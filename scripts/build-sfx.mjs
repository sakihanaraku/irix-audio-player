







import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sfxDir = path.join(projectRoot, 'native', 'sfx');
const unpackedDir = path.join(projectRoot, 'dist', 'win-unpacked');
const buildDir = path.join(projectRoot, 'dist', 'sfx-build');
const version = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')).version;
const APP_EXE = 'iRix Audio Player.exe';
const role = process.argv.includes('--role=setup') ? 'setup' : 'portable';
const outExe = path.join(projectRoot, 'dist', role === 'setup'
  ? `iRixAudioPlayer-${version}-setup-sfx.exe`
  : `iRixAudioPlayer-${version}-portable.exe`);

const log = (...a) => console.log(...a);
const fail = (msg) => { console.error('✗ ' + msg); process.exit(1); };







const reportFile = path.join(projectRoot, 'dist', 'sfx-report.json');
fs.rmSync(reportFile, { force: true });


if (!fs.existsSync(path.join(unpackedDir, APP_EXE))) {
  fail('缺少 dist/win-unpacked，请先运行: npm run dist:dir');
}
fs.mkdirSync(buildDir, { recursive: true });


const iconSrc = path.join(projectRoot, 'build', 'icon.ico');
if (fs.existsSync(iconSrc)) fs.copyFileSync(iconSrc, path.join(sfxDir, 'icon.ico'));


const vswhere = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe';
let vcvars = '';
if (fs.existsSync(vswhere)) {
  const r = spawnSync(vswhere, ['-latest', '-products', '*', '-requires',
    'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'],
    { encoding: 'utf8', windowsHide: true });
  const root = (r.stdout || '').trim().split(/\r?\n/)[0];
  if (root) {
    const candidate = path.join(root, 'VC', 'Auxiliary', 'Build', 'vcvarsall.bat');
    if (fs.existsSync(candidate)) vcvars = candidate;
  }
}
if (!vcvars) {
  
  for (const base of ['C:\\Program Files\\Microsoft Visual Studio', 'C:\\Program Files (x86)\\Microsoft Visual Studio']) {
    if (!fs.existsSync(base)) continue;
    for (const year of fs.readdirSync(base)) {
      for (const edition of ['Community', 'Professional', 'Enterprise', 'BuildTools']) {
        const candidate = path.join(base, year, edition, 'VC', 'Auxiliary', 'Build', 'vcvarsall.bat');
        if (fs.existsSync(candidate)) vcvars = candidate;
      }
    }
  }
}
if (!vcvars) fail('未找到 vcvarsall.bat（需要 Visual Studio C++ 生成工具）');
log(`> vcvarsall: ${vcvars}`);


const stub = path.join(buildDir, role === 'setup' ? 'sfx-setup.exe' : 'sfx-stub.exe');
const bat = path.join(buildDir, `build-${role}.bat`);



const verNums = String(version).split(/[.\-+]/).map((x) => parseInt(x, 10) || 0);
const verNum = [verNums[0] || 0, verNums[1] || 0, verNums[2] || 0, 0].join(',');
fs.writeFileSync(path.join(sfxDir, 'version.h'),
  '// 由 scripts/build-sfx.mjs 生成，勿手改\n#pragma once\n' +
  `#define SFX_VERSION L"${version}"\n` +
  `#define SFX_VERSION_NUM ${verNum}\n`, 'utf8');
fs.writeFileSync(bat, [
  '@echo off',
  `call "${vcvars}" x64 || exit /b 1`,
  `cd /d "${sfxDir}" || exit /b 1`,
  'rc /nologo /fo sfx.res sfx.rc || exit /b 1',
  'cl /nologo /utf-8 /O2 /MT /EHsc /DUNICODE /D_UNICODE ' +
    (role === 'setup' ? '/DSFX_SETUP ' : '') +
    'sfx.cpp sfx.res ' +
    `/Fe"${stub.replace(/\\/g, '/')}" /link /SUBSYSTEM:WINDOWS /MANIFEST:NO ` +
    'user32.lib shell32.lib ole32.lib advapi32.lib',
  'exit /b %ERRORLEVEL%',
  '',
].join('\r\n'), 'utf8');

