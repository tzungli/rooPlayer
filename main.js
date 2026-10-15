const { app, BrowserWindow, ipcMain, dialog, protocol, net, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pathToFileURL, fileURLToPath } = require('url');
const http = require('http');

// Increase V8 maximum heap limit to 4GB to handle large audiophile libraries smoothly
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096');

// Global error handlers to prevent silent process termination
process.on('uncaughtException', (err) => {
  console.error('[rooplayer] Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[rooplayer] Unhandled Rejection:', reason);
});

// 使用者自訂濾波槽儲存路徑：必須在任何 dsp-kernel 載入前設定（主行程與 DSP worker 共用；
// worker_threads 繼承 process.env，worker 內的 dsp-kernel 啟動時自動載入同一份槽位）。
// 截圖模式（--capture）改用暫存 userData：不碰使用者真實設定、空庫自動顯示 demo 展示。
const CAPTURE_MODE = process.argv.includes('--capture');
const TEST_VERSIONS = process.argv.includes('--test-versions'); // 執行期測試「其他版本」匹配邏輯
const TEST_EXCLUSIVE = process.argv.includes('--test-exclusive'); // 執行期測試 WASAPI 獨佔輸出端到端流程
const TEST_LABELS = process.argv.includes('--test-labels'); // 執行期測試發行公司（RECORD LABEL）頁面
const TEST_KKBOX_MATCH = process.argv.includes('--test-kkbox-match'); // 執行期測試 KKBOX 清單的本機 / TIDAL 比對欄位
const TEST_RECOMMEND = process.argv.includes('--test-recommend'); // 執行期測試專輯頁「同類型推薦專輯」關聯評分
const TEST_UF_LAYOUT = process.argv.includes('--test-uf-layout'); // 執行期測試自訂濾波器編輯器的左右配置
const TEST_QUEUE_CONTRAST = process.argv.includes('--test-queue-contrast'); // 執行期測試播放佇列在淺色／深色的文字對比度
const TEST_SPECTRUM_SMOOTH = process.argv.includes('--test-spectrum-smooth'); // 執行期測試 NOW PLAYING 頻譜的播放位置是否連續推進
const TEST_DLNA_HINT = process.argv.includes('--test-dlna-hint'); // 執行期測試 DLNA 串流準備（記憶體緩衝）提示與重複按播放的保護
const FAKE_DLNA_PORT = 49152; // 測試用假 UPnP MediaRenderer _listen port（probeIp 的候選位址之一）
if (CAPTURE_MODE || TEST_VERSIONS || TEST_EXCLUSIVE || TEST_LABELS || TEST_KKBOX_MATCH || TEST_RECOMMEND || TEST_UF_LAYOUT || TEST_QUEUE_CONTRAST || TEST_SPECTRUM_SMOOTH || TEST_DLNA_HINT) {
  // 關鍵：關閉 Chromium 原生遮擋偵測。否則背景視窗被判定 occluded 而暫停合成，
  // capturePage 會一直回傳同一張舊框架（三張截圖 hash 相同的根因）。
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
  const capDir = path.join(require('os').tmpdir(), 'rooplayer-capture-userdata');
  try { fs.mkdirSync(capDir, { recursive: true }); } catch (e) {}
  app.setPath('userData', capDir);
}
process.env.ROOPLAYER_USER_FILTERS = path.join(app.getPath('userData'), 'rooplayer_user_filters.json');
const CAPTURE_DEMO_IR = CAPTURE_MODE ? path.join(app.getPath('userData'), 'demo-concert-hall-ir.wav') : null;
const EXCLUSIVE_TEST_FIXTURE = path.join(app.getPath('userData'), 'exclusive-test-tone.wav');

const nativeAudioEngine = require('./native-audio-engine');
const nativeDspStreamer = require('./native-dsp-streamer');
const mm = require('music-metadata');

// Native DSD duration fallback (pure JS DSF / DFF header parsing, no external processes)
function getDurationWithNativeHeader(filePath) {
  try {
    const dsf = nativeAudioEngine.parseDsf(filePath);
    if (dsf && dsf.dsdRate > 0) return Math.round(dsf.sampleCount / dsf.dsdRate);
  } catch (e) {}
  try {
    const dff = nativeAudioEngine.parseDff(filePath);
    if (dff && dff.dsdRate > 0) return Math.round(dff.sampleCount / dff.dsdRate);
  } catch (e) {}
  return 0;
}

const DlnaManager = require('./dlna-manager');
let dlnaManager = null;
let fakeDlnaRenderer = null; // --test-dlna-hint 用的假 MediaRenderer（tools/fake-dlna-renderer.js）

// ==========================================================
// WASAPI 獨佔輸出（Windows 內建 csc 編譯的 tools/rp-wasapi-exclusive.cs）
// 引擎串流（/sox-stream、/dsd-stream）直接由 helper 以 Range 讀取，
// 引擎本身不需要任何輸出格式改動；獨佔失敗一律由渲染端退回共享模式。
// ==========================================================
const ExclusiveOutput = require('./exclusive-output');
let exclusiveOutput = null;
function getExclusiveOutput() {
  if (!exclusiveOutput) {
    exclusiveOutput = new ExclusiveOutput(__dirname, path.join(app.getPath('userData'), 'exclusive-output'));
    exclusiveOutput.onEvent = (ev) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        try { mainWindow.webContents.send('exclusive:status', ev); } catch (e) {}
      }
    };
  }
  return exclusiveOutput;
}

// Optimize Chromium GPU rendering and process responsiveness for high-resolution audio processing
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

// Cover cache directory for lightweight, fast image handling (avoids storing huge base64 in JSON)
const COVER_CACHE_DIR = path.join(app.getPath('userData'), 'cover_cache');
if (!fs.existsSync(COVER_CACHE_DIR)) {
  try { fs.mkdirSync(COVER_CACHE_DIR, { recursive: true }); } catch (e) {}
}

function toMediaUrl(filePath) {
  if (!filePath) return null;
  try {
    return pathToFileURL(filePath).href;
  } catch (e) {
    const norm = filePath.replace(/\\/g, '/');
    return norm.startsWith('/') ? 'file://' + norm : 'file:///' + norm;
  }
}

function saveCoverPicture(picBuffer, format) {
  try {
    if (!picBuffer || picBuffer.length === 0) return null;
    const hash = crypto.createHash('md5').update(picBuffer).digest('hex');
    const ext = (format && format.includes('png')) ? 'png' : 'jpg';
    const filePath = path.join(COVER_CACHE_DIR, `${hash}.${ext}`);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, picBuffer);
    }
    return toMediaUrl(filePath);
  } catch (e) {
    console.warn('Failed to save cover picture:', e);
    return null;
  }
}

function sanitizeTrackCover(cover) {
  if (!cover || typeof cover !== 'string') return null;
  if (!cover.startsWith('data:image')) return cover;
  try {
    const match = cover.match(/^data:image\/([a-zA-Z0-9\+\-\.]+);base64,(.+)$/);
    if (!match) return null;
    const ext = match[1].includes('png') ? 'png' : 'jpg';
    const base64Data = match[2];
    const hash = crypto.createHash('md5').update(base64Data).digest('hex');
    const filePath = path.join(COVER_CACHE_DIR, `${hash}.${ext}`);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
    }
    return toMediaUrl(filePath);
  } catch (e) {
    console.warn('Failed to sanitize base64 cover:', e);
    return null;
  }
}

// Register custom media scheme for bit-perfect audio streaming from local drive
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true
    }
  }
]);

let mainWindow;
const LIBRARY_FILE = path.join(app.getPath('userData'), 'rooplayer_library.json');
const LEGACY_LIBRARY_FILE = path.join(app.getPath('userData'), 'roon_library.json');

// ----------------- 截圖模式（--capture）：自動擷取介面供 GitHub Pages 使用 -----------------
const CAPTURE_OUT_DIR = path.join(__dirname, 'docs', 'img');

// 示範 IR：合成小型音樂廳脈衝響應（PCM16 立體聲 WAV），供卷積卡片截圖展示
function writeDemoIrWav(filePath) {
  const sr = 44100, secs = 0.45, n = Math.round(sr * secs);
  const data = Buffer.alloc(n * 2 * 2); // stereo int16
  let rng = 12345;
  const rand = () => { rng = (rng * 1103515245 + 12345) & 0x7fffffff; return rng / 0x7fffffff * 2 - 1; };
  const reflections = [[0.011, 0.55], [0.017, 0.42], [0.023, 0.36], [0.031, 0.30], [0.047, 0.24], [0.067, 0.20]];
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let direct = i === 0 ? 1 : 0;
    for (const [dt, g] of reflections) { if (i === Math.round(dt * sr)) direct += g; }
    const tail = (i > sr * 0.02 ? rand() * Math.exp(-(t - 0.02) / 0.11) * 0.22 : 0);
    const l = Math.max(-1, Math.min(1, direct + tail));
    const r = Math.max(-1, Math.min(1, direct * 0.92 + tail * 0.96 + (i > sr * 0.025 ? rand() * Math.exp(-(t - 0.025) / 0.10) * 0.18 : 0)));
    data.writeInt16LE(Math.round(l * 24000), i * 4);
    data.writeInt16LE(Math.round(r * 24000), i * 4 + 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22); // PCM, stereo
  header.writeUInt32LE(sr, 24); header.writeUInt32LE(sr * 4, 28);
  header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(data.length, 40);
  fs.writeFileSync(filePath, Buffer.concat([header, data]));
}

// 獨佔輸出測試素材：6 秒 44.1kHz 24-bit 立體聲正弦 WAV（引擎原生解碼，不需外部依賴）
function writeExclusiveTestFixture(filePath, secs = 6) {
  const sr = 44100, n = Math.round(sr * secs);
  const data = Buffer.alloc(n * 6); // stereo s24le
  for (let i = 0; i < n; i++) {
    const l = Math.round(0.25 * 8388607 * Math.sin(2 * Math.PI * 440 * i / sr));
    const r = Math.round(0.25 * 8388607 * Math.sin(2 * Math.PI * 440 * i / sr + 0.2));
    data.writeIntLE(l, i * 6, 3);
    data.writeIntLE(r, i * 6 + 3, 3);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22); // PCM, stereo
  header.writeUInt32LE(sr, 24); header.writeUInt32LE(sr * 6, 28);
  header.writeUInt16LE(6, 32); header.writeUInt16LE(24, 34);
  header.write('data', 36); header.writeUInt32LE(data.length, 40);
  fs.writeFileSync(filePath, Buffer.concat([header, data]));
}

async function captureShot(name) {
  const img = await Promise.race([
    mainWindow.webContents.capturePage(),
    new Promise((_, rej) => setTimeout(() => rej(new Error('capturePage timeout')), 10000))
  ]);
  fs.mkdirSync(CAPTURE_OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(CAPTURE_OUT_DIR, name), img.toPNG());
  console.log('[capture] saved', name);
}

let captureStarted = false;
const captureSignals = {}; // n -> resolve（渲染器完成 UI 操作後經 capture:step IPC 回報）
ipcMain.on('capture:step', (event, n, info) => {
  console.log('[capture] renderer step signal:', n, info || '');
  if (captureSignals[n]) { captureSignals[n](info); captureSignals[n] = null; }
});

