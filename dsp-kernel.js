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

// Specialized single-phase interpolators for the modulator hot path.
// Each body is an EXACT copy of the corresponding interpolateSample branch (same
// operations, same grouping order) - the phase dispatch and string comparisons are
// resolved once per batch by the caller instead of per sample. Bit-identical output.
function interpolateLinear(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  const m1 = 0.5 * (p2 - p0);
  const m2 = 0.5 * (p3 - p1);
  const y = h00 * p1 + h10 * m1 + h01 * p2 + h11 * m2;
  return Math.max(-1.0, Math.min(1.0, y));
}

function interpolateMinimum(p0, p1, p2, p3, t) {
  const d0 = p1 - p0;
  const d1 = p2 - p1;
  const y = p1 + t * d1 + 0.5 * t * (t - 1.0) * (0.85 * d0 + 0.15 * d1);
  return Math.max(-1.0, Math.min(1.0, y));
}

function interpolateIntermediate(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  const m1 = 0.5 * (p2 - p0);
  const m2 = 0.5 * (p3 - p1);
  const yLin = h00 * p1 + h10 * m1 + h01 * p2 + h11 * m2;
  const d0 = p1 - p0;
  const d1 = p2 - p1;
  const yMin = p1 + t * d1 + 0.5 * t * (t - 1.0) * (0.85 * d0 + 0.15 * d1);
  const y = 0.35 * yLin + 0.65 * yMin;
  return Math.max(-1.0, Math.min(1.0, y));
}

