let manifest = null;
let progress = {};
let favorites = { words: [] };
let streak = { visits: [] };
let prefs = { fontSize: 'md', darkMode: false };
let srs = { words: {} };
let notes = { entries: {} };

const SRS_INTERVALS = [0, 3, 7, 14, 30];
const SRS_SESSION_LIMIT = 20;

let currentLevelNum = null;
let currentChapterNum = null;
let currentChapterData = null;
let currentPopupEntry = null;
let toastTimer = null;

const chapterCache = {};

const $ = (id) => document.getElementById(id);

// ---------- boot ----------

async function init() {
  prefs = await loadState('prefs');
  progress = await loadState('progress');
  favorites = await loadState('favorites');
  streak = await loadState('streak');
  srs = await loadState('srs');
  notes = await loadState('notes');
  applyPrefs();
  recordVisit();
  manifest = await fetch('data/manifest.json').then(r => r.json());
  bindGlobalEvents();
  router();
  window.addEventListener('hashchange', router);
  registerServiceWorker();
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      reg.update();
    }).catch(() => {});
    let reloadedForUpdate = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloadedForUpdate) return;
      reloadedForUpdate = true;
      location.reload();
    });
  }
}

// ---------- progress helpers ----------

function emptyLevelProgress() {
  return { readChapters: {}, chapterQuiz: {}, lastChapter: null, reviewQuizDone: false, reviewQuizScore: null, certificateDate: null };
}

function getLevelProgress(levelNum) {
  const key = `level${levelNum}`;
  if (!progress[key]) progress[key] = emptyLevelProgress();
  return progress[key];
}

function localDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function recordVisit() {
  const today = localDateKey(new Date());
  if (!streak.visits.includes(today)) {
    streak.visits.push(today);
    saveState('streak', streak);
  }
}

function computeStreak() {
  const set = new Set(streak.visits);
  let count = 0;
  const d = new Date();
  while (true) {
    const key = localDateKey(d);
    if (set.has(key)) {
      count++;
      d.setDate(d.getDate() - 1);
    } else break;
  }
  return count;
}

// ---------- spaced repetition (forgetting-curve review) ----------

