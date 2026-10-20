

import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Module = require('node:module');

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mainPath = path.join(projectRoot, 'src', 'main', 'main.js');




const sandbox = path.join(os.tmpdir(), `irix-migrate-unit-${process.pid}-${Date.now()}`);
const legacy = path.join(sandbox, 'AuroraPlayer-data');
const target = path.join(sandbox, 'iRixAudioPlayer-data');

const LEGACY_SETTINGS = { backend: 'wasapi-exclusive', volume: 0.33 };
const LEGACY_PLAYLIST = { version: 1, items: [{ id: 'legacy-1', path: 'D:\\old.flac' }] };

function resetSandbox({ legacyData = true } = {}) {
  fs.rmSync(sandbox, { recursive: true, force: true });
  fs.mkdirSync(sandbox, { recursive: true });
  if (legacyData) {
    fs.mkdirSync(path.join(legacy, 'GPUCache'), { recursive: true });   
    fs.writeFileSync(path.join(legacy, 'settings.json'), JSON.stringify(LEGACY_SETTINGS), 'utf8');
    fs.writeFileSync(path.join(legacy, 'playlist.json'), JSON.stringify(LEGACY_PLAYLIST), 'utf8');
    fs.writeFileSync(path.join(legacy, 'GPUCache', 'data_0'), 'x');
  }
}

let capturedUserData = null;
function loadMainWithFakeElectron() {
  const fakeElectron = {
    app: {
      requestSingleInstanceLock: () => true,
      
      commandLine: { appendSwitch: () => {}, hasSwitch: () => false },
      on: () => {},
      whenReady: () => ({ then: () => ({ catch: () => {} }) }),
      
      
      getPath: (name) => {
        if (name === 'userData') return path.join(os.tmpdir(), 'irix-unused');
        if (name === 'appData') return path.join(sandbox, 'appData');
        if (name === 'home') return path.join(sandbox, 'home');
        if (name === 'music') return path.join(sandbox, 'music');
        return sandbox;
      },
      setPath: (name, value) => { if (name === 'userData') capturedUserData = value; },
      getVersion: () => '1.0.0',
      quit: () => {},
      exit: () => {},
    },
    BrowserWindow: class { constructor() { this.webContents = { send() {}, on() {}, setWindowOpenHandler() {} }; } loadFile() {} on() {} },
    ipcMain: { handle: () => {}, on: () => {} },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    Menu: { setApplicationMenu: () => {}, buildFromTemplate: (t) => t },
    shell: { openExternal: () => {}, showItemInFolder: () => {} },
    contextBridge: { exposeInMainWorld: () => {} },
    ipcRenderer: { invoke: async () => {}, send: () => {}, on: () => {}, removeListener: () => {} },
    webUtils: { getPathForFile: () => '' },
  };
  const orig = Module._load;
  Module._load = function (request) {
    if (request === 'electron') return fakeElectron;
    return orig.apply(this, arguments);
  };
  try {
    delete require.cache[require.resolve(mainPath)];
    require(mainPath);
  } finally {
    Module._load = orig;
  }
}

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

process.env.PORTABLE_EXECUTABLE_DIR = sandbox;


console.log('\n[A] 目标目录不存在');
resetSandbox();
capturedUserData = null;
loadMainWithFakeElectron();
check('userData 指向新数据目录', capturedUserData === target, capturedUserData);
check('settings.json 已迁移', readJson(path.join(target, 'settings.json')).backend === 'wasapi-exclusive');
check('playlist.json 已迁移', readJson(path.join(target, 'playlist.json')).items.length === 1);
check('不搬运 Chromium 缓存', !fs.existsSync(path.join(target, 'GPUCache')));


console.log('\n[B] 目标存在但播放列表为空');
resetSandbox();
fs.mkdirSync(target, { recursive: true });
fs.writeFileSync(path.join(target, 'playlist.json'), JSON.stringify({ version: 1, items: [] }), 'utf8');
loadMainWithFakeElectron();
check('空播放列表被旧数据补齐',
  readJson(path.join(target, 'playlist.json')).items.length === 1,
  `${readJson(path.join(target, 'playlist.json')).items.length} 首`);
check('缺失的 settings.json 被补上', readJson(path.join(target, 'settings.json')).backend === 'wasapi-exclusive');


console.log('\n[C] 目标已有有效播放列表');
resetSandbox();
fs.mkdirSync(target, { recursive: true });
fs.writeFileSync(path.join(target, 'playlist.json'),
  JSON.stringify({ version: 1, items: [{ id: 'new-1', path: 'D:\\new.flac' }, { id: 'new-2', path: 'D:\\new2.flac' }] }), 'utf8');
fs.writeFileSync(path.join(target, 'settings.json'), JSON.stringify({ backend: 'directsound' }), 'utf8');
loadMainWithFakeElectron();
check('已有播放列表不被覆盖', readJson(path.join(target, 'playlist.json')).items.length === 2,
  `${readJson(path.join(target, 'playlist.json')).items.length} 首`);
check('已有设置不被覆盖', readJson(path.join(target, 'settings.json')).backend === 'directsound');


console.log('\n[D] 没有旧数据目录');
resetSandbox({ legacyData: false });
loadMainWithFakeElectron();
check('无旧目录时不报错也不创建文件', !fs.existsSync(path.join(target, 'playlist.json')));

fs.rmSync(sandbox, { recursive: true, force: true });

const failed = checks.filter((c) => !c.ok);
console.log(`\n=== 迁移单测: ${checks.length - failed.length}/${checks.length} 通过 ===`);
process.exit(failed.length ? 1 : 0);
