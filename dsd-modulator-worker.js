// ==========================================
// rooPlayer - DSD Modulator Worker Thread (segment mode)
// Dedicated High-Speed Noise-Shaping 1-bit Delta-Sigma Modulator
// Supports 2nd, 5th, and 7th Order SDM with Linear/Minimum/Intermediate Phase
// Hermite interpolation, or the 'gauss-long' (linear-phase) / 'gauss-min'
// (minimum-phase) Poly-Sinc-Gauss FIR upsampling filters, or the 'poly-ext2' /
// 'hqp-ps-ext2' extended poly-sinc FIR filters.
// Completely offloaded from Electron UI / Main Process
//
// Parallel segment mode (see createDsdSession in native-dsp-streamer.js): 5th/7th-order
// CIFFR on a single thread can run slower than real time (DSD128+ or FIR phases), which
// starved the progressive DSF file and cut off DLNA playback after a few seconds. The track
// is split into contiguous block segments modulated by independent worker threads.
// This worker generates view-relative output bits [0, genEndBit): the first warmupBits blocks are
// the segment's true PRECEDING audio (warm-up, DISCARDED - they converge the integrator state to
// the continuous-run state at the segment boundary), the rest is written at
// 92 + (writeStartBlock + n) * 2 * DSD_BLOCK_SIZE with no shift. The DSF header is written by the
// main thread. The first segment (writeStartBlock 0, warmupBits 0, view from sample 0) is
// bit-identical to the old single-worker whole-file pass.
//
// All DSP math (interpolation kernel + modulator) comes from dsp-kernel.js,
// the single source of truth shared with the progressive streaming engine.
// ==========================================

