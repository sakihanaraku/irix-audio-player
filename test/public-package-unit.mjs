

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizePublicPackageJson, LINUX_ONLY_SCRIPTS } from '../scripts/public-package.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');
const localRaw = fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8');
const localPkg = JSON.parse(localRaw);
const publicPkg = JSON.parse(sanitizePublicPackageJson(localRaw));

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: !!ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

check('公开版移除全部 Linux-only 脚本',
  LINUX_ONLY_SCRIPTS.every((key) => !(key in publicPkg.scripts)),
  Object.keys(publicPkg.scripts).join(', '));
check('本地若包含 Linux 构建脚本，公开版必须裁掉',
  !localPkg.scripts?.['dist:linux'] || !('dist:linux' in publicPkg.scripts));
check('公开版移除 build.linux / build.pacman',
  !publicPkg.build?.linux && !publicPkg.build?.pacman);
check('公开版保留 Windows 主流程脚本',
  ['start', 'test', 'build:native', 'dist:portable', 'dist:nsis'].every((key) => typeof publicPkg.scripts?.[key] === 'string'));


const missing = [];
for (const [key, cmd] of Object.entries(publicPkg.scripts || {})) {
  const matches = String(cmd).matchAll(/(?:node|python)\s+((?:scripts|test)\/[^\s&|]+)/g);
  for (const m of matches) {
    const file = m[1].replace(/^['"]|['"]$/g, '');
    if (!fs.existsSync(path.join(projectRoot, file))) missing.push(`${key} -> ${file}`);
  }
}
check('公开版脚本引用的本地文件均存在', missing.length === 0, missing.join(', '));

const failed = checks.filter((c) => !c.ok);
console.log(`\n=== 公开版 package.json: ${checks.length - failed.length}/${checks.length} 通过 ===`);
process.exit(failed.length ? 1 : 0);
