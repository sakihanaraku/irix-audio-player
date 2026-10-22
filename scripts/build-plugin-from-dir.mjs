

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcArg = process.argv[2];
if (!srcArg) {
  console.error('用法：node scripts/build-plugin-from-dir.mjs <插件目录>');
  process.exit(1);
}
const srcDir = path.resolve(projectRoot, srcArg);
const manifestFile = path.join(srcDir, 'extension.json');
if (!fs.existsSync(manifestFile)) {
  console.error(`✗ 找不到扩展清单：${manifestFile}`);
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
const id = manifest.id || path.basename(srcDir);
const version = manifest.version || '0.0.0';
const dist = path.join(projectRoot, 'dist');
fs.mkdirSync(dist, { recursive: true });
const out = path.join(dist, `iRix-Extension-${id}-${version}.xtxs`);
try { fs.rmSync(out, { force: true }); } catch {  }
const r = spawnSync('tar', ['-cf', out, '-C', srcDir, '.'], { windowsHide: true });
if (r.status !== 0) {
  console.error('✗ tar 打包失败');
  process.exit(1);
}
console.log(`  ✓ ${path.basename(out)}  ${(fs.statSync(out).size / 1024).toFixed(1)} KB`);
console.log(out);
