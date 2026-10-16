

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')).version;
const setup = process.argv[2] || path.join(projectRoot, 'dist', `iRixAudioPlayer-${version}-setup.exe`);

const APP = 'iRix Audio Player';


const installDir = process.argv[3] || path.join(projectRoot, 'dist', 'setup-test');
const startMenuLnk = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu',
  'Programs', `${APP}.lnk`);
const desktopLnk = path.join(process.env.USERPROFILE || '', 'Desktop', `${APP}.lnk`);
const uninstaller = path.join(installDir, `Uninstall ${APP}.exe`);

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

const regQuery = (needle) => {
  const r = spawnSync('reg.exe', ['query',
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall', '/s', '/f', needle],
    { encoding: 'utf8', windowsHide: true });
  return { status: r.status, text: (r.stdout || '') + (r.stderr || '') };
};

const rmIfExists = (p) => { try { fs.rmSync(p, { recursive: true, force: true }); } catch {  } };
const waitGone = async (p, tries = 20) => {
  for (let i = 0; i < tries; i++) {
    if (!fs.existsSync(p)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return !fs.existsSync(p);
};

console.log('=== 安装包验证（真实安装 / 卸载）===');
console.log(`安装包: ${setup}`);
if (!fs.existsSync(setup)) {
  console.log('✗ 找不到安装包');
  process.exit(1);
}


if (fs.existsSync(installDir)) {
  console.log('> 清理已有的旧安装…');
  if (fs.existsSync(uninstaller)) {
    spawnSync(uninstaller, ['/S'], { windowsHide: true, timeout: 600000 });
    await waitGone(installDir);
  }
  rmIfExists(installDir);
  rmIfExists(startMenuLnk);
  rmIfExists(desktopLnk);
}

console.log('\n> 静默安装（/S /D=<目录>）…');
const t0 = Date.now();
const install = spawnSync(setup, ['/S', `/D=${installDir}`], { windowsHide: true, timeout: 900000 });
console.log(`  退出码 ${install.status}，用时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
check('安装包退出码为 0', install.status === 0, `exit=${install.status}`);


let ready = false;
for (let i = 0; i < 60 && !ready; i++) {
  ready = fs.existsSync(path.join(installDir, `${APP}.exe`));
  if (!ready) await new Promise((r) => setTimeout(r, 1000));
}

check('安装到指定目录', ready, installDir);
check('主程序存在', fs.existsSync(path.join(installDir, `${APP}.exe`)), '');
check('原生模块已就位',
  fs.existsSync(path.join(installDir, 'resources', 'app.asar.unpacked', 'native', 'build', 'Release', 'aurora_audio.node')), '');
check('ffmpeg 已就位',
  fs.existsSync(path.join(installDir, 'resources', 'ffmpeg', 'bin', 'ffmpeg.exe')), '');
check('卸载器随安装生成', fs.existsSync(uninstaller), path.basename(uninstaller));
check('开始菜单快捷方式', fs.existsSync(startMenuLnk), startMenuLnk);
check('桌面快捷方式', fs.existsSync(desktopLnk), desktopLnk);

const regInstalled = regQuery(APP);
check('「设置 → 应用」里能看到（写了卸载项）',
  /DisplayName/.test(regInstalled.text) && regInstalled.text.includes(APP),
  (regInstalled.text.match(/DisplayName\s+REG_SZ\s+(.+)/) || [])[1] || '');
check('卸载项里含版本与卸载命令',
  regInstalled.text.includes(version) && /UninstallString/.test(regInstalled.text), version);

console.log('\n> 静默卸载（/S）…');
const t1 = Date.now();
const uninstall = spawnSync(uninstaller, ['/S'], { windowsHide: true, timeout: 900000 });
console.log(`  退出码 ${uninstall.status}，用时 ${((Date.now() - t1) / 1000).toFixed(0)}s`);
check('卸载器退出码为 0', uninstall.status === 0, `exit=${uninstall.status}`);

const dirGone = await waitGone(installDir, 40);
check('安装目录已删除', dirGone, installDir);

await new Promise((r) => setTimeout(r, 1500));
check('开始菜单快捷方式已删除', !fs.existsSync(startMenuLnk), '');
check('桌面快捷方式已删除', !fs.existsSync(desktopLnk), '');
const regAfter = regQuery(APP);
check('卸载后注册表项已清理',
  !/DisplayName\s+REG_SZ\s+iRix Audio Player/m.test(regAfter.text), `query exit=${regAfter.status}`);

const failed = checks.filter((c) => !c.ok);
fs.writeFileSync(path.join(projectRoot, 'dist', 'setup-report.json'),
  JSON.stringify({ setup, checks, installDir }, null, 2));
console.log(`\n=== 安装包验证: ${checks.length - failed.length}/${checks.length} 通过 ===`);
process.exit(failed.length ? 1 : 0);
