
'use strict';

const { app, BrowserWindow, ipcMain, dialog, Menu, shell, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');

const { resolveTools, probeFile, extractCover } = require('./ffmpeg');
const convert = require('./convert');
const lyrics = require('./lyrics');
const { Playlist } = require('./playlist');
const I18N = require('../renderer/i18n');
const { PlayerSession } = require('./player');
const wine = require('./wine');
const paths = require('./paths');
const eq = require('./eq');
const playcounts = require('./playcounts');






const wineRuntime = process.platform === 'win32'
  ? wine.detectWine({ readRegistry: wine.readWineRegistry })
  : { detected: false, version: null, source: null, label: 'Wine', envHits: [] };
if (wineRuntime.detected) {
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-gpu-sandbox');
  try { app.disableHardwareAcceleration(); } catch {  }
}

const APP_ROOT = path.resolve(__dirname, '..', '..');

const APP_ROOT_UNPACKED = APP_ROOT.includes('app.asar')
  ? APP_ROOT.replace('app.asar', 'app.asar.unpacked')
  : APP_ROOT;
const RESOURCES_DIR = process.resourcesPath || '';
const SELFTEST = process.argv.includes('--selftest');

const APP_DISPLAY_NAME = 'iRix Audio Player';
const DATA_DIR_NAME = 'iRixAudioPlayer-data';
const LEGACY_APP_NAME = 'Aurora Player';           
const LEGACY_DATA_DIR_NAME = 'AuroraPlayer-data';




const PREVIOUS_DATA_DIR_NAMES = ['IRiXAudioPlayer-data', LEGACY_DATA_DIR_NAME];
const PREVIOUS_APP_NAMES = ['IRiX Audio Player', LEGACY_APP_NAME];


function hasMeaningfulData(name, file) {
  try {
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (name === 'playlist.json') return Array.isArray(json.items) && json.items.length > 0;
    return json && Object.keys(json).length > 0;
  } catch {
    return false;                       
  }
}








function migrateLegacyData(destDir) {
  let moved = 0;
  for (const legacyName of PREVIOUS_DATA_DIR_NAMES) {
    const legacy = path.join(path.dirname(destDir), legacyName);
    if (!fs.existsSync(legacy)) continue;
    if (path.resolve(legacy).toLowerCase() === path.resolve(destDir).toLowerCase()) continue;  
    try {
      fs.mkdirSync(destDir, { recursive: true });
      for (const name of ['settings.json', 'playlist.json']) {
        const from = path.join(legacy, name);
        const to = path.join(destDir, name);
        if (!fs.existsSync(from)) continue;
        if (fs.existsSync(to) && hasMeaningfulData(name, to)) continue;   
        try {
          fs.copyFileSync(from, to);
          moved++;
        } catch {  }
      }
    } catch {  }
  }
  return moved > 0;
}


if (process.env.PORTABLE_EXECUTABLE_DIR) {
  try {
    const base = process.env.PORTABLE_EXECUTABLE_DIR;
    const target = path.join(base, DATA_DIR_NAME);
    migrateLegacyData(target);
    
    const existed = PREVIOUS_DATA_DIR_NAMES
      .map((n) => path.join(base, n))
      .find((p) => fs.existsSync(p));
    app.setPath('userData', !fs.existsSync(target) && existed ? existed : target);
  } catch {  }
} else {
  
  try {
    const current = app.getPath('userData');
    for (const prevName of PREVIOUS_APP_NAMES) {
      const legacy = path.join(app.getPath('appData'), prevName);
      if (path.resolve(legacy).toLowerCase() === path.resolve(current).toLowerCase()) continue;
      if (fs.existsSync(current) || !fs.existsSync(legacy)) continue;
      fs.mkdirSync(current, { recursive: true });
      for (const name of ['settings.json', 'playlist.json']) {
        const from = path.join(legacy, name);
        if (fs.existsSync(from)) {
          try { fs.copyFileSync(from, path.join(current, name)); } catch {  }
        }
      }
    }
  } catch {  }
}

const DEFAULT_SETTINGS = {
  backend: 'wasapi-shared',      
  deviceId: '',                  
  sampleRate: 48000,             
  channels: 2,
  bits: 32,                      
  exclusive: false,
  bufferMs: 100,
  periodMs: 10,
  ringMs: 300,                   
  allowFormatFallback: true,
  volume: 0.8,
  muted: false,                  
  repeat: 'off',                 
  shuffle: false,
  themeColor: '#35d07f',         
  uiTheme: 'dark',               
  bgSource: 'none',              
  bgLocalPath: '',               
  bgApiUrl: '',                  
  bgOpacity: 0.7,                 
  bgBlur: 18,                    
  browserSplit: 0.5,             
  peakOffsetMs: 0,               
  wineCompat: 'auto',            
  eq: null,                      
  language: 'auto',              
  ffmpegPath: '',
  lyricsPicks: {},               
  lyricsOffsetMs: 0,            
  sidePanel: 'info',             
};

let mainWindow = null;
let settings = { ...DEFAULT_SETTINGS };
let playlist = null;
let player = null;
let tools = { ffmpeg: null, ffprobe: null };

let playingTrackId = null;


function imageToDataUrl(file, maxWidth = 2560) {
  if (!file || !fs.existsSync(file)) return null;
  try {
    const img = nativeImage.createFromPath(file);
    if (img.isEmpty()) return null;
    const { width } = img.getSize();
    const out = width > maxWidth ? img.resize({ width: maxWidth, quality: 'good' }) : img;
    return out.toDataURL({ scaleFactor: 1 }).replace(/^data:image\/png/, 'data:image/png');
  } catch {
    return null;
  }
}


function fetchUrl(url, timeoutMs = 20000, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('too many redirects'));
    let mod;
    try {
      mod = new URL(url).protocol === 'http:' ? require('http') : require('https');
    } catch (err) {
      return reject(err);
    }
    const req = mod.get(url, { timeout: timeoutMs, headers: { 'User-Agent': 'iRix-Audio-Player' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        let next = res.headers.location;
        if (!/^https?:/i.test(next)) next = new URL(next, url).toString();
        return resolve(fetchUrl(next, timeoutMs, redirects + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      let total = 0;
      res.on('data', (c) => {
        total += c.length;
        if (total > 24 * 1024 * 1024) {           
          req.destroy();
          reject(new Error('image too large'));
          return;
        }
        chunks.push(c);
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
  });
}

function mt(key, vars) {
  let lang = 'auto';
  try { lang = settings?.language || 'auto'; } catch {  }
  let locale = '';
  try { locale = app.getLocale(); } catch {  }
  return I18N.translate(I18N.resolve(lang, locale), key, vars);
}






let elevatedCache = null;
function isElevatedProcess() {
  if (elevatedCache !== null) return elevatedCache;
  elevatedCache = false;
  if (process.platform !== 'win32') return elevatedCache;
  if (wineRuntime.detected) return elevatedCache;      
  try {
    const out = require('child_process').execFileSync('whoami', ['/groups'], {
      encoding: 'utf8', windowsHide: true, timeout: 4000,
    });
    elevatedCache = /S-1-16-12288/.test(out);      
  } catch {  }
  return elevatedCache;
}
const coverCache = new Map();



let wineApplied = { changes: {}, skipped: [], notes: [] };


function applyWineCompat() {
  wineApplied = wine.wineSafeOverrides(settings, wineRuntime);
  if (Object.keys(wineApplied.changes).length) settings = { ...settings, ...wineApplied.changes };
  return wineApplied;
}


function withBackendChain(s) {
  return { ...s, backendChain: wine.backendChain(s.backend, wineRuntime) };
}


function effectiveVolume(s) {
  return s && s.muted ? 0 : (s ? s.volume : 0.8);
}


function wineInfoForUi() {
  const ui = wine.wineUiFlags(wineRuntime, settings);
  return {
    detected: wineRuntime.detected,
    version: wineRuntime.version,
    label: wineRuntime.label,
    source: wineRuntime.source,
    mode: settings.wineCompat || 'auto',
    active: ui.active,
    noGlass: ui.noGlass,
    applied: Object.keys(wineApplied.changes),
    skipped: wineApplied.skipped,
    notes: wineApplied.notes,
    unsupported: wine.WINE_UNSUPPORTED_BACKENDS,
    chain: wine.backendChain(settings.backend, wineRuntime),
  };
}

function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json');
}
function playlistFile() {
  return path.join(app.getPath('userData'), 'playlist.json');
}
function userDataDir() {
  return app.getPath('userData');
}


function sanitizeFileName(name) {
  return String(name || 'audio')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'audio';
}

async function loadSettings() {
  try {
    const raw = await fsp.readFile(settingsFile(), 'utf8');
    settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {  }
  applyWineCompat();
}

async function saveSettings() {
  try {
    await fsp.mkdir(path.dirname(settingsFile()), { recursive: true });
    await fsp.writeFile(settingsFile(), JSON.stringify(settings, null, 2), 'utf8');
  } catch {  }
}

function refreshTools() {
  tools = resolveTools({
    explicitPath: settings.ffmpegPath,
    appRoot: APP_ROOT,
    
    extraDirs: [
      path.join(RESOURCES_DIR, 'ffmpeg', 'bin'),
      path.join(APP_ROOT_UNPACKED, 'vendor', 'ffmpeg', 'bin'),
    ],
  });
  if (player) player.setTools(tools);
  return tools;
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    
    width: 1366,
    height: 768,
    minWidth: 1366,
    minHeight: 768,
    backgroundColor: '#0d1014',
    title: APP_DISPLAY_NAME,
    show: true,
    
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  
  
  const openExternalSafely = (url) => {
    try {
      const u = new URL(url);
      if (u.protocol === 'http:' || u.protocol === 'https:') shell.openExternal(url);
    } catch {  }
  };

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url);
    return { action: 'deny' };
  });

  
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('file:')) return;      
    event.preventDefault();
    openExternalSafely(url);
  });

  
  const pushMaximized = () => send('window:maximized', !!mainWindow?.isMaximized());
  mainWindow.on('maximize', pushMaximized);
  mainWindow.on('unmaximize', pushMaximized);
  mainWindow.on('enter-full-screen', pushMaximized);
  mainWindow.on('leave-full-screen', pushMaximized);

  return mainWindow;
}

