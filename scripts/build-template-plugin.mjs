





import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = path.resolve(projectRoot, '..');
const pluginDir = path.join(workspaceRoot, 'irix-extension', 'community', 'irix-extension-template');
const dist = path.join(projectRoot, 'dist');
const ID_RE = /^[a-z0-9][a-z0-9._-]{1,48}$/i;

const manifestFile = path.join(pluginDir, 'extension.json');
if (!fs.existsSync(manifestFile)) {
  console.error(`✗ 找不到模板清单：${manifestFile}`);
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
const id = String(manifest.id || '');
if (!ID_RE.test(id)) {
  console.error(`✗ manifest.id 不合法：${id}`);
  process.exit(1);
}
const entry = path.join(pluginDir, manifest.entry || 'index.js');
if (!fs.existsSync(entry)) {
  console.error(`✗ 找不到入口文件：${entry}`);
  process.exit(1);
}
if (!fs.existsSync(path.join(pluginDir, 'README.md'))) {
  console.error('✗ 模板缺少 README.md（社区投稿要求）');
  process.exit(1);
}

fs.mkdirSync(dist, { recursive: true });
const out = path.join(dist, `iRix-Extension-${id}-${manifest.version || '0.0.0'}.xtxs`);
try { fs.rmSync(out, { force: true }); } catch {  }
const tar = spawnSync('tar', ['-cf', out, '-C', pluginDir, '.'], { windowsHide: true });
if (tar.status !== 0) {
  console.error('✗ 打包失败：' + (tar.stderr || '').toString().slice(0, 300));
  process.exit(1);
}

const list = spawnSync('tar', ['-tf', out], { encoding: 'utf8', windowsHide: true });
const files = (list.stdout || '').split(/\r?\n/).filter(Boolean);
const need = ['extension.json', 'index.js', 'README.md'];
const missing = need.filter((n) => !files.some((f) => f.replace(/^\.\//, '') === n));
if (missing.length) {
  console.error('✗ 包内容不完整，缺少：' + missing.join(', '));
  process.exit(1);
}

const size = fs.statSync(out).size;
console.log(`✓ ${path.basename(out)}  ${(size / 1024).toFixed(1)} KB`);
console.log(`  文件：${files.map((f) => f.replace(/^\.\//, '')).filter((f) => f !== './').join(', ')}`);
console.log(`  安装：应用 → 设置 → 扩展 → 安装扩展… → 选这个 .xtxs → 重启`);
console.log(`  输出：${out}`);
