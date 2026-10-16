/* rooPlayer 說明頁（About）的英文版本
 * index.html 的說明頁各區塊都標了 data-i18n-html="key"；語言選到 English 時，
 * i18n.js 會把這些區塊整段換成下面對應的英文（換回中文時原樣還原）。
 * 這裡的英文與中文內容一段對一段，結構（badge / h4 / ul / strong / code）保持一致。
 */
(function () {
  'use strict';

  const DOC_EN = {
    // ================= 說明頁：各選單操作手冊 =================
    'about.manual.title': `<span class="title-icon">📖</span>
              <h3>Menu features &amp; user manual</h3>`,

    'about.manual.intro': `
              rooPlayer is built as an intuitive modular system that fuses your local lossless collection with advanced DSP upsampling, parametric equalization, convolution filtering and network streaming. Detailed instructions for every menu follow:
            `,

    'about.manual.langnote': `
              <strong>Interface language</strong>: the <strong>🌐 language button</strong> to the right of the dark/light button in the top bar switches between 繁體中文 and English. Every menu, button, table header, tooltip, toast message and confirmation dialog — and this manual — follow the selection, and your choice is remembered. Track titles, artist names, file paths and your own custom filter names are never translated.
            `,

    'about.manual.m1': `<div class="manual-item-header">
                  <span class="item-badge">Overview</span>
                  <h4>Home overview (Overview)</h4>
                </div>
                <div class="manual-item-body">
                  <p>The dashboard of your music library. It collects <strong>album count, track count and Hi-Res lossless statistics</strong> for the current library, with local and online streaming integrated side by side:</p>
                  <ul>
                    <li><strong>🕒 Recently Played</strong>: lists the last 5 albums you played, with the full play history available in one click.</li>
                    <li><strong>🆕 Recently Added Albums</strong>: keeps your newest local imports and TIDAL albums added to the library in sync automatically.</li>
                    <li><strong>🌟 Daily Picks</strong>: selects 5 audiophile recommendations from your listening history, refreshed every day.</li>
                    <li><strong>📖 Artist Spotlight</strong>: explore a master’s life story, signature works and related audiophile recordings at random.</li>
                    <li><strong>🎤 Explore Artists</strong>: artist cards from your library are sampled at random; one click opens the artist page and their albums.</li>
                  </ul>
                </div>`,

    'about.manual.m2': `<div class="manual-item-header">
                  <span class="item-badge">Browsing</span>
                  <h4>Albums, artists and track lists (Albums / Artists / Tracks)</h4>
                </div>
                <div class="manual-item-body">
                  <p>Multi-dimensional browsing with fully customizable visual layout:</p>
                  <ul>
                    <li><strong>Sorted by date added (default)</strong>: the album library opens newest-first; you can also sort by album name A-Z, artist A-Z, release year, track count and play count.</li>
                    <li><strong>Cover size (small / medium / large)</strong>: the album library, artist avatars, <strong>genres</strong> and the TIDAL explorer all expose size controls in their header, so you can switch between a dense grid and large audiophile cards. Each page remembers its own setting.</li>
                    <li><strong>Clean, immersive metadata</strong>: the album detail page shows artist, label, release year, track count and total length to the right of the cover, without cluttered backgrounds or borders.</li>
                    <li><strong>Related-artist and similar-album suggestions</strong>: same-genre album and artist suggestions automatically extend into TIDAL’s audiophile catalog (when signed in).</li>
                  </ul>
                </div>`,

    'about.manual.m3': `<div class="manual-item-header">
                  <span class="item-badge">Favorites</span>
                  <h4>Favorites (albums / tracks / artists)</h4>
                </div>
                <div class="manual-item-body">
                  <p>Your own audiophile selection:</p>
                  <ul>
                    <li>Tap the <strong>heart icon (♡)</strong> on any album card, track row or artist page to add it to Favorites.</li>
                    <li>The favorites pages offer “Play all favorites” and “Shuffle favorites” shortcuts.</li>
                    <li>Favorites can be exported as a backup at any time and re-imported with lossless de-duplication and merging.</li>
                  </ul>
                </div>`,

    'about.manual.m4': `<div class="manual-item-header">
                  <span class="item-badge" style="background: rgba(139, 92, 246, 0.16); color: #a78bfa; border: 1px solid rgba(139, 92, 246, 0.35);">Playlists</span>
                  <h4>Playlists (save / import / edit / delete)</h4>
                </div>
                <div class="manual-item-body">
                  <p>The <strong>Playlists</strong> page sits under “Play History” in the left menu, where you build and order your own track lists:</p>
                  <ul>
                    <li><strong>💾 Save</strong>: press “Save playlist” above the play queue to store every song currently queued, <strong>in order</strong>, as a named playlist. You can also create an empty playlist with “New playlist”, or append the current queue to an existing playlist with “Add current queue”.</li>
                    <li><strong>📥 Import / export</strong>: import <code>.m3u</code> / <code>.m3u8</code> / <code>.json</code> playlist files (paths that are not in your library keep their file path, and artist and title are separated automatically); export a playlist as M3U8 for other players, or as JSON for a complete backup that rooPlayer can re-import.</li>
                    <li><strong>✏️ Edit</strong>: every track in a playlist offers <strong>move up ↑ / move down ↓ / remove this track ✕</strong>, and playback follows the order you set. Renaming is supported; two playlists never share the same name.</li>
                    <li><strong>🗑️ Delete</strong>: delete a whole playlist (only the playlist is removed; the songs stay in your library).</li>
                    <li><strong>▶ Play in order / 🔀 Shuffle</strong>: the playlist loads straight into the play queue — works with local playback, exclusive output and DLNA streaming alike.</li>
                  </ul>
                </div>`,

    'about.manual.m5': `<div class="manual-item-header">
                  <span class="item-badge" style="background: rgba(0, 229, 255, 0.15); color: #00e5ff; border: 1px solid rgba(0, 229, 255, 0.3);">Hi-Res streaming</span>
                  <h4>TIDAL streaming explorer (TIDAL Hi-Res Explorer)</h4>
                </div>
                <div class="manual-item-body">
                  <p>Natively integrated with TIDAL’s catalog of master-grade Hi-Res MAX lossless streaming:</p>
                  <ul>
                    <li><strong>💎 Audiophile picks (Hi-Res Masters)</strong>: category chips filter audiophile reference recordings, audiophile vocals, classical and symphonic, classic jazz and Western hits in one click.</li>
                    <li><strong>🆕 New releases</strong>: high-dynamics lossless master albums released worldwide at the same time.</li>
                    <li><strong>📑 Official themed playlists</strong>: curated audiophile review, high-dynamics test and mood/easy-listening collections.</li>
                    <li><strong>❤️ My collection</strong>: connect your TIDAL account and sync your favorite albums, tracks and your own cloud playlists.</li>
                    <li><strong>🖼️ Cover size (small / medium / large)</strong>: the sub-navigation bar has its own cover-size switch so you can adjust the grid freely.</li>
                    <li><strong>Play a whole album or add it to your library</strong>: play or queue an entire album in one click, and add TIDAL albums to your local library to manage them together.</li>
                  </ul>
                </div>`,

    'about.manual.m6': `<div class="manual-item-header">
                  <span class="item-badge" style="background: rgba(37, 213, 255, 0.15); color: #25d5ff; border: 1px solid rgba(37, 213, 255, 0.3);">Online streaming</span>
                  <h4>KKBOX streaming center (KKBOX Streaming)</h4>
                </div>
                <div class="manual-item-body">
                  <p>The KKBOX interface rebuilt on the same audiophile layout, connected to Mandarin and global pop catalogs:</p>
                  <ul>
                    <li><strong>🏆 Live charts</strong>: its own sub-navigation tab with real-time Mandarin, Western, Japanese/Korean, hip-hop, rock, jazz and classical charts.</li>
                    <li><strong>✨ Featured and 🆕 new hits</strong>: official themed selections, mood compilations and the newest releases as they break.</li>
                    <li><strong>Play the whole chart or queue it</strong>: dynamic cover banner, play-the-whole-chart in one click, and add the whole chart to the rooPlayer play queue.</li>
                    <li><strong>Live search</strong>: search songs, artists and albums in the KKBOX catalog in real time.</li>
                  </ul>
                </div>`,

    'about.manual.m7': `<div class="manual-item-header">
                  <span class="item-badge">Storage &amp; maintenance</span>
                  <h4>Local folders and library maintenance (Storage)</h4>
                </div>
                <div class="manual-item-body">
                  <p>Manage your local music folders and library backups:</p>
                  <ul>
                    <li><strong>Scan a local folder</strong>: pick the drive folders that hold your lossless audio; the engine batch-analyzes ID3 / FLAC / DSF metadata and cover art at high speed.</li>
                    <li><strong>💾 Export library</strong>: export every indexed music folder, track master metadata, favorites and play-count statistics to a standard JSON backup.</li>
                    <li><strong>📥 Import library</strong>: import a backup and merge it with smart de-duplication. Existing folders and duplicate tracks are skipped automatically, with a <strong>detailed skip report</strong>.</li>
                  </ul>
                </div>`,

    'about.manual.m8': `<div class="manual-item-header">
                  <span class="item-badge">Core audiophile engine</span>
                  <h4>Signal path and upsampling engine (Signal Path &amp; DSP Engine)</h4>
                </div>
                <div class="manual-item-body">
                  <p>Click the audiophile star badge ⚡ above the player controls to open the signal-path window:</p>
                  <ul>
                    <li><strong>Left column (live signal path)</strong>: tracks every stage live — “source master ➔ upsampling engine ➔ parametric EQ ➔ convolution ➔ DLNA / local endpoint”. Active EQ and convolution stages are shown at the exact position where they apply in the path diagram.</li>
                    <li><strong>Right column (upsampling settings)</strong>:
                      <br>• <strong>PCM upsampling</strong>: 2x and 4x integer upsampling (recommended for the cleanest phase), plus fixed 96k / 192k / 384k DXD oversampling.
                      <br>• <strong>Nine filter phases</strong>: linear phase, minimum phase, gentle-decay hybrid, Gaussian long-impulse, Gaussian minimum phase, EXT2 approximation, and the PS-EXT2 interpreted FIR (steep rolloff, stop band down to -180 dB).
                      <br>• <strong>1-bit DSD modulation</strong>: built-in 2nd / 5th / 7th-order resonant noise-shaping delta-sigma modulators, with live conversion to DSD64 (2.8 MHz), DSD128 (5.6 MHz), DSD256 (11.2 MHz) or DSD512 (22.5 MHz).
                    </li>
                    <li><strong>Parametric EQ (PEQ)</strong>: tone shaping that is independent of the upsampling engine and works whether the engine is on or off (with the engine off it runs at the native sample rate, with no extra upsampling). Up to 6 fully parametric bands (low shelf / peak / high shelf / low pass / high pass / notch), five built-in tonal presets — flat, warm and dense, bright and open, vocal presence, bass saturation — plus <strong>6 named user slots</strong> for one-click recall of your own tuning. The automatic pre-trim protection guarantees that no gain combination ever clips, and band settings apply live to the playing track.</li>
                    <li><strong>Convolution filter (IR impulse response)</strong>: load an impulse-response WAV for high-precision convolution — room-correction FIR, speaker and headphone calibration, and similar uses. Partitioned frequency-domain convolution keeps even long impulse responses real-time; the IR is resampled to the playback rate automatically, mono IRs are applied to both channels, and an over-high response peak is attenuated automatically to prevent clipping. Processing happens after the parametric EQ; DSD sources are routed through a 24-bit 88.2 kHz path automatically.</li>
                    <li><strong>Progressive parallel conversion engine</strong>: long tracks are modulated by up to 8 parallel workers with automatic throttling to keep CPU usage stable; the converted audio is streamed to the endpoint as it is produced, so <strong>playback starts immediately without waiting for the whole track to convert</strong>.</li>
                  </ul>
                </div>`,

    'about.manual.m9': `<div class="manual-item-header">
                  <span class="item-badge">Streaming endpoints</span>
                  <h4>Audio output devices and network streaming (Audio Zones / DLNA / UPnP)</h4>
                </div>
                <div class="manual-item-body">
                  <p>Cast seamlessly to your living-room streamer, amplifier or network DAC:</p>
                  <ul>
                    <li>Click the <strong>output-device button (🔊/📡)</strong> on the right of the player controls; the system searches your LAN with SSDP for UPnP/DLNA renderers (Eversolo, WiIM, Linn and similar).</li>
                    <li><strong>Probe a specific IP</strong> is supported, so you can connect manually and quickly even when the router blocks UDP broadcasts.</li>
                    <li>Native DSF pass-through, 24-bit PCM upsampled streaming and PCM ➔ 1-bit DSD bitstream delivery are supported; the DAC locks the DSD clock automatically.</li>
                    <li>Parametric EQ and convolution apply to network streaming as well: when active, PCM is streamed as 24-bit and DSD sources are downsampled to 24-bit 88.2 kHz before streaming (with the engine in DSD modulation mode, DSF pass-through takes priority).</li>
                    <li>Streaming uses <strong>progressive generation with HTTP Range / back-pressure flow control</strong>: even when conversion is slower than real time, the endpoint never stutters or drops out.</li>
                    <li>When you switch tracks or quit the app, the endpoint <strong>stops immediately and discards its remaining buffered audio</strong>.</li>
                  </ul>
                </div>`,

    'about.manual.m10': `<div class="manual-item-header">
                  <span class="item-badge">Smart search</span>
                  <h4>Global real-time search (Global Audiophile Search)</h4>
                </div>
                <div class="manual-item-body">
                  <p>The search bar at the top performs millisecond cross-catalog search:</p>
                  <ul>
                    <li><strong>Combined local + online search</strong>: searches your local database and the online catalogs (TIDAL Hi-Res / KKBOX) at the same time.</li>
                    <li><strong>Tab filters</strong>: switch quickly between “All results”, “Local albums” and “Online streaming”.</li>
                    <li><strong>Smart highlighting</strong>: your keywords are matched live against artists, album titles, composers and audiophile formats.</li>
                  </ul>
                </div>`,

    'about.manual.m11': `<div class="manual-item-header">
                  <span class="item-badge">Playback experience</span>
                  <h4>Audiophile player bar and full-screen view (Player Controls &amp; Modal)</h4>
                </div>
                <div class="manual-item-body">
                  <p>A professional, immersive bottom playback bar:</p>
                  <ul>
                    <li><strong>Safe built-in artwork</strong>: when nothing is playing the bottom bar shows the rooPlayer mark instead of a missing file, so there is never a broken image.</li>
                    <li><strong>Full-screen details, live spectrum and scrolling lyrics</strong>: click the album cover on the left of the bar to open the full-screen view — large cover art, a <strong>live spectrum</strong> above the progress bar (driven directly by the source audio of the upsampling engine), live scrolling lyrics and an interactive track list on the right.</li>
                    <li><strong>Precise control and repeat modes</strong>: shuffle, repeat one, repeat all and off, with a live high-resolution format badge (for example LOSSLESS 24/96 FLAC).</li>
                    <li><strong>Smart resume on start</strong>: when the app opens, the player bar restores the last track you played so you can continue with one click.</li>
                  </ul>
                </div>`,

    // ================= 使用授權範圍 =================
    'about.license.title': `<span class="title-icon">📜</span>
              <h3>License &amp; scope of use</h3>`,

    'about.license.b1': `<h4>1. Personal and non-commercial use</h4>
                <p>
                  rooPlayer is developed in the spirit of the MIT license, for personal music lovers and audiophiles to play audio, manage master digital files and run digital signal processing (DSP) on a personal computer or home network, for non-commercial purposes.
                </p>`,

    'about.license.b2': `<h4>2. Third-party components and open-source notices</h4>
                <p>This software integrates advanced open-source projects and DSP algorithms; their intellectual property belongs to their respective authors:</p>
                <ul>
                  <li><strong>Electron Framework</strong>: cross-platform window runtime (Chromium / Node.js).</li>
                  <li><strong>@wasm-audio-decoders/flac</strong>: high-performance pure-local FLAC lossless decoding core in WebAssembly.</li>
                  <li><strong>music-metadata</strong>: pure-JavaScript audio header parsing and master metadata reading engine.</li>
                  <li><strong>rooPlayer Native DSP Kernel</strong>: our own 64-bit floating polyphase FIR upsampling filter, parametric EQ biquad chain, partitioned frequency-domain convolution engine and high-order 1-bit delta-sigma modulators — all implemented in this program, with no external DSP library.</li>
                </ul>`,

    'about.license.b3': `<h4>3. Streaming platform API terms</h4>
                <p>
                  The online catalog features use the public interface of the KKBOX Open API. All track rights, cover images and 30-second preview clips remain the property of KKBOX and its partner record labels. This program follows their terms strictly: it does not decrypt or record paid Widevine-DRM audio without authorization.
                </p>`,

    // ================= 免責聲明 =================
    'about.disclaimer.title': `<span class="title-icon">⚖️</span>
              <h3>Disclaimer</h3>`,

    'about.disclaimer.b1': `<h4>1. Audio hardware output and volume protection</h4>
                <p>
                  This software offers audiophile DSP oversampling upsampling, 1-bit DSD modulation and DLNA/UPnP network endpoint streaming. Very high sample rates (such as 384 kHz, DSD256 or DSD512) produce extremely wide frequency response and high-frequency energy, so before switching upsampling mode or changing a DAC, <strong>please set your amplifier or preamp volume to a safe level first</strong>, to avoid damage to speakers, headphones or hearing caused by device compatibility or transient spikes. The development team is not responsible for hardware damage caused by improper operation of audio equipment.
                </p>`,

    'about.disclaimer.b2': `<h4>2. Safety of your local audio files</h4>
                <p>
                  During library scanning, database import/export and playback, rooPlayer reads your original lossless audio files in <strong>read-only</strong> mode. Removing a folder from the database only deletes the software’s internal index cache; no audio file on your drives is deleted. Users should still keep regular backups of important master files.
                </p>`,

    'about.disclaimer.b3': `<h4>3. Software provided AS-IS</h4>
                <p>
                  This software is provided “as is”, without any express or implied warranty, including but not limited to fitness for a particular purpose, uninterrupted operation or error-free operation. To the maximum extent permitted by applicable law, the developers are not liable for any direct, indirect or consequential damages arising from the use of, or inability to use, this software.
                </p>`,

    // ================= 核心技術與發燒音訊規格 =================
    'about.tech.title': `<span class="title-icon">⚙️</span>
              <h3>Core technology and audiophile specifications (Audiophile Specifications)</h3>`,

    'about.tech.s1': `<span class="spec-label">Supported audio formats</span>
                <span class="spec-value">FLAC (24/192), WAV (32-bit Float), AIFF, DSF (DSD64/128/256/512), DFF, MP3, M4A, AAC, OGG</span>`,

    'about.tech.s2': `<span class="spec-label">PCM upsampling engine</span>
                <span class="spec-value">Our own 64-bit floating Native DSP kernel: high-order Hermite interpolation with nine filter phases (linear / minimum / gentle-decay hybrid, Gaussian long-impulse, Gaussian minimum phase, EXT2 approximation, PS-EXT2 interpreted FIR with a stop band down to -180 dB); polyphase pre-computed acceleration architecture; 2x / 4x integer upsampling, 96k, 192k, 384k DXD</span>`,

    'about.tech.s3': `<span class="spec-label">DSD modulator</span>
                <span class="spec-value">2nd / 5th / 7th-order resonant noise-shaping 1-bit delta-sigma modulator (2.8224 MHz ~ 22.5792 MHz, standard Sony DSF container, correct MSB-first bit order); parallel modulation on up to 8 worker cores, with each segment joined seamlessly using real warm-up audio</span>`,

    'about.tech.s4': `<span class="spec-label">Parametric EQ (PEQ)</span>
                <span class="spec-value">6 fully parametric biquad bands (low shelf / peak / high shelf / low pass / high pass / notch, 20 Hz ~ 20 kHz); 5 tonal presets and 6 named user slots; automatic pre-trim anti-clipping protection; works independently of the upsampling engine, running at the native sample rate when the engine is off</span>`,

    'about.tech.s5': `<span class="spec-label">Convolution filter (IR)</span>
                <span class="spec-value">Partitioned frequency-domain convolution (FFT 4096 / block 2048, impulse responses up to 262,144 taps); IR WAVs are resampled to the playback rate automatically, mono IRs are applied to both channels, and a response peak &gt; 1 is attenuated automatically to prevent clipping; processed after the PEQ in 64-bit floating point, preserving the linear-phase characteristic completely</span>`,

    'about.tech.s6': `<span class="spec-label">Network streaming architecture</span>
                <span class="spec-value">UPnP A/V Architecture v1.0, DLNA MediaRenderer, HTTP progressive streaming with Range &amp; back-pressure flow control (audio is streamed while it is generated, so playback does not break even when conversion is slower than real time)</span>`,

    'about.tech.s7': `<span class="spec-label">Local database</span>
                <span class="spec-value">High-speed JSON cache, multi-level automatic de-duplication by path and metadata, complete synchronization of favorites and play counts</span>`,
  };

  window.I18N_DOC_EN = DOC_EN;
})();
