
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolveTools } = require('../src/main/ffmpeg.js');

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(projectRoot, 'test', 'media');
fs.mkdirSync(outDir, { recursive: true });

const tools = resolveTools({ explicitPath: process.env.AURORA_FFMPEG || '', appRoot: projectRoot });
if (!tools.ffmpeg) {
  console.error('未找到 ffmpeg，无法生成测试媒体');
  process.exit(1);
}
console.log('ffmpeg:', tools.ffmpeg);

function run(args, label) {
  const r = spawnSync(tools.ffmpeg, args, { encoding: 'utf8', windowsHide: true });
  const ok = r.status === 0;
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : ' -> ' + (r.stderr || '').trim().split('\n').slice(-2).join(' | ')}`);
  return ok;
}


const specs = [
  { file: 'tone-16bit-44k.wav', args: ['-ar', '44100', '-ac', '2', '-sample_fmt', 's16'], freq: 440, label: 'WAV PCM16 44.1kHz' },
  { file: 'tone-24bit-96k.wav', args: ['-ar', '96000', '-ac', '2', '-sample_fmt', 's32', '-c:a', 'pcm_s24le'], freq: 523, label: 'WAV PCM24 96kHz' },
  { file: 'tone-lossless-96k-24.flac', args: ['-ar', '96000', '-ac', '2', '-sample_fmt', 's32', '-sample_fmt', 's32', '-bits_per_raw_sample', '24'], freq: 659, label: 'FLAC 96kHz/24bit' },
  { file: 'tone-44k.flac', args: ['-ar', '44100', '-ac', '2'], freq: 587, label: 'FLAC 44.1kHz' },
  { file: 'tone-320k.mp3', args: ['-ar', '44100', '-ac', '2', '-b:a', '320k'], freq: 330, label: 'MP3 320kbps' },
  { file: 'tone-128k.mp3', args: ['-ar', '44100', '-ac', '2', '-b:a', '128k'], freq: 294, label: 'MP3 128kbps' },
  { file: 'tone-aac.m4a', args: ['-ar', '48000', '-ac', '2', '-b:a', '192k'], freq: 392, label: 'AAC (m4a)' },
  { file: 'tone-vorbis.ogg', args: ['-ar', '48000', '-ac', '2', '-q:a', '6'], freq: 349, label: 'Ogg Vorbis' },
  { file: 'tone-opus.opus', args: ['-ar', '48000', '-ac', '2', '-b:a', '128k'], freq: 466, label: 'Opus' },
  { file: 'tone-wma.wma', args: ['-ar', '44100', '-ac', '2', '-b:a', '192k'], freq: 220, label: 'WMA' },
  { file: 'tone-mono-22k.wav', args: ['-ar', '22050', '-ac', '1', '-sample_fmt', 's16'], freq: 880, label: 'WAV 单声道 22.05kHz' },
];

const seconds = 6;
for (const s of specs) {
  const out = path.join(outDir, s.file);
  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi',
    '-i', `sine=frequency=${s.freq}:sample_rate=48000:duration=${seconds}`,
    ...s.args,
    ...(s.file.endsWith('.mp3') ? ['-c:a', 'libmp3lame'] : []),
    '-metadata', `title=测试音 ${s.freq}Hz`,
    '-metadata', 'artist=irix_selftest',
    '-metadata', 'album=Test Media',
    out,
  ];
  run(args, `${s.label} -> ${s.file}`);
}


fs.writeFileSync(path.join(outDir, 'broken.mp3'), 'this is not an audio file at all\n'.repeat(50));


const coverPng = path.join(outDir, 'cover.png');
run(['-hide_banner', '-loglevel', 'error', '-y',
  '-f', 'lavfi', '-i', 'color=c=0x1d2b36:s=600x600',
  '-vf', 'drawbox=x=0:y=0:w=600:h=280:color=0x2b4a5e@1:t=fill,' +
         'drawbox=x=200:y=200:w=200:h=200:color=0x35d07f@1:t=fill',
  '-frames:v', '1', coverPng], '生成封面图 cover.png（600×600 PNG）');

run(['-hide_banner', '-loglevel', 'error', '-y',
  '-i', path.join(outDir, 'tone-44k.flac'), '-i', coverPng,
  '-map', '0:a', '-map', '1:v', '-c:a', 'flac', '-c:v', 'copy',
  '-disposition:v', 'attached_pic',
  '-metadata', 'title=带封面的 FLAC', '-metadata', 'artist=irix_selftest',
  '-metadata', 'album=Cover Test', '-metadata', 'date=2026', '-metadata', 'genre=Test',
  '-metadata', 'track=1',
  path.join(outDir, 'tone-with-cover.flac')], 'FLAC（内嵌 PNG 封面）');

run(['-hide_banner', '-loglevel', 'error', '-y',
  '-i', path.join(outDir, 'tone-320k.mp3'), '-i', coverPng,
  '-map', '0:a', '-map', '1:v', '-c:a', 'copy', '-c:v', 'copy',
  '-id3v2_version', '3', '-disposition:v', 'attached_pic',
  '-metadata:s:v', 'title=Album cover', '-metadata:s:v', 'comment=Cover (front)',
  '-metadata', 'title=带封面的 MP3', '-metadata', 'artist=irix_selftest',
  '-metadata', 'album=Cover Test', '-metadata', 'date=2026',
  path.join(outDir, 'tone-with-cover.mp3')], 'MP3（内嵌 PNG 封面 / ID3v2 APIC）');

const files = fs.readdirSync(outDir);
console.log(`\n测试媒体目录: ${outDir}`);
for (const f of files) {
  const st = fs.statSync(path.join(outDir, f));
  console.log(`  ${f}  ${(st.size / 1024).toFixed(1)} KB`);
}