function addDaysKey(dateKey, days) {
  const d = new Date(dateKey + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return localDateKey(d);
}

const SRS_LEARNING_STREAK_REQUIRED = 3;

function scheduleSRSWord(entry, levelNum, chapterNum) {
  if (srs.words[entry.word]) return;
  srs.words[entry.word] = {
    word: entry.word,
    zh: entry.zh,
    pos: entry.pos,
    level: levelNum,
    chapter: chapterNum,
    box: 0,
    streak: 0,
    nextReview: addDaysKey(localDateKey(new Date()), SRS_INTERVALS[0])
  };
}

function scheduleChapterWordsForSRS(chapterData, levelNum, chapterNum) {
  (chapterData.targetWords || []).forEach((w) => scheduleSRSWord(w, levelNum, chapterNum));
  saveState('srs', srs);
}

function getDueSRSWords() {
  const today = localDateKey(new Date());
  return Object.values(srs.words).filter((w) => w.nextReview <= today);
}

// Box 0 is a "learning" phase: a word that has ever been wrong (or is brand
// new) must be answered correctly SRS_LEARNING_STREAK_REQUIRED times in a
// row before it graduates into the long spaced intervals (box 1+). Any wrong
// answer resets both the box and the streak, so it has to earn its way back.
function gradeSRSWord(word, correct) {
  const entry = srs.words[word];
  if (!entry) return;
  const today = localDateKey(new Date());
  if (!correct) {
    entry.box = 0;
    entry.streak = 0;
    entry.nextReview = addDaysKey(today, SRS_INTERVALS[0]);
  } else if (entry.box === 0) {
    entry.streak = (entry.streak || 0) + 1;
    if (entry.streak >= SRS_LEARNING_STREAK_REQUIRED) {
      entry.box = 1;
      entry.streak = 0;
      entry.nextReview = addDaysKey(today, SRS_INTERVALS[entry.box]);
    } else {
      entry.nextReview = addDaysKey(today, SRS_INTERVALS[0]);
    }
  } else {
    entry.box = Math.min(entry.box + 1, SRS_INTERVALS.length - 1);
    entry.nextReview = addDaysKey(today, SRS_INTERVALS[entry.box]);
  }
  saveState('srs', srs);
}

// ---------- prefs / theme ----------

function applyPrefs() {
  document.documentElement.setAttribute('data-theme', prefs.darkMode ? 'dark' : 'light');
  const scaleMap = { sm: 0.9, md: 1, lg: 1.15 };
  document.documentElement.style.setProperty('--font-scale', scaleMap[prefs.fontSize] || 1);
  const darkToggle = $('darkModeToggle');
  if (darkToggle) darkToggle.checked = prefs.darkMode;
  [['sm', 'fontSmallBtn'], ['md', 'fontMedBtn'], ['lg', 'fontLargeBtn']].forEach(([size, id]) => {
    const el = $(id);
    if (el) el.classList.toggle('active', prefs.fontSize === size);
  });
}

function setFontSize(size) {
  prefs.fontSize = size;
  saveState('prefs', prefs);
  applyPrefs();
}

function setDarkMode(on) {
  prefs.darkMode = on;
  saveState('prefs', prefs);
  applyPrefs();
}

// ---------- routing ----------

function hideAllScreens() {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
}

function showScreen(id) {
  $('screen-' + id).classList.add('active');
}

function updateBottomNav(path) {
  document.querySelectorAll('.bottom-nav a').forEach(a => {
    const route = a.dataset.route;
    const active = route === '/' ? (path === '/' || path.startsWith('/level')) : path === route;
    a.classList.toggle('active', active);
  });
}

function router() {
  stopSpeak();
  closeWordPopup();
  const hash = location.hash || '#/';
  const path = hash.slice(1) || '/';
  hideAllScreens();
  $('backBtn').hidden = path === '/';
  updateBottomNav(path);

  let m;
  if (path === '/') {
    $('topTitle').textContent = '英文單字故事';
    showScreen('home');
    renderHome();
  } else if ((m = path.match(/^\/level\/(\d+)$/))) {
    showScreen('level');
    renderLevel(+m[1]);
  } else if ((m = path.match(/^\/level\/(\d+)\/chapter\/(\d+)$/))) {
    showScreen('chapter');
    renderChapter(+m[1], +m[2]);
  } else if ((m = path.match(/^\/level\/(\d+)\/review$/))) {
    showScreen('review');
    renderReview(+m[1]);
  } else if ((m = path.match(/^\/level\/(\d+)\/certificate$/))) {
    showScreen('certificate');
    renderCertificate(+m[1]);
  } else if (path === '/review-due') {
    $('topTitle').textContent = '今日複習';
    showScreen('review-due');
    renderDueReview();
  } else if (path === '/notebook') {
    $('topTitle').textContent = '我的筆記本';
    showScreen('notebook');
    renderNotebook();
  } else if (path === '/favorites') {
    $('topTitle').textContent = '我的收藏';
    showScreen('favorites');
    renderFavorites();
  } else if (path === '/search') {
    $('topTitle').textContent = '搜尋單字';
    showScreen('search');
    renderSearchScreen();
  } else if (path === '/settings') {
    $('topTitle').textContent = '設定';
    showScreen('settings');
    renderSettings();
  } else {
    location.hash = '#/';
    return;
  }
  window.scrollTo(0, 0);
}

// ---------- data loading ----------

async function loadChapter(levelNum, chapterNum) {
  const key = `${levelNum}-${chapterNum}`;
  if (chapterCache[key]) return chapterCache[key];
  const res = await fetch(`data/level${levelNum}/chapter${chapterNum}.json`);
  const data = await res.json();
  chapterCache[key] = data;
  return data;
}

async function loadAllChaptersForLevel(levelNum) {
  const lvl = manifest.levels.find(l => l.level === levelNum);
  return Promise.all(lvl.chapters.map(c => loadChapter(levelNum, c.chapter)));
}

// ---------- home ----------

function renderHome() {
  const streakDays = computeStreak();
  const banner = $('streakBanner');
  banner.textContent = streakDays > 0 ? `🔥 連續閱讀 ${streakDays} 天，保持下去！` : '👋 開始今天的第一章故事吧！';

  const dueCount = getDueSRSWords().length;
  const dueBanner = $('dueReviewBanner');
  if (dueCount > 0) {
    dueBanner.hidden = false;
    dueBanner.innerHTML = `<span>📅 今天有 ${dueCount} 個單字要複習</span><span>去複習 →</span>`;
    dueBanner.onclick = () => { location.hash = '#/review-due'; };
  } else {
    dueBanner.hidden = true;
  }

  const list = $('levelList');
  list.innerHTML = '';
  manifest.levels.forEach(lvl => {
    const card = document.createElement('div');
    card.className = 'level-card' + (lvl.available ? '' : ' disabled');
    if (lvl.available) {
      const lp = getLevelProgress(lvl.level);
      const doneCount = Object.keys(lp.readChapters).length;
      const total = lvl.chapters.length;
      card.innerHTML = `
        <div>
          <div class="lv-name">${escapeHtml(lvl.name)}</div>
          <div class="lv-sub">${doneCount}/${total} 章已完成${lp.reviewQuizDone ? ' · 已結業' : ''}</div>
        </div>
        ${lp.reviewQuizDone ? '<div class="badge-check">🏆</div>' : ''}
      `;
      card.onclick = () => { location.hash = `#/level/${lvl.level}`; };
    } else {
      card.innerHTML = `
        <div>
          <div class="lv-name">${escapeHtml(lvl.name)}</div>
          <div class="lv-sub">尚未推出，敬請期待</div>
        </div>
      `;
    }
    list.appendChild(card);
  });
}

// ---------- level detail ----------

function renderLevel(levelNum) {
  currentLevelNum = levelNum;
  const lvl = manifest.levels.find(l => l.level === levelNum);
  $('topTitle').textContent = lvl.name;
  $('levelHeading').textContent = `${lvl.name} 章節列表`;

  const lp = getLevelProgress(levelNum);
  const total = lvl.chapters.length;
  const doneCount = Object.keys(lp.readChapters).length;
  $('levelProgressBar').querySelector('.progress-fill').style.width = total ? `${(doneCount / total) * 100}%` : '0%';

  const list = $('chapterList');
  list.innerHTML = '';
  lvl.chapters.forEach(c => {
    const item = document.createElement('div');
    item.className = 'chapter-item' + (lp.readChapters[c.chapter] ? ' done' : '');
    const q = lp.chapterQuiz[c.chapter];
    const status = lp.readChapters[c.chapter] ? `✅ 測驗 ${q ? q.correct : '-'}/${q ? q.total : '-'}` : '尚未讀';
    item.innerHTML = `
      <div class="ch-title">Ch${String(c.chapter).padStart(2, '0')}. ${escapeHtml(c.title)}</div>
      <div class="ch-status">${status}</div>
    `;
    item.onclick = () => { location.hash = `#/level/${levelNum}/chapter/${c.chapter}`; };
    list.appendChild(item);
  });

  const reviewBtn = $('reviewQuizBtn');
  if (lvl.hasReviewQuiz && total > 0 && doneCount === total) {
    reviewBtn.hidden = false;
    reviewBtn.textContent = lp.reviewQuizDone
      ? `📝 重考 Level 總複習大會考（上次 ${lp.reviewQuizScore.correct}/${lp.reviewQuizScore.total}）`
      : '📝 Level 總複習大會考';
    reviewBtn.onclick = () => { location.hash = `#/level/${levelNum}/review`; };
  } else {
    reviewBtn.hidden = true;
  }
}

// ---------- chapter reader ----------

async function renderChapter(levelNum, chapterNum) {
  currentLevelNum = levelNum;
  currentChapterNum = chapterNum;
  const data = await loadChapter(levelNum, chapterNum);
  currentChapterData = data;

  const lp = getLevelProgress(levelNum);
  lp.lastChapter = chapterNum;
  saveState('progress', progress);

  $('topTitle').textContent = `Ch${String(chapterNum).padStart(2, '0')}`;
  $('chapterTitle').textContent = `Chapter ${String(chapterNum).padStart(2, '0')}. ${data.title}`;
  $('chapterMeta').textContent = `Level ${data.level} · ${data.sentences.length} 句 · ${data.quiz.length} 題測驗`;

  resetHighlightRegistry();
  const wordsBySentence = {};
  (data.targetWords || []).forEach(w => {
    const idx = w.firstOccurrenceSentenceIndex;
    if (idx == null || idx < 0) return;
    (wordsBySentence[idx] = wordsBySentence[idx] || []).push({ ...w, cls: 'hl-target' });
  });
  (data.extraHighlightWords || []).forEach(w => {
    const idx = w.firstOccurrenceSentenceIndex;
    if (idx == null || idx < 0) return;
    (wordsBySentence[idx] = wordsBySentence[idx] || []).push({ ...w, cls: 'hl-extra' });
  });

  const sentenceList = $('sentenceList');
  sentenceList.innerHTML = '';
  data.sentences.forEach((s, i) => {
    const div = document.createElement('div');
    div.className = 'sentence';
    div.id = `sentence-${i}`;
    div.innerHTML = `<span class="idx">${i + 1}.</span><span class="en">${highlightSentence(s.en, wordsBySentence[i] || [])}</span><div class="zh">${escapeHtml(s.zh)}</div>`;
    sentenceList.appendChild(div);
  });
  sentenceList.onclick = (e) => {
    if (!ttsState.playing) return;
    if (e.target.closest('.hl-target,.hl-extra,.hl-plain')) return;
    const sentenceEl = e.target.closest('.sentence');
    if (!sentenceEl) return;
    const idx = parseInt(sentenceEl.id.replace('sentence-', ''), 10);
    if (!isNaN(idx)) replaySentence(idx);
  };

  renderQuizBlock($('chapterQuiz'), data.quiz, (score, total) => {
    const wasRead = !!lp.readChapters[chapterNum];
    lp.readChapters[chapterNum] = true;
    lp.chapterQuiz[chapterNum] = { correct: score, total };
    saveState('progress', progress);
    if (!wasRead) {
      scheduleChapterWordsForSRS(data, levelNum, chapterNum);
      showToast(`✅ 完成第 ${chapterNum} 章！測驗 ${score}/${total} 對，${(data.targetWords || []).length} 個單字已加入複習排程`);
    }
  });

  const lvl = manifest.levels.find(l => l.level === levelNum);
  const idx = lvl.chapters.findIndex(c => c.chapter === chapterNum);
  const prevBtn = $('prevChapterBtn');
  const nextBtn = $('nextChapterBtn');
  prevBtn.disabled = idx <= 0;
  prevBtn.onclick = () => { if (idx > 0) location.hash = `#/level/${levelNum}/chapter/${lvl.chapters[idx - 1].chapter}`; };
  nextBtn.disabled = idx >= lvl.chapters.length - 1;
  nextBtn.onclick = () => { if (idx < lvl.chapters.length - 1) location.hash = `#/level/${levelNum}/chapter/${lvl.chapters[idx + 1].chapter}`; };

  document.body.classList.remove('show-zh');
  $('translateToggleBtn').classList.remove('active');
  $('playBtn').textContent = '▶ 自動朗讀';
  $('playBtn').classList.remove('active');

  bindChapterNotes(levelNum, chapterNum, data.title);
}

// ---------- per-chapter notebook ----------

function noteKey(levelNum, chapterNum) {
  return `${levelNum}-${chapterNum}`;
}

let notesSaveDebounce = null;

function bindChapterNotes(levelNum, chapterNum, chapterTitle) {
  const key = noteKey(levelNum, chapterNum);
  const textarea = $('chapterNotesInput');
  const status = $('notesSaveStatus');
  const existing = notes.entries[key];
  textarea.value = existing ? existing.text : '';
  status.textContent = existing ? `上次儲存：${new Date(existing.updatedAt).toLocaleString('zh-TW')}` : '';

  textarea.oninput = () => {
    clearTimeout(notesSaveDebounce);
    status.textContent = '儲存中…';
    notesSaveDebounce = setTimeout(() => {
      const text = textarea.value;
      if (text.trim()) {
        notes.entries[key] = { level: levelNum, chapter: chapterNum, title: chapterTitle, text, updatedAt: new Date().toISOString() };
      } else {
        delete notes.entries[key];
      }
      saveState('notes', notes);
      status.textContent = text.trim() ? `已儲存：${new Date().toLocaleTimeString('zh-TW')}` : '（筆記已清空）';
    }, 600);
  };
}

function renderNotebook() {
  const list = $('notebookList');
  const entries = Object.values(notes.entries).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  const hasEntries = entries.length > 0;
  $('notebookExportSelectedBtn').hidden = !hasEntries;
  $('notebookExportAllBtn').hidden = !hasEntries;

  if (!hasEntries) {
    list.innerHTML = '<p class="meta">還沒有任何筆記。讀章節時，頁面下方有「我的筆記」欄位，寫下的內容會自動儲存並出現在這裡。</p>';
    return;
  }

  list.innerHTML = '';
  entries.forEach(n => {
    const key = noteKey(n.level, n.chapter);
    const item = document.createElement('div');
    item.className = 'notebook-item';
    item.innerHTML = `
      <label class="notebook-check"><input type="checkbox" class="notebook-select" data-key="${escapeHtml(key)}"></label>
      <div class="notebook-body">
        <div class="notebook-title">Level ${n.level} · Ch${String(n.chapter).padStart(2, '0')}. ${escapeHtml(n.title)}</div>
        <div class="notebook-preview">${escapeHtml(n.text.length > 100 ? n.text.slice(0, 100) + '…' : n.text)}</div>
        <div class="meta">更新於 ${new Date(n.updatedAt).toLocaleString('zh-TW')}</div>
      </div>
    `;
    item.querySelector('.notebook-body').onclick = () => { location.hash = `#/level/${n.level}/chapter/${n.chapter}`; };
    list.appendChild(item);
  });
}

function exportNotes(keys) {
  const entries = (keys ? keys.map(k => notes.entries[k]).filter(Boolean) : Object.values(notes.entries))
    .sort((a, b) => a.level - b.level || a.chapter - b.chapter);
  if (!entries.length) {
    showToast('沒有可匯出的筆記');
    return;
  }
  let md = `# 我的單字故事筆記本\n\n匯出時間：${new Date().toLocaleString('zh-TW')}\n\n`;
  entries.forEach(n => {
    md += `## Level ${n.level} · Chapter ${n.chapter}. ${n.title}\n\n${n.text}\n\n---\n\n`;
  });
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `vocab-story-notes-${new Date().toISOString().slice(0, 10)}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---------- quiz rendering (shared by chapter quiz + level review quiz) ----------

function addWordToFavorites(wordInfo) {
  if (favorites.words.some(f => f.word === wordInfo.word)) {
    showToast('已經收藏過了');
    return false;
  }
  favorites.words.push({
    word: wordInfo.word,
    zh: wordInfo.zh || '',
    pos: wordInfo.pos || '',
    level: currentLevelNum,
    chapter: currentChapterNum,
    addedAt: new Date().toISOString()
  });
  saveState('favorites', favorites);
  showToast('⭐ 已加入收藏');
  return true;
}

// wordExtractor(q) is optional: given a quiz question, return {word, zh, pos}
// if the question is clearly "about" one single word (like the Level review
// quiz's "What does X mean?" format), so a favorite button can be shown right
// away without waiting for the quiz to be answered.
function renderQuizBlock(container, quizArray, onAllAnswered, onItemAnswered, wordExtractor) {
  const answers = new Array(quizArray.length).fill(null);
  container.innerHTML = '';
  quizArray.forEach((q, qi) => {
    const item = document.createElement('div');
    item.className = 'quiz-item';
    const qEl = document.createElement('div');
    qEl.className = 'q';
    qEl.textContent = `${qi + 1}. ${q.question}`;
    item.appendChild(qEl);

    const wordInfo = wordExtractor && wordExtractor(q);
    if (wordInfo) {
      const favBtn = document.createElement('button');
      favBtn.type = 'button';
      favBtn.className = 'quiz-fav-btn chip-btn';
      const already = favorites.words.some(f => f.word === wordInfo.word);
      favBtn.textContent = already ? '⭐ 已收藏' : '☆ 先收藏這個字';
      favBtn.onclick = () => {
        if (addWordToFavorites(wordInfo)) favBtn.textContent = '⭐ 已收藏';
      };
      item.appendChild(favBtn);
    }

    q.options.forEach((opt, oi) => {
      const label = document.createElement('label');
      const id = `quiz-${container.id}-${qi}-${oi}`;
      label.id = id;
      label.innerHTML = `<input type="radio" name="quiz-${container.id}-${qi}">${escapeHtml(opt)}`;
      label.onclick = () => {
        if (answers[qi] !== null) return;
        answers[qi] = oi;
        for (let k = 0; k < q.options.length; k++) {
          const el = $(`quiz-${container.id}-${qi}-${k}`);
          if (el) el.classList.remove('correct', 'wrong');
        }
        if (oi === q.answer) {
          label.classList.add('correct');
        } else {
          label.classList.add('wrong');
          const correctEl = $(`quiz-${container.id}-${qi}-${q.answer}`);
          if (correctEl) correctEl.classList.add('correct');
        }
        onItemAnswered && onItemAnswered(qi, oi === q.answer, q);
        if (answers.every(a => a !== null)) {
          const score = answers.filter((a, i2) => a === quizArray[i2].answer).length;
          onAllAnswered && onAllAnswered(score, quizArray.length);
        }
      };
      item.appendChild(label);
    });
    container.appendChild(item);
  });
}

// The generated Level review quiz always asks "What does "word" mean?" with
// the correct Chinese meaning among the options, so we can pull the word +
// its answer straight out of the question/options without extra data.
function reviewQuizWordExtractor(q) {
  const m = q.question.match(/"([^"]+)"/);
  if (!m || q.answer == null || !q.options) return null;
  return { word: m[1], zh: q.options[q.answer] };
}

// ---------- level review quiz ----------

let reviewQuizState = { done: false, score: 0, total: 0 };

async function renderReview(levelNum) {
  currentLevelNum = levelNum;
  reviewQuizState = { done: false, score: 0, total: 0 };
  $('topTitle').textContent = '總複習大會考';
  $('submitReviewBtn').disabled = true;
  $('submitReviewBtn').textContent = '請完成上方所有題目';
  $('reviewResult').textContent = '';

  let data;
  try {
    const res = await fetch(`data/level${levelNum}/levelReviewQuiz.json`);
    data = await res.json();
  } catch (e) {
    $('reviewTitle').textContent = `Level ${levelNum} 總複習大會考`;
    $('reviewQuiz').innerHTML = '<p class="meta">這個 Level 的總複習測驗還沒有準備好。</p>';
    return;
  }
  $('reviewTitle').textContent = data.title;
  renderQuizBlock($('reviewQuiz'), data.quiz, (score, total) => {
    reviewQuizState = { done: true, score, total };
    $('reviewResult').textContent = `已完成所有題目，答對 ${score}/${total} 題。`;
    $('submitReviewBtn').disabled = false;
    $('submitReviewBtn').textContent = `🏆 領取結業證書`;
  }, null, reviewQuizWordExtractor);

  $('submitReviewBtn').onclick = () => {
    if (!reviewQuizState.done) return;
    const lp = getLevelProgress(levelNum);
    lp.reviewQuizDone = true;
    lp.reviewQuizScore = { correct: reviewQuizState.score, total: reviewQuizState.total };
    lp.certificateDate = new Date().toISOString();
    saveState('progress', progress);
    location.hash = `#/level/${levelNum}/certificate`;
  };
}

