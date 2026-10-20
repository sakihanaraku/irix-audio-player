
'use strict';

const $ = (id) => document.getElementById(id);
const api = window.aurora;

const APP_TITLE = (typeof document !== 'undefined' && document.title) || 'iRix Audio Player';

const state = {
  info: null,
  settings: null,
  playlist: [],
  currentId: null,
  browser: { dir: '', home: '', parent: null, entries: [], selected: null, split: 0.5 },
  playerState: { status: 'idle', position: 0, duration: 0 },
  draggingSeek: false,
  internalDragId: null,
  themeColor: null,
  bgDataUrl: null,
  wine: null,
  eq: {
    config: { enabled: false, preampDb: 0, bands: [] },
    bands: [], labels: [], presetGains: {}, presetNames: [], gainLimit: 12, lastSaved: '',
  },
};

const VOLUME_STEP = 5;           


const I18N = window.I18N;
let LANG = 'zh';

function tr(key, vars) {
  return I18N.translate(LANG, key, vars);
}


function applyLanguage(lang) {
  LANG = I18N.resolve(lang, navigator.language || '');
  document.documentElement.lang = LANG === 'zh' ? 'zh-CN' : LANG;

  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = tr(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = tr(el.dataset.i18nTitle);
  for (const el of document.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', tr(el.dataset.i18nAria));
  for (const el of document.querySelectorAll('[data-i18n-alt]')) el.alt = tr(el.dataset.i18nAlt);

  const sel = $('selLanguage');
  if (sel && state.settings) sel.value = state.settings.language || 'auto';

  
  if (state.info) {
    applyInfoToUi();
    buildBackendSelect();
    refreshDevices().catch(() => {});
    updateBackendHint();
  }
  updateDeviceStatus();

  
  if (state.settings) {
    applyUiTheme(state.settings.uiTheme || 'dark');
    if (!bgCooldownTimer && $('btnFetchBg')) $('btnFetchBg').textContent = tr('set.bg.refresh');
  }

  const current = state.currentId ? state.playlist.find((x) => x.id === state.currentId) : null;
  if (current && state.playerState.status !== 'idle') renderNowPlaying(current);
  else {
    $('npTitle').textContent = tr('np.idle');
    $('npArtist').textContent = tr('np.hint');
    renderMeta(null);
  }
  
  
  
  renderTitlebarNowPlaying();
  renderPlaylist();
}

const BACKEND_LABELS = {
  auto: 'backend.auto',
  'wasapi-shared': 'backend.wasapi-shared',
  'wasapi-exclusive': 'backend.wasapi-exclusive',
  directsound: 'backend.directsound',
  mme: 'backend.mme',
  alsa: 'backend.alsa',
};

const BACKEND_HINTS = {
  auto: 'backend.hint.auto',
  'wasapi-shared': 'backend.hint.shared',
  'wasapi-exclusive': 'backend.hint.exclusive',
  directsound: 'backend.hint.directsound',
  mme: 'backend.hint.mme',
  alsa: 'backend.hint.alsa',
  default: 'backend.hint.shared',
};


const defaultBackendId = () =>
  (state.info?.backends || []).find((b) => b.implemented)?.id || 'wasapi-shared';

const STATUS_TEXT = {
  idle: 'status.idle',
  playing: 'status.playing',
  paused: 'status.paused',
  stopped: 'status.stopped',
  ended: 'status.ended',
  error: 'status.error',
};

const RATES = [
  ['0', 'set.rate.follow'],
  ['44100', '44100 Hz'],
  ['48000', '48000 Hz'],
  ['88200', '88200 Hz'],
  ['96000', '96000 Hz'],
  ['176400', '176400 Hz'],
  ['192000', '192000 Hz'],
];


function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function fmtSize(bytes) {
  if (!bytes) return '';
  const mb = bytes / 1048576;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
}

function showError(message) {
  const box = $('errBox');
  if (!message) {
    box.hidden = true;
    box.textContent = '';
    return;
  }
  box.hidden = false;
  box.textContent = message;
}

function badge(text, highlight) {
  const span = document.createElement('span');
  span.className = 'tag' + (highlight ? ' hl' : '');
  span.textContent = text;
  return span;
}


const DEFAULT_THEME = '#35d07f';
const THEME_PRESETS = [
  { name: '翠绿', color: '#35d07f' },
  { name: '天蓝', color: '#2ea3ff' },
  { name: '靛紫', color: '#a78bfa' },
  { name: '品红', color: '#f472b6' },
  { name: '橙', color: '#fb923c' },
  { name: '朱红', color: '#ef4444' },
  { name: '青', color: '#22d3ee' },
  { name: '柠檬', color: '#a3e635' },
  { name: '金', color: '#eab308' },
  { name: '石板', color: '#94a3b8' },
];

function normalizeHex(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  let v = m[1];
  if (v.length === 3) v = v.split('').map((c) => c + c).join('');
  return `#${v.toLowerCase()}`;
}

function hexToRgb(hex) {
  const h = normalizeHex(hex);
  if (!h) return null;
  const n = parseInt(h.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

const toHex = ({ r, g, b }) =>
  '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');


const mixColor = (rgb, amount) =>
  toHex({
    r: amount >= 0 ? rgb.r + (255 - rgb.r) * amount : rgb.r * (1 + amount),
    g: amount >= 0 ? rgb.g + (255 - rgb.g) * amount : rgb.g * (1 + amount),
    b: amount >= 0 ? rgb.b + (255 - rgb.b) * amount : rgb.b * (1 + amount),
  });





function applyTheme(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return DEFAULT_THEME;
  const color = toHex(rgb);
  const root = document.documentElement.style;
  root.setProperty('--accent', color);
  root.setProperty('--accent-rgb', `${rgb.r} ${rgb.g} ${rgb.b}`);
  root.setProperty('--accent-2', mixColor(rgb, 0.38));          
  root.setProperty('--accent-dark', mixColor(rgb, -0.16));      
  root.setProperty('--accent-darker', mixColor(rgb, -0.42));    
  state.themeColor = color;
  const picker = $('themeColor');
  if (picker) picker.value = color;
  document.querySelectorAll('.swatch').forEach((s) => {
    s.classList.toggle('active', s.dataset.color === color);
  });
  return color;
}

function buildThemeSwatches() {
  const box = $('themeSwatches');
  if (!box || box.children.length) return;
  for (const p of THEME_PRESETS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.dataset.color = p.color;
    b.title = `${p.name} ${p.color}`;
    b.style.background = p.color;
    b.addEventListener('click', () => setThemeColor(p.color));
    box.appendChild(b);
  }
  const picker = $('themeColor');
  picker.addEventListener('input', () => applyTheme(picker.value));          
  picker.addEventListener('change', () => setThemeColor(picker.value));     
  $('selLanguage').addEventListener('change', async () => {
    const lang = $('selLanguage').value;
    state.settings.language = lang;
    applyLanguage(lang);
    try {
      await api.settings.set({ language: lang });
    } catch {  }
  });

  $('btnThemeReset').addEventListener('click', () => setThemeColor(DEFAULT_THEME));

  
  const offsetInput = $('peakOffset');
  const applyOffset = (v) => {
    const ms = Math.max(-400, Math.min(400, Number(v) || 0));
    peakMeter.offsetMs = ms;
    state.settings.peakOffsetMs = ms;
    $('peakOffsetVal').textContent = `${ms > 0 ? '+' : ''}${ms} ms`;
  };
  applyOffset(state.settings.peakOffsetMs || 0);
  offsetInput.value = String(peakMeter.offsetMs);
  offsetInput.addEventListener('input', () => applyOffset(offsetInput.value));
  offsetInput.addEventListener('change', () => {
    applyOffset(offsetInput.value);
    api.settings.set({ peakOffsetMs: peakMeter.offsetMs }).catch(() => {});
  });
  $('btnPeakOffsetReset').addEventListener('click', () => {
    offsetInput.value = '0';
    applyOffset(0);
    api.settings.set({ peakOffsetMs: 0 }).catch(() => {});
  });
  applyTheme(state.themeColor || DEFAULT_THEME);
}

async function setThemeColor(hex) {
  const color = applyTheme(hex);
  state.settings.themeColor = color;
  try {
    await api.settings.set({ themeColor: color });
  } catch {  }
}









const BTN_SELECTOR = '.btn, .tb-btn';
const popTimers = new WeakMap();

function popButton(btn) {
  btn.classList.remove('is-down');
  btn.classList.remove('pop');
  void btn.offsetWidth;                 
  btn.classList.add('pop');
  clearTimeout(popTimers.get(btn));
  popTimers.set(btn, setTimeout(() => btn.classList.remove('pop'), 320));
}

function clearPressedButtons() {
  document.querySelectorAll(`${BTN_SELECTOR}.is-down`).forEach((b) => b.classList.remove('is-down'));
}

function bindPressFeedback() {
  document.addEventListener('pointerdown', (e) => {
    const btn = e.target?.closest?.(BTN_SELECTOR);
    if (btn && !btn.disabled) btn.classList.add('is-down');
  }, true);
  document.addEventListener('pointerup', clearPressedButtons, true);
  document.addEventListener('pointercancel', clearPressedButtons, true);
  window.addEventListener('blur', clearPressedButtons);
  document.addEventListener('click', (e) => {
    const btn = e.target?.closest?.(BTN_SELECTOR);
    if (btn && !btn.disabled) popButton(btn);
  }, true);
}



function applyWineInfo(info) {
  state.wine = info || { detected: false, active: false };
  const w = state.wine;
  document.body.classList.toggle('no-glass', !!w.noGlass);

  const item = $('statusWine');
  if (item) {
    item.hidden = !(w.detected || w.mode === 'on');
    item.className = `sb-item ${w.active ? 'ok' : 'missing'}`;
    $('wineText').textContent = tr('sb.wine', { label: w.label || 'Wine' });
  }
  const status = $('wineStatus');
  if (status) {
    const head = w.detected ? tr('set.wine.detected', { label: w.label || 'Wine' }) : tr('set.wine.notDetected');
    if (w.active) {
      const list = (w.applied || []).map((k) => tr(SETTING_LABELS[k] || k)).join('、');
      status.textContent = `${head} · ${tr('set.wine.active', { list: list || '—' })}`;
      status.classList.add('active');
    } else {
      status.textContent = `${head} · ${tr('set.wine.inactive')}`;
      status.classList.remove('active');
    }
  }
  const sel = $('selWineCompat');
  if (sel) sel.value = w.mode || 'auto';
}


const SETTING_LABELS = {
  backend: 'set.mode',
  bufferMs: 'set.buffer',
  periodMs: 'set.period',
  ringMs: 'set.ring',
  wineCompat: 'set.wine.mode',
};


const BG_COOLDOWN_DEFAULT_MS = 30000;
let bgCooldownTimer = null;


function applyUiTheme(theme) {
  const light = theme === 'light';
  document.body.classList.toggle('light', light);
  if (state.settings) state.settings.uiTheme = light ? 'light' : 'dark';
  const btn = $('btnThemeMode');
  if (btn) {
    btn.setAttribute('aria-pressed', String(light));
    const label = tr('tip.themeMode');
    btn.title = tr('theme.current', { theme: tr(light ? 'theme.light' : 'theme.dark') });
  }
}










const THEME_FALLBACK_MS = 150;

function switchUiTheme(next) {
  const apply = () => applyUiTheme(next);
  let applied = false;
  const applyOnce = () => {
    if (applied) return;
    applied = true;
    apply();
  };

  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  
  const manualFade = () => {
    if (reduced) return applyOnce();
    const root = document.documentElement;
    root.classList.add('theme-fading', 'theme-fade-out');
    setTimeout(() => {
      applyOnce();
      root.classList.remove('theme-fade-out');
      setTimeout(() => root.classList.remove('theme-fading'), 220);
    }, 120);
  };

  if (typeof document.startViewTransition === 'function' && !reduced) {
    try {
      const t0 = performance.now();
      const t = document.startViewTransition(applyOnce);
      if (t && t.finished && typeof t.finished.then === 'function') {
        t.finished.then(() => {
          
          
          if (performance.now() - t0 < 120) manualFade();
        }).catch(() => {});
      } else if (t && t.finished && typeof t.finished.catch === 'function') {
        t.finished.catch(() => {});
      }
      setTimeout(applyOnce, THEME_FALLBACK_MS);     
      return;
    } catch {  }
  }
  manualFade();
}

function toggleUiTheme() {
  
  const current = state.settings?.uiTheme || (document.body.classList.contains('light') ? 'light' : 'dark');
  const next = current === 'light' ? 'dark' : 'light';
  if (state.settings) state.settings.uiTheme = next;
  switchUiTheme(next);
  api.settings.set({ uiTheme: next }).catch(() => {});
}



function applyBackground(dataUrl) {
  const layer = $('bgLayer');
  const img = $('bgImage');
  if (dataUrl) {
    img.src = dataUrl;
    layer.classList.add('active');
    state.bgDataUrl = dataUrl;
  } else {
    img.removeAttribute('src');
    layer.classList.remove('active');
    state.bgDataUrl = null;
  }
}






function bgOpacityPercent(s = state.settings || {}) {
  const opacity = Math.max(0, Math.min(1, Number(s.bgOpacity ?? 0.7)));
  return Math.round(opacity * 100);
}

function applyBgVisual() {
  const s = state.settings || {};
  const opacity = Math.max(0, Math.min(1, Number(s.bgOpacity ?? 0.7)));
  const blur = Math.max(0, Math.min(40, Number(s.bgBlur ?? 18)));
  document.documentElement.style.setProperty('--bg-opacity', String(opacity));
  document.documentElement.style.setProperty('--bg-blur', `${blur}px`);
  if ($('bgOpacity')) $('bgOpacityVal').textContent = `${bgOpacityPercent(s)}%`;
  if ($('bgBlur')) $('bgBlurVal').textContent = `${Math.round(blur)} px`;
}

async function refreshBackgroundFromSettings() {
  try {
    const res = await api.bg.get();
    applyBackground(res?.dataUrl || null);
    const wait = Number(res?.cooldownMs) || 0;
    if (wait > 0) startBgCooldown(wait);
  } catch {
    applyBackground(null);
  }
}


function startBgCooldown(ms) {
  const btn = $('btnFetchBg');
  if (!btn) return;
  const until = Date.now() + Math.max(0, ms);
  if (bgCooldownTimer) clearInterval(bgCooldownTimer);
  const tick = () => {
    const left = until - Date.now();
    if (left <= 0) {
      btn.disabled = false;
      btn.textContent = tr('set.bg.refresh');
      clearInterval(bgCooldownTimer);
      bgCooldownTimer = null;
      return;
    }
    btn.disabled = true;
    btn.textContent = tr('set.bg.cooldown', { s: Math.ceil(left / 1000) });
  };
  tick();
  bgCooldownTimer = setInterval(tick, 250);
}

function bindBackgroundEvents() {
  const sel = $('selBgSource');
  sel.value = state.settings.bgSource || 'none';
  $('inpBgApi').value = state.settings.bgApiUrl || '';
  
  $('bgOpacity').value = String(bgOpacityPercent(state.settings));
  $('bgBlur').value = String(state.settings.bgBlur ?? 18);
  applyBgVisual();

  $('btnThemeMode').addEventListener('click', toggleUiTheme);

  
  $('selWineCompat').addEventListener('change', async () => {
    const mode = $('selWineCompat').value;
    try {
      const res = await api.settings.set({ wineCompat: mode });
      if (res && res.settings) state.settings = res.settings;
      if (res && 'wine' in res) applyWineInfo(res.wine);      
      if (res && res.settings) applySettingsToControls();
    } catch (e) {
      $('wineHint').textContent = String(e.message || e);
    }
  });

  sel.addEventListener('change', async () => {
    const source = sel.value;
    state.settings.bgSource = source;
    await api.settings.set({ bgSource: source });
    await refreshBackgroundFromSettings();
    if (source === 'local' && !state.settings.bgLocalPath) $('btnPickBg').click();
    else if (source === 'network' && !state.bgDataUrl) $('btnFetchBg').click();
  });

  $('btnPickBg').addEventListener('click', async () => {
    const res = await api.bg.pick();
    if (!res || res.canceled) return;
    if (res.error) {
      $('bgHint').textContent = res.error;
      return;
    }
    state.settings.bgSource = 'local';
    state.settings.bgLocalPath = res.path;
    sel.value = 'local';
    applyBackground(res.dataUrl);
    $('bgHint').textContent = tr('set.bg.ok');
  });

  $('btnFetchBg').addEventListener('click', async () => {
    if ($('btnFetchBg').disabled) return;
    $('bgHint').textContent = tr('set.bg.loading');
    const res = await api.bg.fetch();
    if (res?.ok) {
      state.settings.bgSource = 'network';
      sel.value = 'network';
      applyBackground(res.dataUrl);
      $('bgHint').textContent = tr('set.bg.ok');
      startBgCooldown(res.cooldownMs || BG_COOLDOWN_DEFAULT_MS);
    } else {
      $('bgHint').textContent = res?.error || tr('err.bgFetch');
      if (res?.cooldownMs) startBgCooldown(res.cooldownMs);
    }
  });

  $('btnClearBg').addEventListener('click', async () => {
    state.settings.bgSource = 'none';
    sel.value = 'none';
    applyBackground(null);
    await api.settings.set({ bgSource: 'none' });
    $('bgHint').textContent = tr('set.bg.hint');
  });

  $('inpBgApi').addEventListener('change', () => {
    const url = $('inpBgApi').value.trim();
    state.settings.bgApiUrl = url;
    api.settings.set({ bgApiUrl: url }).catch(() => {});
  });

  $('bgOpacity').addEventListener('input', () => {
    
    state.settings.bgOpacity = Number($('bgOpacity').value) / 100;
    applyBgVisual();
  });
  $('bgOpacity').addEventListener('change', () => {
    api.settings.set({ bgOpacity: state.settings.bgOpacity }).catch(() => {});
  });
  $('bgBlur').addEventListener('input', () => {
    state.settings.bgBlur = Number($('bgBlur').value);
    applyBgVisual();
  });
  $('bgBlur').addEventListener('change', () => {
    api.settings.set({ bgBlur: state.settings.bgBlur }).catch(() => {});
  });
}


function bindPlaylistFileEvents() {
  $('btnSaveList').addEventListener('click', async () => {
    if (!state.playlist.length) {
      showError(tr('err.listEmpty'));
      return;
    }
    const res = await api.playlist.save();          
    if (res?.canceled) return;
    if (res?.error) {
      showError(res.error);
      return;
    }
    showTransientStatus(tr('msg.savedList', { n: res.count, path: res.filePath }));
  });

  $('btnOpenList').addEventListener('click', async () => {
    const res = await api.playlist.load();
    if (res?.canceled) return;
    if (res?.error) {
      showError(res.error);
      return;
    }
    showTransientStatus(tr('msg.loadedList', { added: res.added, skipped: res.skipped, failed: res.failed }));
  });
}

let statusTimer = null;
let statusFadeTimer = null;
const SCAN_HINT_HOLD_MS = 1000;      
const SCAN_HINT_FADE_MS = 260;       


function setScanHint(text) {
  const el = $('scanHint');
  if (!el) return;
  clearTimeout(statusTimer);
  clearTimeout(statusFadeTimer);
  el.classList.remove('is-out');
  el.textContent = text || '';
  el.title = text || '';
  if (!text) return;
  statusTimer = setTimeout(() => {
    el.classList.add('is-out');                     
    statusFadeTimer = setTimeout(() => {
      el.textContent = '';
      el.title = '';
      el.classList.remove('is-out');                
    }, SCAN_HINT_FADE_MS);
  }, SCAN_HINT_HOLD_MS);
}


function showTransientStatus(text) {
  setScanHint(text);
}


function shortFfmpegVersion(version) {
  if (!version) return '';
  const m = String(version).match(/ffmpeg version ([^\s]+)/i);
  const raw = m ? m[1] : String(version).trim();
  return raw.replace(/-g[0-9a-f]{6,}$/i, '').slice(0, 24);
}







function setStatusItem(el, ok, text) {
  const node = $(el);
  if (!node) return;                       
  node.className = `sb-item ${ok === null ? 'missing' : ok ? 'ok' : 'warn'}`;
  
  const dot = node.querySelector('.dot') || document.createElement('i');
  dot.className = 'dot';
  node.textContent = '';
  node.appendChild(dot);
  node.appendChild(document.createTextNode(text));
}





const PEAK_DB_FLOOR = -90;                    
const PEAK_FRAME_MS = 1000 / 60;              
const PEAK_RELEASE_DB_PER_SEC = 90;           
const PEAK_HOLD_MS = 300;                     
const PEAK_HOLD_RELEASE_DB_PER_SEC = 40;      
const PEAK_ACTIVE_DB = -60;                   
const PEAK_QUEUE_MS = 2500;                   

const PEAK_TICKS = [-40, -20, -10, -6, -3, 0];
const PEAK_ROWS = ['FL', 'FR', 'FC', 'LFE', 'SL', 'SR', 'BL', 'BR'];
const peakMeter = {
  canvas: null, gl: null, ctx2d: null, prog: null, buf: null,
  uRes: null, uColor: null, aPos: 0,
  levelDb: [], holdDb: [], holdTime: [],
  
  queue: [], appliedSample: null, clock: { writtenMs: 0, playMs: 0, anchorAt: 0, playing: false, valid: false },
  latencyMs: 0, effectiveMs: 0, offsetMs: 0, shownPosMs: null,
  timer: 0, idleMs: 0, lastFrame: 0, draws: 0,
};

const clampDb = (db) => Math.max(PEAK_DB_FLOOR, Math.min(0, db));
const linearToDb = (v) => (v > 0 ? clampDb(20 * Math.log10(v)) : PEAK_DB_FLOOR);


const dbToRatio = (db) => {
  if (!Number.isFinite(db) || db <= PEAK_DB_FLOOR) return 0;
  return Math.min(1, Math.pow(10, clampDb(db) / 20));
};

const themeAccentRgb = () => {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb').trim();
  const p = raw.split(/[\s,]+/).map(Number);
  if (p.length >= 3 && p.every((n) => Number.isFinite(n))) {
    return [p[0] / 255, p[1] / 255, p[2] / 255];
  }
  return [0.21, 0.82, 0.5];
};







function switchPeakMeterTo2D(reason) {
  const m = peakMeter;
  if (!m.canvas || !m.canvas.parentElement) return;
  if (m.ctx2d) return;                       
  try {
    const fresh = m.canvas.cloneNode(false); 
    const ctx = fresh.getContext("2d", { alpha: true });
    if (!ctx) return;
    m.canvas.replaceWith(fresh);
    m.canvas = fresh;
    m.gl = null; m.prog = null; m.buf = null;
    m.ctx2d = ctx;
    
    const dpr = window.devicePixelRatio || 1;
    const r = fresh.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      fresh.width = Math.max(1, Math.round(r.width * dpr));
      fresh.height = Math.max(1, Math.round(r.height * dpr));
    }
    try { drawPeakMeter(); } catch {  }
    if (window.__perfInfo) window.__perfInfo.peakRenderer = "2d";
    console.warn("[peak] WebGL 不可用（" + (reason || "context lost") + "）→ 已切换到 2D 画布 ✓");
  } catch {  }
}






function setupPeakGL(gl) {
  if (!gl || gl.isContextLost && gl.isContextLost()) return false;
  try {
    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, [
      "attribute vec2 a_pos;",
      "uniform vec2 u_res;",
      "void main() {",
      "  vec2 p = a_pos / u_res * 2.0 - 1.0;",
      "  gl_Position = vec4(p.x, -p.y, 0.0, 1.0);",
      "}"
    ].join("\n"));
    gl.compileShader(vs);
    const fsr = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fsr, [
      "precision mediump float;",
      "uniform vec4 u_color;",
      "void main() { gl_FragColor = u_color; }"
    ].join("\n"));
    gl.compileShader(fsr);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fsr);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn("[peak] WebGL 程序链接失败:", gl.getProgramInfoLog(prog));
      return false;
    }
    peakMeter.gl = gl;
    peakMeter.glLost = false;
    peakMeter.prog = prog;
    peakMeter.buf = gl.createBuffer();
    peakMeter.uRes = gl.getUniformLocation(prog, "u_res");
    peakMeter.uColor = gl.getUniformLocation(prog, "u_color");
    peakMeter.aPos = gl.getAttribLocation(prog, "a_pos");
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    return true;
  } catch (err) {
    console.warn("[peak] setupPeakGL 失败:", err && err.message);
    return false;
  }
}

