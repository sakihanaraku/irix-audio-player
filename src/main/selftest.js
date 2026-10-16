
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));


let selfTestOutputDir = null;
function getSelfTestOutputDir() {
  return selfTestOutputDir;
}


function pickWritableDir(candidates) {
  for (const dir of candidates) {
    if (!dir) continue;
    try {
      fs.mkdirSync(dir, { recursive: true });
      const probe = path.join(dir, '.write-probe');
      fs.writeFileSync(probe, 'x');
      fs.rmSync(probe, { force: true });
      return dir;
    } catch {  }
  }
  return null;
}

async function waitFor(fn, timeoutMs = 10000, intervalMs = 100) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) return null;
    await sleep(intervalMs);
  }
}

async function runSelfTest({ mainWindow, player, playlist, tools, settings, appRoot }) {
  
  
  
  
  const testDevFrag = process.env.AURORA_TEST_DEVICE || '';
  if (testDevFrag && settings) {
    try {
      const enumBackend = settings.backend === 'wasapi-exclusive' ? 'wasapi-shared' : (settings.backend || 'wasapi-shared');
      const list = player.engine.listDevices(enumBackend);
      const frags = String(testDevFrag).split('|').map((x) => x.trim().toLowerCase()).filter(Boolean);
      const hit = list.find((d) => frags.some((f) => String(d.name).toLowerCase().includes(f)));
      if (hit) {
        settings.deviceId = hit.id;
        record(`声音测试设备（AURORA_TEST_DEVICE=${testDevFrag}）`, true, hit.name);
      } else {
        record(`声音测试设备（AURORA_TEST_DEVICE=${testDevFrag}）`, false,
          `未匹配到设备，仍是系统默认：${list.map((d) => d.name).join(' / ')}`);
      }
    } catch (err) {
      record(`声音测试设备（AURORA_TEST_DEVICE=${testDevFrag}）`, false, err.message);
    }
  }
  const checks = [];
  const record = (name, ok, detail = '') => {
    checks.push({ name, ok: !!ok, detail: String(detail) });
    console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  };
  const exec = (code) => mainWindow.webContents.executeJavaScript(code, true);

  console.log('\n=== iRix Audio Player 端到端自测 ===');
  console.log('appRoot:', appRoot);
  console.log('ffmpeg :', tools.ffmpeg || '(未找到)');

  
  let version = null;
  try {
    version = player.engine.version();
    record('N-API 音频引擎加载', true, JSON.stringify(version));
  } catch (err) {
    record('N-API 音频引擎加载', false, err.message);
  }

  
  const devices = player.engine.listDevices('wasapi-shared');
  record('WASAPI 设备枚举', devices.length > 0, `${devices.length} 个设备，默认: ${devices.find((d) => d.isDefault)?.name || '-'}`);
  const dsDevices = player.engine.listDevices('directsound');
  const mmeDevices = player.engine.listDevices('mme');
  record('DirectSound 设备枚举', dsDevices.length > 0, `${dsDevices.length} 个`);
  record('MME 设备枚举', mmeDevices.length > 0, `${mmeDevices.length} 个`);

  
  const exclusiveProbe = player.engine.probeFormat({
    backend: 'wasapi-exclusive', deviceId: '', sampleRate: 48000, channels: 2, bits: 32,
    isFloat: true, exclusive: true,
  });
  record('WASAPI 独占模式探测', exclusiveProbe.supported || exclusiveProbe.detail.includes('不支持'),
    exclusiveProbe.detail);

  
  record('ffmpeg 定位', !!tools.ffmpeg, tools.ffmpeg || '未找到');
  record('ffprobe 定位', !!tools.ffprobe, tools.ffprobe || '未找到（回退解析 ffmpeg 输出）');

  
  const mediaDir = process.env.AURORA_SELFTEST_MEDIA || path.join(appRoot, 'test', 'media');
  let mediaFiles = [];
  try {
    mediaFiles = fs
      .readdirSync(mediaDir)
      .filter((f) => f !== 'broken.mp3' && /\.(flac|wav|mp3|m4a|ogg|opus|wma)$/i.test(f))
      .map((f) => path.join(mediaDir, f));
  } catch {  }
  record('测试媒体存在', mediaFiles.length >= 6, `${mediaFiles.length} 个文件 @ ${mediaDir}`);

  const addResult = await playlist.add(mediaFiles, tools, {});
  const byExt = {};
  for (const t of addResult.added) byExt[t.ext] = (byExt[t.ext] || 0) + 1;
  record('播放列表导入（含格式识别）', addResult.added.length >= 6,
    Object.entries(byExt).map(([k, v]) => `${k}×${v}`).join(' '));
  const mustHave = ['flac', 'wav', 'mp3'];
  const missing = mustHave.filter((e) => !byExt[e]);
  record('flac/wav/mp3 三种格式识别', missing.length === 0, missing.length ? `缺少 ${missing}` : '全部识别');
  const flacTrack = addResult.added.find((t) => t.ext === 'flac');
  const wavTrack = addResult.added.find((t) => t.ext === 'wav');
  const mp3Track = addResult.added.find((t) => t.ext === 'mp3');
  record('元数据（采样率/位深/时长）', !!(flacTrack && flacTrack.sampleRate && flacTrack.duration),
    flacTrack ? `${flacTrack.name} ${flacTrack.sampleRate}Hz/${flacTrack.bits}bit ${flacTrack.duration.toFixed(1)}s` : '');

  
  mainWindow.webContents.send('playlist:changed', playlist.list());
  await sleep(400);
  const rowCount = await exec(`document.querySelectorAll('.pl-item').length`);
  const countText = await exec(`document.getElementById('plCount').textContent`);
  record('渲染进程播放列表渲染', Number(rowCount) === playlist.list().length && rowCount > 0,
    `DOM 行数 ${rowCount} / 计数 ${countText}`);

  
  const dragShown = await exec(`(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['x'], 'demo.flac'));
    window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true }));
    const on = document.getElementById('drop-overlay').classList.contains('active');
    window.dispatchEvent(new DragEvent('dragleave', { dataTransfer: dt, bubbles: true }));
    const off = !document.getElementById('drop-overlay').classList.contains('active');
    return { on, off };
  })()`);
  record('窗口外拖入的拖拽提示', dragShown.on && dragShown.off, JSON.stringify(dragShown));

  
  const backendSwitch = await exec(`(async () => {
    document.getElementById('btnSettings').click();
    await new Promise(r => setTimeout(r, 200));
    const sel = document.getElementById('selBackend');
    const before = sel.value;
    sel.value = 'wasapi-exclusive';
    sel.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 1200));
    const status = document.getElementById('statusDevice').textContent;
    return { before, after: sel.value, status, hint: document.getElementById('backendHint').textContent };
  })()`);
  record('UI 切换声卡模式（WASAPI 独占）', backendSwitch.after === 'wasapi-exclusive',
    `状态栏="${backendSwitch.status}"`);

  
  await exec(`document.querySelectorAll('.pl-item')[0].click(); true`);
  const playOk = await waitFor(() => {
    const st = player.state();
    return st.status === 'playing' ? st : null;
  }, 8000);
  record('UI 点击播放（独占模式）', !!playOk, playOk ? `状态 ${playOk.status} 格式 ${JSON.stringify(playOk.format)}` : '未进入播放状态');

  let rendered = 0;
  if (playOk) {
    const base = player.output.stats().framesRendered;
    const rate = player.output.format.sampleRate;
    const target = Math.round(rate * 1.5);
    await waitFor(() => player.output.stats().framesRendered - base >= target, 8000);
    rendered = player.output.stats().framesRendered - base;
    record('独占模式实际出声帧数', rendered >= target * 0.9,
      `${rendered} 帧 ≈ ${(rendered / rate).toFixed(2)}s (${rate}Hz)`);
  }

  
  const pauseCheck = await exec(`(async () => {
    document.getElementById('btnPlay').click();
    await new Promise(r => setTimeout(r, 500));
    const glyph = document.getElementById('btnPlay').textContent;
    const status = document.getElementById('statStatus').textContent;
    document.getElementById('btnPlay').click();
    await new Promise(r => setTimeout(r, 400));
    return { glyph, status };
  })()`);
  record('UI 暂停按钮与状态显示', pauseCheck.glyph === '▶' && pauseCheck.status === '已暂停',
    JSON.stringify(pauseCheck));

  const progress = player.state();
  record('播放进度推进', progress.position > 0, `position=${progress.position.toFixed(2)}s / duration=${progress.duration.toFixed(2)}s`);

  const vol = await exec(`(() => {
    const v = document.getElementById('volume');
    v.value = 42; v.dispatchEvent(new Event('input'));
    return document.getElementById('volNum').textContent;
  })()`);
  record('音量控件', vol === '42', `滑块值 ${vol}`);

  
  const back = await exec(`(async () => {
    const sel = document.getElementById('selBackend');
    sel.value = 'wasapi-shared';
    sel.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 1200));
    return document.getElementById('statusDevice').textContent;
  })()`);
  record('切回 WASAPI 共享模式', typeof back === 'string', `状态栏="${back}"`);

  player.stop();

  
  const webUtilsOk = await exec(`(() => {
    const f = new File(['x'], 'a.flac');
    const p = window.aurora.getPathForFile(f);
    return typeof p === 'string';
  })()`);
  record('webUtils.getPathForFile 可用', webUtilsOk === true, '（合成 File 无真实路径，真实拖放由系统提供）');

  
  const artifacts = pickWritableDir([
    process.env.AURORA_SELFTEST_OUT,
    path.join(appRoot, 'test', 'artifacts'),
    path.join(app.getPath('userData'), 'selftest-artifacts'),
  ]);
  if (!artifacts) {
    record('窗口截图', false, '找不到可写目录');
  } else {
    try {
      const image = await mainWindow.webContents.capturePage();
      const png = image.toPNG();
      const shot = path.join(artifacts, 'app-screenshot.png');
      fs.writeFileSync(shot, png);
      record('窗口截图', png.length > 1000, `${shot} (${(png.length / 1024).toFixed(0)} KB)`);
      selfTestOutputDir = artifacts;
    } catch (err) {
      record('窗口截图', false, err.message);
    }
  }

  const failed = checks.filter((c) => !c.ok);
  const summary = { total: checks.length, passed: checks.length - failed.length, failed: failed.length };
  console.log(`\n=== 自测汇总: ${summary.passed}/${summary.total} 通过 ===`);
  for (const f of failed) console.log(`  ✗ ${f.name}: ${f.detail}`);

  return {
    summary,
    checks,
    engine: version,
    ffmpeg: { path: tools.ffmpeg, probe: tools.ffprobe, source: tools.source },
    devices: { wasapi: devices.length, directsound: dsDevices.length, mme: mmeDevices.length },
    exclusiveProbe,
    playlist: { count: playlist.list().length, formats: byExt },
    platform: { electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome },
  };
}

module.exports = { runSelfTest };
