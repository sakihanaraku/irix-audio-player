

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = path.resolve(projectRoot, '..');
const srcRoot = path.join(workspaceRoot, 'extensions-src');
const dist = path.join(projectRoot, 'dist');

if (!fs.existsSync(srcRoot)) {
  console.error('✗ 找不到 extensions-src（扩展源码放在仓库外）');
  process.exit(1);
}

const ok = [];
for (const name of fs.readdirSync(srcRoot)) {
  const dir = path.join(srcRoot, name);
  if (!fs.statSync(dir).isDirectory()) continue;
  const manifestFile = path.join(dir, 'extension.json');
  if (!fs.existsSync(manifestFile)) continue;
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const id = manifest.id || name;
  const version = manifest.version || '0.0.0';
  const out = path.join(dist, `iRix-Extension-${id}-${version}.xtxs`);
  fs.mkdirSync(dist, { recursive: true });
  try { fs.rmSync(out, { force: true }); } catch {  }
  
  const r = spawnSync('tar', ['-cf', out, '-C', dir, '.'], { windowsHide: true });
  if (r.status !== 0) { console.error(`✗ 打包失败: ${id}`); continue; }
  const size = fs.statSync(out).size;
  console.log(`  ✓ ${path.basename(out)}  ${(size / 1024).toFixed(1)} KB`);
  ok.push(out);
}

if (!ok.length) { console.error('✗ 没有生成任何扩展包'); process.exit(1); }
console.log(`\n=== 扩展包: ${ok.length} 个 ===`);
for (const f of ok) console.log('  ' + f);