const PEAK_RESTORE_WAIT_MS = 2500;   
function initPeakMeter() {
  const canvas = $('peakCanvas');
  if (!canvas) return;
  peakMeter.canvas = canvas;

  const buildScale = () => {
    const box = $('peakScale');
    box.innerHTML = '';
    for (const db of PEAK_TICKS) {
      const i = document.createElement('i');
      i.textContent = `${db}`;
      i.style.left = `${dbToRatio(db) * 100}%`;
      box.appendChild(i);
    }
    const unit = document.createElement('i');
    unit.textContent = 'dB';
    unit.style.left = '100%';
    unit.style.transform = 'translateX(-100%)';
    box.appendChild(unit);
  };
  buildScale();

  
  const labels = document.createElement('div');
  labels.className = 'peak-labels';
  for (const name of PEAK_ROWS.slice(0, 2)) {
    const s = document.createElement('span');
    s.textContent = name;
    labels.appendChild(s);
  }
  canvas.parentElement.appendChild(labels);

  let gl = null;
  try {
    
    gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: false, preserveDrawingBuffer: true })
      || canvas.getContext('experimental-webgl');
  } catch { gl = null; }

  if (gl) setupPeakGL(gl);
  if (!peakMeter.gl) {
    peakMeter.ctx2d = canvas.getContext('2d');
    if (!peakMeter.ctx2d) {
      $('peakFallback').hidden = false;
      return;
    }
    console.warn('[peak] 使用 2D canvas 兜底绘制峰值计');
  }

  
  
  detectSoftwareRender();
  
  let restoreTimer = null;
  let lostCount = 0;
  canvas.addEventListener("webglcontextlost", (e) => {
    
    e.preventDefault();
    peakMeter.glLost = true;
    lostCount++;
    
    softwareRenderChecked = false;
    detectSoftwareRender();
    console.warn("[peak] WebGL 上下文丢失（第 " + lostCount + " 次）→ 等待恢复 ✓");
    clearTimeout(restoreTimer);
    restoreTimer = setTimeout(() => {
      if (!peakMeter.glLost) return;                       
      console.warn("[peak] " + (PEAK_RESTORE_WAIT_MS / 1000) + "s 内未恢复 → 才退回 2D ✓");
      switchPeakMeterTo2D("restore timeout");
    }, PEAK_RESTORE_WAIT_MS);
  }, false);
  canvas.addEventListener("webglcontextrestored", () => {
    clearTimeout(restoreTimer);
    console.warn("[peak] WebGL 上下文已恢复 → 重建 WebGL 资源 ✓");
    const ok = setupPeakGL(peakMeter.gl);
    if (!ok) {
      console.warn("[peak] 恢复后重建失败 → 退 2D ✓");
      switchPeakMeterTo2D("restore setup failed");
    } else {
      try { drawPeakMeter(); } catch {  }
    }
  }, false);
  canvas.addEventListener("webglcontextcreationerror", (e) => {
    console.warn("[peak] WebGL 上下文创建失败:", e && e.statusMessage);
  }, false);
}


let softwareRenderChecked = false;
let isSoftwareRender = false;






function detectSoftwareRender() {
  if (softwareRenderChecked) return isSoftwareRender;
  softwareRenderChecked = true;
  let software = false;
  let renderer = '';
  try {
    if (!peakMeter.gl) {
      software = true;
    } else {
      const ext = peakMeter.gl.getExtension('WEBGL_debug_renderer_info');
      renderer = ext ? String(peakMeter.gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '') : '';
      software = /swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer);
    }
  } catch { software = false; }
  isSoftwareRender = software;
  document.body.classList.toggle('software-render', software);
  window.__perfInfo = { softwareRender: software, glRenderer: renderer };
  if (software) console.info('[perf] 软件渲染 → 自动关闭玻璃模糊（backdrop-filter）', renderer ? '· ' + renderer : '');
  return software;
}


function startPeakClock() {
  const m = peakMeter;
  if (m.timer) return;
  m.lastFrame = 0;
  m.idleMs = 0;
  m.timer = setInterval(peakTick, PEAK_FRAME_MS);
}

function stopPeakClock() {
  const m = peakMeter;
  if (m.timer) clearInterval(m.timer);
  m.timer = 0;
  m.lastFrame = 0;
}


function resetPeakHistory() {
  const m = peakMeter;
  m.queue.length = 0;
  m.appliedSample = null;
  m.effectiveMs = 0;
  m.clock.valid = false;
  m.clock.playMs = 0;
  m.clock.writtenMs = 0;
}









function pickDisplaySample(now) {
  const m = peakMeter;
  if (!m.queue.length) return null;
  const c = m.clock;
  if (!c.valid) return m.queue[m.queue.length - 1];    

  const extrapolated = c.playMs + (c.playing ? (now - c.anchorAt) : 0);
  
  const playMs = Math.min(c.writtenMs, extrapolated) - (m.offsetMs || 0);
  
  
  let sample = null;
  for (const s of m.queue) {
    if (s.posMs <= playMs && (!sample || s.posMs >= sample.posMs)) sample = s;
  }
  if (sample) {
    m.effectiveMs = playMs - sample.posMs;
    return sample;
  }
  m.effectiveMs = playMs - m.queue[0].posMs;           
  return m.queue[0];
}








function peakTick(nowArg, { force = false } = {}) {
  const m = peakMeter;
  if (!m.canvas) {
    stopPeakClock();
    return;
  }
  const now = nowArg === undefined ? performance.now() : nowArg;
  if (!m.lastFrame) m.lastFrame = now;
  const elapsed = now - m.lastFrame;
  
  if (!force && elapsed < PEAK_FRAME_MS * 0.9) return;
  const dt = Math.min(0.5, Math.max(0, elapsed) / 1000);
  m.lastFrame = now;
  m.draws++;

  
  const sample = pickDisplaySample(now);
  if (sample && sample !== m.appliedSample) {
    m.appliedSample = sample;
    m.shownPosMs = sample.posMs;           
    for (let i = 0; i < 2; i++) {
      const db = linearToDb(Math.max(0, Math.min(1, sample.peaks[i] || 0)));
      if (!Number.isFinite(m.levelDb[i]) || db > m.levelDb[i]) m.levelDb[i] = db;   
      if (!Number.isFinite(m.holdDb[i]) || db >= m.holdDb[i]) {                     
        m.holdDb[i] = db;
        m.holdTime[i] = now;
      }
    }
  }

  for (let i = 0; i < m.levelDb.length; i++) {
    if (m.levelDb[i] > PEAK_DB_FLOOR) {
      m.levelDb[i] = Math.max(PEAK_DB_FLOOR, m.levelDb[i] - PEAK_RELEASE_DB_PER_SEC * dt);
    }
    if (m.holdDb[i] > PEAK_DB_FLOOR && now - m.holdTime[i] > PEAK_HOLD_MS) {
      m.holdDb[i] = Math.max(PEAK_DB_FLOOR, m.holdDb[i] - PEAK_HOLD_RELEASE_DB_PER_SEC * dt);
    }
  }

  drawPeakMeter();

  const active = m.levelDb.some((v) => v > PEAK_ACTIVE_DB) || state.playerState.status === 'playing';
  m.idleMs = active ? 0 : m.idleMs + elapsed;
  if (m.idleMs > 1200) stopPeakClock();            
}

function peakRects() {
  const m = peakMeter;
  const c = m.canvas;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.max(160, Math.round(c.clientWidth * dpr));
  const H = Math.max(60, Math.round(c.clientHeight * dpr));
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }

  const padL = Math.round(46 * dpr);
  const padR = Math.round(14 * dpr);
  const padT = Math.round(10 * dpr);
  const padB = Math.round(18 * dpr);
  const plotW = Math.max(10, W - padL - padR);
  const rows = 2;
  const gap = Math.round(8 * dpr);
  const rowH = Math.max(8, Math.round((H - padT - padB - gap) / rows));

  const accent = themeAccentRgb();
  const rects = [];
  
  for (let r = 0; r < rows; r++) {
    const y = padT + r * (rowH + gap);
    rects.push({ x: padL, y, w: plotW, h: rowH, color: [1, 1, 1, 0.05] });
    
    for (const db of PEAK_TICKS) {
      if (db === 0) continue;
      const x = padL + dbToRatio(db) * plotW;
      rects.push({ x: Math.round(x), y, w: 1, h: rowH, color: [1, 1, 1, 0.07] });
    }
    const fillW = Math.round(plotW * dbToRatio(m.levelDb[r]));
    if (fillW > 0) {
      rects.push({ x: padL, y, w: fillW, h: rowH, color: [accent[0], accent[1], accent[2], 0.92] });
    }
    const holdX = padL + Math.round(plotW * dbToRatio(m.holdDb[r]));
    if (m.holdDb[r] > PEAK_DB_FLOOR) {
      rects.push({ x: holdX, y, w: Math.max(2, Math.round(2 * dpr)), h: rowH, color: [1, 1, 1, 0.75] });
    }
  }
  
  rects.push({ x: padL + plotW - 1, y: padT, w: 1, h: rowH * rows + gap, color: [1, 1, 1, 0.22] });
  return { rects, W, H };
}

function drawPeakMeter() {
  const m = peakMeter;
  if (!m.canvas || (!m.gl && !m.ctx2d)) return;
  if (m.gl && m.glLost) return;              
  const { rects, W, H } = peakRects();

  if (m.gl) {
    const gl = m.gl;
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(m.prog);
    gl.uniform2f(m.uRes, W, H);
    gl.bindBuffer(gl.ARRAY_BUFFER, m.buf);
    gl.enableVertexAttribArray(m.aPos);
    gl.vertexAttribPointer(m.aPos, 2, gl.FLOAT, false, 0, 0);
    for (const r of rects) {
      const x2 = r.x + r.w;
      const y2 = r.y + r.h;
      const verts = new Float32Array([r.x, r.y, x2, r.y, r.x, y2, r.x, y2, x2, r.y, x2, y2]);
      gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
      gl.uniform4f(m.uColor, r.color[0], r.color[1], r.color[2], r.color[3]);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    return;
  }

  const ctx = m.ctx2d;
  ctx.clearRect(0, 0, W, H);
  for (const r of rects) {
    const [rr, gg, bb, aa] = r.color;
    ctx.fillStyle = `rgba(${Math.round(rr * 255)},${Math.round(gg * 255)},${Math.round(bb * 255)},${aa})`;
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }
}


function updatePeakLevels(peaks, clockInfo = {}) {
  const m = peakMeter;
  if (!m.canvas || !Array.isArray(peaks) || !peaks.length) return;
  const now = performance.now();
  m.latencyMs = Math.max(0, Math.min(2000, Number(clockInfo.latencyMs) || 0));

  const rate = Number(clockInfo.sampleRate) || 48000;
  const hasClock = Number.isFinite(clockInfo.writtenFrames) && Number.isFinite(clockInfo.playedFrames);
  const c = m.clock;
  if (hasClock) {
    const writtenMs = (clockInfo.writtenFrames / rate) * 1000;
    
    
    
    if (c.valid && writtenMs + 200 < c.writtenMs) resetPeakHistory();
    const prevWritten = c.writtenMs;          
    c.writtenMs = writtenMs;
    c.playMs = (clockInfo.playedFrames / rate) * 1000;
    c.anchorAt = now;
    c.playing = state.playerState.status === 'playing';
    c.valid = true;
    m.queue.push({ posMs: prevWritten, peaks: [peaks[0] || 0, peaks[1] || 0] });
  } else {
    c.valid = false;
    m.queue.length = 0;
    m.queue.push({ posMs: now, peaks: [peaks[0] || 0, peaks[1] || 0] });
  }

  
  const head = m.queue[m.queue.length - 1].posMs;
  while (m.queue.length > 2 && head - m.queue[0].posMs > PEAK_QUEUE_MS) m.queue.shift();

  
  peakTick(now, { force: true });
  startPeakClock();
}


window.__peakStats = () => ({
  draws: peakMeter.draws,
  levelDb: peakMeter.levelDb.slice(),
  holdDb: peakMeter.holdDb.slice(),
  running: !!peakMeter.timer,
  frameMs: PEAK_FRAME_MS,
  floorDb: PEAK_DB_FLOOR,
  latencyMs: peakMeter.latencyMs,
  effectiveMs: peakMeter.effectiveMs,
  offsetMs: peakMeter.offsetMs,
  shownPosMs: peakMeter.shownPosMs,
  queued: peakMeter.queue.length,
  clockValid: peakMeter.clock.valid,
  playMs: peakMeter.clock.playMs,
  writtenMs: peakMeter.clock.writtenMs,
  releaseDbPerSec: PEAK_RELEASE_DB_PER_SEC,
  holdMs: PEAK_HOLD_MS,
});



async function boot() {
  state.info = await api.info();
  
  
  document.documentElement.classList.add('rounded-shell');
  document.body.classList.add('rounded-shell');
  state.settings = state.info.settings;
  applyTheme(state.settings.themeColor || DEFAULT_THEME);
  applyLanguage(state.settings.language || 'auto');
  applyUiTheme(state.settings.uiTheme || 'dark');
  buildThemeSwatches();
  applyInfoToUi();
  buildBackendSelect();
  buildRateSelect();
  await refreshDevices();
  bindTitlebar();
  bindSettingsModal();
  bindSettingsEvents();
  bindTransport();
  bindMediaSession();                
  bindTaskbarCommands();             
  bindExtensions();                  
  bindSplitter();
  bindPlaylistDropTarget();
  bindBrowser().catch(() => {});
  bindPlayerEvents();
  bindKeyboard();
  bindPlaylistFileEvents();
  bindBackgroundEvents();
  bindPressFeedback();
  bindRangeFills();
  upgradeAllSelects();          
  bindVolume();
  bindEq().catch(() => {});
  bindRank();
  bindPlaylistContextMenu();
  bindConvert().catch(() => {});
  bindProps();
  bindSidePanel();
  bindLyricsPick();
  bindLyricsOffset();
  bindLyricsExclusive();
  bindLyricsEdit();
  bindTooltips();
  initPeakMeter();

  ensureDefaultCover();
  renderMeta(null);
  state.playlist = await api.playlist.get();
  renderPlaylist();
  await refreshBackgroundFromSettings();
  applyUiTheme(state.settings.uiTheme || 'dark');

  if (!state.info.ffmpeg.ok) {
    showError(tr('err.ffmpegMissing'));
  }
}









const ABOUT_LICENSES = [
  { name: 'iRix Audio Player', lic: 'MIT', url: 'https://opensource.org/license/mit' },
  { name: 'Electron', lic: 'MIT', url: 'https://github.com/electron/electron/blob/main/LICENSE' },
  { name: 'Chromium', lic: 'BSD-3-Clause', url: 'https://chromium.googlesource.com/chromium/src/+/main/LICENSE' },
  { name: 'Node.js', lic: 'MIT', url: 'https://github.com/nodejs/node/blob/main/LICENSE' },
  { name: 'FFmpeg', lic: 'LGPL-2.1+ / GPL-2+', url: 'https://ffmpeg.org/legal.html' },
  
  { name: 'Material Symbols (music_note)', lic: 'Apache-2.0', url: 'https://www.apache.org/licenses/LICENSE-2.0' },
];


function renderAbout() {
  const info = state.info || {};

  const ver = $('aboutVersion');
  if (ver) ver.textContent = info.appVersion || '1.0.1-release';

  const tags = $('aboutTags');
  if (tags && !tags.dataset.filled) {
    const rows = [
      ['Electron', info.electron],
      ['Chromium', info.chrome],
      ['Node.js', info.node],
      ['N-API', info.addon ? `napi ${info.addon.napiVersion}` : ''],
      ['FFmpeg', info.ffmpeg ? shortFfmpegVersion(info.ffmpeg.version) : ''],
    ];
    tags.textContent = '';
    for (const [name, val] of rows) {
      if (!val) continue;
      const span = document.createElement('span');
      span.className = 'about-tag';
      span.appendChild(document.createTextNode(name));
      const b = document.createElement('b');
      b.textContent = String(val);
      span.appendChild(b);
      tags.appendChild(span);
    }
    tags.dataset.filled = '1';
  }

  const lic = $('aboutLicenses');
  if (lic && !lic.dataset.filled) {
    lic.textContent = '';
    for (const entry of ABOUT_LICENSES) {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'lic-name';
      name.textContent = entry.name;
      const a = document.createElement('a');
      a.href = entry.url;              
      a.target = '_blank';
      a.rel = 'noreferrer';
      a.textContent = entry.lic;
      li.append(name, a);
      lic.appendChild(li);
    }
    lic.dataset.filled = '1';
  }
}



async function renderExtensions() {
  const box = $('extList');
  if (!box) return;
  if (!api.ext) { box.textContent = ""; return; }
  let list = [];
  try { list = await api.ext.list(); } catch { list = []; }
  box.textContent = "";
  if (!Array.isArray(list) || !list.length) {
    const empty = document.createElement("div");
    empty.className = "ext-empty";
    empty.textContent = tr('ext.empty');
    box.appendChild(empty);
    return;
  }
  for (const item of list) {
    const row = document.createElement("div");
    row.className = "ext-item";
    const mainEl = document.createElement("div");
    mainEl.className = "ext-main";
    const nameEl = document.createElement("div");
    nameEl.className = "ext-name";
    nameEl.textContent = item.name + (item.version ? "  v" + item.version : "");
    const descEl = document.createElement("div");
    descEl.className = "ext-desc";
    descEl.textContent = item.description || "";
    mainEl.append(nameEl, descEl);
    const sw = document.createElement("label");
    sw.className = "ext-switch";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!item.enabled;
    cb.addEventListener("change", async () => {
      try { await api.ext.toggle(item.id, cb.checked); markRestartNeeded(); }
      catch { cb.checked = !cb.checked; }
    });
    sw.appendChild(cb);
    const del = document.createElement("button");
    del.className = "btn mini";
    del.textContent = tr('ext.remove');
    del.addEventListener("click", async () => {
      try {
        await api.ext.uninstall(item.id);
        await renderExtensions();
        markRestartNeeded();
      } catch {  }
    });
    row.append(mainEl, sw, del);
    box.appendChild(row);
  }
}


function markRestartNeeded() {
  const st = $('extStatus');
  if (!st) return;
  st.hidden = false;
  st.textContent = tr('ext.restartRequired');
}

function bindExtensions() {
  const install = $('btnExtInstall');
  if (install) {
    install.addEventListener("click", async () => {
      try {
        const r = await api.ext.install();
        if (r && r.ok) {
          await renderExtensions();
          markRestartNeeded();
        }
      } catch (err) {
        showError(tr('ext.installFailed', { msg: String(err?.message || err) }));
      }
    });
  }
  const restart = $('btnExtRestart');
  if (restart) restart.addEventListener('click', () => { api.restart?.().catch(() => {}); });
  renderExtensions().catch(() => {});
}

function applyInfoToUi() {
  const info = state.info;

  applyWineInfo(info.wine);
  renderAbout();

  
  

  $('ffmpegInfo').textContent =
    `${info.ffmpeg.path || '未找到'}\n${info.ffmpeg.probePath ? 'ffprobe: ' + info.ffmpeg.probePath + '\n' : ''}` +
    `${tr('set.source')}: ${info.ffmpeg.source || '-'}\nElectron ${info.electron} / Node ${info.node} / ${info.platform}`;

  
}

function buildBackendSelect() {
  const sel = $('selBackend');
  const keep = sel.value || state.settings?.backend || defaultBackendId();
  sel.innerHTML = '';
  const backends = state.info.backends || [];
  for (const b of backends) {
    const opt = document.createElement('option');
    opt.value = b.id;
    const key = BACKEND_LABELS[b.id];
    opt.textContent = key ? tr(key) : b.id;
    opt.title = b.description;
    sel.appendChild(opt);
  }
  const auto = document.createElement('option');
  auto.value = 'auto';
  auto.textContent = tr(BACKEND_LABELS.auto);
  sel.appendChild(auto);
  
  sel.value = keep;
  updateBackendHint();
  if (!sel.dataset.bound) {
    sel.dataset.bound = '1';
    sel.addEventListener('change', () => {
      updateBackendHint();
      
      
      stageAudio({ backend: sel.value, deviceId: '' });
    });
  }
}

function updateBackendHint() {
  const id = $('selBackend').value;
  const b = (state.info.backends || []).find((x) => x.id === id);
  $('backendHint').textContent = id === 'auto'
    ? tr(BACKEND_HINTS.auto)
    : (b?.description || tr(BACKEND_HINTS[id] || BACKEND_HINTS.default));
}

function buildRateSelect() {
  const sel = $('selRate');
  sel.innerHTML = '';
  for (const [v, label] of RATES) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = label.startsWith('set.') ? tr(label) : label;
    sel.appendChild(opt);
  }
  sel.value = String(state.settings.sampleRate ?? 48000);
}




