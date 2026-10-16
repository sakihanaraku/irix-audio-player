
'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');


const KNOWN_EXTENSIONS = new Set([
  'flac', 'wav', 'wave', 'mp3', 'm4a', 'mp4', 'aac', 'ogg', 'oga', 'opus', 'wma', 'asf',
  'ape', 'wv', 'tta', 'alac', 'aiff', 'aif', 'aifc', 'dsf', 'dff', 'mka', 'mkv', 'webm',
  'mpc', 'caf', 'amr', 'ac3', 'dts', 'eac3', 'mlp', 'thd', 'oga', 'spx', 'mid', 'midi',
]);

function exists(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function firstExisting(candidates) {
  for (const c of candidates) {
    if (c && exists(c)) return c;
  }
  return null;
}


function searchDir(dir, exeName, depth = 3) {
  if (!dir || depth < 0) return null;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    if (e.isFile() && e.name.toLowerCase() === exeName) return path.join(dir, e.name);
  }
  for (const e of entries) {
    if (e.isDirectory() && !e.name.startsWith('.')) {
      const found = searchDir(path.join(dir, e.name), exeName, depth - 1);
      if (found) return found;
    }
  }
  return null;
}

function whereIs(exeName) {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const d of dirs) {
    const p = path.join(d, exeName);
    if (exists(p)) return p;
  }
  return null;
}





function resolveTools({ explicitPath = '', appRoot = process.cwd(), extraDirs = [] } = {}) {
  const ffmpegName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const ffprobeName = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';

  const dirs = [];
  let explicitFfmpeg = null;
  if (explicitPath) {
    const stat = (() => { try { return fs.statSync(explicitPath); } catch { return null; } })();
    if (stat && stat.isDirectory()) dirs.push(explicitPath);
    else if (stat && stat.isFile()) {
      
      explicitFfmpeg = explicitPath;
      dirs.push(path.dirname(explicitPath));
    }
  }
  for (const d of extraDirs) dirs.push(d);
  dirs.push(path.join(appRoot, 'vendor', 'ffmpeg'));
  dirs.push(path.join(appRoot, 'vendor', 'ffmpeg', 'bin'));
  
  if (appRoot.includes('app.asar')) {
    const unpacked = appRoot.replace('app.asar', 'app.asar.unpacked');
    dirs.push(path.join(unpacked, 'vendor', 'ffmpeg', 'bin'));
    dirs.push(path.join(unpacked, 'vendor', 'ffmpeg'));
  }
  if (process.resourcesPath) {
    dirs.push(path.join(process.resourcesPath, 'ffmpeg', 'bin'));
    dirs.push(path.join(process.resourcesPath, 'ffmpeg'));
    dirs.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'vendor', 'ffmpeg', 'bin'));
  }
  dirs.push(path.join(appRoot, '..', 'vendor', 'ffmpeg', 'bin'));
  dirs.push(path.join(appRoot, '..', '.tools', 'ffmpeg'));
  dirs.push(path.join(appRoot, '..', '.tools', 'ffmpeg', 'bin'));
  dirs.push(path.join(appRoot, '..', '.tools', 'ffmpeg-npm', 'node_modules', '@ffmpeg-installer', 'win32-x64'));
  dirs.push(path.join(appRoot, '..', '.tools', 'ffmpeg-npm', 'node_modules', '@ffprobe-installer', 'win32-x64'));

  if (process.platform === 'win32') {
    dirs.push('C:\\ffmpeg\\bin');
    dirs.push(path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links'));
    dirs.push(path.join(process.env.USERPROFILE || '', 'scoop', 'shims'));
    dirs.push('C:\\ProgramData\\chocolatey\\bin');
  } else {
    
    dirs.push('/usr/bin', '/usr/local/bin', '/bin', '/opt/homebrew/bin', '/opt/local/bin');
    dirs.push('/snap/bin');                              
    dirs.push('/var/lib/flatpak/exports/bin');           
    dirs.push(path.join(process.env.HOME || '', '.local', 'bin'));
    dirs.push(path.join(process.env.HOME || '', 'bin'));
    
    if (process.env.APPDIR) dirs.push(path.join(process.env.APPDIR, 'usr', 'bin'));
  }

  let ffmpeg = explicitFfmpeg || firstExisting(dirs.map((d) => path.join(d, ffmpegName)));
  let ffprobe = firstExisting(dirs.map((d) => path.join(d, ffprobeName)));
  let source = explicitFfmpeg ? 'explicit-file' : 'search-path';

  if (!ffmpeg && process.env.AURORA_FFMPEG) {
    ffmpeg = firstExisting([process.env.AURORA_FFMPEG]);
    source = 'env:AURORA_FFMPEG';
  }
  if (!ffmpeg && process.env.FFMPEG_PATH) {
    ffmpeg = firstExisting([process.env.FFMPEG_PATH]);
    source = 'env:FFMPEG_PATH';
  }
  if (!ffmpeg) {
    
    for (const d of dirs) {
      const found = searchDir(d, ffmpegName, 3);
      if (found) { ffmpeg = found; source = `scan:${d}`; break; }
    }
  }
  if (!ffprobe) {
    for (const d of dirs) {
      const found = searchDir(d, ffprobeName, 3);
      if (found) { ffprobe = found; break; }
    }
  }
  if (!ffmpeg) {
    const fromPath = whereIs(ffmpegName);
    if (fromPath) { ffmpeg = fromPath; source = 'PATH'; }
  }
  if (!ffprobe) {
    const fromPath = whereIs(ffprobeName);
    if (fromPath) ffprobe = fromPath;
  }

  let version = null;
  if (ffmpeg) {
    try {
      const out = require('node:child_process').execFileSync(ffmpeg, ['-version'], {
        encoding: 'utf8', windowsHide: true, timeout: 5000,
      });
      version = (out.split('\n')[0] || '').trim();
    } catch {  }
  }
  return { ffmpeg, ffprobe, source, version };
}

