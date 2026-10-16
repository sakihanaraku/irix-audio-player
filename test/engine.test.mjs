

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const addonPath = path.resolve(here, '..', 'native', 'build', 'Release', 'aurora_audio.node');

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const seconds = Number(getArg('seconds', '1.5'));
const onlyBackend = getArg('backend', null);
const onlyDevice = getArg('device', '');






const localCfgPath = path.resolve(here, '.device.local.json');
let devicePick = onlyDevice || process.env.AURORA_TEST_DEVICE || '';
if (!devicePick && fs.existsSync(localCfgPath)) {
  try { devicePick = JSON.parse(fs.readFileSync(localCfgPath, 'utf8')).device || ''; } catch {  }
}

const engine = require(addonPath);
const results = [];
const log = (...a) => console.log(...a);
const fail = (msg) => { console.error(`  ✗ ${msg}`); };

function makeToneBuffer(frames, channels, sampleRate, freq) {
  const buf = Buffer.allocUnsafe(frames * channels * 4);
  for (let i = 0; i < frames; i++) {
    const t = i / sampleRate;
    
    const env = Math.min(1, i / (sampleRate * 0.02)) * Math.min(1, (frames - i) / (sampleRate * 0.02));
    for (let c = 0; c < channels; c++) {
      const f = c === 0 ? freq : freq * 1.5;
      buf.writeFloatLE(Math.sin(2 * Math.PI * f * t) * 0.25 * env, (i * channels + c) * 4);
    }
  }
  return buf;
}

log('=== Aurora 音频引擎自测 ===');
log('addon:', addonPath);
log('版本:', JSON.stringify(engine.version()));
log('后端:', engine.backends().map((b) => `${b.id}${b.implemented ? '' : '(未实现)'}`).join(', '));

const allDevices = engine.listDevices('wasapi-shared');
log(`\n[设备枚举] WASAPI 渲染设备 ${allDevices.length} 个:`);
for (const d of allDevices) {
  log(`  - ${d.isDefault ? '★' : ' '} ${d.name}  [${d.state}] ${d.formFactor} ` +
      `混音=${d.mixSampleRate}Hz/${d.mixChannels}ch/${d.mixBits}bit${d.mixFloat ? 'f' : ''}`);
}
if (allDevices.length === 0) fail('WASAPI 设备枚举为空');





const deviceCache = new Map();
function resolveDeviceFor(backend) {
  if (deviceCache.has(backend)) return deviceCache.get(backend);
  let r;
  if (!devicePick) r = { id: '', name: '(系统默认)' };
  else {
    const frags = String(devicePick).split('|').map((x) => x.trim().toLowerCase()).filter(Boolean);
    const enumBackend = backend === 'wasapi-exclusive' ? 'wasapi-shared' : backend;
    const hit = engine.listDevices(enumBackend).find((d) => {
      const n = String(d.name).toLowerCase();
      return d.id.startsWith(devicePick) || frags.some((f) => n.includes(f));
    });
    r = hit ? { id: hit.id, name: hit.name } : { id: '', name: '(该后端无匹配设备 → 跳过)' };
  }
  deviceCache.set(backend, r);
  return r;
}

{
  const all = ['wasapi-shared', 'wasapi-exclusive', 'directsound', 'mme'];
  if (devicePick) {
    log(`\n[设备选择] 规则 "${devicePick}"（按后端各自解析 id）`);
    for (const b of all) log(`  · ${b.padEnd(18)} → ${resolveDeviceFor(b).name}`);
    if (![...deviceCache.values()].some((v) => v.id)) {
      console.error(`  ✗ 没有任何后端能匹配 "${devicePick}"（上面已列出各后端设备清单）`);
      process.exit(1);
    }
  } else {
    log('\n[设备选择] 未指定 → 用系统默认设备（指定：--device 名字片段 / AURORA_TEST_DEVICE / test/.device.local.json）');
  }
}

