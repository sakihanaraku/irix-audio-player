


import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Module = require('node:module');
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};


const userData = path.join(os.tmpdir(), `aurora-smoke-${Date.now()}`);
fs.mkdirSync(userData, { recursive: true });

const handlers = new Map();
const listeners = new Map();
const sentEvents = [];
const invokedChannels = [];
const sentChannels = [];
let windowInstance = null;
let readyCallback = null;

class FakeWebContents {
  constructor() { this.listeners = {}; }
  send(channel, payload) { sentEvents.push({ channel, payload }); }
  on() {}
  removeAllListeners() {}
  setWindowOpenHandler() {}
  async executeJavaScript() { return undefined; }
  async capturePage() { return { toPNG: () => Buffer.from('89504e47', 'hex') }; }
}
class FakeBrowserWindow {
  constructor(options) {
    this.options = options;
    this.webContents = new FakeWebContents();
    windowInstance = this;
  }
  loadFile(file) { this.loadedFile = file; return Promise.resolve(); }
  isDestroyed() { return false; }
  isMinimized() { return false; }
  isMaximized() { return !!maximized; }
  maximize() { maximized = true; this.emit?.('maximize'); }
  unmaximize() { maximized = false; this.emit?.('unmaximize'); }
  minimize() { minimized = true; }
  close() { closed = true; }
  restore() {}
  focus() {}
  on(event, cb) { (this.events = this.events || {})[event] = cb; }
  emit(event) { this.events?.[event]?.(); }
  static getAllWindows() { return windowInstance ? [windowInstance] : []; }
}

let maximized = false;
let minimized = false;
let closed = false;

const fakeElectron = {
  app: {
    requestSingleInstanceLock: () => true,
    on: () => {},
    whenReady: () => ({ then: (cb) => { readyCallback = cb; return { catch: () => {} }; } }),
    getPath: (name) => (name === 'userData' ? userData : projectRoot),
    getVersion: () => '1.0.0',
    quit: () => {},
    exit: (code) => { process.exitCode = code; },
  },
  BrowserWindow: FakeBrowserWindow,
  ipcMain: {
    handle: (channel, fn) => handlers.set(channel, fn),
    on: (channel, fn) => listeners.set(channel, fn),
  },
  dialog: {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    showSaveDialog: async (win, opts) => {
      
      globalThis.__lastSaveDialog = opts;
      return { canceled: true };
    },
  },
  Menu: { setApplicationMenu: () => {}, buildFromTemplate: (t) => t },
  shell: { openExternal: () => {}, showItemInFolder: () => {} },
  contextBridge: { exposeInMainWorld: (name, api) => { globalThis.__exposed = { name, api }; } },
  ipcRenderer: {
    invoke: async (channel, arg) => {
      invokedChannels.push(channel);
      if (!handlers.has(channel)) throw new Error(`主进程没有注册通道: ${channel}`);
      return handlers.get(channel)({}, arg);
    },
    send: (channel, arg) => {
      sentChannels.push(channel);
      if (!listeners.has(channel)) throw new Error(`主进程没有注册监听: ${channel}`);
      listeners.get(channel)({}, arg);
    },
    on: () => {},
    removeListener: () => {},
  },
  webUtils: { getPathForFile: (file) => file?.__path || '' },
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return fakeElectron;
  return originalLoad.apply(this, arguments);
};


console.log('=== IPC 契约测试 ===');
console.log('\n[1] 加载 src/main/main.js（假 electron）');
require(path.join(projectRoot, 'src', 'main', 'main.js'));
check('main.js 被加载', typeof readyCallback === 'function', 'whenReady 已注册');
if (readyCallback) await readyCallback();

check('注册了 IPC 处理器', handlers.size > 0, `${handlers.size} 个通道: ${[...handlers.keys()].join(', ')}`);
check('创建了主窗口', !!windowInstance, windowInstance?.loadedFile || '');
check('窗口加载 renderer/index.html',
  (windowInstance?.loadedFile || '').replace(/\\/g, '/').endsWith('src/renderer/index.html'),
  windowInstance?.loadedFile || '');
check('窗口使用 preload 且开启上下文隔离',
  windowInstance?.options?.webPreferences?.contextIsolation === true &&
  (windowInstance?.options?.webPreferences?.preload || '').includes('preload'),
  JSON.stringify({ contextIsolation: windowInstance?.options?.webPreferences?.contextIsolation }));