function renderCertificate(levelNum) {
  $('topTitle').textContent = '結業證書';
  const lp = getLevelProgress(levelNum);
  $('certTitle').textContent = `🎉 Level ${levelNum} 結業證書`;
  if (lp.reviewQuizDone) {
    $('certBody').textContent = `恭喜完成 Level ${levelNum} 全部章節與總複習大會考！總複習答對 ${lp.reviewQuizScore.correct}/${lp.reviewQuizScore.total} 題。完成時間：${new Date(lp.certificateDate).toLocaleString('zh-TW')}`;
  } else {
    $('certBody').textContent = '這個 Level 還沒完成總複習大會考。';
  }
}

// ---------- daily spaced-repetition review screen ----------
//
// Matches Anki's learning-step behavior: a word that's still in box 0 (new,
// or reset by a wrong answer) gets reinserted a few cards later in THIS same
// session's queue, so it comes back for another attempt within the same
// sitting instead of waiting for a separate future visit. Only once it
// graduates (box >= 1) does it leave the queue and fall back to day-based
// spaced intervals.

let dueQueue = [];
let dueSessionStats = { total: 0, correct: 0, graduated: 0 };

function renderDueReview() {
  const due = getDueSRSWords();
  dueQueue = due.slice(0, SRS_SESSION_LIMIT).map((w) => w.word);
  dueSessionStats = { total: 0, correct: 0, graduated: 0 };

  const emptyEl = $('dueReviewEmpty');
  if (!dueQueue.length) {
    $('dueReviewIntro').textContent = '';
    $('dueReviewQuiz').innerHTML = '';
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;
  showNextDueCard();
}

function updateDueProgress() {
  $('dueReviewIntro').textContent = `本次已作答 ${dueSessionStats.total} 題・已畢業 ${dueSessionStats.graduated} 個單字・佇列剩 ${dueQueue.length + 1} 張。新字或答錯過的字要連續答對 ${SRS_LEARNING_STREAK_REQUIRED} 次（會在這次複習中重複出現）才會進入拉長間隔。`;
}

function showNextDueCard() {
  if (!dueQueue.length) {
    $('dueReviewQuiz').innerHTML = '';
    $('dueReviewIntro').textContent = `複習完成！這次共作答 ${dueSessionStats.total} 題，答對 ${dueSessionStats.correct} 題，畢業 ${dueSessionStats.graduated} 個單字進入拉長間隔。`;
    showToast('📅 今日複習完成！');
    return;
  }
  const word = dueQueue.shift();
  updateDueProgress();
  renderDueCard(word);
}

function renderDueCard(word) {
  const entry = srs.words[word];
  if (!entry) { showNextDueCard(); return; }

  const allZh = Object.values(srs.words).map((w) => w.zh);
  const distractorPool = allZh.filter((zh) => zh !== entry.zh);
  const distractors = [];
  while (distractors.length < 3 && distractorPool.length) {
    const idx = Math.floor(Math.random() * distractorPool.length);
    distractors.push(distractorPool.splice(idx, 1)[0]);
  }
  const options = [...distractors, entry.zh].sort(() => Math.random() - 0.5);
  const answerIdx = options.indexOf(entry.zh);
  const headword = entry.word.split('/')[0];
  let answered = false;

  const alreadyFav = favorites.words.some(f => f.word === entry.word);
  const container = $('dueReviewQuiz');
  container.innerHTML = `
    <div class="quiz-item">
      <div class="q">"${escapeHtml(headword)}" 是什麼意思？ <button class="chip-btn" id="dueSpeakBtn" type="button">🔊</button> <button class="chip-btn" id="dueFavBtn" type="button">${alreadyFav ? '⭐ 已收藏' : '☆ 收藏'}</button></div>
      ${options.map((opt, oi) => `<label id="dueOpt${oi}"><input type="radio" name="dueCard">${escapeHtml(opt)}</label>`).join('')}
    </div>
    <button class="primary-btn" id="dueNextBtn" style="margin-top:12px" hidden>下一張 →</button>
  `;

  $('dueSpeakBtn').onclick = () => speakSingleWord(headword);
  speakSingleWord(headword);
  $('dueFavBtn').onclick = () => {
    if (favorites.words.some(f => f.word === entry.word)) { showToast('已經收藏過了'); return; }
    favorites.words.push({ word: entry.word, zh: entry.zh, pos: entry.pos || '', level: entry.level, chapter: entry.chapter, addedAt: new Date().toISOString() });
    saveState('favorites', favorites);
    $('dueFavBtn').textContent = '⭐ 已收藏';
    showToast('⭐ 已加入收藏');
  };

  options.forEach((opt, oi) => {
    $(`dueOpt${oi}`).onclick = () => {
      if (answered) return;
      answered = true;
      const correct = oi === answerIdx;
      for (let k = 0; k < options.length; k++) $(`dueOpt${k}`).classList.remove('correct', 'wrong');
      if (correct) {
        $(`dueOpt${oi}`).classList.add('correct');
      } else {
        $(`dueOpt${oi}`).classList.add('wrong');
        $(`dueOpt${answerIdx}`).classList.add('correct');
      }

      gradeSRSWord(word, correct);
      dueSessionStats.total++;
      if (correct) dueSessionStats.correct++;

      if (srs.words[word].box === 0) {
        const insertPos = Math.min(dueQueue.length, 3);
        dueQueue.splice(insertPos, 0, word);
      } else {
        dueSessionStats.graduated++;
      }
      updateDueProgress();

      const nextBtn = $('dueNextBtn');
      nextBtn.hidden = false;
      nextBtn.onclick = () => showNextDueCard();
    };
  });
}

// ---------- word popup / favorites ----------

function onWordClick(regId) {
  const entry = highlightRegistry[regId];
  if (!entry) return;
  currentPopupEntry = entry;
  const bases = entry.word.split('/').map(s => s.trim());
  let html = `<h3>${escapeHtml(bases.join(' / '))} <button class="chip-btn" id="wordPopupSpeakBtn" type="button">🔊 發音</button></h3>`;
  html += `<div class="pos">${escapeHtml(entry.pos || '')}${entry.phonetic ? ' · ' + escapeHtml(entry.phonetic) : ''}</div>`;
  html += `<div>${escapeHtml(entry.zh || '')}</div>`;
  const posTokens = (entry.pos || '').split('/').map(t => t.trim());
  if (posTokens.includes('v.') && entry.pastForm) {
    html += `<div class="tenses">三態：${escapeHtml(bases[0])} / ${escapeHtml(entry.pastForm)} / ${escapeHtml(entry.pastParticipleForm || entry.pastForm)}</div>`;
  }
  $('wordPopupBody').innerHTML = html;
  $('wordPopup').hidden = false;
  $('wordPopupSpeakBtn').onclick = () => speakSingleWord(bases[0]);
}

// Tapping a plain (non-highlighted) word in a sentence: it has no dictionary
// data in our word bank, but the user can still favorite it directly so the
// favorites list isn't limited to whatever the story happened to mark.
function onPlainWordClick(word) {
  currentPopupEntry = { word, zh: '', pos: '' };
  let html = `<h3>${escapeHtml(word)} <button class="chip-btn" id="wordPopupSpeakBtn" type="button">🔊 發音</button></h3>`;
  html += `<div class="pos meta">這個字不在故事的標色單字庫裡，沒有內建字義，但你可以直接收藏起來。</div>`;
  $('wordPopupBody').innerHTML = html;
  $('wordPopup').hidden = false;
  $('wordPopupSpeakBtn').onclick = () => speakSingleWord(word);
}

function closeWordPopup() {
  $('wordPopup').hidden = true;
  currentPopupEntry = null;
}

function addFavoriteFromPopup() {
  if (!currentPopupEntry) return;
  const entry = currentPopupEntry;
  if (favorites.words.some(f => f.word === entry.word)) {
    showToast('已經收藏過了');
    return;
  }
  favorites.words.push({
    word: entry.word,
    zh: entry.zh,
    pos: entry.pos,
    pastForm: entry.pastForm,
    pastParticipleForm: entry.pastParticipleForm,
    level: currentLevelNum,
    chapter: currentChapterNum,
    addedAt: new Date().toISOString()
  });
  saveState('favorites', favorites);
  showToast('⭐ 已加入收藏');
}

function renderFavorites() {
  const list = $('favoritesList');
  if (!favorites.words.length) {
    list.innerHTML = '<p class="meta">還沒有收藏任何單字，讀故事時點單字再按「加入收藏」吧。</p>';
    return;
  }
  list.innerHTML = '';
  favorites.words.slice().sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt)).forEach(f => {
    const item = document.createElement('div');
    item.className = 'fav-item';
    item.innerHTML = `
      <div>
        <div class="fav-word">${escapeHtml(f.word)}</div>
        <div class="fav-zh">${escapeHtml(f.zh || '')}</div>
      </div>
      <button class="fav-remove">✕</button>
    `;
    item.querySelector('.fav-remove').onclick = () => {
      favorites.words = favorites.words.filter(w => w.word !== f.word);
      saveState('favorites', favorites);
      renderFavorites();
    };
    list.appendChild(item);
  });
}

