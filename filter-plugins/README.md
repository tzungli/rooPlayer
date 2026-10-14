# rooPlayer 濾波器插件（filter-plugins/）

每個 `.js` 檔案就是一個濾波器插件。啟動時引擎（dsp-kernel.js）自動掃描本目錄並註冊；
升頻設定頁的濾波器按鈕與滑鼠提示由插件描述卡自動生成——新增濾波器只需在此放一個檔案，
引擎核心、UI、DLNA、播放路徑完全不需要任何修改。

## 描述卡格式

```js
'use strict';
module.exports = {
  id: 'my-filter',                 // 唯一識別碼（設定檔儲存用；小寫英文/數字/連字號）
  label: '我的濾波器 (特色)',      // 按鈕顯示文字
  sound: '聲音特色一句描述',       // 滑鼠提示（只寫聽感特色）
  kind: 'fir',                    // 'fir' = 提供濾波係數 / 'interp' = 提供逐樣本內插函數
  dsdSafe: true,                  // 選填，預設 true：是否適用於 DSD 調變路徑

  // kind:'fir' 必要 —— 設計濾波係數（每次建立播放工作階段時呼叫一次）：
  //   fsOut = 輸出取樣率, srcRate = 來源取樣率, kernel = 設計工具箱
  //   必須回傳 { h, S, lo, hi, ratio, integerRatio, fsOut, srcRate, minimumPhase, taps }
  design(fsOut, srcRate, kernel) {
    // 例：Blackman-Harris 窗 sinc，截止 1.15×源 Nyquist、半寬 96 taps：
    return kernel.windowedSincFir(fsOut, srcRate, {
      cutoffRel: 1.15,
      taps: 96,
      window: 'blackmanHarris'
    });
    // 其他工具箱原語：
    //   kernel.kaiserSincFir(fsOut, srcRate, { asDb, fcFactor, transFactor })
    //   kernel.gaussSincFir(fsOut, srcRate, minimumPhase)
    //   kernel.besselI0(x), kernel.fftRun(re, im, inv)
  }

  // kind:'interp' 自訂插件必要 —— 逐樣本內插（熱路徑，保持極簡）：
  // sample(p0, p1, p2, p3, t) { return p1 + t * (p2 - p1); }
};
```

## 規則
- `id` 重複時，後載入者覆寫（可用插件檔案覆寫內建設計做實驗）。
- 單一檔案語法錯誤或描述卡不合格式：自動跳過，不影響其他濾波器。
- FIR 係數上限慣例：脈衝半寬建議 ≤ 150e6 / srcRate / 2（引擎成本上限 ~150 MMAC/s/聲道）。
- 內建七種濾波器的完整設計在 `dsp-kernel.js`（本目錄的內建插件檔只是薄殼）。
- 新增濾波器後重新啟動程式即出現在設定頁；移除或損毀時設定自動退回線性相位。
