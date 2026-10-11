// ==========================================
// rooPlayer - DSD Modulator Worker Thread
// Dedicated High-Speed Noise-Shaping 1-bit Delta-Sigma Modulator
// Supports 2nd, 5th, and 7th Order SDM with Linear/Minimum/Intermediate Phase
// Completely offloaded from Electron UI / Main Process
// ==========================================

const fs = require('fs');
const { parentPort, workerData } = require('worker_threads');

// Filter Phase Interpolation Kernel
function interpolateSample(p0, p1, p2, p3, t, phase) {
  if (phase === 'minimum') {
    const d0 = p1 - p0;
    const d1 = p2 - p1;
    return p1 + t * d1 + 0.5 * t * (t - 1.0) * (0.85 * d0 + 0.15 * d1);
  }
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  const m1 = 0.5 * (p2 - p0);
  const m2 = 0.5 * (p3 - p1);
  const yLin = h00 * p1 + h10 * m1 + h01 * p2 + h11 * m2;

  if (phase === 'intermediate') {
    const d0 = p1 - p0;
    const d1 = p2 - p1;
    const yMin = p1 + t * d1 + 0.5 * t * (t - 1.0) * (0.85 * d0 + 0.15 * d1);
    return 0.35 * yLin + 0.65 * yMin;
  }

  return yLin;
}

