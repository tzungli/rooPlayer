// ==========================================
// rooPlayer - DSD Modulator Worker Thread (rolling chunk mode)
// Dedicated High-Speed Noise-Shaping 1-bit Delta-Sigma Modulator
// Supports 2nd, 5th, and 7th Order SDM with Linear/Minimum/Intermediate Phase
// Hermite interpolation, or the 'gauss-long' (linear-phase) / 'gauss-min'
// (minimum-phase) Poly-Sinc-Gauss FIR upsampling filters, or the 'poly-ext2' /
// 'hqp-ps-ext2' extended poly-sinc FIR filters.
// Completely offloaded from Electron UI / Main Process
//
// Rolling chunk mode (see createDsdSession in native-dsp-streamer.js): the main thread
// assigns small chunks (3-10 s) sequentially to a fixed pool of resident worker threads.
// The ASSIGNMENT itself is the flow control (replaces the old sliding-window cap +
// Atomics.wait polling, which made every capped worker wake on the same 1 s timeout and
// race simultaneously -> periodic ~50% CPU spikes that starved the DLNA HTTP serving):
// a worker generates exactly one assigned chunk, reports progress per 100-block batch,
// then waits idle for its next assignment.
//
// Each chunk view (except chunk 0) starts 1.5 s + FIR guard BEFORE the chunk's own audio
// (warm-up: generated to converge the integrator state to the continuous-run state at the
// chunk boundary, then DISCARDED). Chunk 0 starts at sample 0 with no warm-up and is
// bit-identical to a single-pass whole-file encoding. Chunk joins stay seamless
// (verified by test-dsd-boundary).
//
// All DSP math (interpolation kernel + modulator) comes from dsp-kernel.js,
// the single source of truth shared with the progressive streaming engine.
// ==========================================

const fs = require('fs');
const { parentPort, workerData } = require('worker_threads');
const {
  getDsdRate,
  buildFilterForPhase,
  DsdModulator,
  DSD_BLOCK_SIZE,
  DSD_SAMPLES_PER_BLOCK,
  createPeqChain,
  applyPeqArrays,
  buildUltrasonicFilterCoeffs,
  applyUltrasonicFilter
} = require('./dsp-kernel');

const {
  tmpFile,
  leftBuffer,
  rightBuffer,
  sampleRate,
  dsdMode,
  dsdOrder,
  filterPhase,
  peqOptions,
  ultrasonicFilter,
  dither
} = workerData;

const dsdRate = getDsdRate(dsdMode);
const invRatio = sampleRate / dsdRate;
const samplesPerBlock = DSD_SAMPLES_PER_BLOCK;
const bytesPerBlockPair = 2 * DSD_BLOCK_SIZE;

// 構建 HQPlayer 風格超音波噪聲防護濾波器（預設 30k 截止），濾除 30kHz 以上量化雜訊，防止 DAC 類比端過載
const ultrasonicCoeffs = buildUltrasonicFilterCoeffs(sampleRate, ultrasonicFilter || '30k');

// Data-only mode: the 92-byte DSF header was already written by the main thread.
const fd = fs.openSync(tmpFile, 'r+');

// FIR coefficients and PEQ chain depend only on (dsdRate, srcRate, phase, options):
// built ONCE per worker and reused across every assigned chunk.
let gaussFilter = null;
try { gaussFilter = buildFilterForPhase(dsdRate, sampleRate, filterPhase); } catch (e) { gaussFilter = null; }
let peqChain = null;
try { peqChain = (peqOptions && peqOptions.enabled) ? createPeqChain(sampleRate, peqOptions) : null; } catch (e) { peqChain = null; }

// Reused batch scratch (100 blocks): avoids per-batch allocation churn and the GC pauses
// that used to stall the frontier worker mid-generation (frontier stall = renderer underrun).
const scratch = Buffer.allocUnsafe(100 * bytesPerBlockPair);

