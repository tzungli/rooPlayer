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

// Filter Phase Interpolation Kernel (Linear / Minimum / Intermediate 35:65 blend)
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

// ---------------------------------------------------------------------------
// Poly-Sinc-Gauss Long FIR Upsampling Filter（poly-sinc-gauss 風格）
//
// 閉式設計：h(t) = sinc(2·fc·t/fs) · exp(-(t/σ)²)
//   sinc 基準 × 高斯窗 ⇔ 頻域「高斯形過渡帶」：極低的鈴振、通帶平坦至源
//   Nyquist、鏡像（源取樣率的倍頻）抑制約 -100..-125 dB。線性相位。
//
// minimumPhase=true（'gauss-min'）：以複倒數譜（complex cepstrum）折疊把上述
//   線性相位設計轉換為最小相位因果濾波器：預響鈴嚴格為零，代價是階躍有約 30%
//   的快速衰減後衝（post-kick，約 180µs 內收斂）——即最小相位 gauss
//   家族的「凌厲打擊」性格。最小相位脈衝有長尾（sinc 零點造成的冪律衰減），
//   但長尾對音訊無貢獻：截斷至 ~430µs × fsOut（上限 2500 taps）與全長規格相同
//   （DSD64 1200 taps 與 8944 taps 實測完全等效：鏡像 -99/-122dB、階躍零誤差）。
//
// 類比規格由 DSD64/44.1k 參考點縮放：
//   fc = 1.27 × 源 Nyquist（上限 0.45·fsOut）
//   σ  = 180 samples @ fsOut=2.8224M, src=44.1k（隨 srcRate 與 fsOut 線性縮放）
//   截斷 L = 4.5σ（窗值 exp(-20)≈1.6e-9，再長的尾巴對音訊無意義）；
//   為限制 CPU 成本，必要時收短到 ≥2.5σ（保留 ≥-50dB 旁瓣底），成本上限約
//   150 MMAC/s/聲道。多相實作的成本 = 每輸出樣本約 26 次 MAC（∝ fsOut）。
//
// 非整數 ratio（例如 48k 源 → DSD64）用 S=8 子樣本网格 + 線性插值取樣 h(t)。
// ---------------------------------------------------------------------------
function fftRun(re, im, inv) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const tr = re[i]; re[i] = re[j]; re[j] = tr; const ti = im[i]; im[i] = im[j]; im[j] = ti; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inv ? 2 : -2) * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let ar = 1, ai = 0;
      for (let k = 0; k < len / 2; k++) {
        const r1 = re[i + k], i1 = im[i + k], r2 = re[i + k + len / 2], i2 = im[i + k + len / 2];
        const vr = r2 * ar - i2 * ai, vi = r2 * ai + i2 * ar;
        re[i + k] = r1 + vr; im[i + k] = i1 + vi;
        re[i + k + len / 2] = r1 - vr; im[i + k + len / 2] = i1 - vi;
        const nr = ar * wr - ai * wi; ai = ar * wi + ai * wr; ar = nr;
      }
    }
  }
  if (inv) { for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; } }
}

