const { app, BrowserWindow, ipcMain, dialog, protocol, net, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const http = require('http');
const { spawn } = require('child_process');

const nativeAudioEngine = require('./native-audio-engine');
const mm = require('music-metadata');

const DlnaManager = require('./dlna-manager');
let dlnaManager = null;

// Optimize Chromium GPU rendering and process responsiveness for high-resolution audio processing
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1040,
    minHeight: 680,
    backgroundColor: '#0f1013',
    frame: false, // Custom Roon-style titlebar
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

  mainWindow.loadFile('index.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window:maximizedChange', true);
  });

  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('window:maximizedChange', false);
  });
}

app.whenReady().then(() => {
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
      let filePath = decodeURIComponent(request.url.replace(/^media:\/\//, ''));
      if (process.platform === 'win32') {
        filePath = filePath.replace(/^\//, '');
      }
      return net.fetch(pathToFileURL(filePath).toString());
    } catch (err) {
      console.error('Error streaming media file:', err);
      return new Response('File not found', { status: 404 });
    }
  });

  createWindow();
  startDsdStreamingServer();

  // Initialize DLNA / UPnP Subsystem (Pure Native Audio Engine)
  dlnaManager = new DlnaManager({ nativeAudioEngine });
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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

let isAppQuitting = false;

async function cleanupAllAudioStreams() {
  if (currentMainStreamProc) {
    try { currentMainStreamProc.kill(); } catch (e) {}
    currentMainStreamProc = null;
  }
  if (dsdStreamServer) {
    try { dsdStreamServer.close(); } catch (e) {}
  }
  if (dlnaManager) {
    try { await dlnaManager.destroy(); } catch (e) {}
  }
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

// DSD Streaming Server Engine
let dsdStreamServer = null;
let dsdStreamPort = 0;

let currentMainStreamProc = null;

function startDsdStreamingServer() {
  dsdStreamServer = http.createServer((req, res) => {
    try {
      const reqUrl = new URL(req.url, 'http://127.0.0.1');

      // Native DSP PCM Upsampling Stream
      if (reqUrl.pathname === '/sox-stream') {
        const filePath = reqUrl.searchParams.get('file');
        const startSec = parseFloat(reqUrl.searchParams.get('start') || '0');
        const sampleRate = parseInt(reqUrl.searchParams.get('rate') || '192000', 10);
        const dsdMode = reqUrl.searchParams.get('dsd') || '';

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

        // Read raw PCM samples from disk without any external process (async with WASM FLAC / WAV / AIFF)
        nativeAudioEngine.readPcmSamples(filePath, startSec).then(pcm => {
          if (!pcm) {
            res.writeHead(500);
            res.end('Native PCM read failed');
            return;
          }

          let outBuf = null;
          const isLocal = reqUrl.searchParams.get('local') === '1';

          if (dsdMode && !isLocal) {
            // Native DSD Modulation: Noise-Shaped Delta-Sigma Modulator (for DLNA / DSD DACs)
            outBuf = nativeAudioEngine.encodeDsdDsf(pcm.left, pcm.right, pcm.sampleRate, dsdMode, 300);
            res.writeHead(200, {
              'Content-Type': 'audio/x-dsf',
              'Content-Length': outBuf.length,
              'Access-Control-Allow-Origin': '*'
            });
          } else {
            // Native Cubic Hermite Upsampling to Target Sample Rate (WAV format fully supported by Chromium and DACs)
            const up = nativeAudioEngine.upsampleHermite(pcm.left, pcm.right, pcm.sampleRate, sampleRate);
            outBuf = nativeAudioEngine.encodeWav24(up.outL, up.outR, sampleRate);
            res.writeHead(200, {
              'Content-Type': 'audio/wav',
              'Content-Length': outBuf.length,
              'Access-Control-Allow-Origin': '*'
            });
          }

          res.end(outBuf);
        }).catch(err => {
          console.error('[StreamServer] readPcmSamples error:', err);
          if (!res.headersSent) {
            res.writeHead(500);
            res.end('Native audio stream error');
          }
        });
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

        res.writeHead(200, {
          'Content-Type': 'audio/wav',
          'Content-Length': outWav.length,
          'Access-Control-Allow-Origin': '*'
        });
        res.end(outWav);
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
ipcMain.handle('window:isMaximized', () => mainWindow ? mainWindow.isMaximized() : false);
ipcMain.handle('shell:openExternal', (event, url) => {
  if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
    shell.openExternal(url);
  }
});

// DSD Stream URL helper IPC
ipcMain.handle('audio:getDsdStreamUrl', (event, filePath, startSec = 0) => {
  if (!dsdStreamPort) return '';
  const params = new URLSearchParams();
  params.set('file', filePath);
  if (startSec > 0) params.set('start', startSec.toString());
  return `http://127.0.0.1:${dsdStreamPort}/dsd-stream?${params.toString()}`;
});

// SoX Resampler Stream URL helper IPC
ipcMain.handle('audio:getSoxStreamUrl', (event, filePath, startSec = 0, sampleRate = 192000, precision = 28, dsdMode = '') => {
  if (!dsdStreamPort) return '';
  const params = new URLSearchParams();
  params.set('file', filePath);
  if (startSec > 0) params.set('start', startSec.toString());
  params.set('rate', sampleRate.toString());
  params.set('precision', precision.toString());
  if (dsdMode) params.set('dsd', dsdMode);
  params.set('local', '1'); // Local Electron Chromium playback needs decoded PCM WAV
  return `http://127.0.0.1:${dsdStreamPort}/sox-stream?${params.toString()}`;
});

async function getAudioDurationNative(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return 0;
  try {
    const meta = await mm.parseFile(filePath, { duration: true, skipCovers: true });
    if (meta && meta.format && meta.format.duration) {
      return meta.format.duration;
    }
  } catch (e) {
    // Fallback: check DSF header directly
    const dsf = nativeAudioEngine.parseDsf(filePath);
    if (dsf && dsf.dsdRate > 0) {
      return dsf.sampleCount / dsf.dsdRate;
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
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-TW&dt=t&q=${encodeURIComponent(text.trim())}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (res.ok) {
      const data = await res.json();
      if (data && data[0] && Array.isArray(data[0])) {
        const translated = data[0].map(s => (s && s[0]) ? s[0] : '').join('').trim();
        if (translated) return translated;
      }
    }
  } catch (err) {
    console.warn('Translate to Traditional Chinese failed:', err);
  }
  return text;
});

// DLNA / UPnP MediaRenderer IPC handlers
ipcMain.handle('dlna:getDevices', () => {
  return dlnaManager ? dlnaManager.getDeviceList() : [{ id: 'local', name: '本機音訊 (此電腦)', active: true }];
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

function readImageAsDataUrl(imgFilePath) {
  try {
    const ext = path.extname(imgFilePath).toLowerCase();
    const mime = (ext === '.png') ? 'image/png' : (ext === '.webp' ? 'image/webp' : 'image/jpeg');
    const data = fs.readFileSync(imgFilePath);
    return `data:${mime};base64,${data.toString('base64')}`;
  } catch (e) {
    return null;
  }
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
        if (fs.existsSync(p)) return readImageAsDataUrl(p);
      }
      const files = fs.readdirSync(dir);
      const matched = files.find(f => /\.(jpe?g|png|webp)$/i.test(f) && /cover|folder|front|art/i.test(f))
                   || files.find(f => /\.(jpe?g|png|webp)$/i.test(f));
      if (matched) return readImageAsDataUrl(path.join(dir, matched));
    }

    if (parentDir && parentDir !== dir && fs.existsSync(parentDir)) {
      for (const name of priorityNames) {
        const p = path.join(parentDir, name);
        if (fs.existsSync(p)) return readImageAsDataUrl(p);
      }
      const files = fs.readdirSync(parentDir);
      const matched = files.find(f => /\.(jpe?g|png|webp)$/i.test(f) && /cover|folder|front|art/i.test(f));
      if (matched) return readImageAsDataUrl(path.join(parentDir, matched));
    }
  } catch (e) {}
  return null;
}

ipcMain.handle('library:scanFolder', async (event, folderPath) => {
  const { parseFile } = await import('music-metadata');
  const allFiles = getAllAudioFiles(folderPath);
  const total = allFiles.length;
  const tracks = [];

  for (let i = 0; i < total; i++) {
    const filePath = allFiles[i];
    const fileName = path.basename(filePath);
    
    // Notify progress every few items
    if (i % 5 === 0 || i === total - 1) {
      mainWindow.webContents.send('library:scanProgress', {
        current: i + 1,
        total,
        currentFile: fileName
      });
    }

    try {
      const metadata = await parseFile(filePath, { skipCovers: false });
      const common = metadata.common || {};
      const format = metadata.format || {};

      let coverDataUrl = null;
      if (common.picture && common.picture.length > 0) {
        const pic = common.picture[0];
        const base64 = Buffer.from(pic.data).toString('base64');
        coverDataUrl = `data:${pic.format};base64,${base64}`;
      }
      if (!coverDataUrl) {
        coverDataUrl = findFolderCover(filePath);
      }

      const ext = path.extname(filePath).replace('.', '').toUpperCase();
      let duration = format.duration || 0;
      if (!duration && (ext === 'DSF' || ext === 'DFF')) {
        duration = await getDurationWithFfmpeg(filePath);
      }
      const sampleRate = format.sampleRate || ((ext === 'DSF' || ext === 'DFF') ? 2822400 : 44100);
      const bitsPerSample = format.bitsPerSample || ((ext === 'DSF' || ext === 'DFF') ? 1 : (ext === 'FLAC' ? 24 : 16));
      const isLossless = format.lossless || ['FLAC', 'WAV', 'AIFF', 'DSF', 'DFF', 'ALAC'].includes(ext);

      const labelStr = common.label ? (Array.isArray(common.label) ? common.label.join(', ') : common.label) : null;
      const producerStr = common.producers ? (Array.isArray(common.producers) ? common.producers.join(', ') : common.producers) : (common.producer ? (Array.isArray(common.producer) ? common.producer.join(', ') : common.producer) : null);
      const composerStr = common.composers ? (Array.isArray(common.composers) ? common.composers.join(', ') : common.composers) : (common.composer ? (Array.isArray(common.composer) ? common.composer.join(', ') : common.composer) : null);
      const dateStr = common.date || (common.originalyear ? String(common.originalyear) : null);

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
        genre: common.genre ? common.genre.join(', ') : 'Unknown',
        trackNumber: common.track?.no || (i + 1),
        diskNumber: common.disk?.no || 1,
        duration,
        sampleRate,
        bitsPerSample,
        bitrate: format.bitrate || 0,
        codec: format.codec || ext,
        formatName: ext,
        isLossless,
        cover: coverDataUrl,
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
        duration = await getDurationWithFfmpeg(filePath);
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
        genre: 'Unknown',
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
      if (!t.filePath) return false;
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

    for (const candPath of candidateFiles) {
      if (fs.existsSync(candPath)) {
        try {
          const raw = fs.readFileSync(candPath, 'utf-8');
          const data = JSON.parse(raw);
          (data.folders || []).forEach(f => folderSet.add(f));
          (data.tracks || []).forEach(t => {
            if (t && t.filePath) {
              const normPath = path.normalize(t.filePath).toLowerCase();
              if (!trackPathMap.has(normPath)) {
                trackPathMap.set(normPath, t);
              } else {
                const existing = trackPathMap.get(normPath);
                if (!existing.cover && t.cover) {
                  existing.cover = t.cover;
                }
              }
            }
          });
        } catch (e) {
          console.warn(`Error reading candidate library ${candPath}:`, e);
        }
      }
    }

    const mergedTracks = Array.from(trackPathMap.values());
    let modified = false;

    // Auto-enrich any track missing cover or smart title/artist
    for (const t of mergedTracks) {
      if (!t.cover && t.filePath) {
        const foundCover = findFolderCover(t.filePath);
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
    }

    const finalResult = {
      updatedAt: new Date().toISOString(),
      folders: Array.from(folderSet),
      tracks: mergedTracks
    };

    if (mergedTracks.length > 0 && modified) {
      fs.writeFileSync(LIBRARY_FILE, JSON.stringify(finalResult), 'utf-8');
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
    if (!t.filePath) return false;
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
      playStats: (extraData && extraData.playStats) ? extraData.playStats : { albums: {}, tracks: {} }
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
      }
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
      if (typeof f === 'string' && f.trim()) {
        const norm = path.normalize(f.trim()).toLowerCase();
        folderNormMap.set(norm, f);
      }
    });

    // Track deduplication maps (by filePath and by artist + title)
    const trackFilePathMap = new Map();
    const trackMetaSet = new Set();

    currentTracks.forEach(t => {
      if (t) {
        if (t.filePath) {
          const normP = path.normalize(t.filePath).toLowerCase();
          trackFilePathMap.set(normP, t);
        }
        const art = (t.artist || '').trim().toLowerCase();
        const tit = (t.title || '').trim().toLowerCase();
        if (art && tit) {
          trackMetaSet.add(`${art}:::${tit}`);
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

    // 1. Process imported folders
    const importFolders = Array.isArray(importedData.folders) ? importedData.folders : [];
    report.folders.totalInImport = importFolders.length;

    for (const rawF of importFolders) {
      if (!rawF || typeof rawF !== 'string' || !rawF.trim()) continue;
      const trimmedF = rawF.trim();
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

    // 2. Process imported tracks
    const importTracks = Array.isArray(importedData.tracks) ? importedData.tracks : [];
    report.tracks.totalInImport = importTracks.length;

    for (const t of importTracks) {
      if (!t) continue;
      const tPath = t.filePath ? path.normalize(t.filePath).toLowerCase() : '';
      const tArt = (t.artist || '').trim().toLowerCase();
      const tTit = (t.title || '').trim().toLowerCase();
      const metaKey = (tArt && tTit) ? `${tArt}:::${tTit}` : '';

      let isDuplicate = false;
      let skipReason = '';

      if (tPath && trackFilePathMap.has(tPath)) {
        isDuplicate = true;
        skipReason = `檔案路徑已存在 (${t.filePath})`;
      } else if (metaKey && trackMetaSet.has(metaKey)) {
        isDuplicate = true;
        skipReason = `演出者與曲名重複 (${t.artist || '未知'} - ${t.title || '未知'})`;
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
      report
    };
  } catch (err) {
    console.error('Failed to import library:', err);
    return { success: false, error: err.message };
  }
});
