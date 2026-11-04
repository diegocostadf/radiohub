// RadioHub main process. GPL-3.0-or-later.
// Desenvolvido por Diego Costa · www.diegocosta.digital
'use strict';
const { app, BrowserWindow, ipcMain, dialog, safeStorage, shell, clipboard, nativeImage } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const ai = require('./ai');

const DEV = {
  name: 'Diego Costa', phone: '61 99862-6377', whatsapp: 'https://wa.me/5561998626377',
  site: 'https://www.diegocosta.digital', email: 'contato@diegocosta.digital', pix: 'pix@diegocosta.digital'
};

let win = null;
let engine = null;
let nextId = 1;
const pending = new Map();

// ------------------------------------------------------------ logging
function logLine(text) {
  try {
    const dir = path.join(app.getPath('home'), 'RadioHub', 'logs');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'radiohub.log'), new Date().toISOString() + ' ' + text + '\n');
  } catch {}
}

// ------------------------------------------------------------ engine
function enginePaths() {
  if (app.isPackaged) {
    const res = process.resourcesPath;
    return { py: path.join(res, 'python', 'bin', 'python3'), script: path.join(res, 'engine', 'engine.py') };
  }
  const local = path.join(__dirname, 'python', 'bin', 'python3');
  const py = process.env.RADIOHUB_PYTHON || (fs.existsSync(local) && process.platform === 'darwin' ? local : 'python3');
  return { py, script: path.join(__dirname, 'engine', 'engine.py') };
}

function startEngine() {
  const { py, script } = enginePaths();
  engine = spawn(py, ['-I', '-u', script], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONNOUSERSITE: '1' } });
  const rl = readline.createInterface({ input: engine.stdout });
  rl.on('line', (line) => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.event) { send('engine-event', msg); return; }
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.error) p.reject(msg.error); else p.resolve(msg.result);
  });
  let errTail = '';
  engine.stderr.on('data', (d) => { errTail = (errTail + d.toString()).slice(-4000); logLine('[motor] ' + d.toString().trimEnd()); });
  logLine('motor iniciado: ' + py + ' ' + script);
  engine.on('exit', (code) => {
    for (const p of pending.values()) p.reject({ message: 'O motor parou (código ' + code + '). ' + errTail.slice(-400) });
    pending.clear();
    send('engine-event', { event: 'engine-exit', code, log: errTail });
    engine = null;
  });
}

function callEngine(method, params) {
  if (!engine) startEngine();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    engine.stdin.write(JSON.stringify({ id, method, params: params || {} }) + '\n');
  });
}

function send(ch, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(ch, payload);
}