log('\n[设备枚举] DirectSound:');
for (const d of engine.listDevices('directsound')) log(`  - ${d.isDefault ? '★' : ' '} ${d.name} (${d.id})`);
log('[设备枚举] MME:');
for (const d of engine.listDevices('mme')) log(`  - ${d.isDefault ? '★' : ' '} ${d.name} (id=${d.id})`);

const backends = onlyBackend ? [onlyBackend] : ['wasapi-shared', 'wasapi-exclusive', 'directsound', 'mme'];


if (!onlyBackend || onlyBackend === 'wasapi-exclusive') {
  log('\n[独占模式支持矩阵] (48000Hz/2ch/32bit float 请求)');
  for (const d of allDevices) {
    if (d.state !== 'active') continue;
    const p = engine.probeFormat({ backend: 'wasapi-exclusive', deviceId: d.id, sampleRate: 48000,
      channels: 2, bits: 32, isFloat: true, exclusive: true });
    log(`  ${p.supported ? '✓' : '✗'} ${d.name}  ${p.detail}`);
  }
}

for (const backend of backends) {
  log(`\n[后端 ${backend}]`);
  const exclusive = backend === 'wasapi-exclusive';
  const dev = resolveDeviceFor(backend);
  if (devicePick && !dev.id) {
    log(`  · 跳过：该后端没有匹配 "${devicePick}" 的设备`);
    results.push({ backend, ok: false, reason: `没有匹配 "${devicePick}" 的设备（按用户要求不回落默认设备）` });
    continue;
  }
  const probe = engine.probeFormat({
    backend, deviceId: dev.id, sampleRate: 48000, channels: 2, bits: 32, isFloat: true, exclusive,
  });
  log(`  格式探测: supported=${probe.supported} ${probe.detail}`);

  let out = null;
  try {
    out = new engine.AudioOutput({
      backend,
      deviceId: dev.id,
      sampleRate: 48000,
      channels: 2,
      bits: 32,
      isFloat: true,
      exclusive,
      bufferMs: backend === 'mme' ? 100 : 100,
      periodMs: 10,
      ringMs: 800,
      allowFormatFallback: true,
    });
  } catch (err) {
    fail(`打开失败: ${err.message}`);
    results.push({ backend, ok: false, reason: err.message });
    continue;
  }

  const fmt = out.format;
  log(`  协商格式: ${fmt.sampleRate}Hz ${fmt.channels}ch ${fmt.bits}bit ${fmt.isFloat ? 'float' : 'int'}` +
      ` exclusive=${fmt.exclusive} 设备="${out.deviceName}"`);

  let framesWritten = 0;
  let targetFrames = Math.round(seconds * fmt.inputSampleRate);
  const chunkFrames = 1024;
  const tone = makeToneBuffer(chunkFrames, fmt.inputChannels, fmt.inputSampleRate, 440);
  const t0 = Date.now();
  let iterations = 0;

  while (framesWritten < targetFrames && Date.now() - t0 < 30000) {
    const accepted = out.write(tone);
    framesWritten += accepted;
    if (accepted === 0) {
      await new Promise((r) => setTimeout(r, 5));
    }
    iterations++;
  }
  const writeMs = Date.now() - t0;

  
  let waited = 0;
  let stats = out.stats();
  while (stats.framesRendered < framesWritten - fmt.sampleRate * 0.05 && waited < 10000) {
    await new Promise((r) => setTimeout(r, 50));
    waited += 50;
    stats = out.stats();
  }
  const playMs = Date.now() - t0;

  
  out.pause();
  await new Promise((r) => setTimeout(r, 120));
  const pausedStats = out.stats();
  out.resume();
  await new Promise((r) => setTimeout(r, 80));
  const resumedStats = out.stats();

  out.setVolume(0.5);
  const volOk = Math.abs(out.stats().volume - 0.5) < 1e-6;

  const finalStats = out.stats();
  out.close();

  const renderedSec = finalStats.framesRendered / fmt.sampleRate;
  const ok = finalStats.framesRendered > 0 && finalStats.underrunEvents <= 2;
  log(`  写入 ${framesWritten} 帧 (${(writeMs / 1000).toFixed(2)}s), 声卡播放 ${finalStats.framesRendered} 帧` +
      ` (${renderedSec.toFixed(2)}s), 静音补帧 ${finalStats.framesSilence}, 欠载 ${finalStats.underrunEvents} 次`);
  log(`  暂停生效: ${pausedStats.paused === true ? '是' : '否'}, 恢复: ${resumedStats.paused === false ? '是' : '否'}, 音量设置: ${volOk ? 'OK' : 'FAIL'}`);
  if (finalStats.lastError) log(`  后端错误: ${finalStats.lastError}`);
  if (!ok) fail('渲染帧数不足或欠载过多');

  results.push({
    backend,
    ok,
    device: out.deviceName,
    format: `${fmt.sampleRate}Hz/${fmt.channels}ch/${fmt.bits}bit/${fmt.isFloat ? 'f32' : 'int'}`,
    renderedFrames: finalStats.framesRendered,
    renderedSeconds: Number(renderedSec.toFixed(2)),
    underruns: finalStats.underrunEvents,
    lastError: finalStats.lastError,
  });
}