function buildGaussFilter(fsOut, srcRate, minimumPhase = false) {
  // 操作點（DSD64/44.1k 實測掃描）：通帶至 21k 平坦 -0.2dB、22.05k -0.4dB、
  // 下側鏡像（源取樣率-信号頻，如 19k→25.1k）-2dB、44.1k 鏡像 -112dB、30k -11dB。
  const fc = Math.min(1.27 * srcRate / 2, 0.45 * fsOut);
  let sigma = 180 * (srcRate / 44100) * (fsOut / 2822400);
  if (sigma < 3) sigma = 3;
  const Lcap = Math.floor(150e6 / srcRate / 2);
  let L = Math.min(Math.ceil(4.5 * sigma), Math.max(Lcap, Math.ceil(2.5 * sigma)));
  if (L < 8) L = 8;

  const ratio = fsOut / srcRate;
  const integerRatio = Math.abs(ratio - Math.round(ratio)) < 1e-9;
  const S = integerRatio ? 1 : 8;
  const gaussTap = (t) => {
    const x = 2 * fc * t / fsOut;
    const s = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    return (2 * fc / fsOut) * s * Math.exp(-(t / sigma) * (t / sigma));
  };
  // 升頻增益補償：零插補（zero-stuffing）後濾波，各多相分支的和必須為 1，
  // 即 Σh = ratio（否則輸出 DC/低頻增益會差 ratio 倍）。

  if (!minimumPhase) {
    const half = L * S;
    const n = 2 * half + 2; // +1 guard tap for sub-sample interpolation edge
    const h = new Float64Array(n);
    for (let j = -half; j <= half; j++) h[j + half] = gaussTap(j / S);
    let sum = 0;
    for (let i = 0; i < n - 1; i++) sum += h[i];
    // S>1 時多相分支以 stride=ratio·S 個網格點取樣插值係數，分支和 = Σ_grid h/(ratio·S)，
    // 故網格和需為 ratio·S（S=1 時即 ratio）。
    const g = ratio * S / sum;
    for (let i = 0; i < n; i++) h[i] *= g;
    return { h, S, lo: -L, hi: L, ratio, integerRatio, fsOut, srcRate, minimumPhase: false, taps: 2 * half + 1 };
  }

  // --- 最小相位轉換（單位輸出樣本网格上的複倒數譜折疊）---
  // 截斷 budget：長尾對音訊無貢獻（DSD64 實測 1200 taps 與全長規格相同）。
  // 但 FFT 工作長度 M 必須容納「真實」最小相位尾巴（~3.5ms × fsOut 的冪律長尾，
  // 約為 budget 的 8 倍）：若 M 太小，尾部繞回負時間會污染折疊，產生延遲濾波器。
  const budget = Math.min(2500, Math.max(64, Math.round(fsOut * 4.3e-4)));
  let M = 4096;
  while (M < 2.2 * fsOut * 3.5e-3 || M < 4 * (2 * L + 1)) M *= 2;
  if (M > 65536) M = 65536; // 繞回污染於此深度約 -115dB，對音訊無影響
  const re = new Float64Array(M), im = new Float64Array(M);
  for (let t = -L; t <= L; t++) { const v = gaussTap(t); if (t < 0) re[M + t] = v; else re[t] = v; }
  fftRun(re, im, false);
  for (let k = 0; k < M; k++) {
    const mag = Math.hypot(re[k], im[k]);
    const ph = Math.atan2(im[k], re[k]);
    re[k] = Math.log(Math.max(mag, 1e-14)); im[k] = ph;
  }
  fftRun(re, im, true); // 倒數譜
  for (let t = 1; t < M / 2; t++) { re[t] *= 2; im[t] *= 2; re[M - t] = 0; im[M - t] = 0; } // 折疊 => 最小相位
  fftRun(re, im, false);
  for (let k = 0; k < M; k++) { const lm = Math.min(re[k], 40), ph = im[k]; re[k] = Math.exp(lm) * Math.cos(ph); im[k] = Math.exp(lm) * Math.sin(ph); }
  fftRun(re, im, true); // 因果最小相位脈衝
  let sum = 0;
  for (let i = 0; i < budget; i++) sum += re[i];
  const g = ratio / sum;
  const half = (budget - 1) * S;
  const h = new Float64Array(half + 2);
  for (let j = 0; j <= half; j++) {
    const t = j / S;
    const t0 = Math.floor(t);
    const fr = t - t0;
    h[j] = (re[t0] + fr * (re[Math.min(t0 + 1, budget - 1)] - re[t0])) * g;
  }
  return { h, S, lo: 0, hi: budget - 1, ratio, integerRatio, fsOut, srcRate, minimumPhase: true, taps: budget };
}

