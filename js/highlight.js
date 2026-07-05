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
    result += escapeHtml(text.slice(cursor, m.start));
    const regId = highlightRegistry.length;
    highlightRegistry.push(m.entry);
    result += `<span class="${m.entry.cls}" data-reg-id="${regId}" onclick="onWordClick(${regId})">${escapeHtml(text.slice(m.start, m.end))}</span>`;
    cursor = m.end;
  });
  result += escapeHtml(text.slice(cursor));
  return result;
}
