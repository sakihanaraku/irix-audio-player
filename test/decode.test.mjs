

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { testDeviceId } from './_device.mjs';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { resolveTools, probeFile, extractCover } = require('../src/main/ffmpeg.js');
const { PlayerSession } = require('../src/main/player.js');

const args = process.argv.slice(2);
const getArg = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const backend = getArg('backend', 'wasapi-shared');
const playSeconds = Number(getArg('seconds', '1.2'));
const mediaDir = path.join(projectRoot, 'test', 'media');

const tools = resolveTools({ explicitPath: process.env.AURORA_FFMPEG || '', appRoot: projectRoot });
console.log('=== ffmpeg 解码 + 引擎播放 集成测试 ===');
console.log('ffmpeg :', tools.ffmpeg);
console.log('ffprobe:', tools.ffprobe || '(无，将解析 ffmpeg -i 输出)');
console.log('后端   :', backend, '\n');

if (!tools.ffmpeg) {
  console.error('未找到 ffmpeg');
  process.exit(1);
}
if (!fs.existsSync(mediaDir)) {
  console.error(`缺少测试媒体 ${mediaDir}，请先运行 npm run test:media`);
  process.exit(1);
}

const AUDIO_EXT = new Set(['flac', 'wav', 'mp3', 'm4a', 'aac', 'ogg', 'opus', 'wma', 'ape', 'aiff', 'dsf']);
const files = fs.readdirSync(mediaDir)
  .filter((f) => !f.endsWith('.json'))
  
  .filter((f) => AUDIO_EXT.has(path.extname(f).slice(1).toLowerCase()) || f === 'broken.mp3')
  .map((f) => path.join(mediaDir, f))
  .sort();


console.log('--- 格式识别 ---');
const probes = [];
for (const f of files) {
  const meta = await probeFile(f, tools);
  probes.push({ file: path.basename(f), meta });
  const tag = meta.ok
    ? `${String(meta.codec).padEnd(12)} ${String(meta.sampleRate).padStart(6)}Hz ${String(meta.channels)}ch ` +
      `${String(meta.bits || '-').padStart(3)}bit ${meta.lossless ? '无损' : '有损'} ${meta.duration.toFixed(2)}s`
    : `无法识别: ${meta.error}`;
  console.log(`  ${meta.ok ? '✓' : '✗'} ${path.basename(f).padEnd(28)} ${tag}`);
}
const recognized = probes.filter((p) => p.meta.ok);
const broken = probes.find((p) => p.file === 'broken.mp3');
const mustRecognize = ['wav', 'flac', 'mp3'];
const missing = mustRecognize.filter(
  (ext) => !recognized.some((p) => p.file.toLowerCase().endsWith(ext))
);
if (missing.length) console.error(`✗ 必须识别的格式缺失: ${missing.join(', ')}`);
if (broken && broken.meta.ok) console.error('✗ 损坏文件不应被识别为可播放');


console.log('\n--- 元数据标签 / 内嵌封面 ---');
const coverChecks = [];
for (const name of ['tone-with-cover.flac', 'tone-with-cover.mp3']) {
  const full = path.join(mediaDir, name);
  if (!fs.existsSync(full)) continue;
  const meta = await probeFile(full, tools);
  const okTags = !!(meta.title && meta.artist && meta.album && meta.year);
  console.log(`  ${okTags ? '✓' : '✗'} ${name.padEnd(24)} 标题="${meta.title}" 艺术家="${meta.artist}" ` +
    `专辑="${meta.album}" 年份="${meta.year}" 流派="${meta.genre || '-'}" 音轨="${meta.track || '-'}"`);
  coverChecks.push(okTags);

  const hasCover = meta.hasCover === true;
  console.log(`  ${hasCover ? '✓' : '✗'} ${''.padEnd(24)} 探测到封面: ${meta.hasCover}`);
  coverChecks.push(hasCover);

  const cover = await extractCover(full, tools, { maxSize: 512 });
  const okCover = !!cover && cover.dataUrl.startsWith('data:image/') && cover.bytes > 500;
  console.log(`  ${okCover ? '✓' : '✗'} ${''.padEnd(24)} 封面提取: ${cover ? `${cover.mime} ${cover.bytes} 字节` : '失败'}`);
  coverChecks.push(okCover);
}

