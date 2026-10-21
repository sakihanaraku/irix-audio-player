









import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { Extensions } = require(path.join(projectRoot, 'src', 'main', 'extensions.js'));

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'irix-ext-api-'));
process.on('exit', () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {  } });

const extRoot = path.join(tmp, 'extensions');
const pluginDir = path.join(extRoot, 'api-demo');
fs.mkdirSync(pluginDir, { recursive: true });

const manifest = {
  id: 'api-demo', name: 'API Demo', version: '2.0.0',
  description: 'ext-v2 接口测试', entry: 'index.js', extensions: ['demo'], author: 'tester',
  settings: [
    { key: 'mode', type: 'select', label: '模式', default: 'a', options: ['a', { value: 'b', label: 'B 模式' }] },
    { key: 'count', type: 'number', label: '数量', default: 2, min: 1, max: 5, step: 1 },
    { key: 'flag', type: 'boolean', label: '开关', default: true },
    { key: 'label', type: 'text', label: '标签', default: 'hello' },
    { key: 'bad key', type: 'text', label: '非法键' },
  ],
  commands: [
    { id: 'ping', label: 'Ping' },
    { id: 'boom', label: '失败命令' },
    { id: 'missing', label: '未实现命令' },
  ],
};
fs.writeFileSync(path.join(pluginDir, 'extension.json'), JSON.stringify(manifest, null, 2), 'utf8');
fs.writeFileSync(path.join(pluginDir, 'index.js'), `'use strict';
let activated = 0;
let deactivated = 0;
const api = {
  id: 'api-demo',
  match: /\\.demo$/i,
  activate(ctx) {
    activated++;
    api.__activated = activated;
    ctx.log('activate', ctx.extension.id, ctx.appVersion);
    api.__ctx = ctx;
  },
  deactivate() {
    deactivated++;
    api.__deactivated = deactivated;
  },
  onSettingsChanged(values, key) {
    (api.__changes = api.__changes || []).push([key, values[key]]);
  },
  commands: {
    async ping(ctx) { return 'pong:' + ctx.settings.mode + ':' + ctx.extension.version; },
    async boom() { throw new Error('命令刻意失败'); },
  },
  decode(buffer) { return { data: Buffer.from('raw-audio'), ext: 'flac' }; },
  readMeta(buffer, opts) { return { title: '标题', artist: '艺术家', album: '专辑', duration: 1234, name: opts && opts.name }; },
  extractCover() { return Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...new Array(80).fill(1)]); },
  processAudio(data, opts) { return Buffer.concat([data, Buffer.from(':' + opts.ext)]); },
};
module.exports = api;
`, 'utf8');

const logs = [];
const saved = {};                 
let persistCount = 0;
const manager = new Extensions({
  dir: extRoot,
  getEnabled: () => ['api-demo'],
  saveEnabled: async () => {},
  appVersion: '1.0.2-extUpdate',
  getSettings: (id) => ({ ...(saved[id] || {}) }),
  persistSettings: async (id, values) => { persistCount++; saved[id] = { ...values }; },
  clearSettings: async (id) => { delete saved[id]; },
  log: (...args) => logs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')),
});

