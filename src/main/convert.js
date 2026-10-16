'use strict';








const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');


const PARAM = {
  COMPRESSION: 'compressionLevel',   
  BITRATE: 'bitrate',                
  RATE_MODE: 'rateMode',             
  QUALITY: 'quality',                
  BIT_DEPTH: 'bitDepth',             
};

const FORMATS = [
  {
    id: 'flac',
    label: 'FLAC',
    ext: 'flac',
    codec: 'flac',
    lossless: true,
    params: [PARAM.COMPRESSION],
    notes: '无损，压缩等级越高文件越小、编码越慢',
    compression: { min: 0, max: 8, default: 5 },
  },
  {
    id: 'wav',
    label: 'Wave',
    ext: 'wav',
    codec: 'pcm_s24le',
    lossless: true,
    params: [PARAM.BIT_DEPTH],
    notes: '无损未压缩，文件较大',
    bitDepth: { options: [16, 24, 32], default: 24 },
    codecByDepth: { 16: 'pcm_s16le', 24: 'pcm_s24le', 32: 'pcm_s32le' },
  },
  {
    id: 'mp3',
    label: 'MP3',
    ext: 'mp3',
    codec: 'libmp3lame',
    lossless: false,
    params: [PARAM.RATE_MODE, PARAM.BITRATE, PARAM.QUALITY],
    notes: '兼容性最好',
    bitrate: { options: [128, 160, 192, 256, 320], default: 320, unit: 'kbps' },
    quality: { min: 0, max: 9, default: 0, note: '0 最好 / 9 最小' },
  },
  {
    id: 'aac',
    label: 'AAC',
    ext: 'm4a',
    codec: 'aac',
    lossless: false,
    params: [PARAM.RATE_MODE, PARAM.BITRATE, PARAM.QUALITY],
    notes: '同码率下通常比 MP3 更好',
    bitrate: { options: [96, 128, 160, 192, 256], default: 192, unit: 'kbps' },
    quality: { min: 1, max: 5, default: 2, note: '1 最好 / 5 最小' },
  },
  {
    id: 'vorbis',
    label: 'Vorbis',
    ext: 'ogg',
    codec: 'libvorbis',
    lossless: false,
    params: [PARAM.RATE_MODE, PARAM.QUALITY, PARAM.BITRATE],
    notes: '开源有损格式，VBR 质量 0–10',
    bitrate: { options: [96, 128, 160, 192, 256], default: 160, unit: 'kbps' },
    quality: { min: 0, max: 10, default: 6, note: '10 最好 / 0 最小' },
  },
];

const formatById = (id) => FORMATS.find((f) => f.id === id) || null;


function defaultOptions(formatId) {
  const fmt = formatById(formatId);
  if (!fmt) return {};
  const out = { rateMode: 'vbr' };
  if (fmt.compression) out.compressionLevel = fmt.compression.default;
  if (fmt.bitDepth) out.bitDepth = fmt.bitDepth.default;
  if (fmt.bitrate) out.bitrate = fmt.bitrate.default;
  if (fmt.quality) out.quality = fmt.quality.default;
  return out;
}