function run() {
  const {
    tmpFile,
    leftBuffer,
    rightBuffer,
    sampleRate,
    dsdMode,
    dsdOrder,
    filterPhase
  } = workerData;

  const left = new Float32Array(leftBuffer);
  const right = new Float32Array(rightBuffer);
  const inLen = left.length;

  const order = [2, 5, 7].includes(parseInt(dsdOrder, 10)) ? parseInt(dsdOrder, 10) : 5;
  const phase = ['linear', 'minimum', 'intermediate'].includes(filterPhase) ? filterPhase : 'linear';

  const mode = (dsdMode || 'dsd64').toLowerCase();
  let dsdRate = 2822400; // Standard Sony DSD64 (44.1kHz * 64)
  if (mode === 'dsd128') dsdRate = 5644800; // Standard DSD128 (44.1kHz * 128)
  else if (mode === 'dsd256') dsdRate = 11289600; // Standard DSD256 (44.1kHz * 256)
  else if (mode === 'dsd512') dsdRate = 22579200; // Standard DSD512 (44.1kHz * 512)

  const ratio = dsdRate / sampleRate;
  const invRatio = 1.0 / ratio;
  const outBits = Math.floor(inLen * ratio);

  const blockSize = 4096;
  const samplesPerBlock = blockSize * 8; // 32768
  const totalBlocks = Math.ceil(outBits / samplesPerBlock);
  const totalSamplesPerChannel = totalBlocks * samplesPerBlock;
  const totalDataBytes = totalBlocks * 2 * blockSize;
  const totalFileBytes = 92 + totalDataBytes;

  const fd = fs.openSync(tmpFile, 'w+');
  fs.ftruncateSync(fd, totalFileBytes);

  // 92-byte standard Sony DSF Header
  const header = Buffer.alloc(92);
  let off = 0;
  header.write('DSD ', off); off += 4;
  header.writeBigUInt64LE(28n, off); off += 8;
  header.writeBigUInt64LE(BigInt(totalFileBytes), off); off += 8;
  header.writeBigUInt64LE(0n, off); off += 8;

  header.write('fmt ', off); off += 4;
  header.writeBigUInt64LE(52n, off); off += 8;
  header.writeUInt32LE(1, off); off += 4; // version 1
  header.writeUInt32LE(0, off); off += 4; // raw DSD
  header.writeUInt32LE(2, off); off += 4; // stereo
  header.writeUInt32LE(2, off); off += 4; // 2 channels
  header.writeUInt32LE(dsdRate, off); off += 4;
  header.writeUInt32LE(1, off); off += 4; // 1-bit
  header.writeBigUInt64LE(BigInt(totalSamplesPerChannel), off); off += 8;
  header.writeUInt32LE(blockSize, off); off += 4;
  header.writeUInt32LE(0, off); off += 4;

  header.write('data', off); off += 4;
  header.writeBigUInt64LE(BigInt(12 + totalDataBytes), off); off += 8;

  fs.writeSync(fd, header, 0, 92, 0);

  // Modulator State Variables
  // Order 2 states
  let s1_L = 0, s2_L = 0, y_L = 0;
  let s1_R = 0, s2_R = 0, y_R = 0;

  // Order 5 / 7 states
  let s3_L = 0, s4_L = 0, s5_L = 0, s6_L = 0, s7_L = 0;
  let s3_R = 0, s4_R = 0, s5_R = 0, s6_R = 0, s7_R = 0;

  let blocksWritten = 0;
  let bytesWritten = 92;

  // Initial buffer: write first 3 seconds of audio (~1MB - 2MB)
  const initialBlocks = Math.min(totalBlocks, Math.ceil(3 * dsdRate / samplesPerBlock));

  const writeBatch = (count) => {
    const startB = blocksWritten;
    const endB = Math.min(totalBlocks, startB + count);
    if (startB >= endB) return 0;

    const numB = endB - startB;
    const chunkBytes = numB * 2 * blockSize;
    const blockBuf = Buffer.allocUnsafe(chunkBytes);

    for (let b = 0; b < numB; b++) {
      const curBlock = startB + b;
      const leftOff = b * 2 * blockSize;
      const rightOff = leftOff + blockSize;
      const startSampleIdx = curBlock * samplesPerBlock;

      for (let byteIdx = 0; byteIdx < blockSize; byteIdx++) {
        let byteValL = 0;
        let byteValR = 0;
        const baseSample = startSampleIdx + (byteIdx << 3);

        for (let bit = 0; bit < 8; bit++) {
          const outIdx = baseSample + bit;
          const pos = outIdx * invRatio;
          const idx = pos | 0;
          const t = pos - idx;

          const p0L = idx > 0 ? left[idx - 1] : left[0];
          const p1L = idx < inLen ? left[idx] : 0;
          const p2L = idx < inLen - 1 ? left[idx + 1] : p1L;
          const p3L = idx < inLen - 2 ? left[idx + 2] : p2L;
          const rawL = interpolateSample(p0L, p1L, p2L, p3L, t, phase);

          const p0R = idx > 0 ? right[idx - 1] : right[0];
          const p1R = idx < inLen ? right[idx] : 0;
          const p2R = idx < inLen - 1 ? right[idx + 1] : p1R;
          const p3R = idx < inLen - 2 ? right[idx + 2] : p2R;
          const rawR = interpolateSample(p0R, p1R, p2R, p3R, t, phase);

          if (order === 2) {
            // 2nd-Order Boser-Wooley SDM with Anti-Windup Clamping
            const uL = rawL * 0.75;
            s1_L += uL - y_L;
            if (s1_L > 3.0) s1_L = 3.0; else if (s1_L < -3.0) s1_L = -3.0;
            s2_L += s1_L - 0.5 * y_L;
            if (s2_L > 3.0) s2_L = 3.0; else if (s2_L < -3.0) s2_L = -3.0;
            y_L = (s2_L >= 0) ? 1.0 : -1.0;
            if (y_L > 0) byteValL |= (1 << bit);

            const uR = rawR * 0.75;
            s1_R += uR - y_R;
            if (s1_R > 3.0) s1_R = 3.0; else if (s1_R < -3.0) s1_R = -3.0;
            s2_R += s1_R - 0.5 * y_R;
            if (s2_R > 3.0) s2_R = 3.0; else if (s2_R < -3.0) s2_R = -3.0;
            y_R = (s2_R >= 0) ? 1.0 : -1.0;
            if (y_R > 0) byteValR |= (1 << bit);
          } else if (order === 5) {
            // 5th-Order CRFB (Cascade of Resonators with Feedback) with 2 Zero-Optimizing Resonators
            const uL = rawL * 0.65;
            s1_L += uL - y_L - 0.0006 * s2_L;
            if (s1_L > 3.5) s1_L = 3.5; else if (s1_L < -3.5) s1_L = -3.5;
            s2_L += s1_L;
            if (s2_L > 3.5) s2_L = 3.5; else if (s2_L < -3.5) s2_L = -3.5;
            s3_L += s2_L - 0.5 * y_L - 0.0018 * s4_L;
            if (s3_L > 3.5) s3_L = 3.5; else if (s3_L < -3.5) s3_L = -3.5;
            s4_L += s3_L;
            if (s4_L > 3.5) s4_L = 3.5; else if (s4_L < -3.5) s4_L = -3.5;
            s5_L += s4_L - 0.25 * y_L;
            if (s5_L > 3.5) s5_L = 3.5; else if (s5_L < -3.5) s5_L = -3.5;
            const sigma_L = s5_L + 0.1 * s3_L + 0.05 * s1_L;
            y_L = (sigma_L >= 0) ? 1.0 : -1.0;
            if (y_L > 0) byteValL |= (1 << bit);

            const uR = rawR * 0.65;
            s1_R += uR - y_R - 0.0006 * s2_R;
            if (s1_R > 3.5) s1_R = 3.5; else if (s1_R < -3.5) s1_R = -3.5;
            s2_R += s1_R;
            if (s2_R > 3.5) s2_R = 3.5; else if (s2_R < -3.5) s2_R = -3.5;
            s3_R += s2_R - 0.5 * y_R - 0.0018 * s4_R;
            if (s3_R > 3.5) s3_R = 3.5; else if (s3_R < -3.5) s3_R = -3.5;
            s4_R += s3_R;
            if (s4_R > 3.5) s4_R = 3.5; else if (s4_R < -3.5) s4_R = -3.5;
            s5_R += s4_R - 0.25 * y_R;
            if (s5_R > 3.5) s5_R = 3.5; else if (s5_R < -3.5) s5_R = -3.5;
            const sigma_R = s5_R + 0.1 * s3_R + 0.05 * s1_R;
            y_R = (sigma_R >= 0) ? 1.0 : -1.0;
            if (y_R > 0) byteValR |= (1 << bit);
          } else {
            // 7th-Order CRFB with 3 Zero-Optimizing Resonators
            const uL = rawL * 0.55;
            s1_L += uL - y_L - 0.0003 * s2_L;
            if (s1_L > 3.0) s1_L = 3.0; else if (s1_L < -3.0) s1_L = -3.0;
            s2_L += s1_L;
            if (s2_L > 3.0) s2_L = 3.0; else if (s2_L < -3.0) s2_L = -3.0;
            s3_L += s2_L - 0.5 * y_L - 0.0010 * s4_L;
            if (s3_L > 3.0) s3_L = 3.0; else if (s3_L < -3.0) s3_L = -3.0;
            s4_L += s3_L;
            if (s4_L > 3.0) s4_L = 3.0; else if (s4_L < -3.0) s4_L = -3.0;
            s5_L += s4_L - 0.25 * y_L - 0.0022 * s6_L;
            if (s5_L > 3.0) s5_L = 3.0; else if (s5_L < -3.0) s5_L = -3.0;
            s6_L += s5_L;
            if (s6_L > 3.0) s6_L = 3.0; else if (s6_L < -3.0) s6_L = -3.0;
            s7_L += s6_L - 0.1 * y_L;
            if (s7_L > 3.0) s7_L = 3.0; else if (s7_L < -3.0) s7_L = -3.0;
            const sigma_L = s7_L + 0.08 * s5_L + 0.04 * s3_L + 0.02 * s1_L;
            y_L = (sigma_L >= 0) ? 1.0 : -1.0;
            if (y_L > 0) byteValL |= (1 << bit);

            const uR = rawR * 0.55;
            s1_R += uR - y_R - 0.0003 * s2_R;
            if (s1_R > 3.0) s1_R = 3.0; else if (s1_R < -3.0) s1_R = -3.0;
            s2_R += s1_R;
            if (s2_R > 3.0) s2_R = 3.0; else if (s2_R < -3.0) s2_R = -3.0;
            s3_R += s2_R - 0.5 * y_R - 0.0010 * s4_R;
            if (s3_R > 3.0) s3_R = 3.0; else if (s3_R < -3.0) s3_R = -3.0;
            s4_R += s3_R;
            if (s4_R > 3.0) s4_R = 3.0; else if (s4_R < -3.0) s4_R = -3.0;
            s5_R += s4_R - 0.25 * y_R - 0.0022 * s6_R;
            if (s5_R > 3.0) s5_R = 3.0; else if (s5_R < -3.0) s5_R = -3.0;
            s6_R += s5_R;
            if (s6_R > 3.0) s6_R = 3.0; else if (s6_R < -3.0) s6_R = -3.0;
            s7_R += s6_R - 0.1 * y_R;
            if (s7_R > 3.0) s7_R = 3.0; else if (s7_R < -3.0) s7_R = -3.0;
            const sigma_R = s7_R + 0.08 * s5_R + 0.04 * s3_R + 0.02 * s1_R;
            y_R = (sigma_R >= 0) ? 1.0 : -1.0;
            if (y_R > 0) byteValR |= (1 << bit);
          }
        }

        blockBuf[leftOff + byteIdx] = byteValL;
        blockBuf[rightOff + byteIdx] = byteValR;
      }
    }

    const fileOffset = 92 + startB * 2 * blockSize;
    fs.writeSync(fd, blockBuf, 0, chunkBytes, fileOffset);
    blocksWritten = endB;
    bytesWritten = 92 + blocksWritten * 2 * blockSize;
    return numB;
  };

  // 1. Initial write for instant playback start (< 250ms)
  writeBatch(initialBlocks);
  parentPort.postMessage({
    type: 'initial',
    totalFileBytes,
    blocksWritten,
    bytesWritten,
    totalBlocks
  });

  // 2. High-speed progressive modulation in background (~100 blocks = 1.1s audio per batch)
  while (blocksWritten < totalBlocks) {
    writeBatch(100);
    parentPort.postMessage({
      type: 'progress',
      blocksWritten,
      bytesWritten,
      totalBlocks
    });
  }

  try { fs.closeSync(fd); } catch (e) {}
  parentPort.postMessage({
    type: 'complete',
    blocksWritten,
    bytesWritten,
    totalBlocks
  });
}

run();