// ---------------------------------------------------------------------------
// Modified Bessel I0（級數收斂快速；β≈19 時 60 項內達 double 精度）
// ---------------------------------------------------------------------------
function besselI0(x) {
  let sum = 1, term = 1;
  for (let k = 1; k <= 60; k++) { term *= (x / 2) / k; sum += term * term; if (term * term < sum * 1e-17) break; }
  return sum;
}

// ---------------------------------------------------------------------------
// "extended poly sinc" (EXT2) 風格 FIR 升頻濾波器 — 路線B閉式重新實作
//
// 注意：EXT2 家族的內部參數未公開，此為依「extended poly sinc」家族之
// 公開設計性格所做的閉式近似（Kaiser 窗 sinc）：
//   h(t) = sinc(2·fc·t/fs) · I0(β·sqrt(1-(t/L)²))/I0(β)
// 「extended」性格 = 截止點 fc 延伸到源 Nyquist 之上（1.27×，與本引擎 gauss
// 家族同一延伸因子），整個過渡帶位於音訊帶之上：
//   - 通帶 [0, 源Nyquist] 完全平坦（無高頻滾降）
//   - 源Nyquist..fc 之間的鏡像「泄漏」（約 0dB，位於 22k 以上，可量測不可聽）
//   - fc+Δ 以上鏡像抑制 ≈ -140dB（EXT 級深止帶）
// 線性相位（對稱預/後鈴振，同 gauss-long 性格；最小相位版本請用 gauss-min）。
//
//   Δ（過渡寬度）= 0.136 × srcRate（44.1k → 6kHz，「medium」級長度）
//   Kaiser 階數公式 N ≈ (As-7.95)·fsOut/(14.347·Δ)；β = 0.1102(As-8.7)
//   截斷上限與 gauss 相同：Lcap = 150e6/srcRate/2（≈150 MMAC/s/聲道）；
//   截斷只使過渡帶變寬，止帶深度由窗決定（≈As）不受影響。
// 非整數 ratio 用 S=8 子樣本网格 + 線性插值（與 gauss 相同）。
// ---------------------------------------------------------------------------
function buildPolyExt2Filter(fsOut, srcRate) {
  const AS_DB = 140;
  const fc = Math.min(1.27 * srcRate / 2, 0.45 * fsOut);
  const trans = 0.136 * srcRate;
  const beta = 0.1102 * (AS_DB - 8.7);
  const Lcap = Math.floor(150e6 / srcRate / 2);
  let L = Math.min(Math.ceil((AS_DB - 7.95) * fsOut / (2 * 14.347 * trans)), Lcap);
  if (L < 8) L = 8;

  const ratio = fsOut / srcRate;
  const integerRatio = Math.abs(ratio - Math.round(ratio)) < 1e-9;
  const S = integerRatio ? 1 : 8;

  const i0beta = besselI0(beta);
  const ext2Tap = (t) => {
    if (Math.abs(t) > L) return 0;
    const x = 2 * fc * t / fsOut;
    const s = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    const u = t / L;
    const w = besselI0(beta * Math.sqrt(Math.max(0, 1 - u * u))) / i0beta;
    return (2 * fc / fsOut) * s * w;
  };

  const half = L * S;
  const n = 2 * half + 2; // +1 guard tap for sub-sample interpolation edge
  const h = new Float64Array(n);
  for (let j = -half; j <= half; j++) h[j + half] = ext2Tap(j / S);
  let sum = 0;
  for (let i = 0; i < n - 1; i++) sum += h[i];
  const g = ratio * S / sum; // 同 buildGaussFilter：S>1 時網格和需為 ratio·S
  for (let i = 0; i < n; i++) h[i] *= g;
  return { h, S, lo: -L, hi: L, ratio, integerRatio, fsOut, srcRate, minimumPhase: false, taps: 2 * half + 1 };
}

