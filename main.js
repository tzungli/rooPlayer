const { app, BrowserWindow, ipcMain, dialog, protocol, net, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const http = require('http');
const { spawn } = require('child_process');

let ffmpegPath = null;
const customBinFfmpeg = path.join(__dirname, 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
if (fs.existsSync(customBinFfmpeg)) {
  ffmpegPath = customBinFfmpeg;
} else {
  try {
    ffmpegPath = require('ffmpeg-static');
  } catch (e) {
    console.warn('ffmpeg-static not found:', e);
  }
}

const DlnaManager = require('./dlna-manager');
let dlnaManager = null;

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
      webSecurity: false // allow streaming local media
    },
    show: false
  });

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

  // Initialize DLNA / UPnP Subsystem
  dlnaManager = new DlnaManager({ ffmpegPath });
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

app.on('window-all-closed', () => {
  if (dsdStreamServer) {
    try { dsdStreamServer.close(); } catch (e) {}
  }
  if (dlnaManager) {
    try { dlnaManager.destroy(); } catch (e) {}
  }
  if (process.platform !== 'darwin') app.quit();
});

// DSD Streaming Server Engine
let dsdStreamServer = null;
let dsdStreamPort = 0;

function startDsdStreamingServer() {
  if (!ffmpegPath) {
    console.warn('FFmpeg binary not available for DSD decoding');
    return;
  }

  dsdStreamServer = http.createServer((req, res) => {
    try {
      const reqUrl = new URL(req.url, 'http://127.0.0.1');
      if (reqUrl.pathname === '/sox-stream') {
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

        if (req.method === 'HEAD') {
          res.writeHead(200, {
            'Content-Type': 'audio/flac',
            'Access-Control-Allow-Origin': '*',
            'Transfer-Encoding': 'chunked'
          });
          res.end();
          return;
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
          'Transfer-Encoding': 'chunked'
        });

        const proc = spawn(ffmpegPath, ffmpegArgs, { windowsHide: true });
        proc.stdout.pipe(res);
        proc.stderr.on('data', () => {});

        proc.on('error', (err) => {
          console.error('FFmpeg SoX transcode process error:', err);
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
        return;
      }

      if (reqUrl.pathname !== '/dsd-stream') {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const filePath = reqUrl.searchParams.get('file');
      const startSec = parseFloat(reqUrl.searchParams.get('start') || '0');

      if (!filePath || !fs.existsSync(filePath)) {
        res.writeHead(404);
        res.end('File not found');
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

      // Fast seek with -ss before -i, output high-resolution 24-bit 88.2kHz FLAC with 6dB standard DSD gain
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
        'Transfer-Encoding': 'chunked'
      });

      const proc = spawn(ffmpegPath, ffmpegArgs, { windowsHide: true });
      proc.stdout.pipe(res);
      proc.stderr.on('data', () => {});

      proc.on('error', (err) => {
        console.error('FFmpeg DSD transcode process error:', err);
        if (!res.headersSent) {
          res.writeHead(500);
          res.end('Transcode error');
        }
      });

      req.on('close', () => {
        try {
          proc.kill();
        } catch (e) {}
      });
    } catch (err) {
      console.error('Audio stream server error:', err);
      if (!res.headersSent) {
        res.writeHead(500);
        res.end('Server error');
      }
    }
  });

  dsdStreamServer.listen(0, '127.0.0.1', () => {
    dsdStreamPort = dsdStreamServer.address().port;
    console.log(`High-Res Audio Streaming Server (DSD & SoX) running on port ${dsdStreamPort}`);
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
  return `http://127.0.0.1:${dsdStreamPort}/sox-stream?${params.toString()}`;
});

function getDurationWithFfmpeg(filePath) {
  return new Promise((resolve) => {
    if (!ffmpegPath || !filePath) return resolve(0);
    const proc = spawn(ffmpegPath, ['-i', filePath], { windowsHide: true });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', () => {
      const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (match) {
        const hours = parseFloat(match[1]);
        const mins = parseFloat(match[2]);
        const secs = parseFloat(match[3]);
        resolve(hours * 3600 + mins * 60 + secs);
      } else {
        resolve(0);
      }
    });
    proc.on('error', () => resolve(0));
  });
}

ipcMain.handle('audio:getAudioDuration', async (event, filePath) => {
  return await getDurationWithFfmpeg(filePath);
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