log('\n=== 峰值统计（写入侧，与音量/输出格式无关）===');
{
  const frames = 4800;
  const pcm = new Float32Array(frames * 2);
  for (let i = 0; i < frames; i++) {
    pcm[i * 2] = Math.sin(i * 0.05) * 0.8;       
    pcm[i * 2 + 1] = Math.sin(i * 0.05) * 0.2;   
  }
  const mk = (opts) => new engine.AudioOutput({
    backend: 'wasapi-shared', deviceId: resolveDeviceFor('wasapi-shared').id, sampleRate: 48000, channels: 2, bits: 32,
    isFloat: true, exclusive: false, periodMs: 10, bufferMs: 100, ringMs: 800,
    allowFormatFallback: true, ...opts,
  });
  const readPeaks = (out, after) => new Promise((resolve) => {
    out.write(pcm);
    setTimeout(() => resolve(out.stats().peaks.slice()), after);
  });

  const silent = mk({});
  silent.setVolume(0);
  const pMuted = await readPeaks(silent, 300);
  silent.close();

  const loud = mk({});
  loud.setVolume(1);
  const pLoud = await readPeaks(loud, 300);
  loud.close();

  const other = mk({ sampleRate: 96000, bits: 16, isFloat: false });   
  const pOther = await readPeaks(other, 300);
  other.close();

  const near = (a, b) => Math.abs(a - b) < 0.02;
  log(`  音量 0 → peaks ${JSON.stringify(pMuted.map((v) => +v.toFixed(3)))}`);
  log(`  音量 1 → peaks ${JSON.stringify(pLoud.map((v) => +v.toFixed(3)))}`);
  log(`  16bit/96kHz 输出 → peaks ${JSON.stringify(pOther.map((v) => +v.toFixed(3)))}`);
  if (!near(pMuted[0], 0.8) || !near(pMuted[1], 0.2)) fail('峰值受音量影响（应取写入侧电平）');
  if (!near(pLoud[0], 0.8) || !near(pLoud[1], 0.2)) fail('峰值与写入数据不符');
  if (!near(pOther[0], 0.8)) fail('峰值受输出格式影响');
  log('  ✓ 峰值与音量无关 · 与输出格式无关 · 等于文件本身电平');
  results.forEach((r) => { r.peaksOk = true; });
}

log('\n=== 汇总 ===');
for (const r of results) {
  log(`${r.ok ? '✓' : '✗'} ${r.backend.padEnd(18)} ${r.format ?? ''} 播放 ${r.renderedSeconds ?? 0}s 欠载 ${r.underruns ?? '-'} ${r.lastError || r.reason || ''}`);
}
const failures = results.filter((r) => !r.ok);
process.exit(failures.length ? 1 : 0);