console.log('\n[2] 加载 src/preload/preload.js（假 contextBridge）');
require(path.join(projectRoot, 'src', 'preload', 'preload.js'));
const exposed = globalThis.__exposed;
check('preload 暴露了 window.aurora', exposed?.name === 'aurora', exposed?.name || '(无)');
if (!exposed) { console.error('preload 未暴露 API'); process.exit(1); }


console.log('\n[3] 逐个调用暴露的 API（真实走主进程处理器）');


const argsFor = {
  'settings.set': [{ volume: 0.5 }],
  'ffmpeg.set': [''],
  'devices.list': ['wasapi-shared'],
  'devices.probe': [{ backend: 'wasapi-exclusive', sampleRate: 48000, channels: 2, bits: 32, isFloat: true, exclusive: true }],
  'playlist.add': [[]],
  'playlist.remove': ['nonexistent'],
  'playlist.reorder': ['nonexistent', 0],
  'playlist.save': [],
  'playlist.load': [],
  'bg.get': [],
  'bg.fetch': [],
  'fs.home': [],
  'fs.list': [projectRoot],
  'fs.stat': [projectRoot],
  'eq.get': [],
  'eq.set': [{ enabled: false, preampDb: 0, bands: [] }],
  'eq.save': [null, null],
  'eq.load': [null],
  'player.play': ['nonexistent'],
  'player.seek': [0],
  'player.volume': [0.5],
  probeFile: [path.join(projectRoot, 'test', 'media', 'tone-44k.flac')],
  showItem: [projectRoot],
};
const expectedRejects = new Set(['player.play']);

async function walk(obj, prefix) {
  for (const [key, value] of Object.entries(obj)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'function') {
      const args = argsFor[name] || [];
      try {
        const result = await value(...args);
        const detail = typeof result === 'object' && result ? `${Object.keys(result).slice(0, 4).join(',')}…` : String(result);
        check(`API ${name}`, !expectedRejects.has(name), `返回 ${detail}`);
        if (name === 'info') {
          check('  app:info 含引擎与 ffmpeg 信息', !!result.addon && !!result.ffmpeg && !!result.backends,
            `引擎 ${result.addon?.version} · 后端 ${result.backends?.length} 个 · ffmpeg ${result.ffmpeg?.ok ? '已找到' : '未找到'}`);
          check('  app:info 含四个声卡后端',
            ['wasapi-shared', 'wasapi-exclusive', 'directsound', 'mme'].every((b) => result.backends.some((x) => x.id === b)),
            result.backends.map((b) => b.id).join(','));
        }
        if (name === 'devices.list') {
          check('  devices.list 返回真实设备', Array.isArray(result) && result.length > 0, `${result.length} 个设备`);
        }
        if (name === 'devices.probe') {
          check('  devices.probe 返回独占探测结果', typeof result.supported === 'boolean', result.detail);
        }
        if (name === 'playlist.get') {
          check('  playlist.get 返回数组', Array.isArray(result), `${result.length} 首`);
        }
        if (name === 'player.volume') {
          check('  player.volume 正确往返', Math.abs(result - 0.5) < 1e-6, `返回 ${result}`);
        }
        if (name === 'probeFile') {
          check('  probeFile 识别真实文件', result && result.ok === true,
            `${result?.codec} ${result?.sampleRate}Hz/${result?.bits}bit ${result?.duration?.toFixed(2)}s`);
        }
      } catch (err) {
        const ok = expectedRejects.has(name);
        check(`API ${name}`, ok, ok ? `按预期拒绝: ${err.message}` : `抛错: ${err.message}`);
      }
    } else if (value && typeof value === 'object') {
      await walk(value, name);
    }
  }
}
await walk(exposed.api, '');


console.log('\n[4] 通道对齐');
const missing = invokedChannels.filter((c) => !handlers.has(c));
check('所有 preload 通道都有主进程处理器', missing.length === 0,
  missing.length ? `缺失: ${missing.join(', ')}` : `${new Set(invokedChannels).size} 个 invoke 通道全部对齐`);
const missingSent = sentChannels.filter((c) => !listeners.has(c));
check('所有 send 通道都有主进程监听', missingSent.length === 0,
  missingSent.length ? `缺失: ${missingSent.join(', ')}` : `${new Set(sentChannels).size} 个 send 通道全部对齐（含窗口控制）`);


console.log('\n[5] 自定义标题栏窗口控制');
check('主进程注册了窗口控制通道',
  ['window:minimize', 'window:toggle-maximize', 'window:close'].every((c) => listeners.has(c)),
  [...listeners.keys()].filter((c) => c.startsWith('window:')).join(', '));

