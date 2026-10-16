'use strict';
















const fs = require('node:fs');
const path = require('node:path');

const TIME_RE = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const META_RE = /^\[(ti|ar|al|by|au|length|offset|re|ve):(.*)\]$/i;


function parseLrc(text) {
  const meta = {};
  const lines = [];
  if (typeof text !== 'string' || !text.trim()) return { meta, lines, synced: false };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const metaMatch = META_RE.exec(line);
    if (metaMatch) {
      meta[metaMatch[1].toLowerCase()] = metaMatch[2].trim();
      continue;
    }

    TIME_RE.lastIndex = 0;
    const times = [];
    let m;
    while ((m = TIME_RE.exec(line)) !== null) {
      const min = Number(m[1]);
      const sec = Number(m[2]);
      let frac = 0;
      if (m[3] !== undefined) {
        
        frac = m[3].length === 3 ? Number(m[3]) / 1000 : Number(`0.${m[3]}`);
      }
      times.push(min * 60 + sec + frac);
    }
    const content = line.replace(TIME_RE, '').trim();
    if (!times.length) {
      
      lines.push({ time: null, text: content || line });
      continue;
    }
    for (const time of times) lines.push({ time, text: content });
  }

  const offset = Number(meta.offset);
  if (Number.isFinite(offset) && offset !== 0) {
    for (const l of lines) if (l.time !== null) l.time = Math.max(0, l.time + offset / 1000);
  }

  const synced = lines.some((l) => l.time !== null);
  if (synced) {
    
    
    let first = lines.findIndex((l) => l.time !== null);
    if (first > 0) lines.splice(0, first);
    
    let lastTime = 0;
    for (const l of lines) {
      if (l.time === null) l.time = lastTime;
      else lastTime = l.time;
    }
    lines.sort((a, b) => a.time - b.time);
  }
  return { meta, lines, synced };
}


function lyricsFromTags(tags) {
  if (!tags || typeof tags !== 'object') return null;
  for (const [key, value] of Object.entries(tags)) {
    if (!/lyric/i.test(key)) continue;
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}


function lrcCandidates(track) {
  const dir = path.dirname(track.path || '');
  const base = path.basename(track.path || '', path.extname(track.path || ''));
  const names = [];
  const push = (n) => {
    const clean = String(n || '').replace(/[\\/:*?"<>|]/g, '_').trim();
    if (clean && !names.includes(clean)) names.push(clean);
  };
  push(base);
  if (track.artist && track.title) push(`${track.artist} - ${track.title}`);
  if (track.title) push(track.title);
  if (track.name) push(path.basename(track.name, path.extname(track.name)));
  return names.map((n) => path.join(dir, `${n}.lrc`));
}


function findLrcFile(track) {
  for (const candidate of lrcCandidates(track)) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    } catch {  }
    
    try {
      const dir = path.dirname(candidate);
      const want = path.basename(candidate).toLowerCase();
      const hit = fs.readdirSync(dir).find((f) => f.toLowerCase() === want);
      if (hit) return path.join(dir, hit);
    } catch {  }
  }
  return null;
}


function readLrc(file) {
  try {
    const buf = fs.readFileSync(file);
    
    let text = buf.toString('utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    return text;
  } catch {
    return null;
  }
}






function resolveLyrics(track) {
  if (!track || !track.path) return { found: false };

  
  const embedded = (typeof track.lyricsTag === 'string' && track.lyricsTag.trim())
    ? track.lyricsTag
    : lyricsFromTags(track.formatTags);
  if (embedded) {
    const parsed = parseLrc(embedded);
    return { found: true, source: 'metadata', ...parsed, raw: embedded };
  }

  const file = findLrcFile(track);
  if (file) {
    const raw = readLrc(file);
    if (raw && raw.trim()) {
      const parsed = parseLrc(raw);
      return { found: true, source: 'file', file, ...parsed, raw };
    }
  }
  return { found: false };
}


function parseLyricsText(text) {
  const parsed = parseLrc(text);
  return { found: true, source: 'picked', ...parsed };
}







function saveLyrics(file, text) {
  const target = file;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, String(text ?? ''), 'utf8');
    return { ok: true, file: target };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}


function lrcPathFor(track) {
  const dir = path.dirname(track.path || '');
  const base = path.basename(track.path || '', path.extname(track.path || ''));
  return path.join(dir, `${base || 'lyrics'}.lrc`);
}


function activeLineIndex(lines, positionSec) {
  if (!Array.isArray(lines) || !lines.length) return -1;
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].time;
    if (t === null) return -1;
    if (t <= positionSec + 1e-3) idx = i;
    else break;
  }
  return idx;
}

module.exports = {
  parseLrc,
  lyricsFromTags,
  lrcCandidates,
  findLrcFile,
  readLrc,
  resolveLyrics,
  parseLyricsText,
  activeLineIndex,
  saveLyrics,
  lrcPathFor,
};
