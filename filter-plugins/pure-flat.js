'use strict';
// 內建濾波插件：純真還原 FIR (Bit-Perfect 極平坦)
// 特性：通帶 0~21.5kHz 絕對平坦（漣波 < 0.0001 dB），止帶衰減 -160 dB，
// 線性相位零染色，100% 完整還原錄音室母帶聲音原貌。
module.exports = {
  id: 'pure-flat',
  label: '純真還原 FIR (極致平坦)',
  sound: '通帶 0~21.5kHz 絕對平坦（漣波 < 0.0001dB），零染色純淨還原，呈現錄音室母帶真實原貌',
  kind: 'fir',
  design(fsOut, srcRate, kernel) {
    return kernel.kaiserSincFir(fsOut, srcRate, { asDb: 160, fcFactor: 1.07, transFactor: 0.095 });
  }
};
