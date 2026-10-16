







import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkgVersion = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')).version;

const distDir = path.join(projectRoot, 'dist');
const targets = [];
if (fs.existsSync(distDir)) {
  for (const f of fs.readdirSync(distDir).filter((f) => /-portable\.exe$/i.test(f))) {
    targets.push(['单文件便携版', path.join(distDir, f)]);
  }
  const green = path.join(distDir, 'win-unpacked', 'iRix Audio Player.exe');
  if (fs.existsSync(green)) targets.push(['绿色版主程序', green]);
}
if (!targets.length) {
  console.log('未构建打包产物（dist/），跳过');
  process.exit(0);
}

const out = path.join(distDir, 'vi-check.txt');
const SEP = '\u0001';
let failed = 0;
for (const [label, exe] of targets) {
  fs.rmSync(out, { force: true });
  const script = [
    `$v = (Get-Item -LiteralPath '${exe}').VersionInfo`,
    `@($v.ProductName, $v.FileDescription, $v.OriginalFilename, $v.CompanyName, $v.FileVersion, $v.ProductVersion) -join ([char]1) | Out-File -Encoding utf8 '${out}'`,
  ].join('; ');
  spawnSync('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true });

  const [productName = '', fileDesc = '', origName = '', company = '', fileVer = '', prodVer = ''] =
    fs.readFileSync(out, 'utf8').replace(/^\uFEFF/, '').trim().split(SEP);

  const nameOk = productName.includes('iRix Audio Player');
  const garbled = /[鍏嶅畨瑁卂锟]/.test(fileDesc + productName);           
  const stageOnly = /^(alpha|beta|release)$/i.test(prodVer.trim());     
  const verOk = fileVer.trim() !== '' && prodVer.trim() !== '' && !stageOnly &&
    (fileVer.includes(pkgVersion) || prodVer.includes(pkgVersion));
  const ok = nameOk && !garbled && verOk;
  console.log(`  ${ok ? '✓' : '✗'} ${label}: ${productName} | ${fileDesc} | ` +
    `FileVersion=${fileVer} | ProductVersion=${prodVer} | 期望含 ${pkgVersion}`);
  if (!ok) failed++;
}
fs.rmSync(out, { force: true });
console.log(`\n=== 版本资源校验: ${targets.length - failed}/${targets.length} 通过 ===`);
process.exit(failed ? 1 : 0);
