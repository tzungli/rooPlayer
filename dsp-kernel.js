// ==========================================
// rooPlayer - Shared DSP Kernel (Single Source of Truth)
// 唯一的濾波插值核心與 1-bit Delta-Sigma 調變器實作。
//
// 使用方：
//   - native-dsp-streamer.js  (漸進式升頻 session，本機與 DLNA 共用)
//   - dsd-modulator-worker.js (worker thread 漸進式 DSD 調變)
//
// 所有升頻 / DSD 調變的 DSP 數學只存在於這一個檔案。
// ==========================================

// Filter Phase Interpolation Kernel (Linear, Minimum, Intermediate / Slow Roll-off)
function interpolateSample(p0, p1, p2, p3, t, phase = 'linear') {
  if (phase === 'minimum') {
    const d0 = p1 - p0;
    const d1 = p2 - p1;
    const y = p1 + t * d1 + 0.5 * t * (t - 1.0) * (0.85 * d0 + 0.15 * d1);
    return Math.max(-1.0, Math.min(1.0, y));
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
    const y = 0.35 * yLin + 0.65 * yMin;
    return Math.max(-1.0, Math.min(1.0, y));
  }

  return Math.max(-1.0, Math.min(1.0, yLin));
}

// Standard Sony DSD carrier rates
function getDsdRate(dsdMode = 'dsd64') {
  const mode = (dsdMode || 'dsd64').toLowerCase();
  if (mode === 'dsd128') return 5644800;  // DSD128 (44.1kHz * 128)
  if (mode === 'dsd256') return 11289600; // DSD256 (44.1kHz * 256)
  if (mode === 'dsd512') return 22579200; // DSD512 (44.1kHz * 512)
  return 2822400; // Standard DSD64 (44.1kHz * 64)
}

const DSD_BLOCK_SIZE = 4096; // 4096 bytes = 32768 1-bit samples per channel block
const DSD_SAMPLES_PER_BLOCK = DSD_BLOCK_SIZE * 8;

// ---------------------------------------------------------------------------
// Synthesized CIFFR (Cascade of Integrators with FeedForward + Resonators)
// coefficient sets for the 5th / 7th order paths.
//
// Topology (delayed 1-bit feedback, taps on current states):
//   s1 += c1*(u - y_prev)
//   s2 += c2*s1 - g1*s3_prev ; s3 += c3*s2          (resonator pair 1)
//   s4 += c4*s3 - g2*s5_prev ; s5 += c5*s4          (resonator pair 2)
//   [7th only] s6 += c6*s5 - g3*s7_prev ; s7 += c7*s6 (resonator pair 3)
//   sigma = u + a1*s1 + a2*s2 + a4*s4 [+ a6*s6] ; y = sign(sigma)
//
// The NTF is N(q)/D(q) with N = (1-q)·E1·E2[E3], E_i = 1-(2-θi²)q+q², i.e. one
// DC differentiator zero plus 2 (5th) / 3 (7th) ultrasonic zero pairs placed at
//   f_zero = fs/(2π)·2·asin(θ/2)  ≈  54 kHz / 534 kHz (5th), 51/316/50 kHz (7th @ DSD64).
// The direct u path (b = 1) makes the in-band signal transfer ≈ 1 (unity gain).
// Coefficients were obtained by polynomial NTF synthesis + simulation-based tuning
// (in-band noise < 2nd-order baseline, no integrator clamping at full-scale input).
// ---------------------------------------------------------------------------
const CIFFR_5 = {
  c1: 0.26623248, c2: 0.24130718, c3: 0.59209415, c4: 0.60201918, c5: 0.27603434,
  th1: 0.11997598, th2: 1.14752703,
  a1: 4.12160868, a2: 1.85676227, a4: -1.65042600,
  scale: 0.73477287
};
const CIFFR_7 = {
  c1: 0.25429317, c2: 0.26931930, c3: 0.41656938, c4: 0.47880337, c5: 0.11094818,
  c6: 0.15152217, c7: 0.23268945,
  th1: 0.22848656, th2: 1.35066106, th3: 0.21436316,
  a1: 2.48682077, a2: 1.34265184, a4: -1.65042600, a6: 0.30052327,
  scale: 0.62796370
};
// resonator couplings: g_i * c(odd index) = theta_i^2 (keeps NTF zero placement exact)
CIFFR_5.g1 = CIFFR_5.th1 * CIFFR_5.th1 / CIFFR_5.c3;
CIFFR_5.g2 = CIFFR_5.th2 * CIFFR_5.th2 / CIFFR_5.c5;
CIFFR_7.g1 = CIFFR_7.th1 * CIFFR_7.th1 / CIFFR_7.c3;
CIFFR_7.g2 = CIFFR_7.th2 * CIFFR_7.th2 / CIFFR_7.c5;
CIFFR_7.g3 = CIFFR_7.th3 * CIFFR_7.th3 / CIFFR_7.c7;
const CIFFR_CLAMP = 8.0; // anti-windup safety limit (normal operation stays well below)

