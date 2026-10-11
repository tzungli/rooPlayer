// ==========================================
// rooPlayer - Audiophile Music Media Manager
// ==========================================

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
  volume: 0.8,
  theme: 'dark',
  currentView: 'overview',
  activeAlbumDetail: null,
  currentArtistDetail: null,
  activeGenreFilter: null,
  recentlyPlayedAlbums: [],
  activeFilter: 'all',
  sortBy: 'title',
  trackSortBy: 'default',
  history: ['overview'],
  historyIndex: 0,
  activeAudioZone: 'local',
  activeDlnaDevice: null,
  availableDevices: [],
  dlnaCurrentSec: 0,
  dlnaTotalSec: 0,
  favorites: {
    albums: [],
    tracks: [],
    artists: []
  },
  albumCoverSize: localStorage.getItem('rooplayer_album_cover_size') || 'medium',
  detailCoverSize: localStorage.getItem('rooplayer_detail_cover_size') || 'medium',
  dsp: (() => {
    try {
      const saved = JSON.parse(localStorage.getItem('rooplayer_dsp_settings') || '{}');
      return {
        enabled: saved.enabled === true,
        rateMode: saved.rateMode || '4x',
        precision: saved.precision || 24
      };
    } catch (e) {
      return { enabled: false, rateMode: '4x', precision: 24 };
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
const overviewArtistsGrid = document.getElementById('overviewArtistsGrid');
const allAlbumsGrid = document.getElementById('allAlbumsGrid');
const artistsGrid = document.getElementById('artistsGrid');
const allTracksTbody = document.getElementById('allTracksTbody');
const genresGrid = document.getElementById('genresGrid');

// Player DOM
const playerCoverImg = document.getElementById('playerCoverImg');
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
const detailYear = document.getElementById('detailYear');
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

// Storage / Scanner DOM
const btnSelectFolder = document.getElementById('btnSelectFolder');
const scanProgressBox = document.getElementById('scanProgressBox');
const scanProgressBar = document.getElementById('scanProgressBar');
const scanStatusLabel = document.getElementById('scanStatusLabel');
const scanPercentLabel = document.getElementById('scanPercentLabel');
const scanCurrentFile = document.getElementById('scanCurrentFile');
const scannedFoldersList = document.getElementById('scannedFoldersList');

// ----------------- Initialization -----------------
async function initApp() {
  initTheme();
  initFavorites();
  setupWindowControls();
  setupNavigation();
  setupPlayerControls();
  setupScannerEvents();
  setupFavoritesEvents();
  setupSearch();
  setupCoverSizeControls();
  initAudioZones();
  initDspControls();
  initKkboxStreaming();

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

  // Set initial default volume
  nativeAudio.volume = state.volume;

  // Initialize playback control button states
  updateShuffleUI();
  updateRepeatUI();
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

// ----------------- Play Count Tracker -----------------
function getPlayStats() {
  try {
    const raw = localStorage.getItem('rooplayer_play_stats');
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return { albums: {}, tracks: {} };
}

function savePlayStats(stats) {
  try {
    localStorage.setItem('rooplayer_play_stats', JSON.stringify(stats));
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
      playerHeartBtn.textContent = isFav ? '♥' : '♡';
      playerHeartBtn.title = isFav ? '從最愛歌曲移除' : '加入最愛歌曲';
    }
  }

  // If album detail modal is open
  if (state.activeAlbumDetail) {
    const btnFavAlbum = document.getElementById('btnFavAlbumDetail');
    if (btnFavAlbum) {
      const isFav = isAlbumFavorite(state.activeAlbumDetail);
      btnFavAlbum.classList.toggle('active', isFav);
      btnFavAlbum.textContent = isFav ? '♥ 已在最愛專輯' : '♡ 加入最愛專輯';
    }
  }

  // If artist detail view is open
  if (state.currentArtistDetail) {
    const btnFavArtist = document.getElementById('btnFavArtistDetail');
    if (btnFavArtist) {
      const isFav = isArtistFavorite(state.currentArtistDetail);
      btnFavArtist.classList.toggle('active', isFav);
      btnFavArtist.textContent = isFav ? '⭐ 已在最愛演出者' : '☆ 加入最愛演出者';
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
        favBtn.textContent = isFav ? '♥' : '♡';
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
        favBtn.title = isFav ? '取消最愛演出者' : '加入最愛演出者';
      }
    }
  });

  // Re-sync all visible track table rows heart buttons
  document.querySelectorAll('tr').forEach(tr => {
    const favBtn = tr.querySelector('.btn-track-fav');
    if (favBtn) {
      const titleCell = tr.querySelector('.track-title-cell');
      if (titleCell) {
        const title = titleCell.textContent;
        const matchingTrack = state.tracks.find(t => t.title === title);
        if (matchingTrack) {
          const isFav = isTrackFavorite(matchingTrack);
          favBtn.classList.toggle('active', isFav);
          favBtn.textContent = isFav ? '♥' : '♡';
          favBtn.title = isFav ? '取消最愛歌曲' : '加入最愛歌曲';
        }
      }
    }
  });
}

// Smart Genre Inference & Matching Engine
function inferGenreFromTrack(track) {
  if (track.genre && track.genre !== 'Unknown') return track.genre;
  const text = [(track.genre || ''), (track.album || ''), (track.artist || ''), (track.filePath || '')].join(' ').toLowerCase();

  if (/classi|orchestr|symphon|baroque|opera|chamber|philharmonic|concerto|piano|beethoven|bach|mozart|chopin|tchaikovsky|orff|brahms|handel|vivaldi|古典|交響|協奏|獨奏|管弦|鋼琴曲|樂團|愛樂/i.test(text)) {
    return 'Classical';
  }
  if (/jazz|fusion|swing|bop|bebop|big band|dixieland|smooth jazz|bossa|miles davis|coltrane|chesky|爵士|巴薩諾瓦/i.test(text)) {
    return 'Jazz';
  }
  if (/metal|heavy metal|thrash|death metal|black metal|doom|power metal|金屬/i.test(text)) {
    return 'Metal';
  }
  if (/rock|punk|grunge|alternative|hard rock|psychedelic|prog rock|搖滾/i.test(text)) {
    return 'Rock';
  }
  if (/folk|acoustic|country|bluegrass|singer-songwriter|民謠|民歌|民樂/i.test(text)) {
    return 'Folk';
  }
  if (/soundtrack|ost|film score|movie score|original score|game score|原聲|配樂/i.test(text)) {
    return 'Soundtrack';
  }
  if (/ambient|new age|meditation|drone|relax|atmospheric|enya|氛圍|新世紀|冥想/i.test(text)) {
    return 'Ambient';
  }
  if (/vocal|singer|choral|acappella|fujita|人聲|美聲|聲樂|演唱|女聲|男聲/i.test(text)) {
    return 'Vocal';
  }
  if (/audiophile|hi-end|hifi|burmester|b&w|示範片|展cd|音響展|發燒/i.test(text)) {
    return 'Audiophile';
  }
  if (/soul|r&b|rnb|rhythm and blues|motown|funk|neo-soul|靈魂樂/i.test(text)) {
    return 'Soul / R&B';
  }
  if (/blues|chicago blues|delta blues|bb king|藍調/i.test(text)) {
    return 'Blues';
  }
  if (/hip.?hop|rap|trap|boom bap|嘻哈|饒舌/i.test(text)) {
    return 'Hip Hop';
  }
  if (/electro|techno|house|trance|synth|edm|downtempo|chillout|電子/i.test(text)) {
    return 'Electronic';
  }
  if (/pop|synthpop|dance|disco|ballad|cantopop|mandopop|c-pop|j-pop|k-pop|流行|華語/i.test(text)) {
    return 'Pop';
  }
  return 'Audiophile';
}

function matchItemGenre(item, genreName) {
  if (!item || !genreName) return false;
  const target = genreName.toLowerCase().trim();
  const itemGenre = (item.genre || '').toLowerCase().trim();
  const text = [(item.genre || ''), (item.title || ''), (item.album || ''), (item.artist || ''), (item.filePath || '')].join(' ').toLowerCase();

  // 1. Direct substring match
  if (itemGenre && (itemGenre.includes(target) || target.includes(itemGenre))) return true;

  // 2. Pillar keyword rules
  if (/classi|古典/i.test(target)) {
    return /classi|orchestr|symphon|baroque|opera|chamber|philharmonic|concerto|piano|beethoven|bach|mozart|chopin|tchaikovsky|orff|brahms|handel|vivaldi|古典|交響|協奏|獨奏|管弦|鋼琴曲|樂團|愛樂/i.test(text);
  }
  if (/jazz|爵士/i.test(target)) {
    return /jazz|fusion|swing|bop|bebop|big band|dixieland|smooth jazz|bossa|miles davis|coltrane|chesky|爵士|巴薩諾瓦/i.test(text);
  }
  if (/metal|金屬/i.test(target)) {
    return /metal|heavy metal|thrash|death metal|black metal|doom|power metal|金屬/i.test(text);
  }
  if (/rock|搖滾/i.test(target)) {
    return /rock|punk|grunge|alternative|hard rock|psychedelic|prog rock|搖滾/i.test(text);
  }
  if (/soul|r&b|靈魂/i.test(target)) {
    return /soul|r&b|rnb|rhythm and blues|motown|funk|neo-soul|靈魂樂/i.test(text);
  }
  if (/blues|藍調/i.test(target)) {
    return /blues|chicago blues|delta blues|bb king|藍調/i.test(text);
  }
  if (/folk|民謠|民歌/i.test(target)) {
    return /folk|acoustic|country|bluegrass|singer-songwriter|民謠|民歌|民樂/i.test(text);
  }
  if (/soundtrack|ost|原聲|配樂/i.test(target)) {
    return /soundtrack|ost|film score|movie score|original score|game score|原聲|配樂/i.test(text);
  }
  if (/ambient|氛圍|新世紀/i.test(target)) {
    return /ambient|new age|meditation|drone|relax|atmospheric|enya|氛圍|新世紀|冥想/i.test(text);
  }
  if (/vocal|人聲|發燒/i.test(target)) {
    return /vocal|singer|choral|acappella|fujita|人聲|美聲|聲樂|演唱|女聲|男聲|發燒/i.test(text);
  }
  if (/audiophile|hi-fi|hi-end/i.test(target)) {
    return /audiophile|hi-end|hifi|burmester|b&w|示範片|展cd|音響展|發燒/i.test(text);
  }
  if (/hip.?hop|嘻哈|饒舌/i.test(target)) {
    return /hip.?hop|rap|trap|boom bap|嘻哈|饒舌/i.test(text);
  }
  if (/electr|電子/i.test(target)) {
    return /electro|techno|house|trance|synth|edm|downtempo|chillout|電子/i.test(text);
  }
  if (/pop|流行/i.test(target)) {
    return /pop|synthpop|dance|disco|ballad|cantopop|mandopop|c-pop|j-pop|k-pop|流行|華語/i.test(text);
  }

  // 3. Token-based word match
  const tokens = target.split(/[\s\/\,\&]+/).filter(Boolean);
  return tokens.some(tok => tok.length >= 2 && text.includes(tok));
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

    // If track genre is missing or unknown, infer it intelligently
    if (!t.genre || t.genre === 'Unknown') {
      t.genre = inferGenreFromTrack(t);
    }

    // Albums grouping
    const albumKey = `${t.album}___${t.artist}`;
    if (!albumMap.has(albumKey)) {
      albumMap.set(albumKey, {
        id: albumKey,
        title: t.album,
        artist: t.artist,
        year: t.year,
        date: t.date || null,
        genre: t.genre,
        cover: t.cover,
        isLossless: t.isLossless,
        formatName: t.formatName,
        sampleRate: t.sampleRate,
        bitsPerSample: t.bitsPerSample,
        label: t.label || null,
        producer: t.producer || null,
        composer: t.composer || null,
        copyright: t.copyright || null,
        tracks: []
      });
    }
    const alb = albumMap.get(albumKey);
    alb.tracks.push(t);
    if (!alb.cover && t.cover) alb.cover = t.cover;
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
    if (t.genre && t.genre !== 'Unknown') {
      t.genre.split(',').forEach(g => {
        const trimmed = g.trim();
        if (trimmed) genreSet.add(trimmed);
      });
    }
  });

  // Post-process albums: inherit cover from any child track, sort tracks
  albumMap.forEach(alb => {
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
      if (childWithCover) alb.cover = childWithCover.cover;
    }
    if (!alb.genre || alb.genre === 'Unknown') {
      const childWithGenre = alb.tracks.find(tr => tr.genre && tr.genre !== 'Unknown');
      if (childWithGenre) {
        alb.genre = childWithGenre.genre;
      } else {
        alb.genre = inferGenreFromTrack({ album: alb.title, artist: alb.artist, filePath: alb.tracks[0]?.filePath });
      }
    }
    alb.tracks.sort((a, b) => (a.trackNumber || 0) - (b.trackNumber || 0));
  });

  state.albums = Array.from(albumMap.values());
  state.artists = Array.from(artistMap.values());
  state.genres = Array.from(genreSet);

  // Trigger background online resolution for any remaining unknown album artists
  setTimeout(() => autoResolveUnknownAlbumArtists(), 1000);
}

