'use strict';
// 內建濾波插件：EXT2 近似 FIR（Kaiser 窗 sinc，As 140dB，截止 1.27×源Nyquist，
// 設計見 dsp-kernel.js kaiserSincFir / buildPolyExt2Filter）
module.exports = {
  id: 'poly-ext2',
  label: 'EXT2 近似 FIR (超寬過渡帶)',
  sound: '通帶完全平坦無漣波、高頻延伸自然；22k 以上有些許鏡像泄漏（不可聽）',
  kind: 'fir',
  design(fsOut, srcRate, kernel) {
    return kernel.kaiserSincFir(fsOut, srcRate, { asDb: 140, fcFactor: 1.27, transFactor: 0.136 });
  }
};