try {
  
  const list = manager.list();
  const item = list.find((x) => x.id === 'api-demo');
  check('list：设置描述被规范化（非法键被丢弃 / 类型与默认值齐全）',
    !!item && item.settings.length === 4 &&
    item.settings.map((s) => s.type).join(',') === 'select,number,boolean,text' &&
    item.settings[0].default === 'a' && item.settings[0].options.length === 2 &&
    item.settings[1].min === 1 && item.settings[1].max === 5 &&
    item.settings[2].default === true && item.settings[3].default === 'hello' &&
    item.commands.length === 3,
    JSON.stringify(item && item.settings));
  check('settingsFor：默认值合并 / saved 值优先',
    manager.settingsFor('api-demo').mode === 'a' && manager.settingsFor('api-demo').count === 2);

  
  const loaded = manager.loaded();
  const rec = loaded.find((r) => r.manifest.id === 'api-demo');
  check('loaded：require 后调用 activate(ctx)，ctx 含 appVersion/extension/settings/log',
    loaded.length === 1 && rec.module.__activated === 1 &&
    rec.ctx.appVersion === '1.0.2-extUpdate' &&
    rec.ctx.extension.id === 'api-demo' && rec.ctx.extension.version === '2.0.0' &&
    rec.ctx.settings.mode === 'a' && typeof rec.ctx.log === 'function' &&
    logs.some((l) => l.includes('activate api-demo 1.0.2-extUpdate')),
    logs.join(' | '));
  check('findRecord / findHandler / match 只匹配 .demo',
    !!manager.findRecord('song.demo') && manager.findHandler('song.DEMO') &&
    !manager.findHandler('song.flac'));
  const mod = rec.module;
  check('readMeta / extractCover / processAudio 钩子存在且可调用',
    mod.readMeta(Buffer.from('x'), { name: 'a.demo' }).duration === 1234 &&
    Buffer.isBuffer(mod.extractCover(Buffer.from('x'))) &&
    mod.processAudio(Buffer.from('abc'), { ext: 'flac' }).toString() === 'abc:flac');

  
  const r1 = await manager.setSetting('api-demo', 'mode', 'b');
  check('setSetting(select)：保存、返回 values、onSettingsChanged + live=true',
    persistCount === 1 && saved['api-demo'].mode === 'b' &&
    r1.values.mode === 'b' && r1.live === true &&
    (mod.__changes || []).some(([k, v]) => k === 'mode' && v === 'b'),
    JSON.stringify(saved));
  const r2 = await manager.setSetting('api-demo', 'count', 99);
  check('setSetting(number)：越界被 clamp 到 max',
    r2.values.count === 5 && saved['api-demo'].count === 5, `count=${r2.values.count}`);
  const r3 = await manager.setSetting('api-demo', 'flag', false);
  check('setSetting(boolean)：布尔归一化', r3.values.flag === false && saved['api-demo'].flag === false);
  const r4 = await manager.setSetting('api-demo', 'label', '世界');
  check('setSetting(text)：字符串保存', r4.values.label === '世界');
  const e1 = await manager.setSetting('api-demo', 'mode', 'z').then(() => null, (e) => e);
  const e2 = await manager.setSetting('api-demo', 'nope', 'x').then(() => null, (e) => e);
  check('setSetting：非法选项 / 未知键被拒绝', !!e1 && !!e2,
    `${e1 && e1.message} | ${e2 && e2.message}`);

  
  const c1 = await manager.runCommand('api-demo', 'ping');
  const c2 = await manager.runCommand('api-demo', 'boom');
  const c3 = await manager.runCommand('api-demo', 'missing');
  const e3 = await manager.runCommand('api-demo', 'not-declared').then(() => null, (e) => e);
  check('runCommand：成功返回消息 / 抛错转为 {ok:false} / 未声明命令被拒绝',
    c1.ok === true && c1.message === 'pong:b:2.0.0' &&
    c2.ok === false && String(c2.error).includes('命令刻意失败') &&
    c3.ok === false && String(c3.error).includes('未实现') && !!e3,
    JSON.stringify([c1, c2, c3]));

  
  manager.setEnabled('api-demo', false);
  check('setEnabled(false)：调用 deactivate 并清缓存', mod.__deactivated === 1 && manager.cache.size === 0);
  manager.setEnabled('api-demo', true);
  const rec2 = manager.load('api-demo');
  manager.shutdown();
  check('shutdown：退出时调用 deactivate（best effort）', rec2.module.__deactivated === 2 && manager.cache.size === 0);

  
  const badDir = path.join(extRoot, 'broken-ext');
  fs.mkdirSync(badDir, { recursive: true });
  fs.writeFileSync(path.join(badDir, 'extension.json'),
    JSON.stringify({ id: 'broken-ext', name: 'Broken', version: '0.0.1', entry: 'missing.js' }), 'utf8');
  const list2 = manager.list();
  check('坏插件（entry 缺失）：list 标记 installed=false，加载失败被跳过',
    list2.some((x) => x.id === 'broken-ext' && x.installed === false) &&
    manager.loaded().every((r) => r.manifest.id !== 'broken-ext'), '');
} catch (err) {
  check('ext-v2 接口校验块执行异常', false,
    String(err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : err));
}

const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;
console.log(`\n=== 扩展接口 ext-v2: ${passed}/${results.length} 通过 ===`);
if (failed) for (const r of results) if (!r.ok) console.log(`  ✗ ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
process.exit(failed ? 1 : 0);
