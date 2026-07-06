const DB_NAME = 'vocabStoryDB';
const DB_VERSION = 1;
const STORE = 'kv';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGet(key, fallback) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result ? req.result.value : fallback);
    req.onerror = () => reject(req.error);
  });
}

async function dbSet(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ key, value });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbGetAllRecords() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function dbImportRecords(records) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    records.forEach(r => store.put(r));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

const DEFAULTS = {
  progress: {},
  favorites: { words: [] },
  streak: { visits: [] },
  prefs: { fontSize: 'md', darkMode: false },
  srs: { words: {} },
  notes: { entries: {} }
};

async function loadState(key) {
  return dbGet(key, DEFAULTS[key]);
}

async function saveState(key, value) {
  await dbSet(key, value);
  // Tracks when any of the app's own data last changed, so the cross-device
  // sync feature (js/sync.js) can tell whether a remote backup is newer or
  // older than what's on this device, without needing a full field-by-field
  // merge. Not itself app data, so it's excluded to avoid a pointless loop.
  if (key !== 'lastLocalChangeAt') {
    await dbSet('lastLocalChangeAt', new Date().toISOString());
  }
}

async function exportProgress() {
  const records = await dbGetAllRecords();
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), records }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `vocab-story-progress-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function importProgress(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  if (!data.records || !Array.isArray(data.records)) throw new Error('無效的進度檔案');
  await dbImportRecords(data.records);
}