// 92-byte standard Sony DSF container header
function buildDsfHeader(totalFileBytes, dsdRate, totalSamplesPerChannel, blockSize = DSD_BLOCK_SIZE) {
  const header = Buffer.alloc(92);
  let off = 0;

  // 1. 'DSD ' Chunk (28 bytes)
  header.write('DSD ', off); off += 4;
  header.writeBigUInt64LE(28n, off); off += 8;
  header.writeBigUInt64LE(BigInt(totalFileBytes), off); off += 8;
  header.writeBigUInt64LE(0n, off); off += 8;

  // 2. 'fmt ' Chunk (52 bytes)
  header.write('fmt ', off); off += 4;
  header.writeBigUInt64LE(52n, off); off += 8;
  header.writeUInt32LE(1, off); off += 4; // Format version = 1
  header.writeUInt32LE(0, off); off += 4; // Format ID = 0 (DSD raw)
  header.writeUInt32LE(2, off); off += 4; // Channel Type = 2 (stereo)
  header.writeUInt32LE(2, off); off += 4; // Channels = 2
  header.writeUInt32LE(dsdRate, off); off += 4; // Sample Rate
  header.writeUInt32LE(1, off); off += 4; // Bits per sample = 1
  header.writeBigUInt64LE(BigInt(totalSamplesPerChannel), off); off += 8;
  header.writeUInt32LE(blockSize, off); off += 4; // Block size = 4096
  header.writeUInt32LE(0, off); off += 4; // Reserved

  // 3. 'data' Chunk (12 bytes)
  header.write('data', off); off += 4;
  header.writeBigUInt64LE(BigInt(12 + (totalFileBytes - 92)), off); off += 8;

  return header;
}

// High-Frequency Noise-Shaping 1-bit Delta-Sigma Modulator
// 2nd order: classic Boser-Wooley CIFB (unchanged, proven good).
// 5th / 7th order: synthesized CIFFR (cascade of integrators + feedforward taps +
// ultrasonic resonator pairs, see CIFFR_5 / CIFFR_7 coefficient tables above).
// with Linear / Minimum / Intermediate phase input interpolation.
//
// Stateful: internal integrator state persists across processBlocks() calls,
// so one instance can drive both whole-file encoding and progressive batch encoding
// with bit-identical output.
class DsdModulator {
  constructor(dsdOrder = 5, filterPhase = 'linear') {
    this.order = [2, 5, 7].includes(parseInt(dsdOrder, 10)) ? parseInt(dsdOrder, 10) : 5;
    this.phase = ['linear', 'minimum', 'intermediate'].includes(filterPhase) ? filterPhase : 'linear';

    // Modulator integrator states (per channel)
    this.s1L = 0; this.s2L = 0; this.s3L = 0; this.s4L = 0; this.s5L = 0; this.s6L = 0; this.s7L = 0;
    this.s1R = 0; this.s2R = 0; this.s3R = 0; this.s4R = 0; this.s5R = 0; this.s6R = 0; this.s7R = 0;
    this.yL = 0; this.yR = 0;
  }

