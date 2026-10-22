










import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Module = require('node:module');
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = path.resolve(projectRoot, '..');
const pluginDir = path.join(workspaceRoot, 'irix-extension', 'qa', 'test-interfaces');
const { Extensions, ID_RE } = require(path.join(projectRoot, 'src', 'main', 'extensions.js'));

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'irix-test-plugin-'));
process.on('exit', () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {  } });

try {
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, 'extension.json'), 'utf8'));
  check('manifest：id 合法 / startup=true / 声明 .testext / 有设置与命令',
    ID_RE.test(manifest.id) && manifest.id === path.basename(pluginDir) &&
    manifest.startup === true && manifest.extensions.includes('testext') &&
    Array.isArray(manifest.settings) && manifest.settings.length >= 2 &&
    Array.isArray(manifest.commands) && manifest.commands.some((c) => c.id === 'run-self-test'),
    JSON.stringify({ id: manifest.id, startup: manifest.startup }));

  const plugin = require(path.join(pluginDir, 'index.js'));
  check('模块导出：match / decode / readMeta / extractCover / processAudio / commands / __test',
    plugin.match instanceof RegExp && typeof plugin.decode === 'function' &&
    typeof plugin.readMeta === 'function' && typeof plugin.extractCover === 'function' &&
    typeof plugin.processAudio === 'function' && plugin.commands && typeof plugin.commands['run-self-test'] === 'function' &&
    plugin.__test && typeof plugin.__test.makeContainer === 'function');

  const buf = plugin.__test.makeContainer({ marker: 'unit-test' });
  const meta = plugin.readMeta(buf);
  check('readMeta：标题 / duration 毫秒 / marker',
    meta && meta.title === '接口测试音频' && meta.duration === 1000 && meta.marker === 'unit-test',
    JSON.stringify(meta));
  const decoded = plugin.decode(buf);
  check('decode：真实可播放 WAV（RIFF） + 元数据',
    decoded.ext === 'wav' && Buffer.isBuffer(decoded.data) &&
    decoded.data.subarray(0, 4).toString('latin1') === 'RIFF' &&
    decoded.meta && decoded.meta.marker === 'unit-test',
    `ext=${decoded.ext} data=${decoded.data.length}B`);
  const cover = plugin.extractCover(buf);
  check('extractCover：返回 PNG Buffer（>64B）',
    Buffer.isBuffer(cover) && cover.length > 64 && cover[0] === 0x89);
  const processed = plugin.processAudio(Buffer.from('abc'));
  check('processAudio：返回 Buffer（内容不变，保证可播放）',
    Buffer.isBuffer(processed) && processed.toString() === 'abc' && plugin.__test.stats.processAudioCalls >= 1);

  const stubCtx = {
    appVersion: '1.0.2-ext-v2x',
    extension: { id: 'test-interfaces', name: '扩展接口测试插件', version: '1.0.0', dir: pluginDir },
    settings: { verbose: true, marker: 'unit-test' },
    log: () => {},
  };
  const selfResults = plugin.__test.selfTest(stubCtx);
  check('selfTest：所有自检项通过（含窗口项在非 Electron 环境跳过）',
    Array.isArray(selfResults) && selfResults.length >= 8 && selfResults.every((r) => r.ok),
    selfResults.map((r) => `${r.ok ? '✓' : '✗'}${r.name}`).join(' '));

  const gen = await plugin.commands['generate-sample'](stubCtx);
  const genPath = /已生成 (.+?)（/.exec(gen);
  const sampleFile = genPath && genPath[1];
  const sampleDecoded = sampleFile && fs.existsSync(sampleFile) ? plugin.decode(fs.readFileSync(sampleFile)) : null;
  check('commands.generate-sample：生成 .testext 且可 decode',
    !!sampleFile && fs.existsSync(sampleFile) && sampleDecoded && sampleDecoded.ext === 'wav',
    gen);

  
  const ffprobe = path.join(projectRoot, 'vendor', 'ffmpeg', 'bin', 'ffprobe.exe');
  if (sampleDecoded && fs.existsSync(ffprobe)) {
    const wavFile = path.join(tmp, 'decoded.wav');
    fs.writeFileSync(wavFile, sampleDecoded.data);
    const probe = spawnSync(ffprobe, ['-v', 'error', '-show_entries', 'format=format_name,duration', '-of', 'json', wavFile], {
      encoding: 'utf8', windowsHide: true,
    });
    let fmt = null;
    try { fmt = JSON.parse(probe.stdout); } catch { fmt = null; }
    check('decode 结果可被 ffprobe 识别（wav/pcm 可播放）',
      probe.status === 0 && fmt && /wav/.test(fmt.format?.format_name || ''),
      (fmt && JSON.stringify(fmt.format)) || (probe.stderr || '').slice(0, 120));
  }
  const selfCmd = await plugin.commands['run-self-test'](stubCtx);
  check('commands.run-self-test：返回通过摘要', /自检：\d+\/\d+ 通过/.test(selfCmd), selfCmd);

  
  const extRoot = path.join(tmp, 'extensions');
  fs.mkdirSync(extRoot, { recursive: true });
  fs.cpSync(pluginDir, path.join(extRoot, manifest.id), { recursive: true });
  const enabled = [manifest.id];
  const manager = new Extensions({
    dir: extRoot,
    getEnabled: () => enabled.slice(),
    saveEnabled: async () => {},
    appVersion: '1.0.2-ext-v2x',
    getSettings: () => ({ verbose: true, marker: 'loader-test' }),
    persistSettings: async () => {},
    log: () => {},
  });
  const list = manager.list();
  check('加载器 list：startup 标记被识别',
    list.length === 1 && list[0].startup === true && list[0].installed === true, JSON.stringify(list[0]));
  const started = manager.activateStartup();
  check('activateStartup：只加载声明 startup 的扩展并调用 activate',
    started.includes(manifest.id) && manager.cache.has(manifest.id) &&
    manager.cache.get(manifest.id).ctx.appVersion === '1.0.2-ext-v2x' &&
    manager.cache.get(manifest.id).ctx.settings.marker === 'loader-test',
    JSON.stringify(started));
  manager.shutdown();
  check('shutdown：调用 deactivate 并清缓存', manager.cache.size === 0);

  
  
  
  const handlers = new Map();
  const created = [];
  class FakeBrowserWindow {
    constructor(opts) {
      this.opts = opts;
      this.destroyed = false;
      this.webContents = { send: () => {} };
      created.push(this);
    }
    loadFile(file) { this.loadedFile = file; return Promise.resolve(); }
    on(evt, fn) { if (evt === 'closed') this.onClosed = fn; }
    focus() { this.focused = true; }
    isDestroyed() { return this.destroyed; }
    close() { this.destroyed = true; if (this.onClosed) this.onClosed(); }
  }
  const fakeElectron = {
    BrowserWindow: FakeBrowserWindow,
    ipcMain: {
      handle: (ch, fn) => handlers.set(ch, fn),
      removeHandler: (ch) => handlers.delete(ch),
    },
  };
  
  
  const origLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return fakeElectron;
    return origLoad.call(this, request, parent, isMain);
  };
  const pluginPath = require.resolve(path.join(pluginDir, 'index.js'));
  delete require.cache[pluginPath];
  const winPlugin = require(pluginPath);
  const winCtx = { ...stubCtx, log: () => {} };
  winPlugin.activate(winCtx);
  const win = winPlugin.__test.getWindow();
  check('窗口：activate 创建 BrowserWindow（preload/contextIsolation/sandbox:false）+ 加载 test.html',
    created.length === 1 && win && win.loadedFile === path.join(pluginDir, 'test.html') &&
    win.opts.webPreferences.contextIsolation === true &&
    win.opts.webPreferences.nodeIntegration === false &&
    win.opts.webPreferences.preload === path.join(pluginDir, 'preload.js'),
    win ? win.loadedFile : '未创建');
  check('窗口：IPC 只注册测试通道（run/generate/info/close）',
    handlers.has('irix-test-interfaces:run') && handlers.has('irix-test-interfaces:generate') &&
    handlers.has('irix-test-interfaces:info') && handlers.has('irix-test-interfaces:close'));
  const runHandler = handlers.get('irix-test-interfaces:run');
  const runResult = runHandler ? runHandler() : null;
  check('窗口 IPC run：返回自检结果（全部通过）',
    runResult && runResult.ok === true && Array.isArray(runResult.results) &&
    runResult.results.every((r) => r.ok), JSON.stringify(runResult && runResult.results && runResult.results.length));
  winPlugin.deactivate();
  check('窗口：deactivate 关闭窗口并移除 IPC',
    win.destroyed === true && handlers.size === 0 && winPlugin.__test.getWindow() === null);
  Module._load = origLoad;
} catch (err) {
  check('测试插件校验块执行异常', false, String(err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : err));
}

const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;
console.log(`\n=== 测试插件（ext-v2 接口自检）: ${passed}/${results.length} 通过 ===`);
if (failed) for (const r of results) if (!r.ok) console.log(`  ✗ ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
process.exit(failed ? 1 : 0);
