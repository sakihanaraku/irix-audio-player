
'use strict';

const { app, BrowserWindow, ipcMain, dialog, Menu, shell, nativeImage } = require('electron');
const path = require('node:path');
const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');

const { resolveTools, probeFile, extractCover } = require('./ffmpeg');
const convert = require('./convert');
const lyrics = require('./lyrics');
const { Playlist } = require('./playlist');
const I18N = require('../renderer/i18n');
const { PlayerSession } = require('./player');
const { Extensions } = require('./extensions');
const { resolvePlayableTarget } = require('./playable');
const nodeCrypto = require('node:crypto');
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




if (process.platform === 'win32') {
  try { app.setAppUserModelId('com.irix.audioplayer'); } catch {  }
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






function findLegacySettingsSource(base, target) {
  const candidates = [];
  const add = (dir) => { if (dir) candidates.push(dir); };
  try {
    
    add(path.join(base, DATA_DIR_NAME));
    add(path.join(path.dirname(base), DATA_DIR_NAME));
    add(path.join(path.dirname(path.dirname(base)), DATA_DIR_NAME));
    
    for (const sub of ['Downloads', 'Desktop', 'Documents']) {
      try { add(path.join(app.getPath('home'), sub, DATA_DIR_NAME)); } catch {  }
      try { add(path.join(app.getPath('home'), sub, PREVIOUS_DATA_DIR_NAMES[0])); } catch {  }
    }
    
    for (const name of [DATA_DIR_NAME, 'iRix Audio Player', 'irix-audio-player', ...PREVIOUS_DATA_DIR_NAMES]) {
      try { add(path.join(app.getPath('appData'), name)); } catch {  }
    }
  } catch {  }
  const resolvedTarget = (() => { try { return path.resolve(target).toLowerCase(); } catch { return ''; } })();
  for (const dir of candidates) {
    try {
      if (!dir) continue;
      if (path.resolve(dir).toLowerCase() === resolvedTarget) continue;   
      if (fs.existsSync(path.join(dir, 'settings.json'))) return dir;
    } catch {  }
  }
  return null;
}


if (process.env.PORTABLE_EXECUTABLE_DIR) {
  try {
    const base = process.env.PORTABLE_EXECUTABLE_DIR;
    const target = path.join(base, DATA_DIR_NAME);
    migrateLegacyData(target);
    
    const existed = PREVIOUS_DATA_DIR_NAMES
      .map((n) => path.join(base, n))
      .find((p) => fs.existsSync(p));
    const chosen = !fs.existsSync(target) && existed ? existed : target;
    
    if (!fs.existsSync(path.join(chosen, 'settings.json'))) {
      const legacySettings = findLegacySettingsSource(base, chosen);
      if (legacySettings) {
        try {
          fs.mkdirSync(chosen, { recursive: true });
          for (const name of ['settings.json', 'playlist.json', 'background-cache.img']) {
            const from = path.join(legacySettings, name);
            if (!fs.existsSync(from)) continue;
            try { fs.copyFileSync(from, path.join(chosen, name)); } catch {  }
          }
        } catch {  }
      }
    }
    app.setPath('userData', chosen);
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



const DEFAULT_BACKEND = process.platform === 'linux' ? 'alsa' : 'wasapi-shared';

const DEFAULT_SETTINGS = {
  backend: DEFAULT_BACKEND,      
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
  extensionSettings: {},         
};

let mainWindow = null;
let settings = { ...DEFAULT_SETTINGS };
let playlist = null;
let player = null;
let extensions = null;


function getExtensions() {
  if (!extensions) {
    extensions = new Extensions({
      dir: path.join(app.getPath('userData'), 'extensions'),
      getEnabled: () => (Array.isArray(settings.enabledExtensions) ? settings.enabledExtensions : []),
      saveEnabled: (ids) => { settings.enabledExtensions = ids; return saveSettings(); },
      appVersion: app.getVersion(),
      
      getLanguage: () => I18N.resolve(settings.language, typeof app.getLocale === 'function' ? app.getLocale() : 'en'),
      getSettings: (id) => (settings.extensionSettings && settings.extensionSettings[id]) || {},
      persistSettings: async (id, values) => {
        settings.extensionSettings = { ...(settings.extensionSettings || {}), [id]: values };
        await saveSettings();
      },
      clearSettings: async (id) => {
        const map = { ...(settings.extensionSettings || {}) };
        delete map[id];
        settings.extensionSettings = map;
        await saveSettings();
      },
      log: (...args) => {
        const text = args.map((a) => {
          if (typeof a === 'string') return a;
          try { return JSON.stringify(a); } catch { return String(a); }
        }).join(' ');
        try { console.log('[ext]', text); } catch {  }
        try { debugLog('[ext] ' + text); } catch {  }
      },
      
      onUiChanged: (ui) => send('ext:ui', ui),
    });
  }
  return extensions;
}









async function resolvePlayablePath(filePath, { metaOnly = false } = {}) {
  let rec = null;
  try { rec = getExtensions().findRecord(path.basename(filePath)); } catch { rec = null; }
  const handler = rec ? rec.module : null;
  if (!handler || (typeof handler.decode !== "function" && !(metaOnly && typeof handler.readMeta === "function"))) {
    return filePath;
  }
  const st = await fsp.stat(filePath);
  
  if (metaOnly && typeof handler.readMeta === "function") {
    try {
      const raw = await fsp.readFile(filePath);
      const meta = handler.readMeta(raw, { name: path.basename(filePath) });
      if (meta && typeof meta === "object") return { metaOnly: true, meta };
    } catch (err) {
      debugLog("扩展 readMeta 失败，回退完整解码: " + err.message);
    }
  }
  if (typeof handler.decode !== "function") return filePath;
  const cacheDir = path.join(app.getPath('userData'), 'decode-cache');
  
  const pluginTag = `${rec.manifest.id}@${rec.manifest.version || '0'}`;
  const key = nodeCrypto.createHash("sha1")
    .update(filePath).update(String(st.size)).update(String(st.mtimeMs)).update(pluginTag).digest("hex").slice(0, 16);
  const cached = path.join(cacheDir, key);
  const hit = ["flac", "mp3", "wav", "ogg", "m4a", "aac", "opus"].map((e) => cached + "." + e).find((p) => fs.existsSync(p));
  if (hit) {
    
    let meta = null;
    try { meta = JSON.parse(await fsp.readFile(cached + ".meta.json", "utf8")); } catch { meta = null; }
    
    if (!fs.existsSync(cached + ".cover.img")) {
      try {
        const raw = await fsp.readFile(filePath);
        const r = handler.decode(raw, { name: path.basename(filePath) });
        if (r && r.data && !r.passthrough) {
          if (r.cover && r.cover.length > 64) await fsp.writeFile(cached + ".cover.img", r.cover);
          if (r.meta) {
            await fsp.writeFile(cached + ".meta.json", JSON.stringify(r.meta), "utf8");
            meta = r.meta;
          }
        }
      } catch {  }
    }
    return meta ? { path: hit, meta } : hit;
  }
  let r;
  try {
    const raw = await fsp.readFile(filePath);
    r = handler.decode(raw, { name: path.basename(filePath) });
  } catch (err) {
    throw new Error("扩展解密失败：" + err.message);
  }
  if (!r || !r.data || r.passthrough) return filePath;
  let outData = r.data;
  let outExt = r.ext || "bin";
  
  if (typeof handler.processAudio === "function") {
    try {
      const pr = handler.processAudio(Buffer.from(outData), {
        name: path.basename(filePath), ext: outExt, meta: r.meta || null, sourcePath: filePath,
      });
      if (Buffer.isBuffer(pr)) outData = pr;
      else if (pr && Buffer.isBuffer(pr.data)) {
        outData = pr.data;
        if (pr.ext) outExt = String(pr.ext).replace(/^\./, "").toLowerCase();
      } else {
        throw new Error("processAudio 返回值不合法（需要 Buffer 或 { data, ext }）");
      }
    } catch (err) {
      throw new Error("扩展处理音频失败：" + err.message);
    }
  }
  await fsp.mkdir(cacheDir, { recursive: true });
  const out = cached + "." + outExt;
  await fsp.writeFile(out, outData);
  
  try {
    if (r.cover && r.cover.length > 64) await fsp.writeFile(cached + ".cover.img", r.cover);
  } catch {  }
  
  try {
    if (r.meta) await fsp.writeFile(cached + ".meta.json", JSON.stringify(r.meta), "utf8");
  } catch {  }
  return r.meta ? { path: out, meta: r.meta } : out;
}
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






const BACKUPS_DIR_NAME = 'backups';
const BACKUP_KEEP = 12;

function backupsDir() {
  return path.join(app.getPath('userData'), BACKUPS_DIR_NAME);
}


function backupFileBeforeWrite(file) {
  try {
    if (!fs.existsSync(file)) return;
    const st = fs.statSync(file);
    if (!st.size) return;
    const dir = backupsDir();
    fs.mkdirSync(dir, { recursive: true });
    const base = path.basename(file).replace(/\.(json|img)$/i, '');
    const ext = path.extname(file) || '.json';
    
    const recent = fs.readdirSync(dir).filter((n) => n.startsWith(base + '-')).sort();
    if (recent.length) {
      const last = path.join(dir, recent[recent.length - 1]);
      try {
        if (fs.statSync(last).size === st.size && (Date.now() - fs.statSync(last).mtimeMs) < 5 * 60 * 1000) return;
      } catch {  }
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(file, path.join(dir, base + '-' + stamp + ext));
    
    const all = fs.readdirSync(dir).filter((n) => n.startsWith(base + '-')).sort();
    for (const old of all.slice(0, Math.max(0, all.length - BACKUP_KEEP))) {
      try { fs.rmSync(path.join(dir, old), { force: true }); } catch {  }
    }
  } catch {  }
}


function restoreFromBackup(file) {
  try {
    const dir = backupsDir();
    if (!fs.existsSync(dir)) return false;
    const base = path.basename(file).replace(/\.(json|img)$/i, '');
    const ext = path.extname(file) || '.json';
    const cands = fs.readdirSync(dir).filter((n) => n.startsWith(base + '-') && n.endsWith(ext)).sort().reverse();
    for (const name of cands) {
      const src = path.join(dir, name);
      try {
        const raw = fs.readFileSync(src, 'utf8');
        if (!raw.trim()) continue;
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.copyFileSync(src, file);      
        return JSON.parse(raw);          
      } catch {  }
    }
  } catch {  }
  return false;
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
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('settings 格式不对');
    settings = { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    
    const restored = restoreFromBackup(settingsFile());
    if (restored && typeof restored === 'object' && !Array.isArray(restored)) {
      settings = { ...DEFAULT_SETTINGS, ...restored };
      try { await saveSettings(); } catch {  }
    }
  }
  
  
  const windowsOnlyBackends = ['wasapi-shared', 'wasapi-exclusive', 'directsound', 'mme'];
  if (process.platform === 'linux' && windowsOnlyBackends.includes(settings.backend)) {
    settings.backend = 'alsa';
    settings.deviceId = '';
  }
  if (process.platform === 'win32' && settings.backend === 'alsa') {
    settings.backend = 'wasapi-shared';
    settings.deviceId = '';
  }
  applyWineCompat();
  
  try {
    backupFileBeforeWrite(settingsFile());
    backupFileBeforeWrite(path.join(app.getPath('userData'), 'playlist.json'));
    backupFileBeforeWrite(path.join(app.getPath('userData'), 'play-counts.json'));
  } catch {  }
}

async function saveSettings() {
  try {
    await fsp.mkdir(path.dirname(settingsFile()), { recursive: true });
    backupFileBeforeWrite(settingsFile());      
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





try { app.commandLine?.appendSwitch?.('enable-features', 'MediaSessionService,HardwareMediaKeyHandling'); } catch {  }


if (process.platform === 'linux') { try { app.commandLine?.appendSwitch?.('enable-transparent-visuals'); } catch {  } }






const WINDOW_RADIUS = 12;


function roundedShapeRects(width, height) {
  const r = Math.min(WINDOW_RADIUS, Math.floor(Math.min(width, height) / 2));
  if (r <= 0) return [{ x: 0, y: 0, width, height }];
  const rects = [];
  for (let i = 0; i < r; i++) {
    const dy = r - i - 0.5;
    const dx = Math.round(r - Math.sqrt(Math.max(0, r * r - dy * dy)));
    const w = Math.max(0, width - 2 * dx);
    rects.push({ x: dx, y: i, width: w, height: 1 });
    rects.push({ x: dx, y: height - 1 - i, width: w, height: 1 });
  }
  rects.push({ x: 0, y: r, width, height: Math.max(0, height - 2 * r) });
  return rects;
}


function applyWindowShape(win) {
  if (!win || win.isDestroyed()) return;
  if (process.platform !== 'linux') return;   
  if (typeof win.setShape !== 'function') return;
  try {
    const [w, h] = win.getSize();
    if (win.isMaximized() || win.isFullScreen()) {
      win.setShape([{ x: 0, y: 0, width: w, height: h }]);
    } else {
      win.setShape(roundedShapeRects(w, h));
    }
  } catch {  }
}







let rendererServer = null;
function startRendererServer() {
  return new Promise((resolve) => {
    try {
      const root = path.normalize(path.join(__dirname, '..', 'renderer'));
      const types = {
        '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
        '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
      };
      const server = http.createServer((req, res) => {
        try {
          const u = new URL(req.url, 'http://127.0.0.1');
          let rel = decodeURIComponent(u.pathname);
          if (rel === '/' || rel === '') rel = '/index.html';
          const file = path.normalize(path.join(root, rel));
          if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end('forbidden'); return; }
          const data = fs.readFileSync(file);
          res.writeHead(200, {
            'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream',
            'Cache-Control': 'no-store',
          });
          res.end(data);
        } catch {
          try { res.writeHead(404); res.end('not found'); } catch {  }
        }
      });
      server.listen(0, '127.0.0.1', () => {
        try { rendererServer = server; resolve(server.address().port); } catch { resolve(0); }
      });
      server.on('error', () => resolve(0));
    } catch { resolve(0); }
  });
}











function taskbarIcon(name) {
  
  
  const p = path.join(__dirname, 'assets', 'taskbar', name + '.png');
  try {
    const buf = fs.readFileSync(p);
    const img = nativeImage.createFromBuffer(buf);
    debugLog('icon ' + name + ' path=' + p + ' bytes=' + buf.length + ' empty=' + img.isEmpty());
    if (!img.isEmpty()) return img;
  } catch (err) { debugLog('icon ' + name + ' 读取失败: ' + err.message); }
  try {
    const img = nativeImage.createFromPath(p);     
    return img.isEmpty() ? nativeImage.createEmpty() : img;
  } catch { return nativeImage.createEmpty(); }
}


function taskbarIconBitmap(name) {
  try {
    const p = path.join(__dirname, 'assets', 'taskbar', name + '.png');
    const img = nativeImage.createFromBuffer(fs.readFileSync(p));
    if (img.isEmpty()) return null;
    const size = img.getSize();
    const bitmap = img.toBitmap();
    if (!size || !size.width || !size.height || !bitmap || !bitmap.length) return null;
    return { width: size.width, height: size.height, bitmap };
  } catch (err) {
    debugLog('taskbar bitmap ' + name + ' 读取失败: ' + err.message);
    return null;
  }
}

let taskbarKey = '';
let taskbarState = 'unknown';   


function debugLog(line) {
  try {
    const f = path.join(app.getPath('userData'), 'taskbar-debug.log');
    fs.appendFileSync(f, new Date().toISOString() + '  ' + line + '\n', 'utf8');
  } catch {  }
}


function taskbarCommand(c) {
  try {
    debugLog('thumbar click: ' + c + ' (' + taskbarState + ')');
    send('taskbar:command', c);
  } catch {  }
}


function ensureNativeTaskbar() {
  if (taskbarState === 'native') return true;
  if (taskbarState === 'fallback' || taskbarState === 'off') return false;
  if (process.platform !== 'win32' || !mainWindow || mainWindow.isDestroyed()) {
    taskbarState = 'off';
    return false;
  }
  try {
    const addon = player && player.engine;
    if (!addon || typeof addon.taskbarInstall !== 'function' ||
        typeof addon.taskbarUpdate !== 'function' || typeof addon.taskbarDispose !== 'function') {
      taskbarState = 'fallback';
      debugLog('原生任务栏接口不可用（taskbar* 缺失）→ 回退 Electron');
      return false;
    }
    const icons = {
      prev: taskbarIconBitmap('prev'),
      play: taskbarIconBitmap('play'),
      pause: taskbarIconBitmap('pause'),
      next: taskbarIconBitmap('next'),
    };
    if (!icons.prev || !icons.play || !icons.pause || !icons.next) {
      taskbarState = 'fallback';
      debugLog('任务栏图标读取失败 → 回退 Electron');
      return false;
    }
    addon.taskbarInstall(mainWindow.getNativeWindowHandle(), icons, (command) => taskbarCommand(command));
    taskbarState = 'native';
    debugLog('原生任务栏按钮已安装 ✓');
    return true;
  } catch (err) {
    taskbarState = 'fallback';
    debugLog('原生任务栏安装失败: ' + err.message + ' → 回退 Electron');
    return false;
  }
}

function updateTaskbarButtons() {
  if (process.platform !== 'win32' || !mainWindow || mainWindow.isDestroyed()) return;
  let playing = false;
  try { playing = player.state().status === 'playing'; } catch {  }
  const key = playing ? 'playing' : 'paused';
  if (key === taskbarKey) return;             
  taskbarKey = key;

  
  if (ensureNativeTaskbar()) {
    try {
      player.engine.taskbarUpdate(playing);
    } catch (err) {
      debugLog('原生任务栏 update 失败: ' + err.message);
    }
    return;
  }

  
  try {
    mainWindow.setThumbarButtons([
      { tooltip: '上一首', icon: taskbarIcon('prev'), click: () => taskbarCommand('prev') },
      { tooltip: playing ? '暂停' : '播放', icon: taskbarIcon(playing ? 'pause' : 'play'), click: () => taskbarCommand(playing ? 'pause' : 'play') },
      { tooltip: '下一首', icon: taskbarIcon('next'), click: () => taskbarCommand('next') },
    ]);
    debugLog('回退 Electron 任务栏实现 playing=' + playing);
  } catch {  }
}


function disposeTaskbar() {
  try {
    if (player && player.engine && typeof player.engine.taskbarDispose === 'function') {
      player.engine.taskbarDispose();
    }
  } catch {  }
  taskbarState = 'off';
}

ipcMain.on('taskbar:thumb-clip', (_e, rect) => {
  if (process.platform !== 'win32' || !mainWindow || mainWindow.isDestroyed()) return;
  try {
    const ok = rect && Number.isFinite(rect.width) && Number.isFinite(rect.height) && rect.width > 8 && rect.height > 8;
    
    mainWindow.setThumbnailClip(ok ? {
      x: Math.max(0, Math.round(rect.x)),
      y: Math.max(0, Math.round(rect.y)),
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height)),
    } : { x: 0, y: 0, width: 0, height: 0 });
  } catch {  }
});

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

  
  applyWindowShape(mainWindow);
  let shapeTimer = null;
  const queueShape = () => {
    clearTimeout(shapeTimer);
    shapeTimer = setTimeout(() => applyWindowShape(mainWindow), 60);
  };
  mainWindow.on('resize', queueShape);
  mainWindow.on('maximize', queueShape);
  mainWindow.on('unmaximize', queueShape);
  mainWindow.on('restore', queueShape);
  
  mainWindow.on('closed', () => disposeTaskbar());

  updateTaskbarButtons();

  const indexFile = path.join(__dirname, '..', 'renderer', 'index.html');
  startRendererServer().then((port) => {
    if (port) {
      mainWindow.loadURL('http://127.0.0.1:' + port + '/index.html').catch(() => {
        try { mainWindow.loadFile(indexFile); } catch {  }
      });
      debugLog('renderer 走 http://127.0.0.1:' + port);
    } else {
      mainWindow.loadFile(indexFile);
      debugLog('renderer 退回 file://（http 服务启动失败）');
    }
  });

  
  
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

  





  const silentWavUrl = (() => {
    try {
      const file = path.join(app.getPath("userData"), "silent.wav");
      if (!fs.existsSync(file)) {
        const rate = 8000, n = rate * 2;           
        const buf = Buffer.alloc(44 + n);
        buf.write("RIFF", 0, "latin1"); buf.writeUInt32LE(36 + n, 4);
        buf.write("WAVE", 8, "latin1"); buf.write("fmt ", 12, "latin1");
        buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
        buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate, 28);
        buf.writeUInt16LE(1, 32); buf.writeUInt16LE(8, 34);
        buf.write("data", 36, "latin1"); buf.writeUInt32LE(n, 40);
        buf.fill(128, 44);                         
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, buf);
      }
      return require("node:url").pathToFileURL(file).href;
    } catch { return ""; }
  })();

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
      silentWavUrl,                 
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
    
    if (track) {
      const src = track.path || track.playPath;
      try {
        const rec = src ? getExtensions().findRecord(path.basename(src)) : null;
        if (rec && typeof rec.module.extractCover === "function") {
          const raw = await fsp.readFile(src);
          const cover = rec.module.extractCover(raw, { name: path.basename(src) });
          if (Buffer.isBuffer(cover) && cover.length > 64) {
            const mime = cover[0] === 0xff && cover[1] === 0xd8 ? "image/jpeg"
              : cover.slice(0, 4).toString("hex") === "89504e47" ? "image/png" : "image/jpeg";
            out = { dataUrl: "data:" + mime + ";base64," + cover.toString("base64"), bytes: cover.length, mime };
          }
        }
      } catch (err) { debugLog('扩展 extractCover 失败: ' + err.message); }
    }
    
    
    if (!out.dataUrl && (track ? track.hasCover !== false : true)) {
      try {
        const cover = await extractCover(file, tools, { maxSize: 512 });
        if (cover) out = { dataUrl: cover.dataUrl, bytes: cover.bytes, mime: cover.mime };
      } catch {  }
    }
    
    if (!out.dataUrl && track) {
      try {
        
        const src = track.path || track.playPath;
        if (src && getExtensions().findRecord(path.basename(src))) {
          await resolvePlayablePath(src);
        }
      } catch (err) { debugLog('cover 补 sidecar 失败: ' + err.message); }
    }
    if (!out.dataUrl) {
      try {
        const side = file.replace(/\.[^.]+$/, "") + ".cover.img";
        if (fs.existsSync(side)) {
          const buf = await fsp.readFile(side);
          const mime = buf[0] === 0xff && buf[1] === 0xd8 ? "image/jpeg"
            : buf.slice(0, 4).toString("hex") === "89504e47" ? "image/png" : "image/jpeg";
          out = { dataUrl: "data:" + mime + ";base64," + buf.toString("base64"), bytes: buf.length, mime };
        }
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
  
  try { for (const e of getExtensions().supportedExts()) AUDIO_EXT.add('.' + e); } catch {  }

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
        backupFileBeforeWrite(playCountsFile());
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
    
    
    
    const target = resolvePlayableTarget(await resolvePlayablePath(track.path), track);
    return player.play(
      { ...track, path: target.path, playPath: target.path, meta: target.meta },
      withBackendChain(settings),
      { startSeconds: start || 0 },
    );
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

  
  ipcMain.handle('ext:list', () => getExtensions().list());
  ipcMain.handle('ext:install', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: '安装扩展',
      properties: ['openFile'],
      filters: [{ name: 'iRix 扩展包', extensions: ['xtxs', 'zip'] }],
    });
    if (res.canceled || !res.filePaths?.[0]) return { ok: false, canceled: true };
    const manifest = getExtensions().installFromFile(res.filePaths[0]);
    return { ok: true, manifest, restartRequired: true };
  });
  ipcMain.handle('ext:uninstall', (_e, { id }) => {
    getExtensions().uninstall(id);
    return { ok: true, restartRequired: true };
  });
  ipcMain.handle('ext:toggle', (_e, { id, enabled }) => {
    getExtensions().setEnabled(id, !!enabled);
    return { ok: true, restartRequired: true };
  });
  
  ipcMain.handle('ext:set-setting', async (_e, { id, key, value } = {}) => {
    const r = await getExtensions().setSetting(id, key, value);
    return { ok: true, values: r.values, live: r.live };
  });
  ipcMain.handle('ext:command', async (_e, { id, commandId } = {}) => getExtensions().runCommand(id, commandId));
  
  ipcMain.handle('ext:ui', () => getExtensions().uiState());
  ipcMain.handle('app:restart', () => {
    setTimeout(() => { try { app.relaunch(); } catch {  } app.exit(0); }, 60);
    return { ok: true };
  });

  ipcMain.handle('probe:file', async (_e, { file }) => {
    let target = file;
    try {
      const resolved = await resolvePlayablePath(file);
      target = resolvePlayableTarget(resolved, { path: file, playPath: file }).path || file;
    } catch { target = file; }
    return probeFile(target, tools);
  });

  
  
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
  player.on('state', (s) => { send('player:state', s); updateTaskbarButtons(); });
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
    backupFileBeforeWrite(playCountsFile());
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
    
    
    playlist.setPathResolver((f) => resolvePlayablePath(f, { metaOnly: true }));
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
    
    if (!SELFTEST) {
      setTimeout(() => {
        try { getExtensions().activateStartup(); } catch {  }
      }, 200);
    }

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

  app.on('will-quit', () => {
    disposeTaskbar();
    try { extensions && extensions.shutdown(); } catch {  }
    try { rendererServer && rendererServer.close(); } catch {  }
  });

app.on('window-all-closed', () => {
    if (player) player.dispose();
    app.quit();
  });

  app.on('before-quit', () => {
    if (player) player.dispose();
  });
}
