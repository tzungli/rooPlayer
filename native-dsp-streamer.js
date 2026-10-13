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
const { interpolateSample, buildGaussFilter, firSample } = require('./dsp-kernel');

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
  // Powered by background worker_threads to prevent any Electron UI / main process lag
  async createDsdSession(token, filePath, startSec = 0, dsdMode = 'dsd64', track = null, dsdOrder = 5, filterPhase = 'linear') {
    this.cancelSession(token);

    const tmpFile = path.join(this.cacheDir, `stream_${token}_${Date.now()}.dsf`);
    const pcm = await nativeAudioEngine.readPcmSamples(filePath, startSec);
    if (!pcm) throw new Error('Native PCM read failed for DSD modulation');

    const session = new EventEmitter();
    session.token = token;
    session.filePath = tmpFile;
    session.mimeType = 'audio/x-dsf';
    session.bytesWritten = 92;
    session.isCompleted = false;
    session.isCancelled = false;
    session.totalFileBytes = 0;
    session.durationSec = pcm.left.length / pcm.sampleRate;

    const workerPath = path.join(__dirname, 'dsd-modulator-worker.js');
    const worker = new Worker(workerPath, {
      workerData: {
        tmpFile,
        leftBuffer: pcm.left.buffer,
        leftByteOffset: pcm.left.byteOffset,
        leftLength: pcm.left.length,
        rightBuffer: pcm.right.buffer,
        rightByteOffset: pcm.right.byteOffset,
        rightLength: pcm.right.length,
        sampleRate: pcm.sampleRate,
        dsdMode,
        dsdOrder,
        filterPhase
      }
    });
    session.worker = worker;

    await new Promise((resolve, reject) => {
      let isInit = false;
      worker.on('message', (msg) => {
        if (msg.type === 'initial') {
          session.totalFileBytes = msg.totalFileBytes;
          session.bytesWritten = msg.bytesWritten;
          isInit = true;
          resolve();
        } else if (msg.type === 'progress') {
          session.bytesWritten = msg.bytesWritten;
          session.emit('progress', msg.bytesWritten);
        } else if (msg.type === 'complete') {
          session.isCompleted = true;
          session.bytesWritten = msg.bytesWritten;
          session.emit('complete');
        }
      });
      worker.on('error', (err) => {
        console.error('[DsdWorker] error:', err);
        if (!isInit) reject(err);
      });
      worker.on('exit', (code) => {
        if (!isInit && code !== 0) reject(new Error(`DSD worker exited with code ${code}`));
      });
    });

    session.cancel = () => {
      session.isCancelled = true;
      if (session.worker) {
        try { session.worker.terminate(); } catch (e) {}
        session.worker = null;
      }
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
    let gaussFilter = null;
    if (filterPhase === 'gauss-long' || filterPhase === 'gauss-min') {
      try { gaussFilter = buildGaussFilter(targetSampleRate, srcRate, filterPhase === 'gauss-min'); } catch (e) { gaussFilter = null; }
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
