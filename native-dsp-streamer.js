// ==========================================
// rooPlayer - Native DSP Progressive Audio Streamer
// High-Resolution Non-Blocking On-The-Fly Audio DSP Engine
// Pure Native JavaScript / WASM (Zero FFmpeg Dependency)
// ==========================================

const fs = require('fs');
const path = require('path');
const os = require('os');
const stream = require('stream');
const EventEmitter = require('events');
const { Worker } = require('worker_threads');
const nativeAudioEngine = require('./native-audio-engine');
const { interpolateSample, buildGaussFilter, firSample, buildFilterForPhase, resolveInterpFn, getDsdRate, buildDsfHeader, DSD_BLOCK_SIZE, DSD_SAMPLES_PER_BLOCK, createPeqChain, createPeqState, processPeqPair, applyPeqArrays, createConvolutionState, processConvolutionPair, applyConvolutionArrays, irResponsePeak } = require('./dsp-kernel');

// Progressive Streaming Reader with Backpressure Flow Control
// Prevents downstream DLNA/UPnP renderers from reading unwritten / zero-padded blocks
class ProgressiveFileStream extends stream.Readable {
  constructor(filePath, start, end, session) {
    super({ highWaterMark: 64 * 1024 });
    this.filePath = filePath;
    this.currentPos = start;
    this.endPos = end;
    this.session = session;
    this.fd = fs.openSync(filePath, 'r');
    this._isClosed = false;

    this._onProgress = () => {
      this._tryRead();
    };
    if (this.session) {
      this.session.on('progress', this._onProgress);
      this.session.on('complete', this._onProgress);
    }
  }

  _destroy(err, callback) {
    this._cleanup();
    callback(err);
  }

  _cleanup() {
    if (this._isClosed) return;
    this._isClosed = true;
    if (this.session) {
      this.session.removeListener('progress', this._onProgress);
      this.session.removeListener('complete', this._onProgress);
    }
    try { fs.closeSync(this.fd); } catch (e) {}
  }

  _read(size) {
    this._tryRead(size);
  }

  _tryRead(size = 64 * 1024) {
    if (this._isClosed) return;
    if (this.currentPos > this.endPos) {
      this.push(null);
      this._cleanup();
      return;
    }

    // Allow tail metadata probes (e.g. ID3 tags at end of file) to read directly without blocking
    const isTailProbe = this.session && this.session.totalFileBytes && (this.currentPos > this.session.totalFileBytes - 256 * 1024);
    const availableEnd = (this.session && !isTailProbe)
      ? Math.min(this.endPos + 1, this.session.bytesWritten)
      : (this.endPos + 1);
    const available = availableEnd - this.currentPos;

    if (available <= 0) {
      if (this.session && this.session.isCompleted) {
        this.push(null);
        this._cleanup();
      }
      // Upstream writer hasn't generated this block yet; wait for progress notification
      return;
    }

    const readBytes = Math.min(size, available);
    const buf = Buffer.alloc(readBytes);
    try {
      const bytesRead = fs.readSync(this.fd, buf, 0, readBytes, this.currentPos);
      if (bytesRead <= 0) {
        if (this.session && this.session.isCompleted) {
          this.push(null);
          this._cleanup();
        }
        return;
      }
      this.currentPos += bytesRead;
      this.push(buf.subarray(0, bytesRead));
      if (this.currentPos > this.endPos) {
        this.push(null);
        this._cleanup();
      }
    } catch (err) {
      this.destroy(err);
    }
  }
}

