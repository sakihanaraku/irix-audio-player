























'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ID_RE = /^[a-z0-9][a-z0-9._-]{1,48}$/i;
const KEY_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const SETTING_TYPES = ['text', 'number', 'boolean', 'select'];


function normalizeSettings(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const item of raw.slice(0, 32)) {
    if (!item || typeof item !== 'object') continue;
    const key = String(item.key || '');
    if (!KEY_RE.test(key) || seen.has(key)) continue;
    seen.add(key);
    const type = SETTING_TYPES.includes(item.type) ? item.type : 'text';
    const desc = {
      key,
      type,
      label: String(item.label || key).slice(0, 80),
      description: item.description ? String(item.description).slice(0, 240) : '',
    };
    if (type === 'number') {
      desc.default = Number.isFinite(Number(item.default)) ? Number(item.default) : 0;
      if (Number.isFinite(Number(item.min))) desc.min = Number(item.min);
      if (Number.isFinite(Number(item.max))) desc.max = Number(item.max);
      if (Number.isFinite(Number(item.step)) && Number(item.step) > 0) desc.step = Number(item.step);
    } else if (type === 'boolean') {
      desc.default = item.default !== false;   
    } else if (type === 'select') {
      const options = [];
      const vals = new Set();
      for (const opt of (Array.isArray(item.options) ? item.options : []).slice(0, 24)) {
        const value = String(opt && typeof opt === 'object' ? opt.value : opt);
        if (vals.has(value)) continue;
        vals.add(value);
        options.push({ value, label: String(opt && typeof opt === 'object' ? (opt.label ?? opt.value) : opt).slice(0, 80) });
      }
      desc.options = options;
      desc.default = vals.has(String(item.default)) ? String(item.default) : (options[0] ? options[0].value : '');
    } else {
      desc.default = String(item.default ?? '').slice(0, 4096);
      desc.placeholder = item.placeholder ? String(item.placeholder).slice(0, 120) : '';
    }
    out.push(desc);
  }
  return out;
}


function normalizeCommands(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const item of raw.slice(0, 16)) {
    const obj = item && typeof item === 'object' ? item : { id: item };
    const id = String(obj.id || '');
    if (!KEY_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      label: String(obj.label || id).slice(0, 80),
      description: obj.description ? String(obj.description).slice(0, 240) : '',
    });
  }
  return out;
}


function normalizeSettingValue(desc, raw) {
  if (!desc) return { ok: false, error: '未知设置项' };
  if (desc.type === 'number') {
    const n = Number(raw);
    if (!Number.isFinite(n)) return { ok: false, error: '需要数字' };
    let v = n;
    if (desc.min !== undefined) v = Math.max(desc.min, v);
    if (desc.max !== undefined) v = Math.min(desc.max, v);
    return { ok: true, value: v };
  }
  if (desc.type === 'boolean') return { ok: true, value: raw === true || raw === 'true' || raw === 1 || raw === '1' };
  if (desc.type === 'select') {
    const s = String(raw);
    const hit = (desc.options || []).some((o) => o.value === s);
    if (!hit) return { ok: false, error: '取值不在选项中' };
    return { ok: true, value: s };
  }
  return { ok: true, value: String(raw ?? '').slice(0, 4096) };
}

class Extensions {
  constructor({
    dir, getEnabled, saveEnabled, appVersion = '',
    getSettings = () => ({}),        
    persistSettings = async () => {}, 
    clearSettings = async () => {},   
    log = () => {},                   
  }) {
    this.dir = dir;                       
    this.getEnabled = getEnabled;         
    this.saveEnabled = saveEnabled;       
    this.appVersion = appVersion;
    this.getSavedSettings = getSettings;
    this.persistSettings = persistSettings;
    this.clearSettings = clearSettings;
    this.log = log;
    this.cache = new Map();               
  }

