








import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = path.resolve(projectRoot, '..');
const pluginSrc = path.join(workspaceRoot, 'irix-extension', 'qa', 'lang-loader');
const { Extensions } = require(path.join(projectRoot, 'src', 'main', 'extensions.js'));
const { parseLangText, parseLangFile, ERR_CORRUPT } = require(path.join(pluginSrc, 'lang-format.js'));

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'irix-lang-loader-'));
process.on('exit', () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {  } });
const extRoot = path.join(tmp, 'extensions');
const pluginDir = path.join(extRoot, 'lang-loader');
fs.mkdirSync(extRoot, { recursive: true });
fs.cpSync(pluginSrc, pluginDir, { recursive: true });

try {
  
  const ja = parseLangFile(path.join(pluginDir, 'lang', 'ja.lang'));
  check('.lang：完整语言文件解析（元数据 + 全量 strings）',
    ja.format === 'irix-lang-v1' && ja.code === 'ja' && ja.name === '日本語' &&
    ja.font.includes('Yu Gothic') && Object.keys(ja.strings).length > 200 &&
    ja.strings['tip.settings'] === '設定',
    `${ja.name} / ${Object.keys(ja.strings).length} 条`);

  const zh = parseLangFile(path.join(pluginDir, 'lang', 'zh.lang'));
  check('.lang：中文文件（含换行转义）',
    zh.code === 'zh-CN' && zh.strings['tip.settings'] === '设置' &&
    typeof zh.strings['lyricsEdit.placeholder'] === 'string' &&
    zh.strings['lyricsEdit.placeholder'].includes('\n'),
    `${zh.name} / ${Object.keys(zh.strings).length} 条`);

  let brokenErr = '';
  try { parseLangFile(path.join(pluginDir, 'lang', 'broken.lang')); } catch (e) { brokenErr = e.message; }
  check('损坏文件：@format 不对 → 损坏的文件', brokenErr === ERR_CORRUPT, brokenErr);

  let missingErr = '';
  try { parseLangText('@format=irix-lang-v1\n@code=ja\ntip.settings=x\n'); } catch (e) { missingErr = e.message; }
  check('损坏文件：缺少 @name → 损坏的文件', missingErr === ERR_CORRUPT, missingErr);

  let dupErr = '';
  try { parseLangText('@format=irix-lang-v1\n@code=ja\n@name=X\na.b=x\na.b=y\n'); } catch (e) { dupErr = e.message; }
  check('损坏文件：重复键 → 损坏的文件', dupErr === ERR_CORRUPT, dupErr);

  let keyErr = '';
  try { parseLangText('@format=irix-lang-v1\n@code=ja\n@name=X\nbad key=x\n'); } catch (e) { keyErr = e.message; }
  check('损坏文件：非法键名 → 损坏的文件', keyErr === ERR_CORRUPT, keyErr);

  
  fs.writeFileSync(path.join(pluginDir, 'selected.json'), JSON.stringify({ file: 'zh.lang' }), 'utf8');
  const seen = [];
  const manager = new Extensions({
    dir: extRoot,
    getEnabled: () => ['lang-loader'],
    saveEnabled: async () => {},
    appVersion: '1.0.2-ext-v2x',
    onUiChanged: (ui) => seen.push(ui),
    log: () => {},
  });
  manager.activateStartup();
  const listedLang = manager.list().find((x) => x.id === 'lang-loader');
  check('语言扩展 manifest：uiLanguage=true（安装后禁用内置语言选择）',
    listedLang && listedLang.uiLanguage === true && listedLang.ui === true &&
    listedLang.name === 'Language Loader' && !!listedLang.description,
    JSON.stringify({ name: listedLang && listedLang.name, ui: listedLang && listedLang.ui, uiLanguage: listedLang && listedLang.uiLanguage }));
  check('语言扩展描述跟随当前界面语言（zh.lang 生效后为中文）',
    !!listedLang && /语言|扩展|自动加载/.test(listedLang.description || ''),
    listedLang && listedLang.description);
  const state = manager.uiState();
  check('启动自动加载：selected.json → zh.lang',
    state.language === 'zh-CN' && state.strings['tip.settings'] === '设置' &&
    state.font.includes('YaHei'),
    `${state.language} / ${state.font}`);
  check('ctx.ui 覆盖会推送给渲染层',
    seen.length >= 1 && seen[seen.length - 1].strings['tip.settings'] === '设置',
    `notifications=${seen.length}`);

  const mod = manager.cache.get('lang-loader').module;
  const listed = mod.__test.listLanguages();
  check('选择窗口列表：有效文件 + 损坏文件都列出',
    listed.some((x) => x.file === 'ja.lang' && x.valid) &&
    listed.some((x) => x.file === 'broken.lang' && !x.valid && x.error === '损坏的文件'),
    JSON.stringify(listed.map((x) => [x.file, x.valid])));
  check('插件自身界面文案来自 .lang（ext.lang-loader.*）',
    mod.__test.pickupUi().title === '选择语言文件' &&
    mod.__test.pickupUi().close === '关闭',
    JSON.stringify(mod.__test.pickupUi()));
  check('.lang 文件包含插件 UI 本地化键',
    Object.prototype.hasOwnProperty.call(ja.strings, 'ext.lang-loader.command.choose') &&
    Object.prototype.hasOwnProperty.call(ja.strings, 'ext.lang-loader.popup.title'),
    'ext.lang-loader.*');

  fs.writeFileSync(path.join(pluginDir, 'selected.json'), JSON.stringify({ file: 'broken.lang' }), 'utf8');
  manager.deactivate('lang-loader');
  manager.activateStartup();
  const fallback = manager.uiState();
  check('selected 指向损坏文件 → 自动回退到第一个有效文件',
    fallback.language === 'en' && fallback.strings['tip.settings'] === 'Settings',
    fallback.language);

  const cmd = await manager.runCommand('lang-loader', 'choose');
  check('无 Electron 环境：选择命令返回可读错误而不是崩溃',
    cmd.ok === false && /Electron/.test(cmd.error || ''),
    JSON.stringify(cmd));

  
  const pkg = path.join(projectRoot, 'dist', 'iRix-Extension-lang-loader-1.0.0.xtxs');
  if (fs.existsSync(pkg)) {
    let enabled = [];
    const manager2 = new Extensions({
      dir: path.join(tmp, 'installed-extensions'),
      getEnabled: () => enabled,
      saveEnabled: (ids) => { enabled = ids; },
      appVersion: '1.0.2-ext-v2x',
      log: () => {},
    });
    const installed = manager2.installFromFile(pkg);
    const installedRec = manager2.load('lang-loader');
    check('.xtxs 安装：扩展清单 + lang 目录 + selected 状态可用',
      installed.id === 'lang-loader' && enabled.includes('lang-loader') &&
      fs.existsSync(path.join(manager2.dir, 'lang-loader', 'lang', 'ja.lang')) &&
      !!installedRec.ctx.ui,
      `enabled=${enabled.join(',')}`);
  } else {
    check('.xtxs 安装：未找到打包产物（跳过）', true, pkg);
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n=== 语言扩展: ${results.length - failed}/${results.length} 通过 ===`);
  process.exit(failed ? 1 : 0);
} catch (err) {
  console.error(err);
  process.exit(1);
}
