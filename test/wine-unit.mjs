

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const wine = require('../src/main/wine.js');

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: !!ok });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

const NO_WINE = { env: {}, readRegistry: () => ({ found: false, version: null, source: null }) };
const fakeRegistry = (version) => () => ({ found: true, version, source: 'registry:HKCU\\Software\\Wine' });

console.log('=== Wine 兼容层单测 ===');


console.log('\n[A] 检测');
{
  const r = wine.detectWine(NO_WINE);
  check('没有信号时不认为是 Wine', r.detected === false && r.version === null, JSON.stringify(r));
  check('未检测到时不带 label 版本', r.label === 'Wine', r.label);
}
{
  const r = wine.detectWine({ env: { WINEPREFIX: 'C:\\prefix' }, readRegistry: NO_WINE.readRegistry });
  check('环境变量 WINEPREFIX 命中', r.detected === true && r.source === 'env:WINEPREFIX', JSON.stringify(r.source));
}
{
  const r = wine.detectWine({ env: { WINEARCH: 'win64', WINEDLLOVERRIDES: 'x=n' }, readRegistry: NO_WINE.readRegistry });
  check('多个环境变量都记录在案', r.envHits.length === 2 && r.detected === true, r.envHits.join(','));
}
{
  const r = wine.detectWine({ env: {}, readRegistry: fakeRegistry('wine-9.0') });
  check('注册表命中（HKCU\\Software\\Wine）', r.detected === true && r.source.startsWith('registry'), r.source);
  check('版本号被归一化', r.version === '9.0' && r.label === 'Wine 9.0', `${r.version} / ${r.label}`);
}
{
  const r = wine.detectWine({ env: {}, readRegistry: () => { throw new Error('reg 不存在'); } });
  check('注册表读取抛异常时不影响判定', r.detected === false, JSON.stringify(r.detected));
}
{
  const r = wine.detectWine({ env: { WINEPREFIX: 'x' }, readRegistry: fakeRegistry(null) });
  check('只有环境变量时版本未知但已判定为 Wine', r.detected === true && r.version === null && r.label === 'Wine', r.label);
}


console.log('\n[B] 版本号');
for (const [raw, want] of [
  ['wine-9.0', '9.0'], ['Wine 8.21', '8.21'], ['9', '9'], ['wine-10.0-rc2', '10.0'],
  [null, null], ['', null], ['no digits here', null],
]) {
  check(`normalizeVersion(${JSON.stringify(raw)}) → ${want}`, wine.normalizeVersion(raw) === want,
    String(wine.normalizeVersion(raw)));
}


console.log('\n[C] 兼容模式开关');
{
  const wineOn = { detected: true };
  check('auto + 检测到 Wine → 生效', wine.isWineCompatActive({ wineCompat: 'auto' }, wineOn) === true);
  check('auto + 未检测到 → 不生效', wine.isWineCompatActive({ wineCompat: 'auto' }, { detected: false }) === false);
  check('on 强制生效（即使没检测到）', wine.isWineCompatActive({ wineCompat: 'on' }, { detected: false }) === true);
  check('off 永不生效（即使检测到）', wine.isWineCompatActive({ wineCompat: 'off' }, wineOn) === false);
  check('缺省等价于 auto', wine.isWineCompatActive({}, wineOn) === true);
}