  ensureDir() {
    try { fs.mkdirSync(this.dir, { recursive: true }); } catch {  }
  }

  
  readManifest(id) {
    try {
      if (!ID_RE.test(String(id || ''))) return null;
      const base = path.join(this.dir, String(id));
      if (!fs.statSync(base).isDirectory()) return null;
      return JSON.parse(fs.readFileSync(path.join(base, 'extension.json'), 'utf8'));
    } catch { return null; }
  }

  
  savedSettingsOf(manifest) {
    const saved = this.getSavedSettings(manifest.id) || {};
    const out = {};
    for (const desc of normalizeSettings(manifest.settings)) {
      const raw = saved[desc.key];
      if (raw !== undefined) {
        const nv = normalizeSettingValue(desc, raw);
        if (nv.ok) out[desc.key] = nv.value;
      }
    }
    return out;
  }

  
  settingsFor(id) {
    const manifest = this.readManifest(id);
    if (!manifest) return {};
    const values = {};
    const saved = this.savedSettingsOf(manifest);
    for (const desc of normalizeSettings(manifest.settings)) {
      values[desc.key] = saved[desc.key] !== undefined ? saved[desc.key] : desc.default;
    }
    return values;
  }

  
  contextFor(id, manifest) {
    const rec = this.cache.get(id);
    return {
      appVersion: this.appVersion,
      extension: {
        id: manifest.id,
        name: manifest.name || manifest.id,
        version: manifest.version || '',
        dir: path.join(this.dir, manifest.id),
      },
      settings: this.settingsFor(manifest.id),
      log: (...args) => this.log(`[ext:${manifest.id}]`, ...args),
      
    };
  }

  
  list() {
    this.ensureDir();
    const enabled = new Set(this.getEnabled());
    const out = [];
    let names = [];
    try { names = fs.readdirSync(this.dir); } catch { names = []; }
    for (const name of names) {
      const base = path.join(this.dir, name);
      const manifestFile = path.join(base, 'extension.json');
      try {
        if (!fs.statSync(base).isDirectory()) continue;
        const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
        if (!manifest || !ID_RE.test(String(manifest.id || ''))) continue;
        if (manifest.id !== name) continue;              
        const entryFile = path.join(base, manifest.entry || 'index.js');
        out.push({
          id: manifest.id,
          name: manifest.name || manifest.id,
          version: manifest.version || '',
          description: manifest.description || '',
          extensions: Array.isArray(manifest.extensions) ? manifest.extensions : [],
          author: manifest.author || '',
          homepage: manifest.homepage || '',
          license: manifest.license || '',
          minAppVersion: manifest.minAppVersion || '',
          startup: manifest.startup === true,          
          settings: normalizeSettings(manifest.settings),
          commands: normalizeCommands(manifest.commands),
          values: this.settingsFor(manifest.id),
          enabled: enabled.has(manifest.id),
          installed: fs.existsSync(entryFile),
        });
      } catch {  }
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }

  
  load(id) {
    const cached = this.cache.get(id);
    if (cached) return cached;
    const base = path.join(this.dir, id);
    const manifest = JSON.parse(fs.readFileSync(path.join(base, 'extension.json'), 'utf8'));
    const mod = require(path.join(base, manifest.entry || 'index.js'));
    const rec = { manifest, module: mod, ctx: this.contextFor(id, manifest) };
    try {
      if (mod && typeof mod.activate === 'function') {
        const r = mod.activate(rec.ctx);
        if (r && typeof r.then === 'function') r.catch((err) => this.log(`[ext:${id}] activate 失败:`, err && err.message));
      }
    } catch (err) {
      
      this.log(`[ext:${id}] activate 失败:`, err && err.message);
    }
    this.cache.set(id, rec);
    return rec;
  }

  
  activateStartup() {
    const started = [];
    for (const item of this.list()) {
      if (!item.enabled || !item.installed || !item.startup) continue;
      try {
        this.load(item.id);
        started.push(item.id);
      } catch (err) {
        this.log(`[ext:${item.id}] 启动激活失败:`, err && err.message);
      }
    }
    return started;
  }

  
  loaded() {
    const list = [];
    for (const item of this.list()) {
      if (!item.enabled || !item.installed) continue;
      try { list.push(this.load(item.id)); } catch {  }
    }
    return list;
  }

  
  findHandler(fileName) {
    const rec = this.findRecord(fileName);
    return rec ? rec.module : null;
  }

  
  findRecord(fileName) {
    for (const rec of this.loaded()) {
      try {
        const mod = rec.module;
        if (mod && mod.match instanceof RegExp && mod.match.test(fileName)) return rec;
      } catch {  }
    }
    return null;
  }

  
  supportedExts() {
    const set = new Set();
    for (const item of this.list()) {
      for (const e of item.extensions || []) set.add(String(e).toLowerCase().replace(/^\./, ''));
    }
    return [...set];
  }

  
  async setSetting(id, key, rawValue) {
    const manifest = this.readManifest(id);
    if (!manifest) throw new Error('扩展不存在');
    const desc = normalizeSettings(manifest.settings).find((d) => d.key === key);
    if (!desc) throw new Error('该扩展没有这个设置项');
    const nv = normalizeSettingValue(desc, rawValue);
    if (!nv.ok) throw new Error(nv.error || '设置值不合法');
    const saved = this.savedSettingsOf(manifest);
    saved[desc.key] = nv.value;
    await this.persistSettings(manifest.id, saved);
    const values = this.settingsFor(manifest.id);
    let rec = null;
    try { rec = this.load(manifest.id); } catch { rec = null; }
    let live = false;
    if (rec && rec.module && typeof rec.module.onSettingsChanged === 'function') {
      live = true;
      try {
        const r = rec.module.onSettingsChanged(values, desc.key);
        if (r && typeof r.then === 'function') r.catch((err) => this.log(`[ext:${id}] onSettingsChanged 失败:`, err && err.message));
      } catch (err) {
        this.log(`[ext:${id}] onSettingsChanged 失败:`, err && err.message);
      }
    }
    return { values, live };
  }

  
  async runCommand(id, commandId) {
    const manifest = this.readManifest(id);
    if (!manifest) throw new Error('扩展不存在');
    if (!normalizeCommands(manifest.commands).some((c) => c.id === commandId)) {
      throw new Error('该扩展没有这个命令');
    }
    let rec = null;
    try { rec = this.load(manifest.id); } catch (err) {
      return { ok: false, error: '扩展加载失败：' + (err && err.message ? err.message : err) };
    }
    const commands = rec.module && rec.module.commands;
    const fn = commands && typeof commands === 'object' ? commands[commandId] : null;
    if (typeof fn !== 'function') return { ok: false, error: '插件未实现该命令' };
    try {
      const ret = await fn(this.contextFor(manifest.id, manifest));
      const message = typeof ret === 'string' ? ret
        : (ret && typeof ret.message === 'string' ? ret.message : '');
      return { ok: true, message };
    } catch (err) {
      this.log(`[ext:${id}] 命令 ${commandId} 失败:`, err && err.message);
      return { ok: false, error: String(err && err.message ? err.message : err) };
    }
  }

  
  deactivate(id) {
    const rec = this.cache.get(id);
    if (!rec) return;
    this.cache.delete(id);
    try {
      if (rec.module && typeof rec.module.deactivate === 'function') {
        const r = rec.module.deactivate();
        if (r && typeof r.then === 'function') r.catch((err) => this.log(`[ext:${id}] deactivate 失败:`, err && err.message));
      }
    } catch (err) {
      this.log(`[ext:${id}] deactivate 失败:`, err && err.message);
    }
  }

  
  shutdown() {
    for (const id of [...this.cache.keys()]) this.deactivate(id);
  }

  



  installFromFile(srcPath) {
    this.ensureDir();
    const tmp = path.join(this.dir, '.installing');
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {  }
    fs.mkdirSync(tmp, { recursive: true });
    let srcDir = srcPath;
    try {
      if (fs.statSync(srcPath).isFile()) {
        const r = spawnSync('tar', ['-xf', srcPath, '-C', tmp], { windowsHide: true });
        if (r.status !== 0) throw new Error('解压失败（需要 .zip 或目录）');
        
        const entries = fs.readdirSync(tmp).filter((n) => !n.startsWith('.'));
        if (entries.length === 1 && fs.statSync(path.join(tmp, entries[0])).isDirectory()) {
          srcDir = path.join(tmp, entries[0]);
        } else {
          srcDir = tmp;
        }
      }
    } catch (err) {
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {  }
      throw err;
    }
    try {
      const manifestFile = path.join(srcDir, 'extension.json');
      if (!fs.existsSync(manifestFile)) throw new Error('这不是扩展包（缺 extension.json）');
      const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
      const id = String(manifest.id || '');
      if (!ID_RE.test(id)) throw new Error('扩展 id 不合法（只能用小写字母/数字/.-_）');
      const dest = path.join(this.dir, id);
      try { fs.rmSync(dest, { recursive: true, force: true }); } catch {  }
      fs.cpSync(srcDir, dest, { recursive: true });
      this.deactivate(id);
      
      const enabled = new Set(this.getEnabled());
      enabled.add(id);
      this.saveEnabled([...enabled]);
      return { ...manifest, enabled: true };
    } finally {
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {  }
    }
  }

  uninstall(id) {
    if (!ID_RE.test(String(id || ''))) throw new Error('扩展 id 不合法');
    this.deactivate(id);
    const dest = path.join(this.dir, id);
    try { fs.rmSync(dest, { recursive: true, force: true }); } catch {  }
    const enabled = new Set(this.getEnabled());
    enabled.delete(id);
    this.saveEnabled([...enabled]);
    try { this.clearSettings(id); } catch {  }
    return true;
  }

  setEnabled(id, on) {
    if (!ID_RE.test(String(id || ''))) throw new Error('扩展 id 不合法');
    if (!on) this.deactivate(id);
    const enabled = new Set(this.getEnabled());
    if (on) enabled.add(id); else enabled.delete(id);
    this.saveEnabled([...enabled]);
    return true;
  }
}

module.exports = {
  Extensions, ID_RE, KEY_RE, SETTING_TYPES,
  normalizeSettings, normalizeCommands, normalizeSettingValue,
};