function registerIpc() {
  
  ipcMain.on('window:minimize', () => mainWindow?.minimize());
  ipcMain.on('window:toggle-maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on('window:close', () => mainWindow?.close());
  ipcMain.handle('window:is-maximized', () => !!mainWindow?.isMaximized());

  ipcMain.handle('app:info', async () => {
    let addonInfo = null;
    try {
      addonInfo = player.engine.version();
    } catch {  }
    return {
      appVersion: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      appRoot: APP_ROOT, addon: addonInfo,
      addonPath: player.addonPath,
      resourcesDir: RESOURCES_DIR,
      backends: player.engine.backends(),
      ffmpeg: {
        path: tools.ffmpeg,
        probePath: tools.ffprobe,
        source: tools.source,
        version: tools.version,
        ok: !!tools.ffmpeg,
      },
      settings,
      userData: app.getPath('userData'),
      elevated: isElevatedProcess(),
      bgCooldownMs: 30000,          
      wine: wineInfoForUi(),        
    };
  });

  ipcMain.handle('ffmpeg:set', async (_e, { ffmpegPath }) => {
    settings.ffmpegPath = ffmpegPath || '';
    await saveSettings();
    refreshTools();
    return { path: tools.ffmpeg, probePath: tools.ffprobe, version: tools.version, ok: !!tools.ffmpeg };
  });

  ipcMain.handle('ffmpeg:browse', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: mt('dlg.pickFfmpeg'),
      properties: ['openFile'],
      filters: [{ name: 'ffmpeg', extensions: ['exe'] }],
    });
    if (res.canceled || !res.filePaths.length) return null;
    settings.ffmpegPath = res.filePaths[0];
    await saveSettings();
    refreshTools();
    return { path: tools.ffmpeg, version: tools.version, ok: !!tools.ffmpeg };
  });

  ipcMain.handle('settings:get', () => settings);
  ipcMain.handle('settings:set', async (_e, patch) => {
    const prevKey = player.settingsKey(settings);
    settings = { ...settings, ...patch };
    await saveSettings();
    if ('wineCompat' in patch || 'backend' in patch) applyWineCompat();   
    const changed = player.settingsKey(settings) !== prevKey;
    
    
    if ('volume' in patch || 'muted' in patch) player.setVolume(effectiveVolume(settings));
    return { settings, audioSettingsChanged: changed, wine: wineInfoForUi() };
  });

  ipcMain.handle('devices:list', (_e, { backend }) => player.listDevices(backend || settings.backend));
  ipcMain.handle('devices:probe', (_e, opts) => player.probe(opts));

  
  
  const bgCacheFile = () => path.join(app.getPath('userData'), 'background-cache.img');
  const bgFetchState = { lastAt: 0 };
  const BG_COOLDOWN_MS = 30000;

  ipcMain.handle('bg:get', async () => {
    const src = settings.bgSource;
    if (src === 'local') {
      const url = imageToDataUrl(settings.bgLocalPath);
      return url ? { dataUrl: url, source: 'local', path: settings.bgLocalPath }
        : { dataUrl: null, source: 'local', error: 'local-unreadable' };
    }
    if (src === 'network') {
      const file = bgCacheFile();
      const url = fs.existsSync(file) ? imageToDataUrl(file) : null;
      return { dataUrl: url, source: 'network', cooldownMs: 0 };
    }
    return { dataUrl: null, source: 'none' };
  });

  ipcMain.handle('bg:pick', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: mt('dlg.pickImage'),
      properties: ['openFile'],
      filters: [{ name: mt('dlg.filter.image'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'avif'] }],
    });
    if (res.canceled || !res.filePaths.length) return { canceled: true };
    const file = res.filePaths[0];
    const url = imageToDataUrl(file);
    if (!url) return { canceled: false, error: mt('err.imageUnreadable') };
    settings.bgSource = 'local';
    settings.bgLocalPath = file;
    await saveSettings();
    return { canceled: false, dataUrl: url, path: file };
  });

  
  ipcMain.handle('bg:fetch', async () => {
    const now = Date.now();
    const waitMs = BG_COOLDOWN_MS - (now - bgFetchState.lastAt);
    if (bgFetchState.lastAt && waitMs > 0) {
      return { ok: false, cooldownMs: waitMs, error: mt('err.bgCooldown', { s: Math.ceil(waitMs / 1000) }) };
    }
    const url = (settings.bgApiUrl || '').trim() || 'https://picsum.photos/1920/1080';
    try {
      const buf = await fetchUrl(url, 20000);
      if (!buf || !buf.length) return { ok: false, cooldownMs: 0, error: mt('err.bgFetch') };
      const file = bgCacheFile();
      fs.writeFileSync(file, buf);
      const dataUrl = imageToDataUrl(file);
      if (!dataUrl) return { ok: false, cooldownMs: 0, error: mt('err.bgFetch') };
      bgFetchState.lastAt = Date.now();
      settings.bgSource = 'network';
      await saveSettings();
      return { ok: true, dataUrl, url, cooldownMs: BG_COOLDOWN_MS, bytes: buf.length };
    } catch (err) {
      return { ok: false, cooldownMs: 0, error: mt('err.bgFetch') + ` (${err.message})` };
    }
  });

  
  ipcMain.handle('cover:get', async (_e, { trackId, path: filePath } = {}) => {
    const track = trackId ? playlist.get(trackId) : null;
    const file = (track && (track.playPath || track.path)) || filePath;
    if (!file) return { dataUrl: null };
    const key = `${file}|${track?.mtime || 0}`;
    if (coverCache.has(key)) return coverCache.get(key);
    let out = { dataUrl: null };
    if (track ? track.hasCover !== false : true) {
      try {
        const cover = await extractCover(file, tools, { maxSize: 512 });
        if (cover) out = { dataUrl: cover.dataUrl, bytes: cover.bytes, mime: cover.mime };
      } catch {  }
    }
    coverCache.set(key, out);
    if (coverCache.size > 128) coverCache.delete(coverCache.keys().next().value);
    return out;
  });

  
  
  const AUDIO_EXT = new Set([
    '.flac', '.wav', '.mp3', '.aac', '.m4a', '.mp4', '.ogg', '.oga', '.opus', '.wma',
    '.aiff', '.aif', '.ape', '.alac', '.mka', '.tak', '.wv', '.dsf', '.dff', '.mid', '.midi',
  ]);

  const defaultBrowseDir = () => {
    try {
      const music = app.getPath('music');
      if (music && fs.existsSync(music)) return music;
    } catch {  }
    return app.getPath('home');
  };

  ipcMain.handle('fs:home', () => {
    const pick = (name) => { try { return app.getPath(name); } catch { return ''; } };
    return {
      music: defaultBrowseDir(),
      home: app.getPath('home'),
      desktop: pick('desktop'),
      downloads: pick('downloads'),
    };
  });

  
  const DRIVES_ROOT = '::drives';

  async function listDrives() {
    if (process.platform !== 'win32') {
      return [{ name: '/', path: '/', isDir: true, drive: true, size: 0, mtime: 0, ext: '' }];
    }
    const out = [];
    for (let i = 0; i < 26; i++) {
      const root = `${String.fromCharCode(65 + i)}:\\`;
      let st = null;
      try { st = await fsp.stat(root); } catch { continue; }        
      if (!st.isDirectory()) continue;
      let total = 0;
      let free = 0;
      try {
        const sf = await fsp.statfs(root);                          
        total = sf.blocks * sf.bsize;
        free = sf.bavail * sf.bsize;
      } catch {  }
      out.push({
        name: root, path: root, isDir: true, drive: true,
        size: 0, mtime: 0, ext: '', total, free,
      });
    }
    return out;
  }

  ipcMain.handle('fs:list', async (_e, { dir } = {}) => {
    
    if (dir === DRIVES_ROOT) {
      return { dir: DRIVES_ROOT, parent: null, entries: await listDrives(), drives: true };
    }
    const base = dir && typeof dir === 'string' ? dir : defaultBrowseDir();
    let st = null;
    try { st = await fsp.stat(base); } catch {  }
    if (!st || !st.isDirectory()) {
      const fallback = defaultBrowseDir();
      if (path.resolve(fallback) === path.resolve(base)) throw new Error(mt('err.notDir'));
      return { dir: fallback, parent: parentOf(fallback), entries: await readDirEntries(fallback), fallback: true };
    }
    return {
      dir: base,
      parent: parentOf(base),
      entries: await readDirEntries(base),
    };
  });

  
  function parentOf(dir) {
    const parent = path.dirname(dir);
    if (parent !== dir) return parent;
    return process.platform === 'win32' ? DRIVES_ROOT : null;
  }

  
  ipcMain.handle('fs:stat', async (_e, { input } = {}) => {
    const parsed = paths.parsePathInput(input, {
      platform: process.platform,
      env: process.env,
      home: app.getPath('home'),
    });
    if (!parsed.ok) return { ok: false, reason: parsed.reason };

    const target = parsed.path;
    let st = null;
    try { st = await fsp.stat(target); } catch {  }
    if (!st) return { ok: false, reason: 'not-found', path: target, parent: path.dirname(target) };

    if (st.isDirectory()) {
      return { ok: true, kind: 'dir', path: target, dir: target, parent: path.dirname(target) === target ? null : path.dirname(target) };
    }
    if (st.isFile()) {
      const ext = path.extname(target).toLowerCase();
      const parent = path.dirname(target);
      return {
        ok: true, kind: 'file', path: target, dir: parent,
        parent: path.dirname(parent) === parent ? null : path.dirname(parent),
        name: path.basename(target),
        audio: AUDIO_EXT.has(ext),
      };
    }
    return { ok: false, reason: 'not-dir', path: target };     
  });

  async function readDirEntries(dir) {
    const names = await fsp.readdir(dir, { withFileTypes: true });
    const entries = [];
    for (const d of names) {
      if (d.name.startsWith('.') || d.name.startsWith('$')) continue;      
      const full = path.join(dir, d.name);
      let isDir = d.isDirectory();
      let size = 0;
      let mtime = 0;
      try {
        const s = await fsp.stat(full);
        isDir = s.isDirectory();
        size = s.size;
        mtime = s.mtimeMs;
      } catch { continue; }                                                
      const ext = path.extname(d.name).toLowerCase();
      const audio = !isDir && AUDIO_EXT.has(ext);
      if (!isDir && !audio) continue;                                      
      entries.push({ name: d.name, path: full, isDir, audio, size, mtime, ext });
    }
    entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name, 'zh') : (a.isDir ? -1 : 1)));
    return entries;
  }

  
  
  const currentEq = () => eq.normalizeEqConfig(settings.eq || eq.defaultEqConfig());

  
  ipcMain.handle('plays:get', () => {
    const data = getPlayData();
    return { ranking: playcounts.ranking(data), summary: playcounts.summary(data) };
  });
  
  ipcMain.handle('plays:count', (_e, { trackId } = {}) => {
    const track = trackId ? playlist.get(trackId) : null;
    if (!track) return { ok: false };
    playingTrackId = trackId;
    return { ok: true, plays: countCompletedPlay() };
  });

  
  ipcMain.handle('plays:remove', (_e, { keys } = {}) => {
    const data = getPlayData();
    const removed = playcounts.removeSongs(data, keys);
    if (removed) {
      try {
        playcounts.save(playCountsFile(), data);
      } catch (err) {
        console.error('写入播放次数失败:', err.message);
      }
      send('plays:changed', { removed });
    }
    return { removed, ranking: playcounts.ranking(data), summary: playcounts.summary(data) };
  });

  ipcMain.handle('eq:get', () => ({
    config: currentEq(),
    presets: Object.keys(eq.EQ_PRESETS),
    presetGains: eq.EQ_PRESETS,          
    bands: eq.EQ_BAND_FREQS,
    labels: eq.EQ_BAND_LABELS,
    gainLimit: eq.EQ_GAIN_LIMIT,
    preampRange: [eq.EQ_PREAMP_MIN, eq.EQ_PREAMP_MAX],
  }));

  ipcMain.handle('eq:set', async (_e, { config } = {}) => {
    const next = eq.normalizeEqConfig(config);
    if (eq.eqConfigEquals(settings.eq, next)) return { config: next, unchanged: true };
    settings.eq = next;
    await saveSettings();
    player.setEq(next);                       
    return { config: next };
  });

  
  ipcMain.handle('eq:save', async (_e, { filePath: preset, config } = {}) => {
    const cfg = config ? eq.normalizeEqConfig(config) : currentEq();
    const stamp = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const defaultName =
      `iRix-EQ-${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}` +
      `-${pad(stamp.getHours())}${pad(stamp.getMinutes())}.eq`;
    let target = preset;
    if (!target) {
      let baseDir = '';
      try { baseDir = app.getPath('music'); } catch {  }
      const res = await dialog.showSaveDialog(mainWindow, {
        title: mt('dlg.saveEq'),
        buttonLabel: mt('dlg.save'),
        defaultPath: baseDir ? path.join(baseDir, defaultName) : defaultName,
        filters: [
          { name: mt('dlg.filter.eq'), extensions: ['eq'] },
          { name: mt('dlg.filter.all'), extensions: ['*'] },
        ],
        properties: ['createDirectory', 'showOverwriteConfirmation'],
      });
      if (res.canceled || !res.filePath) return { canceled: true };
      target = res.filePath;
    }
    if (!target.toLowerCase().endsWith('.eq')) target += '.eq';
    try {
      await fsp.writeFile(target, eq.eqToFile(cfg, { appName: APP_DISPLAY_NAME }), 'utf8');
      return { canceled: false, filePath: target };
    } catch (err) {
      return { canceled: false, error: mt('err.saveFailed', { msg: err.message }) };
    }
  });

  
  ipcMain.handle('eq:load', async (_e, { filePath: preset } = {}) => {
    let target = preset;
    if (!target) {
      const res = await dialog.showOpenDialog(mainWindow, {
        title: mt('dlg.openEq'),
        buttonLabel: mt('dlg.open'),
        properties: ['openFile'],
        filters: [
          { name: mt('dlg.filter.eq'), extensions: ['eq'] },
          { name: mt('dlg.filter.all'), extensions: ['*'] },
        ],
      });
      if (res.canceled || !res.filePaths.length) return { canceled: true };
      target = res.filePaths[0];
    }
    try {
      const text = await fsp.readFile(target, 'utf8');
      const parsed = eq.eqFromFile(text);
      if (!parsed.ok) return { canceled: false, error: mt('err.eqBadFile') };
      settings.eq = parsed.config;
      await saveSettings();
      player.setEq(parsed.config);
      return { canceled: false, filePath: target, config: parsed.config };
    } catch (err) {
      return { canceled: false, error: mt('err.eqLoad', { msg: err.message }) };
    }
  });

  ipcMain.handle('playlist:get', () => playlist.list());  ipcMain.handle('playlist:add', async (_e, { paths }) => {
    if (!Array.isArray(paths) || !paths.length) return { added: [], skipped: 0, failed: [] };
    send('playlist:scanning', { total: paths.length });
    const res = await playlist.add(paths, tools, {
      onProgress: (p) => send('playlist:progress', p),
    });
    send('playlist:changed', playlist.list());
    return { added: res.added, skipped: res.skipped, failed: res.failed, scanned: res.scanned };
  });
  ipcMain.handle('playlist:remove', async (_e, { id }) => {
    const items = await playlist.remove(id);
    send('playlist:changed', items);
    return items;
  });
  ipcMain.handle('playlist:clear', async () => {
    const items = await playlist.clear();
    send('playlist:changed', items);
    return items;
  });
  ipcMain.handle('playlist:reorder', async (_e, { id, toIndex }) => {
    const items = await playlist.reorder(id, toIndex);
    send('playlist:changed', items);
    return items;
  });

  
  ipcMain.handle('playlist:save', async (_e, { filePath: preset } = {}) => {
    const items = playlist.list();
    if (!items.length) return { canceled: true, empty: true, error: mt('err.listEmpty') };
    const stamp = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const defaultName =
      `iRix-播放列表-${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}` +
      `-${pad(stamp.getHours())}${pad(stamp.getMinutes())}.playlist`;
    let target = preset;
    if (!target) {
      let musicDir = '';
      try { musicDir = app.getPath('music'); } catch {  }
      const res = await dialog.showSaveDialog(mainWindow, {
        title: mt('dlg.saveList'),
        buttonLabel: mt('dlg.save'),
        defaultPath: musicDir ? path.join(musicDir, defaultName) : defaultName,
        filters: [
          { name: mt('dlg.filter.playlist'), extensions: ['playlist'] },
          { name: mt('dlg.filter.all'), extensions: ['*'] },
        ],
        properties: ['createDirectory', 'showOverwriteConfirmation'],
      });
      if (res.canceled || !res.filePath) return { canceled: true };
      target = res.filePath;
    }
    if (!target.toLowerCase().endsWith('.playlist')) target += '.playlist';
    try {
      const payload = await playlist.saveTo(target);
      return { canceled: false, filePath: target, count: payload.count };
    } catch (err) {
      return { canceled: false, error: mt('err.saveFailed', { msg: err.message }) };
    }
  });

  
  ipcMain.handle('playlist:load', async (_e, { filePath: preset } = {}) => {
    let target = preset;
    if (!target) {
      const res = await dialog.showOpenDialog(mainWindow, {
        title: mt('dlg.openList'),
        buttonLabel: mt('dlg.open'),
        properties: ['openFile'],
        filters: [
          { name: mt('dlg.filter.playlist'), extensions: ['playlist'] },
          { name: mt('dlg.filter.all'), extensions: ['*'] },
        ],
      });
      if (res.canceled || !res.filePaths.length) return { canceled: true };
      target = res.filePaths[0];
    }
    let paths;
    try {
      paths = await Playlist.readPaths(target);
    } catch (err) {
      return { canceled: false, error: mt('err.readListFailed', { msg: err.message }) };
    }
    if (!paths.length) return { canceled: false, error: mt('err.listEmptyFile') };
    send('playlist:scanning', { total: paths.length });
    const out = await playlist.add(paths, tools, { onProgress: (p) => send('playlist:progress', p) });
    send('playlist:changed', playlist.list());
    return {
      canceled: false,
      filePath: target,
      requested: paths.length,
      added: out.added.length,
      skipped: out.skipped,
      failed: out.failed.length,
    };
  });
  ipcMain.handle('playlist:browse', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: mt('dlg.addFiles'),
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: mt('dlg.filter.audio'), extensions: ['flac', 'wav', 'mp3', 'm4a', 'aac', 'ogg', 'opus', 'wma', 'ape', 'aiff', 'dsf', 'mka'] },
        { name: mt('dlg.filter.all'), extensions: ['*'] },
      ],
    });
    if (res.canceled) return { added: [] };
    const out = await playlist.add(res.filePaths, tools, {
      onProgress: (p) => send('playlist:progress', p),
    });
    send('playlist:changed', playlist.list());
    return out;
  });

  ipcMain.handle('player:play', async (_e, { trackId, start }) => {
    const track = playlist.get(trackId);
    if (!track) throw new Error('播放列表中没有该曲目');
    if (!track.ok) throw new Error(`该文件无法解码: ${track.error || '未知原因'}`);
    playingTrackId = trackId;                  
    return player.play(track, withBackendChain(settings), { startSeconds: start || 0 });
  });
  ipcMain.handle('player:pause', () => player.pause());
  ipcMain.handle('player:resume', () => player.resume());
  ipcMain.handle('player:stop', () => player.stop());
  ipcMain.handle('player:seek', (_e, { seconds }) => player.seek(seconds, settings));
  ipcMain.handle('player:volume', (_e, { value }) => {
    settings.volume = player.setVolume(value);
    saveSettings();
    return settings.volume;
  });
  ipcMain.handle('player:release', () => {
    player.release();
    return player.state();
  });
  ipcMain.handle('player:state', () => player.state());

  ipcMain.handle('player:reopen', async () => {    const track = player.track;
    const shouldResume = player.status === 'playing' || player.status === 'paused';
    const position = player.state().position;
    player.stopSource();
    player.closeEngine();
    player.status = 'idle';
    if (shouldResume && track) {
      return player.play(track, withBackendChain(settings), { startSeconds: position });
    }
    return player.state();
  });

  ipcMain.handle('probe:file', async (_e, { file }) => probeFile(file, tools));

  
  
  let runningConvert = null;

  ipcMain.handle('convert:formats', () => ({
    formats: convert.FORMATS.map((f) => ({
      id: f.id, label: f.label, ext: f.ext, lossless: f.lossless, params: f.params, notes: f.notes,
      bitrate: f.bitrate || null, quality: f.quality || null,
      compression: f.compression || null, bitDepth: f.bitDepth || null,
    })),
  }));

  ipcMain.handle('convert:start', async (_e, { trackId, formatId, options } = {}) => {
    const track = trackId ? playlist.get(trackId) : null;
    if (!track) return { ok: false, error: mt('err.noTrack') };
    const fmt = convert.formatById(formatId);
    if (!fmt) return { ok: false, error: mt('err.badFormat') };
    if (!track.ok) return { ok: false, error: track.error || mt('pl.undecodable') };
    if (!tools.ffmpeg) return { ok: false, error: mt('err.noFfmpeg') };
    if (runningConvert) runningConvert.cancel();                  

    const src = track.playPath || track.path;
    const dir = path.dirname(src);                                 
    const fallbackName = sanitizeFileName(
      [track.artist, track.title].filter(Boolean).join(' - ') || path.basename(src, path.extname(src)));
    const base = sanitizeFileName(String(options?.fileName || '').trim() || fallbackName);
    const out = convert.targetPath(dir, base, fmt.ext);

    const started = Date.now();
    send('convert:progress', { progress: 0, phase: 'start' });
    const res = await convert.convert({
      ffmpeg: tools.ffmpeg,
      input: src,
      output: out,
      formatId,
      options: options || {},
      duration: track.duration || 0,
      onProgress: (p) => send('convert:progress', { progress: p, phase: 'encoding' }),
      onSpawn: (c) => { runningConvert = { cancel: () => c.cancel() }; },
    });
    runningConvert = null;
    const ms = Date.now() - started;
    if (res.ok) {
      send('convert:progress', { progress: 1, phase: 'done' });
      send('convert:done', { path: res.path, formatId, ms });
    } else {
      send('convert:done', { failed: true, error: res.error, cancelled: !!res.cancelled });
    }
    return { ...res, ms };
  });

  ipcMain.handle('convert:cancel', () => {
    if (runningConvert) { runningConvert.cancel(); runningConvert = null; return { ok: true, cancelled: true }; }
    
    return { ok: true, cancelled: false };
  });

  
  
  
  ipcMain.handle('lyrics:for', (_e, { trackId } = {}) => {
    const track = trackId ? playlist.get(trackId) : null;
    if (!track) return { found: false, reason: 'no-track' };

    const picked = (settings.lyricsPicks || {})[String(track.path).toLowerCase()];
    if (picked && fs.existsSync(picked)) {
      const raw = lyrics.readLrc(picked);
      if (raw && raw.trim()) {
        return { ...lyrics.parseLyricsText(raw), file: picked, source: 'picked' };
      }
    }
    const resolved = lyrics.resolveLyrics(track);
    return resolved;
  });

  ipcMain.handle('lyrics:pick', async (_e, { trackId } = {}) => {
    const track = trackId ? playlist.get(trackId) : null;
    if (!track) return { ok: false, error: mt('err.noTrack') };
    const res = await dialog.showOpenDialog(mainWindow, {
      title: mt('dlg.pickLyrics'),
      properties: ['openFile'],
      filters: [
        { name: mt('dlg.filter.lyrics'), extensions: ['lrc', 'txt'] },
        { name: mt('dlg.filter.all'), extensions: ['*'] },
      ],
    });
    if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
    const file = res.filePaths[0];
    const raw = lyrics.readLrc(file);
    if (!raw || !raw.trim()) return { ok: false, error: mt('err.lyricsUnreadable') };
    settings.lyricsPicks = { ...(settings.lyricsPicks || {}), [String(track.path).toLowerCase()]: file };
    await saveSettings();
    return { ok: true, ...lyrics.parseLyricsText(raw), file, source: 'picked' };
  });

  
  ipcMain.handle('lyrics:forget', async (_e, { trackId } = {}) => {
    const track = trackId ? playlist.get(trackId) : null;
    if (!track) return { ok: false };
    const key = String(track.path).toLowerCase();
    if (settings.lyricsPicks && settings.lyricsPicks[key]) {
      const next = { ...settings.lyricsPicks };
      delete next[key];
      settings.lyricsPicks = next;
      await saveSettings();
    }
    return { ok: true };
  });

  
  ipcMain.handle('lyrics:read', (_e, { trackId } = {}) => {
    const track = trackId ? playlist.get(trackId) : null;
    if (!track) return { ok: false, error: mt('err.noTrack') };
    const res = lyrics.resolveLyrics(track);
    if (!res.found) return { ok: true, text: '', file: lyrics.lrcPathFor(track), source: 'none' };
    return { ok: true, text: res.raw || '', file: res.file || lyrics.lrcPathFor(track), source: res.source };
  });

  
  ipcMain.handle('lyrics:save', async (_e, { trackId, text } = {}) => {
    const track = trackId ? playlist.get(trackId) : null;
    if (!track) return { ok: false, error: mt('err.noTrack') };
    const resolved = lyrics.resolveLyrics(track);
    const file = resolved.file || lyrics.lrcPathFor(track);
    const saved = lyrics.saveLyrics(file, text);
    if (!saved.ok) return saved;
    settings.lyricsPicks = { ...(settings.lyricsPicks || {}), [String(track.path).toLowerCase()]: file };
    await saveSettings();
    return { ok: true, file };
  });

  ipcMain.handle('shell:showItem', (_e, { file }) => {
    shell.showItemInFolder(file);
    return true;
  });
}

