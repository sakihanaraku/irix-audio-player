
'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const { probeFile, KNOWN_EXTENSIONS } = require('./ffmpeg');

function idFor(p) {
  return crypto.createHash('sha1').update(path.resolve(p).toLowerCase()).digest('hex').slice(0, 16);
}

async function walkForAudio(dir, out, depth = 0, limit = 5000) {
  if (depth > 6 || out.length >= limit) return;
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (out.length >= limit) return;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name.startsWith('.')) continue;
      await walkForAudio(full, out, depth + 1, limit);
    } else if (e.isFile()) {
      const ext = path.extname(e.name).slice(1).toLowerCase();
      if (KNOWN_EXTENSIONS.has(ext)) out.push(full);
    }
  }
}

class Playlist {
  constructor(file) {
    this.file = file;
    this.items = [];
  }

  load() {
    let raw = null;
    try {
      raw = fs.readFileSync(this.file, 'utf8');
      const data = JSON.parse(raw);
      if (Array.isArray(data.items)) this.items = data.items;
    } catch (err) {
      
      if (raw !== null) {
        try {
          const backup = `${this.file}.corrupt-${Date.now()}`;
          fs.writeFileSync(backup, raw, 'utf8');
          console.warn(`playlist: 解析失败，已备份到 ${backup}（${err.message}）`);
        } catch {  }
      }
    }
    return this.items;
  }

  async save() {
    try {
      await fsp.mkdir(path.dirname(this.file), { recursive: true });
      await fsp.writeFile(this.file, JSON.stringify({ version: 1, items: this.items }, null, 2), 'utf8');
    } catch {  }
  }

  list() {
    return this.items;
  }

  
  toExport() {
    return {
      format: 'irix-playlist',
      version: 1,
      app: 'iRix Audio Player',
      savedAt: new Date().toISOString(),
      count: this.items.length,
      items: this.items.map((t) => ({
        path: t.path,
        title: t.title || null,
        artist: t.artist || null,
        album: t.album || null,
        albumArtist: t.albumArtist || null,
        year: t.year || null,
        genre: t.genre || null,
        track: t.track || null,
        duration: t.duration || 0,
        codec: t.codec || null,
        container: t.container || null,
        sampleRate: t.sampleRate || 0,
        channels: t.channels || 0,
        bits: t.bits || 0,
        bitrate: t.bitrate || 0,
        size: t.size || 0,
        ext: t.ext || null,
        lossless: !!t.lossless,
      })),
    };
  }

  
  async saveTo(file) {
    const payload = this.toExport();
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, JSON.stringify(payload, null, 2), 'utf8');
    return payload;
  }

  
  static async readPaths(file) {
    const raw = await fsp.readFile(file, 'utf8');
    const data = JSON.parse(raw);
    const items = Array.isArray(data) ? data : data.items;
    if (!Array.isArray(items)) throw new Error('不是有效的播放列表文件');
    return items.map((it) => (typeof it === 'string' ? it : it && it.path)).filter(Boolean);
  }

  has(p) {
    const id = idFor(p);
    return this.items.some((t) => t.id === id);
  }

  


  async add(inputPaths, tools, { onProgress } = {}) {
    const files = [];
    for (const p of inputPaths) {
      let stat;
      try {
        stat = await fsp.stat(p);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        await walkForAudio(p, files);
      } else if (stat.isFile()) {
        files.push(p);
      }
    }

    const added = [];
    const failed = [];
    let skipped = 0;
    let index = 0;
    for (const f of files) {
      index++;
      if (onProgress && (index % 5 === 0 || index === files.length)) {
        onProgress({ done: index, total: files.length, file: path.basename(f) });
      }
      if (this.has(f)) { skipped++; continue; }
      let meta;
      try {
        meta = await probeFile(f, tools);
      } catch (err) {
        meta = { ok: false, error: err.message, path: f, name: path.basename(f) };
      }
      const track = {
        id: idFor(f),
        path: f,
        playPath: f,                           
        name: path.basename(f),
        ext: path.extname(f).slice(1).toLowerCase(),
        size: meta.size || 0,
        mtime: meta.mtime || 0,
        duration: meta.duration || 0,
        codec: meta.codec || null,
        container: meta.container || null,
        sampleRate: meta.sampleRate || 0,
        channels: meta.channels || 0,
        bits: meta.bits || 0,
        bitrate: meta.bitrate || 0,
        lossless: !!meta.lossless,
        kind: meta.kind || 'unknown',
        title: meta.title || path.basename(f, path.extname(f)),
        artist: meta.artist || null,
        album: meta.album || null,
        albumArtist: meta.albumArtist || null,
        year: meta.year || null,
        genre: meta.genre || null,
        track: meta.track || null,
        channelLayout: meta.channelLayout || null,
        hasCover: !!meta.hasCover,
        lyricsTag: meta.lyricsTag || null,     
        ok: !!meta.ok,
        error: meta.error || null,
        addedAt: Date.now(),
      };
      this.items.push(track);
      added.push(track);
      if (!meta.ok) failed.push(track);
    }
    if (added.length) await this.save();
    return { added, failed, skipped, scanned: files.length };
  }

  async remove(id) {
    const before = this.items.length;
    this.items = this.items.filter((t) => t.id !== id);
    if (this.items.length !== before) await this.save();
    return this.items;
  }

  async clear() {
    this.items = [];
    await this.save();
    return this.items;
  }

  async reorder(id, toIndex) {
    const from = this.items.findIndex((t) => t.id === id);
    if (from < 0) return this.items;
    const [item] = this.items.splice(from, 1);
    const clamped = Math.max(0, Math.min(toIndex, this.items.length));
    this.items.splice(clamped, 0, item);
    await this.save();
    return this.items;
  }

  async updateTrack(id, patch) {
    const t = this.items.find((x) => x.id === id);
    if (t) {
      Object.assign(t, patch);
      await this.save();
    }
    return t;
  }

  get(id) {
    return this.items.find((t) => t.id === id) || null;
  }
}

module.exports = { Playlist, idFor, walkForAudio };
