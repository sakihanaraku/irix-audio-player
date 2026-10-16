



import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const targetArg = process.argv.indexOf('--target');
const target = targetArg >= 0 ? process.argv[targetArg + 1] : 'dir';


const addon = path.join(projectRoot, 'native', 'build', 'Release', 'aurora_audio.node');
if (!fs.existsSync(addon)) {
  console.error('缺少原生模块，请先运行: npm run build:native');
  process.exit(1);
}
const ffmpeg = path.join(projectRoot, 'vendor', 'ffmpeg', 'bin', 'ffmpeg.exe');
if (!fs.existsSync(ffmpeg)) {
  console.error('缺少 vendor/ffmpeg/bin/ffmpeg.exe，请先运行: npm run fetch:ffmpeg');
  process.exit(1);
}
const icon = path.join(projectRoot, 'build', 'icon.ico');
if (!fs.existsSync(icon)) {
  console.warn('缺少 build/icon.ico（可用 npm run make:icon 生成），将使用 Electron 默认图标');
}


const cacheRoot = process.env.AURORA_BUILDER_CACHE
  || path.join(projectRoot, '..', '.tools', 'electron-builder-cache');
fs.mkdirSync(cacheRoot, { recursive: true });

const env = {
  ...process.env,
  ELECTRON_MIRROR: process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/',
  ELECTRON_BUILDER_BINARIES_MIRROR:
    process.env.ELECTRON_BUILDER_BINARIES_MIRROR || 'https://npmmirror.com/mirrors/electron-builder-binaries/',
  ELECTRON_BUILDER_CACHE: cacheRoot,
  npm_config_cache: process.env.npm_config_cache || path.join(cacheRoot, 'npm'),
  
  
  TMP: path.join(projectRoot, 'dist', '.builder-tmp'),
  TEMP: path.join(projectRoot, 'dist', '.builder-tmp'),
};
fs.mkdirSync(env.TMP, { recursive: true });
delete env.ELECTRON_RUN_AS_NODE;

console.log('=== 打包 iRix Audio Player ===');
console.log('目标    :', target);
console.log('缓存目录:', cacheRoot);
console.log('Electron:', JSON.parse(fs.readFileSync(path.join(projectRoot, 'node_modules', 'electron', 'package.json'), 'utf8')).version);
console.log('镜像    :', env.ELECTRON_MIRROR);
console.log('二进制镜像:', env.ELECTRON_BUILDER_BINARIES_MIRROR);
console.log('');


