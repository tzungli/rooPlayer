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
  }
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
  initAudioZones();

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
      <div class="album-year">${album.year ? album.year : ''} ${album.tracks ? album.tracks.length + ' 首' : ''}</div>
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
  state.tracks.forEach((track, idx) => {
    const tr = document.createElement('tr');
    const isHires = (track.bitsPerSample >= 24) || (track.sampleRate > 48000);
    const specLabel = `${track.formatName || 'PCM'} ${track.bitsPerSample ? track.bitsPerSample + 'b/' : ''}${Math.round((track.sampleRate || 44100)/1000)}k`;
    const isFav = isTrackFavorite(track);
    const onlineLinksHtml = generateTrackOnlineLinks(track);

    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td style="text-align: center;"><button class="btn-track-fav ${isFav ? 'active' : ''}" title="${isFav ? '取消最愛歌曲' : '加入最愛歌曲'}">${isFav ? '♥' : '♡'}</button></td>
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
      playTrackList(state.tracks, idx);
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
  let artist = album.artist || '各種演出者';
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

function openAlbumDetail(album) {
  state.activeAlbumDetail = album;
  const defaultDetailCover = createSvgCover(album.title, album.artist, '#27272a', '#09090b');
  detailCoverImg.src = album.cover || defaultDetailCover;
  detailCoverImg.onerror = () => {
    detailCoverImg.onerror = null;
    detailCoverImg.src = defaultDetailCover;
  };
  detailTitle.textContent = album.title;
  detailArtist.textContent = album.artist;
  detailYear.textContent = album.year || 'Unknown';
  detailGenre.textContent = album.genre || 'Various';
  
  const sampleRateKhz = album.sampleRate ? Math.round(album.sampleRate / 1000) : 44.1;
  const bitDepth = album.bitsPerSample || 16;
  detailFormatBadge.textContent = `${album.formatName || 'FLAC'} ${bitDepth}/${sampleRateKhz}`;
  detailTrackCount.textContent = album.tracks.length;

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
  const ext = (track.formatName || '').toUpperCase();
  const isDsd = ext === 'DSF' || ext === 'DFF' || (track.fileName && /\.(dsf|dff)$/i.test(track.fileName)) || (track.filePath && /\.(dsf|dff)$/i.test(track.filePath));

  const statusPill = document.getElementById('signalPathStatusPill');
  const sourceDesc = document.getElementById('signalSourceDesc');
  const engineTitle = document.getElementById('signalEngineTitle');
  const engineDesc = document.getElementById('signalEngineDesc');
  const signalOutputIcon = document.getElementById('signalOutputIcon');
  const signalOutputTitle = document.getElementById('signalOutputTitle');
  const signalOutputDesc = document.getElementById('signalOutputDesc');

  if (state.activeAudioZone !== 'local' && state.activeDlnaDevice) {
    if (signalOutputIcon) signalOutputIcon.textContent = '📡';
    if (signalOutputTitle) signalOutputTitle.textContent = `${state.activeDlnaDevice.name} (DLNA / UPnP)`;
    if (signalOutputDesc) signalOutputDesc.textContent = `透過區網即時串流至 ${state.activeDlnaDevice.ip} (UPnP AVTransport)`;
  } else {
    if (signalOutputIcon) signalOutputIcon.textContent = '🔊';
    if (signalOutputTitle) signalOutputTitle.textContent = 'Windows WASAPI Exclusive / DirectSound';
    if (signalOutputDesc) signalOutputDesc.textContent = '輸出至本機預設音訊裝置';
  }

  if (isDsd) {
    const dsdRate = track.sampleRate ? `${(track.sampleRate / 1000000).toFixed(1)}MHz` : '2.8MHz';
    signalPathBadge.textContent = `ENHANCED | DSD ➔ 24/88.2kHz FLAC`;
    document.getElementById('signalSourceTitle').textContent = `DSD (1-bit / ${dsdRate}) — ${track.title}`;
    if (statusPill) statusPill.textContent = 'ENHANCED (HIGH PRECISION TRANSCODE)';
    if (sourceDesc) sourceDesc.textContent = '原始 DSD 母帶碼流 (Bitstream 1-bit PDM)';
    if (engineTitle) engineTitle.textContent = 'rooPlayer DSD-to-PCM Audio Engine';
    if (engineDesc) engineDesc.textContent = '64-bit 浮點即時降採樣 (Decimation Filter) ➔ 24-bit 88.2kHz FLAC';
  } else {
    const sampleKhz = track.sampleRate ? Math.round(track.sampleRate / 1000) : 44;
    const bitDepth = track.bitsPerSample || 16;
    const isLossless = track.isLossless || track.formatName === 'FLAC';
    signalPathBadge.textContent = `${isLossless ? 'LOSSLESS' : 'ENHANCED'} | ${track.formatName} ${bitDepth}/${sampleKhz}kHz`;
    document.getElementById('signalSourceTitle').textContent = `${track.formatName} ${bitDepth}-bit / ${sampleKhz}kHz (${track.title})`;
    if (statusPill) statusPill.textContent = isLossless ? 'LOSSLESS BIT-PERFECT' : 'ENHANCED';
    if (sourceDesc) sourceDesc.textContent = '原始母帶音訊源 (Bit-Perfect Lossless)';
    if (engineTitle) engineTitle.textContent = 'rooPlayer Core Audio Engine';
    if (engineDesc) engineDesc.textContent = '64-bit 浮點無損混音核心，零採樣損失處理';
  }

  // 1. Play audio via DLNA if a network zone is selected
  if (state.activeAudioZone !== 'local' && state.activeDlnaDevice) {
    isCurrentDsd = false;
    currentDsdOffset = 0;
    stopVirtualProgress();
    stopDemoSynth();
    nativeAudio.pause();

    if (track.isDemo || !track.filePath) {
      showToast('⚠️ 示範音訊為合成示範曲，請選取本機音樂庫檔案進行 DLNA 串流播放');
      state.isPlaying = false;
      btnPlayPause.textContent = '▶';
      updateQueueActiveItem();
      return;
    }

    if (window.electronAPI && window.electronAPI.playDlnaTrack) {
      window.electronAPI.playDlnaTrack(state.activeDlnaDevice.id, track, 0).then(res => {
        if (res && res.success) {
          state.isPlaying = true;
          btnPlayPause.textContent = '⏸';
          const dur = track.duration || 0;
          totalTimeLabel.textContent = formatDuration(dur);
          currentTimeLabel.textContent = '0:00';
          scrubberFill.style.width = '0%';
          showToast(`📡 正在串流至 ${state.activeDlnaDevice.name}: ${track.title}`);
        } else {
          console.error('DLNA playTrack error:', res);
          showToast(`❌ DLNA 播放失敗: ${res ? res.error : '未知錯誤'}`);
          state.isPlaying = false;
          btnPlayPause.textContent = '▶';
        }
      }).catch(err => {
        console.error('DLNA play error:', err);
        showToast(`❌ 串流發送失敗: ${err.message}`);
        state.isPlaying = false;
        btnPlayPause.textContent = '▶';
      });
    }

    updateQueueActiveItem();
    return;
  }

  // Play audio
  if (track.isDemo || !track.filePath) {
    isCurrentDsd = false;
    currentDsdOffset = 0;
    playDemoSynth(track);
    state.isPlaying = true;
    btnPlayPause.textContent = '⏸';
    startVirtualProgress(track.duration || 300);
  } else if (isDsd && window.electronAPI && window.electronAPI.getDsdStreamUrl) {
    stopVirtualProgress();
    stopDemoSynth();
    playDsdTrack(track, 0);
  } else {
    isCurrentDsd = false;
    currentDsdOffset = 0;
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
      if (window.electronAPI && window.electronAPI.pauseDlna) {
        window.electronAPI.pauseDlna(state.activeDlnaDevice.id);
      }
      state.isPlaying = false;
      btnPlayPause.textContent = '▶';
    } else {
      if (window.electronAPI && window.electronAPI.resumeDlna) {
        window.electronAPI.resumeDlna(state.activeDlnaDevice.id);
      }
      state.isPlaying = true;
      btnPlayPause.textContent = '⏸';
    }
    return;
  }

  if (state.isPlaying) {
    if (currentTrack.isDemo || !currentTrack.filePath) {
      stopDemoSynth();
      pauseVirtualProgress();
    } else {
      nativeAudio.pause();
    }
    state.isPlaying = false;
    btnPlayPause.textContent = '▶';
  } else {
    if (currentTrack.isDemo || !currentTrack.filePath) {
      playDemoSynth(currentTrack);
      resumeVirtualProgress();
    } else {
      nativeAudio.play();
    }
    state.isPlaying = true;
    btnPlayPause.textContent = '⏸';
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

  // If user is more than 3 seconds into the track, replay the current track
  const track = state.queue[state.currentTrackIndex];
  const isLocalFile = track && !track.isDemo && track.filePath;
  const currentSec = (state.activeAudioZone !== 'local')
    ? state.dlnaCurrentSec
    : (isCurrentDsd
      ? (currentDsdOffset + nativeAudio.currentTime)
      : ((isLocalFile && nativeAudio.duration) ? nativeAudio.currentTime : virtualCurrentSec));

  if (currentSec > 3) {
    if (state.activeAudioZone !== 'local' && state.activeDlnaDevice) {
      if (window.electronAPI && window.electronAPI.seekDlna) {
        window.electronAPI.seekDlna(state.activeDlnaDevice.id, 0);
      }
      currentTimeLabel.textContent = formatDuration(0);
      scrubberFill.style.width = '0%';
    } else if (isCurrentDsd) {
      playDsdTrack(track, 0);
    } else if (isLocalFile && nativeAudio.src) {
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
        if (state.activeAudioZone !== 'local' && state.activeDlnaDevice) {
          if (window.electronAPI && window.electronAPI.seekDlna) {
            window.electronAPI.seekDlna(state.activeDlnaDevice.id, 0);
          }
          currentTimeLabel.textContent = formatDuration(0);
          scrubberFill.style.width = '0%';
        } else if (isCurrentDsd) {
          playDsdTrack(track, 0);
        } else if (isLocalFile && nativeAudio.src) {
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
  btnPlayPause.textContent = '▶';
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
    } else if (track && !track.isDemo && track.filePath && nativeAudio.src) {
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
nativeAudio.addEventListener('timeupdate', () => {
  if (state.activeAudioZone !== 'local') return;
  const track = state.queue[state.currentTrackIndex];
  if (!track) return;

  if (isCurrentDsd) {
    const current = currentDsdOffset + nativeAudio.currentTime;
    const total = track.duration || 300;
    const percent = Math.min(100, (current / total) * 100);
    scrubberFill.style.width = `${percent}%`;
    currentTimeLabel.textContent = formatDuration(current);
    totalTimeLabel.textContent = formatDuration(total);

    if (current >= total && total > 0) {
      onTrackEnded();
    }
  } else {
    if (!nativeAudio.duration) return;
    const current = nativeAudio.currentTime;
    const total = nativeAudio.duration;
    const percent = (current / total) * 100;
    scrubberFill.style.width = `${percent}%`;
    currentTimeLabel.textContent = formatDuration(current);
    totalTimeLabel.textContent = formatDuration(total);
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

  if (track.isDemo || !track.filePath) {
    virtualCurrentSec = Math.floor(ratio * virtualTotalSec);
    currentTimeLabel.textContent = formatDuration(virtualCurrentSec);
    scrubberFill.style.width = `${ratio * 100}%`;
  } else if (isCurrentDsd) {
    const targetSec = Math.floor(ratio * (track.duration || 300));
    playDsdTrack(track, targetSec);
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

// ----------------- Search Logic -----------------
function setupSearch() {
  const searchInput = document.getElementById('globalSearch');
  const btnClear = document.getElementById('btnClearSearch');

  searchInput.addEventListener('input', (e) => {
    const val = e.target.value.trim();
    btnClear.style.display = val ? 'block' : 'none';
    handleSearch(val);
  });

  btnClear.addEventListener('click', () => {
    searchInput.value = '';
    btnClear.style.display = 'none';
    handleSearch('');
  });
}

function handleSearch(query) {
  const q = query.toLowerCase();
  if (!q) {
    renderAlbums();
    renderTracks();
    return;
  }

  // Clear genre filter banner when typing explicit search
  state.activeGenreFilter = null;
  const bannerBox = document.getElementById('genreFilterBannerBox');
  if (bannerBox) bannerBox.innerHTML = '';

  const matchedAlbums = state.albums.filter(a =>
    a.title.toLowerCase().includes(q) ||
    a.artist.toLowerCase().includes(q) ||
    (a.genre && a.genre.toLowerCase().includes(q)) ||
    matchItemGenre(a, q)
  );

  allAlbumsGrid.innerHTML = '';
  if (matchedAlbums.length === 0) {
    allAlbumsGrid.innerHTML = '<div style="grid-column: 1/-1; padding: 40px; text-align: center; color: var(--text-muted);">未找到相符的專輯</div>';
  } else {
    matchedAlbums.forEach(alb => allAlbumsGrid.appendChild(createAlbumCard(alb)));
  }

  if (state.currentView !== 'albums' && state.currentView !== 'tracks') {
    document.querySelector('[data-view="albums"]').click();
  }
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
    if (state.tracks.length > 0) {
      playTrackList(state.tracks, 0);
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

  // Signal Path Modal
  btnSignalPath.addEventListener('click', () => {
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
    btnPlayPause.textContent = '▶';
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

// Start application
window.addEventListener('DOMContentLoaded', initApp);
