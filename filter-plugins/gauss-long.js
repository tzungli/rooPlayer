'use strict';
// 內建濾波插件：Poly-Sinc-Gauss Long FIR（線性相位，設計見 dsp-kernel.js buildGaussFilter）
module.exports = {
  id: 'gauss-long',
  label: '高斯長脈衝 FIR (極低鈴振)',
  sound: '通帶平坦、極低鈴振與鏡像能量',
  kind: 'fir',
  design(fsOut, srcRate, kernel) {
    return kernel.gaussSincFir(fsOut, srcRate, false);
  }
};
