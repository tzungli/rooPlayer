/* rooPlayer 介面語言（繁體中文 / English）
 *
 * 做法（不改動既有渲染邏輯）：
 * 1) I18N_TEXT：以「繁體中文原文」為鍵的英譯表。套用时把文字節點正規化後比對，命中就換成英文，
 *    原文記在 WeakMap，換回中文時原樣還原（前後空白也照原樣保留）。
 * 2) I18N_PATTERNS：已知含動態内容的字串（「共 12 個播放清單」…）用 regex 對應英文。
 * 3) 通用統計字串翻譯：「N 筆（N 張專輯，N 位演出者…）」這類純計數字串，拆段後逐段換成英文；
 *    任何一段不認識就整串不翻（保留中文），不會翻出半中半英的怪句子。
 * 4) I18N_DOC_EN（i18n-docs-en.js）：說明頁各段落以 data-i18n-html="key" 標記，整段換成英文。
 * 5) MutationObserver：動態渲染出來的中文（列表、副標、按鈕）一樣會被翻譯，
 *    所以不需要把 app.js 裡每個字串都改成 t()。
 * 語言選擇存在 localStorage（rooplayer_language），預設繁體中文。
 */
(function () {
  'use strict';

  const LANG_KEY = 'rooplayer_language';
  const CJK = /[\u3400-\u9fff\uf900-\ufaff]/;

  // ---------------- 文字對照表（鍵為正規化後的繁體中文原文） ----------------
  const I18N_TEXT = {
    // ===== 視窗與頂欄 =====
    '返回': 'Back', '前進': 'Forward',
    '搜尋演出者、專輯、曲目、作曲家...': 'Search artists, albums, tracks, composers...',
    '切換深色 / 淺色主題': 'Toggle dark / light theme',
    '深色': 'Dark', '淺色': 'Light',
    '選擇介面語言': 'Interface language',
    '最小化': 'Minimize', '最大化': 'Maximize', '關閉': 'Close',
    '切換檢視原文或繁體中文翻譯': 'Toggle original text or Chinese translation',
    '檢視原文': 'View original',

    // ===== 左側選單 =====
    '音樂庫 LIBRARY': 'LIBRARY',
    '總覽 Overview': 'Overview',
    '專輯 Albums': 'Albums',
    '演出者 Artists': 'Artists',
    '曲目 Tracks': 'Tracks',
    '曲風流派 Genres': 'Genres',
    '播放紀錄': 'Play History',
    '播放清單': 'Playlists',
    '我的最愛 FAVORITES': 'FAVORITES',
    '最愛專輯': 'Favorite Albums',
    '最愛歌曲': 'Favorite Tracks',
    '最愛演出者': 'Favorite Artists',
    '線上串流 STREAMING': 'STREAMING',
    '管理與設定 SETTINGS': 'SETTINGS & STORAGE',
    '本機資料夾管理': 'Local Folders',
    '說明': 'About',
    '未登入': 'Not signed in', '在線': 'Online', '離線': 'Offline',

    // ===== 總覽 =====
    '高解析音樂殿堂': 'High-Resolution Music Hall',
    '次世代發燒級數位音訊媒體庫與極致無損串流核心播放器': 'Next-generation audiophile digital audio library and reference lossless streaming player',
    '還原母帶級細節，探索無損音訊的極致聆聽體驗。': 'Restore master-grade detail and explore the ultimate lossless listening experience.',
    '點擊檢視播放紀錄': 'Open play history',
    '🕒 最近聆聽 Recent Played': '🕒 Recently Played',
    '檢視完整播放紀錄 ➔': 'View full play history ➔',
    '🆕 最近新增專輯': '🆕 Recently Added Albums',
    '瀏覽全部專輯 ➔': 'Browse all albums ➔',
    '🌟 每日推薦 Daily Recommendation': '🌟 Daily Picks',
    '📖 藝人生活誌 Artist Spotlight': '📖 Artist Spotlight',
    '隨機換一位 ↻': 'Shuffle to another artist ↻',
    '隨機換一位藝人': 'Show a random artist',
    '正在載入藝人生平簡介...': 'Loading artist biography...',
    '演出者名稱': 'Artist name',
    '查看演出者主頁 ➔': 'View artist page ➔',
    '▶ 播放該歌手所有歌曲': '▶ Play all tracks by this artist',
    '📀 相關精選專輯 Selected Albums': '📀 Selected Albums',
    '瀏覽全部演出者 ➔': 'Browse all artists ➔',
    '🎤 探索演出者 Artists': '🎤 Explore Artists',

    // ===== 專輯庫 =====
    '專輯庫 Albums': 'Album Library',
    '全部': 'All',
    'Hi-Res 24-bit': 'Hi-Res 24-bit',
    'FLAC 無損': 'FLAC Lossless',
    '最近新增': 'Recently Added',
    '依新增順序排列': 'Sort: Recently added',
    '依專輯名稱 A-Z': 'Sort: Album name A-Z',
    '依演出者 A-Z': 'Sort: Artist A-Z',
    '依發行年份 (新到舊)': 'Sort: Release year (newest first)',
    '依曲目數量': 'Sort: Track count',
    '依最常播放 (播放次數)': 'Sort: Most played (play count)',
    '預設排序': 'Default order',
    '依曲目長度': 'Sort: Track length',
    '依曲目名稱 A-Z': 'Sort: Track name A-Z',
    '封面尺寸：': 'Cover size:',
    '頭像尺寸：': 'Avatar size:',
    '小': 'Small', '中': 'Medium', '大': 'Large',
    '小尺寸封面': 'Small covers', '中尺寸封面 (預設)': 'Medium covers (default)', '大尺寸封面': 'Large covers',
    '小尺寸頭像': 'Small avatars', '中尺寸頭像 (預設)': 'Medium avatars (default)', '大尺寸頭像': 'Large avatars',

    // ===== 表格欄位 =====
    '時長': 'Length', '專輯': 'Album', '播放': 'Play', '演出者': 'Artist', '曲目名稱': 'Track',
    '格式規格': 'Format', '播放時間': 'Played at', '編輯': 'Edit', '操作': 'Actions',
    '曲目數': 'Tracks', '總時長': 'Total length', '更新時間': 'Updated', '清單名稱': 'Playlist',
    '格式': 'Format', '音訊規格': 'Audio spec',

    // ===== 播放紀錄 =====
    '播放紀錄 Playback History': 'Playback History',
    '▶ 依序播放': '▶ Play in order',
    '🔀 隨機播放': '🔀 Shuffle',
    '🗑️ 清除紀錄': '🗑️ Clear history',
    '尚未有任何播放紀錄': 'No playback history yet',
    '開始播放歌曲後，系統將自動記錄最近播放的 100 首曲目並由最近到最久排序。': 'Once you start playing, rooPlayer records your last 100 tracks, newest first.',

    // ===== 播放清單 =====
    '播放清單 Playlists': 'Playlists',
    '➕ 新增清單': '➕ New playlist',
    '💾 儲存目前隊列': '💾 Save current queue',
    '📥 匯入清單': '📥 Import playlist',
    '新增一個空白播放清單': 'Create an empty playlist',
    '將目前播放隊列的所有歌曲依序存成新的播放清單': 'Save every song in the current queue, in order, as a new playlist',
    '匯入 .m3u / .m3u8 / .json 播放清單檔': 'Import a .m3u / .m3u8 / .json playlist file',
    '← 返回清單': '← Back to playlists',
    '✏️ 重新命名': '✏️ Rename',
    '➕ 加入目前隊列': '➕ Add current queue',
    '💾 匯出 M3U': '💾 Export M3U',
    '🧬 匯出 JSON': '🧬 Export JSON',
    '🗑️ 刪除清單': '🗑️ Delete playlist',
    '重新命名這個清單': 'Rename this playlist',
    '將目前播放隊列依序附加到這個清單': 'Append the current queue to this playlist, in order',
    '匯出成 .m3u8 播放清單檔（通用格式，可被其他播放器讀取）': 'Export as an .m3u8 playlist (universal format, readable by other players)',
    '匯出成 .json（保留完整曲目資訊，rooPlayer 可直接再匯入）': 'Export as .json (keeps full track info; rooPlayer can re-import it)',
    '刪除整個播放清單': 'Delete this whole playlist',
    '還沒有任何播放清單': 'No playlists yet',
    '可用上方「新增清單」建立空白清單，或到播放隊列按「儲存目前隊列」把正在排的曲目依序存成清單；也可以「匯入清單」讀取 .m3u / .json 清單檔。': 'Use “New playlist” above, or press “Save queue” in the play queue to store the current queue in order. You can also “Import playlist” a .m3u / .json file.',
    '這個清單還沒有曲目': 'This playlist has no tracks yet',
    '按「加入目前隊列」可把正在排的曲目依序加進來，或從專輯、曲目、播放紀錄頁面播放歌曲後再儲存。': 'Press “Add current queue” to append the current queue, or play from Albums, Tracks or Play History and then save.',
    '儲存播放清單': 'Save playlist',
    '新增播放清單': 'New playlist',
    '重新命名播放清單': 'Rename playlist',
    '儲存目前播放隊列': 'Save current play queue',
    '將播放隊列加入清單': 'Add play queue to playlist',
    '例如：深夜爵士': 'e.g. Late-night jazz',
    '取消': 'Cancel', '儲存': 'Save', '清空': 'Clear', '刪除': 'Delete', '確定': 'OK',
    '💾 儲存清單': '💾 Save playlist',
    '將目前播放隊列的所有歌曲依序加入一個播放清單並命名儲存': 'Add every song in the current queue to a playlist, in order, and save it with a name',

    // ===== 專輯詳情 =====
    '歌手：': 'Artist:', '年份：': 'Released:', '未載明': 'Not specified',
    '發行公司：': 'Label:', '獨立發行 / 未標記廠牌': 'Self-released / unlabelled',
    '總曲目總時長：': 'Total length:',
    '▶ 播放專輯': '▶ Play album',
    '加入最愛專輯': 'Add album to Favorites',
    '已加入收藏': 'In Favorites',
    '加入最愛演出者': 'Add artist to Favorites',
    '加入曲庫': 'Add to library',
    '從曲庫移除': 'Remove from library',
    '💿 其他發行版本 / VERSIONS': '💿 Other releases / VERSIONS',
    '點擊切換不同音質規格或發行版本': 'Switch between audio quality or release versions',
    '✨ 同類型推薦專輯 Recommended Albums': '✨ Similar albums you may like',
    '🎤 推薦演出者 Recommended Artists': '🎤 Recommended artists',
    '📖 專輯介紹 Album Review': '📖 Album review',
    '點擊展開或縮小專輯介紹': 'Expand or collapse the album review',
    '資料來源：維基百科音樂資料庫': 'Source: Wikipedia',
    '縮小': 'Collapse', '展開': 'Expand',
    '縮小或展開專輯介紹': 'Collapse or expand the album review',
    '📥 匯入至播放佇列': '📥 Add to play queue',
    '▶ 立即播放全部': '▶ Play all now',

    // ===== 演出者 / 發行公司 =====
    '演出者 Artists': 'Artists',
    'ARTIST PROFILE • 演出者總覽': 'ARTIST PROFILE',
    'RECORD LABEL • 發行公司總覽': 'RECORD LABEL',
    '⏱️ 最近播放的專輯': '⏱️ Recently played albums',
    '💿 本機音樂庫收藏': '💿 In your local library',
    '💿 本機音樂庫收藏（該公司發行）': '💿 In your local library (released by this label)',
    '🌐 線上專輯探索 (本機未收錄)': '🌐 Find online (not in your library)',
    '🌐 Wikipedia 維基百科': '🌐 Wikipedia',
    '📖 歌手簡介與背景': '📖 Artist biography',
    '來源：Wikipedia 百科資料庫': 'Source: Wikipedia',
    '在瀏覽器開啟 Wikipedia 完整條目': 'Open the full Wikipedia article in your browser',
    '尚無最近播放紀錄，點擊下方本機專輯即可開始聆聽。': 'No recent plays yet — pick an album below to start listening.',
    '比對線上音樂資料庫，為您挖掘該歌手尚未收藏的經典專輯，點擊按鈕可直接前往 Tidal、Qobuz Hi-Res、KKBOX、Apple Music 或 Spotify 平台搜尋聆聽。': 'We compare online catalogs to find classic albums by this artist you do not own; the buttons search Tidal, Qobuz Hi-Res, KKBOX, Apple Music or Spotify.',
    '比對範圍：本機檔案的 LABEL / PUBLISHER / COPYRIGHT 標籤，以及已加入曲庫的 TIDAL 專輯發行資料。': 'Matched from the LABEL / PUBLISHER / COPYRIGHT tags of your local files and the release data of TIDAL albums in your library.',
    '音樂庫內沒有以該發行公司標記的專輯；下方 TIDAL 發行清單可直接播放或加入曲庫。': 'No albums in your library carry this label; the TIDAL releases below can be played or added to your library.',
    '💎 TIDAL 該公司發行專輯': '💎 TIDAL releases from this label',
    '以 TIDAL 專輯的發行公司資料（copyright 欄位）比對同一家唱片公司，並循該公司演出者的 TIDAL 歷年發行作品延伸查找；可直接以 rooPlayer 音訊引擎播放，或加入曲庫。': 'Matched against the TIDAL copyright field for the same label, then extended through that label’s artists’ TIDAL catalog. Play it directly with the rooPlayer engine, or add it to your library.',
    '▶ 播放該公司所有專輯': '▶ Play all albums from this label',
    '🔄 重新比對 TIDAL': '🔄 Re-check TIDAL',
    '重新連線 TIDAL 比對該發行公司': 'Reconnect to TIDAL and match this label',
    '依發行公司欄位比對': 'Matched by the label field',
    '載入中...': 'Loading...', '檢索中...': 'Searching...', '搜尋中...': 'Searching...',
    '掃描中...': 'Scanning...',

    // ===== 所有曲目 / 曲風 =====
    '所有曲目 Tracks': 'All Tracks',
    '曲風風格 Genres': 'Genres',
    '▶ 播放全部曲目': '▶ Play all tracks',

    // ===== 我的最愛 =====
    '最愛專輯 Favorite Albums': 'Favorite Albums',
    '最愛歌曲 Favorite Tracks': 'Favorite Tracks',
    '最愛演出者 Favorite Artists': 'Favorite Artists',
    '▶ 播放全部最愛專輯': '▶ Play all favorite albums',
    '▶ 播放全部最愛歌曲': '▶ Play all favorite tracks',
    '▶ 播放最愛演出者歌曲': '▶ Play favorite artists',
    '尚未收藏任何最愛專輯': 'No favorite albums yet',
    '尚未收藏任何最愛歌曲': 'No favorite tracks yet',
    '尚未收藏任何最愛演出者': 'No favorite artists yet',
    '在任何專輯卡片上點擊 ♡ 空心愛心圖示即可加入我的最愛。': 'Tap the ♡ outline on any album card to add it to Favorites.',
    '在播放列左側愛心按鈕或曲目清單點擊 ♡ 即可收藏。': 'Tap the heart button in the player bar or the ♡ in any track list to favorite it.',
    '在演出者介紹頁面或演出者卡片上點擊 ⭐ 即可加入最愛演出者。': 'Tap ⭐ on an artist page or artist card to favorite that artist.',

    // ===== 本機資料夾 / 資料庫 =====
    '本機音樂庫設定 Storage': 'Local Library Settings',
    '管理本地音樂儲存夾，自動監控並建立音訊母帶資料庫。': 'Manage local music folders; rooPlayer scans them and builds the master audio database.',
    '支援格式：FLAC (24/192 Hi-Res), WAV, AIFF, DSD/DSF, MP3, M4A, AAC, OGG': 'Supported formats: FLAC (24/192 Hi-Res), WAV, AIFF, DSD/DSF, MP3, M4A, AAC, OGG',
    '📂 選擇音樂資料夾並掃描': '📂 Choose a music folder and scan',
    '正在分析無損音訊中...': 'Analyzing lossless audio...',
    '已加入的資料夾：': 'Added folders:',
    '尚未加入任何音樂資料夾，請點擊上方按鈕選取包含音樂的檔案夾。': 'No music folders yet — use the button above to pick a folder that contains music.',
    '💾 匯出資料庫': '💾 Export library',
    '📥 匯入資料庫': '📥 Import library',
    '匯出所有音樂資料及已加入的資料夾設定為 JSON 備份檔': 'Export all music data and folder settings to a JSON backup',
    '匯入資料庫備份檔並合併（自動略過重複曲目與資料夾）': 'Import and merge a backup (duplicate tracks and folders are skipped)',
    '資料庫匯入與合併報告': 'Library import & merge report',

    // ===== 搜尋結果 =====
    '本機端音樂庫專輯': 'Local library albums',
    '線上串流搜尋結果': 'Online streaming results',
    '線上各大串流平台相關作品，可點選各平台按鈕前往收聽。': 'Related releases on the major streaming services — use the platform buttons to listen.',
    '全部結果': 'All results',
    '📁 本機端專輯': '📁 Local albums',
    '🌐 線上串流 (KKBOX • TIDAL • QOBUZ • SPOTIFY)': '🌐 Online (KKBOX • TIDAL • QOBUZ • SPOTIFY)',
    '未在本機音樂庫找到相符的專輯，您可透過下方各大線上串流平台進行搜尋與試聽。': 'No matching albums in your local library — search and preview them on the streaming services below.',
    '線上相關專輯作品': 'Related online releases',
    'TIDAL 相符歌曲曲目 (直接點播)': 'Matching TIDAL tracks (play directly)',

    // ===== 播放列 / 全螢幕 =====
    '未播放曲目': 'Nothing playing',
    '點選任意曲目開始聆聽': 'Pick any track to start listening',
    '點擊展開專輯封面、播放列表與動態歌詞': 'Open album art, track list and live lyrics',
    '展開播放詳情與歌詞': 'Open playback details and lyrics',
    '播放 / 暫停': 'Play / Pause',
    '上一首': 'Previous', '下一首': 'Next',
    '⏮ 上一首': '⏮ Previous', '下一首 ⏭': 'Next ⏭',
    '循環模式': 'Repeat',
    '靜音切換': 'Mute',
    '播放佇列': 'Play queue',
    '播放隊列': 'Play queue',
    '本機播放': 'Local playback',
    '切換音訊輸出裝置 (本機 / DLNA / UPnP)': 'Change audio output (local / DLNA / UPnP)',
    'Line Out：最大音量輸出鎖定（鎖定時不可調音量）': 'Line Out: fixed maximum output level (volume cannot be adjusted while locked)',
    'WASAPI 獨佔模式：繞過 Windows 混音器，直接以裝置支援的最高取樣率 24-bit 輸出（獨佔期間系統音效暫停、音量鎖定最大）': 'WASAPI exclusive mode: bypasses the Windows mixer and outputs 24-bit at the device’s maximum sample rate (system sounds are paused and volume is locked at maximum while exclusive)',
    '查看 rooPlayer 音訊路徑 (Signal Path)': 'Show the rooPlayer signal path',
    'Signal Path (音訊路徑)': 'Signal Path',
    '即時訊號串流路徑': 'Live signal path',
    '原始母帶音訊源 (Bit-Perfect Lossless)': 'Source master audio (bit-perfect lossless)',
    '參數化等化器 (PEQ)': 'Parametric EQ (PEQ)',
    '卷積濾波器 (IR)': 'Convolution filter (IR)',
    '64-bit 浮點無損混音核心，零採樣損失處理': '64-bit floating lossless mixing core, zero sample loss',
    '動態歌詞 Lyrics': 'Live lyrics',
    '專輯播放列表': 'Album track list',
    '母帶音訊串流': 'Master audio stream',
    '關閉視窗 (Esc)': 'Close (Esc)',
    '點擊查看演出者簡介': 'View artist biography',
    '點擊查看專輯詳情': 'View album details',

    // ===== 播放佇列 =====
    '佇列': 'Queue',

    // ===== DLNA / 輸出裝置 =====
    '音訊輸出設備 Audio Output Zones': 'Audio Output Zones',
    '自動搜尋區網 DLNA / UPnP 串流節點與本機音訊端點': 'Automatically finds LAN DLNA / UPnP renderers and local audio endpoints',
    '重新搜尋設備 🔄': 'Re-scan devices 🔄',
    '💻 本機音訊端點': '💻 Local audio endpoint',
    '本機音訊 (此電腦)': 'Local audio (this PC)',
    'Windows WASAPI Exclusive / DirectSound 核心': 'Windows WASAPI Exclusive / DirectSound core',
    '播放中端點': 'Now playing on',
    '指定 IP 探測連線': 'Probe a specific IP',
    '手動指定 IP 連線探測 (例如: 192.168.1.100)': 'Manually probe an IP address (e.g. 192.168.1.100)',
    '⏳ 串流準備中': '⏳ Preparing stream',

    // ===== DSP / 音訊路徑 =====
    '升頻引擎設定': 'Upsampling engine settings',
    '啟用/關閉 升頻引擎': 'Enable / disable the upsampling engine',
    '發燒級 64 位元浮點即時超取樣升頻濾波器，拓展音場細節與瞬態還原': 'Audiophile 64-bit floating real-time oversampling filter — expands soundstage detail and transient accuracy',
    'PCM 升頻取樣規格 (PCM Upsampling)': 'PCM upsampling target (PCM Upsampling)',
    '調變器階數 (Modulator Order)': 'Modulator order',
    '濾波器相位 (Filter Phase)': 'Filter phase',
    '線性相位': 'Linear phase',
    '線性相位 (零相位失真)': 'Linear phase (zero phase distortion)',
    '最小相位 (零預響鈴)': 'Minimum phase (no pre-ringing)',
    '2x 整數倍頻': '2x integer upsampling',
    '4x 整數倍頻': '4x integer upsampling',
    '4x 整數倍頻 (推薦)': '4x integer upsampling (recommended)',
    '固定 96 kHz': 'Fixed 96 kHz',
    '固定 192 kHz': 'Fixed 192 kHz',
    '固定 384 kHz': 'Fixed 384 kHz',
    '可選 DSD 格式': 'Optional DSD formats',
    '固定升頻至 96 kHz / 24-bit': 'Fixed upsampling to 96 kHz / 24-bit',
    '固定升頻至 192 kHz / 24-bit': 'Fixed upsampling to 192 kHz / 24-bit',
    '固定升頻至 384 kHz / 24-bit (DXD 頂級解碼)': 'Fixed upsampling to 384 kHz / 24-bit (top-tier DXD decoding)',
    '44.1k➔88.2k, 48k➔96k (整數 2 倍超取樣)': '44.1k➔88.2k, 48k➔96k (integer 2x oversampling)',
    '44.1k➔176.4k, 48k➔192k (發燒推薦：整數倍頻相位最純淨)': '44.1k➔176.4k, 48k➔192k (audiophile pick: integer upsampling, cleanest phase)',
    '1-bit DSD 調變升頻 (PCM ➔ 1-bit DSD SDM Modulator)': '1-bit DSD modulation (PCM ➔ 1-bit DSD SDM modulator)',
    '2 階 (經典溫潤)': '2nd order (classic, warm)',
    '5 階 (CRFB 發燒推薦)': '5th order (CRFB, audiophile pick)',
    '7 階 (極致微動態)': '7th order (extreme micro-dynamics)',
    '2 階 Boser-Wooley 經典調變 (溫潤厚實，類比黑膠感)': '2nd-order Boser-Wooley classic modulator (warm and dense, vinyl-like)',
    '5 階 CRFB 雙重諧振零點調變 (發燒高動態，噪聲外推至 100kHz)': '5th-order CRFB double-resonant zero modulator (high dynamics, noise shaped beyond 100 kHz)',
    '7 階 CRFB 三重諧振零點調變 (極致微動態解析，極寬音場)': '7th-order CRFB triple-resonant zero modulator (extreme micro-detail, widest soundstage)',
    '啟用/關閉 參數化等化器': 'Enable / disable parametric EQ',
    '啟用/關閉 卷積濾波器': 'Enable / disable convolution filter',
    '設定即時套用到播放中的曲目': 'Settings apply live to the playing track',
    '自動預降 0.0 dB（保護電路不削頂）': 'Automatic pre-trim 0.0 dB (headroom protection never clips)',
    '📂 載入 IR 檔案…': '📂 Load an IR file…',
    '移除 IR': 'Remove IR',
    '尚未載入 IR。請選擇 16/24/32-bit WAV 脈衝響應檔（單聲道自動套用到左右聲道）。': 'No IR loaded. Choose a 16/24/32-bit WAV impulse response (mono is applied to both channels automatically).',
    '點空白格 → 輸入名稱 Enter 儲存目前設定 ・ 點儲存格載入 ・ 雙擊更名 ・ ✕ 刪除（两步確認）': 'Click an empty slot → type a name, Enter saves the current settings ・ click a slot to load ・ double-click to rename ・ ✕ to delete (two-step confirm)',

    // ===== 自訂濾波器 =====
    '🛠️ 自訂濾波器': '🛠️ Custom filters',
    '＋ 新建': '＋ New',
    '⚙ 管理': '⚙ Manage',
    '收合 ✕': 'Collapse ✕',
    '新建濾波器': 'New filter',
    '自訂濾波器管理': 'Custom filter manager',
    '尚無自訂濾波器 — 點「＋ 新建」於安全範圍內設計專屬濾波器': 'No custom filters yet — press “＋ New” to design one inside safe limits',
    '名稱': 'Name',
    '儲存槽': 'Slot',
    '例如：暖聲緩降': 'e.g. Warm gentle rolloff',
    'ⓘ 對聲音的影響': 'ⓘ Audible effect',
    '聲音特色描述（顯示於濾波器按鈕滑鼠提示）': 'How it sounds (shown in the filter button’s tooltip)',
    '例如：高頻柔化、鈴振不可聽': 'e.g. softens highs, ringing inaudible',
    '低負荷': 'Low load',
    '高負荷': 'High load',
    '通帶平坦區・源Nyquist 標記・鏡像泄漏區・止帶（-120dB 底）': 'Passband flat region ・ source Nyquist marker ・ image leakage band ・ stop band (-120 dB floor)',
    '自訂濾波器以純參數儲存，引擎自動做安全驗證與夾限；任何異常自動退回線性相位，不影響播放穩定。': 'Custom filters are stored as pure parameters; the engine validates and clamps them, and falls back to linear phase on any anomaly, so playback stability is unaffected.',
    '參數窗（滑桿可調）': 'Parametric window (adjustable sliders)',
    '餘弦窗（固定性格）': 'Cosine windows (fixed character)',

    // ===== KKBOX =====
    'KKBOX 帳號': 'KKBOX account',
    '🔑 KKBOX 帳號': '🔑 KKBOX account',
    '🏆 即時排行榜': '🏆 Charts',
    '✨ 精選推薦': '✨ Featured',
    '🏆 KKBOX 即時排行榜': '🏆 KKBOX charts',
    '🆕 KKBOX 新歌速爆': '🆕 KKBOX new hits',
    '🔄 重新整理': '🔄 Refresh',
    'KKBOX 官方權威熱門榜單 • 支援整榜一鍵播放與匯入佇列': 'The official KKBOX chart • play the whole chart or add it to your queue in one click',
    '華語、西洋、日韓即時焦點速爆新歌，掌握第一手潮流發行': 'Breaking Mandarin, Western and Asian releases, updated in real time',
    '瀏覽 KKBOX 即時熱門排行榜': 'Browse the KKBOX charts',
    '發現 KKBOX 速爆最新發行歌曲': 'See the latest breaking releases',
    '🔍 KKBOX 線上搜尋結果': '🔍 KKBOX search results',
    '在 KKBOX 百萬曲庫搜尋歌曲/歌手/專輯...': 'Search songs, artists or albums in the KKBOX catalog...',
    '❮ 返回排行榜': '❮ Back to charts',
    '❮ 返回列表': '❮ Back to list',
    '歌單名稱': 'Playlist name',
    '歌單描述與簡介': 'Playlist description',
    'KKBOX 帳號連線資訊': 'KKBOX account',
    '登入 KKBOX 會員帳號': 'Sign in to your KKBOX account',
    'KKBOX 帳號 (Email 或 手機號碼)': 'KKBOX account (email or phone number)',
    '請輸入 KKBOX 密碼': 'Enter your KKBOX password',
    '密碼 (選填)': 'Password (optional)',
    '儲存會員帳號': 'Save account',
    'API 串流長度': 'Stream length',
    '完整全曲與 Hi-Fi 無損': 'Full tracks and Hi-Fi lossless',
    'KKBOX 串流技術說明': 'How KKBOX streaming works',
    '💡 KKBOX 線上曲庫模式：可一鍵點播排行榜、精選歌單與最新單曲，或匯入整張歌單至 rooPlayer 播放佇列，由原生播放核心與 DLNA 統一控制。': 'KKBOX online catalog: play the charts, featured playlists and new releases in one click, or import a whole playlist into the rooPlayer queue, controlled by the same playback engine and DLNA zones.',

    // ===== TIDAL =====
    'TIDAL 帳號': 'TIDAL account',
    '💎 TIDAL 帳號': '💎 TIDAL account',
    '💎 發燒推薦': '💎 Audiophile picks',
    '📑 官方歌單': '📑 Curated playlists',
    '❤️ 我的收藏': '❤️ My collection',
    '最新發行 Hi-Res 專輯': 'New Hi-Res releases',
    'TIDAL 官方主題與發燒評測播放清單': 'TIDAL official themed and audiophile review playlists',
    '瀏覽我的 TIDAL 雲端最愛收藏': 'Browse my TIDAL favorites',
    '🆕 最新發行專輯 (New Releases)': '🆕 New releases',
    '📑 TIDAL 官方精選歌單 (Official Curated Playlists)': '📑 TIDAL official curated playlists',
    '❤️ 我的 TIDAL 雲端收藏': '❤️ My TIDAL collection',
    '已同步您的 TIDAL 帳號收藏清單': 'Your TIDAL favorites are synced',
    '全球官方同步首發無損母帶專輯與新單曲': 'Lossless master albums and new singles, released worldwide at the same time',
    'TIDAL 官方精心編選之發燒評測、高動態母帶與主題歌單 • 支援一鍵整張點播與匯入佇列': 'Officially curated audiophile review, high-dynamics master and themed playlists • play a whole list or add it to your queue',
    '古典交響名盤': 'Classical & symphonic',
    '全球熱播榜單': 'Global charts',
    '發燒人聲女聲': 'Audiophile vocals',
    '藍調爵士名演': 'Blues & jazz',
    '放鬆輕音樂 Chill': 'Chill & easy listening',
    '發燒音響 Hi-Res': 'Hi-Res audiophile',
    '官方母帶 Masters': 'Official masters',
    '🔍 TIDAL 線上搜尋結果': '🔍 TIDAL search results',
    '在 TIDAL Hi-Res 百萬曲庫搜尋歌曲/專輯/演出者...': 'Search tracks, albums or artists in the TIDAL Hi-Res catalog...',
    '❮ 返回發燒推薦': '❮ Back to audiophile picks',
    '💿 相符專輯 Albums': '💿 Matching albums',
    '🎵 相符曲目 Tracks': '🎵 Matching tracks',
    'TIDAL 發燒串流帳號連線': 'TIDAL audiophile streaming account',
    '🔑 開啟官方登入視窗': '🔑 Open the official sign-in window',
    '進階：手動貼上 Access Token 或自訂連線': 'Advanced: paste an Access Token or connect manually',
    'TIDAL 官方已連線': 'Connected to TIDAL',
    '中斷連線 (登出)': 'Disconnect (sign out)',
    '正在等待登入完成並自動擷取授權...': 'Waiting for sign-in to finish and the token to be captured...',
    '🔄 若視窗已進入 TIDAL 首頁，點此立即完成同步': '🔄 If the window already reached the TIDAL home page, click here to finish now',
    '儲存 Token': 'Save token',
    'User ID (選填)': 'User ID (optional)',
    '尚未連線至 TIDAL 發燒雲端曲庫': 'Not connected to the TIDAL catalog',
    '立即登入 TIDAL': 'Sign in to TIDAL now',
    '登入您的 TIDAL 帳號，即可以 rooPlayer 原生音訊引擎直接串流 24-bit Hi-Res MAX 母帶音質，並無縫整合本機與線上曲庫。': 'Sign in to stream 24-bit Hi-Res MAX masters through the rooPlayer native audio engine, integrated seamlessly with your local library.',
    '在 rooPlayer 登入您的 TIDAL 帳號，享受無縫融合本機與雲端的 Hi-Res Lossless FLAC 發燒串流體驗。': 'Sign in to TIDAL inside rooPlayer and enjoy Hi-Res lossless FLAC streaming fused with your local library.',
    '點擊下方按鈕將開啟 TIDAL 官方登入視窗，支援 Email、Google、Apple 或 Facebook 登入，完成後自動授權綁定。': 'The button below opens the official TIDAL sign-in window (Email, Google, Apple or Facebook); authorization is linked automatically afterwards.',
    '一鍵開啟 TIDAL 官方登入': 'Sign in to TIDAL in one click',
    '⏳ 正在載入 TIDAL 最新發行專輯...': '⏳ Loading TIDAL new releases...',
    '⏳ 正在載入 TIDAL 官方歌單...': '⏳ Loading TIDAL curated playlists...',
    '⏳ 正在載入您的 TIDAL 最愛專輯...': '⏳ Loading your TIDAL favorites...',
    '⏳ 正在載入 KKBOX 即時排行榜...': '⏳ Loading the KKBOX charts...',
    '⏳ 正在載入 KKBOX 新歌歌單...': '⏳ Loading KKBOX new releases...',
    '💡 TIDAL 發燒無損曲庫：支援 24-bit/192kHz Hi-Res MAX、Native DSP 即時倍頻與 1-bit DSD 調變，可一鍵點播整張專輯或無縫加入本機曲庫。': 'TIDAL lossless catalog: 24-bit/192 kHz Hi-Res MAX, native DSP upsampling and 1-bit DSD modulation. Play a whole album in one click or add it to your library.',
    '發燒串流核心功能已就緒': 'Audiophile streaming is ready',
    '混合曲庫整合': 'Combined local + online library',
    '聲音引擎直通': 'Audio engine pass-through',
    'DLNA 投播': 'DLNA casting',
    '重新連線': 'Reconnect',

    // ===== 說明頁快速導覽 =====
    '軟體說明與操作手冊': 'About rooPlayer & User Manual',
    '版本資訊、功能架構、授權條款、免責聲明與詳細選單使用指引。': 'Version information, feature architecture, license terms, disclaimer and a detailed guide to every menu.',
    '📖 各選單操作手冊': '📖 Menu manual',
    '📜 使用授權範圍': '📜 License',
    '⚖️ 免責聲明': '⚖️ Disclaimer',
    '⚙️ 核心音訊規格': '⚙️ Audio specifications',
  };

  // ---------------- 已知含動態内容的字串（regex → 英文，$1… 取自原文） ----------------
  const I18N_PATTERNS = [
    [/^共 (\d+) 個播放清單（曲目依儲存的順序播放）$/, '$1 playlists (tracks play in the saved order)'],
    [/^最近播放的 (\d+) 首歌曲 \(依時間由最近到最久排序\)$/, 'Your last $1 tracks (newest first)'],
    [/^(\d+) 首歌曲 · 總時長 (.+)$/, '$1 tracks · total length $2'],
    [/^已緩衝 ([\d.]+) 秒音訊 \/ 目標 ([\d.]+) 秒 · ([\d.]+) MB · 已等 ([\d.]+) 秒$/, 'Buffered $1 s of audio / target $2 s · $3 MB · waiting $4 s'],
    [/^已等 ([\d.]+) 秒$/, 'waiting $1 s'],
    [/^串流準備中：已緩衝 ([\d.]+) 秒音訊$/, 'Preparing stream: $1 s of audio buffered'],
    [/^高解析度即時升頻：(.+)$/, 'Real-time high-resolution upsampling: $1'],
    [/^參數化等化器：(\d+) 段作用中$/, 'Parametric EQ: $1 bands active'],
    [/^參數化等化器：未啟用$/, 'Parametric EQ: off'],
    [/^分割式頻域卷積：IR 作用中$/, 'Partitioned frequency-domain convolution: IR active'],
    [/^分割式頻域卷積：未載入 IR$/, 'Partitioned frequency-domain convolution: no IR loaded'],
    [/^輸出至 (.+)$/, 'Output to $1'],
    [/^輸出至本機預設音訊裝置$/, 'Output to the local default audio device'],
    [/^自訂濾波器：(.+)$/, 'Custom filter: $1'],
    [/^掃描完成：(.+)$/, 'Scan complete: $1'],
    [/^播放佇列 \((\d+)\)$/, 'Play queue ($1)'],
    [/^播放佇列$/, 'Play queue'],
    [/^播放隊列 \((\d+)\)$/, 'Play queue ($1)'],
    [/^播放隊列$/, 'Play queue'],
    [/^佇列 \((\d+)\)$/, 'Queue ($1)'],
    [/^佇列$/, 'Queue'],
    [/^播放隊列 \($/, 'Play queue ('],
    [/^(\d+) 段$/, '$1 bands'],
    [/^(\d+) 段作用中$/, '$1 bands active'],
    [/^(\d+) 段未作用$/, '$1 bands inactive'],
    [/^(\d+) 個版本$/, '$1 versions'],
    [/^(\d+) 張推薦$/, '$1 recommended albums'],
    [/^(\d+) 位推薦$/, '$1 recommended artists'],
    [/^(\d+) 首推薦$/, '$1 recommended tracks'],
    [/^已加入 (\d+) 張專輯$/, '$1 albums added'],
    [/^已加入 (\d+) 首曲目$/, '$1 tracks added'],
    [/^(\d+) 首已加入$/, '$1 tracks added'],
    [/^找到 (\d+) 筆$/, 'Found $1 results'],
    [/^(\d+) 筆相符$/, '$1 matches'],
    [/^(\d+) 筆結果$/, '$1 results'],
    [/^國家\/地區: (\w+) \| 連線就緒$/, 'Country/region: $1 | connection ready'],
  ];

  // ---------------- 通用統計字串（「共 N 張專輯，N 位演出者…」）逐段翻譯 ----------------
  // 單位寫成 [單數, 複數]，數量為 1 時用單數，避免 "1 items" 這種怪英文。
  const UNIT_MAP = {
    '張專輯': ['album', 'albums'], '位演出者': ['artist', 'artists'], '首曲目': ['track', 'tracks'],
    '種曲風': ['genre', 'genres'], '種格式': ['format', 'formats'],
    '個音樂曲風與流派': ['music style and genre', 'music styles and genres'],
    '個音樂風格與流派': ['music style and genre', 'music styles and genres'],
    '個播放清單': ['playlist', 'playlists'], '個自訂濾波器': ['custom filter', 'custom filters'],
    '個版本': ['version', 'versions'], '個端點': ['endpoint', 'endpoints'],
    '筆結果': ['result', 'results'], '筆相符': ['match', 'matches'], '筆': ['item', 'items'],
    '張最愛專輯': ['favorite album', 'favorite albums'], '首最愛歌曲': ['favorite track', 'favorite tracks'],
    '位最愛演出者': ['favorite artist', 'favorite artists'],
    '張': ['album', 'albums'], '位': ['artist', 'artists'], '首': ['track', 'tracks'],
    '段': ['band', 'bands'], '個': ['item', 'items'],
  };
  const UNIT_KEYS = Object.keys(UNIT_MAP).sort((a, b) => b.length - a.length);
  const SEG_RE = new RegExp('^(?:共 |共)?\\s*(\\d+)\\s*(' + UNIT_KEYS.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')$');

  function translateSummarySegment(seg) {
    const m = SEG_RE.exec(normalize(seg));
    if (!m) return null;
    const pair = UNIT_MAP[m[2]];
    if (!pair) return null;
    return m[1] + ' ' + (Number(m[1]) === 1 ? pair[0] : pair[1]);
  }

  // 只翻「純計數」組成的字串：任何一段不認識就整串不翻，避免半中半英。
  function translateCountSummary(text) {
    const key = normalize(text);
    if (!key || !CJK.test(key)) return null;

    const wrapped = /^(\d+)\s*筆[（(](.+)[）)]$/.exec(key);
    if (wrapped) {
      const inner = translateCountSummary(wrapped[2]);
      if (inner === null) return null;
      const head = Number(wrapped[1]) === 1 ? '1 item' : wrapped[1] + ' items';
      return head + ' (' + inner + ')';
    }

    const parts = key.split(/，|,|、|·| \/ /).map(s => s.trim()).filter(Boolean);
    if (parts.length === 0) return null;
    const out = [];
    for (const part of parts) {
      const seg = translateSummarySegment(part);
      if (seg === null) return null;
      out.push(seg);
    }
    return out.join(', ');
  }

  // ---------------- 語言狀態與套用 ----------------
  const originalText = new WeakMap(); // 文字節點 → 原文（換回中文時原樣還原）
  const originalAttr = new WeakMap(); // 元素 → { attr: 原文 }
  const originalHtml = new Map();     // data-i18n-html 元素 key → 原文 innerHTML

  let currentLang = (() => {
    try {
      const saved = localStorage.getItem(LANG_KEY);
      return saved === 'en' ? 'en' : 'zh-TW';
    } catch (e) { return 'zh-TW'; }
  })();

  const SKIP_TAGS = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, NOSCRIPT: 1, HEAD: 1, TITLE: 1 };
  const TRANSLATE_ATTRS = ['title', 'placeholder', 'aria-label'];

  const normalize = (s) => String(s).replace(/\s+/g, ' ').trim();

  function translateString(text) {
    const key = normalize(text);
    if (!key || !CJK.test(key)) return null;
    if (I18N_TEXT[key] !== undefined) return I18N_TEXT[key];
    for (const [re, en] of I18N_PATTERNS) {
      if (re.test(key)) return key.replace(re, en);
    }
    return translateCountSummary(key);
  }

  function applyToTextNode(node) {
    const parent = node.parentElement;
    if (!parent || SKIP_TAGS[parent.tagName]) return;
    if (parent.closest('[data-i18n-skip]')) return;
    const raw = node.nodeValue;

    // 中文模式：先把之前翻譯過的節點原樣還原（此時節點裡是英文，不能再用「含中文」當條件）
    if (currentLang === 'zh-TW') {
      const saved = originalText.get(node);
      if (typeof saved === 'string' && normalize(saved) !== normalize(raw)) node.nodeValue = saved;
      return;
    }

    const key = normalize(raw);
    if (!key || !CJK.test(key)) return;
    const translated = translateString(key);
    if (translated === null) return;
    if (!originalText.has(node)) originalText.set(node, raw);
    const lead = (raw.match(/^[ \t\r\n\u00a0]*/) || [''])[0];
    const trail = (raw.match(/[ \t\r\n\u00a0]*$/) || [''])[0];
    node.nodeValue = lead + translated + trail;
  }

  function applyToAttributes(el) {
    if (SKIP_TAGS[el.tagName]) return;
    if (el.closest && el.closest('[data-i18n-skip]')) return;
    for (const attr of TRANSLATE_ATTRS) {
      const value = el.getAttribute && el.getAttribute(attr);
      if (!value) continue;
      const saved = originalAttr.get(el);
      if (currentLang === 'zh-TW') {
        if (saved && typeof saved[attr] === 'string' && saved[attr] !== value) el.setAttribute(attr, saved[attr]);
        continue;
      }
      if (!CJK.test(value)) continue;
      const translated = translateString(value);
      if (translated === null) continue;
      const store = saved || {};
      if (!(attr in store)) store[attr] = value;
      originalAttr.set(el, store);
      el.setAttribute(attr, translated);
    }
  }

  function applyToHtmlBlocks() {
    const dict = window.I18N_DOC_EN || {};
    const nodes = Array.prototype.slice.call(document.querySelectorAll('[data-i18n-html]'));
    for (const el of nodes) {
      const key = el.getAttribute('data-i18n-html');
      if (!key) continue;
      if (currentLang === 'zh-TW') {
        const saved = originalHtml.get(key);
        if (typeof saved === 'string' && el.innerHTML !== saved) el.innerHTML = saved;
        continue;
      }
      const en = dict[key];
      if (typeof en !== 'string') continue;
      if (!originalHtml.has(key)) originalHtml.set(key, el.innerHTML);
      if (el.innerHTML !== en) el.innerHTML = en;
    }
  }

  function walk(root) {
    const walker = document.createTreeWalker(root || document.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, null);
    let n;
    while ((n = walker.nextNode())) {
      if (n.nodeType === 3) applyToTextNode(n);
      else if (n.nodeType === 1) applyToAttributes(n);
    }
  }

  let pending = false;
  function scheduleTranslate() {
    if (pending) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      try { walk(document.body); } catch (e) {}
    }, 120);
  }

  let observer = null;
  function startObserver() {
    if (observer || typeof MutationObserver === 'undefined') return;
    observer = new MutationObserver((records) => {
      let needed = false;
      for (const rec of records) {
        if (rec.type === 'characterData') {
          const p = rec.target.parentElement;
          if (p && !SKIP_TAGS[p.tagName] && !p.closest('[data-i18n-skip]')) { needed = true; break; }
          continue;
        }
        for (const node of rec.addedNodes) {
          if (node.nodeType === 1 && !SKIP_TAGS[node.tagName]) { needed = true; break; }
          if (node.nodeType === 3) { const p = node.parentElement; if (p && !SKIP_TAGS[p.tagName]) { needed = true; break; } }
        }
        if (needed) break;
      }
      if (needed) scheduleTranslate();
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  }

  function applyLanguage(lang, options) {
    currentLang = (lang === 'en') ? 'en' : 'zh-TW';
    try { localStorage.setItem(LANG_KEY, currentLang); } catch (e) {}
    document.documentElement.setAttribute('data-lang', currentLang);
    document.documentElement.setAttribute('lang', currentLang === 'en' ? 'en' : 'zh-Hant');
    applyToHtmlBlocks();
    walk(document.body);
    startObserver();
    if (!options || options.notify !== false) {
      try {
        if (typeof window.onAppLanguageChanged === 'function') window.onAppLanguageChanged(currentLang);
      } catch (e) {}
    }
    return currentLang;
  }

  window.I18N_TEXT = I18N_TEXT;
  window.I18N_PATTERNS = I18N_PATTERNS;
  window.I18N = {
    getLanguage: () => currentLang,
    setLanguage: (lang) => applyLanguage(lang),
    applyLanguage: applyLanguage,
    translate: translateString,
    refresh: () => { applyToHtmlBlocks(); walk(document.body); },
    isEnglish: () => currentLang === 'en',
    // 除錯用：列出元素內各文字節點與其原文記錄
    __debugNode: (el) => {
      const target = typeof el === 'string' ? document.querySelector(el) : el;
      if (!target) return null;
      const out = [];
      const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT, null);
      let n;
      while ((n = walker.nextNode())) {
        out.push({ text: n.nodeValue, hasOriginal: originalText.has(n), original: originalText.get(n) });
      }
      return out;
    },
  };
})();