log(`\n> 编译 SFX 启动器（角色: ${role}）`);
fs.rmSync(stub, { force: true });
const cc = spawnSync('cmd.exe', ['/c', bat], { windowsHide: true, encoding: 'utf8' });
if (cc.status !== 0 || !fs.existsSync(stub)) {
  console.error(cc.stdout || '');
  console.error(cc.stderr || '');
  fail('启动器编译失败');
}
const stubSize = fs.statSync(stub).size;
log(`✓ 启动器编译完成: ${(stubSize / 1024).toFixed(0)} KB`);


const readme = (role === 'setup' ? [
  `iRix Audio Player ${version} - 安装包`,
  '',
  `双击 iRixAudioPlayer-${version}-setup.exe 安装；按用户安装（%LOCALAPPDATA%\\Programs），不需要管理员权限。`,
  '· 安装后会创建开始菜单与桌面快捷方式，并在「设置 → 应用」里登记（可直接卸载）；',
  '· 卸载：设置 → 应用 → iRix Audio Player → 卸载，或运行安装目录里的 --uninstall；',
  '· 设置与播放列表保存在「安装目录 \\iRixAudioPlayer-data」，卸载时会一并删除；',
  '· 播放引擎：N-API 原生模块（WASAPI 共享/独占、DirectSound、MME），',
  '  解码后端：内置 ffmpeg（resources/ffmpeg/bin）。',
  '· 支持格式：flac / wav / mp3 / m4a / aac / ogg / opus / wma / ape / aiff / dsf 等；',
  '  直接把文件或文件夹拖进窗口即可加入播放列表；内嵌专辑封面会自动提取显示。',
  '',
] : [
  `iRix Audio Player ${version} - 免安装便携版`,
  '',
  `双击 iRixAudioPlayer-${version}-portable.exe 即可运行，无需安装、不写注册表。`,
  '· 首次启动会把程序释放到可写目录（优先 %LOCALAPPDATA%\\iRixAudioPlayer，其次 %TEMP%，最后 exe 同级 iRixAudioPlayer-unpacked），之后启动会复用；',
  `  想强制重新释放：iRixAudioPlayer-${version}-portable.exe --force`,
  '· 设置与播放列表保存在「exe 同级 \u005ciRixAudioPlayer-data」目录里，删除该目录即恢复默认；',
  '  （从旧版 Aurora Player 升级时会自动迁移 AuroraPlayer-data 里的数据）',
  '· 播放引擎：N-API 原生模块（WASAPI 共享/独占、DirectSound、MME），',
  '  解码后端：内置 ffmpeg（resources/ffmpeg/bin）。',
  '· 支持格式：flac / wav / mp3 / m4a / aac / ogg / opus / wma / ape / aiff / dsf 等，',
  '  直接把文件或文件夹拖进窗口即可加入播放列表；内嵌专辑封面会自动提取显示。',
  '',
]).join('\r\n');

fs.writeFileSync(path.join(unpackedDir, '使用说明.txt'), readme, 'utf8');
fs.writeFileSync(path.join(buildDir, '使用说明.txt'), readme, 'utf8');


log('\n> 打包 payload');
const payloadZip = path.join(buildDir, 'payload.zip');
fs.rmSync(payloadZip, { force: true });
const t0 = Date.now();

const sevenZip = [
  'C:\\Program Files\\7-Zip\\7z.exe',
  'C:\\Program Files (x86)\\7-Zip\\7z.exe',
].find((p) => fs.existsSync(p));

