// ==========================================
// rooPlayer - Native DSP Progressive Audio Streamer
// High-Resolution Non-Blocking On-The-Fly Audio DSP Engine
// Pure Native JavaScript / WASM (Zero FFmpeg Dependency)
// ==========================================

const fs = require('fs');
const path = require('path');
const os = require('os');
const nativeAudioEngine = require('./native-audio-engine');

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
  async createDsdSession(token, filePath, startSec = 0, dsdMode = 'dsd64', track = null) {
    this.cancelSession(token);

    const tmpFile = path.join(this.cacheDir, `stream_${token}_${Date.now()}.dsf`);
    const pcm = await nativeAudioEngine.readPcmSamples(filePath, startSec);
    if (!pcm) throw new Error('Native PCM read failed for DSD modulation');

    const srcRate = pcm.sampleRate;
    const is48k = (srcRate % 48000 === 0);
    let dsdRate = is48k ? 3072000 : 2822400; // dsd64
    if (dsdMode === 'dsd128') dsdRate = is48k ? 6144000 : 5644800;
    else if (dsdMode === 'dsd256') dsdRate = is48k ? 12288000 : 11289600;

    const inLen = pcm.left.length;
    const ratio = dsdRate / srcRate;
    const outBits = Math.floor(inLen * ratio);

    const blockSize = 4096;
    const samplesPerBlock = blockSize * 8; // 32768
    const totalBlocks = Math.ceil(outBits / samplesPerBlock);
    const totalSamplesPerChannel = totalBlocks * samplesPerBlock;
    const totalDataBytes = totalBlocks * 2 * blockSize;
    const totalFileBytes = 92 + totalDataBytes;

    // 1. Instant pre-allocation on disk with exact target size
    const fd = fs.openSync(tmpFile, 'w+');
    fs.ftruncateSync(fd, totalFileBytes);

    // 2. Write 92 bytes DSF Header
    const header = Buffer.alloc(92);
    let off = 0;
    header.write('DSD ', off); off += 4;
    header.writeBigUInt64LE(28n, off); off += 8;
    header.writeBigUInt64LE(BigInt(totalFileBytes), off); off += 8;
    header.writeBigUInt64LE(0n, off); off += 8;

    header.write('fmt ', off); off += 4;
    header.writeBigUInt64LE(52n, off); off += 8;
    header.writeUInt32LE(1, off); off += 4; // version
    header.writeUInt32LE(0, off); off += 4; // format DSD raw
    header.writeUInt32LE(2, off); off += 4; // stereo
    header.writeUInt32LE(2, off); off += 4; // 2 channels
    header.writeUInt32LE(dsdRate, off); off += 4;
    header.writeUInt32LE(1, off); off += 4; // 1 bit
    header.writeBigUInt64LE(BigInt(totalSamplesPerChannel), off); off += 8;
    header.writeUInt32LE(blockSize, off); off += 4;
    header.writeUInt32LE(0, off); off += 4;

    header.write('data', off); off += 4;
    header.writeBigUInt64LE(BigInt(12 + totalDataBytes), off); off += 8;

    fs.writeSync(fd, header, 0, 92, 0);

    // 3. Encoder state & chunk writer
    let a1_L = 0, a2_L = 0, a3_L = 0, y_L = 0;
    let a1_R = 0, a2_R = 0, a3_R = 0, y_R = 0;
    let blocksWritten = 0;
    let isCancelled = false;
    let timer = null;

    const writeBlockChunk = (count) => {
      if (isCancelled || blocksWritten >= totalBlocks) return blocksWritten;
      const startBlock = blocksWritten;
      const endBlock = Math.min(totalBlocks, startBlock + count);
      const chunkBytes = (endBlock - startBlock) * 2 * blockSize;
      const blockBuf = Buffer.alloc(chunkBytes);

      for (let b = startBlock; b < endBlock; b++) {
        const bufOffset = (b - startBlock) * 2 * blockSize;
        const leftOff = bufOffset;
        const rightOff = bufOffset + blockSize;
        const startSampleIdx = b * samplesPerBlock;

        for (let byteIdx = 0; byteIdx < blockSize; byteIdx++) {
          let byteValL = 0;
          let byteValR = 0;
          for (let bit = 0; bit < 8; bit++) {
            const outIdx = startSampleIdx + byteIdx * 8 + bit;
            const pos = outIdx / ratio;
            const idx = pos | 0;
            const t = pos - idx;

            let xL = 0, xR = 0;
            if (idx < inLen - 1) {
              xL = pcm.left[idx] + t * (pcm.left[idx + 1] - pcm.left[idx]);
              xR = pcm.right[idx] + t * (pcm.right[idx + 1] - pcm.right[idx]);
            } else if (idx < inLen) {
              xL = pcm.left[idx];
              xR = pcm.right[idx];
            }

            const diffL = (xL * 0.85) - y_L;
            a1_L += diffL;
            a2_L += a1_L - 0.05 * y_L;
            a3_L += a2_L;
            y_L = (a3_L >= 0) ? 1.0 : -1.0;
            if (y_L > 0) byteValL |= (1 << bit);

            const diffR = (xR * 0.85) - y_R;
            a1_R += diffR;
            a2_R += a1_R - 0.05 * y_R;
            a3_R += a2_R;
            y_R = (a3_R >= 0) ? 1.0 : -1.0;
            if (y_R > 0) byteValR |= (1 << bit);
          }
          blockBuf[leftOff + byteIdx] = byteValL;
          blockBuf[rightOff + byteIdx] = byteValR;
        }
      }

      const fileOffset = 92 + startBlock * 2 * blockSize;
      fs.writeSync(fd, blockBuf, 0, blockBuf.length, fileOffset);
      blocksWritten = endBlock;
      return blocksWritten;
    };

    // 4. Generate initial 3 seconds of audio buffer so player can begin immediately (< 350ms)
    const initialBlocks = Math.min(totalBlocks, Math.ceil(3 * dsdRate / samplesPerBlock));
    writeBlockChunk(initialBlocks);

    // 5. Background progressive generator: writes 250 blocks (~2.9s of audio) every 30ms
    // This yields control to the event loop so Electron UI remains 60fps and HTTP requests are instant
    timer = setInterval(() => {
      if (isCancelled) {
        clearInterval(timer);
        return;
      }
      if (blocksWritten < totalBlocks) {
        writeBlockChunk(250);
      } else {
        clearInterval(timer);
        timer = null;
      }
    }, 30);

    const session = {
      token,
      filePath: tmpFile,
      mimeType: 'audio/x-dsf',
      totalFileBytes,
      durationSec: inLen / srcRate,
      cancel: () => {
        isCancelled = true;
        if (timer) clearInterval(timer);
        try { fs.closeSync(fd); } catch (e) {}
        try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch (e) {}
        this.activeSessions.delete(token);
      }
    };

    this.activeSessions.set(token, session);
    return session;
  }

  // Create progressive streaming session for High-Res PCM Upsampling (WAV format)
  async createPcmSession(token, filePath, startSec = 0, targetSampleRate = 192000, precision = 24, track = null) {
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

    // 3. Encoder state & chunk writer using Cubic Hermite interpolation
    let framesWritten = 0;
    let isCancelled = false;
    let timer = null;

    const writePcmChunk = (chunkFrames) => {
      if (isCancelled || framesWritten >= outFrames) return framesWritten;
      const startF = framesWritten;
      const endF = Math.min(outFrames, startF + chunkFrames);
      const count = endF - startF;
      const buf = Buffer.alloc(count * blockAlign);
      let bufOff = 0;

      for (let i = startF; i < endF; i++) {
        const srcPos = i / ratio;
        const idx = srcPos | 0;
        const t = srcPos - idx;
        const t2 = t * t;
        const t3 = t2 * t;

        const h00 = 2 * t3 - 3 * t2 + 1;
        const h10 = t3 - 2 * t2 + t;
        const h01 = -2 * t3 + 3 * t2;
        const h11 = t3 - t2;

        const p0L = idx > 0 ? inL[idx - 1] : inL[0];
        const p1L = inL[idx];
        const p2L = idx < inLen - 1 ? inL[idx + 1] : p1L;
        const p3L = idx < inLen - 2 ? inL[idx + 2] : p2L;
        const m1L = 0.5 * (p2L - p0L);
        const m2L = 0.5 * (p3L - p1L);
        const sL = Math.max(-1.0, Math.min(1.0, h00 * p1L + h10 * m1L + h01 * p2L + h11 * m2L));

        const p0R = idx > 0 ? inR[idx - 1] : inR[0];
        const p1R = inR[idx];
        const p2R = idx < inLen - 1 ? inR[idx + 1] : p1R;
        const p3R = idx < inLen - 2 ? inR[idx + 2] : p2R;
        const m1R = 0.5 * (p2R - p0R);
        const m2R = 0.5 * (p3R - p1R);
        const sR = Math.max(-1.0, Math.min(1.0, h00 * p1R + h10 * m1R + h01 * p2R + h11 * m2R));

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
      return framesWritten;
    };

    // 4. Generate initial 3 seconds of upsampled frames (< 150ms)
    const initialFrames = Math.min(outFrames, targetSampleRate * 3);
    writePcmChunk(initialFrames);

    // 5. Background progressive generator: writes ~5 seconds of frames every 25ms
    timer = setInterval(() => {
      if (isCancelled) {
        clearInterval(timer);
        return;
      }
      if (framesWritten < outFrames) {
        writePcmChunk(targetSampleRate * 5);
      } else {
        clearInterval(timer);
        timer = null;
      }
    }, 25);

    const session = {
      token,
      filePath: tmpFile,
      mimeType: 'audio/wav',
      totalFileBytes,
      durationSec: inLen / srcRate,
      cancel: () => {
        isCancelled = true;
        if (timer) clearInterval(timer);
        try { fs.closeSync(fd); } catch (e) {}
        try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch (e) {}
        this.activeSessions.delete(token);
      }
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

    const session = {
      token,
      filePath: tmpFile,
      mimeType: 'audio/wav',
      totalFileBytes: wavBuf.length,
      durationSec: (track && track.duration > 0) ? track.duration : (wavBuf.length / (88200 * 6)),
      cancel: () => {
        try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch (e) {}
        this.activeSessions.delete(token);
      }
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

module.exports = new NativeDspStreamer();