// ---------- search ----------

let searchDebounce = null;

function renderSearchScreen() {
  $('searchResults').innerHTML = '';
  $('searchInput').value = '';
}

function doSearch(query) {
  query = query.trim().toLowerCase();
  const resultsEl = $('searchResults');
  if (query.length < 2) {
    resultsEl.innerHTML = '';
    return;
  }
  loadAllChaptersForLevel(1).then(chapters => {
    const hits = [];
    chapters.forEach(ch => {
      const pool = [...(ch.targetWords || []), ...(ch.extraHighlightWords || [])];
      pool.forEach(w => {
        const bases = w.word.toLowerCase().split('/').map(s => s.trim());
        const variants = wordVariants(w);
        if (bases.includes(query) || bases.some(b => b.startsWith(query)) || variants.includes(query)) {
          hits.push({ chapter: ch.chapter, title: ch.title, entry: w });
        }
      });
    });
    if (!hits.length) {
      resultsEl.innerHTML = '<p class="meta">沒有找到相關單字。</p>';
      return;
    }
    resultsEl.innerHTML = '';
    hits.forEach(h => {
      const item = document.createElement('div');
      item.className = 'search-result-item';
      item.innerHTML = `
        <div class="fav-word">${escapeHtml(h.entry.word)}<span class="fav-zh"> — ${escapeHtml(h.entry.zh || '')}</span></div>
        <div class="meta" style="margin:4px 0 0">Ch${String(h.chapter).padStart(2, '0')}. ${escapeHtml(h.title)}</div>
      `;
      item.onclick = () => { location.hash = `#/level/1/chapter/${h.chapter}`; };
      resultsEl.appendChild(item);
    });
  });
}