function clampNumber(value, { min, max, default: def }) {
  const n = Number(value);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function pickOption(value, options, def) {
  const n = Number(value);
  return options.includes(n) ? n : def;
}





function buildArgs(formatId, options = {}) {
  const fmt = formatById(formatId);
  if (!fmt) throw new Error(`不支持的转换格式：${formatId}`);
  const args = ['-map', '0:a:0', '-map_metadata', '0'];

  
  
  if (KEEP_COVER.has(formatId)) {
    args.push('-map', '0:v?', '-c:v', 'copy', '-disposition:v', 'attached_pic');
  }

  switch (formatId) {
    case 'flac': {
      const level = clampNumber(options.compressionLevel, fmt.compression);
      args.push('-c:a', 'flac', '-compression_level', String(level));
      break;
    }
    case 'wav': {
      const depth = pickOption(options.bitDepth, fmt.bitDepth.options, fmt.bitDepth.default);
      args.push('-c:a', fmt.codecByDepth[depth] || fmt.codec);
      break;
    }
    case 'mp3': {
      const mode = options.rateMode === 'cbr' ? 'cbr' : 'vbr';
      if (mode === 'cbr') {
        const br = pickOption(options.bitrate, fmt.bitrate.options, fmt.bitrate.default);
        args.push('-c:a', 'libmp3lame', '-b:a', `${br}k`);
      } else {
        const q = clampNumber(options.quality, fmt.quality);
        args.push('-c:a', 'libmp3lame', '-q:a', String(q));
      }
      break;
    }
    case 'aac': {
      const mode = options.rateMode === 'cbr' ? 'cbr' : 'vbr';
      if (mode === 'cbr') {
        const br = pickOption(options.bitrate, fmt.bitrate.options, fmt.bitrate.default);
        args.push('-c:a', 'aac', '-b:a', `${br}k`);
      } else {
        const q = clampNumber(options.quality, fmt.quality);
        args.push('-c:a', 'aac', '-q:a', String(q));
      }
      break;
    }
    case 'vorbis': {
      const mode = options.rateMode === 'cbr' ? 'cbr' : 'vbr';
      if (mode === 'cbr') {
        const br = pickOption(options.bitrate, fmt.bitrate.options, fmt.bitrate.default);
        args.push('-c:a', 'libvorbis', '-b:a', `${br}k`);
      } else {
        const q = clampNumber(options.quality, fmt.quality);
        args.push('-c:a', 'libvorbis', '-q:a', String(q));
      }
      break;
    }
    default:
      throw new Error(`不支持的转换格式：${formatId}`);
  }

  
  return args;
}


const KEEP_COVER = new Set(['flac', 'mp3', 'aac']);


function buildCommand(ffmpegPath, input, output, formatId, options = {}) {
  return [
    ffmpegPath, '-hide_banner', '-nostdin', '-y', '-i', input,
    ...buildArgs(formatId, options),
    '-progress', 'pipe:1', '-nostats', output,
  ];
}


function targetPath(dir, baseName, ext) {
  const safe = String(baseName || 'output')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'output';
  let out = path.join(dir, `${safe}.${ext}`);
  let n = 1;
  while (fs.existsSync(out)) out = path.join(dir, `${safe} (${++n}).${ext}`);
  return out;
}


function progressFromLine(line, durationSec) {
  const m = /^out_time_(?:us|ms)=(\d+)/.exec(line.trim());
  if (!m || !durationSec) return null;
  const seconds = /us=/.test(line) ? Number(m[1]) / 1e6 : Number(m[1]) / 1e3;
  if (!Number.isFinite(seconds)) return null;
  return Math.max(0, Math.min(1, seconds / durationSec));
}





function convert({ ffmpeg, input, output, formatId, options = {}, duration = 0, onProgress, onSpawn }) {
  return new Promise((resolve) => {
    const [cmd, ...args] = buildCommand(ffmpeg, input, output, formatId, options);
    const child = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderrTail = '';
    let cancelled = false;

    
    child.cancel = () => { cancelled = true; try { child.kill(); } catch {  } };
    if (onSpawn) onSpawn(child);

    child.stdout.on('data', (chunk) => {
      for (const line of chunk.toString().split('\n')) {
        const p = progressFromLine(line, duration);
        if (p !== null && onProgress) onProgress(p);
      }
    });
    child.stderr.on('data', (d) => {
      stderrTail = (stderrTail + d.toString()).slice(-2000);
    });
    child.on('error', (err) => resolve({ ok: false, error: err.message }));
    child.on('close', (code) => {
      if (cancelled) {
        try { fs.rmSync(output, { force: true }); } catch {  }
        return resolve({ ok: false, cancelled: true, error: '已取消' });
      }
      if (code === 0 && fs.existsSync(output)) return resolve({ ok: true, path: output });
      resolve({
        ok: false,
        error: `ffmpeg 退出码 ${code}：${stderrTail.split('\n').filter(Boolean).slice(-2).join(' | ') || '未知错误'}`,
      });
    });
  });
}

module.exports = {
  PARAM,
  FORMATS,
  formatById,
  defaultOptions,
  clampNumber,
  pickOption,
  buildArgs,
  buildCommand,
  targetPath,
  progressFromLine,
  convert,
};