let refreshDevicesSeq = 0;

async function refreshDevices() {
  const backend = $('selBackend').value;
  const sel = $('selDevice');
  const seq = ++refreshDevicesSeq;
  let devices = [];
  try {
    devices = await api.devices.list(backend);
  } catch (err) {
    if (seq !== refreshDevicesSeq) return;      
    $('deviceHint').textContent = tr('err.enumDevices', { msg: err.message });
    return;
  }
  if (seq !== refreshDevicesSeq) return;        
  sel.innerHTML = '';                           
  const def = document.createElement('option');
  def.value = '';
  def.textContent = tr('set.device.default');
  def.title = tr('device.defaultHint');
  sel.appendChild(def);
  for (const d of devices) {
    const opt = document.createElement('option');
    opt.value = d.id;
    const flags = [];
    if (d.isDefault) flags.push(tr('device.default'));
    if (d.state && d.state !== 'active') flags.push(d.state === 'unplugged' ? tr('device.unplugged') : d.state === 'disabled' ? tr('device.disabled') : d.state);
    if (d.formFactor && d.formFactor !== 'unknown') flags.push(d.formFactor);
    opt.textContent = `${d.name}${flags.length ? ' — ' + flags.join('/') : ''}`;
    if (d.mixSampleRate) {
      opt.textContent += ` [${d.mixSampleRate}Hz/${d.mixChannels}ch/${d.mixBits}bit]`;
    }
    sel.appendChild(opt);
  }
  if (state.settings.deviceId && devices.some((d) => d.id === state.settings.deviceId)) {
    sel.value = state.settings.deviceId;
  }
  const active = devices.filter((d) => d.state === 'active').length;
  $('deviceHint').textContent = tr('backend.devices', { total: devices.length, active });
}




let pendingAudio = {};

function audioPendingCount() {
  return Object.keys(pendingAudio).length;
}

function renderAudioPending() {
  const tag = $('audioPending');
  if (tag) tag.hidden = audioPendingCount() === 0;
}


function stageAudio(patch) {
  Object.assign(pendingAudio, patch);
  renderAudioPending();
}

function clearAudioPending() {
  pendingAudio = {};
  renderAudioPending();
}

function applySettingsToControls() {
  const s = state.settings;
  
  const keepAudio = audioPendingCount() > 0;
  if (!keepAudio) {
    $('selBackend').value = s.backend || defaultBackendId();
    updateBackendHint();
    $('selRate').value = String(s.sampleRate ?? 48000);
    $('selBits').value = String(s.bits ?? 32);
    $('selChannels').value = String(s.channels ?? 2);
    $('selPeriod').value = String(s.periodMs ?? 10);
    $('selBuffer').value = String(s.bufferMs ?? 100);
    $('selRing').value = String(s.ringMs ?? 800);
    $('chkFallback').checked = s.allowFormatFallback !== false;
  }
  $('selDevice') && (keepAudio ? null : ($('selDevice').value = s.deviceId || ''));
  renderRepeatButton();
  if (typeof renderVolumeUI === 'function') renderVolumeUI();
  if (!keepAudio) {
    
    $('selBackend').value = s.backend || defaultBackendId();
    $('selPeriod').value = String(s.periodMs ?? 10);
    $('selBuffer').value = String(s.bufferMs ?? 100);
    $('selRing').value = String(s.ringMs ?? 800);
  }
  if (s.wineCompat) $('selWineCompat').value = s.wineCompat;
  updateBackendHint();
  renderAudioPending();
}

async function applySettings(patch) {
  const res = await api.settings.set(patch);
  state.settings = res.settings;
  if (res.audioSettingsChanged) {
    const st = await api.player.reopen();
    applyPlayerState(st);
  }
  updateDeviceStatus();
  return res;
}


function updateDeviceStatus() {
  const st = state.playerState;
  if (st.format) {
    const f = st.format;
    setStatusItem('statusDevice', true,
      tr('sb.device.ok', {
        device: st.deviceName || 'device',
        rate: f.sampleRate,
        ch: f.channels,
        bits: f.bits + (f.isFloat ? 'f' : ''),
      }));
  } else {
    setStatusItem('statusDevice', null, tr('sb.device.none'));
  }
}


function bindTitlebar() {
  $('btnMin').addEventListener('click', () => api.win.minimize());
  $('btnMax').addEventListener('click', () => api.win.toggleMaximize());
  $('btnClose').addEventListener('click', () => api.win.close());
  
  $('btnSettings').addEventListener('click', () => openModalExclusive('settingsModal', () => toggleSettings()));

  
  document.querySelector('.tb-drag').addEventListener('dblclick', () => api.win.toggleMaximize());

  const applyMaximized = (isMax) => {
    document.body.classList.toggle('maximized', !!isMax);
    const label = tr(isMax ? 'tip.restore' : 'tip.max');
    $('btnMax').title = label;
    $('btnMax').setAttribute('aria-label', label);
  };
  api.on('window:maximized', applyMaximized);
  api.win.isMaximized().then(applyMaximized).catch(() => {});
}








const MODAL_OPEN_MS = 260;
const MODAL_CLOSE_MS = 180;
let modalAnimTimer = null;

function playModalAnim(mask, kind) {
  if (modalAnimTimer) clearTimeout(modalAnimTimer);
  mask.classList.remove('anim-open', 'anim-close');
  
  void mask.offsetWidth;
  mask.classList.add(kind === 'close' ? 'anim-close' : 'anim-open');
  const ms = kind === 'close' ? MODAL_CLOSE_MS : MODAL_OPEN_MS;
  modalAnimTimer = setTimeout(() => {
    mask.classList.remove('anim-open', 'anim-close');
    if (kind === 'close') mask.hidden = true;
    modalAnimTimer = null;
  }, ms + 40);
}





function closeOtherModals(exceptId) {
  const ids = ['settingsModal', 'eqModal', 'rankModal'];
  let waited = 0;
  for (const id of ids) {
    if (id === exceptId) continue;
    const mask = $(id);
    if (!mask || mask.hidden) continue;
    if (id === 'settingsModal') toggleSettings(false);
    else if (id === 'eqModal') closeEqModal();
    else closeRankModal();
    waited = MODAL_CLOSE_MS + 40;                 
  }
  return waited;
}


function openModalExclusive(id, open, delay = 0) {
  const run = () => {
    const waited = closeOtherModals(id);
    if (waited) setTimeout(open, waited);         
    else open();
  };
  if (delay) setTimeout(run, delay);
  else run();
}

function toggleSettings(open) {
  const mask = $('settingsModal');
  const show = open === undefined ? mask.hidden : open;
  if (show) {
    mask.hidden = false;
    playModalAnim(mask, 'open');
    $('selBackend').focus({ preventScroll: true });
  } else if (!mask.hidden) {
    
    playModalAnim(mask, 'close');
  }
}

function bindSettingsModal() {
  $('btnCloseSettings').addEventListener('click', () => toggleSettings(false));
  
  $('settingsModal').addEventListener('mousedown', (e) => {
    if (e.target === $('settingsModal')) toggleSettings(false);
  });
}





const PLAY_MODES = ['off', 'all', 'one', 'shuffle'];
const PLAY_MODE_SETTINGS = {
  off: { repeat: 'off', shuffle: false },
  all: { repeat: 'all', shuffle: false },
  one: { repeat: 'one', shuffle: false },
  shuffle: { repeat: 'all', shuffle: true },      
};
function playModeLabel(mode) {
  return tr(mode === 'shuffle' ? 'pl.shuffle' : `pl.repeat.${mode}`);
}

function currentPlayMode(s = state.settings) {
  if (s.shuffle) return 'shuffle';
  return PLAY_MODES.includes(s.repeat) ? s.repeat : 'off';
}

function renderRepeatButton() {
  const btn = $('btnRepeat');
  if (!btn) return;
  const mode = currentPlayMode();
  btn.dataset.mode = mode;
  btn.title = playModeLabel(mode);          
  btn.setAttribute('aria-label', btn.title);
}

function cycleRepeatMode() {
  const next = PLAY_MODES[(PLAY_MODES.indexOf(currentPlayMode()) + 1) % PLAY_MODES.length];
  const patch = PLAY_MODE_SETTINGS[next];
  state.settings.repeat = patch.repeat;
  state.settings.shuffle = patch.shuffle;
  renderRepeatButton();
  applySettings(patch);          
}



function volumeLevel(volume, muted) {
  if (muted) return 'mute';
  const v = Number(volume) || 0;
  if (v <= 0.001) return 'mute';
  return v < 0.5 ? 'low' : 'high';
}


function renderVolumeUI() {
  const muted = !!state.settings.muted;
  const vol = Number(state.settings.volume ?? 0.8);
  const icon = $('volIcon');
  const level = volumeLevel(vol, muted);
  icon.dataset.level = level;
  icon.setAttribute('aria-pressed', muted ? 'true' : 'false');
  icon.title = muted ? tr('tip.unmute') : tr('tip.mute');
  icon.setAttribute('aria-label', icon.title);
  document.querySelector('.volume')?.classList.toggle('is-muted', muted);
  const slider = $('volume');
  if (document.activeElement !== slider) slider.value = String(Math.round(vol * 100));
  syncRangeFill(slider);
  $('volNum').textContent = muted ? tr('vol.muted') : slider.value;
}


async function toggleMute() {
  const next = !state.settings.muted;
  
  if (!next && Number(state.settings.volume ?? 0) <= 0.001) state.settings.volume = 0.8;
  state.settings.muted = next;
  renderVolumeUI();
  await applySettings({ muted: next, volume: state.settings.volume });
  
}

function bindVolume() {
  const slider = $('volume');
  slider.addEventListener('input', () => {
    state.settings.volume = Number(slider.value) / 100;
    
    if (state.settings.muted && state.settings.volume > 0) state.settings.muted = false;
    $('volNum').textContent = slider.value;
    syncRangeFill(slider);
    renderVolumeUI();
    api.player.volume(state.settings.volume);
    applySettings({ volume: state.settings.volume, muted: !!state.settings.muted });
  });
  $('volIcon').addEventListener('click', toggleMute);
  renderVolumeUI();
}

function bindSettingsEvents() {
  applySettingsToControls();
  
  $('selDevice').addEventListener('change', () => stageAudio({ deviceId: $('selDevice').value }));
  $('selRate').addEventListener('change', () => stageAudio({ sampleRate: Number($('selRate').value) }));
  $('selBits').addEventListener('change', () => stageAudio({ bits: Number($('selBits').value) }));
  $('selChannels').addEventListener('change', () => stageAudio({ channels: Number($('selChannels').value) }));
  $('selPeriod').addEventListener('change', () => stageAudio({ periodMs: Number($('selPeriod').value) }));
  $('selBuffer').addEventListener('change', () => stageAudio({ bufferMs: Number($('selBuffer').value) }));
  $('selRing').addEventListener('change', () => stageAudio({ ringMs: Number($('selRing').value) }));
  $('chkFallback').addEventListener('change', () => stageAudio({ allowFormatFallback: $('chkFallback').checked }));
  
  $('btnRepeat').addEventListener('click', cycleRepeatMode);
  $('btnRefreshDevices').addEventListener('click', refreshDevices);
  $('btnApply').addEventListener('click', async () => {
    $('probeResult').textContent = tr('probe.reopening');
    
    if (audioPendingCount() > 0) {
      await applySettings({ ...pendingAudio });
      clearAudioPending();
      await refreshDevices();                 
    }
    const st = await api.player.reopen();
    applyPlayerState(st);
    $('probeResult').textContent = st.format
      ? tr('probe.opened', { detail: `${st.deviceName} · ${st.backend} · ${st.format.sampleRate}Hz/${st.format.channels}ch/${st.format.bits}bit` })
      : tr('probe.released');
  });
  $('btnRelease').addEventListener('click', async () => {
    const st = await api.player.release();
    applyPlayerState(st);
    updateDeviceStatus();
    $('probeResult').textContent = tr('probe.releasedHint');
  });
  $('btnProbe').addEventListener('click', async () => {
    $('probeResult').textContent = tr('probe.probing');
    try {
      const opts = {
        backend: $('selBackend').value,
        deviceId: $('selDevice').value,
        sampleRate: Number($('selRate').value) || 48000,
        channels: Number($('selChannels').value) || 2,
        bits: Number($('selBits').value) || 32,
        isFloat: (Number($('selBits').value) || 32) >= 32,
        exclusive: $('selBackend').value === 'wasapi-exclusive',
      };
      const r = await api.devices.probe(opts);
      const f = r.format || {};
      $('probeResult').textContent =
        tr(r.supported ? 'backend.available' : 'backend.unavailable', { detail: r.detail }) +
        (r.supported ? tr('probe.negotiated', { fmt: `${f.sampleRate}Hz/${f.channels}ch/${f.bits}bit${f.isFloat ? 'f' : ''}` }) : '');
    } catch (err) {
      $('probeResult').textContent = tr('err.probeFailed', { msg: err.message });
    }
  });
  $('btnPickFfmpeg').addEventListener('click', async () => {
    const r = await api.ffmpeg.browse();
    if (!r) return;
    $('ffmpegInfo').textContent = tr('msg.specifiedFfmpeg', { path: r.path }) + `\n${r.version || ''}`;
    
    showError('');
  });
  $('btnAdd').addEventListener('click', async () => {
    const res = await api.playlist.browse();
    if (res && res.added && res.added.length) {
      state.playlist = await api.playlist.get();
      renderPlaylist();
    }
  });
  $('btnClear').addEventListener('click', async () => {
    state.playlist = await api.playlist.clear();
    renderPlaylist();
  });
}












const mediaSupported = (() => {
  try {
    return typeof navigator !== 'undefined' && 'mediaSession' in navigator && typeof MediaMetadata === 'function';
  } catch { return false; }
})();

let mediaKeepAlive = null;







function makeSilentWavUrl(seconds = 1) {
  const rate = 8000;
  const n = rate * seconds;
  const buf = new ArrayBuffer(44 + n);
  const dv = new DataView(buf);
  const str = (off, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); dv.setUint32(4, 36 + n, true); str(8, 'WAVE'); str(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true);
  str(36, 'data'); dv.setUint32(40, n, true);
  for (let i = 0; i < n; i++) dv.setUint8(44 + i, 128);   
  
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);

  
  
  return "data:audio/wav;base64," + btoa(bin);
}

function ensureMediaKeepAlive() {
  if (!mediaSupported || mediaKeepAlive) return;
  try {
    
    const src = makeSilentWavUrl(1);
    const el = new Audio(src);
    el.loop = true;
    el.volume = 0.001;                
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText = 'position:absolute;width:0;height:0;opacity:0;pointer-events:none';
    document.body.appendChild(el);
    mediaKeepAlive = el;
  } catch {  }
}

let mediaRetryBound = false;


function startMediaKeepAlive() {
  ensureMediaKeepAlive();
  if (!mediaKeepAlive) return;
  const p = mediaKeepAlive.play();
  if (!p || typeof p.catch !== "function") return;
  p.catch(() => {
    
    if (mediaRetryBound) return;
    mediaRetryBound = true;
    const retry = () => {
      try { mediaKeepAlive?.play().catch(() => {}); } catch {  }
      window.removeEventListener("pointerdown", retry, true);
      window.removeEventListener("keydown", retry, true);
    };
    window.addEventListener("pointerdown", retry, true);
    window.addEventListener("keydown", retry, true);
  });
}

function setMediaPlaybackState(name) {
  if (!mediaSupported) return;
  try { navigator.mediaSession.playbackState = name; } catch {  }
  if (name === "playing") startMediaKeepAlive();
  else if (mediaKeepAlive) mediaKeepAlive.pause();
}


function updateMediaMetadata(track) {
  if (!mediaSupported || !track) return;
  try {
    const artist = [track.artist, track.album].filter(Boolean).join(' · ') || APP_NAME;
    const artwork = [];
    const img = document.querySelector('#coverImg, #npCover img, .np-cover img, #cover img');
    const src = img?.getAttribute('src') || '';
    if (src.startsWith('data:')) artwork.push({ src, sizes: '512x512' });
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title || track.name || '',
      artist,
      album: track.album || '',
      artwork,
    });
  } catch {  }
}


function updateMediaSessionFromState(st) {
  if (!mediaSupported || !st) return;
  if (!st.trackId) {
    try { navigator.mediaSession.metadata = null; } catch {  }
    setMediaPlaybackState('none');
    return;
  }
  const name = st.status === 'playing' ? 'playing' : st.status === 'paused' ? 'paused' : 'none';
  setMediaPlaybackState(name);
  const duration = Number(st.duration) || 0;
  const position = Number(st.position) || 0;
  if (duration > 0) {
    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: 1,
        position: Math.max(0, Math.min(position, duration)),
      });
    } catch {  }
  }
}


function bindMediaSession() {
  if (!mediaSupported) return;
  const safe = (action, handler) => {
    try { navigator.mediaSession.setActionHandler(action, handler); } catch {  }
  };
  const status = () => state.playerState.status;
  const seekBy = (offset) => {
    const duration = Number(state.playerState.duration) || 0;
    const current = Number(state.playerState.position) || 0;
    const target = Math.max(0, Math.min(duration || Infinity, current + offset));
    api.player.seek(target).then(applyPlayerState).catch(() => {});
  };
  safe('play', () => { if (status() !== 'playing') togglePlay().catch(() => {}); });
  safe('pause', () => { if (status() === 'playing') togglePlay().catch(() => {}); });
  safe('stop', () => { api.player.stop().then(applyPlayerState).catch(() => {}); });
  safe('previoustrack', () => { playRelative(-1).catch(() => {}); });
  safe('nexttrack', () => { playRelative(1).catch(() => {}); });
  safe('seekto', (d) => {
    const t = d && Number(d.seekTime);
    if (Number.isFinite(t)) api.player.seek(t).then(applyPlayerState).catch(() => {});
  });
  safe('seekbackward', (d) => seekBy(-(Number(d?.seekOffset) || 5)));
  safe('seekforward', (d) => seekBy(Number(d?.seekOffset) || 5));
}


function bindTaskbarCommands() {
  api.on('taskbar:command', (cmd) => {
    try {
      if (cmd === 'play') {
        if (state.playerState.status !== 'playing') togglePlay().catch(() => {});
      } else if (cmd === 'pause') {
        if (state.playerState.status === 'playing') togglePlay().catch(() => {});
      } else if (cmd === 'prev') {
        playRelative(-1).catch(() => {});
      } else if (cmd === 'next') {
        playRelative(1).catch(() => {});
      }
    } catch {  }
  });
  window.addEventListener('resize', syncThumbnailClip);
}





let thumbClipTimer = null;
function syncThumbnailClip() {
  if (state.info?.platform !== 'win32') return;
  if (!api.taskbar?.thumbClip) return;
  clearTimeout(thumbClipTimer);
  thumbClipTimer = setTimeout(() => {
    const box = $('coverBox');
    if (!box) return;
    const r = box.getBoundingClientRect();
    api.taskbar.thumbClip({ x: r.x, y: r.y, width: r.width, height: r.height });
  }, 150);
}

