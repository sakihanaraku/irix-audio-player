'use strict';











const WINE_ENV_KEYS = ['WINEPREFIX', 'WINEARCH', 'WINEDLLOVERRIDES', 'WINEDEBUG', 'WINESERVER', 'WINEBOOT'];


const FACTORY_VALUES = {
  backend: 'wasapi-shared',
  bufferMs: 100,
  periodMs: 10,
  ringMs: 300,
};


const WINE_VALUES = {
  backend: 'directsound',     
  bufferMs: 200,
  periodMs: 20,
  ringMs: 800,
};


const WINE_UNSUPPORTED_BACKENDS = ['wasapi-exclusive'];








function detectWine(deps = {}) {
  const env = deps.env || process.env;
  const readRegistry = deps.readRegistry || (() => ({ found: false, version: null, source: null }));

  const envHits = WINE_ENV_KEYS.filter((k) => !!env[k]);
  let reg = { found: false, version: null, source: null };
  try {
    reg = readRegistry() || reg;
  } catch {
    reg = { found: false, version: null, source: null };
  }

  const detected = envHits.length > 0 || !!reg.found;
  const version = normalizeVersion(reg.version);
  let source = null;
  if (envHits.length) source = `env:${envHits.join(',')}`;
  else if (reg.found) source = reg.source || 'registry';

  return {
    detected,
    version,
    source,
    envHits,
    label: describeWine(version),
  };
}


function describeWine(version) {
  const v = normalizeVersion(version);
  return v ? `Wine ${v}` : 'Wine';
}


function normalizeVersion(raw) {
  if (!raw) return null;
  const m = /(\d+(?:\.\d+){0,3})/.exec(String(raw));
  return m ? m[1] : null;
}





function readWineRegistry(deps = {}) {
  const execFileSync = deps.execFileSync || require('child_process').execFileSync;
  const run = (args) => {
    try {
      return execFileSync('reg', args, {
        timeout: 1500, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
      }).toString();
    } catch {
      return '';
    }
  };

  
  const probe = run(['query', 'HKCU\\Software\\Wine']);
  const hklm = run(['query', 'HKLM\\Software\\Wine']);
  const found = /Software\\Wine/i.test(probe) || /Software\\Wine/i.test(hklm);
  if (!found) return { found: false, version: null, source: null };

  
  const dump = run(['query', 'HKLM\\Software\\Wine', '/s']) + run(['query', 'HKCU\\Software\\Wine', '/s']);
  const m = /(wine[-_ ]?\d+(?:\.\d+){0,3})/i.exec(dump) || /Version\s+REG_SZ\s+(\S+)/i.exec(dump);
  return {
    found: true,
    version: m ? normalizeVersion(m[1]) : null,
    source: 'registry:HKCU\\Software\\Wine',
  };
}


function isWineCompatActive(settings = {}, wine = { detected: false }) {
  const mode = settings.wineCompat || 'auto';
  if (mode === 'off') return false;
  if (mode === 'on') return true;
  return !!wine.detected;
}






function wineSafeOverrides(settings = {}, wine = {}, active = null) {
  const on = active === null ? isWineCompatActive(settings, wine) : active;
  if (!on) return { changes: {}, skipped: [], notes: [] };

  const changes = {};
  const skipped = [];
  const notes = [];

  for (const [key, value] of Object.entries(WINE_VALUES)) {
    const current = settings[key];
    const factory = FACTORY_VALUES[key];
    const unsupported = key === 'backend' && WINE_UNSUPPORTED_BACKENDS.includes(current);
    if (current === undefined || current === factory || unsupported) changes[key] = value;
    else skipped.push(key);
  }

  if ((settings.wineCompat || 'auto') !== 'on') changes.wineCompat = 'auto';
  if (settings.allowFormatFallback === false) changes.allowFormatFallback = true;

  notes.push('WASAPI 独占模式在 Wine 下不可用，已改用 DirectSound 输出');
  notes.push('缓冲放大到 200ms/20ms/800ms，容忍 Wine 音频通路较大的抖动');
  notes.push('界面改用不透明的实心面板（Wine 的 GPU 合成下 backdrop-filter 可能失效）');
  if (skipped.length) notes.push(`保留了你手动设置过的项：${skipped.join('、')}`);

  return { changes, skipped, notes };
}





function backendChain(preferred, wine = {}, active = null) {
  const on = active === null ? isWineCompatActive({}, wine) : active;
  const chain = [];
  const push = (b) => {
    if (!b || chain.includes(b)) return;
    if (on && WINE_UNSUPPORTED_BACKENDS.includes(b)) return;
    chain.push(b);
  };
  push(preferred);
  if (on) {
    push('wasapi-shared');
    push('directsound');
    push('mme');
  }
  return chain;
}


function wineUiFlags(wine = {}, settings = {}) {
  const on = isWineCompatActive(settings, wine);
  return {
    active: on,
    noGlass: on,                 
    label: wine.detected ? wine.label || describeWine(wine.version) : 'Wine',
    version: wine.version || null,
  };
}

module.exports = {
  WINE_ENV_KEYS,
  FACTORY_VALUES,
  WINE_VALUES,
  WINE_UNSUPPORTED_BACKENDS,
  detectWine,
  describeWine,
  normalizeVersion,
  readWineRegistry,
  isWineCompatActive,
  wineSafeOverrides,
  backendChain,
  wineUiFlags,
};
