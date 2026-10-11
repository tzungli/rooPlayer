// ==========================================
// rooPlayer - DLNA / UPnP MediaRenderer Subsystem
// Automatic SSDP Discovery & LAN Audio Streaming Engine
// ==========================================

const dgram = require('dgram');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const EventEmitter = require('events');

class DlnaManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.nativeAudioEngine = options.nativeAudioEngine || require('./native-audio-engine');
    this.devices = new Map(); // id -> device details
    this.activeDeviceId = 'local'; // 'local' or device.id
    this.currentTrack = null;
    this.streamingServer = null;
    this.streamingPort = 0;
    this.ssdpSocket = null;
    this.scanInterval = null;
    this.positionTimer = null;
    this.currentDsdProcess = null;
    this.playbackState = 'STOPPED'; // STOPPED | PLAYING | PAUSED_PLAYBACK
    this.currentPositionSec = 0;
    this.currentDurationSec = 0;
    this.trackPlayTimestamp = 0;
    this.hasStartedPlaying = false;
    this.currentDspOptions = null;
    this.coverCache = new Map(); // filePath -> { mimeType, buffer }
    this.activeStreams = new Map(); // token -> streamInfo
    this._playOpCounter = 0;
    this._activePlayPromise = null;
    this._pollSessionCounter = 0;
  }

  // Determine machine's local LAN IPv4 address
  getLocalIp() {
    const interfaces = os.networkInterfaces();
    let fallback = '127.0.0.1';

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
          const dsdModMatch = pathname.match(/^\/dsd-mod-stream\/([^\/]+)/);
          const dsdMatch = pathname.match(/^\/dsd-stream\/([^\/]+)/);
          const soxMatch = pathname.match(/^\/sox-stream\/([^\/]+)/);
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
            this.handleLocalAudioStream(req, res, filePath);
          } else if (dsdModMatch || pathname === '/dsd-mod-stream' || pathname === '/dsd-mod-stream/') {
            const token = dsdModMatch ? dsdModMatch[1] : null;
            const streamInfo = token ? this.activeStreams.get(token) : null;
            const filePath = (streamInfo && streamInfo.filePath) || reqUrl.searchParams.get('file');
            const startSec = (streamInfo && streamInfo.startSec) !== undefined
              ? streamInfo.startSec
              : parseFloat(reqUrl.searchParams.get('start') || '0');
            const dsdMode = (streamInfo && streamInfo.dspOptions && streamInfo.dspOptions.dsdMode)
              ? streamInfo.dspOptions.dsdMode
              : (reqUrl.searchParams.get('dsd') || 'dsd64');
            const precision = (streamInfo && streamInfo.dspOptions && streamInfo.dspOptions.precision)
              ? streamInfo.dspOptions.precision
              : parseInt(reqUrl.searchParams.get('precision') || '28', 10);
            const track = streamInfo ? streamInfo.track : this.currentTrack;
            if (!filePath || !fs.existsSync(filePath)) {
              res.writeHead(404);
              res.end('File not found');
              return;
            }
            this.handleDsdModulationStream(req, res, filePath, startSec, dsdMode, precision, track).catch(e => {
              console.error('handleDsdModulationStream error:', e);
              if (!res.headersSent) { res.writeHead(500); res.end('DSD stream error'); }
            });
          } else if (dsdMatch || pathname === '/dsd-stream' || pathname === '/dsd-stream/') {
            const token = dsdMatch ? dsdMatch[1] : null;
            const streamInfo = token ? this.activeStreams.get(token) : null;
            const filePath = (streamInfo && streamInfo.filePath) || reqUrl.searchParams.get('file');
            const startSec = (streamInfo && streamInfo.startSec) !== undefined
              ? streamInfo.startSec
              : parseFloat(reqUrl.searchParams.get('start') || '0');
            const track = streamInfo ? streamInfo.track : this.currentTrack;
            if (!filePath || !fs.existsSync(filePath)) {
              res.writeHead(404);
              res.end('File not found');
              return;
            }
            this.handleDsdTranscodeStream(req, res, filePath, startSec, track);
          } else if (soxMatch || pathname === '/sox-stream' || pathname === '/sox-stream/') {
            const token = soxMatch ? soxMatch[1] : null;
            const streamInfo = token ? this.activeStreams.get(token) : null;
            const filePath = (streamInfo && streamInfo.filePath) || reqUrl.searchParams.get('file');
            const startSec = (streamInfo && streamInfo.startSec) !== undefined
              ? streamInfo.startSec
              : parseFloat(reqUrl.searchParams.get('start') || '0');
            const sampleRate = (streamInfo && streamInfo.dspOptions && streamInfo.dspOptions.sampleRate)
              ? streamInfo.dspOptions.sampleRate
              : parseInt(reqUrl.searchParams.get('rate') || '192000', 10);
            const precision = (streamInfo && streamInfo.dspOptions && streamInfo.dspOptions.precision)
              ? streamInfo.dspOptions.precision
              : parseInt(reqUrl.searchParams.get('precision') || '28', 10);
            const dsdMode = (streamInfo && streamInfo.dspOptions && streamInfo.dspOptions.dsdMode)
              ? streamInfo.dspOptions.dsdMode
              : (reqUrl.searchParams.get('dsd') || '');
            const track = streamInfo ? streamInfo.track : this.currentTrack;
            if (!filePath || !fs.existsSync(filePath)) {
              res.writeHead(404);
              res.end('File not found');
              return;
            }
            this.handleSoxTranscodeStream(req, res, filePath, startSec, sampleRate, precision, dsdMode, track).catch(e => {
              console.error('handleSoxTranscodeStream error:', e);
              if (!res.headersSent) { res.writeHead(500); res.end('Upsample stream error'); }
            });
          } else if (coverMatch || pathname === '/cover' || pathname === '/cover/') {
            const token = coverMatch ? coverMatch[1] : null;
            const streamInfo = token ? this.activeStreams.get(token) : null;
            const filePath = (streamInfo && streamInfo.filePath) || reqUrl.searchParams.get('file');
            const track = streamInfo ? streamInfo.track : this.currentTrack;
            this.handleCoverImage(req, res, filePath, track);
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

  // Handle standard audio file with HTTP 206 Partial Content Range support
  handleLocalAudioStream(req, res, filePath) {
    const stat = fs.statSync(filePath);
    const totalSize = stat.size;
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

      const stream = fs.createReadStream(filePath, { start, end });
      stream.pipe(res);
      req.on('close', () => stream.destroy());
    } else {
      res.writeHead(200, {
        ...commonHeaders,
        'Content-Length': totalSize
      });

      const stream = fs.createReadStream(filePath);
      stream.pipe(res);
      req.on('close', () => stream.destroy());
    }
  }

  // Handle PCM to 1-bit DSD on-the-fly Delta-Sigma Modulation into Sony DSF stream (Pure Native Engine)
  async handleDsdModulationStream(req, res, filePath, startSec = 0, dsdMode = 'dsd64', precision = 24, track = null) {
    try {
      const pcm = await this.nativeAudioEngine.readPcmSamples(filePath, startSec);
      if (!pcm) {
        res.writeHead(500);
        res.end('Native PCM read failed for DSD modulation');
        return;
      }

      const dsfBuf = this.nativeAudioEngine.encodeDsdDsf(pcm.left, pcm.right, pcm.sampleRate, dsdMode, 300);

      const totalSize = dsfBuf.length;
      const range = req.headers.range;

      const headers = {
        'Content-Type': 'audio/x-dsf',
        'Accept-Ranges': 'bytes',
        'transferMode.dlna.org': 'Streaming',
        'contentFeatures.dlna.org': 'DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000',
        'Access-Control-Allow-Origin': '*'
      };

      if (req.method === 'HEAD') {
        res.writeHead(200, { ...headers, 'Content-Length': totalSize });
        res.end();
        return;
      }

      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;
        const chunkSize = (end - start) + 1;

        res.writeHead(206, {
          ...headers,
          'Content-Range': `bytes ${start}-${end}/${totalSize}`,
          'Content-Length': chunkSize
        });
        res.end(dsfBuf.subarray(start, end + 1));
      } else {
        res.writeHead(200, { ...headers, 'Content-Length': totalSize });
        res.end(dsfBuf);
      }
    } catch (err) {
      console.error('[DLNA] handleDsdModulationStream error:', err);
      if (!res.headersSent) {
        res.writeHead(500);
        res.end('DSD modulation error');
      }
    }
  }

  // Handle DSD (.dsf / .dff) on-the-fly decimation to 24-bit / 88.2 kHz WAV (Pure Native Engine)
  handleDsdTranscodeStream(req, res, filePath, startSec = 0, track = null) {
    const wavBuf = this.nativeAudioEngine.decimateDsfToWav(filePath, startSec);
    if (!wavBuf) {
      res.writeHead(500);
      res.end('Native DSD decimation failed');
      return;
    }

    const totalSize = wavBuf.length;
    const range = req.headers.range;

    const headers = {
      'Content-Type': 'audio/wav',
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'transferMode.dlna.org': 'Streaming',
      'contentFeatures.dlna.org': 'DLNA.ORG_PN=WAV;DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000'
    };

    if (req.method === 'HEAD') {
      res.writeHead(200, { ...headers, 'Content-Length': totalSize });
      res.end();
      return;
    }

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;
      const chunkSize = (end - start) + 1;

      res.writeHead(206, {
        ...headers,
        'Content-Range': `bytes ${start}-${end}/${totalSize}`,
        'Content-Length': chunkSize
      });
      res.end(wavBuf.subarray(start, end + 1));
    } else {
      res.writeHead(200, { ...headers, 'Content-Length': totalSize });
      res.end(wavBuf);
    }
  }

  // Handle High-Res PCM Upsampling to 24-bit WAV (Pure Native Engine)
  async handleSoxTranscodeStream(req, res, filePath, startSec = 0, sampleRate = 192000, precision = 24, dsdMode = '', track = null) {
    try {
      const pcm = await this.nativeAudioEngine.readPcmSamples(filePath, startSec);
      if (!pcm) {
        res.writeHead(500);
        res.end('Native PCM read failed for upsampling');
        return;
      }

      let outBuf = null;
      let mime = 'audio/wav';

      if (dsdMode) {
        outBuf = this.nativeAudioEngine.encodeDsdDsf(pcm.left, pcm.right, pcm.sampleRate, dsdMode, 300);
        mime = 'audio/x-dsf';
      } else {
        const up = this.nativeAudioEngine.upsampleHermite(pcm.left, pcm.right, pcm.sampleRate, sampleRate);
        outBuf = this.nativeAudioEngine.encodeWav24(up.outL, up.outR, sampleRate);
      }

      const totalSize = outBuf.length;
      const range = req.headers.range;

      const headers = {
        'Content-Type': mime,
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        'transferMode.dlna.org': 'Streaming',
        'contentFeatures.dlna.org': 'DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000'
      };

      if (req.method === 'HEAD') {
        res.writeHead(200, { ...headers, 'Content-Length': totalSize });
        res.end();
        return;
      }

      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;
        const chunkSize = (end - start) + 1;

        res.writeHead(206, {
          ...headers,
          'Content-Range': `bytes ${start}-${end}/${totalSize}`,
          'Content-Length': chunkSize
        });
        res.end(outBuf.subarray(start, end + 1));
      } else {
        res.writeHead(200, { ...headers, 'Content-Length': totalSize });
        res.end(outBuf);
      }
    } catch (err) {
      console.error('[DLNA] handleSoxTranscodeStream error:', err);
      if (!res.headersSent) {
        res.writeHead(500);
        res.end('Upsample transcode error');
      }
    }
  }

  // Handle album cover image serving for DLNA Renderers
  async handleCoverImage(req, res, filePath, track = null) {
    const sendCover = (mime, buf) => {
      res.writeHead(200, {
        'Content-Type': mime || 'image/jpeg',
        'Content-Length': buf.length,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=86400'
      });
      if (req.method === 'HEAD') {
        res.end();
      } else {
        res.end(buf);
      }
    };

    try {
      // 1. If track object contains base64 cover data URL or local file path
      if (track && track.cover && typeof track.cover === 'string') {
        if (track.cover.startsWith('data:')) {
          const match = track.cover.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            const mime = match[1];
            const buf = Buffer.from(match[2], 'base64');
            if (filePath) this.cacheCover(filePath, mime, buf);
            sendCover(mime, buf);
            return;
          }
        } else if (fs.existsSync(track.cover)) {
          const ext = path.extname(track.cover).toLowerCase();
          const mime = (ext === '.png') ? 'image/png' : 'image/jpeg';
          const buf = fs.readFileSync(track.cover);
          if (filePath) this.cacheCover(filePath, mime, buf);
          sendCover(mime, buf);
          return;
        }
      }

      // 2. Check in-memory coverCache
      if (filePath && this.coverCache.has(filePath)) {
        const cached = this.coverCache.get(filePath);
        sendCover(cached.mimeType || 'image/jpeg', cached.buffer);
        return;
      }

      // 3. Check local directory for cover/folder image files
      if (filePath && fs.existsSync(filePath)) {
        const dir = path.dirname(filePath);
        const candidates = [
          'cover.jpg', 'cover.jpeg', 'cover.png',
          'folder.jpg', 'folder.jpeg', 'folder.png',
          'front.jpg', 'front.jpeg', 'front.png',
          'album.jpg', 'album.jpeg', 'album.png'
        ];
        for (const name of candidates) {
          const full = path.join(dir, name);
          if (fs.existsSync(full)) {
            const buf = fs.readFileSync(full);
            const mime = (name.endsWith('.png')) ? 'image/png' : 'image/jpeg';
            this.cacheCover(filePath, mime, buf);
            sendCover(mime, buf);
            return;
          }
        }

        // 4. Fallback: Parse embedded cover via music-metadata
        try {
          const mm = await import('music-metadata');
          const metadata = await mm.parseFile(filePath, { skipCovers: false });
          if (metadata.common && metadata.common.picture && metadata.common.picture.length > 0) {
            const pic = metadata.common.picture[0];
            const buf = Buffer.from(pic.data);
            const mime = pic.format || 'image/jpeg';
            this.cacheCover(filePath, mime, buf);
            sendCover(mime, buf);
            return;
          }
        } catch (err) {
          // ignore metadata parse error
        }
      }

      // 5. Ultimate fallback: Return valid 1x1 JPEG so renderer never gets 404
      sendCover('image/jpeg', FALLBACK_JPEG);
    } catch (err) {
      console.warn('handleCoverImage error:', err);
      if (!res.headersSent) {
        sendCover('image/jpeg', FALLBACK_JPEG);
      }
    }
  }

  cacheCover(filePath, mimeType, buffer) {
    if (this.coverCache.size > 100) {
      const firstKey = this.coverCache.keys().next().value;
      this.coverCache.delete(firstKey);
    }
    this.coverCache.set(filePath, { mimeType, buffer });
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

  // Send UPnP SOAP request
  async sendSoapRequest(controlUrl, serviceType, action, bodyXml) {
    const envelope = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:${action} xmlns:u="${serviceType}">
      ${bodyXml}
    </u:${action}>
  </s:Body>
</s:Envelope>`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    try {
      const res = await fetch(controlUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset="utf-8"',
          'SOAPAction': `"${serviceType}#${action}"`
        },
        body: envelope,
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      const responseText = await res.text();
      if (!res.ok) {
        throw new Error(`SOAP ${action} failed: HTTP ${res.status} - ${responseText.slice(0, 200)}`);
      }
      return responseText;
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
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
      return await this._doPlayTrack(deviceId, track, startSec, dspOptions, opId);
    } catch (err) {
      console.error('[DLNA] PlayTrack error:', err);
      return { success: false, error: err.message };
    } finally {
      releaseLock();
    }
  }

  async _doPlayTrack(deviceId, track, startSec, dspOptions, opId) {
    const dev = this.devices.get(deviceId);
    if (!dev) return { success: false, error: 'DLNA Device not found' };

    // 1. Immediately cancel any prior polling and kill any active transcode process
    this.stopPositionPolling();
    if (this.currentDsdProcess) {
      try { this.currentDsdProcess.kill(); } catch (e) {}
      this.currentDsdProcess = null;
    }

    this.activeDeviceId = deviceId;
    this.currentTrack = track;
    this.currentDspOptions = dspOptions;
    this.trackPlayTimestamp = Date.now();
    this.hasStartedPlaying = false;
    this.playbackState = 'PLAYING';

    // 2. Explicitly send Stop to renderer and allow 150ms to clear previous media state
    // This resolves UPnP SOAP Fault 705 (TRANSITION_NOT_AVAILABLE) on track change
    try {
      await this.sendSoapRequest(
        dev.avControlUrl,
        'urn:schemas-upnp-org:service:AVTransport:1',
        'Stop',
        `<InstanceID>0</InstanceID>`
      );
      await new Promise(r => setTimeout(r, 150));
    } catch (e) {
      // Ignore if device was already stopped
    }

    if (!this.streamingServer || !this.streamingPort) {
      await this.startStreamingServer();
    }

    if (opId !== this._playOpCounter) {
      return { success: false, cancelled: true };
    }

    const localIp = this.getLocalIp();
    const ext = (track.formatName || '').toUpperCase();
    const isNativeDsd = ext === 'DSF' || ext === 'DFF' || (track.filePath && /\.(dsf|dff)$/i.test(track.filePath));
    const isNativeDsf = !!(track.filePath && /\.dsf$/i.test(track.filePath));
    const isDsdUpsample = !!(dspOptions && dspOptions.enabled && dspOptions.dsdMode);

    // Register active stream token for clean, URL-safe endpoint without long query parameters
    const streamToken = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    // Prune old activeStreams if too large
    if (this.activeStreams.size > 50) {
      const oldestKey = this.activeStreams.keys().next().value;
      this.activeStreams.delete(oldestKey);
    }

    let streamUrl = '';
    let mimeType = 'audio/flac';
    let protocolInfo = 'http-get:*:audio/flac:DLNA.ORG_PN=FLAC;DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000';

    if (isDsdUpsample) {
      // 1-bit DSD Delta-Sigma Modulation upsampling (DSD64/128/256/512 in Sony DSF container)
      streamUrl = `http://${localIp}:${this.streamingPort}/dsd-mod-stream/${streamToken}/audio.dsf`;
      mimeType = 'audio/x-dsf';
      protocolInfo = 'http-get:*:audio/x-dsf:*';
    } else if (isNativeDsf && (!dspOptions || !dspOptions.enabled)) {
      // Bit-perfect native DSF file direct streaming
      streamUrl = `http://${localIp}:${this.streamingPort}/stream/${streamToken}/track.dsf`;
      mimeType = 'audio/x-dsf';
      protocolInfo = 'http-get:*:audio/x-dsf:*';
    } else if (isNativeDsd) {
      // Native DFF or DSF needing PCM decimation to 24-bit 88.2kHz WAV
      streamUrl = `http://${localIp}:${this.streamingPort}/dsd-stream/${streamToken}/audio.wav`;
      mimeType = 'audio/wav';
      protocolInfo = 'http-get:*:audio/wav:DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000';
    } else if (dspOptions && dspOptions.enabled) {
      // PCM High-Res Upsampling to 24-bit WAV
      streamUrl = `http://${localIp}:${this.streamingPort}/sox-stream/${streamToken}/audio.wav`;
      mimeType = 'audio/wav';
      protocolInfo = 'http-get:*:audio/wav:DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000';
    } else {
      const fileExt = path.extname(track.filePath).toLowerCase() || '.flac';
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
      filePath: track.filePath,
      startSec,
      dspOptions,
      isDsd: isNativeDsd,
      isDsdUpsample,
      mimeType,
      createdAt: Date.now()
    });

    this.streamStartSec = startSec || 0;

    // Cache artwork if track contains cover data URL
    if (track.cover && typeof track.cover === 'string' && track.cover.startsWith('data:')) {
      const match = track.cover.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        const mime = match[1];
        const buffer = Buffer.from(match[2], 'base64');
        this.cacheCover(track.filePath, mime, buffer);
      }
    }

    const coverUrl = `http://${localIp}:${this.streamingPort}/cover/${streamToken}/cover.jpg`;

    // Duration in H:MM:SS.000 format
    const trackDur = (track.duration && track.duration > 0) ? track.duration : 0;
    const effectiveDur = (startSec > 0 && trackDur > startSec && (isDsdUpsample || (dspOptions && dspOptions.enabled)))
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
      `    <upnp:albumArtURI dlna:profileID="JPEG_MED">${coverUrl}</upnp:albumArtURI>`,
      `    <upnp:albumArtURI dlna:profileID="JPEG_LRG">${coverUrl}</upnp:albumArtURI>`,
      `    <upnp:albumArtURI>${coverUrl}</upnp:albumArtURI>`,
      `    <upnp:class>object.item.audioItem.musicTrack</upnp:class>`,
      `    <res protocolInfo="${protocolInfo}" ${durationAttr}>${streamUrl}</res>`,
      '  </item>',
      '</DIDL-Lite>'
    );

    const didl = didlParts.join('\n');
    const escapedDidl = escapeXml(didl);

    // 3. SetAVTransportURI with retry loop and metadata fallback
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

    // 4. Play with retry loop
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

    // 5. If seeking needed on non-DSD/non-DSP file (since DSD & SoX stream handle -ss directly in FFmpeg)
    if (startSec > 0 && !isNativeDsd && !isDsdUpsample && (!dspOptions || !dspOptions.enabled)) {
      await new Promise(r => setTimeout(r, 300));
      await this.seek(deviceId, startSec).catch(() => {});
    }

    this.playbackState = 'PLAYING';
    this.startPositionPolling(dev);
    return { success: true, streamUrl };
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

    // For transcoded streams (DSD or SoX Resampler), UPnP Seek does not work on generated stream;
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

    this.positionTimer = setInterval(async () => {
      if (sessionId !== this._pollSessionCounter) {
        clearInterval(this.positionTimer);
        return;
      }
      try {
        const info = await this.getPositionInfo(dev);
        if (sessionId !== this._pollSessionCounter) return;

        const reportedSec = info.currentSec;
        const actualSec = (this.streamStartSec > 0) ? (this.streamStartSec + reportedSec) : reportedSec;
        const totalDurationSec = (this.currentTrack && this.currentTrack.duration > 0)
          ? this.currentTrack.duration
          : (info.durationSec > 0 ? (info.durationSec + (this.streamStartSec || 0)) : 0);

        this.currentPositionSec = actualSec;
        if (totalDurationSec > 0) this.currentDurationSec = totalDurationSec;

        const stateUpper = (info.state || '').toUpperCase();

        // Mark that device has successfully transitioned into PLAYING or TRANSITIONING
        if (stateUpper === 'PLAYING' || stateUpper === 'TRANSITIONING') {
          this.hasStartedPlaying = true;
        }

        this.emit('playback-progress', {
          currentSec: actualSec,
          durationSec: this.currentDurationSec,
          state: info.state
        });

        const timeSinceStart = Date.now() - this.trackPlayTimestamp;
        // Safety guard: device must have genuinely transitioned to PLAYING and played at least 6 seconds,
        // or 20 seconds must have elapsed since play command, avoiding early STOPPED buffer blips
        const canTriggerEnded = (this.hasStartedPlaying && timeSinceStart > 6000) || (timeSinceStart > 20000);

        // Condition A: Standard DLNA state change to STOPPED / NO_MEDIA_PRESENT / COMPLETED
        const isDeviceStopped = (
          stateUpper === 'STOPPED' ||
          stateUpper === 'NO_MEDIA_PRESENT' ||
          stateUpper === 'COMPLETED'
        );

        if (canTriggerEnded && isDeviceStopped && this.playbackState === 'PLAYING') {
          console.log(`[DLNA] Track finished on renderer (state=${stateUpper}, elapsed=${timeSinceStart}ms), triggering next track`);
          this.playbackState = 'STOPPED';
          this.stopPositionPolling();
          this.emit('track-ended');
          return;
        }

        // Condition B: Time-based threshold guard
        // If reported progress reaches total duration (or within 1.5s of end)
        if (canTriggerEnded && this.playbackState === 'PLAYING' && totalDurationSec > 10) {
          if (actualSec >= totalDurationSec || (totalDurationSec - actualSec <= 1.5 && actualSec > 0)) {
            nearEndCount++;
            // If near end for 2 consecutive ticks (2 seconds)
            if (nearEndCount >= 2) {
              console.log(`[DLNA] Track reached duration limit (${actualSec}/${totalDurationSec}s), triggering next track`);
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
    if (this.currentDsdProcess) {
      try { this.currentDsdProcess.kill(); } catch (e) {}
      this.currentDsdProcess = null;
    }

    // Proactively send Stop command to active DLNA renderer so music does not keep playing on hardware device
    if (this.activeDeviceId && this.activeDeviceId !== 'local') {
      const dev = this.devices.get(this.activeDeviceId);
      if (dev && dev.avControlUrl) {
        try {
          await this.sendSoapRequest(
            dev.avControlUrl,
            'urn:schemas-upnp-org:service:AVTransport:1',
            'Stop',
            `<InstanceID>0</InstanceID>`
          );
        } catch (e) {}
      }
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
