// ============================================================
// Shared genre classification (used by renderer app.js and main.js)
// Single source of truth to keep library scanning and UI grouping consistent.
// ============================================================
'use strict';

const CANONICAL_GENRES = [
  'Classical', 'Jazz', 'Rock', 'Pop', 'Electronic',
  'Soul / R&B', 'Blues', 'Folk', 'Soundtrack', 'Metal',
  'Hip Hop', 'Ambient', 'Vocal', 'Audiophile'
];

function canonicalizeGenre(rawGenre, track = {}) {
  const g = (rawGenre || '').trim();
  const text = [(rawGenre || ''), (track.genre || ''), (track.album || ''), (track.artist || ''), (track.title || ''), (track.filePath || '')].join(' ').toLowerCase();

  if (/classi|orchestr|symphon|baroque|opera|chamber|philharmonic|concerto|piano|beethoven|bach|mozart|chopin|tchaikovsky|orff|brahms|handel|vivaldi|古典|交響|協奏|獨奏|管弦|鋼琴曲|樂團|愛樂/i.test(text)) {
    return 'Classical';
  }
  if (/jazz|fusion|swing|bop|bebop|big band|dixieland|smooth jazz|bossa|miles davis|coltrane|chesky|爵士|巴薩諾瓦/i.test(text)) {
    return 'Jazz';
  }
  if (/soundtrack|ost|film|movie|cinematic|game|anime|bandes originales|vocaloid|サウンドトラック|ゲーム|動畫音樂|動畫影視音樂|原聲|配樂|影視|動漫/i.test(text)) {
    return 'Soundtrack';
  }
  if (/metal|heavy metal|thrash|death metal|black metal|doom|power metal|金屬/i.test(text)) {
    return 'Metal';
  }
  if (/rock|punk|grunge|alternative|hard rock|psychedelic|prog rock|britpop|j-rock|搖滾|朋克/i.test(text)) {
    return 'Rock';
  }
  if (/soul|motown|r&b|rnb|rhythm and blues|funk|gospel|neo-soul|節奏藍調|靈魂樂/i.test(text)) {
    return 'Soul / R&B';
  }
  if (/blues|delta blues|chicago blues|country blues|bb king|藍調/i.test(text)) {
    return 'Blues';
  }
  if (/folk|bluegrass|celtic|americana|singer-songwriter|singer songwriter|民謠|民歌|民樂/i.test(text)) {
    return 'Folk';
  }
  if (/hip.?hop|rap|trap|boom bap|嘻哈|饒舌/i.test(text)) {
    return 'Hip Hop';
  }
  if (/electro|techno|house|trance|synth|edm|downtempo|chillout|dance|disco|club|電子|電音/i.test(text)) {
    return 'Electronic';
  }
  if (/ambient|new age|meditation|drone|relax|atmospheric|enya|contemporary instrumental|氛圍|新世紀|冥想/i.test(text)) {
    return 'Ambient';
  }
  if (/vocal|choral|acappella|acapella|chanson|美聲|聲樂|人聲|歌謠曲/i.test(text)) {
    return 'Vocal';
  }
  if (/audiophile|hi-end|hifi|binaural|burmester|b&w|示範片|展cd|音響展|發燒/i.test(text)) {
    return 'Audiophile';
  }
  if (/pop|cantopop|mandopop|c-pop|cpop|j-pop|jpop|k-pop|synth-pop|ballad|chinese|asian music|老歌|流行|華語|一般流行/i.test(text)) {
    return 'Pop';
  }
  return 'Pop';
}

// Renderer (classic script tag) exposure
if (typeof window !== 'undefined') {
  window.CANONICAL_GENRES = CANONICAL_GENRES;
  window.canonicalizeGenre = canonicalizeGenre;
}

// Node.js (main process) exposure
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CANONICAL_GENRES, canonicalizeGenre };
}