function runCapture(exe, args, { timeout = 20000 } = {}) {
  return new Promise((resolve) => {
    execFile(exe, args, { windowsHide: true, timeout, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout, stderr) => resolve({ err, stdout: stdout || '', stderr: stderr || '' }));
  });
}

function parseFfmpegStderr(text) {
  const meta = {};
  const inputMatch = text.match(/Input #0,\s*([^,]+),/);
  if (inputMatch) meta.container = inputMatch[1].trim();

  const dur = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (dur) meta.duration = Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]);

  const br = text.match(/bitrate:\s*(\d+)\s*kb\/s/);
  if (br) meta.bitrate = Number(br[1]);

  const streamRe = /Stream #\d+:\d+(?:\[[^\]]*\])?(?:\([^)]*\))?:\s*Audio:\s*([^,\n]+)(.*)/g;
  let m;
  while ((m = streamRe.exec(text))) {
    const codec = m[1].trim();
    const rest = m[2];
    const rate = rest.match(/(\d{4,6})\s*Hz/);
    const chLayout = rest.match(/Hz,\s*([^,\n]+)/);
    const bitDepth = rest.match(/,\s*(u8|s16|s32|s64|flt|fltp|dbl|s16p|s32p)\b/);
    const sbr = rest.match(/,\s*(\d+)\s*kb\/s/);
    meta.codec = meta.codec || codec;
    if (rate) meta.sampleRate = meta.sampleRate || Number(rate[1]);
    if (chLayout) {
      const layout = chLayout[1].trim();
      meta.channelLayout = meta.channelLayout || layout;
      const count = { mono: 1, stereo: 2, '2.1': 3, quad: 4, '5.1': 6, '7.1': 8 }[layout];
      if (count) meta.channels = meta.channels || count;
      else if (/^\d+ channels$/.test(layout)) meta.channels = meta.channels || Number(layout.split(' ')[0]);
    }
    if (bitDepth) {
      const map = { u8: 8, s16: 16, s16p: 16, s32: 32, s32p: 32, s64: 64, flt: 32, fltp: 32, dbl: 64 };
      
      if (classifyCodec(codec).lossless) meta.bits = meta.bits || map[bitDepth[1]];
      else meta.decoderSampleFormat = map[bitDepth[1]];
    }
    if (sbr) meta.streamBitrate = meta.streamBitrate || Number(sbr[1]);
  }
  if (!meta.codec && /Output #0/.test(text)) meta.codec = undefined;
  return meta;
}

