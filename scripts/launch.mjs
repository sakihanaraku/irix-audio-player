

import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let electronPath;
try {
  electronPath = require('electron');
} catch (err) {
  console.error('未安装 Electron，请先运行: npm install');
  process.exit(1);
}

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

delete env.NODE_OPTIONS;

const extra = process.argv.slice(2);

const switches = extra.filter((a) => a.startsWith('--no-sandbox') || a.startsWith('--disable-'));
const appArgs = extra.filter((a) => !switches.includes(a));

const child = spawn(electronPath, [...switches, projectRoot, ...appArgs], {
  stdio: 'inherit',
  windowsHide: false,
  env,
});

child.on('exit', (code) => process.exit(code ?? 0));
