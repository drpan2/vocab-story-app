// Cross-device sync via the user's own private GitHub Gist. Deliberately
// simple whole-blob "last write wins" — this app has one user syncing
// between their own 2-3 devices sequentially, not concurrent multi-user
// editing, so a per-field merge would be solving a problem that doesn't
// exist here.
const SYNC_GIST_FILENAME = 'vocab-story-progress.json';
const SYNC_GIST_DESC = '英文單字故事App - 跨裝置同步進度（請勿手動編輯）';
const SYNC_APP_KEYS = ['prefs', 'progress', 'favorites', 'streak', 'srs', 'notes'];

async function getSyncConfig() {
  return dbGet('syncConfig', { token: '', gistId: '', lastSyncedAt: null });
}

async function setSyncConfig(cfg) {
  return dbSet('syncConfig', cfg);
}

function ghHeaders(token) {
  return {
    'Authorization': `token ${token}`,
    'Accept': 'application/vnd.github+json',
    'Content-Type': 'application/json'
  };
}

async function buildSyncPayload() {
  const values = await Promise.all(SYNC_APP_KEYS.map((k) => loadState(k)));
  const data = {};
  SYNC_APP_KEYS.forEach((k, i) => { data[k] = values[i]; });
  return { savedAt: new Date().toISOString(), data };
}

async function applySyncPayload(payload) {
  for (const key of SYNC_APP_KEYS) {
    await saveState(key, payload.data[key]);
  }
  // saveState() bumps lastLocalChangeAt on every call (it doesn't know this
  // was a pull, not a genuine local edit) — pin it back to the payload's own
  // timestamp so the next comparison isn't fooled into thinking this device
  // has newer local changes than what it just received.
  await dbSet('lastLocalChangeAt', payload.savedAt);
}

// Pushes the current local state up, creating the gist on first use.
async function syncPush() {
  const cfg = await getSyncConfig();
  if (!cfg.token) throw new Error('請先貼上並儲存GitHub權杖');
  const payload = await buildSyncPayload();
  const body = {
    description: SYNC_GIST_DESC,
    public: false,
    files: { [SYNC_GIST_FILENAME]: { content: JSON.stringify(payload, null, 2) } }
  };
  const url = cfg.gistId ? `https://api.github.com/gists/${cfg.gistId}` : 'https://api.github.com/gists';
  const res = await fetch(url, { method: cfg.gistId ? 'PATCH' : 'POST', headers: ghHeaders(cfg.token), body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`GitHub API 錯誤 (${res.status})`);
  const json = await res.json();
  await setSyncConfig({ ...cfg, gistId: json.id, lastSyncedAt: payload.savedAt });
  await dbSet('lastLocalChangeAt', payload.savedAt);
  return payload.savedAt;
}

// Pulls the gist and overwrites local state unconditionally (user tapped
// "restore from cloud" on purpose, so no timestamp comparison here).
async function syncPull() {
  const cfg = await getSyncConfig();
  if (!cfg.token || !cfg.gistId) throw new Error('還沒有雲端備份可以還原');
  const payload = await fetchGistPayload(cfg.token, cfg.gistId);
  await applySyncPayload(payload);
  await setSyncConfig({ ...cfg, lastSyncedAt: payload.savedAt });
  return payload.savedAt;
}

async function fetchGistPayload(token, gistId) {
  const res = await fetch(`https://api.github.com/gists/${gistId}`, { headers: ghHeaders(token) });
  if (!res.ok) throw new Error(`GitHub API 錯誤 (${res.status})`);
  const json = await res.json();
  const file = json.files[SYNC_GIST_FILENAME];
  if (!file) throw new Error('雲端備份格式錯誤');
  return JSON.parse(file.content);
}

// Called once on app boot: if a newer backup exists on another device,
// pull it in silently. Any fetch/parse failure is swallowed so a network
// hiccup or bad token never blocks the app from loading.
async function autoPullIfNewer() {
  const cfg = await getSyncConfig();
  if (!cfg.token || !cfg.gistId) return false;
  try {
    const payload = await fetchGistPayload(cfg.token, cfg.gistId);
    const localChangeAt = await dbGet('lastLocalChangeAt', null);
    if (!localChangeAt || new Date(payload.savedAt) > new Date(localChangeAt)) {
      await applySyncPayload(payload);
      await setSyncConfig({ ...cfg, lastSyncedAt: payload.savedAt });
      return true;
    }
  } catch (e) {
    // silent — sync is a convenience layer, not a load-bearing dependency
  }
  return false;
}
