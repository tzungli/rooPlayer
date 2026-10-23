'use strict';
// ==========================================
// 濾波插件：poly-sinc-gauss-long (511 Taps)
// 旗艦高斯多相 FIR 濾波器：
//   - 幾何結構：每相 511 Taps (半寬 255 跨度)
//   - 形狀常數：1 - 6 * (512.5 / 44100) = 0.9302721088435374
//   - 過渡頻寬：3075 Hz * (srcRate / 44100)
//   - 高斯窗參數：σ_rel = 0.125
//   - 直流歸一化：多相分支和嚴格 Bit-Perfect = 1.0 (Σh = ratio · S)
// ==========================================

module.exports = {
  id: 'poly-sinc-gauss-long',
  label: 'poly-sinc-gauss-long (511 Taps)',
  sound: '旗艦級高斯多相 FIR：每相 511 Taps，極致瞬態還原、真實音色與宏大空間感',
  kind: 'fir',
  design(fsOut, srcRate, kernel) {
    return kernel.buildHqPolySincGaussLongFilter(fsOut, srcRate);
  }
};
