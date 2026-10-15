// exclusive-output.js — WASAPI 獨佔模式輸出管理器（主行程）。
//
// 角色：把 tools/rp-wasapi-exclusive.cs 編譯成暫存執行檔、探測輸出裝置的獨佔能力，
// 並管理 helper 行程的生命週期與事件（ready/pos/paused/eof/fail）。
// 音訊資料來源就是引擎已有的 /sox-stream、/dsd-stream（Range 可分段），
// 因此引擎不需要任何輸出格式改動；獨佔失敗時呼叫端自動退回共享模式。
'use strict';

const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const HELPER_SRC = 'rp-wasapi-exclusive.cs';
const HELPER_EXE = 'rp-wasapi-exclusive.exe';
// 引擎 session 的 WAV 檔頭固定 44 bytes（native-dsp-streamer 已驗證），byte seek 直接換算
const WAV_HEADER_BYTES = 44;
const SRC_BLOCK_ALIGN = 6; // 24-bit stereo

function findCsc() {
  const windir = process.env.WINDIR || 'C:\\Windows';
  const candidates = [
    path.join(windir, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
    path.join(windir, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe')
  ];
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch (e) {}
  }
  return null;
}

class ExclusiveOutput {
  constructor(appRoot, cacheDir) {
    this.appRoot = appRoot;
    this.cacheDir = cacheDir;
    this.proc = null;
    this.capability = null;   // probe 結果（含 deviceId / supported[]）
    this.probedAt = 0;
    this.currentRate = 0;     // 目前 helper 使用的取樣率
    this.onEvent = () => {};
    this.lastError = null;
    this.compiling = null;
    this.sawEof = false;      // helper 正常播完後自行退出（exit 0）屬預期，不當成故障
    this.expectedExit = false;
  }

  get srcPath() { return path.join(this.appRoot, 'tools', HELPER_SRC); }
  get exePath() { return path.join(this.cacheDir, HELPER_EXE); }

  // 需要時用 Windows 內建 csc 編譯 helper（.cs 較新才重編），不引入任何 npm 原生相依。
  ensureHelper() {
    const src = this.srcPath;
    const exe = this.exePath;
    if (!fs.existsSync(src)) return null;
    let needBuild = true;
    try {
      if (fs.existsSync(exe)) {
        needBuild = fs.statSync(src).mtimeMs > fs.statSync(exe).mtimeMs;
      }
    } catch (e) { needBuild = true; }
    if (!needBuild) return exe;

    const csc = findCsc();
    if (!csc) {
      this.lastError = { code: 'RP-NOCSC', msg: '找不到 Windows 內建 csc.exe，無法建立獨佔輸出元件' };
      return null;
    }
    try { fs.mkdirSync(this.cacheDir, { recursive: true }); } catch (e) {}
    const res = spawnSync(csc, ['/nologo', '/optimize+', '/target:exe', '/out:' + exe, src], {
      encoding: 'utf8', windowsHide: true, timeout: 120000
    });
    if (res.status !== 0 || !fs.existsSync(exe)) {
      this.lastError = { code: 'RP-COMPILE', msg: '編譯獨佔輸出元件失敗: ' + String((res.stdout || '') + (res.stderr || '')).slice(0, 400) };
      return null;
    }
    return exe;
  }

  // 探測預設（或指定）播放裝置的獨佔格式能力；結果快取，裝置拔插後由渲染端要求重探。
  probe(force = false) {
    if (!force && this.capability && Date.now() - this.probedAt < 300000) return this.capability;
    const exe = this.ensureHelper();
    if (!exe) {
      this.capability = { ok: false, code: (this.lastError && this.lastError.code) || 'RP-NOHELPER', msg: (this.lastError && this.lastError.msg) || 'helper 無法建立' };
      return this.capability;
    }
    let res;
    try {
      res = spawnSync(exe, ['--probe'], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
    } catch (e) {
      this.capability = { ok: false, code: 'RP-PROBE', msg: String(e.message || e) };
      return this.capability;
    }
    const parsed = parseLastJson(res.stdout || '');
    if (!parsed || parsed.ev !== 'probe') {
      this.capability = { ok: false, code: 'RP-PROBE', msg: '獨佔能力探測失敗: ' + String(res.stderr || '').slice(0, 200) };
      return this.capability;
    }
    this.capability = parsed;
    this.probedAt = Date.now();
    return this.capability;
  }

  invalidateProbe() { this.capability = null; this.probedAt = 0; }

  // 依裝置能力選出可用的獨取樣率：偏好 ≥ 來源取樣率裡最接近目標者。
  pickRate(supportedRates, targetRate, sourceRate) {
    const rates = (supportedRates || []).map(r => Number(r) || 0).filter(r => r > 0);
    if (!rates.length) return null;
    rates.sort((a, b) => b - a);
    const floor = Math.max(1, Number(sourceRate) || 1);
    const atLeast = rates.filter(r => r >= floor);
    if (!atLeast.length) return null; // 裝置最高獨佔率 < 來源取樣率：不支援，退回共享
    const target = Number(targetRate) || floor;
    // 先找 ≥ target 的最小者（不無謂升頻），沒有就拿 ≤ target 的最大者
    const up = atLeast.filter(r => r >= target).sort((a, b) => a - b);
    if (up.length) return up[0];
    return atLeast[0];
  }

  isBusy() { return !!this.proc; }

  start({ url, rate, startByte = 0, deviceId = '' }) {
    this.kill();
    const exe = this.ensureHelper();
    if (!exe) return { ok: false, code: (this.lastError && this.lastError.code) || 'RP-NOHELPER', msg: (this.lastError && this.lastError.msg) || 'helper 無法建立' };
    if (!url) return { ok: false, code: 'RP-NOURL', msg: '缺少串流 URL' };
    const args = ['--url', url, '--rate', String(rate)];
    if (deviceId) args.push('--device', deviceId);
    if (startByte > 0) args.push('--start-byte', String(startByte));
    let proc;
    try {
      proc = spawn(exe, args, { windowsHide: true });
    } catch (e) {
      return { ok: false, code: 'RP-SPAWN', msg: String(e.message || e) };
    }
    this.proc = proc;
    this.currentRate = rate;
    this.lastError = null;
    this.sawEof = false;
    this.expectedExit = false;

    let buf = '';
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let obj = null;
        try { obj = JSON.parse(line); } catch (e) { continue; }
        if (obj && obj.ev === 'fail') this.lastError = obj;
        if (obj && obj.ev === 'eof') this.sawEof = true;
        try { this.onEvent(obj); } catch (e) {}
      }
    });
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (d) => { console.error('[ExclusiveOutput] ' + String(d).trim()); });
    proc.on('exit', (code, signal) => {
      const wasCurrent = this.proc === proc;
      if (wasCurrent) this.proc = null;
      // 正常播完（收到 eof 後 exit 0）或我們主動要求退出，都不算故障
      if (wasCurrent && !this.expectedExit && !(this.sawEof && code === 0)) {
        const err = this.lastError || { code: 'RP-EXIT', msg: '獨佔輸出行程意外結束 (code=' + code + ')' };
        try { this.onEvent({ ev: 'crashed', code: err.code || 'RP-EXIT', msg: err.msg || '獨佔輸出失敗', exitCode: code, signal: signal || '' }); } catch (e) {}
      }
      this.expectedExit = false;
    });
    proc.on('error', (e) => {
      this.lastError = { code: 'RP-PROC', msg: String(e.message || e) };
    });
    return { ok: true, rate };
  }

  writeCmd(line) {
    if (!this.proc || !this.proc.stdin || this.proc.killed) return false;
    try { this.proc.stdin.write(line + '\n'); return true; } catch (e) { return false; }
  }

  pause() { return this.writeCmd('pause'); }
  resume() { return this.writeCmd('resume'); }

  // 串流內相對秒 ➔ WAV byte（檔頭 44 bytes，24-bit stereo）
  seek(streamSeconds) {
    const sec = Math.max(0, Number(streamSeconds) || 0);
    if (!this.currentRate) return false;
    const byte = WAV_HEADER_BYTES + Math.round(sec * this.currentRate * SRC_BLOCK_ALIGN);
    return this.writeCmd('seek ' + byte);
  }

  // 正常停止：請 helper 自行 Stop/Reset 後退出行程（保留裝置狀態乾淨）
  stop() {
    if (!this.proc) return true;
    this.expectedExit = true;
    const proc = this.proc;
    this.writeCmd('quit');
    setTimeout(() => { try { if (!proc.killed) proc.kill(); } catch (e) {} }, 1500);
    return true;
  }

  // 強制結束（換軌 / 退出 / 退回共享模式）
  kill() {
    if (!this.proc) return;
    const proc = this.proc;
    this.proc = null;
    this.expectedExit = true;
    try { proc.kill(); } catch (e) {}
  }
}

function parseLastJson(text) {
  const lines = String(text || '').split('\n').map(l => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i][0] !== '{') continue;
    try {
      const obj = JSON.parse(lines[i]);
      if (obj && obj.ev) return obj;
    } catch (e) {}
  }
  return null;
}

module.exports = ExclusiveOutput;
module.exports.findCsc = findCsc;