function bindTransport() {
  $('btnPlay').addEventListener('click', togglePlay);
  $('btnStop').addEventListener('click', async () => {
    applyPlayerState(await api.player.stop());
  });
  $('btnPrev').addEventListener('click', () => playRelative(-1));
  $('btnNext').addEventListener('click', () => playRelative(1));
  

  
  const nudgeVolume = (delta) => {
    const next = Math.max(0, Math.min(100, Number($('volume').value) + delta));
    if (next === Number($('volume').value)) return;
    $('volume').value = next;
    $('volume').dispatchEvent(new Event('input'));
  };
  for (const el of document.querySelectorAll('.volume')) {
    el.addEventListener('wheel', (e) => {
      e.preventDefault();                      
      nudgeVolume(e.deltaY < 0 ? VOLUME_STEP : -VOLUME_STEP);
    }, { passive: false });
  }

  const bar = $('seekBar');
  const ratioFromEvent = (e) => {
    const rect = bar.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  };
  const showSeekPreview = (e) => {
    const r = ratioFromEvent(e);
    $('seekPlayed').style.width = `${r * 100}%`;
    $('timeNow').textContent = fmtTime(r * (state.playerState.duration || 0));
    updateLyricsProgress(r * (state.playerState.duration || 0));   
    updateLyricsExclusiveProgress(r * (state.playerState.duration || 0));   
    return r;
  };
  bindPointerDrag(bar, {
    onStart: (e) => {
      state.draggingSeek = true;
      showSeekPreview(e);
    },
    onMove: (e) => {
      if (!state.draggingSeek) return;
      showSeekPreview(e);
    },
    onEnd: async (e) => {
      if (!state.draggingSeek) return;
      state.draggingSeek = false;
      const r = ratioFromEvent(e);
      const target = r * (state.playerState.duration || 0);
      if (state.currentId) {
        resetPeakHistory();          
        applyPlayerState(await api.player.seek(target));
      }
      updateLyricsProgress(target);  
    },
  });
}

async function togglePlay() {
  const st = state.playerState;
  if (st.status === 'playing') {
    applyPlayerState(await api.player.pause());
    return;
  }
  if (st.status === 'paused') {
    applyPlayerState(await api.player.resume());
    return;
  }
  if (!state.currentId) {
    const first = state.playlist.find((t) => t.ok) || state.playlist[0];
    if (!first) {
      showError(tr('msg.playlistEmptyDrag'));
      return;
    }
    await playTrack(first.id);
    return;
  }
  await playTrack(state.currentId, st.position || 0);
}

async function playTrack(id, start = 0) {
  const track = state.playlist.find((t) => t.id === id);
  if (!track) return;
  if (!track.ok) {
    showError(tr('err.cannotPlay', { name: track.name, msg: track.error || tr('err.cannotDecodeFile') }));
    return;
  }
  showError('');
  state.currentId = id;
  renderPlaylist();
  try {
    applyPlayerState(await api.player.play(id, start));
    renderNowPlaying(track);
  } catch (err) {
    showError(tr('err.playFailed', { msg: err.message }));
  }
}

function playRelative(delta) {
  const list = state.playlist.filter((t) => t.ok);
  if (!list.length) return;
  const idx = list.findIndex((t) => t.id === state.currentId);
  let nextIdx;
  if (state.settings.shuffle && list.length > 1) {
    do { nextIdx = Math.floor(Math.random() * list.length); } while (nextIdx === idx);
  } else {
    nextIdx = idx + delta;
    if (nextIdx >= list.length) nextIdx = state.settings.repeat === 'all' ? 0 : list.length - 1;
    if (nextIdx < 0) nextIdx = 0;
    if (idx < 0) nextIdx = 0;
  }
  playTrack(list[nextIdx].id);
}

function bindPlayerEvents() {
  api.on('player:state', applyPlayerState);
  api.on('player:progress', (p) => {
    state.playerState.position = p.position;
    updateLyricsProgress(p.position || 0);       
    updateLyricsExclusiveProgress(p.position || 0);   
    state.playerState.duration = p.duration || state.playerState.duration;
    state.playerState.status = p.status;
    $('statBuffer').textContent = `${p.bufferedMs} ms`;
    $('statUnderrun').textContent = p.underruns;
    updatePeakLevels(p.peaks, p);
    if (!state.draggingSeek) {
      const total = state.playerState.duration || 0;
      const ratio = total ? Math.min(1, p.position / total) : 0;
      $('seekPlayed').style.width = `${ratio * 100}%`;
      $('timeNow').textContent = fmtTime(p.position);
      $('timeTotal').textContent = fmtTime(total);
    }
  });
  api.on('player:error', (e) => {
    showError(e.message);
    $('statStatus').textContent = tr('status.error');
  });
  api.on('player:ended', () => {
    if (state.settings.repeat === 'one') {
      playTrack(state.currentId, 0);
      return;
    }
    const list = state.playlist.filter((t) => t.ok);
    const idx = list.findIndex((t) => t.id === state.currentId);
    const isLast = idx === list.length - 1;
    if (!isLast || state.settings.repeat === 'all' || state.settings.shuffle) {
      playRelative(1);
    } else {
      $('btnPlay').textContent = '▶';
      $('statStatus').textContent = tr('status.ended');
    }
  });
  api.on('engine:changed', (e) => {
    if (e.opened) {
      setStatusItem('statusDevice', true, `${e.deviceName} · ${e.backend}`);
    } else {
      setStatusItem('statusDevice', null, tr('sb.device.none'));
    }
  });
  api.on('playlist:changed', (items) => {
    state.playlist = items;
    renderPlaylist();
  });
  api.on('playlist:progress', (p) => {
    setScanHint(tr('msg.scanning', { done: p.done, total: p.total, file: p.file || '' }));
  });
  api.on('playlist:scanning', () => {
    setScanHint(tr('msg.scanningShort'));
  });
  api.on('playlist:added-external', (tracks) => {
    if (tracks.length) playTrack(tracks[0].id);
  });
  api.on('menu:add-files', () => $('btnAdd').click());
  api.on('menu:toggle', togglePlay);
  api.on('menu:prev', () => playRelative(-1));
  api.on('menu:next', () => playRelative(1));
}



function renderTitlebarNowPlaying() {
  const el = $('tbNow');
  if (!el) return;
  const track = state.currentId ? state.playlist.find((t) => t.id === state.currentId) : null;
  const status = state.playerState.status;
  el.hidden = false;                                  

  
  let nextState = '';
  let nextText = '';
  let nextSep = false;
  let title = '';
  let waiting = false;
  if (!track || (status !== 'playing' && status !== 'paused')) {
    nextState = tr('np.waiting');
    title = nextState;
    waiting = true;
  } else {
    const name = [track.artist, track.title].filter(Boolean).join(' - ') ||
      track.name || track.path || '';
    nextState = tr(status === 'paused' ? 'np.paused' : 'np.playing');
    nextText = name;
    nextSep = true;
    title = `${nextState}：${name}`;                  
  }

  const signature = `${nextState}\u0000${nextText}\u0000${nextSep ? '1' : '0'}`;
  const paint = () => {
    $('tbNowState').textContent = nextState;
    $('tbNowText').textContent = nextText;
    $('tbNowSep').hidden = !nextSep;
    el.title = title;
    el.classList.toggle('is-waiting', waiting);
    
    document.title = (!waiting && nextText) ? nextText : APP_TITLE;
  };

  if (signature === lastNowSignature) return;          
  const firstPaint = lastNowSignature === '';          
  lastNowSignature = signature;
  
  
  const inner = $('tbNowInner');
  if (firstPaint || !inner || document.body.classList.contains('no-anim')) {
    paint();
    return;
  }
  inner.classList.remove('is-in');
  inner.classList.add('is-out');
  clearTimeout(nowSwapTimer);
  nowSwapTimer = setTimeout(() => {
    paint();
    inner.classList.remove('is-out');
    inner.classList.add('is-in');
    clearTimeout(nowInTimer);
    nowInTimer = setTimeout(() => inner.classList.remove('is-in'), 300);
  }, 130);
}

let lastNowSignature = '';
let nowSwapTimer = null;
let nowInTimer = null;

function applyPlayerState(st) {
  if (!st) return;
  const prevTrackId = state.currentId;
  const prevStatus = state.playerState.status;
  Object.assign(state.playerState, st);
  $('btnPlay').textContent = st.status === 'playing' ? '⏸' : '▶';
  
  
  if (st.volume !== undefined && !state.settings.muted) {
    state.settings.volume = Number(st.volume);
    renderVolumeUI();
  }
  
  if (st.trackId && (st.trackId !== prevTrackId || (st.status === 'playing' && prevStatus !== 'playing'))) {
    resetPeakHistory();
  }

  
  if (!st.trackId) {
    state.currentId = null;
    resetPeakHistory();
    state.playerState.status = st.status || 'idle';
    renderIdleState();
    renderLyricsEmpty();          
    sideState.renderedFor = null;
    renderTitlebarNowPlaying();
    updateDeviceStatus();
    updateMediaSessionFromState(st);
    return;
  }

  state.currentId = st.trackId;
  
  if (st.status === 'playing' && !sideState.renderedFor) {
    sideState.trackId = st.trackId;
    sideState.renderedFor = null;
  }
  $('statStatus').textContent = tr(STATUS_TEXT[st.status]) || st.status;
  if (st.format) {
    const f = st.format;
    const khz = f.sampleRate % 1000 ? (f.sampleRate / 1000).toFixed(1) : String(f.sampleRate / 1000);
    $('statFormat').textContent = `${khz}kHz/${f.channels}ch/${f.bits}bit${f.isFloat ? 'f' : ''}`;
  }
  if (st.duration) $('timeTotal').textContent = fmtTime(st.duration);
  updateDeviceStatus();
  const track = state.playlist.find((t) => t.id === state.currentId);
  if (track) renderNowPlaying(track);
  renderTitlebarNowPlaying();
  if (lxState.open) updateLyricsExclusiveTime();
  updateMediaSessionFromState(st);
}


function renderIdleState() {
  renderTitlebarNowPlaying();          
  syncLyricsExclusiveMeta(null);       
  $('npTitle').textContent = tr('np.idle');
  $('npArtist').textContent = tr('np.hint');
  $('npTags').innerHTML = '';
  ensureDefaultCover();

  $('timeNow').textContent = '00:00';
  $('timeTotal').textContent = '00:00';
  $('seekPlayed').style.width = '0%';
  $('seekBuffer').style.width = '0%';

  $('statBuffer').textContent = '0 ms';
  $('statFormat').textContent = '-';
  $('statUnderrun').textContent = '0';
  $('statStatus').textContent = tr('status.idle');

  renderMeta(null);
  renderPlaylist();          
  showError('');
}

function renderNowPlaying(track) {
  $('npTitle').textContent = track.title || track.name;
  $('npArtist').textContent = [track.artist, track.album].filter(Boolean).join(' · ') || track.path;
  const tags = $('npTags');
  tags.innerHTML = '';
  const f = state.playerState.format;
  if (track.codec) tags.appendChild(badge(track.codec.toUpperCase(), track.lossless));
  if (f) {
    tags.appendChild(badge(tr('np.tags.output', { fmt: `${f.sampleRate}Hz / ${f.channels}ch / ${f.bits}bit${f.isFloat ? 'f' : ''}` }), true));
    if (f.exclusive) tags.appendChild(badge(tr('np.tags.exclusive'), true));
  }
  if (track.sampleRate) tags.appendChild(badge(tr('np.tags.source', { fmt: `${track.sampleRate}Hz/${track.channels}ch` })));
  if (track.bitrate) tags.appendChild(badge(`${Math.round(track.bitrate / 1000)} kbps`));
  renderMeta(track);
  updateMediaMetadata(track);        
  syncLyricsExclusiveMeta(track);    
  syncThumbnailClip();               
  
  if (sideState.which === 'lyrics') renderLyrics(track.id).catch(() => {});
  loadCover(track);
}


function metaRow(key, value, wide) {
  const row = document.createElement('div');
  row.className = 'meta-row' + (wide ? ' wide' : '');
  const k = document.createElement('span');
  k.className = 'k';
  k.textContent = key;
  const v = document.createElement('span');
  v.className = 'v';
  v.textContent = (value === null || value === undefined || value === '') ? '—' : String(value);
  v.title = v.textContent;
  row.append(k, v);
  return row;
}

function renderMeta(track) {
  const grid = $('metaGrid');
  grid.textContent = '';
  
  if (!track) {
    $('metaPath').textContent = '';
    $('metaPath').title = '';
    const empty = document.createElement('div');
    empty.className = 'meta-empty';
    empty.textContent = tr('meta.empty');
    grid.appendChild(empty);
    return;
  }
  $('metaPath').textContent = track.path;
  $('metaPath').title = track.path;

  const f = state.playerState.format;
  const khz = track.sampleRate
    ? `${(track.sampleRate / 1000).toFixed(track.sampleRate % 1000 ? 1 : 0)} kHz` : null;
  const rows = [
    [tr('meta.k.title'), track.title || track.name],
    [tr('meta.k.artist'), track.artist || track.albumArtist],
    [tr('meta.k.album'), track.album],
    [tr('meta.k.year'), track.year],
    [tr('meta.k.genre'), track.genre],
    [tr('meta.k.track'), track.track],
    [tr('meta.k.codec'), track.codec
      ? `${String(track.codec).toUpperCase()}${track.lossless ? ' · ' + tr('meta.lossless') : ' · ' + tr('meta.lossy')}`
      : (track.ext || '').toUpperCase()],
    [tr('meta.k.container'), track.container],
    [tr('meta.k.rate'), khz],
    [tr('meta.k.bits'), track.bits ? `${track.bits} bit` : null],
    [tr('meta.k.channels'), track.channels ? `${track.channels}${track.channelLayout ? ' · ' + track.channelLayout : ''}` : null],
    [tr('meta.k.bitrate'), track.bitrate ? `${Math.round(track.bitrate / 1000)} kbps` : null],
    [tr('meta.k.duration'), track.duration ? fmtTime(track.duration) : null],
    [tr('meta.k.size'), track.size ? fmtSize(track.size) : null],
    [tr('meta.output'), f
      ? `${f.sampleRate}Hz / ${f.channels}ch / ${f.bits}bit${f.isFloat ? 'f' : ''}${f.exclusive ? ' · ' + tr('np.tags.exclusive') : ''}`
      : null],
  ];
  for (const [k, v] of rows) grid.appendChild(metaRow(k, v));
  grid.appendChild(metaRow(tr('meta.path'), track.path, true));
  if (!track.ok) grid.appendChild(metaRow(tr('meta.status'), track.error || tr('pl.undecodable'), true));
}


let coverToken = 0;
async function loadCover(track) {
  const img = $('coverImg');
  const ph = $('coverPlaceholder');
  const token = ++coverToken;
  const showPlaceholder = () => {
    img.hidden = true;                 
    img.removeAttribute('src');
    ph.hidden = false;
  };
  
  
  
  if (!track) return showPlaceholder();
  try {
    const res = await api.cover.get(track.id);
    if (token !== coverToken) return undefined;
    if (res && res.dataUrl) {
      img.onerror = () => { if (token === coverToken) showPlaceholder(); };
      img.src = res.dataUrl;
      img.hidden = false;
      ph.hidden = true;
      
      try { updateMediaMetadata(track); } catch {  }
      return undefined;
    }
  } catch {  }
  if (token === coverToken) showPlaceholder();
  return undefined;
}


function ensureDefaultCover() {
  const img = $('coverImg');
  img.hidden = true;
  img.removeAttribute('src');
  $('coverPlaceholder').hidden = false;
}


function renderPlaylist() {
  const list = $('plList');
  const empty = $('plEmpty');
  list.innerHTML = '';
  $('plCount').textContent = state.playlist.length;
  empty.style.display = state.playlist.length ? 'none' : 'block';

  state.playlist.forEach((t, i) => {
    const li = document.createElement('li');
    li.className = 'pl-item' + (t.id === state.currentId ? ' playing' : '') + (t.ok ? '' : ' bad');
    li.draggable = true;
    li.dataset.id = t.id;

    const idx = document.createElement('div');
    idx.className = 'pl-index';
    idx.textContent = t.id === state.currentId && state.playerState.status === 'playing' ? '▶' : String(i + 1);

    
    const main = document.createElement('div');
    main.className = 'pl-main';
    const name = document.createElement('div');
    name.className = 'pl-name';
    name.textContent = t.title || t.name;
    
    const meta = document.createElement('div');
    meta.className = 'pl-meta';
    meta.textContent = [t.artist, t.container || t.ext, fmtSize(t.size)].filter(Boolean).join(' · ');
    main.append(name, meta);

    const fmt = document.createElement('div');
    fmt.className = 'pl-fmt';
    
    fmt.appendChild(badge((t.codec || t.ext || '?').toUpperCase(), t.lossless));
    if (t.sampleRate) {
      const khz = t.sampleRate % 1000 ? (t.sampleRate / 1000).toFixed(1) : String(t.sampleRate / 1000);
      fmt.appendChild(badge(`${khz}kHz${t.bits ? '/' + t.bits + 'bit' : ''}`));
    }
    if (!t.ok) fmt.appendChild(badge(tr('pl.undecodable')));

    const dur = document.createElement('div');
    dur.className = 'pl-dur';
    dur.textContent = t.duration ? fmtTime(t.duration) : '--:--';

    const del = document.createElement('button');
    del.className = 'pl-del';
    del.textContent = '✕';
    del.title = tr('pl.tip.remove');
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      state.playlist = await api.playlist.remove(t.id);
      if (state.currentId === t.id) state.currentId = null;
  renderTitlebarNowPlaying();
      renderPlaylist();
    });

    li.append(idx, main, fmt, dur, del);
    li.addEventListener('dblclick', () => playTrack(t.id));
    li.addEventListener('click', () => {
      if (t.id !== state.currentId) playTrack(t.id);
    });
    
    
    li.addEventListener('contextmenu', (e) => e.preventDefault());

    
    li.addEventListener('dragstart', (e) => {
      state.internalDragId = t.id;
      e.dataTransfer.setData('text/plain', t.id);
      e.dataTransfer.effectAllowed = 'move';
    });
    li.addEventListener('dragover', (e) => {
      if (isBrowserFileDrag(e)) return;          
      if (!state.internalDragId) return;         
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    li.addEventListener('drop', async (e) => {
      if (isBrowserFileDrag(e)) return;          
      if (!state.internalDragId) return;
      e.preventDefault();
      e.stopPropagation();
      const fromId = state.internalDragId;
      state.internalDragId = null;
      if (fromId === t.id) return;
      state.playlist = await api.playlist.reorder(fromId, i);
      renderPlaylist();
    });
    li.addEventListener('dragend', () => { state.internalDragId = null; });

    list.appendChild(li);
  });
}





function syncRangeFill(input) {
  const min = Number(input.min || 0);
  const max = Number(input.max || 100);
  const val = Number(input.value || 0);
  const pct = max === min ? 0 : ((val - min) / (max - min)) * 100;
  input.style.setProperty('--range-fill', `${pct.toFixed(2)}%`);
}

function bindRangeFills() {
  const ranges = () => document.querySelectorAll('input[type="range"]');
  ranges().forEach((r) => {
    syncRangeFill(r);
    r.addEventListener('input', () => syncRangeFill(r));
    r.addEventListener('change', () => syncRangeFill(r));
  });
}


const EQ_PRESET_LABELS = {
  flat: 'eq.preset.flat', pop: 'eq.preset.pop', rock: 'eq.preset.rock', jazz: 'eq.preset.jazz',
  classical: 'eq.preset.classical', vocal: 'eq.preset.vocal', bass: 'eq.preset.bass',
  treble: 'eq.preset.treble',
};