function wirePlayerEvents() {
  player.on('state', (s) => send('player:state', s));
  player.on('progress', (p) => send('player:progress', p));
  player.on('ended', (p) => {
    countCompletedPlay();                     
    send('player:ended', p);
  });
  player.on('error', (e) => send('player:error', e));
  player.on('engine', (e) => send('engine:changed', e));
  player.on('volume', (v) => send('player:volume', v));
}


function playCountsFile() {
  return path.join(userDataDir(), 'play-counts.json');
}

let playData = null;
function getPlayData() {
  if (!playData) playData = playcounts.load(playCountsFile());
  return playData;
}


function countCompletedPlay() {
  const track = playingTrackId ? playlist.get(playingTrackId) : null;
  if (!track) return null;
  const data = getPlayData();
  const plays = playcounts.addPlay(data, track, {
    durationMs: Number.isFinite(track.duration) ? Math.round(track.duration * 1000) : null,
  });
  try {
    playcounts.save(playCountsFile(), data);
  } catch (err) {
    console.error('写入播放次数失败:', err.message);
  }
  send('plays:changed', { key: playcounts.songKey(track), plays });
  return plays;
}


const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', async (_e, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    const files = argv.slice(1).filter((a) => !a.startsWith('-') && fs.existsSync(a));
    if (files.length) {
      const res = await playlist.add(files, tools);
      send('playlist:changed', playlist.list());
      if (res.added.length) send('playlist:added-external', res.added);
    }
  });

  app.whenReady().then(async () => {
    await loadSettings();
    playlist = new Playlist(playlistFile());
    playlist.load();
    player = new PlayerSession({ appRoot: APP_ROOT, extraRoots: [APP_ROOT_UNPACKED, RESOURCES_DIR] });
    refreshTools();
    player.setVolume(effectiveVolume(settings));       
    player.setEq(settings.eq || eq.defaultEqConfig());       
    wirePlayerEvents();

    Menu.setApplicationMenu(Menu.buildFromTemplate([
      {
        label: '文件',
        submenu: [
          { label: '添加音乐…', accelerator: 'CmdOrCtrl+O', click: () => send('menu:add-files') },
          { label: '清空播放列表', click: async () => { await playlist.clear(); send('playlist:changed', playlist.list()); } },
          { type: 'separator' },
          { label: '退出', role: 'quit' },
        ],
      },
      {
        label: '播放',
        submenu: [
          { label: '播放/暂停', accelerator: 'Space', click: () => send('menu:toggle') },
          { label: '停止', click: () => player.stop() },
          { label: '上一首', click: () => send('menu:prev') },
          { label: '下一首', click: () => send('menu:next') },
        ],
      },
      {
        label: '视图',
        submenu: [
          { role: 'reload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
        ],
      },
    ]));

    registerIpc();
    createWindow();

    if (SELFTEST) {
      const { runSelfTest, getSelfTestOutputDir } = require('./selftest');
      runSelfTest({ mainWindow, player, playlist, tools, settings, appRoot: APP_ROOT })
        .then((report) => {
          
          const dir = getSelfTestOutputDir() || app.getPath('userData');
          try {
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, 'selftest-report.json'), JSON.stringify(report, null, 2));
          } catch {  }
          console.log('SELFTEST_OUTPUT_DIR ' + dir);
          console.log('SELFTEST_RESULT ' + JSON.stringify(report.summary));
          app.exit(report.summary.failed ? 1 : 0);
        })
        .catch((err) => {
          console.error('SELFTEST_FAILED', err);
          app.exit(2);
        });
    }
  });

  app.on('window-all-closed', () => {
    if (player) player.dispose();
    app.quit();
  });

  app.on('before-quit', () => {
    if (player) player.dispose();
  });
}