class NativeDspStreamer {
  constructor() {
    this.cacheDir = path.join(os.tmpdir(), 'rooplayer_dsp_cache');
    try {
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true });
      }
    } catch (e) {
      this.cacheDir = path.join(process.cwd(), 'scratch', 'dsp_cache');
      if (!fs.existsSync(this.cacheDir)) fs.mkdirSync(this.cacheDir, { recursive: true });
    }
    this.activeSessions = new Map(); // token -> session
  }

  // Clean up any stale cache files on startup or exit
  cleanCacheDir() {
    try {
      if (fs.existsSync(this.cacheDir)) {
        const files = fs.readdirSync(this.cacheDir);
        for (const f of files) {
          try {
            fs.unlinkSync(path.join(this.cacheDir, f));
          } catch (e) {}
        }
      }
    } catch (e) {}
  }

  // Create progressive streaming session for PCM -> 1-bit DSD (DSF format)
  // Powered by background worker_threads to prevent any Electron UI / main process lag.
  //
  // Rolling chunk work pool (fix for DLNA playback dropouts + CPU spikes with 5th/7th-order
  // modulators, especially DSD512): a single worker thread modulating 5th/7th-order CIFFR
  // (with FIR phases or at DSD256/512) runs SLOWER than real time (measured 0.4-0.73x for
  // 7th-order DSD512); the progressive DSF file then starves and the DLNA renderer stops after
  // its buffer drains. A fixed pool of up to 8 RESIDENT worker threads is fed small sequential
  // chunks (3-10 s, sized adaptively from each worker's measured real-time factor) by the main
  // thread. The assignment itself is the flow control: only chunks within ~20 s of the
  // contiguous frontier are handed out, so pre-generation is bounded and workers idle when the
  // pool is ahead - CPU tracks real-time demand instead of racing to a shared cap and waking in
  // synchronized polling bursts (the old design's periodic ~50% CPU spikes starved HTTP serving
  // and caused dropouts). First-round assignments are staggered so chunk completions interleave
  // and the prefix advances in small steps. Each non-first chunk additionally modulates ~1.5 s
  // of preceding audio (warm-up) that is DISCARDED, so its integrator state at the chunk
  // boundary has converged to the continuous-run state (no audible discontinuity). Chunk 0 is
  // short (~5 s), starts at sample 0 with no warm-up, and is bit-identical to a single-pass
  // whole-file encoding. Chunk/view boundaries keep the input<->output sample mapping exact
  // (required for non-integer ratios such as 48k -> DSD).
  async createDsdSession(token, filePath, startSec = 0, dsdMode = 'dsd64', track = null, dsdOrder = 5, filterPhase = 'linear', peqOptions = null, convOptions = null, isDlna = false, ultrasonicFilter = '30k', dither = 'gauss1') {
    this.cancelSession(token);

    const tmpFile = path.join(this.cacheDir, `stream_${token}_${Date.now()}.dsf`);
    const pcm = await nativeAudioEngine.readPcmSamples(filePath, startSec);
    if (!pcm) throw new Error('Native PCM read failed for DSD modulation');

    const srcRate = pcm.sampleRate;
    const rawLeft = pcm.left;
    const rawRight = pcm.right;

    // DLNA 串流發燒前導防護（Resync Lead-in Silence Padding）：
    // 當 DLNA 串流從開頭播放（isDlna && startSec === 0）時，前置注入 0.6 秒純靜音（零信號）。
    // 徹底解決各廠牌 DLNA / UPnP 渲染器在開播時因硬體 DAC 時脈 PLL 鎖定及防爆音軟淡入
    // 而導致「開頭第一秒前奏被硬生生吃掉」的發燒痛點！
    const LEAD_IN_SEC = (isDlna && startSec === 0) ? 0.6 : 0;
    const leadInFrames = Math.round(LEAD_IN_SEC * srcRate);
    let pcmL = rawLeft;
    let pcmR = rawRight;
    if (leadInFrames > 0) {
      const paddedL = new Float32Array(rawLeft.length + leadInFrames);
      const paddedR = new Float32Array(rawRight.length + leadInFrames);
      paddedL.set(rawLeft, leadInFrames);
      paddedR.set(rawRight, leadInFrames);
      pcmL = paddedL;
      pcmR = paddedR;
    }
    const inLen = pcmL.length;

    // Convolution (IR) applied in the main process on the source-rate PCM before modulation
    // (DSD-rate convolution is impractical; the workers keep modulating plain PCM).
    let convIrRaw = null;
    try {
      const irData = await this.loadConvolutionIr(convOptions, srcRate);
      if (irData) {
        const cst = createConvolutionState(srcRate, irData.irL, irData.irR);
        if (cst) {
          applyConvolutionArrays(cst, pcmL, pcmR, pcmL, pcmR, inLen);
          convIrRaw = irData.raw;
        }
      }
    } catch (e) { convIrRaw = null; }
    const dsdRate = getDsdRate(dsdMode);
    const samplesPerBlock = DSD_SAMPLES_PER_BLOCK;
    const blockSize = DSD_BLOCK_SIZE;
    const bytesPerBlockPair = 2 * blockSize;
    const outBits = Math.floor(inLen * (dsdRate / srcRate));
    const totalBlocks = Math.ceil(outBits / samplesPerBlock);
    const totalSamplesPerChannel = totalBlocks * samplesPerBlock;
    const totalFileBytes = 92 + totalBlocks * bytesPerBlockPair;

    // 92-byte standard Sony DSF header, written once here; workers only write their data ranges.
    const fd = fs.openSync(tmpFile, 'w+');
    fs.ftruncateSync(fd, totalFileBytes);
    fs.writeSync(fd, buildDsfHeader(totalFileBytes, dsdRate, totalSamplesPerChannel, blockSize), 0, 92, 0);
    fs.closeSync(fd);

    // --- Segment geometry (exact integer input<->output mapping) ---
    const gcd = (a, b) => (b ? gcd(b, a % b) : a);
    // Segment boundaries are multiples of segAlignBlocks so startBlock * samplesPerBlock always
    // maps to an exact integer input-sample offset.
    const segAlignBlocks = dsdRate / gcd(samplesPerBlock * srcRate, dsdRate);
    // Warm-up / guard bit counts are multiples of stepBits so their input-sample spans are integral.
    const stepBits = dsdRate / gcd(srcRate, dsdRate);
    // Guard: max FIR window span in input samples (design cap 150 MMAC/s/ch) + interpolation margin.
    // 必須基於 srcRate (而非 dsdRate) 確保有足夠的輸入樣本讓 FIR 濾波器衰減至零，杜絕 Chunk 邊界截斷失真
    const guardSamples = Math.ceil(150e6 / srcRate / 2) + 32;
    const guardBits = Math.ceil((guardSamples * dsdRate / srcRate) / stepBits) * stepBits;
    const warmupLcm = (samplesPerBlock * stepBits) / gcd(samplesPerBlock, stepBits);
    // Pre-roll = ~1.5 s of the segment's PRECEDING audio (true modulator warm-up) + FIR guard,
    // rounded up to whole blocks so generation and file mapping stay block-aligned.
    const preRollBitsFull = Math.ceil(((1.5 * dsdRate) + guardBits) / warmupLcm) * warmupLcm;

    // --- Rolling chunk work pool (fix for DSD512 / 7th-order modulation) ---
    // Measured single-thread RTF for 7th-order DSD512 is 0.4-0.73x real-time, so the old fixed
    // geometric segments (5 s growing x1.5) made the contiguous prefix CRAWL inside long segments
    // at one worker's sub-realtime rate: the renderer buffer drained and playback stuttered for
    // minutes ("斷斷續續"). The shared sliding-window cap + Atomics.wait 1 s polling also made
    // every capped worker wake on the same timeout boundary and race simultaneously - periodic
    // ~50% CPU spikes that starved the main-process HTTP serving (more dropouts).
    // New design: a fixed pool of W resident workers fed SMALL sequential chunks (3-10 s, sized
    // adaptively from each worker's measured RTF) by the main thread. The assignment itself is
    // the flow control (no Atomics at all): only chunks within AHEAD_SEC of the contiguous
    // frontier are assigned, so total pre-generation is bounded and workers idle when ahead -
    // CPU automatically tracks real-time demand instead of bursting. The first round of
    // assignments is staggered (MIN_GAP_MS) so chunk completions interleave and the prefix
    // advances in small steps instead of one giant jump. Chunk 0 (no warm-up, from sample 0) is
    // bit-identical to a single-pass whole-file encoding; every later chunk warm-starts 1.5 s
    // of the true preceding audio (discarded) so chunk joins match a continuous run.
    const blocksPerSec = dsdRate / samplesPerBlock;
    const W = Math.max(1, Math.min(8, os.cpus().length - 1));
    const AHEAD_SEC = 20;
    const aheadBlocks = Math.max(1, Math.round(AHEAD_SEC * blocksPerSec));
    const MIN_GAP_MS = 250; // first-round assignment stagger
    const CHUNK0_SEC = 5;
    const INIT_SEC = 4; // session resolves (renderer may start) once this much is available
    const chunk0Blocks = Math.min(totalBlocks, Math.max(segAlignBlocks, Math.round((CHUNK0_SEC * blocksPerSec) / segAlignBlocks) * segAlignBlocks));
    const initBlocks = Math.min(chunk0Blocks, Math.max(1, Math.round((INIT_SEC * blocksPerSec) / segAlignBlocks) * segAlignBlocks));

    let rEst = 0; // EMA of measured per-chunk worker RTF (audioSec / wallSec); 0 = not yet measured
    const chunkSizeFor = (startBlock) => {
      let sec;
      if (startBlock === 0) sec = CHUNK0_SEC;
      else if (rEst === 0 || rEst < 0.7) sec = 4;     // well below real time: small chunks -> frequent prefix jumps
      else if (rEst < 0.9) sec = 6;                   // slightly below real time: medium chunks (deficit < 1.1 s)
      else if (rEst < 2) sec = 10;                    // at/above real time: large chunks, minimal warm-up overhead
      else sec = 15;                                  // far above real time (DSD64/128): largest chunks (overhead 9%)
      let sizeBlocks = Math.max(segAlignBlocks, Math.round((sec * blocksPerSec) / segAlignBlocks) * segAlignBlocks);
      if (startBlock + sizeBlocks > totalBlocks) sizeBlocks = totalBlocks - startBlock; // final chunk may be short
      return Math.max(1, sizeBlocks);
    };

    // Shared PCM: SharedArrayBuffer views are shared with every worker without per-worker copies.
    const leftSAB = new SharedArrayBuffer(pcmL.byteLength);
    new Float32Array(leftSAB).set(pcmL);
    const rightSAB = new SharedArrayBuffer(pcmR.byteLength);
    new Float32Array(rightSAB).set(pcmR);

    const session = new EventEmitter();
    session.token = token;
    session.filePath = tmpFile;
    session.mimeType = 'audio/x-dsf';
    session.bytesWritten = 92;
    session.isCompleted = false;
    session.isCancelled = false;
    session.totalFileBytes = totalFileBytes;
    session.leadInSec = LEAD_IN_SEC;
    session.durationSec = rawLeft.length / srcRate; // 歌曲原始真實長度
    session.chunk0Blocks = chunk0Blocks; // exposed for bit-identical regression tests
    // Source PCM exposed for the NOW PLAYING real-time spectrum (對準音樂原始樣本，毫秒級精準對齊)
    session.startSec = startSec;
    session.spectrum = { rate: srcRate, left: rawLeft, right: rawRight };
    // PEQ (applied by every worker on its own view at srcRate before modulation; the raw
    // source PCM above stays untouched - the spectrum window applies PEQ separately).
    session.peqOptions = peqOptions && peqOptions.enabled ? peqOptions : null;
    session.convOptions = convIrRaw ? convOptions : null;
    session.convIrRaw = convIrRaw;
    session.ultrasonicFilter = ultrasonicFilter || '30k';
    session.dither = dither || 'gauss1';

    const workerPath = path.join(__dirname, 'dsd-modulator-worker.js');
    const pool = [];             // resident worker entries { worker, idle, currentChunk }
    const idleWorkers = [];      // entries currently awaiting an assignment
    const chunkMeta = [];        // assigned chunks: { startBlock, endBlock }
    const chunkProgress = [];    // absolute contiguous completed blocks per assigned chunk
    const chunkRetries = new Map();
    let nextStartBlock = 0;      // next unassigned chunk start (blocks)
    let allAssigned = false;
    let firstRoundAssigned = 0;  // assignments in the initial staggered round
    let lastAssignAt = 0;
    let chunk0Started = false;   // chunk 0 has produced its first batch (frontier is moving)
    let initDone = false;
    let initError = null;
    let resolveInit, rejectInit;
    const initPromise = new Promise((res, rej) => { resolveInit = res; rejectInit = rej; });

    // The reader may only consume the contiguous completed prefix across all chunks.
    let currentPrefixBlocks = 0;
    const updateAvailable = () => {
      let prefix = 0;
      for (let i = 0; i < chunkMeta.length; i++) {
        if (chunkProgress[i] >= chunkMeta[i].endBlock) { prefix = chunkMeta[i].endBlock; continue; }
        prefix = chunkProgress[i];
        break;
      }
      currentPrefixBlocks = prefix;
      session.bytesWritten = 92 + prefix * bytesPerBlockPair;
      session.emit('progress', session.bytesWritten);
      if (!initDone && (session.isCompleted || prefix >= initBlocks)) { initDone = true; resolveInit(); }
    };

    const checkComplete = () => {
      if (session.isCompleted) return true;
      if (!allAssigned || chunkMeta.length === 0) return false;
      for (let i = 0; i < chunkMeta.length; i++) {
        if (chunkProgress[i] < chunkMeta[i].endBlock) return false;
      }
      session.isCompleted = true;
      session.bytesWritten = totalFileBytes;
      try { clearInterval(assignTimer); } catch (e) {}
      for (const p of pool) { try { p.worker.terminate(); } catch (e) {} }
      session.emit('complete');
      return true;
    };

    // Assignment IS the flow control: a chunk is only handed out while its start lies within
    // AHEAD_SEC of the contiguous frontier. Workers idle (zero CPU) whenever the pool is ahead,
    // so aggregate generation automatically tracks the renderer's real-time demand.
    const tryAssign = () => {
      if (session.isCompleted || session.isCancelled) return;
      if (checkComplete()) return;
      while (idleWorkers.length > 0 && nextStartBlock < totalBlocks) {
        if (nextStartBlock > currentPrefixBlocks + aheadBlocks) break;
        if (nextStartBlock > 0 && !chunk0Started) break; // keep the startup window clear for chunk 0
        if (firstRoundAssigned < W && Date.now() - lastAssignAt < MIN_GAP_MS) break; // stagger completions
        const startBlock = nextStartBlock;
        const sizeBlocks = chunkSizeFor(startBlock);
        const endBlock = startBlock + sizeBlocks;
        // The view starts warmupBits output-bits before the chunk (exact integer input offset).
        // Generation starts AT the view start: it modulates the chunk's true preceding audio
        // (warm-up) so the integrator state at the chunk boundary matches a continuous run,
        // then writes the chunk itself at its exact file position (no shift). Chunk 0 starts
        // at 0 exactly like a single-worker whole-file pass.
        const warmupBits = startBlock === 0 ? 0 : Math.min(preRollBitsFull, startBlock * samplesPerBlock);
        const viewStartInput = Math.max(0, Math.round(((startBlock * samplesPerBlock - warmupBits) * srcRate) / dsdRate));
        const genEndBit = warmupBits + (endBlock - startBlock) * samplesPerBlock;
        const viewLen = Math.min(inLen - viewStartInput, Math.ceil((genEndBit * srcRate) / dsdRate) + guardSamples);
        const idx = chunkMeta.length;
        chunkMeta.push({ startBlock, endBlock });
        chunkProgress.push(startBlock);
        nextStartBlock = endBlock;
        if (nextStartBlock >= totalBlocks) allAssigned = true;
        const entry = idleWorkers.pop();
        entry.idle = false;
        entry.currentChunk = idx;
        firstRoundAssigned++;
        lastAssignAt = Date.now();
        entry.worker.postMessage({ type: 'assign', idx, startBlock, endBlock, viewStartInput, viewLen, warmupBits, genEndBit });
      }
    };

    // Safety net: drives the staggered first round and recovers missed hand-offs.
    const assignTimer = setInterval(() => { tryAssign(); }, 300);

    if (totalBlocks === 0) {
      session.isCompleted = true;
      session.bytesWritten = totalFileBytes;
      allAssigned = true;
      initDone = true;
      clearInterval(assignTimer);
      resolveInit();
    }

    const spawnWorker = () => {
      const worker = new Worker(workerPath, {
        workerData: {
          tmpFile,
          leftBuffer: leftSAB,
          rightBuffer: rightSAB,
          sampleRate: srcRate,
          dsdMode,
          dsdOrder,
          filterPhase,
          peqOptions: session.peqOptions,
          ultrasonicFilter: session.ultrasonicFilter,
          dither: session.dither
        }
      });
      const entry = { worker, idle: true, currentChunk: -1 };
      pool.push(entry);
      idleWorkers.push(entry);
      worker.on('message', (msg) => {
        if (msg.type === 'progress') {
          chunk0Started = true;
          const c = msg.idx;
          if (c >= 0 && c < chunkProgress.length) chunkProgress[c] = Math.max(chunkProgress[c], msg.blocksWritten);
          updateAvailable();
          tryAssign();
        } else if (msg.type === 'chunkdone') {
          const c = msg.idx;
          const meta = chunkMeta[c];
          if (meta) {
            chunkProgress[c] = Math.max(chunkProgress[c], meta.endBlock);
            const audioSec = (meta.endBlock - meta.startBlock) * samplesPerBlock / dsdRate;
            if (msg.wallSec > 0 && audioSec > 0) {
              const rChunk = audioSec / msg.wallSec;
              rEst = rEst === 0 ? rChunk : rEst * 0.7 + rChunk * 0.3;
            }
          }
          entry.currentChunk = -1;
          entry.idle = true;
          if (!session.isCompleted && !session.isCancelled) idleWorkers.push(entry);
          updateAvailable();
          checkComplete() || tryAssign();
        }
      });
      const degrade = (err) => {
        console.error('[DsdWorker] error:', err);
        if (!initDone) {
          if (!initError) { initError = err; rejectInit(err); }
          return;
        }
        // Retry the unfinished chunk once (regenerated from its start by another worker -
        // same file range, idempotent overwrite); degrade to EOF only on a second failure.
        const c = entry.currentChunk;
        if (c >= 0 && (chunkRetries.get(c) || 0) < 1 && !session.isCompleted && !session.isCancelled) {
          chunkRetries.set(c, (chunkRetries.get(c) || 0) + 1);
          entry.idle = true;
          idleWorkers.push(entry);
          tryAssign();
          return;
        }
        if (!session.isCompleted) {
          session.isCompleted = true;
          try { clearInterval(assignTimer); } catch (e) {}
          session.emit('complete'); // degrade to EOF instead of hanging forever
        }
      };
      worker.on('error', degrade);
      worker.on('exit', (code) => {
        if (code === 0) return; // terminated on complete/cancel
        if (!session.isCompleted && !session.isCancelled) degrade(new Error(`DSD worker exited with code ${code}`));
      });
    };

    if (totalBlocks > 0) {
      // Spawn the whole pool immediately: the parallel workers' module load / JIT warm-up /
      // warm-up regions overlap chunk 0's generation, so the first parallel chunk completions
      // land as early as possible (early completions = early prefix jumps = no startup stall).
      for (let i = 0; i < W; i++) spawnWorker();
    }

    tryAssign(); // kick off chunk 0 immediately

    // 讓呼叫端（DLNA 串流準備流程）能在等待初始緩衝期間就看到進度：session 先交出去，
    // 之後 bytesWritten 的 progress 事件就能被用來顯示「記憶體緩衝中 x 秒音訊」。
    if (typeof this.onSessionInitProgress === 'function') {
      try { this.onSessionInitProgress(session); } catch (e) {}
    }

    try {
      await initPromise;
    } catch (err) {
      try { clearInterval(assignTimer); } catch (e) {}
      for (const p of pool) { try { p.worker.terminate(); } catch (e) {} }
      try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch (e) {}
      throw initError || err;
    }

    session.cancel = () => {
      session.isCancelled = true;
      try { clearInterval(assignTimer); } catch (e) {}
      for (const p of pool) { try { p.worker.terminate(); } catch (e) {} }
      try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch (e) {}
      this.activeSessions.delete(token);
    };

    this.activeSessions.set(token, session);
    return session;
  }

  // Create progressive streaming session for High-Res PCM Upsampling (WAV format)
  async createPcmSession(token, filePath, startSec = 0, targetSampleRate = 192000, track = null, filterPhase = 'linear', peqOptions = null, convOptions = null, isDlna = false) {
    this.cancelSession(token);

    const tmpFile = path.join(this.cacheDir, `stream_${token}_${Date.now()}.wav`);
    const pcm = await nativeAudioEngine.readPcmSamples(filePath, startSec);
    if (!pcm) throw new Error('Native PCM read failed for PCM upsampling');

    const srcRate = pcm.sampleRate;
    const rawLeft = pcm.left;
    const rawRight = pcm.right;

    // DLNA 串流發燒前導防護（Resync Lead-in Silence Padding）：
    // 當 DLNA 串流從開頭播放（isDlna && startSec === 0）時，前置注入 0.6 秒純靜音（零信號）。
    // 徹底解決各廠牌 DLNA / UPnP 渲染器在開播時因硬體 DAC 時脈 PLL 鎖定及防爆音軟淡入
    // 而導致「開頭第一秒前奏被硬生生吃掉」的發燒痛點！
    const LEAD_IN_SEC = (isDlna && startSec === 0) ? 0.6 : 0;
    const leadInFrames = Math.round(LEAD_IN_SEC * srcRate);
    let inL = rawLeft;
    let inR = rawRight;
    if (leadInFrames > 0) {
      const paddedL = new Float32Array(rawLeft.length + leadInFrames);
      const paddedR = new Float32Array(rawRight.length + leadInFrames);
      paddedL.set(rawLeft, leadInFrames);
      paddedR.set(rawRight, leadInFrames);
      inL = paddedL;
      inR = paddedR;
    }
    const inLen = inL.length;
    const ratio = targetSampleRate / srcRate;
    const outFrames = Math.floor(inLen * ratio);

    // 濾波器插件：FIR 插件經 buildFilterForPhase 建立係數（設計見 dsp-kernel.js 與
    // filter-plugins/）；內建/自訂內插插件走 interpolateSample 或插件自取樣函數。
    let gaussFilter = null;
    try { gaussFilter = buildFilterForPhase(targetSampleRate, srcRate, filterPhase); } catch (e) { gaussFilter = null; }
    const customInterp = gaussFilter ? null : resolveInterpFn(filterPhase);

    // PEQ at the output rate (applied after interpolation, before 24-bit packing). The biquad
    // state persists across chunks, so the EQ response is continuous over the whole stream.
    let peqChain = null, peqState = null;
    try { peqChain = createPeqChain(targetSampleRate, peqOptions); } catch (e) { peqChain = null; }
    if (peqChain) peqState = createPeqState(peqChain);

    // Convolution (IR) at the output rate, after PEQ: partitioned frequency-domain filtering.
    let convState = null, convIrRaw = null;
    try {
      const irData = await this.loadConvolutionIr(convOptions, targetSampleRate);
      if (irData) {
        convState = createConvolutionState(targetSampleRate, irData.irL, irData.irR);
        if (convState) convIrRaw = irData.raw;
      }
    } catch (e) { convState = null; }

    const bytesPerSample = 3; // 24-bit PCM
    const channels = 2;
    const blockAlign = channels * bytesPerSample;
    const totalDataBytes = outFrames * blockAlign;
    const totalFileBytes = 44 + totalDataBytes;

    // 1. Instant pre-allocation on disk
    const fd = fs.openSync(tmpFile, 'w+');
    fs.ftruncateSync(fd, totalFileBytes);

    // 2. Write 44 bytes WAV Header
    const header = Buffer.alloc(44);
    let off = 0;
    header.write('RIFF', off); off += 4;
    header.writeUInt32LE(totalFileBytes - 8, off); off += 4;
    header.write('WAVE', off); off += 4;

    header.write('fmt ', off); off += 4;
    header.writeUInt32LE(16, off); off += 4; // Subchunk1Size (16 for PCM)
    header.writeUInt16LE(1, off); off += 2;  // AudioFormat (1 = PCM)
    header.writeUInt16LE(channels, off); off += 2;
    header.writeUInt32LE(targetSampleRate, off); off += 4;
    header.writeUInt32LE(targetSampleRate * blockAlign, off); off += 4; // ByteRate
    header.writeUInt16LE(blockAlign, off); off += 2;
    header.writeUInt16LE(24, off); off += 2; // BitsPerSample = 24

    header.write('data', off); off += 4;
    header.writeUInt32LE(totalDataBytes, off); off += 4;

    fs.writeSync(fd, header, 0, 44, 0);

    const session = new EventEmitter();
    session.token = token;
    session.filePath = tmpFile;
    session.mimeType = 'audio/wav';
    session.totalFileBytes = totalFileBytes;
    session.bytesWritten = 44;
    session.isCompleted = false;
    session.isCancelled = false;
    session.leadInSec = LEAD_IN_SEC;
    session.durationSec = rawLeft.length / srcRate; // 歌曲原始真實長度
    // Source PCM for the NOW PLAYING real-time spectrum (對準音樂原始樣本，毫秒級精準對齊)
    session.startSec = startSec;
    session.spectrum = { rate: srcRate, left: rawLeft, right: rawRight };
    session.peqOptions = peqChain ? peqOptions : null;
    session.convOptions = convState ? convOptions : null;
    session.convIrRaw = convState ? convIrRaw : null;

    // 3. Encoder state & chunk writer using selected filter phase interpolation
    let framesWritten = 0;
    let timer = null;

    const writePcmChunk = (chunkFrames) => {
      if (session.isCancelled || framesWritten >= outFrames) return framesWritten;
      const startF = framesWritten;
      const endF = Math.min(outFrames, startF + chunkFrames);
      const count = endF - startF;
      const buf = Buffer.allocUnsafe(count * blockAlign);
      let bufOff = 0;

      for (let i = startF; i < endF; i++) {
        let sL, sR;
        if (gaussFilter) {
          sL = firSample(inL, inLen, i, ratio, gaussFilter);
          sR = firSample(inR, inLen, i, ratio, gaussFilter);
        } else {
        const srcPos = i / ratio;
        const idx = srcPos | 0;
        const t = srcPos - idx;

        const p0L = idx > 0 ? inL[idx - 1] : inL[0];
        const p1L = inL[idx];
        const p2L = idx < inLen - 1 ? inL[idx + 1] : p1L;
        const p3L = idx < inLen - 2 ? inL[idx + 2] : p2L;
        sL = customInterp ? customInterp(p0L, p1L, p2L, p3L, t) : interpolateSample(p0L, p1L, p2L, p3L, t, filterPhase);

        const p0R = idx > 0 ? inR[idx - 1] : inR[0];
        const p1R = inR[idx];
        const p2R = idx < inLen - 1 ? inR[idx + 1] : p1R;
        const p3R = idx < inLen - 2 ? inR[idx + 2] : p2R;
        sR = customInterp ? customInterp(p0R, p1R, p2R, p3R, t) : interpolateSample(p0R, p1R, p2R, p3R, t, filterPhase);
        }

        if (peqChain) {
          const po = processPeqPair(peqChain, peqState, sL, sR);
          sL = po[0];
          sR = po[1];
        }

        if (convState) {
          const co = processConvolutionPair(convState, sL, sR);
          sL = co[0];
          sR = co[1];
        }

        // 24-bit PCM clamp and pack (Little-Endian)
        const iL = Math.max(-8388608, Math.min(8388607, Math.floor(sL * 8388607)));
        const uL = (iL < 0) ? (iL + 16777216) : iL;
        buf[bufOff++] = uL & 0xFF;
        buf[bufOff++] = (uL >> 8) & 0xFF;
        buf[bufOff++] = (uL >> 16) & 0xFF;

        const iR = Math.max(-8388608, Math.min(8388607, Math.floor(sR * 8388607)));
        const uR = (iR < 0) ? (iR + 16777216) : iR;
        buf[bufOff++] = uR & 0xFF;
        buf[bufOff++] = (uR >> 8) & 0xFF;
        buf[bufOff++] = (uR >> 16) & 0xFF;
      }

      const fileOffset = 44 + startF * blockAlign;
      fs.writeSync(fd, buf, 0, buf.length, fileOffset);
      framesWritten = endF;
      session.bytesWritten = 44 + framesWritten * blockAlign;
      session.emit('progress', session.bytesWritten);
      return framesWritten;
    };

    // 4. Generate initial 3 seconds of upsampled frames (< 150ms)
    const initialFrames = Math.min(outFrames, targetSampleRate * 3);
    writePcmChunk(initialFrames);

    // 5. Background progressive generator: writes ~5 seconds of frames every 25ms
    timer = setInterval(() => {
      if (session.isCancelled) {
        clearInterval(timer);
        return;
      }
      if (framesWritten < outFrames) {
        writePcmChunk(targetSampleRate * 5);
      } else {
        clearInterval(timer);
        timer = null;
        session.isCompleted = true;
        session.emit('complete');
        try { fs.closeSync(fd); } catch (e) {}
      }
    }, 25);

    session.cancel = () => {
      session.isCancelled = true;
      if (timer) clearInterval(timer);
      try { fs.closeSync(fd); } catch (e) {}
      try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch (e) {}
      this.activeSessions.delete(token);
    };

    this.activeSessions.set(token, session);
    return session;
  }

  // Create streaming session for Native DSF/DFF Decimation to 24-bit / 88.2 kHz WAV
  async createDsdDecimateSession(token, filePath, startSec = 0, track = null, peqOptions = null, convOptions = null, isDlna = false) {
    this.cancelSession(token);

    const tmpFile = path.join(this.cacheDir, `stream_${token}_${Date.now()}.wav`);
    let wavBuf = nativeAudioEngine.decimateDsfToWav(filePath, startSec);
    if (!wavBuf) throw new Error('Native DSD decimation failed');

    // PEQ + Convolution (IR) on the decimated 24-bit PCM (88.2 kHz), applied in place
    // before writing the file. DSD-rate convolution is impractical, so DSF sources with
    // an active IR are routed through this decimate path by the callers.
    const decRate = wavBuf.readUInt32LE(24);
    let peqApplied = null;
    try { peqApplied = createPeqChain(decRate, peqOptions); } catch (e) { peqApplied = null; }
    let convState = null;
    try {
      const irData = await this.loadConvolutionIr(convOptions, decRate);
      if (irData) convState = createConvolutionState(decRate, irData.irL, irData.irR);
    } catch (e) { convState = null; }
    if (peqApplied || convState) {
      const st = peqApplied ? createPeqState(peqApplied) : null;
      const totalFrames = (wavBuf.length - 44) / 6;
      for (let f = 0; f < totalFrames; f++) {
        const p = 44 + f * 6;
        let vL = wavBuf[p] | (wavBuf[p + 1] << 8) | (wavBuf[p + 2] << 16);
        if (vL & 0x800000) vL -= 0x1000000;
        let vR = wavBuf[p + 3] | (wavBuf[p + 4] << 8) | (wavBuf[p + 5] << 16);
        if (vR & 0x800000) vR -= 0x1000000;
        let fL = vL / 8388608, fR = vR / 8388608;
        if (peqApplied) {
          const o = processPeqPair(peqApplied, st, fL, fR);
          fL = o[0];
          fR = o[1];
        }
        if (convState) {
          const co = processConvolutionPair(convState, fL, fR);
          fL = co[0];
          fR = co[1];
        }
        let iL = Math.max(-8388608, Math.min(8388607, Math.floor(fL * 8388607)));
        let iR = Math.max(-8388608, Math.min(8388607, Math.floor(fR * 8388607)));
        if (iL < 0) iL += 16777216;
        if (iR < 0) iR += 16777216;
        wavBuf[p] = iL & 0xFF; wavBuf[p + 1] = (iL >> 8) & 0xFF; wavBuf[p + 2] = (iL >> 16) & 0xFF;
        wavBuf[p + 3] = iR & 0xFF; wavBuf[p + 4] = (iR >> 8) & 0xFF; wavBuf[p + 5] = (iR >> 16) & 0xFF;
      }
    }

    const LEAD_IN_SEC = (isDlna && startSec === 0) ? 0.6 : 0;
    const leadInFrames = Math.round(LEAD_IN_SEC * decRate);
    if (leadInFrames > 0) {
      const leadInBytes = leadInFrames * 6;
      const newTotalDataBytes = (wavBuf.length - 44) + leadInBytes;
      const newTotalFileBytes = 44 + newTotalDataBytes;
      const paddedBuf = Buffer.alloc(newTotalFileBytes);
      wavBuf.copy(paddedBuf, 0, 0, 44);
      paddedBuf.writeUInt32LE(newTotalFileBytes - 8, 4);
      paddedBuf.writeUInt32LE(newTotalDataBytes, 40);
      wavBuf.copy(paddedBuf, 44 + leadInBytes, 44);
      wavBuf = paddedBuf;
    }

    fs.writeFileSync(tmpFile, wavBuf);

    const session = new EventEmitter();
    session.token = token;
    session.filePath = tmpFile;
    session.mimeType = 'audio/wav';
    session.totalFileBytes = wavBuf.length;
    session.bytesWritten = wavBuf.length;
    session.isCompleted = true;
    session.leadInSec = LEAD_IN_SEC;
    session.durationSec = (track && track.duration > 0) ? track.duration : ((wavBuf.length - 44 - (leadInFrames * 6)) / (decRate * 6));
    // Decimated 24-bit PCM WAV is fully in memory: windows are read straight from it.
    session.startSec = startSec;
    session.spectrum = { rate: decRate, wav24: wavBuf.subarray(44 + (leadInFrames * 6)), peqApplied: !!peqApplied, convApplied: !!convState };
    session.peqOptions = peqApplied ? peqOptions : null;
    session.convOptions = convState ? convOptions : null;
    session.cancel = () => {
      try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch (e) {}
      this.activeSessions.delete(token);
    };

    this.activeSessions.set(token, session);
    return session;
  }

  // Cancel an active session
  cancelSession(token) {
    if (this.activeSessions.has(token)) {
      const s = this.activeSessions.get(token);
      try { s.cancel(); } catch (e) {}
      this.activeSessions.delete(token);
    }
  }

  // Get active session by token
  getSession(token) {
    return this.activeSessions.get(token);
  }

  // ----------------- Convolution IR pipeline -----------------
  // Load an IR WAV (16/24/32-bit int or 32-bit float, mono or stereo), resample it to the
  // session rate with the engine's own FIR resampler, and attenuate it when its frequency
  // response peak exceeds unity (anti-clipping; reported back for the UI).
  // Returns { irL, irR (Float64, at targetRate), raw {rate, L, R}, normDb, taps } or null.
  async loadConvolutionIr(convOptions, targetRate) {
    if (!convOptions || !convOptions.enabled || !convOptions.irPath) return null;
    if (!fs.existsSync(convOptions.irPath)) return null;
    const ir = await nativeAudioEngine.readPcmSamples(convOptions.irPath, 0, 60);
    if (!ir || !ir.frameCount || !ir.left || !ir.left.length) return null;

    const rawL = Float64Array.from(ir.left);
    const rawR = Float64Array.from(ir.right);
    let irL = rawL, irR = rawR;
    if (ir.sampleRate !== targetRate) {
      irL = resampleIrSamples(rawL, ir.sampleRate, targetRate);
      irR = resampleIrSamples(rawR, ir.sampleRate, targetRate);
    }

    let normDb = 0;
    const peak = Math.max(irResponsePeak(irL), irResponsePeak(irR));
    if (peak > 1.0) {
      const g = 1.0 / peak;
      if (irL === rawL) { irL = Float64Array.from(rawL); irR = Float64Array.from(rawR); }
      for (let i = 0; i < irL.length; i++) { irL[i] *= g; irR[i] *= g; }
      normDb = 20 * Math.log10(g);
    }
    return { irL, irR, raw: { rate: ir.sampleRate, L: rawL, R: rawR }, normDb, taps: irL.length };
  }

  // Synchronous spectrum-path variant: rebuild from the raw IR cached on the session.
  _convStateFromRaw(raw, rate) {
    try {
      if (!raw || !raw.L || !raw.L.length) return null;
      let irL = raw.L, irR = raw.R;
      if (raw.rate !== rate) {
        irL = resampleIrSamples(raw.L, raw.rate, rate);
        irR = resampleIrSamples(raw.R, raw.rate, rate);
      }
      const peak = Math.max(irResponsePeak(irL), irResponsePeak(irR));
      if (peak > 1.0) {
        const g = 1.0 / peak;
        const sL = Float64Array.from(irL), sR = Float64Array.from(irR);
        for (let i = 0; i < sL.length; i++) { sL[i] *= g; sR[i] *= g; }
        irL = sL; irR = sR;
      }
      return createConvolutionState(rate, irL, irR);
    } catch (e) { return null; }
  }

  // Real-time spectrum window for the NOW PLAYING visualizer: returns the SOURCE PCM around a
  // playback time from an active DSP session (no extra decoding - the audio is already in memory).
  getSpectrumWindow(token, timeSec, windowSamples = 4096) {
    const session = token ? this.activeSessions.get(token) : null;
    if (!session || !session.spectrum || session.isCancelled) return null;
    const spec = session.spectrum;
    const relSec = timeSec - (session.startSec || 0);
    if (relSec < -1 || relSec > session.durationSec + 2) return null;
    const n = Math.max(256, Math.min(windowSamples, 8192));
    const outL = new Float32Array(n), outR = new Float32Array(n);
    if (spec.wav24) {
      const totalFrames = spec.wav24.length / 6;
      const off = Math.max(0, Math.min(totalFrames - n, Math.round(relSec * spec.rate)));
      for (let i = 0; i < n; i++) {
        const f = off + i; if (f >= totalFrames) break;
        const p = f * 6;
        let vL = spec.wav24[p] | (spec.wav24[p + 1] << 8) | (spec.wav24[p + 2] << 16);
        if (vL & 0x800000) vL -= 0x1000000;
        let vR = spec.wav24[p + 3] | (spec.wav24[p + 4] << 8) | (spec.wav24[p + 5] << 16);
        if (vR & 0x800000) vR -= 0x1000000;
        outL[i] = vL / 8388608; outR[i] = vR / 8388608;
      }
    } else {
      const len = spec.left.length;
      const off = Math.max(0, Math.min(len - n, Math.round(relSec * spec.rate)));
      outL.set(spec.left.subarray(off, off + n));
      outR.set(spec.right.subarray(off, off + n));
    }
    // DSD/PCM sessions keep the RAW source PCM for the spectrum; show the EQ the listener
    // actually hears by running the same PEQ over the window (fresh state per window: the
    // biquad transient decays in the first half, the FFT uses the settled second half).
    if (session.peqOptions && !spec.peqApplied) {
      if (!session._peqSpecChain || session._peqSpecChain.fs !== spec.rate) {
        try { session._peqSpecChain = createPeqChain(spec.rate, session.peqOptions); } catch (e) { session._peqSpecChain = null; }
      }
      if (session._peqSpecChain) applyPeqArrays(session._peqSpecChain, outL, outR, outL, outR, n);
    }
    // Convolution (IR) for the spectrum too: fresh state per window from the session's cached
    // raw IR (the first B samples are block latency; the FFT uses the settled remainder).
    if (session.convOptions && session.convIrRaw && !spec.convApplied) {
      if (!session._convSpecState || session._convSpecRate !== spec.rate) {
        session._convSpecState = this._convStateFromRaw(session.convIrRaw, spec.rate);
        session._convSpecRate = session._convSpecState ? spec.rate : -1;
      }
      if (session._convSpecState) applyConvolutionArrays(session._convSpecState, outL, outR, outL, outR, n);
    }
    return { rate: spec.rate, left: outL, right: outR };
  }

  // Cleanup all sessions on app exit
  destroy() {
    for (const [token, s] of this.activeSessions.entries()) {
      try { s.cancel(); } catch (e) {}
    }
    this.activeSessions.clear();
    this.cleanCacheDir();
  }
}