// ------------------------------------------------------------ settings & keys
const ud = (...p) => path.join(app.getPath('userData'), ...p);
function readSettings() { try { return JSON.parse(fs.readFileSync(ud('settings.json'), 'utf8')); } catch { return {}; } }
function writeSettings(s) { fs.mkdirSync(ud(), { recursive: true }); fs.writeFileSync(ud('settings.json'), JSON.stringify(s, null, 2)); }
const enc = (t) => (safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(t) : Buffer.from(t, 'utf8')).toString('base64');
const dec = (b) => { const buf = Buffer.from(b, 'base64'); return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8'); };
function readKeys() {
  let keys = {};
  try { keys = JSON.parse(fs.readFileSync(ud('keys.json'), 'utf8')); } catch {}
  // migrate the 0.1.x single Claude key
  try {
    if (!keys.claude && fs.existsSync(ud('anthropic.key'))) {
      const raw = fs.readFileSync(ud('anthropic.key'));
      keys.claude = enc(safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8'));
      fs.writeFileSync(ud('keys.json'), JSON.stringify(keys), { mode: 0o600 });
      fs.unlinkSync(ud('anthropic.key'));
    }
  } catch {}
  return keys;
}
function getKey(provider) { try { const k = readKeys()[provider]; return k ? dec(k) : ''; } catch { return ''; } }
function setKey(provider, key) {
  const keys = readKeys();
  if (key) keys[provider] = enc(key); else delete keys[provider];
  fs.mkdirSync(ud(), { recursive: true });
  fs.writeFileSync(ud('keys.json'), JSON.stringify(keys), { mode: 0o600 });
}
function publicSettings() {
  const s = readSettings();
  const keys = readKeys();
  const provider = s.provider || ai.DEFAULT_PROVIDER;
  return {
    ...s, provider, models: s.models || {},
    hasKey: Object.fromEntries(Object.keys(ai.PROVIDERS).map((id) => [id, ai.PROVIDERS[id].noKey || !!keys[id]])),
    providers: ai.publicProviders(), dev: DEV, version: app.getVersion()
  };
}

// ------------------------------------------------------------ IPC helpers
function asError(e) {
  if (e instanceof Error) return e;
  const msg = (e && e.message) || String(e);
  const kind = (e && e.kind) ? '[' + e.kind + '] ' : '';
  return new Error(kind + msg + (e && e.detail ? '\n@@DETAIL@@\n' + e.detail : ''));
}
const wrap = (fn) => async (...args) => {
  try { return await fn(...args); }
  catch (e) { logLine('ERRO ' + ((e && e.message) || e) + (e && e.detail ? '\n' + e.detail : '')); throw asError(e); }
};

ipcMain.handle('engine', wrap((_e, method, params) => callEngine(method, params)));
ipcMain.handle('settings:get', () => publicSettings());
ipcMain.handle('settings:set', (_e, patch) => {
  const { apiKey, keyProvider, ...rest } = patch || {};
  if (apiKey !== undefined) setKey(keyProvider || readSettings().provider || ai.DEFAULT_PROVIDER, apiKey);
  const s = readSettings();
  if (rest.models) rest.models = { ...(s.models || {}), ...rest.models };
  writeSettings({ ...s, ...rest });
  return publicSettings();
});

// ------------------------------------------------------------ AI
function currentAI(over) {
  const s = readSettings();
  const provider = (over && over.provider) || s.provider || ai.DEFAULT_PROVIDER;
  return { provider, key: getKey(provider), model: ((s.models || {})[provider]) || '' };
}
ipcMain.handle('ai:chat', wrap((_e, { history, text, context }) => { const c = currentAI(); return ai.chat({ ...c, history, text, context }); }));
ipcMain.handle('ai:test', wrap((_e, provider) => { const c = currentAI({ provider }); return ai.ping(c.provider, c.key, c.model); }));
ipcMain.handle('ai:models', wrap((_e, provider) => { const c = currentAI({ provider }); return ai.listModels(c.provider, c.key); }));

// Key wizard: opens the provider's official key page in an app window and
// captures the key when the user clicks Copy there. Third parties cannot mint
// keys on a user's behalf, so this is the shortest legitimate path.
let consoleWin = null;
let keyWatch = null;
function openSite(url, onClosed) {
  if (consoleWin && !consoleWin.isDestroyed()) { consoleWin.loadURL(url); consoleWin.focus(); return consoleWin; }
  consoleWin = new BrowserWindow({
    parent: win, width: 1120, height: 800, backgroundColor: '#ffffff', title: 'Crie a chave e clique em Copiar',
    webPreferences: { partition: 'persist:providers', contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  consoleWin.on('page-title-updated', (e) => e.preventDefault());
  consoleWin.webContents.setWindowOpenHandler(({ url: u }) => {
    if (!/^https:\/\//.test(u)) return { action: 'deny' };
    return { action: 'allow', overrideBrowserWindowOptions: { parent: consoleWin, webPreferences: { partition: 'persist:providers', contextIsolation: true, sandbox: true } } };
  });
  consoleWin.on('closed', () => { consoleWin = null; if (onClosed) onClosed(); });
  consoleWin.loadURL(url);
  return consoleWin;
}
ipcMain.handle('key:wizard', (_e, provider) => new Promise((resolve) => {
  const p = ai.PROVIDERS[provider];
  if (!p || !p.keyUrl) return resolve({ ok: false, reason: 'no-key-needed' });
  if (keyWatch) { if (consoleWin) consoleWin.focus(); return resolve({ ok: false, reason: 'already-open' }); }
  const before = (clipboard.readText() || '').trim();
  let finished = false;
  const finish = (r) => { if (finished) return; finished = true; clearInterval(keyWatch); keyWatch = null; resolve(r); };
  keyWatch = setInterval(() => {
    const t = (clipboard.readText() || '').trim();
    const m = t.match(p.keyRe);
    if (m && t !== before) {
      setKey(provider, m[0]);
      clipboard.writeText('');
      finish({ ok: true });
      if (consoleWin) consoleWin.close();
    }
  }, 600);
  openSite(p.keyUrl, () => finish({ ok: false, reason: 'closed' }));
}));
ipcMain.handle('key:billing', () => { openSite('https://console.anthropic.com/settings/billing'); return true; });

// ------------------------------------------------------------ radio photos
const photoPath = (modelId) => ud('photos', String(modelId).replace(/[^\w.-]+/g, '_') + '.png');
ipcMain.handle('photo:get', (_e, modelId) => {
  try { const p = photoPath(modelId); return fs.existsSync(p) ? 'data:image/png;base64,' + fs.readFileSync(p).toString('base64') : null; } catch { return null; }
});
ipcMain.handle('photo:choose', async (_e, modelId) => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Imagens', extensions: ['jpg', 'jpeg', 'png', 'heic', 'webp', 'gif'] }] });
  if (r.canceled) return null;
  let img = nativeImage.createFromPath(r.filePaths[0]);
  if (img.isEmpty()) throw new Error('Não consegui abrir essa imagem.');
  const s = img.getSize(); const max = 720;
  if (Math.max(s.width, s.height) > max) img = img.resize(s.width > s.height ? { width: max } : { height: max });
  fs.mkdirSync(ud('photos'), { recursive: true });
  fs.writeFileSync(photoPath(modelId), img.toPNG());
  return img.toDataURL();
});
ipcMain.handle('photo:remove', (_e, modelId) => { try { fs.unlinkSync(photoPath(modelId)); } catch {} return true; });

// ------------------------------------------------------------ files & links
ipcMain.handle('file:open', async (_e, kind) => {
  const filters = kind === 'csv' ? [{ name: 'CSV do CHIRP', extensions: ['csv'] }] : [{ name: 'Imagem do rádio', extensions: ['img'] }];
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('file:save', async (_e, kind, suggested) => {
  const ext = kind === 'csv' ? 'csv' : 'img';
  const r = await dialog.showSaveDialog(win, { defaultPath: suggested || ('radio.' + ext), filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
  return r.canceled ? null : r.filePath;
});
ipcMain.handle('shell:reveal', (_e, p) => { if (p) shell.showItemInFolder(p); });
ipcMain.handle('shell:open', (_e, url) => { if (/^(https:\/\/|mailto:)/.test(url)) shell.openExternal(url); });
ipcMain.handle('clipboard:write', (_e, text) => { clipboard.writeText(String(text || '')); return true; });

// ------------------------------------------------------------ updates
// Releases live on GitHub; the site (radiohub.diegocosta.digital) reads the
// same releases. The app checks on launch and every 6 h, asks the user, then
// downloads the DMG itself (no browser, so no quarantine prompt) and opens it.
const UPDATE = { repo: require('./package.json').radiohub.updateRepo, asset: 'RadioHub-mac-arm64.dmg', site: 'https://radiohub.diegocosta.digital' };
let latestRelease = null;
function newer(a, b) { // a > b ?
  const pa = String(a).replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b).replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0); }
  return false;
}
// The site publishes /update.json ({"repo":"owner/name","asset":"..."}) so the
// release location can change without shipping a new app.
async function resolveRepo() {
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 6000);
    const r = await fetch(UPDATE.site + '/update.json', { signal: ctl.signal, cache: 'no-store' });
    clearTimeout(t);
    if (r.ok) {
      const j = await r.json();
      if (j && /^[\w.-]+\/[\w.-]+$/.test(j.repo || '') && !/OWNER/.test(j.repo)) { if (j.asset) UPDATE.asset = j.asset; return j.repo; }
    }
  } catch {}
  return UPDATE.repo && !/OWNER/.test(UPDATE.repo) ? UPDATE.repo : null;
}
async function checkForUpdates(manual) {
  const repo = await resolveRepo();
  if (!repo) return { available: false, current: app.getVersion(), reason: 'not-configured' };
  try {
    const r = await fetch('https://api.github.com/repos/' + repo + '/releases/latest', { headers: { accept: 'application/vnd.github+json', 'user-agent': 'RadioHub/' + app.getVersion() } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const rel = await r.json();
    const asset = (rel.assets || []).find((a) => a.name === UPDATE.asset) || (rel.assets || []).find((a) => /\.dmg$/i.test(a.name));
    const version = String(rel.tag_name || '').replace(/^v/, '');
    latestRelease = { version, notes: rel.body || '', date: rel.published_at, url: asset && asset.browser_download_url, size: asset && asset.size, page: rel.html_url };
    const available = !!asset && newer(version, app.getVersion());
    const skipped = readSettings().skipVersion === version;
    if (available && (manual || !skipped)) send('update-available', latestRelease);
    return { available, current: app.getVersion(), latest: latestRelease };
  } catch (e) {
    logLine('update check failed: ' + e.message);
    if (manual) throw e;
    return { available: false, current: app.getVersion(), error: e.message };
  }
}
ipcMain.handle('update:check', wrap(() => checkForUpdates(true)));
ipcMain.handle('update:skip', (_e, version) => { writeSettings({ ...readSettings(), skipVersion: version }); return true; });
ipcMain.handle('update:download', wrap(async () => {
  if (!latestRelease || !latestRelease.url) throw new Error('Nenhuma atualização disponível.');
  const dest = path.join(app.getPath('downloads'), 'RadioHub-' + latestRelease.version + '.dmg');
  const r = await fetch(latestRelease.url, { headers: { 'user-agent': 'RadioHub/' + app.getVersion() } });
  if (!r.ok || !r.body) throw new Error('Download falhou (HTTP ' + r.status + ').');
  const total = parseInt(r.headers.get('content-length') || latestRelease.size || 0, 10);
  const out = fs.createWriteStream(dest + '.part');
  let got = 0; let lastSent = 0;
  for await (const chunk of r.body) {
    out.write(chunk); got += chunk.length;
    if (Date.now() - lastSent > 250) { lastSent = Date.now(); send('update-progress', { got, total }); }
  }
  await new Promise((res, rej) => out.end((err) => (err ? rej(err) : res())));
  if (total && got < total) throw new Error('Download incompleto. Tente de novo.');
  fs.renameSync(dest + '.part', dest);
  send('update-progress', { got, total: total || got });
  const err = await shell.openPath(dest);
  if (err) throw new Error('Baixei o instalador em ' + dest + ', mas não consegui abrir: ' + err);
  return { path: dest };
}));
ipcMain.handle('app:quit', () => { app.quit(); });

// ------------------------------------------------------------ window
function createWindow() {
  win = new BrowserWindow({
    width: 1360, height: 880, minWidth: 1040, minHeight: 680,
    backgroundColor: '#0F1115', titleBarStyle: 'hiddenInset', title: 'RadioHub',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
}

app.setAboutPanelOptions({
  applicationName: 'RadioHub', applicationVersion: app.getVersion(),
  credits: 'Desenvolvido por ' + DEV.name + ' · ' + DEV.phone + '\n' + DEV.site.replace('https://', '') + ' · ' + DEV.email + '\nApoio via Pix: ' + DEV.pix + '\n\nDrivers de rádio: CHIRP (GPL v3)',
  copyright: '© 2026 ' + DEV.name
});
app.whenReady().then(() => {
  startEngine(); createWindow();
  setTimeout(() => checkForUpdates(false), 6000);
  setInterval(() => checkForUpdates(false), 6 * 3600 * 1000);
});
app.on('window-all-closed', () => { if (engine) engine.kill(); app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