const builderCli = path.join(projectRoot, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js');
if (!fs.existsSync(builderCli)) {
  console.error('未安装 electron-builder，请先运行: npm install');
  process.exit(1);
}
const args = [
  builderCli,
  '--win',
  ...(target === 'nsis' ? ['--win=nsis'] : target === 'nsis-portable' ? ['--win=portable'] : ['--dir']),
  '--x64',
  '--publish', 'never',
];
console.log('> node ' + args.join(' ') + '\n');
const r = spawnSync(process.execPath, args, { cwd: projectRoot, stdio: 'inherit', env, windowsHide: true });
if (r.status !== 0) {
  console.error(`\n打包失败（exit ${r.status}）`);
  process.exit(r.status ?? 1);
}


console.log('\n=== 产物自检 ===');
const dist = path.join(projectRoot, 'dist');
const unpacked = path.join(dist, 'win-unpacked');
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

const pkgs = [];
for (const f of fs.readdirSync(dist)) {
  const full = path.join(dist, f);
  if (fs.statSync(full).isFile() && f.endsWith('.exe')) pkgs.push(full);
}
if (target === 'nsis-portable' || target === 'nsis') {
  check(target === 'nsis' ? '生成安装包 exe' : '生成 portable 单文件 exe', pkgs.length > 0,
    pkgs.map((p) => `${path.basename(p)} ${(fs.statSync(p).size / 1048576).toFixed(1)}MB`).join(', '));
}
if (target === 'nsis') {
  const setup = pkgs.find((p) => /setup/i.test(p)) || pkgs[0];
  if (setup) {
    check('安装包体积合理（>100MB）', fs.statSync(setup).size > 100 * 1048576,
      `${(fs.statSync(setup).size / 1048576).toFixed(1)} MB`);
  }
}

check('解包目录存在', fs.existsSync(unpacked), unpacked);
check('主程序 iRix Audio Player.exe', fs.existsSync(path.join(unpacked, 'iRix Audio Player.exe')), '');
check('原生模块已解包到 asar.unpacked',
  fs.existsSync(path.join(unpacked, 'resources', 'app.asar.unpacked', 'native', 'build', 'Release', 'aurora_audio.node')),
  `${(fs.statSync(path.join(unpacked, 'resources', 'app.asar.unpacked', 'native', 'build', 'Release', 'aurora_audio.node')).size / 1024 || 0).toFixed(0)}KB`);
check('ffmpeg 在 resources 下',
  fs.existsSync(path.join(unpacked, 'resources', 'ffmpeg', 'bin', 'ffmpeg.exe')) &&
  fs.existsSync(path.join(unpacked, 'resources', 'ffmpeg', 'bin', 'ffprobe.exe')), '');
check('app.asar 存在', fs.existsSync(path.join(unpacked, 'resources', 'app.asar')),
  `${(fs.statSync(path.join(unpacked, 'resources', 'app.asar')).size / 1048576).toFixed(1)}MB`);


try {
  const asar = require('@electron/asar');
  const list = asar.listPackage(path.join(unpacked, 'resources', 'app.asar'));
  const has = (p) => list.some((f) => f.replace(/\\/g, '/').endsWith(p));
  check('asar 内含 main.js', has('src/main/main.js'), '');
  check('asar 内含 preload.js', has('src/preload/preload.js'), '');
  check('asar 内含 renderer 三件套',
    has('src/renderer/index.html') && has('src/renderer/renderer.js') && has('src/renderer/styles.css'), '');
  check('asar 未把 ffmpeg 重复打进去（走 extraResources）',
    !list.some((f) => f.includes('vendor')), `${list.length} 个条目`);
} catch (err) {
  check('asar 内容检查', false, err.message);
}


if (target === 'nsis' && !process.env.AURORA_SKIP_RUN) {
  const setup = pkgs.find((p) => /setup/i.test(p));
  if (setup) {
    console.log('\n> 真实安装/卸载验证');
    const r = spawnSync(process.execPath, [path.join(projectRoot, 'scripts', 'verify-setup.mjs'), setup],
      { cwd: projectRoot, stdio: 'inherit', windowsHide: true });
    if (r.status !== 0) console.error('（安装包验证未全部通过，详见上面输出）');
  }
}


if (target === 'nsis-portable' && pkgs.length && process.env.AURORA_SKIP_RUN !== '1') {
  const exe = pkgs[0];
  const smallDir = path.join(os.tmpdir(), 'iRixAudioPlayer');
  fs.rmSync(smallDir, { recursive: true, force: true });
  console.log(`\n> 试运行 ${path.basename(exe)}（本机 Electron GUI 无法启动，仅验证自解压与目录）`);
  const child = spawnSync(exe, [], { windowsHide: true, timeout: 60000, env: { ...process.env } });
  console.log(`  退出码: ${child.status === null ? '(超时/被信号终止)' : child.status}`);
  const extracted = fs.existsSync(smallDir);
  check('portable 自解压到临时目录', extracted, extracted ? smallDir : '未生成');
  if (extracted) {
    const entries = fs.readdirSync(smallDir);
    check('解压目录含 iRix Audio Player.exe', entries.includes('iRix Audio Player.exe'), entries.slice(0, 8).join(', '));
    const dataDir = path.join(path.dirname(exe), 'iRixAudioPlayer-data');
    check('portable 数据目录（设置/列表）', fs.existsSync(dataDir), dataDir);
  }
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n=== 自检: ${checks.length - failed.length}/${checks.length} 通过 ===`);
if (pkgs.length) {
  for (const p of pkgs) console.log(`产物: ${p}  ${(fs.statSync(p).size / 1048576).toFixed(1)} MB`);
}
fs.writeFileSync(path.join(dist, 'package-report.json'),
  JSON.stringify({ target, checks, artifacts: pkgs }, null, 2));
process.exit(failed.length ? 1 : 0);
