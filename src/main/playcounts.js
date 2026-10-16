'use strict';











const fs = require('node:fs');
const path = require('node:path');

const DATA_VERSION = 1;
const MAX_ENTRIES = 500;             


function normField(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim().toLowerCase();
}





function songKey(meta = {}) {
  const artist = normField(meta.artist || meta.albumArtist) || '?';
  const title = normField(meta.title) || '?';
  const album = normField(meta.album) || '?';
  return `${artist}\u0001${title}\u0001${album}`;
}


function displayMeta(meta = {}) {
  const artist = (meta.artist || meta.albumArtist || '').trim();
  const title = (meta.title || '').trim();
  const album = (meta.album || '').trim();
  return {
    artist: artist || null,
    title: title || null,
    album: album || null,
  };
}

function emptyData() {
  return { version: DATA_VERSION, songs: {} };
}


function load(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.songs !== 'object' || !parsed.songs) {
      return emptyData();
    }
    const songs = {};
    for (const [key, entry] of Object.entries(parsed.songs)) {
      if (!entry || typeof entry !== 'object') continue;
      const plays = Number(entry.plays);
      if (!Number.isFinite(plays) || plays <= 0) continue;
      songs[key] = {
        artist: entry.artist || null,
        title: entry.title || null,
        album: entry.album || null,
        plays: Math.floor(plays),
        lastPlayedAt: typeof entry.lastPlayedAt === 'string' ? entry.lastPlayedAt : null,
        durationMs: Number.isFinite(Number(entry.durationMs)) ? Number(entry.durationMs) : null,
      };
    }
    return { version: DATA_VERSION, songs };
  } catch {
    return emptyData();
  }
}

function save(filePath, data) {
  const dir = path.dirname(filePath);
  try { fs.mkdirSync(dir, { recursive: true }); } catch {  }
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}


function addPlay(data, meta = {}, { now = new Date().toISOString(), durationMs = null } = {}) {
  const key = songKey(meta);
  const shown = displayMeta(meta);
  const prev = data.songs[key];
  const entry = {
    artist: shown.artist || prev?.artist || null,
    title: shown.title || prev?.title || null,
    album: shown.album || prev?.album || null,
    plays: (prev?.plays || 0) + 1,
    lastPlayedAt: now,
    durationMs: durationMs ?? prev?.durationMs ?? null,
  };
  data.songs[key] = entry;
  prune(data);
  return entry.plays;
}


function prune(data, limit = MAX_ENTRIES) {
  const keys = Object.keys(data.songs);
  if (keys.length <= limit) return;
  keys.sort((a, b) => {
    const A = data.songs[a];
    const B = data.songs[b];
    if (B.plays !== A.plays) return B.plays - A.plays;
    return String(B.lastPlayedAt || '').localeCompare(String(A.lastPlayedAt || ''));
  });
  for (const key of keys.slice(limit)) delete data.songs[key];
}


function ranking(data) {
  return Object.entries(data.songs)
    .map(([key, entry]) => ({ key, ...entry }))
    .sort((a, b) => {
      if (b.plays !== a.plays) return b.plays - a.plays;
      const at = a.lastPlayedAt || '';
      const bt = b.lastPlayedAt || '';
      if (at !== bt) return bt.localeCompare(at);
      return String(a.title || '').localeCompare(String(b.title || ''));
    });
}


function summary(data) {
  const list = Object.values(data.songs);
  return {
    songs: list.length,
    totalPlays: list.reduce((sum, e) => sum + (e.plays || 0), 0),
  };
}


function removeSongs(data, keys = []) {
  let removed = 0;
  for (const key of Array.isArray(keys) ? keys : []) {
    if (key && Object.prototype.hasOwnProperty.call(data.songs, key)) {
      delete data.songs[key];
      removed++;
    }
  }
  return removed;
}

module.exports = {
  DATA_VERSION,
  MAX_ENTRIES,
  normField,
  songKey,
  displayMeta,
  emptyData,
  load,
  save,
  addPlay,
  removeSongs,
  ranking,
  summary,
};
