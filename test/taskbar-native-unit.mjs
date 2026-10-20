


import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const addonPath = path.join(projectRoot, 'native', 'build', 'Release', 'aurora_audio.node');

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

if (!fs.existsSync(addonPath)) {
  console.log('未构建原生模块（native/build/Release/aurora_audio.node），跳过');
  process.exit(0);
}
const addon = require(addonPath);

if (process.platform !== 'win32') {
  check('非 Windows 不暴露任务栏接口',
    addon.taskbarInstall === undefined && addon.taskbarUpdate === undefined &&
    addon.taskbarDispose === undefined);
} else {
  check('原生模块导出 taskbarInstall / taskbarUpdate / taskbarDispose',
    typeof addon.taskbarInstall === 'function' &&
    typeof addon.taskbarUpdate === 'function' &&
    typeof addon.taskbarDispose === 'function');
  check('未安装时 taskbarUpdate 返回 false（不崩）', addon.taskbarUpdate(false) === false);
  check('未安装时 taskbarUpdate(true) 也返回 false', addon.taskbarUpdate(true) === false);

  const icons = {
    prev: { width: 1, height: 1, bitmap: Buffer.alloc(4) },
    play: { width: 1, height: 1, bitmap: Buffer.alloc(4) },
    pause: { width: 1, height: 1, bitmap: Buffer.alloc(4) },
    next: { width: 1, height: 1, bitmap: Buffer.alloc(4) },
  };
  let err = null;
  try { addon.taskbarInstall(Buffer.alloc(8), icons, () => {}); } catch (e) { err = e; }
  check('无效窗口句柄抛可读错误（不崩进程）', !!err && /句柄/.test(String(err.message)), err ? err.message : '(未抛错)');

  let err2 = null;
  try { addon.taskbarInstall(Buffer.alloc(8), { prev: null }, () => {}); } catch (e) { err2 = e; }
  check('图标参数缺失抛可读错误', !!err2 && /图标/.test(String(err2.message)), err2 ? err2.message : '(未抛错)');

  try { addon.taskbarDispose(); } catch {  }
  check('taskbarDispose 幂等（可重复调用）', (() => {
    try { addon.taskbarDispose(); return true; } catch { return false; }
  })());
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n=== 原生任务栏接口: ${checks.length - failed.length}/${checks.length} 通过 ===`);
process.exit(failed.length ? 1 : 0);
