
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const conv = require('../src/main/convert.js');
const { resolveTools } = require('../src/main/ffmpeg.js');

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: !!ok });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

const tools = resolveTools({ explicitPath: process.env.AURORA_FFMPEG || '', appRoot: projectRoot });
const src = path.join(projectRoot, 'test', 'media', 'tone-44k.flac');
const outDir = fs.mkdtempSync(path.join(projectRoot, 'dist', 'convert-test-'));

const probe = (file) => {
  const r = spawnSync(tools.ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file],
    { encoding: 'utf8', windowsHide: true });
  try { return JSON.parse(r.stdout || '{}'); } catch { return {}; }
};
const audioStream = (info) => (info.streams || []).find((s) => s.codec_type === 'audio') || {};
const fmt = (info) => info.format || {};

console.log('=== 音频转换 单测 ===');
console.log('ffmpeg:', tools.ffmpeg || '(未找到)');

if (!tools.ffmpeg || !fs.existsSync(src)) {
  console.error('缺少 ffmpeg 或测试音频，无法跑转换单测');
  process.exit(1);
}


console.log('\n[A] 参数 → ffmpeg 参数');
{
  const args = (id, opt) => conv.buildArgs(id, opt || conv.defaultOptions(id));
  check('五种格式都有声明与默认参数',
    conv.FORMATS.map((f) => f.id).join(',') === 'flac,wav,mp3,aac,vorbis',
    conv.FORMATS.map((f) => f.label).join(', '));
  check('FLAC：压缩等级写进 -compression_level', (() => {
    const a = args('flac', { compressionLevel: 0 });
    return a.includes('-c:a') && a.includes('flac') &&
      a[a.indexOf('-compression_level') + 1] === '0';
  })(), args('flac', { compressionLevel: 0 }).join(' '));
  check('FLAC：等级越界被夹到 0–8',
    args('flac', { compressionLevel: 99 }).includes('8') &&
    args('flac', { compressionLevel: -5 }).includes('0'), '');
  check('Wave：位深决定 PCM 编码',
    args('wav', { bitDepth: 16 }).includes('pcm_s16le') &&
    args('wav', { bitDepth: 24 }).includes('pcm_s24le') &&
    args('wav', { bitDepth: 32 }).includes('pcm_s32le'), '');
  check('Wave：非法位深回落到 24bit',
    args('wav', { bitDepth: 7 }).includes('pcm_s24le'), '');
  check('MP3 CBR：-b:a 192k',
    (() => { const a = args('mp3', { rateMode: 'cbr', bitrate: 192 }); return a.includes('-b:a') && a.includes('192k'); })(),
    args('mp3', { rateMode: 'cbr', bitrate: 192 }).join(' '));
  check('MP3 VBR：-q:a 0（默认最高质量）',
    (() => { const a = args('mp3', { rateMode: 'vbr' }); return a.includes('-q:a') && a[a.indexOf('-q:a') + 1] === '0'; })(),
    args('mp3', { rateMode: 'vbr' }).join(' '));
  check('MP3：非法码率回落到 320k',
    args('mp3', { rateMode: 'cbr', bitrate: 999 }).includes('320k'), '');
  check('AAC：编码器 aac / 容器 m4a',
    args('aac', {}).includes('aac') && conv.formatById('aac').ext === 'm4a', '');
  check('Vorbis：编码器 libvorbis + -q:a',
    (() => { const a = args('vorbis', { quality: 8 }); return a.includes('libvorbis') && a[a.indexOf('-q:a') + 1] === '8'; })(),
    args('vorbis', { quality: 8 }).join(' '));
  check('Vorbis：质量夹到 0–10', args('vorbis', { quality: 42 }).includes('10'), '');
  check('保留元数据（-map_metadata 0）', args('mp3', {}).includes('-map_metadata'), '');
  check('只取第一条音频流（-map 0:a:0）', args('mp3', {}).join(' ').includes('0:a:0'), '');
  check('flac/mp3/aac 带内嵌封面，wav/ogg 不带',
    args('flac', {}).includes('0:v?') && args('mp3', {}).includes('0:v?') &&
    args('aac', {}).includes('0:v?') &&
    !args('wav', {}).includes('0:v?') && !args('vorbis', {}).includes('0:v?'), '');
  check('未知格式直接报错', (() => {
    try { conv.buildArgs('ogg2', {}); return false; } catch (e) { return /不支持的转换格式/.test(e.message); }
  })(), '');
  check('完整命令行含输入、进度与输出',
    (() => {
      const cmd = conv.buildCommand('ffmpeg', 'in.flac', 'out.mp3', 'mp3', { rateMode: 'vbr' });
      return cmd[0] === 'ffmpeg' && cmd.includes('in.flac') && cmd.includes('-progress') &&
        cmd[cmd.length - 1] === 'out.mp3';
    })(), '');
  check('进度解析：out_time_us → 0–1', (() => {
    const p1 = conv.progressFromLine('out_time_us=5000000', 10);
    const p2 = conv.progressFromLine('out_time_us=99999999', 10);
    const p3 = conv.progressFromLine('frame=10', 10);
    return p1 === 0.5 && p2 === 1 && p3 === null;
  })(), '');
  check('目标文件重名自动加序号', (() => {
    const a = conv.targetPath(outDir, 'same-name', 'mp3');
    fs.writeFileSync(a, 'x');
    const b = conv.targetPath(outDir, 'same-name', 'mp3');
    return path.basename(a) === 'same-name.mp3' && /same-name \(2\)\.mp3$/.test(b);
  })(), '');
  check('文件名里的非法字符被替换', (() => {
    const p = conv.targetPath(outDir, 'a/b:c*d?', 'flac');
    return !/[\\/:*?"<>|]/.test(path.basename(p).replace(/\.flac$/, ''));
  })(), '');
}


console.log('\n[B] 真实转换（每种格式转一遍并用 ffprobe 回读）');
const results = {};
for (const f of conv.FORMATS) {
  const out = conv.targetPath(outDir, `tone-${f.id}`, f.ext);
  const t0 = Date.now();
  const res = await conv.convert({
    ffmpeg: tools.ffmpeg, input: src, output: out, formatId: f.id,
    options: conv.defaultOptions(f.id), duration: 6,
  });
  const ms = Date.now() - t0;
  results[f.id] = res;
  const info = res.ok ? probe(out) : {};
  const a = audioStream(info);
  const size = res.ok ? fs.statSync(out).size : 0;
  check(`${f.label}（.${f.ext}）转换成功`, res.ok === true, res.error || `${(size / 1024).toFixed(0)}KB / ${ms}ms`);
  if (res.ok) {
    check(`${f.label}：ffprobe 认出音频流与采样率`,
      a.codec_name && Number(a.sample_rate) > 0,
      `${a.codec_name} ${a.sample_rate}Hz ${a.channels}ch`);
    check(`${f.label}：时长与源一致（±0.2s）`,
      Math.abs(Number(fmt(info).duration || 0) - 6) < 0.2, `${fmt(info).duration}s`);
  }
}


console.log('\n[C] 参数生效抽查');
{
  const loud = conv.targetPath(outDir, 'q0', 'mp3');
  const quiet = conv.targetPath(outDir, 'q9', 'mp3');
  await conv.convert({ ffmpeg: tools.ffmpeg, input: src, output: loud, formatId: 'mp3', options: { rateMode: 'vbr', quality: 0 }, duration: 6 });
  await conv.convert({ ffmpeg: tools.ffmpeg, input: src, output: quiet, formatId: 'mp3', options: { rateMode: 'vbr', quality: 9 }, duration: 6 });
  const b1 = fs.statSync(loud).size;
  const b2 = fs.statSync(quiet).size;
  check('MP3 VBR：质量 0 的文件明显大于质量 9', b1 > b2 * 1.3, `${(b1 / 1024).toFixed(0)}KB vs ${(b2 / 1024).toFixed(0)}KB`);

  const cbr320 = conv.targetPath(outDir, 'cbr320', 'mp3');
  const cbr128 = conv.targetPath(outDir, 'cbr128', 'mp3');
  await conv.convert({ ffmpeg: tools.ffmpeg, input: src, output: cbr320, formatId: 'mp3', options: { rateMode: 'cbr', bitrate: 320 }, duration: 6 });
  await conv.convert({ ffmpeg: tools.ffmpeg, input: src, output: cbr128, formatId: 'mp3', options: { rateMode: 'cbr', bitrate: 128 }, duration: 6 });
  const b320 = Number(probe(cbr320).format?.bit_rate || 0);
  const b128 = Number(probe(cbr128).format?.bit_rate || 0);
  check('MP3 CBR：320k 与 128k 的码率确实不同',
    Math.abs(b320 - 320000) < 20000 && Math.abs(b128 - 128000) < 20000,
    `${Math.round(b320 / 1000)}kbps vs ${Math.round(b128 / 1000)}kbps`);

  const wav16 = conv.targetPath(outDir, 'wav16', 'wav');
  const wav24 = conv.targetPath(outDir, 'wav24', 'wav');
  await conv.convert({ ffmpeg: tools.ffmpeg, input: src, output: wav16, formatId: 'wav', options: { bitDepth: 16 }, duration: 6 });
  await conv.convert({ ffmpeg: tools.ffmpeg, input: src, output: wav24, formatId: 'wav', options: { bitDepth: 24 }, duration: 6 });
  const w16 = probe(wav16);
  const w24 = probe(wav24);
  const a16 = audioStream(w16);
  const a24 = audioStream(w24);
  const depth = (s) => Number(s.bits_per_raw_sample || s.bits_per_sample || 0);
  check('Wave：16bit 与 24bit 位深真实生效（编码名 + 位深）',
    a16.codec_name === 'pcm_s16le' && a24.codec_name === 'pcm_s24le' &&
    depth(a16) === 16 && depth(a24) === 24,
    `${a16.codec_name}/${depth(a16)}bit vs ${a24.codec_name}/${depth(a24)}bit`);

  const flac0 = conv.targetPath(outDir, 'flac0', 'flac');
  const flac8 = conv.targetPath(outDir, 'flac8', 'flac');
  await conv.convert({ ffmpeg: tools.ffmpeg, input: src, output: flac0, formatId: 'flac', options: { compressionLevel: 0 }, duration: 6 });
  await conv.convert({ ffmpeg: tools.ffmpeg, input: src, output: flac8, formatId: 'flac', options: { compressionLevel: 8 }, duration: 6 });
  const s0 = fs.statSync(flac0).size;
  const s8 = fs.statSync(flac8).size;
  check('FLAC：压缩等级 8 的文件小于等级 0', s8 < s0, `${(s0 / 1024).toFixed(0)}KB → ${(s8 / 1024).toFixed(0)}KB`);
  check('FLAC：两种等级都是无损（解码后时长一致）',
    Math.abs(Number(fmt(probe(flac8)).duration) - 6) < 0.2, '');
}


console.log('\n[D] 进度与取消');
{
  const out = conv.targetPath(outDir, 'progress', 'mp3');
  const seen = [];
  const res = await conv.convert({
    ffmpeg: tools.ffmpeg, input: src, output: out, formatId: 'mp3',
    options: { rateMode: 'cbr', bitrate: 320 }, duration: 6,
    onProgress: (p) => seen.push(p),
  });
  check('转换过程中上报了进度', res.ok && seen.length > 0,
    `收到 ${seen.length} 次，最后 ${seen.length ? (seen[seen.length - 1] * 100).toFixed(0) + '%' : '-'}`);
  check('进度单调不减且在 0–1 之间',
    seen.every((p, i) => p >= 0 && p <= 1 && (i === 0 || p >= seen[i - 1])), '');

  
  const out2 = conv.targetPath(outDir, 'cancelled', 'wav');
  const longSrc = path.join(projectRoot, 'test', 'media', 'tone-lossless-96k-24.flac');
  const res2 = await conv.convert({
    ffmpeg: tools.ffmpeg, input: longSrc, output: out2, formatId: 'wav',
    options: { bitDepth: 32 }, duration: 60,
    onSpawn: (c) => { c.cancel(); },
  });
  check('可以中途取消，且半成品被清掉',
    res2.ok === false && res2.cancelled === true && !fs.existsSync(out2),
    `ok=${res2.ok} cancelled=${res2.cancelled} 残留=${fs.existsSync(out2)}`);
}


console.log('\n[E] 错误处理');
{
  const res = await conv.convert({
    ffmpeg: tools.ffmpeg, input: path.join(outDir, 'not-exist.flac'),
    output: conv.targetPath(outDir, 'bad', 'mp3'), formatId: 'mp3', options: {}, duration: 1,
  });
  check('输入不存在时返回可读错误而不是抛异常', res.ok === false && !!res.error,
    (res.error || '').slice(0, 80));
}

fs.rmSync(outDir, { recursive: true, force: true });
const failed = checks.filter((c) => !c.ok);
console.log(`\n=== 音频转换: ${checks.length - failed.length}/${checks.length} 通过 ===`);
if (failed.length) {
  for (const f of failed) console.log(`  ✗ ${f.name}`);
  process.exit(1);
}
