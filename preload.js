const { contextBridge, ipcRenderer } = require('electron');
const { pathToFileURL } = require('url');

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximizeToggle: () => ipcRenderer.invoke('window:maximizeToggle'),
  close: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  onMaximizedChange: (callback) => {
    ipcRenderer.on('window:maximizedChange', (_event, isMax) => callback(isMax));
  },

  // Library & File Dialogs
  selectFolder: () => ipcRenderer.invoke('dialog:selectFolder'),
  scanFolder: (folderPath) => ipcRenderer.invoke('library:scanFolder', folderPath),
  onScanProgress: (callback) => {
    ipcRenderer.on('library:scanProgress', (_event, data) => callback(data));
  },
  loadSavedLibrary: () => ipcRenderer.invoke('library:loadSaved'),
  removeFolder: (folderPath) => ipcRenderer.invoke('library:removeFolder', folderPath),
  updateAlbumArtist: (albumTitle, artistName) => ipcRenderer.invoke('library:updateAlbumArtist', albumTitle, artistName),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  getDsdStreamUrl: (filePath, startSec = 0) => ipcRenderer.invoke('audio:getDsdStreamUrl', filePath, startSec),
  getSoxStreamUrl: (filePath, startSec = 0, sampleRate = 192000, precision = 28, dsdMode = '') => ipcRenderer.invoke('audio:getSoxStreamUrl', filePath, startSec, sampleRate, precision, dsdMode),
  getAudioDuration: (filePath) => ipcRenderer.invoke('audio:getAudioDuration', filePath),
  translateToZhTw: (text) => ipcRenderer.invoke('util:translateToZhTw', text),

  // DLNA / UPnP Subsystem
  getDlnaDevices: () => ipcRenderer.invoke('dlna:getDevices'),
  scanDlnaDevices: () => ipcRenderer.invoke('dlna:scan'),
  probeDlnaIp: (ip) => ipcRenderer.invoke('dlna:probeIp', ip),
  selectDlnaDevice: (deviceId) => ipcRenderer.invoke('dlna:selectDevice', deviceId),
  playDlnaTrack: (deviceId, track, startSec = 0, dspOptions = null) => ipcRenderer.invoke('dlna:playTrack', deviceId, track, startSec, dspOptions),
  pauseDlna: (deviceId) => ipcRenderer.invoke('dlna:pause', deviceId),
  resumeDlna: (deviceId) => ipcRenderer.invoke('dlna:resume', deviceId),
  stopDlna: (deviceId) => ipcRenderer.invoke('dlna:stop', deviceId),
  seekDlna: (deviceId, seconds) => ipcRenderer.invoke('dlna:seek', deviceId, seconds),
  setDlnaVolume: (deviceId, volume) => ipcRenderer.invoke('dlna:setVolume', deviceId, volume),
  onDlnaDevicesChanged: (callback) => {
    ipcRenderer.on('dlna:devicesChanged', (_event, list) => callback(list));
  },
  onDlnaProgress: (callback) => {
    ipcRenderer.on('dlna:progress', (_event, progress) => callback(progress));
  },
  onDlnaTrackEnded: (callback) => {
    ipcRenderer.on('dlna:trackEnded', () => callback());
  },

  // Media file URL helper - produces 100% compliant standard file:/// URL for seamless audio playback
  getMediaUrl: (absolutePath) => {
    if (!absolutePath) return '';
    try {
      return pathToFileURL(absolutePath).href;
    } catch (e) {
      const normalized = absolutePath.replace(/\\/g, '/');
      return `file:///${normalized}`;
    }
  }
});
