



import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const I18N = require('../src/renderer/i18n.js');

const renderer = fs.readFileSync(path.join(projectRoot, 'src', 'renderer', 'renderer.js'), 'utf8');
const mainSrc = fs.readFileSync(path.join(projectRoot, 'src', 'main', 'main.js'), 'utf8');
const html = fs.readFileSync(path.join(projectRoot, 'src', 'renderer', 'index.html'), 'utf8');

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

const dict = new Set(Object.keys(I18N.DICT.zh));
const used = new Set();
for (const m of renderer.matchAll(/tr\('([^']+)'/g)) used.add(m[1]);
for (const m of mainSrc.matchAll(/mt\('([^']+)'/g)) used.add(m[1]);
for (const m of html.matchAll(/data-i18n(?:-title|-aria|-alt)?="([^"]+)"/g)) used.add(m[1]);

for (const m of renderer.matchAll(/'([a-z]+\.[a-z][\w.]*)'/g)) {
  if (dict.has(m[1])) used.add(m[1]);
}

console.log('=== 多语言词条校验 ===');
const missing = [...used].filter((k) => !dict.has(k));
check('引用的词条都存在', missing.length === 0, missing.length ? `缺失: ${missing.join(', ')}` : `${used.size} 个引用`);

const langs = I18N.LANGS;
const counts = langs.map((l) => Object.keys(I18N.DICT[l]).length);
check('三种语言键数量一致', new Set(counts).size === 1, langs.map((l, i) => `${l}:${counts[i]}`).join(' '));

let keyMismatch = [];
for (const l of langs) {
  const diff = Object.keys(I18N.DICT.zh).filter((k) => !(k in I18N.DICT[l]));
  const extra = Object.keys(I18N.DICT[l]).filter((k) => !(k in I18N.DICT.zh));
  if (diff.length || extra.length) keyMismatch.push(`${l} 缺[${diff.join(',')}] 多[${extra.join(',')}]`);
}
check('各语言键集合完全相同', keyMismatch.length === 0, keyMismatch.join(' | '));

const empty = [];
for (const l of langs) {
  for (const [k, v] of Object.entries(I18N.DICT[l])) {
    if (typeof v !== 'string' || !v.trim()) empty.push(`${l}:${k}`);
  }
}
check('没有空词条', empty.length === 0, empty.join(', ') || '');


const placeholderIssues = [];
for (const k of Object.keys(I18N.DICT.zh)) {
  const pick = (l) => new Set([...(I18N.DICT[l][k] || '').matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort());
  const base = [...pick('zh')].join(',');
  for (const l of langs) {
    if ([...pick(l)].join(',') !== base) placeholderIssues.push(`${l}:${k}`);
  }
}
check('占位符在各语言中一致', placeholderIssues.length === 0, placeholderIssues.join(', ') || '');

const unused = [...dict].filter((k) => !used.has(k));
console.log(`  · 未被引用的词条 ${unused.length} 个${unused.length ? '：' + unused.join(', ') : ''}`);

const failed = checks.filter((c) => !c.ok);
console.log(`\n=== 词条校验: ${checks.length - failed.length}/${checks.length} 通过 ===`);
process.exit(failed.length ? 1 : 0);