  // Modulate output bit range [startBit, endBit) from normalized input Float32Arrays.
  // startBit / endBit must be multiples of DSD_SAMPLES_PER_BLOCK.
  // Returns a Buffer of numBlocks * 2 * DSD_BLOCK_SIZE bytes in DSF block-pair layout
  // (left block followed by right block for each block).
  processBlocks(left, right, inLen, startBit, endBit, invRatio) {
    const numBlocks = Math.round((endBit - startBit) / DSD_SAMPLES_PER_BLOCK);
    if (numBlocks <= 0) return Buffer.alloc(0);

    const blockSize = DSD_BLOCK_SIZE;
    const samplesPerBlock = DSD_SAMPLES_PER_BLOCK;
    const out = Buffer.allocUnsafe(numBlocks * 2 * blockSize);
    const order = this.order;
    const phase = this.phase;

    // Load persistent state into hot locals
    let s1_L = this.s1L, s2_L = this.s2L, s3_L = this.s3L, s4_L = this.s4L, s5_L = this.s5L, s6_L = this.s6L, s7_L = this.s7L, y_L = this.yL;
    let s1_R = this.s1R, s2_R = this.s2R, s3_R = this.s3R, s4_R = this.s4R, s5_R = this.s5R, s6_R = this.s6R, s7_R = this.s7R, y_R = this.yR;

    for (let b = 0; b < numBlocks; b++) {
      const leftOff = b * 2 * blockSize;
      const rightOff = leftOff + blockSize;
      const startSampleIdx = startBit + b * samplesPerBlock;

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
            // 5th-Order CIFFR: 1 DC zero + 2 ultrasonic resonator zero pairs (see CIFFR_5)
            const uL = rawL * CIFFR_5.scale;
            s1_L += CIFFR_5.c1 * (uL - y_L);
            if (s1_L > CIFFR_CLAMP) s1_L = CIFFR_CLAMP; else if (s1_L < -CIFFR_CLAMP) s1_L = -CIFFR_CLAMP;
            s2_L += CIFFR_5.c2 * s1_L - CIFFR_5.g1 * s3_L;
            if (s2_L > CIFFR_CLAMP) s2_L = CIFFR_CLAMP; else if (s2_L < -CIFFR_CLAMP) s2_L = -CIFFR_CLAMP;
            s3_L += CIFFR_5.c3 * s2_L;
            if (s3_L > CIFFR_CLAMP) s3_L = CIFFR_CLAMP; else if (s3_L < -CIFFR_CLAMP) s3_L = -CIFFR_CLAMP;
            s4_L += CIFFR_5.c4 * s3_L - CIFFR_5.g2 * s5_L;
            if (s4_L > CIFFR_CLAMP) s4_L = CIFFR_CLAMP; else if (s4_L < -CIFFR_CLAMP) s4_L = -CIFFR_CLAMP;
            s5_L += CIFFR_5.c5 * s4_L;
            if (s5_L > CIFFR_CLAMP) s5_L = CIFFR_CLAMP; else if (s5_L < -CIFFR_CLAMP) s5_L = -CIFFR_CLAMP;
            const sigma_L = uL + CIFFR_5.a1 * s1_L + CIFFR_5.a2 * s2_L + CIFFR_5.a4 * s4_L;
            y_L = (sigma_L >= 0) ? 1.0 : -1.0;
            if (y_L > 0) byteValL |= (1 << bit);

            const uR = rawR * CIFFR_5.scale;
            s1_R += CIFFR_5.c1 * (uR - y_R);
            if (s1_R > CIFFR_CLAMP) s1_R = CIFFR_CLAMP; else if (s1_R < -CIFFR_CLAMP) s1_R = -CIFFR_CLAMP;
            s2_R += CIFFR_5.c2 * s1_R - CIFFR_5.g1 * s3_R;
            if (s2_R > CIFFR_CLAMP) s2_R = CIFFR_CLAMP; else if (s2_R < -CIFFR_CLAMP) s2_R = -CIFFR_CLAMP;
            s3_R += CIFFR_5.c3 * s2_R;
            if (s3_R > CIFFR_CLAMP) s3_R = CIFFR_CLAMP; else if (s3_R < -CIFFR_CLAMP) s3_R = -CIFFR_CLAMP;
            s4_R += CIFFR_5.c4 * s3_R - CIFFR_5.g2 * s5_R;
            if (s4_R > CIFFR_CLAMP) s4_R = CIFFR_CLAMP; else if (s4_R < -CIFFR_CLAMP) s4_R = -CIFFR_CLAMP;
            s5_R += CIFFR_5.c5 * s4_R;
            if (s5_R > CIFFR_CLAMP) s5_R = CIFFR_CLAMP; else if (s5_R < -CIFFR_CLAMP) s5_R = -CIFFR_CLAMP;
            const sigma_R = uR + CIFFR_5.a1 * s1_R + CIFFR_5.a2 * s2_R + CIFFR_5.a4 * s4_R;
            y_R = (sigma_R >= 0) ? 1.0 : -1.0;
            if (y_R > 0) byteValR |= (1 << bit);
          } else {
            // 7th-Order CIFFR: 1 DC zero + 3 ultrasonic resonator zero pairs (see CIFFR_7)
            const uL = rawL * CIFFR_7.scale;
            s1_L += CIFFR_7.c1 * (uL - y_L);
            if (s1_L > CIFFR_CLAMP) s1_L = CIFFR_CLAMP; else if (s1_L < -CIFFR_CLAMP) s1_L = -CIFFR_CLAMP;
            s2_L += CIFFR_7.c2 * s1_L - CIFFR_7.g1 * s3_L;
            if (s2_L > CIFFR_CLAMP) s2_L = CIFFR_CLAMP; else if (s2_L < -CIFFR_CLAMP) s2_L = -CIFFR_CLAMP;
            s3_L += CIFFR_7.c3 * s2_L;
            if (s3_L > CIFFR_CLAMP) s3_L = CIFFR_CLAMP; else if (s3_L < -CIFFR_CLAMP) s3_L = -CIFFR_CLAMP;
            s4_L += CIFFR_7.c4 * s3_L - CIFFR_7.g2 * s5_L;
            if (s4_L > CIFFR_CLAMP) s4_L = CIFFR_CLAMP; else if (s4_L < -CIFFR_CLAMP) s4_L = -CIFFR_CLAMP;
            s5_L += CIFFR_7.c5 * s4_L;
            if (s5_L > CIFFR_CLAMP) s5_L = CIFFR_CLAMP; else if (s5_L < -CIFFR_CLAMP) s5_L = -CIFFR_CLAMP;
            s6_L += CIFFR_7.c6 * s5_L - CIFFR_7.g3 * s7_L;
            if (s6_L > CIFFR_CLAMP) s6_L = CIFFR_CLAMP; else if (s6_L < -CIFFR_CLAMP) s6_L = -CIFFR_CLAMP;
            s7_L += CIFFR_7.c7 * s6_L;
            if (s7_L > CIFFR_CLAMP) s7_L = CIFFR_CLAMP; else if (s7_L < -CIFFR_CLAMP) s7_L = -CIFFR_CLAMP;
            const sigma_L = uL + CIFFR_7.a1 * s1_L + CIFFR_7.a2 * s2_L + CIFFR_7.a4 * s4_L + CIFFR_7.a6 * s6_L;
            y_L = (sigma_L >= 0) ? 1.0 : -1.0;
            if (y_L > 0) byteValL |= (1 << bit);

            const uR = rawR * CIFFR_7.scale;
            s1_R += CIFFR_7.c1 * (uR - y_R);
            if (s1_R > CIFFR_CLAMP) s1_R = CIFFR_CLAMP; else if (s1_R < -CIFFR_CLAMP) s1_R = -CIFFR_CLAMP;
            s2_R += CIFFR_7.c2 * s1_R - CIFFR_7.g1 * s3_R;
            if (s2_R > CIFFR_CLAMP) s2_R = CIFFR_CLAMP; else if (s2_R < -CIFFR_CLAMP) s2_R = -CIFFR_CLAMP;
            s3_R += CIFFR_7.c3 * s2_R;
            if (s3_R > CIFFR_CLAMP) s3_R = CIFFR_CLAMP; else if (s3_R < -CIFFR_CLAMP) s3_R = -CIFFR_CLAMP;
            s4_R += CIFFR_7.c4 * s3_R - CIFFR_7.g2 * s5_R;
            if (s4_R > CIFFR_CLAMP) s4_R = CIFFR_CLAMP; else if (s4_R < -CIFFR_CLAMP) s4_R = -CIFFR_CLAMP;
            s5_R += CIFFR_7.c5 * s4_R;
            if (s5_R > CIFFR_CLAMP) s5_R = CIFFR_CLAMP; else if (s5_R < -CIFFR_CLAMP) s5_R = -CIFFR_CLAMP;
            s6_R += CIFFR_7.c6 * s5_R - CIFFR_7.g3 * s7_R;
            if (s6_R > CIFFR_CLAMP) s6_R = CIFFR_CLAMP; else if (s6_R < -CIFFR_CLAMP) s6_R = -CIFFR_CLAMP;
            s7_R += CIFFR_7.c7 * s6_R;
            if (s7_R > CIFFR_CLAMP) s7_R = CIFFR_CLAMP; else if (s7_R < -CIFFR_CLAMP) s7_R = -CIFFR_CLAMP;
            const sigma_R = uR + CIFFR_7.a1 * s1_R + CIFFR_7.a2 * s2_R + CIFFR_7.a4 * s4_R + CIFFR_7.a6 * s6_R;
            y_R = (sigma_R >= 0) ? 1.0 : -1.0;
            if (y_R > 0) byteValR |= (1 << bit);
          }
        }

        out[leftOff + byteIdx] = byteValL;
        out[rightOff + byteIdx] = byteValR;
      }
    }

    // Persist state back for the next batch
    this.s1L = s1_L; this.s2L = s2_L; this.s3L = s3_L; this.s4L = s4_L; this.s5L = s5_L; this.s6L = s6_L; this.s7L = s7_L; this.yL = y_L;
    this.s1R = s1_R; this.s2R = s2_R; this.s3R = s3_R; this.s4R = s4_R; this.s5R = s5_R; this.s6R = s6_R; this.s7R = s7_R; this.yR = y_R;

    return out;
  }
}

module.exports = {
  interpolateSample,
  getDsdRate,
  buildDsfHeader,
  DsdModulator,
  DSD_BLOCK_SIZE,
  DSD_SAMPLES_PER_BLOCK
};
