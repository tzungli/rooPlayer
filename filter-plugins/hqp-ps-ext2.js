'use strict';
// 內建濾波插件：PS-EXT2 直譯 FIR（Kaiser 窗 sinc，As 180dB，過渡帶自源 Nyquist 起始，
// 設計見 dsp-kernel.js kaiserSincFir / buildHqpPsExt2Filter）
module.exports = {
  id: 'hqp-ps-ext2',
  label: 'PS-EXT2 直譯 FIR (陡峭滾降+極深止帶)',
  sound: '陡峭滾降、極深止帶；鏡像泄漏僅在超聲頻（不可聽）',
  kind: 'fir',
  design(fsOut, srcRate, kernel) {
    return kernel.kaiserSincFir(fsOut, srcRate, { asDb: 180, fcFactor: 1.135, transFactor: 0.135 });
  }
};