function runCaptureSequence() {
  if (captureStarted) return;
  captureStarted = true;
  console.log('[capture] sequence start');
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const waitRenderer = (n, ms) => Promise.race([
    new Promise((resolve) => { captureSignals[n] = resolve; }),
    sleep(ms).then(() => console.log('[capture] WARNING: renderer step', n, 'not signaled in time'))
  ]);
  // 取渲染端回報的內容（獨佔輸出自我測試把結果字串傳回來）
  const waitRendererInfo = (n, ms) => new Promise((resolve) => {
    captureSignals[n] = (info) => { captureSignals[n] = null; resolve(info === undefined ? '' : String(info)); };
    sleep(ms).then(() => { if (captureSignals[n]) { captureSignals[n] = null; resolve('TIMEOUT'); } });
  });
  (async () => {
    try {
      if (TEST_VERSIONS) {
        console.log('[test] waiting for renderer version-matching test result');
        await waitRenderer(9, 30000);
        console.log('[test] done');
        app.exit(0);
        return;
      }
      if (TEST_EXCLUSIVE) {
        console.log('[test-exclusive] waiting for renderer WASAPI-exclusive self-test result');
        const report = await waitRendererInfo(11, 120000);
        console.log('[test-exclusive] renderer report: ' + report);
        console.log('[test] done');
        app.exit(report.indexOf('PASS') === 0 ? 0 : 1);
        return;
      }
      if (TEST_LABELS) {
        console.log('[test-labels] waiting for renderer record-label page self-test result');
        // 渲染端在廠牌頁面渲染完成時先發 13（截取畫面），最後發 12（測試報告）
        const shotSignal = new Promise((resolve) => { captureSignals[13] = (info) => { captureSignals[13] = null; resolve(info); }; });
        const reportPromise = waitRendererInfo(12, 90000);
        const shotInfo = await shotSignal;
        try {
          const img = await mainWindow.webContents.capturePage();
          const shotPath = path.join(require('os').tmpdir(), 'rooplayer-capture-userdata', 'label-detail-test.png');
          fs.writeFileSync(shotPath, img.toPNG());
          console.log('[test-labels] screenshot saved: ' + shotPath + ' (' + shotInfo + ')');
        } catch (e) { console.warn('[test-labels] screenshot failed:', e); }
        const report = await reportPromise;
        console.log('[test-labels] renderer report: ' + report);
        console.log('[test] done');
        app.exit(report.indexOf('PASS') === 0 ? 0 : 1);
        return;
      }
      if (TEST_KKBOX_MATCH) {
        console.log('[test-kkbox-match] waiting for renderer KKBOX match-column self-test result');
        // 渲染端依序發：16（KKBOX 頁頭，帳號按鈕已反灰）→ 15（比對圖示顯示）→ 14（測試報告）
        const shotHeader = new Promise((resolve) => { captureSignals[16] = (info) => { captureSignals[16] = null; resolve(info); }; });
        const shotBadges = new Promise((resolve) => { captureSignals[15] = (info) => { captureSignals[15] = null; resolve(info); }; });
        const reportPromise = waitRendererInfo(14, 120000);
        const shotDir = path.join(require('os').tmpdir(), 'rooplayer-capture-userdata');
        const saveShot = async (fileName, info) => {
          try {
            const img = await mainWindow.webContents.capturePage();
            const shotPath = path.join(shotDir, fileName);
            fs.writeFileSync(shotPath, img.toPNG());
            console.log('[test-kkbox-match] screenshot saved: ' + shotPath + ' (' + info + ')');
          } catch (e) { console.warn('[test-kkbox-match] screenshot failed:', e); }
        };
        await saveShot('kkbox-login-disabled.png', await shotHeader);
        await saveShot('kkbox-match-test.png', await shotBadges);
        const report = await reportPromise;
        console.log('[test-kkbox-match] renderer report: ' + report);
        console.log('[test] done');
        app.exit(report.indexOf('PASS') === 0 ? 0 : 1);
        return;
      }
      if (TEST_RECOMMEND) {
        console.log('[test-recommend] waiting for renderer album-recommendation self-test result');
        // 渲染端先發 18（推薦卡片已渲染，截取畫面），最後發 17（測試報告）
        const shotSignal = new Promise((resolve) => { captureSignals[18] = (info) => { captureSignals[18] = null; resolve(info); }; });
        const reportPromise = waitRendererInfo(17, 120000);
        const shotInfo = await shotSignal;
        try {
          const img = await mainWindow.webContents.capturePage();
          const shotPath = path.join(require('os').tmpdir(), 'rooplayer-capture-userdata', 'recommend-test.png');
          fs.writeFileSync(shotPath, img.toPNG());
          console.log('[test-recommend] screenshot saved: ' + shotPath + ' (' + shotInfo + ')');
        } catch (e) { console.warn('[test-recommend] screenshot failed:', e); }
        const report = await reportPromise;
        console.log('[test-recommend] renderer report: ' + report);
        console.log('[test] done');
        app.exit(report.indexOf('PASS') === 0 ? 0 : 1);
        return;
      }
      if (TEST_UF_LAYOUT) {
        console.log('[test-uf-layout] waiting for renderer custom-filter editor layout self-test result');
        // 渲染端先發 19（左右配置已渲染，截取畫面），最後發 20（測試報告）
        const shotSignal = new Promise((resolve) => { captureSignals[19] = (info) => { captureSignals[19] = null; resolve(info); }; });
        const reportPromise = waitRendererInfo(20, 120000);
        const shotInfo = await shotSignal;
        try {
          const img = await mainWindow.webContents.capturePage();
          const shotPath = path.join(require('os').tmpdir(), 'rooplayer-capture-userdata', 'uf-layout-test.png');
          fs.writeFileSync(shotPath, img.toPNG());
          console.log('[test-uf-layout] screenshot saved: ' + shotPath + ' (' + shotInfo + ')');
        } catch (e) { console.warn('[test-uf-layout] screenshot failed:', e); }
        const report = await reportPromise;
        console.log('[test-uf-layout] renderer report: ' + report);
        console.log('[test] done');
        app.exit(report.indexOf('PASS') === 0 ? 0 : 1);
        return;
      }
      if (TEST_QUEUE_CONTRAST) {
        console.log('[test-queue-contrast] waiting for renderer queue contrast self-test result');
        // 渲染端先發 21（淺色佇列已渲染，截取畫面），最後發 22（測試報告）
        const shotSignal = new Promise((resolve) => { captureSignals[21] = (info) => { captureSignals[21] = null; resolve(info); }; });
        const reportPromise = waitRendererInfo(22, 120000);
        const shotInfo = await shotSignal;
        try {
          const img = await mainWindow.webContents.capturePage();
          const shotPath = path.join(require('os').tmpdir(), 'rooplayer-capture-userdata', 'queue-contrast-light.png');
          fs.writeFileSync(shotPath, img.toPNG());
          console.log('[test-queue-contrast] screenshot saved: ' + shotPath + ' (' + shotInfo + ')');
        } catch (e) { console.warn('[test-queue-contrast] screenshot failed:', e); }
        const report = await reportPromise;
        console.log('[test-queue-contrast] renderer report: ' + report);
        console.log('[test] done');
        app.exit(report.indexOf('PASS') === 0 ? 0 : 1);
        return;
      }
      if (TEST_SPECTRUM_SMOOTH) {
        console.log('[test-spectrum-smooth] waiting for renderer spectrum smoothness self-test result');
        // 渲染端先發 23（正在取頻譜窗，截取畫面），最後發 24（測試報告）
        const shotSignal = new Promise((resolve) => { captureSignals[23] = (info) => { captureSignals[23] = null; resolve(info); }; });
        const reportPromise = waitRendererInfo(24, 120000);
        const shotInfo = await shotSignal;
        try {
          const img = await mainWindow.webContents.capturePage();
          const shotPath = path.join(require('os').tmpdir(), 'rooplayer-capture-userdata', 'spectrum-smooth.png');
          fs.writeFileSync(shotPath, img.toPNG());
          console.log('[test-spectrum-smooth] screenshot saved: ' + shotPath + ' (' + shotInfo + ')');
        } catch (e) { console.warn('[test-spectrum-smooth] screenshot failed:', e); }
        const report = await reportPromise;
        console.log('[test-spectrum-smooth] renderer report: ' + report);
        console.log('[test] done');
        app.exit(report.indexOf('PASS') === 0 ? 0 : 1);
        return;
      }
      if (TEST_DLNA_HINT) {
        console.log('[test-dlna-hint] waiting for renderer DLNA prepare-hint self-test result');
        // 渲染端先發 25（提示正在顯示中，截取畫面），最後發 26（測試報告）
        const shotSignal = new Promise((resolve) => { captureSignals[25] = (info) => { captureSignals[25] = null; resolve(info); }; });
        const reportPromise = waitRendererInfo(26, 120000);
        const shotInfo = await shotSignal;
        try {
          const img = await mainWindow.webContents.capturePage();
          const shotPath = path.join(require('os').tmpdir(), 'rooplayer-capture-userdata', 'dlna-buffer-hint.png');
          fs.writeFileSync(shotPath, img.toPNG());
          console.log('[test-dlna-hint] screenshot saved: ' + shotPath + ' (' + shotInfo + ')');
        } catch (e) { console.warn('[test-dlna-hint] screenshot failed:', e); }
        const report = await reportPromise;
        console.log('[test-dlna-hint] renderer report: ' + report);
        console.log('[test] done');
        app.exit(report.indexOf('PASS') === 0 ? 0 : 1);
        return;
      }
      await sleep(4500); // 等 initApp / demo 展示渲染完成
      console.log('[capture] step 1: home');
      await captureShot('home.png');

      // 訊號路徑設定視窗：等渲染器自行開啟（?rpCapture=1 hook），再截
      console.log('[capture] step 2: signalpath (waiting renderer signal)');
      await waitRenderer(2, 25000);
      await sleep(900);
      await captureShot('signalpath.png');

      // 展開自訂濾波器工具箱編輯面板：等渲染器展開並設好示範參數，再截
      console.log('[capture] step 3: toolbox (waiting renderer signal)');
      await waitRenderer(3, 25000);
      await sleep(1600); // 等響應預覽 IPC 回傳並繪製
      await captureShot('toolbox.png');

      // PEQ 卡片（warm 預設曲線＋頻響繪製）
      console.log('[capture] step 4: peq (waiting renderer signal)');
      await waitRenderer(4, 25000);
      await sleep(1200); // 等 PEQ 曲線 canvas 重繪
      await captureShot('peq.png');

      // 卷積卡片（已載入示範 IR：合成音樂廳脈衝響應）
      console.log('[capture] step 5: conv (waiting renderer signal)');
      await waitRenderer(5, 25000);
      await sleep(1400); // 等 getIrInfo IPC 回傳並渲染
      await captureShot('conv.png');

      // TIDAL 與本機曲庫整合（首頁最近新增專輯混合呈現示範 TIDAL Hi-Res 專輯）
      console.log('[capture] step 6: tidal (waiting renderer signal)');
      await waitRenderer(6, 30000);
      await sleep(1200);
      await captureShot('tidal.png');

      // 藝人生活誌 Artist Spotlight（生平簡介載入完成後才截）
      console.log('[capture] step 7: spotlight (waiting renderer signal)');
      await waitRenderer(7, 45000);
      await sleep(1800); // 等照片與相關專輯卡片渲染
      await captureShot('spotlight.png');

      console.log('[capture] done');
    } catch (e) {
      console.error('[capture] failed:', e);
    }
    app.exit(0);
  })();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1040,
    minHeight: 680,
    backgroundColor: '#0f1013',
    icon: path.join(__dirname, 'icon.png'),
    frame: false, // Custom frameless titlebar
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false, // allow streaming local media
      webviewTag: true
    },
    show: false
  });

  // Configure KKBOX webview session to ensure Chrome User-Agent and smooth streaming
  try {
    const kkboxSession = session.fromPartition('persist:kkbox');
    const chromeUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
    kkboxSession.setUserAgent(chromeUA);
  } catch (e) {
    console.warn('Failed to configure kkboxSession:', e);
  }

  if (TEST_QUEUE_CONTRAST) {
    mainWindow.loadFile('index.html', { query: { testQueueContrast: '1' } });
  } else if (TEST_UF_LAYOUT) {
    mainWindow.loadFile('index.html', { query: { testUfLayout: '1' } });
  } else if (TEST_RECOMMEND) {
    // 不帶 rpCapture：截圖流程的 UI 自動化會開 modal / 注入示範專輯，干擾本測試的 DOM 斷言
    mainWindow.loadFile('index.html', { query: { testRecommend: '1' } });
  } else if (TEST_KKBOX_MATCH) {
    // 不帶 rpCapture：截圖流程的 UI 自動化會開 modal / 切換頁面，干擾 KKBOX 清單的 DOM 斷言
    mainWindow.loadFile('index.html', { query: { testKkboxMatch: '1' } });
  } else if (TEST_LABELS) {
    // 不帶 rpCapture：截圖流程的 UI 自動化會開 modal / 注入示範專輯，干擾本測試的 DOM 計數
    mainWindow.loadFile('index.html', { query: { testLabels: '1' } });
  } else if (TEST_DLNA_HINT) {
    try {
      writeExclusiveTestFixture(EXCLUSIVE_TEST_FIXTURE, 14);
      console.log('[test-dlna-hint] fixture written:', EXCLUSIVE_TEST_FIXTURE);
    } catch (e) { console.warn('[test-dlna-hint] fixture write failed:', e); }
    mainWindow.loadFile('index.html', { query: { testDlnaHint: '1', fakeDlnaPort: String(FAKE_DLNA_PORT), fixture: EXCLUSIVE_TEST_FIXTURE } });
  } else if (TEST_SPECTRUM_SMOOTH) {
    // 較長的測試音（14s）：本測試要連續取樣約 5 秒，6 秒的音檔會在結尾前就結束
    try {
      writeExclusiveTestFixture(EXCLUSIVE_TEST_FIXTURE, 14);
      console.log('[test-spectrum-smooth] fixture written:', EXCLUSIVE_TEST_FIXTURE);
    } catch (e) { console.warn('[test-spectrum-smooth] fixture write failed:', e); }
    mainWindow.loadFile('index.html', { query: { testSpectrumSmooth: '1', fixture: EXCLUSIVE_TEST_FIXTURE } });
  } else if (TEST_EXCLUSIVE) {
    try {
      writeExclusiveTestFixture(EXCLUSIVE_TEST_FIXTURE);
      console.log('[test-exclusive] fixture written:', EXCLUSIVE_TEST_FIXTURE);
    } catch (e) { console.warn('[test-exclusive] fixture write failed:', e); }
    // 注意：不帶 rpCapture，避免截圖流程的 UI 自動化另開 DSP session 把獨佔測試 session 取代掉
    mainWindow.loadFile('index.html', { query: { testExclusive: '1', fixture: EXCLUSIVE_TEST_FIXTURE } });
  } else if (TEST_VERSIONS) {
    mainWindow.loadFile('index.html', { query: { rpCapture: '1', testVersions: '1' } });
  } else if (CAPTURE_MODE) {
    try { writeDemoIrWav(CAPTURE_DEMO_IR); console.log('[capture] demo IR written:', CAPTURE_DEMO_IR); } catch (e) { console.warn('[capture] demo IR write failed:', e); }
    mainWindow.loadFile('index.html', { query: { rpCapture: '1', demoIr: CAPTURE_DEMO_IR } });
  } else {
    mainWindow.loadFile('index.html');
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (CAPTURE_MODE || TEST_VERSIONS || TEST_EXCLUSIVE || TEST_LABELS || TEST_KKBOX_MATCH || TEST_RECOMMEND || TEST_UF_LAYOUT || TEST_QUEUE_CONTRAST || TEST_SPECTRUM_SMOOTH || TEST_DLNA_HINT) runCaptureSequence();
  });

  if (CAPTURE_MODE || TEST_VERSIONS || TEST_EXCLUSIVE || TEST_LABELS || TEST_KKBOX_MATCH || TEST_RECOMMEND || TEST_UF_LAYOUT || TEST_QUEUE_CONTRAST || TEST_SPECTRUM_SMOOTH || TEST_DLNA_HINT) {
    // 備援觸發：ready-to-show 未觸發時，載入完成 6 秒後強制開始截圖
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        if (!captureStarted) { console.log('[capture] fallback trigger (ready-to-show missed)'); mainWindow.show(); runCaptureSequence(); }
      }, 6000);
    });
    mainWindow.webContents.on('render-process-gone', (e, d) => console.log('[capture] renderer gone:', JSON.stringify(d)));
    setTimeout(() => { if (!captureStarted) console.log('[capture] WARNING: no trigger after 30s'); }, 30000);
  }

  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window:maximizedChange', true);
  });

  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('window:maximizedChange', false);
  });
}

