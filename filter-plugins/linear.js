'use strict';
// 內建濾波插件：線性相位（Hermite 三次內插，零相位失真）
module.exports = {
  id: 'linear',
  label: '線性相位 (零相位失真)',
  sound: '零相位失真，定位精準',
  kind: 'interp',
  builtin: true
};
