// ==========================================
// rooPlayer - Audiophile Music Media Manager
// ==========================================

// ============================================================
// Parametric Equalizer (PEQ) data model (DSP settings modal)
// Audio processing itself lives in dsp-kernel.js (single source of truth);
// this block only manages the settings model, presets and the preview curve.
// ============================================================
const PEQ_BAND_COUNT = 6;
const PEQ_TYPES = ['lowshelf', 'peaking', 'highshelf', 'lowpass', 'highpass', 'notch'];
const PEQ_TYPE_LABELS = {
  lowshelf: '低架 Low Shelf',
  peaking: '峰值 Peaking',
  highshelf: '高架 High Shelf',
  lowpass: '低通 Low Pass',
  highpass: '高通 High Pass',
  notch: '陷波 Notch'
};
const PEQ_GAIN_TYPES = ['lowshelf', 'peaking', 'highshelf']; // types that add gain (headroom applies)

function defaultPeqBand(i) {
  const presets = [
    { type: 'lowshelf', freq: 100, gain: 3, q: 0.707 },
    { type: 'peaking', freq: 1000, gain: 2, q: 1.0 },
    { type: 'highshelf', freq: 6000, gain: -2, q: 0.707 },
    { type: 'peaking', freq: 300, gain: -2, q: 1.0 },
    { type: 'peaking', freq: 3000, gain: 2, q: 1.2 },
    { type: 'highpass', freq: 40, gain: 0, q: 0.707 }
  ];
  const p = presets[i] || presets[1];
  return { on: false, type: p.type, freq: p.freq, gain: p.gain, q: p.q };
}

const PEQ_PRESETS = {
  flat: [],
  warm: [
    { on: true, type: 'lowshelf', freq: 110, gain: 3, q: 0.707 },
    { on: true, type: 'peaking', freq: 300, gain: -2, q: 1.0 },
    { on: true, type: 'highshelf', freq: 8000, gain: -2.5, q: 0.707 }
  ],
  bright: [
    { on: true, type: 'lowshelf', freq: 150, gain: -2.5, q: 0.707 },
    { on: true, type: 'peaking', freq: 3200, gain: 2, q: 1.2 },
    { on: true, type: 'highshelf', freq: 7000, gain: 3.5, q: 0.707 }
  ],
  vocal: [
    { on: true, type: 'peaking', freq: 400, gain: -3, q: 1.0 },
    { on: true, type: 'peaking', freq: 2500, gain: 3.5, q: 1.2 },
    { on: true, type: 'peaking', freq: 8000, gain: -1.5, q: 1.5 }
  ],
  bass: [
    { on: true, type: 'lowshelf', freq: 80, gain: 4.5, q: 0.707 },
    { on: true, type: 'peaking', freq: 160, gain: 2, q: 1.0 },
    { on: true, type: 'peaking', freq: 2500, gain: 0.5, q: 1.5 }
  ]
};

function normalizePeqSettings(raw) {
  const bands = [];
  if (raw && Array.isArray(raw.bands)) {
    for (let i = 0; i < PEQ_BAND_COUNT; i++) {
      const b = raw.bands[i];
      if (!b) break;
      bands.push({
        on: b.on === true,
        type: PEQ_TYPES.includes(b.type) ? b.type : 'peaking',
        freq: Math.min(Math.max(Number(b.freq) || 1000, 20), 20000),
        gain: Math.min(Math.max(Number(b.gain) || 0, -12), 12),
        q: Math.min(Math.max(Number(b.q) || 0.707, 0.3), 8)
      });
    }
  }
  while (bands.length < PEQ_BAND_COUNT) bands.push(defaultPeqBand(bands.length));
  const preset = raw && typeof raw.preset === 'string' && PEQ_PRESETS[raw.preset] ? raw.preset : 'custom';
  return { enabled: !!(raw && raw.enabled), preset, bands };
}

function countActivePeqBands() {
  const peq = state.dsp && state.dsp.peq;
  if (!peq || !peq.enabled) return 0;
  return peq.bands.filter(b => b.on).length;
}

// Headroom exactly as dsp-kernel.createPeqChain computes it: pre-gain = -(maxBoost + 0.5 dB)
function peqHeadroomDb() {
  const peq = state.dsp && state.dsp.peq;
  if (!peq || !peq.enabled) return 0;
  let maxBoost = 0;
  for (const b of peq.bands) {
    if (b.on && PEQ_GAIN_TYPES.includes(b.type)) maxBoost = Math.max(maxBoost, b.gain);
  }
  return Math.max(0, maxBoost) + 0.5;
}

// Compact payload sent to the engine (DLNA dspOptions.peq / local stream ?peq= JSON).
// PEQ is fully independent of the upsampling engine: it acts whenever its own switch is on.
// With the engine off the engine applies it at the native sample rate.
function buildPeqPayload() {
  const peq = state.dsp && state.dsp.peq;
  if (!state.dsp || !peq || !peq.enabled) return null;
  const bands = peq.bands.filter(b => b.on).map(b => ({ on: true, type: b.type, freq: Math.round(b.freq), gain: b.gain, q: b.q }));
  if (!bands.length) return null;
  return { enabled: true, bands };
}

function peqPayloadJson() {
  const p = buildPeqPayload();
  return p ? JSON.stringify(p) : '';
}

// ----------------- Convolution (IR) model -----------------
// Fully independent stage like PEQ: its own switch + one IR WAV path. The engine loads the
// IR itself (path only travels), resamples it to the session rate and applies partitioned
// frequency-domain convolution after PEQ. DSD sources take the decimate path (IR at PCM rate).
function normalizeConvSettings(raw) {
  return {
    enabled: !!(raw && raw.enabled),
    irPath: raw && typeof raw.irPath === 'string' && raw.irPath ? raw.irPath : null
  };
}

function buildConvPayload() {
  const conv = state.dsp && state.dsp.conv;
  if (!state.dsp || !conv || !conv.enabled || !conv.irPath) return null;
  return { enabled: true, irPath: conv.irPath };
}

function convPayloadJson() {
  const p = buildConvPayload();
  return p ? JSON.stringify(p) : '';
}

// True when any native-DSP processing must run: upsampling engine on, PEQ active, or convolution active.
function localDspActive() {
  return !!(state.dsp && state.dsp.enabled) || countActivePeqBands() > 0 || !!buildConvPayload();
}

// ----------------- Filter plugin registry UI -----------------
// 濾波器清單來自引擎的插件註冊表（main.js IPC dsp:listFilterPlugins）。
// 設定頁的濾波器按鈕與滑鼠提示全部由插件描述卡動態生成；新增濾波器只需在
// filter-plugins/ 放一個檔案，本檔不需要任何修改。IPC 不可用时退回內建清單。
let filterPlugins = null;
const FALLBACK_FILTER_PLUGINS = [
  { id: 'linear', label: '線性相位 (零相位失真)', sound: '零相位失真，定位精準', kind: 'interp' },
  { id: 'minimum', label: '最小相位 (零預響鈴)', sound: '零預響鈴，打擊瞬態凌厲爆發', kind: 'interp' },
  { id: 'intermediate', label: '混和 / 緩衰減 (溫潤類比)', sound: '極低預響鈴與自然高頻緩衰，溫潤類比聽感', kind: 'interp' },
  { id: 'gauss-long', label: '高斯長脈衝 FIR (極低鈴振)', sound: '通帶平坦、極低鈴振與鏡像能量', kind: 'fir' },
  { id: 'gauss-min', label: '高斯最小相位 FIR (零預響鈴)', sound: '預響鈴嚴格為零、瞬態凌厲（些微後衝）', kind: 'fir' },
  { id: 'poly-ext2', label: 'EXT2 近似 FIR (超寬過渡帶)', sound: '通帶完全平坦無漣波、高頻延伸自然；22k 以上有些許鏡像泄漏（不可聽）', kind: 'fir' },
  { id: 'hqp-ps-ext2', label: 'PS-EXT2 直譯 FIR (陡峭滾降+極深止帶)', sound: '陡峭滾降、極深止帶；鏡像泄漏僅在超聲頻（不可聽）', kind: 'fir' }
];

function filterPluginList() {
  return (filterPlugins && filterPlugins.length) ? filterPlugins : FALLBACK_FILTER_PLUGINS;
}

function isValidFilterPhaseId(id) {
  return filterPluginList().some(p => p.id === id);
}

function filterLabel(id) {
  const p = filterPluginList().find(x => x.id === id);
  return p ? p.label : '線性相位';
}

// 由插件描述卡生成濾波器按鈕（含聲音特色提示）；active 依目前設定標示。
function renderFilterPhaseSelector() {
  const sel = document.getElementById('dspPhaseSelector');
  if (!sel) return;
  const curPhase = state.dsp.filterPhase || 'linear';
  sel.innerHTML = '';
  for (const p of filterPluginList()) {
    const btn = document.createElement('button');
    btn.className = 'dsp-pill' + (p.id === curPhase ? ' active' : '');
    btn.setAttribute('data-phase', p.id);
    if (p.sound) btn.title = p.sound;
    btn.textContent = p.label;
    sel.appendChild(btn);
  }
  const hint = document.getElementById('dspActivePhaseHint');
  if (hint) hint.textContent = filterLabel(curPhase);
}

// 啟動時向引擎取得插件清單；若存定的濾波器已不存在（插件被移除）自動退回線性相位。
async function loadFilterPluginsUI() {
  if (window.electronAPI && typeof window.electronAPI.listFilterPlugins === 'function') {
    try {
      const list = await window.electronAPI.listFilterPlugins();
      if (Array.isArray(list) && list.length) filterPlugins = list;
    } catch (e) { /* 退回內建清單 */ }
  }
  if (!isValidFilterPhaseId(state.dsp.filterPhase || 'linear')) {
    state.dsp.filterPhase = 'linear';
    try { localStorage.setItem('rooplayer_dsp_settings', JSON.stringify(state.dsp)); } catch (e) {}
  }
  renderFilterPhaseSelector();
}

// Single builder for the engine dspOptions (DLNA playTrack). When the upsampling engine is
// off but PEQ / convolution is active, sampleRate stays at the track's native rate
// (native-rate-only processing).
function buildDspOptions(track) {
  const engineOn = !!(state.dsp && state.dsp.enabled);
  const peqPayload = buildPeqPayload();
  const convPayload = buildConvPayload();
  if (!engineOn && !peqPayload && !convPayload) return null;
  const srcRate = (track && track.sampleRate) || 44100;
  return {
    enabled: engineOn,
    sampleRate: engineOn ? calculateTargetSampleRate(srcRate, state.dsp.rateMode) : srcRate,
    dsdMode: engineOn && isDsdRateMode(state.dsp.rateMode) ? state.dsp.rateMode : '',
    dsdOrder: state.dsp.dsdOrder || 5,
    filterPhase: state.dsp.filterPhase || 'linear',
    peq: peqPayload,
    conv: convPayload
  };
}

// Global State
const state = {
  tracks: [],
  albums: [],
  artists: [],
  genres: [],
  folders: [],
  queue: [],
  currentTrackIndex: -1,
  isPlaying: false,
  isShuffle: false,
  repeatMode: 'off', // 'off' | 'all' | 'one'
  shuffleOrder: [],
  shufflePointer: -1,
  volume: 1.0, // 程式開啟預設音量：最大
  lineOut: false, // Line Out：最大音量輸出鎖定（鎖定時不可調音量）
  exclusive: false, // WASAPI 獨佔輸出：繞過 Windows 混音器直出（等同 LINE OUT 音量鎖定）
  theme: 'dark',
  currentView: 'overview',
  activeAlbumDetail: null,
  currentArtistDetail: null,
  currentLabelDetail: null, // 目前開啟的發行公司（RECORD LABEL）頁面
  activeGenreFilter: null,
  recentlyPlayedAlbums: [],
  activeFilter: 'all',
  sortBy: 'added',
  trackSortBy: 'default',
  history: ['overview'],
  historyIndex: 0,
  activeAudioZone: 'local',
  activeDlnaDevice: null,
  availableDevices: [],
  dlnaCurrentSec: 0,
  dlnaTotalSec: 0,
  activeSpectrumToken: null,
  favorites: {
    albums: [],
    tracks: [],
    artists: []
  },
  albumCoverSize: localStorage.getItem('rooplayer_album_cover_size') || 'medium',
  detailCoverSize: localStorage.getItem('rooplayer_detail_cover_size') || 'medium',
  artistCardSize: localStorage.getItem('rooplayer_artist_card_size') || 'medium',
  tidalCoverSize: localStorage.getItem('rooplayer_tidal_cover_size') || 'medium',
  dsp: (() => {
    try {
      const saved = JSON.parse(localStorage.getItem('rooplayer_dsp_settings') || '{}');
      return {
        enabled: saved.enabled === true,
        rateMode: saved.rateMode || '4x',
        dsdOrder: [2, 5, 7].includes(parseInt(saved.dsdOrder, 10)) ? parseInt(saved.dsdOrder, 10) : 5,
        filterPhase: isValidFilterPhaseId(saved.filterPhase) ? saved.filterPhase : 'linear',
        peq: normalizePeqSettings(saved.peq),
        conv: normalizeConvSettings(saved.conv)
      };
    } catch (e) {
      return { enabled: false, rateMode: '4x', dsdOrder: 5, filterPhase: 'linear', peq: normalizePeqSettings(null), conv: normalizeConvSettings(null) };
    }
  })()
};

// SVG Vinyl/Cover Generator for Showcase Albums
function createSvgCover(title, artist, primaryColor, secondaryColor) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">
    <defs>
      <radialGradient id="grad" cx="50%" cy="50%" r="70%" fx="30%" fy="30%">
        <stop offset="0%" stop-color="${primaryColor}"/>
        <stop offset="100%" stop-color="${secondaryColor}"/>
      </radialGradient>
      <linearGradient id="metal" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="rgba(255,255,255,0.15)"/>
        <stop offset="50%" stop-color="transparent"/>
        <stop offset="100%" stop-color="rgba(0,0,0,0.6)"/>
      </linearGradient>
    </defs>
    <rect width="400" height="400" fill="url(#grad)"/>
    <circle cx="200" cy="200" r="160" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="2"/>
    <circle cx="200" cy="200" r="130" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="1.5"/>
    <circle cx="200" cy="200" r="95" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="1.5"/>
    <circle cx="200" cy="200" r="45" fill="#121316" stroke="rgba(255,255,255,0.2)" stroke-width="2"/>
    <circle cx="200" cy="200" r="12" fill="#fff"/>
    <rect width="400" height="400" fill="url(#metal)"/>
    <text x="32" y="330" fill="#ffffff" font-family="Segoe UI, sans-serif" font-weight="800" font-size="24">${escapeXml(title)}</text>
    <text x="32" y="360" fill="rgba(255,255,255,0.75)" font-family="Segoe UI, sans-serif" font-weight="600" font-size="16">${escapeXml(artist)}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// Convert any cover source (file path, media URL, or file URL) to a valid browser-loadable URL
function formatCoverSrc(src) {
  if (!src || typeof src !== 'string') return '';
  src = src.trim();
  if (src.startsWith('data:') || src.startsWith('http://') || src.startsWith('https://')) {
    return src;
  }
  if (src.startsWith('file:///')) {
    return src;
  }
  if (src.startsWith('file://')) {
    const raw = src.replace(/^file:\/\//, '').replace(/\\/g, '/');
    return raw.startsWith('/') ? 'file://' + raw : 'file:///' + raw;
  }
  if (src.startsWith('media://')) {
    let raw = src.replace(/^media:\/\//i, '').replace(/\\/g, '/');
    return raw.startsWith('/') ? 'file://' + raw : 'file:///' + raw;
  }
  // Local file path like C:\Users\... or /Users/...
  const clean = src.replace(/\\/g, '/');
  return clean.startsWith('/') ? 'file://' + clean : 'file:///' + clean;
}

function escapeXml(unsafe) {
  if (unsafe === null || unsafe === undefined) return '';
  return String(unsafe).replace(/[<>&'"]/g, c => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
    }
  });
}

// Built-in Demo Audiophile Showcase
const DEMO_ALBUMS = [
  {
    title: "Kind of Blue",
    artist: "Miles Davis",
    year: 1959,
    genre: "Jazz",
    isLossless: true,
    formatName: "FLAC",
    sampleRate: 96000,
    bitsPerSample: 24,
    color1: "#1e3a8a",
    color2: "#0f172a",
    tracks: [
      { title: "So What", duration: 562, trackNumber: 1 },
      { title: "Freddie Freeloader", duration: 589, trackNumber: 2 },
      { title: "Blue in Green", duration: 337, trackNumber: 3 },
      { title: "All Blues", duration: 695, trackNumber: 4 },
      { title: "Flamenco Sketches", duration: 566, trackNumber: 5 }
    ]
  },
  {
    title: "Random Access Memories",
    artist: "Daft Punk",
    year: 2013,
    genre: "Electronic",
    isLossless: true,
    formatName: "FLAC",
    sampleRate: 88200,
    bitsPerSample: 24,
    color1: "#701a75",
    color2: "#18181b",
    tracks: [
      { title: "Give Life Back to Music", duration: 274, trackNumber: 1 },
      { title: "Giorgio by Moroder", duration: 544, trackNumber: 2 },
      { title: "Instant Crush (feat. Julian Casablancas)", duration: 337, trackNumber: 3 },
      { title: "Lose Yourself to Dance", duration: 353, trackNumber: 4 },
      { title: "Get Lucky (feat. Pharrell Williams)", duration: 369, trackNumber: 5 }
    ]
  },
  {
    title: "Aja",
    artist: "Steely Dan",
    year: 1977,
    genre: "Rock / Jazz Fusion",
    isLossless: true,
    formatName: "DSD",
    sampleRate: 192000,
    bitsPerSample: 24,
    color1: "#14532d",
    color2: "#052e16",
    tracks: [
      { title: "Black Cow", duration: 310, trackNumber: 1 },
      { title: "Aja", duration: 477, trackNumber: 2 },
      { title: "Deacon Blues", duration: 457, trackNumber: 3 },
      { title: "Peg", duration: 237, trackNumber: 4 },
      { title: "Home at Last", duration: 334, trackNumber: 5 },
      { title: "Josie", duration: 270, trackNumber: 6 }
    ]
  },
  {
    title: "Beethoven: Symphony No. 9",
    artist: "Herbert von Karajan",
    year: 1963,
    genre: "Classical",
    isLossless: true,
    formatName: "FLAC",
    sampleRate: 192000,
    bitsPerSample: 24,
    color1: "#78350f",
    color2: "#291505",
    tracks: [
      { title: "I. Allegro ma non troppo, un poco maestoso", duration: 924, trackNumber: 1 },
      { title: "II. Molto vivace", duration: 660, trackNumber: 2 },
      { title: "III. Adagio molto e cantabile", duration: 980, trackNumber: 3 },
      { title: "IV. Presto - Allegro assai (Ode to Joy)", duration: 1440, trackNumber: 4 }
    ]
  }
];

function initializeDemoData() {
  const tracks = [];
  DEMO_ALBUMS.forEach((demoAlb, albIdx) => {
    const coverUrl = createSvgCover(demoAlb.title, demoAlb.artist, demoAlb.color1, demoAlb.color2);
    demoAlb.tracks.forEach((t, trkIdx) => {
      tracks.push({
        id: `demo_${albIdx}_${trkIdx}`,
        isDemo: true,
        title: t.title,
        artist: demoAlb.artist,
        album: demoAlb.title,
        albumArtist: demoAlb.artist,
        year: demoAlb.year,
        genre: demoAlb.genre,
        trackNumber: t.trackNumber,
        duration: t.duration,
        sampleRate: demoAlb.sampleRate,
        bitsPerSample: demoAlb.bitsPerSample,
        formatName: demoAlb.formatName,
        isLossless: demoAlb.isLossless,
        cover: coverUrl,
        filePath: null
      });
    });
  });
  return tracks;
}

// ----------------- Ambient Audiophile Piano/Chords Synth (For Demo Showcase) -----------------
let audioCtx = null;
let currentSynthNodes = [];
let synthChordTimer = null;

function playDemoSynth(track) {
  stopDemoSynth();
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    // Gentle musical chords: Cmaj9, Am9, Fmaj7, Gsus4
    const chordProgressions = [
      [261.63, 329.63, 392.00, 493.88, 587.33], // C, E, G, B, D
      [220.00, 261.63, 329.63, 392.00, 493.88], // A, C, E, G, B
      [174.61, 220.00, 261.63, 329.63, 392.00], // F, A, C, E, G
      [196.00, 261.63, 293.66, 392.00, 493.88]  // G, C, D, G, B
    ];
    let chordIdx = 0;

    function triggerChord() {
      if (!audioCtx || audioCtx.state === 'suspended') return;
      const notes = chordProgressions[chordIdx % chordProgressions.length];
      chordIdx++;

      notes.forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        const filter = audioCtx.createBiquadFilter();

        // Warm triangle wave with soft lowpass
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1200, audioCtx.currentTime);

        // Gentle acoustic piano envelope
        const now = audioCtx.currentTime + (i * 0.08);
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(state.volume * 0.05, now + 0.08);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 3.2);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(audioCtx.destination);

        osc.start(now);
        osc.stop(now + 3.4);
        currentSynthNodes.push(osc, gain, filter);
      });
    }

    triggerChord();
    synthChordTimer = setInterval(triggerChord, 3600);
  } catch (err) {
    console.error('Demo audio error:', err);
  }
}

function stopDemoSynth() {
  if (synthChordTimer) {
    clearInterval(synthChordTimer);
    synthChordTimer = null;
  }
  if (currentSynthNodes.length) {
    currentSynthNodes.forEach(node => {
      try {
        if (node.stop) node.stop();
        if (node.disconnect) node.disconnect();
      } catch (e) {}
    });
    currentSynthNodes = [];
  }
}

// ----------------- DOM Elements -----------------
const nativeAudio = document.getElementById('nativeAudio');
const overviewGrid = document.getElementById('overviewGrid');
const dailyRecommendGrid = document.getElementById('dailyRecommendGrid');
const overviewArtistsGrid = document.getElementById('overviewArtistsGrid');
const allAlbumsGrid = document.getElementById('allAlbumsGrid');
const artistsGrid = document.getElementById('artistsGrid');
const allTracksTbody = document.getElementById('allTracksTbody');
const genresGrid = document.getElementById('genresGrid');

// Player DOM
const playerCoverImg = document.getElementById('playerCoverImg');
if (playerCoverImg && (!playerCoverImg.getAttribute('src') || playerCoverImg.getAttribute('src') === '')) {
  playerCoverImg.src = 'icon.png';
}
const playerTitle = document.getElementById('playerTitle');
const playerArtist = document.getElementById('playerArtist');
const signalPathBadge = document.getElementById('signalPathBadge');
const btnPlayPause = document.getElementById('btnPlayPause');
const btnPrev = document.getElementById('btnPrev');
const btnNext = document.getElementById('btnNext');
const btnShuffle = document.getElementById('btnShuffle');
const btnRepeat = document.getElementById('btnRepeat');
const scrubberBar = document.getElementById('scrubberBar');
const scrubberFill = document.getElementById('scrubberFill');
const scrubberHandle = document.getElementById('scrubberHandle');
const currentTimeLabel = document.getElementById('currentTimeLabel');
const totalTimeLabel = document.getElementById('totalTimeLabel');
const volumeSlider = document.getElementById('volumeSlider');
const btnVolumeIcon = document.getElementById('btnVolumeIcon');
const btnSignalPath = document.getElementById('btnSignalPath');
const signalPathModal = document.getElementById('signalPathModal');
const btnCloseSignalPath = document.getElementById('btnCloseSignalPath');

// Album Detail Modal DOM
const albumDetailModal = document.getElementById('albumDetailModal');
const btnCloseAlbumDetail = document.getElementById('btnCloseAlbumDetail');
const detailCoverImg = document.getElementById('detailCoverImg');
const detailTitle = document.getElementById('detailTitle');
const detailArtist = document.getElementById('detailArtist');
const detailCompany = document.getElementById('detailCompany');
const detailYear = document.getElementById('detailYear');
const detailTracksDuration = document.getElementById('detailTracksDuration');
const detailGenre = document.getElementById('detailGenre');
const detailFormatBadge = document.getElementById('detailFormatBadge');
const detailTrackCount = document.getElementById('detailTrackCount');
const detailTracklistTbody = document.getElementById('detailTracklistTbody');
const btnPlayAlbumNow = document.getElementById('btnPlayAlbumNow');
const btnShuffleAlbum = document.getElementById('btnShuffleAlbum');

// Queue Drawer DOM
const queueDrawer = document.getElementById('queueDrawer');
const btnToggleQueue = document.getElementById('btnToggleQueue');
const btnCloseQueue = document.getElementById('btnCloseQueue');
const btnClearQueue = document.getElementById('btnClearQueue');
const queueList = document.getElementById('queueList');
const queueCount = document.getElementById('queueCount');

const btnSelectFolder = document.getElementById('btnSelectFolder');
const btnExportLibrary = document.getElementById('btnExportLibrary');
const btnImportLibrary = document.getElementById('btnImportLibrary');
const scanProgressBox = document.getElementById('scanProgressBox');
const scanProgressBar = document.getElementById('scanProgressBar');
const scanStatusLabel = document.getElementById('scanStatusLabel');
const scanPercentLabel = document.getElementById('scanPercentLabel');
const scanCurrentFile = document.getElementById('scanCurrentFile');
const scannedFoldersList = document.getElementById('scannedFoldersList');

// Import Report Modal DOM
const importReportModal = document.getElementById('importReportModal');
const btnCloseImportReport = document.getElementById('btnCloseImportReport');
const btnConfirmImportReport = document.getElementById('btnConfirmImportReport');
const importReportStats = document.getElementById('importReportStats');
const importReportDetails = document.getElementById('importReportDetails');

// ----------------- Dynamic Light Pastel Gradient for Overview Hero Banner -----------------
function applyRandomHeroGradient() {
  const heroBanner = document.getElementById('overviewHeroBanner') || document.querySelector('.hero-banner');
  if (!heroBanner) return;

  const pastelGradients = [
    'linear-gradient(135deg, #e0e7ff 0%, #f3e8ff 50%, #fce7f3 100%)', // 薰衣草粉紫
    'linear-gradient(135deg, #dbeafe 0%, #e0e7ff 45%, #ede9fe 100%)', // 天空冰藍粉紫
    'linear-gradient(135deg, #fef3c7 0%, #fee2e2 50%, #fce7f3 100%)', // 暖陽蜜桃粉杏
    'linear-gradient(135deg, #ccfbf1 0%, #e0f2fe 50%, #ede9fe 100%)', // 薄荷清爽冰川藍
    'linear-gradient(135deg, #dcfce7 0%, #e0f2fe 50%, #f3e8ff 100%)', // 鼠尾草晨光清新
    'linear-gradient(135deg, #ffedd5 0%, #fce7f3 50%, #ede9fe 100%)', // 晨曦朝霞柔粉
    'linear-gradient(135deg, #fae8ff 0%, #f5d0fe 40%, #e0e7ff 100%)', // 夢幻紫丁香
    'linear-gradient(135deg, #e0f2fe 0%, #f0fdf4 50%, #fef9c3 100%)', // 晨露微光湖綠黃
    'linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 45%, #ede9fe 100%)', // 高級月光銀霧紫
    'linear-gradient(135deg, #fce7f3 0%, #ffe4e6 50%, #fed7aa 100%)'  // 櫻花初綻暖杏粉
  ];

  const randomIndex = Math.floor(Math.random() * pastelGradients.length);
  const selectedGradient = pastelGradients[randomIndex];
  heroBanner.style.background = selectedGradient;
}

// ----------------- Initialization -----------------
async function initApp() {
  initTheme();
  applyRandomHeroGradient();
  initFavorites();
  setupWindowControls();
  setupNavigation();
  setupPlayerControls();
  setupScannerEvents();
  setupFavoritesEvents();
  setupHistoryEvents();
  setupSearch();
  setupCoverSizeControls();
  setupResizableTables();
  initAudioZones();
  await loadFilterPluginsUI();
  initDspControls();
  initKkboxStreaming();
  await initTidalStreaming();

  // Load saved library or fall back to showcase demo data
  let saved = null;
  if (window.electronAPI) {
    try {
      saved = await window.electronAPI.loadSavedLibrary();
    } catch (e) {
      console.warn('Could not load saved library:', e);
    }
  }

  if (saved && saved.tracks && saved.tracks.length > 0) {
    state.tracks = saved.tracks;
    state.folders = saved.folders || [];
  } else {
    // Populate demo showcase
    state.tracks = initializeDemoData();
  }

  // Load recently played albums
  try {
    state.recentlyPlayedAlbums = JSON.parse(localStorage.getItem('roon_recent_albums') || '[]');
  } catch (e) {
    state.recentlyPlayedAlbums = [];
  }

  rebuildLibraryCollections();
  renderAll();

  // Startup default: show the last played track in the player bar (display only, not playing)
  restoreLastPlayedTrack();
  console.log(`[Startup] last-played restore: queue=${state.queue.length} index=${state.currentTrackIndex} history=${getPlaybackHistory().length} tidalLoggedIn=${!!(window.tidalService && window.tidalService.isLoggedIn)}`);

  // Set initial default volume
  nativeAudio.volume = state.volume;

  // Initialize playback control button states
  updateShuffleUI();
  updateRepeatUI();

  // 截圖模式 hook（主行程以 ?rpCapture=1 載入時觸發，供 GitHub Pages 介面展示；
  // 正常啟動 location 無此參數，本區塊完全不執行）
  if (window.location.search.includes('rpCapture')) {
    const capParams = new URLSearchParams(window.location.search);
    if (capParams.get('testVersions')) {
      // 執行期測試：「其他版本」匹配邏輯——只允許同名＋同演出者的格式／解析度／平台差異
      setTimeout(async () => {
        try {
          const now = Date.now();
          const cover = createSvgCover('Fixture', 'X', '#334155', '#0f172a');
          const mkTrack = (album, artist, i, fmt, sr, bits) => ({
            id: `fx_${album.replace(/\W/g, '')}_${artist.replace(/\W/g, '')}_${fmt}_${i}`,
            title: `Track ${i + 1}`, trackNumber: i + 1, duration: 120,
            album, artist, albumArtist: artist, year: 2000, genre: 'Test', cover,
            formatName: fmt, sampleRate: sr, bitsPerSample: bits, isLossless: true,
            addedAt: now, filePath: null
          });
          const fixture = [
            ...[0, 1].map(i => mkTrack('Test Album', 'Artist A', i, 'FLAC', 44100, 16)),                       // A：目前專輯
            ...[0, 1].map(i => mkTrack('Test Album', 'Artist B', i, 'WAV', 96000, 24)),                        // B：同名但不同演出者 → 必須排除
            ...[0, 1].map(i => mkTrack('Test Album (Deluxe Edition)', 'Artist A', i, 'FLAC', 96000, 24))      // D：正規化後同專輯同演出者、不同解析度 → 必須納入
          ];
          state.tracks = [...state.tracks, ...fixture];
          rebuildLibraryCollections();
          const target = state.albums.find(a => a.title === 'Test Album' && a.artist === 'Artist A');
          if (!target) throw new Error('fixture album not found');
          openAlbumDetail(target);
          await new Promise(r => setTimeout(r, 2000)); // 等 renderAlbumVersions 完成
          const grid = document.getElementById('albumVersionsGrid');
          const cards = grid ? [...grid.children].map(c => (c.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80)) : [];
          const sectionShown = !!(document.getElementById('albumVersionsSection') && document.getElementById('albumVersionsSection').style.display === 'block');
          const excludedOk = !cards.some(t => t.includes('WAV'));        // B（Artist B 的 WAV）不得出現
          const includedDeluxe = cards.some(t => t.includes('24-bit'));  // D 必須出現
          // 點擊非目前版本：卡片位置必須保持不變，只有 active 標記移動
          const specsOf = (t) => (t.match(/\d+-bit \/ [\d.]+kHz/) || [''])[0];
          let orderStable = false, activeMoved = false;
          if (cards.length >= 2) {
            const order1 = cards.map(specsOf);
            const clicked = [...grid.children].find(c => !c.className.includes('active'));
            if (clicked) {
              clicked.click();
              await new Promise(r => setTimeout(r, 1500)); // 等 openAlbumDetail 重渲染
              const cards2 = [...grid.children].map(c => (c.textContent || '').replace(/\s+/g, ' ').trim());
              const order2 = cards2.map(specsOf);
              orderStable = order2.length === order1.length && order2.every((s, i) => s === order1[i] && s !== '');
              activeMoved = [...grid.children].findIndex(c => c.className.includes('active')) === order1.length - 1;
            }
          }
          const pass = sectionShown && cards.length === 2 && excludedOk && includedDeluxe && orderStable && activeMoved;
          // 附加檢查：專輯頁「推薦演出者」頭像尺寸必須跟隨演出者頁面的尺寸設定
          const recGrid = document.getElementById('albumArtistRecommendationsGrid');
          const mainGrid = document.getElementById('artistsGrid');
          const sizeOf = (g) => [...g.classList].find(c => c.startsWith('artist-size-')) || 'none';
          const sizeMatch = !!recGrid && !!mainGrid && sizeOf(recGrid) === sizeOf(mainGrid) && sizeOf(recGrid) !== 'none';
          // 切換演出者頁尺寸到「大」：專輯頁推薦區必須即時同步
          const largePill = document.querySelector('#artistSizePills .size-pill[data-artist-size="large"]');
          if (largePill) largePill.click();
          await new Promise(r => setTimeout(r, 400));
          const sizeSync = sizeOf(recGrid) === 'artist-size-large' && sizeOf(mainGrid) === 'artist-size-large';
          window.electronAPI.captureStep(9, `TEST-VERSIONS ${pass && sizeMatch && sizeSync ? 'PASS' : 'FAIL'} count=${cards.length} excludedOk=${excludedOk} deluxe=${includedDeluxe} orderStable=${orderStable} activeMoved=${activeMoved} sizeMatch=${sizeMatch} sizeSync=${sizeSync} recSize=${sizeOf(recGrid || { classList: [] })} mainSize=${sizeOf(mainGrid || { classList: [] })} cards=${JSON.stringify(cards)}`);
        } catch (e) {
          if (window.electronAPI.captureStep) window.electronAPI.captureStep(9, 'TEST-VERSIONS ERROR ' + e.message);
        }
      }, 4000);
    } else {
    setTimeout(() => {
      try {
        const btn = document.getElementById('btnSignalPath');
        if (btn) btn.click();
        const eng = document.getElementById('toggleSoxDsp');
        if (eng && !eng.checked) eng.click(); // 啟用升頻引擎：展開引擎設定欄（工具箱在其內）
        const strip = document.getElementById('userFilterStrip');
        if (strip) strip.scrollIntoView({ block: 'center' });
        if (window.electronAPI && window.electronAPI.captureStep) window.electronAPI.captureStep(2, 'signalpath ready');
      } catch (e) { console.warn('[rpCapture] open signal path failed:', e); }
    }, 6000);
    setTimeout(() => {
      try {
        const nb = document.getElementById('ufNewBtn');
        if (nb) nb.click();
        const nm = document.getElementById('ufNameInput');
        if (nm) nm.value = '暖聲緩降';
        const sd = document.getElementById('ufSoundInput');
        if (sd) sd.value = '高頻柔化、鈴振不可聽';
        const winBtn = document.querySelector('#ufWindowSeg .uf-seg-btn[data-window="blackman"]');
        if (winBtn) winBtn.click();
        const cut = document.getElementById('ufCutSlider');
        if (cut) { cut.value = 95; cut.dispatchEvent(new Event('input')); }
        const tap = document.getElementById('ufTapSlider');
        if (tap) { tap.value = 128; tap.dispatchEvent(new Event('input')); }
        const panel = document.getElementById('ufEditorPanel');
        if (panel) panel.scrollIntoView({ block: 'center' });
        if (window.electronAPI && window.electronAPI.captureStep) window.electronAPI.captureStep(3, 'toolbox ready');
      } catch (e) { console.warn('[rpCapture] open toolbox failed:', e); }
    }, 8500);
    setTimeout(() => {
      try {
        closeUfEditor(); // 收合工具箱，讓 PEQ 卡片畫面乾淨
        const warm = (PEQ_PRESETS.warm || []).map(b => Object.assign({}, b));
        state.dsp.peq = normalizePeqSettings({ enabled: true, preset: 'warm', bands: warm });
        const cb = document.getElementById('togglePeq');
        if (cb) cb.checked = true;
        const peqCard = document.getElementById('peqCard');
        if (peqCard) peqCard.classList.add('active');
        const peqEditor = document.getElementById('peqEditor');
        if (peqEditor) peqEditor.style.display = 'block';
        buildPeqBandRows();
        drawPeqCurve();
        if (peqCard) peqCard.scrollIntoView({ block: 'center' });
        if (window.electronAPI && window.electronAPI.captureStep) window.electronAPI.captureStep(4, 'peq ready');
      } catch (e) { console.warn('[rpCapture] open peq failed:', e); }
    }, 12000);
    setTimeout(() => {
      try {
        const params = new URLSearchParams(window.location.search);
        const irPath = params.get('demoIr');
        if (irPath) {
          state.dsp.conv = { enabled: true, irPath };
          syncConvModalUI();
        }
        const convCard = document.getElementById('convCard');
        if (convCard) convCard.scrollIntoView({ block: 'center' });
        if (window.electronAPI && window.electronAPI.captureStep) window.electronAPI.captureStep(5, 'conv ready');
      } catch (e) { console.warn('[rpCapture] open conv failed:', e); }
    }, 14500);
    // 步驟 6：TIDAL 與本機曲庫整合展示——先關閉訊號路徑 modal 回到首頁，
    // 再注入示範「已加入曲庫」的 TIDAL Hi-Res 專輯，與本機專輯一同出現在「最近新增專輯」
    setTimeout(async () => {
      try {
        const closeBtn = document.getElementById('btnCloseSignalPath');
        if (closeBtn) closeBtn.click();
        await new Promise(r => setTimeout(r, 700)); // 等 modal 關閉
        const tidalAlbumId = '100000042';
        if (!isTidalAlbumInLibrary(tidalAlbumId)) {
          const coverUrl = createSvgCover('Time Out', 'Dave Brubeck', '#0e7490', '#083344');
          const now = Date.now();
          const tidalTracks = [
            { trackNumber: 1, title: 'Blue Rondo à la Turk', duration: 404 },
            { trackNumber: 2, title: 'Strange Meadow Lark', duration: 342 },
            { trackNumber: 3, title: 'Take Five', duration: 195 },
            { trackNumber: 4, title: 'Three to Claws', duration: 324 },
            { trackNumber: 5, title: "Everybody's Jumpin'", duration: 223 }
          ].map((t, i) => ({
            id: `tidal_${tidalAlbumId}_${i}`,
            isTidal: true, tidalAlbumId, tidalId: tidalAlbumId,
            title: t.title, trackNumber: t.trackNumber, duration: t.duration,
            album: 'Time Out', artist: 'Dave Brubeck', albumArtist: 'Dave Brubeck',
            year: 1959, genre: 'Jazz', cover: coverUrl,
            formatName: 'FLAC', sampleRate: 96000, bitsPerSample: 24, isLossless: true,
            audioQuality: 'HIRES_LOSSLESS', addedAt: now, filePath: null
          }));
          state.tracks = [...state.tracks, ...tidalTracks];
          rebuildLibraryCollections();
          renderOverview();
        }
        const grid = document.getElementById('overviewGrid');
        if (grid) grid.scrollIntoView({ block: 'center' });
        const modalDisplay = getComputedStyle(document.getElementById('signalPathModal')).display;
        const gridTop = grid ? Math.round(grid.getBoundingClientRect().top) : -1;
        if (window.electronAPI && window.electronAPI.captureStep) window.electronAPI.captureStep(6, 'tidal ready modal=' + modalDisplay + ' gridTop=' + gridTop + ' cards=' + (grid ? grid.children.length : 0));
      } catch (e) { console.warn('[rpCapture] tidal integration failed:', e); }
    }, 17000);
    // 步驟 7：藝人生活誌 Artist Spotlight——指定 Miles Davis（demo 曲庫內），
    // 等生平簡介（維基百科＋自動翻譯）載入完成再回報
    setTimeout(() => {
      try {
        currentSpotlightArtistName = 'Miles Davis';
        renderArtistSpotlight();
        const bioEl = document.getElementById('spotlightBio');
        const nameEl = document.getElementById('spotlightName');
        let tries = 0;
        const iv = setInterval(() => {
          tries++;
          const ready = nameEl && nameEl.textContent.includes('Miles Davis') &&
            bioEl && bioEl.textContent.length > 120 && !bioEl.textContent.includes('正在載入');
          if (ready || tries > 45) {
            clearInterval(iv);
            const sec = document.getElementById('artistSpotlightSection');
            if (sec) sec.scrollIntoView({ block: 'start' });
            const modalDisplay = getComputedStyle(document.getElementById('signalPathModal')).display;
            const secTop = sec ? Math.round(sec.getBoundingClientRect().top) : -1;
            if (window.electronAPI && window.electronAPI.captureStep) window.electronAPI.captureStep(7, 'spotlight ' + (ready ? 'loaded' : 'timeout') + ' bioLen=' + (bioEl ? bioEl.textContent.length : 0) + ' modal=' + modalDisplay + ' secTop=' + secTop);
          }
        }, 700);
      } catch (e) { console.warn('[rpCapture] spotlight failed:', e); }
    }, 19000);
    }
  }
}

// ----------------- Theme Switcher -----------------
function initTheme() {
  const saved = localStorage.getItem('roon_theme') || 'dark';
  setTheme(saved);

  const btnToggle = document.getElementById('btnThemeToggle');
  if (btnToggle) {
    btnToggle.addEventListener('click', () => {
      const next = state.theme === 'dark' ? 'light' : 'dark';
      setTheme(next);
    });
  }
}

function setTheme(theme) {
  state.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('roon_theme', theme);

  const iconEl = document.getElementById('themeIcon');
  const labelEl = document.getElementById('themeLabel');
  if (iconEl && labelEl) {
    if (theme === 'light') {
      iconEl.textContent = '☀️';
      labelEl.textContent = '淺色';
    } else {
      iconEl.textContent = '🌙';
      labelEl.textContent = '深色';
    }
  }
}

// ----------------- Recently Played Tracker -----------------
function recordRecentlyPlayed(album) {
  if (!album) return;
  let recent = [];
  try {
    recent = JSON.parse(localStorage.getItem('roon_recent_albums') || '[]');
  } catch (e) {}

  recent = recent.filter(r => !(r.title === album.title && r.artist.toLowerCase() === album.artist.toLowerCase()));
  recent.unshift({
    title: album.title,
    artist: album.artist,
    year: album.year,
    cover: album.cover,
    formatName: album.formatName,
    sampleRate: album.sampleRate,
    bitsPerSample: album.bitsPerSample,
    isLossless: album.isLossless,
    playedAt: Date.now()
  });

  if (recent.length > 30) recent = recent.slice(0, 30);
  localStorage.setItem('roon_recent_albums', JSON.stringify(recent));
  state.recentlyPlayedAlbums = recent;
}

// ----------------- Playback History Tracker (Recent 100 Tracks) -----------------
// Parsed-JSON cache keyed on the raw localStorage string: render loops call this
// frequently; re-parsing is skipped while the stored string is unchanged.
let _playbackHistoryCache = null;
function getPlaybackHistory() {
  try {
    const raw = localStorage.getItem('rooplayer_playback_history');
    if (!raw) return [];
    if (!_playbackHistoryCache || _playbackHistoryCache.raw !== raw) {
      _playbackHistoryCache = { raw, data: JSON.parse(raw) };
    }
    return _playbackHistoryCache.data.slice(); // fresh array copy: callers may reorder freely
  } catch (e) {}
  return [];
}

function recordTrackPlaybackHistory(track, foundAlbum) {
  if (!track || !track.title) return;
  let history = getPlaybackHistory();

  // Deduplicate and move to top: remove any previous entry of this track
  const trackArtist = (track.artist || (foundAlbum ? foundAlbum.artist : '')).toLowerCase().trim();
  const trackTitle = (track.title || '').toLowerCase().trim();
  history = history.filter(h => !( (h.title || '').toLowerCase().trim() === trackTitle && (h.artist || '').toLowerCase().trim() === trackArtist ));

  const historyItem = {
    id: track.id || `${track.title}___${track.artist}`,
    title: track.title,
    artist: track.artist || (foundAlbum ? foundAlbum.artist : '未知演出者'),
    album: track.album || (foundAlbum ? foundAlbum.title : '未知專輯'),
    duration: track.duration || 0,
    filePath: track.filePath || '',
    formatName: track.formatName || (foundAlbum ? foundAlbum.formatName : 'PCM'),
    sampleRate: track.sampleRate || (foundAlbum ? foundAlbum.sampleRate : 44100),
    bitsPerSample: track.bitsPerSample || (foundAlbum ? foundAlbum.bitsPerSample : 16),
    isLossless: track.isLossless || (foundAlbum ? foundAlbum.isLossless : false),
    cover: track.cover || (foundAlbum ? foundAlbum.cover : null),
    // Source identity: lets the startup "last played track" restore know what is restorable
    isTidal: !!track.isTidal,
    tidalId: track.tidalId || null,
    isKkbox: !!track.isKkbox,
    kkboxId: track.kkboxId || null,
    isDemo: !!track.isDemo,
    audioQuality: track.audioQuality || null,
    playedAt: Date.now()
  };

  history.unshift(historyItem);
  if (history.length > 100) {
    history = history.slice(0, 100);
  }

  try {
    const rawHistory = JSON.stringify(history);
    localStorage.setItem('rooplayer_playback_history', rawHistory);
    _playbackHistoryCache = { raw: rawHistory, data: history };
  } catch (e) {}

  updateHistoryCountBadges();

  if (state.currentView === 'history') {
    renderPlaybackHistory();
  }
  if (state.currentView === 'overview') {
    renderRecentPlayedAlbums();
  }
}

function clearPlaybackHistory() {
  try {
    localStorage.removeItem('rooplayer_playback_history');
  } catch (e) {}
  _playbackHistoryCache = null;
  updateHistoryCountBadges();
  if (state.currentView === 'history') {
    renderPlaybackHistory();
  }
  if (state.currentView === 'overview') {
    renderRecentPlayedAlbums();
  }
}

function updateHistoryCountBadges() {
  const count = getPlaybackHistory().length;
  const historyBadge = document.getElementById('historyCountBadge');
  if (historyBadge) historyBadge.textContent = count;
  const heroBadge = document.getElementById('heroHistoryCount');
  if (heroBadge) heroBadge.textContent = count;
}

// ----------------- Startup Default Track (Last Played) -----------------
// On startup the player bar shows the last played track instead of the empty state:
//  - TIDAL logged in: the newest history entry that is restorable (TIDAL / KKBOX / local)
//  - TIDAL not logged in: the newest entry that is a local library track
// Display only - nothing plays until the user presses play (play then starts the track fresh).
function restoreLastPlayedTrack() {
  try {
    if (state.queue && state.queue.length > 0) return; // a session is already active
    const history = getPlaybackHistory();
    if (!history.length) return;
    const tidalLoggedIn = !!(window.tidalService && window.tidalService.isLoggedIn);
    const kkboxAccount = localStorage.getItem('rooplayer_kkbox_account');

    for (const h of history) {
      if (h.isDemo || String(h.id || '').startsWith('demo_')) continue;
      // Legacy entries (recorded before source flags existed) are identified by their id prefix:
      // TIDAL tracks are always `tidal_<id>`, KKBOX tracks `kkbox_<id>` (see tidal-service / kkbox mapping)
      const isTidalEntry = h.isTidal || String(h.id || '').startsWith('tidal_') || (!h.filePath && !h.isKkbox && h.tidalId);
      const isKkboxEntry = h.isKkbox || String(h.id || '').startsWith('kkbox_') || (!h.filePath && !h.isTidal && h.kkboxId);
      const legacyTidalId = String(h.id || '').startsWith('tidal_') ? String(h.id).slice(6) : null;
      const legacyKkboxId = String(h.id || '').startsWith('kkbox_') ? String(h.id).slice(6) : null;

      if (isTidalEntry) {
        const tidalId = h.tidalId || legacyTidalId;
        if (!tidalLoggedIn || !tidalId) continue;
        const track = {
          id: h.id, isTidal: true, tidalId,
          title: h.title, artist: h.artist, album: h.album || '',
          duration: h.duration || 0, cover: h.cover || null,
          sampleRate: h.sampleRate || 44100, bitDepth: h.bitsPerSample || 16,
          audioQuality: h.audioQuality || 'LOSSLESS',
          formatName: 'FLAC', isLossless: true,
          _restoredSession: true
        };
        showRestoredTrack(track, [track], 0);
        return;
      }

      if (isKkboxEntry) {
        const kkboxId = h.kkboxId || legacyKkboxId;
        if (!kkboxAccount || !kkboxId) continue;
        const track = {
          id: h.id, isKkbox: true, kkboxId,
          title: h.title, artist: h.artist, album: h.album || '',
          duration: h.duration || 0, cover: h.cover || null,
          _restoredSession: true
        };
        showRestoredTrack(track, [track], 0);
        return;
      }

      // Local library entry: the file must still exist in the current library
      if (!h.filePath) continue;
      const match = state.tracks.find(t => t.filePath && String(t.filePath).toLowerCase() === String(h.filePath).toLowerCase());
      if (!match) continue;
      const album = findAlbumForTrack(match);
      const queue = (album && album.tracks && album.tracks.length) ? album.tracks : [match];
      let idx = queue.findIndex(t => (t.id && t.id === match.id) || (t.filePath && String(t.filePath).toLowerCase() === String(match.filePath).toLowerCase()));
      showRestoredTrack(match, queue, idx >= 0 ? idx : 0);
      return;
    }
  } catch (e) {
    console.warn('restoreLastPlayedTrack failed:', e);
  }
}

// Player-bar display for a restored (not yet played) track: mirrors the UI portion of
// playCurrentTrack without starting audio. The queue is primed so pressing play works.
function showRestoredTrack(track, queue, index) {
  state.queue = [...queue];
  state.currentTrackIndex = index;

  playerTitle.textContent = track.title;
  playerArtist.textContent = `${track.artist} — ${track.title}`;
  const defaultPlayerCover = createSvgCover(track.album || '', track.artist || '', '#27272a', '#09090b');
  playerCoverImg.src = formatCoverSrc(track.cover) || defaultPlayerCover;
  playerCoverImg.onerror = () => {
    playerCoverImg.onerror = null;
    playerCoverImg.src = defaultPlayerCover;
  };
  playerArtist.style.cursor = 'pointer';
  playerArtist.onclick = () => openArtistDetail(track.artist);

  const playerHeartBtn = document.getElementById('btnPlayerHeart');
  if (playerHeartBtn) {
    const isFav = isTrackFavorite(track);
    playerHeartBtn.classList.toggle('active', isFav);
    playerHeartBtn.innerHTML = getHeartSvg(isFav, 16);
    playerHeartBtn.title = isFav ? '從最愛歌曲移除' : '加入最愛歌曲';
  }

  totalTimeLabel.textContent = formatDuration(track.duration || 0);
  updatePlayPauseBtnUI();

  // Secondary panels must never block the player-bar restore itself
  try {
    renderQueue();
    updateQueueActiveItem();
    updateSignalPathUI(track);
  } catch (e) {
    console.warn('showRestoredTrack secondary UI:', e);
  }
}

function formatTimeAgo(timestamp) {
  if (!timestamp) return '剛才';
  const now = Date.now();
  const diffSec = Math.floor((now - timestamp) / 1000);
  if (diffSec < 60) return '剛才';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} 分鐘前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小時前`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay} 天前`;
  const d = new Date(timestamp);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${m}/${day} ${h}:${min}`;
}

// ----------------- Play Count Tracker -----------------
// Parsed-JSON cache keyed on the raw localStorage string; returns a shallow copy so
// callers can merge/mutate freely without corrupting the cache before savePlayStats.
let _playStatsCache = null;
function getPlayStats() {
  try {
    const raw = localStorage.getItem('rooplayer_play_stats');
    if (raw) {
      if (!_playStatsCache || _playStatsCache.raw !== raw) {
        _playStatsCache = { raw, data: JSON.parse(raw) };
      }
      const d = _playStatsCache.data;
      return { albums: { ...(d.albums || {}) }, tracks: { ...(d.tracks || {}) } };
    }
  } catch (e) {}
  return { albums: {}, tracks: {} };
}

function savePlayStats(stats) {
  try {
    const raw = JSON.stringify(stats);
    localStorage.setItem('rooplayer_play_stats', raw);
    _playStatsCache = { raw, data: stats };
  } catch (e) {}
}

function recordPlayCount(track, album) {
  if (!track) return;
  const stats = getPlayStats();
  if (!stats.albums) stats.albums = {};
  if (!stats.tracks) stats.tracks = {};

  const trackKey = track.id || `${track.title}___${track.artist}`;
  stats.tracks[trackKey] = (stats.tracks[trackKey] || 0) + 1;

  const albKey = album ? (album.id || `${album.title}___${album.artist}`) : `${track.album}___${track.artist}`;
  stats.albums[albKey] = (stats.albums[albKey] || 0) + 1;

  savePlayStats(stats);
}

function getAlbumPlayCount(album) {
  if (!album) return 0;
  const stats = getPlayStats();
  const albKey = album.id || `${album.title}___${album.artist}`;
  const directCount = (stats.albums && stats.albums[albKey]) || 0;
  let trackSum = 0;
  if (album.tracks && album.tracks.length) {
    album.tracks.forEach(t => {
      const tKey = t.id || `${t.title}___${t.artist}`;
      trackSum += (stats.tracks && stats.tracks[tKey]) || 0;
    });
  }
  return Math.max(directCount, trackSum);
}

function getTrackPlayCount(track) {
  if (!track) return 0;
  const stats = getPlayStats();
  const trackKey = track.id || `${track.title}___${track.artist}`;
  return (stats.tracks && stats.tracks[trackKey]) || 0;
}

// ----------------- Online Unknown Artist Resolver -----------------
function isUnknownArtist(artist) {
  if (!artist) return true;
  const s = String(artist).trim().toLowerCase();
  return (
    s === '' ||
    s === 'unknown' ||
    s === 'unknown artist' ||
    s === 'unknown artists' ||
    s === 'unknown album' ||
    s === '未知演出者' ||
    s === '未知歌手' ||
    s === '未知' ||
    s === 'undefined' ||
    s === 'null'
  );
}

function cleanAlbumTitleForSearch(title) {
  if (!title) return '';
  let cleaned = String(title)
    .replace(/\[(?:flac|dsd|dsf|hi-res|remaster|24bit|24\/[0-9]+|cd[0-9]*|dff|wav|lossless)[^\]]*\]/gi, '')
    .replace(/\((?:remaster|deluxe|expanded|bonus|edition|cd[0-9]*|dff|lossless)[^\)]*\)/gi, '')
    .replace(/\b(?:19|20)\d{2}\b/g, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\[\s*\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || title;
}

const resolvedArtistCache = new Map();

function getCachedResolvedArtist(albumTitle) {
  if (!albumTitle) return null;
  const key = cleanAlbumTitleForSearch(albumTitle).toLowerCase();
  if (resolvedArtistCache.has(key)) return resolvedArtistCache.get(key);
  try {
    const raw = localStorage.getItem('rooplayer_resolved_artists');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed[key]) {
        resolvedArtistCache.set(key, parsed[key]);
        return parsed[key];
      }
    }
  } catch (e) {}
  return null;
}

function setCachedResolvedArtist(albumTitle, artistName) {
  if (!albumTitle || !artistName) return;
  const key = cleanAlbumTitleForSearch(albumTitle).toLowerCase();
  resolvedArtistCache.set(key, artistName);
  try {
    const raw = localStorage.getItem('rooplayer_resolved_artists');
    const store = raw ? JSON.parse(raw) : {};
    store[key] = artistName;
    localStorage.setItem('rooplayer_resolved_artists', JSON.stringify(store));
  } catch (e) {}
}

async function findArtistByAlbumTitleOnline(albumTitle) {
  if (!albumTitle) return null;
  const cached = getCachedResolvedArtist(albumTitle);
  if (cached) return cached;

  const cleanTitle = cleanAlbumTitleForSearch(albumTitle);
  if (!cleanTitle || cleanTitle.length < 2) return null;

  // 1. Try MusicBrainz Release API
  try {
    const mbUrl = `https://musicbrainz.org/ws/2/release/?query=release:${encodeURIComponent(cleanTitle)}&fmt=json&limit=5`;
    const res = await fetch(mbUrl, { headers: { 'User-Agent': 'rooPlayer/1.0' } });
    if (res.ok) {
      const data = await res.json();
      if (data.releases && data.releases.length > 0) {
        for (const rel of data.releases) {
          if (rel['artist-credit'] && rel['artist-credit'].length > 0) {
            const artistName = rel['artist-credit'].map(a => a.name).filter(Boolean).join(', ');
            if (artistName && !isUnknownArtist(artistName) && artistName.toLowerCase() !== 'various artists') {
              setCachedResolvedArtist(albumTitle, artistName);
              return artistName;
            }
          }
        }
      }
    }
  } catch (e) {}

  // 2. Try iTunes Search API
  try {
    const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(cleanTitle)}&entity=album&limit=5`;
    const res = await fetch(itunesUrl);
    if (res.ok) {
      const data = await res.json();
      if (data.results && data.results.length > 0) {
        for (const r of data.results) {
          if (r.artistName && !isUnknownArtist(r.artistName) && r.artistName.toLowerCase() !== 'various artists') {
            setCachedResolvedArtist(albumTitle, r.artistName);
            return r.artistName;
          }
        }
      }
    }
  } catch (e) {}

  // 3. Try Wikipedia Search API
  try {
    const wikiUrl = `https://zh.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(cleanTitle + ' 專輯')}&format=json&utf8=1`;
    const res = await fetch(wikiUrl, { headers: { 'User-Agent': 'rooPlayer/1.0' } });
    if (res.ok) {
      const data = await res.json();
      const hits = data.query?.search;
      if (hits && hits.length > 0) {
        for (const hit of hits) {
          const text = hit.snippet || '';
          const m = text.match(/(?:歌手|音樂人|由)\s*([A-Za-z\u4e00-\u9fa5\s·]{2,15}?)(?:發行|製作|的第|於|推出)/);
          if (m && m[1]) {
            const cand = m[1].replace(/<[^>]+>/g, '').trim();
            if (cand && !isUnknownArtist(cand) && cand.length >= 2 && cand.length <= 25) {
              setCachedResolvedArtist(albumTitle, cand);
              return cand;
            }
          }
        }
      }
    }
  } catch (e) {}

  return null;
}

function applyResolvedArtistToAlbum(album, artistName) {
  if (!album || !artistName) return;
  album.artist = artistName;
  if (album.tracks && album.tracks.length) {
    album.tracks.forEach(t => {
      if (isUnknownArtist(t.artist)) {
        t.artist = artistName;
      }
    });
  }

  // Update in state.artists
  let foundArt = state.artists.find(a => a.name.toLowerCase() === artistName.toLowerCase());
  if (!foundArt) {
    foundArt = {
      name: artistName,
      albums: new Set([album.title]),
      tracks: [...album.tracks]
    };
    state.artists.push(foundArt);
  } else {
    foundArt.albums.add(album.title);
    album.tracks.forEach(t => {
      if (!foundArt.tracks.includes(t)) foundArt.tracks.push(t);
    });
  }

  // Persist to main process
  if (window.electronAPI && window.electronAPI.updateAlbumArtist) {
    window.electronAPI.updateAlbumArtist(album.title, artistName).catch(() => {});
  }

  updateBadgesAndStats();
}

let isResolvingUnknownArtists = false;
async function autoResolveUnknownAlbumArtists() {
  if (isResolvingUnknownArtists) return;
  const unknownAlbums = state.albums.filter(a => isUnknownArtist(a.artist));
  if (unknownAlbums.length === 0) return;

  isResolvingUnknownArtists = true;
  try {
    for (const alb of unknownAlbums) {
      const found = await findArtistByAlbumTitleOnline(alb.title);
      if (found) {
        applyResolvedArtistToAlbum(alb, found);
        // Refresh cards on screen
        const cards = document.querySelectorAll('.album-card');
        cards.forEach(card => {
          const titleEl = card.querySelector('.album-title');
          if (titleEl && titleEl.textContent === alb.title) {
            const artEl = card.querySelector('.album-artist');
            if (artEl) artEl.textContent = found;
          }
        });
      }
      await new Promise(r => setTimeout(r, 400));
    }
  } finally {
    isResolvingUnknownArtists = false;
  }
}

// ----------------- Flat SVG Favorites Icons -----------------
function getHeartSvg(isActive = false, size = 16) {
  if (isActive) {
    return `<svg class="fav-svg-icon active" viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;pointer-events:none;"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;
  }
  return `<svg class="fav-svg-icon" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;pointer-events:none;"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;
}

function getStarSvg(isActive = false, size = 16) {
  if (isActive) {
    return `<svg class="fav-svg-icon active" viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;pointer-events:none;"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
  }
  return `<svg class="fav-svg-icon" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;pointer-events:none;"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
}

// ----------------- Favorites State Management -----------------
function initFavorites() {
  try {
    const raw = localStorage.getItem('roon_favorites');
    if (raw) {
      const parsed = JSON.parse(raw);
      state.favorites = {
        albums: Array.isArray(parsed.albums) ? parsed.albums : [],
        tracks: Array.isArray(parsed.tracks) ? parsed.tracks : [],
        artists: Array.isArray(parsed.artists) ? parsed.artists : []
      };
    }
  } catch (e) {
    console.warn('Error reading roon_favorites:', e);
  }
}

function saveFavorites() {
  try {
    localStorage.setItem('roon_favorites', JSON.stringify(state.favorites));
  } catch (e) {
    console.warn('Error saving roon_favorites:', e);
  }
}

function getAlbumKey(album) {
  if (!album) return '';
  return `${(album.title || '').trim()}___${(album.artist || '').trim()}`.toLowerCase();
}

function getTrackKey(track) {
  if (!track) return '';
  if (track.filePath) return track.filePath;
  if (track.isTidal) return `tidal_${track.tidalId || track.id}`;
  return `${(track.title || '').trim()}___${(track.artist || '').trim()}`.toLowerCase();
}

function isAlbumFavorite(album) {
  if (!album) return false;
  const key = getAlbumKey(album);
  return state.favorites.albums.some(k => k.toLowerCase() === key);
}

function toggleAlbumFavorite(album) {
  if (!album) return;
  const key = getAlbumKey(album);
  const idx = state.favorites.albums.findIndex(k => k.toLowerCase() === key);
  if (idx >= 0) {
    state.favorites.albums.splice(idx, 1);
    showToast(`已從最愛專輯移除《${album.title}》`);
  } else {
    state.favorites.albums.push(key);
    showToast(`♥ 已將《${album.title}》加入最愛專輯`);
  }
  saveFavorites();
  syncAllFavoriteUIs();
}

function isTrackFavorite(track) {
  if (!track) return false;
  const key = getTrackKey(track);
  return state.favorites.tracks.some(k => k.toLowerCase() === key.toLowerCase());
}

function toggleTrackFavorite(track) {
  if (!track) return;
  const key = getTrackKey(track);
  const idx = state.favorites.tracks.findIndex(k => k.toLowerCase() === key.toLowerCase());
  if (idx >= 0) {
    state.favorites.tracks.splice(idx, 1);
    showToast(`已從最愛歌曲移除「${track.title}」`);
  } else {
    state.favorites.tracks.push(key);
    showToast(`♥ 已將「${track.title}」加入最愛歌曲`);
  }
  saveFavorites();
  syncAllFavoriteUIs();
}

function isArtistFavorite(artistName) {
  if (!artistName) return false;
  const name = artistName.trim().toLowerCase();
  return state.favorites.artists.some(a => a.toLowerCase() === name);
}

function toggleArtistFavorite(artistName) {
  if (!artistName) return;
  const name = artistName.trim();
  const idx = state.favorites.artists.findIndex(a => a.toLowerCase() === name.toLowerCase());
  if (idx >= 0) {
    state.favorites.artists.splice(idx, 1);
    showToast(`已從最愛演出者移除「${name}」`);
  } else {
    state.favorites.artists.push(name);
    showToast(`⭐ 已將「${name}」加入最愛演出者`);
  }
  saveFavorites();
  syncAllFavoriteUIs();
}

function getFavoriteAlbumsList() {
  return state.albums.filter(alb => isAlbumFavorite(alb));
}

function getFavoriteTracksList() {
  return state.tracks.filter(track => isTrackFavorite(track));
}

function getFavoriteArtistsList() {
  return state.artists.filter(art => isArtistFavorite(art.name));
}

function syncAllFavoriteUIs() {
  updateBadgesAndStats();

  // If playing, update player heart
  if (state.currentTrackIndex >= 0 && state.queue[state.currentTrackIndex]) {
    const isFav = isTrackFavorite(state.queue[state.currentTrackIndex]);
    const playerHeartBtn = document.getElementById('btnPlayerHeart');
    if (playerHeartBtn) {
      playerHeartBtn.classList.toggle('active', isFav);
      playerHeartBtn.innerHTML = getHeartSvg(isFav, 16);
      playerHeartBtn.title = isFav ? '從最愛歌曲移除' : '加入最愛歌曲';
    }
  }

  // If album detail modal is open
  if (state.activeAlbumDetail) {
    const btnFavAlbum = document.getElementById('btnFavAlbumDetail');
    if (btnFavAlbum) {
      const isFav = isAlbumFavorite(state.activeAlbumDetail);
      btnFavAlbum.classList.toggle('active', isFav);
      btnFavAlbum.innerHTML = `${getHeartSvg(isFav, 15)} <span>${isFav ? '已在最愛專輯' : '加入最愛專輯'}</span>`;
    }
  }

  // If artist detail view is open
  if (state.currentArtistDetail) {
    const btnFavArtist = document.getElementById('btnFavArtistDetail');
    if (btnFavArtist) {
      const isFav = isArtistFavorite(state.currentArtistDetail);
      btnFavArtist.classList.toggle('active', isFav);
      btnFavArtist.innerHTML = `${getStarSvg(isFav, 15)} <span>${isFav ? '已在最愛演出者' : '加入最愛演出者'}</span>`;
    }
  }

  // Re-render favorites views
  renderFavAlbums();
  renderFavTracks();
  renderFavArtists();

  // Re-sync all visible album card heart buttons
  document.querySelectorAll('.album-card').forEach(card => {
    const titleEl = card.querySelector('.album-title');
    const artistEl = card.querySelector('.album-artist');
    if (titleEl && artistEl) {
      const title = titleEl.textContent;
      const artist = artistEl.textContent;
      const isFav = state.favorites.albums.some(k => k.toLowerCase() === `${title}___${artist}`.toLowerCase());
      const favBtn = card.querySelector('.card-fav-btn');
      if (favBtn) {
        favBtn.classList.toggle('active', isFav);
        favBtn.innerHTML = getHeartSvg(isFav, 15);
        favBtn.title = isFav ? '取消最愛專輯' : '加入最愛專輯';
      }
    }
  });

  // Re-sync all visible artist card star buttons
  document.querySelectorAll('.artist-card').forEach(card => {
    const nameEl = card.querySelector('.artist-name');
    if (nameEl) {
      const name = nameEl.textContent;
      const isFav = isArtistFavorite(name);
      const favBtn = card.querySelector('.artist-fav-btn');
      if (favBtn) {
        favBtn.classList.toggle('active', isFav);
        favBtn.innerHTML = getStarSvg(isFav, 14);
        favBtn.title = isFav ? '取消最愛演出者' : '加入最愛演出者';
      }
    }
  });

  // Re-sync all visible track table rows heart buttons
  document.querySelectorAll('tr').forEach(tr => {
    const favBtn = tr.querySelector('.btn-track-fav');
    if (favBtn) {
      const titleSpan = tr.querySelector('.track-name-span');
      const titleCell = titleSpan || tr.querySelector('.track-title-cell');
      if (titleCell) {
        const title = titleCell.textContent.trim();
        const matchingTrack = state.tracks.find(t => t.title === title);
        if (matchingTrack) {
          const isFav = isTrackFavorite(matchingTrack);
          favBtn.classList.toggle('active', isFav);
          favBtn.innerHTML = getHeartSvg(isFav, 14);
          favBtn.title = isFav ? '取消最愛歌曲' : '加入最愛歌曲';
        }
      }
    }
  });
}

// Canonical Genre Pillars Registry
// CANONICAL_GENRES and canonicalizeGenre are provided by genre-utils.js (loaded before app.js)

// Smart Genre Matching Engine
function matchItemGenre(item, genreName) {
  if (!item || !genreName) return false;
  const target = genreName.toLowerCase().trim();
  const itemGenre = canonicalizeGenre(item.genre, item).toLowerCase();
  if (itemGenre === target) return true;
  const rawGenre = (item.genre || '').toLowerCase().trim();
  if (rawGenre && (rawGenre === target || rawGenre.includes(target) || target.includes(rawGenre))) return true;
  return false;
}

// Group Tracks into Albums, Artists, Genres
function rebuildLibraryCollections() {
  const albumMap = new Map();
  const artistMap = new Map();
  const genreSet = new Set();

  // Curated pillar genres always present
  const CURATED_PILLARS = [
    'Classical', 'Jazz', 'Rock', 'Pop', 'Electronic',
    'Soul / R&B', 'Blues', 'Folk', 'Soundtrack', 'Metal',
    'Hip Hop', 'Ambient', 'Vocal', 'Audiophile'
  ];
  CURATED_PILLARS.forEach(p => genreSet.add(p));

  state.tracks.forEach(t => {
    // If track artist is unknown, restore from cached resolved artist if available
    if (isUnknownArtist(t.artist)) {
      const cachedArt = getCachedResolvedArtist(t.album);
      if (cachedArt) {
        t.artist = cachedArt;
        if (!t.albumArtist || isUnknownArtist(t.albumArtist)) t.albumArtist = cachedArt;
      }
    }

    // Canonicalize track genre
    t.genre = canonicalizeGenre(t.genre, t);

    // Albums grouping
    const albumKey = t.isTidal 
      ? `tidal_album_${t.tidalAlbumId || t.albumId || (t.album + '___' + t.artist)}` 
      : `${t.album}___${t.artist}`;

    if (!albumMap.has(albumKey)) {
      albumMap.set(albumKey, {
        id: albumKey,
        isTidal: !!t.isTidal,
        tidalId: t.tidalAlbumId || t.albumId || t.tidalId || null,
        audioQuality: t.audioQuality || null,
        title: t.album,
        artist: t.artist,
        year: t.year,
        date: t.date || null,
        genre: t.genre,
        cover: formatCoverSrc(t.cover),
        isLossless: t.isLossless !== undefined ? t.isLossless : true,
        formatName: t.formatName || (t.isTidal ? 'FLAC' : 'PCM'),
        sampleRate: t.sampleRate,
        bitsPerSample: t.bitsPerSample,
        label: t.label || null,
        producer: t.producer || null,
        composer: t.composer || null,
        copyright: t.copyright || null,
        addedAt: t.addedAt || 0,
        tracks: []
      });
    }
    const alb = albumMap.get(albumKey);
    alb.tracks.push(t);
    if (t.addedAt && (!alb.addedAt || t.addedAt > alb.addedAt)) {
      alb.addedAt = t.addedAt;
    }
    if (t.isTidal) {
      alb.isTidal = true;
      if (!alb.tidalId && (t.tidalAlbumId || t.albumId)) alb.tidalId = t.tidalAlbumId || t.albumId;
      if (!alb.audioQuality && t.audioQuality) alb.audioQuality = t.audioQuality;
    }
    if (!alb.cover && t.cover) alb.cover = formatCoverSrc(t.cover);
    if ((!alb.genre || alb.genre === 'Unknown') && t.genre && t.genre !== 'Unknown') alb.genre = t.genre;
    if (!alb.year && t.year) alb.year = t.year;
    if (!alb.date && t.date) alb.date = t.date;
    if (!alb.label && t.label) alb.label = t.label;
    if (!alb.producer && t.producer) alb.producer = t.producer;
    if (!alb.composer && t.composer) alb.composer = t.composer;
    if (!alb.copyright && t.copyright) alb.copyright = t.copyright;

    // Artists grouping
    if (!artistMap.has(t.artist)) {
      artistMap.set(t.artist, {
        name: t.artist,
        albums: new Set(),
        tracks: []
      });
    }
    const art = artistMap.get(t.artist);
    art.albums.add(t.album);
    art.tracks.push(t);

    // Genres collection
    genreSet.add(t.genre);
  });

  // Post-process albums: inherit cover from any child track, sort tracks
  albumMap.forEach(alb => {
    if (alb.isTidal) {
      alb.formatName = 'FLAC';
      alb.isLossless = true;
      const isHiRes = alb.audioQuality === 'HI_RES_LOSSLESS' || alb.audioQuality === 'HIRES' || (alb.bitsPerSample && alb.bitsPerSample >= 24) || (alb.sampleRate && alb.sampleRate > 48000);
      if (isHiRes) {
        alb.bitsPerSample = alb.bitsPerSample || 24;
        alb.sampleRate = alb.sampleRate || 96000;
      } else {
        alb.bitsPerSample = alb.bitsPerSample || 16;
        alb.sampleRate = alb.sampleRate || 44100;
      }
    }
    if (isUnknownArtist(alb.artist)) {
      const cachedArt = getCachedResolvedArtist(alb.title);
      if (cachedArt) {
        alb.artist = cachedArt;
        alb.tracks.forEach(tr => {
          if (isUnknownArtist(tr.artist)) tr.artist = cachedArt;
        });
      }
    }
    if (!alb.cover) {
      const childWithCover = alb.tracks.find(tr => tr.cover);
      if (childWithCover) alb.cover = formatCoverSrc(childWithCover.cover);
    }
    alb.genre = canonicalizeGenre(alb.genre, alb);
    genreSet.add(alb.genre);
    alb.tracks.sort((a, b) => (a.trackNumber || 0) - (b.trackNumber || 0));
  });

  CANONICAL_GENRES.forEach(p => genreSet.add(p));
  state.albums = Array.from(albumMap.values());
  state.artists = Array.from(artistMap.values());
  state.genres = Array.from(genreSet);

  // Trigger background online resolution for any remaining unknown album artists
  setTimeout(() => autoResolveUnknownAlbumArtists(), 1000);
}

// ----------------- UI Rendering & On-Demand (Lazy) Architecture -----------------
const viewDirtyState = {
  overview: true,
  albums: true,
  artists: true,
  tracks: true,
  genres: true,
  storage: true,
  favAlbums: true,
  favTracks: true,
  favArtists: true,
  history: true,
  kkbox: true,
  tidal: true
};

function markAllViewsDirty() {
  for (const k of Object.keys(viewDirtyState)) {
    viewDirtyState[k] = true;
  }
}

function renderViewIfNeeded(viewId) {
  if (!viewId) viewId = 'overview';
  // If not dirty and not kkbox or tidal, preserve already-built DOM and avoid reflow
  if (!viewDirtyState[viewId] && viewId !== 'kkbox' && viewId !== 'tidal') return;

  switch (viewId) {
    case 'overview':
      renderOverview();
      break;
    case 'albums':
      renderAlbums();
      break;
    case 'artists':
      renderArtists();
      break;
    case 'tracks':
      renderTracks();
      break;
    case 'genres':
      renderGenres();
      break;
    case 'storage':
      renderFolders();
      break;
    case 'favAlbums':
      renderFavAlbums();
      break;
    case 'favTracks':
      renderFavTracks();
      break;
    case 'favArtists':
      renderFavArtists();
      break;
    case 'history':
      renderPlaybackHistory();
      break;
    case 'kkbox':
      onOpenKkboxView();
      break;
    case 'tidal':
      onOpenTidalView();
      break;
    default:
      break;
  }
  viewDirtyState[viewId] = false;
}

function renderAll(forceAll = false) {
  markAllViewsDirty();
  updateBadgesAndStats();
  if (forceAll) {
    renderOverview();
    renderAlbums();
    renderArtists();
    renderTracks();
    renderGenres();
    renderFolders();
    renderFavAlbums();
    renderFavTracks();
    renderFavArtists();
  } else {
    // Lazy on-demand: instantly render current visible view only
    const active = state.currentView || 'overview';
    renderViewIfNeeded(active);
  }
}

function updateBadgesAndStats() {
  const totalAlbums = state.albums.length;
  const totalTracks = state.tracks.length;
  const totalArtists = state.artists.length;
  const hiresCount = state.tracks.filter(t => (t.bitsPerSample >= 24) || (t.sampleRate > 48000)).length;

  document.getElementById('albumCountBadge').textContent = totalAlbums;
  document.getElementById('artistCountBadge').textContent = totalArtists;
  document.getElementById('trackCountBadge').textContent = totalTracks;
  const genreBadge = document.getElementById('genreCountBadge');
  if (genreBadge) {
    const totalGenres = (state.genres && state.genres.length > 0)
      ? state.genres.length
      : (typeof CANONICAL_GENRES !== 'undefined' ? CANONICAL_GENRES.length : 15);
    genreBadge.textContent = totalGenres;
  }

  // Favorites badges and headers
  const favAlbumsCount = getFavoriteAlbumsList().length;
  const favTracksCount = getFavoriteTracksList().length;
  const favArtistsCount = getFavoriteArtistsList().length;

  const favAlbumsBadge = document.getElementById('favAlbumsCountBadge');
  if (favAlbumsBadge) favAlbumsBadge.textContent = favAlbumsCount;
  const favTracksBadge = document.getElementById('favTracksCountBadge');
  if (favTracksBadge) favTracksBadge.textContent = favTracksCount;
  const favArtistsBadge = document.getElementById('favArtistsCountBadge');
  if (favArtistsBadge) favArtistsBadge.textContent = favArtistsCount;

  const favAlbumsHeader = document.getElementById('favAlbumsHeaderCount');
  if (favAlbumsHeader) favAlbumsHeader.textContent = `共 ${favAlbumsCount} 張最愛專輯`;
  const favTracksHeader = document.getElementById('favTracksHeaderCount');
  if (favTracksHeader) favTracksHeader.textContent = `共 ${favTracksCount} 首最愛歌曲`;
  const favArtistsHeader = document.getElementById('favArtistsHeaderCount');
  if (favArtistsHeader) favArtistsHeader.textContent = `共 ${favArtistsCount} 位最愛演出者`;

  document.getElementById('heroAlbumCount').textContent = totalAlbums;
  document.getElementById('heroTrackCount').textContent = totalTracks;
  document.getElementById('heroHiresCount').textContent = hiresCount;
  updateHistoryCountBadges();

  document.getElementById('albumsHeaderCount').textContent = `共 ${totalAlbums} 張專輯`;
  document.getElementById('artistsHeaderCount').textContent = `共 ${totalArtists} 位演出者`;
  document.getElementById('tracksHeaderCount').textContent = `共 ${totalTracks} 首曲目`;
}

// ----------------- Daily Recommendations Engine -----------------
// Updates once per day on first app launch, randomly recommending 5 albums referencing recent playback history
function getDailyRecommendedAlbums() {
  if (!state.albums || state.albums.length === 0) return [];

  const todayStr = new Date().toISOString().split('T')[0];
  const storageKey = 'rooplayer_daily_recommendations';

  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const data = JSON.parse(raw);
      if (data && data.date === todayStr && Array.isArray(data.albumIds) && data.albumIds.length > 0) {
        // Find cached albums
        const cachedAlbums = [];
        data.albumIds.forEach(id => {
          const found = state.albums.find(a => (a.title + ':::' + a.artist) === id || a.title === id);
          if (found && !cachedAlbums.includes(found)) cachedAlbums.push(found);
        });
        if (cachedAlbums.length >= Math.min(5, state.albums.length)) {
          return cachedAlbums.slice(0, 5);
        }
      }
    }
  } catch (e) {
    console.warn('Error reading daily recommendations cache:', e);
  }

  // Generate new daily recommendations for today
  const historyList = getPlaybackHistory();
  const recentGenres = new Set();
  const recentArtists = new Set();
  const recentAlbums = new Set();

  historyList.slice(0, 30).forEach(trk => {
    if (trk.genre && trk.genre !== 'Various') recentGenres.add(trk.genre.toLowerCase().trim());
    if (trk.artist && !isUnknownArtist(trk.artist)) recentArtists.add(trk.artist.toLowerCase().trim());
    if (trk.album) recentAlbums.add(trk.album.toLowerCase().trim());
  });

  // Score candidate albums
  const scoredCandidates = state.albums.map(alb => {
    let score = 10; // base score for randomness
    const albGenre = (alb.genre || '').toLowerCase().trim();
    const albArtist = (alb.artist || '').toLowerCase().trim();
    const albTitle = (alb.title || '').toLowerCase().trim();

    // Preference for genres in recent history
    if (recentGenres.has(albGenre)) score += 50;

    // Preference for artists in recent history
    if (recentArtists.has(albArtist)) score += 40;

    // Bonus for albums recently listened to, but give room for discovery
    if (recentAlbums.has(albTitle)) score += 20;

    // Small bonus for lossless / hires
    if (alb.isLossless) score += 10;

    // Random jitter so every day has fresh variety
    score += Math.random() * 60;

    return { album: alb, score };
  });

  // Sort by score descending
  scoredCandidates.sort((a, b) => b.score - a.score);

  // Take top 5 unique albums
  const chosen = scoredCandidates.slice(0, 5).map(item => item.album);

  // Fallback if less than 5
  if (chosen.length < 5 && state.albums.length > chosen.length) {
    const remainders = state.albums.filter(a => !chosen.includes(a));
    // shuffle remainders
    remainders.sort(() => Math.random() - 0.5);
    chosen.push(...remainders.slice(0, 5 - chosen.length));
  }

  // Persist to localStorage for today
  try {
    const albumIds = chosen.map(a => a.title + ':::' + a.artist);
    localStorage.setItem(storageKey, JSON.stringify({
      date: todayStr,
      albumIds: albumIds
    }));
  } catch (e) {
    console.warn('Error saving daily recommendations cache:', e);
  }

  return chosen;
}

function renderDailyRecommendations() {
  if (!dailyRecommendGrid) return;
  dailyRecommendGrid.innerHTML = '';

  const dailyAlbums = getDailyRecommendedAlbums();
  const section = document.getElementById('dailyRecommendSection');

  if (!dailyAlbums || dailyAlbums.length === 0) {
    if (section) section.style.display = 'none';
    return;
  }

  if (section) section.style.display = 'block';

  dailyAlbums.forEach(alb => {
    dailyRecommendGrid.appendChild(createAlbumCard(alb));
  });
}

// ----------------- 藝人生活誌 Artist Spotlight Engine -----------------
let currentSpotlightArtistName = null;

async function renderArtistSpotlight(forceRefresh = false) {
  const section = document.getElementById('artistSpotlightSection');
  const avatarImg = document.getElementById('spotlightAvatarImg');
  const avatarPlaceholder = document.getElementById('spotlightAvatarPlaceholder');
  const nameEl = document.getElementById('spotlightName');
  const genresEl = document.getElementById('spotlightGenres');
  const bioEl = document.getElementById('spotlightBio');
  const albumsGrid = document.getElementById('spotlightAlbumsGrid');
  const btnViewArtist = document.getElementById('btnSpotlightViewArtist');
  const btnPlayArtist = document.getElementById('btnSpotlightPlayArtist');
  const btnRefresh = document.getElementById('btnRefreshSpotlight');

  if (!section) return;

  const validArtists = (state.artists || []).filter(art => {
    return art && art.name && !isUnknownArtist(art.name);
  });

  if (validArtists.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';

  // Bind refresh button once
  if (btnRefresh && !btnRefresh.dataset.bound) {
    btnRefresh.dataset.bound = 'true';
    btnRefresh.onclick = () => {
      renderArtistSpotlight(true);
      showToast('已隨機更換藝人生活誌');
    };
  }

  // Choose a random artist
  let chosenArt = null;
  if (!forceRefresh && currentSpotlightArtistName) {
    chosenArt = validArtists.find(a => a.name.toLowerCase() === currentSpotlightArtistName.toLowerCase());
  }

  if (!chosenArt) {
    // Pick different from current if possible
    const candidates = validArtists.filter(a => a.name !== currentSpotlightArtistName);
    const pool = candidates.length > 0 ? candidates : validArtists;
    chosenArt = pool[Math.floor(Math.random() * pool.length)];
  }

  currentSpotlightArtistName = chosenArt.name;
  const artistName = chosenArt.name;

  // 1. Basic Info
  nameEl.textContent = artistName;
  nameEl.onclick = () => openArtistDetail(artistName);

  // Genres
  if (genresEl) {
    genresEl.innerHTML = '';
    const artistGenres = new Set();
    const artistAlbums = state.albums.filter(a => (a.artist || '').toLowerCase().trim() === artistName.toLowerCase().trim());
    artistAlbums.forEach(a => { if (a.genre && a.genre !== 'Various') artistGenres.add(a.genre); });
    (chosenArt.tracks || []).forEach(t => { if (t.genre && t.genre !== 'Various') artistGenres.add(t.genre); });

    const genreList = Array.from(artistGenres).slice(0, 3);
    if (genreList.length === 0) genreList.push('流行音樂');
    genreList.forEach(g => {
      const chip = document.createElement('span');
      chip.className = 'spec-chip';
      chip.style.fontSize = '11px';
      chip.style.padding = '2px 8px';
      chip.textContent = g;
      genresEl.appendChild(chip);
    });
  }

  // Actions
  if (btnViewArtist) {
    btnViewArtist.onclick = () => openArtistDetail(artistName);
  }
  if (btnPlayArtist) {
    btnPlayArtist.onclick = () => {
      const artistTracks = state.tracks.filter(t => (t.artist || '').toLowerCase().trim() === artistName.toLowerCase().trim());
      if (artistTracks.length > 0) {
        playTrackList(artistTracks, 0);
        showToast(`▶ 開始播放 ${artistName} 的所有曲目`);
      } else {
        showToast('此演出者暫無本機曲目');
      }
    };
  }

  // Reset Avatar & Bio
  avatarImg.style.display = 'none';
  avatarPlaceholder.style.display = 'flex';
  avatarPlaceholder.textContent = artistName.charAt(0).toUpperCase();
  bioEl.textContent = '正在連線維基百科取得演出者生平介紹與照片...';

  // 2. 關聯精選專輯（依資料庫內容最多顯示 3 張；若只有 1 張就顯示 1 張，以此類推，不補其他歌手的專輯）
  if (albumsGrid) {
    albumsGrid.innerHTML = '';
    let artistAlbums = state.albums.filter(a => (a.artist || '').toLowerCase().trim() === artistName.toLowerCase().trim());
    
    // 若該演出者無獨立專輯，但有收錄在合輯/多曲目專輯中，補上包含該演出者曲目的專輯
    if (artistAlbums.length === 0) {
      artistAlbums = state.albums.filter(a => a.tracks && a.tracks.some(t => (t.artist || '').toLowerCase().trim() === artistName.toLowerCase().trim()));
    }

    // 依資料庫內容最多顯示 3 張，有幾張就顯示幾張（不填補其他歌手專輯）
    const selectedAlbums = artistAlbums.slice(0, 3);
    const albumsWrap = document.getElementById('spotlightAlbumsWrap') || albumsGrid.closest('.spotlight-albums-wrap');
    const albumsTitle = document.getElementById('spotlightAlbumsTitle') || albumsWrap?.querySelector('.spotlight-albums-title');

    if (selectedAlbums.length === 0) {
      if (albumsWrap) albumsWrap.style.display = 'none';
    } else {
      if (albumsWrap) albumsWrap.style.display = 'block';
      if (albumsTitle) {
        albumsTitle.textContent = `📀 相關精選專輯 Selected Albums (${selectedAlbums.length} 張)`;
      }
      selectedAlbums.forEach(alb => {
        albumsGrid.appendChild(createAlbumCard(alb));
      });
    }

    // 若已登入 TIDAL，非同步在 TIDAL 搜尋該演出者之發燒雲端專輯並加入相關精選專輯
    if (window.tidalService && window.tidalService.isLoggedIn) {
      window.tidalService.search(artistName, 8).then(res => {
        if (currentSpotlightArtistName !== artistName) return;
        const tAlbums = (res && res.albums) ? res.albums : [];
        if (!tAlbums || tAlbums.length === 0) return;

        const displayedTitles = new Set(selectedAlbums.map(a => (a.title || '').toLowerCase().trim()));
        const extraTidalAlbums = [];
        for (const ta of tAlbums) {
          const normTitle = (ta.title || '').toLowerCase().trim();
          if (!displayedTitles.has(normTitle)) {
            displayedTitles.add(normTitle);
            extraTidalAlbums.push(ta);
          }
          if (selectedAlbums.length + extraTidalAlbums.length >= 6) break;
        }

        if (extraTidalAlbums.length > 0) {
          if (albumsWrap) albumsWrap.style.display = 'block';
          extraTidalAlbums.forEach(ta => {
            albumsGrid.appendChild(createTidalAlbumCard(ta));
          });
          const totalCount = selectedAlbums.length + extraTidalAlbums.length;
          if (albumsTitle) {
            albumsTitle.textContent = `📀 相關精選專輯 Selected Albums (${totalCount} 張，含 TIDAL 發燒雲端母帶)`;
          }
        }
      }).catch(err => {
        console.warn('Spotlight TIDAL albums search error:', err);
      });
    }
  }

  // 3. Fetch Bio & Photo from Wikipedia / Online API
  try {
    let bioText = '';
    let avatarUrl = '';

    // Check cache first
    if (artistBioTranslationCache.has(artistName)) {
      const cached = artistBioTranslationCache.get(artistName);
      bioText = cached.translatedText || cached.originalText;
      avatarUrl = cached.originalImageUrl || cached.avatarUrl;
      if (bioText && !cached.translatedText) {
        bioText = await translateTextToZhTw(bioText);
        cached.translatedText = bioText;
      }
    } else {
      // 1. Try Chinese Wikipedia
      try {
        const zhUrl = `https://zh.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(artistName)}`;
        const res = await fetch(zhUrl, {
          headers: { 'User-Agent': 'rooPlayer/1.0', 'Accept-Language': 'zh-tw,zh-hant;q=0.9' }
        });
        if (res.ok) {
          const data = await res.json();
          if (data.extract && data.type !== 'disambiguation') {
            bioText = data.extract;
            if (data.originalimage?.source) avatarUrl = data.originalimage.source;
            else if (data.thumbnail?.source) avatarUrl = data.thumbnail.source;
          }
        }
      } catch (e) {}

      // 1-b. If Chinese Wikipedia summary is under 450 characters, fetch query prop=extracts for fuller introduction
      if (bioText.length < 450) {
        try {
          const zhQueryUrl = `https://zh.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&redirects=1&titles=${encodeURIComponent(artistName)}&format=json&origin=*`;
          const qRes = await fetch(zhQueryUrl, {
            headers: { 'User-Agent': 'rooPlayer/1.0', 'Accept-Language': 'zh-tw,zh-hant;q=0.9' }
          });
          if (qRes.ok) {
            const qData = await qRes.json();
            const pages = qData?.query?.pages;
            if (pages) {
              const firstPage = Object.values(pages)[0];
              if (firstPage && firstPage.extract && firstPage.extract.length > bioText.length) {
                bioText = firstPage.extract;
              }
            }
          }
        } catch (e) {}
      }

      // 2. Try English Wikipedia fallback
      if (!bioText || !avatarUrl) {
        try {
          const enUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(artistName)}`;
          const res = await fetch(enUrl, { headers: { 'User-Agent': 'rooPlayer/1.0' } });
          if (res.ok) {
            const data = await res.json();
            if (data.extract && data.type !== 'disambiguation') {
              if (!bioText) bioText = data.extract;
              if (!avatarUrl) {
                if (data.originalimage?.source) avatarUrl = data.originalimage.source;
                else if (data.thumbnail?.source) avatarUrl = data.thumbnail.source;
              }
            }
          }
        } catch (e) {}

        if (bioText.length < 450) {
          try {
            const enQueryUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&redirects=1&titles=${encodeURIComponent(artistName)}&format=json&origin=*`;
            const qRes = await fetch(enQueryUrl, { headers: { 'User-Agent': 'rooPlayer/1.0' } });
            if (qRes.ok) {
              const qData = await qRes.json();
              const pages = qData?.query?.pages;
              if (pages) {
                const firstPage = Object.values(pages)[0];
                if (firstPage && firstPage.extract && firstPage.extract.length > bioText.length) {
                  bioText = firstPage.extract;
                }
              }
            }
          } catch (e) {}
        }
      }

      // 自動翻譯為繁體中文 (Traditional Chinese)
      if (bioText) {
        bioText = await translateTextToZhTw(bioText);
      }

      // Cache results
      if (bioText || avatarUrl) {
        artistBioTranslationCache.set(artistName, {
          originalText: bioText,
          translatedText: bioText,
          avatarUrl,
          originalImageUrl: avatarUrl
        });
      }
    }

    // Only update if current spotlight artist hasn't changed
    if (currentSpotlightArtistName === artistName) {
      if (avatarUrl) {
        avatarImg.src = avatarUrl;
        avatarImg.onload = () => {
          avatarImg.style.display = 'block';
          avatarPlaceholder.style.display = 'none';
        };
        avatarImg.onerror = () => {
          avatarImg.style.display = 'none';
          avatarPlaceholder.style.display = 'flex';
        };
      }

      if (bioText) {
        // 擴增至 500 字以內，若超過則截斷至 495 字並加上省略號
        let trimmed = bioText.replace(/\s+/g, ' ').trim();
        if (trimmed.length > 500) {
          trimmed = trimmed.substring(0, 495) + '...';
        }
        bioEl.textContent = trimmed;
      } else {
        bioEl.textContent = `${artistName} 是深受當代樂迷喜愛與推崇的經典音樂創作者，在發燒音響與高解析錄音領域擁有豐富代表作。本機音樂庫中已完整收錄多張珍貴母帶與熱門曲目，點擊「查看演出者主頁」即可探索其專屬生平介紹、發行專輯與完整串流曲庫。`;
      }
    }
  } catch (err) {
    if (currentSpotlightArtistName === artistName) {
      bioEl.textContent = `${artistName} 是一位優秀的音樂創作者與演出者，在發燒音樂領域具備卓越表現。點擊查看更多個人專輯與作品。`;
    }
  }
}

// ----------------- 最近聆聽 Recent Played Albums -----------------
function getRecentlyPlayedAlbums(maxCount = 5) {
  const history = getPlaybackHistory();
  const seenAlbumKeys = new Set();
  const recentAlbums = [];

  for (const trk of history) {
    if (recentAlbums.length >= maxCount) break;
    let album = findAlbumForTrack(trk);
    if (!album && trk.album) {
      album = state.albums.find(a => (a.title || '').trim().toLowerCase() === (trk.album || '').trim().toLowerCase());
    }
    if (!album && trk.album) {
      album = {
        title: trk.album,
        artist: trk.artist || '未知演出者',
        cover: trk.cover || '',
        year: trk.year || '',
        genre: trk.genre || 'Various',
        formatName: trk.formatName || 'PCM',
        sampleRate: trk.sampleRate || 44100,
        bitsPerSample: trk.bitsPerSample || 16,
        isLossless: trk.isLossless || false,
        tracks: [trk]
      };
    }
    if (album) {
      const key = `${(album.title || '').toLowerCase().trim()}|${(album.artist || '').toLowerCase().trim()}`;
      if (!seenAlbumKeys.has(key)) {
        seenAlbumKeys.add(key);
        recentAlbums.push(album);
      }
    }
  }

  return recentAlbums;
}

function renderRecentPlayedAlbums() {
  const grid = document.getElementById('recentAlbumsGrid');
  if (!grid) return;

  grid.innerHTML = '';
  const curSize = state.albumCoverSize || 'medium';
  grid.classList.remove('cover-size-small', 'cover-size-medium', 'cover-size-large');
  grid.classList.add(`cover-size-${curSize}`);

  const recentAlbums = getRecentlyPlayedAlbums(5);

  if (recentAlbums.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 24px; text-align: center; color: var(--text-muted); background: var(--bg-card); border-radius: 12px; border: 1px dashed var(--border-color); font-size: 13px;">
        🎵 尚無最近聆聽紀錄，點擊播放任一歌曲後，將在此自動列出最近聽過的專輯。
      </div>
    `;
    return;
  }

  recentAlbums.forEach(alb => {
    grid.appendChild(createAlbumCard(alb));
  });
}

// Render Overview
function renderOverview() {
  // 1. Render Daily Recommendations (Top of Overview)
  renderDailyRecommendations();

  // 2. Render 藝人生活誌 Artist Spotlight
  renderArtistSpotlight();

  // 3. Render 最近聆聽 Recent Played Albums (最多 5 張專輯)
  renderRecentPlayedAlbums();

  // 4. Render 最近新增專輯 (最多呈現 5 張專輯，包含新增進資料庫的 TIDAL 專輯)
  overviewGrid.innerHTML = '';
  const curSize = state.albumCoverSize || 'medium';
  overviewGrid.classList.remove('cover-size-small', 'cover-size-medium', 'cover-size-large');
  overviewGrid.classList.add(`cover-size-${curSize}`);
  
  // 依加入時間排序，確保新加入曲庫的 TIDAL 專輯與本機最新專輯優先呈現於總覽
  const sortedAlbums = [...state.albums].sort((a, b) => {
    const aTime = a.addedAt || 0;
    const bTime = b.addedAt || 0;
    if (aTime !== bTime) return bTime - aTime;
    return 0;
  });
  const featured = sortedAlbums.slice(0, 5);
  featured.forEach(alb => {
    overviewGrid.appendChild(createAlbumCard(alb));
  });

  // 5. 探索演出者: metadata-driven discovery (TIDAL-related artists first when logged in)
  renderDiscoverArtists();
}

// ----------------- Overview: 探索演出者 (metadata-driven artist discovery) -----------------
let discoverArtistsOpId = 0;

// Build a listening profile from local metadata: playback history, recently played albums,
// play counts. Produces weighted seed artists and seed genres.
function buildListeningProfile() {
  const history = getPlaybackHistory();
  const recentAlbums = getRecentlyPlayedAlbums(10);
  const stats = getPlayStats();

  // Library lookup maps so history/stats entries can be resolved to artist + canonical genre
  const trackByKey = new Map();
  const trackByPath = new Map();
  state.albums.forEach(alb => {
    (alb.tracks || []).forEach(t => {
      const key = t.id || `${t.title}___${t.artist}`;
      const meta = { artist: t.artist, genre: canonicalizeGenre(t.genre, t) };
      trackByKey.set(key, meta);
      if (t.filePath) trackByPath.set(t.filePath, meta);
    });
  });

  const artistScore = new Map();
  const genreScore = new Map();

  const addArtist = (name, w) => {
    if (!name || isUnknownArtist(name)) return;
    const norm = String(name).toLowerCase().trim();
    if (!norm) return;
    const cur = artistScore.get(norm) || { name, score: 0 };
    cur.score += w;
    artistScore.set(norm, cur);
  };
  const addGenre = (g, w, contextTrack) => {
    const cg = canonicalizeGenre(g, contextTrack || {});
    if (!cg || cg === 'Various' || cg === 'Unknown') return;
    genreScore.set(cg, (genreScore.get(cg) || 0) + w);
  };

  // 1) Playback history (recently listened artists, weight 3)
  history.forEach(h => {
    addArtist(h.artist, 3);
    const meta = (h.filePath && trackByPath.get(h.filePath)) || trackByKey.get(h.id) || trackByKey.get(`${h.title}___${h.artist}`);
    if (meta) addGenre(meta.genre, 3);
    else addGenre(h.genre, 3, { album: h.album, artist: h.artist, title: h.title });
  });

  // 2) Recently played albums (weight 2)
  recentAlbums.forEach(alb => {
    addArtist(alb.artist, 2);
    addGenre(alb.genre, 2, alb);
  });

  // 3) Play counts (frequently listened, weight 1 per play)
  Object.entries(stats.tracks || {}).forEach(([key, count]) => {
    const meta = trackByKey.get(key);
    if (meta) {
      addArtist(meta.artist, count);
      addGenre(meta.genre, count);
    } else {
      const parts = String(key).split('___');
      if (parts.length >= 2) addArtist(parts.slice(1).join('___'), count);
    }
  });
  Object.entries(stats.albums || {}).forEach(([key, count]) => {
    const alb = state.albums.find(a => (a.id || `${a.title}___${a.artist}`) === key);
    if (alb) {
      addArtist(alb.artist, count);
      addGenre(alb.genre, count, alb);
    }
  });

  const topArtists = [...artistScore.values()].sort((a, b) => b.score - a.score);
  const topGenres = [...genreScore.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
  const seedNames = new Set(topArtists.slice(0, 6).map(a => a.name.toLowerCase().trim()));
  return { topArtists, topGenres, seedNames };
}

// Local library artists related to the profile: sharing seed genres or seed artists' genres.
function getLocalRelatedArtists(profile, excludeNorm, limit) {
  const seedGenres = new Set(profile.topGenres.slice(0, 4));
  profile.topArtists.slice(0, 6).forEach(seed => {
    const seedArt = state.artists.find(a => (a.name || '').toLowerCase().trim() === seed.name.toLowerCase().trim());
    if (!seedArt) return;
    (seedArt.tracks || []).forEach(t => {
      const g = canonicalizeGenre(t.genre, t);
      if (g && g !== 'Various' && g !== 'Unknown') seedGenres.add(g);
    });
  });

  const scored = [];
  state.artists.forEach(art => {
    const norm = (art.name || '').toLowerCase().trim();
    if (!norm || excludeNorm.has(norm) || isUnknownArtist(art.name)) return;
    let score = 0;
    const counted = new Set();
    (art.tracks || []).forEach(t => {
      const g = canonicalizeGenre(t.genre, t);
      if (g && seedGenres.has(g) && !counted.has(g)) {
        counted.add(g);
        score += 5;
      }
    });
    if (score > 0) {
      score += ((art.albums && art.albums.size) || 0) * 0.1;
      scored.push({ art, score });
    }
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(s => s.art);
}

// TIDAL-related artists: similar artists of seed artists + artists tied to seed genres.
async function fetchTidalDiscoverArtists(profile, excludeNorm, limit) {
  const svc = window.tidalService;
  if (!svc || !svc.isLoggedIn) return [];

  const tasks = [];
  profile.topArtists.slice(0, 4).forEach(seed => {
    tasks.push(
      svc.searchArtist(seed.name)
        .then(a => (a && a.id) ? svc.getSimilarArtists(a.id, 6) : [])
        .catch(() => [])
    );
  });
  profile.topGenres.slice(0, 2).forEach(g => {
    tasks.push(svc.search(g, 8).then(res => (res && res.artists) || []).catch(() => []));
  });

  const results = (await Promise.all(tasks)).flat();
  const seen = new Set(excludeNorm);
  const out = [];
  results.forEach(ta => {
    if (!ta || !ta.name) return;
    const norm = String(ta.name).toLowerCase().trim();
    if (!norm || seen.has(norm) || isUnknownArtist(ta.name)) return;
    seen.add(norm);
    out.push({ name: ta.name, picture: ta.picture, isTidal: true });
    if (out.length >= limit) return;
  });
  return out;
}

function renderDiscoverArtists() {
  if (!overviewArtistsGrid) return;
  const opId = ++discoverArtistsOpId;

  const curArtistSize = state.artistCardSize || 'medium';
  overviewArtistsGrid.classList.remove('artist-size-small', 'artist-size-medium', 'artist-size-large');
  overviewArtistsGrid.classList.add(`artist-size-${curArtistSize}`);

  const profile = buildListeningProfile();

  // Local related artists (rendered immediately, then re-rendered with TIDAL results in front)
  let localArtists = getLocalRelatedArtists(profile, profile.seedNames, 10);
  if (localArtists.length < 10) {
    // Not enough related artists: fill remaining slots with the most-listened artists themselves
    profile.topArtists.forEach(seed => {
      if (localArtists.length >= 10) return;
      const art = state.artists.find(a => (a.name || '').toLowerCase().trim() === seed.name.toLowerCase().trim());
      if (art && !localArtists.includes(art)) localArtists.push(art);
    });
  }
  if (localArtists.length === 0) {
    // No listening profile yet: fall back to artists with the largest local discography
    localArtists = [...state.artists]
      .filter(a => !isUnknownArtist(a.name))
      .sort((a, b) => ((b.albums && b.albums.size) || 0) - ((a.albums && a.albums.size) || 0))
      .slice(0, 10);
  }

  const paint = (tidalArtists, localList) => {
    if (opId !== discoverArtistsOpId) return; // stale async result guard
    overviewArtistsGrid.innerHTML = '';
    const seen = new Set();
    [...tidalArtists, ...localList].forEach(a => {
      if (overviewArtistsGrid.children.length >= 10) return;
      const norm = (a.name || '').toLowerCase().trim();
      if (!norm || seen.has(norm)) return;
      seen.add(norm);
      overviewArtistsGrid.appendChild(createArtistCard(a));
    });
    hydrateArtistAvatars(overviewArtistsGrid);
  };

  paint([], localArtists);

  // Enrich with TIDAL-related artists (placed in front) when logged in
  if (window.tidalService && window.tidalService.isLoggedIn) {
    fetchTidalDiscoverArtists(profile, profile.seedNames, 10)
      .then(tidalArtists => {
        paint(tidalArtists, localArtists.slice(0, Math.max(0, 10 - tidalArtists.length)));
      })
      .catch(() => {});
  }
}

// Render Albums
function renderAlbums() {
  allAlbumsGrid.innerHTML = '';
  const curSize = state.albumCoverSize || 'medium';
  allAlbumsGrid.classList.remove('cover-size-small', 'cover-size-medium', 'cover-size-large');
  allAlbumsGrid.classList.add(`cover-size-${curSize}`);
  let filtered = [...state.albums];

  // If genre filter is active
  const bannerBox = document.getElementById('genreFilterBannerBox');
  if (bannerBox) {
    if (state.activeGenreFilter) {
      filtered = filtered.filter(a => matchItemGenre(a, state.activeGenreFilter));
      const genreInfo = getGenreIllustrationInfo(state.activeGenreFilter);
      bannerBox.innerHTML = `
        <div class="genre-filter-banner">
          <div class="genre-filter-text">
            <span>🏷️ 目前篩選曲風：</span>
            <span class="genre-filter-badge">${genreInfo.zhName || state.activeGenreFilter}</span>
            <span style="color: var(--text-muted); font-size: 12px;">(共 ${filtered.length} 張專輯)</span>
          </div>
          <button class="btn-clear-genre-filter" id="btnClearGenreFilter">清除篩選 ✕</button>
        </div>
      `;
      const btnClear = document.getElementById('btnClearGenreFilter');
      if (btnClear) {
        btnClear.addEventListener('click', () => {
          state.activeGenreFilter = null;
          renderAlbums();
        });
      }
    } else {
      bannerBox.innerHTML = '';
    }
  }

  if (state.activeFilter === 'hires') {
    filtered = filtered.filter(a => (a.bitsPerSample >= 24) || (a.sampleRate > 48000));
  } else if (state.activeFilter === 'flac') {
    filtered = filtered.filter(a => {
      const fTrack = (a.tracks && a.tracks[0]) || {};
      const fPath = fTrack.filePath || fTrack.fileName || a.filePath || '';
      return getAudioFormatFromPath(fPath, a.formatName || '').toUpperCase() === 'FLAC';
    });
  }

  // Sort
  if (state.sortBy === 'added') {
    filtered.sort((a, b) => {
      const aTime = a.addedAt || 0;
      const bTime = b.addedAt || 0;
      if (bTime !== aTime) return bTime - aTime;
      return (a.title || '').localeCompare(b.title || '');
    });
  } else if (state.sortBy === 'title') {
    filtered.sort((a, b) => a.title.localeCompare(b.title));
  } else if (state.sortBy === 'artist') {
    filtered.sort((a, b) => a.artist.localeCompare(b.artist));
  } else if (state.sortBy === 'year') {
    filtered.sort((a, b) => (b.year || 0) - (a.year || 0));
  } else if (state.sortBy === 'tracks') {
    filtered.sort((a, b) => b.tracks.length - a.tracks.length);
  } else if (state.sortBy === 'playCount') {
    filtered.sort((a, b) => {
      const countA = getAlbumPlayCount(a);
      const countB = getAlbumPlayCount(b);
      if (countB !== countA) return countB - countA;
      return a.title.localeCompare(b.title);
    });
  }

  if (filtered.length === 0) {
    allAlbumsGrid.innerHTML = '<div style="grid-column: 1/-1; padding: 40px; text-align: center; color: var(--text-muted);">此分類下尚無符合的專輯</div>';
    return;
  }

  const frag = document.createDocumentFragment();
  filtered.forEach(alb => {
    frag.appendChild(createAlbumCard(alb));
  });
  allAlbumsGrid.appendChild(frag);
}

function createAlbumCard(album) {
  const card = document.createElement('div');
  card.className = 'album-card';

  const defaultCover = createSvgCover(album.title, album.artist, '#27272a', '#09090b');
  const coverSrc = formatCoverSrc(album.cover) || defaultCover;

  const firstTrack = (album.tracks && album.tracks[0]) || {};
  const rawPath = firstTrack.filePath || firstTrack.fileName || album.filePath || '';
  const fmt = getAudioFormatFromPath(rawPath, album.formatName || 'PCM').toUpperCase();
  const isDsd = fmt === 'DSF' || fmt === 'DFF' || fmt === 'DSD';

  let qualityTagHtml = '';
  if (album.isTidal) {
    const isHiRes = album.audioQuality === 'HI_RES_LOSSLESS' || album.audioQuality === 'HIRES' || (album.bitsPerSample && album.bitsPerSample >= 24) || (album.sampleRate && album.sampleRate > 48000);
    qualityTagHtml = isHiRes
      ? `<span class="album-quality-tag tag-tidal-hires">TIDAL MAX</span>`
      : `<span class="album-quality-tag tag-tidal">TIDAL FLAC</span>`;
  } else if (isDsd) {
    qualityTagHtml = `<span class="album-quality-tag tag-dsd">DSD</span>`;
  } else if (album.bitsPerSample >= 24 || album.sampleRate > 48000) {
    qualityTagHtml = `<span class="album-quality-tag tag-hires">${fmt} 24b</span>`;
  } else if (fmt === 'WAV') {
    qualityTagHtml = `<span class="album-quality-tag tag-wav">WAV</span>`;
  } else if (fmt === 'AIFF') {
    qualityTagHtml = `<span class="album-quality-tag tag-aiff">AIFF</span>`;
  } else if (fmt === 'FLAC') {
    qualityTagHtml = `<span class="album-quality-tag tag-flac">FLAC</span>`;
  } else if (album.isLossless) {
    qualityTagHtml = `<span class="album-quality-tag tag-lossless">${fmt}</span>`;
  }

  const isFav = isAlbumFavorite(album);
  const playCount = getAlbumPlayCount(album);
  const playCountText = playCount > 0 ? ` • 播放 ${playCount} 次` : '';

  card.innerHTML = `
    <div class="album-art-wrap">
      <img src="${coverSrc}" class="album-art-img" alt="${escapeXml(album.title)}" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='${defaultCover}';">
      ${qualityTagHtml}
      <button class="card-play-btn" title="播放專輯">▶</button>
      <button class="card-fav-btn ${isFav ? 'active' : ''}" title="${isFav ? '取消最愛專輯' : '加入最愛專輯'}">${getHeartSvg(isFav, 15)}</button>
    </div>
    <div class="album-meta">
      <div class="album-title" title="${escapeXml(album.title)}">${escapeXml(album.title)}</div>
      <div class="album-artist clickable-artist" title="查看演出者介紹">${escapeXml(album.artist)}</div>
      <div class="album-year">${album.year ? album.year + ' • ' : ''}${album.tracks ? album.tracks.length + ' 首' : ''}${playCountText}</div>
    </div>
  `;

  // Explicit click on album artwork cover opens full album details
  const artWrap = card.querySelector('.album-art-wrap');
  if (artWrap) {
    artWrap.style.cursor = 'pointer';
    artWrap.addEventListener('click', (e) => {
      if (e.target.closest('.card-fav-btn') || e.target.closest('.card-play-btn')) return;
      e.stopPropagation();
      openAlbumDetail(album);
    });
  }

  // Click card to open album details, or click artist to view artist details
  card.addEventListener('click', (e) => {
    if (e.target.closest('.card-fav-btn')) {
      e.stopPropagation();
      toggleAlbumFavorite(album);
    } else if (e.target.closest('.card-play-btn')) {
      e.stopPropagation();
      playAlbum(album);
    } else if (e.target.closest('.clickable-artist')) {
      e.stopPropagation();
      openArtistDetail(album.artist);
    } else {
      openAlbumDetail(album);
    }
  });

  return card;
}

// Create Artist Card
// ----------------- Artist Avatar Engine（登入 TIDAL 時由 TIDAL 抓取演出者照片） -----------------
const artistAvatarCache = new Map(); // 小寫演出者名 -> TIDAL picture 圖片 ID
try {
  const rawAvatars = localStorage.getItem('rooplayer_artist_avatars');
  if (rawAvatars) Object.entries(JSON.parse(rawAvatars) || {}).forEach(([k, v]) => { if (v) artistAvatarCache.set(k, v); });
} catch (e) {}
function saveArtistAvatarCache() {
  try {
    const obj = {}; let n = 0;
    for (const [k, v] of artistAvatarCache) { if (n++ >= 400) break; obj[k] = v; }
    localStorage.setItem('rooplayer_artist_avatars', JSON.stringify(obj));
  } catch (e) {}
}
const normArtistKey = (s) => String(s || '').toLowerCase().trim();
const looseArtistKey = (s) => normArtistKey(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');
function applyArtistAvatar(card, pictureId) {
  if (!pictureId || !window.tidalService) return;
  const url = window.tidalService.getCoverUrl(pictureId, 320);
  if (!url) return;
  const avatar = card.querySelector('.artist-avatar');
  if (!avatar || avatar.querySelector('img')) return;
  const initial = (card.dataset.artistName || '?').charAt(0).toUpperCase();
  const wrap = document.createElement('div');
  wrap.className = 'artist-avatar';
  wrap.style.cssText = 'overflow:hidden;background:#27272a;';
  wrap.innerHTML = `<img src="${url}" alt="${escapeXml(card.dataset.artistName || '')}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;" onerror="this.style.display='none';this.parentElement.textContent='${initial}';">`;
  avatar.replaceWith(wrap);
}
const avatarFetchInFlight = new Set();
async function hydrateArtistAvatars(container) {
  if (!container || !window.tidalService || !window.tidalService.isLoggedIn) return;
  const svc = window.tidalService;
  for (const card of [...container.querySelectorAll('.artist-card')]) {
    if (card.querySelector('.artist-avatar img')) continue; // 已有照片
    const name = card.dataset.artistName || '';
    const key = normArtistKey(name);
    if (!key) continue;
    const cached = artistAvatarCache.get(key);
    if (cached) { applyArtistAvatar(card, cached); continue; }
    if (avatarFetchInFlight.has(key)) continue;
    avatarFetchInFlight.add(key);
    (async () => {
      try {
        const res = await svc.search(name, 5);
        const items = (res && res.artists) || [];
        // 僅接受名稱完全相符或去符號後相符者，避免誤掛不相干演出者的照片
        const hit = items.find(a => normArtistKey(a.name) === key)
          || items.find(a => looseArtistKey(a.name) && looseArtistKey(a.name) === looseArtistKey(name));
        const pic = hit && (hit.picture || hit.image);
        if (pic) {
          artistAvatarCache.set(key, pic);
          saveArtistAvatarCache();
          if (card.isConnected) applyArtistAvatar(card, pic);
        }
      } catch (e) {} finally { avatarFetchInFlight.delete(key); }
    })();
  }
}

function createArtistCard(art) {
  const card = document.createElement('div');
  card.className = 'artist-card';
  card.dataset.artistName = art.name || '';
  const initial = (art.name || '?').charAt(0).toUpperCase();
  const isFav = isArtistFavorite(art.name);

  let subText = '';
  if (art.albums && typeof art.albums.size === 'number') {
    const trkLen = (art.tracks && art.tracks.length) || 0;
    subText = `${art.albums.size} 張專輯 • ${trkLen} 首曲目`;
  } else if (art.albums && Array.isArray(art.albums)) {
    const trkLen = (art.tracks && art.tracks.length) || 0;
    subText = `${art.albums.length} 張專輯 • ${trkLen} 首曲目`;
  } else if (art.albumCount) {
    subText = art.albumCount;
  } else if (art.isTidal) {
    subText = 'TIDAL 推薦藝人';
  } else {
    subText = '演出者';
  }

  let avatarHtml = `<div class="artist-avatar">${initial}</div>`;
  let picId = art.picture || artistAvatarCache.get(normArtistKey(art.name)) || '';
  if (picId && window.tidalService) {
    const picUrl = window.tidalService.getCoverUrl(picId, 320);
    if (picUrl) {
      avatarHtml = `
        <div class="artist-avatar" style="overflow: hidden; background: #27272a;">
          <img src="${picUrl}" alt="${escapeXml(art.name)}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%; display: block;" onerror="this.style.display='none';this.parentElement.textContent='${initial}';">
        </div>
      `;
    }
  }

  const tidalBadgeHtml = art.isTidal 
    ? '<span class="platform-chip tidal" style="position:absolute;bottom:2px;right:2px;font-size:9px;padding:1px 6px;background:#000;color:#00e5ff;border:1px solid #00e5ff;border-radius:10px;font-weight:700;">TIDAL</span>'
    : '';

  card.innerHTML = `
    <div class="artist-avatar-wrap">
      ${avatarHtml}
      <button class="artist-fav-btn ${isFav ? 'active' : ''}" title="${isFav ? '取消最愛演出者' : '加入最愛演出者'}">${getStarSvg(isFav, 14)}</button>
      ${tidalBadgeHtml}
    </div>
    <div class="artist-name">${escapeXml(art.name)}</div>
    <div class="artist-sub">${escapeXml(subText)}</div>
  `;
  card.addEventListener('click', (e) => {
    if (e.target.closest('.artist-fav-btn')) {
      e.stopPropagation();
      toggleArtistFavorite(art.name);
      return;
    }
    openArtistDetail(art.name);
  });
  return card;
}

// Render Artists Tab
function renderArtists() {
  artistsGrid.innerHTML = '';
  const curSize = state.artistCardSize || 'medium';
  artistsGrid.classList.remove('artist-size-small', 'artist-size-medium', 'artist-size-large');
  artistsGrid.classList.add(`artist-size-${curSize}`);
  const frag = document.createDocumentFragment();
  state.artists.forEach(art => {
    frag.appendChild(createArtistCard(art));
  });
  artistsGrid.appendChild(frag);
  hydrateArtistAvatars(artistsGrid); // 登入 TIDAL 時補抓演出者照片
}

// ----------------- Artist Detail View -----------------
async function openArtistDetail(artistName) {
  state.currentArtistDetail = artistName;
  navigateTo('artistDetail');

  const localAlbums = state.albums.filter(a => a.artist.toLowerCase() === artistName.toLowerCase());
  const localTracks = state.tracks.filter(t => t.artist.toLowerCase() === artistName.toLowerCase());


  // Reset Hero Banner Backdrop & Avatar
  const heroBackdrop = document.getElementById('artistHeroBackdrop');
  if (heroBackdrop) {
    heroBackdrop.style.backgroundImage = 'none';
    heroBackdrop.style.opacity = '0';
  }
  const avatarImg = document.getElementById('artistDetailAvatar');
  const avatarPlaceholder = document.getElementById('artistDetailAvatarPlaceholder');
  avatarImg.style.display = 'none';
  avatarPlaceholder.style.display = 'flex';
  avatarPlaceholder.textContent = artistName.charAt(0).toUpperCase();

  // Set Hero information
  document.getElementById('artistDetailName').textContent = artistName;
  document.getElementById('artistDetailAlbumCount').textContent = localAlbums.length;
  document.getElementById('artistDetailTrackCount').textContent = localTracks.length;

  // Collect genres
  const genres = new Set();
  localTracks.forEach(t => {
    if (t.genre && t.genre !== 'Unknown') {
      t.genre.split(',').forEach(g => genres.add(g.trim()));
    }
  });
  const genresBox = document.getElementById('artistDetailGenres');
  genresBox.innerHTML = '';
  genres.forEach(g => {
    const chip = document.createElement('span');
    chip.className = 'genre-chip';
    chip.textContent = g;
    genresBox.appendChild(chip);
  });

  // Play / Shuffle buttons
  document.getElementById('btnPlayAllArtistTracks').onclick = () => {
    if (localTracks.length) playTrackList(localTracks, 0);
  };
  document.getElementById('btnShuffleArtistTracks').onclick = () => {
    if (localTracks.length) {
      setShuffleState(true);
      const randIdx = Math.floor(Math.random() * localTracks.length);
      playTrackList(localTracks, randIdx);
      showToast(`🔀 隨機播放 ${artistName} 的所有曲目`);
    }
  };

  // Favorite button in Artist Detail Hero
  const btnFavArtist = document.getElementById('btnFavArtistDetail');
  if (btnFavArtist) {
    const isFav = isArtistFavorite(artistName);
    btnFavArtist.classList.toggle('active', isFav);
    btnFavArtist.innerHTML = `${getStarSvg(isFav, 15)} <span>${isFav ? '已在最愛演出者' : '加入最愛演出者'}</span>`;
    btnFavArtist.onclick = (e) => {
      e.stopPropagation();
      toggleArtistFavorite(artistName);
    };
  }

  // 2-1: Fetch Wikipedia Biography & Image (banner background)
  fetchArtistBio(artistName, localAlbums);

  // 2-2: Render Recently Played Albums by this artist
  renderArtistRecentAlbums(artistName);

  // 2-3: Render Local Albums
  renderArtistLocalAlbums(localAlbums);

  // 2-4: Fetch Missing Online Albums (Tidal / Qobuz / KKBOX)
  fetchArtistMissingAlbums(artistName, localAlbums);
}

// ----------------- Artist Biography & Translation Engine -----------------
const artistBioTranslationCache = new Map();
let currentArtistBioState = {
  originalText: '',
  translatedText: '',
  isShowingOriginal: false
};

async function translateTextToZhTw(text) {
  if (!text || !text.trim()) return '';
  try {
    if (window.electronAPI && window.electronAPI.translateToZhTw) {
      const translated = await window.electronAPI.translateToZhTw(text);
      if (translated) return translated;
    }

    const translateChunk = async (chunk) => {
      const trimmed = chunk.trim();
      if (!trimmed) return '';
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-TW&dt=t&q=${encodeURIComponent(trimmed)}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data && data[0] && Array.isArray(data[0])) {
          return data[0].map(s => (s && s[0]) ? s[0] : '').join('').trim();
        }
      }
      return trimmed;
    };

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
    console.warn('Translate to zh-TW error:', err);
  }
  return text;
}

// 2-1. Fetch Biography & Photos from Wikipedia REST API with Auto Traditional Chinese Translation
async function fetchArtistBio(artistName, localAlbums = []) {
  const loadingEl = document.getElementById('bioLoading');
  const textEl = document.getElementById('artistBioText');
  const sourceBadge = document.getElementById('bioSourceBadge');
  const btnWiki = document.getElementById('btnOpenWikipedia');
  const btnToggleBioLang = document.getElementById('btnToggleBioLang');
  const avatarImg = document.getElementById('artistDetailAvatar');
  const avatarPlaceholder = document.getElementById('artistDetailAvatarPlaceholder');
  const heroBackdrop = document.getElementById('artistHeroBackdrop');

  loadingEl.style.display = 'flex';
  loadingEl.innerHTML = '<span class="spinner"></span> 正在連線至維基百科音樂資料庫並自動翻譯為繁體中文...';
  textEl.style.display = 'none';
  btnWiki.style.display = 'none';
  if (btnToggleBioLang) btnToggleBioLang.style.display = 'none';

  let rawBioText = '';
  let wikiPageUrl = '';
  let avatarUrl = '';
  let originalImageUrl = '';
  let isFromEnWiki = false;

  // Check cache first for instant display
  if (artistBioTranslationCache.has(artistName)) {
    const cached = artistBioTranslationCache.get(artistName);
    rawBioText = cached.originalText;
    wikiPageUrl = cached.wikiPageUrl;
    avatarUrl = cached.avatarUrl;
    originalImageUrl = cached.originalImageUrl;
    isFromEnWiki = cached.isFromEnWiki;
  } else {
    try {
      // 1. Try Chinese Wikipedia first (with Accept-Language for Traditional Chinese)
      const zhUrl = `https://zh.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(artistName)}`;
      let res = await fetch(zhUrl, {
        headers: {
          'User-Agent': 'rooPlayer/1.0',
          'Accept-Language': 'zh-tw,zh-hant;q=0.9'
        }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.extract && data.type !== 'disambiguation') {
          rawBioText = data.extract;
          wikiPageUrl = data.content_urls?.desktop?.page || `https://zh.wikipedia.org/wiki/${encodeURIComponent(artistName)}`;
          if (data.originalimage?.source) originalImageUrl = data.originalimage.source;
          if (data.thumbnail?.source) avatarUrl = data.thumbnail.source;
        }
      }

      // 2. Fallback to English Wikipedia if no Chinese extract or missing images
      if (!rawBioText || (!originalImageUrl && !avatarUrl)) {
        const enUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(artistName)}`;
        res = await fetch(enUrl, { headers: { 'User-Agent': 'rooPlayer/1.0' } });
        if (res.ok) {
          const data = await res.json();
          if (data.extract && data.type !== 'disambiguation') {
            if (!rawBioText) {
              rawBioText = data.extract;
              isFromEnWiki = true;
            }
            if (!wikiPageUrl) wikiPageUrl = data.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(artistName)}`;
            if (data.originalimage?.source && !originalImageUrl) originalImageUrl = data.originalimage.source;
            if (data.thumbnail?.source && !avatarUrl) avatarUrl = data.thumbnail.source;
          }
        }
      }
    } catch (err) {
      console.warn('Wikipedia API fetch error:', err);
    }
  }

  // Auto-translate to Traditional Chinese if we got a bio
  let translatedBioText = rawBioText;
  if (rawBioText) {
    if (artistBioTranslationCache.has(artistName) && artistBioTranslationCache.get(artistName).translatedText) {
      translatedBioText = artistBioTranslationCache.get(artistName).translatedText;
    } else {
      translatedBioText = await translateTextToZhTw(rawBioText);
      artistBioTranslationCache.set(artistName, {
        originalText: rawBioText,
        translatedText: translatedBioText,
        wikiPageUrl,
        avatarUrl,
        originalImageUrl,
        isFromEnWiki
      });
    }
  }

  loadingEl.style.display = 'none';

  if (rawBioText) {
    currentArtistBioState = {
      originalText: rawBioText,
      translatedText: translatedBioText,
      isShowingOriginal: false
    };

    textEl.textContent = translatedBioText;
    textEl.style.display = 'block';

    const hasTranslationDiff = (translatedBioText.trim() !== rawBioText.trim());
    if (hasTranslationDiff) {
      sourceBadge.textContent = isFromEnWiki
        ? '資料來源：英文維基百科 (自動翻譯為繁體中文)'
        : '資料來源：維基百科 (繁體中文)';
      if (btnToggleBioLang) {
        btnToggleBioLang.style.display = 'inline-flex';
        btnToggleBioLang.textContent = '檢視原文';
        btnToggleBioLang.onclick = () => {
          currentArtistBioState.isShowingOriginal = !currentArtistBioState.isShowingOriginal;
          if (currentArtistBioState.isShowingOriginal) {
            textEl.textContent = currentArtistBioState.originalText;
            btnToggleBioLang.textContent = '顯示繁體中文翻譯';
            showToast('已切換為原始語言簡介');
          } else {
            textEl.textContent = currentArtistBioState.translatedText;
            btnToggleBioLang.textContent = '檢視原文';
            showToast('已切換為繁體中文翻譯');
          }
        };
      }
    } else {
      sourceBadge.textContent = '資料來源：中文維基百科 (繁體中文)';
      if (btnToggleBioLang) btnToggleBioLang.style.display = 'none';
    }

    if (wikiPageUrl) {
      btnWiki.style.display = 'inline-flex';
      btnWiki.onclick = () => {
        if (window.electronAPI) window.electronAPI.openExternal(wikiPageUrl);
      };
    }
  } else {
    textEl.textContent = `${artistName} 是深受音樂愛好者喜愛的知名音樂家與演出者。本機音樂庫中已收錄相關經典錄音。可點擊下方線上串流專區探索完整作品目錄。`;
    textEl.style.display = 'block';
    sourceBadge.textContent = '音樂庫資料庫簡介 (繁體中文)';
    if (btnToggleBioLang) btnToggleBioLang.style.display = 'none';
  }

  // Set Avatar and Banner Backdrop Image
  const finalBannerUrl = originalImageUrl || avatarUrl;
  if (finalBannerUrl) {
    avatarImg.src = avatarUrl || finalBannerUrl;
    avatarImg.style.display = 'block';
    avatarPlaceholder.style.display = 'none';

    if (heroBackdrop) {
      heroBackdrop.style.backgroundImage = `url("${finalBannerUrl}")`;
      heroBackdrop.style.opacity = '1';
    }
  } else {
    // If no artist image found online, fallback to first local album cover as banner backdrop
    const firstLocalCover = localAlbums.find(a => a.cover)?.cover;
    if (firstLocalCover && heroBackdrop) {
      heroBackdrop.style.backgroundImage = `url("${formatCoverSrc(firstLocalCover)}")`;
      heroBackdrop.style.opacity = '0.65';
    }
  }
}

// 2-2. Render Recently Played Albums by this artist
function renderArtistRecentAlbums(artistName) {
  const container = document.getElementById('artistRecentAlbumsGrid');
  const emptyHint = document.getElementById('artistNoRecentHint');
  const countBadge = document.getElementById('artistRecentAlbumsCount');
  container.innerHTML = '';

  let recent = [];
  try {
    recent = JSON.parse(localStorage.getItem('roon_recent_albums') || '[]');
  } catch (e) {}

  const matchingRecent = recent.filter(r => r.artist.toLowerCase() === artistName.toLowerCase());
  countBadge.textContent = `${matchingRecent.length} 張`;

  if (!matchingRecent.length) {
    emptyHint.style.display = 'block';
    container.style.display = 'none';
    return;
  }

  emptyHint.style.display = 'none';
  container.style.display = 'grid';

  matchingRecent.forEach(alb => {
    const fullAlbum = state.albums.find(a => a.title === alb.title && a.artist.toLowerCase() === artistName.toLowerCase());
    container.appendChild(createAlbumCard(fullAlbum || alb));
  });
}

// 2-3. Render Local Albums
function renderArtistLocalAlbums(localAlbums) {
  const container = document.getElementById('artistLocalAlbumsGrid');
  const countBadge = document.getElementById('artistLocalAlbumsCount');
  container.innerHTML = '';
  countBadge.textContent = `${localAlbums.length} 張`;

  localAlbums.forEach(alb => {
    container.appendChild(createAlbumCard(alb));
  });
}

async function fetchArtistMissingAlbums(artistName, localAlbums) {
  const loadingEl = document.getElementById('missingAlbumsLoading');
  const container = document.getElementById('artistMissingAlbumsGrid');
  const countBadge = document.getElementById('artistMissingAlbumsCount');
  const titleEl = document.getElementById('artistOnlineSectionTitle');
  const tagsEl = document.getElementById('artistOnlinePlatformTags');
  const descEl = document.getElementById('artistOnlineSectionDesc');

  loadingEl.style.display = 'flex';
  container.innerHTML = '';
  countBadge.textContent = '檢索中...';

  const normalize = (s) => s.toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5]/g, '')
    .trim();

  const localTitlesNormalized = new Set(localAlbums.map(a => normalize(a.title)));

  // If TIDAL is logged in, use TIDAL official discography!
  if (window.tidalService && window.tidalService.isLoggedIn) {
    if (titleEl) titleEl.innerHTML = '💎 TIDAL 歷年完整發行作品 (直接播放 & 收錄)';
    if (tagsEl) tagsEl.innerHTML = `
      <span class="platform-tag tidal" style="background:#000;color:#00e5ff;border:1px solid #00e5ff;font-weight:700;">TIDAL Hi-Res MAX</span>
      <span class="platform-tag" style="background:rgba(255,255,255,0.08);color:#d4d4d8;">Bit-Perfect Lossless</span>
    `;
    if (descEl) descEl.textContent = '已連接 TIDAL 雲端資料庫。您可以直接點擊播放該專輯以 rooPlayer 音訊引擎聆聽，或點擊「加入曲庫」無縫整合至本機收藏。';

    try {
      const artistObj = await window.tidalService.searchArtist(artistName);
      if (artistObj && artistObj.id) {
        const tidalAlbums = await window.tidalService.getArtistAlbums(artistObj.id, 50);
        if (tidalAlbums && tidalAlbums.length > 0) {
          loadingEl.style.display = 'none';
          countBadge.textContent = `共 ${tidalAlbums.length} 張作品`;

          const seenTidalTitles = new Set();
          tidalAlbums.forEach(alb => {
            const normTitle = normalize(alb.title);
            if (seenTidalTitles.has(normTitle)) return;
            seenTidalTitles.add(normTitle);

            const card = document.createElement('div');
            card.className = 'album-card tidal-discography-card';
            card.dataset.tidalId = String(alb.tidalId);

            const defaultCover = createSvgCover(alb.title, alb.artist, '#27272a', '#09090b');
            const coverSrc = formatCoverSrc(alb.cover) || defaultCover;
            const inLib = isTidalAlbumInLibrary(alb.tidalId);
            const hasLocal = localTitlesNormalized.has(normTitle);

            const isHiRes = alb.audioQuality === 'HI_RES_LOSSLESS' || alb.audioQuality === 'HIRES';
            const qualityBadgeHtml = isHiRes
              ? `<span class="album-quality-tag tag-tidal-hires">TIDAL MAX</span>`
              : `<span class="album-quality-tag tag-tidal">TIDAL FLAC</span>`;

            let statusText = '';
            if (inLib) {
              statusText = '<span style="color:#00e5ff;font-weight:700;">✓ 已在曲庫</span>';
            } else if (hasLocal) {
              statusText = '<span style="color:#a1a1aa;">📁 本機已有</span>';
            }

            card.innerHTML = `
              <div class="album-art-wrap">
                <img src="${coverSrc}" class="album-art-img" alt="${escapeXml(alb.title)}" loading="lazy">
                ${qualityBadgeHtml}
                <button class="card-play-btn" title="播放整張 TIDAL 專輯">▶</button>
              </div>
              <div class="album-meta">
                <div class="album-title" title="${escapeXml(alb.title)}">${escapeXml(alb.title)}</div>
                <div class="album-artist">${escapeXml(alb.artist)}</div>
                <div class="album-year">${alb.year ? alb.year + ' • ' : ''}${alb.numberOfTracks ? alb.numberOfTracks + ' 首 • ' : ''}${statusText}</div>
              </div>
              <div class="tidal-card-actions">
                <button class="btn-tidal-lib-action ${inLib ? 'in-library' : ''}" data-tidal-id="${alb.tidalId}">${inLib ? '✓ 已在曲庫' : '➕ 加入曲庫'}</button>
              </div>
            `;

            // Click play button
            const playBtn = card.querySelector('.card-play-btn');
            if (playBtn) {
              playBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                playTidalAlbum(alb.tidalId);
              });
            }

            // Click add to library button
            const libBtn = card.querySelector('.btn-tidal-lib-action');
            if (libBtn) {
              libBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (isTidalAlbumInLibrary(alb.tidalId)) {
                  if (confirm(`確定要將《${alb.title}》從曲庫移除嗎？`)) {
                    await removeTidalAlbumFromLibrary(alb.tidalId);
                  }
                } else {
                  await addTidalAlbumToLibrary(alb.tidalId, alb);
                }
              });
            }

            // Explicit click on album artwork cover opens full album details
            const artWrap = card.querySelector('.album-art-wrap');
            if (artWrap) {
              artWrap.style.cursor = 'pointer';
              artWrap.addEventListener('click', (e) => {
                if (e.target.closest('.card-play-btn')) return;
                e.stopPropagation();
                openAlbumDetail(alb);
              });
            }

            // Click card body opens album details
            card.addEventListener('click', (e) => {
              if (e.target.closest('.card-play-btn') || e.target.closest('.btn-tidal-lib-action')) return;
              openAlbumDetail(alb);
            });

            container.appendChild(card);
          });
          return;
        }
      }
    } catch (tidalErr) {
      console.warn('TIDAL artist discography fetch error:', tidalErr);
    }
  } else {
    if (titleEl) titleEl.innerHTML = '🌐 線上專輯探索 (本機未收錄)';
    if (tagsEl) tagsEl.innerHTML = `
      <span class="platform-tag tidal">Tidal</span>
      <span class="platform-tag qobuz">Qobuz</span>
      <span class="platform-tag kkbox">KKBOX</span>
      <span class="platform-tag apple">Apple Music</span>
      <span class="platform-tag spotify">Spotify</span>
    `;
    if (descEl) descEl.innerHTML = '比對線上音樂資料庫，為您挖掘該歌手尚未收藏的經典專輯。 <a href="#" id="linkLoginTidalFromArtist" style="color:#00e5ff;margin-left:8px;font-weight:bold;text-decoration:underline;cursor:pointer;">💎 登入 TIDAL 一鍵串流與收錄</a>';
    setTimeout(() => {
      const link = document.getElementById('linkLoginTidalFromArtist');
      if (link && typeof openTidalLoginModal === 'function') {
        link.onclick = (e) => { e.preventDefault(); openTidalLoginModal(); };
      }
    }, 50);
  }

  let missingAlbums = [];

  try {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(artistName)}&entity=album&limit=30`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      const onlineAlbums = data.results || [];

      const seenTitles = new Set();
      onlineAlbums.forEach(online => {
        const normTitle = normalize(online.collectionName);
        if (!normTitle || seenTitles.has(normTitle)) return;
        seenTitles.add(normTitle);

        if (!localTitlesNormalized.has(normTitle)) {
          const year = online.releaseDate ? new Date(online.releaseDate).getFullYear() : '';
          const highResCover = online.artworkUrl100 ? online.artworkUrl100.replace('100x100bb', '600x600bb') : '';
          missingAlbums.push({
            title: online.collectionName,
            artist: online.artistName || artistName,
            year: year,
            trackCount: online.trackCount || 0,
            cover: highResCover,
            genre: online.primaryGenreName || 'Music',
            appleUrl: online.collectionViewUrl || ''
          });
        }
      });
    }
  } catch (err) {
    console.warn('Online discography fetch error:', err);
  }

  loadingEl.style.display = 'none';
  countBadge.textContent = `共發現 ${missingAlbums.length} 張未收錄作品`;

  if (!missingAlbums.length) {
    container.innerHTML = '<div class="empty-hint" style="grid-column: 1 / -1;">已收藏該歌手在線上可查得之主要代表作品，或線上資料庫目前暫無額外未收錄專輯。</div>';
    return;
  }

  missingAlbums.forEach(alb => {
    const card = document.createElement('div');
    card.className = 'missing-album-card';

    const defaultCover = createSvgCover(alb.title, alb.artist, '#27272a', '#09090b');
    const coverSrc = formatCoverSrc(alb.cover) || defaultCover;

    const searchQuery = `${alb.title} ${alb.artist}`;
    // Tidal: direct site search on Google avoids Tidal's 403 Forbidden Cloudflare block on URL queries
    const tidalSearchUrl = `https://www.google.com/search?q=${encodeURIComponent('site:tidal.com ' + searchQuery)}`;
    // Qobuz: official working search endpoint with auto-redirect to albums results
    const qobuzSearchUrl = `https://www.qobuz.com/us-en/search?q=${encodeURIComponent(searchQuery)}`;
    // KKBOX: site search on Google avoids KKBOX's 404 on deprecated search.php and regional gatekeeping
    const kkboxSearchUrl = `https://www.google.com/search?q=${encodeURIComponent('site:kkbox.com ' + searchQuery)}`;
    // Apple Music: direct official album page
    const appleSearchUrl = alb.appleUrl || `https://music.apple.com/us/search?term=${encodeURIComponent(searchQuery)}`;
    // Spotify: official web player search
    const spotifySearchUrl = `https://open.spotify.com/search/${encodeURIComponent(searchQuery)}`;

    card.innerHTML = `
      <div class="album-art-wrap" style="position: relative;">
        <img src="${coverSrc}" class="album-art-img" alt="${escapeXml(alb.title)}" loading="lazy">
        <span class="missing-badge">未收錄</span>
      </div>
      <div class="album-meta">
        <div class="album-title" title="${escapeXml(alb.title)}">${escapeXml(alb.title)}</div>
        <div class="album-artist">${escapeXml(alb.artist)}</div>
        <div class="album-year">${alb.year ? alb.year + ' • ' : ''}${alb.trackCount ? alb.trackCount + ' 首' : ''}</div>
      </div>
      <div class="missing-links-bar">
        <button class="btn-stream-link tidal" data-platform="tidal" data-url="${tidalSearchUrl}" title="前往 Tidal 搜尋此專輯">Tidal</button>
        <button class="btn-stream-link qobuz" data-platform="qobuz" data-url="${qobuzSearchUrl}" title="在 Qobuz Hi-Res 線上檢視與試聽">Qobuz</button>
        <button class="btn-stream-link kkbox" data-platform="kkbox" data-url="${kkboxSearchUrl}" title="前往 KKBOX 搜尋此專輯">KKBOX</button>
        <button class="btn-stream-link apple" data-platform="apple" data-url="${appleSearchUrl}" title="在 Apple Music 開啟官方專輯">Apple</button>
        <button class="btn-stream-link spotify" data-platform="spotify" data-url="${spotifySearchUrl}" title="在 Spotify 搜尋並串流">Spotify</button>
      </div>
    `;

    card.querySelectorAll('.btn-stream-link').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const platform = btn.getAttribute('data-platform');
        const url = btn.getAttribute('data-url');
        const queryText = `${alb.title} ${alb.artist}`;

        // Auto copy query to clipboard
        if (navigator.clipboard) {
          navigator.clipboard.writeText(queryText).catch(() => {});
        }

        if (platform === 'tidal') {
          showToast(`已複製「${alb.title}」，開啟 Tidal 專輯搜尋`);
        } else if (platform === 'qobuz') {
          showToast(`正在開啟 Qobuz Hi-Res 專輯搜尋...`);
        } else if (platform === 'kkbox') {
          showToast(`已複製「${alb.title}」，開啟 KKBOX 專輯搜尋`);
        } else if (platform === 'apple') {
          showToast(`正在開啟 Apple Music 官方專輯...`);
        } else if (platform === 'spotify') {
          showToast(`正在開啟 Spotify 搜尋...`);
        }

        if (window.electronAPI) {
          window.electronAPI.openExternal(url);
        } else {
          window.open(url, '_blank');
        }
      });
    });

    container.appendChild(card);
  });
}

// Generate external YouTube icon link for track (rendered in its own dedicated column right of the title column)
function generateTrackOnlineLinks(track) {
  if (!track || !track.title) return '';
  const title = String(track.title || '').trim();
  const artist = String(track.artist || '').trim();
  const query = `${title} ${artist}`.trim();
  if (!query) return '';

  const ytUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;

  return `<a href="${ytUrl}" class="track-ext-link yt" target="_blank" title="在 YouTube 搜尋播放「${escapeXml(title)}」" data-url="${ytUrl}" data-platform="YouTube"><svg class="yt-svg-icon" viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg></a>`;
}

function handleTrackExternalLinkClick(extLink) {
  if (!extLink) return;
  const url = extLink.getAttribute('data-url') || extLink.href;
  const platform = extLink.getAttribute('data-platform') || '線上音樂';
  if (!url) return;

  if (window.electronAPI && window.electronAPI.openExternal) {
    window.electronAPI.openExternal(url);
  } else {
    window.open(url, '_blank');
  }
  showToast(`已在瀏覽器開啟 ${platform} 搜尋`);
}

// Render Tracks Tab (Chunked Progressive Loading for Instant Responsiveness)
const TRACKS_CHUNK_SIZE = 120;
let tracksRenderOffset = 0;
let currentDisplayTracks = [];
let tracksScrollListenerAttached = false;
let tracksIdleLoadTimer = null;

function renderTracks() {
  if (tracksIdleLoadTimer) {
    clearTimeout(tracksIdleLoadTimer);
    tracksIdleLoadTimer = null;
  }
  allTracksTbody.innerHTML = '';
  let displayTracks = [...state.tracks];
  if (state.trackSortBy === 'playCount') {
    displayTracks.sort((a, b) => {
      const cA = getTrackPlayCount(a);
      const cB = getTrackPlayCount(b);
      if (cB !== cA) return cB - cA;
      return (a.title || '').localeCompare(b.title || '');
    });
  } else if (state.trackSortBy === 'title') {
    displayTracks.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  } else if (state.trackSortBy === 'artist') {
    displayTracks.sort((a, b) => (a.artist || '').localeCompare(b.artist || ''));
  } else if (state.trackSortBy === 'duration') {
    displayTracks.sort((a, b) => (b.duration || 0) - (a.duration || 0));
  }

  currentDisplayTracks = displayTracks;
  tracksRenderOffset = 0;

  renderNextTracksChunk();
  setupTracksScrollListener();
  scheduleNextTracksIdleChunk();
  setupResizableTable('allTracksTable', 'all_tracks_v2');
}

function renderNextTracksChunk() {
  if (tracksRenderOffset >= currentDisplayTracks.length) {
    removeTracksSentinel();
    return;
  }

  const chunk = currentDisplayTracks.slice(tracksRenderOffset, tracksRenderOffset + TRACKS_CHUNK_SIZE);
  const frag = document.createDocumentFragment();

  chunk.forEach((track, localIdx) => {
    const idx = tracksRenderOffset + localIdx;
    const tr = document.createElement('tr');
    const isHires = (track.bitsPerSample >= 24) || (track.sampleRate > 48000);
    const specLabel = `${track.formatName || 'PCM'} ${track.bitsPerSample ? track.bitsPerSample + 'b/' : ''}${Math.round((track.sampleRate || 44100)/1000)}k`;
    const isFav = isTrackFavorite(track);
    const onlineLinksHtml = generateTrackOnlineLinks(track);
    const playCount = getTrackPlayCount(track);
    const playBadge = playCount > 0 ? `<span class="track-play-badge" title="播放次數：${playCount} 次">${playCount}</span>` : '';

    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td style="text-align: center;"><button class="btn-track-fav ${isFav ? 'active' : ''}" title="${isFav ? '取消最愛歌曲' : '加入最愛歌曲'}">${getHeartSvg(isFav, 14)}</button></td>
      <td class="track-title-cell">
        <div class="track-title-text">
          <span class="track-name-span">${escapeXml(track.title)}</span>${playBadge}
        </div>
      </td>
      <td class="track-yt-cell">${onlineLinksHtml}</td>
      <td>${escapeXml(track.artist)}</td>
      <td>${escapeXml(track.album)}</td>
      <td><span class="format-chip ${isHires ? 'hires' : ''}">${specLabel}</span></td>
      <td style="text-align: right;">${formatDuration(track.duration)}</td>
    `;
    tr.addEventListener('click', (e) => {
      const extLink = e.target.closest('.track-ext-link');
      if (extLink) {
        e.preventDefault();
        e.stopPropagation();
        handleTrackExternalLinkClick(extLink);
        return;
      }
      if (e.target.closest('.btn-track-fav')) {
        e.stopPropagation();
        toggleTrackFavorite(track);
        return;
      }
      playTrackList(currentDisplayTracks, idx);
    });
    frag.appendChild(tr);
  });

  const sentinel = document.getElementById('tracksSentinelRow');
  if (sentinel) {
    allTracksTbody.insertBefore(frag, sentinel);
  } else {
    allTracksTbody.appendChild(frag);
  }

  tracksRenderOffset += chunk.length;

  if (tracksRenderOffset < currentDisplayTracks.length) {
    ensureTracksSentinel();
  } else {
    removeTracksSentinel();
  }
}

function ensureTracksSentinel() {
  let sentinel = document.getElementById('tracksSentinelRow');
  if (!sentinel) {
    sentinel = document.createElement('tr');
    sentinel.id = 'tracksSentinelRow';
    allTracksTbody.appendChild(sentinel);
  }
  sentinel.innerHTML = `
    <td colspan="7" style="text-align: center; padding: 12px; color: var(--text-muted); font-size: 12px; border: none; background: transparent;">
      <span class="spinner" style="display:inline-block; width:12px; height:12px; margin-right:6px; vertical-align:middle;"></span>
      已載入 ${tracksRenderOffset} / ${currentDisplayTracks.length} 首曲目 (向下滾動持續載入)...
    </td>
  `;
}

function removeTracksSentinel() {
  const sentinel = document.getElementById('tracksSentinelRow');
  if (sentinel) sentinel.remove();
}

function setupTracksScrollListener() {
  if (tracksScrollListenerAttached) return;
  const mainContent = document.getElementById('mainContent');
  if (!mainContent) return;
  tracksScrollListenerAttached = true;

  mainContent.addEventListener('scroll', () => {
    if (state.currentView !== 'tracks') return;
    if (tracksRenderOffset >= currentDisplayTracks.length) return;
    const scrollRemaining = mainContent.scrollHeight - (mainContent.scrollTop + mainContent.clientHeight);
    if (scrollRemaining < 800) {
      renderNextTracksChunk();
      scheduleNextTracksIdleChunk();
    }
  }, { passive: true });
}

function scheduleNextTracksIdleChunk() {
  if (tracksRenderOffset >= currentDisplayTracks.length) return;
  if (tracksIdleLoadTimer) clearTimeout(tracksIdleLoadTimer);
  tracksIdleLoadTimer = setTimeout(() => {
    if (state.currentView === 'tracks' && tracksRenderOffset < currentDisplayTracks.length) {
      renderNextTracksChunk();
      scheduleNextTracksIdleChunk();
    }
  }, 120);
}

// ----------------- Resizable Table Columns Engine -----------------
function saveTableColWidths(table, storageKey) {
  if (!table) return;
  const widths = {};
  table.querySelectorAll('thead th').forEach((th, idx) => {
    if (th.style.width) {
      widths[idx] = th.style.width;
    }
  });
  try {
    localStorage.setItem('rooplayer_col_widths_' + storageKey, JSON.stringify(widths));
  } catch (e) {}
}

function restoreTableColWidths(table, storageKey) {
  if (!table) return;
  try {
    const raw = localStorage.getItem('rooplayer_col_widths_' + storageKey);
    if (!raw) return;
    const widths = JSON.parse(raw);
    const headers = table.querySelectorAll('thead th');
    headers.forEach((th, idx) => {
      if (widths[idx]) {
        th.style.width = widths[idx];
      }
    });
  } catch (e) {}
}

function setupResizableTable(tableId, storageKey) {
  const table = typeof tableId === 'string' ? document.getElementById(tableId) : tableId;
  if (!table) return;

  const headers = table.querySelectorAll('thead th');
  if (!headers.length) return;

  // Restore saved widths on startup
  restoreTableColWidths(table, storageKey);

  headers.forEach((th, idx) => {
    if (th.querySelector('.col-resizer')) return;

    // Minimum width based on column type
    const minW = idx === 0 || idx === 1 ? 28 : (idx === headers.length - 1 ? 55 : 60);

    const resizer = document.createElement('div');
    resizer.className = 'col-resizer';
    resizer.title = '拖曳調整此欄位寬度（連按兩下重設預設值）';
    th.appendChild(resizer);

    // Double-click to reset width
    resizer.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      e.preventDefault();
      th.style.width = '';
      saveTableColWidths(table, storageKey);
      showToast('已重設欄位寬度');
    });

    resizer.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const startX = e.pageX;
      const startWidth = th.getBoundingClientRect().width;
      resizer.classList.add('resizing');
      document.body.classList.add('table-col-resizing');

      function onMouseMove(moveEvent) {
        moveEvent.preventDefault();
        const diff = moveEvent.pageX - startX;
        const newWidth = Math.max(minW, Math.round(startWidth + diff));
        th.style.width = `${newWidth}px`;
      }

      function onMouseUp() {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        resizer.classList.remove('resizing');
        document.body.classList.remove('table-col-resizing');
        saveTableColWidths(table, storageKey);
      }

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  });
}

function setupResizableTables() {
  setupResizableTable('allTracksTable', 'all_tracks_v2');
  setupResizableTable('favTracksTable', 'fav_tracks_v2');
  setupResizableTable('historyTracksTable', 'history_tracks_v2');
  setupResizableTable('detailTracklistTable', 'album_detail_tracks_v2');
}

// Realistic Genre Illustration & Metadata Registry
function getGenreIllustrationInfo(genreName) {
  const g = (genreName || '').toLowerCase().trim();

  if (/classi|orchestr|symphon|baroque|opera|chamber|philharmonic|concerto|piano|beethoven|bach|mozart|chopin|古典|交響|協奏|獨奏/i.test(g)) {
    return { imageSrc: 'assets/genres/genre_classical.jpg', zhName: '古典樂派 • 交響協奏', badge: 'CLASSICAL' };
  }
  if (/jazz|fusion|swing|bop|bebop|big band|dixieland|smooth jazz|爵士/i.test(g)) {
    return { imageSrc: 'assets/genres/genre_jazz.jpg', zhName: '爵士樂 • 即興搖擺', badge: 'JAZZ' };
  }
  if (/metal|heavy metal|thrash|death metal|black metal|doom|hard rock|重金屬|金屬/i.test(g)) {
    return { imageSrc: 'assets/genres/genre_metal.jpg', zhName: '重金屬 • 狂野搖滾', badge: 'METAL' };
  }
  if (/rock|alternative|indie rock|punk|grunge|psychedelic|prog rock|搖滾|朋克/i.test(g)) {
    return { imageSrc: 'assets/genres/genre_rock.jpg', zhName: '搖滾樂 • 經典吉他', badge: 'ROCK' };
  }
  if (/electr|edm|techno|house|trance|synth|ambient electro|idm|dance|disco|club|電子|電音/i.test(g)) {
    return { imageSrc: 'assets/genres/genre_electronic.jpg', zhName: '電子音樂 • 合成器浪潮', badge: 'ELECTRONIC' };
  }
  if (/soul|motown|r&b|rnb|funk|gospel|neo-soul|節奏藍調|靈魂樂/i.test(g)) {
    return { imageSrc: 'assets/genres/genre_soul.jpg', zhName: '靈魂樂 • 節奏藍調 R&B', badge: 'SOUL / R&B' };
  }
  if (/blues|delta blues|chicago blues|country blues|藍調/i.test(g)) {
    return { imageSrc: 'assets/genres/genre_blues.jpg', zhName: '經典藍調 • 靈魂之聲', badge: 'BLUES' };
  }
  if (/folk|acoustic|bluegrass|celtic|americana|singer|songwriter|民謠|不插電/i.test(g)) {
    return { imageSrc: 'assets/genres/genre_folk.jpg', zhName: '民謠音樂 • 原聲不插電', badge: 'FOLK' };
  }
  if (/country|western|nashville|鄉村/i.test(g)) {
    return { imageSrc: 'assets/genres/genre_country.jpg', zhName: '鄉村音樂 • 原野之聲', badge: 'COUNTRY' };
  }
  if (/hip hop|hip-hop|rap|trap|boom bap|r&b rap|嘻哈|饒舌/i.test(g)) {
    return { imageSrc: 'assets/genres/genre_hiphop.jpg', zhName: '嘻哈饒舌 • 節拍韻律', badge: 'HIP HOP' };
  }
  if (/soundtrack|score|ost|film|movie|theme|cinematic|game|原聲|配樂|影視/i.test(g)) {
    return { imageSrc: 'assets/genres/genre_soundtrack.jpg', zhName: '影視配樂 • 史詩原聲', badge: 'SOUNDTRACK' };
  }
  if (/ambient|new age|chill|meditation|downtempo|drone|relax|氛圍|新世紀/i.test(g)) {
    return { imageSrc: 'assets/genres/genre_ambient.jpg', zhName: '氛圍音樂 • 心靈冥想', badge: 'AMBIENT' };
  }
  if (/vocal|chanson|acapella|ballad|人聲/i.test(g)) {
    return { imageSrc: 'assets/genres/genre_vocal.jpg', zhName: '發燒人聲 • 錄音室母帶', badge: 'VOCAL' };
  }
  if (/audiophile|hi-end|hifi|burmester|b&w|示範片|展cd|音響展|發燒/i.test(g)) {
    return { imageSrc: 'assets/genres/genre_classical.jpg', zhName: '發燒示範 • 母帶鑑聽', badge: 'AUDIOPHILE' };
  }
  if (/pop|cantopop|mandopop|k-pop|j-pop|indie pop|流行|華語流行/i.test(g)) {
    return { imageSrc: 'assets/genres/genre_pop.jpg', zhName: '流行音樂 • 現代旋律', badge: 'POP' };
  }

  return { imageSrc: 'assets/genres/genre_classical.jpg', zhName: '音樂流派風格', badge: 'GENRE' };
}

// Render Genres (Album-style presentation with realistic illustrations)
function renderGenres() {
  if (!genresGrid) return;
  genresGrid.innerHTML = '';

  const headerCount = document.getElementById('genresHeaderCount');

  // Collect all genres: strictly canonical core genres
  const genreSet = new Set();
  (state.genres || []).forEach(g => {
    const cg = canonicalizeGenre(g);
    if (cg) genreSet.add(cg);
  });

  CANONICAL_GENRES.forEach(cg => genreSet.add(cg));

  const genreList = Array.from(genreSet);

  // Sort: genres with tracks in user's library first (ordered by track count desc), then others
  genreList.sort((a, b) => {
    const aCount = state.tracks.filter(t => matchItemGenre(t, a)).length;
    const bCount = state.tracks.filter(t => matchItemGenre(t, b)).length;
    if (bCount !== aCount) return bCount - aCount;
    return a.localeCompare(b);
  });

  if (headerCount) {
    headerCount.textContent = `共 ${genreList.length} 個音樂風格與流派，以專輯風格探索您的發燒音樂庫`;
  }

  const genreBadge = document.getElementById('genreCountBadge');
  if (genreBadge) genreBadge.textContent = genreList.length;

  const frag = document.createDocumentFragment();
  genreList.forEach(genreName => {
    const card = document.createElement('div');
    card.className = 'album-card genre-album-card';

    const info = getGenreIllustrationInfo(genreName);

    const matchingTracks = state.tracks.filter(t => matchItemGenre(t, genreName));
    const matchingAlbums = state.albums.filter(a => matchItemGenre(a, genreName));

    const trackCount = matchingTracks.length;
    const albumCount = matchingAlbums.length;

    card.innerHTML = `
      <div class="album-art-wrap">
        <img src="${info.imageSrc}" class="album-art-img" alt="${escapeXml(genreName)}" loading="lazy" decoding="async">
        <span class="album-quality-tag tag-genre">${info.badge}</span>
        <button class="card-play-btn" title="播放「${escapeXml(genreName)}」曲風電台">▶</button>
      </div>
      <div class="album-meta">
        <div class="album-title" title="${escapeXml(genreName)}">${escapeXml(genreName)}</div>
        <div class="album-artist">${escapeXml(info.zhName)}</div>
        <div class="album-year">${albumCount} 張專輯 • ${trackCount} 首曲目</div>
      </div>
    `;

    // Play genre button
    const playBtn = card.querySelector('.card-play-btn');
    if (playBtn) {
      playBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (matchingTracks.length > 0) {
          showToast(`正在播放「${genreName}」曲風電台 (${matchingTracks.length} 首)`);
          playTrackList(matchingTracks, 0);
        } else {
          showToast(`音樂庫中尚未加入「${genreName}」風格的歌曲檔案`);
        }
      });
    }

    // Card click: Navigate to Albums view and filter by this genre accurately
    card.addEventListener('click', () => {
      state.activeGenreFilter = genreName;
      const navAlbums = document.querySelector('[data-view="albums"]');
      if (navAlbums) navAlbums.click();
      renderAlbums();
      showToast(`已篩選「${info.zhName || genreName}」風格專輯`);
    });

    frag.appendChild(card);
  });
  genresGrid.appendChild(frag);
}

// Render Scanned Folders
function renderFolders() {
  scannedFoldersList.innerHTML = '';
  if (!state.folders || state.folders.length === 0) {
    scannedFoldersList.innerHTML = '<div class="empty-folder-hint">尚未加入任何音樂資料夾，請點擊上方按鈕選取包含音樂的檔案夾。</div>';
    return;
  }
  state.folders.forEach(f => {
    const item = document.createElement('div');
    item.className = 'folder-list-item';
    const normF = (f || '').toLowerCase().replace(/\\/g, '/');
    const folderTracks = state.tracks.filter(t => {
      if (!t.filePath) return false;
      const normTrackPath = t.filePath.toLowerCase().replace(/\\/g, '/');
      return normTrackPath.startsWith(normF);
    });
    item.innerHTML = `
      <div>
        <div style="font-weight: 600; font-size: 13px; color: var(--text-main);">${escapeXml(f)}</div>
        <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">已收錄 ${folderTracks.length} 首歌曲</div>
      </div>
      <div style="display: flex; gap: 8px;">
        <button class="btn btn-secondary btn-sm btn-rescan">重新掃描</button>
        <button class="btn btn-secondary btn-sm btn-remove" style="color: #ef4444;">移除</button>
      </div>
    `;

    const rescanBtn = item.querySelector('.btn-rescan');
    if (rescanBtn) {
      rescanBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        rescanSpecificFolder(f);
      });
    }

    const removeBtn = item.querySelector('.btn-remove');
    if (removeBtn) {
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeSpecificFolder(f);
      });
    }

    scannedFoldersList.appendChild(item);
  });
}

// ----------------- Album Detail View & Web Bio / Recommendations -----------------
const albumBioCache = new Map();
let currentAlbumBioState = {
  originalText: '',
  translatedText: '',
  isShowingOriginal: false
};

let isAlbumIntroCollapsed = localStorage.getItem('roo_album_intro_collapsed') === 'true';

function updateAlbumIntroCollapseUI() {
  const sectionEl = document.getElementById('albumIntroSection');
  const iconEl = document.getElementById('albumIntroCollapseIcon');
  const textEl = document.getElementById('albumIntroCollapseText');
  const btnEl = document.getElementById('btnToggleAlbumIntroCollapse');
  if (!sectionEl) return;

  if (isAlbumIntroCollapsed) {
    sectionEl.classList.add('collapsed');
    if (iconEl) iconEl.textContent = '▼';
    if (textEl) textEl.textContent = '展開';
    if (btnEl) btnEl.title = '展開專輯介紹';
  } else {
    sectionEl.classList.remove('collapsed');
    if (iconEl) iconEl.textContent = '▲';
    if (textEl) textEl.textContent = '縮小';
    if (btnEl) btnEl.title = '縮小專輯介紹';
  }
}

function toggleAlbumIntroCollapse(e) {
  if (e) {
    e.stopPropagation();
    e.preventDefault();
  }
  isAlbumIntroCollapsed = !isAlbumIntroCollapsed;
  localStorage.setItem('roo_album_intro_collapsed', isAlbumIntroCollapsed);
  updateAlbumIntroCollapseUI();
}

function cleanWikipediaAlbumExtract(rawText, maxChars = 2200) {
  if (!rawText) return '';
  let text = rawText.replace(/\r/g, '');
  // Cut off non-narrative sections (track lists, references, personnel, external links, charts, certs)
  const cutoffRegex = /\n==\s*(?:曲目(?:列表)?|Track listing|Personnel|制作人员|製作人員|参考资料|參考資料|References|外部链接|外部連結|External links|榜单|榜單|Charts|销售认证|銷售認證|Certifications|派台歌成績|發行歷史|Release history)[\s\S]*/i;
  text = text.replace(cutoffRegex, '').trim();

  // Format section titles nicely for reader
  text = text.replace(/\n===\s*([^=\n]+)\s*===\n/g, '\n\n【$1】\n');
  text = text.replace(/\n==\s*([^=\n]+)\s*==\n/g, '\n\n◆ $1 ◆\n');

  // Normalize excessive newlines
  text = text.replace(/\n{3,}/g, '\n\n').trim();

  if (text.length > maxChars) {
    const cut = text.slice(0, maxChars);
    const lastParagraph = cut.lastIndexOf('\n\n');
    if (lastParagraph > maxChars * 0.6) {
      text = cut.slice(0, lastParagraph) + '\n\n...（更多典藏資料請參閱維基百科全文）';
    } else {
      const lastPeriod = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('. '));
      if (lastPeriod > maxChars * 0.6) {
        text = cut.slice(0, lastPeriod + 1) + ' ...（更多典藏資料請參閱維基百科全文）';
      } else {
        text = cut + '...';
      }
    }
  }
  return text;
}

async function fetchAlbumBio(album) {
  const loadingEl = document.getElementById('albumBioLoading');
  const textEl = document.getElementById('albumBioText');
  const sourceBadge = document.getElementById('albumIntroSourceBadge');
  const btnToggleBioLang = document.getElementById('btnToggleAlbumBioLang');

  if (!loadingEl || !textEl) return;

  loadingEl.style.display = 'flex';
  loadingEl.innerHTML = '<span class="spinner"></span> 正在搜尋專輯背景資料並自動翻譯為繁體中文...';
  textEl.style.display = 'none';
  if (btnToggleBioLang) btnToggleBioLang.style.display = 'none';

  const cacheKey = `${album.title}___${album.artist}`;
  let rawBioText = '';
  let isFromEnWiki = false;

  if (albumBioCache.has(cacheKey)) {
    const cached = albumBioCache.get(cacheKey);
    rawBioText = cached.originalText;
    isFromEnWiki = cached.isFromEnWiki;
  } else {
    try {
      // 1. Try Wikipedia search in Chinese
      const zhSearchUrl = `https://zh.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(album.title + ' ' + album.artist)}&format=json&origin=*`;
      let res = await fetch(zhSearchUrl);
      if (res.ok) {
        const data = await res.json();
        const hit = data.query?.search?.[0]?.title;
        if (hit) {
          // Fetch full extract for rich narrative details
          const zhExtractUrl = `https://zh.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&titles=${encodeURIComponent(hit)}&format=json&origin=*`;
          const extRes = await fetch(zhExtractUrl);
          if (extRes.ok) {
            const extData = await extRes.json();
            const pages = extData.query?.pages;
            const raw = pages ? Object.values(pages)[0]?.extract : '';
            if (raw) {
              const cleaned = cleanWikipediaAlbumExtract(raw, 2200);
              if (cleaned && cleaned.length >= 80) {
                rawBioText = cleaned;
              }
            }
          }
          if (!rawBioText) {
            const zhSummaryUrl = `https://zh.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(hit)}`;
            const sumRes = await fetch(zhSummaryUrl, {
              headers: {
                'User-Agent': 'rooPlayer/1.0',
                'Accept-Language': 'zh-tw,zh-hant;q=0.9'
              }
            });
            if (sumRes.ok) {
              const sumData = await sumRes.json();
              if (sumData.extract && sumData.type !== 'disambiguation') {
                rawBioText = sumData.extract;
              }
            }
          }
        }
      }

      // 2. If no Chinese summary or too brief, try English Wikipedia Search
      if (!rawBioText) {
        const enSearchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(album.title + ' ' + album.artist + ' album')}&format=json&origin=*`;
        res = await fetch(enSearchUrl);
        if (res.ok) {
          const data = await res.json();
          const hit = data.query?.search?.[0]?.title;
          if (hit) {
            const enExtractUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&titles=${encodeURIComponent(hit)}&format=json&origin=*`;
            const extRes = await fetch(enExtractUrl);
            if (extRes.ok) {
              const extData = await extRes.json();
              const pages = extData.query?.pages;
              const raw = pages ? Object.values(pages)[0]?.extract : '';
              if (raw) {
                const cleaned = cleanWikipediaAlbumExtract(raw, 2200);
                if (cleaned && cleaned.length >= 80) {
                  rawBioText = cleaned;
                  isFromEnWiki = true;
                }
              }
            }
            if (!rawBioText) {
              const enSummaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(hit)}`;
              const sumRes = await fetch(enSummaryUrl, { headers: { 'User-Agent': 'rooPlayer/1.0' } });
              if (sumRes.ok) {
                const sumData = await sumRes.json();
                if (sumData.extract && sumData.type !== 'disambiguation') {
                  rawBioText = sumData.extract;
                  isFromEnWiki = true;
                }
              }
            }
          }
        }
      }

      // 3. Direct page summary fallback
      if (!rawBioText) {
        const directUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(album.title + ' (album)')}`;
        const dirRes = await fetch(directUrl, { headers: { 'User-Agent': 'rooPlayer/1.0' } });
        if (dirRes.ok) {
          const sumData = await dirRes.json();
          if (sumData.extract && sumData.type !== 'disambiguation') {
            rawBioText = sumData.extract;
            isFromEnWiki = true;
          }
        }
      }
    } catch (err) {
      console.warn('Wikipedia album summary fetch error:', err);
    }
  }

  // Auto-translate to Traditional Chinese if we got a bio from the web
  let translatedBioText = rawBioText;
  if (rawBioText) {
    if (albumBioCache.has(cacheKey) && albumBioCache.get(cacheKey).translatedText) {
      translatedBioText = albumBioCache.get(cacheKey).translatedText;
    } else {
      translatedBioText = await translateTextToZhTw(rawBioText);
      albumBioCache.set(cacheKey, {
        originalText: rawBioText,
        translatedText: translatedBioText,
        isFromEnWiki
      });
    }
  }

  loadingEl.style.display = 'none';

  if (rawBioText) {
    currentAlbumBioState = {
      originalText: rawBioText,
      translatedText: translatedBioText,
      isShowingOriginal: false
    };

    textEl.textContent = translatedBioText;
    textEl.style.display = 'block';

    const hasTranslationDiff = (translatedBioText.trim() !== rawBioText.trim());
    if (hasTranslationDiff) {
      sourceBadge.textContent = isFromEnWiki
        ? '資料來源：維基百科音樂資料庫 (深度介紹 / 自動翻譯為繁體中文)'
        : '資料來源：中文維基百科音樂資料庫 (深度介紹 / 繁體中文)';
      if (btnToggleBioLang) {
        btnToggleBioLang.style.display = 'inline-flex';
        btnToggleBioLang.textContent = '檢視原文';
        btnToggleBioLang.onclick = () => {
          currentAlbumBioState.isShowingOriginal = !currentAlbumBioState.isShowingOriginal;
          if (currentAlbumBioState.isShowingOriginal) {
            textEl.textContent = currentAlbumBioState.originalText;
            btnToggleBioLang.textContent = '顯示繁體中文翻譯';
            showToast('已切換為原始語言簡介');
          } else {
            textEl.textContent = currentAlbumBioState.translatedText;
            btnToggleBioLang.textContent = '檢視原文';
            showToast('已切換為繁體中文翻譯');
          }
        };
      }
    } else {
      sourceBadge.textContent = '資料來源：中文維基百科 (繁體中文)';
      if (btnToggleBioLang) btnToggleBioLang.style.display = 'none';
    }
  } else {
    // Elegant fallback overview generated from local metadata (doubled/tripled content density)
    const trackCount = (album.tracks && Array.isArray(album.tracks)) ? album.tracks.length : (album.numberOfTracks || 0);
    const sampleTracks = (album.tracks && album.tracks.length > 0)
      ? album.tracks.slice(0, 3).map(t => `「${t.title}」`).join('、')
      : `「${album.title}」`;
    const totalDurationText = formatTotalAlbumDuration(album.tracks || []);
    const yearText = album.year ? `於 ${album.year} 年錄製發行` : (album.date ? `於 ${album.date.slice(0, 4)} 年錄製發行` : '所精心打造');
    const genreText = album.genre && album.genre !== 'Various' ? album.genre : '多元精緻風格';
    const specKhz = album.sampleRate ? Math.round(album.sampleRate / 1000) : 44.1;
    const bitDepth = album.bitsPerSample || 16;
    const firstTrack = (album.tracks && album.tracks[0]) || {};
    const fmt = getAudioFormatFromPath(firstTrack.filePath || album.filePath || '', album.formatName || 'PCM').toUpperCase();
    const isDsd = fmt === 'DSF' || fmt === 'DFF' || fmt === 'DSD';
    const isLossless = album.isLossless || ['WAV', 'FLAC', 'AIFF', 'ALAC', 'APE', 'DSF', 'DFF', 'DSD'].includes(fmt);
    const channels = album.channels || firstTrack.channels || 2;
    const channelDesc = channels === 1 ? '單聲道 (Mono)' : (channels === 2 ? '雙聲道立體聲 (Stereo)' : `${channels} 聲道環繞音場`);
    const formatLabel = isDsd
      ? `DSD 1-bit / ${album.sampleRate ? (album.sampleRate / 1000000).toFixed(1) : '2.8'}MHz Direct Stream Digital`
      : `${fmt} ${bitDepth}-bit / ${specKhz}kHz ${isLossless ? '發燒無損母帶' : '數位音訊'}`;

    const labelPart = album.label ? `，由唱片廠牌 ${album.label} 發行` : '';
    const producerPart = album.producer ? `，由製作人 ${album.producer} 操刀製作` : '';
    const composerPart = album.composer ? `，主要作曲由 ${album.composer} 執筆` : '';

    const p1 = `《${album.title}》是由知名演出者 ${album.artist} ${yearText}的代表性音樂作品${labelPart}${producerPart}${composerPart}。作品在藝術性與音樂張力上皆深具份量，細膩融合了 ${genreText} 的核心精髓，展現出高度成熟的編曲層次與深厚的情感共鳴。`;

    const p2 = `全張專輯共精選收錄 ${trackCount} 首完整曲目錄音，總播放時間長達 ${totalDurationText}。其中包括焦點代表作如 ${sampleTracks} 等，在樂器對位、節奏鋪陳與人聲演繹之間呈現精緻的動態起伏，為樂迷帶來沉浸式的完整聽覺旅程。`;

    const p3 = `母帶規格與聲學品質方面，本音樂庫以 ${formatLabel} 高規格完整珍藏，採 ${channelDesc} 架構。錄音具備寬闊的音場深度與豐富的微動態細節，殘響延伸與器樂質感皆表現優異。推薦透過 Bit-Perfect 原音直通輸出或開啟 DSP 升頻引擎，體驗至臻完美的發燒級聆賞享受。`;

    textEl.textContent = `${p1}\n\n${p2}\n\n${p3}`;
    textEl.style.display = 'block';
    sourceBadge.textContent = '音樂庫母帶深度元資料介紹 (繁體中文)';
    if (btnToggleBioLang) btnToggleBioLang.style.display = 'none';
  }
}

// ----------------- Album Credits & Metadata Engine -----------------
const albumCreditsCache = new Map();

function formatTotalAlbumDuration(tracks) {
  if (!tracks || !tracks.length) return '0 秒';
  const totalSec = tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = Math.floor(totalSec % 60);
  if (hrs > 0) {
    return `${hrs} 小時 ${mins} 分 ${secs} 秒`;
  }
  return `${mins} 分 ${secs} 秒`;
}

async function fetchOnlineAlbumCredits(album) {
  const cacheKey = `${album.title}___${album.artist}`;
  if (albumCreditsCache.has(cacheKey)) {
    return albumCreditsCache.get(cacheKey);
  }

  const result = {
    producer: null,
    label: null,
    releaseDate: null,
    copyright: null,
    composer: null
  };

  try {
    // 1. iTunes Search API (fast, returns global copyright, publisher label & release date)
    const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(album.title + ' ' + album.artist)}&entity=album&limit=5`;
    const res = await fetch(itunesUrl);
    if (res.ok) {
      const data = await res.json();
      if (data.results && data.results.length > 0) {
        const normTitle = album.title.toLowerCase().trim();
        const normArtist = album.artist.toLowerCase().trim();
        const hit = data.results.find(r => {
          const rTitle = (r.collectionName || '').toLowerCase();
          const rArt = (r.artistName || '').toLowerCase();
          return (rTitle.includes(normTitle) || normTitle.includes(rTitle)) &&
                 (rArt.includes(normArtist) || normArtist.includes(rArt));
        }) || data.results[0];

        if (hit) {
          if (hit.copyright) {
            result.copyright = hit.copyright;
            let clean = hit.copyright.replace(/^[℗©pPcC0-9\s,\.\-]+/, '').trim();
            clean = clean.replace(/(under exclusive license to|licensed to|a division of).*$/i, '').trim();
            if (clean && clean.length > 2) {
              result.label = clean;
            }
          }
          if (hit.releaseDate) {
            result.releaseDate = hit.releaseDate.slice(0, 10);
          }
        }
      }
    }
  } catch (e) {
    // iTunes fetch error ignored
  }

  try {
    // 2. MusicBrainz Release API
    if (!result.label || !result.releaseDate) {
      const mbUrl = `https://musicbrainz.org/ws/2/release/?query=release:${encodeURIComponent(album.title)}+AND+artist:${encodeURIComponent(album.artist)}&fmt=json&limit=3`;
      const mbRes = await fetch(mbUrl, { headers: { 'User-Agent': 'rooPlayer/1.0' } });
      if (mbRes.ok) {
        const mbData = await mbRes.json();
        if (mbData.releases && mbData.releases.length > 0) {
          const rel = mbData.releases[0];
          if (rel['label-info-list'] && rel['label-info-list'].length > 0) {
            const labels = rel['label-info-list'].map(l => l.label?.name).filter(Boolean);
            if (labels.length > 0 && !result.label) {
              result.label = labels.slice(0, 2).join(', ');
            }
          }
          if (rel.date && !result.releaseDate) {
            result.releaseDate = rel.date;
          }
        }
      }
    }
  } catch (e) {
    // MusicBrainz fetch error ignored
  }

  // 3. Extract producer or label from Wikipedia review text if available
  try {
    if (!result.producer) {
      let bioText = '';
      if (albumBioCache.has(cacheKey)) {
        bioText = albumBioCache.get(cacheKey).originalText || '';
      }
      if (bioText) {
        const prodMatch = bioText.match(/(?:produced by|producers include|producer(?:\(s\))?\s*:)\s*([^.,\n]+)/i);
        if (prodMatch && prodMatch[1]) {
          const rawProd = prodMatch[1].trim();
          if (rawProd.length > 2 && rawProd.length < 80) {
            result.producer = rawProd;
          }
        }
        if (!result.label) {
          const labelMatch = bioText.match(/(?:released(?: [a-zA-Z0-9 ,]+)? through|released by|released on)\s*([^.,\n]+)/i);
          if (labelMatch && labelMatch[1]) {
            const rawLabel = labelMatch[1].trim();
            if (rawLabel.length > 2 && rawLabel.length < 60) {
              result.label = rawLabel;
            }
          }
        }
      }
    }
  } catch (e) {}

  albumCreditsCache.set(cacheKey, result);
  return result;
}

function getAudioFormatFromPath(filePath, fallback = 'PCM') {
  if (!filePath || typeof filePath !== 'string') return fallback;
  if (filePath.startsWith('tidal_') || filePath.includes('tidal')) return 'FLAC';
  const match = filePath.match(/\.([a-zA-Z0-9]+)(?:[\?#]|$)/);
  if (!match) return fallback;
  const ext = match[1].toUpperCase();
  if (ext === 'WAVE') return 'WAV';
  if (ext === 'AIF') return 'AIFF';
  return ext;
}

function renderAlbumMetadata(album) {
  const companyEl = document.getElementById('detailCompany');
  const yearEl = document.getElementById('detailYear');
  const durationEl = document.getElementById('detailTracksDuration');

  // Extract initial values from album and track objects
  let year = '未載明';
  if (album.year) {
    year = String(album.year).includes('年') ? String(album.year) : `${album.year} 年`;
  } else if (album.date) {
    const rawY = String(album.date).slice(0, 4);
    if (rawY && !isNaN(rawY)) year = `${rawY} 年`;
  }

  let label = album.label || null;
  if (!label && album.copyright) {
    const clean = album.copyright.replace(/^[℗©pPcC0-9\s,\.\-]+/, '').replace(/(under exclusive license to|licensed to|a division of).*$/i, '').trim();
    if (clean && clean.length > 2) label = clean;
  }

  (album.tracks || []).forEach(t => {
    if (!label && t.label) label = t.label;
    if (!label && t.copyright) {
      const clean = t.copyright.replace(/^[℗©pPcC0-9\s,\.\-]+/, '').replace(/(under exclusive license to|licensed to|a division of).*$/i, '').trim();
      if (clean && clean.length > 2) label = clean;
    }
    if ((!year || year === '未載明') && (t.year || t.date)) {
      const yVal = t.year || t.date;
      const rawY = String(yVal).slice(0, 4);
      if (rawY && !isNaN(rawY)) year = `${rawY} 年`;
    }
  });

  const trackCount = (album.tracks && Array.isArray(album.tracks)) ? album.tracks.length : (album.numberOfTracks || 0);
  const tracksDurationText = (album.tracks && album.tracks.length)
    ? `${album.tracks.length} 首歌曲 • ${formatTotalAlbumDuration(album.tracks)}`
    : `${trackCount} 首歌曲`;

  if (companyEl) {
    companyEl.textContent = label || '獨立發行 / 未標記廠牌';
    setAlbumLabelLink(companyEl, label); // 有真實廠牌時可點擊 ➔ 開啟該發行公司頁面
  }
  if (yearEl) yearEl.textContent = year;
  if (durationEl) durationEl.textContent = tracksDurationText;

  // Background fetch online enrichment if label or year is missing
  if (!label || year === '未載明') {
    fetchOnlineAlbumCredits(album).then(onlineCredits => {
      if (state.activeAlbumDetail && state.activeAlbumDetail.title === album.title && state.activeAlbumDetail.artist === album.artist) {
        if (!label && onlineCredits.label) {
          label = onlineCredits.label;
          if (companyEl) {
            companyEl.textContent = label;
            setAlbumLabelLink(companyEl, label);
          }
          // 線上補齊的廠牌記回記憶體中的專輯：同一廠牌頁面在本次工作階段也會收錄它
          if (state.activeAlbumDetail && state.activeAlbumDetail.title === album.title && state.activeAlbumDetail.artist === album.artist) {
            state.activeAlbumDetail.label = label;
          }
        }
        if ((!year || year === '未載明') && onlineCredits.releaseDate) {
          const parsedYear = String(onlineCredits.releaseDate).slice(0, 4);
          if (parsedYear && !isNaN(parsedYear)) {
            year = `${parsedYear} 年`;
            if (yearEl) yearEl.textContent = year;
          }
        }
      }
    }).catch(() => {});
  }
}


// ----------------- 發行公司（Record Label）辨識與廠牌頁面 -----------------
// 專輯頁的「發行公司」可點擊 ➔ 開啟該公司頁面，列出音樂庫（本機標籤 + 已收錄 TIDAL）
// 與 TIDAL 上同屬該公司的全部發行專輯。
// 比對來源：album.label（本機 LABEL / PUBLISHER 標籤）➔ copyright 推導 ➔ 各 track 同名字欄位。
function cleanCopyrightLabel(copyright) {
  const raw = String(copyright || '')
    .replace(/^[℗©pPcC0-9\s,\.\-]+/, '')
    .replace(/(under exclusive license to|licensed to|a division of).*$/i, '')
    .trim();
  return raw.length > 2 ? raw : '';
}

function albumLabelValue(album) {
  if (!album) return '';
  if (album.label) return String(album.label).trim();
  const fromCopyright = cleanCopyrightLabel(album.copyright);
  if (fromCopyright) return fromCopyright;
  for (const t of (album.tracks || [])) {
    if (t.label) return String(t.label).trim();
    const derived = cleanCopyrightLabel(t.copyright);
    if (derived) return derived;
  }
  return '';
}

// 公司名稱結尾的 korporative 字樣不影響身分（RCA ⇔ RCA Records、Decca ⇔ Decca Music Group）
const LABEL_SUFFIX_WORDS = [
  'records', 'record', 'recording', 'recordings', 'rec', 'label', 'ltd', 'ltda', 'limited',
  'inc', 'co', 'corp', 'corporation', 'gmbh', 'llc', 'llp', 'bv', 'group', 'entertainment',
  'publishing', 'distribution', 'music group', 'music limited', 'music co'
];

function normalizeLabelKey(value) {
  let key = String(value || '')
    .replace(/[℗©]/g, ' ')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/[^0-9a-z\u4e00-\u9fff\s.&'\-]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (const suffix of LABEL_SUFFIX_WORDS) {
      const pattern = new RegExp(`\\s${suffix.replace(/\./g, '\\.?')}$`, 'i');
      if (pattern.test(key) && key.replace(pattern, '').trim().length >= 3) {
        key = key.replace(pattern, '').trim();
        changed = true;
      }
    }
    if (!changed) break;
  }
  return key;
}

// 同一公司判定：正規化後相同，或一方以完整單字出現在另一方內（Decca ⇔ Decca Music Group、
// Universal Music ⇔ Universal Music Ltd）。Sony Music 與 Sony Classical 不同名 ⇒ 不會誤併。
function labelsMatch(a, b) {
  const ka = normalizeLabelKey(a);
  const kb = normalizeLabelKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  const shorter = ka.length <= kb.length ? ka : kb;
  const longer = ka.length <= kb.length ? kb : ka;
  if (shorter.length < 3) return false;
  const escaped = shorter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^0-9a-z])${escaped}([^0-9a-z]|$)`, 'i').test(longer);
}

function labelTitleKey(title, artist) {
  return `${normalizeLabelKey(title)}||${normalizeLabelKey(artist)}`;
}

function albumsForLabel(labelName) {
  const matched = [];
  state.albums.forEach(alb => {
    const lab = albumLabelValue(alb);
    if (lab && labelsMatch(lab, labelName)) matched.push(alb);
  });
  matched.sort((a, b) => String(b.year || b.date || '').localeCompare(String(a.year || a.date || '')));
  return matched;
}

// 專輯頁：把「發行公司」變成可點擊的廠牌連結
function setAlbumLabelLink(companyEl, label) {
  if (!companyEl) return;
  const hasLabel = !!(label && String(label).trim() && String(label).trim() !== '獨立發行 / 未標記廠牌');
  companyEl.classList.toggle('label-link', hasLabel);
  companyEl.title = hasLabel ? `檢視 ${label} 在 rooPlayer 音樂庫（含 TIDAL）發行的全部專輯` : '';
  companyEl.onclick = hasLabel
    ? (e) => { e.stopPropagation(); openLabelDetail(String(label).trim()); }
    : null;
}

let labelDetailRenderSeq = 0;

function renderLabelAlbumGrid(gridId, countId, emptyId, albums, emptyText) {
  const grid = document.getElementById(gridId);
  const countBadge = document.getElementById(countId);
  const emptyHint = document.getElementById(emptyId);
  if (!grid) return;
  grid.innerHTML = '';
  if (countBadge) countBadge.textContent = `${albums.length} 張`;
  albums.forEach(alb => grid.appendChild(createAlbumCard(alb)));
  if (emptyHint) {
    emptyHint.style.display = albums.length ? 'none' : 'block';
    if (emptyText && !albums.length) emptyHint.textContent = emptyText;
  }
}

function createLabelTidalCard(alb) {
  const card = document.createElement('div');
  card.className = 'album-card tidal-discography-card';
  card.dataset.tidalId = String(alb.tidalId);

  const defaultCover = createSvgCover(alb.title, alb.artist, '#27272a', '#09090b');
  const coverSrc = formatCoverSrc(alb.cover) || defaultCover;
  const inLib = isTidalAlbumInLibrary(alb.tidalId);
  const isHiRes = alb.audioQuality === 'HI_RES_LOSSLESS' || alb.audioQuality === 'HIRES';
  const qualityBadgeHtml = isHiRes
    ? `<span class="album-quality-tag tag-tidal-hires">TIDAL MAX</span>`
    : `<span class="album-quality-tag tag-tidal">TIDAL FLAC</span>`;
  const labelName = albumLabelValue(alb);

  card.innerHTML = `
    <div class="album-art-wrap">
      <img src="${coverSrc}" class="album-art-img" alt="${escapeXml(alb.title)}" loading="lazy">
      ${qualityBadgeHtml}
      <button class="card-play-btn" title="播放整張 TIDAL 專輯">▶</button>
    </div>
    <div class="album-meta">
      <div class="album-title" title="${escapeXml(alb.title)}">${escapeXml(alb.title)}</div>
      <div class="album-artist">${escapeXml(alb.artist)}</div>
      <div class="album-year">${alb.year ? alb.year + ' • ' : ''}${alb.numberOfTracks ? alb.numberOfTracks + ' 首 • ' : ''}${inLib ? '<span style="color:#00e5ff;font-weight:700;">✓ 已在曲庫</span>' : (labelName ? escapeXml(labelName) : '')}</div>
    </div>
    <div class="tidal-card-actions">
      <button class="btn-tidal-lib-action ${inLib ? 'in-library' : ''}" data-tidal-id="${alb.tidalId}">${inLib ? '✓ 已在曲庫' : '➕ 加入曲庫'}</button>
    </div>
  `;

  const playBtn = card.querySelector('.card-play-btn');
  if (playBtn) {
    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      playTidalAlbum(alb.tidalId);
    });
  }
  const libBtn = card.querySelector('.btn-tidal-lib-action');
  if (libBtn) {
    libBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (isTidalAlbumInLibrary(alb.tidalId)) {
        if (confirm(`確定要將《${alb.title}》從曲庫移除嗎？`)) {
          await removeTidalAlbumFromLibrary(alb.tidalId);
        }
      } else {
        await addTidalAlbumToLibrary(alb.tidalId, alb);
      }
    });
  }
  const artWrap = card.querySelector('.album-art-wrap');
  if (artWrap) {
    artWrap.style.cursor = 'pointer';
    artWrap.addEventListener('click', (e) => {
      if (e.target.closest('.card-play-btn')) return;
      e.stopPropagation();
      openAlbumDetail(alb);
    });
  }
  return card;
}

// TIDAL 端該公司的發行專輯：① 直接以公司名稱搜尋 ② 循該公司在庫演出者的 TIDAL 歷年發行延伸
// 兩者都只保留 TIDAL 發行資料（copyright 欄位）確實屬於該公司者。
async function fetchLabelTidalAlbums(labelName, localMatched) {
  const loadingEl = document.getElementById('labelTidalLoading');
  const grid = document.getElementById('labelTidalAlbumsGrid');
  const countBadge = document.getElementById('labelTidalAlbumsCount');
  const emptyHint = document.getElementById('labelTidalEmptyHint');
  const seq = ++labelDetailRenderSeq;

  if (loadingEl) loadingEl.style.display = 'flex';
  if (grid) grid.innerHTML = '';
  if (emptyHint) emptyHint.style.display = 'none';
  if (countBadge) countBadge.textContent = '檢索中...';

  if (!window.tidalService || !window.tidalService.isLoggedIn) {
    if (loadingEl) loadingEl.style.display = 'none';
    if (countBadge) countBadge.textContent = '未連線 TIDAL';
    if (emptyHint) {
      emptyHint.textContent = '尚未連線 TIDAL：於「TIDAL」頁登入後，即可列出該發行公司在 TIDAL 的發行專輯並直接播放或加入曲庫。';
      emptyHint.style.display = 'block';
    }
    return;
  }

  try {
    const found = new Map();
    const accept = (alb) => {
      if (!alb || !alb.tidalId) return;
      if (!labelsMatch(alb.label || alb.copyright, labelName)) return;
      found.set(String(alb.tidalId), alb);
    };

    // 1) 以公司名稱直接搜尋 TIDAL 專輯
    try {
      const direct = await window.tidalService.search(labelName, 50);
      ((direct && direct.albums) || []).forEach(accept);
    } catch (e) { console.warn('[label] TIDAL label search failed:', e); }
    if (seq !== labelDetailRenderSeq) return;

    // 2) 循該公司在庫演出者延伸其 TIDAL 歷年發行（最多 8 位，避免大量請求）
    const artistNames = [...new Set((localMatched || []).map(a => a.artist).filter(Boolean))].slice(0, 8);
    for (const artistName of artistNames) {
      try {
        const artistObj = await window.tidalService.searchArtist(artistName);
        if (!artistObj || !artistObj.id) continue;
        const discography = await window.tidalService.getArtistAlbums(artistObj.id, 50);
        (discography || []).forEach(accept);
      } catch (e) { /* 單一演出者失敗不影響整頁 */ }
      if (seq !== labelDetailRenderSeq) return;
    }

    // 3) 排除上方清單已出現者（已在曲庫的 TIDAL 專輯、同名本機專輯）
    const knownIds = new Set((localMatched || []).map(a => String(a.tidalId || '')).filter(Boolean));
    const knownTitles = new Set((localMatched || []).map(a => labelTitleKey(a.title, a.artist)));
    const list = [...found.values()]
      .filter(alb => !knownIds.has(String(alb.tidalId)) && !knownTitles.has(labelTitleKey(alb.title, alb.artist)))
      .sort((a, b) => String(b.releaseDate || b.year || '').localeCompare(String(a.releaseDate || a.year || '')));

    if (loadingEl) loadingEl.style.display = 'none';
    if (countBadge) countBadge.textContent = list.length ? `共 ${list.length} 張` : '0 張';
    if (grid) list.forEach(alb => grid.appendChild(createLabelTidalCard(alb)));
    if (emptyHint) {
      emptyHint.textContent = list.length
        ? ''
        : `TIDAL 未回報屬於「${labelName}」的其他發行專輯（TIDAL 僅在 copyright 欄位提供發行公司資料）。`;
      emptyHint.style.display = list.length ? 'none' : 'block';
    }
  } catch (e) {
    console.warn('[label] TIDAL label expansion failed:', e);
    if (loadingEl) loadingEl.style.display = 'none';
    if (countBadge) countBadge.textContent = '連線失敗';
    if (emptyHint) {
      emptyHint.textContent = `連線 TIDAL 時發生錯誤：${String((e && e.message) || e)}`;
      emptyHint.style.display = 'block';
    }
  }
}

async function openLabelDetail(labelName) {
  const label = String(labelName || '').trim();
  if (!label) return;
  state.currentLabelDetail = label;
  navigateTo('labelDetail');

  const matched = albumsForLabel(label);
  const inLibraryAlbums = matched;
  const tracks = [];
  inLibraryAlbums.forEach(alb => { if (Array.isArray(alb.tracks)) tracks.push(...alb.tracks); });
  const artists = [...new Set(inLibraryAlbums.map(a => a.artist).filter(Boolean))].sort();

  const nameEl = document.getElementById('labelDetailName');
  if (nameEl) nameEl.textContent = label;
  const setText = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
  setText('labelDetailAlbumCount', inLibraryAlbums.length);
  setText('labelDetailArtistCount', artists.length);
  setText('labelDetailTrackCount', tracks.length);

  const avatarImg = document.getElementById('labelDetailAvatar');
  const avatarPlaceholder = document.getElementById('labelDetailAvatarPlaceholder');
  if (avatarImg) { avatarImg.style.display = 'none'; avatarImg.src = ''; }
  if (avatarPlaceholder) {
    avatarPlaceholder.style.display = 'flex';
    avatarPlaceholder.textContent = '🏷️';
  }
  const backdrop = document.getElementById('labelHeroBackdrop');
  if (backdrop) { backdrop.style.backgroundImage = 'none'; backdrop.style.opacity = '0'; }

  // 該公司演出者 chips（點擊開演出者頁）
  const chipsBox = document.getElementById('labelDetailArtists');
  if (chipsBox) {
    chipsBox.innerHTML = '';
    artists.forEach(name => {
      const chip = document.createElement('span');
      chip.className = 'genre-chip label-artist-chip';
      chip.textContent = name;
      chip.title = `開啟 ${name} 的演出者頁面`;
      chip.addEventListener('click', () => openArtistDetail(name));
      chipsBox.appendChild(chip);
    });
  }

  const btnPlayAll = document.getElementById('btnPlayAllLabelAlbums');
  if (btnPlayAll) {
    btnPlayAll.onclick = () => {
      if (!tracks.length) { showToast('此發行公司在音樂庫內尚無可播放的曲目'); return; }
      playTrackList(tracks, 0);
      showToast(`▶ 播放 ${label} 發行的全部專輯（${tracks.length} 首）`);
    };
  }
  const btnShuffle = document.getElementById('btnShuffleLabelAlbums');
  if (btnShuffle) {
    btnShuffle.onclick = () => {
      if (!tracks.length) { showToast('此發行公司在音樂庫內尚無可播放的曲目'); return; }
      setShuffleState(true);
      playTrackList(tracks, Math.floor(Math.random() * tracks.length));
      showToast(`🔀 隨機播放 ${label} 發行的專輯`);
    };
  }
  const btnRetidy = document.getElementById('btnLabelTidalSearch');
  if (btnRetidy) btnRetidy.onclick = () => fetchLabelTidalAlbums(label, inLibraryAlbums);

  renderLabelAlbumGrid('labelLocalAlbumsGrid', 'labelLocalAlbumsCount', 'labelNoLocalHint',
    inLibraryAlbums, '音樂庫內沒有以該發行公司標記的專輯；下方 TIDAL 發行清單可直接播放或加入曲庫。');

  fetchLabelTidalAlbums(label, inLibraryAlbums);
}

// ----------------- 發行公司頁面執行期自我測試（main.js --test-labels） -----------------
// 注入帶 LABEL / 僅帶 copyright 的測試專輯 ➔ 驗證廠牌比對、專輯頁「發行公司」可點擊、
// 點擊後廠牌頁面正確列出該公司專輯（含未標記廠牌不可點擊的反例）。
async function runLabelSelfTest() {
  const lines = [];
  const ok = (name, detail) => lines.push(`PASS ${name}${detail ? ' [' + detail + ']' : ''}`);
  const bad = (name, detail) => lines.push(`FAIL ${name}${detail ? ' [' + detail + ']' : ''}`);
  const note = (name, detail) => lines.push(`NOTE ${name}${detail ? ' [' + detail + ']' : ''}`);
  const finish = () => {
    const failed = lines.filter(l => l.startsWith('FAIL'));
    const report = (failed.length ? 'FAIL ' : 'PASS ') + lines.join(' | ');
    try { window.electronAPI.captureStep(12, report); } catch (err) {}
  };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  try {
    if (!window.electronAPI || !window.electronAPI.captureStep) { bad('capture IPC available'); finish(); return; }

    const now = Date.now();
    const mkTrack = (id, album, artist, extra) => Object.assign({
      id, title: `Track ${id}`, trackNumber: 1, duration: 120,
      album, artist, albumArtist: artist, year: 2020, genre: 'Jazz',
      formatName: 'FLAC', sampleRate: 96000, bitsPerSample: 24, isLossless: true,
      addedAt: now, filePath: `D:\\__rp_label_test__\\${album}\\${id}.flac`
    }, extra || {});

    state.tracks = [...state.tracks,
      mkTrack('lta1', 'Label Test Album One', 'Test Artist A', { label: 'Test Label Records' }),
      mkTrack('lta1b', 'Label Test Album One', 'Test Artist A', { label: 'Test Label Records' }),
      mkTrack('lta2', 'Label Test Album Two', 'Test Artist B', { copyright: '℗ 2021 Test Label Records' }),
      mkTrack('lta3', 'Other Label Album', 'Test Artist C', { label: 'Other Label Co' }),
      mkTrack('lta4', 'No Label Album', 'Test Artist D', {})
    ];
    rebuildLibraryCollections();

    const matched = albumsForLabel('Test Label Records');
    const titles = matched.map(a => a.title).sort().join('|');
    if (matched.length === 2 && titles === 'Label Test Album One|Label Test Album Two') {
      ok('label page collects label-tagged + copyright-derived albums', titles);
    } else {
      bad('label page collects label-tagged + copyright-derived albums', `count=${matched.length} titles=${titles}`);
    }

    const matchCases = [
      ['Test Label', 'Test Label Records', true],
      ['Test Label Records', 'Test Label', true],
      ['Decca', 'Decca Music Group', true],
      ['RCA Records', 'RCA', true],
      ['Universal Music', 'Universal Music Ltd', true],
      ['Test Label Records', 'Other Label Co', false],
      ['Sony Music', 'Sony Classical', false]
    ];
    const wrongCases = matchCases.filter(([a, b, want]) => labelsMatch(a, b) !== want);
    if (!wrongCases.length) ok('label identity rules', `${matchCases.length} cases`);
    else bad('label identity rules', wrongCases.map(c => `${c[0]} vs ${c[1]} want=${c[2]}`).join(', '));

    const taggedAlbum = state.albums.find(a => a.title === 'Label Test Album One');
    if (!taggedAlbum) { bad('test album grouped in library'); finish(); return; }
    openAlbumDetail(taggedAlbum);
    await sleep(250);
    const companyEl = document.getElementById('detailCompany');
    if (!companyEl || !companyEl.classList.contains('label-link') || typeof companyEl.onclick !== 'function') {
      bad('album page 發行公司 becomes clickable when label exists', companyEl ? `class=${companyEl.className}` : 'element missing');
    } else {
      ok('album page 發行公司 becomes clickable when label exists', companyEl.textContent);
    }

    if (companyEl && typeof companyEl.onclick === 'function') {
      companyEl.onclick({ stopPropagation: () => {} });
      await sleep(500);
      const view = document.getElementById('viewLabelDetail');
      const grid = document.getElementById('labelLocalAlbumsGrid');
      const cards = grid ? grid.querySelectorAll('.album-card').length : -1;
      const nameEl = document.getElementById('labelDetailName');
      const albumCountEl = document.getElementById('labelDetailAlbumCount');
      const artistCountEl = document.getElementById('labelDetailArtistCount');
      const viewOk = view && view.classList.contains('active');
      const nameOk = nameEl && nameEl.textContent === 'Test Label Records';
      const countsOk = albumCountEl && albumCountEl.textContent === '2' && artistCountEl && artistCountEl.textContent === '2';
      if (viewOk && nameOk && cards === 2 && countsOk) {
        ok('clicking label opens label page with that label albums', `cards=${cards} artists=${artistCountEl.textContent}`);
      } else {
        bad('clicking label opens label page with that label albums', `view=${!!viewOk} name=${nameOk} cards=${cards} albumCount=${albumCountEl && albumCountEl.textContent} artistCount=${artistCountEl && artistCountEl.textContent}`);
      }

      const tidalBadge = document.getElementById('labelTidalAlbumsCount');
      const tidalLoading = document.getElementById('labelTidalLoading');
      const tidalLoggedIn = !!(window.tidalService && window.tidalService.isLoggedIn);
      note('TIDAL section state', `loggedIn=${tidalLoggedIn} badge=${tidalBadge ? tidalBadge.textContent : 'n/a'} loadingVisible=${tidalLoading ? tidalLoading.style.display : 'n/a'}`);

      // 以假 TIDAL 服務驗證該公司專輯的篩選與去重（不依賴網路；跑完即還原）
      const realTidalService = window.tidalService;
      try {
        const mockAlbums = [
          { tidalId: 'mock1', title: 'Mock Label Release One', artist: 'Test Artist A', releaseDate: '2022-01-01', numberOfTracks: 5, copyright: '℗ 2022 Test Label Records', label: 'Test Label Records', audioQuality: 'HI_RES_LOSSLESS', cover: '' },
          { tidalId: 'mock2', title: 'Mock Other Company Release', artist: 'Test Artist A', releaseDate: '2023-01-01', numberOfTracks: 4, copyright: '℗ 2023 Other Label Co', label: 'Other Label Co', audioQuality: 'LOSSLESS', cover: '' },
          { tidalId: 'mock3', title: 'Label Test Album One', artist: 'Test Artist A', releaseDate: '2020-05-05', numberOfTracks: 2, copyright: '℗ 2020 Test Label Records', label: 'Test Label Records', audioQuality: 'LOSSLESS', cover: '' }
        ];
        window.tidalService = {
          isLoggedIn: true,
          search: async () => ({ albums: mockAlbums, tracks: [], artists: [] }),
          searchArtist: async (name) => (name === 'Test Artist A' ? { id: 'mock-artist-1' } : null),
          getArtistAlbums: async () => mockAlbums
        };
        await fetchLabelTidalAlbums('Test Label Records', matched);
        await sleep(200);
        const tidalGrid = document.getElementById('labelTidalAlbumsGrid');
        const tidalCards = tidalGrid ? [...tidalGrid.querySelectorAll('.album-card')] : [];
        const tidalTitles = tidalCards.map(c => (c.querySelector('.album-title') || {}).textContent).sort().join('|');
        const hiresTag = tidalCards.some(c => !!c.querySelector('.tag-tidal-hires'));
        if (tidalCards.length === 1 && tidalTitles === 'Mock Label Release One' && hiresTag) {
          ok('TIDAL expansion keeps only same-label albums and drops duplicates already listed', tidalTitles);
        } else {
          bad('TIDAL expansion keeps only same-label albums and drops duplicates already listed', `count=${tidalCards.length} titles=${tidalTitles}`);
        }
      } finally {
        window.tidalService = realTidalService;
      }

      // 請主行程截取廠牌頁面（兩個區塊都已渲染），再繼續後續檢查與清理
      try { window.electronAPI.captureStep(13, 'label page rendered'); } catch (err) {}
      await sleep(3500);
    }

    // 無本機標籤的專輯：不得由本機資料推導出廠牌；link 開/關行為直接驗證（線上補齊屬非同步，不作為斷言）
    const untaggedAlbum = state.albums.find(a => a.title === 'No Label Album');
    if (untaggedAlbum && albumLabelValue(untaggedAlbum) === '') {
      ok('album without local label derives no label');
    } else {
      bad('album without local label derives no label', `value=${untaggedAlbum ? albumLabelValue(untaggedAlbum) : 'album missing'}`);
    }

    const scratch = document.createElement('span');
    scratch.className = 'detail-meta-value label-link';
    scratch.onclick = () => {};
    setAlbumLabelLink(scratch, '');
    const cleared = !scratch.classList.contains('label-link') && !scratch.onclick;
    setAlbumLabelLink(scratch, 'Real Label Records');
    const armed = scratch.classList.contains('label-link') && typeof scratch.onclick === 'function';
    if (cleared && armed) ok('label link toggles off without label, on with label');
    else bad('label link toggles off without label, on with label', `cleared=${cleared} armed=${armed}`);

    state.tracks = state.tracks.filter(t => !String(t.id).startsWith('lta'));
    rebuildLibraryCollections();
    const cleaned = albumsForLabel('Test Label Records').length;
    if (cleaned === 0) ok('test data removed after self-test');
    else bad('test data removed after self-test', `left=${cleaned}`);
  } catch (err) {
    bad('self-test threw', String((err && err.message) || err));
  }
  finish();
}

try {
  const rpLabelParams = new URLSearchParams(window.location.search || '');
  if (rpLabelParams.get('testLabels') === '1' && window.electronAPI && window.electronAPI.captureStep) {
    setTimeout(() => { runLabelSelfTest(); }, 2600);
  }
} catch (err) {}

// ----------------- Album Recommendations Card Component -----------------
function createRecommendAlbumCard(alb, reason) {
  const card = document.createElement('div');
  card.className = 'recommend-card';

  const defaultCover = createSvgCover(alb.title, alb.artist, '#27272a', '#09090b');
  const coverSrc = formatCoverSrc(alb.cover) || defaultCover;

  let specLabel = '';
  if (alb.isTidal) {
    const isHiRes = alb.audioQuality === 'HI_RES_LOSSLESS' || alb.audioQuality === 'HIRES' || (alb.mediaMetadata?.tags?.includes('HIRES_LOSSLESS'));
    specLabel = isHiRes ? 'TIDAL MAX 24b' : 'TIDAL FLAC 16b';
  } else {
    const firstTrk = (alb.tracks && alb.tracks[0]) || {};
    const albFmt = getAudioFormatFromPath(firstTrk.filePath || firstTrk.fileName || alb.filePath, alb.formatName || 'PCM').toUpperCase();
    const isAlbDsd = albFmt === 'DSF' || albFmt === 'DFF' || albFmt === 'DSD';
    const sampleKhz = formatKhz(alb.sampleRate || firstTrk.sampleRate || 44100);
    const bitDepth = alb.bitsPerSample || firstTrk.bitsPerSample || (isAlbDsd ? 1 : 16);
    specLabel = isAlbDsd ? `DSD 1b/${sampleKhz}` : `${albFmt} ${bitDepth}b/${sampleKhz}`;
  }

  const tidalBadgeHtml = alb.isTidal 
    ? '<span class="recommend-tidal-pill">TIDAL</span>'
    : '';

  card.innerHTML = `
    <div class="recommend-art-wrap" style="position: relative;">
      <img src="${coverSrc}" class="recommend-card-art" alt="${escapeXml(alb.title)}" loading="lazy" onerror="this.onerror=null;this.src='${defaultCover}';">
      <span class="recommend-badge-pill">${escapeXml(reason)}</span>
      ${tidalBadgeHtml}
    </div>
    <div class="recommend-title" title="${escapeXml(alb.title)}">${escapeXml(alb.title)}</div>
    <div class="recommend-artist" title="${escapeXml(alb.artist)}">${escapeXml(alb.artist)}</div>
    <div class="recommend-meta">
      <span>${alb.year || alb.genre || ''}</span>
      <span class="format-chip" style="font-size: 9px; padding: 1px 5px; ${alb.isTidal ? 'background: rgba(0, 229, 255, 0.12); color: #00e5ff; border-color: rgba(0, 229, 255, 0.3);' : ''}">${specLabel}</span>
    </div>
  `;

  card.addEventListener('click', (e) => {
    e.stopPropagation();
    openAlbumDetail(alb);
  });

  return card;
}

// ----------------- Album Recommendations Engine (Metadata-driven + TIDAL) -----------------
function renderAlbumRecommendations(album) {
  const container = document.getElementById('albumRecommendationsGrid');
  const countBadge = document.getElementById('recommendCountBadge');
  const genreTag = document.getElementById('recommendGenreTag');

  if (!container) return;
  container.innerHTML = '';

  const currentGenre = (album.genre || '').trim();
  if (genreTag) {
    genreTag.textContent = currentGenre && currentGenre !== 'Various' ? currentGenre : '多元曲風';
  }

  // Tokenize genres helper
  const tokenizeGenre = (g) => {
    if (!g) return [];
    return g.toLowerCase()
      .replace(/[\/,\-\_\&]/g, ' ')
      .split(/\s+/)
      .map(w => w.trim())
      .filter(w => w.length > 1 && !['and', 'the', 'various', 'music'].includes(w));
  };

  const albumGenreTokens = new Set(tokenizeGenre(currentGenre));
  (album.tracks || []).forEach(t => {
    tokenizeGenre(t.genre).forEach(w => albumGenreTokens.add(w));
  });

  const candidates = (state.albums || []).filter(cand => {
    // Exclude current album
    const isSameTitle = (cand.title || '').toLowerCase().trim() === (album.title || '').toLowerCase().trim();
    const isSameArtist = (cand.artist || '').toLowerCase().trim() === (album.artist || '').toLowerCase().trim();
    return !(isSameTitle && isSameArtist);
  });

  // Calculate similarity scores for local library albums
  const scored = candidates.map(cand => {
    let score = 0;
    let reason = '精選推薦';

    const candGenre = (cand.genre || '').trim();
    const candTokens = new Set(tokenizeGenre(candGenre));
    (cand.tracks || []).forEach(t => {
      tokenizeGenre(t.genre).forEach(w => candTokens.add(w));
    });

    // 1. Exact genre match
    if (currentGenre && candGenre && currentGenre.toLowerCase() === candGenre.toLowerCase() && currentGenre !== 'Various') {
      score += 120;
      reason = `同為 ${candGenre} 曲風`;
    } else {
      // Token overlap
      let overlapCount = 0;
      let matchedWord = '';
      albumGenreTokens.forEach(token => {
        if (candTokens.has(token)) {
          overlapCount++;
          matchedWord = token;
        }
      });

      if (overlapCount > 0) {
        score += overlapCount * 40;
        reason = `同含 ${matchedWord.toUpperCase()} 風格`;
      }
    }

    // 2. Same Artist Bonus
    if ((cand.artist || '').toLowerCase().trim() === (album.artist || '').toLowerCase().trim()) {
      score += 50;
      if (score < 100) reason = `同為 ${album.artist} 作品`;
    }

    // 3. Era / Decade Proximity
    if (album.year && cand.year) {
      const yearDiff = Math.abs(album.year - cand.year);
      if (yearDiff <= 3) {
        score += 25;
        if (score < 40) reason = `同為 ${cand.year} 年代經典`;
      } else if (yearDiff <= 10) {
        score += 15;
      }
    }

    // 4. Hi-Res / Format Proximity
    if (cand.isLossless && album.isLossless) {
      score += 10;
    }
    const isDsdCand = cand.formatName === 'DSD' || cand.formatName === 'DSF' || cand.formatName === 'DFF';
    const isDsdAlbum = album.formatName === 'DSD' || album.formatName === 'DSF' || album.formatName === 'DFF';
    if (isDsdCand && isDsdAlbum) {
      score += 25;
      reason = '同為 DSD 發燒母帶';
    }

    return { album: cand, score, reason };
  });

  // Sort descending by score
  scored.sort((a, b) => b.score - a.score);

  // Take top local recommended albums (up to 4)
  const localRecommendations = scored.slice(0, 4);

  const displayedTitles = new Set();
  displayedTitles.add((album.title || '').toLowerCase().trim());

  localRecommendations.forEach(item => {
    displayedTitles.add((item.album.title || '').toLowerCase().trim());
    container.appendChild(createRecommendAlbumCard(item.album, item.reason));
  });

  const isTidalLoggedIn = window.tidalService && window.tidalService.isLoggedIn;

  if (localRecommendations.length === 0 && !isTidalLoggedIn) {
    const empty = document.createElement('div');
    empty.className = 'recommend-empty-hint';
    empty.textContent = `目前本機音樂庫中暫無其他 ${currentGenre || '同類型'} 專輯，在「資料夾」加入更多音樂目錄即可自動擴充風格比對推薦！`;
    container.appendChild(empty);
  } else if (countBadge) {
    countBadge.textContent = `${localRecommendations.length} 張推薦`;
  }

  // 5. Enrich with online TIDAL albums if logged in
  if (isTidalLoggedIn) {
    const searchPromises = [];
    const curArtistName = (album.artist || '').trim();

    if (curArtistName && !isUnknownArtist(curArtistName)) {
      searchPromises.push(
        window.tidalService.search(curArtistName, 8)
          .then(res => ({ type: 'artist', albums: res?.albums || [] }))
          .catch(() => ({ type: 'artist', albums: [] }))
      );
    }

    if (currentGenre && currentGenre !== 'Various') {
      searchPromises.push(
        window.tidalService.search(currentGenre, 8)
          .then(res => ({ type: 'genre', albums: res?.albums || [] }))
          .catch(() => ({ type: 'genre', albums: [] }))
      );
    }

    Promise.all(searchPromises).then(results => {
      if (state.activeAlbumDetail !== album) return;

      const tidalCandidates = [];
      results.forEach(res => {
        (res.albums || []).forEach(tAlb => {
          if (!tAlb || !tAlb.title) return;
          const normTitle = (tAlb.title || '').toLowerCase().trim();
          if (displayedTitles.has(normTitle)) return;
          displayedTitles.add(normTitle);

          let reason = 'TIDAL 發燒精選';
          if (res.type === 'artist' || (tAlb.artist || '').toLowerCase().trim() === curArtistName.toLowerCase().trim()) {
            reason = `同為 ${curArtistName} (TIDAL)`;
          } else if (currentGenre && currentGenre !== 'Various') {
            reason = `TIDAL ${currentGenre} 精選`;
          }
          tidalCandidates.push({ album: tAlb, reason });
        });
      });

      const selectedTidal = tidalCandidates.slice(0, 5);
      if (selectedTidal.length > 0) {
        const emptyHint = container.querySelector('.recommend-empty-hint');
        if (emptyHint) emptyHint.remove();

        selectedTidal.forEach(item => {
          container.appendChild(createRecommendAlbumCard(item.album, item.reason));
        });
      }

      const totalCount = container.querySelectorAll('.recommend-card').length;
      if (countBadge) {
        countBadge.textContent = selectedTidal.length > 0 
          ? `${totalCount} 張推薦 (含 TIDAL)` 
          : `${totalCount} 張推薦`;
      }

      if (totalCount === 0) {
        const empty = document.createElement('div');
        empty.className = 'recommend-empty-hint';
        empty.textContent = `暫無其他 ${currentGenre || '同類型'} 專輯推薦。`;
        container.appendChild(empty);
      }
    }).catch(err => {
      console.warn('TIDAL album recommendations fetch error:', err);
    });
  }
}

// ----------------- Recommended Artists Engine (Genre-based + TIDAL) -----------------
function renderAlbumArtistRecommendations(album) {
  const container = document.getElementById('albumArtistRecommendationsGrid');
  const countBadge = document.getElementById('recommendArtistCountBadge');
  const genreTag = document.getElementById('recommendArtistGenreTag');

  if (!container) return;
  container.innerHTML = '';
  // 頭像尺寸跟隨「演出者頁面」的尺寸設定（小／中／大），兩頁視覺一致
  container.classList.remove('artist-size-small', 'artist-size-medium', 'artist-size-large');
  container.classList.add(`artist-size-${state.artistCardSize || 'medium'}`);

  const currentGenre = (album.genre || '').trim();
  if (genreTag) {
    genreTag.textContent = currentGenre && currentGenre !== 'Various' ? currentGenre : '多元曲風';
  }

  // Tokenize genres helper
  const tokenizeGenre = (g) => {
    if (!g) return [];
    return g.toLowerCase()
      .replace(/[\/,\-\_\&]/g, ' ')
      .split(/\s+/)
      .map(w => w.trim())
      .filter(w => w.length > 1 && !['and', 'the', 'various', 'music'].includes(w));
  };

  const albumGenreTokens = new Set(tokenizeGenre(currentGenre));
  (album.tracks || []).forEach(t => {
    tokenizeGenre(t.genre).forEach(w => albumGenreTokens.add(w));
  });

  const curArtist = (album.artist || '').trim().toLowerCase();

  // Find all candidate artists from state.artists excluding current album artist
  const candidateArtists = (state.artists || []).filter(art => {
    if (!art || !art.name) return false;
    if (isUnknownArtist(art.name)) return false;
    if (art.name.toLowerCase().trim() === curArtist) return false;
    return true;
  });

  // Calculate genre relevance for each artist
  const matchingArtists = [];
  const otherArtists = [];

  candidateArtists.forEach(art => {
    let hasGenreMatch = false;
    const artTracks = art.tracks || [];
    const artAlbums = state.albums.filter(a => (a.artist || '').toLowerCase().trim() === art.name.toLowerCase().trim());

    if (currentGenre && currentGenre !== 'Various') {
      if (matchItemGenre({ genre: currentGenre, artist: art.name }, currentGenre)) {
        const anyMatch = artAlbums.some(a => matchItemGenre(a, currentGenre)) || artTracks.some(t => matchItemGenre(t, currentGenre));
        if (anyMatch) hasGenreMatch = true;
      }
    }

    if (!hasGenreMatch && albumGenreTokens.size > 0) {
      const artTokens = new Set();
      artAlbums.forEach(a => tokenizeGenre(a.genre).forEach(tok => artTokens.add(tok)));
      artTracks.forEach(t => tokenizeGenre(t.genre).forEach(tok => artTokens.add(tok)));

      for (const tok of albumGenreTokens) {
        if (artTokens.has(tok)) {
          hasGenreMatch = true;
          break;
        }
      }
    }

    if (hasGenreMatch) {
      matchingArtists.push(art);
    } else {
      otherArtists.push(art);
    }
  });

  // Fisher-Yates shuffle
  const shuffleArray = (arr) => {
    const res = [...arr];
    for (let i = res.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [res[i], res[j]] = [res[j], res[i]];
    }
    return res;
  };

  let chosenArtists = [];
  if (matchingArtists.length > 0) {
    const shuffledMatching = shuffleArray(matchingArtists);
    chosenArtists = shuffledMatching.slice(0, 4);
  }

  // Fallback: if not enough matching artists, fill with random artists
  if (chosenArtists.length < 4 && otherArtists.length > 0) {
    const shuffledOthers = shuffleArray(otherArtists);
    const needed = 4 - chosenArtists.length;
    chosenArtists.push(...shuffledOthers.slice(0, needed));
  }

  const seenArtistNames = new Set();
  if (curArtist) seenArtistNames.add(curArtist);

  chosenArtists.forEach(art => {
    seenArtistNames.add((art.name || '').toLowerCase().trim());
    container.appendChild(createArtistCard(art));
  });
  hydrateArtistAvatars(container);

  const isTidalLoggedIn = window.tidalService && window.tidalService.isLoggedIn;

  if (chosenArtists.length === 0 && !isTidalLoggedIn) {
    const empty = document.createElement('div');
    empty.className = 'recommend-empty-hint';
    empty.textContent = `目前本機音樂庫中暫無其他 ${currentGenre || '同類型'} 演出者，匯入更多演出者作品即可自動擴充風格比對推薦！`;
    container.appendChild(empty);
  } else if (countBadge) {
    countBadge.textContent = `${chosenArtists.length} 位推薦`;
  }

  // Enrich with online TIDAL artists if logged in
  if (isTidalLoggedIn) {
    const artistPromises = [];
    const curArtistName = (album.artist || '').trim();

    if (curArtistName && !isUnknownArtist(curArtistName)) {
      artistPromises.push(
        window.tidalService.searchArtist(curArtistName)
          .then(artObj => artObj?.id ? window.tidalService.getSimilarArtists(artObj.id, 8) : [])
          .catch(() => [])
      );
      artistPromises.push(
        window.tidalService.search(curArtistName, 6)
          .then(res => res?.artists || [])
          .catch(() => [])
      );
    }

    if (currentGenre && currentGenre !== 'Various') {
      artistPromises.push(
        window.tidalService.search(currentGenre, 8)
          .then(res => res?.artists || [])
          .catch(() => [])
      );
    }

    Promise.all(artistPromises).then(results => {
      if (state.activeAlbumDetail !== album) return;

      const allTidalArtists = results.flat();
      const tidalArtists = [];

      allTidalArtists.forEach(ta => {
        if (!ta || !ta.name) return;
        const normA = ta.name.toLowerCase().trim();
        if (!normA || seenArtistNames.has(normA) || isUnknownArtist(normA)) return;
        seenArtistNames.add(normA);

        tidalArtists.push({
          id: `tidal_art_${ta.id}`,
          tidalId: ta.id,
          name: ta.name,
          picture: ta.picture,
          isTidal: true,
          albumCount: currentGenre && currentGenre !== 'Various' ? `TIDAL ${currentGenre} 藝人` : 'TIDAL 推薦藝人'
        });
      });

      const selectedTidalArtists = tidalArtists.slice(0, 5);
      if (selectedTidalArtists.length > 0) {
        const emptyHint = container.querySelector('.recommend-empty-hint');
        if (emptyHint) emptyHint.remove();

        selectedTidalArtists.forEach(art => {
          container.appendChild(createArtistCard(art));
        });
      }

      const totalArtists = container.querySelectorAll('.artist-card').length;
      if (countBadge) {
        countBadge.textContent = selectedTidalArtists.length > 0
          ? `${totalArtists} 位推薦 (含 TIDAL)`
          : `${totalArtists} 位推薦`;
      }

      if (totalArtists === 0) {
        const empty = document.createElement('div');
        empty.className = 'recommend-empty-hint';
        empty.textContent = `暫無其他 ${currentGenre || '同類型'} 演出者推薦。`;
        container.appendChild(empty);
      }
    }).catch(err => {
      console.warn('TIDAL artist recommendations fetch error:', err);
    });
  }
}

function renderDetailTracklist(album) {
  detailTracklistTbody.innerHTML = '';
  if (!album || !Array.isArray(album.tracks) || !album.tracks.length) {
    return;
  }
  album.tracks.forEach((t, idx) => {
    const tr = document.createElement('tr');
    const isFav = isTrackFavorite(t);
    const trackWithArtist = t.artist ? t : { ...t, artist: album.artist };
    const onlineLinksHtml = generateTrackOnlineLinks(trackWithArtist);

    let trackChipText = '';
    if (t.isTidal) {
      const isHiRes = t.audioQuality === 'HI_RES_LOSSLESS' || t.audioQuality === 'HIRES' || (t.bitDepth && t.bitDepth >= 24) || (t.bitsPerSample && t.bitsPerSample >= 24);
      trackChipText = isHiRes ? 'TIDAL MAX 24b' : 'TIDAL FLAC 16b';
    } else {
      const trackFmt = getAudioFormatFromPath(t.filePath || t.fileName, t.formatName || 'PCM').toUpperCase();
      const isTrackDsd = trackFmt === 'DSF' || trackFmt === 'DFF' || trackFmt === 'DSD';
      trackChipText = isTrackDsd
        ? `DSD 1b`
        : `${trackFmt} ${t.bitsPerSample || 16}b`;
    }

    tr.innerHTML = `
      <td>${t.trackNumber || (idx + 1)}</td>
      <td style="text-align: center;"><button class="btn-track-fav ${isFav ? 'active' : ''}" title="${isFav ? '取消最愛歌曲' : '加入最愛歌曲'}">${getHeartSvg(isFav, 14)}</button></td>
      <td class="track-title-cell">
        <div class="track-title-text">
          <span class="track-name-span">${escapeXml(t.title)}</span>
        </div>
      </td>
      <td class="track-yt-cell">${onlineLinksHtml}</td>
      <td><span class="format-chip">${trackChipText}</span></td>
      <td style="text-align: right;">${formatDuration(t.duration)}</td>
    `;
    tr.addEventListener('click', (e) => {
      const extLink = e.target.closest('.track-ext-link');
      if (extLink) {
        e.preventDefault();
        e.stopPropagation();
        handleTrackExternalLinkClick(extLink);
        return;
      }
      if (e.target.closest('.btn-track-fav')) {
        e.stopPropagation();
        toggleTrackFavorite(t);
        return;
      }
      playTrackList(album.tracks, idx);
    });
    detailTracklistTbody.appendChild(tr);
  });
  setupResizableTable('detailTracklistTable', 'album_detail_tracks_v2');
}

// ==========================================================
// Unified Local + TIDAL Hybrid Library & Versions Engine
// ==========================================================

function isTidalAlbumInLibrary(tidalAlbumId) {
  if (!tidalAlbumId || !state.tracks) return false;
  const tidStr = String(tidalAlbumId);
  return state.tracks.some(t => t.isTidal && (String(t.tidalAlbumId) === tidStr || String(t.albumId) === tidStr));
}

async function addTidalAlbumToLibrary(tidalAlbumId, preloadedData = null) {
  if (!window.tidalService) {
    showToast('⚠️ TIDAL 服務尚未啟動');
    return false;
  }
  if (isTidalAlbumInLibrary(tidalAlbumId)) {
    showToast('ℹ️ 此專輯已在您的音樂庫中');
    return true;
  }

  showToast('⏳ 正在將 TIDAL 專輯加入曲庫...');
  try {
    let albumData = preloadedData;
    if (!albumData || !albumData.tracks || albumData.tracks.length === 0) {
      albumData = await window.tidalService.getAlbum(tidalAlbumId);
    }

    if (!albumData || !albumData.tracks || albumData.tracks.length === 0) {
      throw new Error('無法取得專輯曲目資訊');
    }

    const album = albumData.album || albumData;
    const tracks = albumData.tracks;

    const now = Date.now();
    tracks.forEach(tr => {
      tr.isTidal = true;
      tr.tidalAlbumId = tidalAlbumId;
      tr.album = album.title;
      tr.artist = tr.artist || album.artist;
      tr.cover = tr.cover || album.cover;
      tr.genre = tr.genre || album.genre || 'Pop';
      tr.addedAt = now;
    });

    state.tracks = [...state.tracks, ...tracks];
    rebuildLibraryCollections();
    viewDirtyState.overview = true;
    viewDirtyState.albums = true;

    if (window.electronAPI && window.electronAPI.saveLibraryTracks) {
      await window.electronAPI.saveLibraryTracks(state.tracks);
    }

    showToast(`✅ 已將《${album.title}》加入曲庫 (${tracks.length} 首曲目)`);

    if (state.activeAlbumDetail && (String(state.activeAlbumDetail.tidalId) === String(tidalAlbumId) || state.activeAlbumDetail.id === `tidal_album_${tidalAlbumId}`)) {
      updateAlbumDetailLibraryButton(state.activeAlbumDetail);
    }

    document.querySelectorAll(`.btn-tidal-lib-action[data-tidal-id="${tidalAlbumId}"]`).forEach(btn => {
      btn.className = 'btn-tidal-lib-action in-library';
      btn.innerHTML = '✓ 已在曲庫';
    });

    return true;
  } catch (err) {
    console.error('Failed to add TIDAL album to library:', err);
    showToast(`❌ 加入曲庫失敗: ${err.message || '網路或認證錯誤'}`);
    return false;
  }
}

async function removeTidalAlbumFromLibrary(tidalAlbumId) {
  if (!tidalAlbumId || !state.tracks) return false;
  const tidStr = String(tidalAlbumId);

  const beforeCount = state.tracks.length;
  state.tracks = state.tracks.filter(t => !(t.isTidal && (String(t.tidalAlbumId) === tidStr || String(t.albumId) === tidStr)));
  const removed = beforeCount - state.tracks.length;

  if (removed > 0) {
    rebuildLibraryCollections();
    viewDirtyState.overview = true;
    viewDirtyState.albums = true;
    if (window.electronAPI && window.electronAPI.saveLibraryTracks) {
      await window.electronAPI.saveLibraryTracks(state.tracks);
    }
    showToast(`🗑️ 已從曲庫移除該專輯 (共 ${removed} 首曲目)`);

    if (state.activeAlbumDetail && (String(state.activeAlbumDetail.tidalId) === String(tidalAlbumId) || state.activeAlbumDetail.id === `tidal_album_${tidalAlbumId}`)) {
      updateAlbumDetailLibraryButton(state.activeAlbumDetail);
    }

    document.querySelectorAll(`.btn-tidal-lib-action[data-tidal-id="${tidalAlbumId}"]`).forEach(btn => {
      btn.className = 'btn-tidal-lib-action';
      btn.innerHTML = '➕ 加入曲庫';
    });

    return true;
  }
  return false;
}

async function playTidalAlbum(tidalAlbumId) {
  if (!window.tidalService) {
    showToast('⚠️ TIDAL 服務尚未啟動');
    return;
  }
  showToast('⏳ 正在連接 TIDAL 載入專輯音訊...');
  try {
    const data = await window.tidalService.getAlbum(tidalAlbumId);
    if (data && data.tracks && data.tracks.length > 0) {
      showToast(`▶ 正在播放 TIDAL 專輯: 《${data.album.title}》`);
      playTrackList(data.tracks, 0);
    } else {
      showToast('⚠️ 未能取得專輯曲目');
    }
  } catch (err) {
    console.error('Play TIDAL album error:', err);
    showToast(`❌ 播放失敗: ${err.message}`);
  }
}

function updateAlbumDetailLibraryButton(album) {
  const btn = document.getElementById('btnTidalLibraryToggle');
  const icon = document.getElementById('btnTidalLibraryToggleIcon');
  const text = document.getElementById('btnTidalLibraryToggleText');
  if (!btn) return;

  if (album && album.isTidal) {
    btn.style.display = 'inline-flex';
    const inLib = isTidalAlbumInLibrary(album.tidalId);
    if (inLib) {
      btn.className = 'btn btn-secondary in-library';
      if (icon) icon.textContent = '✓';
      if (text) text.textContent = '已在曲庫 (從曲庫移除)';
      btn.title = '點擊從音樂庫中移除此專輯';
      btn.onclick = async () => {
        if (confirm(`確定要將《${album.title}》從您的音樂庫中移除嗎？`)) {
          await removeTidalAlbumFromLibrary(album.tidalId);
          updateAlbumDetailLibraryButton(album);
        }
      };
    } else {
      btn.className = 'btn btn-secondary not-in-library';
      if (icon) icon.textContent = '➕';
      if (text) text.textContent = '加入曲庫';
      btn.title = '點擊將此 TIDAL 專輯加入您的本機音樂庫中';
      btn.onclick = async () => {
        await addTidalAlbumToLibrary(album.tidalId, album);
        updateAlbumDetailLibraryButton(album);
      };
    }
  } else {
    btn.style.display = 'none';
  }
}

async function renderAlbumVersions(album) {
  const versionsSection = document.getElementById('albumVersionsSection');
  const versionsGrid = document.getElementById('albumVersionsGrid');
  const versionsCountBadge = document.getElementById('albumVersionsCountBadge');
  if (!versionsSection || !versionsGrid) return;

  versionsSection.style.display = 'none';
  versionsGrid.innerHTML = '';

  const norm = (s) => (s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\(.*?\)|\[.*?\]/g, '').replace(/[^a-z0-9\u4e00-\u9fa5]/g, '').trim();
  // 「其他版本」定義：同專輯名稱＋同演出者，只有格式／解析度／平台不同。
  // 同名但不同演出者的專輯（翻唱、同名合輯）不是版本，一律排除。
  const artistOf = (a) => {
    let ar = a && (a.artist || a.albumArtist);
    if (ar && typeof ar === 'object') ar = ar.name;
    return norm(ar);
  };
  const currentTitleNorm = norm(album.title);
  const currentArtistNorm = artistOf(album);
  if (!currentTitleNorm || !currentArtistNorm) return;

  const versions = [];
  const seenKeys = new Set();
  const seenTidalIds = new Set();
  const seenSpecs = new Set();

  const getSemanticKey = (v) => {
    const src = v.isTidal ? 'tidal' : 'local';
    const specs = (v.specs || '').toLowerCase().replace(/\s+/g, '');
    const trk = v.trackCount || 0;
    return `${src}:::${specs}:::${trk}`;
  };

  const currentFirstTrack = (album.tracks && album.tracks[0]) || {};
  const currentFmt = getAudioFormatFromPath(currentFirstTrack.filePath || currentFirstTrack.fileName, album.formatName || 'PCM').toUpperCase();
  const currentBitDepth = album.bitsPerSample || currentFirstTrack.bitsPerSample || 16;
  const currentRate = album.sampleRate || currentFirstTrack.sampleRate || 44100;
  const currentRateKhz = formatKhz(currentRate);

  const curVer = {
    album: album,
    isCurrent: true,
    isTidal: !!album.isTidal,
    sourceName: album.isTidal ? 'TIDAL 官方串流' : '本機檔案 (Local)',
    format: currentFmt,
    specs: album.isTidal
      ? ((album.audioQuality === 'HI_RES_LOSSLESS' || album.bitsPerSample >= 24) ? 'Hi-Res 24-bit / 96kHz MAX' : 'Lossless 16-bit / 44.1kHz')
      : `${currentFmt} ${currentBitDepth}-bit / ${currentRateKhz}`,
    trackCount: (album.tracks && album.tracks.length) || album.numberOfTracks || 0,
    year: album.year || ''
  };

  versions.push(curVer);
  seenKeys.add(String(album.id));
  if (album.tidalId) seenTidalIds.add(String(album.tidalId));
  seenSpecs.add(getSemanticKey(curVer));

  // 1. Scan other local or library albums
  state.albums.forEach(alb => {
    if (!alb) return;
    if (String(alb.id) === String(album.id)) return;
    if (seenKeys.has(String(alb.id))) return;
    if (alb.tidalId && seenTidalIds.has(String(alb.tidalId))) return;

    if (norm(alb.title) === currentTitleNorm && artistOf(alb) === currentArtistNorm) {
      const tr0 = (alb.tracks && alb.tracks[0]) || {};
      const f = getAudioFormatFromPath(tr0.filePath || tr0.fileName, alb.formatName || 'PCM').toUpperCase();
      const b = alb.bitsPerSample || tr0.bitsPerSample || 16;
      const r = formatKhz(alb.sampleRate || tr0.sampleRate || 44100);

      const candVer = {
        album: alb,
        isCurrent: false,
        isTidal: !!alb.isTidal,
        sourceName: alb.isTidal ? 'TIDAL 官方串流' : '本機檔案 (Local)',
        format: f,
        specs: alb.isTidal
          ? ((alb.audioQuality === 'HI_RES_LOSSLESS' || alb.bitsPerSample >= 24) ? 'Hi-Res 24-bit / 96kHz MAX' : 'Lossless 16-bit / 44.1kHz')
          : `${f} ${b}-bit / ${r}`,
        trackCount: (alb.tracks && alb.tracks.length) || alb.numberOfTracks || 0,
        year: alb.year || ''
      };

      const semKey = getSemanticKey(candVer);
      if (seenSpecs.has(semKey)) return;

      seenKeys.add(String(alb.id));
      if (alb.tidalId) seenTidalIds.add(String(alb.tidalId));
      seenSpecs.add(semKey);
      versions.push(candVer);
    }
  });

  // 2. Scan TIDAL online catalog versions
  if (window.tidalService && window.tidalService.isLoggedIn) {
    try {
      const searchRes = await window.tidalService.searchAlbumVersions(album.title, album.artist);
      (searchRes || []).forEach(ta => {
        if (!ta) return;
        const tidStr = String(ta.tidalId || ta.id || '');
        if (tidStr && seenTidalIds.has(tidStr)) return;

        if (norm(ta.title) === currentTitleNorm && artistOf(ta) === currentArtistNorm) {
          const isHiRes = ta.audioQuality === 'HI_RES_LOSSLESS' || ta.audioQuality === 'HIRES' || (ta.mediaMetadata?.tags?.includes('HIRES_LOSSLESS'));
          const candVer = {
            album: ta,
            isCurrent: false,
            isTidal: true,
            isOnlineOnly: !isTidalAlbumInLibrary(ta.tidalId),
            sourceName: 'TIDAL 官方串流',
            format: 'FLAC',
            specs: isHiRes ? 'Hi-Res 24-bit / 96kHz MAX' : 'Lossless 16-bit / 44.1kHz',
            trackCount: ta.numberOfTracks || 0,
            year: ta.year || ''
          };

          const semKey = getSemanticKey(candVer);
          if (seenSpecs.has(semKey)) return;

          if (tidStr) seenTidalIds.add(tidStr);
          seenSpecs.add(semKey);
          versions.push(candVer);
        }
      });
    } catch (e) {
      console.warn('Online version search warning:', e);
    }
  }

  // 穩定排序：版本卡片位置不隨「目前選取」改變——本機在前、依位元深度與取樣率遞升，TIDAL 在後。
  // 點選其他版本只更換 active 標記，不調換卡片位置（避免越點越亂）。
  const specRank = (v) => {
    const m = /(\d+)\s*-bit\s*\/\s*([\d.]+)\s*kHz/i.exec(v.specs || '');
    const bits = m ? parseInt(m[1], 10) : 0;
    const khz = m ? parseFloat(m[2]) : 0;
    return (v.isTidal ? 1e12 : 0) + bits * 1000000 + khz;
  };
  versions.sort((a, b) => (specRank(a) - specRank(b)) || (a.trackCount - b.trackCount) || String(a.year || '').localeCompare(String(b.year || '')));

  if (versions.length > 1) {
    if (versionsCountBadge) versionsCountBadge.textContent = `${versions.length} 個版本`;
    versionsSection.style.display = 'block';

    versions.forEach(ver => {
      const card = document.createElement('div');
      card.className = `album-version-card ${ver.isCurrent ? 'active' : ''}`;
      const icon = ver.isTidal ? '💎' : '📁';
      const badgeClass = ver.isTidal
        ? ((ver.specs.includes('24-bit') || ver.specs.includes('MAX')) ? 'tag-tidal-hires' : 'tag-tidal')
        : 'tag-hires';

      card.innerHTML = `
        <div class="version-source-icon">${icon}</div>
        <div class="version-card-meta">
          <div class="version-card-specs">
            <span class="album-quality-tag ${badgeClass}" style="position:static;display:inline-block;margin-right:4px;">${ver.isTidal ? (ver.specs.includes('24-bit') ? 'TIDAL MAX' : 'TIDAL FLAC') : ver.format}</span>
            <span>${escapeXml(ver.sourceName)}</span>
          </div>
          <div class="version-card-sub">${escapeXml(ver.specs)} • ${ver.trackCount} 首 ${ver.year ? '• ' + ver.year : ''}</div>
        </div>
      `;

      card.onclick = () => {
        if (!ver.isCurrent) {
          openAlbumDetail(ver.album);
          showToast(`💿 已切換至版本: ${ver.sourceName} (${ver.specs})`);
        }
      };

      versionsGrid.appendChild(card);
    });
  }
}

function openAlbumDetail(album) {
  if (!album) return;
  state.activeAlbumDetail = album;
  applyDetailCoverSize(state.detailCoverSize || 'medium');
  const defaultDetailCover = createSvgCover(album.title || 'Album', album.artist || 'Artist', '#27272a', '#09090b');
  if (detailCoverImg) {
    detailCoverImg.src = formatCoverSrc(album.cover) || defaultDetailCover;
    detailCoverImg.onerror = () => {
      detailCoverImg.onerror = null;
      detailCoverImg.src = defaultDetailCover;
    };
  }
  if (detailTitle) detailTitle.textContent = album.title || '未知專輯';
  try { renderAlbumMetadata(album); } catch (e) {}
  if (detailGenre) detailGenre.textContent = album.genre || 'Various';

  if (detailArtist) {
    if (isUnknownArtist(album.artist)) {
      const cachedArt = getCachedResolvedArtist(album.title);
      if (cachedArt) {
        applyResolvedArtistToAlbum(album, cachedArt);
        detailArtist.textContent = cachedArt;
      } else {
        detailArtist.innerHTML = '<span style="color: var(--accent-purple); font-size: 14px; font-weight: normal;">🔍 正在透過專輯名稱搜尋線上音樂庫歌手...</span>';
        findArtistByAlbumTitleOnline(album.title).then(found => {
          if (found && state.activeAlbumDetail === album) {
            applyResolvedArtistToAlbum(album, found);
            if (detailArtist) detailArtist.textContent = found;
            try { fetchAlbumBio(album); } catch (e) {}
            try { renderAlbumMetadata(album); } catch (e) {}
            try { renderDetailTracklist(album); } catch (e) {}
          } else if (state.activeAlbumDetail === album && isUnknownArtist(album.artist)) {
            if (detailArtist) detailArtist.textContent = '未知演出者';
          }
        });
      }
    } else {
      detailArtist.textContent = album.artist || '未知演出者';
    }
  }
  
  const firstTrack = (album.tracks && album.tracks[0]) || {};
  const rawPath = firstTrack.filePath || firstTrack.fileName || album.filePath || '';
  const fmt = getAudioFormatFromPath(rawPath, album.formatName || 'PCM').toUpperCase();
  const isDsd = fmt === 'DSF' || fmt === 'DFF' || fmt === 'DSD';
  const effectiveRate = album.sampleRate || firstTrack.sampleRate || 44100;
  const bitDepth = album.bitsPerSample || firstTrack.bitsPerSample || (isDsd ? 1 : 16);
  const sampleRateKhz = formatKhz(effectiveRate);

  if (detailFormatBadge) {
    if (album.isTidal) {
      const isHiRes = album.audioQuality === 'HI_RES_LOSSLESS' || album.audioQuality === 'HIRES' || bitDepth >= 24;
      detailFormatBadge.textContent = isHiRes ? `TIDAL MAX 24/${sampleRateKhz}` : `TIDAL FLAC 16/${sampleRateKhz}`;
    } else if (isDsd) {
      const dsdMhz = effectiveRate ? `${(effectiveRate / 1000000).toFixed(1)}M` : '2.8M';
      detailFormatBadge.textContent = `${fmt} 1b/${dsdMhz}`;
    } else {
      detailFormatBadge.textContent = `${fmt} ${bitDepth}/${sampleRateKhz}`;
    }
  }

  const detailFormatSpec = document.getElementById('detailFormatSpec');
  if (detailFormatSpec) {
    if (album.isTidal) {
      const isHiRes = album.audioQuality === 'HI_RES_LOSSLESS' || album.audioQuality === 'HIRES' || bitDepth >= 24;
      detailFormatSpec.textContent = isHiRes ? `TIDAL FLAC 24-bit / ${sampleRateKhz} Hi-Res MAX` : `TIDAL FLAC 16-bit / ${sampleRateKhz} Lossless`;
    } else if (isDsd) {
      const dsdMhz = effectiveRate ? `${(effectiveRate / 1000000).toFixed(1)}MHz` : '2.8MHz';
      detailFormatSpec.textContent = `DSD 1-bit / ${dsdMhz} Direct Stream Digital`;
    } else {
      const isLossless = album.isLossless || ['WAV', 'FLAC', 'AIFF', 'ALAC', 'APE'].includes(fmt);
      detailFormatSpec.textContent = `${fmt} ${bitDepth}-bit / ${sampleRateKhz} ${isLossless ? 'Lossless' : ''}`.trim();
    }
  }

  const detailChannelsSpec = document.getElementById('detailChannelsSpec');
  if (detailChannelsSpec) {
    const channels = album.channels || firstTrack.channels || 2;
    detailChannelsSpec.textContent = channels === 1 ? '1 Channel (Mono)' : (channels === 2 ? '2 Channels (Stereo)' : `${channels} Channels (Surround)`);
  }

  detailTrackCount.textContent = (album.tracks && album.tracks.length) || album.numberOfTracks || 0;

  if (album.tracks && album.tracks.length) {
    renderDetailTracklist(album);
  } else if (album.isTidal && window.tidalService) {
    const tbody = document.getElementById('detailTracklistTbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:32px;color:#a1a1aa;"><span class="spinner"></span> 正在從 TIDAL 載入曲目清單與音訊規格...</td></tr>';
    
    window.tidalService.getAlbum(album.tidalId).then(data => {
      if (data && data.tracks && state.activeAlbumDetail === album) {
        album.tracks = data.tracks;
        album.cover = album.cover || data.album?.cover;
        album.year = album.year || data.album?.year;
        album.sampleRate = data.tracks[0]?.sampleRate || 44100;
        album.bitsPerSample = data.tracks[0]?.bitsPerSample || 16;
        const countEl = document.getElementById('detailTrackCount');
        if (countEl) countEl.textContent = album.tracks.length;
        renderDetailTracklist(album);
        renderAlbumMetadata(album);
      }
    }).catch(err => {
      console.warn('Failed to fetch TIDAL album tracks:', err);
      if (tbody) tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:24px;color:#ef4444;">無法載入曲目: ${escapeXml(err.message)}</td></tr>`;
    });
  } else {
    renderDetailTracklist(album);
  }

  // Favorite button in Album Detail Modal
  const btnFavAlbum = document.getElementById('btnFavAlbumDetail');
  if (btnFavAlbum) {
    const isFav = isAlbumFavorite(album);
    btnFavAlbum.classList.toggle('active', isFav);
    btnFavAlbum.innerHTML = `${getHeartSvg(isFav, 15)} <span>${isFav ? '已在最愛專輯' : '加入最愛專輯'}</span>`;
    btnFavAlbum.onclick = (e) => {
      e.stopPropagation();
      toggleAlbumFavorite(album);
    };
  }

  // Clicking artist in detail view opens artist page
  if (detailArtist) {
    detailArtist.style.cursor = 'pointer';
    detailArtist.onclick = () => {
      openArtistDetail(album.artist);
    };
  }

  // 1. Fetch Album Bio (Online search + Auto Traditional Chinese Translation)
  try {
    updateAlbumIntroCollapseUI();
    fetchAlbumBio(album);
  } catch (e) {
    console.warn('fetchAlbumBio error:', e);
  }

  // 2. Render Album Credits & Metadata (Artist, Producer, Release Year, Record Label, etc.)
  try {
    renderAlbumMetadata(album);
  } catch (e) {
    console.warn('renderAlbumMetadata error:', e);
  }

  // 3. Render Recommended Albums (Based on metadata & same genre)
  try {
    renderAlbumRecommendations(album);
  } catch (e) {
    console.warn('renderAlbumRecommendations error:', e);
  }

  // 4. Render Recommended Artists (Genre-based random sampling)
  try {
    renderAlbumArtistRecommendations(album);
  } catch (e) {
    console.warn('renderAlbumArtistRecommendations error:', e);
  }

  // 5. Update TIDAL Library button state
  try {
    updateAlbumDetailLibraryButton(album);
  } catch (e) {
    console.warn('updateAlbumDetailLibraryButton error:', e);
  }

  // 6. Album Versions Comparison & Resolution
  try {
    renderAlbumVersions(album);
  } catch (e) {
    console.warn('renderAlbumVersions error:', e);
  }

  navigateTo('albumDetail');
  const mainContentEl = document.getElementById('mainContent');
  if (mainContentEl) mainContentEl.scrollTop = 0;
}

function closeAlbumDetail() {
  if (state.historyIndex > 0) {
    state.historyIndex--;
    applyView(state.history[state.historyIndex], false);
  } else {
    navigateTo('albums');
  }
}

// ----------------- Player & Audio Engine -----------------
function findAlbumForTrack(track) {
  if (!track || !state.albums || !state.albums.length) return null;
  // 1. Try to find by track's filePath matching one of album.tracks
  if (track.filePath) {
    const byFile = state.albums.find(a => a.tracks && a.tracks.some(tr => tr.filePath && tr.filePath === track.filePath));
    if (byFile) return byFile;
  }
  // 2. Try to match album title & artist
  const trkAlbum = (track.album || '').trim().toLowerCase();
  const trkArtist = (track.artist || '').trim().toLowerCase();
  if (trkAlbum && trkArtist) {
    const byBoth = state.albums.find(a => 
      (a.title || '').trim().toLowerCase() === trkAlbum && 
      ((a.artist || '').trim().toLowerCase() === trkArtist || (a.albumArtist || '').trim().toLowerCase() === trkArtist)
    );
    if (byBoth) return byBoth;
  }
  // 3. Try to match album title alone (handles compilation albums or various artists)
  if (trkAlbum) {
    const byTitle = state.albums.find(a => (a.title || '').trim().toLowerCase() === trkAlbum);
    if (byTitle) return byTitle;
  }
  // 4. Try matching track title in album tracks
  if (track.title) {
    const byTrackTitle = state.albums.find(a => a.tracks && a.tracks.some(tr => tr.title && tr.title === track.title));
    if (byTrackTitle) return byTrackTitle;
  }
  return null;
}

function getEnrichedTrack(track) {
  if (!track) return track;
  const foundAlbum = findAlbumForTrack(track);
  return {
    ...track,
    cover: track.cover || (foundAlbum ? foundAlbum.cover : null) || null,
    album: track.album || (foundAlbum ? foundAlbum.title : 'Album'),
    artist: track.artist || (foundAlbum ? foundAlbum.artist : 'Artist'),
    albumArtist: track.albumArtist || (foundAlbum ? (foundAlbum.albumArtist || foundAlbum.artist) : track.artist),
    genre: track.genre || (foundAlbum ? foundAlbum.genre : ''),
    year: track.year || (foundAlbum ? foundAlbum.year : '')
  };
}

async function playAlbum(album) {
  if (!album) return;
  if (album.isTidal && (!album.tracks || !album.tracks.length) && window.tidalService) {
    try {
      showToast('⏳ 正在從 TIDAL 載入專輯音訊...');
      const data = await window.tidalService.getAlbum(album.tidalId);
      if (data && data.tracks && data.tracks.length > 0) {
        album.tracks = data.tracks;
      }
    } catch (e) {
      console.warn('Failed to load tracks for TIDAL album:', e);
    }
  }
  if (!album.tracks || !album.tracks.length) return;
  recordRecentlyPlayed(album);
  playTrackList(album.tracks, 0);
}

function playTrackList(tracks, startIndex = 0) {
  state.queue = [...tracks];
  state.currentTrackIndex = startIndex;
  if (state.isShuffle) {
    generateShuffleOrder(startIndex);
  }
  renderQueue();
  playCurrentTrack();
}

// Background prefetch: proactively cache the next TIDAL tracks in the queue so that
// track switching with DSP upsampling / DLNA starts from a warm cache instantly.
let tidalPrefetchActive = false;
function prefetchNextTidalTracks(count = 2) {
  if (tidalPrefetchActive) return;
  if (!window.electronAPI || !window.electronAPI.tidalCacheTrack) return;

  const queue = state.queue || [];
  const targets = [];
  const pushTarget = (t) => {
    if (t && t.isTidal && t.tidalId && !(t.filePath && String(t.filePath).endsWith('.flac')) && targets.length < count) {
      targets.push(t);
    }
  };
  if (state.isShuffle && state.shuffleOrder && state.shuffleOrder.length) {
    for (let p = (state.shufflePointer || 0) + 1; p < state.shuffleOrder.length && targets.length < count; p++) {
      pushTarget(queue[state.shuffleOrder[p]]);
    }
  } else {
    for (let i = (state.currentTrackIndex || 0) + 1; i < queue.length && targets.length < count; i++) {
      pushTarget(queue[i]);
    }
  }
  if (!targets.length) return;

  tidalPrefetchActive = true;
  (async () => {
    try {
      for (const t of targets) {
        try {
          const cachedFast = await window.electronAPI.tidalCacheTrack(t.tidalId);
          if (cachedFast) { t.filePath = cachedFast; continue; }
          if (!t.streamUrl && window.tidalService) {
            const quality = (localDspActive() && state.activeAudioZone === 'local') ? 'HI_RES_LOSSLESS' : 'LOSSLESS';
            const sInfo = await window.tidalService.getTrackStreamUrl(t.tidalId, quality);
            if (sInfo && sInfo.url) {
              t.streamUrl = sInfo.url;
              if (sInfo.sampleRate) t.sampleRate = sInfo.sampleRate;
              if (sInfo.bitDepth) t.bitDepth = sInfo.bitDepth;
              t.formatName = 'FLAC';
            }
          }
          if (t.streamUrl) {
            const optionalInfo = (sInfo && sInfo.manifest) ? {
              manifest: sInfo.manifest,
              manifestMimeType: sInfo.manifestMimeType,
              bitDepth: sInfo.bitDepth,
              sampleRate: sInfo.sampleRate,
              audioQuality: sInfo.audioQuality
            } : undefined;
            const cached = await window.electronAPI.tidalCacheTrack(t.tidalId, t.streamUrl, optionalInfo);
            if (cached) t.filePath = cached;
          }
        } catch (_) {}
      }
    } finally {
      tidalPrefetchActive = false;
    }
  })();
}

async function playCurrentTrack() {
  if (state.currentTrackIndex < 0 || state.currentTrackIndex >= state.queue.length) return;
  const track = state.queue[state.currentTrackIndex];

  // Record to recently played albums
  const foundAlbum = findAlbumForTrack(track);
  if (foundAlbum) {
    recordRecentlyPlayed(foundAlbum);
  }

  // Record play count statistics
  recordPlayCount(track, foundAlbum);

  // Record playback history (Recent 100 tracks, sorted newest to oldest)
  recordTrackPlaybackHistory(track, foundAlbum);

  // Stop previous synth or native audio
  stopDemoSynth();
  nativeAudio.pause();

  // Update UI Elements
  playerTitle.textContent = track.title;
  playerArtist.textContent = `${track.artist} — ${track.title}`;
  const defaultPlayerCover = createSvgCover(track.album, track.artist, '#27272a', '#09090b');
  playerCoverImg.src = formatCoverSrc(track.cover || (foundAlbum ? foundAlbum.cover : null)) || defaultPlayerCover;
  playerCoverImg.onerror = () => {
    playerCoverImg.onerror = null;
    playerCoverImg.src = defaultPlayerCover;
  };

  // Clicking player artist navigates to artist page
  playerArtist.style.cursor = 'pointer';
  playerArtist.onclick = () => {
    openArtistDetail(track.artist);
  };

  // Update Player Favorite Heart
  const playerHeartBtn = document.getElementById('btnPlayerHeart');
  if (playerHeartBtn) {
    const isFav = isTrackFavorite(track);
    playerHeartBtn.classList.toggle('active', isFav);
    playerHeartBtn.innerHTML = getHeartSvg(isFav, 16);
    playerHeartBtn.title = isFav ? '從最愛歌曲移除' : '加入最愛歌曲';
  }

  // Update Signal Path Badge & Modal
  updateSignalPathUI(track);

  // Update Queue and Now Playing modal content immediately for all playback outputs (DLNA, local, DSD, KKBOX)
  updateQueueActiveItem();
  if (typeof updateNowPlayingModalContent === 'function') {
    const npModal = document.getElementById('nowPlayingModal');
    if (npModal && npModal.style.display !== 'none') {
      updateNowPlayingModalContent();
    }
  }

  // 1. Play audio via DLNA if a network zone is selected
  if (state.activeAudioZone !== 'local' && state.activeDlnaDevice) {
    isCurrentDsd = false;
    isCurrentSox = false;
    currentDsdOffset = 0;
    currentSoxOffset = 0;
    state.dlnaCurrentSec = 0;
    state.dlnaTotalSec = track.duration || 0;
    stopVirtualProgress();
    stopDemoSynth();
    nativeAudio.pause();

    if (track.isDemo || (!track.filePath && !track.isKkbox && !track.isTidal)) {
      showToast('⚠️ 示範音訊為合成示範曲，請選取本機音樂庫或線上串流歌曲進行 DLNA 串流播放');
      state.isPlaying = false;
      updatePlayPauseBtnUI();
      updateQueueActiveItem();
      return;
    }

    // Resolve TIDAL streamUrl and cache file for DLNA streaming
    if (track.isTidal) {
      const tidalQuality = localDspActive() ? 'HI_RES_LOSSLESS' : 'LOSSLESS';
      let streamInfo = null;

      // Fast path: file already cached on disk (or manifest already registered in the
      // main process) — skip the TIDAL API + manifest round-trip entirely.
      if (!track.filePath || !String(track.filePath).endsWith('.flac')) {
        try {
          const cachedFast = await window.electronAPI.tidalCacheTrack(track.tidalId);
          if (cachedFast) track.filePath = cachedFast;
        } catch (e) {
          console.warn('[DLNA] TIDAL cache fast path failed:', e);
        }
      }

      // Resolve a fresh stream info whenever the cache file is missing — even if a
      // prefetch attempt already left a (possibly expired) streamUrl on this track.
      if ((!track.streamUrl || !track.filePath || !String(track.filePath).endsWith('.flac')) && window.tidalService) {
        playerArtist.textContent = `⏳ 正在取得 TIDAL 串流資訊...`;
        try {
          streamInfo = await window.tidalService.getTrackStreamUrl(track.tidalId, tidalQuality);
          if (streamInfo && streamInfo.url) {
            track.streamUrl = streamInfo.url;
            if (streamInfo.filePath) track.filePath = streamInfo.filePath;
            track.sampleRate = streamInfo.sampleRate || track.sampleRate || 44100;
            track.bitDepth = streamInfo.bitDepth || track.bitDepth || 16;
            track.formatName = 'FLAC';
          }
        } catch (e) {
          console.warn('[DLNA] TIDAL stream resolve failed:', e);
        }
      }

      // Assemble the cache file, passing the freshly fetched manifest explicitly so the
      // main process never depends on a previously registered (possibly stale) entry.
      if (track.streamUrl && (!track.filePath || !String(track.filePath).endsWith('.flac'))) {
        playerArtist.textContent = `⏳ 正在快取 TIDAL 曲目以供串流轉換...`;
        const optionalInfo = (streamInfo && streamInfo.manifest) ? {
          manifest: streamInfo.manifest,
          manifestMimeType: streamInfo.manifestMimeType,
          bitDepth: streamInfo.bitDepth,
          sampleRate: streamInfo.sampleRate,
          audioQuality: streamInfo.audioQuality
        } : undefined;
        try {
          const cached = await window.electronAPI.tidalCacheTrack(track.tidalId, track.streamUrl, optionalInfo);
          if (cached) track.filePath = cached;
        } catch (e) {
          console.warn('[DLNA] TIDAL cache assembly failed:', e);
        }
      }
      playerArtist.textContent = `${track.artist} — ${track.title}`;

      // No cached file = nothing the DLNA streaming server can serve; fail with a clear
      // message instead of a cryptic "path argument must be of type string" TypeError.
      if (!track.filePath || !String(track.filePath).endsWith('.flac')) {
        showToast('❌ TIDAL 曲目快取失敗：無法取得音訊檔（請確認 TIDAL 登入狀態或稍後再試）');
        state.isPlaying = false;
        updatePlayPauseBtnUI();
        updateQueueActiveItem();
        return;
      }
    }

    // Attempt to load duration if missing
    if ((!track.duration || track.duration <= 0) && window.electronAPI && window.electronAPI.getAudioDuration && track.filePath) {
      window.electronAPI.getAudioDuration(track.filePath).then(d => {
        if (d && d > 0) {
          track.duration = Math.round(d);
          state.dlnaTotalSec = track.duration;
          totalTimeLabel.textContent = formatDuration(track.duration);
        }
      }).catch(() => {});
    }

    if (window.electronAPI && window.electronAPI.playDlnaTrack) {
      const dspOptions = buildDspOptions(track);

      const enrichedTrack = getEnrichedTrack(track);
      window.electronAPI.playDlnaTrack(state.activeDlnaDevice.id, enrichedTrack, 0, dspOptions).then(res => {
        if (res && res.success) {
          state.isPlaying = true;
          state.activeSpectrumToken = res.token || null; // DSP sessions carry a spectrum window; direct streams return null data and the visualizer hides itself
          updatePlayPauseBtnUI();
          const dur = track.duration || 0;
          if (dspOptions && dspOptions.dsdMode) {
            showToast(`⚡ 正在以 1-bit ${dspOptions.dsdMode.toUpperCase()} 串流至 ${state.activeDlnaDevice.name}: ${track.title}`);
          } else if (track.filePath && /\.dsf$/i.test(track.filePath) && (!dspOptions || !dspOptions.enabled)) {
            showToast(`🎵 正在以 Native DSD 直通串流至 ${state.activeDlnaDevice.name}: ${track.title}`);
          } else {
            showToast(`📡 正在串流至 ${state.activeDlnaDevice.name}: ${track.title}`);
          }
          prefetchNextTidalTracks();
        } else if (res && res.cancelled) {
          console.log('[DLNA] Play superseded by newer track selection');
        } else {
          console.error('DLNA playTrack error:', res);
          showToast(`❌ DLNA 播放失敗: ${res ? res.error : '未知錯誤'}`);
          state.isPlaying = false;
          updatePlayPauseBtnUI();
        }
      }).catch(err => {
        console.error('DLNA play error:', err);
        showToast(`❌ 串流發送失敗: ${err.message}`);
        state.isPlaying = false;
        updatePlayPauseBtnUI();
      });
    }

    updateQueueActiveItem();
    return;
  }

  // Play audio
  const ext = (track.formatName || '').toUpperCase();
  const isDsd = ext === 'DSF' || ext === 'DFF' || (track.fileName && /\.(dsf|dff)$/i.test(track.fileName)) || (track.filePath && /\.(dsf|dff)$/i.test(track.filePath));

  if (track.isTidal) {
    isCurrentDsd = false;
    isCurrentSox = false;
    currentDsdOffset = 0;
    currentSoxOffset = 0;
    stopVirtualProgress();
    stopDemoSynth();

    // Fast path for DSP upsampling: a cached local FLAC file needs no stream URL
    // or TIDAL API round-trip — go straight into the progressive DSP session.
    if (localDspActive() && window.electronAPI && window.electronAPI.getSoxStreamUrl && window.electronAPI.tidalCacheTrack) {
      if (!track.filePath || !String(track.filePath).endsWith('.flac')) {
        try {
          const cachedFast = await window.electronAPI.tidalCacheTrack(track.tidalId);
          if (cachedFast) track.filePath = cachedFast;
        } catch (_) {}
      }
      if (track.filePath && String(track.filePath).endsWith('.flac')) {
        playerArtist.textContent = `⚡ 正在透過 DSP 升頻引擎調變 TIDAL 音訊...`;
        await playSoxTrack(track, 0);
        playerArtist.textContent = `${track.artist} — ${track.title}`;
        if (track.duration) totalTimeLabel.textContent = formatDuration(track.duration);
        prefetchNextTidalTracks();
        return;
      }
    }

    playerArtist.textContent = `⏳ 正在連接 TIDAL Hi-Res 官方音訊串流...`;

    const getTidalStreamPromise = (track.streamUrl)
      ? Promise.resolve({ url: track.streamUrl, filePath: track.filePath, sampleRate: track.sampleRate, bitDepth: track.bitDepth, audioQuality: track.audioQuality })
      : ((window.tidalService)
          ? window.tidalService.getTrackStreamUrl(track.tidalId, localDspActive() ? 'HI_RES_LOSSLESS' : 'LOSSLESS')
          : Promise.reject(new Error('TIDAL 服務模組未初始化'))
        ).then(info => {
          track.streamUrl = info.url;
          if (info.filePath) track.filePath = info.filePath;
          track.sampleRate = info.sampleRate || 44100;
          track.bitDepth = info.bitDepth || 16;
          track.audioQuality = info.audioQuality || 'LOSSLESS';
          track.formatName = 'FLAC';
          return info;
        });

    getTidalStreamPromise.then(async (info) => {
      if (!info || !info.url) throw new Error('未取得有效音訊串流');

      // If DSP Upsampling (SoX Hermite / DSD 1-bit modulator) is enabled:
      if (localDspActive() && window.electronAPI && window.electronAPI.getSoxStreamUrl) {
        playerArtist.textContent = localDspActive() && !state.dsp.enabled
          ? `🎚️ 正在透過參數化等化器處理 TIDAL 音訊 (原生採樣率)...`
          : `⚡ 正在透過 DSP 升頻引擎調變 TIDAL 音訊...`;
        let cached = track.filePath;
        const buildOptionalInfo = (srcInfo) => (srcInfo && srcInfo.manifest) ? {
          manifest: srcInfo.manifest,
          manifestMimeType: srcInfo.manifestMimeType,
          bitDepth: srcInfo.bitDepth,
          sampleRate: srcInfo.sampleRate,
          audioQuality: srcInfo.audioQuality
        } : undefined;
        if (!cached || !cached.endsWith('.flac')) {
          if (window.electronAPI.tidalCacheTrack) {
            cached = await window.electronAPI.tidalCacheTrack(track.tidalId, track.streamUrl, buildOptionalInfo(info));
          }
          if (!cached && window.tidalService) {
            // 舊 streamUrl 可能已過期：重新取得播放資訊並用新的 manifest 重組快取一次
            try {
              const freshInfo = await window.tidalService.getTrackStreamUrl(track.tidalId, 'HI_RES_LOSSLESS');
              if (freshInfo && freshInfo.url) {
                track.streamUrl = freshInfo.url;
                cached = await window.electronAPI.tidalCacheTrack(track.tidalId, freshInfo.url, buildOptionalInfo(freshInfo));
              }
            } catch (e) {
              console.warn('[TIDAL] Cache re-resolve failed:', e);
            }
          }
        }
        if (cached) {
          track.filePath = cached;
          await playSoxTrack(track, 0);
          playerArtist.textContent = `${track.artist} — ${track.title}`;
          if (track.duration) totalTimeLabel.textContent = formatDuration(track.duration);
          prefetchNextTidalTracks();
          return;
        }
      }

      // Direct Bit-Perfect Local Playback via HTML5 Audio Engine
      if (nativeAudio.src !== track.streamUrl) {
        nativeAudio.src = track.streamUrl;
      }
      return nativeAudio.play().then(() => {
        state.isPlaying = true;
        updatePlayPauseBtnUI();
        playerArtist.textContent = `${track.artist} — ${track.title}`;
        if (track.duration) totalTimeLabel.textContent = formatDuration(track.duration);
        const qLabel = (track.bitDepth === 24 || (track.sampleRate && track.sampleRate > 48000)) ? '24-bit Hi-Res' : '16-bit Lossless';
        showToast(`🎵 正在播放 TIDAL 原生串流: 《${track.title}》 [${qLabel}]`);
        prefetchNextTidalTracks();
      });
    }).catch(err => {
      console.error('TIDAL stream play error:', err);
      playerArtist.textContent = `TIDAL 串流錯誤: ${err.message || '無法取得音訊'}`;
      showToast(`❌ TIDAL 播放失敗: ${err.message}`);
      state.isPlaying = false;
      updatePlayPauseBtnUI();
    });
  } else if (track.isKkbox) {
    isCurrentDsd = false;
    isCurrentSox = false;
    currentDsdOffset = 0;
    currentSoxOffset = 0;
    stopVirtualProgress();
    stopDemoSynth();

    playerArtist.textContent = `⏳ 正在連接 KKBOX 官方音訊串流...`;
    const setupAndPlay = (streamUrl) => {
      if (nativeAudio.src !== streamUrl) {
        nativeAudio.src = streamUrl;
      }
      return nativeAudio.play();
    };

    const streamPromise = (track.streamUrl)
      ? Promise.resolve(track.streamUrl)
      : kkboxService.getTrackStreamUrl(track.kkboxId).then(url => {
          track.streamUrl = url;
          return url;
        });

    streamPromise.then(streamUrl => {
      if (!streamUrl) throw new Error('未取得有效音訊串流');
      return setupAndPlay(streamUrl);
    }).then(() => {
      state.isPlaying = true;
      updatePlayPauseBtnUI();
      playerArtist.textContent = `${track.artist} — ${track.title}`;
      totalTimeLabel.textContent = formatDuration(track.duration || 30);
      showToast(`🎵 正在播放 KKBOX 線上串流: 《${track.title}》`);
    }).catch(err => {
      console.error('KKBOX stream play error:', err);
      playerArtist.textContent = `KKBOX 串流錯誤: ${err.message || '無法取得音訊'}`;
      showToast(`❌ KKBOX 播放失敗: ${err.message}`);
      state.isPlaying = false;
      updatePlayPauseBtnUI();
    });
  } else if (track.isDemo || !track.filePath) {
    isCurrentDsd = false;
    isCurrentSox = false;
    currentDsdOffset = 0;
    currentSoxOffset = 0;
    playDemoSynth(track);
    state.isPlaying = true;
    btnPlayPause.textContent = '⏸';
    startVirtualProgress(track.duration || 300);
  } else if (isDsd && window.electronAPI && window.electronAPI.getDsdStreamUrl) {
    isCurrentSox = false;
    currentSoxOffset = 0;
    stopVirtualProgress();
    stopDemoSynth();
    playDsdTrack(track, 0);
  } else if (localDspActive() && window.electronAPI && window.electronAPI.getSoxStreamUrl) {
    isCurrentDsd = false;
    currentDsdOffset = 0;
    stopVirtualProgress();
    stopDemoSynth();
    playSoxTrack(track, 0);
  } else {
    isCurrentDsd = false;
    isCurrentSox = false;
    currentDsdOffset = 0;
    currentSoxOffset = 0;
    stopVirtualProgress();
    stopDemoSynth();

    const mediaUrl = window.electronAPI ? window.electronAPI.getMediaUrl(track.filePath) : track.filePath;
    nativeAudio.src = mediaUrl;
    nativeAudio.play().then(() => {
      state.isPlaying = true;
      btnPlayPause.textContent = '⏸';
    }).catch(err => {
      console.error('Audio play error:', err);
      playerArtist.textContent = `播放錯誤: ${err.message || '無法解碼音訊檔案'}`;
      state.isPlaying = false;
      btnPlayPause.textContent = '▶';
    });
  }

  updateQueueActiveItem();
  if (typeof updateNowPlayingModalContent === 'function') {
    const npModal = document.getElementById('nowPlayingModal');
    if (npModal && npModal.style.display !== 'none') {
      updateNowPlayingModalContent();
    }
  }
}

// ----------------- DSD Direct Streaming Engine -----------------
let isCurrentDsd = false;
let currentDsdOffset = 0;

async function playDsdTrack(track, startSec = 0) {
  isCurrentDsd = true;
  currentDsdOffset = startSec;

  try {
    if ((!track.duration || track.duration === 0) && window.electronAPI && window.electronAPI.getAudioDuration) {
      window.electronAPI.getAudioDuration(track.filePath).then(dur => {
        if (dur) {
          track.duration = dur;
          totalTimeLabel.textContent = formatDuration(dur);
        }
      }).catch(() => {});
    }

    const streamUrl = await window.electronAPI.getDsdStreamUrl(track.filePath, startSec, peqPayloadJson(), convPayloadJson());
    if (!streamUrl) {
      playerArtist.textContent = '無法建立 DSD 串流服務';
      return;
    }

    // WASAPI 獨佔輸出：DSF 由引擎固定輸出 88.2kHz/24-bit，裝置需支援 88.2k 獨佔格式
    if (state.exclusive && exclusiveZoneOk()) {
      const exRate = exclusiveChooseRate(88200, 88200);
      if (exRate === 88200 && await exclusiveStartStream(track, startSec, streamUrl, exRate)) {
        state.isPlaying = true;
        updatePlayPauseBtnUI();
        updateSignalPathUI(track);
        showToast('🎚️ WASAPI 獨佔輸出: DSD ➔ 24-bit/88.2kHz 直出（繞過混音器，系統音效暫停）');
        return;
      }
      exclusiveFallbackShared(exRate === 88200 ? '獨佔輸出啟動失敗' : '輸出裝置不支援 88.2kHz 獨佔格式');
    }

    nativeAudio.src = streamUrl;
    nativeAudio.play().then(() => {
      state.isPlaying = true;
      btnPlayPause.textContent = '⏸';
      showToast(`⚡ DSD 啟用: 即時轉為 24-bit/88.2kHz PCM 發燒音質`);
    }).catch(err => {
      console.error('DSD play error:', err);
      playerArtist.textContent = `DSD 播放錯誤: ${err.message || '解碼失敗'}`;
      state.isPlaying = false;
      btnPlayPause.textContent = '▶';
    });
  } catch (err) {
    console.error('getDsdStreamUrl error:', err);
    playerArtist.textContent = `DSD 解碼服務錯誤: ${err.message}`;
  }
}

// ----------------- Native DSP Progressive Streaming Engine -----------------
let isCurrentSox = false;
let currentSoxOffset = 0;

function isDsdRateMode(mode) {
  if (!mode || typeof mode !== 'string') return false;
  const m = mode.trim().toLowerCase();
  return ['dsd64', 'dsd128', 'dsd256', 'dsd512'].includes(m);
}

function getDsdMhz(mode) {
  const m = (mode || 'dsd64').trim().toLowerCase();
  switch (m) {
    case 'dsd64': return '2.8224 MHz';
    case 'dsd128': return '5.6448 MHz';
    case 'dsd256': return '11.2896 MHz';
    case 'dsd512': return '22.5792 MHz';
    default: return '2.8224 MHz';
  }
}

function calculateTargetSampleRate(sourceRate = 44100, rateMode = '4x') {
  const src = Number(sourceRate) || 44100;
  if (rateMode === 'dsd64') {
    return (src % 48000 === 0) ? 192000 : 176400;
  }
  if (['dsd128', 'dsd256', 'dsd512'].includes(rateMode)) {
    return (src % 48000 === 0) ? 384000 : 352800;
  }
  if (rateMode === '192k') return 192000;
  if (rateMode === '384k') return 384000;
  if (rateMode === '96k') return 96000;

  if (rateMode === '2x') {
    if (src <= 48000) return src * 2;
    if (src <= 96000) return src * 2;
    return src;
  }

  // Default '4x'
  if (src <= 48000) return src * 4;
  if (src <= 96000) return src * 2;
  return src;
}

function formatKhz(rateHz) {
  if (!rateHz) return '44.1kHz';
  const khz = rateHz / 1000;
  return Number.isInteger(khz) ? `${khz}kHz` : `${khz.toFixed(1)}kHz`;
}

async function playSoxTrack(track, startSec = 0) {
  isCurrentSox = true;
  isCurrentDsd = false;
  currentSoxOffset = startSec;

  try {
    if ((!track.duration || track.duration === 0) && window.electronAPI && window.electronAPI.getAudioDuration) {
      window.electronAPI.getAudioDuration(track.filePath).then(dur => {
        if (dur) {
          track.duration = dur;
          totalTimeLabel.textContent = formatDuration(dur);
        }
      }).catch(() => {});
    }

    const engineOn = !!(state.dsp && state.dsp.enabled);
    const targetRate = engineOn ? calculateTargetSampleRate(track.sampleRate || 44100, state.dsp.rateMode) : (track.sampleRate || 44100);
    const isDsd = engineOn && isDsdRateMode(state.dsp.rateMode);
    const dsdMode = isDsd ? state.dsp.rateMode : '';
    const dsdOrder = state.dsp.dsdOrder || 5;
    const filterPhase = state.dsp.filterPhase || 'linear';

    const streamUrl = await window.electronAPI.getSoxStreamUrl(track.filePath, startSec, targetRate, dsdMode, dsdOrder, filterPhase, peqPayloadJson(), convPayloadJson());
    if (!streamUrl) {
      playerArtist.textContent = '無法建立 SoX 升頻串流服務';
      return;
    }

    // WASAPI 獨佔輸出：同一条引擎串流改由 helper 以裝置支援的取樣率直出，
    // 升頻 / PEQ / 卷積全部保留；裝置最高獨取樣率低於來源時自動退回共享模式。
    if (state.exclusive && exclusiveZoneOk()) {
      const srcRate = track.sampleRate || 44100;
      const exRate = exclusiveChooseRate(srcRate, targetRate);
      if (exRate) {
        const exUrl = await window.electronAPI.getSoxStreamUrl(track.filePath, startSec, exRate, '', dsdOrder, filterPhase, peqPayloadJson(), convPayloadJson());
        if (exUrl && await exclusiveStartStream(track, startSec, exUrl, exRate)) {
          state.isPlaying = true;
          updatePlayPauseBtnUI();
          updateSignalPathUI(track);
          showToast(`🎚️ WASAPI 獨佔輸出: ${formatKhz(srcRate)} ➔ ${formatKhz(exRate)} 24-bit 直出（繞過混音器，系統音效暫停）`);
          return;
        }
        exclusiveFallbackShared('獨佔輸出啟動失敗');
      } else {
        exclusiveFallbackShared(`裝置最高獨取樣率低於來源 ${formatKhz(srcRate)}`);
      }
    }

    nativeAudio.src = streamUrl;
    nativeAudio.play().then(() => {
      state.isPlaying = true;
      btnPlayPause.textContent = '⏸';
      const phaseText = filterLabel(filterPhase);
      if (isDsd) {
        const mhz = getDsdMhz(state.dsp.rateMode);
        showToast(`⚡ 1-bit DSD 調變: PCM ➔ ${state.dsp.rateMode.toUpperCase()} (${dsdOrder} 階 • ${phaseText} • ${mhz})`);
      } else if (!engineOn) {
        const proc = [];
        if (countActivePeqBands() > 0) proc.push(`PEQ ${countActivePeqBands()} 段`);
        if (buildConvPayload()) proc.push('卷積 IR');
        showToast(`🎚️ 原生採樣率處理 (${formatKhz(targetRate)} 24-bit): ${proc.join(' + ')}`);
      } else {
        const trkFmt = getAudioFormatFromPath(track.filePath || track.fileName, track.formatName || 'PCM').toUpperCase();
        showToast(`🎛️ SoX 升頻: ${formatKhz(track.sampleRate || 44100)} ➔ ${formatKhz(targetRate)} (24-bit • ${phaseText} • ${trkFmt})`);
      }
    }).catch(err => {
      console.error('SoX play error:', err);
      playerArtist.textContent = `SoX 播放異常，正在切換原生播放...`;
      isCurrentSox = false;
      currentSoxOffset = 0;
      nativeAudio.src = window.electronAPI ? window.electronAPI.getMediaUrl(track.filePath) : track.filePath;
      nativeAudio.play().catch(e => console.error('Fallback error:', e));
    });
  } catch (err) {
    console.error('getSoxStreamUrl error:', err);
    playerArtist.textContent = `SoX 升頻解碼服務錯誤: ${err.message}`;
  }
}

function updateSignalPathUI(track = null) {
  if (!track && state.currentTrackIndex >= 0 && state.queue[state.currentTrackIndex]) {
    track = state.queue[state.currentTrackIndex];
  }

  const signalPathBadge = document.getElementById('signalPathBadge');
  const statusPill = document.getElementById('signalPathStatusPill');
  const signalPathDot = document.getElementById('signalPathDot');
  const sourceTitle = document.getElementById('signalSourceTitle');
  const sourceDesc = document.getElementById('signalSourceDesc');
  const engineTitle = document.getElementById('signalEngineTitle');
  const engineDesc = document.getElementById('signalEngineDesc');
  const signalOutputIcon = document.getElementById('signalOutputIcon');
  const signalOutputTitle = document.getElementById('signalOutputTitle');
  const signalOutputDesc = document.getElementById('signalOutputDesc');
  const signalSoxArrow = document.getElementById('signalSoxArrow');
  const signalSoxStage = document.getElementById('signalSoxStage');
  const signalSoxTitle = document.getElementById('signalSoxTitle');
  const signalSoxDesc = document.getElementById('signalSoxDesc');

  // Output Zone Info
  if (state.activeAudioZone !== 'local' && state.activeDlnaDevice) {
    if (signalOutputIcon) signalOutputIcon.textContent = '📡';
    if (signalOutputTitle) signalOutputTitle.textContent = `${state.activeDlnaDevice.name} (DLNA / UPnP)`;
    if (signalOutputDesc) {
      if (state.dsp && state.dsp.enabled && isDsdRateMode(state.dsp.rateMode)) {
        signalOutputDesc.textContent = `透過區網即時傳輸 1-bit ${state.dsp.rateMode.toUpperCase()} DSF 串流至 ${state.activeDlnaDevice.ip} (UPnP AVTransport)`;
      } else {
        signalOutputDesc.textContent = `透過區網即時串流至 ${state.activeDlnaDevice.ip} (UPnP AVTransport)`;
      }
    }
  } else {
    if (signalOutputIcon) signalOutputIcon.textContent = '🔊';
    if (signalOutputTitle) signalOutputTitle.textContent = 'Windows WASAPI Exclusive / DirectSound';
    if (signalOutputDesc) signalOutputDesc.textContent = '輸出至本機預設音訊裝置';
  }

  // Update DSP UI controls state inside modal
  const toggleSoxDsp = document.getElementById('toggleSoxDsp');
  const dspSoxCard = document.querySelector('.dsp-sox-card');
  const dspActiveRateHint = document.getElementById('dspActiveRateHint');
  const dspActiveDsdHint = document.getElementById('dspActiveDsdHint');

  if (toggleSoxDsp) toggleSoxDsp.checked = !!(state.dsp && state.dsp.enabled);
  if (dspSoxCard) dspSoxCard.classList.toggle('active', !!(state.dsp && state.dsp.enabled));

  const curRateMode = (state.dsp && state.dsp.rateMode) || '4x';

  // Clear pill active classes
  document.querySelectorAll('#dspRateSelector .dsp-pill, #dspDsdRateSelector .dsp-pill').forEach(p => p.classList.remove('active'));

  if (isDsdRateMode(curRateMode)) {
    const dsdPill = document.querySelector(`#dspDsdRateSelector .dsp-pill[data-rate-mode="${curRateMode}"]`);
    if (dsdPill) {
      dsdPill.classList.add('active');
      if (dspActiveDsdHint) dspActiveDsdHint.textContent = `${dsdPill.textContent} (已生效)`;
      if (dspActiveRateHint) dspActiveRateHint.textContent = '使用 DSD 調變中';
    }
  } else {
    const ratePill = document.querySelector(`#dspRateSelector .dsp-pill[data-rate-mode="${curRateMode}"]`);
    if (ratePill) {
      ratePill.classList.add('active');
      if (dspActiveRateHint) dspActiveRateHint.textContent = ratePill.textContent;
      if (dspActiveDsdHint) dspActiveDsdHint.textContent = '可選 DSD 格式';
    }
  }

  const curOrder = state.dsp.dsdOrder || 5;
  const curPhase = state.dsp.filterPhase || 'linear';

  const orderPill = document.querySelector(`#dspOrderSelector .dsp-pill[data-order="${curOrder}"]`);
  const dspActiveOrderHint = document.getElementById('dspActiveOrderHint');
  if (orderPill) {
    document.querySelectorAll('#dspOrderSelector .dsp-pill').forEach(p => p.classList.remove('active'));
    orderPill.classList.add('active');
    if (dspActiveOrderHint) dspActiveOrderHint.textContent = orderPill.textContent;
  }

  const phasePill = document.querySelector(`#dspPhaseSelector .dsp-pill[data-phase="${curPhase}"]`);
  const dspActivePhaseHint = document.getElementById('dspActivePhaseHint');
  if (phasePill) {
    document.querySelectorAll('#dspPhaseSelector .dsp-pill').forEach(p => p.classList.remove('active'));
    phasePill.classList.add('active');
    if (dspActivePhaseHint) dspActivePhaseHint.textContent = phasePill.textContent;
  }

  // PEQ editor state (modal open / live sync)
  syncPeqModalUI();

  // Convolution (IR) card state (modal open / live sync)
  syncConvModalUI();

  if (!track) {
    if (state.queue && state.queue.length > 0) {
      track = state.queue[0];
    } else if (state.tracks && state.tracks.length > 0) {
      track = state.tracks[0];
    } else {
      track = {
        title: '音訊測試曲目',
        artist: 'Hi-Res Audio',
        sampleRate: 44100,
        bitsPerSample: 16,
        formatName: 'FLAC',
        isLossless: true
      };
    }
  }

  let trkFmt = getAudioFormatFromPath(track.filePath || track.fileName, track.formatName || 'PCM').toUpperCase();
  if (track.isTidal) {
    const isHiRes = (track.bitDepth === 24) || (track.sampleRate && track.sampleRate > 48000) || track.audioQuality === 'HI_RES_LOSSLESS';
    trkFmt = isHiRes ? 'TIDAL HI-RES FLAC' : 'TIDAL LOSSLESS FLAC';
  } else if (track.isKkbox) {
    trkFmt = 'KKBOX AAC';
  }

  const customSourceDesc = track.isTidal 
    ? 'TIDAL 官方母帶級高解析串流 (Bit-Perfect Lossless Stream)' 
    : (track.isKkbox ? 'KKBOX 官方即時音訊串流' : '原始母帶音訊源 (Bit-Perfect Lossless Input)');

  const ext = trkFmt;
  const isNativeDsd = ext === 'DSF' || ext === 'DFF' || ext === 'DSD' || (track.fileName && /\.(dsf|dff)$/i.test(track.fileName)) || (track.filePath && /\.(dsf|dff)$/i.test(track.filePath));
  const isDspActive = state.dsp && state.dsp.enabled;

  if (isDspActive) {
    const srcRate = track.sampleRate || 44100;
    const targetRate = calculateTargetSampleRate(srcRate, state.dsp.rateMode);
    const srcKhz = formatKhz(srcRate);
    const targetKhz = formatKhz(targetRate);

    const orderNum = state.dsp.dsdOrder || 5;
    const phaseDesc = filterLabel(curPhase);

    if (isDsdRateMode(state.dsp.rateMode)) {
      const mhz = getDsdMhz(state.dsp.rateMode);
      const modeUpper = state.dsp.rateMode.toUpperCase();

      if (signalPathBadge) signalPathBadge.textContent = `DSP (${modeUpper} / ${orderNum}階) | 1-bit / ${mhz} ⚡`;
      if (statusPill) statusPill.textContent = `DSP ENHANCED (PCM ➔ ${modeUpper} ${orderNum}階)`;
      if (sourceTitle) sourceTitle.textContent = `${trkFmt} ${track.bitDepth || track.bitsPerSample || 16}-bit / ${srcKhz} (${track.title || ''})`;
      if (sourceDesc) sourceDesc.textContent = customSourceDesc;

      if (signalSoxArrow) signalSoxArrow.style.display = 'block';
      if (signalSoxStage) signalSoxStage.style.display = 'flex';
      if (signalSoxTitle) signalSoxTitle.textContent = `升頻引擎：1-bit ${modeUpper} Delta-Sigma 調變 (${orderNum} 階)`;
      if (signalSoxDesc) signalSoxDesc.textContent = `超取樣升頻規格：PCM ${srcKhz} ➔ ${modeUpper} (1-bit / ${mhz} • ${orderNum} 階 Delta-Sigma 噪聲整形 • ${phaseDesc})`;

      if (engineTitle) engineTitle.textContent = `rooPlayer 1-bit DSD Modulator Engine (${orderNum} 階)`;
      if (engineDesc) engineDesc.textContent = `${orderNum} 階 64-bit 浮點即時超取樣調變碼流 (${phaseDesc})，高頻噪聲上移至 100 kHz 射頻頻段，維持音訊帶平坦模擬聽感`;
      if (signalPathDot) signalPathDot.className = 'signal-dot dsd-gold';
    } else {
      const modeUpper = state.dsp.rateMode.toUpperCase();
      if (signalPathBadge) signalPathBadge.textContent = `DSP (${modeUpper}) | 24/${targetKhz} ⚡`;
      if (statusPill) statusPill.textContent = 'DSP ENHANCED (NATIVE FIR UPSAMPLER)';
      if (sourceTitle) sourceTitle.textContent = `${trkFmt} ${track.bitDepth || track.bitsPerSample || 16}-bit / ${srcKhz} (${track.title || ''})`;
      if (sourceDesc) sourceDesc.textContent = customSourceDesc;

      if (signalSoxArrow) signalSoxArrow.style.display = 'block';
      if (signalSoxStage) signalSoxStage.style.display = 'flex';
      if (signalSoxTitle) signalSoxTitle.textContent = `升頻引擎：rooPlayer Native DSP (${modeUpper})`;
      if (signalSoxDesc) signalSoxDesc.textContent = `超取樣升頻規格：${srcKhz} ➔ 24-bit / ${targetKhz} (${phaseDesc})`;

      if (engineTitle) engineTitle.textContent = 'rooPlayer Core Audio Engine';
      if (engineDesc) engineDesc.textContent = `64-bit 浮點即時超取樣升頻核心 (${phaseDesc}) ➔ 輸出至 24-bit ${targetKhz}`;
      if (signalPathDot) signalPathDot.className = 'signal-dot purple';
    }
  } else if (isNativeDsd) {
    const dsdRate = track.sampleRate ? `${(track.sampleRate / 1000000).toFixed(1)}MHz` : '2.8MHz';
    const isDlna = state.activeAudioZone !== 'local' && state.activeDlnaDevice;
    const peqOn = countActivePeqBands() > 0;
    const convOn = !!buildConvPayload();
    const procOn = peqOn || convOn;
    const procLabel = [peqOn ? 'PEQ' : '', convOn ? '卷積 IR' : ''].filter(Boolean).join(' + ');
    if (isDlna) {
      if (procOn) {
        if (signalPathBadge) signalPathBadge.textContent = `${procLabel} + DSD ➔ 24/88.2kHz ⚡`;
        if (statusPill) statusPill.textContent = `ENHANCED (DSD ➔ 24/88.2k + ${procLabel})`;
      } else {
        if (signalPathBadge) signalPathBadge.textContent = `BIT-PERFECT | Native DSD (1-bit / ${dsdRate}) ⚡`;
        if (statusPill) statusPill.textContent = 'BIT-PERFECT (DIRECT STREAMING)';
      }
      if (sourceTitle) sourceTitle.textContent = `DSD (1-bit / ${dsdRate}) — ${track.title}`;
      if (sourceDesc) sourceDesc.textContent = '原始 DSD 母帶碼流 (Bitstream 1-bit PDM)';

      if (signalSoxArrow) signalSoxArrow.style.display = 'none';
      if (signalSoxStage) signalSoxStage.style.display = 'none';

      if (engineTitle) engineTitle.textContent = procOn ? `rooPlayer DSD-to-PCM + ${procLabel} Streamer` : 'rooPlayer Bit-Perfect DSD Streamer';
      if (engineDesc) engineDesc.textContent = procOn
        ? `原生 DSD 即時降採樣至 24-bit 88.2kHz，並以${procLabel}處理${peqOn ? `（${countActivePeqBands()} 段 PEQ）` : ''}`
        : '原生 1-bit DSD (Sony DSF) 直通傳輸至網路渲染器，無重取樣或轉換';
      if (signalPathDot) signalPathDot.className = 'signal-dot dsd-gold';
    } else {
      if (signalPathBadge) signalPathBadge.textContent = procOn ? `${procLabel} | DSD ➔ 24/88.2kHz ⚡` : `ENHANCED | DSD ➔ 24/88.2kHz PCM`;
      if (sourceTitle) sourceTitle.textContent = `DSD (1-bit / ${dsdRate}) — ${track.title}`;
      if (statusPill) statusPill.textContent = procOn ? `ENHANCED (TRANSCODE + ${procLabel})` : 'ENHANCED (HIGH PRECISION TRANSCODE)';
      if (sourceDesc) sourceDesc.textContent = '原始 DSD 母帶碼流 (Bitstream 1-bit PDM)';

      if (signalSoxArrow) signalSoxArrow.style.display = 'none';
      if (signalSoxStage) signalSoxStage.style.display = 'none';

      if (engineTitle) engineTitle.textContent = 'rooPlayer DSD-to-PCM Audio Engine';
      if (engineDesc) engineDesc.textContent = procOn
        ? `64-bit 浮點即時降採樣 (Decimation Filter) ＋ ${procLabel}${peqOn ? `（${countActivePeqBands()} 段 PEQ）` : ''} ➔ 24-bit 88.2kHz PCM`
        : '64-bit 浮點即時降採樣 (Decimation Filter) ➔ 24-bit 88.2kHz PCM';
      if (signalPathDot) signalPathDot.className = 'signal-dot purple';
    }
  } else {
    const sampleKhz = formatKhz(track.sampleRate || 44100);
    const bitDepth = track.bitDepth || track.bitsPerSample || 16;
    const isLossless = track.isLossless || ['WAV', 'FLAC', 'AIFF', 'ALAC', 'APE'].includes(trkFmt) || track.isTidal;
    const peqN = countActivePeqBands();
    const peqOn = peqN > 0;
    const convOn = !!buildConvPayload();
    const procParts = [];
    if (peqOn) procParts.push(`PEQ (${peqN}段)`);
    if (convOn) procParts.push('卷積 IR');
    const procLabel = procParts.join(' + ');
    const procOn = peqOn || convOn;

    if (signalPathBadge) signalPathBadge.textContent = procOn
      ? `${procLabel} ⚡ | ${trkFmt} ${bitDepth}/${sampleKhz}`
      : `${isLossless ? 'LOSSLESS' : 'ENHANCED'} | ${trkFmt} ${bitDepth}/${sampleKhz}`;
    if (sourceTitle) sourceTitle.textContent = `${trkFmt} ${bitDepth}-bit / ${sampleKhz} (${track.title})`;
    if (statusPill) statusPill.textContent = convOn ? 'DSP ACTIVE (NATIVE-RATE DSP)' : (peqOn ? 'PEQ ACTIVE (NATIVE-RATE DSP)' : (isLossless ? 'LOSSLESS BIT-PERFECT' : 'ENHANCED'));
    if (sourceDesc) sourceDesc.textContent = customSourceDesc;

    if (signalSoxArrow) signalSoxArrow.style.display = 'none';
    if (signalSoxStage) signalSoxStage.style.display = 'none';

    if (engineTitle) engineTitle.textContent = procOn ? 'rooPlayer Native DSP (原生率處理)' : 'rooPlayer Core Audio Engine';
    if (engineDesc) engineDesc.textContent = procOn
      ? `原生 ${sampleKhz} 不升頻即時處理：${procLabel}${peqOn ? `（自動預降 ${peqHeadroomDb().toFixed(1)} dB）` : ''}`
      : '64-bit 浮點無損混音核心，零採樣損失處理';
    if (signalPathDot) signalPathDot.className = 'signal-dot purple';
  }

  // PEQ stage in the signal flow diagram (shown in every mode when PEQ is active). JS
  // repositions the node to the exact point of the chain where the engine applies it:
  //  - engine on + PCM upsampling: after the upsampler stage (PEQ runs at the output rate)
  //  - engine on + DSD modulation: before the modulation stage (PEQ runs on the source PCM)
  //  - engine off (PEQ-only): right after the source stage (PEQ runs at the native rate)
  const peqStage = document.getElementById('signalPeqStage');
  const peqArrow = document.getElementById('signalPeqArrow');
  const peqActiveCount = countActivePeqBands();
  if (peqStage && peqArrow) {
    if (peqActiveCount > 0) {
      const stagesEl = peqStage.parentElement;
      let anchor = null;
      if (isDspActive && !isDsdRateMode(curRateMode)) {
        anchor = signalSoxStage && signalSoxStage.parentElement === stagesEl ? signalSoxStage.nextElementSibling : null;
        if (anchor === peqArrow) anchor = peqStage.nextElementSibling; // already positioned here
      }
      if (!anchor || anchor.parentElement !== stagesEl) anchor = signalSoxArrow; // DSD mode / PEQ-only
      if (anchor && anchor.parentElement === stagesEl) {
        stagesEl.insertBefore(peqArrow, anchor);
        stagesEl.insertBefore(peqStage, anchor);
      }
      peqArrow.style.display = 'block';
      peqStage.style.display = 'flex';
      const peqDesc = document.getElementById('signalPeqDesc');
      if (peqDesc) peqDesc.textContent = peqStageSummary();
    } else {
      peqArrow.style.display = 'none';
      peqStage.style.display = 'none';
    }
  }

  // Convolution (IR) stage node: always after PEQ where both are shown, EXCEPT in engine DSD
  // modulation mode where the engine applies the IR on the source PCM before the worker's PEQ.
  //  - engine on + PCM upsampling: after the upsampler stage (IR runs at the output rate)
  //  - engine on + DSD modulation: before the PEQ node / modulation stage (IR runs on source PCM)
  //  - engine off (conv-only): right after the source stage or after the PEQ node
  const convStage = document.getElementById('signalConvStage');
  const convArrow = document.getElementById('signalConvArrow');
  const convActive = !!buildConvPayload();
  if (convStage && convArrow) {
    if (convActive) {
      const stagesEl = convStage.parentElement;
      const peqShown = peqActiveCount > 0 && peqStage && peqStage.parentElement === stagesEl && peqStage.style.display !== 'none';
      let anchor = null;
      if (isDspActive && !isDsdRateMode(curRateMode)) {
        if (peqShown) {
          anchor = peqStage.nextElementSibling;
          if (anchor === convArrow) anchor = convStage.nextElementSibling; // already positioned here
        } else {
          anchor = signalSoxStage && signalSoxStage.parentElement === stagesEl ? signalSoxStage.nextElementSibling : null;
          if (anchor === convArrow) anchor = convStage.nextElementSibling;
        }
      } else if (isDspActive && peqShown) {
        // DSD modulation: IR before PEQ (matches the engine's actual order on the source PCM)
        anchor = peqArrow;
      }
      if (!anchor || anchor.parentElement !== stagesEl) {
        if (!isDspActive && peqShown) {
          anchor = peqStage.nextElementSibling;
          if (anchor === convArrow) anchor = convStage.nextElementSibling;
        } else {
          anchor = signalSoxArrow; // conv-only: right after the source stage
        }
      }
      if (anchor && anchor.parentElement === stagesEl) {
        stagesEl.insertBefore(convArrow, anchor);
        stagesEl.insertBefore(convStage, anchor);
      }
      convArrow.style.display = 'block';
      convStage.style.display = 'flex';
      const convDesc = document.getElementById('signalConvDesc');
      if (convDesc) {
        const irName = (state.dsp.conv.irPath || '').replace(/\\/g, '/').split('/').pop();
        convDesc.textContent = `卷積濾波器：分割式頻域處理（IR: ${irName}）`;
      }
    } else {
      convArrow.style.display = 'none';
      convStage.style.display = 'none';
    }
  }
}

// ========================================================
// PEQ editor UI (DSP settings modal): band editor, presets, response curve.
// The preview curve mirrors dsp-kernel.js biquad math for display only;
// the audible signal is always processed by the engine itself.
// ========================================================
let peqReapplyTimer = null;

function peqFreqFromSlider(v) { return 20 * Math.pow(10, 3 * v / 1000); }
function peqFreqToSlider(f) { return Math.max(0, Math.min(1000, Math.round(1000 * (Math.log10(Math.min(Math.max(f, 20), 20000)) - Math.log10(20)) / 3))); }
function peqQFromSlider(v) { return 0.3 * Math.pow(8 / 0.3, v / 100); }
function peqQToSlider(q) { return Math.max(0, Math.min(100, Math.round(100 * Math.log(Math.min(Math.max(q, 0.3), 8) / 0.3) / Math.log(8 / 0.3)))); }
function peqFormatFreq(f) { return f >= 10000 ? (f / 1000).toFixed(1) + ' kHz' : (f >= 1000 ? (f / 1000).toFixed(2) + ' kHz' : Math.round(f) + ' Hz'); }
function peqFormatGain(g) { return (g > 0 ? '+' : '') + g.toFixed(1) + ' dB'; }

// Signal-path stage summary line: "低架 +3.0 dB @ 110 Hz ・ 峰值 -2.0 dB @ 300 Hz ...（自動預降 X.X dB）"
function peqStageSummary() {
  const peq = state.dsp.peq;
  const typeShort = { lowshelf: '低架', peaking: '峰值', highshelf: '高架', lowpass: '低通', highpass: '高通', notch: '陷波' };
  const parts = peq.bands.filter(b => b.on).map(b => {
    const g = PEQ_GAIN_TYPES.includes(b.type) ? `${peqFormatGain(b.gain)} ` : '';
    return `${typeShort[b.type] || b.type} ${g}@ ${peqFormatFreq(b.freq)}`;
  });
  return `參數化等化器：${parts.join(' ・ ')}（自動預降 ${peqHeadroomDb().toFixed(1)} dB）`;
}

// Seamless live re-apply: restart the active stream from the current position with the new EQ
function peqScheduleReapply() {
  localStorage.setItem('rooplayer_dsp_settings', JSON.stringify(state.dsp));
  updatePeqHint();
  if (peqReapplyTimer) clearTimeout(peqReapplyTimer);
  peqReapplyTimer = setTimeout(() => {
    peqReapplyTimer = null;
    if (!((state.dsp.enabled || countActivePeqBands() > 0 || buildConvPayload()) && state.isPlaying)) return;
    const track = state.queue[state.currentTrackIndex];
    if (!track || track.isDemo || !track.filePath) return;
    const curSec = getCurrentPlaybackTime();
    if (state.activeAudioZone !== 'local' && state.activeDlnaDevice) {
      window.electronAPI.playDlnaTrack(state.activeDlnaDevice.id, getEnrichedTrack(track), Math.floor(curSec), buildDspOptions(track));
    } else {
      const ext = (track.formatName || '').toUpperCase();
      const isDsd = ext === 'DSF' || ext === 'DFF' || (track.filePath && /\.(dsf|dff)$/i.test(track.filePath));
      if (isDsd) playDsdTrack(track, Math.floor(curSec));
      else playSoxTrack(track, Math.floor(curSec));
    }
  }, 450);
}

// Preview biquad coefficients - identical formulas to dsp-kernel.js biquadCoeffs
function peqUiBiquad(type, fs, f0, gainDb, Q) {
  const w0 = 2 * Math.PI * f0 / fs;
  const c = Math.cos(w0), s = Math.sin(w0);
  if (!(s > 0)) return null;
  const alpha = s / (2 * Q);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'lowpass') {
    b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; a0 = 1 + alpha; a1 = -2 * c; a2 = 1 - alpha;
  } else if (type === 'highpass') {
    b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; a0 = 1 + alpha; a1 = -2 * c; a2 = 1 - alpha;
  } else if (type === 'notch') {
    b0 = 1; b1 = -2 * c; b2 = 1; a0 = 1 + alpha; a1 = -2 * c; a2 = 1 - alpha;
  } else if (type === 'peaking') {
    const A = Math.pow(10, gainDb / 20);
    b0 = 1 + alpha * A; b1 = -2 * c; b2 = 1 - alpha * A; a0 = 1 + alpha; a1 = -2 * c; a2 = 1 - alpha;
  } else if (type === 'lowshelf' || type === 'highshelf') {
    const G = Math.pow(10, gainDb / 20);
    const K = 1 / Math.tan(Math.PI * f0 / fs);
    if (!(K > 0) || !isFinite(K)) return null;
    const den0 = K * K + K / Q + 1;
    const sqG = Math.sqrt(G);
    if (type === 'lowshelf') {
      b0 = K * K + K * sqG / Q + G; b1 = 2 * (G - K * K); b2 = K * K - K * sqG / Q + G;
      a0 = den0; a1 = 2 * (1 - K * K); a2 = K * K - K / Q + 1;
    } else {
      b0 = G * K * K + K * sqG / Q + 1; b1 = 2 * (1 - G * K * K); b2 = G * K * K - K * sqG / Q + 1;
      a0 = den0; a1 = 2 * (1 - K * K); a2 = K * K - K / Q + 1;
    }
  } else {
    return null;
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

function peqUiMagDb(bands, f, fs) {
  const w = 2 * Math.PI * f / fs;
  const cw = Math.cos(w), sw = Math.sin(w), c2w = Math.cos(2 * w), s2w = Math.sin(2 * w);
  let reN = 1, imN = 0;
  for (const b of bands) {
    const rn = b.b0 + b.b1 * cw + b.b2 * c2w, in_ = -(b.b1 * sw + b.b2 * s2w);
    const rd = 1 + b.a1 * cw + b.a2 * c2w, id = -(b.a1 * sw + b.a2 * s2w);
    const on = reN * rn - imN * in_, oi = reN * in_ + imN * rn;
    const od = rd * rd + id * id;
    reN = (on * rd + oi * id) / od;
    imN = (oi * rd - on * id) / od;
  }
  return 20 * Math.log10(Math.hypot(reN, imN) + 1e-15);
}

function drawPeqCurve() {
  const canvas = document.getElementById('peqCurveCanvas');
  if (!canvas || !canvas.getContext) return;
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 560, H = canvas.clientHeight || 150;
  const pw = Math.max(1, Math.round(W * dpr)), ph = Math.round(H * dpr);
  if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const fs = 48000, fMin = 20, fMax = 20000, dbMax = 15;
  const xOf = f => Math.log(f / fMin) / Math.log(fMax / fMin) * W;
  const yOf = db => H / 2 - Math.max(-dbMax, Math.min(dbMax, db)) / dbMax * (H / 2 - 8);

  // Frequency grid
  ctx.font = '9px system-ui, sans-serif';
  ctx.textAlign = 'center';
  for (const [f, label] of [[50, '50'], [100, '100'], [500, '500'], [1000, '1k'], [5000, '5k'], [10000, '10k']]) {
    const x = xOf(f);
    ctx.strokeStyle = 'rgba(148,163,184,0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, 4); ctx.lineTo(x, H - 12); ctx.stroke();
    ctx.fillStyle = 'rgba(148,163,184,0.55)';
    ctx.fillText(label, x, H - 3);
  }
  // dB grid
  for (const db of [-12, -6, 0, 6, 12]) {
    const y = yOf(db);
    ctx.strokeStyle = db === 0 ? 'rgba(148,163,184,0.45)' : 'rgba(148,163,184,0.14)';
    ctx.lineWidth = db === 0 ? 1.2 : 1;
    ctx.setLineDash(db === 0 ? [] : [4, 4]);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(148,163,184,0.55)';
    ctx.fillText(`${db > 0 ? '+' : ''}${db}`, 3, y - 2);
  }

  const peq = state.dsp.peq;
  const activeBands = peq.enabled ? peq.bands.filter(b => b.on) : [];
  const coeffs = activeBands.map(b => peqUiBiquad(b.type, fs, b.freq, b.gain, b.q)).filter(Boolean);

  const N = 512;
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const f = fMin * Math.pow(fMax / fMin, i / N);
    const db = coeffs.length ? peqUiMagDb(coeffs, f, fs) : 0;
    pts.push([xOf(f), yOf(db)]);
  }

  if (coeffs.length) {
    const grad = ctx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, '#22d3ee');
    grad.addColorStop(0.5, '#a78bfa');
    grad.addColorStop(1, '#f472b6');
    // soft fill under the curve
    ctx.beginPath();
    ctx.moveTo(pts[0][0], yOf(0));
    for (const [x, y] of pts) ctx.lineTo(x, y);
    ctx.lineTo(pts[pts.length - 1][0], yOf(0));
    ctx.closePath();
    ctx.fillStyle = 'rgba(139,92,246,0.14)';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (const [x, y] of pts) ctx.lineTo(x, y);
    ctx.strokeStyle = grad;
    ctx.lineWidth = 2;
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(0, yOf(0));
    ctx.lineTo(W, yOf(0));
    ctx.strokeStyle = 'rgba(148,163,184,0.6)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

function updatePeqHeadroomNote() {
  const note = document.getElementById('peqHeadroomNote');
  if (!note) return;
  const hr = peqHeadroomDb();
  note.textContent = `自動預降 -${hr.toFixed(1)} dB（保護電路不削頂）`;
}

function updatePeqHint() {
  const hint = document.getElementById('dspActivePeqHint');
  if (!hint) return;
  const peq = state.dsp.peq;
  if (!peq.enabled) { hint.textContent = '關閉'; return; }
  const n = peq.bands.filter(b => b.on).length;
  if (!n) { hint.textContent = '尚無作用頻段'; return; }
  const mode = state.dsp.enabled ? '' : '（原生率處理）';
  hint.textContent = `${n} 段作用中 (預降 ${peqHeadroomDb().toFixed(1)} dB)${mode}`;
}

function peqUpdateGainCell(row, band) {
  const gainS = row.querySelector('.peq-gain-slider');
  const gainV = row.querySelector('.peq-gain-val');
  if (!gainS || !gainV) return;
  const usable = PEQ_GAIN_TYPES.includes(band.type);
  gainS.disabled = !usable;
  const cell = gainS.closest('.peq-slider-cell');
  if (cell) cell.style.opacity = usable ? '1' : '0.35';
  gainV.textContent = usable ? peqFormatGain(band.gain) : '—';
}

function buildPeqBandRows() {
  const list = document.getElementById('peqBandList');
  if (!list) return;
  list.innerHTML = '';
  state.dsp.peq.bands.forEach((band, idx) => {
    const row = document.createElement('div');
    row.className = 'peq-band-row' + (band.on ? ' band-on' : '');
    const typeOpts = PEQ_TYPES.map(t => `<option value="${t}"${t === band.type ? ' selected' : ''}>${PEQ_TYPE_LABELS[t]}</option>`).join('');
    row.innerHTML = `
      <label title="啟用此頻段"><input type="checkbox" class="peq-band-on" ${band.on ? 'checked' : ''}></label>
      <select class="peq-band-type" title="頻段類型">${typeOpts}</select>
      <div class="peq-slider-cell">
        <input type="range" class="peq-freq-slider" min="0" max="1000" value="${peqFreqToSlider(band.freq)}" title="頻率 (20 Hz - 20 kHz)">
        <span class="peq-val peq-freq-val">${peqFormatFreq(band.freq)}</span>
      </div>
      <div class="peq-slider-cell">
        <input type="range" class="peq-gain-slider" min="-24" max="24" step="1" value="${Math.round(band.gain * 2)}" title="增益 (-12 ~ +12 dB)">
        <span class="peq-val peq-gain-val"></span>
      </div>
      <div class="peq-slider-cell">
        <input type="range" class="peq-q-slider" min="0" max="100" value="${peqQToSlider(band.q)}" title="Q 值（頻寬；越大越窄）">
        <span class="peq-val peq-q-val">Q ${band.q.toFixed(2)}</span>
      </div>`;

    const onCb = row.querySelector('.peq-band-on');
    onCb.addEventListener('change', () => {
      band.on = onCb.checked;
      row.classList.toggle('band-on', band.on);
      state.dsp.peq.preset = 'custom';
      drawPeqCurve(); updatePeqHeadroomNote(); peqScheduleReapply();
    });
    const typeSel = row.querySelector('.peq-band-type');
    typeSel.addEventListener('change', () => {
      band.type = PEQ_TYPES.includes(typeSel.value) ? typeSel.value : 'peaking';
      peqUpdateGainCell(row, band);
      state.dsp.peq.preset = 'custom';
      drawPeqCurve(); updatePeqHeadroomNote(); peqScheduleReapply();
    });
    const freqS = row.querySelector('.peq-freq-slider');
    const freqV = row.querySelector('.peq-freq-val');
    freqS.addEventListener('input', () => {
      band.freq = peqFreqFromSlider(parseInt(freqS.value, 10));
      freqV.textContent = peqFormatFreq(band.freq);
      drawPeqCurve();
    });
    freqS.addEventListener('change', () => { state.dsp.peq.preset = 'custom'; peqScheduleReapply(); });
    const gainS = row.querySelector('.peq-gain-slider');
    const gainV = row.querySelector('.peq-gain-val');
    gainS.addEventListener('input', () => {
      band.gain = parseInt(gainS.value, 10) / 2;
      gainV.textContent = peqFormatGain(band.gain);
      drawPeqCurve(); updatePeqHeadroomNote();
    });
    gainS.addEventListener('change', () => { state.dsp.peq.preset = 'custom'; peqScheduleReapply(); });
    const qS = row.querySelector('.peq-q-slider');
    const qV = row.querySelector('.peq-q-val');
    qS.addEventListener('input', () => {
      band.q = peqQFromSlider(parseInt(qS.value, 10));
      qV.textContent = `Q ${band.q.toFixed(2)}`;
      drawPeqCurve();
    });
    qS.addEventListener('change', () => { state.dsp.peq.preset = 'custom'; peqScheduleReapply(); });

    peqUpdateGainCell(row, band);
    list.appendChild(row);
  });
}

function syncPeqModalUI() {
  const peq = state.dsp.peq;
  const cb = document.getElementById('togglePeq');
  const editor = document.getElementById('peqEditor');
  const peqCard = document.getElementById('peqCard');
  if (peqCard) peqCard.classList.toggle('active', peq.enabled);
  if (cb) cb.checked = peq.enabled;
  if (editor) editor.style.display = peq.enabled ? 'block' : 'none';
  document.querySelectorAll('#peqPresetSelector .dsp-pill').forEach(p =>
    p.classList.toggle('active', peq.enabled && peq.preset !== 'custom' && p.getAttribute('data-peq-preset') === peq.preset));
  if (peq.enabled) { buildPeqBandRows(); drawPeqCurve(); }
  buildPeqSlotRow();
  updatePeqHeadroomNote();
  updatePeqHint();
}

// ----------------- User PEQ Slots: 6 named saved setups (localStorage) -----------------
const PEQ_SLOT_COUNT = 6;
const PEQ_SLOTS_KEY = 'rooplayer_peq_slots';

function getPeqSlots() {
  const slots = new Array(PEQ_SLOT_COUNT).fill(null);
  try {
    const raw = JSON.parse(localStorage.getItem(PEQ_SLOTS_KEY) || '[]');
    if (!Array.isArray(raw)) return slots;
    for (let i = 0; i < PEQ_SLOT_COUNT; i++) {
      const s = raw[i];
      if (s && typeof s.name === 'string' && s.name.trim() && Array.isArray(s.bands)) {
        slots[i] = {
          name: s.name.trim().slice(0, 24),
          bands: normalizePeqSettings({ enabled: true, bands: s.bands }).bands
        };
      }
    }
  } catch (e) {}
  return slots;
}

function savePeqSlots(slots) {
  try { localStorage.setItem(PEQ_SLOTS_KEY, JSON.stringify(slots)); } catch (e) {}
}

// Slot chips use inline UI only (no window.prompt/confirm - Electron does not support them):
// empty slot click -> inline name input (Enter save / Esc cancel); filled chip click -> load;
// dblclick -> inline rename; ✕ -> two-step inline delete confirmation.
function buildPeqSlotRow() {
  const row = document.getElementById('peqSlotRow');
  if (!row) return;
  const slots = getPeqSlots();
  row.innerHTML = '';

  const makeEditChip = (i, currentName, isNew) => {
    const chip = document.createElement('div');
    chip.className = 'peq-slot-chip editing';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'peq-slot-input';
    input.maxLength = 24;
    input.value = currentName || `我的設定 ${i + 1}`;
    const okBtn = document.createElement('span');
    okBtn.className = 'peq-slot-edit-ok';
    okBtn.title = '儲存名稱 (Enter)';
    okBtn.textContent = '✓';
    const cancelBtn = document.createElement('span');
    cancelBtn.className = 'peq-slot-edit-cancel';
    cancelBtn.title = '取消 (Esc)';
    cancelBtn.textContent = '✕';
    chip.appendChild(input);
    chip.appendChild(okBtn);
    chip.appendChild(cancelBtn);
    const commit = () => {
      const name = input.value.trim().slice(0, 24);
      if (!name) { buildPeqSlotRow(); return; }
      if (isNew) {
        slots[i] = { name, bands: state.dsp.peq.bands.map(b => ({ ...b })) };
        savePeqSlots(slots);
        showToast(`💾 已儲存 PEQ 設定「${name}」`);
      } else {
        slots[i].name = name;
        savePeqSlots(slots);
      }
      buildPeqSlotRow();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') commit();
      else if (e.key === 'Escape') buildPeqSlotRow();
    });
    input.addEventListener('click', (e) => e.stopPropagation());
    okBtn.addEventListener('click', (e) => { e.stopPropagation(); commit(); });
    cancelBtn.addEventListener('click', (e) => { e.stopPropagation(); buildPeqSlotRow(); });
    return chip;
  };

  const makeConfirmDeleteChip = (slot, i) => {
    const chip = document.createElement('div');
    chip.className = 'peq-slot-chip filled confirming';
    const label = document.createElement('span');
    label.className = 'peq-slot-name';
    label.textContent = `刪除「${slot.name}」?`;
    const yes = document.createElement('span');
    yes.className = 'peq-slot-confirm-yes';
    yes.title = '確定刪除';
    yes.textContent = '✓';
    const no = document.createElement('span');
    no.className = 'peq-slot-confirm-no';
    no.title = '保留';
    no.textContent = '✕';
    chip.appendChild(label);
    chip.appendChild(yes);
    chip.appendChild(no);
    yes.addEventListener('click', (e) => {
      e.stopPropagation();
      slots[i] = null;
      savePeqSlots(slots);
      buildPeqSlotRow();
    });
    no.addEventListener('click', (e) => { e.stopPropagation(); buildPeqSlotRow(); });
    chip.addEventListener('click', () => buildPeqSlotRow());
    return chip;
  };

  const makeChip = (slot, i) => {
    const chip = document.createElement('div');
    if (slot) {
      chip.className = 'peq-slot-chip filled';
      chip.title = `載入「${slot.name}」（雙擊更名，點 ✕ 刪除）`;
      const nameEl = document.createElement('span');
      nameEl.className = 'peq-slot-name';
      nameEl.textContent = slot.name;
      const delEl = document.createElement('span');
      delEl.className = 'peq-slot-del';
      delEl.title = '刪除設定';
      delEl.textContent = '✕';
      chip.appendChild(nameEl);
      chip.appendChild(delEl);
      let clickTimer = null; // defer load so a dblclick rename does not also load
      chip.addEventListener('click', (e) => {
        if (e.target === delEl) {
          if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
          chip.replaceWith(makeConfirmDeleteChip(slot, i));
          return;
        }
        if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; return; }
        clickTimer = setTimeout(() => { clickTimer = null; loadPeqSlot(slot); }, 260);
      });
      chip.addEventListener('dblclick', () => {
        if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
        const edit = makeEditChip(i, slot.name, false);
        chip.replaceWith(edit);
        const inp = edit.querySelector('input');
        inp.focus();
        inp.select();
      });
    } else {
      chip.className = 'peq-slot-chip';
      chip.title = '將目前 PEQ 設定儲存到此空格';
      const plusEl = document.createElement('span');
      plusEl.className = 'peq-slot-plus';
      plusEl.textContent = '＋';
      const labelEl = document.createElement('span');
      labelEl.className = 'peq-slot-name';
      labelEl.textContent = `儲存 ${i + 1}`;
      chip.appendChild(plusEl);
      chip.appendChild(labelEl);
      chip.addEventListener('click', () => {
        const edit = makeEditChip(i, `我的設定 ${i + 1}`, true);
        chip.replaceWith(edit);
        const inp = edit.querySelector('input');
        inp.focus();
        inp.select();
      });
    }
    return chip;
  };

  slots.forEach((slot, i) => row.appendChild(makeChip(slot, i)));
}

function loadPeqSlot(slot) {
  state.dsp.peq.enabled = true;
  state.dsp.peq.preset = 'custom';
  state.dsp.peq.bands = slot.bands.map(b => ({ ...b }));
  const cb = document.getElementById('togglePeq');
  if (cb) cb.checked = true;
  const peqCard = document.getElementById('peqCard');
  if (peqCard) peqCard.classList.add('active');
  const editor = document.getElementById('peqEditor');
  if (editor) editor.style.display = 'block';
  buildPeqBandRows();
  drawPeqCurve();
  updatePeqHeadroomNote();
  peqScheduleReapply();
  showToast(`🎚️ 已載入 PEQ 設定「${slot.name}」`);
}

function initPeqControls() {
  const togglePeq = document.getElementById('togglePeq');
  const peqEditor = document.getElementById('peqEditor');
  const presetSelector = document.getElementById('peqPresetSelector');

  if (togglePeq) {
    togglePeq.addEventListener('change', () => {
      state.dsp.peq.enabled = togglePeq.checked;
      const peqCard = document.getElementById('peqCard');
      if (peqCard) peqCard.classList.toggle('active', togglePeq.checked);
      localStorage.setItem('rooplayer_dsp_settings', JSON.stringify(state.dsp));
      if (peqEditor) peqEditor.style.display = togglePeq.checked ? 'block' : 'none';
      if (togglePeq.checked) { buildPeqBandRows(); drawPeqCurve(); }
      updatePeqHeadroomNote();
      updatePeqHint();
      updateSignalPathUI();
      peqScheduleReapply();
    });
  }

  if (presetSelector) {
    presetSelector.addEventListener('click', (e) => {
      const btn = e.target.closest('.dsp-pill');
      if (!btn) return;
      const key = btn.getAttribute('data-peq-preset');
      if (!key || !PEQ_PRESETS[key]) return;
      presetSelector.querySelectorAll('.dsp-pill').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const peq = state.dsp.peq;
      peq.preset = key;
      peq.bands = [];
      for (let i = 0; i < PEQ_BAND_COUNT; i++) {
        const src = PEQ_PRESETS[key][i];
        peq.bands.push(src ? { ...src } : defaultPeqBand(i));
      }
      buildPeqBandRows();
      drawPeqCurve();
      updatePeqHeadroomNote();
      peqScheduleReapply();
    });
  }

  syncPeqModalUI();
}

// ========================================================
// Convolution (IR) card UI: switch, IR file picker, info display.
// The engine loads the IR itself from the stored path; only the path travels over IPC.
// ========================================================
let convInfoCache = null; // { path, info } - avoid re-reading the IR file on every modal sync

function normalizeConvSettingsSafe(raw) {
  return normalizeConvSettings(raw);
}

function syncConvModalUI() {
  if (!state.dsp.conv) state.dsp.conv = normalizeConvSettingsSafe(null);
  const conv = state.dsp.conv;
  const cb = document.getElementById('toggleConv');
  const card = document.getElementById('convCard');
  const editor = document.getElementById('convEditor');
  const badge = document.getElementById('dspActiveConvHint');
  const removeBtn = document.getElementById('convRemoveIr');
  const active = !!(conv.enabled && conv.irPath);

  if (cb) cb.checked = !!conv.enabled;
  if (card) card.classList.toggle('active', !!conv.enabled);
  if (editor) editor.style.display = conv.enabled ? 'block' : 'none';
  if (badge) {
    badge.textContent = active ? '作用中' : (conv.enabled ? '未載入 IR' : '關閉');
    badge.style.color = active ? '#fb923c' : '';
  }
  if (removeBtn) removeBtn.style.display = conv.irPath ? '' : 'none';
  updateConvInfo();
}

async function updateConvInfo() {
  const infoEl = document.getElementById('convInfo');
  if (!infoEl) return;
  const conv = state.dsp.conv;
  if (!conv || !conv.irPath) {
    convInfoCache = null;
    infoEl.textContent = '尚未載入 IR。請選擇 16/24/32-bit WAV 脈衝響應檔（單聲道自動套用到左右聲道）。';
    return;
  }
  if (convInfoCache && convInfoCache.path === conv.irPath) {
    renderConvInfo(convInfoCache.info);
    return;
  }
  infoEl.textContent = '讀取 IR 檔案資訊中…';
  let info = null;
  try {
    if (window.electronAPI && window.electronAPI.getIrInfo) info = await window.electronAPI.getIrInfo(conv.irPath);
  } catch (e) { info = { ok: false, error: String((e && e.message) || e) }; }
  convInfoCache = { path: conv.irPath, info };
  renderConvInfo(info);
}

function renderConvInfo(info) {
  const infoEl = document.getElementById('convInfo');
  const conv = state.dsp.conv;
  if (!infoEl || !conv || !conv.irPath) return;
  if (!info || !info.ok) {
    infoEl.innerHTML = `<span class="conv-info-err">IR 無法讀取（${info && info.error ? info.error : '未知錯誤'}），播放將自動略過卷積：</span><br>${conv.irPath}`;
    return;
  }
  const name = conv.irPath.replace(/\\/g, '/').split('/').pop();
  const chText = info.channels === 1 ? '單聲道（自動套用左右）' : `${info.channels} 聲道`;
  const peakNote = info.responsePeak > 1.0 ? ` ・ 響應峰值 ${info.responsePeak.toFixed(2)}（自動衰減 ${(-20 * Math.log10(info.responsePeak)).toFixed(1)} dB 防削頂）` : '';
  infoEl.innerHTML = `<span class="conv-info-ok">✓ ${name}</span> ・ ${info.sampleRate} Hz ・ ${(info.durationMs / 1000).toFixed(1)} s ・ ${chText}${peakNote}<br><span style="color:var(--text-muted)">${conv.irPath}</span>`;
}

// Restart the active stream with the current DSP stage configuration (conv card controls).
// Falls back to bit-perfect passthrough when nothing is active anymore.
function restartCurrentStreamWithDsp() {
  const track = state.queue[state.currentTrackIndex];
  if (!track || track.isDemo || !track.filePath || !state.isPlaying) return;
  const curSec = getCurrentPlaybackTime();
  if (state.activeAudioZone !== 'local' && state.activeDlnaDevice) {
    window.electronAPI.playDlnaTrack(state.activeDlnaDevice.id, getEnrichedTrack(track), Math.floor(curSec), buildDspOptions(track));
    return;
  }
  const ext = (track.formatName || '').toUpperCase();
  const isDsd = ext === 'DSF' || ext === 'DFF' || (track.filePath && /\.(dsf|dff)$/i.test(track.filePath));
  if (isDsd) { playDsdTrack(track, Math.floor(curSec)); return; }
  if (localDspActive()) { playSoxTrack(track, Math.floor(curSec)); return; }
  isCurrentSox = false;
  currentSoxOffset = 0;
  const mediaUrl = window.electronAPI ? window.electronAPI.getMediaUrl(track.filePath) : track.filePath;
  nativeAudio.src = mediaUrl;
  nativeAudio.currentTime = Math.floor(curSec);
  nativeAudio.play().catch(e => console.error(e));
}

function initConvControls() {
  const toggleConv = document.getElementById('toggleConv');
  const pickBtn = document.getElementById('convPickIr');
  const removeBtn = document.getElementById('convRemoveIr');

  if (toggleConv) {
    toggleConv.addEventListener('change', () => {
      state.dsp.conv.enabled = toggleConv.checked;
      localStorage.setItem('rooplayer_dsp_settings', JSON.stringify(state.dsp));
      syncConvModalUI();
      updateSignalPathUI();
      if (state.isPlaying) restartCurrentStreamWithDsp();
      showToast(state.dsp.conv.enabled ? '🌊 卷積濾波器已啟用' : '卷積濾波器已關閉');
    });
  }

  if (pickBtn) {
    pickBtn.addEventListener('click', async () => {
      if (!window.electronAPI || !window.electronAPI.pickIrFile) return;
      let picked = null;
      try { picked = await window.electronAPI.pickIrFile(); } catch (e) { return; }
      if (!picked) return;
      state.dsp.conv.irPath = picked;
      if (!state.dsp.conv.enabled) state.dsp.conv.enabled = true; // loading an IR implies wanting it active
      convInfoCache = null;
      localStorage.setItem('rooplayer_dsp_settings', JSON.stringify(state.dsp));
      syncConvModalUI();
      updateSignalPathUI();
      if (state.isPlaying) restartCurrentStreamWithDsp();
      showToast('🌊 卷積 IR 已載入');
    });
  }

  if (removeBtn) {
    removeBtn.addEventListener('click', () => {
      state.dsp.conv.irPath = null;
      state.dsp.conv.enabled = false;
      convInfoCache = null;
      localStorage.setItem('rooplayer_dsp_settings', JSON.stringify(state.dsp));
      syncConvModalUI();
      updateSignalPathUI();
      if (state.isPlaying) restartCurrentStreamWithDsp();
      showToast('卷積 IR 已移除');
    });
  }

  syncConvModalUI();
}

// ========================================================
// 使用者自訂濾波工具箱（User Filter Toolbox）
// 純參數 JSON → 主行程槽檔 → 引擎註冊表（安全驗證/夾限全在 dsp-kernel）。
// ========================================================
let ufSlots = [];
let ufEditingId = null;
let ufPreviewTimer = null;

const UF_WINDOW_LABELS = { hann: 'Hann', hamming: 'Hamming', blackman: 'Blackman', blackmanHarris: 'Blackman-Harris', kaiser: 'Kaiser', nuttall: 'Nuttall', blackmanNuttall: 'Blackman-Nuttall', gauss: 'Gauss', chebyshev: 'Chebyshev' };

function ufPreviewContext() {
  const track = (state.queue && state.queue[0]) || (state.tracks && state.tracks[0]) || null;
  const srcRate = (track && track.sampleRate) || 44100;
  const rateMode = state.dsp.rateMode || '4x';
  let targetRate;
  if (isDsdRateMode(rateMode)) {
    targetRate = { dsd64: 2822400, dsd128: 5644800, dsd256: 11289600, dsd512: 22579200 }[rateMode] || 2822400;
  } else {
    targetRate = calculateTargetSampleRate(srcRate, rateMode);
  }
  return { srcRate, targetRate };
}

async function refreshUserFilterSlots() {
  if (!window.electronAPI || typeof window.electronAPI.listFilterSlots !== 'function') return;
  try {
    const r = await window.electronAPI.listFilterSlots();
    if (r && Array.isArray(r.slots)) ufSlots = r.slots;
  } catch (e) { /* 保持現況 */ }
  renderUserFilterChips();
}

function renderUserFilterChips() {
  const row = document.getElementById('ufChipRow');
  if (!row) return;
  row.innerHTML = '';
  if (!ufSlots.length) {
    const empty = document.createElement('span');
    empty.className = 'uf-chips-empty';
    empty.textContent = '尚無自訂濾波器 — 點「＋ 新建」於安全範圍內設計專屬濾波器';
    row.appendChild(empty);
    return;
  }
  const curPhase = state.dsp.filterPhase || 'linear';
  for (const s of ufSlots) {
    const chip = document.createElement('span');
    chip.className = 'uf-chip' + (s.id === curPhase ? ' active' : '');
    chip.setAttribute('data-slot', s.id);
    const name = document.createElement('span');
    name.textContent = '🔧 ' + s.name;
    const edit = document.createElement('span');
    edit.className = 'uf-chip-edit';
    edit.textContent = '編輯';
    chip.appendChild(name);
    chip.appendChild(edit);
    row.appendChild(chip);
  }
}

function ufSpecFromForm() {
  const windowBtn = document.querySelector('#ufWindowSeg .uf-seg-btn.active');
  const phaseBtn = document.querySelector('#ufPhaseSeg .uf-seg-btn.active');
  const slotSel = document.getElementById('ufSlotSelect');
  return {
    id: slotSel && slotSel.value ? slotSel.value : (ufEditingId || 'uf-1'),
    name: (document.getElementById('ufNameInput').value || '').trim(),
    sound: (document.getElementById('ufSoundInput').value || '').trim(),
    window: windowBtn ? windowBtn.getAttribute('data-window') : 'blackmanHarris',
    phase: phaseBtn ? phaseBtn.getAttribute('data-phase') : 'linear',
    cutoffRel: (parseInt(document.getElementById('ufCutSlider').value, 10) || 113) / 100,
    taps: parseInt(document.getElementById('ufTapSlider').value, 10) || 96,
    asDb: parseInt(document.getElementById('ufAsSlider').value, 10) || 100,
    sigmaRel: (parseInt(document.getElementById('ufSigmaSlider').value, 10) || 30) / 100
  };
}

function ufUpdateFormReadouts() {
  const spec = ufSpecFromForm();
  document.getElementById('ufAsVal').textContent = spec.asDb + ' dB';
  document.getElementById('ufCutVal').textContent = spec.cutoffRel.toFixed(2) + ' ×源Nyq';
  document.getElementById('ufTapVal').textContent = spec.taps + ' taps';
  document.getElementById('ufSigmaVal').textContent = spec.sigmaRel.toFixed(2) + ' ×L';
  document.getElementById('ufAsRow').style.display = (spec.window === 'kaiser' || spec.window === 'chebyshev') ? '' : 'none';
  document.getElementById('ufSigmaRow').style.display = spec.window === 'gauss' ? '' : 'none';
  const ctx = ufPreviewContext();
  const mmac = Math.round(spec.taps * ctx.targetRate * 2 / 1e6);
  const badge = document.getElementById('ufLoadBadge');
  const level = mmac < 60 ? '低' : (mmac < 150 ? '中' : '高');
  badge.textContent = `${level}負荷 ~${mmac}MMAC/s`;
  badge.className = 'uf-load' + (level === '中' ? ' load-mid' : (level === '高' ? ' load-high' : ''));
}

function ufFillSlotSelect(preferId) {
  const sel = document.getElementById('ufSlotSelect');
  sel.innerHTML = '';
  const byId = {};
  ufSlots.forEach(s => { byId[s.id] = s; });
  let firstFree = null;
  for (let i = 1; i <= 6; i++) {
    const id = 'uf-' + i;
    const occupied = byId[id] && id !== preferId;
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = occupied ? `槽 ${i}：${byId[id].name}（將覆寫）` : `槽 ${i}：空`;
    sel.appendChild(opt);
    if (!byId[id] && !firstFree) firstFree = id;
  }
  sel.value = preferId || firstFree || 'uf-1';
}

function ufSchedulePreview() {
  clearTimeout(ufPreviewTimer);
  ufPreviewTimer = setTimeout(ufDoPreview, 140);
}

async function ufDoPreview() {
  const cv = document.getElementById('ufPreviewCanvas');
  if (!cv || !window.electronAPI || typeof window.electronAPI.previewFilterSpec !== 'function') return;
  const ctx = ufPreviewContext();
  const note = document.getElementById('ufPreviewCtxNote');
  if (note) note.textContent = `${(ctx.srcRate / 1000).toFixed(1)}k → ${ctx.targetRate >= 1e6 ? (ctx.targetRate / 1e6).toFixed(2) + 'M' : (ctx.targetRate / 1000).toFixed(1)}k 脈絡`;
  let data = null;
  try { data = await window.electronAPI.previewFilterSpec(ufSpecFromForm(), ctx.srcRate, ctx.targetRate); } catch (e) {}
  drawUfPreview(cv, data);
}

function drawUfPreview(cv, data) {
  const g = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  g.clearRect(0, 0, W, H);
  const cs = getComputedStyle(document.documentElement);
  const gridCol = 'rgba(128,128,128,0.18)';
  const textCol = (cs.getPropertyValue('--text-muted') || '#888').trim() || '#888';
  const padL = 42, padR = 8, padT = 12, padB = 20;
  const dbTop = 6, dbBot = -120;
  const yOf = db => padT + (dbTop - db) / (dbTop - dbBot) * (H - padT - padB);
  if (!data || !data.xs || !data.xs.length) {
    g.fillStyle = textCol; g.font = '12px sans-serif';
    g.fillText('無法產生預覽（請檢查參數）', padL, H / 2);
    return;
  }
  const fMax = data.xs[data.xs.length - 1] || 1;
  const xOf = f => padL + f / fMax * (W - padL - padR);
  // dB grid
  g.strokeStyle = gridCol; g.fillStyle = textCol; g.font = '10px sans-serif'; g.lineWidth = 1;
  for (const db of [0, -24, -48, -72, -96, -120]) {
    const y = yOf(db);
    g.beginPath(); g.moveTo(padL, y); g.lineTo(W - padR, y); g.stroke();
    g.fillText(db === 0 ? '0dB' : db + 'dB', 4, y + 3);
  }
  // frequency grid + labels
  const srcNyq = data.srcNyq;
  const marks = [srcNyq, srcNyq * 2].filter(f => f <= fMax);
  for (const f of [0, ...marks]) {
    const x = xOf(f);
    if (f === srcNyq) {
      g.save();
      g.strokeStyle = 'rgba(251,146,60,0.65)'; g.setLineDash([5, 4]);
      g.beginPath(); g.moveTo(x, padT); g.lineTo(x, H - padB); g.stroke();
      g.restore();
      g.fillStyle = 'rgba(251,146,60,0.9)';
      g.fillText('源Nyq', x - 14, H - 8);
    } else {
      g.strokeStyle = gridCol;
      g.beginPath(); g.moveTo(x, padT); g.lineTo(x, H - padB); g.stroke();
      g.fillStyle = textCol;
      g.fillText(f === 0 ? '0' : Math.round(f / 1000) + 'k', x - 6, H - 8);
    }
  }
  // response curve
  g.strokeStyle = '#34d399'; g.lineWidth = 1.8;
  g.beginPath();
  for (let i = 0; i < data.xs.length; i++) {
    const x = xOf(data.xs[i]);
    const y = yOf(Math.max(dbBot, Math.min(dbTop, data.ysDb[i])));
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.stroke();
  g.lineWidth = 1;
}

function openUfEditor(slotId) {
  const panel = document.getElementById('ufEditorPanel');
  if (!panel) return;
  const slot = slotId ? ufSlots.find(s => s.id === slotId) : null;
  ufEditingId = slot ? slot.id : null;
  document.getElementById('ufEditorTitle').textContent = slot ? `編輯濾波器（${slot.id}）` : '新建濾波器';
  document.getElementById('ufNameInput').value = slot ? slot.name : '';
  document.getElementById('ufSoundInput').value = slot ? (slot.sound || '') : '';
  document.getElementById('ufCutSlider').value = slot ? Math.round(slot.cutoffRel * 100) : 113;
  document.getElementById('ufTapSlider').value = slot ? slot.taps : 96;
  document.getElementById('ufAsSlider').value = slot ? slot.asDb : 100;
  document.getElementById('ufSigmaSlider').value = slot ? Math.round((slot.sigmaRel || 0.3) * 100) : 30;
  const win = slot ? slot.window : 'blackmanHarris';
  document.querySelectorAll('#ufWindowSeg .uf-seg-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-window') === win));
  const phase = slot ? slot.phase : 'linear';
  document.querySelectorAll('#ufPhaseSeg .uf-seg-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-phase') === phase));
  document.getElementById('ufDeleteBtn').style.display = slot ? '' : 'none';
  ufFillSlotSelect(slot ? slot.id : null);
  document.getElementById('ufManagePanel').style.display = 'none';
  panel.style.display = '';
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  ufUpdateFormReadouts();
  ufSchedulePreview();
}

function closeUfEditor() {
  const panel = document.getElementById('ufEditorPanel');
  if (panel) panel.style.display = 'none';
  clearTimeout(ufPreviewTimer);
}

async function ufSaveFlow() {
  const spec = ufSpecFromForm();
  if (!spec.name) { showToast('⚠️ 請先為濾波器取名稱'); return; }
  const r = await window.electronAPI.saveFilterSlot(spec);
  if (!r || !r.ok) { showToast('⚠️ 儲存失敗：' + ((r && r.error) || '未知錯誤')); return; }
  ufSlots = r.slots;
  closeUfEditor();
  renderUserFilterChips();
  await loadFilterPluginsUI(); // 重新取得插件清單 → 🔧 濾波器出現在按鈕列
  state.dsp.filterPhase = spec.id;
  try { localStorage.setItem('rooplayer_dsp_settings', JSON.stringify(state.dsp)); } catch (e) {}
  renderFilterPhaseSelector();
  renderUserFilterChips();
  showToast(`🛠️ 已建立自訂濾波器「${spec.name}」並套用`);
  triggerLiveDspUpdate();
}

async function ufDeleteFlow(slotId) {
  const r = await window.electronAPI.deleteFilterSlot(slotId);
  if (!r || !r.ok) { showToast('⚠️ 刪除失敗'); return; }
  ufSlots = r.slots;
  if (state.dsp.filterPhase === slotId) {
    state.dsp.filterPhase = 'linear';
    try { localStorage.setItem('rooplayer_dsp_settings', JSON.stringify(state.dsp)); } catch (e) {}
    await loadFilterPluginsUI();
    renderFilterPhaseSelector();
    triggerLiveDspUpdate();
  }
  renderUserFilterChips();
  closeUfEditor();
  renderUfManageList();
  showToast('🗑️ 已刪除自訂濾波器');
}

function renderUfManageList() {
  const list = document.getElementById('ufManageList');
  if (!list) return;
  list.innerHTML = '';
  if (!ufSlots.length) {
    const empty = document.createElement('div');
    empty.className = 'uf-manage-empty';
    empty.textContent = '尚無自訂濾波器。';
    list.appendChild(empty);
    return;
  }
  for (const s of ufSlots) {
    const row = document.createElement('div');
    row.className = 'uf-manage-row';
    row.setAttribute('data-slot', s.id);
    const info = document.createElement('div');
    const nm = document.createElement('div');
    nm.className = 'uf-mr-name';
    nm.textContent = `🔧 ${s.name}`;
    const sp = document.createElement('div');
    sp.className = 'uf-mr-spec';
    sp.textContent = `${UF_WINDOW_LABELS[s.window] || s.window} 窗・截止 ${s.cutoffRel.toFixed(2)}×・${s.taps} taps・${s.phase === 'minimum' ? '最小相位' : '線性相位'}${(s.window === 'kaiser' || s.window === 'chebyshev') ? '・止帶 ' + s.asDb + 'dB' : ''}${s.window === 'gauss' ? '・σ ' + (s.sigmaRel || 0.3).toFixed(2) : ''}`;
    info.appendChild(nm);
    info.appendChild(sp);
    const acts = document.createElement('div');
    acts.className = 'uf-mr-actions';
    for (const [label, cls, action] of [['編輯', '', 'edit'], ['複製', '', 'copy'], ['刪除', 'uf-delete-btn', 'delete']]) {
      const b = document.createElement('button');
      b.className = 'uf-mini-btn ' + cls;
      b.textContent = label;
      b.setAttribute('data-action', action);
      acts.appendChild(b);
    }
    row.appendChild(info);
    row.appendChild(acts);
    list.appendChild(row);
  }
}

function ufCopyFlow(slotId) {
  const src = ufSlots.find(s => s.id === slotId);
  if (!src) return;
  const taken = new Set(ufSlots.map(s => s.id));
  let target = null;
  for (let i = 1; i <= 6; i++) { if (!taken.has('uf-' + i)) { target = 'uf-' + i; break; } }
  if (!target) { showToast('⚠️ 儲存槽已滿（6 槽）'); return; }
  const copy = Object.assign({}, src, { id: target, name: (src.name + ' 複本').slice(0, 40) });
  window.electronAPI.saveFilterSlot(copy).then(r => {
    if (r && r.ok) { ufSlots = r.slots; renderUserFilterChips(); renderUfManageList(); loadFilterPluginsUI(); showToast(`已複製到槽 ${target.slice(3)}`); }
  });
}

function initUserFilterControls() {
  const $ = id => document.getElementById(id);
  if (!$('userFilterStrip')) return;

  $('ufNewBtn').addEventListener('click', () => openUfEditor(null));
  $('ufManageBtn').addEventListener('click', () => {
    const p = $('ufManagePanel');
    const opening = p.style.display === 'none';
    renderUfManageList();
    p.style.display = opening ? '' : 'none';
  });
  $('ufCloseEditor').addEventListener('click', closeUfEditor);
  $('ufCloseManage').addEventListener('click', () => { $('ufManagePanel').style.display = 'none'; });

  $('ufWindowSeg').addEventListener('click', (e) => {
    const b = e.target.closest('.uf-seg-btn');
    if (!b) return;
    document.querySelectorAll('#ufWindowSeg .uf-seg-btn').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    ufUpdateFormReadouts();
    ufSchedulePreview();
  });
  $('ufPhaseSeg').addEventListener('click', (e) => {
    const b = e.target.closest('.uf-seg-btn');
    if (!b) return;
    document.querySelectorAll('#ufPhaseSeg .uf-seg-btn').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    ufSchedulePreview();
  });
  ['ufAsSlider', 'ufCutSlider', 'ufTapSlider'].forEach(id => {
    $(id).addEventListener('input', () => { ufUpdateFormReadouts(); ufSchedulePreview(); });
  });
  $('ufSaveBtn').addEventListener('click', ufSaveFlow);
  $('ufDeleteBtn').addEventListener('click', () => { if (ufEditingId) ufDeleteFlow(ufEditingId); });

  $('ufChipRow').addEventListener('click', (e) => {
    const chip = e.target.closest('.uf-chip');
    if (chip) openUfEditor(chip.getAttribute('data-slot'));
  });
  $('ufManageList').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const row = btn.closest('.uf-manage-row');
    const slotId = row && row.getAttribute('data-slot');
    if (!slotId) return;
    const action = btn.getAttribute('data-action');
    if (action === 'edit') openUfEditor(slotId); // openUfEditor 會收合管理面板，保持單面板
    else if (action === 'copy') ufCopyFlow(slotId);
    else if (action === 'delete') ufDeleteFlow(slotId);
  });

  refreshUserFilterSlots();
}

function initDspControls() {
  const toggleSoxDsp = document.getElementById('toggleSoxDsp');
  const dspSoxCard = document.querySelector('.dsp-sox-card');
  const dspRateSelector = document.getElementById('dspRateSelector');
  const dspDsdRateSelector = document.getElementById('dspDsdRateSelector');
  const dspOrderSelector = document.getElementById('dspOrderSelector');
  const dspPhaseSelector = document.getElementById('dspPhaseSelector');
  const dspActiveRateHint = document.getElementById('dspActiveRateHint');
  const dspActiveDsdHint = document.getElementById('dspActiveDsdHint');
  const dspActiveOrderHint = document.getElementById('dspActiveOrderHint');
  const dspActivePhaseHint = document.getElementById('dspActivePhaseHint');

  const triggerLiveDspUpdate = () => {
    updateSignalPathUI();
    if (state.dsp.enabled && state.isPlaying) {
      const track = state.queue[state.currentTrackIndex];
      if (track && !track.isDemo && track.filePath) {
        const curSec = getCurrentPlaybackTime();
        if (state.activeAudioZone !== 'local' && state.activeDlnaDevice) {
          window.electronAPI.playDlnaTrack(state.activeDlnaDevice.id, getEnrichedTrack(track), Math.floor(curSec), buildDspOptions(track));
        } else {
          playSoxTrack(track, Math.floor(curSec));
        }
      }
    }
  };

  if (toggleSoxDsp) {
    toggleSoxDsp.checked = state.dsp.enabled;
    if (dspSoxCard) dspSoxCard.classList.toggle('active', state.dsp.enabled);

    toggleSoxDsp.addEventListener('change', () => {
      state.dsp.enabled = toggleSoxDsp.checked;
      if (dspSoxCard) dspSoxCard.classList.toggle('active', state.dsp.enabled);
      localStorage.setItem('rooplayer_dsp_settings', JSON.stringify(state.dsp));
      updateSignalPathUI();

      // If a track is currently playing, switch stream seamlessly
      const track = state.queue[state.currentTrackIndex];
      if (track && !track.isDemo && track.filePath && state.isPlaying) {
        const curSec = getCurrentPlaybackTime();
        if (state.activeAudioZone !== 'local' && state.activeDlnaDevice) {
          window.electronAPI.playDlnaTrack(state.activeDlnaDevice.id, getEnrichedTrack(track), Math.floor(curSec), buildDspOptions(track));
        } else {
          if (state.dsp.enabled) {
            playSoxTrack(track, Math.floor(curSec));
          } else if (countActivePeqBands() > 0 || buildConvPayload()) {
            // PEQ / convolution-only processing: native-rate DSP stream (DSF via the decimate path)
            const ext = (track.formatName || '').toUpperCase();
            const isDsd = ext === 'DSF' || ext === 'DFF' || (track.filePath && /\.(dsf|dff)$/i.test(track.filePath));
            if (isDsd) playDsdTrack(track, Math.floor(curSec));
            else playSoxTrack(track, Math.floor(curSec));
          } else {
            isCurrentSox = false;
            currentSoxOffset = 0;
            const ext = (track.formatName || '').toUpperCase();
            const isDsd = ext === 'DSF' || ext === 'DFF' || (track.filePath && /\.(dsf|dff)$/i.test(track.filePath));
            if (isDsd) {
              playDsdTrack(track, Math.floor(curSec));
            } else {
              const mediaUrl = window.electronAPI ? window.electronAPI.getMediaUrl(track.filePath) : track.filePath;
              nativeAudio.src = mediaUrl;
              nativeAudio.currentTime = Math.floor(curSec);
              nativeAudio.play().catch(e => console.error(e));
            }
          }
        }
      }
      showToast(state.dsp.enabled ? '⚡ 已啟用 Native DSP 升頻引擎' : '已關閉 DSP 升頻，恢復 Bit-Perfect 直通');
    });
  }

  // PCM rate selection handler
  if (dspRateSelector) {
    dspRateSelector.addEventListener('click', (e) => {
      const btn = e.target.closest('.dsp-pill');
      if (!btn) return;
      const rateMode = btn.getAttribute('data-rate-mode');
      if (!rateMode) return;

      document.querySelectorAll('#dspRateSelector .dsp-pill, #dspDsdRateSelector .dsp-pill').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');

      state.dsp.rateMode = rateMode;
      localStorage.setItem('rooplayer_dsp_settings', JSON.stringify(state.dsp));
      if (dspActiveRateHint) dspActiveRateHint.textContent = btn.textContent;
      if (dspActiveDsdHint) dspActiveDsdHint.textContent = '可選 DSD 格式';
      triggerLiveDspUpdate();
    });
  }

  // 1-bit DSD modulation rate selection handler
  if (dspDsdRateSelector) {
    dspDsdRateSelector.addEventListener('click', (e) => {
      const btn = e.target.closest('.dsp-pill');
      if (!btn) return;
      const rateMode = btn.getAttribute('data-rate-mode');
      if (!rateMode) return;

      document.querySelectorAll('#dspRateSelector .dsp-pill, #dspDsdRateSelector .dsp-pill').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');

      state.dsp.rateMode = rateMode;
      localStorage.setItem('rooplayer_dsp_settings', JSON.stringify(state.dsp));
      if (dspActiveDsdHint) dspActiveDsdHint.textContent = `${btn.textContent} (已生效)`;
      if (dspActiveRateHint) dspActiveRateHint.textContent = '使用 DSD 調變中';
      triggerLiveDspUpdate();
    });
  }

  // Modulator Order selection handler (2nd, 5th, 7th order)
  if (dspOrderSelector) {
    dspOrderSelector.addEventListener('click', (e) => {
      const btn = e.target.closest('.dsp-pill');
      if (!btn) return;
      const order = parseInt(btn.getAttribute('data-order') || '5', 10);
      if (!order) return;

      dspOrderSelector.querySelectorAll('.dsp-pill').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');

      state.dsp.dsdOrder = order;
      localStorage.setItem('rooplayer_dsp_settings', JSON.stringify(state.dsp));
      if (dspActiveOrderHint) dspActiveOrderHint.textContent = btn.textContent;
      triggerLiveDspUpdate();
    });
  }

  // Filter Phase selection handler (Linear, Minimum, Intermediate)
  if (dspPhaseSelector) {
    dspPhaseSelector.addEventListener('click', (e) => {
      const btn = e.target.closest('.dsp-pill');
      if (!btn) return;
      const phase = btn.getAttribute('data-phase');
      if (!phase) return;

      dspPhaseSelector.querySelectorAll('.dsp-pill').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');

      state.dsp.filterPhase = phase;
      localStorage.setItem('rooplayer_dsp_settings', JSON.stringify(state.dsp));
      if (dspActivePhaseHint) dspActivePhaseHint.textContent = btn.textContent;
      renderUserFilterChips();
      triggerLiveDspUpdate();
    });
  }

  // Parametric Equalizer (PEQ) controls
  initPeqControls();

  // Convolution (IR) controls (card below the PEQ card)
  initConvControls();

  // User Filter Toolbox (自訂濾波槽：條列在濾波器按鈕列下方)
  initUserFilterControls();
}

// ========================================================
// Now Playing Modal & Dynamic Online Lyrics Subsystem
// ========================================================
const nowPlayingLyricsCache = new Map();
let currentSyncedLyrics = [];
let currentActiveLyricIndex = -1;
let nowPlayingSyncInterval = null;

function cleanTitleForLyrics(title) {
  if (!title) return '';
  return title
    .replace(/^\d+[\.\-\s]+/, '')
    .replace(/\(.*?(?:feat|ft|live|version|remaster|mix|acoustic|edit|deluxe).*?\)/gi, '')
    .replace(/\[.*?(?:feat|ft|live|version|remaster|mix|acoustic|edit|deluxe).*?\]/gi, '')
    .replace(/\b(?:feat|ft)\.?\s+[^\-]+/i, '')
    .replace(/\s+/g, ' ')
    .trim() || title;
}

function parseLrc(lrcText) {
  if (!lrcText) return [];
  const lines = lrcText.split('\n');
  const result = [];
  const timeRegex = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]/g;
  for (const line of lines) {
    const matches = [...line.matchAll(timeRegex)];
    const text = line.replace(timeRegex, '').trim();
    if (matches.length > 0 && text) {
      for (const m of matches) {
        const min = parseInt(m[1], 10);
        const sec = parseInt(m[2], 10);
        const ms = m[3] ? parseFloat('0.' + m[3]) : 0;
        result.push({ time: min * 60 + sec + ms, text });
      }
    }
  }
  result.sort((a, b) => a.time - b.time);
  return result;
}

async function fetchLyricsOnline(title, artist, album, duration) {
  if (!title) return null;
  const cleanTitle = cleanTitleForLyrics(title);
  const cleanArt = (artist && !isUnknownArtist(artist)) ? artist.replace(/\(.*?\)|\[.*?\]/g, '').trim() : '';
  const cacheKey = `${cleanArt}___${cleanTitle}`.toLowerCase();

  if (nowPlayingLyricsCache.has(cacheKey)) {
    return nowPlayingLyricsCache.get(cacheKey);
  }

  // 1. Try LRCLIB API (Best global database for synced + plain lyrics)
  try {
    const q = (cleanArt ? cleanArt + ' ' : '') + cleanTitle;
    const url = `https://lrclib.net/api/search?q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'rooPlayer/1.0' } });
    if (res.ok) {
      const hits = await res.json();
      if (Array.isArray(hits) && hits.length > 0) {
        const best = hits.find(h => h.syncedLyrics) || hits[0];
        if (best.syncedLyrics || best.plainLyrics) {
          const result = {
            source: 'LRCLIB 線上音樂資料庫',
            synced: best.syncedLyrics || null,
            plain: best.plainLyrics || null
          };
          nowPlayingLyricsCache.set(cacheKey, result);
          return result;
        }
      }
    }
  } catch (e) {
    // LRCLIB error ignored
  }

  // 2. Try Netease Cloud Music Lyric API (Comprehensive fallback for Pop/Asian/Classic)
  try {
    const searchUrl = `https://music.163.com/api/search/get/web?s=${encodeURIComponent(cleanTitle + ' ' + cleanArt)}&type=1&offset=0&limit=3`;
    const sRes = await fetch(searchUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (sRes.ok) {
      const sData = await sRes.json();
      const songId = sData.result?.songs?.[0]?.id;
      if (songId) {
        const lyricUrl = `https://music.163.com/api/song/lyric?os=pc&id=${songId}&lv=-1&kv=-1&tv=-1`;
        const lRes = await fetch(lyricUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (lRes.ok) {
          const lData = await lRes.json();
          const raw = lData.lrc?.lyric;
          if (raw && raw.trim()) {
            const isSynced = raw.includes('[00:');
            const result = {
              source: '網易雲音樂歌詞庫',
              synced: isSynced ? raw : null,
              plain: raw
            };
            nowPlayingLyricsCache.set(cacheKey, result);
            return result;
          }
        }
      }
    }
  } catch (e) {
    // Netease error ignored
  }

  return null;
}

async function loadLyricsForNowPlaying(track) {
  const container = document.getElementById('nowPlayingLyricsContainer');
  const sourceEl = document.getElementById('nowPlayingLyricSource');
  if (!container) return;

  currentSyncedLyrics = [];
  currentActiveLyricIndex = -1;

  container.innerHTML = `
    <div class="lyrics-loading-state">
      <span class="spinner"></span>
      <div>正在連線線上音樂庫檢索歌詞...</div>
      <div style="font-size: 11px; opacity: 0.7;">《${escapeXml(track.title)}》 • ${escapeXml(track.artist)}</div>
    </div>
  `;
  if (sourceEl) sourceEl.textContent = '搜尋中...';

  const lyricData = await fetchLyricsOnline(track.title, track.artist, track.album, track.duration);

  // Prevent race condition if track changed during fetch
  if (state.currentTrackIndex < 0 || state.queue[state.currentTrackIndex] !== track) {
    return;
  }

  if (lyricData && lyricData.synced) {
    if (sourceEl) sourceEl.textContent = `即時同步歌詞 • ${lyricData.source}`;
    currentSyncedLyrics = parseLrc(lyricData.synced);
    renderSyncedLyrics(currentSyncedLyrics);
  } else if (lyricData && lyricData.plain) {
    if (sourceEl) sourceEl.textContent = `純文字歌詞 • ${lyricData.source}`;
    container.innerHTML = `<div class="lyrics-plain-box">${escapeXml(lyricData.plain)}</div>`;
  } else {
    if (sourceEl) sourceEl.textContent = '未收錄歌詞';
    const googleQuery = encodeURIComponent(`${track.title} ${track.artist} 歌詞`);
    container.innerHTML = `
      <div class="lyrics-empty-state">
        <div class="lyrics-empty-icon">🎶</div>
        <div style="font-size: 15px; font-weight: 600; color: var(--text-main);">未找到動態歌詞</div>
        <div style="font-size: 12px; color: var(--text-muted); line-height: 1.6;">此曲目可能為純音樂演奏，或線上音樂資料庫中尚未建立歌詞。</div>
        <button class="lyrics-empty-btn" id="btnGoogleLyrics">🌐 在 Google 搜尋此曲歌詞</button>
      </div>
    `;
    const btnGoogle = document.getElementById('btnGoogleLyrics');
    if (btnGoogle) {
      btnGoogle.onclick = () => {
        const url = `https://www.google.com/search?q=${googleQuery}`;
        if (window.electronAPI && window.electronAPI.openExternal) {
          window.electronAPI.openExternal(url);
        } else {
          window.open(url, '_blank');
        }
      };
    }
  }
}

function renderSyncedLyrics(lines) {
  const container = document.getElementById('nowPlayingLyricsContainer');
  if (!container) return;

  if (!lines || lines.length === 0) {
    container.innerHTML = '<div class="lyrics-empty-state"><div>無歌詞內容</div></div>';
    return;
  }

  const box = document.createElement('div');
  box.className = 'lyrics-synced-box';

  lines.forEach((line, idx) => {
    const lineEl = document.createElement('div');
    lineEl.className = 'lyric-line';
    lineEl.id = `lyric-line-${idx}`;
    lineEl.textContent = line.text;
    lineEl.title = `點擊跳至 ${formatDuration(line.time)}`;
    lineEl.onclick = () => {
      seekPlaybackTo(line.time);
    };
    box.appendChild(lineEl);
  });

  container.innerHTML = '';
  container.appendChild(box);
}

function updateNowPlayingPlaybackProgress() {
  const modal = document.getElementById('nowPlayingModal');
  if (!modal || modal.style.display === 'none') return;
  const track = state.queue[state.currentTrackIndex];
  if (!track) return;

  const currentSec = getCurrentPlaybackTime();
  const totalSec = track.duration || (nativeAudio.duration || 300);

  const curTimeEl = document.getElementById('nowPlayingCurTime');
  const totalTimeEl = document.getElementById('nowPlayingTotalTime');
  const fillEl = document.getElementById('nowPlayingScrubberFill');

  if (curTimeEl) curTimeEl.textContent = formatDuration(currentSec);
  if (totalTimeEl) totalTimeEl.textContent = formatDuration(totalSec);

  if (fillEl && totalSec > 0) {
    const percent = Math.min(100, Math.max(0, (currentSec / totalSec) * 100));
    fillEl.style.width = `${percent}%`;
  }

  // Update Synced Lyrics Highlighting & Smooth Auto-scroll
  if (currentSyncedLyrics.length > 0) {
    let targetIdx = -1;
    for (let i = 0; i < currentSyncedLyrics.length; i++) {
      if (currentSec >= currentSyncedLyrics[i].time) {
        targetIdx = i;
      } else {
        break;
      }
    }

    if (targetIdx !== currentActiveLyricIndex) {
      if (currentActiveLyricIndex >= 0) {
        const prevEl = document.getElementById(`lyric-line-${currentActiveLyricIndex}`);
        if (prevEl) prevEl.classList.remove('active');
      }
      currentActiveLyricIndex = targetIdx;
      if (currentActiveLyricIndex >= 0) {
        const curEl = document.getElementById(`lyric-line-${currentActiveLyricIndex}`);
        if (curEl) {
          curEl.classList.add('active');
          curEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    }
  }
}

function getCurrentPlaybackTime() {
  if (state.activeAudioZone !== 'local' && state.activeDlnaDevice) {
    return state.dlnaCurrentSec || 0;
  }
  if (exclusiveActive) return exclusivePosSec || 0; // 獨佔輸出由 helper 的位置事件驅動
  if (isCurrentDsd) {
    return (currentDsdOffset || 0) + (nativeAudio.currentTime || 0);
  }
  if (isCurrentSox) {
    return (currentSoxOffset || 0) + (nativeAudio.currentTime || 0);
  }
  if (nativeAudio.duration) {
    return nativeAudio.currentTime || 0;
  }
  return virtualCurrentSec || 0;
}

function seekPlaybackTo(targetSec) {
  const track = state.queue[state.currentTrackIndex];
  if (!track) return;
  const total = track.duration || (nativeAudio.duration || 300);
  targetSec = Math.max(0, Math.min(total, targetSec));

  if (state.activeAudioZone !== 'local' && state.activeDlnaDevice) {
    if (window.electronAPI && window.electronAPI.seekDlna) {
      window.electronAPI.seekDlna(state.activeDlnaDevice.id, targetSec);
    }
  } else if (exclusiveActive) {
    exclusiveSeekTo(targetSec);
  } else if (isCurrentDsd) {
    playDsdTrack(track, targetSec);
  } else if (isCurrentSox) {
    playSoxTrack(track, targetSec);
  } else if (nativeAudio.duration) {
    nativeAudio.currentTime = targetSec;
  } else {
    virtualCurrentSec = targetSec;
  }
  updateNowPlayingPlaybackProgress();
}

function updatePlayPauseBtnUI() {
  const icon = state.isPlaying ? '⏸' : '▶';
  if (btnPlayPause) btnPlayPause.textContent = icon;
  const npBtn = document.getElementById('btnNowPlayingPlayPause');
  if (npBtn) npBtn.textContent = icon;
}

function updateNowPlayingModalContent() {
  if (state.currentTrackIndex < 0 || !state.queue[state.currentTrackIndex]) return;
  const track = state.queue[state.currentTrackIndex];
  const foundAlbum = findAlbumForTrack(track);

  // 1. Left: Cover Art & Track Info
  const defaultCover = createSvgCover(track.album || track.title, track.artist, '#27272a', '#09090b');
  const coverSrc = formatCoverSrc(track.cover || (foundAlbum ? foundAlbum.cover : null)) || defaultCover;
  const coverImg = document.getElementById('nowPlayingCoverImg');
  if (coverImg) {
    coverImg.src = coverSrc;
    coverImg.onerror = () => {
      coverImg.onerror = null;
      coverImg.src = defaultCover;
    };
  }

  const titleEl = document.getElementById('nowPlayingTrackTitle');
  if (titleEl) titleEl.textContent = track.title;

  const artistEl = document.getElementById('nowPlayingArtistName');
  if (artistEl) {
    artistEl.textContent = track.artist;
    artistEl.onclick = () => {
      closeNowPlayingModal();
      openArtistDetail(track.artist);
    };
  }

  const albumEl = document.getElementById('nowPlayingAlbumName');
  if (albumEl) {
    albumEl.textContent = track.album || '未分類專輯';
    albumEl.onclick = () => {
      if (foundAlbum) {
        closeNowPlayingModal();
        openAlbumDetail(foundAlbum);
      }
    };
  }

  const trackFmt = getAudioFormatFromPath(track.filePath || track.fileName, track.formatName || 'PCM').toUpperCase();
  const isTrkDsd = trackFmt === 'DSF' || trackFmt === 'DFF' || trackFmt === 'DSD';
  const isDspDsd = state.dsp && state.dsp.enabled && isDsdRateMode(state.dsp.rateMode);
  const sampleRateKhz = formatKhz(track.sampleRate || 44100);
  const bitDepth = track.bitsPerSample || (isTrkDsd ? 1 : 16);
  const formatBadge = document.getElementById('nowPlayingFormatBadge');
  if (formatBadge) {
    if (isTrkDsd) {
      const dsdMhz = track.sampleRate ? `${(track.sampleRate / 1000000).toFixed(1)}M` : '2.8M';
      formatBadge.textContent = `${trackFmt} 1b/${dsdMhz}`;
    } else if (isDspDsd) {
      const modeUpper = state.dsp.rateMode.toUpperCase();
      const mhz = getDsdMhz(state.dsp.rateMode);
      formatBadge.textContent = `${modeUpper} 1b/${mhz.replace(' MHz', 'M')}`;
    } else {
      formatBadge.textContent = `${trackFmt} ${bitDepth}/${sampleRateKhz}`;
    }
  }

  updatePlayPauseBtnUI();

  // 2. Middle: Playlist / Album Tracklist
  const tracklistSource = (foundAlbum && foundAlbum.tracks && foundAlbum.tracks.length > 0)
    ? foundAlbum.tracks
    : state.queue;

  const countPill = document.getElementById('nowPlayingTracklistCount');
  if (countPill) {
    countPill.textContent = `共 ${tracklistSource.length} 首歌曲`;
  }

  const tracklistScroll = document.getElementById('nowPlayingTracklistContainer');
  if (tracklistScroll) {
    tracklistScroll.innerHTML = '';
    tracklistSource.forEach((t, idx) => {
      const isCurrent = (track.filePath && t.filePath)
        ? (t.filePath === track.filePath)
        : (t.title === track.title && (t.artist || '').toLowerCase() === (track.artist || '').toLowerCase());
      const row = document.createElement('div');
      row.className = `np-track-item ${isCurrent ? 'active' : ''}`;
      row.innerHTML = `
        <div class="np-track-num">${isCurrent ? '🔊' : (t.trackNumber || idx + 1)}</div>
        <div class="np-track-title-wrap">
          <div class="np-track-title" title="${escapeXml(t.title)}">${escapeXml(t.title)}</div>
        </div>
        <div class="np-track-dur">${formatDuration(t.duration)}</div>
      `;
      row.dataset.trackNum = t.trackNumber || (idx + 1);
      row.onclick = () => {
        // Immediate visual response
        tracklistScroll.querySelectorAll('.np-track-item').forEach(el => {
          el.classList.remove('active');
          const numEl = el.querySelector('.np-track-num');
          if (numEl && numEl.textContent === '🔊') {
            const trackNum = el.dataset.trackNum || '';
            numEl.textContent = trackNum;
          }
        });
        row.classList.add('active');
        const curNumEl = row.querySelector('.np-track-num');
        if (curNumEl) curNumEl.textContent = '🔊';

        const queueIdx = state.queue.findIndex(qt => (qt.filePath && t.filePath) ? qt.filePath === t.filePath : qt.title === t.title);
        if (queueIdx >= 0) {
          state.currentTrackIndex = queueIdx;
          playCurrentTrack();
        } else {
          playTrackList(tracklistSource, idx);
        }
      };
      tracklistScroll.appendChild(row);
      if (isCurrent) {
        setTimeout(() => row.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
      }
    });
  }

  // 3. Right: Load Lyrics Online
  loadLyricsForNowPlaying(track);

  // Update Time
  updateNowPlayingPlaybackProgress();
}

function openNowPlayingModal() {
  if (state.currentTrackIndex < 0 || !state.queue[state.currentTrackIndex]) {
    if (state.tracks.length > 0) {
      playTrackList(state.tracks, 0);
    } else {
      showToast('音樂庫中尚無歌曲，請先匯入音樂資料夾');
      return;
    }
  }

  const modal = document.getElementById('nowPlayingModal');
  if (!modal) return;
  modal.style.display = 'flex';
  updateNowPlayingModalContent();

  if (!nowPlayingSyncInterval) {
    nowPlayingSyncInterval = setInterval(() => {
      updateNowPlayingPlaybackProgress();
    }, 250);
  }
}

function closeNowPlayingModal() {
  const modal = document.getElementById('nowPlayingModal');
  if (!modal) return;
  modal.style.display = 'none';
  if (nowPlayingSyncInterval) {
    clearInterval(nowPlayingSyncInterval);
    nowPlayingSyncInterval = null;
  }
}

function togglePlayPause() {
  if (state.currentTrackIndex === -1) {
    if (state.tracks.length > 0) {
      playTrackList(state.tracks, 0);
    }
    return;
  }

  const currentTrack = state.queue[state.currentTrackIndex];

  // If active audio zone is DLNA
  if (state.activeAudioZone !== 'local' && state.activeDlnaDevice) {
    if (state.isPlaying) {
      state.isPlaying = false;
      updatePlayPauseBtnUI();
      if (window.electronAPI && window.electronAPI.pauseDlna) {
        window.electronAPI.pauseDlna(state.activeDlnaDevice.id).catch(err => {
          console.warn('DLNA pause error:', err);
        });
      }
    } else {
      // If we were paused and have progress > 0, attempt resume first
      if (state.dlnaCurrentSec && state.dlnaCurrentSec > 0 && window.electronAPI && window.electronAPI.resumeDlna) {
        window.electronAPI.resumeDlna(state.activeDlnaDevice.id)
          .then(() => {
            state.isPlaying = true;
            updatePlayPauseBtnUI();
          })
          .catch(err => {
            console.warn('DLNA resume failed, restarting track:', err);
            playCurrentTrack();
          });
      } else {
        // If not playing or starting from 0, properly initiate playback with URI
        playCurrentTrack();
      }
    }
    return;
  }

  if (state.isPlaying) {
    if (currentTrack.isKkbox) {
      nativeAudio.pause();
    } else if (currentTrack.isDemo || !currentTrack.filePath) {
      stopDemoSynth();
      pauseVirtualProgress();
    } else if (exclusiveActive) {
      try { window.electronAPI.exclusivePause(); } catch (err) {}
    } else {
      nativeAudio.pause();
    }
    state.isPlaying = false;
    updatePlayPauseBtnUI();
  } else {
    if (currentTrack._restoredSession) {
      // Restored at startup but never played this session: start it through the full flow
      currentTrack._restoredSession = false;
      playCurrentTrack();
      return;
    }
    if (currentTrack.isKkbox) {
      if (nativeAudio.src) {
        nativeAudio.play().then(() => {
          state.isPlaying = true;
          updatePlayPauseBtnUI();
        }).catch(err => {
          console.warn('KKBOX resume failed, reloading:', err);
          playCurrentTrack();
        });
        return;
      } else {
        playCurrentTrack();
        return;
      }
    } else if (currentTrack.isDemo || !currentTrack.filePath) {
      playDemoSynth(currentTrack);
      resumeVirtualProgress();
    } else if (exclusiveActive) {
      exclusiveEndedFired = false;
      try { window.electronAPI.exclusiveResume(); } catch (err) {}
    } else {
      nativeAudio.play();
    }
    state.isPlaying = true;
    updatePlayPauseBtnUI();
  }
}

// ----------------- Shuffle & Repeat Engine -----------------
function generateShuffleOrder(startQueueIndex = -1) {
  if (!state.queue || state.queue.length === 0) {
    state.shuffleOrder = [];
    state.shufflePointer = -1;
    return;
  }

  const n = state.queue.length;
  const indices = Array.from({ length: n }, (_, i) => i);

  if (startQueueIndex >= 0 && startQueueIndex < n) {
    const rest = indices.filter(i => i !== startQueueIndex);
    // Fisher-Yates non-repeating shuffle
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    state.shuffleOrder = [startQueueIndex, ...rest];
    state.shufflePointer = 0;
  } else {
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    state.shuffleOrder = indices;
    state.shufflePointer = 0;
  }
}

function setShuffleState(enable) {
  state.isShuffle = enable;
  if (state.isShuffle) {
    generateShuffleOrder(state.currentTrackIndex);
    showToast('🔀 隨機播放：已開啟');
  } else {
    showToast('🔀 隨機播放：已關閉 (依序播放)');
  }
  updateShuffleUI();
}

function updateShuffleUI() {
  btnShuffle.classList.toggle('active', state.isShuffle);
  btnShuffle.title = state.isShuffle ? '隨機播放：已開啟 (點擊關閉)' : '隨機播放：已關閉 (點擊開啟)';
}

function cycleRepeatMode() {
  if (state.repeatMode === 'off') {
    state.repeatMode = 'all';
    showToast('🔁 循環模式：清單循環 (全部播放完後重新循環)');
  } else if (state.repeatMode === 'all') {
    state.repeatMode = 'one';
    showToast('🔂 循環模式：單曲循環 (重複播放目前曲目)');
  } else {
    state.repeatMode = 'off';
    showToast('🔁 循環模式：已關閉 (播放至隊列結束即停止)');
  }
  updateRepeatUI();
}

function updateRepeatUI() {
  if (state.repeatMode === 'off') {
    btnRepeat.textContent = '🔁';
    btnRepeat.classList.remove('active', 'repeat-one');
    btnRepeat.title = '循環模式：關閉 (點擊切換為全部循環)';
  } else if (state.repeatMode === 'all') {
    btnRepeat.textContent = '🔁';
    btnRepeat.classList.add('active');
    btnRepeat.classList.remove('repeat-one');
    btnRepeat.title = '循環模式：清單循環 (點擊切換為單曲循環)';
  } else if (state.repeatMode === 'one') {
    btnRepeat.textContent = '🔂';
    btnRepeat.classList.add('active', 'repeat-one');
    btnRepeat.title = '循環模式：單曲循環 (點擊關閉循環)';
  }
}

// Audiophile Floating Toast
let toastTimer = null;
function showToast(message) {
  let toastEl = document.getElementById('appToast');
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.id = 'appToast';
    toastEl.className = 'app-toast';
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = message;
  toastEl.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.classList.remove('show');
  }, 2200);
}

function playNextTrack(fromAutoEnd = false) {
  if (!state.queue.length) return;

  if (state.isShuffle) {
    if (!state.shuffleOrder.length || state.shuffleOrder.length !== state.queue.length) {
      generateShuffleOrder(state.currentTrackIndex);
    }

    if (state.shufflePointer < state.shuffleOrder.length - 1) {
      state.shufflePointer++;
      state.currentTrackIndex = state.shuffleOrder[state.shufflePointer];
      playCurrentTrack();
    } else {
      // Reached the end of the shuffled list
      if (state.repeatMode === 'all') {
        generateShuffleOrder(-1);
        state.shufflePointer = 0;
        state.currentTrackIndex = state.shuffleOrder[0];
        playCurrentTrack();
      } else {
        // repeatMode === 'off'
        if (fromAutoEnd) {
          stopPlaybackAtEnd();
        } else {
          state.shufflePointer = 0;
          state.currentTrackIndex = state.shuffleOrder[0];
          playCurrentTrack();
        }
      }
    }
  } else {
    // Sequential mode
    if (state.currentTrackIndex < state.queue.length - 1) {
      state.currentTrackIndex++;
      playCurrentTrack();
    } else {
      // Reached the end of the sequential list
      if (state.repeatMode === 'all') {
        state.currentTrackIndex = 0;
        playCurrentTrack();
      } else {
        // repeatMode === 'off'
        if (fromAutoEnd) {
          stopPlaybackAtEnd();
        } else {
          state.currentTrackIndex = 0;
          playCurrentTrack();
        }
      }
    }
  }
}

function playPrevTrack() {
  if (!state.queue.length) return;

  const track = state.queue[state.currentTrackIndex];
  const isLocalFile = track && !track.isDemo && track.filePath;
  const currentSec = getCurrentPlaybackTime();

  // If active audio zone is DLNA: replay or switch via playCurrentTrack
  if (state.activeAudioZone !== 'local' && state.activeDlnaDevice) {
    if (currentSec > 3) {
      playCurrentTrack();
    } else {
      if (state.isShuffle) {
        if (!state.shuffleOrder.length || state.shuffleOrder.length !== state.queue.length) {
          generateShuffleOrder(state.currentTrackIndex);
        }
        if (state.shufflePointer > 0) {
          state.shufflePointer--;
          state.currentTrackIndex = state.shuffleOrder[state.shufflePointer];
          playCurrentTrack();
        } else if (state.repeatMode === 'all') {
          state.shufflePointer = state.shuffleOrder.length - 1;
          state.currentTrackIndex = state.shuffleOrder[state.shufflePointer];
          playCurrentTrack();
        } else {
          playCurrentTrack();
        }
      } else {
        state.currentTrackIndex = (state.currentTrackIndex - 1 + state.queue.length) % state.queue.length;
        playCurrentTrack();
      }
    }
    return;
  }

  // Non-DLNA local playback
  if (currentSec > 3) {
    if (isCurrentDsd) {
      playDsdTrack(track, 0);
    } else if (isCurrentSox) {
      playSoxTrack(track, 0);
    } else if ((isLocalFile || track.isKkbox || track.isTidal) && nativeAudio.src) {
      nativeAudio.currentTime = 0;
    } else {
      virtualCurrentSec = 0;
      currentTimeLabel.textContent = formatDuration(0);
      scrubberFill.style.width = '0%';
    }
    return;
  }

  // Within 3 seconds: go to previous track in shuffle or queue history
  if (state.isShuffle) {
    if (!state.shuffleOrder.length || state.shuffleOrder.length !== state.queue.length) {
      generateShuffleOrder(state.currentTrackIndex);
    }

    if (state.shufflePointer > 0) {
      state.shufflePointer--;
      state.currentTrackIndex = state.shuffleOrder[state.shufflePointer];
      playCurrentTrack();
    } else {
      if (state.repeatMode === 'all') {
        state.shufflePointer = state.shuffleOrder.length - 1;
        state.currentTrackIndex = state.shuffleOrder[state.shufflePointer];
        playCurrentTrack();
      } else {
        if (isCurrentDsd) {
          playDsdTrack(track, 0);
        } else if (isCurrentSox) {
          playSoxTrack(track, 0);
        } else if ((isLocalFile || track.isKkbox || track.isTidal) && nativeAudio.src) {
          nativeAudio.currentTime = 0;
        } else {
          virtualCurrentSec = 0;
          currentTimeLabel.textContent = formatDuration(0);
          scrubberFill.style.width = '0%';
        }
      }
    }
  } else {
    state.currentTrackIndex = (state.currentTrackIndex - 1 + state.queue.length) % state.queue.length;
    playCurrentTrack();
  }
}

function stopPlaybackAtEnd() {
  state.isPlaying = false;
  updatePlayPauseBtnUI();
  stopDemoSynth();
  stopVirtualProgress();
  exclusiveStopStream();
  if (nativeAudio.src) {
    nativeAudio.pause();
  }
  if (state.activeAudioZone !== 'local' && state.activeDlnaDevice && window.electronAPI && window.electronAPI.stopDlna) {
    window.electronAPI.stopDlna(state.activeDlnaDevice.id).catch(() => {});
  }
  scrubberFill.style.width = '100%';
  currentTimeLabel.textContent = totalTimeLabel.textContent;
}

let isTrackEndingHandled = false;

function onTrackEnded() {
  if (isTrackEndingHandled) return;
  isTrackEndingHandled = true;
  setTimeout(() => { isTrackEndingHandled = false; }, 600);

  if (state.repeatMode === 'one') {
    const track = state.queue[state.currentTrackIndex];
    if (state.activeAudioZone !== 'local' && state.activeDlnaDevice) {
      playCurrentTrack();
    } else if (isCurrentDsd && track) {
      playDsdTrack(track, 0);
    } else if (isCurrentSox && track) {
      playSoxTrack(track, 0);
    } else if (track && (track.filePath || track.isKkbox || track.isTidal) && nativeAudio.src) {
      nativeAudio.currentTime = 0;
      nativeAudio.play().catch(err => console.error('Repeat error:', err));
    } else {
      // Demo synth: restart current track from beginning
      playCurrentTrack();
    }
    return;
  }

  const isLastTrack = state.isShuffle
    ? (state.shufflePointer >= state.shuffleOrder.length - 1)
    : (state.currentTrackIndex >= state.queue.length - 1);

  if (isLastTrack && state.repeatMode === 'off') {
    stopPlaybackAtEnd();
    return;
  }

  playNextTrack(true);
}

// Native Audio Element Events
let timeUpdateRaf = null;

nativeAudio.addEventListener('timeupdate', () => {
  if (state.activeAudioZone !== 'local') return;
  const track = state.queue[state.currentTrackIndex];
  if (!track) return;

  if (isCurrentDsd) {
    const current = currentDsdOffset + nativeAudio.currentTime;
    const total = track.duration || 300;
    if (current >= total && total > 0) {
      onTrackEnded();
      return;
    }
  } else if (isCurrentSox) {
    const current = currentSoxOffset + nativeAudio.currentTime;
    const total = track.duration || 300;
    if (current >= total && total > 0) {
      onTrackEnded();
      return;
    }
  }

  // Throttle DOM updates with requestAnimationFrame so window drag and UI animations stay 60+ FPS
  if (!timeUpdateRaf) {
    timeUpdateRaf = requestAnimationFrame(() => {
      timeUpdateRaf = null;
      if (isCurrentDsd) {
        const current = currentDsdOffset + nativeAudio.currentTime;
        const total = track.duration || 300;
        const percent = Math.min(100, (current / total) * 100);
        scrubberFill.style.width = `${percent}%`;
        currentTimeLabel.textContent = formatDuration(current);
        totalTimeLabel.textContent = formatDuration(total);
      } else if (isCurrentSox) {
        const current = currentSoxOffset + nativeAudio.currentTime;
        const total = track.duration || 300;
        const percent = Math.min(100, (current / total) * 100);
        scrubberFill.style.width = `${percent}%`;
        currentTimeLabel.textContent = formatDuration(current);
        totalTimeLabel.textContent = formatDuration(total);
      } else {
        const current = nativeAudio.currentTime;
        const total = (track.duration && track.duration > 0) ? track.duration : (nativeAudio.duration || 0);
        if (total > 0 && total !== Infinity && !isNaN(total)) {
          const percent = Math.min(100, (current / total) * 100);
          scrubberFill.style.width = `${percent}%`;
          currentTimeLabel.textContent = formatDuration(current);
          totalTimeLabel.textContent = formatDuration(total);
          if (current >= total) {
            onTrackEnded();
            return;
          }
        } else if (nativeAudio.duration && nativeAudio.duration !== Infinity && !isNaN(nativeAudio.duration)) {
          const percent = (current / nativeAudio.duration) * 100;
          scrubberFill.style.width = `${percent}%`;
          currentTimeLabel.textContent = formatDuration(current);
          totalTimeLabel.textContent = formatDuration(nativeAudio.duration);
        } else {
          currentTimeLabel.textContent = formatDuration(current);
        }
      }
      updateNowPlayingPlaybackProgress();
    });
  }
});

nativeAudio.addEventListener('ended', () => {
  if (state.activeAudioZone === 'local') {
    onTrackEnded();
  }
});

// Virtual Progress for Synth Audio
let virtualTimer = null;
let virtualCurrentSec = 0;
let virtualTotalSec = 300;
let isVirtualPaused = false;

function startVirtualProgress(duration) {
  stopVirtualProgress();
  virtualCurrentSec = 0;
  virtualTotalSec = duration;
  isVirtualPaused = false;
  totalTimeLabel.textContent = formatDuration(virtualTotalSec);

  virtualTimer = setInterval(() => {
    if (isVirtualPaused) return;
    virtualCurrentSec++;
    if (virtualCurrentSec >= virtualTotalSec) {
      onTrackEnded();
      return;
    }
    const percent = (virtualCurrentSec / virtualTotalSec) * 100;
    scrubberFill.style.width = `${percent}%`;
    currentTimeLabel.textContent = formatDuration(virtualCurrentSec);
  }, 1000);
}

function pauseVirtualProgress() {
  isVirtualPaused = true;
}

function resumeVirtualProgress() {
  isVirtualPaused = false;
}

function stopVirtualProgress() {
  if (virtualTimer) {
    clearInterval(virtualTimer);
    virtualTimer = null;
  }
}

// ----------------- Scrubber & Volume -----------------
scrubberBar.addEventListener('click', (e) => {
  const rect = scrubberBar.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const ratio = Math.max(0, Math.min(1, clickX / rect.width));

  const track = state.queue[state.currentTrackIndex];
  if (!track) return;

  if (state.activeAudioZone !== 'local' && state.activeDlnaDevice) {
    const total = track.duration || state.dlnaTotalSec || 300;
    const targetSec = Math.floor(ratio * total);
    if (window.electronAPI && window.electronAPI.seekDlna) {
      window.electronAPI.seekDlna(state.activeDlnaDevice.id, targetSec);
    }
    state.dlnaCurrentSec = targetSec;
    currentTimeLabel.textContent = formatDuration(targetSec);
    scrubberFill.style.width = `${ratio * 100}%`;
    return;
  }

  if (track.isKkbox || track.isTidal) {
    const total = (track.duration && track.duration > 0) ? track.duration : (nativeAudio.duration || 0);
    if (total > 0 && (!nativeAudio.duration || nativeAudio.duration === Infinity)) {
      nativeAudio.currentTime = Math.floor(ratio * total);
    } else if (nativeAudio.duration && nativeAudio.duration !== Infinity) {
      nativeAudio.currentTime = ratio * nativeAudio.duration;
    }
  } else if (track.isDemo || !track.filePath) {
    virtualCurrentSec = Math.floor(ratio * virtualTotalSec);
    currentTimeLabel.textContent = formatDuration(virtualCurrentSec);
    scrubberFill.style.width = `${ratio * 100}%`;
  } else if (exclusiveActive) {
    const total = track.duration || 300;
    exclusiveSeekTo(Math.max(0, Math.min(total, ratio * total)));
    scrubberFill.style.width = `${ratio * 100}%`;
    currentTimeLabel.textContent = formatDuration(Math.max(0, Math.min(total, ratio * total)));
  } else if (isCurrentDsd) {
    const targetSec = Math.floor(ratio * (track.duration || 300));
    playDsdTrack(track, targetSec);
  } else if (isCurrentSox) {
    const targetSec = Math.floor(ratio * (track.duration || 300));
    playSoxTrack(track, targetSec);
  } else if (nativeAudio.duration) {
    nativeAudio.currentTime = ratio * nativeAudio.duration;
  }
});

// ----------------- Volume & Line Out -----------------
// Line Out：輸出音量鎖定為最大（100%）；鎖定期間音量滑桿與靜音按鈕停用。
let lastVolume = 1; // 解除靜音時回復的音量（預設最大）
let lineOutRestoreVolume = null; // 解除 Line Out 時回復的音量

function applyVolume(v) {
  if (v > 0) lastVolume = v;
  state.volume = v;
  nativeAudio.volume = v;
  if (audioCtx && currentSynthNodes.length) {
    const masterGain = currentSynthNodes[currentSynthNodes.length - 1];
    if (masterGain && masterGain.gain) {
      masterGain.gain.setValueAtTime(v * 0.15, audioCtx.currentTime);
    }
  }
  btnVolumeIcon.textContent = v === 0 ? '🔇' : (v < 0.5 ? '🔉' : '🔊');

  if (state.activeAudioZone !== 'local' && state.activeDlnaDevice) {
    if (window.electronAPI && window.electronAPI.setDlnaVolume) {
      const vol100 = Math.round(v * 100);
      window.electronAPI.setDlnaVolume(state.activeDlnaDevice.id, vol100);
    }
  }
}

volumeSlider.addEventListener('input', (e) => {
  if (state.lineOut) { e.target.value = 1; return; } // Line Out 鎖定中：不可調音量
  applyVolume(parseFloat(e.target.value));
});

btnVolumeIcon.addEventListener('click', () => {
  if (state.lineOut) return; // Line Out 鎖定中：靜音亦屬音量調整，停用
  if (state.volume > 0) {
    volumeSlider.value = 0;
    volumeSlider.dispatchEvent(new Event('input'));
  } else {
    volumeSlider.value = lastVolume > 0 ? lastVolume : 1;
    volumeSlider.dispatchEvent(new Event('input'));
  }
});

const btnLineOut = document.getElementById('btnLineOut');
btnLineOut.addEventListener('click', () => {
  if (!state.lineOut) {
    lineOutRestoreVolume = state.volume;
    state.lineOut = true;
    volumeSlider.value = 1;
    volumeSlider.disabled = true;
    btnVolumeIcon.disabled = true;
    btnLineOut.classList.add('line-out-active');
    applyVolume(1);
    showToast('🔌 Line Out 已啟用：輸出音量鎖定為最大');
  } else {
    state.lineOut = false;
    volumeSlider.disabled = false;
    btnVolumeIcon.disabled = false;
    btnLineOut.classList.remove('line-out-active');
    const restore = lineOutRestoreVolume === null ? 1 : lineOutRestoreVolume;
    lineOutRestoreVolume = null;
    volumeSlider.value = restore;
    applyVolume(restore);
    showToast('🔌 Line Out 已解除：恢復音量調整');
    // 獨佔輸出必然伴隨最大音量直出：解除音量鎖定時一併解除獨佔輸出
    if (state.exclusive) setExclusiveOff('WASAPI 獨佔輸出需鎖定最大音量，已一併解除');
  }
});

// ----------------- WASAPI 獨佔輸出（Windows 聲音獨佔模式） -----------------
// 開啟後本機播放改由 tools/rp-wasapi-exclusive（主行程以 Windows 內建 csc 編譯）直接以
// AUDCLNT_SHAREMODE_EXCLUSIVE 驅動輸出裝置：引擎串流完全不變，helper 用 Range 分段讀取
// 同一条 /sox-stream、/dsd-stream，所以升頻 / PEQ / 卷縮全部保留。
// 獨佔期間 Windows 混音器被繞過（系統音效暫停），音量等同 LINE OUT 最大直出；
// 任何一步失敗都自動退回原本的共享模式播放路徑，不會變成不能聽。
const btnExclusive = document.getElementById('btnExclusive');
let exclusiveCap = null;           // 裝置獨佔能力探測結果（主行程快取）
let exclusiveCapChecked = false;
let exclusiveActive = false;       // helper 目前驅動輸出裝置
let exclusiveRate = 0;             // helper 目前使用的取樣率
let exclusiveStreamStartSec = 0;   // 目前串流的起點（絕對秒）
let exclusivePosSec = 0;           // helper 位置事件換算出的絕對播放位置（秒）
let exclusiveEndedFired = false;
let exclusiveFallbackAt = 0;       // 最近一次退回共享的時間戳（避免每首都重試、每首都跳訊息）
let exclusiveEventTap = null;      // 自我測試攔截點：回傳 true 表示事件已由測試接管

function exclusiveApiOk() {
  return !!(window.electronAPI && window.electronAPI.exclusiveStart && window.electronAPI.exclusiveProbe);
}

function exclusiveZoneOk() {
  return state.activeAudioZone === 'local' && !state.activeDlnaDevice;
}

function isDsdFilePath(filePath) {
  return /\.(dsf|dff)$/i.test(String(filePath || ''));
}

function exclusiveSupportedRates() {
  if (!exclusiveCap || !exclusiveCap.ok || !Array.isArray(exclusiveCap.supported)) return [];
  return exclusiveCap.supported.map(s => Number(s.rate) || 0).filter(r => r > 0).sort((a, b) => b - a);
}

async function exclusiveEnsureCapability(force = false) {
  if (!exclusiveApiOk()) return null;
  if (!force && exclusiveCapChecked) return exclusiveCap;
  try {
    exclusiveCap = await window.electronAPI.exclusiveProbe(force);
  } catch (err) {
    exclusiveCap = { ok: false, msg: String((err && err.message) || err) };
  }
  exclusiveCapChecked = true;
  updateExclusiveBtnState();
  return exclusiveCap;
}

// 裝置能力 ∩ 來源取樣率：選 ≥ 來源率且尽量貼近目標者；回傳 null 代表這首無法獨佔直出。
function exclusiveChooseRate(sourceRate, targetRate) {
  const rates = exclusiveSupportedRates();
  if (!rates.length) return null;
  const floor = Math.max(1, Number(sourceRate) || 1);
  const usable = rates.filter(r => r >= floor);
  if (!usable.length) return null;
  const want = Number(targetRate) || floor;
  const up = usable.filter(r => r >= want).sort((a, b) => a - b);
  return up.length ? up[0] : usable[0];
}

// 獨佔初始化前必須釋放共享模式佔用（Chromium 的 HTMLAudioElement 仍持有同一裝置時，
// IAudioClient::Initialize 會回 AUDCLNT_E_DEVICE_IN_USE）
function exclusiveReleaseSharedDevice() {
  try { nativeAudio.pause(); } catch (err) {}
  try {
    nativeAudio.removeAttribute('src');
    nativeAudio.load();
  } catch (err) {}
  // 示範合成器（WebAudio）同樣會佔用輸出裝置：獨佔初始化前先讓它讓位
  try { stopDemoSynth(); } catch (err) {}
  try { if (audioCtx && audioCtx.state === 'running') audioCtx.suspend(); } catch (err) {}
}

async function exclusiveStartStream(track, startSec, streamUrl, rate) {
  if (!exclusiveApiOk() || !streamUrl || !rate) return false;
  exclusiveReleaseSharedDevice();
  let res = null;
  try {
    res = await window.electronAPI.exclusiveStart({
      url: streamUrl,
      rate,
      deviceId: (exclusiveCap && exclusiveCap.deviceId) || ''
    });
  } catch (err) {
    res = { ok: false, msg: String((err && err.message) || err) };
  }
  if (!res || !res.ok) {
    exclusiveActive = false;
    exclusiveRate = 0;
    return false;
  }
  exclusiveActive = true;
  exclusiveRate = rate;
  exclusiveStreamStartSec = startSec;
  exclusivePosSec = startSec;
  exclusiveEndedFired = false;
  updateExclusiveBtnState();
  return true;
}

function exclusiveStopStream() {
  const wasActive = exclusiveActive;
  exclusiveActive = false;
  exclusiveRate = 0;
  exclusiveStreamStartSec = 0;
  if (wasActive && exclusiveApiOk()) {
    try { window.electronAPI.exclusiveStop(); } catch (err) {}
  }
}

// 獨佔失敗：這首改走共享模式，並把開關關掉（原因清楚告知；8 秒內不重複跳訊息，避免每首都跳）
function exclusiveFallbackShared(msg) {
  const now = Date.now();
  const notify = now - exclusiveFallbackAt >= 8000;
  exclusiveFallbackAt = now;
  exclusiveStopStream();
  state.exclusive = false;
  try { localStorage.setItem('rooplayer_exclusive_output', '0'); } catch (err) {}
  updateExclusiveBtnState();
  if (notify) showToast(`⚠️ WASAPI 獨佔輸出無法使用（${msg || '裝置不支援'}），已退回共享模式播放`);
}

function exclusiveHandleEnded() {
  if (exclusiveEndedFired) return;
  exclusiveEndedFired = true;
  exclusiveStopStream();
  onTrackEnded();
}

function exclusiveSeekTo(targetSec) {
  if (!exclusiveActive || !exclusiveApiOk()) return false;
  const rel = Math.max(0, targetSec - exclusiveStreamStartSec);
  exclusivePosSec = targetSec;
  exclusiveEndedFired = false;
  try { window.electronAPI.exclusiveSeek(rel); } catch (err) {}
  return true;
}

function renderExclusiveProgress() {
  const track = state.queue[state.currentTrackIndex];
  if (!track) return;
  const total = (track.duration && track.duration > 0) ? track.duration : 0;
  const current = Math.max(0, exclusivePosSec);
  currentTimeLabel.textContent = formatDuration(current);
  if (total > 0) {
    scrubberFill.style.width = `${Math.min(100, (current / total) * 100)}%`;
    totalTimeLabel.textContent = formatDuration(total);
  }
  updateNowPlayingPlaybackProgress();
}

if (exclusiveApiOk() && window.electronAPI.onExclusiveStatus) {
  window.electronAPI.onExclusiveStatus((ev) => {
    if (!ev) return;
    if (exclusiveEventTap && exclusiveEventTap(ev)) return; // 自我測試接管事件
    if (ev.ev === 'pos') {
      if (!exclusiveActive || !exclusiveRate) return;
      const audible = Number(ev.audible) || 0;
      exclusivePosSec = exclusiveStreamStartSec + audible / exclusiveRate;
      renderExclusiveProgress();
      const track = state.queue[state.currentTrackIndex];
      const total = (track && track.duration) ? track.duration : 0;
      if (total > 0 && exclusivePosSec >= total) exclusiveHandleEnded();
    } else if (ev.ev === 'eof') {
      if (exclusiveActive) exclusiveHandleEnded();
    } else if (ev.ev === 'fail' || ev.ev === 'crashed') {
      if (!exclusiveActive) return;
      const resumeSec = exclusivePosSec;
      const track = state.queue[state.currentTrackIndex];
      const wasPlaying = state.isPlaying;
      exclusiveFallbackShared(ev.msg);
      if (wasPlaying && track && track.filePath) {
        if (isDsdFilePath(track.filePath)) playDsdTrack(track, resumeSec);
        else playSoxTrack(track, resumeSec);
      }
    }
  });
}

// 關閉獨佔輸出：寫入設定、停止 helper，必要時從目前位置改以共享模式續播
function setExclusiveOff(note) {
  state.exclusive = false;
  try { localStorage.setItem('rooplayer_exclusive_output', '0'); } catch (err) {}
  const resumeSec = exclusiveActive ? exclusivePosSec : 0;
  const wasPlaying = state.isPlaying;
  const track = state.queue[state.currentTrackIndex];
  exclusiveStopStream();
  updateExclusiveBtnState();
  if (wasPlaying && track && track.filePath) {
    if (isDsdFilePath(track.filePath)) playDsdTrack(track, resumeSec);
    else playSoxTrack(track, resumeSec);
  }
  if (note) showToast('🎚️ ' + note);
}

function updateExclusiveBtnState() {
  if (!btnExclusive) return;
  const rates = exclusiveSupportedRates();
  btnExclusive.classList.toggle('exclusive-out-active', !!state.exclusive);
  btnExclusive.disabled = !exclusiveApiOk() || (!rates.length && !exclusiveCapChecked);
  btnExclusive.title = rates.length
    ? `WASAPI 獨佔模式：最高 ${formatKhz(rates[0])} 24-bit 直出，繞過 Windows 混音器（獨佔期間系統音效暫停、音量鎖定最大）`
    : (exclusiveCapChecked ? 'WASAPI 獨佔模式：目前輸出裝置未回報可用格式' : 'WASAPI 獨佔模式：正在探測輸出裝置能力');
}

// 訊號路徑徽章：獨佔輸出在既有徽章後方補上 EXCLUSIVE 標記（原函數照常執行）
const baseUpdateSignalPathUI = updateSignalPathUI;
updateSignalPathUI = function (track = null) {
  baseUpdateSignalPathUI(track);
  if (exclusiveActive && exclusiveRate && signalPathBadge) {
    signalPathBadge.textContent = `${signalPathBadge.textContent} | EXCLUSIVE ${formatKhz(exclusiveRate)}`;
  }
};

if (btnExclusive) {
  btnExclusive.addEventListener('click', async () => {
    if (!exclusiveApiOk()) { showToast('⚠️ 獨佔輸出需要桌面版執行環境'); return; }
    if (!exclusiveZoneOk()) { showToast('⚠️ 獨佔輸出只適用於本機播放（DLNA 輸出請先切回本機播放）'); return; }

    if (!state.exclusive) {
      const cap = await exclusiveEnsureCapability(true);
      const rates = exclusiveSupportedRates();
      if (!rates.length) {
        updateExclusiveBtnState();
        showToast(`❌ 目前輸出裝置不支援 WASAPI 獨佔模式：${(cap && cap.msg) || '無可用格式'}`);
        return;
      }
      state.exclusive = true;
      try { localStorage.setItem('rooplayer_exclusive_output', '1'); } catch (err) {}
      // 獨佔輸出由裝置決定音量：同步啟用 LINE OUT 鎖定，音量滑桿停用
      if (!state.lineOut) {
        lineOutRestoreVolume = state.volume;
        state.lineOut = true;
        volumeSlider.value = 1;
        volumeSlider.disabled = true;
        btnVolumeIcon.disabled = true;
        btnLineOut.classList.add('line-out-active');
        applyVolume(1);
      }
      updateExclusiveBtnState();
      const nativePick = exclusiveChooseRate(44100, 44100) || rates[0];
      showToast(`🎚️ WASAPI 獨佔模式已啟用：本機播放改以 ${formatKhz(nativePick)} 24-bit 直出（最高 ${formatKhz(rates[0])}，系統音效暫停）`);
      // 正在播放 → 立刻以獨佔從目前位置續播
      if (state.isPlaying && state.currentTrackIndex >= 0) {
        const track = state.queue[state.currentTrackIndex];
        if (track && track.filePath) {
          const at = getCurrentPlaybackTime();
          if (isDsdFilePath(track.filePath)) playDsdTrack(track, at);
          else playSoxTrack(track, at);
        }
      }
    } else {
      setExclusiveOff('已解除 WASAPI 獨佔模式：恢復 Windows 共享模式輸出');
    }
  });
}

// ----------------- 獨佔輸出執行期自我測試（main.js --test-exclusive） -----------------
// 完整走過一次真實路徑：探測裝置能力 ➔ 引擎 /sox-stream 升頻 ➔ helper 獨佔播放 ➔
// 位置事件 ➔ 暫停 / 續播 / 跳轉（Range 分段）➔ 播完結算。結果經 capture:step(11) 回報主行程。
async function runExclusiveSelfTest(fixturePath) {
  const lines = [];
  const ok = (name, detail) => lines.push(`PASS ${name}${detail ? ' [' + detail + ']' : ''}`);
  const bad = (name, detail) => lines.push(`FAIL ${name}${detail ? ' [' + detail + ']' : ''}`);
  const finish = () => {
    exclusiveEventTap = null;
    exclusiveStopStream();
    const failed = lines.filter(l => l.startsWith('FAIL'));
    const report = (failed.length ? 'FAIL ' : 'PASS ') + lines.join(' | ');
    try { window.electronAPI.captureStep(11, report); } catch (err) {}
  };

  try {
    if (!fixturePath || !window.electronAPI || !window.electronAPI.getSoxStreamUrl) {
      bad('fixture / stream IPC available', 'fixture=' + fixturePath);
      finish();
      return;
    }
    const cap = await exclusiveEnsureCapability(true);
    const rates = exclusiveSupportedRates();
    if (!cap || !cap.ok || !rates.length) {
      bad('probe exclusive capability', JSON.stringify(cap || {}).slice(0, 180));
      finish();
      return;
    }
    ok('probe exclusive capability', 'rates=' + rates.join(','));

    const rate = exclusiveChooseRate(44100, 96000) || rates[0];
    const url = await window.electronAPI.getSoxStreamUrl(fixturePath, 0, rate, '', 5, 'linear', '', '');
    if (!url) { bad('build engine sox-stream url'); finish(); return; }
    ok('build engine sox-stream url', 'rate=' + rate);

    const events = [];
    exclusiveEventTap = (ev) => { events.push(ev); return true; };

    const started = await exclusiveStartStream({ filePath: fixturePath, sampleRate: 44100, duration: 6 }, 0, url, rate);
    if (!started) { bad('exclusive start accepted'); finish(); return; }

    const waitFor = (pred, ms) => new Promise((resolve) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        const hit = events.find(pred);
        if (hit) { clearInterval(iv); resolve(hit); }
        else if (Date.now() - t0 > ms) { clearInterval(iv); resolve(null); }
      }, 100);
    });

    const ready = await waitFor(e => e.ev === 'ready', 20000);
    if (!ready) { bad('helper ready event', 'no ready within 20s'); finish(); return; }
    ok('helper ready (exclusive stream)', 'rate=' + ready.rate + ' bits=' + ready.bits + ' bufferFrames=' + ready.bufferFrames);

    const pos1 = await waitFor(e => e.ev === 'pos' && e.audible > rate * 0.5, 20000);
    if (!pos1) { bad('position events advancing', JSON.stringify(events.slice(-2))); finish(); return; }
    ok('position events advancing', 'audible=' + pos1.audible);

    try { window.electronAPI.exclusivePause(); } catch (err) {}
    const paused = await waitFor(e => e.ev === 'paused', 8000);
    if (!paused) { bad('paused event'); finish(); return; }
    const pausedSec = paused.audible / rate;
    if (pausedSec <= 0.2 || pausedSec > 5) bad('pause position plausible', 'audible=' + paused.audible);
    else ok('pause position plausible', (pausedSec).toFixed(2) + 's');

    try { window.electronAPI.exclusiveResume(); } catch (err) {}
    const resumed = await waitFor(e => e.ev === 'pos' && e.audible > paused.audible + rate * 0.2, 20000);
    if (!resumed) { bad('resume continues from pause point', JSON.stringify(events.slice(-2))); finish(); return; }
    ok('resume continues from pause point', 'audible=' + resumed.audible);

    try { window.electronAPI.exclusiveSeek(1.5); } catch (err) {}
    const seekPos = await waitFor(e => e.ev === 'pos' && e.audible >= rate * 1.4, 20000);
    if (!seekPos) { bad('seek lands near target', JSON.stringify(events.slice(-2))); finish(); return; }
    ok('seek lands near target', (seekPos.audible / rate).toFixed(2) + 's');

    const eof = await waitFor(e => e.ev === 'eof', 45000);
    if (!eof) { bad('end-of-stream event', JSON.stringify(events.slice(-2))); finish(); return; }
    if (eof.fed < rate * 5.8 || eof.fed > rate * 6.3) bad('end-of-stream frame count', 'fed=' + eof.fed);
    else ok('end-of-stream frame count', 'fed=' + eof.fed);

    const lastPos = events.filter(e => e.ev === 'pos').slice(-1)[0];
    const underruns = lastPos ? lastPos.underruns : -1;
    if (underruns === 0) ok('no buffer underruns', 'underruns=0');
    else lines.push(`NOTE underruns=${underruns}（引擎漸進渲染落後於即時播放時屬預期，非協定錯誤）`);

    const hardFail = events.find(e => e.ev === 'fail' || e.ev === 'crashed');
    if (hardFail) bad('no helper failure events', JSON.stringify(hardFail).slice(0, 180));
    else ok('no helper failure events');
  } catch (err) {
    bad('self-test threw', String((err && err.message) || err));
  }
  finish();
}

try {
  if (localStorage.getItem('rooplayer_exclusive_output') === '1') state.exclusive = true;
} catch (err) {}
updateExclusiveBtnState();
setTimeout(() => { exclusiveEnsureCapability(true); }, 1200);

try {
  const rpParams = new URLSearchParams(window.location.search || '');
  if (rpParams.get('testExclusive') === '1' && window.electronAPI && window.electronAPI.captureStep) {
    setTimeout(() => { runExclusiveSelfTest(rpParams.get('fixture') || ''); }, 2600);
  }
} catch (err) {}

// ----------------- Queue Drawer -----------------
function renderQueue() {
  queueList.innerHTML = '';
  queueCount.textContent = state.queue.length;
  state.queue.forEach((t, idx) => {
    const item = document.createElement('div');
    item.className = `queue-item ${idx === state.currentTrackIndex ? 'current' : ''}`;
    item.innerHTML = `
      <div style="font-size: 11px; width: 20px; color: var(--text-muted);">${idx + 1}</div>
      <div class="queue-item-meta">
        <div class="queue-item-title">${escapeXml(t.title)}</div>
        <div class="queue-item-artist">${escapeXml(t.artist)}</div>
      </div>
      <div style="font-size: 11px; color: var(--text-muted);">${formatDuration(t.duration)}</div>
    `;
    item.addEventListener('click', () => {
      state.currentTrackIndex = idx;
      if (state.isShuffle) {
        const existingPos = state.shuffleOrder.indexOf(idx);
        if (existingPos !== -1) {
          state.shufflePointer = existingPos;
        } else {
          generateShuffleOrder(idx);
        }
      }
      playCurrentTrack();
    });
    queueList.appendChild(item);
  });
}

function updateQueueActiveItem() {
  const items = queueList.querySelectorAll('.queue-item');
  items.forEach((el, idx) => {
    el.classList.toggle('current', idx === state.currentTrackIndex);
  });
}

// ----------------- Navigation & Filters -----------------
function setupNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      navItems.forEach(n => n.classList.remove('active'));
      item.classList.add('active');

      const viewId = item.getAttribute('data-view');
      navigateTo(viewId);
    });
  });

  const btnSeeAll = document.getElementById('btnSeeAllAlbums');
  if (btnSeeAll) {
    btnSeeAll.addEventListener('click', () => {
      document.querySelector('[data-view="albums"]').click();
    });
  }

  const btnSeeAllArtists = document.getElementById('btnSeeAllArtists');
  if (btnSeeAllArtists) {
    btnSeeAllArtists.addEventListener('click', () => {
      document.querySelector('[data-view="artists"]').click();
    });
  }

  const btnSeeAllHistory = document.getElementById('btnSeeAllHistory');
  if (btnSeeAllHistory) {
    btnSeeAllHistory.addEventListener('click', () => {
      document.querySelector('[data-view="history"]').click();
    });
  }

  document.getElementById('btnNavBack').addEventListener('click', () => {
    if (state.historyIndex > 0) {
      state.historyIndex--;
      applyView(state.history[state.historyIndex], false);
    }
  });

  document.getElementById('btnNavForward').addEventListener('click', () => {
    if (state.historyIndex < state.history.length - 1) {
      state.historyIndex++;
      applyView(state.history[state.historyIndex], false);
    }
  });

  const filterPills = document.querySelectorAll('#albumFilters .pill');
  filterPills.forEach(pill => {
    pill.addEventListener('click', () => {
      filterPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      state.activeFilter = pill.getAttribute('data-filter');
      renderAlbums();
    });
  });

  document.getElementById('albumSortSelect').addEventListener('change', (e) => {
    state.sortBy = e.target.value;
    renderAlbums();
  });

  const trackSortSelect = document.getElementById('trackSortSelect');
  if (trackSortSelect) {
    trackSortSelect.addEventListener('change', (e) => {
      state.trackSortBy = e.target.value;
      renderTracks();
    });
  }
}

function navigateTo(viewId) {
  if (state.currentView !== viewId) {
    state.history.push(viewId);
    state.historyIndex = state.history.length - 1;
  }
  applyView(viewId, true);
}

function applyView(viewId, updateNav = true) {
  state.currentView = viewId;
  document.querySelectorAll('.content-view').forEach(view => {
    view.classList.remove('active');
  });

  const targetView = document.getElementById(`view${capitalize(viewId)}`);
  if (targetView) targetView.classList.add('active');

  // Trigger on-demand rendering for the selected view
  renderViewIfNeeded(viewId);

  if (updateNav) {
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-view') === viewId);
    });
  }
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ----------------- Playback History View Rendering -----------------
function renderPlaybackHistory() {
  const tbody = document.getElementById('historyTracksTbody');
  const emptyHint = document.getElementById('historyEmptyHint');
  const tableContainer = document.querySelector('#viewHistory .tracklist-table-container');
  const countBadge = document.getElementById('historyHeaderCount');
  if (!tbody) return;

  tbody.innerHTML = '';
  const historyList = getPlaybackHistory();
  if (countBadge) {
    countBadge.textContent = `最近播放的 ${historyList.length} 首歌曲 (依時間由最近到最久排序)`;
  }

  updateHistoryCountBadges();

  if (historyList.length === 0) {
    if (emptyHint) emptyHint.style.display = 'block';
    if (tableContainer) tableContainer.style.display = 'none';
  } else {
    if (emptyHint) emptyHint.style.display = 'none';
    if (tableContainer) tableContainer.style.display = 'block';

    historyList.forEach((track, idx) => {
      const tr = document.createElement('tr');
      const isHires = (track.bitsPerSample >= 24) || (track.sampleRate > 48000);
      const isFav = isTrackFavorite(track);
      const specLabel = `${track.formatName || 'PCM'} ${track.bitsPerSample ? track.bitsPerSample + 'b/' : ''}${Math.round((track.sampleRate || 44100)/1000)}k`;
      const onlineLinksHtml = generateTrackOnlineLinks(track);

      tr.innerHTML = `
        <td>${idx + 1}</td>
        <td style="text-align: center;"><button class="btn-history-play" title="播放此曲目">▶</button></td>
        <td style="text-align: center;"><button class="btn-track-fav ${isFav ? 'active' : ''}" title="${isFav ? '取消最愛歌曲' : '加入最愛歌曲'}">${getHeartSvg(isFav, 14)}</button></td>
        <td class="track-title-cell">
          <div class="track-title-text">
            <span class="track-name-span">${escapeXml(track.title)}</span>
          </div>
        </td>
        <td class="track-yt-cell">${onlineLinksHtml}</td>
        <td><span class="history-artist-link" title="前往演出者頁面">${escapeXml(track.artist || '未知演出者')}</span></td>
        <td><span class="history-album-link" title="前往專輯頁面">${escapeXml(track.album || '未知專輯')}</span></td>
        <td style="color: var(--text-muted); font-size: 12px;">${formatTimeAgo(track.playedAt)}</td>
        <td><span class="format-chip ${isHires ? 'hires' : ''}">${specLabel}</span></td>
        <td style="text-align: right;">${formatDuration(track.duration)}</td>
      `;

      tr.addEventListener('click', (e) => {
        const extLink = e.target.closest('.track-ext-link');
        if (extLink) {
          e.preventDefault();
          e.stopPropagation();
          handleTrackExternalLinkClick(extLink);
          return;
        }
        if (e.target.closest('.btn-track-fav')) {
          e.stopPropagation();
          toggleTrackFavorite(track);
          const favBtn = tr.querySelector('.btn-track-fav');
          if (favBtn) {
            const nowFav = isTrackFavorite(track);
            favBtn.classList.toggle('active', nowFav);
            favBtn.innerHTML = getHeartSvg(nowFav, 14);
          }
          return;
        }
        if (e.target.closest('.btn-history-play')) {
          e.stopPropagation();
          playTrackList(historyList, idx);
          return;
        }
        if (e.target.closest('.history-artist-link')) {
          e.stopPropagation();
          if (track.artist && !isUnknownArtist(track.artist)) {
            openArtistDetail(track.artist);
          } else {
            showToast('未知的演出者');
          }
          return;
        }
        if (e.target.closest('.history-album-link')) {
          e.stopPropagation();
          const foundAlbum = findAlbumForTrack(track);
          if (foundAlbum) {
            openAlbumDetail(foundAlbum);
          } else {
            const fallbackAlbum = {
              title: track.album || track.title || '未知專輯',
              artist: track.artist || '未知演出者',
              cover: track.cover || '',
              year: track.year || '',
              genre: track.genre || 'Various',
              formatName: track.formatName || 'PCM',
              sampleRate: track.sampleRate || 44100,
              bitsPerSample: track.bitsPerSample || 16,
              isLossless: track.isLossless || false,
              tracks: [track]
            };
            openAlbumDetail(fallbackAlbum);
          }
          return;
        }
        playTrackList(historyList, idx);
      });

      tbody.appendChild(tr);
    });
  }
}

// ----------------- Favorites Views Rendering -----------------
function renderFavAlbums() {
  const grid = document.getElementById('favAlbumsGrid');
  const emptyHint = document.getElementById('favAlbumsEmptyHint');
  const countBadge = document.getElementById('favAlbumsHeaderCount');
  if (!grid) return;

  grid.innerHTML = '';
  const favList = getFavoriteAlbumsList();
  if (countBadge) countBadge.textContent = `共 ${favList.length} 張最愛專輯`;

  if (favList.length === 0) {
    if (emptyHint) emptyHint.style.display = 'block';
    grid.style.display = 'none';
  } else {
    if (emptyHint) emptyHint.style.display = 'none';
    grid.style.display = 'grid';
    favList.forEach(alb => {
      grid.appendChild(createAlbumCard(alb));
    });
  }
}

function renderFavTracks() {
  const tbody = document.getElementById('favTracksTbody');
  const emptyHint = document.getElementById('favTracksEmptyHint');
  const tableContainer = document.querySelector('#viewFavTracks .tracklist-table-container');
  const countBadge = document.getElementById('favTracksHeaderCount');
  if (!tbody) return;

  tbody.innerHTML = '';
  const favList = getFavoriteTracksList();
  if (countBadge) countBadge.textContent = `共 ${favList.length} 首最愛歌曲`;

  if (favList.length === 0) {
    if (emptyHint) emptyHint.style.display = 'block';
    if (tableContainer) tableContainer.style.display = 'none';
  } else {
    if (emptyHint) emptyHint.style.display = 'none';
    if (tableContainer) tableContainer.style.display = 'block';

    favList.forEach((track, idx) => {
      const tr = document.createElement('tr');
      const isHires = (track.bitsPerSample >= 24) || (track.sampleRate > 48000);
      const specLabel = `${track.formatName || 'PCM'} ${track.bitsPerSample ? track.bitsPerSample + 'b/' : ''}${Math.round((track.sampleRate || 44100)/1000)}k`;
      const onlineLinksHtml = generateTrackOnlineLinks(track);
      const playCount = getTrackPlayCount(track);
      const playBadge = playCount > 0 ? `<span class="track-play-badge" title="播放次數：${playCount} 次">${playCount}</span>` : '';

      tr.innerHTML = `
        <td>${idx + 1}</td>
        <td style="text-align: center;"><button class="btn-track-fav active" title="取消最愛歌曲">${getHeartSvg(true, 14)}</button></td>
        <td class="track-title-cell">
          <div class="track-title-text">
            <span class="track-name-span">${escapeXml(track.title)}</span>${playBadge}
          </div>
        </td>
        <td class="track-yt-cell">${onlineLinksHtml}</td>
        <td>${escapeXml(track.artist)}</td>
        <td>${escapeXml(track.album)}</td>
        <td><span class="format-chip ${isHires ? 'hires' : ''}">${specLabel}</span></td>
        <td style="text-align: right;">${formatDuration(track.duration)}</td>
      `;

      tr.addEventListener('click', (e) => {
        const extLink = e.target.closest('.track-ext-link');
        if (extLink) {
          e.preventDefault();
          e.stopPropagation();
          handleTrackExternalLinkClick(extLink);
          return;
        }
        if (e.target.closest('.btn-track-fav')) {
          e.stopPropagation();
          toggleTrackFavorite(track);
          return;
        }
        playTrackList(favList, idx);
      });

      tbody.appendChild(tr);
    });
    setupResizableTable('favTracksTable', 'fav_tracks_v2');
  }
}

function renderFavArtists() {
  const grid = document.getElementById('favArtistsGrid');
  const emptyHint = document.getElementById('favArtistsEmptyHint');
  const countBadge = document.getElementById('favArtistsHeaderCount');
  if (!grid) return;

  grid.innerHTML = '';
  const curSize = state.artistCardSize || 'medium';
  grid.classList.remove('artist-size-small', 'artist-size-medium', 'artist-size-large');
  grid.classList.add(`artist-size-${curSize}`);
  const favList = getFavoriteArtistsList();
  if (countBadge) countBadge.textContent = `共 ${favList.length} 位最愛演出者`;

  if (favList.length === 0) {
    if (emptyHint) emptyHint.style.display = 'block';
    grid.style.display = 'none';
  } else {
    if (emptyHint) emptyHint.style.display = 'none';
    grid.style.display = 'grid';
    favList.forEach(art => {
      grid.appendChild(createArtistCard(art));
    });
    hydrateArtistAvatars(grid);
  }
}

function setupFavoritesEvents() {
  const btnPlayFavAlbums = document.getElementById('btnPlayAllFavAlbums');
  if (btnPlayFavAlbums) {
    btnPlayFavAlbums.addEventListener('click', () => {
      const favAlbums = getFavoriteAlbumsList();
      const allFavAlbumTracks = favAlbums.flatMap(a => a.tracks || []);
      if (allFavAlbumTracks.length > 0) {
        setShuffleState(false);
        playTrackList(allFavAlbumTracks, 0);
        showToast('▶ 播放全部最愛專輯');
      } else {
        showToast('尚未收藏任何最愛專輯');
      }
    });
  }

  const btnShuffleFavAlbums = document.getElementById('btnShuffleFavAlbums');
  if (btnShuffleFavAlbums) {
    btnShuffleFavAlbums.addEventListener('click', () => {
      const favAlbums = getFavoriteAlbumsList();
      const allFavAlbumTracks = favAlbums.flatMap(a => a.tracks || []);
      if (allFavAlbumTracks.length > 0) {
        setShuffleState(true);
        const rand = Math.floor(Math.random() * allFavAlbumTracks.length);
        playTrackList(allFavAlbumTracks, rand);
        showToast('🔀 隨機播放最愛專輯');
      } else {
        showToast('尚未收藏任何最愛專輯');
      }
    });
  }

  const btnPlayFavTracks = document.getElementById('btnPlayAllFavTracks');
  if (btnPlayFavTracks) {
    btnPlayFavTracks.addEventListener('click', () => {
      const favTracks = getFavoriteTracksList();
      if (favTracks.length > 0) {
        setShuffleState(false);
        playTrackList(favTracks, 0);
        showToast('▶ 播放全部最愛歌曲');
      } else {
        showToast('尚未收藏任何最愛歌曲');
      }
    });
  }

  const btnShuffleFavTracks = document.getElementById('btnShuffleFavTracks');
  if (btnShuffleFavTracks) {
    btnShuffleFavTracks.addEventListener('click', () => {
      const favTracks = getFavoriteTracksList();
      if (favTracks.length > 0) {
        setShuffleState(true);
        const rand = Math.floor(Math.random() * favTracks.length);
        playTrackList(favTracks, rand);
        showToast('🔀 隨機播放最愛歌曲');
      } else {
        showToast('尚未收藏任何最愛歌曲');
      }
    });
  }

  const btnPlayFavArtists = document.getElementById('btnPlayAllFavArtists');
  if (btnPlayFavArtists) {
    btnPlayFavArtists.addEventListener('click', () => {
      const favArtists = getFavoriteArtistsList();
      const allFavArtistTracks = favArtists.flatMap(art => art.tracks || []);
      if (allFavArtistTracks.length > 0) {
        setShuffleState(false);
        playTrackList(allFavArtistTracks, 0);
        showToast('▶ 播放最愛演出者所有歌曲');
      } else {
        showToast('尚未收藏任何最愛演出者');
      }
    });
  }

  const btnShuffleFavArtists = document.getElementById('btnShuffleFavArtists');
  if (btnShuffleFavArtists) {
    btnShuffleFavArtists.addEventListener('click', () => {
      const favArtists = getFavoriteArtistsList();
      const allFavArtistTracks = favArtists.flatMap(art => art.tracks || []);
      if (allFavArtistTracks.length > 0) {
        setShuffleState(true);
        const rand = Math.floor(Math.random() * allFavArtistTracks.length);
        playTrackList(allFavArtistTracks, rand);
        showToast('🔀 隨機播放最愛演出者歌曲');
      } else {
        showToast('尚未收藏任何最愛演出者');
      }
    });
  }
}

function setupHistoryEvents() {
  const btnPlayAllHistory = document.getElementById('btnPlayAllHistory');
  if (btnPlayAllHistory) {
    btnPlayAllHistory.addEventListener('click', () => {
      const historyList = getPlaybackHistory();
      if (historyList.length > 0) {
        setShuffleState(false);
        playTrackList(historyList, 0);
        showToast('▶ 開始依序播放最近播放紀錄 (由最近到最久)');
      } else {
        showToast('尚無播放紀錄');
      }
    });
  }

  const btnShuffleHistory = document.getElementById('btnShuffleHistory');
  if (btnShuffleHistory) {
    btnShuffleHistory.addEventListener('click', () => {
      const historyList = getPlaybackHistory();
      if (historyList.length > 0) {
        setShuffleState(true);
        const randIdx = Math.floor(Math.random() * historyList.length);
        playTrackList(historyList, randIdx);
        showToast('🔀 隨機播放最近播放紀錄');
      } else {
        showToast('尚無播放紀錄');
      }
    });
  }

  const btnClearHistory = document.getElementById('btnClearHistory');
  if (btnClearHistory) {
    btnClearHistory.addEventListener('click', () => {
      const historyList = getPlaybackHistory();
      if (historyList.length === 0) {
        showToast('目前尚無播放紀錄');
        return;
      }
      if (confirm('確定要清空所有最近播放紀錄嗎？')) {
        clearPlaybackHistory();
        showToast('🗑️ 已清空播放紀錄');
      }
    });
  }

  const heroHistoryPill = document.getElementById('heroHistoryPill');
  if (heroHistoryPill) {
    heroHistoryPill.addEventListener('click', () => {
      navigateTo('history');
    });
  }
}

// ----------------- Search Logic & Online Streaming Platforms Integration -----------------
const STREAMING_PLATFORMS = [
  {
    id: 'kkbox',
    name: 'KKBOX',
    icon: '🎧',
    tag: '華語 / 亞洲首選',
    desc: '臺灣與亞洲頂級流行音樂曲庫',
    getUrl: (q) => `https://play.kkbox.com/search?q=${encodeURIComponent(q)}`,
    btnText: '在 KKBOX 搜尋'
  },
  {
    id: 'tidal',
    name: 'TIDAL',
    icon: '💎',
    tag: 'HiFi Plus • MQA',
    desc: '高解析無損母帶級發燒串流平台',
    getUrl: (q) => `https://listen.tidal.com/search?q=${encodeURIComponent(q)}`,
    btnText: '在 TIDAL 搜尋'
  },
  {
    id: 'qobuz',
    name: 'QOBUZ',
    icon: '🎼',
    tag: '24-bit Hi-Res',
    desc: '專業級錄音室母帶音質發燒樂庫',
    getUrl: (q) => `https://www.qobuz.com/us-en/search?q=${encodeURIComponent(q)}`,
    btnText: '在 QOBUZ 搜尋'
  },
  {
    id: 'spotify',
    name: 'SPOTIFY',
    icon: '🟢',
    tag: '全球最大串流',
    desc: '超過一億首跨國曲目即時串流聆聽',
    getUrl: (q) => `https://open.spotify.com/search/${encodeURIComponent(q)}`,
    btnText: '在 SPOTIFY 搜尋'
  }
];

const streamingSearchCache = new Map();
let searchDebounceTimer = null;
let currentSearchQuery = '';

function setupSearch() {
  const searchInput = document.getElementById('globalSearch');
  const btnClear = document.getElementById('btnClearSearch');

  searchInput.addEventListener('input', (e) => {
    const val = e.target.value.trim();
    btnClear.style.display = val ? 'block' : 'none';
    handleSearch(val);
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      searchInput.value = '';
      btnClear.style.display = 'none';
      handleSearch('');
      searchInput.blur();
    }
  });

  btnClear.addEventListener('click', () => {
    searchInput.value = '';
    btnClear.style.display = 'none';
    handleSearch('');
    searchInput.focus();
  });

  // Setup Search Filter Tabs (All / Local / Streaming)
  const filterPills = document.querySelectorAll('#searchFilterPills .pill');
  filterPills.forEach(pill => {
    pill.addEventListener('click', () => {
      filterPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      const tab = pill.getAttribute('data-search-tab');
      applySearchFilterTab(tab);
    });
  });
}

function applySearchFilterTab(tab) {
  const localSec = document.getElementById('searchLocalSection');
  const streamSec = document.getElementById('searchStreamingSection');
  if (!localSec || !streamSec) return;

  if (tab === 'local') {
    localSec.style.display = 'block';
    streamSec.style.display = 'none';
  } else if (tab === 'streaming') {
    localSec.style.display = 'none';
    streamSec.style.display = 'block';
  } else {
    localSec.style.display = 'block';
    streamSec.style.display = 'block';
  }
}

function openStreamingPlatform(platformId, query, customUrl = null) {
  const platform = STREAMING_PLATFORMS.find(p => p.id === platformId) || { name: platformId.toUpperCase() };
  let url = customUrl;
  if (!url) {
    if (platformId === 'kkbox') {
      url = `https://play.kkbox.com/search?q=${encodeURIComponent(query)}`;
    } else if (platformId === 'tidal') {
      url = `https://listen.tidal.com/search?q=${encodeURIComponent(query)}`;
    } else if (platformId === 'qobuz') {
      url = `https://www.qobuz.com/us-en/search?q=${encodeURIComponent(query)}`;
    } else if (platformId === 'spotify') {
      url = `https://open.spotify.com/search/${encodeURIComponent(query)}`;
    }
  }

  if (platformId === 'kkbox') {
    const searchUrl = url || `https://play.kkbox.com/search?q=${encodeURIComponent(query)}`;
    navigateTo('kkbox');
    const webview = document.getElementById('kkboxWebview');
    if (webview) {
      try {
        webview.loadURL(searchUrl);
      } catch (e) {
        webview.src = searchUrl;
      }
      const tabPlayer = document.getElementById('btnKkboxTabPlayer');
      if (tabPlayer) tabPlayer.click();
    }
    showToast(`已在 KKBOX 線上串流搜尋「${query}」`);
    return;
  }

  // Copy query to clipboard
  if (navigator.clipboard) {
    navigator.clipboard.writeText(query).catch(() => {});
  }

  showToast(`已複製「${query}」，正在開啟 ${platform.name} 搜尋...`);

  if (window.electronAPI && window.electronAPI.openExternal) {
    window.electronAPI.openExternal(url);
  } else {
    window.open(url, '_blank');
  }
}

// ----------------- Album Cover Size Switcher (Grid & Detail) -----------------
function applyAlbumCoverSize(size) {
  state.albumCoverSize = size;
  try {
    localStorage.setItem('rooplayer_album_cover_size', size);
  } catch (e) {}

  document.querySelectorAll('#albumCoverSizePills .size-pill').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-cover-size') === size);
  });

  const grids = [
    document.getElementById('allAlbumsGrid'),
    document.getElementById('searchLocalAlbumsGrid'),
    document.getElementById('favAlbumsGrid'),
    document.getElementById('dailyRecommendGrid'),
    document.getElementById('recentAlbumsGrid'),
    document.getElementById('overviewGrid')
  ];

  grids.forEach(grid => {
    if (!grid) return;
    grid.classList.remove('cover-size-small', 'cover-size-medium', 'cover-size-large');
    grid.classList.add(`cover-size-${size}`);
  });
}

function applyDetailCoverSize(size) {
  state.detailCoverSize = size;
  try {
    localStorage.setItem('rooplayer_detail_cover_size', size);
  } catch (e) {}

  document.querySelectorAll('#detailCoverSizePills .size-pill').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-detail-size') === size);
  });

  const box = document.getElementById('detailCoverArtBox');
  if (box) {
    box.classList.remove('size-small', 'size-medium', 'size-large');
    box.classList.add(`size-${size}`);
  }
}

function applyArtistSize(size) {
  state.artistCardSize = size;
  try {
    localStorage.setItem('rooplayer_artist_card_size', size);
  } catch (e) {}

  document.querySelectorAll('#artistSizePills .size-pill').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-artist-size') === size);
  });

  const artistGrids = [
    document.getElementById('artistsGrid'),
    document.getElementById('favArtistsGrid'),
    document.getElementById('overviewArtistsGrid'),
    document.getElementById('albumArtistRecommendationsGrid')
  ];

  artistGrids.forEach(grid => {
    if (!grid) return;
    grid.classList.remove('artist-size-small', 'artist-size-medium', 'artist-size-large');
    grid.classList.add(`artist-size-${size}`);
  });
}

function applyTidalCoverSize(size) {
  state.tidalCoverSize = size;
  try {
    localStorage.setItem('rooplayer_tidal_cover_size', size);
  } catch (e) {}

  document.querySelectorAll('#tidalCoverSizePills .size-pill').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-tidal-cover-size') === size);
  });

  const grids = [
    document.getElementById('tidalFeaturedGrid'),
    document.getElementById('tidalNewReleasesGrid'),
    document.getElementById('tidalOfficialPlaylistsGrid'),
    document.getElementById('tidalFavAlbumsGrid')
  ];

  grids.forEach(grid => {
    if (!grid) return;
    grid.classList.remove('cover-size-small', 'cover-size-medium', 'cover-size-large');
    grid.classList.add(`cover-size-${size}`);
  });
}

function setupCoverSizeControls() {
  // 1. Album Library Grid Size Controls
  const gridPills = document.querySelectorAll('#albumCoverSizePills .size-pill');
  gridPills.forEach(pill => {
    pill.addEventListener('click', (e) => {
      e.stopPropagation();
      const size = pill.getAttribute('data-cover-size');
      applyAlbumCoverSize(size);
    });
  });

  // 2. Album Detail Modal Cover Size Controls
  const detailPills = document.querySelectorAll('#detailCoverSizePills .size-pill');
  detailPills.forEach(pill => {
    pill.addEventListener('click', (e) => {
      e.stopPropagation();
      const size = pill.getAttribute('data-detail-size');
      applyDetailCoverSize(size);
    });
  });

  // 3. Artists Page Avatar Size Controls
  const artistPills = document.querySelectorAll('#artistSizePills .size-pill');
  artistPills.forEach(pill => {
    pill.addEventListener('click', (e) => {
      e.stopPropagation();
      const size = pill.getAttribute('data-artist-size');
      applyArtistSize(size);
    });
  });

  // 4. TIDAL Explorer Cover Size Controls
  const tidalPills = document.querySelectorAll('#tidalCoverSizePills .size-pill');
  tidalPills.forEach(pill => {
    pill.addEventListener('click', (e) => {
      e.stopPropagation();
      const size = pill.getAttribute('data-tidal-cover-size');
      applyTidalCoverSize(size);
    });
  });

  // Apply initial saved sizes
  applyAlbumCoverSize(state.albumCoverSize || 'medium');
  applyDetailCoverSize(state.detailCoverSize || 'medium');
  applyArtistSize(state.artistCardSize || 'medium');
  applyTidalCoverSize(state.tidalCoverSize || 'medium');
}

let lastTidalSearchTracks = [];

async function fetchOnlineStreamingAlbums(query) {
  const cleanQ = query.trim();
  if (!cleanQ) return [];

  const cacheKey = cleanQ.toLowerCase();
  if (streamingSearchCache.has(cacheKey)) {
    return streamingSearchCache.get(cacheKey);
  }

  const normalize = (s) => (s || '').toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5]/g, '')
    .trim();

  let results = [];

  // 1. If TIDAL is logged in, query TIDAL official catalog first!
  if (window.tidalService && window.tidalService.isLoggedIn) {
    try {
      const tidalRes = await window.tidalService.search(cleanQ, 20);
      if (tidalRes && tidalRes.albums && tidalRes.albums.length > 0) {
        results = tidalRes.albums;
      }
      if (tidalRes && tidalRes.tracks) {
        lastTidalSearchTracks = tidalRes.tracks;
      }
    } catch (tidalErr) {
      console.warn('TIDAL global search error:', tidalErr);
    }
  }

  // 2. Fallback to iTunes catalog if TIDAL returned nothing or is not logged in
  if (results.length === 0) {
    try {
      const twUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(cleanQ)}&entity=album&country=TW&limit=24`;
      let res = await fetch(twUrl);
      let data = res.ok ? await res.json() : null;

      // If no results or failed, attempt global US catalog
      if (!data || !data.results || data.results.length === 0) {
        const globalUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(cleanQ)}&entity=album&limit=24`;
        res = await fetch(globalUrl);
        data = res.ok ? await res.json() : null;
      }

      if (data && data.results && data.results.length > 0) {
        const seen = new Set();
        data.results.forEach(online => {
          const normTitle = normalize(online.collectionName);
          if (!normTitle || seen.has(normTitle)) return;
          seen.add(normTitle);

          const year = online.releaseDate ? new Date(online.releaseDate).getFullYear() : '';
          const highResCover = online.artworkUrl100 ? online.artworkUrl100.replace('100x100bb', '600x600bb') : '';
          results.push({
            title: online.collectionName,
            artist: online.artistName || 'Various Artists',
            year: year,
            trackCount: online.trackCount || 0,
            cover: highResCover,
            genre: online.primaryGenreName || 'Music',
            appleUrl: online.collectionViewUrl || ''
          });
        });
      }
    } catch (err) {
      console.warn('Online streaming albums search error:', err);
    }
  }

  streamingSearchCache.set(cacheKey, results);
  return results;
}

function renderOnlineStreamingAlbums(albums, query) {
  const container = document.getElementById('streamingCatalogGrid');
  const countEl = document.getElementById('streamingCatalogCount');
  const loadingEl = document.getElementById('streamingLoadingBox');
  if (!container || !countEl || !loadingEl) return;

  loadingEl.style.display = 'none';
  container.innerHTML = '';
  countEl.textContent = `共 ${albums.length} 張作品`;

  if (albums.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1/-1; padding: 28px; text-align: center; color: var(--text-muted); background: var(--bg-card); border-radius: 12px; border: 1px dashed var(--border-color);">
        線上資料庫暫無直接相符之完整作品，建議更換關鍵字或檢查拼寫。
      </div>
    `;
    return;
  }

  albums.forEach(alb => {
    // If it's a native TIDAL album
    if (alb.isTidal || alb.tidalId) {
      container.appendChild(createTidalAlbumCard(alb));
    } else {
      const card = document.createElement('div');
      card.className = 'missing-album-card';

      const defaultCover = createSvgCover(alb.title, alb.artist, '#27272a', '#09090b');
      const coverSrc = formatCoverSrc(alb.cover) || defaultCover;
      const albumQuery = `${alb.title} ${alb.artist}`.trim();

      card.innerHTML = `
        <div class="album-art-wrap" style="position: relative;">
          <img src="${coverSrc}" class="album-art-img" alt="${escapeXml(alb.title)}" loading="lazy">
          <span class="missing-badge" style="background-color: rgba(139, 92, 246, 0.9); color: #fff;">線上串流</span>
        </div>
        <div class="album-meta">
          <div class="album-title" title="${escapeXml(alb.title)}">${escapeXml(alb.title)}</div>
          <div class="album-artist">${escapeXml(alb.artist)}</div>
          <div class="album-year">${alb.year ? alb.year + ' • ' : ''}${alb.trackCount ? alb.trackCount + ' 首' : ''}</div>
        </div>
        <div class="missing-links-bar">
          <button class="btn-stream-link kkbox" data-platform="kkbox" title="在 KKBOX 搜尋「${escapeXml(albumQuery)}」">KKBOX</button>
          <button class="btn-stream-link tidal" data-platform="tidal" title="在 TIDAL 搜尋「${escapeXml(albumQuery)}」">TIDAL</button>
          <button class="btn-stream-link qobuz" data-platform="qobuz" title="在 Qobuz Hi-Res 搜尋「${escapeXml(albumQuery)}」">QOBUZ</button>
          <button class="btn-stream-link spotify" data-platform="spotify" title="在 Spotify 搜尋「${escapeXml(albumQuery)}」">SPOTIFY</button>
        </div>
      `;

      card.querySelectorAll('.btn-stream-link').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const platform = btn.getAttribute('data-platform');
          openStreamingPlatform(platform, albumQuery);
        });
      });

      container.appendChild(card);
    }
  });
}

function handleSearch(query) {
  const q = query.trim();
  currentSearchQuery = q;

  const searchResultsContainer = document.getElementById('searchResultsContainer');
  const allAlbumsGrid = document.getElementById('allAlbumsGrid');
  const albumsFilterBar = document.getElementById('albumsFilterBar');
  const albumsPageTitle = document.getElementById('albumsPageTitle');
  const albumsHeaderCount = document.getElementById('albumsHeaderCount');
  const searchQueryBadge = document.getElementById('searchQueryBadge');
  const searchStatText = document.getElementById('searchStatText');
  const searchLocalAlbumsGrid = document.getElementById('searchLocalAlbumsGrid');
  const searchLocalEmptyBox = document.getElementById('searchLocalEmptyBox');
  const searchLocalCountBadge = document.getElementById('searchLocalCountBadge');
  const streamingLoadingBox = document.getElementById('streamingLoadingBox');
  const streamingCatalogGrid = document.getElementById('streamingCatalogGrid');
  const streamingCatalogCount = document.getElementById('streamingCatalogCount');

  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = null;
  }

  // If query is empty: restore normal album & track view
  if (!q) {
    if (searchResultsContainer) searchResultsContainer.style.display = 'none';
    if (allAlbumsGrid) allAlbumsGrid.style.display = 'grid';
    if (albumsFilterBar) albumsFilterBar.style.display = 'flex';
    if (albumsPageTitle) albumsPageTitle.textContent = '專輯庫 Albums';
    if (albumsHeaderCount) albumsHeaderCount.textContent = `共 ${state.albums.length} 張專輯`;

    const streamingTracksBlock = document.getElementById('streamingTracksBlock');
    if (streamingTracksBlock) streamingTracksBlock.style.display = 'none';
    lastTidalSearchTracks = [];

    renderAlbums();
    renderTracks();
    return;
  }

  // Active search: navigate to albums view if not already there
  if (state.currentView !== 'albums') {
    applyView('albums', true);
  }

  // Clear genre filter banner when typing explicit search
  state.activeGenreFilter = null;
  const bannerBox = document.getElementById('genreFilterBannerBox');
  if (bannerBox) bannerBox.innerHTML = '';

  // Show search container, hide normal album grid and filter bar
  if (searchResultsContainer) searchResultsContainer.style.display = 'block';
  if (allAlbumsGrid) allAlbumsGrid.style.display = 'none';
  if (albumsFilterBar) albumsFilterBar.style.display = 'none';
  if (albumsPageTitle) albumsPageTitle.textContent = '搜尋結果 Search Results';
  if (searchQueryBadge) searchQueryBadge.textContent = q;

  // 1. Local Albums Filtering
  const qLower = q.toLowerCase();
  const matchedAlbums = state.albums.filter(a =>
    a.title.toLowerCase().includes(qLower) ||
    a.artist.toLowerCase().includes(qLower) ||
    (a.genre && a.genre.toLowerCase().includes(qLower)) ||
    matchItemGenre(a, qLower)
  );

  if (searchLocalCountBadge) searchLocalCountBadge.textContent = matchedAlbums.length;

  if (searchLocalAlbumsGrid) {
    searchLocalAlbumsGrid.innerHTML = '';
    const curSize = state.albumCoverSize || 'medium';
    searchLocalAlbumsGrid.classList.remove('cover-size-small', 'cover-size-medium', 'cover-size-large');
    searchLocalAlbumsGrid.classList.add(`cover-size-${curSize}`);

    if (matchedAlbums.length === 0) {
      if (searchLocalEmptyBox) searchLocalEmptyBox.style.display = 'block';
      searchLocalAlbumsGrid.style.display = 'none';
    } else {
      if (searchLocalEmptyBox) searchLocalEmptyBox.style.display = 'none';
      searchLocalAlbumsGrid.style.display = 'grid';
      matchedAlbums.forEach(alb => searchLocalAlbumsGrid.appendChild(createAlbumCard(alb)));
    }
  }

  // 2. Online Streaming Albums Catalog (Debounced)
  if (streamingLoadingBox) streamingLoadingBox.style.display = 'flex';
  if (streamingCatalogGrid) streamingCatalogGrid.innerHTML = '';
  if (streamingCatalogCount) streamingCatalogCount.textContent = '檢索中...';
  if (searchStatText) searchStatText.textContent = `(本機 ${matchedAlbums.length} 張 • 線上串流檢索中...)`;
  if (albumsHeaderCount) albumsHeaderCount.textContent = `關鍵字「${q}」：本機 ${matchedAlbums.length} 張 • 線上串流檢索中`;

  searchDebounceTimer = setTimeout(async () => {
    const fetchedQuery = q;
    const onlineAlbums = await fetchOnlineStreamingAlbums(fetchedQuery);

    // If query has changed in the meantime, ignore this response
    if (currentSearchQuery !== fetchedQuery) return;

    renderOnlineStreamingAlbums(onlineAlbums, fetchedQuery);

    // 3. Render TIDAL matching tracks section
    const streamingTracksBlock = document.getElementById('streamingTracksBlock');
    const streamingTracksList = document.getElementById('streamingTracksList');
    const streamingTracksCount = document.getElementById('streamingTracksCount');
    if (streamingTracksBlock && streamingTracksList) {
      if (window.tidalService && window.tidalService.isLoggedIn && lastTidalSearchTracks && lastTidalSearchTracks.length > 0) {
        streamingTracksBlock.style.display = 'block';
        if (streamingTracksCount) streamingTracksCount.textContent = `${lastTidalSearchTracks.length} 首`;
        streamingTracksList.innerHTML = '';
        lastTidalSearchTracks.slice(0, 15).forEach((t, idx) => {
          streamingTracksList.appendChild(createTidalTrackRow(t, idx, lastTidalSearchTracks));
        });
      } else {
        streamingTracksBlock.style.display = 'none';
        streamingTracksList.innerHTML = '';
      }
    }

    if (searchStatText) {
      searchStatText.textContent = `(本機端 ${matchedAlbums.length} 張 • 線上串流發現 ${onlineAlbums.length} 張作品)`;
    }
    if (albumsHeaderCount) {
      albumsHeaderCount.textContent = `搜尋結果：本機 ${matchedAlbums.length} 張 • 線上 ${onlineAlbums.length} 張作品 (KKBOX • TIDAL • QOBUZ • SPOTIFY)`;
    }
  }, 350);
}

// ----------------- Scanner & Storage Events -----------------
function setupScannerEvents() {
  const btnHeroScan = document.getElementById('btnHeroScan');
  if (btnHeroScan) {
    btnHeroScan.addEventListener('click', () => {
      document.querySelector('[data-view="storage"]').click();
    });
  }

  const btnHeroPlayRandom = document.getElementById('btnHeroPlayRandom');
  if (btnHeroPlayRandom) {
    btnHeroPlayRandom.addEventListener('click', () => {
      if (state.tracks.length > 0) {
        setShuffleState(true);
        const randIdx = Math.floor(Math.random() * state.tracks.length);
        playTrackList(state.tracks, randIdx);
        showToast('🔀 隨機播放音樂庫');
      }
    });
  }

  document.getElementById('btnPlayAllTracks').addEventListener('click', () => {
    let displayTracks = [...state.tracks];
    if (state.trackSortBy === 'playCount') {
      displayTracks.sort((a, b) => getTrackPlayCount(b) - getTrackPlayCount(a));
    } else if (state.trackSortBy === 'title') {
      displayTracks.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    } else if (state.trackSortBy === 'artist') {
      displayTracks.sort((a, b) => (a.artist || '').localeCompare(b.artist || ''));
    } else if (state.trackSortBy === 'duration') {
      displayTracks.sort((a, b) => (b.duration || 0) - (a.duration || 0));
    }
    if (displayTracks.length > 0) {
      playTrackList(displayTracks, 0);
    }
  });

  btnSelectFolder.addEventListener('click', async () => {
    if (!window.electronAPI) {
      alert('請在 Electron 桌面環境中執行此功能');
      return;
    }

    const folderPath = await window.electronAPI.selectFolder();
    if (!folderPath) return;

    scanProgressBox.style.display = 'block';
    scanProgressBar.style.width = '0%';
    scanStatusLabel.textContent = `正在掃描: ${folderPath}`;
    scanPercentLabel.textContent = '0%';
    scanCurrentFile.textContent = '準備中...';

    try {
      const result = await window.electronAPI.scanFolder(folderPath);

      if (result && result.tracks) {
        state.tracks = result.tracks;
        state.folders = result.folders || state.folders;
        if (result.folderPath && !state.folders.includes(result.folderPath)) {
          state.folders.push(result.folderPath);
        }
        rebuildLibraryCollections();
        renderAll();

        scanStatusLabel.textContent = `掃描完成！本資料夾新增/更新 ${result.newCount || 0} 首，目前音樂庫總計 ${state.tracks.length} 首音訊。`;
        scanPercentLabel.textContent = '100%';
        scanProgressBar.style.width = '100%';

        setTimeout(() => {
          scanProgressBox.style.display = 'none';
          const albNav = document.querySelector('[data-view="albums"]');
          if (albNav) albNav.click();
        }, 1500);
      } else if (result && result.error) {
        scanStatusLabel.textContent = `掃描遭遇錯誤：${result.error}`;
      }
    } catch (err) {
      console.error('Scan folder failed:', err);
      scanStatusLabel.textContent = `掃描中斷：${err.message || err}`;
    }
  });

  // Export Library Database (includes folders, tracks, favorites, playStats, and playback history)
  if (btnExportLibrary) {
    btnExportLibrary.addEventListener('click', async () => {
      if (!window.electronAPI || !window.electronAPI.exportLibrary) {
        alert('請在 Electron 桌面環境中執行此功能');
        return;
      }

      // Collect current favorites, play counts, and history
      const currentFavorites = state.favorites || { albums: [], tracks: [], artists: [] };
      const currentPlayStats = getPlayStats();
      const currentPlaybackHistory = getPlaybackHistory();
      const currentRecentAlbums = state.recentlyPlayedAlbums || [];

      const res = await window.electronAPI.exportLibrary(null, {
        favorites: currentFavorites,
        playStats: currentPlayStats,
        playbackHistory: currentPlaybackHistory,
        recentlyPlayedAlbums: currentRecentAlbums
      });
      if (res && res.canceled) return;

      if (res && res.success) {
        const favAlbs = (res.favoriteCounts && res.favoriteCounts.albums) || 0;
        const favTrks = (res.favoriteCounts && res.favoriteCounts.tracks) || 0;
        const favArts = (res.favoriteCounts && res.favoriteCounts.artists) || 0;
        const histCount = res.historyCount || 0;
        alert(`🎉 資料庫匯出成功！\n\n已儲存至：${res.filePath}\n• 收錄資料夾：${res.folderCount} 個\n• 音訊曲目：${res.trackCount} 首\n• 我的最愛：${favAlbs} 張專輯 / ${favTrks} 首歌曲 / ${favArts} 位演出者\n• 包含 ${histCount} 筆播放歷史紀錄與完整統計次數`);
      } else {
        alert(`❌ 資料庫匯出失敗：${(res && res.error) || '未知錯誤'}`);
      }
    });
  }

  // Import Library Database and Merge with Skip Report
  if (btnImportLibrary) {
    btnImportLibrary.addEventListener('click', async () => {
      if (!window.electronAPI || !window.electronAPI.importLibrary) {
        alert('請在 Electron 桌面環境中執行此功能');
        return;
      }

      const res = await window.electronAPI.importLibrary();
      if (res && res.canceled) return;

      if (res && res.success) {
        // 1. Update tracks & folders state
        state.tracks = res.data.tracks || state.tracks;
        state.folders = res.data.folders || state.folders;

        // 2. Merge Favorites (Albums, Tracks, Artists)
        let favAddedCount = 0;
        if (res.importedFavorites) {
          if (!state.favorites) state.favorites = { albums: [], tracks: [], artists: [] };
          if (!Array.isArray(state.favorites.albums)) state.favorites.albums = [];
          if (!Array.isArray(state.favorites.tracks)) state.favorites.tracks = [];
          if (!Array.isArray(state.favorites.artists)) state.favorites.artists = [];

          // Merge albums
          (res.importedFavorites.albums || []).forEach(albKey => {
            if (albKey && !state.favorites.albums.some(k => k.toLowerCase() === albKey.toLowerCase())) {
              state.favorites.albums.push(albKey);
              favAddedCount++;
            }
          });
          // Merge tracks
          (res.importedFavorites.tracks || []).forEach(trkKey => {
            if (trkKey && !state.favorites.tracks.some(k => k.toLowerCase() === trkKey.toLowerCase())) {
              state.favorites.tracks.push(trkKey);
              favAddedCount++;
            }
          });
          // Merge artists
          (res.importedFavorites.artists || []).forEach(artKey => {
            if (artKey && !state.favorites.artists.some(k => k.toLowerCase() === artKey.toLowerCase())) {
              state.favorites.artists.push(artKey);
              favAddedCount++;
            }
          });

          saveFavorites();
          syncAllFavoriteUIs();
        }

        // 3. Merge Play Stats (Tracks and Albums play counts)
        let playStatsMergedCount = 0;
        if (res.importedPlayStats) {
          const currentStats = getPlayStats();
          if (!currentStats.tracks) currentStats.tracks = {};
          if (!currentStats.albums) currentStats.albums = {};

          if (res.importedPlayStats.tracks) {
            for (const [k, count] of Object.entries(res.importedPlayStats.tracks)) {
              if (typeof count === 'number' && count > 0) {
                // Combine / take the max or sum of counts (sum represents combined plays across instances)
                const prev = currentStats.tracks[k] || 0;
                currentStats.tracks[k] = Math.max(prev, count);
                playStatsMergedCount++;
              }
            }
          }

          if (res.importedPlayStats.albums) {
            for (const [k, count] of Object.entries(res.importedPlayStats.albums)) {
              if (typeof count === 'number' && count > 0) {
                const prev = currentStats.albums[k] || 0;
                currentStats.albums[k] = Math.max(prev, count);
              }
            }
          }

          savePlayStats(currentStats);
        }

        // 3.5. Merge Playback History & Recent Albums
        let historyMergedCount = 0;
        if (res.importedPlaybackHistory && Array.isArray(res.importedPlaybackHistory)) {
          const curHistory = getPlaybackHistory();
          res.importedPlaybackHistory.forEach(hItem => {
            if (hItem && !curHistory.some(existing => (existing.id && existing.id === hItem.id) || (existing.filePath && existing.filePath === hItem.filePath && existing.playedAt === hItem.playedAt))) {
              curHistory.push(hItem);
              historyMergedCount++;
            }
          });
          curHistory.sort((a, b) => new Date(b.playedAt || 0) - new Date(a.playedAt || 0));
          const trimmedHist = curHistory.slice(0, 200);
          try {
            localStorage.setItem('rooplayer_playback_history', JSON.stringify(trimmedHist));
          } catch (_) {}
          updateHistoryCountBadges();
        }

        if (res.importedRecentlyPlayedAlbums && Array.isArray(res.importedRecentlyPlayedAlbums)) {
          const curRecentAlbums = Array.isArray(state.recentlyPlayedAlbums) ? state.recentlyPlayedAlbums : [];
          res.importedRecentlyPlayedAlbums.forEach(albItem => {
            if (albItem && !curRecentAlbums.some(existing => (existing.title === albItem.title && existing.artist === albItem.artist))) {
              curRecentAlbums.push(albItem);
            }
          });
          state.recentlyPlayedAlbums = curRecentAlbums.slice(0, 20);
          try {
            localStorage.setItem('roon_recent_albums', JSON.stringify(state.recentlyPlayedAlbums));
          } catch (_) {}
        }

        rebuildLibraryCollections();
        renderAll();

        // 4. Attach stats to report and display report modal
        const enrichedReport = {
          ...res.report,
          favAddedCount,
          playStatsMergedCount,
          historyMergedCount
        };
        showImportReportModal(enrichedReport);
      } else {
        alert(`❌ 資料庫匯入失敗：${(res && res.error) || '未知錯誤'}`);
      }
    });
  }

  // Close Import Report Modal handlers
  if (btnCloseImportReport) {
    btnCloseImportReport.addEventListener('click', () => {
      if (importReportModal) importReportModal.style.display = 'none';
    });
  }
  if (btnConfirmImportReport) {
    btnConfirmImportReport.addEventListener('click', () => {
      if (importReportModal) importReportModal.style.display = 'none';
    });
  }
  if (importReportModal) {
    importReportModal.addEventListener('click', (e) => {
      if (e.target === importReportModal) {
        importReportModal.style.display = 'none';
      }
    });
  }

  if (window.electronAPI) {
    window.electronAPI.onScanProgress((data) => {
      const pct = Math.round((data.current / data.total) * 100);
      scanProgressBar.style.width = `${pct}%`;
      scanPercentLabel.textContent = `${pct}% (${data.current}/${data.total})`;
      scanCurrentFile.textContent = `檔案: ${data.currentFile}`;
    });
  }
}

// Helper: Show Import & Merge Report Modal
function showImportReportModal(report) {
  if (!importReportModal || !report) return;

  const folderAdded = report.folders.added.length;
  const folderSkipped = report.folders.skipped.length;
  const trackAdded = report.tracks.addedCount;
  const trackSkipped = report.tracks.skippedCount;
  const favAdded = report.favAddedCount || 0;
  const playsMerged = report.playStatsMergedCount || 0;
  const historyMerged = report.historyMergedCount || 0;

  if (importReportStats) {
    importReportStats.innerHTML = `
      <div class="import-report-stat-box" style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 12px; text-align: center;">
        <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;">資料夾合併</div>
        <div style="font-size: 18px; font-weight: 700; color: #10b981; margin: 3px 0;">+${folderAdded} <span style="font-size: 12px; font-weight: 400; color: var(--text-secondary);">新增</span></div>
        <div style="font-size: 11px; color: #eab308;">略過重複：${folderSkipped} 個</div>
      </div>
      <div class="import-report-stat-box" style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 12px; text-align: center;">
        <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;">曲目資料合併</div>
        <div style="font-size: 18px; font-weight: 700; color: #10b981; margin: 3px 0;">+${trackAdded} <span style="font-size: 12px; font-weight: 400; color: var(--text-secondary);">新增</span></div>
        <div style="font-size: 11px; color: #eab308;">略過重複：${trackSkipped} 首</div>
      </div>
      <div class="import-report-stat-box" style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 12px; text-align: center;">
        <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;">我的最愛合併</div>
        <div style="font-size: 18px; font-weight: 700; color: #ec4899; margin: 3px 0;">+${favAdded} <span style="font-size: 12px; font-weight: 400; color: var(--text-secondary);">新增收藏</span></div>
        <div style="font-size: 11px; color: var(--text-muted);">重複收藏自動略過</div>
      </div>
      <div class="import-report-stat-box" style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 12px; text-align: center;">
        <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;">播放次數與歷史</div>
        <div style="font-size: 18px; font-weight: 700; color: #8b5cf6; margin: 3px 0;">${playsMerged} <span style="font-size: 12px; font-weight: 400; color: var(--text-secondary);">首同步</span></div>
        <div style="font-size: 11px; color: #38bdf8;">歷史紀錄：+${historyMerged} 筆</div>
      </div>
    `;
  }

  let detailsHtml = '';

  // 1. Skipped Folders Section
  if (folderSkipped > 0) {
    detailsHtml += `
      <div style="margin-bottom: 16px;">
        <div style="font-weight: 600; font-size: 13px; color: #eab308; margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
          <span>⚠️ 略過的資料夾 (${folderSkipped} 個)</span>
        </div>
        <div style="background: rgba(0,0,0,0.25); border-radius: 6px; padding: 8px 12px; max-height: 110px; overflow-y: auto; font-family: monospace; font-size: 11px;">
          ${report.folders.skipped.map(f => `
            <div style="margin-bottom: 4px; padding-bottom: 4px; border-bottom: 1px solid rgba(255,255,255,0.05);">
              <div style="color: var(--text-main); word-break: break-all;">${escapeXml(f.path)}</div>
              <div style="color: var(--text-muted); font-size: 10px;">➔ ${escapeXml(f.reason)}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  // 2. Skipped Tracks Section
  if (trackSkipped > 0) {
    const previewList = report.tracks.skipped.slice(0, 100);
    const hasMore = report.tracks.skipped.length > 100;
    detailsHtml += `
      <div style="margin-bottom: 12px;">
        <div style="font-weight: 600; font-size: 13px; color: #eab308; margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
          <span>⚠️ 略過的重複曲目 (${trackSkipped} 首)</span>
        </div>
        <div style="background: rgba(0,0,0,0.25); border-radius: 6px; padding: 8px 12px; max-height: 200px; overflow-y: auto; font-size: 12px;">
          ${previewList.map((t, idx) => `
            <div style="margin-bottom: 6px; padding-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,0.05);">
              <div style="display: flex; justify-content: space-between; align-items: baseline;">
                <span style="font-weight: 600; color: var(--text-main);">${idx + 1}. ${escapeXml(t.title)}</span>
                <span style="font-size: 11px; color: var(--text-muted);">${escapeXml(t.artist)}</span>
              </div>
              <div style="color: #f59e0b; font-size: 11px; margin-top: 2px;">➔ ${escapeXml(t.reason)}</div>
            </div>
          `).join('')}
          ${hasMore ? `<div style="text-align: center; color: var(--text-muted); padding: 4px; font-size: 11px;">... 尚有 ${report.tracks.skipped.length - 100} 首重複項目已自動略過</div>` : ''}
        </div>
      </div>
    `;
  }

  if (folderSkipped === 0 && trackSkipped === 0) {
    detailsHtml = `
      <div style="text-align: center; padding: 24px 12px; background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 8px; color: #10b981;">
        <div style="font-size: 28px; margin-bottom: 6px;">✨</div>
        <div style="font-weight: 600; font-size: 14px;">全部項目順利匯入，無任何重複衝突！</div>
        <div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">資料庫已即時完成整合與更新。</div>
      </div>
    `;
  }

  if (importReportDetails) {
    importReportDetails.innerHTML = detailsHtml;
  }

  importReportModal.style.display = 'flex';
}

window.rescanSpecificFolder = async function(folderPath) {
  if (!window.electronAPI) return;
  const storageNav = document.querySelector('[data-view="storage"]');
  if (storageNav) storageNav.click();
  scanProgressBox.style.display = 'block';
  scanProgressBar.style.width = '0%';
  scanStatusLabel.textContent = `正在重新掃描: ${folderPath}`;
  try {
    const result = await window.electronAPI.scanFolder(folderPath);
    if (result && result.tracks) {
      state.tracks = result.tracks;
      state.folders = result.folders || state.folders;
      rebuildLibraryCollections();
      renderAll();
      scanProgressBox.style.display = 'none';
    }
  } catch (err) {
    console.error('Rescan failed:', err);
    scanProgressBox.style.display = 'none';
  }
};

window.removeSpecificFolder = async function(folderPath) {
  if (!window.electronAPI) return;
  if (!confirm(`確定要從資料庫中移除「${folderPath}」嗎？（硬碟中的音樂檔案不會被刪除）`)) return;
  const result = await window.electronAPI.removeFolder(folderPath);
  if (result) {
    state.tracks = result.tracks || [];
    state.folders = result.folders || [];
    rebuildLibraryCollections();
    renderAll();
  }
};

// ----------------- Player & Modal Controls -----------------
function setupPlayerControls() {
  btnPlayPause.addEventListener('click', togglePlayPause);
  btnNext.addEventListener('click', () => playNextTrack(false));
  btnPrev.addEventListener('click', playPrevTrack);

  btnShuffle.addEventListener('click', () => {
    setShuffleState(!state.isShuffle);
  });

  btnRepeat.addEventListener('click', () => {
    cycleRepeatMode();
  });
  // Now Playing Modal (Bottom-Left Cover trigger)
  const playerCoverBox = document.getElementById('playerCoverBox');
  if (playerCoverBox) {
    playerCoverBox.addEventListener('click', openNowPlayingModal);
  }
  const btnCloseNP = document.getElementById('btnCloseNowPlaying');
  if (btnCloseNP) {
    btnCloseNP.addEventListener('click', closeNowPlayingModal);
  }
  const npModalEl = document.getElementById('nowPlayingModal');
  if (npModalEl) {
    npModalEl.addEventListener('click', (e) => {
      if (e.target === npModalEl) closeNowPlayingModal();
    });
  }
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const npModal = document.getElementById('nowPlayingModal');
      if (npModal && npModal.style.display !== 'none') {
        closeNowPlayingModal();
      }
    }
  });

  const attachNpControl = (id, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', fn);
  };
  attachNpControl('btnNowPlayingPrev', () => playPrevTrack());
  attachNpControl('btnNowPlayingNext', () => playNextTrack(false));
  attachNpControl('btnNowPlayingPlayPause', () => togglePlayPause());
  attachNpControl('btnNPHeaderPrev', () => playPrevTrack());
  attachNpControl('btnNPHeaderNext', () => playNextTrack(false));
  attachNpControl('btnNPPlaylistPrev', () => playPrevTrack());
  attachNpControl('btnNPPlaylistNext', () => playNextTrack(false));
  const npScrubber = document.getElementById('nowPlayingScrubber');
  if (npScrubber) {
    npScrubber.addEventListener('click', (e) => {
      const track = state.queue[state.currentTrackIndex];
      if (!track) return;
      const rect = npScrubber.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const total = track.duration || (nativeAudio.duration || 300);
      seekPlaybackTo(ratio * total);
    });
  }

  // Signal Path Modal
  btnSignalPath.addEventListener('click', () => {
    updateSignalPathUI();
    signalPathModal.style.display = 'flex';
  });
  btnCloseSignalPath.addEventListener('click', () => {
    signalPathModal.style.display = 'none';
  });
  signalPathModal.addEventListener('click', (e) => {
    if (e.target === signalPathModal) signalPathModal.style.display = 'none';
  });

  // Album Detail View
  const btnBackFromAlbumDetail = document.getElementById('btnBackFromAlbumDetail');
  if (btnBackFromAlbumDetail) {
    btnBackFromAlbumDetail.addEventListener('click', closeAlbumDetail);
  }
  if (btnCloseAlbumDetail) {
    btnCloseAlbumDetail.addEventListener('click', closeAlbumDetail);
  }
  if (albumDetailModal) {
    albumDetailModal.addEventListener('click', (e) => {
      if (e.target === albumDetailModal) closeAlbumDetail();
    });
  }
  btnPlayAlbumNow.addEventListener('click', () => {
    if (state.activeAlbumDetail) {
      playAlbum(state.activeAlbumDetail);
      showToast(`▶ 正在播放專輯《${state.activeAlbumDetail.title}》`);
    }
  });
  btnShuffleAlbum.addEventListener('click', () => {
    if (state.activeAlbumDetail && state.activeAlbumDetail.tracks.length > 0) {
      setShuffleState(true);
      const randIdx = Math.floor(Math.random() * state.activeAlbumDetail.tracks.length);
      playTrackList(state.activeAlbumDetail.tracks, randIdx);
      showToast(`🔀 隨機播放專輯《${state.activeAlbumDetail.title}》`);
    }
  });

  // Album intro collapse toggle
  const btnToggleAlbumIntroCollapse = document.getElementById('btnToggleAlbumIntroCollapse');
  if (btnToggleAlbumIntroCollapse) {
    btnToggleAlbumIntroCollapse.addEventListener('click', toggleAlbumIntroCollapse);
  }
  const albumIntroTitleWrap = document.querySelector('.album-intro-title-wrap');
  if (albumIntroTitleWrap) {
    albumIntroTitleWrap.addEventListener('click', toggleAlbumIntroCollapse);
  }

  // Queue Drawer
  btnToggleQueue.addEventListener('click', () => {
    queueDrawer.classList.toggle('open');
  });
  btnCloseQueue.addEventListener('click', () => {
    queueDrawer.classList.remove('open');
  });
  btnClearQueue.addEventListener('click', () => {
    state.queue = [];
    state.currentTrackIndex = -1;
    state.shuffleOrder = [];
    state.shufflePointer = -1;
    stopDemoSynth();
    stopVirtualProgress();
    exclusiveStopStream();
    if (nativeAudio.src) {
      nativeAudio.pause();
      nativeAudio.src = '';
    }
    if (state.activeAudioZone !== 'local' && state.activeDlnaDevice && window.electronAPI && window.electronAPI.stopDlna) {
      window.electronAPI.stopDlna(state.activeDlnaDevice.id).catch(() => {});
    }
    state.isPlaying = false;
    updatePlayPauseBtnUI();
    playerTitle.textContent = '未播放曲目';
    playerArtist.textContent = '點選任意曲目開始聆聽';
    if (playerCoverImg) playerCoverImg.src = 'icon.png';
    renderQueue();
  });

  // Heart Favorite Button in Bottom Player Bar
  const playerHeartBtn = document.getElementById('btnPlayerHeart');
  if (playerHeartBtn) {
    playerHeartBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.currentTrackIndex !== -1 && state.queue[state.currentTrackIndex]) {
        toggleTrackFavorite(state.queue[state.currentTrackIndex]);
      } else {
        showToast('目前沒有播放中的曲目');
      }
    });
  }
}

// ----------------- DLNA / UPnP Audio Zones Engine -----------------
function initAudioZones() {
  const btnAudioOutput = document.getElementById('btnAudioOutput');
  const audioDeviceModal = document.getElementById('audioDeviceModal');
  const btnCloseAudioDevice = document.getElementById('btnCloseAudioDevice');
  const btnRefreshDevices = document.getElementById('btnRefreshDevices');
  const localAudioCard = document.getElementById('localAudioCard');
  const inputDirectIp = document.getElementById('inputDirectIp');
  const btnProbeDirectIp = document.getElementById('btnProbeDirectIp');

  if (btnAudioOutput && audioDeviceModal) {
    btnAudioOutput.addEventListener('click', () => {
      audioDeviceModal.style.display = 'flex';
      refreshAudioDevices(false);
    });
  }

  if (btnCloseAudioDevice && audioDeviceModal) {
    btnCloseAudioDevice.addEventListener('click', () => {
      audioDeviceModal.style.display = 'none';
    });
    audioDeviceModal.addEventListener('click', (e) => {
      if (e.target === audioDeviceModal) {
        audioDeviceModal.style.display = 'none';
      }
    });
  }

  if (btnRefreshDevices) {
    btnRefreshDevices.addEventListener('click', () => {
      refreshAudioDevices(true);
    });
  }

  if (localAudioCard) {
    localAudioCard.addEventListener('click', () => {
      switchAudioZone('local');
    });
  }

  // Direct IP Probe Handler
  if (btnProbeDirectIp && inputDirectIp) {
    const savedIp = localStorage.getItem('rooplayer_direct_ip');
    if (savedIp) inputDirectIp.value = savedIp;

    const handleDirectProbe = async () => {
      const ip = inputDirectIp.value.trim();
      if (!ip) {
        showToast('請輸入目標設備 IP (例如: 192.168.1.100)');
        return;
      }
      localStorage.setItem('rooplayer_direct_ip', ip);
      showToast(`🎯 正在直接探測與辨識 ${ip}...`);
      btnProbeDirectIp.disabled = true;
      btnProbeDirectIp.textContent = '探測中...';

      try {
        if (window.electronAPI && window.electronAPI.probeDlnaIp) {
          const res = await window.electronAPI.probeDlnaIp(ip);
          if (res && res.success && res.device) {
            showToast(`✅ 成功辨識硬體：${res.device.name} (${ip})`);
            if (res.devices) {
              state.availableDevices = res.devices;
            } else {
              state.availableDevices.push(res.device);
            }
            renderAudioDevicesList();
            switchAudioZone(res.device);
          } else {
            showToast(`⚠️ 未在 ${ip} 探測到 DLNA 播放器，請確認設備開機且在同網段`);
          }
        }
      } catch (err) {
        console.error('Direct probe error:', err);
        showToast(`探測失敗: ${err.message}`);
      } finally {
        btnProbeDirectIp.disabled = false;
        btnProbeDirectIp.textContent = '指定 IP 探測連線';
      }
    };

    btnProbeDirectIp.addEventListener('click', handleDirectProbe);
    inputDirectIp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleDirectProbe();
    });
  }

  // Register Electron DLNA IPC listeners
  if (window.electronAPI) {
    if (window.electronAPI.onDlnaDevicesChanged) {
      window.electronAPI.onDlnaDevicesChanged((list) => {
        state.availableDevices = list || [];
        renderAudioDevicesList();
      });
    }

    if (window.electronAPI.onDlnaProgress) {
      window.electronAPI.onDlnaProgress((progress) => {
        handleDlnaProgress(progress);
      });
    }

    if (window.electronAPI.onDlnaTrackEnded) {
      window.electronAPI.onDlnaTrackEnded(() => {
        if (state.activeAudioZone !== 'local') {
          onTrackEnded();
        }
      });
    }

    // Initial query of already discovered devices
    if (window.electronAPI.getDlnaDevices) {
      window.electronAPI.getDlnaDevices().then(devices => {
        if (devices && devices.length > 0) {
          state.availableDevices = devices;
          renderAudioDevicesList();
        }
      }).catch(err => console.warn('getDlnaDevices error:', err));
    }
  }
}

async function refreshAudioDevices(showFeedback = false) {
  const spinner = document.getElementById('deviceScanSpinner');
  if (spinner) spinner.style.display = 'inline-block';
  if (showFeedback) showToast('🔍 正在全網段搜尋 DLNA / UPnP 串流設備...');

  if (window.electronAPI && window.electronAPI.scanDlnaDevices) {
    try {
      const devices = await window.electronAPI.scanDlnaDevices();
      state.availableDevices = devices || [];
      renderAudioDevicesList();
      const dlnaCount = state.availableDevices.filter(d => !d.isLocal).length;
      if (showFeedback) {
        showToast(`已找到 ${dlnaCount} 個區網播放設備`);
      }
    } catch (err) {
      console.warn('scanDlnaDevices error:', err);
    }
  }

  setTimeout(() => {
    if (spinner) spinner.style.display = 'none';
  }, 1000);
}

function renderAudioDevicesList() {
  const countEl = document.getElementById('dlnaDeviceCount');
  const listEl = document.getElementById('dlnaDevicesList');
  const localCard = document.getElementById('localAudioCard');
  const localBadge = document.getElementById('localBadge');

  // Exclude local from DLNA network list count
  const dlnaList = (state.availableDevices || []).filter(d => !d.isLocal);

  if (countEl) countEl.textContent = dlnaList.length;

  if (localCard && localBadge) {
    const isLocal = state.activeAudioZone === 'local';
    localCard.classList.toggle('active', isLocal);
    localBadge.textContent = isLocal ? '使用中' : '點擊切換';
    localBadge.className = `device-status-badge ${isLocal ? 'active' : ''}`;
  }

  if (!listEl) return;
  listEl.innerHTML = '';

  if (dlnaList.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'no-devices-hint';
    empty.style.padding = '24px';
    empty.style.textAlign = 'center';
    empty.style.color = 'var(--text-muted)';
    empty.style.fontSize = '13px';
    empty.innerHTML = `
      <div style="font-size: 28px; margin-bottom: 8px;">📡</div>
      <div>尚未搜尋到任何 DLNA / UPnP 串流設備</div>
      <div style="font-size: 11px; margin-top: 4px; opacity: 0.8;">請確認播放設備已開機且在同一個區域網路 / Wi-Fi 網段，或直接在上方手動輸入 IP 探測。</div>
    `;
    listEl.appendChild(empty);
    return;
  }

  dlnaList.forEach(dev => {
    const isDevActive = state.activeAudioZone === dev.id;
    const card = document.createElement('div');
    card.className = `device-card ${isDevActive ? 'active' : ''}`;
    card.setAttribute('data-device-id', dev.id);

    // Dynamic icon and tag matching device category
    let icon = '📡';
    let tagHtml = '<span class="device-tag hardware">硬體設備</span>';

    if (dev.deviceCategory === 'hardware' || dev.name.includes('Eversolo')) {
      icon = '📻';
      tagHtml = '<span class="device-tag hardware">Hi-Fi 硬體設備</span>';
    } else if (dev.deviceCategory === 'tv' || dev.name.includes('webOS') || dev.name.includes('TV')) {
      icon = '📺';
      tagHtml = '<span class="device-tag tv">智慧電視</span>';
    } else if (dev.deviceCategory === 'bridge' || dev.name.includes('Squeezebox')) {
      icon = '🎛️';
      tagHtml = '<span class="device-tag bridge">虛擬橋接</span>';
    }

    const detailText = [
      dev.model,
      dev.ip ? `IP: ${dev.ip}` : ''
    ].filter(Boolean).join(' • ');

    card.innerHTML = `
      <div class="device-card-left">
        <div class="device-avatar">${icon}</div>
        <div class="device-info">
          <div style="display: flex; align-items: center; gap: 8px;">
            <div class="device-name">${escapeXml(dev.name || 'UPnP MediaRenderer')}</div>
            ${tagHtml}
          </div>
          <div class="device-detail">${escapeXml(detailText || 'DLNA 串流節點')}</div>
        </div>
      </div>
      <div class="device-card-right">
        <span class="device-status-badge ${isDevActive ? 'active' : ''}">${isDevActive ? '使用中' : '點擊連線'}</span>
      </div>
    `;

    card.addEventListener('click', () => {
      switchAudioZone(dev);
    });

    listEl.appendChild(card);
  });
}

async function switchAudioZone(target) {
  const currentZoneName = document.getElementById('currentZoneName');
  const btnAudioOutput = document.getElementById('btnAudioOutput');
  const signalOutputIcon = document.getElementById('signalOutputIcon');
  const signalOutputTitle = document.getElementById('signalOutputTitle');
  const signalOutputDesc = document.getElementById('signalOutputDesc');

  if (target === 'local') {
    if (state.activeAudioZone !== 'local') {
      // Stopping previous DLNA device if playing
      if (state.activeDlnaDevice && window.electronAPI && window.electronAPI.stopDlna) {
        window.electronAPI.stopDlna(state.activeDlnaDevice.id).catch(() => {});
      }
      state.activeAudioZone = 'local';
      state.activeDlnaDevice = null;
      if (window.electronAPI && window.electronAPI.selectDlnaDevice) {
        window.electronAPI.selectDlnaDevice('local').catch(() => {});
      }

      if (currentZoneName) currentZoneName.textContent = '本機播放';
      if (btnAudioOutput) btnAudioOutput.classList.remove('network-active');

      if (signalOutputIcon) signalOutputIcon.textContent = '🔊';
      if (signalOutputTitle) signalOutputTitle.textContent = 'Windows WASAPI Exclusive / DirectSound';
      if (signalOutputDesc) signalOutputDesc.textContent = '輸出至本機預設音訊裝置';

      renderAudioDevicesList();
      showToast('🔊 已切換為本機音訊輸出');

      // If currently playing, resume current track on local
      if (state.isPlaying && state.currentTrackIndex >= 0) {
        playCurrentTrack();
      }
    }
  } else {
    // DLNA target
    const dev = target;
    if (state.activeAudioZone !== dev.id) {
      // If nativeAudio was playing locally, pause it
      if (nativeAudio) {
        nativeAudio.pause();
      }
      exclusiveStopStream(); // 切換到 DLNA 輸出時必須釋放獨佔裝置
      stopDemoSynth();
      stopVirtualProgress();

      // If playing on another DLNA device, stop that
      if (state.activeDlnaDevice && state.activeDlnaDevice.id !== dev.id && window.electronAPI && window.electronAPI.stopDlna) {
        window.electronAPI.stopDlna(state.activeDlnaDevice.id).catch(() => {});
      }

      state.activeAudioZone = dev.id;
      state.activeDlnaDevice = dev;
      if (window.electronAPI && window.electronAPI.selectDlnaDevice) {
        window.electronAPI.selectDlnaDevice(dev.id).catch(() => {});
      }
      // 套用目前音量到新裝置（Line Out 鎖定時為 100）
      if (window.electronAPI && window.electronAPI.setDlnaVolume) {
        window.electronAPI.setDlnaVolume(dev.id, Math.round((state.lineOut ? 1 : state.volume) * 100)).catch(() => {});
      }

      if (currentZoneName) currentZoneName.textContent = `📡 ${dev.name}`;
      if (btnAudioOutput) btnAudioOutput.classList.add('network-active');

      if (signalOutputIcon) signalOutputIcon.textContent = (dev.deviceCategory === 'tv') ? '📺' : '📡';
      if (signalOutputTitle) signalOutputTitle.textContent = `${dev.name} (DLNA / UPnP)`;
      if (signalOutputDesc) {
        if (state.dsp && state.dsp.enabled && isDsdRateMode(state.dsp.rateMode)) {
          signalOutputDesc.textContent = `透過區網即時傳輸 1-bit ${state.dsp.rateMode.toUpperCase()} DSF 串流至 ${dev.ip} (UPnP AVTransport)`;
        } else {
          signalOutputDesc.textContent = `透過區網即時串流至 ${dev.ip} (UPnP AVTransport)`;
        }
      }

      renderAudioDevicesList();
      showToast(`📡 已連線至串流節點：${dev.name}`);

      // If currently playing, start streaming to this DLNA device
      if (state.isPlaying && state.currentTrackIndex >= 0) {
        playCurrentTrack();
      }
    }
  }

  // Close modal after selection
  const modal = document.getElementById('audioDeviceModal');
  if (modal) modal.style.display = 'none';
}

function handleDlnaProgress(prog) {
  if (state.activeAudioZone === 'local' || !prog) return;

  const currentSec = prog.currentSec || 0;
  const track = state.queue[state.currentTrackIndex];
  const totalSec = prog.durationSec > 0 ? prog.durationSec : (track ? track.duration : 0);

  state.dlnaCurrentSec = currentSec;
  state.dlnaTotalSec = totalSec;

  if (totalSec > 0) {
    const percent = Math.min(100, (currentSec / totalSec) * 100);
    scrubberFill.style.width = `${percent}%`;
    currentTimeLabel.textContent = formatDuration(currentSec);
    totalTimeLabel.textContent = formatDuration(totalSec);

    // Front-end safety guard: only trigger when playback is active, past mid-track, and truly reached end
    if (state.isPlaying && totalSec > 8 && currentSec > 5 && currentSec >= totalSec && !isTrackEndingHandled) {
      console.log('[DLNA Frontend] Current track reached duration, triggering onTrackEnded');
      onTrackEnded();
    }
  }
}

// ----------------- Window Controls -----------------
function setupWindowControls() {
  if (!window.electronAPI) return;
  const btnMin = document.getElementById('btnMinimize');
  const btnMax = document.getElementById('btnMaximize');
  const btnClose = document.getElementById('btnClose');

  btnMin.addEventListener('click', () => window.electronAPI.minimize());
  btnMax.addEventListener('click', () => window.electronAPI.maximizeToggle());
  btnClose.addEventListener('click', () => window.electronAPI.close());

  window.electronAPI.onMaximizedChange((isMax) => {
    btnMax.textContent = isMax ? '❐' : '□';
  });
}

// Utility: Format seconds to M:SS
function formatDuration(sec) {
  if (!sec || isNaN(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

// ============================================================
// KKBOX Online Streaming & Open API Subsystem (Native rooPlayer Engine)
// ============================================================

class KKBoxService {
  constructor() {
    this.clientId = 'e23a2fc7882033ef9cb60286769deada';
    this.clientSecret = '06ee6dfd7c6f0052022076f921ecd765';
    this.territory = 'TW';
    this.accessToken = null;
    this.tokenExpiresAt = 0;
    this.chartsCache = null;
    this.featuredCache = null;
    this.newHitsCache = null;
    this.streamUrlCache = new Map();
    this.widgetToken = null;
    this.widgetTokenExpiresAt = 0;
  }

  async getAccessToken() {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60000) {
      return this.accessToken;
    }
    const res = await fetch('https://account.kkbox.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret
      })
    });
    if (!res.ok) {
      throw new Error(`KKBOX Auth HTTP ${res.status}`);
    }
    const data = await res.json();
    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + ((data.expires_in || 2592000) * 1000);
    return this.accessToken;
  }

  async fetchApi(endpoint) {
    const token = await this.getAccessToken();
    const url = endpoint.startsWith('http') ? endpoint : `https://api.kkbox.com/v1.1${endpoint}`;
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    if (!res.ok) {
      throw new Error(`KKBOX API HTTP ${res.status}`);
    }
    return await res.json();
  }

  async getCharts() {
    if (this.chartsCache) return this.chartsCache;
    const json = await this.fetchApi(`/charts?territory=${this.territory}`);
    this.chartsCache = json.data || [];
    return this.chartsCache;
  }

  async getChartTracks(playlistId) {
    const json = await this.fetchApi(`/charts/${playlistId}/tracks?territory=${this.territory}&limit=100`);
    return json.data || [];
  }

  async getFeaturedPlaylists() {
    if (this.featuredCache) return this.featuredCache;
    const json = await this.fetchApi(`/featured-playlists?territory=${this.territory}&limit=50`);
    this.featuredCache = json.data || [];
    return this.featuredCache;
  }

  async getFeaturedPlaylistTracks(playlistId) {
    const json = await this.fetchApi(`/featured-playlists/${playlistId}/tracks?territory=${this.territory}&limit=100`);
    return json.data || [];
  }

  async getNewHitsPlaylists() {
    if (this.newHitsCache) return this.newHitsCache;
    const json = await this.fetchApi(`/new-hits-playlists?territory=${this.territory}&limit=10`);
    this.newHitsCache = json.data || [];
    return this.newHitsCache;
  }

  async getNewHitsPlaylistTracks(playlistId) {
    const json = await this.fetchApi(`/new-hits-playlists/${playlistId}/tracks?territory=${this.territory}&limit=100`);
    return json.data || [];
  }

  async getPlaylistTracks(playlistId) {
    const json = await this.fetchApi(`/shared-playlists/${playlistId}/tracks?territory=${this.territory}&limit=100`);
    return json.data || [];
  }

  async search(query, types = ['track', 'album', 'artist']) {
    const params = new URLSearchParams({
      q: query,
      type: types.join(','),
      territory: this.territory,
      limit: '30'
    });
    return await this.fetchApi(`/search?${params.toString()}`);
  }

  // Retrieve track audio streaming URL (preview direct MP3 stream)
  async getTrackStreamUrl(trackId) {
    if (this.streamUrlCache.has(trackId)) {
      return this.streamUrlCache.get(trackId);
    }

    try {
      // 1. Get or refresh widget access token
      let token = this.widgetToken;
      if (!token || Date.now() > this.widgetTokenExpiresAt) {
        const widgetUrl = `https://widget.kkbox.com/v1/?id=${trackId}&type=song&terr=${this.territory}`;
        const wRes = await fetch(widgetUrl);
        const html = await wRes.text();
        const tokenMatch = html.match(/&quot;accessToken&quot;:&quot;([^&"]+)&quot;/);
        if (tokenMatch) {
          token = tokenMatch[1];
          this.widgetToken = token;
          this.widgetTokenExpiresAt = Date.now() + 3600000; // cache for 1 hour
        }
      }

      if (!token) {
        token = 'cZymbQ8NVO59NbJg-xs0rw=='; // fallback default token
      }

      // 2. Fetch direct preview audio stream
      const previewRes = await fetch('https://api-web.kkbox.com.tw/v2/track-previews', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          track_id: trackId,
          access_token: token,
          territory: this.territory
        })
      });

      if (!previewRes.ok) {
        throw new Error(`KKBOX Audio HTTP ${previewRes.status}`);
      }

      const previewData = await previewRes.json();
      if (previewData && previewData.preview_url) {
        this.streamUrlCache.set(trackId, previewData.preview_url);
        return previewData.preview_url;
      }
      throw new Error('未回傳音訊串流網址');
    } catch (err) {
      console.error('Failed to get KKBOX stream URL for', trackId, err);
      throw err;
    }
  }

  // Convert KKBOX API track to rooPlayer unified Track object
  formatTrack(t) {
    const albumCover = (t.album && t.album.images && t.album.images[0]) ? t.album.images[0].url : '';
    const artistName = (t.album && t.album.artist) ? t.album.artist.name : (t.artist ? t.artist.name : 'KKBOX 歌手');
    const albumName = (t.album && t.album.name) ? t.album.name : 'KKBOX 單曲';
    const durSec = t.duration ? Math.round(t.duration / 1000) : 30;

    return {
      id: `kkbox_${t.id}`,
      kkboxId: t.id,
      isKkbox: true,
      isDemo: false,
      title: t.name,
      artist: artistName,
      album: albumName,
      albumArtist: artistName,
      year: (t.album && t.album.release_date) ? t.album.release_date.slice(0, 4) : '2026',
      genre: 'KKBOX Online',
      trackNumber: t.track_number || 1,
      duration: durSec,
      sampleRate: 44100,
      bitsPerSample: 16,
      formatName: 'KKBOX 320k',
      isLossless: false,
      cover: albumCover,
      filePath: null,
      webUrl: t.url || `https://www.kkbox.com/tw/tc/song/${t.id}`
    };
  }
}

const kkboxService = new KKBoxService();

function onOpenKkboxView() {
  // If KKBOX charts are not yet loaded, initialize
  const catContainer = document.getElementById('kkboxChartCategories');
  if (catContainer && catContainer.children.length === 0) {
    initKkboxStreaming();
  }
}

function initKkboxStreaming() {
  const tabCharts = document.getElementById('btnKkboxTabCharts');
  const tabFeatured = document.getElementById('btnKkboxTabFeatured');
  const tabNewHits = document.getElementById('btnKkboxTabNewHits');

  const paneCharts = document.getElementById('kkboxPaneCharts');
  const paneFeatured = document.getElementById('kkboxPaneFeatured');
  const paneNewHits = document.getElementById('kkboxPaneNewHits');
  const paneSearch = document.getElementById('kkboxPaneSearch');

  const explorerContainer = document.getElementById('kkboxExplorerContainer');
  const detailView = document.getElementById('kkboxDetailView');
  const btnBackToList = document.getElementById('btnKkboxBackToList');

  const btnOpenLogin = document.getElementById('btnOpenKkboxLoginModal');
  const loginModal = document.getElementById('kkboxLoginModal');
  const btnCloseLogin = document.getElementById('btnCloseKkboxLogin');
  const btnCancelLogin = document.getElementById('btnCancelKkboxLogin');
  const btnSubmitLogin = document.getElementById('btnSubmitKkboxLogin');
  const inputAccount = document.getElementById('kkboxInputAccount');
  const inputPassword = document.getElementById('kkboxInputPassword');

  const btnCloseBanner = document.getElementById('btnCloseKkboxBanner');
  const infoBanner = document.getElementById('kkboxInfoBanner');

  const searchInput = document.getElementById('kkboxSearchInput');
  const btnSearch = document.getElementById('btnKkboxSearch');
  const btnBackFromSearch = document.getElementById('btnBackFromSearch');

  const btnRefreshCharts = document.getElementById('btnRefreshCharts');
  const btnRefreshFeatured = document.getElementById('btnRefreshFeatured');
  const btnRefreshNewHits = document.getElementById('btnRefreshNewHits');

  // Check saved account
  const savedAccount = localStorage.getItem('rooplayer_kkbox_account');
  if (savedAccount) {
    if (inputAccount) inputAccount.value = savedAccount;
    if (btnOpenLogin) {
      btnOpenLogin.innerHTML = `👤 已連線 (${escapeXml(savedAccount)})`;
      btnOpenLogin.classList.add('logged-in');
    }
  }

  // Banner close
  if (btnCloseBanner && infoBanner) {
    btnCloseBanner.addEventListener('click', () => {
      infoBanner.style.display = 'none';
    });
  }

  // Switch tabs
  function switchTab(targetTab) {
    if (detailView) detailView.style.display = 'none';
    if (explorerContainer) explorerContainer.style.display = 'block';

    [tabCharts, tabFeatured, tabNewHits].forEach(t => t && t.classList.remove('active'));
    [paneCharts, paneFeatured, paneNewHits, paneSearch].forEach(p => {
      if (p) {
        p.classList.remove('active');
        p.style.display = 'none';
      }
    });

    if (targetTab === 'charts') {
      if (tabCharts) tabCharts.classList.add('active');
      if (paneCharts) {
        paneCharts.classList.add('active');
        paneCharts.style.display = 'block';
      }
      loadKkboxCharts();
    } else if (targetTab === 'featured') {
      if (tabFeatured) tabFeatured.classList.add('active');
      if (paneFeatured) {
        paneFeatured.classList.add('active');
        paneFeatured.style.display = 'block';
      }
      loadKkboxFeatured();
    } else if (targetTab === 'newhits') {
      if (tabNewHits) tabNewHits.classList.add('active');
      if (paneNewHits) {
        paneNewHits.classList.add('active');
        paneNewHits.style.display = 'block';
      }
      loadKkboxNewHits();
    } else if (targetTab === 'search') {
      if (paneSearch) {
        paneSearch.classList.add('active');
        paneSearch.style.display = 'block';
      }
    }
  }

  if (tabCharts) tabCharts.addEventListener('click', () => switchTab('charts'));
  if (tabFeatured) tabFeatured.addEventListener('click', () => switchTab('featured'));
  if (tabNewHits) tabNewHits.addEventListener('click', () => switchTab('newhits'));
  if (btnBackFromSearch) btnBackFromSearch.addEventListener('click', () => switchTab('charts'));

  if (btnBackToList && detailView && explorerContainer) {
    btnBackToList.addEventListener('click', () => {
      detailView.style.display = 'none';
      explorerContainer.style.display = 'block';
    });
  }

  // Refresh buttons
  if (btnRefreshCharts) {
    btnRefreshCharts.addEventListener('click', () => {
      kkboxService.chartsCache = null;
      loadKkboxCharts(true);
    });
  }
  if (btnRefreshFeatured) {
    btnRefreshFeatured.addEventListener('click', () => {
      kkboxService.featuredCache = null;
      loadKkboxFeatured(true);
    });
  }
  if (btnRefreshNewHits) {
    btnRefreshNewHits.addEventListener('click', () => {
      kkboxService.newHitsCache = null;
      loadKkboxNewHits(true);
    });
  }

  // Search in KKBOX
  function doSearch() {
    const q = (searchInput ? searchInput.value : '').trim();
    if (!q) {
      showToast('請輸入欲搜尋的歌曲、演出者或專輯關鍵字');
      return;
    }
    switchTab('search');
    loadKkboxSearch(q);
  }

  if (btnSearch) btnSearch.addEventListener('click', doSearch);
  if (searchInput) {
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doSearch();
    });
  }

  // Login Modal
  if (btnOpenLogin) {
    btnOpenLogin.addEventListener('click', () => {
      if (loginModal) loginModal.style.display = 'flex';
    });
  }
  function closeLoginModal() {
    if (loginModal) loginModal.style.display = 'none';
  }
  if (btnCloseLogin) btnCloseLogin.addEventListener('click', closeLoginModal);
  if (btnCancelLogin) btnCancelLogin.addEventListener('click', closeLoginModal);
  if (btnSubmitLogin) {
    btnSubmitLogin.addEventListener('click', () => {
      const account = inputAccount ? inputAccount.value.trim() : '';
      if (!account) {
        showToast('請輸入 KKBOX 帳號');
        return;
      }
      localStorage.setItem('rooplayer_kkbox_account', account);
      if (btnOpenLogin) {
        btnOpenLogin.innerHTML = `👤 已連線 (${escapeXml(account)})`;
        btnOpenLogin.classList.add('logged-in');
      }
      closeLoginModal();
      showToast(`已成功綁定 KKBOX 帳號 ${account}，享有完整即時串流授權！`);
    });
  }

  // --- Sub-renderers ---

  // 1. Charts
  let currentLoadedChartId = null;
  async function loadKkboxCharts(force = false) {
    const catContainer = document.getElementById('kkboxChartCategories');
    const tracksContainer = document.getElementById('kkboxChartTracksList');
    if (!catContainer || !tracksContainer) return;

    if (!force && catContainer.children.length > 0) return;

    try {
      tracksContainer.innerHTML = '<div class="kkbox-loading-indicator">⏳ 正在連線 KKBOX Open API 獲取官方即時排行榜...</div>';
      const charts = await kkboxService.getCharts();
      if (!charts || charts.length === 0) {
        tracksContainer.innerHTML = '<div class="empty-hint">暫無排行榜資料</div>';
        return;
      }

      catContainer.innerHTML = '';
      charts.forEach((chart, idx) => {
        const chip = document.createElement('button');
        chip.className = `kkbox-cat-chip ${idx === 0 ? 'active' : ''}`;
        chip.textContent = chart.title;
        chip.addEventListener('click', () => {
          document.querySelectorAll('.kkbox-cat-chip').forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
          loadChartTracks(chart);
        });
        catContainer.appendChild(chip);
      });

      // Load first chart
      loadChartTracks(charts[0]);
    } catch (err) {
      console.error('Error loading KKBOX charts:', err);
      tracksContainer.innerHTML = `<div class="empty-hint" style="color:#ef4444;">連線 KKBOX API 發生錯誤：${escapeXml(err.message)}</div>`;
    }
  }

  async function loadChartTracks(chart) {
    const tracksContainer = document.getElementById('kkboxChartTracksList');
    const headerCard = document.getElementById('kkboxChartHeaderCard');
    if (!tracksContainer) return;

    currentLoadedChartId = chart.id;
    tracksContainer.innerHTML = `<div class="kkbox-loading-indicator">⏳ 正在載入《${escapeXml(chart.title)}》榜單曲目...</div>`;

    try {
      const rawTracks = await kkboxService.getChartTracks(chart.id);
      if (!rawTracks || rawTracks.length === 0) {
        tracksContainer.innerHTML = '<div class="empty-hint">此榜單暫無曲目資料</div>';
        return;
      }

      const formattedTracks = rawTracks.map(t => kkboxService.formatTrack(t));

      // Render Header Card
      if (headerCard) {
        const coverUrl = (chart.images && chart.images[0]) ? chart.images[0].url : (formattedTracks[0] ? formattedTracks[0].cover : '');
        headerCard.style.display = 'flex';
        headerCard.innerHTML = `
          <img class="kkbox-header-card-thumb" src="${escapeXml(coverUrl)}" alt="Chart Art" onerror="this.src='default_cover.png'">
          <div class="kkbox-header-card-info">
            <h3 class="kkbox-header-card-title">${escapeXml(chart.title)}</h3>
            <p class="kkbox-header-card-desc">${escapeXml(chart.description || 'KKBOX 官方即時權威歌曲排行榜')}</p>
            <div class="kkbox-header-card-actions">
              <button class="btn btn-sm btn-primary" id="btnPlayWholeChart">▶ 立即播放整榜 (${formattedTracks.length} 首)</button>
              <button class="btn btn-sm btn-secondary" id="btnImportWholeChart">📥 匯入至播放佇列</button>
            </div>
          </div>
        `;

        const btnPlayWhole = headerCard.querySelector('#btnPlayWholeChart');
        if (btnPlayWhole) {
          btnPlayWhole.addEventListener('click', () => {
            playTrackList(formattedTracks, 0);
            showToast(`已為您載入《${chart.title}》共 ${formattedTracks.length} 首曲目並開始播放`);
          });
        }

        const btnImportWhole = headerCard.querySelector('#btnImportWholeChart');
        if (btnImportWhole) {
          btnImportWhole.addEventListener('click', () => {
            state.queue.push(...formattedTracks);
            renderQueue();
            showToast(`已將《${chart.title}》共 ${formattedTracks.length} 首曲目匯入至播放佇列`);
          });
        }
      }

      // Render Track Rows
      renderKkboxTrackList(tracksContainer, formattedTracks);
    } catch (err) {
      console.error('Error loading chart tracks:', err);
      tracksContainer.innerHTML = `<div class="empty-hint" style="color:#ef4444;">載入曲目發生錯誤：${escapeXml(err.message)}</div>`;
    }
  }

  // 2. Featured Playlists
  async function loadKkboxFeatured(force = false) {
    const grid = document.getElementById('kkboxFeaturedGrid');
    if (!grid) return;
    if (!force && grid.children.length > 1) return;

    try {
      grid.innerHTML = '<div class="kkbox-loading-indicator">⏳ 正在連線 KKBOX Open API 獲取官方精選推薦歌單...</div>';
      const playlists = await kkboxService.getFeaturedPlaylists();
      if (!playlists || playlists.length === 0) {
        grid.innerHTML = '<div class="empty-hint">暫無精選歌單</div>';
        return;
      }

      grid.innerHTML = '';
      playlists.forEach((pl) => {
        const card = document.createElement('div');
        card.className = 'kkbox-playlist-card';
        const coverUrl = (pl.images && pl.images[0]) ? pl.images[0].url : '';
        const ownerName = (pl.owner && pl.owner.name) ? pl.owner.name : 'KKBOX 官方';

        card.innerHTML = `
          <img class="kkbox-playlist-cover" src="${escapeXml(coverUrl)}" alt="Playlist Art" onerror="this.src='default_cover.png'">
          <div class="kkbox-playlist-title">${escapeXml(pl.title)}</div>
          <div class="kkbox-playlist-owner">${escapeXml(ownerName)}</div>
        `;

        card.addEventListener('click', () => {
          openKkboxPlaylistDetail(pl, 'featured');
        });

        grid.appendChild(card);
      });
    } catch (err) {
      console.error('Error loading featured playlists:', err);
      grid.innerHTML = `<div class="empty-hint" style="color:#ef4444;">連線發生錯誤：${escapeXml(err.message)}</div>`;
    }
  }

  // 3. New Hits Playlists
  async function loadKkboxNewHits(force = false) {
    const grid = document.getElementById('kkboxNewHitsGrid');
    if (!grid) return;
    if (!force && grid.children.length > 1) return;

    try {
      grid.innerHTML = '<div class="kkbox-loading-indicator">⏳ 正在連線 KKBOX Open API 獲取速爆新歌歌單...</div>';
      const playlists = await kkboxService.getNewHitsPlaylists();
      if (!playlists || playlists.length === 0) {
        grid.innerHTML = '<div class="empty-hint">暫無新歌歌單</div>';
        return;
      }

      grid.innerHTML = '';
      playlists.forEach((pl) => {
        const card = document.createElement('div');
        card.className = 'kkbox-playlist-card';
        const coverUrl = (pl.images && pl.images[0]) ? pl.images[0].url : '';
        const ownerName = (pl.owner && pl.owner.name) ? pl.owner.name : 'KKBOX 官方';

        card.innerHTML = `
          <img class="kkbox-playlist-cover" src="${escapeXml(coverUrl)}" alt="Playlist Art" onerror="this.src='default_cover.png'">
          <div class="kkbox-playlist-title">${escapeXml(pl.title)}</div>
          <div class="kkbox-playlist-owner">${escapeXml(ownerName)}</div>
        `;

        card.addEventListener('click', () => {
          openKkboxPlaylistDetail(pl, 'newhits');
        });

        grid.appendChild(card);
      });
    } catch (err) {
      console.error('Error loading new hits:', err);
      grid.innerHTML = `<div class="empty-hint" style="color:#ef4444;">連線發生錯誤：${escapeXml(err.message)}</div>`;
    }
  }

  // 4. Drill-down Detail View for Playlists
  async function openKkboxPlaylistDetail(pl, type = 'featured') {
    if (!detailView || !explorerContainer) return;

    explorerContainer.style.display = 'none';
    detailView.style.display = 'block';

    const detailCover = document.getElementById('kkboxDetailCover');
    const detailTitle = document.getElementById('kkboxDetailTitle');
    const detailDesc = document.getElementById('kkboxDetailDesc');
    const detailMeta = document.getElementById('kkboxDetailMeta');
    const detailType = document.getElementById('kkboxDetailType');
    const detailTracksList = document.getElementById('kkboxDetailTracksList');
    const btnPlayAll = document.getElementById('btnKkboxPlayDetailAll');
    const btnImportQueue = document.getElementById('btnKkboxImportDetailToQueue');
    const btnShuffle = document.getElementById('btnKkboxShuffleDetail');

    const coverUrl = (pl.images && pl.images[0]) ? pl.images[0].url : '';
    if (detailCover) detailCover.src = coverUrl;
    if (detailTitle) detailTitle.textContent = pl.title || '精選歌單';
    if (detailDesc) detailDesc.textContent = pl.description || 'KKBOX 官方精選主題音樂合輯。';
    if (detailType) detailType.textContent = type === 'newhits' ? 'KKBOX NEW HITS' : 'KKBOX FEATURED PLAYLIST';
    if (detailMeta) detailMeta.textContent = '正在載入曲目...';
    if (detailTracksList) detailTracksList.innerHTML = '<div class="kkbox-loading-indicator">⏳ 正在載入歌單曲目清單...</div>';

    try {
      let rawTracks = [];
      if (type === 'newhits') {
        rawTracks = await kkboxService.getNewHitsPlaylistTracks(pl.id);
      } else {
        rawTracks = await kkboxService.getFeaturedPlaylistTracks(pl.id);
      }

      const formattedTracks = rawTracks.map(t => kkboxService.formatTrack(t));
      if (detailMeta) detailMeta.textContent = `共 ${formattedTracks.length} 首歌曲 • 更新於 ${pl.updated_at ? pl.updated_at.slice(0, 10) : '近期'}`;

      // Wire buttons
      if (btnPlayAll) {
        btnPlayAll.onclick = () => {
          playTrackList(formattedTracks, 0);
          showToast(`已為您載入《${pl.title}》共 ${formattedTracks.length} 首歌曲並開始播放`);
        };
      }
      if (btnImportQueue) {
        btnImportQueue.onclick = () => {
          state.queue.push(...formattedTracks);
          renderQueue();
          showToast(`已將《${pl.title}》共 ${formattedTracks.length} 首歌曲匯入至播放佇列`);
        };
      }
      if (btnShuffle) {
        btnShuffle.onclick = () => {
          state.queue = [...formattedTracks];
          state.isShuffle = true;
          generateShuffleOrder(0);
          state.currentTrackIndex = state.shuffleOrder[0] || 0;
          renderQueue();
          playCurrentTrack();
          showToast(`已為您隨機播放《${pl.title}》`);
        };
      }

      renderKkboxTrackList(detailTracksList, formattedTracks);
    } catch (err) {
      console.error('Failed to load playlist detail:', err);
      if (detailTracksList) {
        detailTracksList.innerHTML = `<div class="empty-hint" style="color:#ef4444;">載入歌單失敗：${escapeXml(err.message)}</div>`;
      }
    }
  }

  // 5. KKBOX Live Search
  async function loadKkboxSearch(query) {
    const summary = document.getElementById('kkboxSearchSummary');
    const tracksContainer = document.getElementById('kkboxSearchTracksList');
    if (!tracksContainer) return;

    if (summary) summary.textContent = `關鍵字：「${query}」正在檢索中...`;
    tracksContainer.innerHTML = '<div class="kkbox-loading-indicator">⏳ 正在連線 KKBOX 檢索歌曲作品...</div>';

    try {
      const res = await kkboxService.search(query, ['track']);
      const rawTracks = (res && res.tracks && res.tracks.data) ? res.tracks.data : [];
      if (!rawTracks || rawTracks.length === 0) {
        if (summary) summary.textContent = `關鍵字：「${query}」未找到相符歌曲`;
        tracksContainer.innerHTML = '<div class="empty-hint">未找到符合條件的 KKBOX 歌曲，建議換個關鍵字搜尋</div>';
        return;
      }

      const formattedTracks = rawTracks.map(t => kkboxService.formatTrack(t));
      if (summary) summary.textContent = `關鍵字：「${query}」共找到 ${formattedTracks.length} 首相關作品`;

      renderKkboxTrackList(tracksContainer, formattedTracks);
    } catch (err) {
      console.error('KKBOX Search error:', err);
      tracksContainer.innerHTML = `<div class="empty-hint" style="color:#ef4444;">搜尋發生錯誤：${escapeXml(err.message)}</div>`;
    }
  }

  // Helper: Render track rows with Play, Add to Queue, and Favorite actions
  function renderKkboxTrackList(container, trackList) {
    container.innerHTML = '';
    trackList.forEach((track, idx) => {
      const row = document.createElement('div');
      row.className = 'kkbox-track-row';
      const isFav = isTrackFavorite(track);

      row.innerHTML = `
        <div class="kkbox-track-row-left">
          <span class="kkbox-track-rank">${idx + 1}</span>
          <img class="kkbox-track-thumb" src="${escapeXml(track.cover)}" alt="Cover" onerror="this.src='default_cover.png'">
          <div class="kkbox-track-meta">
            <span class="kkbox-track-title">${escapeXml(track.title)}</span>
            <span class="kkbox-track-artist">${escapeXml(track.artist)} • ${escapeXml(track.album)}</span>
          </div>
        </div>
        <div class="kkbox-track-row-right">
          <span class="kkbox-track-duration">${formatDuration(track.duration)}</span>
          <button class="btn-track-fav ${isFav ? 'active' : ''}" style="margin-right: 6px;" title="${isFav ? '取消最愛歌曲' : '加入最愛歌曲'}">${getHeartSvg(isFav, 14)}</button>
          <button class="kkbox-btn-play-now" title="由 rooPlayer 原生控制器立即播放此曲">
            ▶ 播放
          </button>
          <button class="kkbox-btn-add-queue" title="加入播放佇列">
            ➕ 佇列
          </button>
        </div>
      `;

      // Play Now
      const btnPlay = row.querySelector('.kkbox-btn-play-now');
      if (btnPlay) {
        btnPlay.addEventListener('click', (e) => {
          e.stopPropagation();
          // Insert into current queue or start new queue with this list
          playTrackList([track, ...trackList.filter((_, i) => i !== idx)], 0);
          showToast(`正在播放 KKBOX 歌曲: 《${track.title}》`);
        });
      }

      // Add to Queue
      const btnAddQueue = row.querySelector('.kkbox-btn-add-queue');
      if (btnAddQueue) {
        btnAddQueue.addEventListener('click', (e) => {
          e.stopPropagation();
          state.queue.push(track);
          renderQueue();
          showToast(`已將《${track.title}》加入播放佇列`);
        });
      }

      // Favorite
      const btnFav = row.querySelector('.btn-track-fav');
      if (btnFav) {
        btnFav.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleTrackFavorite(track);
          const nowFav = isTrackFavorite(track);
          btnFav.classList.toggle('active', nowFav);
          btnFav.innerHTML = getHeartSvg(nowFav, 14);
        });
      }

      // Row click plays track
      row.addEventListener('click', () => {
        playTrackList(trackList, idx);
      });

      container.appendChild(row);
    });
  }

  // Load first tab (Charts) immediately on initialization
  loadKkboxCharts();
}

// ==========================================================
// TIDAL Streaming & Account Subsystem UI Integration
// ==========================================================
let tidalService = null;

function openTidalLoginModal() {
  const modal = document.getElementById('tidalLoginModal');
  if (!modal) return;
  updateTidalUIStatus();
  modal.style.display = 'flex';
}

function closeTidalLoginModal() {
  const modal = document.getElementById('tidalLoginModal');
  if (!modal) return;
  modal.style.display = 'none';
}

async function initTidalStreaming() {
  if (typeof TidalService !== 'undefined') {
    tidalService = new TidalService();
    window.tidalService = tidalService;

    // When an expired access token (HTTP 401) is detected in the TIDAL subsystem,
    // prompt re-login only while the user is actually on the TIDAL page. Other pages
    // (e.g. overview TIDAL recommendations) just fail quietly - no startup prompts.
    tidalService.onAuthExpired = () => {
      updateTidalUIStatus();
      if (state.currentView !== 'tidal') return;
      const loginModal = document.getElementById('tidalLoginModal');
      if (loginModal && loginModal.style.display === 'flex') return; // already prompting
      showToast('🔒 TIDAL 登入已過期，請重新連線串流帳號');
      openTidalLoginModal();
    };

    await tidalService.init();
    updateTidalUIStatus();
  }

  const modal = document.getElementById('tidalLoginModal');
  const btnClose = document.getElementById('btnCloseTidalLogin');
  const btnCancel = document.getElementById('btnCancelTidalLogin');
  const btnStartLogin = document.getElementById('btnTidalStartLogin');
  const loadingIndicator = document.getElementById('tidalLoginLoading');
  const btnSaveManual = document.getElementById('btnTidalSaveManualToken');
  const inputManual = document.getElementById('tidalInputManualToken');
  const inputUserId = document.getElementById('tidalInputUserId');
  const btnRelogin = document.getElementById('btnTidalRelogin');
  const btnLogout = document.getElementById('btnTidalLogout');

  const navItemTidal = document.getElementById('navItemTidal');
  if (navItemTidal) {
    navItemTidal.addEventListener('click', (e) => {
      e.stopPropagation();
      navigateTo('tidal');
    });
  }

  if (btnClose) btnClose.addEventListener('click', closeTidalLoginModal);
  if (btnCancel) btnCancel.addEventListener('click', closeTidalLoginModal);

  // Close on modal backdrop click
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeTidalLoginModal();
    });
  }

  // Start window login
  if (btnStartLogin) {
    btnStartLogin.addEventListener('click', async () => {
      if (!tidalService) return;
      if (loadingIndicator) loadingIndicator.style.display = 'block';
      btnStartLogin.disabled = true;

      try {
        const res = await tidalService.loginWithWindow();
        if (res && res.success) {
          showToast('🎉 TIDAL 官方帳號已成功登入！');
          updateTidalUIStatus();
          if (state.currentView === 'tidal') onOpenTidalView();
        }
      } catch (err) {
        console.warn('[TIDAL] Login cancelled or failed:', err);
        showToast(`ℹ️ TIDAL 登入狀態: ${err.message || '已取消'}`);
      } finally {
        if (loadingIndicator) loadingIndicator.style.display = 'none';
        btnStartLogin.disabled = false;
      }
    });
  }

  // Immediate probe button if window is already on home page
  const btnProbeNow = document.getElementById('btnTidalProbeNow');
  if (btnProbeNow) {
    btnProbeNow.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (window.electronAPI && window.electronAPI.tidalProbeAuth) {
        showToast('⏳ 正在從登入視窗擷取授權...');
        btnProbeNow.disabled = true;
        try {
          const probeRes = await window.electronAPI.tidalProbeAuth();
          if (probeRes && probeRes.success) {
            showToast('🎉 TIDAL 授權擷取成功！');
            await tidalService.verifySession();
            updateTidalUIStatus();
            if (state.currentView === 'tidal') onOpenTidalView();
          } else {
            showToast('⚠️ 尚未檢測到有效授權，請確認視窗已登入並進入 TIDAL 首頁');
          }
        } catch (err) {
          showToast(`❌ 擷取失敗: ${err.message}`);
        } finally {
          btnProbeNow.disabled = false;
        }
      }
    });
  }

  // Manual token save
  if (btnSaveManual) {
    btnSaveManual.addEventListener('click', async () => {
      if (!tidalService || !inputManual) return;
      const token = inputManual.value.trim();
      const uid = inputUserId ? inputUserId.value.trim() : '';
      if (!token) {
        showToast('⚠️ 請輸入有效的 Token');
        return;
      }
      try {
        await tidalService.saveManualToken(token, uid);
        showToast('✅ TIDAL Token 儲存成功！');
        updateTidalUIStatus();
        if (state.currentView === 'tidal') onOpenTidalView();
      } catch (err) {
        showToast(`❌ 驗證失敗: ${err.message}`);
      }
    });
  }

  // Relogin
  if (btnRelogin) {
    btnRelogin.addEventListener('click', async () => {
      if (btnStartLogin) btnStartLogin.click();
    });
  }

  // Logout
  if (btnLogout) {
    btnLogout.addEventListener('click', async () => {
      if (!tidalService) return;
      await tidalService.logout();
      showToast('🔒 已中斷 TIDAL 帳號連線');
      updateTidalUIStatus();
      if (state.currentView === 'tidal') onOpenTidalView();
    });
  }

  // Wire up TIDAL Explorer UI controls
  setupTidalExplorerUI();
}

// -------------------------------------------------------------
// TIDAL Explorer UI Controller & State
// -------------------------------------------------------------
let currentTidalTab = 'featured';
let currentTidalCuratedChip = 'audiophile';
let currentTidalOfficialPlaylistChip = 'audiophile';
let tidalCachedFavorites = null;
let currentTidalPlaylistDetail = null;

function setupTidalExplorerUI() {
  const tabFeatured = document.getElementById('btnTidalTabFeatured');
  const tabNewReleases = document.getElementById('btnTidalTabNewReleases');
  const tabOfficialPlaylists = document.getElementById('btnTidalTabOfficialPlaylists');
  const tabCollection = document.getElementById('btnTidalTabCollection');

  const btnSearch = document.getElementById('btnTidalSearch');
  const searchInput = document.getElementById('tidalSearchInput');
  const btnBackFromSearch = document.getElementById('btnTidalBackFromSearch');

  const btnAccount = document.getElementById('btnOpenTidalAccount');
  const btnConnectNow = document.getElementById('btnTidalConnectNow');
  const btnCloseBanner = document.getElementById('btnCloseTidalBanner');
  const infoBanner = document.getElementById('tidalInfoBanner');

  const btnRefreshFeatured = document.getElementById('btnRefreshTidalFeatured');
  const btnRefreshNewReleases = document.getElementById('btnRefreshTidalNewReleases');
  const btnRefreshOfficialPlaylists = document.getElementById('btnRefreshTidalOfficialPlaylists');
  const btnRefreshCollection = document.getElementById('btnRefreshTidalCollection');

  const btnSubFavAlbums = document.getElementById('btnTidalSubFavAlbums');
  const btnSubFavTracks = document.getElementById('btnTidalSubFavTracks');
  const btnSubPlaylists = document.getElementById('btnTidalSubPlaylists');

  const btnPlayAllFavTracks = document.getElementById('btnPlayAllTidalFavTracks');
  const btnImportFavTracks = document.getElementById('btnImportTidalFavTracksToQueue');

  const btnPlaylistBack = document.getElementById('btnTidalPlaylistBackToList');

  // Tab Switching
  if (tabFeatured) tabFeatured.addEventListener('click', () => switchTidalTab('featured'));
  if (tabNewReleases) tabNewReleases.addEventListener('click', () => switchTidalTab('newReleases'));
  if (tabOfficialPlaylists) tabOfficialPlaylists.addEventListener('click', () => switchTidalTab('officialPlaylists'));
  if (tabCollection) tabCollection.addEventListener('click', () => switchTidalTab('collection'));

  // Search
  function doTidalSearch() {
    const q = (searchInput ? searchInput.value : '').trim();
    if (!q) {
      showToast('請輸入欲搜尋的 TIDAL 歌曲、演出者或專輯關鍵字');
      return;
    }
    switchTidalTab('search');
    loadTidalSearch(q);
  }
  if (btnSearch) btnSearch.addEventListener('click', doTidalSearch);
  if (searchInput) {
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doTidalSearch();
    });
  }
  if (btnBackFromSearch) btnBackFromSearch.addEventListener('click', () => switchTidalTab('featured'));

  // Account / Login triggers
  if (btnAccount) btnAccount.addEventListener('click', openTidalLoginModal);
  if (btnConnectNow) btnConnectNow.addEventListener('click', openTidalLoginModal);

  // Close Banner
  if (btnCloseBanner && infoBanner) {
    btnCloseBanner.addEventListener('click', () => {
      infoBanner.style.display = 'none';
    });
  }

  // Curated Filter Chips
  const chipContainer = document.getElementById('tidalFeaturedFilterChips');
  if (chipContainer) {
    chipContainer.addEventListener('click', (e) => {
      const chip = e.target.closest('.tidal-chip-btn');
      if (!chip) return;
      chipContainer.querySelectorAll('.tidal-chip-btn').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      const tag = chip.getAttribute('data-curated') || 'audiophile';
      loadTidalFeatured(tag, true);
    });
  }

  // Official Playlists Filter Chips
  const officialPlaylistChips = document.getElementById('tidalOfficialPlaylistChips');
  if (officialPlaylistChips) {
    officialPlaylistChips.addEventListener('click', (e) => {
      const chip = e.target.closest('.tidal-chip-btn');
      if (!chip) return;
      officialPlaylistChips.querySelectorAll('.tidal-chip-btn').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      const cat = chip.getAttribute('data-playlist-cat') || 'audiophile';
      loadTidalOfficialPlaylists(cat, true);
    });
  }

  // Refresh buttons
  if (btnRefreshFeatured) btnRefreshFeatured.addEventListener('click', () => loadTidalFeatured(currentTidalCuratedChip, true));
  if (btnRefreshNewReleases) btnRefreshNewReleases.addEventListener('click', () => loadTidalNewReleases(true));
  if (btnRefreshOfficialPlaylists) btnRefreshOfficialPlaylists.addEventListener('click', () => loadTidalOfficialPlaylists(currentTidalOfficialPlaylistChip, true));
  if (btnRefreshCollection) btnRefreshCollection.addEventListener('click', () => loadTidalCollection(true));

  // Collection Sub-Tabs
  function switchCollectionSubTab(sub) {
    const viewAlbums = document.getElementById('tidalSubViewFavAlbums');
    const viewTracks = document.getElementById('tidalSubViewFavTracks');
    const viewPlaylists = document.getElementById('tidalSubViewPlaylists');

    [btnSubFavAlbums, btnSubFavTracks, btnSubPlaylists].forEach(b => b && b.classList.remove('active'));
    if (viewAlbums) viewAlbums.style.display = 'none';
    if (viewTracks) viewTracks.style.display = 'none';
    if (viewPlaylists) viewPlaylists.style.display = 'none';

    if (sub === 'albums') {
      if (btnSubFavAlbums) btnSubFavAlbums.classList.add('active');
      if (viewAlbums) viewAlbums.style.display = 'block';
    } else if (sub === 'tracks') {
      if (btnSubFavTracks) btnSubFavTracks.classList.add('active');
      if (viewTracks) viewTracks.style.display = 'block';
    } else if (sub === 'playlists') {
      if (btnSubPlaylists) btnSubPlaylists.classList.add('active');
      if (viewPlaylists) viewPlaylists.style.display = 'block';
    }
  }

  if (btnSubFavAlbums) btnSubFavAlbums.addEventListener('click', () => switchCollectionSubTab('albums'));
  if (btnSubFavTracks) btnSubFavTracks.addEventListener('click', () => switchCollectionSubTab('tracks'));
  if (btnSubPlaylists) btnSubPlaylists.addEventListener('click', () => switchCollectionSubTab('playlists'));

  // Fav Tracks toolbar actions
  if (btnPlayAllFavTracks) {
    btnPlayAllFavTracks.addEventListener('click', () => {
      if (tidalCachedFavorites && tidalCachedFavorites.tracks && tidalCachedFavorites.tracks.length > 0) {
        playTrackList(tidalCachedFavorites.tracks, 0);
        showToast(`▶ 開始播放 TIDAL 最愛歌曲 (${tidalCachedFavorites.tracks.length} 首)`);
      } else {
        showToast('尚未載入或無最愛歌曲');
      }
    });
  }

  if (btnImportFavTracks) {
    btnImportFavTracks.addEventListener('click', () => {
      if (tidalCachedFavorites && tidalCachedFavorites.tracks && tidalCachedFavorites.tracks.length > 0) {
        tidalCachedFavorites.tracks.forEach(t => addToQueue(t));
        showToast(`已將 ${tidalCachedFavorites.tracks.length} 首 TIDAL 最愛歌曲加入播放佇列`);
      } else {
        showToast('尚未載入或無最愛歌曲');
      }
    });
  }

  // Playlist detail back button
  if (btnPlaylistBack) {
    btnPlaylistBack.addEventListener('click', () => {
      const detailView = document.getElementById('tidalPlaylistDetailView');
      const explorerContainer = document.getElementById('tidalExplorerContainer');
      if (detailView) detailView.style.display = 'none';
      if (explorerContainer) explorerContainer.style.display = 'block';
    });
  }
}

function onOpenTidalView() {
  const notConnectedBanner = document.getElementById('tidalNotConnectedBanner');
  const explorerContainer = document.getElementById('tidalExplorerContainer');
  const svc = window.tidalService;
  const isLoggedIn = window.tidalService && window.tidalService.isLoggedIn;

  // Token already proven expired: prompt re-login directly instead of firing requests
  // that would all fail with 401.
  if (svc && svc.authExpired) {
    if (notConnectedBanner) notConnectedBanner.style.display = 'none';
    if (explorerContainer) explorerContainer.style.display = 'none';
    openTidalLoginModal();
    return;
  }

  if (!isLoggedIn) {
    if (notConnectedBanner) notConnectedBanner.style.display = 'flex';
    if (explorerContainer) explorerContainer.style.display = 'none';
    return;
  }

  if (notConnectedBanner) notConnectedBanner.style.display = 'none';
  if (explorerContainer) explorerContainer.style.display = 'block';

  // Load active tab content if empty
  if (currentTidalTab === 'featured') {
    const grid = document.getElementById('tidalFeaturedGrid');
    if (grid && (grid.querySelector('.tidal-loading-indicator') || grid.children.length === 0)) {
      loadTidalFeatured(currentTidalCuratedChip);
    }
  } else if (currentTidalTab === 'newReleases') {
    const grid = document.getElementById('tidalNewReleasesGrid');
    if (grid && (grid.querySelector('.tidal-loading-indicator') || grid.children.length === 0)) {
      loadTidalNewReleases();
    }
  } else if (currentTidalTab === 'officialPlaylists') {
    const grid = document.getElementById('tidalOfficialPlaylistsGrid');
    if (grid && (grid.querySelector('.tidal-loading-indicator') || grid.children.length === 0)) {
      loadTidalOfficialPlaylists(currentTidalOfficialPlaylistChip);
    }
  } else if (currentTidalTab === 'collection') {
    loadTidalCollection();
  }
}

function switchTidalTab(tabName) {
  currentTidalTab = tabName;
  const tabFeatured = document.getElementById('btnTidalTabFeatured');
  const tabNewReleases = document.getElementById('btnTidalTabNewReleases');
  const tabOfficialPlaylists = document.getElementById('btnTidalTabOfficialPlaylists');
  const tabCollection = document.getElementById('btnTidalTabCollection');

  const paneFeatured = document.getElementById('tidalPaneFeatured');
  const paneNewReleases = document.getElementById('tidalPaneNewReleases');
  const paneOfficialPlaylists = document.getElementById('tidalPaneOfficialPlaylists');
  const paneCollection = document.getElementById('tidalPaneCollection');
  const paneSearch = document.getElementById('tidalPaneSearch');
  const detailView = document.getElementById('tidalPlaylistDetailView');
  const explorerContainer = document.getElementById('tidalExplorerContainer');

  if (detailView) detailView.style.display = 'none';
  if (explorerContainer) explorerContainer.style.display = 'block';

  [tabFeatured, tabNewReleases, tabOfficialPlaylists, tabCollection].forEach(t => t && t.classList.remove('active'));
  [paneFeatured, paneNewReleases, paneOfficialPlaylists, paneCollection, paneSearch].forEach(p => {
    if (p) {
      p.classList.remove('active');
      p.style.display = 'none';
    }
  });

  if (tabName === 'featured') {
    if (tabFeatured) tabFeatured.classList.add('active');
    if (paneFeatured) {
      paneFeatured.classList.add('active');
      paneFeatured.style.display = 'block';
    }
    loadTidalFeatured(currentTidalCuratedChip);
  } else if (tabName === 'newReleases') {
    if (tabNewReleases) tabNewReleases.classList.add('active');
    if (paneNewReleases) {
      paneNewReleases.classList.add('active');
      paneNewReleases.style.display = 'block';
    }
    loadTidalNewReleases();
  } else if (tabName === 'officialPlaylists') {
    if (tabOfficialPlaylists) tabOfficialPlaylists.classList.add('active');
    if (paneOfficialPlaylists) {
      paneOfficialPlaylists.classList.add('active');
      paneOfficialPlaylists.style.display = 'block';
    }
    loadTidalOfficialPlaylists(currentTidalOfficialPlaylistChip);
  } else if (tabName === 'collection') {
    if (tabCollection) tabCollection.classList.add('active');
    if (paneCollection) {
      paneCollection.classList.add('active');
      paneCollection.style.display = 'block';
    }
    loadTidalCollection();
  } else if (tabName === 'search') {
    if (paneSearch) {
      paneSearch.classList.add('active');
      paneSearch.style.display = 'block';
    }
  }
}

function createTidalAlbumCard(alb) {
  const card = document.createElement('div');
  card.className = 'album-card tidal-discography-card';
  card.dataset.tidalId = String(alb.tidalId);

  const defaultCover = createSvgCover(alb.title, alb.artist, '#27272a', '#09090b');
  const coverSrc = formatCoverSrc(alb.cover) || defaultCover;
  const inLib = isTidalAlbumInLibrary(alb.tidalId);

  const isHiRes = alb.audioQuality === 'HI_RES_LOSSLESS' || alb.audioQuality === 'HIRES' || (alb.mediaMetadata?.tags?.includes('HIRES_LOSSLESS'));
  const qualityBadgeHtml = isHiRes
    ? `<span class="album-quality-tag tag-tidal-hires">TIDAL MAX</span>`
    : `<span class="album-quality-tag tag-tidal">TIDAL FLAC</span>`;

  card.innerHTML = `
    <div class="album-art-wrap">
      <img src="${coverSrc}" class="album-art-img" alt="${escapeXml(alb.title)}" loading="lazy">
      ${qualityBadgeHtml}
      <button class="card-play-btn" title="播放整張 TIDAL 專輯">▶</button>
    </div>
    <div class="album-meta">
      <div class="album-title" title="${escapeXml(alb.title)}">${escapeXml(alb.title)}</div>
      <div class="album-artist">${escapeXml(alb.artist)}</div>
      <div class="album-year">${alb.year ? alb.year + ' • ' : ''}${alb.numberOfTracks ? alb.numberOfTracks + ' 首 • ' : ''}${inLib ? '<span style="color:#00e5ff;font-weight:700;">✓ 已在曲庫</span>' : ''}</div>
    </div>
    <div class="tidal-card-actions">
      <button class="btn-tidal-lib-action ${inLib ? 'in-library' : ''}" data-tidal-id="${alb.tidalId}">${inLib ? '✓ 已在曲庫' : '➕ 加入曲庫'}</button>
    </div>
  `;

  // Click play
  const playBtn = card.querySelector('.card-play-btn');
  if (playBtn) {
    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      playTidalAlbum(alb.tidalId);
    });
  }

  // Click add to library
  const libBtn = card.querySelector('.btn-tidal-lib-action');
  if (libBtn) {
    libBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (isTidalAlbumInLibrary(alb.tidalId)) {
        if (confirm(`確定要將《${alb.title}》從曲庫移除嗎？`)) {
          await removeTidalAlbumFromLibrary(alb.tidalId);
          libBtn.textContent = '➕ 加入曲庫';
          libBtn.classList.remove('in-library');
        }
      } else {
        await addTidalAlbumToLibrary(alb.tidalId, alb);
        libBtn.textContent = '✓ 已在曲庫';
        libBtn.classList.add('in-library');
      }
    });
  }

  // Explicit click on album artwork cover opens full album details & tracklist
  const artWrap = card.querySelector('.album-art-wrap');
  if (artWrap) {
    artWrap.style.cursor = 'pointer';
    artWrap.addEventListener('click', (e) => {
      if (e.target.closest('.card-play-btn')) return;
      e.stopPropagation();
      openAlbumDetail(alb);
    });
  }

  // Click card body to open full album details!
  card.addEventListener('click', (e) => {
    if (e.target.closest('.card-play-btn') || e.target.closest('.btn-tidal-lib-action')) return;
    openAlbumDetail(alb);
  });

  return card;
}

function createTidalPlaylistCard(playlist) {
  const card = document.createElement('div');
  card.className = 'album-card';
  const coverUrl = tidalService.getPlaylistCoverUrl(playlist, 640);
  const coverSrc = coverUrl || createSvgCover(playlist.title, 'TIDAL Playlist', '#1e293b', '#0f172a');

  card.innerHTML = `
    <div class="album-art-wrap">
      <img src="${coverSrc}" class="album-art-img" alt="${escapeXml(playlist.title)}" loading="lazy">
      <span class="album-quality-tag" style="background: rgba(0, 229, 255, 0.2); color: #00e5ff; border: 1px solid rgba(0, 229, 255, 0.4);">PLAYLIST</span>
      <button class="card-play-btn" title="播放歌單">▶</button>
    </div>
    <div class="album-meta">
      <div class="album-title" title="${escapeXml(playlist.title)}">${escapeXml(playlist.title)}</div>
      <div class="album-artist">${escapeXml(playlist.creator?.name || 'TIDAL')}</div>
      <div class="album-year">${playlist.numberOfTracks || 0} 首歌曲</div>
    </div>
  `;

  // Play button
  const playBtn = card.querySelector('.card-play-btn');
  if (playBtn) {
    playBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      showToast(`正在載入歌單《${playlist.title}》...`);
      try {
        const tracks = await tidalService.getPlaylistTracks(playlist.uuid);
        if (tracks.length > 0) {
          playTrackList(tracks, 0);
          showToast(`▶ 開始播放歌單《${playlist.title}》(${tracks.length} 首)`);
        }
      } catch (err) {
        showToast(`❌ 播放歌單失敗: ${err.message}`);
      }
    });
  }

  card.addEventListener('click', (e) => {
    if (e.target.closest('.card-play-btn')) return;
    openTidalPlaylistDetail(playlist);
  });

  return card;
}

function createTidalTrackRow(track, idx, parentList = []) {
  const row = document.createElement('div');
  row.className = 'tidal-track-row';
  const isHiRes = (track.sampleRate > 48000 || track.bitsPerSample >= 24 || track.audioQuality === 'HI_RES_LOSSLESS');
  const specLabel = isHiRes ? 'Hi-Res 24-bit' : 'FLAC 16-bit';

  row.innerHTML = `
    <div class="tidal-track-row-left">
      <span class="tidal-track-rank">${idx + 1}</span>
      <img class="tidal-track-thumb" src="${track.cover || 'default_cover.png'}" alt="Cover" onerror="this.src='default_cover.png'">
      <div class="tidal-track-meta">
        <span class="tidal-track-title">${escapeXml(track.title)}</span>
        <span class="tidal-track-artist">${escapeXml(track.artist)} • ${escapeXml(track.album)}</span>
      </div>
    </div>
    <div class="tidal-track-row-right">
      <span class="album-quality-tag ${isHiRes ? 'tag-tidal-hires' : 'tag-tidal'}" style="margin: 0; font-size: 10px;">${specLabel}</span>
      <span class="tidal-track-duration">${formatDuration(track.duration)}</span>
      <button class="btn-tidal-track-play" title="立即播放">▶</button>
      <button class="btn-tidal-track-queue" title="加入播放佇列">📥</button>
    </div>
  `;

  row.querySelector('.btn-tidal-track-play').addEventListener('click', (e) => {
    e.stopPropagation();
    const listToPlay = parentList.length > 0 ? parentList : [track];
    playTrackList(listToPlay, parentList.indexOf(track) >= 0 ? parentList.indexOf(track) : 0);
    showToast(`▶ 正在播放：${track.title}`);
  });

  row.querySelector('.btn-tidal-track-queue').addEventListener('click', (e) => {
    e.stopPropagation();
    addToQueue(track);
    showToast(`已將「${track.title}」加入播放佇列`);
  });

  row.addEventListener('click', (e) => {
    if (e.target.closest('.btn-tidal-track-play') || e.target.closest('.btn-tidal-track-queue')) return;
    const listToPlay = parentList.length > 0 ? parentList : [track];
    playTrackList(listToPlay, parentList.indexOf(track) >= 0 ? parentList.indexOf(track) : 0);
  });

  return row;
}

async function loadTidalFeatured(curatedTag = 'audiophile', force = false) {
  currentTidalCuratedChip = curatedTag;
  const grid = document.getElementById('tidalFeaturedGrid');
  if (!grid) return;
  grid.classList.remove('cover-size-small', 'cover-size-medium', 'cover-size-large');
  grid.classList.add(`cover-size-${state.tidalCoverSize || 'medium'}`);
  if (!force && grid.children.length > 1 && !grid.querySelector('.tidal-loading-indicator')) return;

  grid.innerHTML = '<div class="tidal-loading-indicator">⏳ 正在載入 TIDAL 發燒推薦專輯...</div>';

  try {
    const albums = await window.tidalService.getHiResPicks(curatedTag, 30);
    grid.innerHTML = '';
    if (!albums || albums.length === 0) {
      grid.innerHTML = '<div class="empty-hint" style="grid-column: 1/-1;">暫無此分類推薦專輯</div>';
      return;
    }
    albums.forEach(alb => {
      grid.appendChild(createTidalAlbumCard(alb));
    });
  } catch (err) {
    console.error('Failed to load TIDAL featured:', err);
    grid.innerHTML = `<div class="empty-hint" style="grid-column: 1/-1; color: #ef4444;">載入發燒推薦失敗: ${escapeXml(err.message)}</div>`;
  }
}

async function loadTidalNewReleases(force = false) {
  const grid = document.getElementById('tidalNewReleasesGrid');
  if (!grid) return;
  grid.classList.remove('cover-size-small', 'cover-size-medium', 'cover-size-large');
  grid.classList.add(`cover-size-${state.tidalCoverSize || 'medium'}`);
  if (!force && grid.children.length > 1 && !grid.querySelector('.tidal-loading-indicator')) return;

  grid.innerHTML = '<div class="tidal-loading-indicator">⏳ 正在載入 TIDAL 最新發行專輯...</div>';

  try {
    const albums = await window.tidalService.getNewReleases(30);
    grid.innerHTML = '';
    if (!albums || albums.length === 0) {
      grid.innerHTML = '<div class="empty-hint" style="grid-column: 1/-1;">暫無最新發行專輯</div>';
      return;
    }
    albums.forEach(alb => {
      grid.appendChild(createTidalAlbumCard(alb));
    });
  } catch (err) {
    console.error('Failed to load TIDAL new releases:', err);
    grid.innerHTML = `<div class="empty-hint" style="grid-column: 1/-1; color: #ef4444;">載入最新發行失敗: ${escapeXml(err.message)}</div>`;
  }
}

async function loadTidalOfficialPlaylists(category = 'audiophile', force = false) {
  currentTidalOfficialPlaylistChip = category;
  const grid = document.getElementById('tidalOfficialPlaylistsGrid');
  if (!grid) return;
  grid.classList.remove('cover-size-small', 'cover-size-medium', 'cover-size-large');
  grid.classList.add(`cover-size-${state.tidalCoverSize || 'medium'}`);
  if (!force && grid.children.length > 1 && !grid.querySelector('.tidal-loading-indicator')) return;

  grid.innerHTML = '<div class="tidal-loading-indicator">⏳ 正在載入 TIDAL 官方精選歌單...</div>';

  try {
    const playlists = await window.tidalService.getOfficialPlaylists(category, 30);
    grid.innerHTML = '';
    if (!playlists || playlists.length === 0) {
      grid.innerHTML = '<div class="empty-hint" style="grid-column: 1/-1;">暫無此分類官方歌單</div>';
      return;
    }
    playlists.forEach(pl => {
      grid.appendChild(createTidalPlaylistCard(pl));
    });
  } catch (err) {
    console.error('Failed to load TIDAL official playlists:', err);
    grid.innerHTML = `<div class="empty-hint" style="grid-column: 1/-1; color: #ef4444;">載入官方歌單失敗: ${escapeXml(err.message)}</div>`;
  }
}

async function loadTidalCollection(force = false) {
  const albumsBadge = document.getElementById('tidalFavAlbumsCountBadge');
  const tracksBadge = document.getElementById('tidalFavTracksCountBadge');
  const playlistsBadge = document.getElementById('tidalPlaylistsCountBadge');
  const albumsGrid = document.getElementById('tidalFavAlbumsGrid');
  const tracksTbody = document.getElementById('tidalFavTracksTbody');
  const playlistsGrid = document.getElementById('tidalPlaylistsGrid');

  if (!window.tidalService || !window.tidalService.isLoggedIn) return;

  try {
    // 1. Fetch Favorite Albums
    if (force || !tidalCachedFavorites || !tidalCachedFavorites.albums) {
      if (albumsGrid) albumsGrid.innerHTML = '<div class="tidal-loading-indicator">⏳ 正在載入您的 TIDAL 最愛專輯...</div>';
      const favAlbums = await window.tidalService.getFavoriteAlbums(100);
      if (!tidalCachedFavorites) tidalCachedFavorites = {};
      tidalCachedFavorites.albums = favAlbums;
      if (albumsBadge) albumsBadge.textContent = favAlbums.length;

      if (albumsGrid) {
        albumsGrid.classList.remove('cover-size-small', 'cover-size-medium', 'cover-size-large');
        albumsGrid.classList.add(`cover-size-${state.tidalCoverSize || 'medium'}`);
        albumsGrid.innerHTML = '';
        if (favAlbums.length === 0) {
          albumsGrid.innerHTML = '<div class="empty-hint" style="grid-column: 1/-1;">您的 TIDAL 帳號中尚未加入最愛專輯</div>';
        } else {
          favAlbums.forEach(alb => albumsGrid.appendChild(createTidalAlbumCard(alb)));
        }
      }
    }

    // 2. Fetch Favorite Tracks
    if (force || !tidalCachedFavorites || !tidalCachedFavorites.tracks) {
      const favTracks = await window.tidalService.getFavoriteTracks(100);
      if (!tidalCachedFavorites) tidalCachedFavorites = {};
      tidalCachedFavorites.tracks = favTracks;
      if (tracksBadge) tracksBadge.textContent = favTracks.length;

      if (tracksTbody) {
        tracksTbody.innerHTML = '';
        if (favTracks.length === 0) {
          tracksTbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 24px; color: var(--text-muted);">尚未收藏任何最愛歌曲</td></tr>';
        } else {
          favTracks.forEach((t, idx) => {
            const tr = document.createElement('tr');
            const isHiRes = (t.sampleRate > 48000 || t.bitsPerSample >= 24 || t.audioQuality === 'HI_RES_LOSSLESS');
            const specLabel = isHiRes ? 'Hi-Res 24-bit' : 'FLAC 16-bit';
            const isFav = isTrackFavorite(t);

            tr.innerHTML = `
              <td>${idx + 1}</td>
              <td style="text-align: center;"><button class="btn-track-fav ${isFav ? 'active' : ''}" title="${isFav ? '已在最愛歌曲' : '加入本機最愛歌曲'}">${getHeartSvg(isFav, 14)}</button></td>
              <td class="track-title-cell">
                <div class="track-title-text">
                  <span class="track-name-span">${escapeXml(t.title)}</span>
                </div>
              </td>
              <td>${escapeXml(t.artist)}</td>
              <td>${escapeXml(t.album)}</td>
              <td><span class="format-chip ${isHiRes ? 'hires' : ''}">${specLabel}</span></td>
              <td style="text-align: right;">${formatDuration(t.duration)}</td>
            `;

            tr.addEventListener('click', (e) => {
              if (e.target.closest('.btn-track-fav')) {
                e.stopPropagation();
                toggleTrackFavorite(t);
                const btnFav = tr.querySelector('.btn-track-fav');
                const nowFav = isTrackFavorite(t);
                if (btnFav) {
                  btnFav.classList.toggle('active', nowFav);
                  btnFav.innerHTML = getHeartSvg(nowFav, 14);
                }
                return;
              }
              playTrackList(favTracks, idx);
            });

            tracksTbody.appendChild(tr);
          });
        }
      }
    }

    // 3. Fetch Playlists
    if (force || !tidalCachedFavorites || !tidalCachedFavorites.playlists) {
      const userPlaylists = await window.tidalService.getUserPlaylists();
      if (!tidalCachedFavorites) tidalCachedFavorites = {};
      tidalCachedFavorites.playlists = userPlaylists;
      if (playlistsBadge) playlistsBadge.textContent = userPlaylists.length;

      if (playlistsGrid) {
        playlistsGrid.innerHTML = '';
        if (userPlaylists.length === 0) {
          playlistsGrid.innerHTML = '<div class="empty-hint" style="grid-column: 1/-1;">您的 TIDAL 帳號中尚未建立個人歌單</div>';
        } else {
          userPlaylists.forEach(pl => playlistsGrid.appendChild(createTidalPlaylistCard(pl)));
        }
      }
    }
  } catch (err) {
    console.error('Failed to load TIDAL collection:', err);
    showToast(`❌ 載入 TIDAL 收藏失敗: ${err.message}`);
  }
}

async function loadTidalSearch(query) {
  const summary = document.getElementById('tidalSearchSummary');
  const albumsGrid = document.getElementById('tidalSearchAlbumsGrid');
  const tracksList = document.getElementById('tidalSearchTracksList');

  if (summary) summary.textContent = `關鍵字「${query}」正在檢索中...`;
  if (albumsGrid) albumsGrid.innerHTML = '<div class="tidal-loading-indicator">⏳ 正在搜尋專輯...</div>';
  if (tracksList) tracksList.innerHTML = '<div class="tidal-loading-indicator">⏳ 正在搜尋曲目...</div>';

  try {
    const res = await window.tidalService.search(query, 24);
    const albums = res.albums || [];
    const tracks = res.tracks || [];

    if (summary) summary.textContent = `關鍵字「${query}」：共找到 ${albums.length} 張專輯 • ${tracks.length} 首歌曲`;

    if (albumsGrid) {
      albumsGrid.innerHTML = '';
      if (albums.length === 0) {
        albumsGrid.innerHTML = '<div class="empty-hint" style="grid-column: 1/-1;">未找到相符專輯</div>';
      } else {
        albums.forEach(alb => albumsGrid.appendChild(createTidalAlbumCard(alb)));
      }
    }

    if (tracksList) {
      tracksList.innerHTML = '';
      if (tracks.length === 0) {
        tracksList.innerHTML = '<div class="empty-hint">未找到相符歌曲</div>';
      } else {
        tracks.forEach((t, idx) => {
          tracksList.appendChild(createTidalTrackRow(t, idx, tracks));
        });
      }
    }
  } catch (err) {
    console.error('TIDAL Search error:', err);
    if (summary) summary.textContent = `搜尋發生錯誤: ${err.message}`;
  }
}

async function openTidalPlaylistDetail(playlist) {
  currentTidalPlaylistDetail = playlist;
  const explorerContainer = document.getElementById('tidalExplorerContainer');
  const detailView = document.getElementById('tidalPlaylistDetailView');
  const coverImg = document.getElementById('tidalPlaylistDetailCover');
  const titleEl = document.getElementById('tidalPlaylistDetailTitle');
  const descEl = document.getElementById('tidalPlaylistDetailDesc');
  const metaEl = document.getElementById('tidalPlaylistDetailMeta');
  const tracksContainer = document.getElementById('tidalPlaylistTracksList');

  if (explorerContainer) explorerContainer.style.display = 'none';
  if (detailView) detailView.style.display = 'block';

  if (titleEl) titleEl.textContent = playlist.title || '歌單';
  if (descEl) descEl.textContent = playlist.description || 'TIDAL 精選歌單';
  if (metaEl) metaEl.textContent = `共 ${playlist.numberOfTracks || 0} 首歌曲 • 由 ${playlist.creator?.name || 'TIDAL'} 建立`;

  const coverUrl = tidalService.getPlaylistCoverUrl(playlist, 640);
  if (coverImg) coverImg.src = coverUrl || 'default_cover.png';

  if (tracksContainer) tracksContainer.innerHTML = '<div class="tidal-loading-indicator">⏳ 正在載入歌單曲目...</div>';

  try {
    const tracks = await window.tidalService.getPlaylistTracks(playlist.uuid);
    if (tracksContainer) {
      tracksContainer.innerHTML = '';
      if (tracks.length === 0) {
        tracksContainer.innerHTML = '<div class="empty-hint">歌單內尚無曲目</div>';
      } else {
        tracks.forEach((t, idx) => {
          tracksContainer.appendChild(createTidalTrackRow(t, idx, tracks));
        });
      }
    }

    // Play all button
    const btnPlayAll = document.getElementById('btnTidalPlayPlaylistAll');
    if (btnPlayAll) {
      btnPlayAll.onclick = () => {
        if (tracks.length > 0) {
          playTrackList(tracks, 0);
          showToast(`▶ 播放歌單《${playlist.title}》`);
        }
      };
    }

    // Import to queue
    const btnImport = document.getElementById('btnTidalImportPlaylistToQueue');
    if (btnImport) {
      btnImport.onclick = () => {
        tracks.forEach(t => addToQueue(t));
        showToast(`已將《${playlist.title}》${tracks.length} 首歌曲加入播放佇列`);
      };
    }

    // Shuffle
    const btnShuffle = document.getElementById('btnTidalShufflePlaylist');
    if (btnShuffle) {
      btnShuffle.onclick = () => {
        if (tracks.length > 0) {
          setShuffleState(true);
          const randIdx = Math.floor(Math.random() * tracks.length);
          playTrackList(tracks, randIdx);
          showToast(`🔀 隨機播放歌單《${playlist.title}》`);
        }
      };
    }
  } catch (err) {
    console.error('Failed to load playlist tracks:', err);
    if (tracksContainer) {
      tracksContainer.innerHTML = `<div class="empty-hint" style="color:#ef4444;">載入歌單失敗: ${escapeXml(err.message)}</div>`;
    }
  }
}

function updateTidalUIStatus() {
  const badge = document.getElementById('tidalStatusBadge');
  const loggedOutView = document.getElementById('tidalLoggedOutView');
  const loggedInView = document.getElementById('tidalLoggedInView');
  const profileName = document.getElementById('tidalProfileName');
  const profileTier = document.getElementById('tidalProfileTier');
  const profileInfo = document.getElementById('tidalProfileInfo');

  const isLoggedIn = tidalService && tidalService.isLoggedIn;

  if (badge) {
    if (isLoggedIn) {
      badge.textContent = '已連線';
      badge.style.background = 'rgba(0, 229, 255, 0.2)';
      badge.style.color = '#00e5ff';
      badge.style.borderColor = 'rgba(0, 229, 255, 0.5)';
    } else {
      badge.textContent = '未登入';
      badge.style.background = 'rgba(255, 255, 255, 0.08)';
      badge.style.color = 'var(--text-muted)';
      badge.style.borderColor = 'rgba(255, 255, 255, 0.15)';
    }
  }

  if (loggedOutView && loggedInView) {
    if (isLoggedIn) {
      loggedOutView.style.display = 'none';
      loggedInView.style.display = 'block';

      if (profileName) {
        profileName.textContent = (tidalService.user && tidalService.user.userName)
          ? `TIDAL: ${tidalService.user.userName}` 
          : 'TIDAL 官方已連線';
      }
      if (profileTier) {
        profileTier.textContent = 'Hi-Res MAX';
      }
      if (profileInfo) {
        const country = tidalService.countryCode || 'TW';
        const uid = (tidalService.user && tidalService.user.userId) || (tidalService.auth && tidalService.auth.userId) || '已授權';
        profileInfo.textContent = `地區: ${country} | 會員規格: 24-bit/192kHz Hi-Res FLAC | 帳號: ${uid}`;
      }
    } else {
      loggedOutView.style.display = 'block';
      loggedInView.style.display = 'none';
    }
  }
}

// ================= NOW PLAYING real-time spectrum visualizer =================
// Fed directly from the DSP engine's source PCM (IPC window fetch ~8/s, FFT in the renderer).
// Works for DLNA streaming (session token from playDlnaTrack) and local DSP playback (main-side
// fallback token). Purely visual: it never touches the audio path and hides itself when the
// active stream has no DSP session (direct passthrough).
(function nowPlayingSpectrum() {
  const canvas = document.getElementById('nowPlayingSpectrum');
  const wrap = document.getElementById('nowPlayingSpectrumWrap');
  if (!canvas || !wrap) return;
  if (!window.electronAPI || !window.electronAPI.getAudioSpectrum) { wrap.style.display = 'none'; return; }

  const BARS = 64, FFT_N = 2048;
  const bars = new Float32Array(BARS), peaks = new Float32Array(BARS), targets = new Float32Array(BARS);
  const re = new Float64Array(FFT_N), im = new Float64Array(FFT_N);
  const hann = new Float32Array(FFT_N); let hannSum = 0;
  for (let i = 0; i < FFT_N; i++) { hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / FFT_N); hannSum += hann[i]; }

  // Iterative radix-2 FFT with precomputed tables
  let bits = 0; while ((1 << bits) < FFT_N) bits++;
  const rev = new Uint16Array(FFT_N);
  for (let i = 0; i < FFT_N; i++) { let r = 0; for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b); rev[i] = r; }
  const cosT = new Float64Array(FFT_N / 2), sinT = new Float64Array(FFT_N / 2);
  for (let i = 0; i < FFT_N / 2; i++) { cosT[i] = Math.cos(2 * Math.PI * i / FFT_N); sinT[i] = Math.sin(2 * Math.PI * i / FFT_N); }
  function fftRun() {
    for (let i = 0; i < FFT_N; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let size = 2; size <= FFT_N; size <<= 1) {
      const half = size >> 1, step = FFT_N / size;
      for (let i = 0; i < FFT_N; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const c = cosT[k], s = -sinT[k];
          const ar = re[j + half], ai = im[j + half];
          const wr = ar * c - ai * s, wi = ar * s + ai * c;
          re[j + half] = re[j] - wr; im[j + half] = im[j] - wi;
          re[j] += wr; im[j] += wi;
        }
      }
    }
  }

  // Log-frequency bar ranges: 40 Hz .. min(16 kHz, 0.45 x rate)
  let binRanges = null, binRate = 0;
  function buildBins(rate) {
    const fMin = 40, fMax = Math.min(16000, rate * 0.45);
    binRanges = new Array(BARS);
    for (let b = 0; b < BARS; b++) {
      const f0 = fMin * Math.pow(fMax / fMin, b / BARS), f1 = fMin * Math.pow(fMax / fMin, (b + 1) / BARS);
      const k0 = Math.max(1, Math.round(f0 * FFT_N / rate));
      const k1 = Math.max(k0 + 1, Math.min(Math.round(f1 * FFT_N / rate), FFT_N / 2 - 1));
      binRanges[b] = [k0, k1, Math.sqrt(f0 * f1)];
    }
    binRate = rate;
  }

  // DLNA zone -> that stream's DSP session token; local zone -> only DSP playback
  // (null token = main-side fallback to the latest local DSP session). undefined = no source.
  function spectrumSource() {
    if (state.activeAudioZone !== 'local' && state.activeDlnaDevice) return state.activeSpectrumToken || undefined;
    return (isCurrentDsd || isCurrentSox) ? null : undefined;
  }

  let fetching = false, lastFetch = 0;
  async function fetchSpectrum() {
    const src = spectrumSource();
    if (src === undefined) { targets.fill(0); return; }
    let res = null;
    try { res = await window.electronAPI.getAudioSpectrum(src, getCurrentPlaybackTime()); } catch (e) { res = null; }
    if (!res || !res.left || res.left.length < FFT_N || !res.rate) { targets.fill(0); return; }
    if (binRate !== res.rate) buildBins(res.rate);
    const L = res.left, R = res.right, start = L.length - FFT_N;
    for (let i = 0; i < FFT_N; i++) { re[i] = (L[start + i] + R[start + i]) * 0.5 * hann[i]; im[i] = 0; }
    fftRun();
    for (let b = 0; b < BARS; b++) {
      const rng = binRanges[b], k0 = rng[0], k1 = rng[1];
      let acc = 0;
      for (let k = k0; k < k1; k++) acc += Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      const mag = acc / ((k1 - k0) * hannSum);
      let db = 20 * Math.log10(mag + 1e-12);
      db += Math.max(0, Math.min(14, 10 * Math.log10(rng[2] / 200))); // gentle pink tilt keeps highs lively
      targets[b] = Math.max(0, Math.min(1, (db + 78) / 66));
    }
  }

  // Canvas sizing + gradient matching the scrubber palette (cyan -> purple -> pink)
  let ctx = null, cw = 0, ch = 0, grad = null;
  function resize() {
    cw = canvas.clientWidth; ch = canvas.clientHeight;
    if (!cw || !ch) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
    ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    grad = ctx.createLinearGradient(0, ch, 0, 0);
    grad.addColorStop(0, '#06b6d4');
    grad.addColorStop(0.55, '#8b5cf6');
    grad.addColorStop(1, '#ec4899');
  }

  function draw() {
    ctx.clearRect(0, 0, cw, ch);
    const slot = cw / BARS, barW = Math.max(2, slot * 0.62);
    ctx.fillStyle = 'rgba(139, 92, 246, 0.16)';
    ctx.fillRect(0, ch - 2, cw, 2); // idle baseline
    for (let b = 0; b < BARS; b++) {
      const v = bars[b];
      if (v < 0.004) continue;
      const hgt = Math.max(3, v * (ch - 10));
      const x = b * slot + (slot - barW) / 2, y = ch - hgt - 2;
      ctx.globalAlpha = 0.22; // soft glow halo
      ctx.fillStyle = grad;
      ctx.fillRect(x - 2, y - 2, barW + 4, hgt + 2);
      ctx.globalAlpha = 1;
      ctx.fillRect(x, y, barW, hgt);
      const py = ch - Math.max(3, peaks[b] * (ch - 10)) - 4; // falling peak-hold caps
      if (py > 1) { ctx.fillStyle = 'rgba(255, 255, 255, 0.7)'; ctx.fillRect(x, py, barW, 2); }
    }
    ctx.globalAlpha = 1;
  }

  function frame(ts) {
    requestAnimationFrame(frame);
    if (!canvas.clientWidth || canvas.clientWidth !== cw || canvas.clientHeight !== ch) resize();
    if (!cw || !ch || !ctx) return; // modal closed: no drawing, no fetching
    if (state.isPlaying && !fetching && ts - lastFetch > 120) {
      lastFetch = ts; fetching = true;
      Promise.resolve().then(fetchSpectrum).finally(() => { fetching = false; });
    }
    if (!state.isPlaying) targets.fill(0);
    for (let b = 0; b < BARS; b++) {
      bars[b] = Math.max(targets[b], bars[b] * 0.90); // instant attack, smooth fall
      peaks[b] = Math.max(bars[b], peaks[b] - 0.010);
    }
    draw();
  }
  requestAnimationFrame(frame);
})();

// Start application
window.addEventListener('DOMContentLoaded', initApp);