// Hermite weight tables for exact unit-fraction step sizes (44.1k -> DSD64/128/256/512:
// invRatio = 1/64, 1/128, 1/256, 1/512 - all exact binary fractions). The interpolation
// phase t then cycles through exactly `period` values; the table stores the identical
// Float64 weights the inline Hermite code computes (same operation order), so using the
// table is bit-identical while removing ~15 flops per output sample per channel.
// Cached per period: weights depend only on period.
const HERMITE_TABS = new Map();
function getHermiteTab(period) {
  let tab = HERMITE_TABS.get(period);
  if (tab) return tab;
  tab = new Float64Array(period * 4);
  for (let k = 0; k < period; k++) {
    const t = k / period;
    const t2 = t * t, t3 = t2 * t;
    const o = k << 2;
    tab[o] = 2 * t3 - 3 * t2 + 1;
    tab[o + 1] = t3 - 2 * t2 + t;
    tab[o + 2] = -2 * t3 + 3 * t2;
    tab[o + 3] = t3 - t2;
  }
  HERMITE_TABS.set(period, tab);
  return tab;
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

// ---------------------------------------------------------------------------
// 泛用最小相位轉換（複倒數譜折疊）：把由 tapFn(t)（t = 整數輸出樣本）定義的
// 對稱線性相位 FIR 轉換為因果最小相位濾波器。截斷 budget 與 FFT 工作長度慣例
// 與 buildGaussFilter 完全相同（gauss-min 即以此實作，輸出逐 bit 不變）。
// ---------------------------------------------------------------------------
function minimumPhaseFromTapFn(fsOut, srcRate, L, S, tapFn) {
  const ratio = fsOut / srcRate;
  const integerRatio = Math.abs(ratio - Math.round(ratio)) < 1e-9;
  // 截斷 budget：長尾對音訊無貢獻（DSD64 實測 1200 taps 與全長規格相同）。
  // 但 FFT 工作長度 M 必須容納「真實」最小相位尾巴（~3.5ms × fsOut 的冪律長尾，
  // 約為 budget 的 8 倍）：若 M 太小，尾部繞回負時間會污染折疊，產生延遲濾波器。
  const budget = Math.min(2500, Math.max(64, Math.round(fsOut * 4.3e-4)));
  let M = 4096;
  while (M < 2.2 * fsOut * 3.5e-3 || M < 4 * (2 * L + 1)) M *= 2;
  if (M > 65536) M = 65536; // 繞回污染於此深度約 -115dB，對音訊無影響
  const re = new Float64Array(M), im = new Float64Array(M);
  for (let t = -L; t <= L; t++) { const v = tapFn(t); if (t < 0) re[M + t] = v; else re[t] = v; }
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

  // 最小相位變體：複倒數譜折疊轉換（慣例見 minimumPhaseFromTapFn）
  return minimumPhaseFromTapFn(fsOut, srcRate, L, S, gaussTap);
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
//
// kaiserSincFir 為泛用化設計原語（供濾波器插件使用）；
// buildPolyExt2Filter / buildHqpPsExt2Filter 為其固定參數特化（輸出與泛用化
// 之前逐 bit 相同）。
// ---------------------------------------------------------------------------
function kaiserSincFir(fsOut, srcRate, opts) {
  const AS_DB = opts.asDb;
  const fc = Math.min(opts.fcFactor * srcRate / 2, 0.45 * fsOut);
  const trans = opts.transFactor * srcRate;
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

// poly-ext2 特化：As 140dB、截止 1.27×源Nyquist、過渡寬 0.136×srcRate
function buildPolyExt2Filter(fsOut, srcRate) {
  return kaiserSincFir(fsOut, srcRate, { asDb: 140, fcFactor: 1.27, transFactor: 0.136 });
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
  return kaiserSincFir(fsOut, srcRate, { asDb: 180, fcFactor: 1.135, transFactor: 0.135 });
}

// ---------------------------------------------------------------------------
// 泛用 windowed-sinc FIR 設計原語（供濾波器插件與使用者自訂濾波使用）：
//   cutoffRel = 截止 / 源Nyquist（可 >1，extended 性格；上限 0.45·fsOut）
//   taps      = 半寬 L（輸出樣本單位）
//   window    = 'hann' | 'hamming' | 'blackman' | 'blackmanHarris' | 'kaiser'(需 asDb)
// sincWindowTapFn 回傳未正規化的 tap 函數與網格參數（可餵給 minimumPhaseFromTapFn）；
// windowedSincFir 增益正規化與子樣本网格慣例與內建 FIR 完全相同（Σh = ratio·S）。
// ---------------------------------------------------------------------------
function sincWindowTapFn(fsOut, srcRate, opts) {
  const fc = Math.min((opts.cutoffRel || 1.135) * srcRate / 2, 0.45 * fsOut);
  const L = Math.max(8, Math.round(opts.taps || 64));
  const ratio = fsOut / srcRate;
  const integerRatio = Math.abs(ratio - Math.round(ratio)) < 1e-9;
  const S = integerRatio ? 1 : 8;

  // 餘弦窗以 u = t/L ∈ [-1,1] 定義（半週期衰減，邊界歸零；與 Kaiser 的 u 慣例一致）
  const winFns = {
    hann: (u) => 0.5 + 0.5 * Math.cos(Math.PI * u),
    hamming: (u) => 0.54 + 0.46 * Math.cos(Math.PI * u),
    blackman: (u) => 0.42 + 0.5 * Math.cos(Math.PI * u) + 0.08 * Math.cos(2 * Math.PI * u),
    blackmanHarris: (u) => 0.35872 + 0.48804 * Math.cos(Math.PI * u) + 0.14124 * Math.cos(2 * Math.PI * u) + 0.010564 * Math.cos(3 * Math.PI * u)
  };
  const wName = opts.window || 'blackmanHarris';
  let winFn;
  if (wName === 'kaiser') {
    const asDb = opts.asDb || 100;
    const beta = 0.1102 * (asDb - 8.7);
    const i0b = besselI0(beta);
    winFn = (u) => besselI0(beta * Math.sqrt(Math.max(0, 1 - u * u))) / i0b;
  } else {
    winFn = winFns[wName] || winFns.blackmanHarris;
  }

  const tapFn = (t) => {
    if (Math.abs(t) > L) return 0;
    const x = 2 * fc * t / fsOut;
    const s = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    return (2 * fc / fsOut) * s * winFn(t / L);
  };
  return { tapFn, L, S, fc, ratio, integerRatio, window: wName };
}

function windowedSincFir(fsOut, srcRate, opts) {
  const w = sincWindowTapFn(fsOut, srcRate, opts);
  const { tapFn, L, S, ratio, integerRatio } = w;

  const half = L * S;
  const n = 2 * half + 2; // +1 guard tap（與內建 FIR 相同慣例）
  const h = new Float64Array(n);
  for (let j = -half; j <= half; j++) h[j + half] = tapFn(j / S);
  let sum = 0;
  for (let i = 0; i < n - 1; i++) sum += h[i];
  const g = ratio * S / sum;
  for (let i = 0; i < n; i++) h[i] *= g;
  return { h, S, lo: -L, hi: L, ratio, integerRatio, fsOut, srcRate, minimumPhase: false, taps: 2 * half + 1 };
}

// ---------------------------------------------------------------------------
// 濾波器插件註冊表（Filter Plugin Registry）
//
// 插件位置：filter-plugins/*.js（與本檔同目錄；啟動時自動掃描註冊，worker 行程亦然）
// 每個插件自帶描述卡：
//   { id, label, sound, kind: 'fir' | 'interp', builtin?, design?, sample?, dsdSafe? }
//   kind 'fir'   : design(fsOut, srcRate, kernel) 必須回傳 { h, S, lo, hi, ratio,
//                  integerRatio, fsOut, srcRate, minimumPhase, taps }
//                  （由 firSample / buildFirPhases 多相執行；kernel = 設計工具箱）
//   kind 'interp': builtin 內建走 interpolateSample；自訂插件提供
//                  sample(p0, p1, p2, p3, t) 回傳插值樣本
// 同名 id 的插件檔案會覆寫內建設計（供實驗性替換）。
// ---------------------------------------------------------------------------
const path = require('path');
const fs = require('fs');

const FILTER_REGISTRY = new Map();

// 提供給插件 design() 的設計工具箱（插件不需要 require 本檔）
const FILTER_TOOLBOX = {
  gaussSincFir: buildGaussFilter,
  kaiserSincFir,
  windowedSincFir,
  sincWindowTapFn,
  minimumPhaseFromTapFn,
  besselI0,
  fftRun
};

function registerFilterPlugin(desc) {
  if (!desc || typeof desc.id !== 'string' || !desc.id || typeof desc.label !== 'string' || !desc.label) return false;
  const kind = desc.kind === 'fir' ? 'fir' : (desc.kind === 'interp' ? 'interp' : null);
  if (!kind) return false;
  if (kind === 'fir' && typeof desc.design !== 'function') return false;
  if (kind === 'interp' && desc.builtin !== true && typeof desc.sample !== 'function') return false;
  FILTER_REGISTRY.set(desc.id, {
    id: desc.id,
    label: desc.label,
    sound: typeof desc.sound === 'string' ? desc.sound : '',
    kind,
    builtin: desc.builtin === true,
    dsdSafe: desc.dsdSafe !== false,
    design: typeof desc.design === 'function' ? desc.design : null,
    sample: typeof desc.sample === 'function' ? desc.sample : null
  });
  return true;
}

// 給 UI 的序列化描述（不含函數，可安全經 IPC 傳遞）
function listFilterPlugins() {
  return [...FILTER_REGISTRY.values()].map(p => ({ id: p.id, label: p.label, sound: p.sound, kind: p.kind, builtin: p.builtin, dsdSafe: p.dsdSafe }));
}

function getFilterPlugin(id) { return FILTER_REGISTRY.get(id) || null; }
function isValidFilterPhase(id) { return FILTER_REGISTRY.has(id); }

// 依相位 id 建立 FIR 濾波係數（非 FIR 插件 / 未知 id → null，呼叫端退回內插路徑）
function buildFilterForPhase(fsOut, srcRate, phaseId) {
  const p = FILTER_REGISTRY.get(phaseId);
  if (!p || p.kind !== 'fir' || typeof p.design !== 'function') return null;
  let gf;
  try { gf = p.design(fsOut, srcRate, FILTER_TOOLBOX); } catch (e) { return null; }
  if (!gf || !(gf.h instanceof Float64Array) || gf.h.length < 2) return null;
  if (!Number.isInteger(gf.S) || gf.S < 1 || gf.S > 64) return null;
  if (!Number.isInteger(gf.lo) || !Number.isInteger(gf.hi) || gf.hi < gf.lo) return null;
  if (!Number.isFinite(gf.h[0]) || !Number.isFinite(gf.h[gf.h.length - 1])) return null;
  return gf;
}

// 自訂內插插件的取樣函數（內建 linear/minimum/intermediate 回傳 null，
// 呼叫端維持 interpolateSample 熱路徑零開銷）
function resolveInterpFn(phaseId) {
  const p = FILTER_REGISTRY.get(phaseId);
  if (!p || p.kind !== 'interp' || p.builtin) return null;
  return p.sample || null;
}

// 掃描插件目錄並註冊；回傳 { loaded, failed }（單一檔案損毀不影響其他插件）
function loadFilterPlugins(dirOverride) {
  const dirPath = dirOverride || path.join(__dirname, 'filter-plugins');
  let names = [];
  try { names = fs.readdirSync(dirPath).filter(f => f.endsWith('.js')).sort(); } catch (e) { return { loaded: 0, failed: [] }; }
  let loaded = 0;
  const failed = [];
  for (const name of names) {
    try {
      const mod = require(path.join(dirPath, name));
      if (registerFilterPlugin(mod)) loaded++; else failed.push(name);
    } catch (e) { failed.push(name); }
  }
  return { loaded, failed };
}

// 安全網：插件目錄缺失/全毀時，核心內建的最小註冊（保證 'linear' 一定可用）
function registerCoreFallbackFilters() {
  registerFilterPlugin({ id: 'linear', label: '線性相位 (零相位失真)', sound: '零相位失真，定位精準', kind: 'interp', builtin: true });
  registerFilterPlugin({ id: 'minimum', label: '最小相位 (零預響鈴)', sound: '零預響鈴，打擊瞬態凌厲爆發', kind: 'interp', builtin: true });
  registerFilterPlugin({ id: 'intermediate', label: '混和 / 緩衰減 (溫潤類比)', sound: '極低預響鈴與自然高頻緩衰，溫潤類比聽感', kind: 'interp', builtin: true });
  registerFilterPlugin({ id: 'gauss-long', label: '高斯長脈衝 FIR (極低鈴振)', sound: '通帶平坦、極低鈴振與鏡像能量', kind: 'fir', design: (fo, sr, k) => k.gaussSincFir(fo, sr, false) });
  registerFilterPlugin({ id: 'gauss-min', label: '高斯最小相位 FIR (零預響鈴)', sound: '預響鈴嚴格為零、瞬態凌厲（些微後衝）', kind: 'fir', design: (fo, sr, k) => k.gaussSincFir(fo, sr, true) });
  registerFilterPlugin({ id: 'poly-ext2', label: 'EXT2 近似 FIR (超寬過渡帶)', sound: '通帶完全平坦無漣波、高頻延伸自然；22k 以上有些許鏡像泄漏（不可聽）', kind: 'fir', design: (fo, sr, k) => k.kaiserSincFir(fo, sr, { asDb: 140, fcFactor: 1.27, transFactor: 0.136 }) });
  registerFilterPlugin({ id: 'hqp-ps-ext2', label: 'PS-EXT2 直譯 FIR (陡峭滾降+極深止帶)', sound: '陡峭滾降、極深止帶；鏡像泄漏僅在超聲頻（不可聽）', kind: 'fir', design: (fo, sr, k) => k.kaiserSincFir(fo, sr, { asDb: 180, fcFactor: 1.135, transFactor: 0.135 }) });
}

// ---------------------------------------------------------------------------
// 使用者自訂濾波槽（User Filter Slots）
// 工具箱 UI 只產生純參數 JSON（不執行任何使用者程式碼）；這裡做全部驗證與夾限，
// 任何異常回傳 null → 該槽不註冊 → 選取它的設定自動退回線性相位。
// 槽 id 固定為 uf-1..uf-6（與 PEQ 儲存槽相同的 6 槽慣例）。
// ---------------------------------------------------------------------------
const USER_FILTER_WINDOWS = ['hann', 'hamming', 'blackman', 'blackmanHarris', 'kaiser'];
const USER_FILTER_LIMITS = { cutoffMin: 0.8, cutoffMax: 1.35, tapsMin: 16, tapsMax: 512, asMin: 40, asMax: 180 };

function validateUserFilterSpec(spec) {
  if (!spec || typeof spec !== 'object') return null;
  if (typeof spec.id !== 'string' || !/^uf-[1-6]$/.test(spec.id)) return null;
  const name = typeof spec.name === 'string' ? spec.name.trim().slice(0, 40) : '';
  if (!name) return null;
  const sound = typeof spec.sound === 'string' ? spec.sound.trim().slice(0, 80) : '';
  const window = USER_FILTER_WINDOWS.includes(spec.window) ? spec.window : null;
  if (!window) return null;
  const phase = spec.phase === 'minimum' ? 'minimum' : 'linear';
  const num = (v, dflt) => (typeof v === 'number' && Number.isFinite(v) ? v : dflt);
  const cutoffRel = Math.min(USER_FILTER_LIMITS.cutoffMax, Math.max(USER_FILTER_LIMITS.cutoffMin, num(spec.cutoffRel, 1.135)));
  const taps = Math.round(Math.min(USER_FILTER_LIMITS.tapsMax, Math.max(USER_FILTER_LIMITS.tapsMin, num(spec.taps, 96))));
  const asDb = Math.round(Math.min(USER_FILTER_LIMITS.asMax, Math.max(USER_FILTER_LIMITS.asMin, num(spec.asDb, 100))));
  return { id: spec.id, name, sound, window, phase, cutoffRel, taps, asDb };
}

function userFilterSpecToDescriptor(spec) {
  const v = validateUserFilterSpec(spec);
  if (!v) return null;
  return {
    id: v.id,
    label: '🔧 ' + v.name,
    sound: v.sound || '使用者自訂濾波器',
    kind: 'fir',
    builtin: false,
    design(fsOut, srcRate, kernel) {
      const Lcap = Math.floor(150e6 / srcRate / 2); // 引擎成本上限（同內建 FIR 慣例）
      const L = Math.max(8, Math.min(v.taps, Lcap > 0 ? Lcap : v.taps));
      const w = kernel.sincWindowTapFn(fsOut, srcRate, { cutoffRel: v.cutoffRel, L, window: v.window, asDb: v.asDb });
      if (!w) return null;
      if (v.phase === 'minimum') return kernel.minimumPhaseFromTapFn(fsOut, srcRate, L, w.S, w.tapFn);
      return kernel.windowedSincFir(fsOut, srcRate, { cutoffRel: v.cutoffRel, taps: L, window: v.window, asDb: v.asDb });
    }
  };
}

function unregisterFilterPlugin(id) {
  if (typeof id === 'string' && FILTER_REGISTRY.has(id)) FILTER_REGISTRY.delete(id);
}

// 從 JSON 檔載入槽位：{ version: 1, slots: [spec, ...] }；無效條目跳過。
function loadUserFilterSpecs(filePath) {
  let data;
  try { data = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (e) { return { loaded: 0, failed: [] }; }
  const slots = data && Array.isArray(data.slots) ? data.slots : [];
  let loaded = 0;
  const failed = [];
  for (const s of slots) {
    const d = userFilterSpecToDescriptor(s);
    if (d) { registerFilterPlugin(d); loaded++; } else if (s && s.id) failed.push(String(s.id));
  }
  return { loaded, failed };
}

// 槽位存檔後重載：移除全部 uf-* 再從檔案重建（主行程即時生效；新 worker 自行載入）。
function reloadUserFilters() {
  for (const id of [...FILTER_REGISTRY.keys()]) {
    if (id.startsWith('uf-')) FILTER_REGISTRY.delete(id);
  }
  if (process.env.ROOPLAYER_USER_FILTERS) return loadUserFilterSpecs(process.env.ROOPLAYER_USER_FILTERS);
  return { loaded: 0, failed: [] };
}

// 頻率響應預覽：回傳 { xs(Hz), ysDb }（0..min(fsOut/2, 1.6×源Nyquist)，-120dB 底）。
function previewUserFilterSpec(spec, srcRate, fsOut) {
  const d = userFilterSpecToDescriptor(spec);
  if (!d) return null;
  let gf;
  try { gf = d.design(fsOut, srcRate, FILTER_TOOLBOX); } catch (e) { return null; }
  if (!gf) return null;
  const N = 512;
  const fMax = Math.min(fsOut / 2, 1.15 * srcRate); // 完整顯示鏡像帶（源取樣率 ± 截止）
  const h = gf.h, S = gf.S, norm = gf.ratio * S;
  const xs = new Array(N), ysDb = new Array(N);
  for (let i = 0; i < N; i++) {
    const f = fMax * i / (N - 1);
    const w = 2 * Math.PI * f / (fsOut * S);
    let re = 0, im = 0;
    for (let j = 0; j < h.length; j++) {
      const a = h[j];
      if (a === 0) continue;
      const ang = w * j;
      re += a * Math.cos(ang);
      im -= a * Math.sin(ang);
    }
    const mag = Math.hypot(re, im) / norm;
    xs[i] = f;
    ysDb[i] = Math.max(-120, 20 * Math.log10(Math.max(mag, 1e-7)));
  }
  return { xs, ysDb, srcNyq: srcRate / 2, fsOut };
}

loadFilterPlugins();
if (!FILTER_REGISTRY.has('linear')) registerCoreFallbackFilters();
// 使用者自訂濾波槽（工具箱 UI 建立，主行程存檔；worker 經環境變數同一路徑載入）
if (process.env.ROOPLAYER_USER_FILTERS) loadUserFilterSpecs(process.env.ROOPLAYER_USER_FILTERS);

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
// Input upsampling: phase id 由濾波器插件註冊表解析（見上方 Filter Plugin Registry）。
// 內建：Linear / Minimum / Intermediate Hermite 內插；gauss-long / gauss-min /
// poly-ext2 / hqp-ps-ext2 FIR（設計見 buildGaussFilter / kaiserSincFir）。
// FIR 相位需要 buildFilterForPhase() 建立的係數；缺失時退回線性 Hermite。
//
// Stateful: internal integrator state persists across processBlocks() calls,
// so one instance can drive both whole-file encoding and progressive batch encoding
// with bit-identical output.
class DsdModulator {
  constructor(dsdOrder = 5, filterPhase = 'linear', gaussFilter = null) {
    this.order = [2, 5, 7].includes(parseInt(dsdOrder, 10)) ? parseInt(dsdOrder, 10) : 5;
    const plugin = FILTER_REGISTRY.get(filterPhase) || null;
    let phase = plugin ? filterPhase : 'linear';
    let useFir = !!(plugin && plugin.kind === 'fir');
    // FIR 插件需要 buildFilterForPhase() 提供的係數；缺失時退回線性 Hermite
    if (useFir && !gaussFilter) { phase = 'linear'; useFir = false; }
    this.phase = phase;
    this.useFir = useFir;
    this.interpFn = (plugin && plugin.kind === 'interp' && plugin.builtin !== true) ? (plugin.sample || null) : null;
    this.gf = gaussFilter || null;

    // Modulator integrator states (per channel)
    this.s1L = 0; this.s2L = 0; this.s3L = 0; this.s4L = 0; this.s5L = 0; this.s6L = 0; this.s7L = 0;
    this.s1R = 0; this.s2R = 0; this.s3R = 0; this.s4R = 0; this.s5R = 0; this.s6R = 0; this.s7R = 0;
    this.yL = 0; this.yR = 0;
  }

  // Shared per-batch interpolation setup: resolved ONCE per batch (no per-sample phase
  // string comparisons, no generic dispatcher). For exact unit-fraction ratios the Hermite
  // weight table is used and the input index / phase are tracked incrementally
  // (bit-identical to pos = outIdx * invRatio; idx = pos | 0 for the exact powers of two
  // involved). For FIR phases the polyphase fast path is hoisted out of firSample (same
  // arithmetic, tables cached on the filter object).
  _interpCtx(invRatio) {
    const phase = this.phase;
    const useGauss = this.useFir;
    const interpFn = this.interpFn; // 自訂內插插件（內建相位為 null，熱路徑不變）
    const gf = this.gf;
    const ratio = 1 / invRatio;
    const mode = interpFn ? 3 : (phase === 'minimum' ? 1 : phase === 'intermediate' ? 2 : 0);
    let wTab = null, wPeriod = 0;
    if (!useGauss && mode === 0) {
      const period = Math.round(ratio);
      if (period >= 2 && period <= 8192 && (period & (period - 1)) === 0 && 1 / period === invRatio) {
        wPeriod = period;
        wTab = getHermiteTab(period);
      }
    }
    let fPhases = null, fP = 0, fQ = 0;
    if (useGauss && gf) {
      let ph = gf.phases;
      if (ph === undefined) ph = gf.phases = buildFirPhases(gf);
      if (ph) { fPhases = ph.phases; fP = ph.P; fQ = ph.Q; }
    }
    return { mode, useGauss, wTab, wPeriod, fPhases, fP, fQ, ratio, interpFn };
  }

  // Modulate output bit range [startBit, endBit) from normalized input Float32Arrays.
  // startBit / endBit must be multiples of DSD_SAMPLES_PER_BLOCK.
  // Returns a Buffer of numBlocks * 2 * DSD_BLOCK_SIZE bytes in DSF block-pair layout
  // (left block followed by right block for each block).
  // Optional outBuf: a caller-reused scratch buffer (>= needed size) to avoid per-batch
  // allocation churn / GC pauses in progressive worker loops. Ignored when too small.
  //
  // Per-order specialization: each run path is its own (much smaller) function. V8 tiers
  // small hot functions up to its optimizing compiler quickly; the previous single generic
  // mega-function (all three orders + all phases in one body) stayed at baseline tier for
  // the first seconds of every worker thread - the startup chunk ran at 0.3-0.5x while the
  // steady state ran at 1.0-1.3x. Bit-identical: the run paths contain the same statements.
  processBlocks(left, right, inLen, startBit, endBit, invRatio, outBuf) {
    const numBlocks = Math.round((endBit - startBit) / DSD_SAMPLES_PER_BLOCK);
    if (numBlocks <= 0) return Buffer.alloc(0);
    const needBytes = numBlocks * 2 * DSD_BLOCK_SIZE;
    const out = (outBuf && outBuf.length >= needBytes) ? outBuf : Buffer.allocUnsafe(needBytes);
    if (this.order === 2) return this.runBlocks2(left, right, inLen, startBit, numBlocks, invRatio, out);
    if (this.order === 7) return this.runBlocks7(left, right, inLen, startBit, numBlocks, invRatio, out);
    return this.runBlocks5(left, right, inLen, startBit, numBlocks, invRatio, out);
  }

  runBlocks5(left, right, inLen, startBit, numBlocks, invRatio, out) {
    const blockSize = DSD_BLOCK_SIZE;
    const samplesPerBlock = DSD_SAMPLES_PER_BLOCK;
    const ctx = this._interpCtx(invRatio);
    const mode = ctx.mode, useGauss = ctx.useGauss, wTab = ctx.wTab, wPeriod = ctx.wPeriod, fPhases = ctx.fPhases, fP = ctx.fP, fQ = ctx.fQ, ratio = ctx.ratio, interpFn = ctx.interpFn;
    const gf = this.gf;

    // Hot-path hoisting: resolve coefficient table lookups once per batch, not per bit.
    const c1 = CIFFR_5.c1, c2 = CIFFR_5.c2, c3 = CIFFR_5.c3, c4 = CIFFR_5.c4, c5 = CIFFR_5.c5;
    const g1 = CIFFR_5.g1, g2 = CIFFR_5.g2, a1 = CIFFR_5.a1, a2 = CIFFR_5.a2, a4 = CIFFR_5.a4, scale = CIFFR_5.scale;
    const CLAMP = CIFFR_CLAMP;

    // Load persistent state into hot locals
    let s1_L = this.s1L, s2_L = this.s2L, s3_L = this.s3L, s4_L = this.s4L, s5_L = this.s5L, y_L = this.yL;
    let s1_R = this.s1R, s2_R = this.s2R, s3_R = this.s3R, s4_R = this.s4R, s5_R = this.s5R, y_R = this.yR;

    let curIdx = 0, curPhi = 0;
    if (wTab) {
      curIdx = Math.floor(startBit / wPeriod);
      curPhi = startBit - curIdx * wPeriod;
    }

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
            // Poly-Sinc-Gauss / polyphase FIR fast path, hoisted from firSample
            // (identical arithmetic; phase tables cached on the filter object).
            let done = false;
            if (fPhases) {
              const phi = outIdx % fP;
              const entry = fPhases[phi];
              if (entry) {
                const kBase = entry.k0 + Math.floor(outIdx / fP) * fQ;
                const T = entry.T;
                if (kBase >= 0 && kBase + T <= inLen) {
                  const G = entry.G;
                  let accL = 0, accR = 0;
                  for (let j = 0; j < T; j++) { const k = kBase + j; accL += left[k] * G[j]; accR += right[k] * G[j]; }
                  rawL = accL; rawR = accR;
                  done = true;
                }
              }
            }
            if (!done) {
              rawL = firSample(left, inLen, outIdx, ratio, gf);
              rawR = firSample(right, inLen, outIdx, ratio, gf);
            }
          } else if (wTab) {
            // Exact unit-fraction ratio (44.1k -> DSD64/128/256/512): input index and
            // interpolation phase tracked incrementally; Hermite weights from the table.
            // Bit-identical to the generic path for the exact binary fractions involved.
            const idx = curIdx;
            const o = curPhi << 2;
            curPhi++; if (curPhi === wPeriod) { curPhi = 0; curIdx++; }

            const p1L = idx < inLen ? left[idx] : 0;
            const p2L = idx < inLen - 1 ? left[idx + 1] : p1L;
            const p0L = idx > 0 ? left[idx - 1] : left[0];
            const p3L = idx < inLen - 2 ? left[idx + 2] : p2L;
            const yL = wTab[o] * p1L + wTab[o + 1] * (0.5 * (p2L - p0L)) + wTab[o + 2] * p2L + wTab[o + 3] * (0.5 * (p3L - p1L));
            rawL = Math.max(-1.0, Math.min(1.0, yL));

            const p1R = idx < inLen ? right[idx] : 0;
            const p2R = idx < inLen - 1 ? right[idx + 1] : p1R;
            const p0R = idx > 0 ? right[idx - 1] : right[0];
            const p3R = idx < inLen - 2 ? right[idx + 2] : p2R;
            const yR = wTab[o] * p1R + wTab[o + 1] * (0.5 * (p2R - p0R)) + wTab[o + 2] * p2R + wTab[o + 3] * (0.5 * (p3R - p1R));
            rawR = Math.max(-1.0, Math.min(1.0, yR));
          } else {
            const pos = outIdx * invRatio;
            const idx = pos | 0;
            const t = pos - idx;

            const p0L = idx > 0 ? left[idx - 1] : left[0];
            const p1L = idx < inLen ? left[idx] : 0;
            const p2L = idx < inLen - 1 ? left[idx + 1] : p1L;
            const p3L = idx < inLen - 2 ? left[idx + 2] : p2L;
            rawL = mode === 3 ? interpFn(p0L, p1L, p2L, p3L, t)
                 : mode === 1 ? interpolateMinimum(p0L, p1L, p2L, p3L, t)
                 : mode === 2 ? interpolateIntermediate(p0L, p1L, p2L, p3L, t)
                 : interpolateLinear(p0L, p1L, p2L, p3L, t);

            const p0R = idx > 0 ? right[idx - 1] : right[0];
            const p1R = idx < inLen ? right[idx] : 0;
            const p2R = idx < inLen - 1 ? right[idx + 1] : p1R;
            const p3R = idx < inLen - 2 ? right[idx + 2] : p2R;
            rawR = mode === 3 ? interpFn(p0R, p1R, p2R, p3R, t)
                 : mode === 1 ? interpolateMinimum(p0R, p1R, p2R, p3R, t)
                 : mode === 2 ? interpolateIntermediate(p0R, p1R, p2R, p3R, t)
                 : interpolateLinear(p0R, p1R, p2R, p3R, t);
          }

          {
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
            byteValL = (byteValL << 1) | (y_L > 0 ? 1 : 0); // DSF spec: MSB-first

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
            byteValR = (byteValR << 1) | (y_R > 0 ? 1 : 0); // DSF spec: MSB-first
          }
        }

        out[leftOff + byteIdx] = byteValL;
        out[rightOff + byteIdx] = byteValR;
      }
    }

    // Persist state back for the next batch
    this.s1L = s1_L; this.s2L = s2_L; this.s3L = s3_L; this.s4L = s4_L; this.s5L = s5_L; this.yL = y_L;
    this.s1R = s1_R; this.s2R = s2_R; this.s3R = s3_R; this.s4R = s4_R; this.s5R = s5_R; this.yR = y_R;

    return out;
  }

  runBlocks2(left, right, inLen, startBit, numBlocks, invRatio, out) {
    const blockSize = DSD_BLOCK_SIZE;
    const samplesPerBlock = DSD_SAMPLES_PER_BLOCK;
    const ctx = this._interpCtx(invRatio);
    const mode = ctx.mode, useGauss = ctx.useGauss, wTab = ctx.wTab, wPeriod = ctx.wPeriod, fPhases = ctx.fPhases, fP = ctx.fP, fQ = ctx.fQ, ratio = ctx.ratio, interpFn = ctx.interpFn;
    const gf = this.gf;

    // Load persistent state into hot locals
    let s1_L = this.s1L, s2_L = this.s2L, y_L = this.yL;
    let s1_R = this.s1R, s2_R = this.s2R, y_R = this.yR;

    let curIdx = 0, curPhi = 0;
    if (wTab) {
      curIdx = Math.floor(startBit / wPeriod);
      curPhi = startBit - curIdx * wPeriod;
    }

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
            let done = false;
            if (fPhases) {
              const phi = outIdx % fP;
              const entry = fPhases[phi];
              if (entry) {
                const kBase = entry.k0 + Math.floor(outIdx / fP) * fQ;
                const T = entry.T;
                if (kBase >= 0 && kBase + T <= inLen) {
                  const G = entry.G;
                  let accL = 0, accR = 0;
                  for (let j = 0; j < T; j++) { const k = kBase + j; accL += left[k] * G[j]; accR += right[k] * G[j]; }
                  rawL = accL; rawR = accR;
                  done = true;
                }
              }
            }
            if (!done) {
              rawL = firSample(left, inLen, outIdx, ratio, gf);
              rawR = firSample(right, inLen, outIdx, ratio, gf);
            }
          } else if (wTab) {
            const idx = curIdx;
            const o = curPhi << 2;
            curPhi++; if (curPhi === wPeriod) { curPhi = 0; curIdx++; }

            const p1L = idx < inLen ? left[idx] : 0;
            const p2L = idx < inLen - 1 ? left[idx + 1] : p1L;
            const p0L = idx > 0 ? left[idx - 1] : left[0];
            const p3L = idx < inLen - 2 ? left[idx + 2] : p2L;
            const yL = wTab[o] * p1L + wTab[o + 1] * (0.5 * (p2L - p0L)) + wTab[o + 2] * p2L + wTab[o + 3] * (0.5 * (p3L - p1L));
            rawL = Math.max(-1.0, Math.min(1.0, yL));

            const p1R = idx < inLen ? right[idx] : 0;
            const p2R = idx < inLen - 1 ? right[idx + 1] : p1R;
            const p0R = idx > 0 ? right[idx - 1] : right[0];
            const p3R = idx < inLen - 2 ? right[idx + 2] : p2R;
            const yR = wTab[o] * p1R + wTab[o + 1] * (0.5 * (p2R - p0R)) + wTab[o + 2] * p2R + wTab[o + 3] * (0.5 * (p3R - p1R));
            rawR = Math.max(-1.0, Math.min(1.0, yR));
          } else {
            const pos = outIdx * invRatio;
            const idx = pos | 0;
            const t = pos - idx;

            const p0L = idx > 0 ? left[idx - 1] : left[0];
            const p1L = idx < inLen ? left[idx] : 0;
            const p2L = idx < inLen - 1 ? left[idx + 1] : p1L;
            const p3L = idx < inLen - 2 ? left[idx + 2] : p2L;
            rawL = mode === 3 ? interpFn(p0L, p1L, p2L, p3L, t)
                 : mode === 1 ? interpolateMinimum(p0L, p1L, p2L, p3L, t)
                 : mode === 2 ? interpolateIntermediate(p0L, p1L, p2L, p3L, t)
                 : interpolateLinear(p0L, p1L, p2L, p3L, t);

            const p0R = idx > 0 ? right[idx - 1] : right[0];
            const p1R = idx < inLen ? right[idx] : 0;
            const p2R = idx < inLen - 1 ? right[idx + 1] : p1R;
            const p3R = idx < inLen - 2 ? right[idx + 2] : p2R;
            rawR = mode === 3 ? interpFn(p0R, p1R, p2R, p3R, t)
                 : mode === 1 ? interpolateMinimum(p0R, p1R, p2R, p3R, t)
                 : mode === 2 ? interpolateIntermediate(p0R, p1R, p2R, p3R, t)
                 : interpolateLinear(p0R, p1R, p2R, p3R, t);
          }

          {
            // 2nd-Order Boser-Wooley SDM with Anti-Windup Clamping
            const uL = rawL * 0.75;
            s1_L += uL - y_L;
            if (s1_L > 3.0) s1_L = 3.0; else if (s1_L < -3.0) s1_L = -3.0;
            s2_L += s1_L - 0.5 * y_L;
            if (s2_L > 3.0) s2_L = 3.0; else if (s2_L < -3.0) s2_L = -3.0;
            y_L = (s2_L >= 0) ? 1.0 : -1.0;
            byteValL = (byteValL << 1) | (y_L > 0 ? 1 : 0); // DSF spec: MSB-first

            const uR = rawR * 0.75;
            s1_R += uR - y_R;
            if (s1_R > 3.0) s1_R = 3.0; else if (s1_R < -3.0) s1_R = -3.0;
            s2_R += s1_R - 0.5 * y_R;
            if (s2_R > 3.0) s2_R = 3.0; else if (s2_R < -3.0) s2_R = -3.0;
            y_R = (s2_R >= 0) ? 1.0 : -1.0;
            byteValR = (byteValR << 1) | (y_R > 0 ? 1 : 0); // DSF spec: MSB-first
          }
        }

        out[leftOff + byteIdx] = byteValL;
        out[rightOff + byteIdx] = byteValR;
      }
    }

    // Persist state back for the next batch
    this.s1L = s1_L; this.s2L = s2_L; this.yL = y_L;
    this.s1R = s1_R; this.s2R = s2_R; this.yR = y_R;

    return out;
  }

  runBlocks7(left, right, inLen, startBit, numBlocks, invRatio, out) {
    const blockSize = DSD_BLOCK_SIZE;
    const samplesPerBlock = DSD_SAMPLES_PER_BLOCK;
    const ctx = this._interpCtx(invRatio);
    const mode = ctx.mode, useGauss = ctx.useGauss, wTab = ctx.wTab, wPeriod = ctx.wPeriod, fPhases = ctx.fPhases, fP = ctx.fP, fQ = ctx.fQ, ratio = ctx.ratio, interpFn = ctx.interpFn;
    const gf = this.gf;

    // Hot-path hoisting: resolve coefficient table lookups once per batch, not per bit.
    const c1 = CIFFR_7.c1, c2 = CIFFR_7.c2, c3 = CIFFR_7.c3, c4 = CIFFR_7.c4, c5 = CIFFR_7.c5, c6 = CIFFR_7.c6, c7 = CIFFR_7.c7;
    const g1 = CIFFR_7.g1, g2 = CIFFR_7.g2, g3 = CIFFR_7.g3, a1 = CIFFR_7.a1, a2 = CIFFR_7.a2, a4 = CIFFR_7.a4, a6 = CIFFR_7.a6, scale = CIFFR_7.scale;
    const CLAMP = CIFFR_CLAMP;

    // Load persistent state into hot locals
    let s1_L = this.s1L, s2_L = this.s2L, s3_L = this.s3L, s4_L = this.s4L, s5_L = this.s5L, s6_L = this.s6L, s7_L = this.s7L, y_L = this.yL;
    let s1_R = this.s1R, s2_R = this.s2R, s3_R = this.s3R, s4_R = this.s4R, s5_R = this.s5R, s6_R = this.s6R, s7_R = this.s7R, y_R = this.yR;

    let curIdx = 0, curPhi = 0;
    if (wTab) {
      curIdx = Math.floor(startBit / wPeriod);
      curPhi = startBit - curIdx * wPeriod;
    }

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
            let done = false;
            if (fPhases) {
              const phi = outIdx % fP;
              const entry = fPhases[phi];
              if (entry) {
                const kBase = entry.k0 + Math.floor(outIdx / fP) * fQ;
                const T = entry.T;
                if (kBase >= 0 && kBase + T <= inLen) {
                  const G = entry.G;
                  let accL = 0, accR = 0;
                  for (let j = 0; j < T; j++) { const k = kBase + j; accL += left[k] * G[j]; accR += right[k] * G[j]; }
                  rawL = accL; rawR = accR;
                  done = true;
                }
              }
            }
            if (!done) {
              rawL = firSample(left, inLen, outIdx, ratio, gf);
              rawR = firSample(right, inLen, outIdx, ratio, gf);
            }
          } else if (wTab) {
            const idx = curIdx;
            const o = curPhi << 2;
            curPhi++; if (curPhi === wPeriod) { curPhi = 0; curIdx++; }

            const p1L = idx < inLen ? left[idx] : 0;
            const p2L = idx < inLen - 1 ? left[idx + 1] : p1L;
            const p0L = idx > 0 ? left[idx - 1] : left[0];
            const p3L = idx < inLen - 2 ? left[idx + 2] : p2L;
            const yL = wTab[o] * p1L + wTab[o + 1] * (0.5 * (p2L - p0L)) + wTab[o + 2] * p2L + wTab[o + 3] * (0.5 * (p3L - p1L));
            rawL = Math.max(-1.0, Math.min(1.0, yL));

            const p1R = idx < inLen ? right[idx] : 0;
            const p2R = idx < inLen - 1 ? right[idx + 1] : p1R;
            const p0R = idx > 0 ? right[idx - 1] : right[0];
            const p3R = idx < inLen - 2 ? right[idx + 2] : p2R;
            const yR = wTab[o] * p1R + wTab[o + 1] * (0.5 * (p2R - p0R)) + wTab[o + 2] * p2R + wTab[o + 3] * (0.5 * (p3R - p1R));
            rawR = Math.max(-1.0, Math.min(1.0, yR));
          } else {
            const pos = outIdx * invRatio;
            const idx = pos | 0;
            const t = pos - idx;

            const p0L = idx > 0 ? left[idx - 1] : left[0];
            const p1L = idx < inLen ? left[idx] : 0;
            const p2L = idx < inLen - 1 ? left[idx + 1] : p1L;
            const p3L = idx < inLen - 2 ? left[idx + 2] : p2L;
            rawL = mode === 3 ? interpFn(p0L, p1L, p2L, p3L, t)
                 : mode === 1 ? interpolateMinimum(p0L, p1L, p2L, p3L, t)
                 : mode === 2 ? interpolateIntermediate(p0L, p1L, p2L, p3L, t)
                 : interpolateLinear(p0L, p1L, p2L, p3L, t);

            const p0R = idx > 0 ? right[idx - 1] : right[0];
            const p1R = idx < inLen ? right[idx] : 0;
            const p2R = idx < inLen - 1 ? right[idx + 1] : p1R;
            const p3R = idx < inLen - 2 ? right[idx + 2] : p2R;
            rawR = mode === 3 ? interpFn(p0R, p1R, p2R, p3R, t)
                 : mode === 1 ? interpolateMinimum(p0R, p1R, p2R, p3R, t)
                 : mode === 2 ? interpolateIntermediate(p0R, p1R, p2R, p3R, t)
                 : interpolateLinear(p0R, p1R, p2R, p3R, t);
          }

          {
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
            byteValL = (byteValL << 1) | (y_L > 0 ? 1 : 0); // DSF spec: MSB-first

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
            byteValR = (byteValR << 1) | (y_R > 0 ? 1 : 0); // DSF spec: MSB-first
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

// ---------------------------------------------------------------------------
// Parametric Equalizer (PEQ) - cascaded biquad IIR filters (RBJ cookbook form)
//
// Applied in the PCM domain BEFORE upsampling/modulation output packing, at the
// processing sample rate of each path (source rate in DSD workers, target rate
// in PCM sessions, 88.2k in decimate sessions). Biquads are minimum-phase IIR
// (no pre-ringing) - the standard parametric-EQ behaviour.
//
// Headroom: any positive band gain lowers the whole chain by (maxBoost + 0.5 dB)
// pre-gain so boosted material can never clip the 24-bit / ±1 modulator path.
// ---------------------------------------------------------------------------
function biquadCoeffs(type, fs, f0, gainDb, Q) {
  const w0 = 2 * Math.PI * f0 / fs;
  const c = Math.cos(w0), s = Math.sin(w0);
  if (!(s > 0)) return null; // f0 must be strictly inside (0, Nyquist)
  const alpha = s / (2 * Q);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'lowpass') {
    b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2;
    a0 = 1 + alpha; a1 = -2 * c; a2 = 1 - alpha;
  } else if (type === 'highpass') {
    b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2;
    a0 = 1 + alpha; a1 = -2 * c; a2 = 1 - alpha;
  } else if (type === 'notch') {
    b0 = 1; b1 = -2 * c; b2 = 1;
    a0 = 1 + alpha; a1 = -2 * c; a2 = 1 - alpha;
  } else if (type === 'peaking') {
    const A = Math.pow(10, gainDb / 20); // peak gain at f0 = A (verified numerically)
    b0 = 1 + alpha * A; b1 = -2 * c; b2 = 1 - alpha * A;
    a0 = 1 + alpha; a1 = -2 * c; a2 = 1 - alpha;
  } else if (type === 'lowshelf' || type === 'highshelf') {
    // Second-order shelves derived here: analog Butterworth-shelf prototype
    //   lowshelf:  H(s) = (s^2 + (sqrt(G)/Q)s + G) / (s^2 + (1/Q)s + 1)   (omega0 normalized to 1)
    //   highshelf: H(s) = (G*s^2 + (sqrt(G)/Q)s + 1) / (s^2 + (1/Q)s + 1)
    // bilinear-transformed with prewarp K = 1/tan(pi*f0/fs) (bilinear maps analog corner 1 to
    // exactly f0 with this choice). Asymptotic gains are EXACT:
    // lowshelf DC gain = G = 10^(dB/20) with 0 dB at HF; highshelf the mirror. Q controls
    // the transition sharpness (Q = 0.707 gives the maximally-flat Butterworth slope).
    const G = Math.pow(10, gainDb / 20);
    const K = 1 / Math.tan(Math.PI * f0 / fs);
    if (!(K > 0) || !isFinite(K)) return null;
    const den0 = K * K + K / Q + 1;
    const sqG = Math.sqrt(G);
    if (type === 'lowshelf') {
      b0 = K * K + K * sqG / Q + G;
      b1 = 2 * (G - K * K);
      b2 = K * K - K * sqG / Q + G;
      a0 = den0;
      a1 = 2 * (1 - K * K);
      a2 = K * K - K / Q + 1;
    } else {
      b0 = G * K * K + K * sqG / Q + 1;
      b1 = 2 * (1 - G * K * K);
      b2 = G * K * K - K * sqG / Q + 1;
      a0 = den0;
      a1 = 2 * (1 - K * K);
      a2 = K * K - K / Q + 1;
    }
  } else {
    return null;
  }
  return { type, f0, b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

// Build a PEQ chain from renderer options: { enabled, bands: [{on,type,freq,gain,q}] }.
// Returns null when nothing is active (callers then skip the stage entirely - bit-perfect).
function createPeqChain(fs, peqOptions) {
  if (!peqOptions || !peqOptions.enabled || !Array.isArray(peqOptions.bands)) return null;
  const bands = [];
  let maxBoost = 0;
  for (const b of peqOptions.bands) {
    if (!b || !b.on) continue;
    const type = String(b.type || 'peaking');
    const f0 = Math.min(Math.max(Number(b.freq) || 100, 20), Math.min(20000, fs * 0.45));
    const Q = Math.min(Math.max(Number(b.q) || 0.7, 0.3), 8);
    const gainDb = Math.min(Math.max(Number(b.gain) || 0, -18), 18);
    const coeffs = biquadCoeffs(type, fs, f0, gainDb, Q);
    if (!coeffs) continue;
    bands.push(coeffs);
    if (type === 'peaking' || type === 'lowshelf' || type === 'highshelf') maxBoost = Math.max(maxBoost, gainDb);
  }
  if (!bands.length) return null;
  const headroomDb = Math.max(0, maxBoost) + 0.5;
  return { fs, bands, preGain: Math.pow(10, -headroomDb / 20), headroomDb };
}

// Transposed Direct-Form II state (numerically stable, per channel per band).
function createPeqState(chain) {
  const n = chain.bands.length;
  return { l1: new Float64Array(n), l2: new Float64Array(n), r1: new Float64Array(n), r2: new Float64Array(n), out: new Float64Array(2) };
}

// Process one stereo sample pair through the chain. Returns chain-independent scratch [L, R].
function processPeqPair(chain, st, xL, xR) {
  let l = xL * chain.preGain;
  let r = xR * chain.preGain;
  const bands = chain.bands;
  for (let i = 0; i < bands.length; i++) {
    const b = bands[i];
    let y = b.b0 * l + st.l1[i];
    st.l1[i] = b.b1 * l - b.a1 * y + st.l2[i];
    st.l2[i] = b.b2 * l - b.a2 * y;
    l = y;
    y = b.b0 * r + st.r1[i];
    st.r1[i] = b.b1 * r - b.a1 * y + st.r2[i];
    st.r2[i] = b.b2 * r - b.a2 * y;
    r = y;
  }
  st.out[0] = l;
  st.out[1] = r;
  return st.out;
}

// Whole-array convenience pass (used by DSD workers on their view slice, decimate
// sessions, and the spectrum window). Fresh state: caller-provided warm-up regions
// cover the (fast-decaying) biquad transients.
function applyPeqArrays(chain, inL, inR, outL, outR, len) {
  const n = Math.min(len === undefined ? inL.length : len, inL.length, inR.length, outL.length, outR.length);
  const st = createPeqState(chain);
  for (let i = 0; i < n; i++) {
    const o = processPeqPair(chain, st, inL[i], inR[i]);
    outL[i] = o[0];
    outR[i] = o[1];
  }
  return n;
}

// ---------------------------------------------------------------------------
// 卷積濾波器（IR 脈衝響應，Roon 風格）：分割式頻域卷積（partitioned overlap-save）。
// FFT 尺寸 N = 4096，區塊 B = N/2 = 2048；IR 切成每段 ≤ B taps 的分割（k=0 為最新 taps）。
// 每個輸入區塊：X_n = FFT([前 B 樣本 | 現行 B 樣本]) 存入環形緩衝，
// 輸出區塊 n = lastB( IFFT( Σ_{k=0..K-1} X_{n-k} · H_k ) )。
// 每區塊成本：1 次 FFT + K 次頻譜乘加 + 1 次 IFFT（與 IR 長度無關的線性 K）。
// 群延遲恆定 = B 樣本（線性相位不受影響）；無累加器、無近似。
// ---------------------------------------------------------------------------
const CONV_FFT_SIZE = 4096;
const CONV_BLOCK_SIZE = CONV_FFT_SIZE / 2;
const CONV_MAX_IR_TAPS = 262144; // ~5.9s @44.1k / 1.4s @192k 上限，超出自動截尾

function nextPow2(n) { let p = 1; while (p < n) p <<= 1; return p; }

// IR 的頻率響應峰值 max|H(f)|（用於防削頭正規化與 UI 資訊）
function irResponsePeak(ir) {
  const taps = Math.min(ir.length, CONV_MAX_IR_TAPS);
  if (taps <= 0) return 0;
  const n = nextPow2(Math.max(2, taps));
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < taps; i++) re[i] = ir[i];
  fftRun(re, im, false);
  let peak = 0;
  for (let i = 0; i <= n / 2; i++) {
    const m = Math.hypot(re[i], im[i]);
    if (m > peak) peak = m;
  }
  return peak;
}

function buildConvPartitions(ir) {
  const N = CONV_FFT_SIZE, B = CONV_BLOCK_SIZE;
  const taps = Math.min(ir.length, CONV_MAX_IR_TAPS);
  if (taps <= 0) return null;
  const K = Math.ceil(taps / B);
  const parts = new Array(K);
  for (let k = 0; k < K; k++) {
    const re = new Float64Array(N), im = new Float64Array(N);
    const start = k * B, len = Math.min(B, taps - start);
    for (let i = 0; i < len; i++) re[i] = ir[start + i];
    fftRun(re, im, false);
    parts[k] = { re, im };
  }
  return parts;
}

function createConvolutionState(fs, irL, irR) {
  if (!fs || !irL || !irL.length || !irR || !irR.length) return null;
  const partsL = buildConvPartitions(irL);
  const partsR = buildConvPartitions(irR);
  if (!partsL || !partsR) return null;
  const K = Math.max(partsL.length, partsR.length);
  const N = CONV_FFT_SIZE, B = CONV_BLOCK_SIZE;
  const mkChannel = (parts) => {
    const padded = parts.slice();
    while (padded.length < K) padded.push({ re: new Float64Array(N), im: new Float64Array(N) });
    return {
      parts: padded,
      ring: Array.from({ length: K }, () => ({ re: new Float64Array(N), im: new Float64Array(N) })),
      ringPos: 0,
      window: new Float64Array(2 * B), // [前 B | 現行 B]
      fillCount: 0,
      out: new Float64Array(B),
      outPos: 0,
      outLen: 0,
      xRe: new Float64Array(N),
      xIm: new Float64Array(N)
    };
  };
  return { fs, K, L: mkChannel(partsL), R: mkChannel(partsR), yRe: new Float64Array(N), yIm: new Float64Array(N) };
}

function convProcessBlock(st, ch) {
  const N = CONV_FFT_SIZE, B = CONV_BLOCK_SIZE;
  const xRe = ch.xRe, xIm = ch.xIm;
  xRe.set(ch.window);
  xIm.fill(0);
  fftRun(xRe, xIm, false);
  const slot = ch.ring[ch.ringPos];
  slot.re.set(xRe);
  slot.im.set(xIm);
  ch.ringPos = (ch.ringPos + 1) % st.K;

  const yRe = st.yRe, yIm = st.yIm;
  yRe.fill(0);
  yIm.fill(0);
  for (let k = 0; k < st.K; k++) {
    const X = ch.ring[(ch.ringPos - 1 - k + 2 * st.K) % st.K];
    const H = ch.parts[k];
    const xr = X.re, xi = X.im, hr = H.re, hi = H.im;
    for (let i = 0; i < N; i++) {
      const a = xr[i], b = xi[i];
      yRe[i] += a * hr[i] - b * hi[i];
      yIm[i] += a * hi[i] + b * hr[i];
    }
  }
  fftRun(yRe, yIm, true);

  // overlap-save 有效輸出 = 後 B 個樣本 = 區塊 n 的完整卷積輸出
  for (let i = 0; i < B; i++) ch.out[i] = yRe[B + i];
  ch.outPos = 0;
  ch.outLen = B;

  ch.window.copyWithin(0, B); // 前 B ← 現行 B（下一區塊的重疊區）
}

function processConvolutionPair(st, xL, xR) {
  const B = CONV_BLOCK_SIZE;
  st.L.window[B + st.L.fillCount] = xL;
  st.R.window[B + st.R.fillCount] = xR;
  st.L.fillCount++;
  st.R.fillCount++;
  if (st.L.fillCount === B) {
    convProcessBlock(st, st.L);
    convProcessBlock(st, st.R);
    st.L.fillCount = 0;
    st.R.fillCount = 0;
  }
  let oL = 0, oR = 0;
  if (st.L.outPos < st.L.outLen) oL = st.L.out[st.L.outPos++];
  if (st.R.outPos < st.R.outLen) oR = st.R.out[st.R.outPos++];
  return [oL, oR];
}

// Whole-array convenience pass (decimate sessions / spectrum windows). Fresh state:
// the first B samples are the inherent block latency; the final IR tail past the
// window end is truncated by the caller's fixed output length (same as PEQ sessions).
function applyConvolutionArrays(st, inL, inR, outL, outR, len) {
  const n = Math.min(len === undefined ? inL.length : len, inL.length, inR.length, outL.length, outR.length);
  for (let i = 0; i < n; i++) {
    const o = processConvolutionPair(st, inL[i], inR[i]);
    outL[i] = o[0];
    outR[i] = o[1];
  }
  return n;
}

module.exports = {
  interpolateSample,
  buildGaussFilter,
  buildPolyExt2Filter,
  buildHqpPsExt2Filter,
  kaiserSincFir,
  windowedSincFir,
  sincWindowTapFn,
  minimumPhaseFromTapFn,
  registerFilterPlugin,
  listFilterPlugins,
  getFilterPlugin,
  isValidFilterPhase,
  buildFilterForPhase,
  resolveInterpFn,
  loadFilterPlugins,
  unregisterFilterPlugin,
  validateUserFilterSpec,
  userFilterSpecToDescriptor,
  loadUserFilterSpecs,
  reloadUserFilters,
  previewUserFilterSpec,
  USER_FILTER_WINDOWS,
  USER_FILTER_LIMITS,
  firSample,
  getDsdRate,
  buildDsfHeader,
  DsdModulator,
  DSD_BLOCK_SIZE,
  DSD_SAMPLES_PER_BLOCK,
  biquadCoeffs,
  createPeqChain,
  createPeqState,
  processPeqPair,
  applyPeqArrays,
  CONV_FFT_SIZE,
  CONV_BLOCK_SIZE,
  CONV_MAX_IR_TAPS,
  irResponsePeak,
  createConvolutionState,
  processConvolutionPair,
  applyConvolutionArrays
};