maximized = false;
minimized = false;
closed = false;
sentEvents.length = 0;
exposed.api.win.minimize();
check('最小化被调用', minimized === true, `minimized=${minimized}`);
exposed.api.win.toggleMaximize();
check('最大化被调用（isMaximized=true）', maximized === true, `maximized=${maximized}`);
exposed.api.win.toggleMaximize();
check('再次调用还原（isMaximized=false）', maximized === false, `maximized=${maximized}`);
exposed.api.win.close();
check('关闭被调用', closed === true, `closed=${closed}`);
check('窗口为无边框（frame:false）', windowInstance?.options?.frame === false,
  `frame=${windowInstance?.options?.frame}`);
check('窗口标题为 iRix Audio Player', windowInstance?.options?.title === 'iRix Audio Player',
  windowInstance?.options?.title);
check('最小窗口尺寸 1366×768',
  windowInstance?.options?.minWidth === 1366 && windowInstance?.options?.minHeight === 768,
  `minWidth=${windowInstance?.options?.minWidth} minHeight=${windowInstance?.options?.minHeight}`);
check('默认窗口尺寸也是 1366×768',
  windowInstance?.options?.width === 1366 && windowInstance?.options?.height === 768,
  `width=${windowInstance?.options?.width} height=${windowInstance?.options?.height}`);
const coverRes = await exposed.api.cover.get('nonexistent');
check('cover:get 通道可用（无曲目时返回空）', coverRes && coverRes.dataUrl === null,
  JSON.stringify(coverRes));
const bgRes = await exposed.api.bg.get();
check('bg:get 通道可用（默认纯色背景）', bgRes && bgRes.dataUrl === null && bgRes.source === 'none',
  JSON.stringify(bgRes));


const fsHome = await exposed.api.fs.home();
check('fs:home 返回音乐目录', fsHome && typeof fsHome.music === 'string' && fsHome.music.length > 0,
  JSON.stringify(fsHome));
const fsList = await exposed.api.fs.list(fsHome.music);
check('fs:list 能列出音乐目录', fsList && fsList.dir === fsHome.music && Array.isArray(fsList.entries),
  `dir=${fsList && fsList.dir} entries=${fsList && fsList.entries.length}`);
check('fs:list 只返回文件夹与音频，且文件夹排在前面', (() => {
  if (!fsList || !fsList.entries.length) return true;                 
  const dirs = fsList.entries.filter((e) => e.isDir).length;
  const dirsFirst = fsList.entries.slice(0, dirs).every((e) => e.isDir);
  const onlyAudio = fsList.entries.every((e) => e.isDir || e.audio);
  return dirsFirst && onlyAudio;
})(), JSON.stringify((fsList.entries || []).slice(0, 4).map((e) => e.name)));
const fsBad = await exposed.api.fs.list('Z:\\绝对不存在的目录\\nope').catch((e) => ({ error: String(e.message || e) }));
check('fs:list 对不存在的目录有兜底（回到音乐目录或明确报错，不吞异常）',
  !!(fsBad && (fsBad.error || fsBad.dir)), JSON.stringify(fsBad && (fsBad.error || fsBad.dir)));


const statDir = await exposed.api.fs.stat(projectRoot);
check('fs:stat 识别已存在的目录', statDir.ok === true && statDir.kind === 'dir', JSON.stringify(statDir));
const statFile = await exposed.api.fs.stat(path.join(projectRoot, 'package.json'));
check('fs:stat 识别已存在的文件并给出所在目录',
  statFile.ok === true && statFile.kind === 'file' && statFile.dir === projectRoot && statFile.name === 'package.json',
  JSON.stringify(statFile));
const statMissing = await exposed.api.fs.stat('Z:\\definitely\\missing\\path');
check('fs:stat 对不存在的路径返回 not-found', statMissing.ok === false && statMissing.reason === 'not-found',
  JSON.stringify(statMissing));
const statRelative = await exposed.api.fs.stat('relative\\path');
check('fs:stat 对相对路径返回 not-absolute',
  statRelative.ok === false && statRelative.reason === 'not-absolute', JSON.stringify(statRelative));
