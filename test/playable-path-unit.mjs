



import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { resolvePlayableTarget } = require(path.join(projectRoot, 'src', 'main', 'playable.js'));

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

const track = { path: 'C:\\Music\\a.testext', playPath: 'C:\\Music\\a.testext', meta: { title: 'T' } };

const r1 = resolvePlayableTarget('C:\\cache\\a.wav', track);
check('字符串结果：直接用解码后的真实路径', r1.path === 'C:\\cache\\a.wav', JSON.stringify(r1));

const r2 = resolvePlayableTarget({ path: 'C:\\cache\\a.wav', meta: { title: 'T2', duration: 1000 } }, track);
check('{path, meta} 结果：取 path + meta', r2.path === 'C:\\cache\\a.wav' && r2.meta.title === 'T2', JSON.stringify(r2));

const r3 = resolvePlayableTarget({ metaOnly: true, meta: { title: 'T3' } }, track);
check('metaOnly 结果不应作为播放路径（回退原文件）', r3.path === track.path, JSON.stringify(r3));

const r4 = resolvePlayableTarget('', track);
check('空结果：回退 track.playPath/track.path', r4.path === track.path);


check('返回纯字符串 path（PlayerSession 可直接使用）', typeof r1.path === 'string' && r1.path.length > 0);

const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;
console.log(`\n=== 播放路径归一化: ${passed}/${results.length} 通过 ===`);
if (failed) for (const r of results) if (!r.ok) console.log(`  ✗ ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
process.exit(failed ? 1 : 0);
