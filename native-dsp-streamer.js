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
const { interpolateSample, buildGaussFilter, buildPolyExt2Filter, buildHqpPsExt2Filter, firSample, getDsdRate, buildDsfHeader, DSD_BLOCK_SIZE, DSD_SAMPLES_PER_BLOCK } = require('./dsp-kernel');

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
  // Parallel segment modulation (fix for DLNA playback dropouts with 5th/7th-order modulators):
  // a single worker thread modulating 5th/7th-order CIFFR (especially with FIR filter phases or
  // at DSD128+) can run SLOWER than real time; the progressive DSF file then starves and the
  // DLNA renderer stops after its buffer drains. The track is split into up to 8 contiguous block
  // segments modulated by parallel worker threads. The FIRST segment is deliberately short (~5 s):
  // the contiguous prefix the renderer consumes is gated by the frontier worker's rate, so a short
  // first segment bounds any stall, and every later segment is pre-generated well before the
  // renderer reaches it (segment sizes grow geometrically x1.5). Each non-first segment additionally
  // modulates ~1.5 s of preceding audio (warm-up) that is DISCARDED, so its integrator state at the
  // segment boundary has converged to the continuous-run state (no audible discontinuity).
  // Segment/view boundaries are chosen so the input<->output sample mapping stays exact
  // (required for non-integer ratios such as 48k -> DSD).
  async createDsdSession(token, filePath, startSec = 0, dsdMode = 'dsd64', track = null, dsdOrder = 5, filterPhase = 'linear') {
    this.cancelSession(token);

    const tmpFile = path.join(this.cacheDir, `stream_${token}_${Date.now()}.dsf`);
    const pcm = await nativeAudioEngine.readPcmSamples(filePath, startSec);
    if (!pcm) throw new Error('Native PCM read failed for DSD modulation');

    const srcRate = pcm.sampleRate;
    const inLen = pcm.left.length;
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
    const guardSamples = Math.ceil(150e6 / dsdRate) + 4;
    const guardBits = Math.ceil((guardSamples * dsdRate / srcRate) / stepBits) * stepBits;
    const warmupLcm = (samplesPerBlock * stepBits) / gcd(samplesPerBlock, stepBits);
    // Pre-roll = ~1.5 s of the segment's PRECEDING audio (true modulator warm-up) + FIR guard,
    // rounded up to whole blocks so generation and file mapping stay block-aligned.
    const preRollBitsFull = Math.ceil(((1.5 * dsdRate) + guardBits) / warmupLcm) * warmupLcm;

    // Segment sizes: first ~5 s, then geometrically x1.5, so the contiguous prefix crosses segment
    // boundaries before a slower-than-real-time frontier worker runs out of lead.
    const segSizes = [];
    {
      let remaining = totalBlocks;
      // Up to 8 parallel workers: modern audiophile machines have 8+ physical cores; the
      // contiguous-prefix frontier gains every worker's output once the first segment lands.
      const maxWorkers = Math.max(1, Math.min(8, os.cpus().length - 1));
      const minSegBlocks = Math.max(segAlignBlocks, Math.round(6 * dsdRate / samplesPerBlock));
      while (remaining > 0 && segSizes.length < maxWorkers) {
        const wantSec = segSizes.length === 0 ? 5 : 5 * Math.pow(1.5, segSizes.length);
        let sizeBlocks = Math.max(segAlignBlocks, Math.round((wantSec * dsdRate / samplesPerBlock) / segAlignBlocks) * segAlignBlocks);
        if (segSizes.length > 0 && remaining - sizeBlocks < minSegBlocks) sizeBlocks = remaining; // merge short tail
        if (sizeBlocks > remaining) sizeBlocks = remaining;
        segSizes.push(sizeBlocks);
        remaining -= sizeBlocks;
      }
    }

    const segs = [];
    {
      let startBlock = 0;
      for (let i = 0; i < segSizes.length; i++) {
        const endBlock = startBlock + segSizes[i];
        // The view starts preRollBits output-bits before the segment (exact integer input offset).
        // Generation starts AT the view start: it modulates the segment's true preceding audio
        // (warm-up) so the integrator state at the segment boundary matches a continuous run,
        // then writes the segment itself at its exact file position (no shift). The first
        // segment starts at 0 exactly like the old single-worker whole-file pass.
        const preRollBits = startBlock === 0 ? 0 : Math.min(preRollBitsFull, startBlock * samplesPerBlock);
        const viewStartInput = Math.max(0, Math.round(((startBlock * samplesPerBlock - preRollBits) * srcRate) / dsdRate));
        const genStartBit = 0;
        const genEndBit = preRollBits + (endBlock - startBlock) * samplesPerBlock;
        const viewLen = Math.min(inLen - viewStartInput, Math.ceil((genEndBit * srcRate) / dsdRate) + guardSamples);
        segs.push({ startBlock, endBlock, viewStartInput, viewLen, genStartBit, genEndBit, warmupBits: preRollBits });
        startBlock = endBlock;
      }
    }
    const K = segs.length;

    // Shared PCM: SharedArrayBuffer views are shared with every worker without per-worker copies.
    const leftSAB = new SharedArrayBuffer(pcm.left.byteLength);
    new Float32Array(leftSAB).set(pcm.left);
    const rightSAB = new SharedArrayBuffer(pcm.right.byteLength);
    new Float32Array(rightSAB).set(pcm.right);

    const session = new EventEmitter();
    session.token = token;
    session.filePath = tmpFile;
    session.mimeType = 'audio/x-dsf';
    session.bytesWritten = 92;
    session.isCompleted = false;
    session.isCancelled = false;
    session.totalFileBytes = totalFileBytes;
    session.durationSec = inLen / srcRate;
    // Source PCM exposed for the NOW PLAYING real-time spectrum (zero-copy views on the
    // SharedArrayBuffers the modulation workers already read).
    session.startSec = startSec;
    session.spectrum = { rate: srcRate, left: new Float32Array(leftSAB), right: new Float32Array(rightSAB) };

    const workerPath = path.join(__dirname, 'dsd-modulator-worker.js');
    const workers = [];
    const workerProgress = segs.map((s) => s.startBlock); // absolute contiguous completed blocks per segment
    let completedCount = 0;
    let initDone = false;
    let initError = null;
    let resolveInit, rejectInit;
    const initPromise = new Promise((res, rej) => { resolveInit = res; rejectInit = rej; });

    // The reader may only consume the contiguous completed prefix across all segments.
    let currentPrefixBlocks = 0;
    const updateAvailable = () => {
      let prefix = 0;
      for (let i = 0; i < K; i++) {
        if (workerProgress[i] >= segs[i].endBlock) { prefix = segs[i].endBlock; continue; }
        prefix = workerProgress[i];
        break;
      }
      currentPrefixBlocks = prefix;
      session.bytesWritten = 92 + prefix * bytesPerBlockPair;
      session.emit('progress', session.bytesWritten);
      updateCaps();
    };

    // Sliding-window cap pacing: a worker may generate at most CAP_AHEAD_SEC of audio beyond
    // the contiguous frontier; beyond that it naps until the frontier approaches. The frontier
    // worker is never capped (always full speed -> the renderer can never starve), while
    // far-ahead workers idle instead of pinning all cores for the whole track - CPU contention
    // had been starving the HTTP serving / Electron and caused periodic pops.
    const blocksPerSec = dsdRate / samplesPerBlock;
    const CAP_AHEAD_SEC = 25;
    const capBlocks = Math.max(1, Math.round(CAP_AHEAD_SEC * blocksPerSec));
    const capSAB = new SharedArrayBuffer(K * 4);
    const capView = new Int32Array(capSAB);
    capView.fill(capBlocks); // initial window: prefix = 0
    const updateCaps = () => {
      if (session.isCompleted || session.isCancelled) return;
      const cap = currentPrefixBlocks + capBlocks;
      for (let i = 0; i < K; i++) Atomics.store(capView, i, cap);
    };

    if (K === 0) {
      session.isCompleted = true;
      session.bytesWritten = totalFileBytes;
      initDone = true;
      resolveInit();
    }

    for (let i = 0; i < K; i++) {
      const s = segs[i];
      const worker = new Worker(workerPath, {
        workerData: {
          tmpFile,
          leftBuffer: leftSAB,
          leftByteOffset: s.viewStartInput * 4,
          leftLength: s.viewLen,
          rightBuffer: rightSAB,
          rightByteOffset: s.viewStartInput * 4,
          rightLength: s.viewLen,
          sampleRate: srcRate,
          dsdMode,
          dsdOrder,
          filterPhase,
          genStartBit: s.genStartBit,
          genEndBit: s.genEndBit,
          warmupBits: s.warmupBits,
          writeStartBlock: s.startBlock,
          isPrimary: i === 0,
          capSAB,
          capSlot: i
        }
      });
      workers.push(worker);
      worker.on('message', (msg) => {
        if (msg.type === 'progress' || msg.type === 'initial') {
          workerProgress[i] = Math.max(workerProgress[i], msg.blocksWritten);
          updateAvailable();
          if (msg.type === 'initial' && !initDone) { initDone = true; resolveInit(); }
        }
      });
      worker.on('error', (err) => {
        console.error('[DsdWorker] error:', err);
        if (!initDone) {
          if (!initError) { initError = err; rejectInit(err); }
        } else if (!session.isCompleted) {
          session.isCompleted = true; session.emit('complete'); // degrade to EOF instead of hanging forever
        }
      });
      worker.on('exit', (code) => {
        if (code === 0) {
          workerProgress[i] = segs[i].endBlock;
          completedCount++;
          if (completedCount >= K) {
            session.isCompleted = true;
            session.bytesWritten = totalFileBytes;
            session.emit('complete');
          } else {
            updateAvailable();
          }
        } else if (!initDone) {
          if (!initError) { initError = new Error(`DSD worker exited with code ${code}`); rejectInit(initError); }
        } else if (!session.isCompleted) {
          session.isCompleted = true; session.emit('complete');
        }
      });
    }

    try {
      await initPromise;
    } catch (err) {
      for (const w of workers) { try { w.terminate(); } catch (e) {} }
      try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch (e) {}
      throw initError || err;
    }

    session.cancel = () => {
      session.isCancelled = true;
      for (const w of workers) { try { w.terminate(); } catch (e) {} }
      try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch (e) {}
      this.activeSessions.delete(token);
    };

    this.activeSessions.set(token, session);
    return session;
  }

  // Create progressive streaming session for High-Res PCM Upsampling (WAV format)
  async createPcmSession(token, filePath, startSec = 0, targetSampleRate = 192000, track = null, filterPhase = 'linear') {
    this.cancelSession(token);

    const tmpFile = path.join(this.cacheDir, `stream_${token}_${Date.now()}.wav`);
    const pcm = await nativeAudioEngine.readPcmSamples(filePath, startSec);
    if (!pcm) throw new Error('Native PCM read failed for PCM upsampling');

    const inL = pcm.left;
    const inR = pcm.right;
    const inLen = inL.length;
    const srcRate = pcm.sampleRate;
    const ratio = targetSampleRate / srcRate;
    const outFrames = Math.floor(inLen * ratio);

    // 'gauss-long' / 'gauss-min' 濾波相位：Poly-Sinc-Gauss Long FIR 升頻（線性或最小相位，設計見 dsp-kernel.js）
    // 'poly-ext2'：extended poly sinc (EXT2) 風格 Kaiser 窗 sinc FIR（設計見 dsp-kernel.js）
    // 'hqp-ps-ext2'：poly-sinc-ext2 直譯 FIR：陡峭滾降（過渡帶自源 Nyquist 起始）+ 極深止帶（設計見 dsp-kernel.js）
    let gaussFilter = null;
    if (filterPhase === 'gauss-long' || filterPhase === 'gauss-min') {
      try { gaussFilter = buildGaussFilter(targetSampleRate, srcRate, filterPhase === 'gauss-min'); } catch (e) { gaussFilter = null; }
    } else if (filterPhase === 'poly-ext2') {
      try { gaussFilter = buildPolyExt2Filter(targetSampleRate, srcRate); } catch (e) { gaussFilter = null; }
    } else if (filterPhase === 'hqp-ps-ext2') {
      try { gaussFilter = buildHqpPsExt2Filter(targetSampleRate, srcRate); } catch (e) { gaussFilter = null; }
    }

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
    session.durationSec = inLen / srcRate;
    // Source PCM for the NOW PLAYING real-time spectrum (same arrays the upsampler reads).
    session.startSec = startSec;
    session.spectrum = { rate: srcRate, left: inL, right: inR };

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
        sL = interpolateSample(p0L, p1L, p2L, p3L, t, filterPhase);

        const p0R = idx > 0 ? inR[idx - 1] : inR[0];
        const p1R = inR[idx];
        const p2R = idx < inLen - 1 ? inR[idx + 1] : p1R;
        const p3R = idx < inLen - 2 ? inR[idx + 2] : p2R;
        sR = interpolateSample(p0R, p1R, p2R, p3R, t, filterPhase);
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
  async createDsdDecimateSession(token, filePath, startSec = 0, track = null) {
    this.cancelSession(token);

    const tmpFile = path.join(this.cacheDir, `stream_${token}_${Date.now()}.wav`);
    const wavBuf = nativeAudioEngine.decimateDsfToWav(filePath, startSec);
    if (!wavBuf) throw new Error('Native DSD decimation failed');

    fs.writeFileSync(tmpFile, wavBuf);

    const session = new EventEmitter();
    session.token = token;
    session.filePath = tmpFile;
    session.mimeType = 'audio/wav';
    session.totalFileBytes = wavBuf.length;
    session.bytesWritten = wavBuf.length;
    session.isCompleted = true;
    session.durationSec = (track && track.duration > 0) ? track.duration : (wavBuf.length / (88200 * 6));
    // Decimated 24-bit PCM WAV is fully in memory: windows are read straight from it.
    session.startSec = startSec;
    session.spectrum = { rate: wavBuf.readUInt32LE(24), wav24: wavBuf.subarray(44) };
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

module.exports = instance;