// ---------------------------------------------------------------------------
// "poly-sinc-ext2" 直譯 FIR — 依公開規格描述重新實作（hqp-ps-ext2）
//
// 設計目標（依 poly-sinc-ext2 公開規格：線性相位多相正弦、陡峭滾降、極高止帶）：
//   - 過渡帶精確從源 Nyquist 起始，延伸至 1.27×源Nyquist（「ext2」延伸）：
//     通帶 [0, 源Nyquist] 完全平坦；源Nyquist..1.27×源Nyquist 為滾降帶
//   - Kaiser 窗 As = 180dB（極高止帶衰減；poly-ext2 為 140dB）
//   - 線性相位（對稱脈衝，同 gauss-long / poly-ext2）
//   - 任意倍率：S=8 子樣本网格 + 線性插值（與 gauss/poly-ext2 相同）
//   - 16× 兩階段架構（第一階段升頻至 16× 中間速率）是 poly-sinc-ext2 家族的計算效率
//     實作；對線性相位濾波而言其複合頻率響應與本單級 FIR 等價，故本引擎以
//     單級直接執行實作（執行成本與 poly-ext2 同級）。
//   - 邊界情況：fsOut 太低（ratio < 1.27）時過渡帶無法完整位於源Nyquist之上，
//     截止退回 0.45×fsOut（與 poly-ext2 相同處理）。
// 非官方原廠係數；依公開技術規格描述的閉式直譯。
// ---------------------------------------------------------------------------
function buildHqpPsExt2Filter(fsOut, srcRate) {
  const AS_DB = 180;
  // 過渡帶 [srcNyq, 1.27×srcNyq]：中心 1.135×srcNyq、寬 0.27×srcNyq = 0.135×srcRate
  const fc = Math.min(1.135 * srcRate / 2, 0.45 * fsOut);
  const trans = 0.135 * srcRate;
  const beta = 0.1102 * (AS_DB - 8.7);
  const Lcap = Math.floor(150e6 / srcRate / 2);
  let L = Math.min(Math.ceil((AS_DB - 7.95) * fsOut / (2 * 14.347 * trans)), Lcap);
  if (L < 8) L = 8;

  const ratio = fsOut / srcRate;
  const integerRatio = Math.abs(ratio - Math.round(ratio)) < 1e-9;
  const S = integerRatio ? 1 : 8;

  const i0beta = besselI0(beta);
  const extTap = (t) => {
    if (Math.abs(t) > L) return 0;
    const x = 2 * fc * t / fsOut;
    const s = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    const u = t / L;
    const w = besselI0(beta * Math.sqrt(Math.max(0, 1 - u * u))) / i0beta;
    return (2 * fc / fsOut) * s * w;
  };

  const half = L * S;
  const n = 2 * half + 2; // +1 guard tap for sub-sample interpolation edge
  const h = new Float64Array(n);
  for (let j = -half; j <= half; j++) h[j + half] = extTap(j / S);
  let sum = 0;
  for (let i = 0; i < n - 1; i++) sum += h[i];
  const g = ratio * S / sum; // 同 buildGaussFilter：S>1 時網格和需為 ratio·S
  for (let i = 0; i < n; i++) h[i] *= g;
  return { h, S, lo: -L, hi: L, ratio, integerRatio, fsOut, srcRate, minimumPhase: false, taps: 2 * half + 1 };
}

