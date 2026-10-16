


import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { testDeviceId } from './_device.mjs';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const resources = path.join(projectRoot, 'dist', 'win-unpacked', 'resources');
const appAsar = path.join(resources, 'app.asar');
const appUnpacked = path.join(resources, 'app.asar.unpacked');

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

console.log('=== 打包产物运行期校验 ===');
console.log('resources:', resources);
if (!fs.existsSync(appAsar)) {
  console.error('缺少 dist/win-unpacked，请先运行: npm run dist:dir');
  process.exit(2);
}


process.resourcesPath = resources;

const { resolveTools } = require('../src/main/ffmpeg.js');
const { PlayerSession } = require('../src/main/player.js');


console.log('\n[1] 包内 ffmpeg 解析（resources/ffmpeg/bin）');
const tools = resolveTools({
  appRoot: appAsar,
  extraDirs: [path.join(resources, 'ffmpeg', 'bin'), path.join(appUnpacked, 'vendor', 'ffmpeg', 'bin')],
});
check('解析到包内 ffmpeg', !!tools.ffmpeg && tools.ffmpeg.startsWith(resources), tools.ffmpeg || '(未找到)');
check('解析到包内 ffprobe', !!tools.ffprobe && tools.ffprobe.startsWith(resources), tools.ffprobe || '(未找到)');


console.log('\n[2] app.asar.unpacked 内的原生模块');
const addonPath = path.join(appUnpacked, 'native', 'build', 'Release', 'aurora_audio.node');
check('原生模块已解包', fs.existsSync(addonPath), addonPath);
let engine = null;
try {
  engine = require(addonPath);
  check('原生模块可加载', true, JSON.stringify(engine.version()));
} catch (err) {
  check('原生模块可加载', false, err.message);
}


console.log('\n[3] 用包内 ffmpeg + 原生模块播放');
const media = path.join(projectRoot, 'test', 'media', 'tone-44k.flac');
if (!engine || !tools.ffmpeg || !fs.existsSync(media)) {
  check('播放测试前置条件', false, '缺少引擎/ffmpeg/测试媒体');
} else {
  const session = new PlayerSession({ appRoot: appAsar, extraRoots: [appUnpacked, resources] });
  check('PlayerSession 在打包路径下加载原生模块',
    session.addonPath.startsWith(appUnpacked), session.addonPath);
  session.setTools(tools);
  session.setVolume(0.2);

  const settings = {
    backend: 'wasapi-shared', deviceId: testDeviceId(session), sampleRate: 48000, channels: 2, bits: 32,
    exclusive: false, bufferMs: 100, periodMs: 10, ringMs: 800, allowFormatFallback: true,
  };
  const track = { id: 'pkg', path: media, name: 'tone-44k.flac', duration: 6, ok: true };
  try {
    const st = await session.play(track, settings, {});
    const base = session.baseFrames;
    const t0 = Date.now();
    let frames = 0;
    while (Date.now() - t0 < 8000) {
      await new Promise((r) => setTimeout(r, 50));
      frames = session.output.stats().framesRendered - base;
      if (frames >= st.format.sampleRate * 0.9) break;
    }
    const seconds = frames / st.format.sampleRate;
    check('包内组件真实出声', frames > 0 && seconds >= 0.8,
      `${st.deviceName} ${st.format.sampleRate}Hz/${st.format.channels}ch/${st.format.bits}bit 播放 ${seconds.toFixed(2)}s`);
    session.stop();
  } catch (err) {
    check('包内组件真实出声', false, err.message);
  }
  session.dispose();
}


console.log('\n[4] app.asar 内容');
try {
  const asar = require('@electron/asar');
  const list = asar.listPackage(appAsar).map((f) => f.replace(/\\/g, '/'));
  const has = (s) => list.some((f) => f.endsWith(s));
  check('asar 含主进程/预加载/渲染层',
    has('src/main/main.js') && has('src/preload/preload.js') && has('src/renderer/index.html'), `${list.length} 个条目`);
  check('asar 含测试与构建脚本被排除', !has('test/engine.test.mjs') && !has('scripts/package.mjs'),
    '打包只含运行所需文件');
} catch (err) {
  check('asar 内容检查', false, err.message);
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n=== 汇总: ${checks.length - failed.length}/${checks.length} 通过 ===`);
fs.writeFileSync(path.join(projectRoot, 'dist', 'packaged-report.json'),
  JSON.stringify({ checks, tools, addonPath }, null, 2));
process.exit(failed.length ? 1 : 0);