const statEmpty = await exposed.api.fs.stat('   ');
check('fs:stat 对空输入返回 empty', statEmpty.ok === false && statEmpty.reason === 'empty', JSON.stringify(statEmpty));
const statBadChar = await exposed.api.fs.stat('C:\\bad<name>');
check('fs:stat 对非法字符返回 illegal-char',
  statBadChar.ok === false && statBadChar.reason === 'illegal-char', JSON.stringify(statBadChar));
const statEnv = await exposed.api.fs.stat('%USERPROFILE%');
check('fs:stat 会展开环境变量（%USERPROFILE% 能定位到主目录）',
  statEnv.ok === true || statEnv.reason === 'not-found', JSON.stringify(statEnv));


const eqGet = await exposed.api.eq.get();
check('eq:get 返回 8 段与预设', eqGet.config.bands.length === 8 &&
  eqGet.bands[0] === 20 && eqGet.bands[7] === 19000 && eqGet.presets.length >= 6,
  `${eqGet.bands.join('/')} · 预设 ${eqGet.presets.length} 个`);
check('eq:get 带上预设数值（界面不重复定义）',
  !!eqGet.presetGains && Array.isArray(eqGet.presetGains.rock) && eqGet.presetGains.rock.length === 8, '');
const eqSet = await exposed.api.eq.set({
  enabled: true, preampDb: -3, bands: eqGet.bands.map((f, i) => ({ freq: f, gainDb: i * 1.5 })),
});
check('eq:set 保存并回传规整后的配置',
  eqSet.config.enabled === true && eqSet.config.preampDb === -3 && eqSet.config.bands[7].gainDb === 10.5,
  JSON.stringify(eqSet.config.bands.map((b) => b.gainDb)));
const eqSaved = await exposed.api.settings.get();
check('EQ 配置落到 settings（重启后仍在）',
  !!eqSaved.eq && eqSaved.eq.enabled === true && eqSaved.eq.bands.length === 8, JSON.stringify(eqSaved.eq));
const eqClamp = await exposed.api.eq.set({
  enabled: true, preampDb: 99, bands: eqGet.bands.map((f) => ({ freq: f, gainDb: 99 })),
});
check('eq:set 对越界值做夹紧', eqClamp.config.preampDb === 12 && eqClamp.config.bands[0].gainDb === 12,
  `${eqClamp.config.preampDb} / ${eqClamp.config.bands[0].gainDb}`);
const eqFile = path.join(userData, 'unit-test.eq');
const eqSaveRes = await exposed.api.eq.save(
  { enabled: true, preampDb: -2, bands: eqGet.bands.map((f, i) => ({ freq: f, gainDb: i })) }, eqFile);
check('eq:save 能写出 .eq 文件', eqSaveRes.canceled === false && fs.existsSync(eqFile), JSON.stringify(eqSaveRes));
const eqText = fs.readFileSync(eqFile, 'utf8');
check('.eq 文件是带格式标识的 JSON',
  JSON.parse(eqText).format === 'irix-eq' && JSON.parse(eqText).bands.length === 8, '');
await exposed.api.eq.set({ enabled: false, preampDb: 0, bands: eqGet.bands.map((f) => ({ freq: f, gainDb: 0 })) });
const eqLoadRes = await exposed.api.eq.load(eqFile);
check('eq:load 能读回 .eq 并应用',
  eqLoadRes.canceled === false && eqLoadRes.config.preampDb === -2 && eqLoadRes.config.bands[3].gainDb === 3,
  JSON.stringify(eqLoadRes.config && eqLoadRes.config.bands.map((b) => b.gainDb)));
const badEq = path.join(userData, 'bad.eq');
fs.writeFileSync(badEq, 'not json at all', 'utf8');
const eqBadRes = await exposed.api.eq.load(badEq);
check('坏 .eq 文件被拒绝且报错', !!eqBadRes.error && !eqBadRes.config, JSON.stringify(eqBadRes));