// ----------------- UI Rendering -----------------
function renderAll() {
  updateBadgesAndStats();
  renderOverview();
  renderAlbums();
  renderArtists();
  renderTracks();
  renderGenres();
  renderFolders();
  renderFavAlbums();
  renderFavTracks();
  renderFavArtists();
}

function updateBadgesAndStats() {
  const totalAlbums = state.albums.length;
  const totalTracks = state.tracks.length;
  const totalArtists = state.artists.length;
  const hiresCount = state.tracks.filter(t => (t.bitsPerSample >= 24) || (t.sampleRate > 48000)).length;

  document.getElementById('albumCountBadge').textContent = totalAlbums;
  document.getElementById('artistCountBadge').textContent = totalArtists;
  document.getElementById('trackCountBadge').textContent = totalTracks;

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

  document.getElementById('albumsHeaderCount').textContent = `共 ${totalAlbums} 張專輯`;
  document.getElementById('artistsHeaderCount').textContent = `共 ${totalArtists} 位演出者`;
  document.getElementById('tracksHeaderCount').textContent = `共 ${totalTracks} 首曲目`;
}

// Render Overview
function renderOverview() {
  overviewGrid.innerHTML = '';
  // Show up to 8 albums
  const featured = state.albums.slice(0, 8);
  featured.forEach(alb => {
    overviewGrid.appendChild(createAlbumCard(alb));
  });

  // Featured Artists in Overview
  if (overviewArtistsGrid) {
    overviewArtistsGrid.innerHTML = '';
    const featuredArtists = state.artists.slice(0, 6);
    featuredArtists.forEach(art => {
      overviewArtistsGrid.appendChild(createArtistCard(art));
    });
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
    filtered = filtered.filter(a => a.formatName === 'FLAC');
  }

  // Sort
  if (state.sortBy === 'title') {
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

  filtered.forEach(alb => {
    allAlbumsGrid.appendChild(createAlbumCard(alb));
  });
}

function createAlbumCard(album) {
  const card = document.createElement('div');
  card.className = 'album-card';

  const defaultCover = createSvgCover(album.title, album.artist, '#27272a', '#09090b');
  const coverSrc = album.cover || defaultCover;

  let qualityTagHtml = '';
  if (album.bitsPerSample >= 24 || album.sampleRate > 48000) {
    qualityTagHtml = `<span class="album-quality-tag tag-hires">HI-RES 24b</span>`;
  } else if (album.isLossless || album.formatName === 'FLAC') {
    qualityTagHtml = `<span class="album-quality-tag tag-flac">FLAC</span>`;
  }

  const isFav = isAlbumFavorite(album);
  const playCount = getAlbumPlayCount(album);
  const playCountText = playCount > 0 ? ` • 播放 ${playCount} 次` : '';

  card.innerHTML = `
    <div class="album-art-wrap">
      <img src="${coverSrc}" class="album-art-img" alt="${escapeXml(album.title)}" loading="lazy" onerror="this.onerror=null;this.src='${defaultCover}';">
      ${qualityTagHtml}
      <button class="card-play-btn" title="播放專輯">▶</button>
      <button class="card-fav-btn ${isFav ? 'active' : ''}" title="${isFav ? '取消最愛專輯' : '加入最愛專輯'}">${isFav ? '♥' : '♡'}</button>
    </div>
    <div class="album-meta">
      <div class="album-title" title="${escapeXml(album.title)}">${escapeXml(album.title)}</div>
      <div class="album-artist clickable-artist" title="查看演出者介紹">${escapeXml(album.artist)}</div>
      <div class="album-year">${album.year ? album.year + ' • ' : ''}${album.tracks ? album.tracks.length + ' 首' : ''}${playCountText}</div>
    </div>
  `;

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
function createArtistCard(art) {
  const card = document.createElement('div');
  card.className = 'artist-card';
  const initial = art.name.charAt(0).toUpperCase();
  const isFav = isArtistFavorite(art.name);

  card.innerHTML = `
    <div class="artist-avatar-wrap">
      <div class="artist-avatar">${initial}</div>
      <button class="artist-fav-btn ${isFav ? 'active' : ''}" title="${isFav ? '取消最愛演出者' : '加入最愛演出者'}">⭐</button>
    </div>
    <div class="artist-name">${escapeXml(art.name)}</div>
    <div class="artist-sub">${art.albums.size} 張專輯 • ${art.tracks.length} 首曲目</div>
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
  state.artists.forEach(art => {
    artistsGrid.appendChild(createArtistCard(art));
  });
}

// ----------------- Artist Detail View (Roon Inspired) -----------------
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
    btnFavArtist.textContent = isFav ? '⭐ 已在最愛演出者' : '☆ 加入最愛演出者';
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
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-TW&dt=t&q=${encodeURIComponent(text.trim())}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (data && data[0] && Array.isArray(data[0])) {
        return data[0].map(s => (s && s[0]) ? s[0] : '').join('').trim();
      }
    }
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
      heroBackdrop.style.backgroundImage = `url("${firstLocalCover}")`;
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

// 2-4. Fetch Missing Online Albums (Tidal / Qobuz / KKBOX)
async function fetchArtistMissingAlbums(artistName, localAlbums) {
  const loadingEl = document.getElementById('missingAlbumsLoading');
  const container = document.getElementById('artistMissingAlbumsGrid');
  const countBadge = document.getElementById('artistMissingAlbumsCount');

  loadingEl.style.display = 'flex';
  container.innerHTML = '';
  countBadge.textContent = '檢索中...';

  const normalize = (s) => s.toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5]/g, '')
    .trim();

  const localTitlesNormalized = new Set(localAlbums.map(a => normalize(a.title)));

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
    const coverSrc = alb.cover || defaultCover;

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

// Generate external streaming hyperlinks (YouTube & YouTube Music) for track
function generateTrackOnlineLinks(track) {
  if (!track || !track.title) return '';
  const title = String(track.title || '').trim();
  const artist = String(track.artist || '').trim();
  const query = `${title} ${artist}`.trim();
  if (!query) return '';

  const ytUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  const ytmUrl = `https://music.youtube.com/search?q=${encodeURIComponent(query)}`;

  return `
    <div class="track-stream-links">
      <a href="${ytUrl}" class="track-ext-link yt" target="_blank" title="在 YouTube 搜尋播放「${escapeXml(title)}」" data-url="${ytUrl}" data-platform="YouTube">
        <span class="ext-icon">▶</span> YouTube
      </a>
      <a href="${ytmUrl}" class="track-ext-link ytm" target="_blank" title="在 YouTube Music 搜尋播放「${escapeXml(title)}」" data-url="${ytmUrl}" data-platform="YT Music">
        <span class="ext-icon">🎵</span> YT Music
      </a>
    </div>
  `;
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

// Render Tracks Tab
function renderTracks() {
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

  displayTracks.forEach((track, idx) => {
    const tr = document.createElement('tr');
    const isHires = (track.bitsPerSample >= 24) || (track.sampleRate > 48000);
    const specLabel = `${track.formatName || 'PCM'} ${track.bitsPerSample ? track.bitsPerSample + 'b/' : ''}${Math.round((track.sampleRate || 44100)/1000)}k`;
    const isFav = isTrackFavorite(track);
    const onlineLinksHtml = generateTrackOnlineLinks(track);
    const playCount = getTrackPlayCount(track);
    const playBadge = playCount > 0 ? `<span style="display:inline-block; margin-left:6px; font-size:11px; padding:1px 6px; border-radius:10px; background:rgba(217,70,239,0.15); color:var(--accent-purple);">播放 ${playCount} 次</span>` : '';

    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td style="text-align: center;"><button class="btn-track-fav ${isFav ? 'active' : ''}" title="${isFav ? '取消最愛歌曲' : '加入最愛歌曲'}">${isFav ? '♥' : '♡'}</button></td>
      <td class="track-title-cell">
        <div class="track-title-text">${escapeXml(track.title)}${playBadge}</div>
        ${onlineLinksHtml}
      </td>
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
      playTrackList(displayTracks, idx);
    });
    allTracksTbody.appendChild(tr);
  });
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

  // Collect all genres: scanned user genres + curated core genres
  const genreSet = new Set();
  (state.genres || []).forEach(g => {
    if (g && g.trim() && g !== 'Unknown') genreSet.add(g.trim());
  });

  const CURATED_PILLARS = [
    'Classical', 'Jazz', 'Rock', 'Pop', 'Electronic',
    'Soul / R&B', 'Blues', 'Folk', 'Soundtrack', 'Metal',
    'Hip Hop', 'Ambient', 'Vocal', 'Audiophile'
  ];

  CURATED_PILLARS.forEach(cg => {
    const exists = Array.from(genreSet).some(g => g.toLowerCase() === cg.toLowerCase());
    if (!exists) {
      genreSet.add(cg);
    }
  });

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
        <img src="${info.imageSrc}" class="album-art-img" alt="${escapeXml(genreName)}" loading="lazy">
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

    genresGrid.appendChild(card);
  });
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
    const folderTracks = state.tracks.filter(t => t.filePath && t.filePath.startsWith(f));
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

      // 2. If no Chinese summary, try English Wikipedia Search
      if (!rawBioText) {
        const enSearchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(album.title + ' ' + album.artist + ' album')}&format=json&origin=*`;
        res = await fetch(enSearchUrl);
        if (res.ok) {
          const data = await res.json();
          const hit = data.query?.search?.[0]?.title;
          if (hit) {
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

      // 3. Direct page summary fallback
      if (!rawBioText) {
        const directUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(album.title + ' (album)')}`;
        res = await fetch(directUrl, { headers: { 'User-Agent': 'rooPlayer/1.0' } });
        if (res.ok) {
          const sumData = await res.json();
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
        ? '資料來源：維基百科音樂資料庫 (自動翻譯為繁體中文)'
        : '資料來源：中文維基百科 (繁體中文)';
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
    // Elegant fallback overview generated from local metadata
    const sampleTrack = (album.tracks && album.tracks.length > 0) ? album.tracks[0].title : album.title;
    const yearText = album.year ? `於 ${album.year} 年錄製發行` : '所精心打造';
    const genreText = album.genre && album.genre !== 'Various' ? album.genre : '多元精緻風格';
    const specKhz = album.sampleRate ? Math.round(album.sampleRate / 1000) : 44.1;
    const bitDepth = album.bitsPerSample || 16;
    const formatLabel = `${album.formatName || 'PCM'} ${bitDepth}-bit / ${specKhz}kHz`;

    textEl.textContent = `《${album.title}》是由知名演出者 ${album.artist} ${yearText}的代表性作品。全張專輯共收錄包含「${sampleTrack}」在內之 ${album.tracks.length} 首精彩錄音，曲風涵蓋 ${genreText}。本音樂庫以 ${formatLabel} 發燒母帶規格完整收錄，展現豐富的音場深度與動態細節。`;
    textEl.style.display = 'block';
    sourceBadge.textContent = '音樂庫母帶元資料介紹 (繁體中文)';
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

function renderAlbumMetadata(album) {
  const metaGrid = document.getElementById('albumMetaGrid');
  const sourceBadge = document.getElementById('albumMetaSourceBadge');
  if (!metaGrid) return;

  // Extract initial values from album and track objects
  let artist = isUnknownArtist(album.artist) ? '正在線上查找歌手...' : (album.artist || '各種演出者');
  let year = album.year ? `${album.year} 年` : (album.date ? `${album.date.slice(0, 4)} 年` : '未載明');
  let releaseDate = album.date || (album.year ? `${album.year} 年` : '未載明');
  let genre = album.genre || '未分類風格';
  let label = album.label || null;
  let producer = album.producer || null;
  let composer = album.composer || null;
  let copyright = album.copyright || null;

  (album.tracks || []).forEach(t => {
    if (!label && t.label) label = t.label;
    if (!producer && t.producer) producer = t.producer;
    if (!composer && t.composer) composer = t.composer;
    if (!copyright && t.copyright) copyright = t.copyright;
    if ((!releaseDate || releaseDate === '未載明') && t.date) releaseDate = t.date;
  });

  const ext = (album.formatName || 'FLAC').toUpperCase();
  const isDsd = ext === 'DSF' || ext === 'DFF';
  let specsText = '';
  if (isDsd) {
    specsText = 'DSD 2.8MHz 1-bit Direct Stream Digital (無損母帶)';
  } else {
    const bitDepth = album.bitsPerSample || 16;
    const sampleRateKhz = album.sampleRate ? Math.round(album.sampleRate / 1000) : 44.1;
    specsText = `${ext} ${bitDepth}-bit / ${sampleRateKhz}kHz ${album.isLossless ? '發燒無損母帶' : '數位音訊'}`;
  }

  const tracksDurationText = `${album.tracks.length} 首歌曲 • ${formatTotalAlbumDuration(album.tracks)}`;

  function buildGridHtml(curArtist, curProducer, curReleaseDate, curLabel, curGenre, curComposer, curSpecs, curTracksDur, curCopyright, hasOnlineData) {
    if (sourceBadge) {
      sourceBadge.textContent = hasOnlineData ? '母帶標籤與線上音樂資料庫 (已同步)' : '本機母帶音訊元資料';
      sourceBadge.style.background = hasOnlineData ? 'rgba(16, 185, 129, 0.15)' : 'rgba(59, 130, 246, 0.15)';
      sourceBadge.style.color = hasOnlineData ? '#34d399' : '#60a5fa';
      sourceBadge.style.borderColor = hasOnlineData ? 'rgba(16, 185, 129, 0.3)' : 'rgba(59, 130, 246, 0.3)';
    }

    let html = `
      <div class="meta-card">
        <div class="meta-icon-label"><span class="meta-icon">🎤</span> 主要歌手 / 演出者</div>
        <div class="meta-value accent">${escapeXml(curArtist)}</div>
      </div>
      <div class="meta-card">
        <div class="meta-icon-label"><span class="meta-icon">🎛️</span> 專輯製作人 / 混音</div>
        <div class="meta-value" id="metaProducerVal">${escapeXml(curProducer || '母帶檔案未載明 (依專輯製作群)')}</div>
      </div>
      <div class="meta-card">
        <div class="meta-icon-label"><span class="meta-icon">📅</span> 發行年份 / 發行日期</div>
        <div class="meta-value" id="metaDateVal">${escapeXml(curReleaseDate)}</div>
      </div>
      <div class="meta-card">
        <div class="meta-icon-label"><span class="meta-icon">🏢</span> 發行公司 / 唱片廠牌</div>
        <div class="meta-value" id="metaLabelVal">${escapeXml(curLabel || '獨立發行 / 未標記廠牌')}</div>
      </div>
      <div class="meta-card">
        <div class="meta-icon-label"><span class="meta-icon">🏷️</span> 音樂風格 / 曲風</div>
        <div class="meta-value">${escapeXml(curGenre)}</div>
      </div>
      <div class="meta-card">
        <div class="meta-icon-label"><span class="meta-icon">🎼</span> 作曲 / 詞曲創作</div>
        <div class="meta-value" id="metaComposerVal">${escapeXml(curComposer || curArtist)}</div>
      </div>
      <div class="meta-card">
        <div class="meta-icon-label"><span class="meta-icon">🔊</span> 錄音規格 / 取樣率</div>
        <div class="meta-value">${escapeXml(curSpecs)}</div>
      </div>
      <div class="meta-card">
        <div class="meta-icon-label"><span class="meta-icon">⏱️</span> 曲目總數與總時長</div>
        <div class="meta-value">${escapeXml(curTracksDur)}</div>
      </div>
    `;

    if (curCopyright) {
      html += `
        <div class="meta-card meta-card-wide">
          <div class="meta-icon-label"><span class="meta-icon">📜</span> 版權宣告與出版型號 (Copyright & Publishing)</div>
          <div class="meta-value" id="metaCopyrightVal" style="font-weight: 500; font-size: 13px; color: var(--text-sub);">${escapeXml(curCopyright)}</div>
        </div>
      `;
    }
    return html;
  }

  // Render initially with local metadata
  metaGrid.innerHTML = buildGridHtml(artist, producer, releaseDate, label, genre, composer, specsText, tracksDurationText, copyright, false);

  // Background fetch online enrichment if producer, label, copyright, or releaseDate is missing
  if (!producer || !label || !copyright || releaseDate === '未載明') {
    fetchOnlineAlbumCredits(album).then(onlineCredits => {
      if (state.activeAlbumDetail && state.activeAlbumDetail.title === album.title && state.activeAlbumDetail.artist === album.artist) {
        let hasUpdated = false;
        if (!producer && onlineCredits.producer) { producer = onlineCredits.producer; hasUpdated = true; }
        if (!label && onlineCredits.label) { label = onlineCredits.label; hasUpdated = true; }
        if ((!releaseDate || releaseDate === '未載明') && onlineCredits.releaseDate) { releaseDate = onlineCredits.releaseDate; hasUpdated = true; }
        if (!copyright && onlineCredits.copyright) { copyright = onlineCredits.copyright; hasUpdated = true; }
        if (!composer && onlineCredits.composer) { composer = onlineCredits.composer; hasUpdated = true; }

        if (hasUpdated) {
          metaGrid.innerHTML = buildGridHtml(artist, producer, releaseDate, label, genre, composer, specsText, tracksDurationText, copyright, true);
        }
      }
    }).catch(() => {});
  }
}

// ----------------- Album Recommendations Engine (Metadata-driven) -----------------
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
    const isSameTitle = cand.title.toLowerCase().trim() === album.title.toLowerCase().trim();
    const isSameArtist = cand.artist.toLowerCase().trim() === album.artist.toLowerCase().trim();
    return !(isSameTitle && isSameArtist);
  });

  // Calculate similarity scores
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
    if (cand.artist.toLowerCase().trim() === album.artist.toLowerCase().trim()) {
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

  // Take top recommended albums
  const recommendations = scored.slice(0, 5);

  if (countBadge) {
    countBadge.textContent = `${recommendations.length} 張推薦`;
  }

  if (recommendations.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'recommend-empty-hint';
    empty.textContent = `目前本機音樂庫中暫無其他 ${currentGenre || '同類型'} 專輯，在「資料夾」加入更多音樂目錄即可自動擴充風格比對推薦！`;
    container.appendChild(empty);
    return;
  }

  recommendations.forEach(item => {
    const alb = item.album;
    const card = document.createElement('div');
    card.className = 'recommend-card';

    const defaultCover = createSvgCover(alb.title, alb.artist, '#27272a', '#09090b');
    const coverSrc = alb.cover || defaultCover;
    const sampleKhz = alb.sampleRate ? Math.round(alb.sampleRate / 1000) : 44;
    const bitDepth = alb.bitsPerSample || 16;
    const specLabel = `${alb.formatName || 'FLAC'} ${bitDepth}b/${sampleKhz}k`;

    card.innerHTML = `
      <div class="recommend-art-wrap">
        <img src="${coverSrc}" class="recommend-card-art" alt="${escapeXml(alb.title)}" loading="lazy" onerror="this.onerror=null;this.src='${defaultCover}';">
        <span class="recommend-badge-pill">${escapeXml(item.reason)}</span>
      </div>
      <div class="recommend-title" title="${escapeXml(alb.title)}">${escapeXml(alb.title)}</div>
      <div class="recommend-artist" title="${escapeXml(alb.artist)}">${escapeXml(alb.artist)}</div>
      <div class="recommend-meta">
        <span>${alb.year || alb.genre || ''}</span>
        <span class="format-chip" style="font-size: 9px; padding: 1px 5px;">${specLabel}</span>
      </div>
    `;

    card.addEventListener('click', (e) => {
      e.stopPropagation();
      openAlbumDetail(alb);
    });

    container.appendChild(card);
  });
}

