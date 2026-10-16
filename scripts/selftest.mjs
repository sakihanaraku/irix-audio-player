



import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronPath = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const outDir = path.join(projectRoot, 'test', 'artifacts');
env.AURORA_SELFTEST_OUT = outDir;
if (!env.AURORA_SELFTEST_MEDIA) env.AURORA_SELFTEST_MEDIA = path.join(projectRoot, 'test', 'media');

const extra = process.argv.slice(2);
const switches = extra.filter((a) => a.startsWith('--no-sandbox') || a.startsWith('--disable-'));
const appArgs = extra.filter((a) => !switches.includes(a));

const child = spawn(electronPath, [...switches, projectRoot, '--selftest', ...appArgs], {
  stdio: 'inherit',
  env,
});
child.on('exit', (code) => {
  const reportFile = path.join(outDir, 'selftest-report.json');
  if (fs.existsSync(reportFile)) {
    try {
      const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
      console.log(`\n自测: ${report.summary.passed}/${report.summary.total} 通过`);
      console.log(`产物目录: ${outDir}`);
    } catch {  }
  }
  process.exit(code ?? 0);
});
