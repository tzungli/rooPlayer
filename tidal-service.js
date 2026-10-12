// ==========================================================
// rooPlayer - TIDAL High-Resolution Streaming Subsystem
// Audiophile-Grade Master / Hi-Res Lossless FLAC Engine
// ==========================================================

class TidalService {
  constructor() {
    this.auth = null;
    this.isLoggedIn = false;
    this.user = null;
    this.countryCode = 'TW';
    this.cachedFavorites = null;
    this.cachedPlaylists = [];
  }

  /**
   * Initialize Tidal service from stored credentials
   */
  async init() {
    try {
      if (window.electronAPI && window.electronAPI.tidalGetStoredAuth) {
        const stored = await window.electronAPI.tidalGetStoredAuth();
        if (stored && stored.accessToken) {
          this.auth = stored;
          this.countryCode = stored.countryCode || 'TW';
          this.isLoggedIn = true;
          // Verify session in background
          this.verifySession().catch(err => {
            console.warn('[TIDAL] Stored session verification warning:', err);
          });
          return true;
        }
      }
    } catch (e) {
      console.warn('[TIDAL] Failed to initialize stored auth:', e);
    }
    return false;
  }

  /**
   * Verify if current accessToken is valid and retrieve user session
   */
  async verifySession() {
    if (!this.auth || !this.auth.accessToken) {
      this.isLoggedIn = false;
      return false;
    }
    try {
      const res = await this.api('/sessions');
      if (res && (res.userId || res.sessionId)) {
        this.user = res;
        this.countryCode = res.countryCode || this.countryCode;
        this.isLoggedIn = true;
        return true;
      }
    } catch (err) {
      console.warn('[TIDAL] Session check failed:', err);
    }
    return false;
  }

  /**
   * Open native Electron window to log into TIDAL officially
   */
  async loginWithWindow() {
    if (!window.electronAPI || !window.electronAPI.tidalLoginWithWindow) {
      throw new Error('Electron API 不可用');
    }
    const res = await window.electronAPI.tidalLoginWithWindow();
    if (res && res.success && res.auth) {
      this.auth = res.auth;
      this.countryCode = res.auth.countryCode || 'TW';
      this.isLoggedIn = true;
      await this.verifySession();
      return { success: true, user: this.user, auth: this.auth };
    }
    throw new Error(res ? res.error : '登入已取消');
  }

  /**
   * Save custom/manual Access Token
   */
  async saveManualToken(token, userId = '', countryCode = 'TW') {
    if (!token || !token.trim()) throw new Error('Token 不能為空');
    const authData = {
      accessToken: token.trim(),
      userId: (userId || '').trim(),
      countryCode: (countryCode || 'TW').trim().toUpperCase(),
      updatedAt: new Date().toISOString()
    };
    if (window.electronAPI && window.electronAPI.tidalSaveAuth) {
      await window.electronAPI.tidalSaveAuth(authData);
    }
    this.auth = authData;
    this.countryCode = authData.countryCode;
    this.isLoggedIn = true;
    await this.verifySession();
    return true;
  }

  /**
   * Logout and clear credentials
   */
  async logout() {
    this.auth = null;
    this.isLoggedIn = false;
    this.user = null;
    this.cachedFavorites = null;
    this.cachedPlaylists = [];
    if (window.electronAPI && window.electronAPI.tidalLogout) {
      await window.electronAPI.tidalLogout();
    }
  }