const noCover = await extractCover(path.join(mediaDir, 'tone-44k.flac'), tools, { maxSize: 512 });
const okNoCover = noCover === null;
console.log(`  ${okNoCover ? '✓' : '✗'} ${''.padEnd(24)} 无封面文件返回 null: ${noCover === null}`);
coverChecks.push(okNoCover);
const noCoverProbe = await probeFile(path.join(mediaDir, 'tone-44k.flac'), tools);
console.log(`  ${noCoverProbe.hasCover === false ? '✓' : '✗'} ${''.padEnd(24)} 无封面文件 hasCover=false`);
coverChecks.push(noCoverProbe.hasCover === false);


console.log(`\n--- 实际播放（每个 ${playSeconds}s，后端 ${backend}）---`);
const session = new PlayerSession({ appRoot: projectRoot });
session.setTools(tools);
session.setVolume(0.25);

const settings = {
  backend, deviceId: testDeviceId(session), sampleRate: 48000, channels: 2, bits: 32, exclusive: backend === 'wasapi-exclusive',
  bufferMs: 100, periodMs: 10, ringMs: 800, allowFormatFallback: true,
};

const results = [];
for (const { file, meta } of probes) {
  if (!meta.ok) {
    results.push({ file, played: false, reason: '无法解码（预期行为）', expected: true });
    continue;
  }
  const track = {
    id: file, path: path.join(mediaDir, file), name: file, duration: meta.duration,
    ok: true,
  };
  const st = await session.play(track, settings, {});
  const rate = st.format.sampleRate;
  const warmupFrames = Math.round(rate * 0.25);          
  const targetFrames = warmupFrames + Math.round(playSeconds * rate);
  const t0 = Date.now();
  let stats = session.output.stats();
  let playedFrames = stats.framesRendered - session.baseFrames;

  
  while (playedFrames < warmupFrames && Date.now() - t0 < 10000) {
    await new Promise((r) => setTimeout(r, 20));
    stats = session.output.stats();
    playedFrames = stats.framesRendered - session.baseFrames;
  }
  const baseUnderruns = stats.underrunEvents;

  while (playedFrames < targetFrames && Date.now() - t0 < 15000) {
    await new Promise((r) => setTimeout(r, 50));
    stats = session.output.stats();
    playedFrames = stats.framesRendered - session.baseFrames;
  }
  const seconds = (playedFrames - warmupFrames) / rate;
  const trackUnderruns = stats.underrunEvents - baseUnderruns;
  const ok = playedFrames > 0 && seconds >= playSeconds * 0.9 && trackUnderruns === 0;
  console.log(`  ${ok ? '✓' : '✗'} ${file.padEnd(28)} 解码 ${meta.codec}/${meta.sampleRate}Hz -> 输出 ` +
    `${st.format.sampleRate}Hz/${st.format.channels}ch/${st.format.bits}bit 播放 ${seconds.toFixed(2)}s ` +
    `稳态欠载 ${trackUnderruns}${stats.lastError ? ' 错误:' + stats.lastError : ''}`);
  results.push({ file, played: ok, seconds: Number(seconds.toFixed(2)), underruns: trackUnderruns,
    outputFormat: `${st.format.sampleRate}/${st.format.channels}/${st.format.bits}` });
  session.stop();
}

session.dispose();

const playedOk = results.filter((r) => r.played || r.expected);
const failures = results.filter((r) => !r.played && !r.expected);
console.log('\n=== 汇总 ===');
console.log(`格式识别通过 ${recognized.length}/${probes.length}（损坏文件被正确拒绝: ${broken ? !broken.meta.ok : 'n/a'}）`);
console.log(`实际播放通过 ${playedOk.length}/${results.length}`);
console.log(`封面/标签检查通过 ${coverChecks.filter(Boolean).length}/${coverChecks.length}`);
if (missing.length || failures.length || coverChecks.some((c) => !c)) {
  console.error('失败项:', missing.join(','), JSON.stringify(failures), `封面检查 ${coverChecks.filter(Boolean).length}/${coverChecks.length}`);
  process.exit(1);
}
process.exit(0);