console.log('\n[D] 保守默认值');
{
  const r = wine.wineSafeOverrides(
    { backend: 'wasapi-shared', bufferMs: 100, periodMs: 10, ringMs: 300, allowFormatFallback: false },
    { detected: true });
  check('出厂默认值全部被替换',
    r.changes.backend === 'directsound' && r.changes.bufferMs === 200 &&
    r.changes.periodMs === 20 && r.changes.ringMs === 800,
    JSON.stringify(r.changes));
  check('独占回退开关被强制打开', r.changes.allowFormatFallback === true);
  check('说明里包含三项改动', r.notes.length >= 3, `${r.notes.length} 条`);
}
{
  const r = wine.wineSafeOverrides(
    { backend: 'mme', bufferMs: 400, periodMs: 10, ringMs: 300 }, { detected: true });
  check('用户手动改过的项不动', r.changes.backend === undefined && r.changes.bufferMs === undefined,
    `changes=${JSON.stringify(r.changes)}`);
  check('未改过的项仍然被替换', r.changes.periodMs === 20 && r.changes.ringMs === 800);
  check('skipped 列表记录了被保留的项', r.skipped.includes('backend') && r.skipped.includes('bufferMs'),
    r.skipped.join(','));
}
{
  const r = wine.wineSafeOverrides({ backend: 'wasapi-exclusive', bufferMs: 100, periodMs: 10, ringMs: 300 },
    { detected: true });
  check('用户选的独占模式被强制换掉（Wine 无此实现）', r.changes.backend === 'directsound', r.changes.backend);
}
{
  const r = wine.wineSafeOverrides({ wineCompat: 'off', backend: 'wasapi-shared' }, { detected: true });
  check('off 时不做任何覆盖', Object.keys(r.changes).length === 0, JSON.stringify(r.changes));
}
{
  const r = wine.wineSafeOverrides({ backend: 'wasapi-shared' }, { detected: false });
  check('未检测到 Wine 且 auto 时不覆盖', Object.keys(r.changes).length === 0);
}


console.log('\n[E] 后端降级链');
{
  const chain = wine.backendChain('wasapi-exclusive', { detected: true });
  check('Wine 下排除独占后端', !chain.includes('wasapi-exclusive'), chain.join(' → '));
  check('降级链含 共享/DirectSound/MME', chain.includes('wasapi-shared') && chain.includes('directsound') &&
    chain.includes('mme'), chain.join(' → '));
}
{
  const chain = wine.backendChain('directsound', { detected: true });
  check('首选后端排在最前且不重复', chain[0] === 'directsound' && new Set(chain).size === chain.length,
    chain.join(' → '));
}
{
  const chain = wine.backendChain('mme', { detected: true });
  check('首选 MME 时链首为 MME', chain[0] === 'mme', chain.join(' → '));
}
{
  const chain = wine.backendChain('wasapi-shared', { detected: false }, false);
  check('非 Wine 时只尝试用户选的后端（不做隐式降级）', chain.length === 1 && chain[0] === 'wasapi-shared',
    chain.join(' → '));
}
{
  const chain = wine.backendChain('', { detected: true });
  check('空后端给出可用链', chain.length >= 3, chain.join(' → '));
}


console.log('\n[F] 界面开关');
{
  const ui = wine.wineUiFlags({ detected: true, version: '9.0' }, {});
  check('生效时关闭玻璃效果（noGlass）', ui.active === true && ui.noGlass === true, JSON.stringify(ui));
  check('给出可显示的标签', ui.label === 'Wine 9.0', ui.label);
}
{
  const ui = wine.wineUiFlags({ detected: true, version: '9.0' }, { wineCompat: 'off' });
  check('off 时 noGlass 为 false', ui.active === false && ui.noGlass === false, JSON.stringify(ui));
}


console.log('\n[G] 真实注册表读取');
{
  const t0 = Date.now();
  const r = wine.readWineRegistry();
  const ms = Date.now() - t0;
  check('readWineRegistry 不抛异常且返回结构完整',
    typeof r.found === 'boolean' && 'version' in r && 'source' in r, JSON.stringify(r));
  check('读取耗时有超时保护（<2.5s）', ms < 2500, `${ms} ms`);
  check('本机（原生 Windows）未误判为 Wine', r.found === false, `found=${r.found}`);
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n=== Wine 兼容层: ${checks.length - failed.length}/${checks.length} 通过 ===`);
if (failed.length) {
  for (const f of failed) console.log(`  ✗ ${f.name}`);
  process.exit(1);
}
