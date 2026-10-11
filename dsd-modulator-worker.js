// ==========================================
// rooPlayer - DSD Modulator Worker Thread
// Dedicated High-Speed Noise-Shaping 1-bit Delta-Sigma Modulator
// Completely offloaded from Electron UI / Main Process
// ==========================================

const fs = require('fs');
const { parentPort, workerData } = require('worker_threads');

function run() {
  const {
    tmpFile,
    leftBuffer,
    rightBuffer,
    sampleRate,
    dsdMode
  } = workerData;

  const left = new Float32Array(leftBuffer);
  const right = new Float32Array(rightBuffer);
  const inLen = left.length;

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

  let s1_L = 0, s2_L = 0, y_L = 0;
  let s1_R = 0, s2_R = 0, y_R = 0;

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

          let xL = 0, xR = 0;
          if (idx < inLen - 1) {
            xL = (left[idx] + t * (left[idx + 1] - left[idx])) * 0.75;
            xR = (right[idx] + t * (right[idx + 1] - right[idx])) * 0.75;
          } else if (idx < inLen) {
            xL = left[idx] * 0.75;
            xR = right[idx] * 0.75;
          }

          // Audio-Grade 2nd-Order Boser-Wooley Delta-Sigma Modulator with Anti-Windup Clamping
          s1_L += xL - y_L;
          if (s1_L > 3.0) s1_L = 3.0; else if (s1_L < -3.0) s1_L = -3.0;
          s2_L += s1_L - 0.5 * y_L;
          if (s2_L > 3.0) s2_L = 3.0; else if (s2_L < -3.0) s2_L = -3.0;
          y_L = (s2_L >= 0) ? 1.0 : -1.0;
          if (y_L > 0) byteValL |= (1 << bit);

          s1_R += xR - y_R;
          if (s1_R > 3.0) s1_R = 3.0; else if (s1_R < -3.0) s1_R = -3.0;
          s2_R += s1_R - 0.5 * y_R;
          if (s2_R > 3.0) s2_R = 3.0; else if (s2_R < -3.0) s2_R = -3.0;
          y_R = (s2_R >= 0) ? 1.0 : -1.0;
          if (y_R > 0) byteValR |= (1 << bit);
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