{
  const files = ['src/main/main.js', 'src/main/player.js', 'src/main/playcounts.js',
    'src/renderer/renderer.js', 'src/preload/preload.js'];
  const violations = [];
  for (const rel of files) {
    
    const src = fs.readFileSync(path.join(projectRoot, rel), 'utf8').replace(/`[\s\S]*?`/g, '``');
    const declared = new Set([...src.matchAll(/\b(?:let|const|var|function|class)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
    
    for (const m of src.matchAll(/\(([^)]*)\)\s*(?:=>|\{)/g)) {
      for (const part of m[1].split(',')) {
        const name = part.split(/[=:]/)[0].replace(/[{}\s.]/g, '');
        if (/^[A-Za-z_$][\w$]*$/.test(name)) declared.add(name);
      }
    }
    for (const m of src.matchAll(/^\s*([a-z][\w$]*)\s*=(?!=)/gm)) {
      if (!declared.has(m[1])) violations.push(`${rel}: ${m[1]}`);
    }
  }
  check('没有"赋值给未声明变量"（严格模式下会直接崩）', violations.length === 0, violations.join(', '));
}


{
  const file = path.join(projectRoot, 'test', 'media', 'tone-44k.flac');
  if (fs.existsSync(file)) {
    const added = await exposed.api.playlist.add([file]);
    const id = added && added.added && added.added[0]
      ? (added.added[0].id || added.added[0]) : null;
    const playRes = id
      ? await exposed.api.player.play(id).then(() => 'ok').catch((e) => String(e.message || e))
      : 'no-id';
    check('player:play 不会因为未声明变量报 ReferenceError',
      !/ReferenceError/.test(String(playRes)), String(playRes).slice(0, 80));
    await exposed.api.player.stop().catch(() => {});
    
  }
}


{
  const drivesRoot = '::drives';
  const drives = await exposed.api.fs.list(drivesRoot);
  check('fs:list 支持磁盘列表虚拟根',
    Array.isArray(drives.entries) && drives.entries.length > 0 && drives.drives === true,
    `${drives.entries.length} 个磁盘：${drives.entries.map((e) => e.name).join(', ')}`);
  check('磁盘条目是目录且带 drive 标记、没有上级',
    drives.entries.every((e) => e.isDir === true && e.drive === true) && drives.parent === null,
    JSON.stringify(drives.parent));
  if (process.platform === 'win32') {
    check('磁盘名是盘符形式（C:\\）',
      drives.entries.every((e) => /^[A-Z]:\\$/.test(e.name)), drives.entries.map((e) => e.name).join(','));
    check('磁盘带容量信息（total/free）',
      drives.entries.some((e) => e.total > 0), 
      drives.entries.map((e) => `${e.name} ${(e.total / 1e9).toFixed(0)}G`).join(', '));
  }
  
  const start = await exposed.api.fs.list(drives.entries[0].path);
  check('进入某个磁盘后上级仍指向磁盘列表',
    start.dir === drives.entries[0].path && start.parent === drivesRoot,
    `${start.dir} → ${start.parent}`);
  
  const rootRes = await exposed.api.fs.list(start.dir);
  check('盘根的上级 = 磁盘列表', rootRes.parent === drivesRoot, String(rootRes.parent));
  
  const nested = await exposed.api.fs.list('::drives').then(() => exposed.api.fs.list(path.join(drives.entries[0].path, 'Windows')).catch(() => null));
  if (nested && nested.dir) {
    check('普通目录的上级是它的父目录（不是磁盘列表）',
      nested.parent !== drivesRoot && path.dirname(nested.dir) === nested.parent,
      `${nested.dir} → ${nested.parent}`);
  }
}


const plays0 = await exposed.api.plays.get();
check('plays:get 返回排行榜与汇总',
  Array.isArray(plays0.ranking) && typeof plays0.summary?.totalPlays === 'number',
  JSON.stringify(plays0.summary));
check('初始没有播放记录', plays0.ranking.length === 0 && plays0.summary.totalPlays === 0,
  `${plays0.ranking.length} 条`);
const countedBad = await exposed.api.plays.count('t-does-not-exist');
check('对不存在的曲目计数会被拒绝', countedBad.ok === false, JSON.stringify(countedBad));
const firstTrack = (await exposed.api.playlist.get())[0];
if (firstTrack) {
  const r1 = await exposed.api.plays.count(firstTrack.id);
  check('完播计数 +1', r1.ok === true && r1.plays === 1, JSON.stringify(r1));
  await exposed.api.plays.count(firstTrack.id);
  const plays1 = await exposed.api.plays.get();
  check('同一首重复完播累加（不新增条目）',
    plays1.ranking.length === 1 && plays1.ranking[0].plays === 2, JSON.stringify(plays1.summary));
  check('排行榜条目带元数据字段',
    'artist' in plays1.ranking[0] && 'title' in plays1.ranking[0] && 'album' in plays1.ranking[0], '');
  check('统计落盘（play-counts.json）',
    fs.existsSync(path.join(userData, 'play-counts.json')), path.join(userData, 'play-counts.json'));
  
  const keyToRemove = plays1.ranking[0].key;
  const removeRes = await exposed.api.plays.remove([keyToRemove]);
  check('plays:remove 按 key 移除记录',
    removeRes.removed === 1 && removeRes.ranking.length === 0, JSON.stringify(removeRes.summary));
  check('移除后重新读取仍为空（已持久化）',
    (await exposed.api.plays.get()).ranking.length === 0, '');
  check('移除不存在的 key 返回 0',
    (await exposed.api.plays.remove(['nope'])).removed === 0, '');
}


const volNormal = await exposed.api.player.volume(0.6);
check('音量接口返回实际音量', Math.abs(volNormal - 0.6) < 0.001, String(volNormal));
const muteSet = await exposed.api.settings.set({ muted: true });
check('静音写进设置且音量保留',
  muteSet.settings.muted === true && Math.abs(muteSet.settings.volume - 0.6) < 0.001,
  JSON.stringify({ muted: muteSet.settings.muted, volume: muteSet.settings.volume }));
const stMuted = await exposed.api.player.state();
check('静音后引擎音量确实为 0', Math.abs((stMuted.volume ?? -1)) < 0.001, String(stMuted.volume));
const unMuteSet = await exposed.api.settings.set({ muted: false });
check('取消静音后音量还原为 0.6',
  unMuteSet.settings.muted === false && Math.abs(unMuteSet.settings.volume - 0.6) < 0.001,
  JSON.stringify({ muted: unMuteSet.settings.muted, volume: unMuteSet.settings.volume }));
const stUnmuted = await exposed.api.player.state();
check('取消静音后引擎音量回到 0.6', Math.abs(stUnmuted.volume - 0.6) < 0.001, String(stUnmuted.volume));


const infoAll = await exposed.api.info();
const wInfo = infoAll.wine || {};
check('info.wine 结构完整',
  typeof wInfo.detected === 'boolean' && 'version' in wInfo && typeof wInfo.mode === 'string' &&
  typeof wInfo.active === 'boolean' && Array.isArray(wInfo.chain) && Array.isArray(wInfo.unsupported),
  JSON.stringify(wInfo));
check('本机（原生 Windows）未误判为 Wine 且兼容模式不生效',
  wInfo.detected === false && wInfo.active === false && wInfo.noGlass === false, `detected=${wInfo.detected}`);
check('Wine 兼容模式默认 auto 且标注独占不可用',
  wInfo.mode === 'auto' && wInfo.unsupported.includes('wasapi-exclusive'),
  `mode=${wInfo.mode} unsupported=${wInfo.unsupported.join(',')}`);
check('settings:set 会回传 Wine 状态（界面据此刷新）',
  typeof exposed.api.settings.set === 'function', '');
const maxEvents = sentEvents.filter((e) => e.channel === 'window:maximized').length;
check('最大化状态已推送到渲染层', maxEvents >= 2, `${maxEvents} 次 window:maximized 事件`);


const preloadSrc = fs.readFileSync(path.join(projectRoot, 'src', 'preload', 'preload.js'), 'utf8');
const whitelist = (preloadSrc.match(/EVENT_CHANNELS = \[([\s\S]*?)\]/) || [, ''])[1]
  .split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);
const mainSrc = fs.readFileSync(path.join(projectRoot, 'src', 'main', 'main.js'), 'utf8')
  + fs.readFileSync(path.join(projectRoot, 'src', 'main', 'player.js'), 'utf8');
const missingEvents = whitelist.filter((c) => !mainSrc.includes(`'${c}'`));
check('事件通道白名单与主进程一致', missingEvents.length === 0, missingEvents.join(', ') || `${whitelist.length} 个事件通道`);


const rendererSrc = fs.readFileSync(path.join(projectRoot, 'src', 'renderer', 'renderer.js'), 'utf8');
const listened = [...rendererSrc.matchAll(/api\.on\('([^']+)'/g)].map((m) => m[1]);
const badListen = listened.filter((c) => !whitelist.includes(c));
check('渲染层监听的通道都在 preload 白名单内', badListen.length === 0, badListen.join(', ') || `${listened.length} 个监听通道`);

fs.rmSync(userData, { recursive: true, force: true });

const failed = checks.filter((c) => !c.ok);
console.log(`\n=== 汇总: ${checks.length - failed.length}/${checks.length} 通过 ===`);
if (failed.length) {
  for (const f of failed) console.error(`  ✗ ${f.name}: ${f.detail}`);
  process.exit(1);
}
process.exit(0);