const LOSSLESS_CODECS = new Set(['flac', 'alac', 'pcm_s16le', 'pcm_s24le', 'pcm_s32le', 'pcm_f32le',
  'pcm_u8', 'pcm_s16be', 'pcm_s24be', 'pcm_f64le', 'ape', 'wavpack', 'tta', 'truehd', 'mlp', 'dst']);

function classifyCodec(codec) {
  if (!codec) return { kind: 'unknown', lossless: false };
  const c = codec.toLowerCase();
  if (LOSSLESS_CODECS.has(c) || c.startsWith('pcm_')) return { kind: 'lossless', lossless: true };
  if (['mp3', 'aac', 'vorbis', 'opus', 'wmav2', 'ac3', 'eac3', 'dts', 'mp2', 'amr_nb'].includes(c)) {
    return { kind: 'lossy', lossless: false };
  }
  return { kind: 'other', lossless: false };
}


async function probeFile(file, tools) {
  const ext = path.extname(file).slice(1).toLowerCase();
  const result = {
    path: file,
    name: path.basename(file),
    ext,
    supportedExt: KNOWN_EXTENSIONS.has(ext),
    ok: false,
    error: null,
    container: null,
    codec: null,
    sampleRate: 0,
    channels: 0,
    bits: 0,
    duration: 0,
    bitrate: 0,
    title: null,
    artist: null,
    album: null,
    albumArtist: null,
    year: null,
    genre: null,
    track: null,
    channelLayout: null,
    hasCover: false,
    lossless: false,
    kind: 'unknown',
    lyricsTag: null,          
  };

  let stat = null;
  try {
    stat = await fsp.stat(file);
  } catch (err) {
    result.error = `无法访问文件: ${err.message}`;
    return result;
  }
  result.size = stat.size;
  result.mtime = stat.mtimeMs;

  if (tools.ffprobe) {
    const { err, stdout } = await runCapture(tools.ffprobe, [
      '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file,
    ]);
    if (!err && stdout.trim().startsWith('{')) {
      try {
        const json = JSON.parse(stdout);
        const audio = (json.streams || []).find((s) => s.codec_type === 'audio');
        const video = (json.streams || []).find((s) => s.codec_type === 'video');
        const fmt = json.format || {};
        if (audio) {
          result.ok = true;
          result.container = fmt.format_long_name || fmt.format_name || null;
          result.codec = audio ? audio.codec_name : null;
          result.sampleRate = Number(audio?.sample_rate || 0);
          result.channels = Number(audio?.channels || 0);
          result.bits = Number(audio?.bits_per_raw_sample || audio?.bits_per_sample || 0);
          { const cls0 = classifyCodec(result.codec); if (!cls0.lossless) result.bits = 0; }
          result.duration = Number(fmt.duration || audio?.duration || 0);
          result.bitrate = Number(fmt.bit_rate || audio?.bit_rate || 0);
          result.channelLayout = audio?.channel_layout || null;
          
          result.hasCover = !!(video && (video.disposition?.attached_pic === 1 ||
                                         video.disposition?.attached_pic === true));
          const tags = { ...(fmt.tags || {}), ...(audio?.tags || {}) };
          const tag = (...names) => {
            for (const n of names) {
              const v = tags[n] ?? tags[n.toUpperCase()] ?? tags[n.toLowerCase()];
              if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
            }
            return null;
          };
          result.title = tag('title');
          result.artist = tag('artist');
          result.album = tag('album');
          result.albumArtist = tag('album_artist', 'albumartist');
          result.genre = tag('genre');
          const dateTag = tag('date', 'year', 'originaldate', 'creation_time');
          result.year = dateTag ? (dateTag.match(/\d{4}/) || [null])[0] : null;
          result.track = tag('track', 'tracknumber');
    
    const lyricKey = Object.keys(tags).find((k) => /lyric/i.test(k) &&
      tags[k] !== undefined && tags[k] !== null && String(tags[k]).trim() !== '');
    result.lyricsTag = lyricKey ? String(tags[lyricKey]) : null;
          const cls = classifyCodec(result.codec);
          result.lossless = cls.lossless;
          result.kind = cls.kind;
        }
      } catch (err2) {
        result.error = `解析 ffprobe 输出失败: ${err2.message}`;
      }
    }
  }

  if (!result.ok && tools.ffmpeg) {
    
    const { stderr } = await runCapture(tools.ffmpeg, ['-hide_banner', '-i', file]);
    const meta = parseFfmpegStderr(stderr);
    if (meta.codec) {                       
      result.ok = true;
      Object.assign(result, {
        container: meta.container || result.container,
        codec: meta.codec || result.codec,
        sampleRate: meta.sampleRate || 0,
        channels: meta.channels || 0,
        bits: meta.bits || 0,
        duration: meta.duration || 0,
        bitrate: meta.bitrate || 0,
      });
      
      result.hasCover = /Stream #\d+:\d+.*: Video: /i.test(stderr);
      const cls = classifyCodec(result.codec);
      result.lossless = cls.lossless;
      result.kind = cls.kind;
    } else {
      const reason = (stderr.match(/Invalid data found|No such file|Permission denied|moov atom not found/i) || [])[0];
      result.error = reason ? `无法解码: ${reason}` : '文件中没有音频流';
    }
  } else if (!tools.ffmpeg && !tools.ffprobe) {
    result.error = '未找到 ffmpeg/ffprobe 可执行文件';
  } else if (!result.ok && !result.error) {
    result.error = '文件中没有音频流';
  }

  if (result.ok && !result.title) {
    result.title = path.basename(file, path.extname(file));
  }
  return result;
}





