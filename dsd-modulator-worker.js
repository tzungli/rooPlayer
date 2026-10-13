// ==========================================
// rooPlayer - DSD Modulator Worker Thread
// Dedicated High-Speed Noise-Shaping 1-bit Delta-Sigma Modulator
// Supports 2nd, 5th, and 7th Order SDM with Linear/Minimum/Intermediate Phase
// Hermite interpolation, or the 'gauss-long' (linear-phase) / 'gauss-min'
// (minimum-phase) Poly-Sinc-Gauss FIR upsampling filters.
// Completely offloaded from Electron UI / Main Process
//
// All DSP math (interpolation kernel + modulator) comes from dsp-kernel.js,
// the single source of truth shared with the progressive streaming engine.
// ==========================================

const fs = require('fs');
const { parentPort, workerData } = require('worker_threads');
const {
  getDsdRate,
  buildDsfHeader,
  buildGaussFilter,
  DsdModulator,
  DSD_BLOCK_SIZE,
  DSD_SAMPLES_PER_BLOCK
} = require('./dsp-kernel');

function run() {
  const {
    tmpFile,
    leftBuffer,
    leftByteOffset,
    leftLength,
    rightBuffer,
    rightByteOffset,
    rightLength,
    sampleRate,
    dsdMode,
    dsdOrder,
    filterPhase
  } = workerData;

  // Respect the subarray view (startSec offset / max duration) instead of
  // modulating the whole underlying buffer.
  const left = new Float32Array(leftBuffer, leftByteOffset || 0, leftLength !== undefined ? leftLength : leftBuffer.byteLength / 4);
  const right = new Float32Array(rightBuffer, rightByteOffset || 0, rightLength !== undefined ? rightLength : rightBuffer.byteLength / 4);
  const inLen = left.length;

  const dsdRate = getDsdRate(dsdMode);
  const ratio = dsdRate / sampleRate;
  const invRatio = 1.0 / ratio;
  const outBits = Math.floor(inLen * ratio);

  const blockSize = DSD_BLOCK_SIZE;
  const samplesPerBlock = DSD_SAMPLES_PER_BLOCK;
  const totalBlocks = Math.ceil(outBits / samplesPerBlock);
  const totalSamplesPerChannel = totalBlocks * samplesPerBlock;
  const totalDataBytes = totalBlocks * 2 * blockSize;
  const totalFileBytes = 92 + totalDataBytes;

  const fd = fs.openSync(tmpFile, 'w+');
  fs.ftruncateSync(fd, totalFileBytes);

  // 92-byte standard Sony DSF Header
  const header = buildDsfHeader(totalFileBytes, dsdRate, totalSamplesPerChannel, blockSize);
  fs.writeSync(fd, header, 0, 92, 0);

  // Stateful modulator: integrator state carries across every batch,
  // producing bit-identical output to a single whole-file modulation pass.
  // 'gauss-long' / 'gauss-min' filter phase: build the Poly-Sinc-Gauss FIR coefficients
  // (linear- or minimum-phase) for this exact (dsdRate, sampleRate) pair once; the
  // kernel then uses the FIR instead of Hermite interpolation.
  let gaussFilter = null;
  if (filterPhase === 'gauss-long' || filterPhase === 'gauss-min') {
    try { gaussFilter = buildGaussFilter(dsdRate, sampleRate, filterPhase === 'gauss-min'); } catch (e) { gaussFilter = null; }
  }
  const modulator = new DsdModulator(dsdOrder, filterPhase, gaussFilter);

  let blocksWritten = 0;
  let bytesWritten = 92;

  // Initial buffer: write first 3 seconds of audio (~1MB - 2MB)
  const initialBlocks = Math.min(totalBlocks, Math.ceil(3 * dsdRate / samplesPerBlock));

  const writeBatch = (count) => {
    const startB = blocksWritten;
    const endB = Math.min(totalBlocks, startB + count);
    if (startB >= endB) return 0;

    const chunk = modulator.processBlocks(
      left,
      right,
      inLen,
      startB * samplesPerBlock,
      endB * samplesPerBlock,
      invRatio
    );

    const fileOffset = 92 + startB * 2 * blockSize;
    fs.writeSync(fd, chunk, 0, chunk.length, fileOffset);
    blocksWritten = endB;
    bytesWritten = 92 + blocksWritten * 2 * blockSize;
    return endB - startB;
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