const instance = new NativeDspStreamer();
instance.ProgressiveFileStream = ProgressiveFileStream;

// Offline IR resampling with the engine's FIR resampler (gain-preserving: Σh = ratio).
// Hermite fallback keeps the IR usable if the FIR design path ever fails.
function resampleIrSamples(samples, srcRate, dstRate) {
  const ratio = dstRate / srcRate;
  const outLen = Math.max(1, Math.round(samples.length * ratio));
  const out = new Float64Array(outLen);
  let gf = null;
  try { gf = buildGaussFilter(dstRate, srcRate); } catch (e) { gf = null; }
  if (gf) {
    for (let i = 0; i < outLen; i++) out[i] = firSample(samples, samples.length, i, ratio, gf);
    return out;
  }
  for (let i = 0; i < outLen; i++) {
    const srcPos = i / ratio;
    const idx = srcPos | 0;
    const t = srcPos - idx;
    const last = samples.length - 1;
    const p1 = samples[Math.min(idx, last)];
    const p0 = idx > 0 ? samples[idx - 1] : p1;
    const p2 = idx < last ? samples[idx + 1] : p1;
    const p3 = idx < last - 1 ? samples[idx + 2] : p2;
    out[i] = interpolateSample(p0, p1, p2, p3, t, 'linear');
  }
  return out;
}

