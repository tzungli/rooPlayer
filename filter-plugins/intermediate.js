'use strict';
// 內建濾波插件：混和 / 緩衰減（線性 35% + 最小相位 65% 混合）
module.exports = {
  id: 'intermediate',
  label: '混和 / 緩衰減 (溫潤類比)',
  sound: '極低預響鈴與自然高頻緩衰，溫潤類比聽感',
  kind: 'interp',
  builtin: true
};
