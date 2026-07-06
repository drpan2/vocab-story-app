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

// GitHub's newer "fine-grained" tokens (prefix github_pat_) don't support
// the classic Gist API the way "classic" tokens (prefix ghp_) do, and this
// is a common mistake since GitHub's own UI nudges new users toward
// fine-grained by default. Checked up front so the error points at the
// actual fix instead of a bare "401".
function tokenLooksFineGrained(token) {
  return token.startsWith('github_pat_');
}

// Does a minimal authenticated request so token problems surface the
// moment the user saves it, instead of only failing later on push/pull.
async function verifyToken(token) {
  if (tokenLooksFineGrained(token)) {
    throw new Error('這是Fine-grained權杖(github_pat_開頭)，Gist功能需要Classic權杖(ghp_開頭)，請用設定頁的連結重新產生一個');
  }
  const res = await fetch('https://api.github.com/user', { headers: ghHeaders(token) });
  if (res.status === 401) throw new Error('權杖無效或已過期，請重新產生一個');
  if (!res.ok) throw new Error(`權杖驗證失敗 (${res.status})`);
  const json = await res.json();
  return json.login;
}

// A device only learns the gist's ID from its OWN push response — gistId
// lives in local config, not in the synced payload itself, so a second
// device that has never pushed has no way to know it yet even though the
// gist already exists under the same GitHub account. Look it up by its
// fixed description before giving up.
async function findExistingGist(token) {
  const res = await fetch('https://api.github.com/gists?per_page=100', { headers: ghHeaders(token) });
  if (!res.ok) return null;
  const list = await res.json();
  const match = list.find((g) => g.description === SYNC_GIST_DESC && g.files && g.files[SYNC_GIST_FILENAME]);
  return match ? match.id : null;
}

// Returns cfg with a resolved gistId (discovering + persisting it if this
// device doesn't have one cached yet), or null in cfg.gistId if truly none
// exists anywhere on this account.
async function ensureGistId(cfg) {
  if (cfg.gistId) return cfg;
  const found = await findExistingGist(cfg.token);
  if (found) {
    const updated = { ...cfg, gistId: found };
    await setSyncConfig(updated);
    return updated;
  }
  return cfg;
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

// Pushes the current local state up, creating the gist on first use (or
// discovering + updating one this device didn't know about yet).
async function syncPush() {
  let cfg = await getSyncConfig();
  if (!cfg.token) throw new Error('請先貼上並儲存GitHub權杖');
  cfg = await ensureGistId(cfg);
  const payload = await buildSyncPayload();
  const body = {
    description: SYNC_GIST_DESC,
    public: false,
    files: { [SYNC_GIST_FILENAME]: { content: JSON.stringify(payload, null, 2) } }
  };
  const url = cfg.gistId ? `https://api.github.com/gists/${cfg.gistId}` : 'https://api.github.com/gists';
  const res = await fetch(url, { method: cfg.gistId ? 'PATCH' : 'POST', headers: ghHeaders(cfg.token), body: JSON.stringify(body) });
  if (res.status === 401) throw new Error('權杖無效或已過期，請到設定頁重新儲存一個新權杖');
  if (!res.ok) throw new Error(`GitHub API 錯誤 (${res.status})`);
  const json = await res.json();
  await setSyncConfig({ ...cfg, gistId: json.id, lastSyncedAt: payload.savedAt });
  await dbSet('lastLocalChangeAt', payload.savedAt);
  return payload.savedAt;
}

// Pulls the gist and overwrites local state unconditionally (user tapped
// "restore from cloud" on purpose, so no timestamp comparison here).
async function syncPull() {
  let cfg = await getSyncConfig();
  if (!cfg.token) throw new Error('還沒有雲端備份可以還原');
  cfg = await ensureGistId(cfg);
  if (!cfg.gistId) throw new Error('還沒有雲端備份可以還原');
  const payload = await fetchGistPayload(cfg.token, cfg.gistId);
  await applySyncPayload(payload);
  await setSyncConfig({ ...cfg, lastSyncedAt: payload.savedAt });
  return payload.savedAt;
}

async function fetchGistPayload(token, gistId) {
  const res = await fetch(`https://api.github.com/gists/${gistId}`, { headers: ghHeaders(token) });
  if (res.status === 401) throw new Error('權杖無效或已過期，請到設定頁重新儲存一個新權杖');
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
  let cfg = await getSyncConfig();
  if (!cfg.token) return false;
  try {
    cfg = await ensureGistId(cfg);
    if (!cfg.gistId) return false;
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