// Shared helper: apply a PEQ chain to a complete 24-bit WAV buffer in place (used by the
// local /dsd-stream decimation path in main.js, mirroring createDsdDecimateSession).
instance.applyPeqToWavBuffer = function (wavBuf, peqOptions) {
  let chain = null;
  try { chain = createPeqChain(wavBuf.readUInt32LE(24), peqOptions); } catch (e) { chain = null; }
  if (!chain) return wavBuf;
  const st = createPeqState(chain);
  const totalFrames = (wavBuf.length - 44) / 6;
  for (let f = 0; f < totalFrames; f++) {
    const p = 44 + f * 6;
    let vL = wavBuf[p] | (wavBuf[p + 1] << 8) | (wavBuf[p + 2] << 16);
    if (vL & 0x800000) vL -= 0x1000000;
    let vR = wavBuf[p + 3] | (wavBuf[p + 4] << 8) | (wavBuf[p + 5] << 16);
    if (vR & 0x800000) vR -= 0x1000000;
    const o = processPeqPair(chain, st, vL / 8388608, vR / 8388608);
    let iL = Math.max(-8388608, Math.min(8388607, Math.floor(o[0] * 8388607)));
    let iR = Math.max(-8388608, Math.min(8388607, Math.floor(o[1] * 8388607)));
    if (iL < 0) iL += 16777216;
    if (iR < 0) iR += 16777216;
    wavBuf[p] = iL & 0xFF; wavBuf[p + 1] = (iL >> 8) & 0xFF; wavBuf[p + 2] = (iL >> 16) & 0xFF;
    wavBuf[p + 3] = iR & 0xFF; wavBuf[p + 4] = (iR >> 8) & 0xFF; wavBuf[p + 5] = (iR >> 16) & 0xFF;
  }
  return wavBuf;
};

