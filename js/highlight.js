function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wordVariants(entry) {
  const forms = new Set();
  entry.word.split('/').forEach(base => {
    const w = base.trim().toLowerCase();
    if (!w) return;
    forms.add(w);
    forms.add(w + 's');
    forms.add(w + 'es');
    forms.add(w + 'ed');
    forms.add(w + 'ing');
    if (w.endsWith('e')) {
      forms.add(w.slice(0, -1) + 'ing');
      forms.add(w + 'd');
    }
    if (w.endsWith('y') && w.length > 1 && !'aeiou'.includes(w[w.length - 2])) {
      forms.add(w.slice(0, -1) + 'ies');
      forms.add(w.slice(0, -1) + 'ied');
    }
  });
  ['pastForm', 'pastParticipleForm'].forEach(key => {
    if (entry[key]) {
      entry[key].split('/').forEach(f => forms.add(f.trim().toLowerCase()));
    }
  });
  return Array.from(forms).filter(Boolean).sort((a, b) => b.length - a.length);
}

// Registry of highlighted words per chapter render, keyed by incrementing id, so click handlers
// can look up full entry data without re-serializing JSON into HTML attributes.
let highlightRegistry = [];

function resetHighlightRegistry() {
  highlightRegistry = [];
}

// `favorites` is a global defined in app.js; by the time any chapter is
// actually rendered it has already been loaded from IndexedDB, so it's safe
// to read here even though this file is loaded first in index.html.
function isFavoritedWord(word) {
  const key = word.toLowerCase();
  return favorites.words.some(f => f.word.toLowerCase() === key);
}

// Wrap every plain word (not already part of a target/extra highlight) in its
// own clickable span too, so users can tap ANY word in the sentence and add
// it to favorites, not just the ones the story marked as target vocabulary.
//
// IMPORTANT: this must scan the RAW (unescaped) segment for word tokens, then
// escape each piece individually. Escaping the whole segment first and then
// regex-matching letters on the result is wrong: encoded entities like
// `&quot;` and `&amp;` contain letter runs ("quot", "amp") that would get
// mistaken for real words and wrapped in a <span>, which breaks the entity
// and makes it render as literal "&quot;" text on screen instead of a quote
// mark. Quotation marks appear constantly in this story's dialogue, so this
// bug was highly visible in production.
function wrapPlainWords(segment) {
  let result = '';
  let cursor = 0;
  const re = /[A-Za-z']+/g;
  let m;
  while ((m = re.exec(segment))) {
    result += escapeHtml(segment.slice(cursor, m.index));
    const token = m[0];
    const key = token.toLowerCase().replace(/^'+|'+$/g, '');
    if (key) {
      const safeKey = key.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const cls = isFavoritedWord(key) ? 'hl-plain hl-favorited' : 'hl-plain';
      result += `<span class="${cls}" data-plain-key="${escapeHtml(key)}" onclick="onPlainWordClick('${safeKey}')">${escapeHtml(token)}</span>`;
    } else {
      result += escapeHtml(token);
    }
    cursor = re.lastIndex;
  }
  result += escapeHtml(segment.slice(cursor));
  return result;
}

function highlightSentence(text, words) {
  const matches = [];
  words.forEach(w => {
    for (const variant of wordVariants(w)) {
      const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`\\b${escaped}\\b`, 'i');
      const m = re.exec(text);
      if (m) {
        matches.push({ start: m.index, end: m.index + m[0].length, entry: w });
        break;
      }
    }
  });
  matches.sort((a, b) => a.start - b.start);
  const kept = [];
  let lastEnd = -1;
  matches.forEach(m => {
    if (m.start >= lastEnd) {
      kept.push(m);
      lastEnd = m.end;
    }
  });
  let result = '';
  let cursor = 0;
  kept.forEach(m => {
    result += wrapPlainWords(text.slice(cursor, m.start));
    const regId = highlightRegistry.length;
    highlightRegistry.push(m.entry);
    const cls = isFavoritedWord(m.entry.word) ? `${m.entry.cls} hl-favorited` : m.entry.cls;
    result += `<span class="${cls}" data-reg-id="${regId}" onclick="onWordClick(${regId})">${escapeHtml(text.slice(m.start, m.end))}</span>`;
    cursor = m.end;
  });
  result += wrapPlainWords(text.slice(cursor));
  return result;
}