app.whenReady().then(async () => {
  app.on('web-contents-created', (event, contents) => {
    if (contents.getType() === 'webview') {
      contents.setWindowOpenHandler(({ url }) => {
        return { action: 'allow' };
      });
    }
  });

  // Handle local media streaming protocol
  protocol.handle('media', (request) => {
    try {
      let raw = decodeURIComponent(request.url.replace(/^media:\/\//i, ''));
      if (process.platform === 'win32') {
        raw = raw.replace(/^\//, '');
        // Restore drive colon if Chromium stripped it when parsing hostname (e.g. c/Users -> C:/Users)
        if (/^[a-zA-Z][\/\\]/.test(raw)) {
          raw = raw[0].toUpperCase() + ':/' + raw.slice(2);
        }
      }
      return net.fetch(pathToFileURL(raw).toString());
    } catch (err) {
      console.error('Error streaming media file:', err);
      return new Response('File not found', { status: 404 });
    }
  });

  createWindow();
  startDsdStreamingServer();

  // Initialize DLNA / UPnP Subsystem (Pure Native Audio Engine)
  dlnaManager = new DlnaManager();
  dlnaManager.startStreamingServer();
  dlnaManager.startSsdpDiscovery();

  dlnaManager.on('devices-updated', (list) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('dlna:devicesChanged', list);
    }
  });

  dlnaManager.on('playback-progress', (progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('dlna:progress', progress);
    }
  });

  dlnaManager.on('track-ended', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('dlna:trackEnded');
    }
  });

  // 串流準備進度（引擎建立 session、正式播放前的記憶體緩衝、裝置開播）→ 渲染端顯示提示
  dlnaManager.on('prepare-status', (info) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('dlna:prepareStatus', info);
    }
  });

  if (TEST_DLNA_HINT) {
    // 假 MediaRenderer：位置在 Play 後先停在 0 三秒，模擬真實裝置開播前的 ramp-up
    try {
      const { createFakeDlnaRenderer } = require('./tools/fake-dlna-renderer');
      fakeDlnaRenderer = createFakeDlnaRenderer({ port: FAKE_DLNA_PORT, holdPlayingSec: 3.0, trackDurationSec: 14 });
      await fakeDlnaRenderer.start();
      console.log(`[test-dlna-hint] fake MediaRenderer listening on 127.0.0.1:${FAKE_DLNA_PORT}`);
      const dev = await dlnaManager.probeIp('127.0.0.1');
      console.log('[test-dlna-hint] probe device:', dev ? dev.name : 'none');
    } catch (e) {
      console.warn('[test-dlna-hint] fake renderer setup failed:', e);
    }
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

let isAppQuitting = false;

async function cleanupAllAudioStreams() {
  for (const [, entryPromise] of localDspSessions) {
    Promise.resolve(entryPromise).then(e => { try { e.session.cancel(); } catch (err) {} }).catch(() => {});
  }
  localDspSessions.clear();
  if (dsdStreamServer) {
    try { dsdStreamServer.close(); } catch (e) {}
  }
  if (dlnaManager) {
    try { await dlnaManager.destroy(); } catch (e) {}
  }
  if (exclusiveOutput) {
    try { exclusiveOutput.kill(); } catch (e) {} // 獨佔 helper 必須跟著結束，否則裝置會一直被佔用
  }
  try { nativeDspStreamer.destroy(); } catch (e) {}
}

app.on('before-quit', async (event) => {
  if (!isAppQuitting) {
    isAppQuitting = true;
    event.preventDefault();
    await cleanupAllAudioStreams();
    app.quit();
  }
});

app.on('window-all-closed', async () => {
  await cleanupAllAudioStreams();
  if (process.platform !== 'darwin') app.quit();
});

// Ctrl+C / kill signal (e.g. launched via 啟動軟體.bat console): run the same cleanup so the
// DLNA renderer receives its Stop command instead of playing out its buffer after a hard kill.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    if (isAppQuitting) return;
    isAppQuitting = true;
    try { await cleanupAllAudioStreams(); } catch (e) {}
    app.exit(0);
  });
}

// DSD Streaming Server Engine
let dsdStreamServer = null;
let dsdStreamPort = 0;

function getDsdStreamPort() {
  if (dsdStreamPort > 0) return Promise.resolve(dsdStreamPort);
  return new Promise((resolve) => {
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      if (dsdStreamPort > 0 || attempts > 40) {
        clearInterval(interval);
        resolve(dsdStreamPort || 9099);
      }
    }, 50);
  });
}

// ==========================================================
// Local DSP Playback Sessions
// Local /sox-stream playback shares the exact same progressive
// streaming engine (native-dsp-streamer) as the DLNA output path:
// blocks are generated in the background and served as they are ready,
// so the main process never computes a whole track synchronously.
// ==========================================================
const localDspSessions = new Map(); // sessionKey -> Promise<{ token, session }>
let lastLocalDspToken = null; // most recent local DSP session token (spectrum IPC fallback)

function serveProgressiveSession(req, res, session) {
  const totalSize = session.totalFileBytes;
  const ext = path.extname(session.filePath).toLowerCase();
  const contentType = ext === '.dsf' ? 'audio/x-dsf' : 'audio/wav';
  const headers = {
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
    'Access-Control-Allow-Origin': '*'
  };

  if (req.method === 'HEAD') {
    res.writeHead(200, { ...headers, 'Content-Length': totalSize });
    res.end();
    return;
  }

  const ProgressiveFileStream = nativeDspStreamer.ProgressiveFileStream;
  const range = req.headers.range;
  let stream;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;
    const chunkSize = Math.max(0, (end - start) + 1);
    res.writeHead(206, {
      ...headers,
      'Content-Range': `bytes ${start}-${end}/${totalSize}`,
      'Content-Length': chunkSize
    });
    stream = (session.isCompleted || !ProgressiveFileStream)
      ? fs.createReadStream(session.filePath, { start, end })
      : new ProgressiveFileStream(session.filePath, start, end, session);
  } else {
    res.writeHead(200, { ...headers, 'Content-Length': totalSize });
    stream = (session.isCompleted || !ProgressiveFileStream)
      ? fs.createReadStream(session.filePath)
      : new ProgressiveFileStream(session.filePath, 0, totalSize - 1, session);
  }

  stream.pipe(res);
  req.on('close', () => { try { stream.destroy(); } catch (e) {} });
}

