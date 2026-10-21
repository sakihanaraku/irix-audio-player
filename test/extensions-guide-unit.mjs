









import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = path.resolve(projectRoot, '..');
const guidePath = path.join(projectRoot, 'EXTENSIONS.md');
const communityDir = path.join(workspaceRoot, 'irix-extension', 'community');
const templateDir = path.join(communityDir, 'irix-extension-template');
const { Extensions, ID_RE } = require(path.join(projectRoot, 'src', 'main', 'extensions.js'));

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}
function read(p) { return fs.readFileSync(p, 'utf8'); }
function expectThrow(fn) {
  try { fn(); return null; } catch (err) { return err; }
}
function makeContainer(audio, meta = {}) {
  const metaBuf = Buffer.from(JSON.stringify(meta), 'utf8');
  const head = Buffer.alloc(12);
  head.write('HELLOXTS', 0, 'latin1');
  head.writeUInt32LE(metaBuf.length, 8);
  return Buffer.concat([head, metaBuf, audio]);
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'irix-xtxs-guide-'));
const cleanup = () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {  } };
process.on('exit', cleanup);

console.log('=== 扩展开发引导 + 社区模板校验 ===');
try {
  
  
  const guidePath = path.join(projectRoot, 'EXTENSIONS.md');
  const zhGuidePath = path.join(projectRoot, 'EXTENSIONS.zh-CN.md');
  const guide = read(guidePath);
  const guideTopics = [
    'extension.json', 'index.js', 'match', 'decode', 'passthrough',
    'meta', 'cover', 'duration', 'irix-extension-template', 'minAppVersion',
    'SHA-256', 'CATALOG.md', 'Security model and submission review', 'Community submission process',
    'extensions-guide-unit',
  ];
  const missing = guideTopics.filter((t) => !guide.includes(t));
  check('EXTENSIONS.md（英文默认入口）存在且覆盖完整规范',
    guide.length > 12000 && missing.length === 0,
    missing.length ? '缺少: ' + missing.join(', ') : `长度 ${guide.length}`);

  
  const jsonBlocks = [...guide.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
  let guideManifest = null;
  try { guideManifest = JSON.parse(jsonBlocks[0]); } catch { guideManifest = null; }
  check('EXTENSIONS.md 里的 extension.json 示例可解析', !!guideManifest);

  const zhGuide = read(zhGuidePath);
  const zhTopics = [
    'extension.json', 'index.js', 'match', 'decode', 'passthrough',
    'meta', 'cover', 'duration', 'irix-extension-template', 'minAppVersion',
    'SHA-256', 'CATALOG.md', '安全', '投稿', 'extensions-guide-unit',
  ];
  const zhMissing = zhTopics.filter((t) => !zhGuide.includes(t));
  check('EXTENSIONS.zh-CN.md（中文版）存在且覆盖完整规范',
    zhGuide.length > 12000 && zhMissing.length === 0,
    zhMissing.length ? '缺少: ' + zhMissing.join(', ') : `长度 ${zhGuide.length}`);
  const zhJsonBlocks = [...zhGuide.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
  let zhGuideManifest = null;
  try { zhGuideManifest = JSON.parse(zhJsonBlocks[0]); } catch { zhGuideManifest = null; }
  check('EXTENSIONS.zh-CN.md 里的 extension.json 示例可解析', !!zhGuideManifest);
  
  const templateManifestPath = path.join(templateDir, 'extension.json');
  const templateManifest = JSON.parse(read(templateManifestPath));
  check('模板 extension.json 合法（id 正则 / 必填字段 / entry 存在）',
    ID_RE.test(templateManifest.id) &&
    templateManifest.id === path.basename(templateDir) &&
    typeof templateManifest.name === 'string' && templateManifest.name.length > 0 &&
    typeof templateManifest.version === 'string' && templateManifest.version.length > 0 &&
    typeof templateManifest.description === 'string' && templateManifest.description.length > 0 &&
    Array.isArray(templateManifest.extensions) && templateManifest.extensions.includes('hello') &&
    fs.existsSync(path.join(templateDir, templateManifest.entry || 'index.js')),
    JSON.stringify({ id: templateManifest.id, version: templateManifest.version }));
  check('模板 manifest 声明 ext-v2 设置 + 命令',
    Array.isArray(templateManifest.settings) && templateManifest.settings.some((s) => s.key === 'passthroughUnknown' && s.type === 'boolean') &&
    Array.isArray(templateManifest.commands) && templateManifest.commands.some((c) => c.id === 'ping'));
  check('引导内嵌示例与模板清单一致（id / extensions）',
    guideManifest && guideManifest.id === templateManifest.id &&
    Array.isArray(guideManifest.extensions) && guideManifest.extensions.join() === templateManifest.extensions.join() &&
    zhGuideManifest && zhGuideManifest.id === templateManifest.id &&
    Array.isArray(zhGuideManifest.extensions) && zhGuideManifest.extensions.join() === templateManifest.extensions.join());

  
  for (const [file, label, expectedManifest] of [
    ['EXTENSIONS.zh-CN.md', 'Chinese', zhGuideManifest],
    ['EXTENSIONS.ja.md', 'Japanese', null],
  ]) {
    let text = '';
    try { text = read(path.join(projectRoot, file)); } catch {  }
    const fences = (text.match(/```/g) || []).length;
    const blocks = [...text.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    let manifest = expectedManifest;
    if (!manifest) { try { manifest = JSON.parse(blocks[0]); } catch { manifest = null; } }
    check(`${label} 开发指南存在且与模板示例一致`,
      text.length > 10000 && fences % 2 === 0 && manifest &&
      manifest.id === templateManifest.id &&
      Array.isArray(manifest.extensions) && manifest.extensions.join() === templateManifest.extensions.join(),
      text ? `长度 ${text.length} / fences ${fences}` : '文件不存在');
  }
  check('模板 README / 社区投稿说明 / 目录文件齐全',
    fs.existsSync(path.join(templateDir, 'README.md')) &&
    read(path.join(templateDir, 'README.md')).includes('EXTENSIONS.md') &&
    fs.existsSync(path.join(templateDir, 'make-sample.mjs')) &&
    fs.existsSync(path.join(communityDir, 'README.md')) &&
    fs.existsSync(path.join(communityDir, 'CATALOG.md')) &&
    read(path.join(communityDir, 'CATALOG.md')).includes('SHA-256'));

  
  const plugin = require(path.join(templateDir, 'index.js'));
  check('模板模块导出 { id, match: RegExp, decode, readMeta, activate, commands }',
    typeof plugin.id === 'string' && plugin.id === templateManifest.id &&
    plugin.match instanceof RegExp && typeof plugin.decode === 'function' &&
    typeof plugin.readMeta === 'function' && typeof plugin.activate === 'function' &&
    typeof plugin.deactivate === 'function' && plugin.commands && typeof plugin.commands.ping === 'function');

  const audio = Buffer.concat([Buffer.from('fLaC', 'latin1'), Buffer.alloc(256, 0x5a)]);
  const sample = makeContainer(audio, { title: '标题', artist: '艺术家', album: '专辑', duration: 195000 });
  const out = plugin.decode(sample, { name: 'song.hello' });
  check('decode 正常容器：返回 Buffer / ext=flac / 元数据 / passthrough=false',
    out && Buffer.isBuffer(out.data) && out.data.length === audio.length &&
    out.ext === 'flac' && out.meta && out.meta.title === '标题' &&
    out.meta.artist === '艺术家' && out.meta.album === '专辑' &&
    out.meta.duration === 195000 && out.passthrough === false,
    `data=${out && out.data && out.data.length} ext=${out && out.ext}`);
  check('decode 识别真实格式（ID3 → mp3）',
    plugin.decode(makeContainer(Buffer.concat([Buffer.from('ID3', 'latin1'), Buffer.alloc(32)])), {}).ext === 'mp3');
  check('readMeta：只读元数据（不解码音频）返回 duration 毫秒',
    (() => {
      const m = plugin.readMeta(sample, { name: 'song.hello' });
      return m && m.title === '标题' && m.duration === 195000;
    })());
  check('match 只匹配容器后缀（大小写不敏感）',
    plugin.match.test('song.hello') && plugin.match.test('SONG.HELLO') && !plugin.match.test('song.flac'));
  const idempotent = plugin.decode(sample, { name: 'song.hello' }).data.length === out.data.length;
  check('decode 连续调用结果一致（无副作用）', idempotent);
  const e1 = expectThrow(() => plugin.decode(Buffer.alloc(4), {}));
  const e2 = expectThrow(() => plugin.decode(Buffer.from('NOTHELLO____', 'latin1'), {}));
  const badLen = Buffer.alloc(12); badLen.write('HELLOXTS', 0, 'latin1'); badLen.writeUInt32LE(1024, 8);
  const e3 = expectThrow(() => plugin.decode(badLen, {}));
  const emptyPayload = makeContainer(Buffer.alloc(0), {});
  const e4 = expectThrow(() => plugin.decode(emptyPayload, {}));
  check('decode 对坏文件抛可读错误（短文件 / 魔数 / 头长度 / 空音频）',
    !!e1 && !!e2 && !!e3 && !!e4 && [e1, e2, e3, e4].every((e) => typeof e.message === 'string' && e.message.length > 0),
    `messages=${[e1, e2, e3, e4].map((e) => e && e.message).join(' | ')}`);

  
  const inputAudio = path.join(tmp, 'input.flac');
  fs.writeFileSync(inputAudio, audio);
  const sampleOut = path.join(tmp, 'song.hello');
  const mk = spawnSync(process.execPath, [path.join(templateDir, 'make-sample.mjs'), inputAudio, sampleOut, '样例标题', '样例艺术家'], {
    encoding: 'utf8', windowsHide: true,
  });
  const made = fs.existsSync(sampleOut) ? plugin.decode(fs.readFileSync(sampleOut), { name: 'song.hello' }) : null;
  check('make-sample.mjs 生成的 .hello 能被模板解码',
    mk.status === 0 && made && made.ext === 'flac' && made.meta && made.meta.title === '样例标题' && made.data.length === audio.length,
    (mk.stderr || mk.stdout || '').trim());

  
  const pkg = path.join(tmp, `iRix-Extension-${templateManifest.id}-${templateManifest.version}.xtxs`);
  const tarBuild = spawnSync('tar', ['-cf', pkg, '-C', templateDir, '.'], { encoding: 'utf8', windowsHide: true });
  check('用系统 tar 打出 .xtxs 包', tarBuild.status === 0 && fs.existsSync(pkg) && fs.statSync(pkg).size > 0,
    (tarBuild.stderr || '').trim());

  const extensionsRoot = path.join(tmp, 'extensions');
  const enabled = [];
  const settingsStore = {};
  const mgr = new Extensions({
    dir: extensionsRoot,
    getEnabled: () => enabled.slice(),
    saveEnabled: (ids) => { enabled.length = 0; enabled.push(...ids); return Promise.resolve(); },
    appVersion: '1.0.2-extUpdate',
    getSettings: (id) => ({ ...(settingsStore[id] || {}) }),
    persistSettings: async (id, values) => { settingsStore[id] = { ...values }; },
    clearSettings: async (id) => { delete settingsStore[id]; },
  });
  const installed = mgr.installFromFile(pkg);
  check('installFromFile：解压 / 校验 / 复制到 extensions/<id> / 默认启用',
    installed && installed.id === templateManifest.id && enabled.includes(templateManifest.id) &&
    fs.existsSync(path.join(extensionsRoot, templateManifest.id, 'extension.json')) &&
    fs.existsSync(path.join(extensionsRoot, templateManifest.id, 'index.js')),
    `enabled=${JSON.stringify(enabled)}`);
  const list = mgr.list();
  check('list：元数据完整（name/version/extensions/installed/enabled）',
    list.length === 1 && list[0].id === templateManifest.id &&
    list[0].name === templateManifest.name && list[0].version === templateManifest.version &&
    list[0].extensions.join() === 'hello' && list[0].installed === true && list[0].enabled === true,
    JSON.stringify(list[0]));
  const loaded = mgr.loaded();
  const handler = mgr.findHandler('song.hello');
  const viaHandler = handler && handler.decode(sample, { name: 'song.hello' });
  check('loaded / findHandler / supportedExts / 通过加载器 decode',
    loaded.length === 1 && handler && typeof handler.decode === 'function' &&
    viaHandler && viaHandler.ext === 'flac' &&
    mgr.supportedExts().includes('hello'));
  check('loaded：activate(ctx) 收到 appVersion / extension / settings',
    loaded.length === 1 && loaded[0].ctx.appVersion === '1.0.2-extUpdate' &&
    loaded[0].ctx.extension.id === templateManifest.id &&
    loaded[0].ctx.extension.version === templateManifest.version &&
    loaded[0].ctx.settings.passthroughUnknown === false);
  const setRes = await mgr.setSetting(templateManifest.id, 'passthroughUnknown', true);
  check('setSetting + runCommand：模板设置保存 / 命令可执行',
    setRes.values.passthroughUnknown === true && settingsStore[templateManifest.id].passthroughUnknown === true &&
    (await mgr.runCommand(templateManifest.id, 'ping')).message.includes('OK'));
  mgr.uninstall(templateManifest.id);
  check('uninstall：目录与启用列表都清掉',
    !fs.existsSync(path.join(extensionsRoot, templateManifest.id)) &&
    mgr.list().length === 0 && enabled.length === 0);
} catch (err) {
  check('扩展引导校验块执行异常', false, String(err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : err));
}

const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;
console.log(`\n=== 扩展开发引导 + 社区模板: ${passed}/${results.length} 通过 ===`);
if (failed) {
  for (const r of results) if (!r.ok) console.log(`  ✗ ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
}
process.exit(failed ? 1 : 0);