function extractCover(file, tools, { maxSize = 512, timeoutMs = 15000 } = {}) {
  return new Promise((resolve) => {
    if (!tools || !tools.ffmpeg) return resolve(null);
    const args = [
      '-hide_banner', '-loglevel', 'error', '-nostdin',
      '-i', file,
      '-map', '0:v:0', '-frames:v', '1',
      '-vf', `scale=${maxSize}:${maxSize}:force_original_aspect_ratio=decrease`,
      '-f', 'image2pipe', '-vcodec', 'mjpeg', '-',
    ];
    let child;
    try {
      child = spawn(tools.ffmpeg, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      return resolve(null);
    }
    const chunks = [];
    let bytes = 0;
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch {  }
      finish(null);
    }, timeoutMs);

    child.stdout.on('data', (d) => {
      bytes += d.length;
      if (bytes > 12 * 1024 * 1024) {           
        try { child.kill(); } catch {  }
        finish(null);
        return;
      }
      chunks.push(d);
    });
    child.on('error', () => finish(null));
    child.on('close', () => {
      if (!chunks.length) return finish(null);
      const buf = Buffer.concat(chunks);
      if (buf.length < 128) return finish(null);
      
      const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
      const isPng = buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG';
      if (!isJpeg && !isPng) return finish(null);
      finish({
        mime: isPng ? 'image/png' : 'image/jpeg',
        bytes: buf.length,
        dataUrl: `data:${isPng ? 'image/png' : 'image/jpeg'};base64,${buf.toString('base64')}`,
      });
    });
  });
}


function buildDecodeArgs({ file, sampleRate, channels, seekSeconds = 0 }) {  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin'];
  if (seekSeconds && seekSeconds > 0.01) args.push('-ss', seekSeconds.toFixed(3));
  args.push(
    '-i', file,
    '-map', '0:a:0',
    '-vn', '-sn', '-dn',
    '-f', 'f32le',
    '-acodec', 'pcm_f32le',
    '-ar', String(sampleRate),
    '-ac', String(channels),
    '-'
  );
  return args;
}





function writeTagsWithFfmpeg(ffmpegPath, src, out, tags = {}) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error('ffmpeg 不可用'));
    const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', src];
    
    const map = { title: 'title', artist: 'artist', album: 'album', albumArtist: 'album_artist' };
    const wanted = Object.entries(map).filter(([key]) => tags[key]);
    if (wanted.length) args.push('-map_metadata', '-1');
    for (const [key, tag] of wanted) args.push('-metadata', `${tag}=${tags[key]}`);
    args.push('-c', 'copy', out);
    const child = spawn(ffmpegPath, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ ok: true, path: out });
      else reject(new Error(`ffmpeg 写标签失败（exit ${code}）：${err.slice(-200)}`));
    });
  });
}

module.exports = {
  KNOWN_EXTENSIONS,
  resolveTools,
  probeFile,
  extractCover,
  buildDecodeArgs,
  parseFfmpegStderr,
  classifyCodec,
  runCapture,
  writeTagsWithFfmpeg,
};