function startDsdStreamingServer() {
  dsdStreamServer = http.createServer(async (req, res) => {
    try {
      const reqUrl = new URL(req.url, 'http://127.0.0.1');

      // Native DSP PCM Upsampling Stream (Progressive session, same engine as the DLNA path)
      if (reqUrl.pathname === '/sox-stream') {
        const filePath = reqUrl.searchParams.get('file');
        const startSec = parseFloat(reqUrl.searchParams.get('start') || '0');
        const sampleRate = parseInt(reqUrl.searchParams.get('rate') || '192000', 10);
        const filterPhase = reqUrl.searchParams.get('phase') || 'linear';
        // PEQ options arrive as compact JSON (renderer keeps the single source of truth)
        let peqOptions = null;
        const peqRaw = reqUrl.searchParams.get('peq');
        if (peqRaw) {
          try {
            const parsed = JSON.parse(peqRaw);
            if (parsed && parsed.enabled && Array.isArray(parsed.bands)) peqOptions = parsed;
          } catch (e) { peqOptions = null; }
        }
        // Convolution (IR) options arrive the same way: { enabled, irPath }
        let convOptions = null;
        const convRaw = reqUrl.searchParams.get('conv');
        if (convRaw) {
          try {
            const parsedConv = JSON.parse(convRaw);
            if (parsedConv && parsedConv.enabled && parsedConv.irPath) convOptions = parsedConv;
          } catch (e) { convOptions = null; }
        }

        if (!filePath || !fs.existsSync(filePath)) {
          res.writeHead(404);
          res.end('File not found');
          return;
        }

        // Local Chromium playback always receives progressive 24-bit PCM WAV
        // (DSD rate modes are mapped to intermediate PCM rates by the renderer;
        //  dsd/order URL params are accepted for compatibility and ignored here)
        const sessionKey = crypto.createHash('md5').update(`${filePath}|${startSec}|${sampleRate}|${filterPhase}|${peqRaw || ''}|${convRaw || ''}`).digest('hex');

        try {
          let entryPromise = localDspSessions.get(sessionKey);
          if (!entryPromise) {
            // A new DSP playback request supersedes and cancels any previous local session
            for (const [k, oldPromise] of localDspSessions) {
              if (k !== sessionKey) {
                Promise.resolve(oldPromise).then(old => { try { old.session.cancel(); } catch (e) {} }).catch(() => {});
                localDspSessions.delete(k);
              }
            }
            entryPromise = (async () => {
              const token = `local_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
              const session = await nativeDspStreamer.createPcmSession(token, filePath, startSec, sampleRate, null, filterPhase, peqOptions, convOptions);
              return { token, session };
            })();
            localDspSessions.set(sessionKey, entryPromise);
            entryPromise.catch(() => { localDspSessions.delete(sessionKey); });
          }
          const entry = await entryPromise;
          lastLocalDspToken = entry.token; // spectrum fallback for local DSP playback (renderer only has the URL)
          serveProgressiveSession(req, res, entry.session);
        } catch (err) {
          console.error('[StreamServer] Local DSP session error:', err);
          if (!res.headersSent) {
            res.writeHead(500);
            res.end('Local DSP stream error');
          } else {
            res.end();
          }
        }
        return;
      }

      // Native DSF Decimation Stream
      if (reqUrl.pathname === '/dsd-stream') {
        const filePath = reqUrl.searchParams.get('file');
        const startSec = parseFloat(reqUrl.searchParams.get('start') || '0');

        if (!filePath || !fs.existsSync(filePath)) {
          res.writeHead(404);
          res.end('File not found');
          return;
        }

        if (req.method === 'HEAD') {
          res.writeHead(200, {
            'Content-Type': 'audio/wav',
            'Access-Control-Allow-Origin': '*',
            'Transfer-Encoding': 'chunked'
          });
          res.end();
          return;
        }

        // Native 32x Decimation to 88.2kHz / 24-bit WAV
        const outWav = nativeAudioEngine.decimateDsfToWav(filePath, startSec);
        if (!outWav) {
          res.writeHead(500);
          res.end('Native DSF decimation failed');
          return;
        }
        let outWavFinal = outWav;
        const peqRawDsd = reqUrl.searchParams.get('peq');
        if (peqRawDsd) {
          try {
            const parsedPeq = JSON.parse(peqRawDsd);
            if (parsedPeq && parsedPeq.enabled && Array.isArray(parsedPeq.bands)) {
              outWavFinal = nativeDspStreamer.applyPeqToWavBuffer(outWav, parsedPeq);
            }
          } catch (e) { /* PEQ failure must never break playback */ }
        }
        const convRawDsd = reqUrl.searchParams.get('conv');
        if (convRawDsd) {
          try {
            const parsedConv = JSON.parse(convRawDsd);
            if (parsedConv && parsedConv.enabled && parsedConv.irPath) {
              outWavFinal = await nativeDspStreamer.applyConvToWavBufferAsync(outWavFinal, parsedConv);
            }
          } catch (e) { /* Convolution failure must never break playback */ }
        }

        // Range 支援：WASAPI 獨佔輸出以 byte 分段重新取用同一条 88.2k 串流（seek / resume）
        const totalDsdBytes = outWavFinal.length;
        const dsdRange = req.headers.range;
        if (dsdRange) {
          const parts = dsdRange.replace(/bytes=/, '').split('-');
          const rStart = Math.max(0, parseInt(parts[0], 10) || 0);
          const rEnd = Math.min(totalDsdBytes - 1, parts[1] !== undefined && parts[1] !== '' ? parseInt(parts[1], 10) : totalDsdBytes - 1);
          const chunk = rStart <= rEnd ? outWavFinal.subarray(rStart, rEnd + 1) : Buffer.alloc(0);
          res.writeHead(206, {
            'Content-Type': 'audio/wav',
            'Content-Length': chunk.length,
            'Content-Range': `bytes ${rStart}-${rEnd}/${totalDsdBytes}`,
            'Accept-Ranges': 'bytes',
            'Access-Control-Allow-Origin': '*'
          });
          res.end(chunk);
        } else {
          res.writeHead(200, {
            'Content-Type': 'audio/wav',
            'Content-Length': totalDsdBytes,
            'Accept-Ranges': 'bytes',
            'Access-Control-Allow-Origin': '*'
          });
          res.end(outWavFinal);
        }
        return;
      }

      // TIDAL Realtime Lossless Audio Streaming & Local Server
      if (reqUrl.pathname === '/tidal-stream') {
        const trackId = reqUrl.searchParams.get('id');
        const safeId = String(trackId || '').replace(/[^a-zA-Z0-9_-]/g, '');
        if (!safeId) {
          res.writeHead(400);
          res.end('Missing track id');
          return;
        }

        const targetFile = path.join(TIDAL_CACHE_DIR, `${safeId}.flac`);

        // 1. If file is already cached on disk (>64KB), stream with full Range support
        if (fs.existsSync(targetFile)) {
          try {
            const stat = fs.statSync(targetFile);
            if (stat.size > 64 * 1024) {
              const fileSize = stat.size;
              const range = req.headers.range;

              if (req.method === 'HEAD') {
                res.writeHead(200, {
                  'Content-Type': 'audio/flac',
                  'Content-Length': fileSize,
                  'Accept-Ranges': 'bytes',
                  'Access-Control-Allow-Origin': '*'
                });
                res.end();
                return;
              }

              if (range) {
                const parts = range.replace(/bytes=/, '').split('-');
                const start = parseInt(parts[0], 10);
                const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
                const chunkSize = (end - start) + 1;
                res.writeHead(206, {
                  'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                  'Accept-Ranges': 'bytes',
                  'Content-Length': chunkSize,
                  'Content-Type': 'audio/flac',
                  'Access-Control-Allow-Origin': '*'
                });
                fs.createReadStream(targetFile, { start, end }).pipe(res);
              } else {
                res.writeHead(200, {
                  'Content-Length': fileSize,
                  'Content-Type': 'audio/flac',
                  'Accept-Ranges': 'bytes',
                  'Access-Control-Allow-Origin': '*'
                });
                fs.createReadStream(targetFile).pipe(res);
              }
              return;
            }
          } catch (err) {
            console.warn('[StreamServer] Error reading cached TIDAL file:', err);
          }
        }

        // 2. Not cached: assemble FLAC on-the-fly from manifest segments (Pure Node, no external processes)
        const info = tidalManifestMap.get(safeId);
        if (!info || !info.manifestXml) {
          res.writeHead(404);
          res.end('TIDAL stream manifest not found');
          return;
        }

        const resolved = parseTidalManifestSegments(info.manifestXml);
        if (!resolved || !resolved.segmentUrls.length) {
          res.writeHead(404);
          res.end('TIDAL stream manifest could not be resolved');
          return;
        }

        if (req.method === 'HEAD') {
          res.writeHead(200, {
            'Content-Type': 'audio/flac',
            'Access-Control-Allow-Origin': '*',
            'Transfer-Encoding': 'chunked'
          });
          res.end();
          return;
        }

        res.writeHead(200, {
          'Content-Type': 'audio/flac',
          'Access-Control-Allow-Origin': '*',
          'Transfer-Encoding': 'chunked'
        });

        const tempFlac = path.join(TIDAL_CACHE_DIR, `temp_${safeId}_${Date.now()}.flac`);
        let aborted = false;
        req.on('close', () => { aborted = true; });

        try {
          const segmentUrls = resolved.initUrl ? [resolved.initUrl, ...resolved.segmentUrls] : resolved.segmentUrls;
          const completed = await fetchTidalSegmentsInOrder(segmentUrls, (buf) => {
            res.write(buf);
            fs.appendFileSync(tempFlac, buf);
          }, { concurrency: 8, shouldAbort: () => aborted });
          res.end();

          try {
            const stat = fs.statSync(tempFlac);
            if (completed && !aborted && stat.size > 64 * 1024) {
              if (fs.existsSync(targetFile)) fs.unlinkSync(targetFile);
              fs.renameSync(tempFlac, targetFile);
              console.log(`[TIDAL] Successfully cached track ${safeId} to disk (${stat.size} bytes)`);
            } else {
              try { fs.unlinkSync(tempFlac); } catch (_) {}
            }
          } catch (_) {}
        } catch (err) {
          console.error('[StreamServer] TIDAL segment stream error:', err);
          try { if (fs.existsSync(tempFlac)) fs.unlinkSync(tempFlac); } catch (_) {}
          if (!res.headersSent) {
            res.writeHead(500);
            res.end('TIDAL segment stream error');
          } else {
            res.end();
          }
        }

        return;
      }

      res.writeHead(404);
      res.end('Not found');
    } catch (err) {
      console.error('Native Audio stream server error:', err);
      if (!res.headersSent) {
        res.writeHead(500);
        res.end('Server error');
      }
    }
  });

  dsdStreamServer.listen(0, '127.0.0.1', () => {
    dsdStreamPort = dsdStreamServer.address().port;
    console.log(`Native High-Res Audio Streaming Server (DSD & PCM) running on port ${dsdStreamPort}`);
  });
}

// Window controls IPC
ipcMain.handle('window:minimize', () => mainWindow?.minimize());
ipcMain.handle('window:maximizeToggle', () => {
  if (!mainWindow) return false;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
    return false;
  } else {
    mainWindow.maximize();
    return true;
  }
});
ipcMain.handle('window:close', () => mainWindow?.close());
ipcMain.handle('shell:openExternal', (event, url) => {
  if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
    shell.openExternal(url);
  }
});

// DSD Stream URL helper IPC
ipcMain.handle('audio:getDsdStreamUrl', (event, filePath, startSec = 0, peqJson = '', convJson = '') => {
  if (!dsdStreamPort) return '';
  const params = new URLSearchParams();
  params.set('file', filePath);
  if (startSec > 0) params.set('start', startSec.toString());
  if (peqJson) params.set('peq', peqJson);
  if (convJson) params.set('conv', convJson);
  return `http://127.0.0.1:${dsdStreamPort}/dsd-stream?${params.toString()}`;
});

// Native DSP PCM Upsampling Stream URL helper IPC
// 濾波器插件清單（供設定頁動態生成濾波器按鈕與聲音特色提示）
ipcMain.handle('dsp:listFilterPlugins', () => {
  try {
    return require('./dsp-kernel').listFilterPlugins();
  } catch (e) {
    return [];
  }
});

// ----------------- 使用者自訂濾波槽（工具箱） -----------------
// 純參數 JSON 存於 userData；dsp-kernel 做全部驗證/夾限/註冊（不執行使用者程式碼）。
function readUserFilterSlots() {
  try {
    const data = JSON.parse(fs.readFileSync(process.env.ROOPLAYER_USER_FILTERS, 'utf8'));
    return Array.isArray(data && data.slots) ? data.slots : [];
  } catch (e) {
    return [];
  }
}

function writeUserFilterSlots(slots) {
  try {
    fs.writeFileSync(process.env.ROOPLAYER_USER_FILTERS, JSON.stringify({ version: 1, slots }, null, 2));
    require('./dsp-kernel').reloadUserFilters(); // 主行程註冊表即時重建（新 session/worker 立即採用）
    return true;
  } catch (e) {
    return false;
  }
}

ipcMain.handle('filters:listSlots', () => {
  return { slots: readUserFilterSlots() };
});

ipcMain.handle('filters:saveSlot', (event, spec) => {
  const kernel = require('./dsp-kernel');
  const v = kernel.validateUserFilterSpec(spec);
  if (!v) return { ok: false, error: '濾波器參數無效' };
  const slots = readUserFilterSlots().filter(s => !(s && s.id === v.id));
  slots.push(v);
  slots.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  if (!writeUserFilterSlots(slots)) return { ok: false, error: '儲存失敗' };
  return { ok: true, slots };
});

ipcMain.handle('filters:deleteSlot', (event, slotId) => {
  if (typeof slotId !== 'string' || !/^uf-[1-6]$/.test(slotId)) return { ok: false, error: '槽位識別碼無效' };
  const slots = readUserFilterSlots().filter(s => !(s && s.id === slotId));
  if (!writeUserFilterSlots(slots)) return { ok: false, error: '儲存失敗' };
  return { ok: true, slots };
});

// 響應預覽：以目前播放脈絡的 (srcRate → targetRate) 設計並回傳曲線資料（純資料，不動播放路徑）
ipcMain.handle('filters:preview', (event, spec, srcRate, targetRate) => {
  try {
    const kernel = require('./dsp-kernel');
    const v = kernel.validateUserFilterSpec(spec);
    if (!v) return null;
    const sr = Math.max(8000, Math.min(192000, parseInt(srcRate, 10) || 44100));
    const fo = Math.max(sr, Math.min(2822400 * 4, parseInt(targetRate, 10) || sr * 4));
    return kernel.previewUserFilterSpec(v, sr, fo);
  } catch (e) {
    return null;
  }
});

ipcMain.handle('audio:getSoxStreamUrl', (event, filePath, startSec = 0, sampleRate = 192000, dsdMode = '', dsdOrder = 5, filterPhase = 'linear', peqJson = '', convJson = '') => {
  if (!dsdStreamPort) return '';
  const params = new URLSearchParams();
  params.set('file', filePath);
  if (startSec > 0) params.set('start', startSec.toString());
  params.set('rate', sampleRate.toString());
  if (dsdMode) params.set('dsd', dsdMode);
  params.set('order', (dsdOrder || 5).toString());
  params.set('phase', filterPhase || 'linear');
  if (peqJson) params.set('peq', peqJson);
  if (convJson) params.set('conv', convJson);
  params.set('local', '1'); // Local Electron Chromium playback needs decoded PCM WAV
  return `http://127.0.0.1:${dsdStreamPort}/sox-stream?${params.toString()}`;
});

// ==========================================================
// WASAPI 獨佔輸出 IPC（渲染端只處理狀態與按鈕，COM 全部在 helper 行程內）
// ==========================================================
ipcMain.handle('exclusive:probe', (event, force = false) => {
  try {
    return getExclusiveOutput().probe(force);
  } catch (e) {
    return { ok: false, code: 'RP-PROBE', msg: String(e.message || e) };
  }
});

ipcMain.handle('exclusive:start', (event, opts = {}) => {
  try {
    return getExclusiveOutput().start({
      url: opts.url || '',
      rate: Number(opts.rate) || 0,
      startByte: Number(opts.startByte) || 0,
      deviceId: opts.deviceId || ''
    });
  } catch (e) {
    return { ok: false, code: 'RP-START', msg: String(e.message || e) };
  }
});

ipcMain.handle('exclusive:pause', () => { try { return { ok: getExclusiveOutput().pause() }; } catch (e) { return { ok: false, msg: String(e.message || e) }; } });
ipcMain.handle('exclusive:resume', () => { try { return { ok: getExclusiveOutput().resume() }; } catch (e) { return { ok: false, msg: String(e.message || e) }; } });
ipcMain.handle('exclusive:seek', (event, streamSeconds = 0) => { try { return { ok: getExclusiveOutput().seek(streamSeconds) }; } catch (e) { return { ok: false, msg: String(e.message || e) }; } });
ipcMain.handle('exclusive:stop', () => { try { return { ok: getExclusiveOutput().stop() }; } catch (e) { return { ok: false, msg: String(e.message || e) }; } });
ipcMain.handle('exclusive:state', () => {
  const mgr = getExclusiveOutput();
  return { running: mgr.isBusy(), rate: mgr.currentRate, capability: mgr.capability || null };
});

// ==========================================================
// Convolution IR: file picker + metadata (for the PEQ-adjacent UI card)
// ==========================================================
ipcMain.handle('conv:pickIrFile', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '選擇脈衝響應（IR）WAV 檔案',
    properties: ['openFile'],
    filters: [
      { name: '脈衝響應 WAV', extensions: ['wav'] },
      { name: '所有檔案', extensions: ['*'] }
    ]
  });
  if (result.canceled || !result.filePaths || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('conv:getIrInfo', async (event, irPath) => {
  try {
    if (!irPath || !fs.existsSync(irPath)) return { ok: false, error: '檔案不存在' };
    const ir = await nativeAudioEngine.readPcmSamples(irPath, 0, 60);
    if (!ir || !ir.frameCount) return { ok: false, error: '無法解碼（需 16/24/32-bit WAV）' };
    const irL = Float64Array.from(ir.left);
    const peak = require('./dsp-kernel').irResponsePeak(irL);
    return {
      ok: true,
      sampleRate: ir.sampleRate,
      channels: ir.channels,
      frames: ir.frameCount,
      durationMs: Math.round((ir.frameCount / ir.sampleRate) * 1000),
      responsePeak: peak
    };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

async function getAudioDurationNative(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return 0;
  try {
    const meta = await mm.parseFile(filePath, { duration: true, skipCovers: true });
    if (meta && meta.format && meta.format.duration) {
      return meta.format.duration;
    }
  } catch (e) {
    // Fallback: check DSF / DFF headers directly
    const dsf = nativeAudioEngine.parseDsf(filePath);
    if (dsf && dsf.dsdRate > 0) {
      return dsf.sampleCount / dsf.dsdRate;
    }
    const dff = nativeAudioEngine.parseDff(filePath);
    if (dff && dff.dsdRate > 0) {
      return dff.sampleCount / dff.dsdRate;
    }
  }
  return 0;
}

ipcMain.handle('audio:getAudioDuration', async (event, filePath) => {
  return await getAudioDurationNative(filePath);
});

// Translation to Traditional Chinese (zh-TW) IPC
ipcMain.handle('util:translateToZhTw', async (event, text) => {
  if (!text || typeof text !== 'string' || !text.trim()) return '';
  const translateChunk = async (chunk) => {
    const trimmed = chunk.trim();
    if (!trimmed) return '';
    try {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-TW&dt=t&q=${encodeURIComponent(trimmed)}`;
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (res.ok) {
        const data = await res.json();
        if (data && data[0] && Array.isArray(data[0])) {
          return data[0].map(s => (s && s[0]) ? s[0] : '').join('').trim();
        }
      }
    } catch (err) {
      console.warn('Translate chunk failed:', err);
    }
    return trimmed;
  };

  try {
    if (text.includes('\n\n')) {
      const paragraphs = text.split('\n\n').filter(p => p.trim());
      const results = [];
      for (const p of paragraphs) {
        results.push(await translateChunk(p));
      }
      return results.join('\n\n');
    }
    return await translateChunk(text);
  } catch (err) {
    console.warn('Translate to Traditional Chinese failed:', err);
  }
  return text;
});

// ==========================================================
// TIDAL Streaming Subsystem IPC & Auth
// ==========================================================
const TIDAL_AUTH_FILE = path.join(app.getPath('userData'), 'rooplayer_tidal_auth.json');

function loadTidalAuth() {
  try {
    if (fs.existsSync(TIDAL_AUTH_FILE)) {
      return JSON.parse(fs.readFileSync(TIDAL_AUTH_FILE, 'utf-8'));
    }
  } catch (e) {
    console.warn('[TIDAL] Failed to read auth file:', e);
  }
  return null;
}

function saveTidalAuth(data) {
  try {
    fs.writeFileSync(TIDAL_AUTH_FILE, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.error('[TIDAL] Failed to save auth file:', e);
    return false;
  }
}

function clearTidalAuth() {
  try {
    if (fs.existsSync(TIDAL_AUTH_FILE)) {
      fs.unlinkSync(TIDAL_AUTH_FILE);
    }
    const tidalSession = session.fromPartition('persist:tidal');
    tidalSession.clearStorageData().catch(() => {});
    return true;
  } catch (e) {
    console.error('[TIDAL] Failed to clear auth:', e);
    return false;
  }
}

ipcMain.handle('tidal:getStoredAuth', () => loadTidalAuth());
ipcMain.handle('tidal:saveAuth', (event, data) => saveTidalAuth(data));
ipcMain.handle('tidal:logout', () => clearTidalAuth());

const TIDAL_CACHE_DIR = path.join(app.getPath('userData'), 'tidal_cache');
if (!fs.existsSync(TIDAL_CACHE_DIR)) {
  try { fs.mkdirSync(TIDAL_CACHE_DIR, { recursive: true }); } catch (_) {}
}

const tidalManifestMap = new Map();

// ==========================================================
// TIDAL Manifest Segment Resolver (Pure Node, no FFmpeg)
// Supports DASH XML manifests (SegmentTemplate / SegmentTimeline)
// and BTS-style JSON manifests (direct download urls).
// ==========================================================
function parseTidalManifestSegments(manifestSource) {
  if (!manifestSource) return null;
  const trimmed = String(manifestSource).trim();

  // BTS-style manifest: JSON with direct download URLs
  if (trimmed.startsWith('{')) {
    try {
      const bts = JSON.parse(trimmed);
      const urls = Array.isArray(bts.urls) ? bts.urls.map(u => String(u).trim()).filter(u => /^https?:\/\//i.test(u)) : [];
      if (urls.length > 0) return { initUrl: null, segmentUrls: urls };
    } catch (_) {}
    return null;
  }

  try {
    // Base URLs used to resolve relative segment templates (TIDAL usually uses absolute URLs)
    const baseUrls = [...trimmed.matchAll(/<BaseURL>([^<]+)<\/BaseURL>/g)].map(m => m[1].trim()).filter(Boolean);
    const base = baseUrls.length > 0 ? baseUrls[baseUrls.length - 1] : '';

    // Representation-level SegmentTemplate overrides AdaptationSet-level (last one in document order)
    const allTemplates = [...trimmed.matchAll(/<SegmentTemplate[^>]*>/g)].map(m => m[0]);
    if (!allTemplates.length) return null;
    const template = allTemplates[allTemplates.length - 1];

    const attr = (name) => {
      const m = template.match(new RegExp(`[\\s"]${name}="([^"]*)"`));
      return m ? m[1] : null;
    };
    const mediaTpl = attr('media');
    if (!mediaTpl) return null;
    const initTpl = attr('initialization');
    const startNumber = parseInt(attr('startNumber') || '1', 10);
    const timescale = parseInt(attr('timescale') || '1', 10);
    const segDuration = parseInt(attr('duration') || '0', 10);

    const repTag = (trimmed.match(/<Representation[^>]*>/) || [])[0] || '';
    const repId = (repTag.match(/\bid="([^"]*)"/) || [])[1] || '';
    const bandwidth = (repTag.match(/\bbandwidth="(\d+)"/) || [])[1] || '0';

    const fillPlaceholders = (tpl, number, time) => {
      return tpl
        .replace(/\$RepresentationID\$/g, repId)
        .replace(/\$Bandwidth\$/g, bandwidth)
        .replace(/\$Number\$/g, String(number))
        .replace(/\$Time\$/g, (time !== null && time !== undefined) ? String(time) : String(number));
    };
    const resolveUrl = (filled) => {
      if (!filled) return null;
      if (/^https?:\/\//i.test(filled)) return filled;
      if (!base) return null;
      try { return new URL(filled, base).toString(); } catch (_) { return null; }
    };

    // Build the segment list: SegmentTimeline entries first, then duration math, then single segment
    const segments = [];
    const timeline = [...trimmed.matchAll(/<S\b([^>]*)\/?>/g)];
    if (timeline.length > 0) {
      let curTime = null;
      for (const s of timeline) {
        const attrs = s[1];
        const tM = attrs.match(/\bt="(\d+)"/);
        const dM = attrs.match(/\bd="(\d+)"/);
        const rM = attrs.match(/\br="(-?\d+)"/);
        const d = dM ? parseInt(dM[1], 10) : 0;
        const repeats = rM ? (parseInt(rM[1], 10) >= 0 ? parseInt(rM[1], 10) + 1 : 1) : 1;
        if (tM) curTime = parseInt(tM[1], 10);
        for (let i = 0; i < repeats; i++) {
          segments.push({ number: startNumber + segments.length, time: curTime !== null ? curTime + i * d : null });
        }
        if (curTime !== null && d > 0) curTime += repeats * d;
      }
    } else if (segDuration > 0) {
      const mPD = (trimmed.match(/mediaPresentationDuration="([^"]+)"/) || [])[1] || '';
      const durM = mPD.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?$/);
      let totalSec = 0;
      if (durM) {
        totalSec = (parseInt(durM[1] || '0', 10) * 3600) + (parseInt(durM[2] || '0', 10) * 60) + parseFloat(durM[3] || '0');
      }
      const count = totalSec > 0 ? Math.ceil((totalSec * timescale) / segDuration) : 1;
      for (let i = 0; i < count; i++) {
        segments.push({ number: startNumber + i, time: segDuration * i });
      }
    } else {
      segments.push({ number: startNumber, time: 0 });
    }

    const segmentUrls = segments
      .map(seg => resolveUrl(fillPlaceholders(mediaTpl, seg.number, seg.time)))
      .filter(Boolean);
    if (segmentUrls.length === 0) return null;

    return {
      initUrl: initTpl ? resolveUrl(fillPlaceholders(initTpl, startNumber, 0)) : null,
      segmentUrls
    };
  } catch (err) {
    console.warn('[TIDAL] Failed to parse manifest segments:', err);
    return null;
  }
}
const activeTidalCachePromises = new Map();

ipcMain.handle('tidal:getStreamUrl', async (event, trackId, playbackInfo) => {
  if (!trackId) return null;
  const safeId = String(trackId).replace(/[^a-zA-Z0-9_-]/g, '');
  const targetFile = path.join(TIDAL_CACHE_DIR, `${safeId}.flac`);

  let cachedFile = null;
  if (fs.existsSync(targetFile)) {
    try {
      const stat = fs.statSync(targetFile);
      if (stat.size > 64 * 1024) {
        cachedFile = targetFile;
      }
    } catch (_) {}
  }

  if (playbackInfo && playbackInfo.manifest) {
    let manifestXml = '';
    try {
      manifestXml = Buffer.from(playbackInfo.manifest, 'base64').toString('utf-8');
    } catch (_) {}
    tidalManifestMap.set(safeId, {
      manifestXml,
      manifestMimeType: playbackInfo.manifestMimeType,
      bitDepth: playbackInfo.bitDepth || 16,
      sampleRate: playbackInfo.sampleRate || 44100,
      audioQuality: playbackInfo.audioQuality || 'LOSSLESS'
    });
  }

  const port = await getDsdStreamPort();
  const streamUrl = `http://127.0.0.1:${port}/tidal-stream?id=${safeId}`;

  return {
    streamUrl,
    filePath: cachedFile,
    bitDepth: playbackInfo ? (playbackInfo.bitDepth || 16) : 16,
    sampleRate: playbackInfo ? (playbackInfo.sampleRate || 44100) : 44100,
    audioQuality: playbackInfo ? (playbackInfo.audioQuality || 'LOSSLESS') : 'LOSSLESS'
  };
});

// Fetch TIDAL manifest segments with bounded parallelism, delivering buffers in order.
// Dramatically reduces cache build time vs sequential per-segment round-trips.
async function fetchTidalSegmentsInOrder(segmentUrls, onSegment, options = {}) {
  const concurrency = Math.max(1, Math.min(options.concurrency || 8, 16));
  const shouldAbort = options.shouldAbort || (() => false);
  const total = segmentUrls.length;
  const inflight = new Map();
  let issueIndex = 0;

  const issueNext = () => {
    if (issueIndex >= total) return;
    const i = issueIndex++;
    const p = fetch(segmentUrls[i]).then(async (segRes) => {
      if (!segRes.ok) throw new Error(`Segment HTTP ${segRes.status}`);
      return Buffer.from(await segRes.arrayBuffer());
    });
    p.catch(() => {}); // suppress unhandled rejections for segments not awaited yet
    inflight.set(i, p);
  };

  for (let k = 0; k < Math.min(concurrency, total); k++) issueNext();

  try {
    for (let i = 0; i < total; i++) {
      const buf = await inflight.get(i); // ordered delivery guaranteed
      inflight.delete(i);
      if (shouldAbort()) {
        await Promise.allSettled([...inflight.values()]);
        inflight.clear();
        return false; // aborted by caller
      }
      await onSegment(buf, i);
      issueNext();
    }
    return true; // completed
  } catch (err) {
    await Promise.allSettled([...inflight.values()]);
    inflight.clear();
    throw err;
  }
}

ipcMain.handle('tidal:cacheTrack', async (event, trackId, streamUrlOrInfo, optionalInfo) => {
  if (!trackId) return null;
  const safeId = String(trackId).replace(/[^a-zA-Z0-9_-]/g, '');
  const targetFile = path.join(TIDAL_CACHE_DIR, `${safeId}.flac`);

  if (fs.existsSync(targetFile)) {
    try {
      const stat = fs.statSync(targetFile);
      if (stat.size > 64 * 1024) {
        return targetFile;
      }
    } catch (_) {}
  }

  if (activeTidalCachePromises.has(safeId)) {
    const existingResult = await activeTidalCachePromises.get(safeId);
    if (existingResult) return existingResult;
    // 前一次組裝失敗：若呼叫端提供了新的串流資訊 / manifest，繼續往下用新資訊重新組裝，
    // 不再直接回傳舊失敗結果。
  }

  const cachePromise = (async () => {
    try {
      let info = (optionalInfo && optionalInfo.manifest) ? optionalInfo : null;
      if (!info && typeof streamUrlOrInfo === 'object' && streamUrlOrInfo && streamUrlOrInfo.manifest) {
        info = streamUrlOrInfo;
      }
      if (!info) {
        info = tidalManifestMap.get(safeId);
      }

      let manifestXml = (info && info.manifestXml) ? info.manifestXml : null;
      if (!manifestXml && info && info.manifest) {
        try {
          manifestXml = Buffer.from(info.manifest, 'base64').toString('utf-8');
        } catch (_) {}
      }

      if (manifestXml) {
        const resolved = parseTidalManifestSegments(manifestXml);
        if (resolved && resolved.segmentUrls.length) {
          const tempFlac = path.join(TIDAL_CACHE_DIR, `cache_temp_${safeId}_${Date.now()}.flac`);
          try {
            const segmentUrls = resolved.initUrl ? [resolved.initUrl, ...resolved.segmentUrls] : resolved.segmentUrls;
            await fetchTidalSegmentsInOrder(segmentUrls, (buf) => {
              fs.appendFileSync(tempFlac, buf);
            }, { concurrency: 8 });
            const stat = fs.statSync(tempFlac);
            if (stat.size > 64 * 1024) {
              if (fs.existsSync(targetFile)) fs.unlinkSync(targetFile);
              fs.renameSync(tempFlac, targetFile);
              console.log(`[TIDAL] Cache finished for track ${safeId}`);
              return targetFile;
            }
            try { fs.unlinkSync(tempFlac); } catch (_) {}
          } catch (err) {
            console.warn('[TIDAL] Manifest segment assembly failed for', safeId, err);
            try { if (fs.existsSync(tempFlac)) fs.unlinkSync(tempFlac); } catch (_) {}
          }
        }
      }

      // Fallback: If streamUrlOrInfo is direct HTTP download URL
      const directUrl = typeof streamUrlOrInfo === 'string' ? streamUrlOrInfo : null;
      if (directUrl && directUrl.startsWith('http') && !directUrl.includes('/tidal-stream')) {
        const res = await fetch(directUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const arrayBuf = await res.arrayBuffer();
        fs.writeFileSync(targetFile, Buffer.from(arrayBuf));
        return targetFile;
      }

      return null;
    } catch (err) {
      console.error('[TIDAL] Failed to cache track:', trackId, err);
      return null;
    } finally {
      activeTidalCachePromises.delete(safeId);
    }
  })();

  activeTidalCachePromises.set(safeId, cachePromise);
  return await cachePromise;
});

// Universal backend API proxy to avoid renderer CORS and enable direct Node fetch
ipcMain.handle('tidal:api', async (event, { endpoint, method = 'GET', body = null, token = '' }) => {
  const url = endpoint.startsWith('http') ? endpoint : `https://api.tidal.com/v1${endpoint}`;
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  };

  const options = {
    method: method || 'GET',
    headers
  };
  if (body && (method === 'POST' || method === 'PUT')) {
    options.body = typeof body === 'string' ? body : JSON.stringify(body);
  }

  const res = await fetch(url, options);
  if (!res.ok) {
    let errText = '';
    try { errText = await res.text(); } catch (_) {}
    throw new Error(`TIDAL API HTTP ${res.status}: ${errText || res.statusText}`);
  }
  return await res.json();
});

// Window-based official TIDAL Web Login & Token Capturer
let activeTidalAuthWin = null;
let activeTidalFinishLogin = null;

ipcMain.handle('tidal:loginWithWindow', async () => {
  return new Promise((resolve) => {
    let resolved = false;

    // Close any previous auth window if open
    if (activeTidalAuthWin && !activeTidalAuthWin.isDestroyed()) {
      try { activeTidalAuthWin.close(); } catch (_) {}
    }

    const authWin = new BrowserWindow({
      width: 560,
      height: 780,
      title: 'TIDAL 官方帳號登入 — rooPlayer',
      parent: mainWindow || undefined,
      modal: false,
      autoHideMenuBar: true,
      webPreferences: {
        partition: 'persist:tidal',
        nodeIntegration: false,
        contextIsolation: true
      }
    });
    authWin.setMenu(null);
    activeTidalAuthWin = authWin;

    const tidalSession = session.fromPartition('persist:tidal');
    const chromeUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
    tidalSession.setUserAgent(chromeUA);
    authWin.webContents.setUserAgent(chromeUA);

    // Allow third-party OAuth popups (e.g. Google, Apple, Facebook login)
    authWin.webContents.setWindowOpenHandler(({ url }) => {
      return { action: 'allow' };
    });

    const finishLogin = async (token, source = 'unknown') => {
      if (resolved || !token) return;
      token = String(token).trim();
      if (token.length < 25) return;

      console.log(`[TIDAL] Validating token from ${source} (${token.substring(0, 12)}...)...`);

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4500);

        const sessRes = await fetch('https://api.tidal.com/v1/sessions', {
          headers: {
            'Authorization': `Bearer ${token}`,
            'User-Agent': chromeUA
          },
          signal: controller.signal
        }).catch(err => {
          console.warn('[TIDAL] Verify fetch warning:', err.message);
          return null;
        });
        clearTimeout(timeoutId);

        // If explicitly unauthorized (401), this is a guest/bootstrap token, not a user token
        if (sessRes && sessRes.status === 401) {
          console.log('[TIDAL] Token is unauthenticated guest token (401), ignoring and waiting for user login...');
          return;
        }

        let sess = null;
        if (sessRes && sessRes.ok) {
          sess = await sessRes.json().catch(() => null);
        }

        resolved = true;
        activeTidalFinishLogin = null;
        clearInterval(pollTimer);

        const authData = {
          accessToken: token,
          userId: (sess && sess.userId) ? String(sess.userId) : '',
          sessionId: (sess && sess.sessionId) || '',
          countryCode: (sess && sess.countryCode) || 'TW',
          channel: (sess && sess.channel) || '',
          updatedAt: new Date().toISOString()
        };

        console.log('[TIDAL] Login successfully captured and verified! User ID:', authData.userId || 'Authenticated');
        saveTidalAuth(authData);

        setTimeout(() => {
          try {
            if (authWin && !authWin.isDestroyed()) authWin.close();
          } catch (_) {}
        }, 500);

        resolve({ success: true, auth: authData });
      } catch (err) {
        console.warn('[TIDAL] Session check error:', err);
        // Fallback: if token looks like a valid JWT (starts with eyJ), accept it
        if (!resolved && token.startsWith('eyJ')) {
          resolved = true;
          activeTidalFinishLogin = null;
          clearInterval(pollTimer);
          const authData = {
            accessToken: token,
            countryCode: 'TW',
            updatedAt: new Date().toISOString()
          };
          saveTidalAuth(authData);
          setTimeout(() => {
            try {
              if (authWin && !authWin.isDestroyed()) authWin.close();
            } catch (_) {}
          }, 500);
          resolve({ success: true, auth: authData });
        }
      }
    };

    activeTidalFinishLogin = finishLogin;

    // Helper: extract Bearer token from header dictionary
    const extractBearer = (headers) => {
      if (!headers) return null;
      for (const [k, v] of Object.entries(headers)) {
        if (k.toLowerCase() === 'authorization') {
          const strVal = Array.isArray(v) ? v[0] : String(v);
          if (strVal && strVal.toLowerCase().startsWith('bearer ')) {
            return strVal.slice(7).trim();
          }
        }
      }
      return null;
    };

    // 1. Intercept ALL outgoing requests across all domains in this session
    const filterAll = { urls: ['*://*/*'] };

    const onBeforeHeaders = (details, callback) => {
      const token = extractBearer(details.requestHeaders);
      if (token && !resolved) {
        finishLogin(token, `onBeforeSendHeaders:${details.url}`);
      }
      callback({ requestHeaders: details.requestHeaders });
    };

    const onSentHeaders = (details) => {
      const token = extractBearer(details.requestHeaders);
      if (token && !resolved) {
        finishLogin(token, `onSendHeaders:${details.url}`);
      }
    };

    tidalSession.webRequest.onBeforeSendHeaders(filterAll, onBeforeHeaders);
    tidalSession.webRequest.onSendHeaders(filterAll, onSentHeaders);

    // 2. Active in-page probe function
    const probePage = async () => {
      if (resolved || authWin.isDestroyed()) return;

      // 2-a. Check session cookies for JWT token
      try {
        const cookies = await tidalSession.cookies.get({ domain: '.tidal.com' });
        for (const c of cookies) {
          if (c.value && c.value.startsWith('eyJ') && c.value.length > 30) {
            finishLogin(c.value, `cookie:${c.name}`);
            return;
          }
        }
      } catch (_) {}

      // 2-b. Probe localStorage / sessionStorage / window
      try {
        const pageToken = await authWin.webContents.executeJavaScript(`
          (function() {
            try {
              if (window.__tidal_captured_token__) return window.__tidal_captured_token__;

              const stores = [window.localStorage, window.sessionStorage];
              for (const s of stores) {
                if (!s) continue;
                for (let i = 0; i < s.length; i++) {
                  const k = s.key(i);
                  const v = s.getItem(k);
                  if (!v) continue;

                  // Direct JWT match
                  const m = v.match(/eyJ[A-Za-z0-9_-]{15,}\\.[A-Za-z0-9_-]{15,}\\.[A-Za-z0-9_-]{10,}/);
                  if (m) return m[0];

                  // JSON deep search
                  if (v.includes('token') || v.includes('Token') || v.includes('auth') || v.includes('Auth')) {
                    try {
                      const obj = JSON.parse(v);
                      const search = (o) => {
                        if (!o || typeof o !== 'object') return null;
                        for (const prop in o) {
                          const val = o[prop];
                          if (typeof val === 'string' && val.length > 25) {
                            if (val.startsWith('ey') || prop.toLowerCase().includes('token')) return val;
                          } else if (typeof val === 'object') {
                            const res = search(val);
                            if (res) return res;
                          }
                        }
                        return null;
                      };
                      const found = search(obj);
                      if (found) return found;
                    } catch (_) {}
                  }
                }
              }
            } catch(e) {}
            return null;
          })()
        `).catch(() => null);

        if (pageToken && typeof pageToken === 'string' && pageToken.length > 25 && !resolved) {
          finishLogin(pageToken, 'executeJS:storage');
          return;
        }
      } catch (_) {}

      // 2-c. If already inside listen.tidal.com and not in login form, inject in-page fetch patch & sync button
      try {
        const curUrl = authWin.webContents.getURL();
        if (curUrl && curUrl.includes('listen.tidal.com') && !curUrl.includes('/login')) {
          await authWin.webContents.executeJavaScript(`
            (function() {
              // Monkey patch fetch & XHR to catch the next API request
              if (!window.__tidal_hook_installed__) {
                window.__tidal_hook_installed__ = true;
                const origFetch = window.fetch;
                window.fetch = function(...args) {
                  try {
                    const opts = args[1];
                    if (opts && opts.headers) {
                      let h = opts.headers;
                      let auth = null;
                      if (h instanceof Headers) auth = h.get('authorization') || h.get('Authorization');
                      else if (typeof h === 'object') auth = h['Authorization'] || h['authorization'];
                      if (auth && auth.startsWith('Bearer ')) {
                        window.__tidal_captured_token__ = auth.slice(7).trim();
                      }
                    }
                  } catch(_) {}
                  return origFetch.apply(this, args);
                };

                const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
                XMLHttpRequest.prototype.setRequestHeader = function(header, value) {
                  try {
                    if (header && header.toLowerCase() === 'authorization' && value && value.startsWith('Bearer ')) {
                      window.__tidal_captured_token__ = value.slice(7).trim();
                    }
                  } catch(_) {}
                  return origSetHeader.apply(this, arguments);
                };

                // Trigger a benign internal fetch to provoke token transmission
                try {
                  fetch('https://api.tidal.com/v1/sessions').catch(() => {});
                } catch(_) {}
              }

              // Inject floating sync bar on top of the TIDAL web player
              if (!document.getElementById('rooplayer-sync-banner')) {
                const banner = document.createElement('div');
                banner.id = 'rooplayer-sync-banner';
                banner.style.cssText = 'position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:99999999;background:#000;border:2px solid #00e5ff;padding:8px 18px;border-radius:24px;color:#00e5ff;font-family:sans-serif;font-size:13px;font-weight:bold;cursor:pointer;box-shadow:0 6px 20px rgba(0,229,255,0.4);display:flex;align-items:center;gap:8px;';
                banner.innerHTML = '<span>💎 已進入 TIDAL 首頁？點此立即同步授權至 rooPlayer</span>';
                banner.onclick = function() {
                  banner.innerHTML = '<span>⏳ 正在同步授權...</span>';
                  try { fetch('https://api.tidal.com/v1/sessions').catch(() => {}); } catch(_) {}
                };
                document.body.appendChild(banner);
              }
            })()
          `).catch(() => {});
        }
      } catch (_) {}
    };

    // Run active probe periodically every 1000ms
    const pollTimer = setInterval(probePage, 1000);

    // Event hooks on navigation
    authWin.webContents.on('did-navigate', probePage);
    authWin.webContents.on('did-navigate-in-page', probePage);
    authWin.webContents.on('did-finish-load', probePage);

    // Load official Web Player login entry point
    authWin.loadURL('https://listen.tidal.com/login');

    authWin.on('closed', () => {
      activeTidalAuthWin = null;
      activeTidalFinishLogin = null;
      clearInterval(pollTimer);
      try {
        tidalSession.webRequest.onBeforeSendHeaders(filterAll, null);
        tidalSession.webRequest.onSendHeaders(filterAll, null);
      } catch (_) {}
      if (!resolved) {
        resolve({ success: false, error: '使用者關閉了登入視窗' });
      }
    });
  });
});

// Manual/Immediate Probe Trigger IPC (when user clicks "已完成登入，立即擷取")
ipcMain.handle('tidal:probeAuth', async () => {
  if (activeTidalAuthWin && !activeTidalAuthWin.isDestroyed() && typeof activeTidalFinishLogin === 'function') {
    try {
      const tidalSession = session.fromPartition('persist:tidal');
      // 1. Check cookies
      const cookies = await tidalSession.cookies.get({ domain: '.tidal.com' });
      for (const c of cookies) {
        if (c.value && c.value.startsWith('eyJ') && c.value.length > 30) {
          await activeTidalFinishLogin(c.value, `manualProbe:cookie:${c.name}`);
          return { success: true };
        }
      }

      // 2. Trigger fetch and inspect in page
      const tok = await activeTidalAuthWin.webContents.executeJavaScript(`
        (async function() {
          if (window.__tidal_captured_token__) return window.__tidal_captured_token__;
          for (let i = 0; i < localStorage.length; i++) {
            const v = localStorage.getItem(localStorage.key(i));
            if (!v) continue;
            const m = v.match(/eyJ[A-Za-z0-9_-]{15,}\\.[A-Za-z0-9_-]{15,}\\.[A-Za-z0-9_-]{10,}/);
            if (m) return m[0];
          }
          return null;
        })()
      `).catch(() => null);

      if (tok && typeof tok === 'string' && tok.length > 25) {
        await activeTidalFinishLogin(tok, 'manualProbe:executeJS');
        return { success: true };
      }
    } catch (e) {
      console.warn('[TIDAL] manualProbe error:', e);
    }
  }
  return { success: false, error: '未檢測到登入視窗中的有效授權' };
});

// DLNA / UPnP MediaRenderer IPC handlers
ipcMain.handle('dlna:getDevices', () => {
  return dlnaManager ? dlnaManager.getDeviceList() : [{ id: 'local', name: '本機音訊 (此電腦)', active: true }];
});

// --test-dlna-hint：取得假裝置實際收到的 SOAP 動作序列（斷言重複按播放不會重送指令）
ipcMain.handle('dlna:fakeRendererActions', () => {
  return fakeDlnaRenderer ? fakeDlnaRenderer.actions.map(a => ({ action: a.action, t: a.t, uri: a.uri || '' })) : [];
});

ipcMain.handle('dlna:scan', async () => {
  if (dlnaManager) {
    return await dlnaManager.scanAndDiscover(1000);
  }
  return [];
});

ipcMain.handle('dlna:probeIp', async (event, ip) => {
  if (dlnaManager) {
    const dev = await dlnaManager.probeIp(ip);
    return { success: !!dev, device: dev, devices: dlnaManager.getDeviceList() };
  }
  return { success: false };
});

ipcMain.handle('dlna:selectDevice', (event, deviceId) => {
  if (dlnaManager) {
    return dlnaManager.selectDevice(deviceId);
  }
  return 'local';
});

ipcMain.handle('dlna:playTrack', async (event, deviceId, track, startSec = 0, dspOptions = null) => {
  if (dlnaManager) {
    return await dlnaManager.playTrack(deviceId, track, startSec, dspOptions);
  }
  return { success: false };
});

// NOW PLAYING real-time spectrum: window of the active DSP session's source PCM.
// token null falls back to the most recent local DSP session token.
ipcMain.handle('audio:getSpectrum', (event, token, timeSec) => {
  try {
    return nativeDspStreamer.getSpectrumWindow(token || lastLocalDspToken, timeSec);
  } catch (e) {
    return null;
  }
});

ipcMain.handle('dlna:pause', async (event, deviceId) => {
  if (dlnaManager) {
    await dlnaManager.pause(deviceId);
    return { success: true };
  }
  return { success: false };
});

ipcMain.handle('dlna:resume', async (event, deviceId) => {
  if (dlnaManager) {
    await dlnaManager.resume(deviceId);
    return { success: true };
  }
  return { success: false };
});

ipcMain.handle('dlna:stop', async (event, deviceId) => {
  if (dlnaManager) {
    await dlnaManager.stop(deviceId);
    return { success: true };
  }
  return { success: false };
});

ipcMain.handle('dlna:seek', async (event, deviceId, seconds) => {
  if (dlnaManager) {
    await dlnaManager.seek(deviceId, seconds);
    return { success: true };
  }
  return { success: false };
});

ipcMain.handle('dlna:setVolume', async (event, deviceId, volume) => {
  if (dlnaManager) {
    await dlnaManager.setVolume(deviceId, volume);
    return { success: true };
  }
  return { success: false };
});

// Dialog IPC: Select music folder
ipcMain.handle('dialog:selectFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: '選擇包含音樂檔案的資料夾'
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

// Library scan & persistence
const AUDIO_EXTS = new Set(['.mp3', '.flac', '.wav', '.m4a', '.aac', '.ogg', '.aiff', '.dsf', '.dff', '.wma']);

// canonicalizeGenre is shared with the renderer via genre-utils.js (single source of truth)
const { canonicalizeGenre } = require('./genre-utils.js');

function getAllAudioFiles(dirPath, files = []) {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        getAllAudioFiles(fullPath, files);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (AUDIO_EXTS.has(ext)) {
          files.push(fullPath);
        }
      }
    }
  } catch (err) {
    console.error(`Cannot read dir ${dirPath}:`, err);
  }
  return files;
}

function findFolderCover(filePath) {
  try {
    if (!filePath) return null;
    const dir = path.dirname(filePath);
    const parentDir = path.dirname(dir);
    const priorityNames = [
      'cover.jpg', 'cover.jpeg', 'cover.png',
      'folder.jpg', 'folder.jpeg', 'folder.png',
      'front.jpg', 'front.jpeg', 'front.png',
      'album.jpg', 'album.jpeg', 'album.png',
      'Cover.jpg', 'Folder.jpg', 'Front.jpg', 'Album.jpg'
    ];

    if (fs.existsSync(dir)) {
      for (const name of priorityNames) {
        const p = path.join(dir, name);
        if (fs.existsSync(p)) return toMediaUrl(p);
      }
      const files = fs.readdirSync(dir);
      const matched = files.find(f => /\.(jpe?g|png|webp)$/i.test(f) && /cover|folder|front|art/i.test(f))
                   || files.find(f => /\.(jpe?g|png|webp)$/i.test(f));
      if (matched) return toMediaUrl(path.join(dir, matched));
    }

    if (parentDir && parentDir !== dir && fs.existsSync(parentDir)) {
      for (const name of priorityNames) {
        const p = path.join(parentDir, name);
        if (fs.existsSync(p)) return toMediaUrl(p);
      }
      const files = fs.readdirSync(parentDir);
      const matched = files.find(f => /\.(jpe?g|png|webp)$/i.test(f) && /cover|folder|front|art/i.test(f));
      if (matched) return toMediaUrl(path.join(parentDir, matched));
    }
  } catch (e) {}
  return null;
}

ipcMain.handle('library:scanFolder', async (event, folderPath) => {
  try {
    const { parseFile } = await import('music-metadata');
    const allFiles = getAllAudioFiles(folderPath);
    const total = allFiles.length;
    const tracks = [];
    const albumCoverCache = new Map();

    for (let i = 0; i < total; i++) {
      const filePath = allFiles[i];
      const fileName = path.basename(filePath);
      
      // Notify progress safely to avoid IPC backpressure
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (i % 5 === 0 || i === total - 1) {
          mainWindow.webContents.send('library:scanProgress', {
            current: i + 1,
            total,
            currentFile: fileName
          });
        }
      }

      try {
        const metadata = await parseFile(filePath, { skipCovers: false });
        const common = metadata.common || {};
        const format = metadata.format || {};

        let title = common.title || path.basename(filePath, path.extname(filePath));
        let artist = common.artist || common.albumartist || null;
        let album = common.album || path.basename(path.dirname(filePath)) || 'Unknown Album';
        let year = common.year || null;

        // Smart filename extraction: "01. Artist _ Title" or "01 - Artist - Title"
        const rawBaseName = path.basename(filePath, path.extname(filePath));
        const filenameMatch = rawBaseName.match(/^\d+[\.\-\s]+\s*(.+?)\s*[_—\-]\s*(.+)$/);
        if (filenameMatch) {
          if (!artist || artist === 'Unknown Artist') {
            artist = filenameMatch[1].trim();
          }
          if (!common.title) {
            title = filenameMatch[2].trim();
          }
        }

        // If artist is still unknown, check parent directory name
        if (!artist || artist === 'Unknown Artist') {
          const parentDir = path.dirname(path.dirname(filePath));
          const parentBase = path.basename(parentDir);
          if (parentBase && parentBase.toLowerCase() !== 'rippedalbums' && parentBase !== path.basename(folderPath)) {
            artist = parentBase;
          } else {
            artist = 'Unknown Artist';
          }
        }

        // If year is unknown, check 4-digit year in album or directory name
        if (!year) {
          const yearMatch = (album + ' ' + path.dirname(filePath)).match(/(?:^|\D)(19\d{2}|20\d{2})(?:\D|$)/);
          if (yearMatch) {
            year = parseInt(yearMatch[1], 10);
          }
        }

        // Cache cover once per album/folder to avoid memory and disk duplication
        let coverUrl = null;
        const albumKey = `${artist || ''}___${album || ''}`.trim() || path.dirname(filePath);
        if (albumCoverCache.has(albumKey)) {
          coverUrl = albumCoverCache.get(albumKey);
        } else {
          if (common.picture && common.picture.length > 0) {
            coverUrl = saveCoverPicture(common.picture[0].data, common.picture[0].format);
          }
          if (!coverUrl) {
            coverUrl = findFolderCover(filePath);
          }
          if (coverUrl) {
            albumCoverCache.set(albumKey, coverUrl);
          }
        }

        const ext = path.extname(filePath).replace('.', '').toUpperCase();
        let duration = format.duration || 0;
        if (!duration && (ext === 'DSF' || ext === 'DFF')) {
          duration = getDurationWithNativeHeader(filePath);
        }
        const sampleRate = format.sampleRate || ((ext === 'DSF' || ext === 'DFF') ? 2822400 : 44100);
        const bitsPerSample = format.bitsPerSample || ((ext === 'DSF' || ext === 'DFF') ? 1 : (ext === 'FLAC' ? 24 : 16));
        const isLossless = format.lossless || ['FLAC', 'WAV', 'AIFF', 'DSF', 'DFF', 'ALAC'].includes(ext);

        const labelStr = common.label ? (Array.isArray(common.label) ? common.label.join(', ') : common.label) : null;
        const producerStr = common.producers ? (Array.isArray(common.producers) ? common.producers.join(', ') : common.producers) : (common.producer ? (Array.isArray(common.producer) ? common.producer.join(', ') : common.producer) : null);
        const composerStr = common.composers ? (Array.isArray(common.composers) ? common.composers.join(', ') : common.composers) : (common.composer ? (Array.isArray(common.composer) ? common.composer.join(', ') : common.composer) : null);
        const dateStr = common.date || (common.originalyear ? String(common.originalyear) : null);

        tracks.push({
          id: `track_${Date.now()}_${i}`,
          filePath,
          fileName,
          title,
          artist,
          album,
          albumArtist: common.albumartist || artist,
          year,
          date: dateStr,
          genre: canonicalizeGenre(common.genre ? (Array.isArray(common.genre) ? common.genre.join(', ') : common.genre) : 'Unknown', { title, artist, album, filePath }),
          trackNumber: common.track?.no || (i + 1),
          diskNumber: common.disk?.no || 1,
          duration,
          sampleRate,
          bitsPerSample,
          bitrate: format.bitrate || 0,
          codec: format.codec || ext,
          formatName: ext,
          isLossless,
          cover: coverUrl,
          label: labelStr,
          producer: producerStr,
          composer: composerStr,
          copyright: common.copyright || null
        });
      } catch (err) {
        console.warn(`Failed to parse metadata for ${filePath}:`, err);
        // Fallback track info
        const ext = path.extname(filePath).replace('.', '').toUpperCase();
        let duration = 0;
        if (ext === 'DSF' || ext === 'DFF') {
          duration = getDurationWithNativeHeader(filePath);
        }
        const rawBase = path.basename(filePath, path.extname(filePath));
        const fnMatch = rawBase.match(/^\d+[\.\-\s]+\s*(.+?)\s*[_—\-]\s*(.+)$/);
        const fallbackArtist = fnMatch ? fnMatch[1].trim() : 'Unknown Artist';
        const fallbackTitle = fnMatch ? fnMatch[2].trim() : rawBase;
        const fallbackCover = findFolderCover(filePath);

        tracks.push({
          id: `track_${Date.now()}_${i}`,
          filePath,
          fileName,
          title: fallbackTitle,
          artist: fallbackArtist,
          album: path.basename(path.dirname(filePath)),
          year: null,
          genre: canonicalizeGenre('Unknown', { title: fallbackTitle, artist: fallbackArtist, album: path.basename(path.dirname(filePath)), filePath }),
          trackNumber: i + 1,
          duration,
          sampleRate: (ext === 'DSF' || ext === 'DFF') ? 2822400 : 44100,
          bitsPerSample: (ext === 'DSF' || ext === 'DFF') ? 1 : 16,
          codec: ext,
          formatName: ext,
          isLossless: ['FLAC', 'WAV', 'AIFF', 'DSF', 'DFF'].includes(ext),
          cover: fallbackCover
        });
      }
    }

    // Save library data locally by merging with existing folders
    const { combinedTracks, folders } = saveLibrary(tracks, folderPath);
    return { tracks: combinedTracks, folders, folderPath, newCount: tracks.length };
  } catch (error) {
    console.error('Fatal error during scanFolder:', error);
    return { error: error.message, tracks: [], folders: [] };
  }
});

function saveLibrary(newTracks, folderPath) {
  try {
    const existing = loadLibraryData();
    const folders = existing.folders || [];
    if (!folders.includes(folderPath)) {
      folders.push(folderPath);
    }

    // Filter out previous tracks from THIS folder path to avoid duplicates on re-scan
    let normalizedTarget = path.normalize(folderPath).toLowerCase();
    if (!normalizedTarget.endsWith(path.sep)) normalizedTarget += path.sep;

    const otherTracks = (existing.tracks || []).filter(t => {
      if (t && t.isTidal) return true;
      if (!t || !t.filePath) return false;
      const normalizedTrack = path.normalize(t.filePath).toLowerCase();
      return !normalizedTrack.startsWith(normalizedTarget);
    });

    const combinedTracks = [...otherTracks, ...newTracks];
    const data = {
      updatedAt: new Date().toISOString(),
      folders,
      tracks: combinedTracks
    };
    fs.writeFileSync(LIBRARY_FILE, JSON.stringify(data), 'utf-8');
    return { combinedTracks, folders };
  } catch (err) {
    console.error('Failed to save library data:', err);
    return { combinedTracks: newTracks, folders: [folderPath] };
  }
}

function loadLibraryData() {
  try {
    const userData = app.getPath('userData');
    const roamingDir = path.dirname(userData);
    const candidateFiles = [
      LIBRARY_FILE,
      LEGACY_LIBRARY_FILE,
      path.join(roamingDir, 'roon-media-manager', 'roon_library.json'),
      path.join(roamingDir, 'roon', 'roon_library.json')
    ];

    const trackPathMap = new Map();
    const folderSet = new Set();
    let modified = false;

    for (const candPath of candidateFiles) {
      if (fs.existsSync(candPath)) {
        try {
          const raw = fs.readFileSync(candPath, 'utf-8');
          const data = JSON.parse(raw);
          (data.folders || []).forEach(f => folderSet.add(f));
          (data.tracks || []).forEach(t => {
            if (t && (t.filePath || t.isTidal)) {
              const normKey = t.isTidal ? `tidal_${t.tidalId || t.id}` : path.normalize(t.filePath).toLowerCase();
              if (t.cover && t.cover.startsWith('data:image')) {
                t.cover = sanitizeTrackCover(t.cover);
                modified = true;
              }
              if (!trackPathMap.has(normKey)) {
                trackPathMap.set(normKey, t);
              } else {
                const existing = trackPathMap.get(normKey);
                if (!existing.cover && t.cover) {
                  existing.cover = t.cover;
                }
              }
            }
          });
          // If we read LIBRARY_FILE and found tracks, do not keep reading legacy files
          if (candPath === LIBRARY_FILE && trackPathMap.size > 0) {
            break;
          }
        } catch (e) {
          console.warn(`Error reading candidate library ${candPath}:`, e);
        }
      }
    }

    const mergedTracks = Array.from(trackPathMap.values());
    const dirCoverCache = new Map();

    // Auto-enrich any track missing cover or smart title/artist
    for (const t of mergedTracks) {
      if (!t.cover && t.filePath) {
        const dir = path.dirname(t.filePath);
        let foundCover;
        if (dirCoverCache.has(dir)) {
          foundCover = dirCoverCache.get(dir);
        } else {
          foundCover = findFolderCover(t.filePath);
          dirCoverCache.set(dir, foundCover);
        }
        if (foundCover) {
          t.cover = foundCover;
          modified = true;
        }
      }

      // If artist is Unknown, try smart filename extraction
      if ((!t.artist || t.artist === 'Unknown Artist') && t.fileName) {
        const rawBase = path.basename(t.fileName, path.extname(t.fileName));
        const fnMatch = rawBase.match(/^\d+[\.\-\s]+\s*(.+?)\s*[_—\-]\s*(.+)$/);
        if (fnMatch) {
          t.artist = fnMatch[1].trim();
          if (!t.title || t.title === rawBase) {
            t.title = fnMatch[2].trim();
          }
          modified = true;
        }
      }

      // Canonicalize genre to prevent duplicate/unmapped categories
      const canonGenre = canonicalizeGenre(t.genre, t);
      if (t.genre !== canonGenre) {
        t.genre = canonGenre;
        modified = true;
      }
    }

    const finalResult = {
      updatedAt: new Date().toISOString(),
      folders: Array.from(folderSet),
      tracks: mergedTracks
    };

    if (mergedTracks.length > 0 && modified) {
      try {
        fs.writeFileSync(LIBRARY_FILE, JSON.stringify(finalResult), 'utf-8');
      } catch (err) {
        console.warn('Failed to rewrite sanitized library file:', err);
      }
    }

    return finalResult;
  } catch (err) {
    console.error('Failed to load library:', err);
  }
  return { folders: [], tracks: [] };
}

ipcMain.handle('library:loadSaved', () => loadLibraryData());

ipcMain.handle('library:removeFolder', async (event, folderPath) => {
  const existing = loadLibraryData();
  let normalizedTarget = path.normalize(folderPath).toLowerCase();
  if (!normalizedTarget.endsWith(path.sep)) normalizedTarget += path.sep;

  const remainingTracks = (existing.tracks || []).filter(t => {
    if (t && t.isTidal) return true;
    if (!t || !t.filePath) return false;
    const normalizedTrack = path.normalize(t.filePath).toLowerCase();
    return !normalizedTrack.startsWith(normalizedTarget);
  });

  const remainingFolders = (existing.folders || []).filter(f => {
    let normF = path.normalize(f).toLowerCase();
    if (!normF.endsWith(path.sep)) normF += path.sep;
    return normF !== normalizedTarget;
  });

  const data = {
    updatedAt: new Date().toISOString(),
    folders: remainingFolders,
    tracks: remainingTracks
  };
  fs.writeFileSync(LIBRARY_FILE, JSON.stringify(data), 'utf-8');
  return data;
});

ipcMain.handle('library:saveTracks', async (event, tracks) => {
  try {
    const existing = loadLibraryData();
    const data = {
      updatedAt: new Date().toISOString(),
      folders: existing.folders || [],
      tracks: Array.isArray(tracks) ? tracks : []
    };
    fs.writeFileSync(LIBRARY_FILE, JSON.stringify(data), 'utf-8');
    return { success: true, count: data.tracks.length };
  } catch (err) {
    console.error('Failed to save library tracks:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('library:updateAlbumArtist', async (event, albumTitle, artistName) => {
  try {
    const existing = loadLibraryData();
    let changed = false;
    (existing.tracks || []).forEach(t => {
      if (t.album === albumTitle && (!t.artist || t.artist === 'Unknown Artist' || t.artist === '未知演出者' || t.artist === '未知歌手' || t.artist.trim().toLowerCase() === 'unknown')) {
        t.artist = artistName;
        if (!t.albumArtist || t.albumArtist === 'Unknown Artist') t.albumArtist = artistName;
        changed = true;
      }
    });
    if (changed) {
      existing.updatedAt = new Date().toISOString();
      fs.writeFileSync(LIBRARY_FILE, JSON.stringify(existing), 'utf-8');
    }
    return { success: true, changed };
  } catch (err) {
    console.error('Failed to update album artist:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('library:export', async (event, defaultFilename, extraData) => {
  try {
    const existing = loadLibraryData();
    const d = new Date();
    const dateStr = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
    const defaultName = defaultFilename || `rooplayer_library_backup_${dateStr}.json`;

    const result = await dialog.showSaveDialog(mainWindow, {
      title: '匯出音樂資料庫與資料夾設定',
      defaultPath: defaultName,
      filters: [
        { name: 'JSON 資料庫備份 (*.json)', extensions: ['json'] },
        { name: '所有檔案 (*.*)', extensions: ['*'] }
      ]
    });

    if (result.canceled || !result.filePath) {
      return { canceled: true };
    }

    const exportPayload = {
      app: 'rooPlayer',
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      folders: existing.folders || [],
      tracks: existing.tracks || [],
      favorites: (extraData && extraData.favorites) ? extraData.favorites : { albums: [], tracks: [], artists: [] },
      playStats: (extraData && extraData.playStats) ? extraData.playStats : { albums: {}, tracks: {} },
      playbackHistory: (extraData && extraData.playbackHistory) ? extraData.playbackHistory : [],
      recentlyPlayedAlbums: (extraData && extraData.recentlyPlayedAlbums) ? extraData.recentlyPlayedAlbums : []
    };

    fs.writeFileSync(result.filePath, JSON.stringify(exportPayload, null, 2), 'utf-8');

    return {
      success: true,
      filePath: result.filePath,
      folderCount: (exportPayload.folders || []).length,
      trackCount: (exportPayload.tracks || []).length,
      favoriteCounts: {
        albums: (exportPayload.favorites.albums || []).length,
        tracks: (exportPayload.favorites.tracks || []).length,
        artists: (exportPayload.favorites.artists || []).length
      },
      historyCount: (exportPayload.playbackHistory || []).length,
      recentAlbumCount: (exportPayload.recentlyPlayedAlbums || []).length
    };
  } catch (err) {
    console.error('Failed to export library:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('library:import', async () => {
  try {
    const dialogRes = await dialog.showOpenDialog(mainWindow, {
      title: '選取要匯入的音樂資料庫備份檔',
      properties: ['openFile'],
      filters: [
        { name: 'JSON 資料庫備份 (*.json)', extensions: ['json'] },
        { name: '所有檔案 (*.*)', extensions: ['*'] }
      ]
    });

    if (dialogRes.canceled || !dialogRes.filePaths.length) {
      return { canceled: true };
    }

    const importFilePath = dialogRes.filePaths[0];
    const fileContent = fs.readFileSync(importFilePath, 'utf-8');
    let importedData = null;
    try {
      importedData = JSON.parse(fileContent);
    } catch (parseErr) {
      return { success: false, error: '所選檔案不是有效的 JSON 格式！' };
    }

    if (!importedData || (!Array.isArray(importedData.tracks) && !Array.isArray(importedData.folders))) {
      return { success: false, error: 'JSON 檔案中未發現有效的 tracks 或 folders 結構！' };
    }

    const currentLib = loadLibraryData();
    const currentFolders = Array.isArray(currentLib.folders) ? currentLib.folders : [];
    const currentTracks = Array.isArray(currentLib.tracks) ? currentLib.tracks : [];

    // Folder deduplication map (normalized path)
    const folderNormMap = new Map();
    currentFolders.forEach(f => {
      const folderPathStr = typeof f === 'string' ? f : (f && (f.path || f.folderPath) ? (f.path || f.folderPath) : '');
      if (typeof folderPathStr === 'string' && folderPathStr.trim()) {
        const norm = path.normalize(folderPathStr.trim()).toLowerCase();
        folderNormMap.set(norm, folderPathStr.trim());
      }
    });

    // Track deduplication maps (by filePath and by artist + album + trackNumber + title)
    const trackFilePathMap = new Map();
    const trackMetaSet = new Set();

    currentTracks.forEach(t => {
      if (t) {
        if (t.filePath) {
          const normP = path.normalize(t.filePath).toLowerCase();
          trackFilePathMap.set(normP, t);
        }
        const art = (t.artist || '').trim().toLowerCase();
        const alb = (t.album || '').trim().toLowerCase();
        const tit = (t.title || '').trim().toLowerCase();
        const trkNum = t.trackNumber != null ? String(t.trackNumber).trim() : '';
        if (art && tit) {
          trackMetaSet.add(`${art}:::${alb}:::${trkNum}:::${tit}`);
        }
      }
    });

    // Detailed report structures
    const report = {
      importedFile: importFilePath,
      folders: {
        totalInImport: 0,
        added: [],
        skipped: [] // { path, reason }
      },
      tracks: {
        totalInImport: 0,
        addedCount: 0,
        skippedCount: 0,
        skipped: [] // { title, artist, filePath, reason }
      }
    };

    const mergedFolders = [...currentFolders];
    const mergedTracks = [...currentTracks];

    // 1. Process imported folders (compatible with strings and objects)
    const importFolders = Array.isArray(importedData.folders) ? importedData.folders : [];
    report.folders.totalInImport = importFolders.length;

    for (const rawF of importFolders) {
      if (!rawF) continue;
      const folderPathStr = typeof rawF === 'string' ? rawF : (rawF.path || rawF.folderPath || '');
      if (!folderPathStr || typeof folderPathStr !== 'string' || !folderPathStr.trim()) continue;
      const trimmedF = folderPathStr.trim();
      const normF = path.normalize(trimmedF).toLowerCase();

      if (folderNormMap.has(normF)) {
        report.folders.skipped.push({
          path: trimmedF,
          reason: '資料夾已存在於目前音樂庫中'
        });
      } else {
        folderNormMap.set(normF, trimmedF);
        mergedFolders.push(trimmedF);
        report.folders.added.push(trimmedF);
      }
    }

    // 2. Process imported tracks with album-aware deduplication
    const importTracks = Array.isArray(importedData.tracks) ? importedData.tracks : [];
    report.tracks.totalInImport = importTracks.length;
    const dirCoverCache = new Map();

    for (const t of importTracks) {
      if (!t) continue;
      const tPath = t.filePath ? path.normalize(t.filePath).toLowerCase() : '';
      const tArt = (t.artist || '').trim().toLowerCase();
      const tAlb = (t.album || '').trim().toLowerCase();
      const tTit = (t.title || '').trim().toLowerCase();
      const tTrkNum = t.trackNumber != null ? String(t.trackNumber).trim() : '';
      const metaKey = (tArt && tTit) ? `${tArt}:::${tAlb}:::${tTrkNum}:::${tTit}` : '';

      let isDuplicate = false;
      let skipReason = '';

      if (tPath && trackFilePathMap.has(tPath)) {
        isDuplicate = true;
        skipReason = `檔案路徑已存在 (${t.filePath})`;
      } else if (metaKey && trackMetaSet.has(metaKey)) {
        isDuplicate = true;
        skipReason = `專輯與曲目重複 (${t.artist || '未知'} - [${t.album || '未知'}] ${t.title || '未知'})`;
      }

      if (isDuplicate) {
        report.tracks.skippedCount++;
        report.tracks.skipped.push({
          title: t.title || t.fileName || '未知曲目',
          artist: t.artist || '未知演出者',
          album: t.album || '未知專輯',
          filePath: t.filePath || '',
          reason: skipReason
        });
      } else {
        if (tPath) trackFilePathMap.set(tPath, t);
        if (metaKey) trackMetaSet.add(metaKey);

        // Sanitize / recover cover
        if (t.cover) {
          t.cover = sanitizeTrackCover(t.cover);
          if (typeof t.cover === 'string' && t.cover.startsWith('file://')) {
            try {
              const localCoverPath = fileURLToPath(t.cover);
              if (!fs.existsSync(localCoverPath) && t.filePath) {
                t.cover = null;
              }
            } catch (_) {}
          }
        }
        if (!t.cover && t.filePath) {
          const dir = path.dirname(t.filePath);
          let foundCover;
          if (dirCoverCache.has(dir)) {
            foundCover = dirCoverCache.get(dir);
          } else {
            foundCover = findFolderCover(t.filePath);
            dirCoverCache.set(dir, foundCover);
          }
          if (foundCover) t.cover = foundCover;
        }

        mergedTracks.push(t);
        report.tracks.addedCount++;
      }
    }

    // Save merged result to LIBRARY_FILE
    const finalLib = {
      updatedAt: new Date().toISOString(),
      folders: mergedFolders,
      tracks: mergedTracks
    };
    fs.writeFileSync(LIBRARY_FILE, JSON.stringify(finalLib), 'utf-8');

    return {
      success: true,
      data: finalLib,
      importedFavorites: importedData.favorites || null,
      importedPlayStats: importedData.playStats || null,
      importedPlaybackHistory: Array.isArray(importedData.playbackHistory) ? importedData.playbackHistory : null,
      importedRecentlyPlayedAlbums: Array.isArray(importedData.recentlyPlayedAlbums) ? importedData.recentlyPlayedAlbums : null,
      report
    };
  } catch (err) {
    console.error('Failed to import library:', err);
    return { success: false, error: err.message };
  }
});
