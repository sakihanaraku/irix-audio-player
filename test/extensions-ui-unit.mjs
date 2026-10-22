



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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'irix-ext-ui-'));
process.on('exit', () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {  } });
const extRoot = path.join(tmp, 'extensions');

function makePlugin(id, manifestExtra, activateBody) {
  const dir = path.join(extRoot, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'extension.json'), JSON.stringify({
    id, name: id, version: '1.0.0', entry: 'index.js',
    ...manifestExtra,
  }, null, 2), 'utf8');
  fs.writeFileSync(path.join(dir, 'index.js'), `'use strict';
module.exports = {
  activate(ctx) {
    ${activateBody}
  },
  deactivate() {},
};
`, 'utf8');
}

makePlugin('ui-demo', { ui: true, startup: true }, `
    ctx.ui.setTexts({
      strings: { 'tip.lyrics': '扩展歌词', 'set.audioMode': '扩展声卡模式' },
      font: 'Test Font, sans-serif',
      language: 'ja',
    });
`);
makePlugin('no-ui', {}, `
    try { ctx.ui.setFont('X'); } catch (err) { module.exports.__noUiError = err.message; }
`);

const seen = [];
const manager = new Extensions({
  dir: extRoot,
  getEnabled: () => ['ui-demo', 'no-ui'],
  saveEnabled: async () => {},
  appVersion: '1.0.2-ext-v2x',
  onUiChanged: (ui) => seen.push(ui),
  log: () => {},
});

try {
  const list = manager.list();
  check('list：manifest.ui 暴露为 ui:true',
    list.find((x) => x.id === 'ui-demo')?.ui === true &&
    list.find((x) => x.id === 'no-ui')?.ui === false,
    JSON.stringify(list.map((x) => [x.id, x.ui])));

  manager.activateStartup();
  manager.load('no-ui');
  const state = manager.uiState();
  check('ctx.ui.setTexts：字符串 / 字体 / lang 生效',
    state.strings['tip.lyrics'] === '扩展歌词' &&
    state.strings['set.audioMode'] === '扩展声卡模式' &&
    state.font === 'Test Font, sans-serif' && state.language === 'ja',
    JSON.stringify(state));
  check('onUiChanged：覆盖变化会通知渲染层',
    seen.length >= 1 && seen[seen.length - 1].strings['tip.lyrics'] === '扩展歌词',
    `notifications=${seen.length}`);

  check('未声明 ui:true 的扩展调用 ctx.ui 会报错',
    manager.cache.get('no-ui').module.__noUiError === '扩展未声明 ui 能力（在 extension.json 设置 "ui": true）',
    String(manager.cache.get('no-ui').module.__noUiError));

  let badKey = '';
  try { manager.applyUi('ui-demo', { strings: { 'bad key': 'x' } }); } catch (e) { badKey = e.message; }
  check('非法 i18n 键被拒绝', /键名不合法/.test(badKey), badKey);

  let badFont = '';
  try { manager.applyUi('ui-demo', { font: 'x<script>' }); } catch (e) { badFont = e.message; }
  check('非法字体值被拒绝', /非法字符/.test(badFont), badFont);

  let badLang = '';
  try { manager.applyUi('ui-demo', { language: '日本語' }); } catch (e) { badLang = e.message; }
  check('非法 lang 值被拒绝', /不合法/.test(badLang), badLang);

  manager.applyUi('ui-demo', { strings: { 'tip.lyrics': '仅改一条' } });
  check('覆盖是替换式：新 strings 只保留本次键',
    manager.uiState().strings['tip.lyrics'] === '仅改一条' &&
    manager.uiState().strings['set.audioMode'] === undefined,
    JSON.stringify(manager.uiState().strings));

  manager.deactivate('ui-demo');
  check('deactivate 后清除 UI 覆盖',
    manager.uiState().strings['tip.lyrics'] === undefined && manager.uiState().font === '',
    JSON.stringify(manager.uiState()));

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n=== ext-v2x 界面覆盖: ${results.length - failed}/${results.length} 通过 ===`);
  process.exit(failed ? 1 : 0);
} catch (err) {
  console.error(err);
  process.exit(1);
}