function formatDb(v) {
  const n = Number(v) || 0;
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}`;
}


function buildEqUi(meta) {
  state.eq.bands = meta.bands || state.eq.bands;
  state.eq.labels = meta.labels || state.eq.labels;
  state.eq.gainLimit = meta.gainLimit || 12;
  state.eq.presetGains = meta.presetGains || {};
  state.eq.presetNames = meta.presets || Object.keys(EQ_PRESET_LABELS);

  const wrap = $('eqBands');
  wrap.innerHTML = '';
  state.eq.bands.forEach((freq, i) => {
    const band = document.createElement('div');
    band.className = 'eq-band';
    const db = document.createElement('b');
    db.className = 'eq-db';
    db.id = `eqDb${i}`;
    db.textContent = '0';
    const sliderWrap = document.createElement('div');
    sliderWrap.className = 'eq-slider-wrap';
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.id = `eqBand${i}`;
    slider.min = String(-state.eq.gainLimit);
    slider.max = String(state.eq.gainLimit);
    slider.step = '0.5';
    slider.value = '0';
    slider.setAttribute('aria-label', `${state.eq.labels[i]} Hz`);
    sliderWrap.appendChild(slider);
    const freqEl = document.createElement('span');
    freqEl.className = 'eq-freq';
    freqEl.textContent = `${state.eq.labels[i]}Hz`;
    band.append(db, sliderWrap, freqEl);
    wrap.appendChild(band);

    
    slider.addEventListener('input', () => {
      state.eq.config.bands[i].gainDb = Number(slider.value);
      db.textContent = formatDb(Number(slider.value));
      syncRangeFill(slider);
      sendEqRealtime();
    });
    slider.addEventListener('change', () => renderEqUi());
  });

  const presetWrap = $('eqPresets');
  presetWrap.innerHTML = '';
  for (const name of state.eq.presetNames) {
    const btn = document.createElement('button');
    btn.className = 'btn mini ghost';
    btn.dataset.preset = name;
    btn.textContent = tr(EQ_PRESET_LABELS[name]) || name;
    btn.addEventListener('click', () => applyEqPreset(name));
    presetWrap.appendChild(btn);
  }
}


function renderEqUi() {
  const cfg = state.eq.config;
  cfg.bands.forEach((band, i) => {
    const slider = $(`eqBand${i}`);
    if (slider) {
      slider.value = String(band.gainDb);
      syncRangeFill(slider);
    }
    const db = $(`eqDb${i}`);
    if (db) db.textContent = formatDb(band.gainDb);
  });
  $('chkEqEnabled').checked = !!cfg.enabled;
  $('eqPreamp').value = String(cfg.preampDb || 0);
  $('eqPreampVal').textContent = `${formatDb(cfg.preampDb)} dB`;
  syncRangeFill($('eqPreamp'));
  for (const btn of document.querySelectorAll('#eqPresets .btn')) {
    const gains = state.eq.presetGains?.[btn.dataset.preset];
    btn.classList.toggle('active', !!gains &&
      gains.every((g, i) => Math.abs(g - cfg.bands[i].gainDb) < 0.001));
  }
  $('eqStatus').textContent = state.eq.lastSaved
    ? tr('eq.status.saved', { path: state.eq.lastSaved })
    : (cfg.enabled ? tr('eq.status.on') : tr('eq.status.off'));
}





let eqRealtimeTimer = null;
let eqRealtimePending = false;
function sendEqRealtime() {
  eqRealtimePending = true;
  if (eqRealtimeTimer) return;
  eqRealtimeTimer = setTimeout(async () => {
    eqRealtimeTimer = null;
    eqRealtimePending = false;
    await pushEqConfig();
  }, 60);
}

async function pushEqConfig() {
  try {
    const res = await api.eq.set(state.eq.config);
    if (res && res.config) state.eq.config = res.config;
    $('eqStatus').textContent = state.eq.config.enabled ? tr('eq.status.on') : tr('eq.status.off');
    return res;
  } catch (err) {
    showToast(tr('eq.err.apply', { msg: String(err.message || err) }), 'err');
    return null;
  }
}

function applyEqPreset(name) {
  const gains = state.eq.presetGains?.[name];
  if (!gains) return;
  state.eq.config.enabled = true;
  state.eq.config.bands = state.eq.config.bands.map((b, i) => ({ ...b, gainDb: gains[i] ?? 0 }));
  renderEqUi();
  pushEqConfig();
  showToast(tr('eq.presetApplied', { name: tr(EQ_PRESET_LABELS[name]) || name }), 'ok');
}

function openEqModal() {
  const mask = $('eqModal');
  if (!mask.hidden) return;
  mask.hidden = false;
  playModalAnim(mask, 'open');            
  $('chkEqEnabled').focus({ preventScroll: true });
}

function closeEqModal() {
  const mask = $('eqModal');
  if (mask.hidden) return;
  playModalAnim(mask, 'close');
}

async function bindEq() {
  let meta = {};
  try { meta = await api.eq.get(); } catch {  }
  state.eq.config = meta.config || state.eq.config;
  buildEqUi(meta);
  renderEqUi();

  $('btnEq').addEventListener('click', () => {
    openModalExclusive('eqModal', () => {
      if ($('eqModal').hidden) openEqModal();
      else closeEqModal();
    });
  });
  $('btnCloseEq').addEventListener('click', closeEqModal);
  $('eqModal').addEventListener('mousedown', (e) => {
    if (e.target === $('eqModal')) closeEqModal();
  });

  $('chkEqEnabled').addEventListener('change', () => {
    state.eq.config.enabled = $('chkEqEnabled').checked;
    renderEqUi();
    pushEqConfig();
  });
  $('eqPreamp').addEventListener('input', () => {
    state.eq.config.preampDb = Number($('eqPreamp').value);
    $('eqPreampVal').textContent = `${formatDb(state.eq.config.preampDb)} dB`;
    syncRangeFill($('eqPreamp'));
    sendEqRealtime();
  });
  $('btnEqReset').addEventListener('click', () => {
    state.eq.config.bands = state.eq.config.bands.map((b) => ({ ...b, gainDb: 0 }));
    state.eq.config.preampDb = 0;
    state.eq.lastSaved = '';
    renderEqUi();
    pushEqConfig();
    showToast(tr('eq.resetDone'), 'ok');
  });
  $('btnEqSave').addEventListener('click', async () => {
    const res = await api.eq.save(state.eq.config);
    if (res?.canceled) return;
    if (res?.error) { showToast(res.error, 'err'); return; }
    state.eq.lastSaved = res.filePath;
    renderEqUi();
    showToast(tr('eq.saved', { path: res.filePath }), 'ok');
  });
  $('btnEqLoad').addEventListener('click', async () => {
    const res = await api.eq.load();
    if (res?.canceled) return;
    if (res?.error) { showToast(res.error, 'err'); return; }
    state.eq.config = res.config;
    state.eq.lastSaved = res.filePath;
    renderEqUi();
    showToast(tr('eq.loaded', { path: res.filePath }), 'ok');
  });
}





const SELECT_UI = new Map();          

function selectedOptionText(sel) {
  const opt = sel.options[sel.selectedIndex];
  return opt ? (opt.textContent || opt.label || '').trim() : '';
}


function rebuildSelectOptions(sel) {
  const ui = SELECT_UI.get(sel);
  if (!ui) return;
  ui.pop.innerHTML = '';
  for (const opt of sel.options) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'sel-opt';
    item.dataset.value = opt.value;
    item.textContent = (opt.textContent || opt.value).trim();
    item.setAttribute('role', 'option');
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      closeSelectUI(sel);
      if (sel.value === opt.value) { syncSelectUI(sel); return; }
      sel.value = opt.value;                                  
      sel.dispatchEvent(new Event('change', { bubbles: true }));   
    });
    ui.pop.appendChild(item);
  }
  syncSelectUI(sel);
}


function syncSelectUI(sel) {
  const ui = SELECT_UI.get(sel);
  if (!ui) return;
  ui.label.textContent = selectedOptionText(sel) || '—';
  ui.btn.disabled = sel.disabled;
  for (const item of ui.pop.querySelectorAll('.sel-opt')) {
    const on = item.dataset.value === sel.value;
    item.classList.toggle('is-selected', on);
    item.setAttribute('aria-selected', on ? 'true' : 'false');
  }
}

function openSelectUI(sel) {
  const ui = SELECT_UI.get(sel);
  if (!ui || !ui.pop.hidden) return;
  for (const other of SELECT_UI.keys()) if (other !== sel) closeSelectUI(other);   
  ui.pop.hidden = false;
  ui.btn.setAttribute('aria-expanded', 'true');
  ui.pop.classList.add('anim-open');
  setTimeout(() => ui.pop.classList.remove('anim-open'), 220);   
  const cur = ui.pop.querySelector('.sel-opt.is-selected') || ui.pop.firstElementChild;
  cur?.classList.add('is-active');
  cur?.scrollIntoView({ block: 'nearest' });
}

function closeSelectUI(sel) {
  const ui = SELECT_UI.get(sel);
  if (!ui || ui.pop.hidden) return;
  ui.pop.hidden = true;
  ui.btn.setAttribute('aria-expanded', 'false');
  ui.pop.classList.remove('anim-open');
  for (const item of ui.pop.querySelectorAll('.sel-opt')) item.classList.remove('is-active');
}

function moveSelectActive(sel, delta) {
  const ui = SELECT_UI.get(sel);
  if (!ui || ui.pop.hidden) return;
  const items = [...ui.pop.querySelectorAll('.sel-opt')];
  if (!items.length) return;
  const at = items.findIndex((i) => i.classList.contains('is-active'));
  const next = Math.max(0, Math.min(items.length - 1, (at < 0 ? 0 : at + delta)));
  items.forEach((i, i2) => i.classList.toggle('is-active', i2 === next));
  items[next].scrollIntoView({ block: 'nearest' });
}


function upgradeSelect(sel) {
  if (SELECT_UI.has(sel)) return;

  const wrap = document.createElement('div');
  wrap.className = 'sel-wrap';
  sel.parentNode.insertBefore(wrap, sel);
  wrap.appendChild(sel);
  sel.classList.add('sel-native');

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'sel-btn';
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.setAttribute('aria-expanded', 'false');
  const label = document.createElement('span');
  label.className = 'sel-label';
  const caret = document.createElement('i');
  caret.className = 'sel-caret';
  btn.append(label, caret);

  const pop = document.createElement('div');
  pop.className = 'sel-pop';
  pop.hidden = true;
  pop.setAttribute('role', 'listbox');

  wrap.append(btn, pop);
  SELECT_UI.set(sel, { wrap, btn, label, pop });

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (pop.hidden) openSelectUI(sel);
    else closeSelectUI(sel);
  });
  btn.addEventListener('keydown', (e) => {
    if (e.code === 'Enter' || e.code === 'Space' || e.code === 'ArrowDown') {
      e.preventDefault();
      if (pop.hidden) openSelectUI(sel);
      else if (e.code === 'Enter') ui_pickActive(sel);
      else moveSelectActive(sel, 1);
    } else if (e.code === 'ArrowUp') {
      e.preventDefault();
      moveSelectActive(sel, -1);
    } else if (e.code === 'Escape') {
      e.preventDefault();
      closeSelectUI(sel);
    }
  });
  
  
  

  
  const proto = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  Object.defineProperty(sel, 'value', {
    configurable: true,
    get() { return proto.get.call(sel); },
    set(v) { proto.set.call(sel, v); syncSelectUI(sel); },
  });
  
  new MutationObserver(() => rebuildSelectOptions(sel))
    .observe(sel, { childList: true, subtree: true, characterData: true });

  rebuildSelectOptions(sel);
}

function ui_pickActive(sel) {
  const ui = SELECT_UI.get(sel);
  const item = ui?.pop.querySelector('.sel-opt.is-active') || ui?.pop.querySelector('.sel-opt.is-selected');
  if (item) item.click();
}

function upgradeAllSelects(root = document) {
  for (const sel of root.querySelectorAll('select')) upgradeSelect(sel);
  document.addEventListener('click', () => {
    for (const sel of SELECT_UI.keys()) closeSelectUI(sel);      
  });
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape') return;
    for (const sel of SELECT_UI.keys()) closeSelectUI(sel);
  });
}


const RANK_PLAY_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
  '<path d="M8 5.5v13l11-6.5z"></path></svg>';


function rankItemEl(entry, index) {
  const li = document.createElement('li');
  li.className = 'rank-item' + (index === 0 ? ' is-top' : '');
  li.dataset.key = entry.key;
  li.dataset.plays = String(entry.plays);

  const editing = rankEditMode;
  
  
  {
    const slot = document.createElement('span');
    slot.className = 'rank-pick-slot';
    const pick = document.createElement('input');
    pick.type = 'checkbox';
    pick.className = 'rank-pick';
    pick.checked = rankPicked.has(entry.key);
    pick.tabIndex = editing ? 0 : -1;
    pick.setAttribute('aria-label', entry.title || tr('rank.unknownTitle'));
    pick.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!rankEditMode) { pick.checked = false; return; }
      toggleRankPick(entry.key, pick.checked, li);
    });
    slot.appendChild(pick);
    li.appendChild(slot);
    li.addEventListener('click', () => {
      if (!rankEditMode) return;                    
      pick.checked = !pick.checked;
      toggleRankPick(entry.key, pick.checked, li);
    });
    if (pick.checked) li.classList.add('is-picked');
  }

  const no = document.createElement('span');
  no.className = 'rank-no';
  no.textContent = `${index + 1}`;

  const main = document.createElement('div');
  main.className = 'rank-main';
  const name = document.createElement('div');
  name.className = 'rank-name';
  name.textContent = entry.title || tr('rank.unknownTitle');
  const sub = document.createElement('div');
  sub.className = 'rank-sub';
  sub.textContent = [entry.artist || tr('rank.unknownArtist'), entry.album].filter(Boolean).join(' · ');
  main.append(name, sub);

  const count = document.createElement('span');
  count.className = 'rank-count';
  count.innerHTML = RANK_PLAY_ICON;                  
  const num = document.createElement('span');
  num.textContent = `${entry.plays} ${tr('rank.times')}`;
  count.appendChild(num);
  count.title = tr('rank.timesTip', { n: entry.plays });

  li.append(no, main, count);
  if (entry.lastPlayedAt) li.title = `${name.textContent}\n${sub.textContent}`;
  return li;
}


let rankEditMode = false;
const rankPicked = new Set();

function renderRankEditBar() {
  const foot = $('rankEditFoot');
  $('rankList').classList.toggle('is-editing', rankEditMode);
  $('btnRankEdit').textContent = tr('rank.edit');
  $('btnRankRemove').disabled = rankPicked.size === 0;
  $('btnRankRemove').textContent = rankPicked.size
    ? `${tr('rank.remove')} (${rankPicked.size})`
    : tr('rank.remove');
  $('btnRankSelectAll').textContent = rankPicked.size && rankPicked.size === rankRowCount
    ? tr('rank.unselectAll') : tr('rank.selectAll');
  $('rankEditTip').textContent = rankPicked.size ? tr('rank.picked', { n: rankPicked.size }) : '';

  
  if (rankEditMode) {
    foot.hidden = false;
    foot.classList.remove('is-in');
    void foot.offsetWidth;                          
    foot.classList.add('is-in');
    clearTimeout(rankFootTimer);
    rankFootTimer = setTimeout(() => foot.classList.remove('is-in'), 450);
  } else {
    foot.classList.remove('is-in');
    foot.hidden = true;
  }
}

let rankFootTimer = null;

let rankRowCount = 0;

function toggleRankPick(key, checked, li) {
  if (checked) rankPicked.add(key);
  else rankPicked.delete(key);
  li?.classList.toggle('is-picked', checked);
  renderRankEditBar();
}

function setRankEditMode(on) {
  rankEditMode = on;
  if (!on) rankPicked.clear();
  
  for (const li of document.querySelectorAll('#rankList .rank-item')) {
    const pick = li.querySelector('.rank-pick');
    if (pick) {
      pick.checked = false;
      pick.tabIndex = on ? 0 : -1;
    }
    li.classList.remove('is-picked');
  }
  renderRankEditBar();
}

async function removeRankPicked() {
  const keys = [...rankPicked];
  if (!keys.length) return;
  try {
    const res = await api.plays.remove(keys);
    rankPicked.clear();
    rankRowCount = 0;
    renderRankList(res);                             
    if (res?.removed) showToast(tr('rank.removed', { n: res.removed }), 'ok');
  } catch (err) {
    showToast(tr('rank.errRemove', { msg: String(err.message || err) }), 'err');
  }
}

async function renderRankList(prefetched = null) {
  const list = $('rankList');
  let data = prefetched;
  if (!data) {
    data = { ranking: [], summary: { songs: 0, totalPlays: 0 } };
    try {
      data = await api.plays.get();
    } catch {  }
  }
  const ranking = data.ranking || [];
  list.innerHTML = '';
  rankRowCount = ranking.length;
  if (!ranking.length) {
    const li = document.createElement('li');
    li.className = 'rank-empty';
    li.textContent = tr('rank.empty');
    list.appendChild(li);
  } else {
    ranking.forEach((entry, i) => list.appendChild(rankItemEl(entry, i)));
  }
  const s = data.summary || { songs: 0, totalPlays: 0 };
  $('rankSummary').textContent = tr('rank.summary', { songs: s.songs, plays: s.totalPlays });
  renderRankEditBar();
}

function openRankModal() {
  const mask = $('rankModal');
  if (!mask.hidden) return;
  rankEditMode = false;
  rankPicked.clear();
  renderRankList();
  mask.hidden = false;
  playModalAnim(mask, 'open');                        
  $('btnCloseRank').focus({ preventScroll: true });
}

function closeRankModal() {
  const mask = $('rankModal');
  if (mask.hidden) return;
  rankEditMode = false;                               
  rankPicked.clear();
  playModalAnim(mask, 'close');
}

function bindRank() {
  
  $('btnRank').addEventListener('click', () => {
    openModalExclusive('rankModal', () => {
      if ($('rankModal').hidden) openRankModal();
      else closeRankModal();
    });
  });
  $('btnCloseRank').addEventListener('click', closeRankModal);
  $('rankModal').addEventListener('mousedown', (e) => {
    if (e.target === $('rankModal')) closeRankModal();
  });
  
  $('btnRankEdit').addEventListener('click', () => setRankEditMode(!rankEditMode));
  $('btnRankDone').addEventListener('click', () => setRankEditMode(false));
  $('btnRankSelectAll').addEventListener('click', () => {
    const all = [...document.querySelectorAll('#rankList .rank-item')];
    const selectAll = rankPicked.size !== all.length;
    rankPicked.clear();
    for (const li of all) {
      const pick = li.querySelector('.rank-pick');
      if (selectAll) rankPicked.add(li.dataset.key);
      if (pick) pick.checked = selectAll;
      li.classList.toggle('is-picked', selectAll);
    }
    renderRankEditBar();
  });
  $('btnRankRemove').addEventListener('click', removeRankPicked);
  
  api.on('plays:changed', () => {
    if (!$('rankModal').hidden) renderRankList();
  });
}



let ctxTrackId = null;
let ctxAnimTimer = null;
let ctxOpenedAt = 0;               

function playCtxAnim(menu, kind) {
  
  
  const cls = kind === 'close' ? 'anim-close' : 'anim-open';
  if (menu.classList.contains(cls)) return;
  clearTimeout(ctxAnimTimer);
  menu.classList.remove('anim-open', 'anim-close');
  void menu.offsetWidth;                                   
  menu.classList.add(cls);
  ctxAnimTimer = setTimeout(() => {
    menu.classList.remove('anim-open', 'anim-close');
    if (kind === 'close') menu.hidden = true;
  }, (kind === 'close' ? MODAL_CLOSE_MS : MODAL_OPEN_MS) + 40);
}

function ctxItem(label, onClick, { submenu = false, key = null } = {}) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ctx-item';
  if (key) btn.dataset.key = key;
  const span = document.createElement('span');
  span.textContent = label;
  btn.appendChild(span);
  if (submenu) {
    const arrow = document.createElement('span');
    arrow.className = 'ctx-arrow';
    arrow.textContent = '▸';
    btn.appendChild(arrow);
  }
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick(btn);
  });
  return btn;
}


function openCtxMenu(x, y, trackId) {
  const menu = $('ctxMenu');
  ctxTrackId = trackId;
  menu.textContent = '';
  menu.append(
    ctxItem(tr('ctx.play'), () => { closeCtxMenu(); playTrack(trackId); }, { key: 'play' }),
    ctxItem(tr('ctx.remove'), () => { closeCtxMenu(); removeTrackById(trackId); }, { key: 'remove' }),
    ctxItem(tr('ctx.convert'), () => showCtxFormats(), { submenu: true, key: 'convert' }),
    ctxItem(tr('ctx.props'), () => { closeCtxMenu(); openPropsModal(trackId); }, { key: 'props' }),
  );
  placeCtxMenu(x, y);
  playCtxAnim(menu, 'open');
}


function showCtxFormats() {
  const menu = $('ctxMenu');
  const box = menu.getBoundingClientRect();
  menu.textContent = '';
  menu.append(ctxItem(`‹ ${tr('ctx.convert')}`, () => openCtxMenu(box.left, box.top, ctxTrackId), { key: 'back' }));
  const sep = document.createElement('div');
  sep.className = 'ctx-sep';
  menu.append(sep);
  for (const f of CONVERT_FORMATS) {
    menu.append(ctxItem(f.label, () => {
      closeCtxMenu();
      openConvertModal(ctxTrackId, f.id);
    }, { key: `fmt:${f.id}` }));
  }
  placeCtxMenu(box.left, box.top);
  playCtxAnim(menu, 'open');
}


function placeCtxMenu(x, y) {
  const menu = $('ctxMenu');
  menu.hidden = false;
  ctxOpenedAt = Date.now();        
  menu.style.left = '0px';
  menu.style.top = '0px';
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(6, Math.min(x, window.innerWidth - r.width - 6))}px`;
  menu.style.top = `${Math.max(6, Math.min(y, window.innerHeight - r.height - 6))}px`;
}

function closeCtxMenu() {
  const menu = $('ctxMenu');
  if (menu.hidden) return;
  playCtxAnim(menu, 'close');
}

async function removeTrackById(id) {
  state.playlist = await api.playlist.remove(id);
  if (state.currentId === id) state.currentId = null;
  renderTitlebarNowPlaying();
  renderPlaylist();
}

function bindPlaylistContextMenu() {
  $('plList').addEventListener('contextmenu', (e) => {
    const row = e.target.closest?.('.pl-item');
    if (!row) return;
    e.preventDefault();
    openCtxMenu(e.clientX, e.clientY, row.dataset.id);
  });
  
  window.addEventListener('mousedown', (e) => {
    const menu = $('ctxMenu');
    if (!menu.hidden && !menu.contains(e.target)) closeCtxMenu();
  });
  window.addEventListener('blur', closeCtxMenu);
  window.addEventListener('resize', closeCtxMenu);
  
  document.addEventListener('scroll', () => {
    if (Date.now() - ctxOpenedAt < 200) return;
    closeCtxMenu();
  }, true);
}


let CONVERT_FORMATS = [];
let convState = { trackId: null, formatId: 'flac', options: {} };

function currentConvertFormat() {
  return CONVERT_FORMATS.find((f) => f.id === convState.formatId) || CONVERT_FORMATS[0];
}

function convDefaultOptions(fmt) {
  const o = { rateMode: 'vbr' };
  if (fmt.compression) o.compressionLevel = fmt.compression.default;
  if (fmt.bitDepth) o.bitDepth = fmt.bitDepth.default;
  if (fmt.bitrate) o.bitrate = fmt.bitrate.default;
  if (fmt.quality) o.quality = fmt.quality.default;
  return o;
}


