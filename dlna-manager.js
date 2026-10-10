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
    this.ffmpegPath = options.ffmpegPath || null;
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
    this.coverCache = new Map(); // filePath -> { mimeType, buffer }
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
    this.streamingServer = http.createServer((req, res) => {
      try {
        const reqUrl = new URL(req.url, 'http://127.0.0.1');
        const pathname = reqUrl.pathname;

        if (pathname === '/stream') {
          const filePath = reqUrl.searchParams.get('file');
          if (!filePath || !fs.existsSync(filePath)) {
            res.writeHead(404);
            res.end('File not found');
            return;
          }
          this.handleLocalAudioStream(req, res, filePath);
        } else if (pathname === '/dsd-stream') {
          const filePath = reqUrl.searchParams.get('file');
          const startSec = parseFloat(reqUrl.searchParams.get('start') || '0');
          if (!filePath || !fs.existsSync(filePath)) {
            res.writeHead(404);
            res.end('File not found');
            return;
          }
          this.handleDsdTranscodeStream(req, res, filePath, startSec);
        } else if (pathname === '/sox-stream') {
          const filePath = reqUrl.searchParams.get('file');
          const startSec = parseFloat(reqUrl.searchParams.get('start') || '0');
          const sampleRate = parseInt(reqUrl.searchParams.get('rate') || '192000', 10);
          const precision = parseInt(reqUrl.searchParams.get('precision') || '28', 10);
          const dsdMode = reqUrl.searchParams.get('dsd') || '';
          if (!filePath || !fs.existsSync(filePath)) {
            res.writeHead(404);
            res.end('File not found');
            return;
          }
          this.handleSoxTranscodeStream(req, res, filePath, startSec, sampleRate, precision, dsdMode);
        } else if (pathname === '/cover') {
          const filePath = reqUrl.searchParams.get('file');
          if (!filePath || !fs.existsSync(filePath)) {
            res.writeHead(404);
            res.end('Cover not found');
            return;
          }
          this.handleCoverImage(req, res, filePath);
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
    });
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
      '.aiff': 'audio/aiff'
    };
    const contentType = mimeMap[ext] || 'audio/flac';

    if (req.method === 'HEAD') {
      res.writeHead(200, {
        'Content-Length': totalSize,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'transferMode.dlna.org': 'Streaming',
        'Access-Control-Allow-Origin': '*'
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
        'Content-Range': `bytes ${start}-${end}/${totalSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType,
        'transferMode.dlna.org': 'Streaming',
        'Access-Control-Allow-Origin': '*'
      });

      const stream = fs.createReadStream(filePath, { start, end });
      stream.pipe(res);
      req.on('close', () => stream.destroy());
    } else {
      res.writeHead(200, {
        'Content-Length': totalSize,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'transferMode.dlna.org': 'Streaming',
        'Access-Control-Allow-Origin': '*'
      });

      const stream = fs.createReadStream(filePath);
      stream.pipe(res);
      req.on('close', () => stream.destroy());
    }
  }

  // Handle DSD (.dsf / .dff) on-the-fly decimation transcoding to 24-bit / 88.2 kHz FLAC
  handleDsdTranscodeStream(req, res, filePath, startSec = 0) {
    if (!this.ffmpegPath) {
      res.writeHead(500);
      res.end('FFmpeg not available for DSD decoding');
      return;
    }

    if (req.method === 'HEAD') {
      res.writeHead(200, {
        'Content-Type': 'audio/flac',
        'Access-Control-Allow-Origin': '*',
        'transferMode.dlna.org': 'Streaming',
        'Transfer-Encoding': 'chunked'
      });
      res.end();
      return;
    }

    if (this.currentDsdProcess) {
      try { this.currentDsdProcess.kill(); } catch (e) {}
      this.currentDsdProcess = null;
    }

    const ffmpegArgs = [];
    if (startSec > 0) {
      ffmpegArgs.push('-ss', startSec.toString());
    }
    ffmpegArgs.push(
      '-i', filePath,
      '-af', 'volume=6dB',
      '-c:a', 'flac',
      '-ar', '88200',
      '-f', 'flac',
      'pipe:1'
    );

    res.writeHead(200, {
      'Content-Type': 'audio/flac',
      'Access-Control-Allow-Origin': '*',
      'transferMode.dlna.org': 'Streaming',
      'Transfer-Encoding': 'chunked'
    });

    const proc = spawn(this.ffmpegPath, ffmpegArgs, { windowsHide: true });
    this.currentDsdProcess = proc;
    proc.stdout.pipe(res);
    proc.stderr.on('data', () => {});

    proc.on('error', (err) => {
      console.error('[DLNA] DSD transcode process error:', err);
    });

    req.on('close', () => {
      try {
        proc.kill();
      } catch (e) {}
    });
  }

  // Handle SoX Resampler (libsoxr) on-the-fly audiophile upsampling or 1-bit DSD modulation to 24-bit Hi-Res FLAC
  handleSoxTranscodeStream(req, res, filePath, startSec = 0, sampleRate = 192000, precision = 28, dsdMode = '') {
    if (!this.ffmpegPath) {
      res.writeHead(500);
      res.end('FFmpeg not available for SoX Resampling');
      return;
    }

    if (req.method === 'HEAD') {
      res.writeHead(200, {
        'Content-Type': 'audio/flac',
        'Access-Control-Allow-Origin': '*',
        'transferMode.dlna.org': 'Streaming',
        'Transfer-Encoding': 'chunked'
      });
      res.end();
      return;
    }

    if (this.currentDsdProcess) {
      try { this.currentDsdProcess.kill(); } catch (e) {}
      this.currentDsdProcess = null;
    }

    const afFilter = dsdMode
      ? `aresample=resampler=soxr:precision=${precision}:cheby=1:dither_method=triangular_hp:osr=${sampleRate}`
      : `aresample=resampler=soxr:precision=${precision}:cheby=1:osr=${sampleRate}`;

    const ffmpegArgs = [];
    if (startSec > 0) {
      ffmpegArgs.push('-ss', startSec.toString());
    }
    ffmpegArgs.push(
      '-i', filePath,
      '-af', afFilter,
      '-c:a', 'flac',
      '-sample_fmt', 's32',
      '-ar', sampleRate.toString(),
      '-f', 'flac',
      'pipe:1'
    );

    res.writeHead(200, {
      'Content-Type': 'audio/flac',
      'Access-Control-Allow-Origin': '*',
      'transferMode.dlna.org': 'Streaming',
      'Transfer-Encoding': 'chunked'
    });

    const proc = spawn(this.ffmpegPath, ffmpegArgs, { windowsHide: true });
    this.currentDsdProcess = proc;
    proc.stdout.pipe(res);
    proc.stderr.on('data', () => {});

    proc.on('error', (err) => {
      console.error('[DLNA] SoX Resampler transcode process error:', err);
      if (!res.headersSent) {
        res.writeHead(500);
        res.end('SoX transcode error');
      }
    });

    req.on('close', () => {
      try {
        proc.kill();
      } catch (e) {}
    });
  }

  // Handle album cover image serving for DLNA Renderers
  async handleCoverImage(req, res, filePath) {
    try {
      // 1. Check in-memory cache first
      if (this.coverCache.has(filePath)) {
        const cached = this.coverCache.get(filePath);
        res.writeHead(200, {
          'Content-Type': cached.mimeType || 'image/jpeg',
          'Content-Length': cached.buffer.length,
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=86400'
        });
        res.end(cached.buffer);
        return;
      }

      // 2. Check local folder for cover / folder images
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
          res.writeHead(200, {
            'Content-Type': mime,
            'Content-Length': buf.length,
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=86400'
          });
          res.end(buf);
          return;
        }
      }

      // 3. Fallback: Parse embedded cover via music-metadata
      try {
        const mm = await import('music-metadata');
        const metadata = await mm.parseFile(filePath, { skipCovers: false });
        if (metadata.common && metadata.common.picture && metadata.common.picture.length > 0) {
          const pic = metadata.common.picture[0];
          const buf = Buffer.from(pic.data);
          const mime = pic.format || 'image/jpeg';
          this.cacheCover(filePath, mime, buf);
          res.writeHead(200, {
            'Content-Type': mime,
            'Content-Length': buf.length,
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=86400'
          });
          res.end(buf);
          return;
        }
      } catch (err) {
        // metadata parse error ignored
      }

      // 4. No cover found
      res.writeHead(404);
      res.end('Cover not found');
    } catch (err) {
      console.warn('handleCoverImage error:', err);
      if (!res.headersSent) {
        res.writeHead(500);
        res.end('Server error');
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

  // Play a track on a DLNA renderer
  async playTrack(deviceId, track, startSec = 0, dspOptions = null) {
    const dev = this.devices.get(deviceId);
    if (!dev) throw new Error('DLNA Device not found');

    // 1. Immediately cancel any prior polling and kill any active transcode process
    this.stopPositionPolling();
    if (this.currentDsdProcess) {
      try { this.currentDsdProcess.kill(); } catch (e) {}
      this.currentDsdProcess = null;
    }

    this.currentTrack = track;
    this.trackPlayTimestamp = Date.now();
    this.hasStartedPlaying = false;
    this.playbackState = 'PLAYING';

    // 2. Explicitly send Stop to renderer and allow 200ms to clear previous media state
    // This resolves UPnP SOAP Fault 705 (TRANSITION_NOT_AVAILABLE) on track change
    try {
      await this.sendSoapRequest(
        dev.avControlUrl,
        'urn:schemas-upnp-org:service:AVTransport:1',
        'Stop',
        `<InstanceID>0</InstanceID>`
      );
      await new Promise(r => setTimeout(r, 200));
    } catch (e) {
      // Ignore if device was already stopped
    }

    const localIp = this.getLocalIp();
    const ext = (track.formatName || '').toUpperCase();
    const isDsd = ext === 'DSF' || ext === 'DFF' || (track.filePath && /\.(dsf|dff)$/i.test(track.filePath));
    const timestampNonce = `_t=${Date.now()}`;

    let streamUrl = '';
    let mimeType = 'audio/flac';

    if (isDsd) {
      streamUrl = `http://${localIp}:${this.streamingPort}/dsd-stream?file=${encodeURIComponent(track.filePath)}&start=${startSec}&${timestampNonce}`;
      mimeType = 'audio/flac';
    } else if (dspOptions && dspOptions.enabled) {
      const targetRate = dspOptions.sampleRate || 192000;
      const precision = dspOptions.precision || 28;
      const dsdParam = dspOptions.dsdMode ? `&dsd=${encodeURIComponent(dspOptions.dsdMode)}` : '';
      streamUrl = `http://${localIp}:${this.streamingPort}/sox-stream?file=${encodeURIComponent(track.filePath)}&start=${startSec}&rate=${targetRate}&precision=${precision}${dsdParam}&${timestampNonce}`;
      mimeType = 'audio/flac';
    } else {
      streamUrl = `http://${localIp}:${this.streamingPort}/stream?file=${encodeURIComponent(track.filePath)}&${timestampNonce}`;
      const fileExt = path.extname(track.filePath).toLowerCase();
      if (fileExt === '.mp3') mimeType = 'audio/mpeg';
      else if (fileExt === '.wav') mimeType = 'audio/wav';
      else if (fileExt === '.m4a' || fileExt === '.aac') mimeType = 'audio/mp4';
      else mimeType = 'audio/flac';
    }

    // Cache artwork if track contains cover data URL
    if (track.cover && typeof track.cover === 'string' && track.cover.startsWith('data:')) {
      const match = track.cover.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        const mime = match[1];
        const buffer = Buffer.from(match[2], 'base64');
        this.cacheCover(track.filePath, mime, buffer);
      }
    }

    const coverUrl = `http://${localIp}:${this.streamingPort}/cover?file=${encodeURIComponent(track.filePath)}`;

    // Build DIDL-Lite metadata with multi-profile UPnP album artwork
    const coverXml = `
    <upnp:albumArtURI dlna:profileID="JPEG_TN">${escapeXml(coverUrl)}</upnp:albumArtURI>
    <upnp:albumArtURI dlna:profileID="JPEG_MED">${escapeXml(coverUrl)}</upnp:albumArtURI>
    <upnp:albumArtURI dlna:profileID="JPEG_LRG">${escapeXml(coverUrl)}</upnp:albumArtURI>
    <upnp:albumArtURI>${escapeXml(coverUrl)}</upnp:albumArtURI>
    <upnp:icon>${escapeXml(coverUrl)}</upnp:icon>`;

    const didl = `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:dlna="urn:schemas-dlna-org:metadata-1-0/">
  <item id="1" parentID="0" restricted="1">
    <dc:title>${escapeXml(track.title || 'Track')}</dc:title>
    <dc:creator>${escapeXml(track.artist || 'Artist')}</dc:creator>
    <upnp:artist>${escapeXml(track.artist || 'Artist')}</upnp:artist>
    <upnp:album>${escapeXml(track.album || 'Album')}</upnp:album>
    <upnp:class>object.item.audioItem.musicTrack</upnp:class>${coverXml}
    <res protocolInfo="http-get:*:${mimeType}:*">${streamUrl}</res>
  </item>
</DIDL-Lite>`;

    const escapedDidl = escapeXml(didl);

    // 3. SetAVTransportURI with retry loop
    let uriSuccess = false;
    let lastUriError = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await this.sendSoapRequest(
          dev.avControlUrl,
          'urn:schemas-upnp-org:service:AVTransport:1',
          'SetAVTransportURI',
          `<InstanceID>0</InstanceID>
           <CurrentURI>${escapeXml(streamUrl)}</CurrentURI>
           <CurrentURIMetaData>${escapedDidl}</CurrentURIMetaData>`
        );
        uriSuccess = true;
        break;
      } catch (err) {
        lastUriError = err;
        console.warn(`[DLNA] SetAVTransportURI attempt ${attempt} failed:`, err.message);
        await new Promise(r => setTimeout(r, 250));
      }
    }
    if (!uriSuccess) {
      throw lastUriError || new Error('SetAVTransportURI failed after 3 attempts');
    }

    // 4. Play with retry loop
    let playSuccess = false;
    let lastPlayError = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
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
        await new Promise(r => setTimeout(r, 250));
      }
    }
    if (!playSuccess) {
      throw lastPlayError || new Error('Play action failed after 3 attempts');
    }

    // 5. If seeking needed on non-DSD/non-DSP file (since DSD & SoX stream handle -ss directly in FFmpeg)
    if (startSec > 0 && !isDsd && (!dspOptions || !dspOptions.enabled)) {
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

    const timeStr = formatHms(seconds);
    await this.sendSoapRequest(
      dev.avControlUrl,
      'urn:schemas-upnp-org:service:AVTransport:1',
      'Seek',
      `<InstanceID>0</InstanceID>
       <Unit>REL_TIME</Unit>
       <Target>${timeStr}</Target>`
    );
  }

  // Set Volume on DLNA renderer (0.0 to 1.0)
  async setVolume(deviceId, volFloat) {
    const dev = this.devices.get(deviceId);
    if (!dev || !dev.renderingControlUrl) return;

    const vol100 = Math.round(Math.max(0, Math.min(100, volFloat * 100)));
    await this.sendSoapRequest(
      dev.renderingControlUrl,
      'urn:schemas-upnp-org:service:RenderingControl:1',
      'SetVolume',
      `<InstanceID>0</InstanceID>
       <Channel>Master</Channel>
       <DesiredVolume>${vol100}</DesiredVolume>`
    );
  }

  // Query PositionInfo from DLNA renderer
  async getPositionInfo(dev) {
    const xml = await this.sendSoapRequest(
      dev.avControlUrl,
      'urn:schemas-upnp-org:service:AVTransport:1',
      'GetPositionInfo',
      `<InstanceID>0</InstanceID>`
    );

    const relTimeMatch = xml.match(/<RelTime>(.*?)<\/RelTime>/i);
    const trackDurMatch = xml.match(/<TrackDuration>(.*?)<\/TrackDuration>/i);
    const stateMatch = xml.match(/<CurrentTransportState>(.*?)<\/CurrentTransportState>/i);

    const relTimeStr = relTimeMatch ? relTimeMatch[1].trim() : '0:00:00';
    const durStr = trackDurMatch ? trackDurMatch[1].trim() : '0:00:00';

    const currentSec = parseHmsToSec(relTimeStr);
    const durationSec = parseHmsToSec(durStr);

    return {
      currentSec,
      durationSec,
      state: stateMatch ? stateMatch[1].trim() : this.playbackState
    };
  }

  // Start polling playback progress from DLNA device
  startPositionPolling(dev) {
    this.stopPositionPolling();
    this.positionTimer = setInterval(async () => {
      try {
        const info = await this.getPositionInfo(dev);
        this.currentPositionSec = info.currentSec;
        if (info.durationSec > 0) this.currentDurationSec = info.durationSec;

        // Mark that device has successfully transitioned into PLAYING
        if (info.state === 'PLAYING') {
          this.hasStartedPlaying = true;
        }

        this.emit('playback-progress', {
          currentSec: info.currentSec,
          durationSec: this.currentDurationSec,
          state: info.state
        });

        // Detect track ending on DLNA device with startup protection guard:
        // 1. Device must have reached PLAYING state at least once (or elapsed > 15s)
        // 2. State must be STOPPED while rooPlayer expected PLAYING
        // 3. At least 4 seconds must have elapsed since track start, preventing initial startup state false triggers
        const timeSinceStart = Date.now() - this.trackPlayTimestamp;
        const canTriggerEnded = (this.hasStartedPlaying || timeSinceStart > 15000) && (timeSinceStart > 4000);

        if (canTriggerEnded && info.state === 'STOPPED' && this.playbackState === 'PLAYING') {
          console.log('[DLNA] Track finished on renderer, emitting track-ended');
          this.playbackState = 'STOPPED';
          this.stopPositionPolling();
          this.emit('track-ended');
        }
      } catch (err) {
        // Polling fail ignored
      }
    }, 1000);
  }

  stopPositionPolling() {
    if (this.positionTimer) {
      clearInterval(this.positionTimer);
      this.positionTimer = null;
    }
  }

  // Cleanup on app exit
  destroy() {
    this.stopPositionPolling();
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

module.exports = DlnaManager;