  /**
   * Universal API call helper
   */
  async api(endpoint, params = {}, method = 'GET', body = null) {
    if (!this.auth || !this.auth.accessToken) {
      throw new Error('TIDAL 尚未登入');
    }

    const queryParams = new URLSearchParams();
    if (this.countryCode && !endpoint.includes('countryCode=')) {
      queryParams.set('countryCode', this.countryCode);
    }
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) queryParams.set(k, String(v));
    }

    const qs = queryParams.toString();
    const finalEndpoint = endpoint.includes('?') 
      ? `${endpoint}${qs ? '&' + qs : ''}` 
      : (qs ? `${endpoint}?${qs}` : endpoint);

    if (window.electronAPI && window.electronAPI.tidalApi) {
      return await window.electronAPI.tidalApi({
        endpoint: finalEndpoint,
        method,
        body,
        token: this.auth.accessToken
      });
    }

    // Direct fetch fallback
    const url = finalEndpoint.startsWith('http') 
      ? finalEndpoint 
      : `https://api.tidal.com/v1${finalEndpoint}`;

    const headers = {
      'Authorization': `Bearer ${this.auth.accessToken}`,
      'Content-Type': 'application/json'
    };

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });

    if (!res.ok) {
      throw new Error(`TIDAL API HTTP ${res.status}: ${res.statusText}`);
    }
    return await res.json();
  }

  // ==========================================================
  // Catalog Discovery & Search
  // ==========================================================

  async search(query, limit = 20) {
    if (!query || !query.trim()) return { albums: [], tracks: [], artists: [], playlists: [] };
    const res = await this.api('/search', { query: query.trim(), limit });
    return {
      albums: (res.albums && res.albums.items) ? res.albums.items.map(a => this.normalizeAlbum(a)) : [],
      tracks: (res.tracks && res.tracks.items) ? res.tracks.items.map(t => this.normalizeTrack(t)) : [],
      artists: (res.artists && res.artists.items) ? res.artists.items : [],
      playlists: (res.playlists && res.playlists.items) ? res.playlists.items : []
    };
  }

  async getAlbum(albumId) {
    const album = await this.api(`/albums/${albumId}`);
    const itemsRes = await this.api(`/albums/${albumId}/items`, { limit: 100 });
    const tracks = (itemsRes && itemsRes.items) 
      ? itemsRes.items.map(item => this.normalizeTrack(item.item || item, album))
      : [];
    return {
      album: this.normalizeAlbum(album),
      tracks
    };
  }

  async getArtist(artistId) {
    const artist = await this.api(`/artists/${artistId}`);
    const albums = await this.getArtistAlbums(artistId, 50);
    return {
      artist,
      albums
    };
  }

  async getArtistAlbums(artistId, limit = 50) {
    const albumsRes = await this.api(`/artists/${artistId}/albums`, { limit });
    return (albumsRes && albumsRes.items) ? albumsRes.items.map(a => this.normalizeAlbum(a.item || a)) : [];
  }

  async searchArtist(artistName) {
    if (!artistName || !artistName.trim()) return null;
    const res = await this.search(artistName.trim(), 5);
    if (res && res.artists && res.artists.length > 0) {
      return res.artists[0];
    }
    return null;
  }

  async searchAlbumVersions(albumTitle, artistName = '') {
    if (!albumTitle || !albumTitle.trim()) return [];
    const query = `${albumTitle.trim()} ${artistName ? artistName.trim() : ''}`.trim();
    const res = await this.search(query, 10);
    return res.albums || [];
  }

  // ==========================================================
  // User Collection (Favorites & Playlists)
  // ==========================================================

  async getFavoriteAlbums(limit = 50, offset = 0) {
    const userId = this.auth?.userId || (this.user?.userId);
    if (!userId) throw new Error('缺少使用者 ID');
    const res = await this.api(`/users/${userId}/favorites/albums`, { limit, offset, order: 'DATE', orderDirection: 'DESC' });
    return (res && res.items) ? res.items.map(item => this.normalizeAlbum(item.item || item.album || item)) : [];
  }

  async getFavoriteTracks(limit = 100, offset = 0) {
    const userId = this.auth?.userId || (this.user?.userId);
    if (!userId) throw new Error('缺少使用者 ID');
    const res = await this.api(`/users/${userId}/favorites/tracks`, { limit, offset, order: 'DATE', orderDirection: 'DESC' });
    return (res && res.items) ? res.items.map(item => this.normalizeTrack(item.item || item.track || item)) : [];
  }

  async getFavoriteArtists(limit = 50, offset = 0) {
    const userId = this.auth?.userId || (this.user?.userId);
    if (!userId) throw new Error('缺少使用者 ID');
    const res = await this.api(`/users/${userId}/favorites/artists`, { limit, offset });
    return (res && res.items) ? res.items.map(item => item.item || item.artist || item) : [];
  }

  async getUserPlaylists() {
    const userId = this.auth?.userId || (this.user?.userId);
    if (!userId) throw new Error('缺少使用者 ID');
    const res = await this.api(`/users/${userId}/playlists`, { limit: 50 });
    return (res && res.items) ? res.items : [];
  }

  async getPlaylistTracks(playlistUuid) {
    const res = await this.api(`/playlists/${playlistUuid}/items`, { limit: 100 });
    return (res && res.items) ? res.items.map(item => this.normalizeTrack(item.item || item)) : [];
  }

  // ==========================================================
  // Audio Playback & Stream Manifest Resolution
  // ==========================================================

  async getTrackStreamUrl(trackId, preferredQuality = 'LOSSLESS') {
    const endpoint = `/tracks/${trackId}/playbackinfopostpaywall`;
    const params = {
      audioquality: preferredQuality,
      playbackmode: 'STREAM',
      assetpresentation: 'FULL'
    };

    try {
      const info = await this.api(endpoint, params);
      if (!info) throw new Error('無法取得串流播放資訊');

      // 1. DASH Manifest (Official TIDAL Web / Desktop Bit-Perfect Stream)
      if (info.manifestMimeType === 'application/dash+xml' && info.manifest) {
        if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.tidalGetStreamUrl) {
          const res = await window.electronAPI.tidalGetStreamUrl(trackId, info);
          if (res && res.streamUrl) {
            return {
              url: res.streamUrl,
              filePath: res.filePath || null,
              mimeType: 'audio/flac',
              codecs: 'flac',
              bitDepth: info.bitDepth || 16,
              sampleRate: info.sampleRate || 44100,
              audioQuality: info.audioQuality || preferredQuality
            };
          }
        }
      }

      // 2. Direct BTS manifest (Lossless / Hi-Res FLAC)
      if (info.manifestMimeType === 'application/vnd.tidal.bts' && info.manifest) {
        try {
          const btsJson = JSON.parse(atob(info.manifest));
          if (btsJson.urls && btsJson.urls.length > 0) {
            return {
              url: btsJson.urls[0],
              mimeType: btsJson.mimeType || 'audio/flac',
              codecs: btsJson.codecs || 'flac',
              bitDepth: info.bitDepth || 16,
              sampleRate: info.sampleRate || 44100,
              audioQuality: info.audioQuality || preferredQuality
            };
          }
        } catch (e) {
          console.warn('[TIDAL] Failed to decode BTS manifest:', e);
        }
      }

      // 3. Direct URL fallback
      if (info.urls && info.urls[0]) {
        return {
          url: info.urls[0],
          mimeType: 'audio/flac',
          audioQuality: info.audioQuality || preferredQuality
        };
      }

      // 4. Fallback: try LOSSLESS if HI_RES_LOSSLESS was unavailable
      if (preferredQuality === 'HI_RES_LOSSLESS') {
        return await this.getTrackStreamUrl(trackId, 'LOSSLESS');
      }

      throw new Error(info.error || '未找到合適的音訊串流連結');
    } catch (err) {
      console.error('[TIDAL] Get stream error for track', trackId, err);
      throw err;
    }
  }

  // ==========================================================
  // Catalog Discovery & Curated Collections
  // ==========================================================

  async getHomeModules(deviceType = 'TABLET') {
    return await this.api('/pages/home', { deviceType });
  }

  async getNewReleases(limit = 30) {
    try {
      const home = await this.getHomeModules('TABLET');
      if (home && home.rows) {
        const albMod = home.rows.flatMap(r => r.modules || []).find(m => m.type === 'ALBUM_LIST');
        if (albMod && albMod.pagedList && albMod.pagedList.items) {
          return albMod.pagedList.items.slice(0, limit).map(a => this.normalizeAlbum(a));
        }
      }
    } catch (e) {
      console.warn('[TIDAL] getHomeModules failed, falling back to search:', e);
    }
    const searchRes = await this.search('2026', limit);
    return searchRes.albums || [];
  }

  async getHiResPicks(curatedTag = 'audiophile', limit = 30) {
    const queries = {
      audiophile: 'Audiophile Hi-Res Master',
      vocal: 'Vocal Audiophile',
      classical: 'Deutsche Grammophon Classical',
      jazz: 'Blue Note Jazz',
      pop: 'Master Hits'
    };
    const q = queries[curatedTag] || queries.audiophile;
    const res = await this.search(q, limit);
    return res.albums || [];
  }

  async getOfficialPlaylists(category = 'audiophile', limit = 30) {
    const queries = {
      audiophile: 'Audiophile Hi-Res Master',
      masters: 'TIDAL Masters',
      relax: 'Relax Acoustic Chill',
      vocal: 'Audiophile Vocal',
      jazz: 'Blue Note Jazz Masters',
      classical: 'Classical Masterpieces',
      top: 'TIDAL Hits'
    };
    const q = queries[category] || queries.audiophile;
    const res = await this.search(q, limit);
    return res.playlists || [];
  }

  async getPlaylist(playlistUuid) {
    const playlist = await this.api(`/playlists/${playlistUuid}`);
    const tracks = await this.getPlaylistTracks(playlistUuid);
    return {
      playlist,
      tracks
    };
  }

  // Cover image helper
  getCoverUrl(coverId, size = 640) {
    if (!coverId) return '';
    const cleanId = String(coverId).replace(/-/g, '/');
    return `https://resources.tidal.com/images/${cleanId}/${size}x${size}.jpg`;
  }

  // Data Normalization to rooPlayer unified Track / Album format
  normalizeTrack(t, parentAlbum = null) {
    if (!t) return null;
    const artists = (t.artists && Array.isArray(t.artists)) 
      ? t.artists.map(a => a.name).join(', ') 
      : (t.artist ? t.artist.name : 'Unknown Artist');

    const albumTitle = parentAlbum ? parentAlbum.title : (t.album ? t.album.title : 'TIDAL Album');
    const coverId = parentAlbum ? (parentAlbum.cover || parentAlbum.coverId) : (t.album ? t.album.cover : null);
    const coverUrl = this.getCoverUrl(coverId, 640);

    const hasHiresTag = (t.mediaMetadata && t.mediaMetadata.tags && t.mediaMetadata.tags.includes('HIRES_LOSSLESS')) ||
                        (parentAlbum?.mediaMetadata?.tags && parentAlbum.mediaMetadata.tags.includes('HIRES_LOSSLESS'));
    const quality = (hasHiresTag || t.audioQuality === 'HI_RES_LOSSLESS' || t.audioQuality === 'HIRES' || (t.audioModes && t.audioModes.includes('HIRES_LOSSLESS'))) 
      ? 'HI_RES_LOSSLESS' 
      : (t.audioQuality || 'LOSSLESS');
    const qualityLabel = (quality === 'HI_RES_LOSSLESS' || quality === 'HIRES') ? 'Hi-Res FLAC' : 'Lossless FLAC';

    return {
      id: `tidal_${t.id}`,
      tidalId: t.id,
      isTidal: true,
      title: t.title || 'Unknown Title',
      artist: artists,
      album: albumTitle,
      duration: t.duration || 0,
      trackNumber: t.trackNumber || 1,
      discNumber: t.volumeNumber || 1,
      cover: coverUrl,
      year: t.streamStartDate ? new Date(t.streamStartDate).getFullYear() : (t.album?.releaseDate ? new Date(t.album.releaseDate).getFullYear() : ''),
      formatName: 'FLAC',
      audioQuality: quality,
      qualityLabel: qualityLabel,
      sampleRate: (quality === 'HI_RES_LOSSLESS' || quality === 'HIRES') ? 96000 : 44100,
      bitsPerSample: (quality === 'HI_RES_LOSSLESS' || quality === 'HIRES') ? 24 : 16,
      channels: 2
    };
  }

  normalizeAlbum(a) {
    if (!a) return null;
    const artists = (a.artists && Array.isArray(a.artists)) 
      ? a.artists.map(ar => ar.name).join(', ') 
      : (a.artist ? a.artist.name : 'Unknown Artist');

    const coverUrl = this.getCoverUrl(a.cover, 640);
    const hasHiresTag = (a.mediaMetadata && a.mediaMetadata.tags && a.mediaMetadata.tags.includes('HIRES_LOSSLESS'));
    const quality = (hasHiresTag || a.audioQuality === 'HI_RES_LOSSLESS' || a.audioQuality === 'HIRES' || (a.audioModes && a.audioModes.includes('HIRES_LOSSLESS'))) 
      ? 'HI_RES_LOSSLESS' 
      : (a.audioQuality || 'LOSSLESS');
    const qualityLabel = (quality === 'HI_RES_LOSSLESS' || quality === 'HIRES') ? 'Hi-Res 24-bit' : 'Lossless 16-bit';

    return {
      id: `tidal_album_${a.id}`,
      tidalId: a.id,
      isTidal: true,
      title: a.title || 'Unknown Album',
      artist: artists,
      cover: coverUrl,
      coverId: a.cover,
      year: a.releaseDate ? new Date(a.releaseDate).getFullYear() : '',
      releaseDate: a.releaseDate || '',
      numberOfTracks: a.numberOfTracks || 0,
      duration: a.duration || 0,
      audioQuality: quality,
      qualityLabel: qualityLabel,
      type: a.type || 'ALBUM',
      mediaMetadata: a.mediaMetadata,
      copyright: a.copyright || '',
      label: a.copyright ? a.copyright.replace(/^[℗©pPcC0-9\s,\.\-]+/, '').replace(/(under exclusive license to|licensed to|a division of).*$/i, '').trim() : ''
    };
  }
}

if (typeof window !== 'undefined') {
  window.TidalService = TidalService;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TidalService;
}
