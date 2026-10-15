const { contextBridge, ipcRenderer } = require('electron');
const { pathToFileURL } = require('url');

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximizeToggle: () => ipcRenderer.invoke('window:maximizeToggle'),
  close: () => ipcRenderer.invoke('window:close'),
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
  saveLibraryTracks: (tracks) => ipcRenderer.invoke('library:saveTracks', tracks),
  exportLibrary: (defaultFilename, extraData) => ipcRenderer.invoke('library:export', defaultFilename, extraData),
  importLibrary: () => ipcRenderer.invoke('library:import'),
  readPlaylistFile: () => ipcRenderer.invoke('playlist:readFile'),
  writePlaylistFile: (suggestedName, text, ext) => ipcRenderer.invoke('playlist:writeFile', suggestedName, text, ext),
  removeFolder: (folderPath) => ipcRenderer.invoke('library:removeFolder', folderPath),
  updateAlbumArtist: (albumTitle, artistName) => ipcRenderer.invoke('library:updateAlbumArtist', albumTitle, artistName),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  getDsdStreamUrl: (filePath, startSec = 0, peqJson = '', convJson = '') => ipcRenderer.invoke('audio:getDsdStreamUrl', filePath, startSec, peqJson, convJson),
  getSoxStreamUrl: (filePath, startSec = 0, sampleRate = 192000, dsdMode = '', dsdOrder = 5, filterPhase = 'linear', peqJson = '', convJson = '') => ipcRenderer.invoke('audio:getSoxStreamUrl', filePath, startSec, sampleRate, dsdMode, dsdOrder, filterPhase, peqJson, convJson),
  pickIrFile: () => ipcRenderer.invoke('conv:pickIrFile'),
  getIrInfo: (irPath) => ipcRenderer.invoke('conv:getIrInfo', irPath),
  listFilterPlugins: () => ipcRenderer.invoke('dsp:listFilterPlugins'),
  listFilterSlots: () => ipcRenderer.invoke('filters:listSlots'),
  saveFilterSlot: (spec) => ipcRenderer.invoke('filters:saveSlot', spec),
  deleteFilterSlot: (slotId) => ipcRenderer.invoke('filters:deleteSlot', slotId),
  previewFilterSpec: (spec, srcRate, targetRate) => ipcRenderer.invoke('filters:preview', spec, srcRate, targetRate),
  captureStep: (n, info) => ipcRenderer.send('capture:step', n, info),
  getAudioDuration: (filePath) => ipcRenderer.invoke('audio:getAudioDuration', filePath),
  translateToZhTw: (text) => ipcRenderer.invoke('util:translateToZhTw', text),

  // TIDAL Streaming Subsystem
  tidalLoginWithWindow: () => ipcRenderer.invoke('tidal:loginWithWindow'),
  tidalProbeAuth: () => ipcRenderer.invoke('tidal:probeAuth'),
  tidalGetStoredAuth: () => ipcRenderer.invoke('tidal:getStoredAuth'),
  tidalSaveAuth: (data) => ipcRenderer.invoke('tidal:saveAuth', data),
  tidalLogout: () => ipcRenderer.invoke('tidal:logout'),
  tidalApi: (options) => ipcRenderer.invoke('tidal:api', options),
  tidalGetStreamUrl: (trackId, playbackInfo) => ipcRenderer.invoke('tidal:getStreamUrl', trackId, playbackInfo),
  tidalCacheTrack: (trackId, streamUrlOrInfo, optionalInfo) => ipcRenderer.invoke('tidal:cacheTrack', trackId, streamUrlOrInfo, optionalInfo),

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
  getAudioSpectrum: (token, timeSec) => ipcRenderer.invoke('audio:getSpectrum', token, timeSec),
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
  onDlnaPrepareStatus: (callback) => {
    ipcRenderer.on('dlna:prepareStatus', (_event, info) => callback(info));
  },
  getFakeDlnaRendererActions: () => ipcRenderer.invoke('dlna:fakeRendererActions'),

  // WASAPI 獨佔輸出（Windows 聲音獨佔模式）
  exclusiveProbe: (force = false) => ipcRenderer.invoke('exclusive:probe', force),
  exclusiveStart: (options) => ipcRenderer.invoke('exclusive:start', options),
  exclusivePause: () => ipcRenderer.invoke('exclusive:pause'),
  exclusiveResume: () => ipcRenderer.invoke('exclusive:resume'),
  exclusiveSeek: (streamSeconds) => ipcRenderer.invoke('exclusive:seek', streamSeconds),
  exclusiveStop: () => ipcRenderer.invoke('exclusive:stop'),
  exclusiveState: () => ipcRenderer.invoke('exclusive:state'),
  onExclusiveStatus: (callback) => {
    ipcRenderer.on('exclusive:status', (_event, payload) => callback(payload));
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