// ---------- settings ----------

function renderSettings() {
  applyPrefs();
}

// ---------- confirm modal (generic, used for destructive actions) ----------

function showConfirmModal(title, body, onConfirm) {
  $('confirmModalTitle').textContent = title;
  $('confirmModalBody').textContent = body;
  $('confirmModal').hidden = false;
  const okBtn = $('confirmModalOk');
  const cancelBtn = $('confirmModalCancel');
  const cleanup = () => { $('confirmModal').hidden = true; okBtn.onclick = null; cancelBtn.onclick = null; };
  okBtn.onclick = () => { cleanup(); onConfirm(); };
  cancelBtn.onclick = cleanup;
}

async function resetReadingRecords() {
  progress = {};
  srs = { words: {} };
  streak = { visits: [] };
  await saveState('progress', progress);
  await saveState('srs', srs);
  await saveState('streak', streak);
  showToast('✅ 已重置閱讀與測驗記錄');
  setTimeout(() => { location.hash = '#/'; }, 600);
}

// ---------- toast ----------

function showToast(msg) {
  const toast = $('toast');
  toast.textContent = msg;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 2500);
}

// ---------- global bindings ----------

function bindGlobalEvents() {
  $('wordPopupClose').onclick = closeWordPopup;
  $('wordPopup').onclick = (e) => { if (e.target.id === 'wordPopup') closeWordPopup(); };
  $('wordPopupFavBtn').onclick = addFavoriteFromPopup;

  $('translateToggleBtn').onclick = () => {
    document.body.classList.toggle('show-zh');
    $('translateToggleBtn').classList.toggle('active');
  };

  $('playBtn').onclick = () => {
    const btn = $('playBtn');
    if (ttsState.playing) {
      stopSpeak();
      btn.textContent = '▶ 自動朗讀';
      btn.classList.remove('active');
      document.querySelectorAll('.sentence.reading').forEach(e => e.classList.remove('reading'));
      return;
    }
    btn.textContent = '⏸ 停止朗讀';
    btn.classList.add('active');
    const sentences = currentChapterData.sentences.map(s => s.en);
    speakChapter(sentences, (i) => {
      document.querySelectorAll('.sentence.reading').forEach(e => e.classList.remove('reading'));
      const el = $(`sentence-${i}`);
      if (el) { el.classList.add('reading'); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    }, () => {
      btn.textContent = '▶ 自動朗讀';
      btn.classList.remove('active');
      document.querySelectorAll('.sentence.reading').forEach(e => e.classList.remove('reading'));
    });
  };

  const order = ['sm', 'md', 'lg'];
  $('fontMinusBtn').onclick = () => { const i = Math.max(0, order.indexOf(prefs.fontSize) - 1); setFontSize(order[i]); };
  $('fontPlusBtn').onclick = () => { const i = Math.min(order.length - 1, order.indexOf(prefs.fontSize) + 1); setFontSize(order[i]); };
  $('fontSmallBtn').onclick = () => setFontSize('sm');
  $('fontMedBtn').onclick = () => setFontSize('md');
  $('fontLargeBtn').onclick = () => setFontSize('lg');
  $('darkModeToggle').onchange = (e) => setDarkMode(e.target.checked);

  $('searchInput').addEventListener('input', (e) => {
    clearTimeout(searchDebounce);
    const val = e.target.value;
    searchDebounce = setTimeout(() => doSearch(val), 150);
  });

  $('forceRefreshBtn').onclick = async () => {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) await reg.update();
    }
    location.reload();
  };

  $('exportBtn').onclick = () => exportProgress();
  $('importBtn').onclick = () => $('importFile').click();
  $('importFile').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      await importProgress(file);
      showToast('✅ 匯入成功，重新載入中...');
      setTimeout(() => location.reload(), 800);
    } catch (err) {
      showToast('匯入失敗：檔案格式不正確');
    }
  };

  $('resetProgressBtn').onclick = () => {
    showConfirmModal(
      '確定要重置閱讀與測驗記錄嗎？',
      '這會清空所有 Level 的章節閱讀進度、章節測驗成績、總複習大會考結果，以及單字複習排程。收藏單字和筆記本內容不會受影響。',
      () => {
        showConfirmModal(
          '再次確認：真的要重置嗎？',
          '這個動作無法復原！所有閱讀與測驗記錄都會永久消失。',
          resetReadingRecords
        );
      }
    );
  };

  $('notebookExportAllBtn').onclick = () => exportNotes(null);
  $('notebookExportSelectedBtn').onclick = () => {
    const keys = Array.from(document.querySelectorAll('.notebook-select:checked')).map(el => el.dataset.key);
    if (!keys.length) { showToast('請先勾選要匯出的章節'); return; }
    exportNotes(keys);
  };
}

init();