// Shared helper: apply a convolution IR to a complete 24-bit WAV buffer in place (used by
// the local /dsd-stream decimation path in main.js, mirroring createDsdDecimateSession).
instance.applyConvToWavBufferAsync = async function (wavBuf, convOptions) {
  let convState = null;
  try {
    const irData = await instance.loadConvolutionIr(convOptions, wavBuf.readUInt32LE(24));
    if (irData) convState = createConvolutionState(wavBuf.readUInt32LE(24), irData.irL, irData.irR);
  } catch (e) { return wavBuf; }
  if (!convState) return wavBuf;
  const totalFrames = (wavBuf.length - 44) / 6;
  for (let f = 0; f < totalFrames; f++) {
    const p = 44 + f * 6;
    let vL = wavBuf[p] | (wavBuf[p + 1] << 8) | (wavBuf[p + 2] << 16);
    if (vL & 0x800000) vL -= 0x1000000;
    let vR = wavBuf[p + 3] | (wavBuf[p + 4] << 8) | (wavBuf[p + 5] << 16);
    if (vR & 0x800000) vR -= 0x1000000;
    const o = processConvolutionPair(convState, vL / 8388608, vR / 8388608);
    let iL = Math.max(-8388608, Math.min(8388607, Math.floor(o[0] * 8388607)));
    let iR = Math.max(-8388608, Math.min(8388607, Math.floor(o[1] * 8388607)));
    if (iL < 0) iL += 16777216;
    if (iR < 0) iR += 16777216;
    wavBuf[p] = iL & 0xFF; wavBuf[p + 1] = (iL >> 8) & 0xFF; wavBuf[p + 2] = (iL >> 16) & 0xFF;
    wavBuf[p + 3] = iR & 0xFF; wavBuf[p + 4] = (iR >> 8) & 0xFF; wavBuf[p + 5] = (iR >> 16) & 0xFF;
  }
  return wavBuf;
};

module.exports = instance;