function renderDetailTracklist(album) {
  detailTracklistTbody.innerHTML = '';
  album.tracks.forEach((t, idx) => {
    const tr = document.createElement('tr');
    const isFav = isTrackFavorite(t);
    const trackWithArtist = t.artist ? t : { ...t, artist: album.artist };
    const onlineLinksHtml = generateTrackOnlineLinks(trackWithArtist);

    tr.innerHTML = `
      <td>${t.trackNumber || (idx + 1)}</td>
      <td style="text-align: center;"><button class="btn-track-fav ${isFav ? 'active' : ''}" title="${isFav ? '取消最愛歌曲' : '加入最愛歌曲'}">${isFav ? '♥' : '♡'}</button></td>
      <td class="track-title-cell">
        <div class="track-title-text">${escapeXml(t.title)}</div>
        ${onlineLinksHtml}
      </td>
      <td><span class="format-chip">${t.formatName} ${t.bitsPerSample || 16}b</span></td>
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
}

function openAlbumDetail(album) {
  state.activeAlbumDetail = album;
  applyDetailCoverSize(state.detailCoverSize || 'medium');
  const defaultDetailCover = createSvgCover(album.title, album.artist, '#27272a', '#09090b');
  detailCoverImg.src = album.cover || defaultDetailCover;
  detailCoverImg.onerror = () => {
    detailCoverImg.onerror = null;
    detailCoverImg.src = defaultDetailCover;
  };
  detailTitle.textContent = album.title;
  if (detailYear) detailYear.textContent = '';
  detailGenre.textContent = album.genre || 'Various';

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
          detailArtist.textContent = found;
          fetchAlbumBio(album);
          renderAlbumMetadata(album);
          renderDetailTracklist(album);
        } else if (state.activeAlbumDetail === album && isUnknownArtist(album.artist)) {
          detailArtist.textContent = '未知演出者';
        }
      });
    }
  } else {
    detailArtist.textContent = album.artist;
  }
  
  const sampleRateKhz = album.sampleRate ? Math.round(album.sampleRate / 1000) : 44.1;
  const bitDepth = album.bitsPerSample || 16;
  detailFormatBadge.textContent = `${album.formatName || 'FLAC'} ${bitDepth}/${sampleRateKhz}`;
  detailTrackCount.textContent = album.tracks.length;

  renderDetailTracklist(album);

  // Favorite button in Album Detail Modal
  const btnFavAlbum = document.getElementById('btnFavAlbumDetail');
  if (btnFavAlbum) {
    const isFav = isAlbumFavorite(album);
    btnFavAlbum.classList.toggle('active', isFav);
    btnFavAlbum.textContent = isFav ? '♥ 已在最愛專輯' : '♡ 加入最愛專輯';
    btnFavAlbum.onclick = (e) => {
      e.stopPropagation();
      toggleAlbumFavorite(album);
    };
  }

  // Clicking artist in detail modal opens artist page
  detailArtist.style.cursor = 'pointer';
  detailArtist.onclick = () => {
    closeAlbumDetail();
    openArtistDetail(album.artist);
  };

  // Scroll modal back to top
  const modalContent = albumDetailModal.querySelector('.modal-content');
  if (modalContent) modalContent.scrollTop = 0;

  // 1. Fetch Album Bio (Online search + Auto Traditional Chinese Translation)
  fetchAlbumBio(album);

  // 2. Render Album Credits & Metadata (Artist, Producer, Release Year, Record Label, etc.)
  renderAlbumMetadata(album);

  // 3. Render Recommended Albums (Based on metadata & same genre)
  renderAlbumRecommendations(album);

  albumDetailModal.style.display = 'flex';
}

function closeAlbumDetail() {
  albumDetailModal.style.display = 'none';
  state.activeAlbumDetail = null;
}

// ----------------- Player & Audio Engine -----------------
function getEnrichedTrack(track) {
  if (!track) return track;
  const foundAlbum = state.albums.find(a => a.title === track.album && (a.artist || '').toLowerCase() === (track.artist || '').toLowerCase());
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

function playAlbum(album) {
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

function playCurrentTrack() {
  if (state.currentTrackIndex < 0 || state.currentTrackIndex >= state.queue.length) return;
  const track = state.queue[state.currentTrackIndex];

  // Record to recently played albums
  const foundAlbum = state.albums.find(a => a.title === track.album && a.artist.toLowerCase() === track.artist.toLowerCase());
  if (foundAlbum) {
    recordRecentlyPlayed(foundAlbum);
  }

  // Record play count statistics
  recordPlayCount(track, foundAlbum);

  // Stop previous synth or native audio
  stopDemoSynth();
  nativeAudio.pause();

  // Update UI Elements
  playerTitle.textContent = track.title;
  playerArtist.textContent = `${track.artist} — ${track.album}`;
  const defaultPlayerCover = createSvgCover(track.album, track.artist, '#27272a', '#09090b');
  playerCoverImg.src = track.cover || (foundAlbum ? foundAlbum.cover : null) || defaultPlayerCover;
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
    playerHeartBtn.textContent = isFav ? '♥' : '♡';
    playerHeartBtn.title = isFav ? '從最愛歌曲移除' : '加入最愛歌曲';
  }

  // Update Signal Path Badge & Modal
  updateSignalPathUI(track);

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

    if (track.isDemo || (!track.filePath && !track.isKkbox)) {
      showToast('⚠️ 示範音訊為合成示範曲，請選取本機音樂庫或 KKBOX 歌曲進行 DLNA 串流播放');
      state.isPlaying = false;
      updatePlayPauseBtnUI();
      updateQueueActiveItem();
      return;
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
      const dspOptions = state.dsp && state.dsp.enabled ? {
        enabled: true,
        sampleRate: calculateTargetSampleRate(track.sampleRate || 44100, state.dsp.rateMode),
        precision: state.dsp.precision || 28,
        dsdMode: isDsdRateMode(state.dsp.rateMode) ? state.dsp.rateMode : ''
      } : null;

      const enrichedTrack = getEnrichedTrack(track);
      window.electronAPI.playDlnaTrack(state.activeDlnaDevice.id, enrichedTrack, 0, dspOptions).then(res => {
        if (res && res.success) {
          state.isPlaying = true;
          updatePlayPauseBtnUI();
          const dur = track.duration || 0;
          if (dspOptions && dspOptions.dsdMode) {
            showToast(`⚡ 正在以 1-bit ${dspOptions.dsdMode.toUpperCase()} 串流至 ${state.activeDlnaDevice.name}: ${track.title}`);
          } else if (track.filePath && /\.dsf$/i.test(track.filePath) && (!dspOptions || !dspOptions.enabled)) {
            showToast(`🎵 正在以 Native DSD 直通串流至 ${state.activeDlnaDevice.name}: ${track.title}`);
          } else {
            showToast(`📡 正在串流至 ${state.activeDlnaDevice.name}: ${track.title}`);
          }
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

  if (track.isKkbox) {
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
      playerArtist.textContent = `${track.artist} — ${track.album}`;
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
  } else if (state.dsp && state.dsp.enabled && window.electronAPI && window.electronAPI.getSoxStreamUrl) {
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

    const streamUrl = await window.electronAPI.getDsdStreamUrl(track.filePath, startSec);
    if (!streamUrl) {
      playerArtist.textContent = '無法建立 DSD 串流服務';
      return;
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

// ----------------- SoX Resampler Direct Streaming Engine -----------------
let isCurrentSox = false;
let currentSoxOffset = 0;

function isDsdRateMode(mode) {
  return ['dsd64', 'dsd128', 'dsd256', 'dsd512'].includes(mode);
}

function getDsdMhz(mode, srcRate = 44100) {
  const is48kFamily = (Number(srcRate) % 48000 === 0);
  switch (mode) {
    case 'dsd64': return is48kFamily ? '3.072 MHz' : '2.8224 MHz';
    case 'dsd128': return is48kFamily ? '6.144 MHz' : '5.6448 MHz';
    case 'dsd256': return is48kFamily ? '12.288 MHz' : '11.2896 MHz';
    case 'dsd512': return is48kFamily ? '24.576 MHz' : '22.5792 MHz';
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

    const targetRate = calculateTargetSampleRate(track.sampleRate || 44100, state.dsp.rateMode);
    const precision = state.dsp.precision || 28;
    const isDsd = isDsdRateMode(state.dsp.rateMode);
    const dsdMode = isDsd ? state.dsp.rateMode : '';

    const streamUrl = await window.electronAPI.getSoxStreamUrl(track.filePath, startSec, targetRate, precision, dsdMode);
    if (!streamUrl) {
      playerArtist.textContent = '無法建立 SoX 升頻串流服務';
      return;
    }

    nativeAudio.src = streamUrl;
    nativeAudio.play().then(() => {
      state.isPlaying = true;
      btnPlayPause.textContent = '⏸';
      if (isDsd) {
        const mhz = getDsdMhz(state.dsp.rateMode, track.sampleRate || 44100);
        showToast(`⚡ 1-bit DSD 調變啟用: PCM ➔ ${state.dsp.rateMode.toUpperCase()} (1-bit / ${mhz})`);
      } else {
        showToast(`🎛️ SoX 升頻啟用: ${formatKhz(track.sampleRate || 44100)} ➔ ${formatKhz(targetRate)} (24-bit Hi-Res FLAC)`);
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
  const dspActivePrecisionHint = document.getElementById('dspActivePrecisionHint');

  if (toggleSoxDsp) toggleSoxDsp.checked = !!(state.dsp && state.dsp.enabled);
  if (dspSoxCard) dspSoxCard.classList.toggle('active', !!(state.dsp && state.dsp.enabled));

  const curRateMode = (state.dsp && state.dsp.rateMode) || '4x';
  const curPrecision = (state.dsp && state.dsp.precision) || 24;

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

  const precPill = document.querySelector(`#dspPrecisionSelector .dsp-pill[data-precision="${curPrecision}"]`);
  if (precPill) {
    document.querySelectorAll('#dspPrecisionSelector .dsp-pill').forEach(p => p.classList.remove('active'));
    precPill.classList.add('active');
    if (dspActivePrecisionHint) dspActivePrecisionHint.textContent = `${curPrecision}-bit VHQ`;
  }

  if (!track) return;

  const ext = (track.formatName || '').toUpperCase();
  const isNativeDsd = ext === 'DSF' || ext === 'DFF' || (track.fileName && /\.(dsf|dff)$/i.test(track.fileName)) || (track.filePath && /\.(dsf|dff)$/i.test(track.filePath));
  const isDspActive = !track.isDemo && state.dsp && state.dsp.enabled;

  if (isDspActive) {
    const srcRate = track.sampleRate || 44100;
    const targetRate = calculateTargetSampleRate(srcRate, state.dsp.rateMode);
    const srcKhz = formatKhz(srcRate);
    const targetKhz = formatKhz(targetRate);

    if (isDsdRateMode(state.dsp.rateMode)) {
      const mhz = getDsdMhz(state.dsp.rateMode, srcRate);
      const modeUpper = state.dsp.rateMode.toUpperCase();

      if (signalPathBadge) signalPathBadge.textContent = `DSP (${modeUpper}) | 1-bit / ${mhz} ⚡`;
      if (statusPill) statusPill.textContent = `DSP ENHANCED (PCM ➔ ${modeUpper})`;
      if (sourceTitle) sourceTitle.textContent = `${track.formatName || 'PCM'} ${track.bitsPerSample || 16}-bit / ${srcKhz} (${track.title || ''})`;
      if (sourceDesc) sourceDesc.textContent = '原始母帶音訊源 (Bit-Perfect Lossless Input)';

      if (signalSoxArrow) signalSoxArrow.style.display = 'block';
      if (signalSoxStage) signalSoxStage.style.display = 'flex';
      if (signalSoxTitle) signalSoxTitle.textContent = 'SoX Resampler & 1-bit DSD Modulator (SDM)';
      if (signalSoxDesc) signalSoxDesc.textContent = `${state.dsp.precision}-bit VHQ 升頻調變：PCM ${srcKhz} ➔ ${modeUpper} (1-bit / ${mhz}) 噪聲整形`;

      if (engineTitle) engineTitle.textContent = 'rooPlayer 1-bit DSD Modulator Engine';
      if (engineDesc) engineDesc.textContent = '超寬頻 64-bit 浮點調變碼流，高頻噪聲上移至 100 kHz 射頻頻段，維持音訊帶平坦模擬聽感';
      if (signalPathDot) signalPathDot.className = 'signal-dot dsd-gold';
    } else {
      if (signalPathBadge) signalPathBadge.textContent = `DSP (${state.dsp.rateMode.toUpperCase()}) | 24/${targetKhz} ⚡`;
      if (statusPill) statusPill.textContent = 'DSP ENHANCED (SOX RESAMPLER)';
      if (sourceTitle) sourceTitle.textContent = `${track.formatName || 'PCM'} ${track.bitsPerSample || 16}-bit / ${srcKhz} (${track.title || ''})`;
      if (sourceDesc) sourceDesc.textContent = '原始母帶音訊源 (Bit-Perfect Lossless Input)';

      if (signalSoxArrow) signalSoxArrow.style.display = 'block';
      if (signalSoxStage) signalSoxStage.style.display = 'flex';
      if (signalSoxTitle) signalSoxTitle.textContent = 'SoX Resampler (libsoxr VHQ)';
      if (signalSoxDesc) signalSoxDesc.textContent = `${state.dsp.precision}-bit VHQ 浮點升頻：${srcKhz} ➔ ${targetKhz} (24-bit Hi-Res FLAC)`;

      if (engineTitle) engineTitle.textContent = 'rooPlayer Core Audio Engine';
      if (engineDesc) engineDesc.textContent = `64-bit 浮點即時超取樣升頻核心 ➔ 輸出至 24-bit ${targetKhz}`;
      if (signalPathDot) signalPathDot.className = 'signal-dot purple';
    }
  } else if (isNativeDsd) {
    const dsdRate = track.sampleRate ? `${(track.sampleRate / 1000000).toFixed(1)}MHz` : '2.8MHz';
    const isDlna = state.activeAudioZone !== 'local' && state.activeDlnaDevice;
    if (isDlna) {
      if (signalPathBadge) signalPathBadge.textContent = `BIT-PERFECT | Native DSD (1-bit / ${dsdRate}) ⚡`;
      if (sourceTitle) sourceTitle.textContent = `DSD (1-bit / ${dsdRate}) — ${track.title}`;
      if (statusPill) statusPill.textContent = 'BIT-PERFECT (DIRECT STREAMING)';
      if (sourceDesc) sourceDesc.textContent = '原始 DSD 母帶碼流 (Bitstream 1-bit PDM)';

      if (signalSoxArrow) signalSoxArrow.style.display = 'none';
      if (signalSoxStage) signalSoxStage.style.display = 'none';

      if (engineTitle) engineTitle.textContent = 'rooPlayer Bit-Perfect DSD Streamer';
      if (engineDesc) engineDesc.textContent = '原生 1-bit DSD (Sony DSF) 直通傳輸至網路渲染器，無重取樣或轉換';
      if (signalPathDot) signalPathDot.className = 'signal-dot dsd-gold';
    } else {
      if (signalPathBadge) signalPathBadge.textContent = `ENHANCED | DSD ➔ 24/88.2kHz FLAC`;
      if (sourceTitle) sourceTitle.textContent = `DSD (1-bit / ${dsdRate}) — ${track.title}`;
      if (statusPill) statusPill.textContent = 'ENHANCED (HIGH PRECISION TRANSCODE)';
      if (sourceDesc) sourceDesc.textContent = '原始 DSD 母帶碼流 (Bitstream 1-bit PDM)';

      if (signalSoxArrow) signalSoxArrow.style.display = 'none';
      if (signalSoxStage) signalSoxStage.style.display = 'none';

      if (engineTitle) engineTitle.textContent = 'rooPlayer DSD-to-PCM Audio Engine';
      if (engineDesc) engineDesc.textContent = '64-bit 浮點即時降採樣 (Decimation Filter) ➔ 24-bit 88.2kHz FLAC';
      if (signalPathDot) signalPathDot.className = 'signal-dot purple';
    }
  } else {
    const sampleKhz = track.sampleRate ? Math.round(track.sampleRate / 1000) : 44;
    const bitDepth = track.bitsPerSample || 16;
    const isLossless = track.isLossless || track.formatName === 'FLAC';

    if (signalPathBadge) signalPathBadge.textContent = `${isLossless ? 'LOSSLESS' : 'ENHANCED'} | ${track.formatName} ${bitDepth}/${sampleKhz}kHz`;
    if (sourceTitle) sourceTitle.textContent = `${track.formatName} ${bitDepth}-bit / ${sampleKhz}kHz (${track.title})`;
    if (statusPill) statusPill.textContent = isLossless ? 'LOSSLESS BIT-PERFECT' : 'ENHANCED';
    if (sourceDesc) sourceDesc.textContent = '原始母帶音訊源 (Bit-Perfect Lossless)';

    if (signalSoxArrow) signalSoxArrow.style.display = 'none';
    if (signalSoxStage) signalSoxStage.style.display = 'none';

    if (engineTitle) engineTitle.textContent = 'rooPlayer Core Audio Engine';
    if (engineDesc) engineDesc.textContent = '64-bit 浮點無損混音核心，零採樣損失處理';
    if (signalPathDot) signalPathDot.className = 'signal-dot purple';
  }
}

function initDspControls() {
  const toggleSoxDsp = document.getElementById('toggleSoxDsp');
  const dspSoxCard = document.querySelector('.dsp-sox-card');
  const dspRateSelector = document.getElementById('dspRateSelector');
  const dspDsdRateSelector = document.getElementById('dspDsdRateSelector');
  const dspPrecisionSelector = document.getElementById('dspPrecisionSelector');
  const dspActiveRateHint = document.getElementById('dspActiveRateHint');
  const dspActiveDsdHint = document.getElementById('dspActiveDsdHint');
  const dspActivePrecisionHint = document.getElementById('dspActivePrecisionHint');

  const triggerLiveDspUpdate = () => {
    updateSignalPathUI();
    if (state.dsp.enabled && state.isPlaying) {
      const track = state.queue[state.currentTrackIndex];
      if (track && !track.isDemo && track.filePath) {
        const curSec = getCurrentPlaybackTime();
        if (state.activeAudioZone !== 'local' && state.activeDlnaDevice) {
          const dspOptions = {
            enabled: true,
            sampleRate: calculateTargetSampleRate(track.sampleRate || 44100, state.dsp.rateMode),
            precision: state.dsp.precision,
            dsdMode: isDsdRateMode(state.dsp.rateMode) ? state.dsp.rateMode : ''
          };
          window.electronAPI.playDlnaTrack(state.activeDlnaDevice.id, getEnrichedTrack(track), Math.floor(curSec), dspOptions);
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
          const dspOptions = state.dsp.enabled ? {
            enabled: true,
            sampleRate: calculateTargetSampleRate(track.sampleRate || 44100, state.dsp.rateMode),
            precision: state.dsp.precision,
            dsdMode: isDsdRateMode(state.dsp.rateMode) ? state.dsp.rateMode : ''
          } : null;
          window.electronAPI.playDlnaTrack(state.activeDlnaDevice.id, getEnrichedTrack(track), Math.floor(curSec), dspOptions);
        } else {
          if (state.dsp.enabled) {
            playSoxTrack(track, Math.floor(curSec));
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
      showToast(state.dsp.enabled ? '⚡ 已啟用 SoX Resampler / DSD 升頻引擎' : '已關閉 DSP 升頻，恢復 Bit-Perfect 直通');
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

  // Precision selection handler
  if (dspPrecisionSelector) {
    dspPrecisionSelector.addEventListener('click', (e) => {
      const btn = e.target.closest('.dsp-pill');
      if (!btn) return;
      const prec = parseInt(btn.getAttribute('data-precision') || '28', 10);
      if (!prec) return;

      dspPrecisionSelector.querySelectorAll('.dsp-pill').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');

      state.dsp.precision = prec;
      localStorage.setItem('rooplayer_dsp_settings', JSON.stringify(state.dsp));
      if (dspActivePrecisionHint) dspActivePrecisionHint.textContent = `${prec}-bit VHQ`;
      triggerLiveDspUpdate();
    });
  }
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
  const foundAlbum = state.albums.find(a => a.title === track.album && a.artist.toLowerCase() === track.artist.toLowerCase());

  // 1. Left: Cover Art & Track Info
  const defaultCover = createSvgCover(track.album || track.title, track.artist, '#27272a', '#09090b');
  const coverSrc = track.cover || (foundAlbum ? foundAlbum.cover : null) || defaultCover;
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

  const sampleRateKhz = track.sampleRate ? Math.round(track.sampleRate / 1000) : 44.1;
  const bitDepth = track.bitsPerSample || 16;
  const formatBadge = document.getElementById('nowPlayingFormatBadge');
  if (formatBadge) {
    formatBadge.textContent = `${track.formatName || 'FLAC'} ${bitDepth}/${sampleRateKhz}`;
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
      const isCurrent = (t.title === track.title && (t.artist || '').toLowerCase() === (track.artist || '').toLowerCase());
      const row = document.createElement('div');
      row.className = `np-track-item ${isCurrent ? 'active' : ''}`;
      row.innerHTML = `
        <div class="np-track-num">${isCurrent ? '🔊' : (t.trackNumber || idx + 1)}</div>
        <div class="np-track-title-wrap">
          <div class="np-track-title" title="${escapeXml(t.title)}">${escapeXml(t.title)}</div>
        </div>
        <div class="np-track-dur">${formatDuration(t.duration)}</div>
      `;
      row.onclick = () => {
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
    } else {
      nativeAudio.pause();
    }
    state.isPlaying = false;
    updatePlayPauseBtnUI();
  } else {
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
  let toastEl = document.getElementById('roonToast');
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.id = 'roonToast';
    toastEl.className = 'roon-toast';
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
    } else if ((isLocalFile || track.isKkbox) && nativeAudio.src) {
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
        } else if ((isLocalFile || track.isKkbox) && nativeAudio.src) {
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
    } else if (track && (track.filePath || track.isKkbox) && nativeAudio.src) {
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
        if (!nativeAudio.duration) return;
        const current = nativeAudio.currentTime;
        const total = nativeAudio.duration;
        const percent = (current / total) * 100;
        scrubberFill.style.width = `${percent}%`;
        currentTimeLabel.textContent = formatDuration(current);
        totalTimeLabel.textContent = formatDuration(total);
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

  if (track.isKkbox) {
    if (nativeAudio.duration) {
      nativeAudio.currentTime = ratio * nativeAudio.duration;
    }
  } else if (track.isDemo || !track.filePath) {
    virtualCurrentSec = Math.floor(ratio * virtualTotalSec);
    currentTimeLabel.textContent = formatDuration(virtualCurrentSec);
    scrubberFill.style.width = `${ratio * 100}%`;
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

volumeSlider.addEventListener('input', (e) => {
  state.volume = parseFloat(e.target.value);
  nativeAudio.volume = state.volume;
  if (audioCtx && currentSynthNodes.length) {
    const masterGain = currentSynthNodes[currentSynthNodes.length - 1];
    if (masterGain && masterGain.gain) {
      masterGain.gain.setValueAtTime(state.volume * 0.15, audioCtx.currentTime);
    }
  }
  btnVolumeIcon.textContent = state.volume === 0 ? '🔇' : (state.volume < 0.5 ? '🔉' : '🔊');

  if (state.activeAudioZone !== 'local' && state.activeDlnaDevice) {
    if (window.electronAPI && window.electronAPI.setDlnaVolume) {
      const vol100 = Math.round(state.volume * 100);
      window.electronAPI.setDlnaVolume(state.activeDlnaDevice.id, vol100);
    }
  }
});

btnVolumeIcon.addEventListener('click', () => {
  if (state.volume > 0) {
    volumeSlider.value = 0;
    volumeSlider.dispatchEvent(new Event('input'));
  } else {
    volumeSlider.value = 0.8;
    volumeSlider.dispatchEvent(new Event('input'));
  }
});

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
    applyView(viewId, true);
  }
}

function applyView(viewId, updateNav = true) {
  state.currentView = viewId;
  document.querySelectorAll('.content-view').forEach(view => {
    view.classList.remove('active');
  });

  const targetView = document.getElementById(`view${capitalize(viewId)}`);
  if (targetView) targetView.classList.add('active');

  if (viewId === 'favAlbums') {
    renderFavAlbums();
  } else if (viewId === 'favTracks') {
    renderFavTracks();
  } else if (viewId === 'favArtists') {
    renderFavArtists();
  } else if (viewId === 'kkbox') {
    onOpenKkboxView();
  }

  if (updateNav) {
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-view') === viewId);
    });
  }
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
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

      tr.innerHTML = `
        <td>${idx + 1}</td>
        <td style="text-align: center;"><button class="btn-track-fav active" title="取消最愛歌曲">♥</button></td>
        <td class="track-title-cell">
          <div class="track-title-text">${escapeXml(track.title)}</div>
          ${onlineLinksHtml}
        </td>
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
  }
}

function renderFavArtists() {
  const grid = document.getElementById('favArtistsGrid');
  const emptyHint = document.getElementById('favArtistsEmptyHint');
  const countBadge = document.getElementById('favArtistsHeaderCount');
  if (!grid) return;

  grid.innerHTML = '';
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
    document.getElementById('favAlbumsGrid')
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

  // Apply initial saved sizes
  applyAlbumCoverSize(state.albumCoverSize || 'medium');
  applyDetailCoverSize(state.detailCoverSize || 'medium');
}

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
  try {
    // 1. First attempt with Taiwan store (best for Chinese, Asian & Western popular albums)
    const twUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(cleanQ)}&entity=album&country=TW&limit=24`;
    let res = await fetch(twUrl);
    let data = res.ok ? await res.json() : null;

    // 2. If no results or failed, attempt global US catalog
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
    const card = document.createElement('div');
    card.className = 'missing-album-card';

    const defaultCover = createSvgCover(alb.title, alb.artist, '#27272a', '#09090b');
    const coverSrc = alb.cover || defaultCover;
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
  document.getElementById('btnHeroScan').addEventListener('click', () => {
    document.querySelector('[data-view="storage"]').click();
  });

  document.getElementById('btnHeroPlayRandom').addEventListener('click', () => {
    if (state.tracks.length > 0) {
      setShuffleState(true);
      const randIdx = Math.floor(Math.random() * state.tracks.length);
      playTrackList(state.tracks, randIdx);
      showToast('🔀 隨機播放音樂庫');
    }
  });

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

    const result = await window.electronAPI.scanFolder(folderPath);

    if (result && result.tracks) {
      state.tracks = result.tracks;
      state.folders = result.folders || state.folders;
      if (!state.folders.includes(result.folderPath)) {
        state.folders.push(result.folderPath);
      }
      rebuildLibraryCollections();
      renderAll();

      scanStatusLabel.textContent = `掃描完成！本資料夾新增/更新 ${result.newCount || 0} 首，目前音樂庫總計 ${state.tracks.length} 首音訊。`;
      scanPercentLabel.textContent = '100%';
      scanProgressBar.style.width = '100%';

      setTimeout(() => {
        scanProgressBox.style.display = 'none';
        document.querySelector('[data-view="albums"]').click();
      }, 1500);
    }
  });

  if (window.electronAPI) {
    window.electronAPI.onScanProgress((data) => {
      const pct = Math.round((data.current / data.total) * 100);
      scanProgressBar.style.width = `${pct}%`;
      scanPercentLabel.textContent = `${pct}% (${data.current}/${data.total})`;
      scanCurrentFile.textContent = `檔案: ${data.currentFile}`;
    });
  }
}

window.rescanSpecificFolder = async function(folderPath) {
  if (!window.electronAPI) return;
  document.querySelector('[data-view="storage"]').click();
  scanProgressBox.style.display = 'block';
  scanProgressBar.style.width = '0%';
  scanStatusLabel.textContent = `正在重新掃描: ${folderPath}`;
  const result = await window.electronAPI.scanFolder(folderPath);
  if (result && result.tracks) {
    state.tracks = result.tracks;
    state.folders = result.folders || state.folders;
    rebuildLibraryCollections();
    renderAll();
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

  const btnNPPrev = document.getElementById('btnNowPlayingPrev');
  if (btnNPPrev) {
    btnNPPrev.addEventListener('click', () => btnPrev.click());
  }
  const btnNPNext = document.getElementById('btnNowPlayingNext');
  if (btnNPNext) {
    btnNPNext.addEventListener('click', () => btnNext.click());
  }
  const btnNPPlayPause = document.getElementById('btnNowPlayingPlayPause');
  if (btnNPPlayPause) {
    btnNPPlayPause.addEventListener('click', () => togglePlayPause());
  }
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

  // Album Detail Modal
  btnCloseAlbumDetail.addEventListener('click', closeAlbumDetail);
  albumDetailModal.addEventListener('click', (e) => {
    if (e.target === albumDetailModal) closeAlbumDetail();
  });
  btnPlayAlbumNow.addEventListener('click', () => {
    if (state.activeAlbumDetail) {
      playAlbum(state.activeAlbumDetail);
      closeAlbumDetail();
    }
  });
  btnShuffleAlbum.addEventListener('click', () => {
    if (state.activeAlbumDetail && state.activeAlbumDetail.tracks.length > 0) {
      setShuffleState(true);
      const randIdx = Math.floor(Math.random() * state.activeAlbumDetail.tracks.length);
      playTrackList(state.activeAlbumDetail.tracks, randIdx);
      closeAlbumDetail();
      showToast(`🔀 隨機播放專輯《${state.activeAlbumDetail.title}》`);
    }
  });

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

      if (currentZoneName) currentZoneName.textContent = `📡 ${dev.name}`;
      if (btnAudioOutput) btnAudioOutput.classList.add('network-active');

      if (signalOutputIcon) signalOutputIcon.textContent = (dev.deviceCategory === 'tv') ? '📺' : '📡';
      if (signalOutputTitle) signalOutputTitle.textContent = `${dev.name} (DLNA / UPnP)`;
      if (signalOutputDesc) signalOutputDesc.textContent = `透過區網即時串流至 ${dev.ip} (UPnP AVTransport)`;

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

    // Front-end safety guard: if renderer reached track end and didn't fire event
    if (state.isPlaying && totalSec > 8 && currentSec >= totalSec && !isTrackEndingHandled) {
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
    const json = await this.fetchApi(`/new-hits-playlists?territory=${this.territory}&limit=50`);
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
          <button class="btn-track-fav ${isFav ? 'active' : ''}" style="margin-right: 6px;" title="${isFav ? '取消最愛歌曲' : '加入最愛歌曲'}">${isFav ? '♥' : '♡'}</button>
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
          btnFav.classList.toggle('active', isTrackFavorite(track));
          btnFav.textContent = isTrackFavorite(track) ? '♥' : '♡';
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

// Start application
window.addEventListener('DOMContentLoaded', initApp);


