// ==========================================
// rooPlayer - DLNA / UPnP MediaRenderer Subsystem
// Automatic SSDP Discovery & LAN Audio Streaming Engine
// ==========================================

const dgram = require('dgram');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const EventEmitter = require('events');
const { fileURLToPath } = require('url');

// Robust helper to resolve file://, media://, and plain local paths on Windows & POSIX
function resolveLocalCoverPath(src) {
  if (!src || typeof src !== 'string') return null;
  src = src.trim();
  if (src.startsWith('data:') || src.startsWith('http://') || src.startsWith('https://')) {
    return null;
  }
  if (src.startsWith('file://')) {
    try {
      return fileURLToPath(src);
    } catch (e) {
      let clean = src.replace(/^file:\/\/\/?/, '');
      clean = decodeURIComponent(clean);
      if (/^[a-zA-Z]:[\\/]/.test(clean)) {
        return clean.replace(/\//g, '\\');
      }
      return '/' + clean;
    }
  }
  if (src.startsWith('media://')) {
    let clean = src.replace(/^media:\/\/\/?/i, '');
    clean = decodeURIComponent(clean);
    if (/^[a-zA-Z]:[\\/]/.test(clean)) {
      return clean.replace(/\//g, '\\');
    }
    return '/' + clean;
  }
  return src;
}

class DlnaManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.devices = new Map(); // id -> device details
    this.activeDeviceId = 'local'; // 'local' or device.id
    this.currentTrack = null;
    this.currentStreamToken = null;
    this.streamingServer = null;
    this.streamingPort = 0;
    this.ssdpSocket = null;
    this.scanInterval = null;
    this.positionTimer = null;
    this.playbackState = 'STOPPED'; // STOPPED | PLAYING | PAUSED_PLAYBACK
    this.currentPositionSec = 0;
    this.currentDurationSec = 0;
    this.trackPlayTimestamp = 0;
    this.hasStartedPlaying = false;
    this.currentDspOptions = null;
    this.coverCache = new Map(); // key -> { mimeType, buffer }
    this._pendingCoverPromises = new Map(); // key -> Promise
    this.activeStreams = new Map(); // token -> streamInfo
    this.nativeDspStreamer = options.nativeDspStreamer || require('./native-dsp-streamer');
    this.currentStreamSession = null;
    this._playOpCounter = 0;
    this._activePlayPromise = null;
    this._pollSessionCounter = 0;

    // 串流準備進度（送給渲染端顯示「記憶體緩衝中」提示，避免使用者以為失敗而一直按播放鍵）
    this._prepareTimer = null;
    this._prepareT0 = 0;
    this._prepareSession = null;
    this._prepareStage = '';
    this._prepareTrack = null;
    this._playAnnounced = false;
    this.PREPARE_TARGET_SEC = 2.5; // 自適應目標：PCM升頻約 2.0-2.5 秒即可極速平滑開播
    this.PREPARE_TARGET_DSD_SEC = 4.0; // DSD 調變運算密度較高，給予 4.0 秒安全緩衝
    this.PREPARE_MAX_WAIT_MS = 8000; // 縮短最大等待上限，不再讓使用者無謂乾等
    // HTTP Agent 啟用 keepAlive 持久連線，消除每次 SOAP 請求重建 TCP 的延遲與丟包
    this.httpAgent = new http.Agent({
      keepAlive: true,
      maxSockets: 20,
      keepAliveMsecs: 15000,
      timeout: 10000
    });
  }

  // ---- 串流準備階段事件（stage: preparing / buffer / opening / playing / failed） ----
  emitPrepare(extra) {
    if (!this._prepareT0) return;
    const payload = Object.assign({
      stage: this._prepareStage,
      elapsedMs: Date.now() - this._prepareT0,
      title: (this._prepareTrack && (this._prepareTrack.title || this._prepareTrack.fileName)) || '',
    }, extra || {});
    this.emit('prepare-status', payload);
  }

  // 目前引擎 session 已緩衝多少（換算成秒與 MB，給 UI 用）
  prepareBufferStats() {
    const s = this._prepareSession || this.currentStreamSession;
    if (!s) return null;
    const total = Number(s.totalFileBytes) || 0;
    const written = Number(s.bytesWritten) || 0;
    const dur = Number(s.durationSec) || 0;
    if (total <= 0 || dur <= 0) return null;
    const ratio = Math.max(0, Math.min(1, written / total));
    return {
      bufferedSec: dur * ratio,
      bufferedMB: written / 1048576,
      totalMB: total / 1048576,
      totalSec: dur,
      ratio,
      done: !!s.isCompleted,
    };
  }

  startPrepareTracking(track, dev) {
    this.stopPrepareTracking();
    this._prepareT0 = Date.now();
    this._prepareSession = null;
    this._prepareTrack = track;
    this._prepareStage = 'preparing';
    this._playAnnounced = false;
    this.emitPrepare({ deviceName: (dev && dev.friendlyName) || (dev && dev.name) || '' });
    // 每 250ms 回報一次：引擎 session 一出現就改成回報實際緩衝量
    this._prepareTimer = setInterval(() => {
      const stats = this.prepareBufferStats();
      if (stats) {
        this._prepareStage = 'buffer';
        this.emitPrepare({
          bufferedSec: Number(stats.bufferedSec.toFixed(2)),
          bufferedMB: Number(stats.bufferedMB.toFixed(1)),
          totalMB: Number(stats.totalMB.toFixed(1)),
          targetSec: Math.min(this.PREPARE_TARGET_SEC, Number(stats.totalSec.toFixed(2))),
          ratio: Number(stats.ratio.toFixed(4)),
        });
      } else {
        this.emitPrepare();
      }
    }, 250);
  }

  stopPrepareTracking(finalStage, extra) {
    if (this._prepareTimer) {
      clearInterval(this._prepareTimer);
      this._prepareTimer = null;
    }
    if (finalStage) {
      this._prepareStage = finalStage;
      this.emitPrepare(extra);
    }
    this._prepareT0 = 0;
    this._prepareStage = '';
    this._prepareSession = null;
    this._prepareTrack = null;
  }

  // Play 之前的記憶體緩衝：自適應等待目標秒數寫入 session（直通 0s、PCM 2.5s、DSD 4s）
  async waitForPrepareBuffer(opId, isDsd = false) {
    const baseTarget = isDsd ? this.PREPARE_TARGET_DSD_SEC : this.PREPARE_TARGET_SEC;
    const targetSec = Math.min(baseTarget, (this.currentStreamSession && this.currentStreamSession.durationSec) || baseTarget);
    const t0 = Date.now();
    while (Date.now() - t0 < this.PREPARE_MAX_WAIT_MS) {
      if (opId !== this._playOpCounter) return false;
      const s = this.currentStreamSession;
      if (!s || s.isCancelled || s.isCompleted) return true;
      const stats = this.prepareBufferStats();
      if (!stats) return true; // 非漸進式 session（直通串流）：沒有緩衝可等，立即開播
      if (stats.bufferedSec >= targetSec) return true;
      await new Promise(r => setTimeout(r, 60)); // 縮短輪詢間隔為 60ms，達標瞬間立即釋放
    }
    console.warn(`[DLNA] 準備緩衝等待達門檻或逾時（${Date.now() - t0}ms），直接通知播放`);
    return false;
  }

  // Determine machine's local LAN IPv4 address
  getLocalIp(targetDeviceIp = null) {
    const interfaces = os.networkInterfaces();
    let fallback = '127.0.0.1';

    // If target device IP provided, prioritize network interface on the same subnet
    if (targetDeviceIp && typeof targetDeviceIp === 'string') {
      const parts = targetDeviceIp.split('.');
      if (parts.length === 4) {
        const prefix3 = `${parts[0]}.${parts[1]}.${parts[2]}.`;
        const prefix2 = `${parts[0]}.${parts[1]}.`;
        for (const [name, addrs] of Object.entries(interfaces)) {
          for (const a of addrs) {
            if (a.family === 'IPv4' && !a.internal) {
              if (a.address.startsWith(prefix3)) return a.address;
              if (a.address.startsWith(prefix2)) return a.address;
            }
          }
        }
      }
    }

    for (const [name, addrs] of Object.entries(interfaces)) {
      for (const a of addrs) {
        if (a.family === 'IPv4' && !a.internal) {
          // Prioritize typical home/office LAN subnets (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
          if (a.address.startsWith('192.168.') || a.address.startsWith('10.') || /^172\.(1[6-9]|2\d|3[01])\./.test(a.address)) {
            return a.address;
          }
          fallback = a.address;
        }
      }
    }
    return fallback;
  }

  // Start internal LAN HTTP audio streaming server
  startStreamingServer() {
    if (this.streamingServer && this.streamingPort > 0) {
      return Promise.resolve(this.streamingPort);
    }
    if (this._startServerPromise) {
      return this._startServerPromise;
    }

    this._startServerPromise = new Promise((resolve, reject) => {
      this.streamingServer = http.createServer((req, res) => {
        try {
          const reqUrl = new URL(req.url, 'http://127.0.0.1');
          const pathname = reqUrl.pathname;

          const streamMatch = pathname.match(/^\/stream\/([^\/]+)/);
          const coverMatch = pathname.match(/^\/cover\/([^\/]+)/);

          if (streamMatch || pathname === '/stream' || pathname === '/stream/') {
            const token = streamMatch ? streamMatch[1] : null;
            const streamInfo = token ? this.activeStreams.get(token) : null;
            const filePath = (streamInfo && streamInfo.filePath) || reqUrl.searchParams.get('file');
            if (!filePath || !fs.existsSync(filePath)) {
              res.writeHead(404);
              res.end('File not found');
              return;
            }
            // 防禦性檢查：僅允許音訊白名單副檔名，防止透過 URL 參數讀取本機系統敏感檔案 (Path Traversal)
            const audioExt = path.extname(filePath).toLowerCase();
            const allowedAudioExts = new Set(['.flac', '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.aiff', '.dsf', '.dff', '.wma']);
            if (!allowedAudioExts.has(audioExt)) {
              res.writeHead(403);
              res.end('Access denied');
              return;
            }
            this.handleLocalAudioStream(req, res, filePath, token);
          } else if (
            coverMatch ||
            pathname === '/cover' ||
            pathname === '/cover/' ||
            pathname === '/cover.jpg' ||
            pathname === '/cover.png' ||
            pathname === '/albumart.jpg' ||
            pathname === '/artwork.jpg'
          ) {
            let token = coverMatch ? coverMatch[1] : null;
            if (token && (token === 'cover.jpg' || token === 'cover.png' || token === 'cover')) {
              token = null;
            }
            const streamInfo = token ? this.activeStreams.get(token) : (this.currentStreamToken ? this.activeStreams.get(this.currentStreamToken) : null);
            const effectiveToken = token || this.currentStreamToken;
            const track = (streamInfo && streamInfo.track) || this.currentTrack;
            const filePath = (track && track.filePath) || (streamInfo && streamInfo.filePath) || reqUrl.searchParams.get('file');
            // 防禦性檢查：若指定了 filePath，限制為合法檔案
            if (filePath && !fs.existsSync(filePath)) {
              res.writeHead(404);
              res.end('Cover not found');
              return;
            }
            this.handleCoverImage(req, res, filePath, track, effectiveToken).catch(err => {
              console.error('[DLNA] handleCoverImage error:', err);
              if (!res.headersSent) {
                res.writeHead(500);
                res.end('Cover error');
              }
            });
          } else {
            res.writeHead(404);
            res.end('Not found');
          }
        } catch (err) {
          console.error('DLNA Stream server error:', err);
          if (!res.headersSent) {
            res.writeHead(500);
            res.end('Server error');
          }
        }
      });

      // Listen on 0.0.0.0 so all LAN DLNA renderers can reach it
      this.streamingServer.listen(0, '0.0.0.0', () => {
        this.streamingPort = this.streamingServer.address().port;
        console.log(`[DLNA] Streaming Server listening on LAN http://${this.getLocalIp()}:${this.streamingPort}`);
        this._startServerPromise = null;
        resolve(this.streamingPort);
      });

      this.streamingServer.on('error', (err) => {
        console.error('[DLNA] Streaming Server error:', err);
        this._startServerPromise = null;
        reject(err);
      });
    });

    return this._startServerPromise;
  }

  // Handle audio file stream with HTTP 206 Partial Content Range and Progressive Flow Control
  handleLocalAudioStream(req, res, filePath, token = null) {
    const session = token ? this.nativeDspStreamer.getSession(token) : Array.from(this.nativeDspStreamer.activeSessions.values()).find(s => s.filePath === filePath);
    const totalSize = (session && session.totalFileBytes) ? session.totalFileBytes : fs.statSync(filePath).size;
    const range = req.headers.range;
    const ext = path.extname(filePath).toLowerCase();

    const mimeMap = {
      '.flac': 'audio/flac',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.m4a': 'audio/mp4',
      '.aac': 'audio/aac',
      '.ogg': 'audio/ogg',
      '.aiff': 'audio/aiff',
      '.dsf': 'audio/x-dsf',
      '.dff': 'audio/x-dff'
    };
    const contentType = mimeMap[ext] || 'audio/flac';
    const commonHeaders = {
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'transferMode.dlna.org': 'Streaming',
      'contentFeatures.dlna.org': 'DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000',
      'Access-Control-Allow-Origin': '*'
    };

    if (req.method === 'HEAD') {
      res.writeHead(200, {
        ...commonHeaders,
        'Content-Length': totalSize
      });
      res.end();
      return;
    }

    // 關鍵優化：配置 TCP Socket 參數，關閉 Nagle's 演算法（避免高取樣率微小排隊延遲與抖動），並啟用 TCP Keep-Alive
    if (res.socket) {
      try {
        res.socket.setNoDelay(true);
        res.socket.setKeepAlive(true, 30000);
      } catch (e) {}
    }

    const ProgressiveFileStream = this.nativeDspStreamer.ProgressiveFileStream;
    const isProgressive = session && !session.isCompleted && ProgressiveFileStream;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;
      const chunkSize = (end - start) + 1;

      res.writeHead(206, {
        ...commonHeaders,
        'Content-Range': `bytes ${start}-${end}/${totalSize}`,
        'Content-Length': chunkSize
      });

      const stream = isProgressive
        ? new ProgressiveFileStream(filePath, start, end, session)
        : fs.createReadStream(filePath, { start, end });
      stream.pipe(res);
      req.on('close', () => stream.destroy());
    } else {
      res.writeHead(200, {
        ...commonHeaders,
        'Content-Length': totalSize
      });

      const stream = isProgressive
        ? new ProgressiveFileStream(filePath, 0, totalSize - 1, session)
        : fs.createReadStream(filePath);
      stream.pipe(res);
      req.on('close', () => stream.destroy());
    }
  }

  // Asynchronously resolve album artwork buffer and mimeType across all possible cover sources
  async resolveCoverBuffer(track = null, filePath = null, token = null) {
    const candidateKeys = [
      token,
      track && track.cover,
      track && track.filePath,
      track && track.id,
      filePath
    ].filter(Boolean);

    // 1. Check in-memory coverCache
    for (const key of candidateKeys) {
      if (this.coverCache.has(key)) {
        return this.coverCache.get(key);
      }
    }

    // Lock deduplication promise if already in flight for this token/track
    const lockKey = token || (track && (track.id || track.filePath || track.cover)) || filePath;
    if (lockKey && this._pendingCoverPromises.has(lockKey)) {
      return await this._pendingCoverPromises.get(lockKey);
    }

    const fetchPromise = (async () => {
      try {
        // 2. Check track.cover if present
        if (track && track.cover && typeof track.cover === 'string') {
          const coverSrc = track.cover.trim();

          // 2a. Base64 data URL
          if (coverSrc.startsWith('data:')) {
            const match = coverSrc.match(/^data:([^;]+);base64,(.+)$/);
            if (match) {
              const mimeType = match[1] || 'image/jpeg';
              const buffer = Buffer.from(match[2], 'base64');
              this.cacheCover(candidateKeys, mimeType, buffer);
              return { mimeType, buffer };
            }
          }

          // 2b. Remote HTTP or HTTPS URL (TIDAL, KKBOX, etc.)
          if (coverSrc.startsWith('http://') || coverSrc.startsWith('https://')) {
            try {
              const resp = await fetch(coverSrc, { signal: AbortSignal.timeout(6000) });
              if (resp.ok) {
                const arrayBuf = await resp.arrayBuffer();
                const buffer = Buffer.from(arrayBuf);
                const rawMime = resp.headers.get('content-type') || 'image/jpeg';
                const mimeType = rawMime.split(';')[0].trim();
                this.cacheCover(candidateKeys, mimeType, buffer);
                return { mimeType, buffer };
              }
            } catch (fetchErr) {
              console.warn('[DLNA] Failed to fetch remote cover URL:', coverSrc, fetchErr.message);
            }
          }

          // 2c. Local file URL (file://, file:///) or media URL (media://) or direct local path
          const localPath = resolveLocalCoverPath(coverSrc);
          if (localPath && fs.existsSync(localPath)) {
            try {
              const buffer = fs.readFileSync(localPath);
              const ext = path.extname(localPath).toLowerCase();
              const mimeType = (ext === '.png') ? 'image/png' : (ext === '.webp' ? 'image/webp' : 'image/jpeg');
              this.cacheCover(candidateKeys, mimeType, buffer);
              return { mimeType, buffer };
            } catch (readErr) {
              console.warn('[DLNA] Failed to read local cover file:', localPath, readErr.message);
            }
          }
        }

        // 3. Fallback: Search in track's original audio file directory
        const audioPath = (track && track.filePath) || filePath;
        if (audioPath && fs.existsSync(audioPath)) {
          const dir = path.dirname(audioPath);
          const candidates = [
            'cover.jpg', 'cover.jpeg', 'cover.png',
            'Cover.jpg', 'Cover.jpeg', 'Cover.png',
            'folder.jpg', 'folder.jpeg', 'folder.png',
            'Folder.jpg', 'Folder.jpeg', 'Folder.png',
            'front.jpg', 'front.jpeg', 'front.png',
            'Front.jpg', 'Front.jpeg', 'Front.png',
            'album.jpg', 'album.jpeg', 'album.png',
            'Album.jpg', 'Album.jpeg', 'Album.png'
          ];
          for (const name of candidates) {
            const full = path.join(dir, name);
            if (fs.existsSync(full)) {
              try {
                const buffer = fs.readFileSync(full);
                const mimeType = name.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
                this.cacheCover(candidateKeys, mimeType, buffer);
                return { mimeType, buffer };
              } catch (e) {}
            }
          }

          // 4. Fallback: Parse embedded cover via music-metadata
          try {
            const mm = await import('music-metadata');
            const metadata = await mm.parseFile(audioPath, { skipCovers: false });
            if (metadata.common && metadata.common.picture && metadata.common.picture.length > 0) {
              const pic = metadata.common.picture[0];
              const buffer = Buffer.from(pic.data);
              const mimeType = pic.format || 'image/jpeg';
              this.cacheCover(candidateKeys, mimeType, buffer);
              return { mimeType, buffer };
            }
          } catch (mmErr) {
            // ignore
          }
        }

        // 5. Fallback: Project icon (icon.png)
        const iconPath = path.join(__dirname, 'icon.png');
        if (fs.existsSync(iconPath)) {
          try {
            const buffer = fs.readFileSync(iconPath);
            return { mimeType: 'image/png', buffer };
          } catch (e) {}
        }

        // 6. Minimal 1x1 JPEG fallback
        return { mimeType: 'image/jpeg', buffer: FALLBACK_JPEG };
      } finally {
        if (lockKey) this._pendingCoverPromises.delete(lockKey);
      }
    })();

    if (lockKey) {
      this._pendingCoverPromises.set(lockKey, fetchPromise);
    }
    return await fetchPromise;
  }

  // Handle album cover image serving for DLNA Renderers with standard UPnP/DLNA headers
  async handleCoverImage(req, res, filePath, track = null, token = null) {
    const sendCover = (mime, buf) => {
      const isPng = !!(mime && mime.toLowerCase().includes('png'));
      const dlnaPn = isPng ? 'PNG_LRG' : 'JPEG_LRG';
      const safeMime = isPng ? 'image/png' : 'image/jpeg';
      const headers = {
        'Content-Type': safeMime,
        'Content-Length': buf.length,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=86400',
        'Accept-Ranges': 'bytes',
        'Connection': 'keep-alive',
        'contentFeatures.dlna.org': `DLNA.ORG_PN=${dlnaPn};DLNA.ORG_OP=00;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=00900000000000000000000000000000`,
        'transferMode.dlna.org': 'Interactive'
      };

      if (req.headers && req.headers.range) {
        const range = req.headers.range;
        const match = range.match(/bytes=(\d+)-(\d*)/);
        if (match) {
          const start = parseInt(match[1], 10);
          const end = match[2] ? parseInt(match[2], 10) : buf.length - 1;
          if (start < buf.length && end < buf.length && start <= end) {
            const chunk = buf.subarray(start, end + 1);
            headers['Content-Range'] = `bytes ${start}-${end}/${buf.length}`;
            headers['Content-Length'] = chunk.length;
            res.writeHead(206, headers);
            if (req.method === 'HEAD') {
              res.end();
            } else {
              res.end(chunk);
            }
            return;
          }
        }
      }

      res.writeHead(200, headers);
      if (req.method === 'HEAD') {
        res.end();
      } else {
        res.end(buf);
      }
    };

    try {
      const { mimeType, buffer } = await this.resolveCoverBuffer(track, filePath, token);
      sendCover(mimeType, buffer);
    } catch (err) {
      console.warn('[DLNA] handleCoverImage error:', err);
      if (!res.headersSent) {
        sendCover('image/jpeg', FALLBACK_JPEG);
      }
    }
  }

  cacheCover(keys, mimeType, buffer) {
    if (!buffer || buffer.length === 0) return;
    const keyList = Array.isArray(keys) ? keys : [keys];
    for (const key of keyList) {
      if (!key) continue;
      if (this.coverCache.size > 200) {
        const firstKey = this.coverCache.keys().next().value;
        this.coverCache.delete(firstKey);
      }
      this.coverCache.set(key, { mimeType: mimeType || 'image/jpeg', buffer });
    }
  }

  // Initialize SSDP Discovery
  startSsdpDiscovery() {
    try {
      this.ssdpSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

      this.ssdpSocket.on('message', (msg, rinfo) => {
        this.handleSsdpMessage(msg.toString(), rinfo.address);
      });

      this.ssdpSocket.on('error', (err) => {
        console.warn('[DLNA] SSDP socket error:', err.message);
      });

      this.ssdpSocket.bind(0, () => {
        try {
          this.ssdpSocket.setBroadcast(true);
          this.ssdpSocket.setMulticastTTL(4);
        } catch (e) {}
        this.triggerScan();
      });

      // Periodically refresh discovery every 30 seconds
      this.scanInterval = setInterval(() => {
        this.triggerScan();
      }, 30000);
    } catch (err) {
      console.error('[DLNA] Failed to start SSDP discovery:', err);
    }
  }

  // Broadcast SSDP M-SEARCH messages + Subnet Unicast M-SEARCH + Direct Streamer Probe
  triggerScan() {
    if (!this.ssdpSocket) return;

    const targets = [
      'urn:schemas-upnp-org:device:MediaRenderer:1',
      'urn:schemas-upnp-org:service:AVTransport:1',
      'ssdp:all'
    ];

    // 1. Multicast M-SEARCH
    targets.forEach(st => {
      const msg = [
        'M-SEARCH * HTTP/1.1',
        'HOST: 239.255.255.250:1900',
        'MAN: "ssdp:discover"',
        'MX: 2',
        `ST: ${st}`,
        '',
        ''
      ].join('\r\n');

      const buf = Buffer.from(msg);
      try {
        this.ssdpSocket.send(buf, 0, buf.length, 1900, '239.255.255.250');
      } catch (e) {}
    });

    // 2. Subnet Unicast M-SEARCH sweeps (bypasses Wi-Fi router multicast packet drops)
    const localIp = this.getLocalIp();
    const parts = localIp.split('.');
    if (parts.length === 4) {
      const subnetPrefix = `${parts[0]}.${parts[1]}.${parts[2]}`;
      const unicastMsg = Buffer.from([
        'M-SEARCH * HTTP/1.1',
        'HOST: 239.255.255.250:1900',
        'MAN: "ssdp:discover"',
        'MX: 1',
        'ST: urn:schemas-upnp-org:device:MediaRenderer:1',
        '',
        ''
      ].join('\r\n'));

      for (let i = 1; i <= 254; i++) {
        const targetIp = `${subnetPrefix}.${i}`;
        try {
          this.ssdpSocket.send(unicastMsg, 0, unicastMsg.length, 1900, targetIp);
        } catch (e) {}
      }
    }
  }

  // Asynchronously scan and wait for responses
  async scanAndDiscover(timeoutMs = 1200) {
    this.triggerScan();
    await new Promise(r => setTimeout(r, timeoutMs));
    return this.getDeviceList();
  }

  // Direct IP probe for a specific device (e.g. 192.168.1.100)
  async probeIp(targetIp) {
    if (!targetIp || typeof targetIp !== 'string') return null;
    const ip = targetIp.trim();

    // 1. Send unicast SSDP to port 1900
    if (this.ssdpSocket) {
      const mSearch = Buffer.from([
        'M-SEARCH * HTTP/1.1',
        `HOST: ${ip}:1900`,
        'MAN: "ssdp:discover"',
        'MX: 1',
        'ST: urn:schemas-upnp-org:device:MediaRenderer:1',
        '',
        ''
      ].join('\r\n'));
      try {
        this.ssdpSocket.send(mSearch, 0, mSearch.length, 1900, ip);
      } catch (e) {}
    }

    // 2. Direct probe common DLNA description URLs
    const candidateUrls = [
      `http://${ip}:1858/description.xml`, // Eversolo default
      `http://${ip}:1289/`,                // LG TV default
      `http://${ip}:49152/description.xml`,
      `http://${ip}:49153/description.xml`,
      `http://${ip}:49154/description.xml`,
      `http://${ip}:8080/description.xml`,
      `http://${ip}:2869/`,
      `http://${ip}:9000/plugins/UPnP/MediaRenderer.xml`
    ];

    for (const url of candidateUrls) {
      try {
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), 600);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(tid);
        if (res.ok) {
          const dev = await this.fetchDeviceDescription(url, ip);
          if (dev) return dev;
        }
      } catch (e) {
        // Continue trying next
      }
    }
    return null;
  }

  // Parse SSDP message headers
  handleSsdpMessage(text, remoteIp) {
    const lines = text.split('\r\n');
    let location = '';
    let st = '';
    let usn = '';

    for (const line of lines) {
      const match = line.match(/^([^:]+):\s*(.*)$/);
      if (match) {
        const key = match[1].trim().toUpperCase();
        const val = match[2].trim();
        if (key === 'LOCATION') location = val;
        else if (key === 'ST' || key === 'NT') st = val;
        else if (key === 'USN') usn = val;
      }
    }

    if (!location) return;

    // Check if this location is already parsed and known
    for (const dev of this.devices.values()) {
      if (dev.location === location) return;
    }

    this.fetchDeviceDescription(location, remoteIp);
  }

  // Fetch device XML description and parse services
  async fetchDeviceDescription(locationUrl, remoteIp) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(locationUrl, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!res.ok) return null;
      const xml = await res.text();

      // Only care about devices that have AVTransport service (i.e. MediaRenderer)
      if (!xml.includes('urn:schemas-upnp-org:service:AVTransport:1') && !xml.includes('AVTransport')) {
        return null;
      }

      const rawFriendlyName = (xml.match(/<friendlyName>(.*?)<\/friendlyName>/i)?.[1] || '').trim() || 'UPnP 音訊設備';
      const rawModelName = (xml.match(/<modelName>(.*?)<\/modelName>/i)?.[1] || '').trim() || 'MediaRenderer';
      const manufacturer = (xml.match(/<manufacturer>(.*?)<\/manufacturer>/i)?.[1] || '').trim() || '';
      const udn = (xml.match(/<UDN>(.*?)<\/UDN>/i)?.[1] || '').trim() || locationUrl;

      // Parse individual <service> blocks cleanly to avoid cross-service regex capture
      const serviceBlocks = xml.match(/<service>[\s\S]*?<\/service>/gi) || [];
      let resolvedAvControlUrl = null;
      let resolvedRenderingControlUrl = null;

      for (const block of serviceBlocks) {
        const sType = block.match(/<serviceType>(.*?)<\/serviceType>/i)?.[1]?.trim() || '';
        const cUrl = block.match(/<controlURL>(.*?)<\/controlURL>/i)?.[1]?.trim();
        if (!cUrl) continue;

        if (sType.includes('AVTransport')) {
          resolvedAvControlUrl = new URL(cUrl, locationUrl).toString();
        } else if (sType.includes('RenderingControl')) {
          resolvedRenderingControlUrl = new URL(cUrl, locationUrl).toString();
        }
      }

      if (!resolvedAvControlUrl) return null;

      // Check device icon
      let iconUrl = null;
      const iconMatch = xml.match(/<icon>[\s\S]*?<url>(.*?)<\/url>[\s\S]*?<\/icon>/i);
      if (iconMatch) {
        iconUrl = new URL(iconMatch[1].trim(), locationUrl).toString();
      }

      // Intelligent classification and presentation name
      let displayName = rawFriendlyName;
      let displayModel = rawModelName;
      let deviceCategory = 'hardware'; // 'hardware' | 'tv' | 'bridge'

      const isEversolo = manufacturer.toUpperCase().includes('EVERSOLO') ||
                         xml.includes('eversolo.com') ||
                         rawFriendlyName === 'T8' ||
                         rawModelName === 'T8';

      if (isEversolo) {
        displayName = (rawFriendlyName === 'T8') ? 'Eversolo T8' : (rawFriendlyName.startsWith('Eversolo') ? rawFriendlyName : `Eversolo ${rawFriendlyName}`);
        displayModel = 'Eversolo Hi-Fi 發燒數位串流播放器 (DMR)';
        deviceCategory = 'hardware';
      } else if (manufacturer.includes('LG') || rawModelName.includes('LG TV')) {
        displayName = rawFriendlyName;
        displayModel = 'LG webOS 智慧電視 (DMR)';
        deviceCategory = 'tv';
      } else if (rawModelName === 'Squeezebox' || manufacturer.includes('Lyrion')) {
        displayName = `${rawFriendlyName} (Squeezebox 虛擬橋接)`;
        displayModel = 'Lyrion Squeezebox 虛擬端點';
        deviceCategory = 'bridge';
      }

      const deviceId = udn || `dev_${remoteIp}_${rawFriendlyName.replace(/[^a-zA-Z0-9]/g, '_')}`;

      // Deduplicate: check if this device or control URL already registered
      for (const [id, dev] of this.devices.entries()) {
        if (dev.avControlUrl === resolvedAvControlUrl || (udn && dev.id === udn) || (dev.name === displayName && dev.ip === remoteIp)) {
          dev.lastSeen = Date.now();
          return dev;
        }
      }

      const deviceObj = {
        id: deviceId,
        name: displayName,
        model: displayModel,
        manufacturer,
        ip: remoteIp,
        location: locationUrl,
        avControlUrl: resolvedAvControlUrl,
        renderingControlUrl: resolvedRenderingControlUrl,
        iconUrl,
        deviceCategory,
        lastSeen: Date.now()
      };

      this.devices.set(deviceId, deviceObj);
      console.log(`[DLNA] Found MediaRenderer: "${displayName}" (${displayModel}) @ ${remoteIp}`);
      this.emit('devices-updated', this.getDeviceList());
      return deviceObj;
    } catch (err) {
      // Ignore network abort or parsing errors
      return null;
    }
  }

  // Get sanitized list of discovered DLNA devices for frontend
  getDeviceList() {
    const list = [
      {
        id: 'local',
        name: '本機音訊 (此電腦)',
        model: 'Windows WASAPI / DirectSound',
        ip: '127.0.0.1',
        isLocal: true,
        deviceCategory: 'local',
        active: (this.activeDeviceId === 'local')
      }
    ];

    // Sort DLNA devices: hardware DAC/streamers first, then TV, then virtual bridges
    const dlnaDevices = Array.from(this.devices.values()).map(dev => ({
      id: dev.id,
      name: dev.name,
      model: dev.model,
      manufacturer: dev.manufacturer,
      ip: dev.ip,
      isLocal: false,
      hasVolume: !!dev.renderingControlUrl,
      iconUrl: dev.iconUrl,
      deviceCategory: dev.deviceCategory || 'hardware',
      active: (this.activeDeviceId === dev.id)
    })).sort((a, b) => {
      const order = { hardware: 1, tv: 2, bridge: 3 };
      return (order[a.deviceCategory] || 2) - (order[b.deviceCategory] || 2);
    });

    return [...list, ...dlnaDevices];
  }

  // Select active device (either 'local' or DLNA device id)
  selectDevice(deviceId) {
    if (this.activeDeviceId !== deviceId) {
      if (this.activeDeviceId !== 'local') {
        // Stop playback on previous DLNA device
        this.stop(this.activeDeviceId).catch(() => {});
      }
      this.activeDeviceId = deviceId;
      this.emit('devices-updated', this.getDeviceList());
    }
    return this.activeDeviceId;
  }

  // Send UPnP SOAP request with Persistent HTTP Keep-Alive Connection Pool
  async sendSoapRequest(controlUrl, serviceType, action, bodyXml, timeoutMs = 6000) {
    const envelope = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:${action} xmlns:u="${serviceType}">
      ${bodyXml}
    </u:${action}>
  </s:Body>
</s:Envelope>`;

    const bodyBuffer = Buffer.from(envelope, 'utf-8');

    return new Promise((resolve, reject) => {
      let isSettled = false;
      const parsedUrl = new URL(controlUrl);

      const req = http.request(parsedUrl, {
        method: 'POST',
        agent: this.httpAgent,
        headers: {
          'Content-Type': 'text/xml; charset="utf-8"',
          'SOAPAction': `"${serviceType}#${action}"`,
          'Content-Length': bodyBuffer.length,
          'Connection': 'keep-alive'
        },
        timeout: timeoutMs
      }, (res) => {
        let responseText = '';
        res.setEncoding('utf-8');
        res.on('data', (chunk) => { responseText += chunk; });
        res.on('end', () => {
          if (isSettled) return;
          isSettled = true;
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(responseText);
          } else {
            reject(new Error(`SOAP ${action} failed: HTTP ${res.statusCode} - ${responseText.slice(0, 200)}`));
          }
        });
      });

      req.on('timeout', () => {
        if (isSettled) return;
        isSettled = true;
        req.destroy(new Error(`SOAP ${action} timeout after ${timeoutMs}ms`));
      });

      req.on('error', (err) => {
        if (isSettled) return;
        isSettled = true;
        reject(err);
      });

      req.write(bodyBuffer);
      req.end();
    });
  }

  // Play a track on a DLNA renderer with concurrency serialization & queue protection
  async playTrack(deviceId, track, startSec = 0, dspOptions = null) {
    const opId = ++this._playOpCounter;
    this.stopPositionPolling(); // Immediately cancel any active polling timer

    // Chain onto the active play promise to prevent interleaved SOAP commands
    const prevPromise = this._activePlayPromise || Promise.resolve();
    let releaseLock;
    this._activePlayPromise = new Promise(resolve => { releaseLock = resolve; });

    try {
      await prevPromise.catch(() => {});
      if (opId !== this._playOpCounter) {
        // A newer track selection superseded this one while waiting for previous SOAP call to finish
        return { success: false, cancelled: true };
      }
      const result = await this._doPlayTrack(deviceId, track, startSec, dspOptions, opId);
      if (!result || !result.success) {
        const cancelled = !!(result && result.cancelled);
        this.stopPrepareTracking(cancelled ? '' : 'failed', cancelled ? undefined : { error: (result && result.error) || '串流播放失敗' });
      }
      return result;
    } catch (err) {
      console.error('[DLNA] PlayTrack error:', err);
      this.stopPrepareTracking('failed', { error: err.message });
      return { success: false, error: err.message };
    } finally {
      releaseLock();
    }
  }

  async _doPlayTrack(deviceId, track, startSec, dspOptions, opId) {
    const dev = this.devices.get(deviceId);
    if (!dev) return { success: false, error: 'DLNA Device not found' };

    // Every playback branch below needs a real local file to serve to the renderer.
    // Fail cleanly instead of throwing a TypeError from path.extname(undefined).
    if (!track.filePath || typeof track.filePath !== 'string') {
      return { success: false, error: '音訊檔路徑未取得（來源尚未完成本機快取）' };
    }

    // 1. Immediately cancel any prior polling state
    this.stopPositionPolling();

    this.activeDeviceId = deviceId;
    this.currentTrack = track;
    this.currentDspOptions = dspOptions;
    this.trackPlayTimestamp = Date.now();
    this.hasStartedPlaying = false;
    this.playbackState = 'PLAYING';

    // 從这一刻起回報準備進度（引擎建立 session、記憶體緩衝、裝置開播）
    this.startPrepareTracking(track, dev);
    if (this.nativeDspStreamer && typeof this.nativeDspStreamer === 'object') {
      this.nativeDspStreamer.onSessionInitProgress = (session) => { this._prepareSession = session; };
    }

    // 2. 智慧平滑切換（消除無謂的 150ms 盲等）：
    // 若設備本來就處於 STOPPED 或 NO_MEDIA_PRESENT，直接略過 Stop 指令；
    // 僅在播放中切歌時發送 Stop，並將緩衝等待從 150ms 最佳化至 40ms，使切歌反應提升數倍！
    if (this.playbackState === 'PLAYING') {
      try {
        await this.sendSoapRequest(
          dev.avControlUrl,
          'urn:schemas-upnp-org:service:AVTransport:1',
          'Stop',
          `<InstanceID>0</InstanceID>`,
          2000
        );
        await new Promise(r => setTimeout(r, 40));
      } catch (e) {
        // Ignore if device was already stopped
      }
    }

    if (!this.streamingServer || !this.streamingPort) {
      await this.startStreamingServer();
    }

    if (opId !== this._playOpCounter) {
      return { success: false, cancelled: true };
    }

    // Cancel any existing DSP progressive streaming session from previous track
    if (this.currentStreamSession) {
      this.currentStreamSession.cancel();
      this.currentStreamSession = null;
    }

    const localIp = this.getLocalIp(dev ? dev.ip : null);
    const ext = (track.formatName || '').toUpperCase();
    const isNativeDsd = ext === 'DSF' || ext === 'DFF' || (track.filePath && /\.(dsf|dff)$/i.test(track.filePath));
    const isNativeDsf = !!(track.filePath && /\.dsf$/i.test(track.filePath));
    const isDsdUpsample = !!(dspOptions && dspOptions.enabled && dspOptions.dsdMode);
    const isTv = (dev.deviceCategory === 'tv');

    // Register active stream token for clean, URL-safe endpoint without long query parameters
    const streamToken = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    // Prune old activeStreams if too large
    if (this.activeStreams.size > 50) {
      const oldestKey = this.activeStreams.keys().next().value;
      this.activeStreams.delete(oldestKey);
    }

    let activeFilePath = track.filePath;
    let streamUrl = '';
    let mimeType = 'audio/flac';
    let protocolInfo = 'http-get:*:audio/flac:DLNA.ORG_PN=FLAC;DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000';

    if (isNativeDsf) {
      if (isTv || (dspOptions && (dspOptions.peq || dspOptions.conv) && !isDsdUpsample)) {
        // Smart TV (cannot decode DSD) or PEQ/Convolution-only mode: decimate DSF to 24-bit 88.2kHz WAV
        // (PEQ / IR applied when set). Engine DSD-modulation mode (isDsdUpsample) keeps the native DSF
        // modulation path below instead - bit-perfect passthrough wins there.
        const session = await this.nativeDspStreamer.createDsdDecimateSession(streamToken, track.filePath, startSec, track, dspOptions ? dspOptions.peq : null, dspOptions ? dspOptions.conv : null, true);
        this.currentStreamSession = session;
        activeFilePath = session.filePath;
        streamUrl = `http://${localIp}:${this.streamingPort}/stream/${streamToken}/audio.wav`;
        mimeType = 'audio/wav';
        protocolInfo = 'http-get:*:audio/wav:DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000';
      } else {
        // Audiophile streamer: Bit-perfect native DSF direct streaming (zero CPU, bit-perfect)
        activeFilePath = track.filePath;
        streamUrl = `http://${localIp}:${this.streamingPort}/stream/${streamToken}/track.dsf`;
        mimeType = 'audio/x-dsf';
        protocolInfo = 'http-get:*:audio/x-dsf:*';
      }
    } else if (isDsdUpsample) {
      if (isTv) {
        // Smart TV compatibility: TV cannot decode DSD bitstreams; provide High-Res 24-bit 96kHz WAV
        const session = await this.nativeDspStreamer.createPcmSession(streamToken, track.filePath, startSec, 96000, track, dspOptions ? (dspOptions.filterPhase || 'linear') : 'linear', dspOptions ? dspOptions.peq : null, dspOptions ? dspOptions.conv : null, true);
        this.currentStreamSession = session;
        activeFilePath = session.filePath;
        streamUrl = `http://${localIp}:${this.streamingPort}/stream/${streamToken}/audio.wav`;
        mimeType = 'audio/wav';
        protocolInfo = 'http-get:*:audio/wav:DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000';
      } else {
        // Audiophile streamer / DAC: Progressive on-the-fly DSD modulation in DSF container (Worker + Flow Control)
        const dsdOrder = dspOptions ? (dspOptions.dsdOrder || 5) : 5;
        const filterPhase = dspOptions ? (dspOptions.filterPhase || 'linear') : 'linear';
        const session = await this.nativeDspStreamer.createDsdSession(streamToken, track.filePath, startSec, dspOptions.dsdMode, track, dsdOrder, filterPhase, dspOptions.peq, dspOptions.conv, true);
        this.currentStreamSession = session;
        activeFilePath = session.filePath;
        streamUrl = `http://${localIp}:${this.streamingPort}/stream/${streamToken}/audio.dsf`;
        mimeType = 'audio/x-dsf';
        protocolInfo = 'http-get:*:audio/x-dsf:*';
      }
    } else if (isNativeDsd) {
      // Native DFF needing PCM decimation to 24-bit 88.2kHz WAV (PEQ / IR applied when set)
      const session = await this.nativeDspStreamer.createDsdDecimateSession(streamToken, track.filePath, startSec, track, dspOptions ? dspOptions.peq : null, dspOptions ? dspOptions.conv : null, true);
      this.currentStreamSession = session;
      activeFilePath = session.filePath;
      streamUrl = `http://${localIp}:${this.streamingPort}/stream/${streamToken}/audio.wav`;
      mimeType = 'audio/wav';
      protocolInfo = 'http-get:*:audio/wav:DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000';
    } else if (dspOptions && (dspOptions.enabled || dspOptions.peq || dspOptions.conv)) {
      // PCM Progressive DSP to 24-bit WAV: full upsampling (engine on), PEQ-only or Convolution-only
      // at the native sample rate
      const targetRate = dspOptions.enabled ? (dspOptions.sampleRate || 192000) : (dspOptions.sampleRate || track.sampleRate || 44100);
      const filterPhase = dspOptions.filterPhase || 'linear';
      const session = await this.nativeDspStreamer.createPcmSession(streamToken, track.filePath, startSec, targetRate, track, filterPhase, dspOptions ? dspOptions.peq : null, dspOptions ? dspOptions.conv : null, true);
      this.currentStreamSession = session;
      activeFilePath = session.filePath;
      streamUrl = `http://${localIp}:${this.streamingPort}/stream/${streamToken}/audio.wav`;
      mimeType = 'audio/wav';
      protocolInfo = 'http-get:*:audio/wav:DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000';
    } else {
      // Direct pass-through: zero latency, zero CPU!
      const fileExt = path.extname(track.filePath).toLowerCase() || '.flac';
      activeFilePath = track.filePath;
      streamUrl = `http://${localIp}:${this.streamingPort}/stream/${streamToken}/track${fileExt}`;
      if (fileExt === '.mp3') {
        mimeType = 'audio/mpeg';
        protocolInfo = 'http-get:*:audio/mpeg:DLNA.ORG_PN=MP3;DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000';
      } else if (fileExt === '.wav') {
        mimeType = 'audio/wav';
        protocolInfo = 'http-get:*:audio/wav:DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000';
      } else if (fileExt === '.m4a' || fileExt === '.aac') {
        mimeType = 'audio/mp4';
        protocolInfo = 'http-get:*:audio/mp4:DLNA.ORG_PN=AAC_ISO;DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000';
      } else if (fileExt === '.dsf') {
        mimeType = 'audio/x-dsf';
        protocolInfo = 'http-get:*:audio/x-dsf:*';
      } else {
        mimeType = 'audio/flac';
        protocolInfo = 'http-get:*:audio/flac:DLNA.ORG_PN=FLAC;DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000';
      }
    }

    this.activeStreams.set(streamToken, {
      track,
      filePath: activeFilePath,
      startSec,
      dspOptions,
      isDsd: isNativeDsd,
      isDsdUpsample,
      mimeType,
      createdAt: Date.now()
    });

    this.streamStartSec = startSec || 0;

    this.currentStreamToken = streamToken;

    // 自適應記憶體緩衝：PCM 升頻僅需 2.0-2.5 秒緩衝即可平滑起播；DSD 調變需 4 秒
    if (this.currentStreamSession && !this.currentStreamSession.isCompleted) {
      this._prepareStage = 'buffer';
      await this.waitForPrepareBuffer(opId, isDsdUpsample);
    }

    // Proactively pre-resolve and cache album artwork buffer for instantaneous serving to DLNA renderer
    this.resolveCoverBuffer(track, activeFilePath, streamToken).catch(err => {
      console.warn('[DLNA] Proactive resolveCoverBuffer error:', err.message);
    });

    const coverUrl = `http://${localIp}:${this.streamingPort}/cover/${streamToken}/cover.jpg`;

    // Duration in H:MM:SS.000 format
    const trackDur = (track.duration && track.duration > 0) ? track.duration : 0;
    const effectiveDur = (startSec > 0 && trackDur > startSec && (isDsdUpsample || (dspOptions && (dspOptions.enabled || dspOptions.peq || dspOptions.conv))))
      ? (trackDur - startSec)
      : trackDur;
    const durationFormatted = effectiveDur > 0 ? formatHmsMs(effectiveDur) : '';
    const durationAttr = durationFormatted ? `duration="${durationFormatted}"` : '';

    const titleStr = track.title || path.basename(track.filePath, path.extname(track.filePath)) || 'Track';
    const artistStr = track.artist || 'Unknown Artist';
    const albumStr = track.album || 'Unknown Album';
    const albumArtistStr = track.albumArtist || artistStr;

    // Build standard compliant DIDL-Lite metadata
    const didlParts = [
      '<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:dlna="urn:schemas-dlna-org:metadata-1-0/">',
      '  <item id="1" parentID="0" restricted="1">',
      `    <dc:title>${escapeXml(titleStr)}</dc:title>`,
      `    <dc:creator>${escapeXml(artistStr)}</dc:creator>`,
      `    <upnp:artist role="Performer">${escapeXml(artistStr)}</upnp:artist>`,
      `    <upnp:artist>${escapeXml(artistStr)}</upnp:artist>`,
      `    <upnp:album>${escapeXml(albumStr)}</upnp:album>`,
      `    <upnp:albumArtist>${escapeXml(albumArtistStr)}</upnp:albumArtist>`
    ];

    if (track.genre) {
      didlParts.push(`    <upnp:genre>${escapeXml(track.genre)}</upnp:genre>`);
    }
    const trackNum = track.trackNumber || track.trackNo;
    if (trackNum) {
      didlParts.push(`    <upnp:originalTrackNumber>${escapeXml(trackNum)}</upnp:originalTrackNumber>`);
    }
    if (track.year) {
      didlParts.push(`    <dc:date>${escapeXml(track.year)}</dc:date>`);
    }

    didlParts.push(
      `    <upnp:albumArtURI dlna:profileID="JPEG_TN">${coverUrl}</upnp:albumArtURI>`,
      `    <upnp:albumArtURI dlna:profileID="JPEG_SM">${coverUrl}</upnp:albumArtURI>`,
      `    <upnp:albumArtURI dlna:profileID="JPEG_MED">${coverUrl}</upnp:albumArtURI>`,
      `    <upnp:albumArtURI dlna:profileID="JPEG_LRG">${coverUrl}</upnp:albumArtURI>`,
      `    <upnp:albumArtURI>${coverUrl}</upnp:albumArtURI>`,
      `    <upnp:icon>${coverUrl}</upnp:icon>`,
      `    <upnp:class>object.item.audioItem.musicTrack</upnp:class>`
    );

    if ((isNativeDsf && !(dspOptions && (dspOptions.peq || dspOptions.conv))) || isDsdUpsample) {
      let dsdHz = 2822400;
      if (dspOptions && dspOptions.dsdMode) {
        const m = dspOptions.dsdMode.toLowerCase();
        if (m === 'dsd128') dsdHz = 5644800;
        else if (m === 'dsd256') dsdHz = 11289600;
        else if (m === 'dsd512') dsdHz = 22579200;
      }
      didlParts.push(
        `    <res protocolInfo="http-get:*:audio/x-dsf:*" sampleFrequency="${dsdHz}" bitsPerSample="1" nrAudioChannels="2" ${durationAttr}>${streamUrl}</res>`,
        `    <res protocolInfo="http-get:*:audio/dsf:*" sampleFrequency="${dsdHz}" bitsPerSample="1" nrAudioChannels="2" ${durationAttr}>${streamUrl}</res>`
      );
    } else {
      didlParts.push(`    <res protocolInfo="${protocolInfo}" ${durationAttr}>${streamUrl}</res>`);
      // 擴充相容性：針對 WAV 串流額外宣告標準 LPCM 協議，確保嚴格遵守 DLNA 規格的品牌（如 Pioneer/Yamaha/Sony）能完美辨別
      if (mimeType === 'audio/wav') {
        didlParts.push(`    <res protocolInfo="http-get:*:audio/L16:*" ${durationAttr}>${streamUrl}</res>`);
        didlParts.push(`    <res protocolInfo="http-get:*:audio/x-wav:*" ${durationAttr}>${streamUrl}</res>`);
      }
    }

    // Secondary artwork resources placed AFTER audio resources
    didlParts.push(
      `    <res protocolInfo="http-get:*:image/jpeg:DLNA.ORG_PN=JPEG_LRG;DLNA.ORG_FLAGS=00900000000000000000000000000000">${coverUrl}</res>`,
      `    <res protocolInfo="http-get:*:image/jpeg:DLNA.ORG_PN=JPEG_MED;DLNA.ORG_FLAGS=00900000000000000000000000000000">${coverUrl}</res>`,
      `    <res protocolInfo="http-get:*:image/jpeg:DLNA.ORG_PN=JPEG_TN;DLNA.ORG_FLAGS=00900000000000000000000000000000">${coverUrl}</res>`,
      `    <res protocolInfo="http-get:*:image/jpeg:*">${coverUrl}</res>`,
      `    <res protocolInfo="http-get:*:image/png:*">${coverUrl}</res>`
    );

    didlParts.push(
      '  </item>',
      '</DIDL-Lite>'
    );

    const didl = didlParts.join('\n');
    const escapedDidl = escapeXml(didl);

    // 3. SetAVTransportURI with retry loop and metadata fallback
    this._prepareStage = 'seturi';
    this.emitPrepare();
    let uriSuccess = false;
    let lastUriError = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (opId !== this._playOpCounter) return { success: false, cancelled: true };
      try {
        const metaPayload = (attempt === 3) ? '' : escapedDidl;
        await this.sendSoapRequest(
          dev.avControlUrl,
          'urn:schemas-upnp-org:service:AVTransport:1',
          'SetAVTransportURI',
          `<InstanceID>0</InstanceID>
           <CurrentURI>${escapeXml(streamUrl)}</CurrentURI>
           <CurrentURIMetaData>${metaPayload}</CurrentURIMetaData>`
        );
        uriSuccess = true;
        break;
      } catch (err) {
        lastUriError = err;
        console.warn(`[DLNA] SetAVTransportURI attempt ${attempt} failed:`, err.message);
        await new Promise(r => setTimeout(r, 200));
      }
    }
    if (!uriSuccess) {
      throw lastUriError || new Error('SetAVTransportURI failed after 3 attempts');
    }

    if (opId !== this._playOpCounter) {
      return { success: false, cancelled: true };
    }

    // 協定層防跳幀保護：發送 Play 之前給予設備 200ms 握手安定時間，讓設備有充足時間探測 URL、
    // 建立 TCP 連線與內部預載緩衝區，徹底避免設備因倉促開播而丟棄開頭封包
    await new Promise(r => setTimeout(r, 200));

    // 4. Play with retry loop
    this._prepareStage = 'play';
    this.emitPrepare();
    let playSuccess = false;
    let lastPlayError = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (opId !== this._playOpCounter) return { success: false, cancelled: true };
      try {
        await this.sendSoapRequest(
          dev.avControlUrl,
          'urn:schemas-upnp-org:service:AVTransport:1',
          'Play',
          `<InstanceID>0</InstanceID>
           <Speed>1</Speed>`
        );
        playSuccess = true;
        break;
      } catch (err) {
        lastPlayError = err;
        console.warn(`[DLNA] Play action attempt ${attempt} failed:`, err.message);
        await new Promise(r => setTimeout(r, 200));
      }
    }
    if (!playSuccess) {
      throw lastPlayError || new Error('Play action failed after 3 attempts');
    }

    if (opId !== this._playOpCounter) {
      return { success: false, cancelled: true };
    }

    // 5. If seeking needed on non-DSD/non-DSP file (since DSD & upsample streams bake the start offset directly in the native engine)
    if (startSec > 0 && !isNativeDsd && !isDsdUpsample && (!dspOptions || (!dspOptions.enabled && !dspOptions.peq && !dspOptions.conv))) {
      await new Promise(r => setTimeout(r, 300));
      await this.seek(deviceId, startSec).catch(() => {});
    }

    // 指令都送出去了，但裝置真正開始發出聲音還要時間：繼續回報「opening」直到位置開始前進
    if (this._prepareT0) {
      this._prepareStage = 'opening';
      this.emitPrepare();
    }

    this.playbackState = 'PLAYING';
    this.startPositionPolling(dev);
    return { success: true, streamUrl, token: streamToken };
  }

  // Resume playback on DLNA renderer
  async resume(deviceId) {
    const dev = this.devices.get(deviceId);
    if (!dev) return;

    await this.sendSoapRequest(
      dev.avControlUrl,
      'urn:schemas-upnp-org:service:AVTransport:1',
      'Play',
      `<InstanceID>0</InstanceID><Speed>1</Speed>`
    );
    this.playbackState = 'PLAYING';
    if (!this.positionTimer) {
      this.startPositionPolling(dev);
    }
  }

  // Pause playback on DLNA renderer
  async pause(deviceId) {
    const dev = this.devices.get(deviceId);
    if (!dev) return;

    await this.sendSoapRequest(
      dev.avControlUrl,
      'urn:schemas-upnp-org:service:AVTransport:1',
      'Pause',
      `<InstanceID>0</InstanceID>`
    );
    this.playbackState = 'PAUSED_PLAYBACK';
  }

  // Stop playback on DLNA renderer
  async stop(deviceId) {
    const dev = this.devices.get(deviceId);
    if (!dev) return;

    this.stopPositionPolling();
    this.stopPrepareTracking();
    if (this.currentStreamSession) {
      this.currentStreamSession.cancel();
      this.currentStreamSession = null;
    }
    try {
      await this.sendSoapRequest(
        dev.avControlUrl,
        'urn:schemas-upnp-org:service:AVTransport:1',
        'Stop',
        `<InstanceID>0</InstanceID>`
      );
    } catch (e) {}
    this.playbackState = 'STOPPED';
  }

  // Seek on DLNA renderer (seconds)
  async seek(deviceId, seconds) {
    const dev = this.devices.get(deviceId);
    if (!dev) return;

    // For transcoded streams (DSD or PCM upsampling), UPnP Seek does not work on generated stream;
    // restart transcoding from the target offset instead.
    if (this.currentTrack) {
      const ext = (this.currentTrack.formatName || '').toUpperCase();
      const isDsd = ext === 'DSF' || ext === 'DFF' || (this.currentTrack.filePath && /\.(dsf|dff)$/i.test(this.currentTrack.filePath));
      const isDsdUpsample = !!(this.currentDspOptions && this.currentDspOptions.enabled && this.currentDspOptions.dsdMode);
      if (isDsd || isDsdUpsample || (this.currentDspOptions && this.currentDspOptions.enabled)) {
        return await this.playTrack(deviceId, this.currentTrack, seconds, this.currentDspOptions);
      }
    }

    const timeStr = formatHms(seconds);
    try {
      await this.sendSoapRequest(
        dev.avControlUrl,
        'urn:schemas-upnp-org:service:AVTransport:1',
        'Seek',
        `<InstanceID>0</InstanceID>
         <Unit>REL_TIME</Unit>
         <Target>${timeStr}</Target>`
      );
    } catch (err) {
      console.warn('[DLNA] Direct Seek failed on device:', err.message);
    }
  }

  // Set Volume on DLNA renderer (handles 0.0 to 1.0 or 0 to 100)
  async setVolume(deviceId, volFloat) {
    const dev = this.devices.get(deviceId);
    if (!dev || !dev.renderingControlUrl) return;

    const normalized = (volFloat > 1) ? volFloat : (volFloat * 100);
    const vol100 = Math.round(Math.max(0, Math.min(100, normalized)));
    try {
      await this.sendSoapRequest(
        dev.renderingControlUrl,
        'urn:schemas-upnp-org:service:RenderingControl:1',
        'SetVolume',
        `<InstanceID>0</InstanceID>
         <Channel>Master</Channel>
         <DesiredVolume>${vol100}</DesiredVolume>`
      );
    } catch (err) {
      console.warn('[DLNA] SetVolume failed:', err.message);
    }
  }

  // Query PositionInfo and TransportInfo from DLNA renderer
  async getPositionInfo(dev) {
    let positionXml = '';
    try {
      positionXml = await this.sendSoapRequest(
        dev.avControlUrl,
        'urn:schemas-upnp-org:service:AVTransport:1',
        'GetPositionInfo',
        `<InstanceID>0</InstanceID>`
      );
    } catch (e) {
      // Some renderers fail GetPositionInfo intermittently
    }

    let transportXml = '';
    try {
      transportXml = await this.sendSoapRequest(
        dev.avControlUrl,
        'urn:schemas-upnp-org:service:AVTransport:1',
        'GetTransportInfo',
        `<InstanceID>0</InstanceID>`
      );
    } catch (e) {
      // GetTransportInfo optional fallback
    }

    const relTimeMatch = positionXml.match(/<RelTime>(.*?)<\/RelTime>/i);
    const trackDurMatch = positionXml.match(/<TrackDuration>(.*?)<\/TrackDuration>/i);
    const stateMatchPos = positionXml.match(/<CurrentTransportState>(.*?)<\/CurrentTransportState>/i);
    const stateMatchTrans = transportXml.match(/<CurrentTransportState>(.*?)<\/CurrentTransportState>/i);

    const relTimeStr = relTimeMatch ? relTimeMatch[1].trim() : '0:00:00';
    const durStr = trackDurMatch ? trackDurMatch[1].trim() : '0:00:00';

    const currentSec = parseHmsToSec(relTimeStr);
    const durationSec = parseHmsToSec(durStr);

    let state = this.playbackState;
    if (stateMatchTrans && stateMatchTrans[1]) {
      state = stateMatchTrans[1].trim();
    } else if (stateMatchPos && stateMatchPos[1]) {
      state = stateMatchPos[1].trim();
    }

    return {
      currentSec,
      durationSec,
      state
    };
  }

  // Start polling playback progress from DLNA device with session guard
  startPositionPolling(dev) {
    this.stopPositionPolling();
    const sessionId = ++this._pollSessionCounter;
    let nearEndCount = 0;
    let maxReportedSec = 0;
    let trackEndedFired = false;

    this.positionTimer = setInterval(async () => {
      if (sessionId !== this._pollSessionCounter) {
        clearInterval(this.positionTimer);
        return;
      }
      try {
        const info = await this.getPositionInfo(dev);
        if (sessionId !== this._pollSessionCounter || trackEndedFired) return;

        const reportedSec = info.currentSec;
        const actualSec = (this.streamStartSec > 0) ? (this.streamStartSec + reportedSec) : reportedSec;
        const totalDurationSec = (this.currentTrack && this.currentTrack.duration > 0)
          ? this.currentTrack.duration
          : (info.durationSec > 0 ? (info.durationSec + (this.streamStartSec || 0)) : 0);

        if (actualSec > maxReportedSec) maxReportedSec = actualSec;
        const effectivePosSec = Math.max(actualSec, maxReportedSec);

        this.currentPositionSec = actualSec;
        if (totalDurationSec > 0) this.currentDurationSec = totalDurationSec;

        const stateUpper = (info.state || '').toUpperCase();

        this.emit('playback-progress', {
          currentSec: actualSec,
          maxSec: maxReportedSec,
          durationSec: this.currentDurationSec,
          state: info.state
        });

        // Mark that device has successfully transitioned into PLAYING
        if (stateUpper === 'PLAYING') {
          // 準備提示要等到「真的開始發出聲音」（位置開始前進）才關掉：
          // 很多裝置會先回報 PLAYING 但位置還停在 0（開播前的 ramp-up）。
          // 位置先送出去、提示後關掉，UI 才不會出現「提示消失但進度還在 0」的空檔。
          if (actualSec > 0 && this._prepareT0) {
            this._playAnnounced = true;
            this.stopPrepareTracking('playing', { positionSec: Number(actualSec.toFixed(2)) });
          }
          this.hasStartedPlaying = true;
        }

        // Robust Track Ended Guard across diverse DLNA/UPnP renderers (Eversolo, WiIM, Sony, LG, Marantz, Denon, Moode, etc.):
        // A track has genuinely finished when it was playing AND:
        // 1. Explicitly reported COMPLETED, OR
        // 2. Reported STOPPED or NO_MEDIA_PRESENT, and playback had progressed close to end (effectivePosSec within 4.5s of total or >= 94% duration), OR
        //    (covers renderers that reset RelTime to 00:00:00 upon STOPPED at EOF)
        // 3. Progress reached duration limit for 2 consecutive ticks (nearEndCount >= 2)
        const isCompleted = (stateUpper === 'COMPLETED');
        const reachedDuration = (totalDurationSec > 5 && (effectivePosSec >= totalDurationSec - 4.5 || (totalDurationSec > 15 && effectivePosSec >= totalDurationSec * 0.94)));
        const isStoppedAtEnd = ((stateUpper === 'STOPPED' || stateUpper === 'NO_MEDIA_PRESENT') && reachedDuration);

        if (this.hasStartedPlaying && (isCompleted || isStoppedAtEnd)) {
          console.log(`[DLNA] Track finished on renderer (state=${stateUpper}, progress=${actualSec}s, maxReached=${maxReportedSec}/${totalDurationSec}s), triggering next track`);
          trackEndedFired = true;
          this.playbackState = 'STOPPED';
          this.stopPositionPolling();
          this.emit('track-ended');
          return;
        }

        // Time-based threshold guard: renderer remains in PLAYING or hung near end
        if (this.hasStartedPlaying && totalDurationSec > 8) {
          if (effectivePosSec >= totalDurationSec || (totalDurationSec - effectivePosSec <= 2.0 && effectivePosSec > 0)) {
            nearEndCount++;
            if (nearEndCount >= 2) {
              console.log(`[DLNA] Track reached duration limit for 2 ticks (${effectivePosSec}/${totalDurationSec}s, state=${stateUpper}), triggering next track`);
              trackEndedFired = true;
              this.playbackState = 'STOPPED';
              this.stopPositionPolling();
              this.emit('track-ended');
              return;
            }
          } else {
            nearEndCount = 0;
          }
        }
      } catch (err) {
        // Polling fail ignored
      }
    }, 1000);
  }

  stopPositionPolling() {
    this._pollSessionCounter++;
    if (this.positionTimer) {
      clearInterval(this.positionTimer);
      this.positionTimer = null;
    }
  }

  // Cleanup on app exit
  async destroy() {
    this.stopPositionPolling();

    // Send Stop to the active DLNA renderer FIRST, before tearing down the stream session,
    // so the renderer flushes its internal buffer and goes silent immediately instead of
    // playing buffered audio for several seconds after the app closes. Short response timeout
    // keeps app shutdown fast even if the device is slow to answer the SOAP call (the command
    // itself is already delivered).
    if (this.activeDeviceId && this.activeDeviceId !== 'local') {
      const dev = this.devices.get(this.activeDeviceId);
      if (dev && dev.avControlUrl) {
        try {
          await this.sendSoapRequest(
            dev.avControlUrl,
            'urn:schemas-upnp-org:service:AVTransport:1',
            'Stop',
            `<InstanceID>0</InstanceID>`,
            2500
          );
          console.log(`[DLNA] Stop sent to "${dev.name || dev.id}" on shutdown`);
        } catch (e) {
          console.warn(`[DLNA] Stop on shutdown failed: ${e.message}`);
        }
      }
    }

    if (this.currentStreamSession) {
      try { this.currentStreamSession.cancel(); } catch (e) {}
      this.currentStreamSession = null;
    }
    if (this.nativeDspStreamer) {
      try { this.nativeDspStreamer.destroy(); } catch (e) {}
    }

    if (this.scanInterval) clearInterval(this.scanInterval);
    if (this.ssdpSocket) {
      try { this.ssdpSocket.close(); } catch (e) {}
    }
    if (this.streamingServer) {
      try { this.streamingServer.close(); } catch (e) {}
    }
  }
}

// Helpers
function escapeXml(unsafe) {
  return String(unsafe || '').replace(/[<>&'"]/g, c => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
    }
  });
}

function formatHms(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function parseHmsToSec(hms) {
  if (!hms || hms === 'NOT_IMPLEMENTED') return 0;
  const parts = hms.split(':').map(p => parseFloat(p) || 0);
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return 0;
}

function formatHmsMs(seconds) {
  if (!seconds || seconds <= 0 || isNaN(seconds)) return '';
  const s = Math.floor(seconds);
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const ms = Math.floor((seconds - s) * 1000);
  return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

// Minimal 1x1 valid baseline JPEG buffer for cover image fallback
const FALLBACK_JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
  0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
  0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
  0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20,
  0x24, 0x2e, 0x27, 0x20, 0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29,
  0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27, 0x39, 0x3d, 0x38, 0x32,
  0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
  0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00,
  0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
  0x09, 0x0a, 0x0b, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f,
  0x00, 0xbf, 0x80, 0xff, 0xd9
]);

module.exports = DlnaManager;
