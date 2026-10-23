'use strict';
// ==========================================
// 濾波插件：HQPlayer poly-sinc-gauss-long (511 Taps)
// 依據 HQPlayer 6 REA 深度逆向工程分析成果精確重構：
//   - 官方標籤：poly-sinc-gauss-long (5/5 transients, timbre, space)
//   - 幾何結構：每相 511 Taps (lengthClass = 2: 0x1FF)
//   - 形狀常數：1 - 6 * (512.5 / 44100) = 0.9302721088435374
//   - 過渡頻寬：3075 Hz * (srcRate / 44100)
//   - 高斯窗參數：σ_rel = 0.125
//   - 直流歸一化：多相分支和嚴格 Bit-Perfect = 1.0 (Σh = ratio · S)
// ==========================================

module.exports = {
  id: 'poly-sinc-gauss-long',
  label: 'HQPlayer 逆向：poly-sinc-gauss-long (511 Taps)',
  sound: 'HQPlayer 官方 5/5 滿分旗艦濾波器：每相 511 Taps，極致瞬態還原、真實音色與宏大空間感',
  kind: 'fir',
  design(fsOut, srcRate, kernel) {
    return kernel.buildHqPolySincGaussLongFilter(fsOut, srcRate);
  }
};