function renderConvertParams() {
  const fmt = currentConvertFormat();
  const box = $('convParams');
  box.textContent = '';
  $('convExt').textContent = `.${fmt.ext}`;
  if (!fmt) return;

  
  
  const addField = (labelKey, node, { upgrade = false } = {}) => {
    const field = document.createElement('label');
    field.className = 'field';
    const span = document.createElement('span');
    span.textContent = tr(labelKey);
    field.append(span, node);
    box.appendChild(field);
    if (upgrade) upgradeSelect(node);
    return field;
  };

  
  if (fmt.compression) {
    const wrap = document.createElement('div');
    const range = document.createElement('input');
    range.type = 'range';
    range.className = 'conv-range';
    range.min = String(fmt.compression.min);
    range.max = String(fmt.compression.max);
    range.step = '1';
    range.value = String(convState.options.compressionLevel);
    syncRangeFill(range);                     
    const val = document.createElement('span');
    val.className = 'conv-range-val';
    val.textContent = String(range.value);
    range.addEventListener('input', () => {
      convState.options.compressionLevel = Number(range.value);
      val.textContent = range.value;
      syncRangeFill(range);
    });
    wrap.append(range, val);
    addField('conv.compression', wrap);
  }

  
  if (fmt.bitDepth) {
    const sel = document.createElement('select');
    for (const d of fmt.bitDepth.options) {
      const opt = document.createElement('option');
      opt.value = String(d);
      opt.textContent = `${d} bit`;
      sel.appendChild(opt);
    }
    sel.value = String(convState.options.bitDepth);
    sel.addEventListener('change', () => { convState.options.bitDepth = Number(sel.value); });
    addField('conv.bitDepth', sel, { upgrade: true });
  }

  
  if (fmt.params.includes('rateMode')) {
    const row = document.createElement('div');
    row.className = 'conv-formats';
    const mk = (mode, labelKey) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `conv-fmt${convState.options.rateMode === mode ? ' is-on' : ''}`;
      b.dataset.rateMode = mode;
      b.textContent = tr(labelKey);
      b.addEventListener('click', () => {
        convState.options.rateMode = mode;
        renderConvertParamsAnimated();        
      });
      return b;
    };
    row.append(mk('vbr', 'conv.vbr'), mk('cbr', 'conv.cbr'));
    addField('conv.rateMode', row);

    if (convState.options.rateMode === 'cbr') {
      const sel = document.createElement('select');
      for (const b of fmt.bitrate.options) {
        const opt = document.createElement('option');
        opt.value = String(b);
        opt.textContent = `${b} ${fmt.bitrate.unit}`;
        sel.appendChild(opt);
      }
      sel.value = String(convState.options.bitrate);
      sel.addEventListener('change', () => { convState.options.bitrate = Number(sel.value); });
      addField('conv.bitrate', sel, { upgrade: true });
    } else if (fmt.quality) {
      const wrap = document.createElement('div');
      const range = document.createElement('input');
      range.type = 'range';
      range.className = 'conv-range';
      range.min = String(fmt.quality.min);
      range.max = String(fmt.quality.max);
      range.step = '1';
      range.value = String(convState.options.quality);
      syncRangeFill(range);                   
      const val = document.createElement('span');
      val.className = 'conv-range-val';
      val.textContent = `${range.value}（${tr('conv.vbr')}）`;
      range.addEventListener('input', () => {
        convState.options.quality = Number(range.value);
        val.textContent = `${range.value}（${tr('conv.vbr')}）`;
        syncRangeFill(range);
      });
      wrap.append(range, val);
      addField('conv.quality', wrap);
    }
  }

  const note = document.createElement('p');
  note.className = 'hint';
  note.textContent = fmt.notes || '';
  box.appendChild(note);
}



let convSwapTimer = null;
function renderConvertParamsAnimated() {
  const box = $('convParams');
  clearTimeout(convSwapTimer);
  box.classList.add('is-swapping');
  convSwapTimer = setTimeout(() => {
    renderConvertParams();
    box.classList.remove('is-swapping');
  }, 90);
}

function renderConvertFormats() {
  const box = $('convFormats');
  box.textContent = '';
  for (const f of CONVERT_FORMATS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `conv-fmt${f.id === convState.formatId ? ' is-on' : ''}`;
    b.dataset.format = f.id;
    const name = document.createElement('span');
    name.textContent = `${f.label}${f.lossless ? ` · ${tr('conv.lossless')}` : ` · ${tr('conv.lossy')}`}`;
    b.appendChild(name);
    b.addEventListener('click', () => {
      if (convState.formatId === f.id) return;
      convState.formatId = f.id;
      convState.options = convDefaultOptions(f);
      renderConvertFormats();
      renderConvertParamsAnimated();          
    });
    box.appendChild(b);
  }
}

function setConvertProgress(p, phase) {
  const wrap = $('convProgress');
  wrap.hidden = false;                                  
  if (phase === 'start') {
    $('convBar').style.transform = 'scaleX(0)';
    $('convPercent').textContent = '0%';
    return;
  }
  const percent = Math.round(Math.max(0, Math.min(1, p)) * 100);
  $('convBar').style.transform = `scaleX(${Math.max(0, Math.min(1, percent / 100))})`;
  $('convPercent').textContent = tr('conv.progress', { percent });
}

function openConvertModal(trackId, formatId) {
  const track = state.playlist.find((t) => t.id === trackId);
  if (!track) return;
  convState.trackId = trackId;
  convState.formatId = formatId;
  const fmt = currentConvertFormat();
  convState.options = convDefaultOptions(fmt);

  $('convSrc').textContent = tr('conv.srcHint', { name: track.name || track.path });
  $('convFileName').value = [track.artist, track.title].filter(Boolean).join(' - ') ||
    (track.name || '').replace(/\.[^.]+$/, '');
  $('convDirHint').textContent = `${tr('conv.dir')}：${track.path.replace(/[^\\/]+$/, '')} ${tr('conv.sameDir')}`;
  $('convProgress').hidden = true;
  renderConvertFormats();
  renderConvertParams();

  const mask = $('convertModal');
  openModalExclusive('convertModal', () => {
    mask.hidden = false;
    playModalAnim(mask, 'open');
    $('convFileName').focus({ preventScroll: true });
    $('convFileName').select();
  });
}

function closeConvertModal() {
  const mask = $('convertModal');
  if (mask.hidden) return;
  playModalAnim(mask, 'close');
}

async function startConvert() {
  const btn = $('btnConvertStart');
  if (btn.disabled) return;
  btn.disabled = true;
  $('btnConvertCancel').disabled = false;
  setConvertProgress(0, 'start');
  try {
    const res = await api.convert.start(convState.trackId, convState.formatId, {
      fileName: $('convFileName').value.trim(),
      ...convState.options,
    });
    if (res && res.ok) {
      showToast(tr('conv.done', { name: (res.path || '').split(/[\\/]/).pop() }), 'ok');
      closeConvertModal();
    } else if (res && res.cancelled) {
      showToast(tr('conv.cancelled'), 'ok');
    } else {
      showToast(tr('conv.failed', { msg: (res && res.error) || '?' }), 'err');
    }
  } catch (err) {
    showToast(tr('conv.failed', { msg: String(err.message || err) }), 'err');
  } finally {
    btn.disabled = false;
  }
}

async function bindConvert() {
  try {
    const res = await api.convert.formats();
    CONVERT_FORMATS = (res && res.formats) || [];
  } catch { CONVERT_FORMATS = []; }
  if (!CONVERT_FORMATS.length) return;

  $('btnConvertStart').addEventListener('click', startConvert);
  $('btnConvertCancel').addEventListener('click', () => { api.convert.cancel(); closeConvertModal(); });
  $('btnCloseConvert').addEventListener('click', () => { api.convert.cancel(); closeConvertModal(); });
  $('convertModal').addEventListener('mousedown', (e) => {
    if (e.target === $('convertModal')) { api.convert.cancel(); closeConvertModal(); }
  });
  $('convFileName').addEventListener('keydown', (e) => {
    if (e.code === 'Enter') { e.preventDefault(); startConvert(); }
  });
  api.on('convert:progress', (p) => {
    if (!$('convertModal').hidden) setConvertProgress(p.progress || 0, p.phase);
  });
}


function openPropsModal(trackId) {
  const track = state.playlist.find((t) => t.id === trackId);
  if (!track) return;
  state.propsTrackId = trackId;               
  const grid = $('propsGrid');
  grid.textContent = '';
  const rows = [
    [tr('meta.k.title'), track.title || track.name],
    [tr('meta.k.artist'), track.artist || track.albumArtist],
    [tr('meta.k.album'), track.album],
    [tr('props.fmt'), [track.container, (track.ext || '').toUpperCase()].filter(Boolean).join(' · ')],
    [tr('meta.k.codec'), track.codec ? String(track.codec).toUpperCase() : null],
    [tr('meta.k.rate'), track.sampleRate ? `${track.sampleRate} Hz / ${track.channels} ch` : null],
    [tr('conv.bitrate'), track.bitrate ? `${Math.round(track.bitrate / 1000)} kbps` : null],
    [tr('meta.k.duration'), track.duration ? fmtTime(track.duration) : null],
    [tr('props.size'), track.size ? fmtSize(track.size) : null],
    [tr('props.modified'), track.mtime ? new Date(track.mtime).toLocaleString() : null],
    [tr('props.path'), track.path],
  ];
  for (const [k, v] of rows) {
    if (!v) continue;
    const row = document.createElement('div');
    row.className = 'meta-row wide';
    const kk = document.createElement('span');
    kk.className = 'k';
    kk.textContent = k;
    const vv = document.createElement('span');
    vv.className = 'v';
    vv.textContent = v;
    
    row.append(kk, vv);
    grid.appendChild(row);
  }
  $('btnPropsReveal').onclick = () => api.showItem(track.path);
  const mask = $('propsModal');
  openModalExclusive('propsModal', () => {
    mask.hidden = false;
    playModalAnim(mask, 'open');
    $('btnPropsClose').focus({ preventScroll: true });
  });
}

function closePropsModal() {
  const mask = $('propsModal');
  if (mask.hidden) return;
  playModalAnim(mask, 'close');
}

function bindProps() {
  $('btnCloseProps').addEventListener('click', closePropsModal);
  $('btnPropsClose').addEventListener('click', closePropsModal);
  $('propsModal').addEventListener('mousedown', (e) => {
    if (e.target === $('propsModal')) closePropsModal();
  });
}





let tipEl = null;
let tipTarget = null;
let tipFadeTimer = null;