// ---- Polyphase phase tables (integer AND rational upsampling ratios) ----
// With ratio = P/Q in lowest terms, the FIR tap pattern for output index o depends
// only on phi = o mod P: the contributing inputs are k = k0(phi) + m·Q + j and the
// h-samples are h(t0(phi) - j·P/Q), where m = floor(o/P). Precomputing the
// interpolated coefficient sequence G_phi[j] per phase turns the hot loop into two
// contiguous linear scans (no per-tap float index math, no strided h access).
// All index math here is exact integer arithmetic (num = (t_j - lo)·S·Q), which is
// strictly more accurate than the legacy iterative float subtraction.
// buildFirPhases returns null for extreme P; firSample then keeps the generic path.
function buildFirPhases(gf) {
  const fsOut = Math.round(gf.fsOut), srcRate = Math.round(gf.srcRate);
  if (!Number.isInteger(fsOut) || !Number.isInteger(srcRate) || srcRate <= 0) return null;
  const gcdI = (a, b) => (b ? gcdI(b, a % b) : a);
  const g = gcdI(fsOut, srcRate);
  const P = fsOut / g, Q = srcRate / g;
  if (P < 1 || P > 4096) return null;
  const h = gf.h, S = gf.S, lo = gf.lo, hi = gf.hi;
  const maxJ = (hi - lo) * S;
  const phases = new Array(P);
  for (let phi = 0; phi < P; phi++) {
    const k0 = Math.ceil((phi - hi) * Q / P);
    const A = phi * Q - k0 * P - lo * Q; // = (t0 - lo)·Q, exact integer
    const T = Math.floor(A / P) + 1; // tap count for interior outputs of this phase
    if (T < 1 || T > 8192) { phases[phi] = null; continue; }
    const N0 = S * A;
    const SP = S * P;
    const G = new Float64Array(T);
    for (let j = 0; j < T; j++) {
      const num = N0 - j * SP; // = (t_j - lo)·S·Q, exact integer in [0, maxJ·Q]
      let j0 = Math.floor(num / Q);
      if (j0 < 0) j0 = 0; else if (j0 > maxJ) j0 = maxJ; // safety net (exact math: never fires)
      const rem = num - j0 * Q;
      G[j] = rem <= 0 ? h[j0] : h[j0] + (rem / Q) * (h[j0 + 1] - h[j0]);
    }
    phases[phi] = { k0, T, G };
  }
  return { P, Q, phases };
}

