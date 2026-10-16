
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { parsePathInput, expandEnv, REASON_TEXT } = require('../src/main/paths.js');

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: !!ok });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

const WIN = { platform: 'win32', env: { USERPROFILE: 'C:\\Users\\me', TEMP: 'C:\\Temp' }, home: 'C:\\Users\\me' };
const NIX = { platform: 'linux', env: { HOME: '/home/me' }, home: '/home/me' };
const P = (v, o = WIN) => parsePathInput(v, o);

console.log('=== 地址栏路径校验单测 ===');


console.log('\n[A] Windows 合法路径');
{
  const r = P('C:\\Users\\demo\\Music');
  check('盘符绝对路径通过', r.ok && r.path === 'C:\\Users\\demo\\Music' && r.kind === 'win', JSON.stringify(r));
  check('正斜杠也接受', P('C:/Users/demo').ok === true, JSON.stringify(P('C:/Users/demo')));
  check('带引号的路径会去引号', P('"C:\\Program Files"').path === 'C:\\Program Files',
    JSON.stringify(P('"C:\\Program Files"')));
  check('单引号同样处理', P("'C:\\Music'").path === 'C:\\Music', '');
  check('首尾空白被裁掉', P('   C:\\Music   ').path === 'C:\\Music', '');
  check('UNC 路径通过', P('\\\\server\\share\\music').ok === true, JSON.stringify(P('\\\\server\\share\\music')));
  check('环境变量展开（%VAR%）', P('%USERPROFILE%\\Music').path === 'C:\\Users\\me\\Music',
    JSON.stringify(P('%USERPROFILE%\\Music')));
  check('只写到盘符也通过', P('D:\\').ok === true, '');
  check('~ 展开到用户目录', P('~\\Music').path === 'C:\\Users\\me\\Music', JSON.stringify(P('~\\Music')));
}


console.log('\n[B] Windows 非法路径');
{
  check('空输入 → empty', P('').reason === 'empty' && P('   ').reason === 'empty' && P(null).reason === 'empty');
  check('相对路径 → not-absolute', P('Users\\demo').reason === 'not-absolute', P('Users\\demo').reason);
  check('C:foo（盘符相对）→ drive-relative', P('C:foo').reason === 'drive-relative', P('C:foo').reason);
  check('非法字符 < > | ? * → illegal-char',
    ['C:\\a<b', 'C:\\a>b', 'C:\\a|b', 'C:\\a?b', 'C:\\a*b'].every((v) => P(v).reason === 'illegal-char'));
  check('盘符里的冒号不算非法字符', P('C:\\a\\b').ok === true, '');
  check('未定义的环境变量 → bad-env', P('%NOPE%\\Music').reason === 'bad-env', P('%NOPE%\\Music').reason);
  check('没有主目录时 ~ → bad-home',
    parsePathInput('~\\Music', { platform: 'win32', env: {}, home: '' }).reason === 'bad-home');
}


console.log('\n[C] Linux / macOS 路径');
{
  check('绝对路径通过', parsePathInput('/home/me/Music', NIX).ok === true, '');
  check('相对路径被拒', parsePathInput('home/me', NIX).reason === 'not-absolute',
    parsePathInput('home/me', NIX).reason);
  check('~ 展开', parsePathInput('~/Music', NIX).path === '/home/me/Music', JSON.stringify(parsePathInput('~/Music', NIX)));
  check('$VAR 展开', parsePathInput('$HOME/Music', NIX).path === '/home/me/Music', '');
  check('${VAR} 展开', parsePathInput('${HOME}/Music', NIX).path === '/home/me/Music', '');
  check('根目录 / 通过', parsePathInput('/', NIX).ok === true, '');
}


console.log('\n[D] expandEnv');
{
  const env = { HOME: '/h', USERPROFILE: 'C:\\u' };
  check('三种写法都能展开',
    expandEnv('$HOME|${HOME}|%USERPROFILE%', env) === '/h|/h|C:\\u',
    expandEnv('$HOME|${HOME}|%USERPROFILE%', env));
  check('未定义的变量原样保留', expandEnv('%NOPE%', env) === '%NOPE%', expandEnv('%NOPE%', env));
  check('没有变量时原样返回', expandEnv('/plain/path', env) === '/plain/path', '');
}


console.log('\n[E] 错误码覆盖');
{
  const produced = ['empty', 'bad-env', 'bad-home', 'drive-relative', 'not-absolute', 'illegal-char', 'not-found', 'not-dir'];
  check('所有可能的 reason 都有对应词条 key',
    produced.every((r) => typeof REASON_TEXT[r] === 'string' && REASON_TEXT[r].startsWith('path.err.')),
    produced.map((r) => `${r}→${REASON_TEXT[r]}`).join(' '));
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n=== 地址栏校验: ${checks.length - failed.length}/${checks.length} 通过 ===`);
if (failed.length) {
  for (const f of failed) console.log(`  ✗ ${f.name}`);
  process.exit(1);
}