function tipPosition(target) {
  const tip = tipEl;
  const r = target.getBoundingClientRect();
  tip.hidden = false;
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  
  let left = r.left + r.width / 2 - w / 2;
  left = Math.max(6, Math.min(left, window.innerWidth - w - 6));
  let top = r.bottom + 8;
  if (top + h > window.innerHeight - 6) top = Math.max(6, r.top - h - 8);
  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(top)}px`;
}

function tipShow(target) {
  const text = target.dataset.tip || '';
  if (!text || !tipEl) return;
  tipTarget = target;
  tipEl.textContent = text;
  clearTimeout(tipFadeTimer);
  tipEl.hidden = false;
  tipPosition(target);
  
  tipEl.classList.remove('is-out');
  tipEl.classList.add('is-in');
}

function tipHide() {
  if (!tipEl || tipEl.hidden) return;
  
  tipEl.classList.add('is-out');
  clearTimeout(tipFadeTimer);
  tipFadeTimer = setTimeout(() => {
    tipEl.hidden = true;
    tipEl.classList.remove('is-out', 'is-in');
  }, 130);
  
  if (tipTarget && !tipTarget.hasAttribute('title') && tipTarget.dataset.tip) {
    tipTarget.setAttribute('title', tipTarget.dataset.tip);
  }
  tipTarget = null;
}


function tipAdopt(el) {
  if (el.hasAttribute('title')) {
    const t = el.getAttribute('title');
    if (t) el.dataset.tip = t;
    el.removeAttribute('title');
  }
  return el.dataset.tip || '';
}

function bindTooltips() {
  tipEl = $('appTip');
  if (!tipEl) return;
  document.addEventListener('mouseover', (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    const el = t.closest('[title], [data-tip]');
    if (!el) return tipHide();
    if (el === tipTarget) return;
    tipAdopt(el);
    tipShow(el);
  });
  document.addEventListener('mouseout', (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    const el = t.closest('[title], [data-tip]');
    if (el && el === tipTarget) tipHide();
  });
  
  for (const ev of ['mousedown', 'wheel', 'blur', 'resize']) window.addEventListener(ev, tipHide, true);
  document.addEventListener('scroll', tipHide, true);
  window.addEventListener('keydown', tipHide);
}



let sideState = { which: 'info', lines: [], synced: false, activeIndex: -1, trackId: null,
  raw: '', rawFile: '', rawSource: 'none', renderedFor: null };
let sideSwapTimer = null;


const SIDE_FADE_MS = 160;      

function setSidePanel(which, { persist = true } = {}) {
  const next = which === 'none' ? 'none' : (which === 'lyrics' ? 'lyrics' : 'info');
  const panel = document.querySelector('.side-panel');
  
  const apply = () => {
    $('metaPanel').hidden = next !== 'info';
    $('lyricsPanel').hidden = next !== 'lyrics';
    panel.classList.remove('is-swapping');       
  };
  
  sideState.which = next;
  $('btnLyrics').classList.toggle('is-on', next === 'lyrics');
  $('btnInfo').classList.toggle('is-on', next === 'info');

  
  
  clearTimeout(sideSwapTimer);
  panel.classList.add('is-swapping');
  sideSwapTimer = setTimeout(apply, SIDE_FADE_MS + 10);

  if (next === 'lyrics') {
    
    setTimeout(() => { renderLyrics(sideState.trackId || state.currentId || null).catch(() => {}); }, 0);
  }
  if (persist) {
    
    try { api.settings.set({ sidePanel: next }); } catch {  }
  }
}

function renderLyricsEmpty(hintKey) {
  const body = $('lyricsBody');
  body.textContent = '';
  body.classList.remove('is-plain');
  body.appendChild(lyricsSpacer('top'));
  const line = document.createElement('div');
  line.className = 'meta-empty';
  line.textContent = tr('lyrics.empty');
  const hint = document.createElement('div');
  hint.className = 'lyrics-note';
  hint.textContent = tr(hintKey || 'lyrics.emptyHint');
  body.append(line, hint);
  body.appendChild(lyricsSpacer('bottom'));
  layoutLyricsSpacers();
  $('lyricsSource').textContent = '';
  sideState.lines = [];
  sideState.activeIndex = -1;
  sideState.raw = '';                 
  sideState.rawFile = '';
  sideState.rawSource = 'none';
}


function lyricsSpacer(kind) {
  const pad = document.createElement('div');
  pad.className = 'lyrics-pad';
  pad.dataset.pad = kind;
  return pad;
}

function layoutLyricsSpacers() {
  const body = $('lyricsBody');
  if (!body) return;
  const half = Math.max(0, Math.round(body.clientHeight / 2));
  for (const pad of body.querySelectorAll('.lyrics-pad')) pad.style.height = `${half}px`;
}

function paintLyricsHighlight() {
  const body = $('lyricsBody');
  const lines = [...body.querySelectorAll('.lyric-line')];
  lines.forEach((el, i) => el.classList.toggle('is-active', i === sideState.activeIndex));
  const active = lines[sideState.activeIndex];
  
  if (!sideState.synced || $('lyricsPanel').hidden) return;
  if (!active) {
    
    
    body.scrollTop = 0;
    return;
  }
  const target = active.offsetTop - body.clientHeight / 2 + active.offsetHeight / 2;
  body.scrollTop = Math.max(0, target);
}

async function renderLyrics(trackId) {
  const body = $('lyricsBody');
  if (trackId === sideState.trackId && sideState.renderedFor === trackId) return;   
  sideState.trackId = trackId || null;
  sideState.renderedFor = trackId || null;
  if (!trackId) return renderLyricsEmpty();
  let res = null;
  try {
    res = await api.lyrics.get(trackId);
  } catch {  }

  if (!res || !res.found || !res.lines || !res.lines.length) return renderLyricsEmpty();

  sideState.lines = res.lines;
  sideState.synced = !!res.synced;
  sideState.activeIndex = -1;
  try { body.scrollTop = 0; } catch {  }   
  
  sideState.raw = res.raw || '';
  sideState.rawFile = res.file || '';
  sideState.rawSource = res.source || 'none';

  
  const fileName = res.file ? res.file.split(/[\\/]/).pop() : '';
  $('lyricsSource').textContent = res.source === 'metadata'
    ? tr('lyrics.fromMetadata')
    : (res.source === 'picked' ? `${tr('lyrics.picked')} · ${fileName}` : tr('lyrics.fromFile', { name: fileName }));
  $('lyricsSource').removeAttribute('title');   

  body.textContent = '';
  body.classList.toggle('is-plain', !res.synced);
  body.appendChild(lyricsSpacer('top'));            
  if (!res.synced) {
    const note = document.createElement('div');
    note.className = 'lyrics-note';
    note.textContent = tr('lyrics.unsynced');
    body.appendChild(note);
  }
  for (const line of res.lines) {
    const div = document.createElement('div');
    div.className = 'lyric-line';
    div.textContent = line.text || '♪';
    body.appendChild(div);
  }
  body.appendChild(lyricsSpacer('bottom'));         
  layoutLyricsSpacers();
  
  updateLyricsProgress(state.playerState.position || 0);
}


function updateLyricsProgress(positionSec) {
  if (sideState.which !== 'lyrics' || !sideState.lines.length) return;
  if (!sideState.synced) return;
  
  const pos = positionSec - (Number(state.settings && state.settings.lyricsOffsetMs) || 0) / 1000;
  let idx = -1;
  for (let i = 0; i < sideState.lines.length; i++) {
    const t = sideState.lines[i].time;
    if (t === null || t > pos + 1e-3) break;
    idx = i;
  }
  
  
  
  if (idx === sideState.activeIndex && idx !== -1) return;
  sideState.activeIndex = idx;
  paintLyricsHighlight();
}


function renderLyricsOffset() {
  const ms = Number(state.settings && state.settings.lyricsOffsetMs) || 0;
  const el = $('lyricsOffsetVal');
  if (el) el.textContent = `${ms >= 0 ? '+' : '-'}${(Math.abs(ms) / 1000).toFixed(1)} s`;
  const box = $('lyricsOffset');
  if (box) box.dataset.offset = String(ms);
}


function setLyricsOffset(ms) {
  const next = Math.max(-30000, Math.min(30000, Math.round(Number(ms) || 0)));
  if (!state.settings) state.settings = {};
  state.settings.lyricsOffsetMs = next;
  renderLyricsOffset();
  sideState.activeIndex = -1;                     
  try { updateLyricsProgress(state.playerState.position || 0); } catch {  }
  updateLyricsExclusiveProgress(state.playerState.position || 0);   
  try { api.settings.set({ lyricsOffsetMs: next }); } catch {  }
}

function bindLyricsOffset() {
  const box = $('lyricsOffset');
  if (!box) return;
  for (const btn of box.querySelectorAll('.lyr-off')) {
    btn.addEventListener('click', () => {
      setLyricsOffset((Number(state.settings && state.settings.lyricsOffsetMs) || 0) + Number(btn.dataset.step));
    });
  }
  const reset = $('lyricsOffsetReset');
  if (reset) reset.addEventListener('click', () => setLyricsOffset(0));
  
  const toggle = $('btnLyricsBar');
  if (toggle) {
    toggle.addEventListener('click', () => {
      const open = !box.classList.contains('is-open');
      box.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', String(open));
    });
  }
  renderLyricsOffset();
}





const lxState = {
  open: false,
  trackId: null,
  metaTrackId: null,
  renderedFor: null,
  lines: [],
  synced: false,
  activeIndex: -1,
  paintedOnce: false,
  coverToken: 0,
};

function lxFindTrack() {
  return state.playlist.find((t) => t.id === state.currentId) || null;
}


function lxArtistLine(track) {
  if (!track) return '';
  return [track.artist, track.album].filter(Boolean).join(' - ');
}


function updateLyricsExclusiveTime(positionSec) {
  const el = $('lxTime');
  if (!el) return;
  const total = state.playerState.duration || 0;
  const pos = Number.isFinite(positionSec) ? positionSec : (state.playerState.position || 0);
  el.textContent = `${fmtTime(Math.max(0, pos))}/${fmtTime(total)}`;
  updateLyricsExclusiveBar(pos);
  if (lxControlsShown) {
    syncLyricsExclusiveControls();   
    syncLyricsExclusiveVolume();     
  }
}


function updateLyricsExclusiveBar(positionSec) {
  const fill = $('lxProgressFill');
  if (!fill) return;
  const total = state.playerState.duration || 0;
  const pos = Number.isFinite(positionSec) ? positionSec : (state.playerState.position || 0);
  const ratio = total > 0 ? Math.max(0, Math.min(1, pos / total)) : 0;
  fill.style.transform = `scaleX(${ratio.toFixed(4)})`;
  const head = $('lxProgressHead');
  if (head) head.style.left = `${(ratio * 100).toFixed(3)}%`;
  const bar = $('lxProgress');
  if (bar) bar.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
}


let lxSeeking = false;

function lxBarRatioAt(e) {
  const zone = $('lxProgressZone');
  if (!zone) return 0;
  const r = zone.getBoundingClientRect();
  if (!r.width) return 0;
  return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
}


function showLyricsExclusiveBarBubble(e) {
  const zone = $('lxProgressZone');
  const bubble = $('lxProgressTime');
  if (!zone || !bubble) return;
  const total = state.playerState.duration || 0;
  const ratio = lxBarRatioAt(e);
  const sec = ratio * total;
  bubble.hidden = false;
  bubble.textContent = `${fmtTime(Math.max(0, sec))}/${fmtTime(total)}`;
  bubble.style.left = `${(ratio * 100).toFixed(3)}%`;
  zone.classList.add('is-hover');
  return sec;
}

function hideLyricsExclusiveBarBubble() {
  const zone = $('lxProgressZone');
  const bubble = $('lxProgressTime');
  if (bubble) bubble.hidden = true;
  if (zone) zone.classList.remove('is-hover', 'is-dragging');
}


function previewLyricsExclusiveSeek(sec) {
  const total = state.playerState.duration || 0;
  const ratio = total > 0 ? Math.max(0, Math.min(1, sec / total)) : 0;
  const fill = $('lxProgressFill');
  if (fill) fill.style.transform = `scaleX(${ratio.toFixed(4)})`;
  const head = $('lxProgressHead');
  if (head) head.style.left = `${(ratio * 100).toFixed(3)}%`;
  const el = $('lxTime');
  if (el) el.textContent = `${fmtTime(Math.max(0, sec))}/${fmtTime(total)}`;
  if (lxState.synced && lxState.lines.length) {
    const idx = lyricsExclusiveIndexAt(sec);
    if (idx !== lxState.activeIndex) {
      lxState.activeIndex = idx;
      paintLyricsExclusiveHighlight(false);
    }
  }
}

function bindLyricsExclusiveProgressBar() {
  const zone = $('lxProgressZone');
  if (!zone) return;
  bindPointerDrag(zone, {
    onStart: (e) => {
      if (!lxState.open || !state.currentId) return;
      lxSeeking = true;
      zone.classList.add('is-dragging');
      const sec = showLyricsExclusiveBarBubble(e);
      previewLyricsExclusiveSeek(sec || 0);
    },
    onMove: (e) => {
      if (!lxSeeking) return;
      const sec = showLyricsExclusiveBarBubble(e);
      previewLyricsExclusiveSeek(sec || 0);
    },
    onEnd: async (e) => {
      if (!lxSeeking) return;
      lxSeeking = false;
      zone.classList.remove('is-dragging');
      const total = state.playerState.duration || 0;
      const target = e && typeof e.clientX === 'number'
        ? lxBarRatioAt(e) * total
        : (state.playerState.position || 0);
      if (state.currentId) {
        try { applyPlayerState(await api.player.seek(target)); } catch {  }
        updateLyricsExclusiveProgress(target);
      }
      
      if (e && typeof e.clientY === 'number') {
        const overZone = lxPointIn(zone, e);
        if (overZone) showLyricsExclusiveBarBubble(e);
        else hideLyricsExclusiveBarBubble();
      } else {
        hideLyricsExclusiveBarBubble();
      }
    },
  });
}


function layoutLyricsExclusiveArtist() {
  const box = $('lxArtist');
  const text = $('lxArtistText');
  if (!box || !text) return;
  box.classList.remove('is-marquee');
  box.style.removeProperty('--lx-marquee-dist');
  box.style.removeProperty('--lx-marquee-dur');
  const overflow = Math.round(text.scrollWidth - box.clientWidth);
  if (overflow <= 2) return;
  const dist = overflow + 12;
  const dur = Math.max(4, Math.min(30, Math.round((dist + 36) / 26)));
  box.style.setProperty('--lx-marquee-dist', `${dist}px`);
  box.style.setProperty('--lx-marquee-dur', `${dur}s`);
  box.classList.add('is-marquee');
}

function lxCoverPlaceholder() {
  const img = $('lxCoverImg');
  const ph = $('lxCoverPlaceholder');
  if (img) { img.hidden = true; img.removeAttribute('src'); }
  if (ph) ph.hidden = false;
}

async function loadLyricsExclusiveCover(track) {
  const img = $('lxCoverImg');
  const ph = $('lxCoverPlaceholder');
  if (!img) return;
  const token = ++lxState.coverToken;
  if (!track) return lxCoverPlaceholder();
  try {
    const res = await api.cover.get(track.id);
    if (token !== lxState.coverToken) return;      
    if (res && res.dataUrl) {
      img.onerror = () => { if (token === lxState.coverToken) lxCoverPlaceholder(); };
      img.src = res.dataUrl;
      img.hidden = false;
      if (ph) ph.hidden = true;
      return;
    }
  } catch {  }
  if (token === lxState.coverToken) lxCoverPlaceholder();
}

function lxSpacer(kind) {
  const el = document.createElement('div');
  el.className = 'lx-pad';
  el.dataset.pad = kind;
  return el;
}


function layoutLyricsExclusiveSpacers() {
  const box = $('lxLyrics');
  if (!box) return;
  const half = Math.max(0, Math.round(box.clientHeight / 2));
  for (const pad of box.querySelectorAll('.lx-pad')) pad.style.height = `${half}px`;
}

function renderLyricsExclusiveEmpty() {
  const box = $('lxLyrics');
  if (!box) return;
  box.textContent = '';
  box.classList.remove('is-plain');
  box.appendChild(lxSpacer('top'));
  const line = document.createElement('div');
  line.className = 'lx-note';
  line.textContent = tr('lyrics.empty');
  const hint = document.createElement('div');
  hint.className = 'lx-note';
  hint.textContent = tr('lyrics.emptyHint');
  box.append(line, hint);
  box.appendChild(lxSpacer('bottom'));
  lxState.lines = [];
  lxState.synced = false;
  lxState.activeIndex = -1;
  lxState.renderedFor = null;
  layoutLyricsExclusiveSpacers();
}

async function renderLyricsExclusive(trackId) {
  const box = $('lxLyrics');
  if (!box) return;
  
  if (trackId && trackId === lxState.renderedFor) {
    layoutLyricsExclusiveSpacers();
    updateLyricsExclusiveProgress(state.playerState.position || 0);
    return;
  }
  lxState.trackId = trackId || null;
  lxState.renderedFor = trackId || null;
  if (!trackId) return renderLyricsExclusiveEmpty();
  let res = null;
  try { res = await api.lyrics.get(trackId); } catch {  }
  if (lxState.renderedFor !== (trackId || null)) return;      
  if (!res || !res.found || !res.lines || !res.lines.length) return renderLyricsExclusiveEmpty();

  lxState.lines = res.lines;
  lxState.synced = !!res.synced;
  lxState.activeIndex = -1;
  box.textContent = '';
  box.classList.toggle('is-plain', !res.synced);
  box.appendChild(lxSpacer('top'));
  if (!res.synced) {
    const note = document.createElement('div');
    note.className = 'lx-note';
    note.textContent = tr('lyrics.unsynced');
    box.appendChild(note);
  }
  for (const line of res.lines) {
    const div = document.createElement('div');
    div.className = 'lx-line';
    div.textContent = line.text || '♪';
    box.appendChild(div);
  }
  box.appendChild(lxSpacer('bottom'));
  layoutLyricsExclusiveSpacers();
  
  box.classList.remove('is-enter');
  void box.offsetWidth;                 
  box.classList.add('is-enter');
  lxState.paintedOnce = false;          
  try { box.scrollTop = 0; } catch {  }   
  
  updateLyricsExclusiveProgress(state.playerState.position || 0);
}


function paintLyricsExclusiveHighlight(smooth) {
  const box = $('lxLyrics');
  if (!box) return;
  const lines = [...box.querySelectorAll('.lx-line')];
  lines.forEach((el, i) => el.classList.toggle('is-active', i === lxState.activeIndex));
  const active = lines[lxState.activeIndex];
  if (!active) {
    
    try { box.scrollTo({ top: 0, behavior: 'auto' }); } catch { box.scrollTop = 0; }
    return;
  }
  const target = Math.max(0, active.offsetTop - box.clientHeight / 2 + active.offsetHeight / 2);
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const behavior = smooth && !reduce ? 'smooth' : 'auto';
  try {
    if (typeof box.scrollTo === 'function') box.scrollTo({ top: target, behavior });
    else box.scrollTop = target;
  } catch { box.scrollTop = target; }
}


function lyricsExclusiveIndexAt(positionSec) {
  const pos = positionSec - (Number(state.settings && state.settings.lyricsOffsetMs) || 0) / 1000;
  let idx = -1;
  for (let i = 0; i < lxState.lines.length; i++) {
    const t = lxState.lines[i].time;
    if (t === null || t > pos + 1e-3) break;
    idx = i;
  }
  return idx;
}


function updateLyricsExclusiveProgress(positionSec) {
  if (!lxState.open || lxSeeking) return;
  updateLyricsExclusiveTime(positionSec);
  if (!lxState.lines.length || !lxState.synced) return;
  const idx = lyricsExclusiveIndexAt(positionSec);
  
  if (idx === lxState.activeIndex && idx !== -1) return;
  lxState.activeIndex = idx;
  const smooth = lxState.paintedOnce === true;   
  lxState.paintedOnce = true;
  paintLyricsExclusiveHighlight(smooth);
}


function resetLyricsExclusive() {
  lxState.trackId = null;
  lxState.metaTrackId = null;
  lxState.renderedFor = null;
  lxState.lines = [];
  lxState.synced = false;
  lxState.activeIndex = -1;
  lxState.paintedOnce = false;
  lxState.coverToken += 1;                 
  lxSeeking = false;
  hideLyricsExclusiveBarBubble();          
  lxCoverPlaceholder();
  const artist = $('lxArtist');
  if (artist) {
    artist.classList.remove('is-marquee');
    artist.style.removeProperty('--lx-marquee-dist');
    artist.style.removeProperty('--lx-marquee-dur');
  }
  const artistText = $('lxArtistText');
  if (artistText) artistText.textContent = '';
  if ($('lxTitle')) $('lxTitle').textContent = tr('np.idle');
  const box = $('lxLyrics');
  if (box) {
    box.textContent = '';
    box.classList.remove('is-enter', 'is-plain');
    box.appendChild(lxSpacer('top'));
    const note = document.createElement('div');
    note.className = 'lx-note';
    note.textContent = tr('np.hint');
    box.appendChild(note);
    box.appendChild(lxSpacer('bottom'));
    try { box.scrollTo({ top: 0, behavior: 'auto' }); } catch { box.scrollTop = 0; }
    layoutLyricsExclusiveSpacers();
  }
  if ($('lxTime')) $('lxTime').textContent = '00:00/00:00';
  const fill = $('lxProgressFill');
  if (fill) fill.style.transform = 'scaleX(0)';
  const bar = $('lxProgress');
  if (bar) bar.setAttribute('aria-valuenow', '0');
  
  if (lxControlsShown) {
    syncLyricsExclusiveControls();
    syncLyricsExclusiveVolume();
  }
}


function syncLyricsExclusiveMeta(track) {
  if (!lxState.open) return;
  const trackId = track ? track.id : null;
  if (!trackId) {
    
    resetLyricsExclusive();
    return;
  }
  const changed = trackId !== lxState.metaTrackId;
  lxState.metaTrackId = trackId;
  $('lxTitle').textContent = track ? (track.title || track.name) : tr('np.idle');
  const artistText = track ? lxArtistLine(track) : tr('np.hint');
  const artistEl = $('lxArtistText');
  if (artistEl) artistEl.textContent = artistText;
  else $('lxArtist').textContent = artistText;
  layoutLyricsExclusiveArtist();
  updateLyricsExclusiveTime();
  if (!changed) return;
  loadLyricsExclusiveCover(track);
  renderLyricsExclusive(trackId);
}

function setLyricsExclusive(open) {
  const next = !!open;
  if (next === lxState.open) return;
  lxState.open = next;
  document.body.classList.toggle('lyrics-exclusive', next);
  const sec = $('lyricsExclusive');
  if (sec) sec.setAttribute('aria-hidden', String(!next));
  const btn = $('btnLyricsFull');
  if (btn) {
    btn.classList.toggle('is-on', next);
    btn.setAttribute('aria-pressed', String(next));
  }
  if (next) {
    
    syncLyricsExclusiveMeta(lxFindTrack());
    layoutLyricsExclusiveSpacers();               
    lxState.activeIndex = -1;
    lxState.paintedOnce = false;                  
    updateLyricsExclusiveProgress(state.playerState.position || 0);
    hideLyricsExclusiveControls();                
    syncLyricsExclusiveControls();
    syncLyricsExclusiveVolume();
    lxSeeking = false;
    hideLyricsExclusiveBarBubble();               
  } else {
    lxState.renderedFor = null;
    lxState.metaTrackId = null;
    hideLyricsExclusiveControls();                
    lxSeeking = false;
    hideLyricsExclusiveBarBubble();
  }
}






let lxControlsShown = false;

function lxPointIn(el, e) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
}


function lxControlsHit(e) {
  const ctl = $('lxControls');
  const bandH = Math.max(40, (ctl && ctl.offsetHeight) || 64);
  const distance = window.innerHeight - e.clientY;
  if (distance >= 0 && distance <= bandH + 2) return true;
  return lxControlsShown && lxPointIn(ctl, e);
}


function syncLyricsExclusiveControls() {
  const play = $('lxCtrlPlay');
  if (play && $('btnPlay')) play.textContent = $('btnPlay').textContent;
  const rep = $('lxCtrlRepeat');
  const mainRep = $('btnRepeat');
  if (rep && mainRep) {
    if (!rep.dataset.filled) {                   
      rep.innerHTML = mainRep.innerHTML;
      rep.dataset.filled = '1';
    }
    if (mainRep.dataset.mode) rep.dataset.mode = mainRep.dataset.mode;
    else rep.removeAttribute('data-mode');
  }
}


function syncLyricsExclusiveVolume() {
  const icon = $('lxVolIcon');
  const slider = $('lxVolume');
  const num = $('lxVolNum');
  const box = $('lxVolumeBox');
  const muted = !!state.settings.muted;
  const vol = Number(state.settings.volume ?? 0.8);
  if (icon) {
    icon.dataset.level = volumeLevel(vol, muted);
    icon.setAttribute('aria-pressed', muted ? 'true' : 'false');
  }
  if (slider && document.activeElement !== slider) slider.value = String(Math.round(vol * 100));
  if (slider) syncRangeFill(slider);
  if (num) num.textContent = muted ? tr('vol.muted') : String(Math.round(vol * 100));
  if (box) box.classList.toggle('is-muted', muted);
}

function showLyricsExclusiveControls() {
  const sec = $('lyricsExclusive');
  const ctl = $('lxControls');
  if (!sec || !ctl || lxControlsShown) return;
  lxControlsShown = true;
  syncLyricsExclusiveControls();
  syncLyricsExclusiveVolume();
  
  
  const rise = Math.max(40, ctl.offsetHeight - 14 + 6);
  sec.style.setProperty('--lx-controls-rise', `${Math.round(rise)}px`);
  sec.style.setProperty('--lx-controls-top', `${Math.round(ctl.offsetHeight)}px`);   
  sec.classList.add('controls-open');
  ctl.setAttribute('aria-hidden', 'false');
}

function hideLyricsExclusiveControls() {
  const sec = $('lyricsExclusive');
  const ctl = $('lxControls');
  if (sec) sec.classList.remove('controls-open');
  if (ctl) ctl.setAttribute('aria-hidden', 'true');
  lxControlsShown = false;
}


function onLyricsExclusivePointerMove(e) {
  if (!lxState.open) return;
  if (lxControlsHit(e)) {
    if (!lxControlsShown) showLyricsExclusiveControls();
  } else if (lxControlsShown) {
    hideLyricsExclusiveControls();
  }
  
  if (!lxSeeking) {
    const zone = $('lxProgressZone');
    if (zone && lxPointIn(zone, e)) showLyricsExclusiveBarBubble(e);
    else hideLyricsExclusiveBarBubble();
  }
}

function toggleLyricsExclusive() {
  setLyricsExclusive(!lxState.open);
}

function bindLyricsExclusive() {
  const btn = $('btnLyricsFull');
  if (btn) btn.addEventListener('click', toggleLyricsExclusive);
  
  const wire = (id, targetId) => {
    const el = $(id);
    if (el) el.addEventListener('click', () => { const target = $(targetId); if (target) target.click(); });
  };
  wire('lxCtrlPrev', 'btnPrev');
  wire('lxCtrlPlay', 'btnPlay');
  wire('lxCtrlStop', 'btnStop');
  wire('lxCtrlNext', 'btnNext');
  wire('lxCtrlRepeat', 'btnRepeat');
  const repeat = $('lxCtrlRepeat');
  if (repeat) repeat.addEventListener('click', syncLyricsExclusiveControls);
  
  const lxVolIcon = $('lxVolIcon');
  if (lxVolIcon) {
    lxVolIcon.addEventListener('click', () => {
      const main = $('volIcon');
      if (main) main.click();
      syncLyricsExclusiveVolume();
    });
  }
  const lxVol = $('lxVolume');
  if (lxVol) {
    lxVol.addEventListener('input', () => {
      const main = $('volume');
      if (!main) return;
      main.value = lxVol.value;
      main.dispatchEvent(new Event('input', { bubbles: true }));
      syncLyricsExclusiveVolume();
    });
    const lxVolBox = $('lxVolumeBox');
    if (lxVolBox) {
      lxVolBox.addEventListener('wheel', (e) => {
        e.preventDefault();
        const main = $('volume');
        if (!main) return;
        const cur = Number(main.value);
        const next = Math.max(0, Math.min(100, cur + (e.deltaY < 0 ? VOLUME_STEP : -VOLUME_STEP)));
        if (next === cur) return;
        main.value = String(next);
        main.dispatchEvent(new Event('input', { bubbles: true }));
        syncLyricsExclusiveVolume();
      }, { passive: false });
    }
  }
  syncLyricsExclusiveVolume();
  bindLyricsExclusiveProgressBar();             
  
  document.addEventListener('pointermove', onLyricsExclusivePointerMove, { passive: true });
  const sec = $('lyricsExclusive');
  if (sec) {
    sec.addEventListener('pointerleave', () => {
      if (lxControlsShown) hideLyricsExclusiveControls();
    });
  }
  
  window.addEventListener('resize', () => {
    if (!lxState.open) return;
    layoutLyricsExclusiveSpacers();
    layoutLyricsExclusiveArtist();
    paintLyricsExclusiveHighlight(false);
    if (lxControlsShown) {
      const ctl = $('lxControls');
      if (ctl) sec.style.setProperty('--lx-controls-rise', `${Math.round(Math.max(40, ctl.offsetHeight - 14 + 6))}px`);
    if (ctl) sec.style.setProperty('--lx-controls-top', `${Math.round(ctl.offsetHeight)}px`);
    }
  });
}




const lyricsEdit = { trackId: null, file: '', source: 'none', history: [], index: -1, timer: null };

function lyricsEditPush(text) {
  const h = lyricsEdit.history;
  if (h[lyricsEdit.index] === text) return;
  h.splice(lyricsEdit.index + 1);            
  h.push(text);
  if (h.length > 60) h.shift();              
  lyricsEdit.index = h.length - 1;
  renderLyricsEditButtons();
}

function renderLyricsEditButtons() {
  const undo = $('btnLyricsUndo');
  const redo = $('btnLyricsRedo');
  if (undo) undo.disabled = lyricsEdit.index <= 0;
  if (redo) redo.disabled = lyricsEdit.index >= lyricsEdit.history.length - 1;
  const hint = $('lyricsEditHint');
  if (hint) {
    const name = lyricsEdit.file ? lyricsEdit.file.split(/[\\/]/).pop() : tr('lyricsEdit.noFile');
    const from = lyricsEdit.source === 'metadata' ? tr('lyricsEdit.fromMetadata') : '';
    
    hint.textContent = `${from}${name}${lyricsEdit.file ? ` — ${lyricsEdit.file}` : ''}`.trim();
  }
}

function applyLyricsEditText(text) {
  const box = $('lyricsEditText');
  if (box) box.value = text;
  renderLyricsEditButtons();
}

function lyricsEditUndo() {
  if (lyricsEdit.index <= 0) return;
  lyricsEdit.index--;
  applyLyricsEditText(lyricsEdit.history[lyricsEdit.index]);
}

function lyricsEditRedo() {
  if (lyricsEdit.index >= lyricsEdit.history.length - 1) return;
  lyricsEdit.index++;
  applyLyricsEditText(lyricsEdit.history[lyricsEdit.index]);
}

async function openLyricsEditor() {
  const trackId = sideState.trackId || state.currentId;
  if (!trackId) {
    showToast(tr('lyricsEdit.noTrack'), 'err', { corner: true });
    return;
  }
  lyricsEdit.trackId = trackId;
  lyricsEdit.history = [];
  lyricsEdit.index = -1;
  
  let text = sideState.raw || '';
  let file = sideState.rawFile || '';
  let source = sideState.rawSource || 'none';
  if (!text) {
    try {
      const res = await api.lyrics.read(trackId);
      if (res && res.ok) { text = res.text || ''; file = res.file || ''; source = res.source || 'none'; }
    } catch {  }
  }
  lyricsEdit.file = file;
  lyricsEdit.source = source;
  const box = $('lyricsEditText');
  if (box) box.value = text;
  
  
  $('lyricsEditPath').textContent = file ? file.split(/[\\/]/).pop() : '';
  $('lyricsEditPath').removeAttribute('title');
  lyricsEditPush(text);
  openModalExclusive('lyricsEditModal', () => {
    $('lyricsEditModal').hidden = false;
    playModalAnim($('lyricsEditModal'), 'open');
    if (box) { box.focus(); box.setSelectionRange(text.length, text.length); }
  });
}

function closeLyricsEditor() {
  clearTimeout(lyricsEdit.timer);
  openModalExclusive('lyricsEditModal', () => {
    playModalAnim($('lyricsEditModal'), 'close');     
  });
}

async function saveLyricsEdit() {
  const trackId = lyricsEdit.trackId || sideState.trackId || state.currentId;
  const text = $('lyricsEditText').value;
  if (!trackId) return showToast(tr('lyricsEdit.failed', { msg: tr('lyricsEdit.noTrack') }), 'err', { corner: true });
  let res = null;
  try {
    res = await api.lyrics.save(trackId, text);
  } catch (err) {
    res = { ok: false, error: String(err && err.message ? err.message : err) };
  }
  if (!res || !res.ok) {
    
    showToast(tr('lyricsEdit.failed', { msg: (res && res.error) || tr('lyricsEdit.unknownError') }), 'err', { corner: true });
    return;
  }
  lyricsEdit.file = res.file || lyricsEdit.file;
  
  sideState.renderedFor = null;
  sideState.raw = null;
  sideState.trackId = trackId;
  await renderLyrics(trackId).catch(() => {});
  showToast(tr('lyricsEdit.saved', { name: (lyricsEdit.file || '').split(/[\\/]/).pop() }), 'ok', { corner: true });
  renderLyricsEditButtons();
}

function bindLyricsEdit() {
  const edit = $('btnLyricsEdit');
  if (edit) edit.addEventListener('click', () => { openLyricsEditor().catch(() => {}); });
  const close = $('btnCloseLyricsEdit');
  if (close) close.addEventListener('click', closeLyricsEditor);
  const mask = $('lyricsEditModal');
  if (mask) mask.addEventListener('mousedown', (e) => { if (e.target === mask) closeLyricsEditor(); });
  $('btnLyricsUndo').addEventListener('click', lyricsEditUndo);
  $('btnLyricsRedo').addEventListener('click', lyricsEditRedo);
  $('btnLyricsSave').addEventListener('click', () => { saveLyricsEdit().catch(() => {}); });
  const box = $('lyricsEditText');
  
  box.addEventListener('input', () => {
    clearTimeout(lyricsEdit.timer);
    lyricsEdit.timer = setTimeout(() => lyricsEditPush(box.value), 400);
  });
  box.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ' && !e.shiftKey) { e.preventDefault(); lyricsEditUndo(); }
    if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyY' || (e.code === 'KeyZ' && e.shiftKey))) { e.preventDefault(); lyricsEditRedo(); }
  });
  renderLyricsEditButtons();
}

function bindSidePanel() {
  
  $('btnLyrics').addEventListener('click', () => {
    if (sideState.which === 'lyrics') return;
    setSidePanel('lyrics');
  });
  $('btnInfo').addEventListener('click', () => {
    if (sideState.which === 'info') return;
    setSidePanel('info');
  });
  
  setSidePanel('lyrics', { persist: false });
  
  window.addEventListener('resize', layoutLyricsSpacers);
}


function bindLyricsPick() {
  $('btnLyricsPick').addEventListener('click', async () => {
    const trackId = state.propsTrackId;
    if (!trackId) return;
    try {
      const res = await api.lyrics.pick(trackId);
      if (res && res.canceled) return;
      if (!res || !res.ok) {
        showToast(tr('lyrics.fail'), 'err');
        return;
      }
      showToast(tr('lyrics.pickedToast', { name: (res.file || '').split(/[\\/]/).pop() }), 'ok');
      if (sideState.which !== 'lyrics') setSidePanel('lyrics');
      else await renderLyrics(trackId);
    } catch (err) {
      showToast(tr('lyrics.fail'), 'err');
    }
  });
  $('btnLyricsForget').addEventListener('click', async () => {
    const trackId = state.propsTrackId;
    if (!trackId) return;
    await api.lyrics.forget(trackId).catch(() => {});
    await renderLyrics(trackId);
  });
}








const TOAST_MS = 2600;
function showToast(text, kind = 'info', { corner = false } = {}) {
  
  
  
  const wrap = corner ? document.body : $('toastWrap');
  if (!wrap || !text) return;
  const el = document.createElement('div');
  el.className = `toast ${kind}${corner ? ' toast-corner' : ''}`;
  el.textContent = text;
  wrap.appendChild(el);
  void el.offsetWidth;
  if (!corner) el.classList.add('anim-in');       
  
  
  setTimeout(() => el.classList.remove('anim-in'), 320);
  setTimeout(() => {
    el.classList.remove('anim-in');
    el.classList.add('anim-out');
    setTimeout(() => el.remove(), 220);
  }, TOAST_MS);
  
  const sel = corner ? '.toast.toast-corner' : '.toast:not(.toast-corner)';
  while (wrap.querySelectorAll(sel).length > 3) {
    const first = wrap.querySelector(sel);
    if (first === el) break;
    first.remove();
  }
  return el;
}


const BROWSER_DRAG_MIME = 'application/x-irix-path';

async function addPathsToPlaylist(paths) {
  const list = (paths || []).filter(Boolean);
  if (!list.length) return null;
  setScanHint(tr('msg.importing', { n: list.length }));
  try {
    const res = await api.playlist.add(list);
    state.playlist = await api.playlist.get();
    renderPlaylist();
    setScanHint(
      tr('msg.added', { added: res.added.length }) +
      (res.skipped ? tr('msg.skipped', { n: res.skipped }) : '') +
      (res.failed.length ? tr('msg.failed', { n: res.failed.length }) : ''));
    return res;
  } catch (err) {
    showError(tr('err.importFailed', { msg: err.message }));
    setScanHint('');
    return null;
  }
}

function fmtSize(bytes) {
  if (!bytes) return '';
  const mb = bytes / 1024 / 1024;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function renderBrowser() {
  const list = $('browserList');
  const entries = state.browser.entries || [];
  const dir = state.browser.dir || '';

  
  
  
  const pathEl = $('browserPath');
  pathEl.textContent = '';
  const span = document.createElement('span');
  span.setAttribute('dir', 'ltr');
  
  span.textContent = isDrivesRoot(dir) ? tr('browser.drives') : dir;
  pathEl.appendChild(span);
  pathEl.title = isDrivesRoot(dir) ? tr('browser.drives') : dir;
  const audioCount = entries.filter((e) => !e.isDir).length;
  $('browserCount').textContent = String(audioCount);
  $('btnBrowseAdd').disabled = audioCount === 0;
  $('btnBrowseUp').disabled = !state.browser.parent;      
  list.innerHTML = '';

  if (!entries.length) {
    const li = document.createElement('li');
    li.className = 'br-empty';
    li.textContent = tr('browser.empty');
    list.appendChild(li);
    return;
  }

  for (const entry of entries) {
    const li = document.createElement('li');
    li.className = `br-item${entry.isDir ? ' dir' : ''}${state.browser.selected === entry.path ? ' selected' : ''}${entry.drive ? ' drive' : ''}`;
    li.dataset.path = entry.path;             
    li.draggable = true;

    const name = document.createElement('span');
    name.className = 'br-name';
    name.textContent = entry.name;

    if (entry.drive) {
      
      li.append(name);
    } else {
      const ico = document.createElement('span');
      ico.className = 'br-ico';
      
      
      ico.innerHTML = entry.isDir
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5v7A1.5 1.5 0 0 1 19.5 18h-15A1.5 1.5 0 0 1 3 16.5z"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 17.2V6.6l9-2v10"/><circle cx="6.6" cy="17.4" r="2.4"/><circle cx="15.6" cy="15.4" r="2.4"/></svg>';
      const meta = document.createElement('span');
      meta.className = 'br-meta';
      meta.textContent = entry.isDir ? tr('browser.folder') : fmtSize(entry.size);
      li.append(ico, name, meta);
    }

    li.addEventListener('click', () => {
      state.browser.selected = entry.path;
      renderBrowser();
    });
    li.addEventListener('dblclick', async () => {
      if (entry.isDir) {
        await loadBrowserDir(entry.path);
      } else if (entry.audio) {
        await addPathsToPlaylist([entry.path]);
      }
    });
    li.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      api.showItem(entry.path);
    });
    li.addEventListener('dragstart', (e) => {
      
      e.dataTransfer.setData(BROWSER_DRAG_MIME, entry.path);
      e.dataTransfer.setData('text/plain', entry.path);
      e.dataTransfer.effectAllowed = 'copy';
      li.classList.add('dragging');
    });
    li.addEventListener('dragend', () => li.classList.remove('dragging'));

    list.appendChild(li);
  }
}


const DRIVES_ROOT = '::drives';
const isDrivesRoot = (dir) => dir === DRIVES_ROOT;








function playBrowserCascade() {
  const list = $('browserList');
  if (!list) return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  if (document.body.classList.contains('no-anim')) return;
  const rows = [...list.children].filter((el) => el.classList.contains('br-item'));
  if (rows.length < 2) return;                       
  list.classList.add('is-cascade');
  rows.forEach((row, i) => { row.style.transitionDelay = `${Math.min(i, 20) * 17}ms`; });
  const reveal = () => {
    list.classList.remove('is-cascade');
    setTimeout(() => rows.forEach((row) => { row.style.transitionDelay = ''; }), 700);
  };
  requestAnimationFrame(() => requestAnimationFrame(reveal));
  setTimeout(() => list.classList.remove('is-cascade'), 800);   
}

async function loadBrowserDir(dir, { highlight = null } = {}) {
  try {
    const res = await api.fs.list(dir);
    state.browser.dir = res.dir;
    state.browser.parent = res.parent || null;
    state.browser.entries = res.entries || [];
    state.browser.selected = highlight || null;
    
    $('browserHint').textContent = res.fallback
      ? tr('browser.fallback')
      : (res.drives ? tr('browser.drivesHint') : '');
    renderBrowser();
    playBrowserCascade();                   
    
    if (highlight) {
      const row = [...document.querySelectorAll('.br-item')].find((li) => li.dataset.path === highlight);
      row?.scrollIntoView({ block: 'nearest' });
    }
    return res;
  } catch (err) {
    $('browserHint').textContent = tr('browser.error', { msg: err.message });
    return null;
  }
}


function enterPathEdit() {
  const show = $('browserPath');
  const input = $('browserPathInput');
  if (!input.hidden) return;
  
  input.value = isDrivesRoot(state.browser.dir) ? '' : (state.browser.dir || '');
  input.hidden = false;
  show.hidden = true;
  input.classList.remove('bad');
  $('browserHint').textContent = tr('path.hint');
  input.focus();
  input.select();
}


function exitPathEdit() {
  const show = $('browserPath');
  const input = $('browserPathInput');
  if (input.hidden) return;
  input.hidden = true;
  show.hidden = false;
  input.classList.remove('bad');
  $('browserHint').textContent = '';      
}





async function submitPathInput() {
  const input = $('browserPathInput');
  const value = input.value;
  const res = await api.fs.stat(value).catch((e) => ({ ok: false, reason: 'ipc', message: String(e.message || e) }));

  if (res && res.ok && res.kind === 'dir') {
    exitPathEdit();
    await loadBrowserDir(res.path);
    showToast(tr('path.jumped', { path: res.path }), 'ok');
    return;
  }
  if (res && res.ok && res.kind === 'file') {
    exitPathEdit();
    await loadBrowserDir(res.dir, { highlight: res.path });
    showToast(res.audio === false
      ? tr('path.fileNotAudio', { name: res.name })
      : tr('path.jumpedFile', { name: res.name }), res.audio === false ? 'err' : 'ok');
    return;
  }

  const reason = (res && res.reason) || 'not-found';
  const key = REASON_TEXT[reason] || 'path.err.notFound';
  input.classList.add('bad');
  const extra = res && res.path ? tr('path.err.notFoundAt', { path: res.path }) : '';
  showToast(tr(key) + extra, 'err');
  input.focus();
}


const REASON_TEXT = {
  empty: 'path.err.empty',
  'bad-env': 'path.err.badEnv',
  'bad-home': 'path.err.badHome',
  'drive-relative': 'path.err.driveRelative',
  'not-absolute': 'path.err.notAbsolute',
  'illegal-char': 'path.err.illegalChar',
  'not-found': 'path.err.notFound',
  'not-dir': 'path.err.notDir',
};

function bindPathEditor() {
  const show = $('browserPath');
  const input = $('browserPathInput');
  show.addEventListener('click', enterPathEdit);
  show.addEventListener('keydown', (e) => {
    if (e.code === 'Enter' || e.code === 'F2') { e.preventDefault(); enterPathEdit(); }
  });
  input.addEventListener('keydown', (e) => {
    if (e.code === 'Enter') { e.preventDefault(); submitPathInput(); }
    else if (e.code === 'Escape') { e.preventDefault(); exitPathEdit(); }
  });
  
  input.addEventListener('blur', () => exitPathEdit());
}


function isBrowserFileDrag(e) {
  return Array.from(e.dataTransfer?.types || []).includes(BROWSER_DRAG_MIME);
}

function bindPlaylistDropTarget() {
  const panel = $('playlistPanel');
  const body = $('plBody');
  const isBrowserDrag = isBrowserFileDrag;

  panel.addEventListener('dragover', (e) => {
    if (!isBrowserDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    body.classList.add('drop-target');
  });
  panel.addEventListener('dragleave', (e) => {
    if (!panel.contains(e.relatedTarget)) body.classList.remove('drop-target');
  });
  panel.addEventListener('drop', async (e) => {
    if (!isBrowserDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    body.classList.remove('drop-target');
    const paths = (e.dataTransfer.getData(BROWSER_DRAG_MIME) || '').split('\n').filter(Boolean);
    if (paths.length) await addPathsToPlaylist(paths);
  });
}

async function bindBrowser() {
  const home = await api.fs.home().catch(() => ({ music: '' }));
  state.browser.home = home.music || home.home || '';
  await loadBrowserDir(state.browser.home);
  bindPathEditor();
  bindBrowserWheel();

  $('btnBrowseUp').addEventListener('click', () => {
    if (state.browser.parent) loadBrowserDir(state.browser.parent);
  });
  $('btnBrowseRefresh').addEventListener('click', () => loadBrowserDir(state.browser.dir));
  $('btnBrowseAdd').addEventListener('click', () => {
    const files = (state.browser.entries || []).filter((e) => !e.isDir && e.audio).map((e) => e.path);
    if (files.length) addPathsToPlaylist(files);
  });
}


const BROWSER_WHEEL_STEP = 40;      
const BROWSER_ROW_FALLBACK = 30;    


function wheelDeltaPx(e, el) {
  if (e.deltaMode === 1) return e.deltaY * 16;
  if (e.deltaMode === 2) return e.deltaY * (el.clientHeight || 400);
  return e.deltaY;
}


function browserRowPitch(list) {
  const rows = list.querySelectorAll('.br-item');
  if (rows.length >= 2) {
    const pitch = rows[1].offsetTop - rows[0].offsetTop;
    if (pitch > 0) return pitch;
  }
  if (rows.length === 1) return rows[0].getBoundingClientRect().height;
  return BROWSER_ROW_FALLBACK;
}

function bindBrowserWheel() {
  const list = $('browserList');
  if (!list) return;
  let acc = 0;
  
  
  
  let pitchRows = -1;
  let pitch = BROWSER_ROW_FALLBACK;
  const rowPitch = () => {
    const rows = list.querySelectorAll('.br-item').length;
    if (rows !== pitchRows) {
      pitchRows = rows;
      pitch = browserRowPitch(list) || BROWSER_ROW_FALLBACK;
    }
    return pitch;
  };
  list.addEventListener('wheel', (e) => {
    if (!e.deltaY) return;
    const raw = wheelDeltaPx(e, list);
    if (!raw) return;
    e.preventDefault();                                   
    acc = Math.sign(raw) === Math.sign(acc) ? acc + raw : raw;   
    if (Math.abs(acc) < BROWSER_WHEEL_STEP) return;        
    acc = 0;
    list.scrollTop += Math.sign(raw) * rowPitch();         
  }, { passive: false });
}


let splitterDrag = null;









let dragging = false;

function bindPointerDrag(handle, { onStart, onMove, onEnd } = {}) {
  if (!handle) return;
  const begin = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    
    if (dragging) return;
    dragging = true;
    e.preventDefault();
    let last = 0;
    const emit = (ev) => {
      
      
      last = Date.now();
      onMove?.(ev);
    };
    const stop = (ev) => {
      if (!dragging) return;
      dragging = false;
      cleanup();
      if (ev && typeof ev.clientX === 'number') last = Date.now();
      onEnd?.(ev);
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', emit, true);
      window.removeEventListener('mousemove', emit, true);
      window.removeEventListener('pointerup', stop, true);
      window.removeEventListener('mouseup', stop, true);
      window.removeEventListener('pointercancel', stop, true);
      window.removeEventListener('blur', stop, true);
      window.removeEventListener('contextmenu', stop, true);   
      clearInterval(watchdog);
    };
    
    
    const watchdog = setInterval(() => {
      if (dragging && last && Date.now() - last > 2000) stop(null);
      else if (dragging && !last && Date.now() - started > 2000) stop(null);
    }, 250);
    const started = Date.now();
    window.addEventListener('pointermove', emit, true);
    window.addEventListener('mousemove', emit, true);
    window.addEventListener('pointerup', stop, true);
    window.addEventListener('mouseup', stop, true);
    window.addEventListener('pointercancel', stop, true);
    window.addEventListener('blur', stop, true);
    window.addEventListener('contextmenu', stop, true);
    try { handle.setPointerCapture?.(e.pointerId); } catch {  }
    onStart?.(e);
  };
  handle.addEventListener('pointerdown', begin);
  handle.addEventListener('mousedown', begin);
}

function applySplit(ratio) {
  const r = Math.min(0.85, Math.max(0.15, Number(ratio) || 0.5));
  state.browser.split = r;
  const pl = $('playlistPanel');
  const br = $('browserPanel');
  pl.style.flexGrow = '0';
  br.style.flexGrow = '0';
  pl.style.flexBasis = `${(r * 100).toFixed(2)}%`;
  br.style.flexBasis = `${((1 - r) * 100).toFixed(2)}%`;
  const sp = $('rightSplitter');
  sp.setAttribute('aria-valuenow', String(Math.round(r * 100)));
}

function bindSplitter() {
  const sp = $('rightSplitter');
  const col = $('rightCol');
  applySplit(state.settings.browserSplit ?? 0.5);

  const ratioFromY = (clientY) => {
    const rect = col.getBoundingClientRect();
    if (rect.height <= 0) return state.browser.split;
    return (clientY - rect.top) / rect.height;
  };

  bindPointerDrag(sp, {
    onStart: (e) => {
      splitterDrag = { id: e.pointerId };
      sp.classList.add('dragging');
    },
    onMove: (e) => {
      if (!splitterDrag) return;
      applySplit(ratioFromY(e.clientY));
    },
    onEnd: () => {
      if (!splitterDrag) return;
      splitterDrag = null;
      sp.classList.remove('dragging');
      api.settings.set({ browserSplit: state.browser.split }).catch(() => {});
    },
  });

  
  sp.addEventListener('keydown', (e) => {
    if (e.code !== 'ArrowUp' && e.code !== 'ArrowDown') return;
    e.preventDefault();
    applySplit(state.browser.split + (e.code === 'ArrowUp' ? -0.05 : 0.05));
    api.settings.set({ browserSplit: state.browser.split }).catch(() => {});
  });
}


function bindKeyboard() {
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && !$('settingsModal').hidden) {
      toggleSettings(false);
      return;
    }
    if (e.code === 'Escape' && !$('eqModal').hidden) {
      closeEqModal();
      return;
    }
    if (e.code === 'Escape' && !$('rankModal').hidden) {
      closeRankModal();
      return;
    }
    if (e.code === 'Escape' && !$('convertModal').hidden) {
      api.convert.cancel();
      closeConvertModal();
      return;
    }
    if (e.code === 'Escape' && !$('propsModal').hidden) {
      closePropsModal();
      return;
    }
    if (e.code === 'Escape' && !$('lyricsEditModal').hidden) {
      closeLyricsEditor();
      return;
    }
    if (e.code === 'Escape' && !$('ctxMenu').hidden) {
      closeCtxMenu();
      return;
    }
    
    if (e.code === 'Escape' && lxState.open) {
      setLyricsExclusive(false);
      return;
    }
    
    if ((e.code === 'KeyM' || e.key === 'm' || e.key === 'M') && !e.ctrlKey && !e.altKey && !e.metaKey) {
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      const typing = tag === 'input' && document.activeElement.type !== 'range' ||
        tag === 'textarea' || document.activeElement?.isContentEditable;
      if (!typing) {
        e.preventDefault();
        toggleMute();
        return;
      }
    }
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') {   
      e.preventDefault();
      $('btnSaveList').click();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyO') {   
      e.preventDefault();
      $('btnOpenList').click();
      return;
    }
    if (e.code === 'Space') {
      e.preventDefault();
      togglePlay();
    } else if (e.code === 'ArrowRight' && state.currentId) {
      resetPeakHistory();          
      api.player.seek(Math.min((state.playerState.position || 0) + 5, state.playerState.duration || 0))
        .then(applyPlayerState);
    } else if (e.code === 'ArrowLeft' && state.currentId) {
      resetPeakHistory();
      api.player.seek(Math.max((state.playerState.position || 0) - 5, 0)).then(applyPlayerState);
    } else if (e.code === 'ArrowUp') {
      e.preventDefault();
      $('volume').value = Math.min(100, Number($('volume').value) + 5);
      $('volume').dispatchEvent(new Event('input'));
    } else if (e.code === 'ArrowDown') {
      e.preventDefault();
      $('volume').value = Math.max(0, Number($('volume').value) - 5);
      $('volume').dispatchEvent(new Event('input'));
    }
  });
}

boot().catch((err) => {
  console.error(err);
  showError(tr('err.initFailed', { msg: err.stack || err.message }));
});