// Evaluate the Gauss FIR at output index outIdx for a zero-stuffed input grid
// (input sample k lands at output position k·ratio). out = Σ_k input[k]·h(outIdx - k·ratio)
// h support is [gf.lo, gf.hi] in output-sample units, stored on the S grid.
function firSample(input, inLen, outIdx, ratio, gf) {
  // Fast path: contiguous polyphase scan with precomputed coefficients (built once per filter).
  let ph = gf.phases;
  if (ph === undefined) ph = gf.phases = buildFirPhases(gf);
  if (ph) {
    const P = ph.P, Q = ph.Q;
    const phi = outIdx % P;
    const entry = ph.phases[phi];
    if (entry) {
      const kBase = entry.k0 + Math.floor(outIdx / P) * Q;
      const T = entry.T;
      if (kBase >= 0 && kBase + T <= inLen) {
        const G = entry.G;
        let acc = 0;
        for (let j = 0; j < T; j++) acc += input[kBase + j] * G[j];
        return acc;
      }
    }
  }

  const h = gf.h, S = gf.S, lo = gf.lo, hi = gf.hi;
  let kStart = Math.ceil((outIdx - hi) / ratio);
  let kEnd = Math.floor((outIdx - lo) / ratio);
  if (kStart < 0) kStart = 0;
  if (kEnd > inLen - 1) kEnd = inLen - 1;
  let acc = 0;
  if (gf.integerRatio) {
    const r = Math.round(gf.ratio);
    let m = outIdx - kStart * r - lo;
    for (let k = kStart; k <= kEnd; k++, m -= r) acc += input[k] * h[m];
  } else {
    let t = outIdx - kStart * ratio;
    const maxJ = (hi - lo) * S;
    for (let k = kStart; k <= kEnd; k++, t -= ratio) {
      let j = (t - lo) * S;
      // 浮點捨入可能讓 j 微越界（-1e-9 量級）=> 夾回邊界，誤差可忽略
      if (j < 0) j = 0; else if (j > maxJ) j = maxJ;
      const j0 = Math.floor(j);
      const frac = j - j0;
      acc += input[k] * (h[j0] + frac * (h[j0 + 1] - h[j0]));
    }
  }
  return acc;
}

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
// Input upsampling: Linear / Minimum / Intermediate phase Hermite interpolation,
// 'gauss-long' = Poly-Sinc-Gauss Long FIR (linear phase), 'gauss-min' = the
// minimum-phase variant of the same design (zero pre-ringing), 'poly-ext2' =
// extended-poly-sinc (EXT2) style Kaiser-windowed sinc (see buildPolyExt2Filter),
// 'hqp-ps-ext2' = poly-sinc-ext2 direct-interpretation FIR (see buildHqpPsExt2Filter).
// All FIR phases require a gaussFilter built by buildGaussFilter()/buildPolyExt2Filter()/
// buildHqpPsExt2Filter(); falls back to linear Hermite when absent.
//
// Stateful: internal integrator state persists across processBlocks() calls,
// so one instance can drive both whole-file encoding and progressive batch encoding
// with bit-identical output.
class DsdModulator {
  constructor(dsdOrder = 5, filterPhase = 'linear', gaussFilter = null) {
    this.order = [2, 5, 7].includes(parseInt(dsdOrder, 10)) ? parseInt(dsdOrder, 10) : 5;
    let phase = ['linear', 'minimum', 'intermediate', 'gauss-long', 'gauss-min', 'poly-ext2', 'hqp-ps-ext2'].includes(filterPhase) ? filterPhase : 'linear';
    // FIR phases need coefficients from buildGaussFilter()/buildPolyExt2Filter()/buildHqpPsExt2Filter(); fall back to linear Hermite
    if ((phase === 'gauss-long' || phase === 'gauss-min' || phase === 'poly-ext2' || phase === 'hqp-ps-ext2') && !gaussFilter) phase = 'linear';
    this.phase = phase;
    this.gf = gaussFilter || null;

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
    const useGauss = phase === 'gauss-long' || phase === 'gauss-min' || phase === 'poly-ext2' || phase === 'hqp-ps-ext2';
    const ratio = 1 / invRatio;
    const gf = this.gf;

    // Hot-path hoisting: resolve coefficient table lookups once per batch, not per bit.
    let c1 = 0, c2 = 0, c3 = 0, c4 = 0, c5 = 0, c6 = 0, c7 = 0;
    let g1 = 0, g2 = 0, g3 = 0, a1 = 0, a2 = 0, a4 = 0, a6 = 0, scale = 0;
    const CLAMP = CIFFR_CLAMP;
    if (order === 5) {
      c1 = CIFFR_5.c1; c2 = CIFFR_5.c2; c3 = CIFFR_5.c3; c4 = CIFFR_5.c4; c5 = CIFFR_5.c5;
      g1 = CIFFR_5.g1; g2 = CIFFR_5.g2; a1 = CIFFR_5.a1; a2 = CIFFR_5.a2; a4 = CIFFR_5.a4; scale = CIFFR_5.scale;
    } else if (order === 7) {
      c1 = CIFFR_7.c1; c2 = CIFFR_7.c2; c3 = CIFFR_7.c3; c4 = CIFFR_7.c4; c5 = CIFFR_7.c5; c6 = CIFFR_7.c6; c7 = CIFFR_7.c7;
      g1 = CIFFR_7.g1; g2 = CIFFR_7.g2; g3 = CIFFR_7.g3; a1 = CIFFR_7.a1; a2 = CIFFR_7.a2; a4 = CIFFR_7.a4; a6 = CIFFR_7.a6; scale = CIFFR_7.scale;
    }

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
          let rawL, rawR;
          if (useGauss) {
            // Poly-Sinc-Gauss Long FIR（見 buildGaussFilter 設計註解）
            rawL = firSample(left, inLen, outIdx, ratio, gf);
            rawR = firSample(right, inLen, outIdx, ratio, gf);
          } else {
            const pos = outIdx * invRatio;
            const idx = pos | 0;
            const t = pos - idx;

            const p0L = idx > 0 ? left[idx - 1] : left[0];
            const p1L = idx < inLen ? left[idx] : 0;
            const p2L = idx < inLen - 1 ? left[idx + 1] : p1L;
            const p3L = idx < inLen - 2 ? left[idx + 2] : p2L;
            rawL = interpolateSample(p0L, p1L, p2L, p3L, t, phase);

            const p0R = idx > 0 ? right[idx - 1] : right[0];
            const p1R = idx < inLen ? right[idx] : 0;
            const p2R = idx < inLen - 1 ? right[idx + 1] : p1R;
            const p3R = idx < inLen - 2 ? right[idx + 2] : p2R;
            rawR = interpolateSample(p0R, p1R, p2R, p3R, t, phase);
          }

          if (order === 2) {
            // 2nd-Order Boser-Wooley SDM with Anti-Windup Clamping
            const uL = rawL * 0.75;
            s1_L += uL - y_L;
            if (s1_L > 3.0) s1_L = 3.0; else if (s1_L < -3.0) s1_L = -3.0;
            s2_L += s1_L - 0.5 * y_L;
            if (s2_L > 3.0) s2_L = 3.0; else if (s2_L < -3.0) s2_L = -3.0;
            y_L = (s2_L >= 0) ? 1.0 : -1.0;
            if (y_L > 0) byteValL |= (1 << (7 - bit)); // DSF spec: MSB-first

            const uR = rawR * 0.75;
            s1_R += uR - y_R;
            if (s1_R > 3.0) s1_R = 3.0; else if (s1_R < -3.0) s1_R = -3.0;
            s2_R += s1_R - 0.5 * y_R;
            if (s2_R > 3.0) s2_R = 3.0; else if (s2_R < -3.0) s2_R = -3.0;
            y_R = (s2_R >= 0) ? 1.0 : -1.0;
            if (y_R > 0) byteValR |= (1 << (7 - bit)); // DSF spec: MSB-first
          } else if (order === 5) {
            // 5th-Order CIFFR: 1 DC zero + 2 ultrasonic resonator zero pairs (see CIFFR_5; coefficients hoisted above)
            const uL = rawL * scale;
            s1_L += c1 * (uL - y_L);
            if (s1_L > CLAMP) s1_L = CLAMP; else if (s1_L < -CLAMP) s1_L = -CLAMP;
            s2_L += c2 * s1_L - g1 * s3_L;
            if (s2_L > CLAMP) s2_L = CLAMP; else if (s2_L < -CLAMP) s2_L = -CLAMP;
            s3_L += c3 * s2_L;
            if (s3_L > CLAMP) s3_L = CLAMP; else if (s3_L < -CLAMP) s3_L = -CLAMP;
            s4_L += c4 * s3_L - g2 * s5_L;
            if (s4_L > CLAMP) s4_L = CLAMP; else if (s4_L < -CLAMP) s4_L = -CLAMP;
            s5_L += c5 * s4_L;
            if (s5_L > CLAMP) s5_L = CLAMP; else if (s5_L < -CLAMP) s5_L = -CLAMP;
            const sigma_L = uL + a1 * s1_L + a2 * s2_L + a4 * s4_L;
            y_L = (sigma_L >= 0) ? 1.0 : -1.0;
            if (y_L > 0) byteValL |= (1 << (7 - bit)); // DSF spec: MSB-first

            const uR = rawR * scale;
            s1_R += c1 * (uR - y_R);
            if (s1_R > CLAMP) s1_R = CLAMP; else if (s1_R < -CLAMP) s1_R = -CLAMP;
            s2_R += c2 * s1_R - g1 * s3_R;
            if (s2_R > CLAMP) s2_R = CLAMP; else if (s2_R < -CLAMP) s2_R = -CLAMP;
            s3_R += c3 * s2_R;
            if (s3_R > CLAMP) s3_R = CLAMP; else if (s3_R < -CLAMP) s3_R = -CLAMP;
            s4_R += c4 * s3_R - g2 * s5_R;
            if (s4_R > CLAMP) s4_R = CLAMP; else if (s4_R < -CLAMP) s4_R = -CLAMP;
            s5_R += c5 * s4_R;
            if (s5_R > CLAMP) s5_R = CLAMP; else if (s5_R < -CLAMP) s5_R = -CLAMP;
            const sigma_R = uR + a1 * s1_R + a2 * s2_R + a4 * s4_R;
            y_R = (sigma_R >= 0) ? 1.0 : -1.0;
            if (y_R > 0) byteValR |= (1 << (7 - bit)); // DSF spec: MSB-first
          } else {
            // 7th-Order CIFFR: 1 DC zero + 3 ultrasonic resonator zero pairs (see CIFFR_7; coefficients hoisted above)
            const uL = rawL * scale;
            s1_L += c1 * (uL - y_L);
            if (s1_L > CLAMP) s1_L = CLAMP; else if (s1_L < -CLAMP) s1_L = -CLAMP;
            s2_L += c2 * s1_L - g1 * s3_L;
            if (s2_L > CLAMP) s2_L = CLAMP; else if (s2_L < -CLAMP) s2_L = -CLAMP;
            s3_L += c3 * s2_L;
            if (s3_L > CLAMP) s3_L = CLAMP; else if (s3_L < -CLAMP) s3_L = -CLAMP;
            s4_L += c4 * s3_L - g2 * s5_L;
            if (s4_L > CLAMP) s4_L = CLAMP; else if (s4_L < -CLAMP) s4_L = -CLAMP;
            s5_L += c5 * s4_L;
            if (s5_L > CLAMP) s5_L = CLAMP; else if (s5_L < -CLAMP) s5_L = -CLAMP;
            s6_L += c6 * s5_L - g3 * s7_L;
            if (s6_L > CLAMP) s6_L = CLAMP; else if (s6_L < -CLAMP) s6_L = -CLAMP;
            s7_L += c7 * s6_L;
            if (s7_L > CLAMP) s7_L = CLAMP; else if (s7_L < -CLAMP) s7_L = -CLAMP;
            const sigma_L = uL + a1 * s1_L + a2 * s2_L + a4 * s4_L + a6 * s6_L;
            y_L = (sigma_L >= 0) ? 1.0 : -1.0;
            if (y_L > 0) byteValL |= (1 << (7 - bit)); // DSF spec: MSB-first

            const uR = rawR * scale;
            s1_R += c1 * (uR - y_R);
            if (s1_R > CLAMP) s1_R = CLAMP; else if (s1_R < -CLAMP) s1_R = -CLAMP;
            s2_R += c2 * s1_R - g1 * s3_R;
            if (s2_R > CLAMP) s2_R = CLAMP; else if (s2_R < -CLAMP) s2_R = -CLAMP;
            s3_R += c3 * s2_R;
            if (s3_R > CLAMP) s3_R = CLAMP; else if (s3_R < -CLAMP) s3_R = -CLAMP;
            s4_R += c4 * s3_R - g2 * s5_R;
            if (s4_R > CLAMP) s4_R = CLAMP; else if (s4_R < -CLAMP) s4_R = -CLAMP;
            s5_R += c5 * s4_R;
            if (s5_R > CLAMP) s5_R = CLAMP; else if (s5_R < -CLAMP) s5_R = -CLAMP;
            s6_R += c6 * s5_R - g3 * s7_R;
            if (s6_R > CLAMP) s6_R = CLAMP; else if (s6_R < -CLAMP) s6_R = -CLAMP;
            s7_R += c7 * s6_R;
            if (s7_R > CLAMP) s7_R = CLAMP; else if (s7_R < -CLAMP) s7_R = -CLAMP;
            const sigma_R = uR + a1 * s1_R + a2 * s2_R + a4 * s4_R + a6 * s6_R;
            y_R = (sigma_R >= 0) ? 1.0 : -1.0;
            if (y_R > 0) byteValR |= (1 << (7 - bit)); // DSF spec: MSB-first
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
  buildGaussFilter,
  buildPolyExt2Filter,
  buildHqpPsExt2Filter,
  firSample,
  getDsdRate,
  buildDsfHeader,
  DsdModulator,
  DSD_BLOCK_SIZE,
  DSD_SAMPLES_PER_BLOCK
};