let packed = false;
if (sevenZip) {
  
  
  const r = spawnSync(sevenZip, ['a', '-tzip', '-mx=9', '-mmt=on', payloadZip, '.\\*', '-r',
    '-x!*.pdb', '-bso0', '-bsp0'], { cwd: unpackedDir, windowsHide: true, timeout: 1800000 });
  packed = r.status === 0 && fs.existsSync(payloadZip);
} else {
  log('   未找到 7-Zip，改用 tar.exe');
}
if (!packed) {
  const r = spawnSync('tar.exe', ['-a', '-c', '-f', payloadZip, '-C', unpackedDir, '.'],
    { windowsHide: true, timeout: 900000 });
  if (r.status !== 0) fail('打包 payload 失败（7-Zip 与 tar 都不可用）');
  if (!fs.existsSync(payloadZip)) fail('payload.zip 没有生成');
}
const payloadSize = fs.statSync(payloadZip).size;
log(`✓ payload: ${(payloadSize / 1048576).toFixed(1)} MB，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);


const listOut = spawnSync('tar.exe', ['-tf', payloadZip],
  { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
const entries = (listOut.stdout || '').split(/\r?\n/).filter(Boolean).map((e) => e.replace(/^\.\//, ''));
const hasApp = entries.some((e) => e === APP_EXE || e.endsWith('/' + APP_EXE));
const hasAddon = entries.some((e) => /aurora_audio\.node$/.test(e));
const hasFfmpeg = entries.some((e) => /ffmpeg\.exe$/.test(e));
const hasAsar = entries.some((e) => /app\.asar$/.test(e));
log(`✓ 包内结构: 主程序 ${hasApp ? '✓' : '✗'} · 原生模块 ${hasAddon ? '✓' : '✗'} · ` +
    `ffmpeg ${hasFfmpeg ? '✓' : '✗'} · app.asar ${hasAsar ? '✓' : '✗'}（${entries.length} 个条目）`);
if (!hasApp || !hasAddon || !hasFfmpeg || !hasAsar) fail('payload 内容不完整');


log('\n> 拼接单文件 exe');
const stubBuf = fs.readFileSync(stub);
const payloadBuf = fs.readFileSync(payloadZip);
const footer = Buffer.alloc(24);
footer.writeBigUInt64LE(BigInt(stubBuf.length), 0);
footer.writeBigUInt64LE(BigInt(payloadBuf.length), 8);
footer.write('AURORASX', 16, 'ascii');
try {
  fs.writeFileSync(outExe, Buffer.concat([stubBuf, payloadBuf, footer]));
} catch (err) {
  
  if (err.code === 'EBUSY' || err.code === 'EPERM') {
    fail(`产物被占用，写不进去：\n  ${outExe}\n` +
      '请先关闭正在运行的 iRix Audio Player（含便携版启动器进程），再重新运行本脚本。');
  }
  throw err;
}
const exeSize = fs.statSync(outExe).size;
log(`✓ ${outExe}`);
log(`  大小 ${(exeSize / 1048576).toFixed(1)} MB = 启动器 ${(stubSize / 1024).toFixed(0)}KB + 数据 ${(payloadSize / 1048576).toFixed(1)}MB + 索引 24B`);


log('\n=== 产物校验 ===');
const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok: !!ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

check('单文件 exe 已生成', exeSize > 100 * 1048576, `${(exeSize / 1048576).toFixed(1)} MB`);
const tail = fs.readFileSync(outExe);



function footerPosition(buf) {
  const eof = buf.length - 24;
  if (buf.length < 0x40 || buf[0] !== 0x4D || buf[1] !== 0x5A) return eof;
  const peOff = buf.readInt32LE(0x3C);
  if (peOff <= 0 || peOff + 24 > buf.length) return eof;
  if (buf.toString('ascii', peOff, peOff + 4) !== 'PE\0\0') return eof;
  const magic = buf.readUInt16LE(peOff + 24);
  const dirsOff = magic === 0x10B ? peOff + 24 + 96 : magic === 0x20B ? peOff + 24 + 112 : -1;
  if (dirsOff < 0) return eof;
  const certEntry = dirsOff + 4 * 8;
  if (certEntry + 8 > buf.length) return eof;
  const certOffset = buf.readUInt32LE(certEntry);
  const certSize = buf.readUInt32LE(certEntry + 4);
  if (certOffset > 24 && certSize > 0 && certOffset <= buf.length) {
    for (let pad = 0; pad < 8; pad++) {
      const at = certOffset - 24 - pad;
      if (at < 0) break;
      if (buf.toString('ascii', at + 16, at + 24) === 'AURORASX') return at;
    }
    return certOffset - 24;
  }
  return eof;
}
const footerAt = footerPosition(tail);
const readFooter = (buf, at) => ({
  offset: Number(buf.readBigUInt64LE(at)),
  size: Number(buf.readBigUInt64LE(at + 8)),
  magic: buf.toString('ascii', at + 16, at + 24),
});
const f = readFooter(tail, footerAt);
check('尾部索引可解析', f.magic === 'AURORASX', `offset=${f.offset} size=${f.size} at=${footerAt}`);
check('索引与实际大小一致', f.offset + f.size === footerAt,
  `offset+size = ${f.offset + f.size}（索引位置 ${footerAt}）`);




{
  const utf16 = (s) => stubBuf.includes(Buffer.from(s, 'utf16le'));
  check('启动器内嵌的主程序名与产物一致', utf16(APP_EXE), `${APP_EXE} ${utf16(APP_EXE) ? '找到' : '未找到'}`);
  const stale = ['IRiX Audio Player.exe', 'IRiXAudioPlayer'].filter(utf16);
  check('启动器里没有残留旧应用名', stale.length === 0, stale.join(', ') || '干净');
}



const unpackDir = path.join(projectRoot, 'dist', 'sfx-unpacked-test');
fs.rmSync(unpackDir, { recursive: true, force: true });

const sfxLogPaths = [
  path.join(os.tmpdir(), 'iRixAudioPlayer-sfx.log'),
  path.join(unpackDir, 'iRixAudioPlayer-sfx.log'),
];
const readSfxLog = () => {
  for (const p of sfxLogPaths) {
    if (fs.existsSync(p)) return { text: fs.readFileSync(p, 'utf8'), path: p };
  }
  return { text: '', path: '(没有日志)' };
};

log('\n> 试运行 --extract-only --force（验证自解压）');
const run = spawnSync(outExe, ['--extract-only', '--force', '--quiet', `--unpack-dir=${unpackDir}`],
  { windowsHide: true, timeout: 300000 });
check('启动器退出码为 0', run.status === 0, `exit=${run.status}`);
if (run.status !== 0 || process.env.AURORA_VERBOSE === '1') {
  const got = readSfxLog();
  if (got.text) {
    log(`   启动器日志（${got.path}）:`);
    for (const l of got.text.trim().split('\n')) log('     ' + l);
  } else {
    log('   （没有启动器日志，可能根本没跑到日志初始化）');
  }
}
check('释放出主程序', fs.existsSync(path.join(unpackDir, APP_EXE)), unpackDir);
check('释放出原生模块',
  fs.existsSync(path.join(unpackDir, 'resources', 'app.asar.unpacked', 'native', 'build', 'Release', 'aurora_audio.node')), '');
check('释放出 ffmpeg',
  fs.existsSync(path.join(unpackDir, 'resources', 'ffmpeg', 'bin', 'ffmpeg.exe')) &&
  fs.existsSync(path.join(unpackDir, 'resources', 'ffmpeg', 'bin', 'ffprobe.exe')), '');
check('释放出 app.asar', fs.existsSync(path.join(unpackDir, 'resources', 'app.asar')),
  fs.existsSync(path.join(unpackDir, 'resources', 'app.asar'))
    ? `${(fs.statSync(path.join(unpackDir, 'resources', 'app.asar')).size / 1048576).toFixed(1)} MB` : '');
check('使用说明随包释放', fs.existsSync(path.join(unpackDir, '使用说明.txt')), '');



{
  const asarInPack = path.join(unpackedDir, 'resources', 'app.asar');
  const asarOut = path.join(unpackDir, 'resources', 'app.asar');
  if (fs.existsSync(asarInPack) && fs.existsSync(asarOut)) {
    const a = fs.readFileSync(asarInPack);
    const b = fs.readFileSync(asarOut);
    check('释放出的 app.asar 与打包内容逐字节一致',
      a.length === b.length && a.equals(b),
      `打包 ${(a.length / 1024).toFixed(0)} KB vs 释放 ${(b.length / 1024).toFixed(0)} KB`);
  }
}



if (role === 'setup') {
  log('\n> 试运行：安装（--suffix=Test，测完自动卸载）');
  const testDir = path.join(projectRoot, 'dist', 'setup-test');
  const suffix = 'Test';
  fs.rmSync(testDir, { recursive: true, force: true });
  const install = spawnSync(outExe, ['--install', '--quiet', '--no-launch', `--suffix=${suffix}`,
    `--install-dir=${testDir}`], { windowsHide: true, timeout: 600000 });
  check('安装退出码为 0', install.status === 0, `exit=${install.status}`);
  check('安装目录里有主程序', fs.existsSync(path.join(testDir, APP_EXE)), testDir);
  check('安装目录里有原生模块与 ffmpeg',
    fs.existsSync(path.join(testDir, 'resources', 'app.asar.unpacked', 'native', 'build', 'Release', 'aurora_audio.node')) &&
    fs.existsSync(path.join(testDir, 'resources', 'ffmpeg', 'bin', 'ffmpeg.exe')), '');
  check('安装目录里有使用说明', fs.existsSync(path.join(testDir, '使用说明.txt')), '');

  const startMenuLnk = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu',
    'Programs', `iRix Audio Player (${suffix}).lnk`);
  const desktopLnk = path.join(process.env.USERPROFILE || '', 'Desktop', `iRix Audio Player (${suffix}).lnk`);
  check('创建了开始菜单快捷方式', fs.existsSync(startMenuLnk), startMenuLnk);
  check('创建了桌面快捷方式', fs.existsSync(desktopLnk), desktopLnk);

  const regQuery = spawnSync('reg.exe', ['query',
    `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\iRixAudioPlayer-${suffix}`],
    { encoding: 'utf8', windowsHide: true });
  const regText = (regQuery.stdout || '').toString();
  check('写入了卸载项（设置→应用里能看到）', regQuery.status === 0 && /iRix Audio Player/.test(regText),
    `${regQuery.status}`);
  check('卸载项里含版本号与卸载命令',
    /1\.0\.0-alpha/.test(regText) && /--uninstall/.test(regText),
    (regText.match(/DisplayVersion\s+REG_SZ\s+(\S+)/) || [])[1] || '');
  check('卸载项里登记了安装位置', new RegExp('InstallLocation\\s+REG_SZ\\s+').test(regText), '');

  log('\n> 试运行：卸载');
  const uninstall = spawnSync(outExe, ['--uninstall', '--quiet', `--suffix=${suffix}`,
    `--install-dir=${testDir}`, '--no-launch'], { windowsHide: true, timeout: 600000 });
  check('卸载退出码为 0', uninstall.status === 0, `exit=${uninstall.status}`);
  const regAfter = spawnSync('reg.exe', ['query',
    `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\iRixAudioPlayer-${suffix}`],
    { encoding: 'utf8', windowsHide: true });
  check('卸载后注册表项已删除', regAfter.status !== 0, `reg query exit=${regAfter.status}`);
  check('卸载后快捷方式已删除', !fs.existsSync(startMenuLnk) && !fs.existsSync(desktopLnk), '');
  
  let dirGone = false;
  for (let i = 0; i < 20 && !dirGone; i++) {
    await new Promise((r) => setTimeout(r, 500));
    dirGone = !fs.existsSync(testDir);
  }
  check('卸载后安装目录已被删除', dirGone, testDir);
}





log('\n> 试运行：释放目录被占用时（模拟"忘了关程序"）');
{
  
  const hasWide = (s) => stubBuf.includes(Buffer.from(s, 'utf16le'));
  check('启动器内置"上一次实例还在运行"的可操作提示',
    hasWide('还在运行') && hasWide('请先关闭正在运行的窗口'), 
    hasWide('还在运行') ? '含提示文字' : '未找到提示文字');

  const lockedExe = path.join(unpackDir, APP_EXE);
  const locker = spawn('powershell', ['-NoProfile', '-Command',
    `$f=[IO.File]::Open('${lockedExe.replace(/'/g, "''")}','Open','ReadWrite','None'); Start-Sleep -Seconds 30`],
    { windowsHide: true, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 2500));            
  const run2 = spawnSync(outExe, ['--extract-only', '--force', '--quiet', `--unpack-dir=${unpackDir}`],
    { windowsHide: true, timeout: 300000 });
  check('被占用时启动器退出码非 0（不会假装成功）', run2.status !== 0, `exit=${run2.status}`);
  
  
  
  locker.kill();
  await new Promise((r) => setTimeout(r, 600));
}

{
  const run3 = spawnSync(outExe, ['--extract-only', '--force', '--quiet', `--unpack-dir=${unpackDir}`],
    { windowsHide: true, timeout: 300000 });
  check('关掉占用后可以正常重新解压', run3.status === 0 && fs.existsSync(path.join(unpackDir, APP_EXE)),
    `exit=${run3.status}`);
}

const failed = checks.filter((c) => !c.ok);
fs.writeFileSync(reportFile,
  JSON.stringify({ artifact: outExe, sizeMB: Number((exeSize / 1048576).toFixed(1)), checks }, null, 2));
console.log(`\n=== 单文件打包自检: ${checks.length - failed.length}/${checks.length} 通过 ===`);
process.exit(failed.length ? 1 : 0);