// JIT warm-up: run a short throwaway modulation (zeros, DISCARDED) at worker start so the
// hot loop is fully optimized before the first real chunk. Without this, the first seconds of
// a session run at cold-JIT speed (~0.2x), the startup prefix crawl dips below real time,
// and the renderer's preroll buffer drains -> a startup dropout.
try {
  const warmMod = new DsdModulator(dsdOrder, filterPhase, gaussFilter);
  const warmBits = Math.max(samplesPerBlock, Math.ceil((0.2 * dsdRate) / samplesPerBlock) * samplesPerBlock);
  const warmSamples = Math.ceil((warmBits * sampleRate) / dsdRate) + 8;
  const zl = new Float32Array(warmSamples);
  const zr = new Float32Array(warmSamples);
  warmMod.processBlocks(zl, zr, warmSamples, 0, warmBits, invRatio, scratch);
} catch (e) {}

function processChunk(msg) {
  const { idx, startBlock, endBlock, viewStartInput, viewLen, warmupBits, genEndBit } = msg;

  // The main thread hands an exact input-sample view (chunk range + warm-up + FIR guard).
  const left = new Float32Array(leftBuffer, viewStartInput * 4, viewLen);
  const right = new Float32Array(rightBuffer, viewStartInput * 4, viewLen);
  const inLen = viewLen;

  // PEQ (PCM domain, at source rate): applied to this chunk's view before modulation.
  // The view includes the chunk's true preceding audio (warm-up), so the biquad state at
  // the chunk boundary is converged exactly like the modulator's - chunk joins stay seamless.
  let peqL = left, peqR = right;
  if (peqChain) {
    try {
      peqL = new Float32Array(inLen);
      peqR = new Float32Array(inLen);
      applyPeqArrays(peqChain, left, right, peqL, peqR, inLen);
    } catch (e) { peqL = left; peqR = right; /* PEQ failure must never break playback */ }
  }

  // 應用超音波噪聲防護濾波器（預設 30k 截止），平滑切除高頻噪聲
  if (ultrasonicCoeffs) {
    if (peqL === left) {
      peqL = new Float32Array(left);
      peqR = new Float32Array(right);
    }
    applyUltrasonicFilter(ultrasonicCoeffs, peqL, peqR, inLen);
  }

  const modulator = new DsdModulator(dsdOrder, filterPhase, gaussFilter, dither || 'gauss1');
  const genBlocks = Math.round(genEndBit / samplesPerBlock);
  const warmupBlocks = Math.round(warmupBits / samplesPerBlock);

  const t0 = process.hrtime.bigint();
  let genDone = 0; // generated blocks so far, INCLUDING warm-up blocks
  while (genDone < genBlocks) {
    const endB = Math.min(genBlocks, genDone + 100);
    const chunk = modulator.processBlocks(
      peqL,
      peqR,
      inLen,
      genDone * samplesPerBlock,
      endB * samplesPerBlock,
      invRatio,
      scratch
    );

    // Warm-up blocks are generated (to converge modulator state) but never written.
    const writeStart = Math.max(genDone, warmupBlocks);
    if (writeStart < endB) {
      const fileOffset = 92 + (writeStart - warmupBlocks + startBlock) * bytesPerBlockPair;
      fs.writeSync(fd, chunk, (writeStart - genDone) * bytesPerBlockPair, (endB - writeStart) * bytesPerBlockPair, fileOffset);
    }
    genDone = endB;
    parentPort.postMessage({
      type: 'progress',
      idx,
      blocksWritten: startBlock + Math.max(0, genDone - warmupBlocks)
    });
  }

  const wallSec = Number(process.hrtime.bigint() - t0) / 1e9;
  parentPort.postMessage({ type: 'chunkdone', idx, wallSec });
}

parentPort.on('message', (msg) => {
  if (!msg) return;
  if (msg.type === 'assign') {
    processChunk(msg);
  } else if (msg.type === 'stop') {
    try { fs.closeSync(fd); } catch (e) {}
    process.exit(0);
  }
});
