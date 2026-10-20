









'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ID_RE = /^[a-z0-9][a-z0-9._-]{1,48}$/i;

class Extensions {
  constructor({ dir, getEnabled, saveEnabled }) {
    this.dir = dir;                       
    this.getEnabled = getEnabled;         
    this.saveEnabled = saveEnabled;       
    this.cache = new Map();               
  }

  ensureDir() {
    try { fs.mkdirSync(this.dir, { recursive: true }); } catch {  }
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
          minAppVersion: manifest.minAppVersion || '',
          enabled: enabled.has(manifest.id),
          installed: fs.existsSync(entryFile),
        });
      } catch {  }
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }

  
  loaded() {
    const list = [];
    for (const item of this.list()) {
      if (!item.enabled || !item.installed) continue;
      const cached = this.cache.get(item.id);
      if (cached) { list.push(cached); continue; }
      try {
        const base = path.join(this.dir, item.id);
        const manifest = JSON.parse(fs.readFileSync(path.join(base, 'extension.json'), 'utf8'));
        const mod = require(path.join(base, manifest.entry || 'index.js'));
        const rec = { manifest, module: mod };
        this.cache.set(item.id, rec);
        list.push(rec);
      } catch {  }
    }
    return list;
  }

  
  findHandler(fileName) {
    for (const { module: mod } of this.loaded()) {
      try {
        if (mod && mod.match instanceof RegExp && mod.match.test(fileName)) return mod;
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
      this.cache.delete(id);
      
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
    const dest = path.join(this.dir, id);
    try { fs.rmSync(dest, { recursive: true, force: true }); } catch {  }
    this.cache.delete(id);
    const enabled = new Set(this.getEnabled());
    enabled.delete(id);
    this.saveEnabled([...enabled]);
    return true;
  }

  setEnabled(id, on) {
    if (!ID_RE.test(String(id || ''))) throw new Error('扩展 id 不合法');
    const enabled = new Set(this.getEnabled());
    if (on) enabled.add(id); else enabled.delete(id);
    this.cache.delete(id);
    this.saveEnabled([...enabled]);
    return true;
  }
}

module.exports = { Extensions, ID_RE };