const fs = require('fs');
const { parentPort, workerData } = require('worker_threads');
const {
  getDsdRate,
  buildGaussFilter,
  buildPolyExt2Filter,
  buildHqpPsExt2Filter,
  DsdModulator,
  DSD_BLOCK_SIZE,
  DSD_SAMPLES_PER_BLOCK,
  createPeqChain,
  applyPeqArrays
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
    filterPhase,
    genStartBit,
    genEndBit,
    warmupBits,
    writeStartBlock,
    isPrimary,
    capSAB,
    capSlot
  } = workerData;

  // Sliding-window cap signal (see createDsdSession): capView[capSlot] = absolute block index
  // this worker may generate up to (frontier + CAP_AHEAD_SEC). The worker naps whenever it is
  // ahead of the sliding window; Atomics.wait wakes early when the main thread advances the cap.
  const capView = capSAB ? new Int32Array(capSAB) : null;

  // The main thread hands an exact input-sample view (segment range + warm-up + FIR guard).
  const left = new Float32Array(leftBuffer, leftByteOffset || 0, leftLength !== undefined ? leftLength : leftBuffer.byteLength / 4);
  const right = new Float32Array(rightBuffer, rightByteOffset || 0, rightLength !== undefined ? rightLength : rightBuffer.byteLength / 4);
  const inLen = left.length;

  const dsdRate = getDsdRate(dsdMode);
  const ratio = dsdRate / sampleRate;
  const invRatio = 1.0 / ratio;

  const blockSize = DSD_BLOCK_SIZE;
  const samplesPerBlock = DSD_SAMPLES_PER_BLOCK;
  const bytesPerBlockPair = 2 * blockSize;

  const genBlocks = Math.round((genEndBit - genStartBit) / samplesPerBlock);
  const warmupBlocks = Math.round(warmupBits / samplesPerBlock);

  // Data-only mode: the 92-byte DSF header was already written by the main thread.
  const fd = fs.openSync(tmpFile, 'r+');

  // 'gauss-long' / 'gauss-min' / 'poly-ext2' / 'hqp-ps-ext2' filter phases: build the FIR
  // coefficients for this exact (dsdRate, sampleRate) pair once (designs in dsp-kernel.js).
  let gaussFilter = null;
  if (filterPhase === 'gauss-long' || filterPhase === 'gauss-min') {
    try { gaussFilter = buildGaussFilter(dsdRate, sampleRate, filterPhase === 'gauss-min'); } catch (e) { gaussFilter = null; }
  } else if (filterPhase === 'poly-ext2') {
    try { gaussFilter = buildPolyExt2Filter(dsdRate, sampleRate); } catch (e) { gaussFilter = null; }
  } else if (filterPhase === 'hqp-ps-ext2') {
    try { gaussFilter = buildHqpPsExt2Filter(dsdRate, sampleRate); } catch (e) { gaussFilter = null; }
  }
  const modulator = new DsdModulator(dsdOrder, filterPhase, gaussFilter);

  // PEQ (PCM domain, at source rate): applied once to this worker's view slice before
  // modulation. The view includes the segment's true preceding audio (warm-up), so the
  // biquad state at the segment boundary is converged exactly like the modulator's -
  // segment joins stay seamless. Fresh chain per worker (identical coefficients).
  let peqL = left, peqR = right;
  if (workerData.peqOptions && workerData.peqOptions.enabled) {
    try {
      const peqChain = createPeqChain(sampleRate, workerData.peqOptions);
      if (peqChain) {
        peqL = new Float32Array(inLen);
        peqR = new Float32Array(inLen);
        applyPeqArrays(peqChain, left, right, peqL, peqR, inLen);
      }
    } catch (e) { /* PEQ failure must never break playback: fall through unprocessed */ }
  }

  let genDone = 0; // generated blocks so far, INCLUDING warm-up blocks

  const writeBatch = (count) => {
    const startB = genDone;
    const endB = Math.min(genBlocks, startB + count);
    if (startB >= endB) return 0;

    const chunk = modulator.processBlocks(
      peqL,
      peqR,
      inLen,
      genStartBit + startB * samplesPerBlock,
      genStartBit + endB * samplesPerBlock,
      invRatio
    );

    // Warm-up blocks are generated (to converge modulator state) but never written.
    const writeStart = Math.max(startB, warmupBlocks);
    if (writeStart < endB) {
      const fileOffset = 92 + (writeStart - warmupBlocks + writeStartBlock) * bytesPerBlockPair;
      fs.writeSync(fd, chunk, (writeStart - startB) * bytesPerBlockPair, (endB - writeStart) * bytesPerBlockPair, fileOffset);
    }
    genDone = endB;
    parentPort.postMessage({
      type: 'progress',
      blocksWritten: writeStartBlock + Math.max(0, genDone - warmupBlocks)
    });
    return endB - startB;
  };

  // 1. Initial burst for instant playback start (< 250ms): first ~3 seconds of this segment.
  //    The primary (first) segment's initial write gates the session start. Segments far ahead
  //    of the sliding window skip their initial burst (it would only burn CPU for later).
  const initialBlocks = Math.min(genBlocks, Math.ceil(3 * dsdRate / samplesPerBlock));
  const skipInitial = capView && !isPrimary && writeStartBlock > Atomics.load(capView, capSlot);
  if (!skipInitial) writeBatch(initialBlocks);
  if (isPrimary) {
    parentPort.postMessage({
      type: 'initial',
      blocksWritten: writeStartBlock + Math.max(0, genDone - warmupBlocks)
    });
  }

  // 2. Progressive modulation in background (~100 blocks per batch), held to the sliding
  //    window: nap until the frontier comes within CAP_AHEAD_SEC of this segment.
  while (genDone < genBlocks) {
    if (capView) {
      const myAbs = writeStartBlock + Math.max(0, genDone - warmupBlocks);
      let cap = Atomics.load(capView, capSlot);
      while (myAbs > cap) {
        Atomics.wait(capView, capSlot, cap, 1000);
        const c2 = Atomics.load(capView, capSlot);
        if (c2 > cap) cap = c2;
      }
    }
    writeBatch(Math.min(100, genBlocks - genDone));
  }

  try { fs.closeSync(fd); } catch (e) {}
  parentPort.postMessage({
    type: 'progress',
    blocksWritten: writeStartBlock + Math.max(0, genBlocks - warmupBlocks)
  });
}

run();
