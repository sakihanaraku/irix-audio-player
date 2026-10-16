

import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { testDeviceId } from './_device.mjs';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { resolveTools } = require('../src/main/ffmpeg.js');
const { Playlist } = require('../src/main/playlist.js');
const { PlayerSession } = require('../src/main/player.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mediaDir = path.join(projectRoot, 'test', 'media');
const tools = resolveTools({ explicitPath: process.env.AURORA_FFMPEG || '', appRoot: projectRoot });

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

console.log('=== 主进程业务流程端到端测试 ===');
console.log('ffmpeg:', tools.ffmpeg);

const tmpPlaylist = path.join(os.tmpdir(), `aurora-playlist-${Date.now()}.json`);
const playlist = new Playlist(tmpPlaylist);
playlist.load();


console.log('\n[1] 拖入导入与格式识别');
const dropPaths = [
  path.join(mediaDir, 'tone-44k.flac'),
  path.join(mediaDir, 'tone-320k.mp3'),
  path.join(mediaDir, 'tone-16bit-44k.wav'),
  path.join(mediaDir, 'tone-lossless-96k-24.flac'),
  path.join(mediaDir, 'tone-mono-22k.wav'),
  path.join(mediaDir, 'broken.mp3'),
  mediaDir, 
];
const addRes = await playlist.add(dropPaths, tools);
const exts = addRes.added.map((t) => t.ext);
check('导入文件+文件夹', addRes.added.length >= 11, `新增 ${addRes.added.length} 首，扫描 ${addRes.scanned} 个文件`);
check('flac 被识别', exts.includes('flac'), '');
check('wav 被识别', exts.includes('wav'), '');
check('mp3 被识别', exts.includes('mp3'), '');
check('其余格式（m4a/ogg/opus/wma）', ['m4a', 'ogg', 'opus', 'wma'].every((e) => exts.includes(e)), exts.join(','));
const brokenTrack = addRes.added.find((t) => t.name === 'broken.mp3');
check('损坏文件被标记为不可解码', brokenTrack && brokenTrack.ok === false, brokenTrack?.error || '');
const flac24 = addRes.added.find((t) => t.name === 'tone-lossless-96k-24.flac');
check('FLAC 24bit 元数据正确', flac24 && flac24.bits === 24 && flac24.sampleRate === 96000 && flac24.lossless,
  `${flac24?.sampleRate}Hz/${flac24?.bits}bit lossless=${flac24?.lossless}`);

const dup = await playlist.add([path.join(mediaDir, 'tone-44k.flac')], tools);
check('重复导入被去重', dup.added.length === 0 && dup.skipped === 1, `skipped=${dup.skipped}`);

const wavTrack = playlist.list().find((t) => t.name === 'tone-16bit-44k.wav');
const flacTrack = playlist.list().find((t) => t.name === 'tone-lossless-96k-24.flac');
check('测试曲目已就位', !!wavTrack && !!flacTrack, `${wavTrack?.name} / ${flacTrack?.name}`);


console.log('\n[2] 列表管理');
const before = playlist.list().map((t) => t.id);
const moveId = playlist.list().find((t) => t.name === 'tone-128k.mp3')?.id || before[3];
await playlist.reorder(moveId, 0);
const after = playlist.list().map((t) => t.id);
check('拖动排序生效', after[0] === moveId, `指定曲目移到首位`);
await playlist.remove(after[0]);
check('移除曲目', !playlist.list().some((t) => t.id === moveId), `剩余 ${playlist.list().length} 首`);
const persisted = JSON.parse(fs.readFileSync(tmpPlaylist, 'utf8'));
check('播放列表已持久化', persisted.items.length === playlist.list().length, `${persisted.items.length} 首写入磁盘`);


console.log('\n[3] 播放控制（真实声卡输出）');
const session = new PlayerSession({ appRoot: projectRoot });
session.setTools(tools);
session.setVolume(0.2);

const settings = {
  backend: 'wasapi-shared', deviceId: testDeviceId(session), sampleRate: 48000, channels: 2, bits: 32,
  exclusive: false, bufferMs: 100, periodMs: 10, ringMs: 800, allowFormatFallback: true,
};
const events = [];
session.on('ended', () => events.push('ended'));
session.on('error', (e) => events.push('error:' + e.message));

let st = await session.play(wavTrack, settings, {});
check('打开声卡并开始播放', st.status === 'playing', `${st.deviceName} ${JSON.stringify(st.format)}`);
check('输出格式跟随设置', st.format.sampleRate === 48000 && st.format.channels === 2, JSON.stringify({ r: st.format.sampleRate, c: st.format.channels, b: st.format.bits }));

await sleep(1200);
let played = (session.output.stats().framesRendered - session.baseFrames) / st.format.sampleRate;
check('实际播放约 1.2s', played > 0.9 && played < 2.0, `${played.toFixed(2)}s`);

st = session.pause();
await sleep(400);
const pausedFrames = session.output.stats().framesRendered;
await sleep(400);
check('暂停后不再消耗音频数据', session.output.stats().framesRendered === pausedFrames, `帧数停在 ${pausedFrames}`);
check('状态为 paused', st.status === 'paused', st.status);

session.resume();
await sleep(600);
const resumed = session.output.stats().framesRendered;
check('恢复后继续播放', resumed > pausedFrames, `+${resumed - pausedFrames} 帧`);


const seekTarget = 4.0;
st = await session.seek(seekTarget, settings);
await sleep(700);
const pos = session.state().position;
check('拖动定位到 4s', Math.abs(pos - seekTarget) < 1.2, `当前位置 ${pos.toFixed(2)}s`);
check('定位后仍在播放', session.state().status === 'playing', session.state().status);


session.setVolume(0.35);
check('音量设置生效', Math.abs(session.output.stats().volume - 0.35) < 0.01, String(session.output.stats().volume));


console.log('\n[4] 切换曲目（不同采样率/位深）');
st = await session.play(flacTrack, settings, {});
await sleep(1000);
const flacPlayed = (session.output.stats().framesRendered - session.baseFrames) / st.format.sampleRate;
check('切换到 96kHz/24bit FLAC 并出声', flacPlayed > 0.7, `${flacPlayed.toFixed(2)}s @ ${st.format.sampleRate}Hz`);
check('输出格式不变（解码端重采样）', st.format.sampleRate === 48000, `${st.format.sampleRate}Hz`);


{
  const progress = await new Promise((resolve) => {
    session.once('progress', resolve);
  });
  const lat = progress.latencyMs;
  check('进度事件带音频延迟（供峰值计对齐）',
    Number.isFinite(lat) && lat > 0 && lat <= 2000,
    `latencyMs=${lat} · bufferedMs=${progress.bufferedMs} · peaks=${JSON.stringify((progress.peaks || []).map((v) => +v.toFixed(3)))}`);
  check('延迟与实际缓冲量级一致',
    Math.abs(lat - progress.bufferedMs) <= 300,
    `latency ${lat}ms vs buffered ${progress.bufferedMs}ms`);
}



{
  const before = await new Promise((resolve) => session.once('progress', resolve));
  await session.seek(3, settings);
  const after = await new Promise((resolve) => session.once('progress', resolve));
  await sleep(150);
  const settled = await new Promise((resolve) => session.once('progress', resolve));
  check('seek 后帧位置重新计数（界面据此清空峰值历史）',
    settled.writtenFrames < before.writtenFrames,
    `跳转前 written=${Math.round(before.writtenFrames)} 帧 → 跳转后 ${Math.round(settled.writtenFrames)} 帧`);
  check('seek 后音频时钟仍然有效', Number.isFinite(after.writtenFrames) && after.writtenFrames >= 0 &&
    Number.isFinite(after.playedFrames), `written=${Math.round(after.writtenFrames)} played=${Math.round(after.playedFrames)}`);
}


console.log('\n[4.5] 停止后回到初始状态');
{
  const playing = session.state();
  check('停止前有当前曲目', !!playing.trackId && playing.position > 0,
    `trackId=${playing.trackId} position=${playing.position.toFixed(2)}s`);
  const fileBefore = fs.readFileSync(tmpPlaylist, 'utf8');
  const itemsBefore = playlist.list().length;
  const stopped = session.stop();
  const fileAfter = fs.readFileSync(tmpPlaylist, 'utf8');
  check('停止后清空当前曲目', stopped.trackId === null, `trackId=${stopped.trackId}`);
  check('停止后状态为 idle', stopped.status === 'idle', stopped.status);
  check('停止后进度与时长归零', stopped.position === 0 && stopped.duration === 0,
    `position=${stopped.position} duration=${stopped.duration}`);
  check('停止后仍在后台（声卡保持打开）', !!stopped.format && !!stopped.deviceName,
    `${stopped.deviceName} ${stopped.format?.sampleRate}Hz`);
  check('停止不影响播放列表（内存）', playlist.list().length === itemsBefore && itemsBefore > 0,
    `${itemsBefore} → ${playlist.list().length} 首`);
  check('停止不写播放列表文件（磁盘）', fileBefore === fileAfter, 'playlist.json 字节数未变');
  
  const restarted = await session.play(flacTrack, settings, {});
  check('停止后可重新播放', restarted.trackId === flacTrack.id && restarted.status === 'playing',
    `${restarted.status} trackId=${restarted.trackId}`);
}


console.log('\n[5] 切换声卡工作模式');
for (const backend of ['wasapi-exclusive', 'directsound', 'mme']) {
  
  
  
  const s2 = {
    ...settings, backend, exclusive: backend === 'wasapi-exclusive',
    deviceId: testDeviceId(session, backend),
  };
  
  session.stopSource();
  session.closeEngine();
  session.status = 'idle';
  try {
    st = await session.play(flacTrack, s2, {});
    await sleep(900);
    const secs = (session.output.stats().framesRendered - session.baseFrames) / st.format.sampleRate;
    check(`切换到 ${backend}`, secs > 0.6, `${st.deviceName} ${st.format.sampleRate}Hz/${st.format.channels}ch/${st.format.bits}bit 播放 ${secs.toFixed(2)}s`);
  } catch (err) {
    check(`切换到 ${backend}`, false, err.message);
  }
}


session.release();
check('释放声卡', session.state().format === null && session.state().status === 'idle', '');


console.log('\n[7] 播放列表保存与读取（.playlist）');
{
  const outFile = path.join(path.dirname(tmpPlaylist), `iRix-播放列表-${Date.now()}.playlist`);
  const payload = await playlist.saveTo(outFile);
  const raw = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  check('写出 .playlist 文件', fs.existsSync(outFile) && fs.statSync(outFile).size > 200,
    `${(fs.statSync(outFile).size / 1024).toFixed(1)} KB`);
  check('扩展名与格式标记正确',
    outFile.endsWith('.playlist') && raw.format === 'irix-playlist' && raw.version === 1,
    `${raw.format} v${raw.version}`);
  check('记录曲目数量', payload.count === playlist.list().length && raw.items.length === raw.count,
    `${raw.count} 首`);
  check('每条都带完整路径', raw.items.every((it) => typeof it.path === 'string' && it.path.length > 3),
    raw.items[0]?.path);
  check('每条都带元数据（标题/编码/采样率）',
    raw.items.some((it) => it.title && it.codec && it.sampleRate),
    `${raw.items[0]?.title} · ${raw.items[0]?.codec} · ${raw.items[0]?.sampleRate}Hz`);

  const paths = await Playlist.readPaths(outFile);
  check('能读回全部路径', paths.length === raw.count && paths.every((p) => p.startsWith(mediaDir)),
    `${paths.length} 条`);

  
  const tmp2 = path.join(os.tmpdir(), `irix-reload-${Date.now()}.json`);
  const pl2 = new Playlist(tmp2);
  pl2.load();
  const res2 = await pl2.add(paths.slice(0, 3), tools, {});
  check('读回的路径可以重新导入', res2.added.length === 3, `${res2.added.length} 首`);
  fs.rmSync(tmp2, { force: true });

  
  const plain = path.join(os.tmpdir(), `irix-plain-${Date.now()}.playlist`);
  fs.writeFileSync(plain, JSON.stringify(paths.slice(0, 2)), 'utf8');
  check('兼容纯路径数组格式', (await Playlist.readPaths(plain)).length === 2, '');
  fs.rmSync(plain, { force: true });
  fs.rmSync(outFile, { force: true });
}

session.dispose();
fs.rmSync(tmpPlaylist, { force: true });

const failed = checks.filter((c) => !c.ok);
console.log(`\n=== 汇总: ${checks.length - failed.length}/${checks.length} 通过 ===`);
if (failed.length) {
  for (const f of failed) console.error(`  ✗ ${f.name}: ${f.detail}`);
  process.exit(1);
}
process.exit(0);
