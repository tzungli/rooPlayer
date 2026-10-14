'use strict';
// 內建濾波插件：高斯最小相位 FIR（零預響鈴，設計見 dsp-kernel.js buildGaussFilter minimumPhase）
module.exports = {
  id: 'gauss-min',
  label: '高斯最小相位 FIR (零預響鈴)',
  sound: '預響鈴嚴格為零、瞬態凌厲（些微後衝）',
  kind: 'fir',
  design(fsOut, srcRate, kernel) {
    return kernel.gaussSincFir(fsOut, srcRate, true);
  }
};
