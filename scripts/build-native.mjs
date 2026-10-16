

import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nativeDir = path.join(projectRoot, 'native');
const clean = process.argv.includes('--clean');
const forElectron = process.argv.includes('--electron');

function findPython() {
  const candidates = [
    process.env.PYTHON,
    process.env.npm_config_python,
    'py',
    'python',
    'python3',
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      const r = spawnSync(c, ['-c', 'import sys; print(sys.version_info[0])'], {
        encoding: 'utf8', windowsHide: true, shell: false,
      });
      if (r.status === 0 && r.stdout.trim() === '3') return c;
    } catch {  }
  }
  
  const globals = [
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python'),
    'C:\\Program Files\\Python311', 'C:\\Program Files\\Python312',
    'C:\\Program Files\\Python313', 'C:\\Program Files\\Python314',
  ];
  for (const base of globals) {
    if (!base || !fs.existsSync(base)) continue;
    let dirs = [];
    try { dirs = fs.readdirSync(base); } catch { continue; }
    for (const d of dirs) {
      const exe = path.join(base, d, 'python.exe');
      if (fs.existsSync(exe)) return exe;
    }
  }
  return null;
}

function findMsvsVersion() {
  const vswhere = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe';
  if (!fs.existsSync(vswhere)) return null;
  const r = spawnSync(vswhere, ['-products', '*', '-latest', '-property', 'installationVersion'], {
    encoding: 'utf8', windowsHide: true,
  });
  const v = (r.stdout || '').trim();
  if (!v) return null;
  const major = v.split('.')[0];
  if (major === '17') return '2022';
  if (major === '16') return '2019';
  if (major === '18') return '2022';    
  return null;
}

const python = findPython();
const msvs = findMsvsVersion();
console.log('Python :', python || '(未找到，node-gyp 可能失败)');
console.log('MSVS   :', msvs || '(交给 node-gyp 自动探测)');

if (clean) {
  fs.rmSync(path.join(nativeDir, 'build'), { recursive: true, force: true });
  console.log('已清理 native/build');
}

const args = [path.join(nativeDir, 'node_modules', 'node-gyp', 'bin', 'node-gyp.js')];
if (!fs.existsSync(args[0])) {
  
  args[0] = 'node-gyp';
}
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const cli = fs.existsSync(args[0]) ? process.execPath : npx;
const cliArgs = fs.existsSync(args[0]) ? args : ['--yes', 'node-gyp@11'];



let electronArgs = [];
if (forElectron) {
  let version = null;
  try {
    version = JSON.parse(fs.readFileSync(path.join(projectRoot, 'node_modules', 'electron', 'package.json'), 'utf8')).version;
  } catch {  }
  if (!version) {
    console.error('未找到已安装的 Electron，无法用 --electron 构建');
    process.exit(1);
  }
  const distUrl = process.env.AURORA_ELECTRON_HEADERS || 'https://npmmirror.com/mirrors/electron/';
  electronArgs = ['--target', version, '--dist-url', distUrl, '--arch', 'x64'];
  console.log(`Electron 目标: ${version}  headers: ${distUrl}`);
}


const configured = fs.existsSync(path.join(nativeDir, 'build', 'config.gypi'));
if (!configured && !clean) console.log('未找到 build/config.gypi，改用 rebuild（自动先 configure）');

const finalArgs = [
  ...cliArgs,
  (clean || !configured) ? 'rebuild' : 'build',
  ...electronArgs,
  ...(msvs ? [`--msvs_version=${msvs}`] : []),
  ...(python ? [`--python=${python}`] : []),
];

console.log(`\n> ${cli} ${finalArgs.join(' ')}\n`);


const r = spawnSync(cli, finalArgs, {
  cwd: nativeDir, stdio: 'inherit', windowsHide: true,
  shell: process.platform === 'win32' && /\.cmd$/i.test(cli),
});
if (r.status !== 0) {
  console.error('\n原生模块构建失败');
  process.exit(r.status ?? 1);
}
const out = path.join(nativeDir, 'build', 'Release', 'aurora_audio.node');
console.log(`\n✓ 构建完成: ${out}  (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
