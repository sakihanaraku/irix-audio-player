

import { createWriteStream } from 'node:fs';
import { mkdir, rm, readdir, rename, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const URL = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip';
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.resolve(process.argv[2] ?? path.join(projectRoot, 'vendor', 'ffmpeg'));
const zip = path.join(target, 'ffmpeg-download.zip');

const t0 = Date.now();
await mkdir(target, { recursive: true });

console.log(`[fetch] GET ${URL}`);
const res = await fetch(URL, { redirect: 'follow' });
if (!res.ok) throw new Error(`下载失败: HTTP ${res.status}`);
const total = Number(res.headers.get('content-length') || 0);
if (total) console.log(`[fetch] 体积 ${(total / 1048576).toFixed(1)}MB`);

let seen = 0;
let lastLog = 0;
const out = createWriteStream(zip);
const reader = res.body.getReader();
for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  seen += value.length;
  if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r));
  const now = Date.now();
  if (now - lastLog > 5000) {
    lastLog = now;
    const pct = total ? ((seen / total) * 100).toFixed(1) + '%' : '?';
    const mbps = seen / 1048576 / ((now - t0) / 1000);
    console.log(`[fetch] ${(seen / 1048576).toFixed(1)}MB ${pct} ${mbps.toFixed(2)}MB/s`);
  }
}
await new Promise((r) => out.end(r));
console.log(`[fetch] 已下载 ${((await stat(zip)).size / 1048576).toFixed(1)}MB，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);

console.log('[fetch] 解压中 (tar.exe)...');
const code = await new Promise((resolve) => {
  const p = spawn('tar.exe', ['-xf', zip, '-C', target], { stdio: 'inherit' });
  p.on('exit', resolve);
});
if (code !== 0) throw new Error(`tar 解压失败，退出码 ${code}`);
await rm(zip, { force: true });


for (const entry of await readdir(target, { withFileTypes: true })) {
  const full = path.join(target, entry.name);
  if (entry.isDirectory() && /ffmpeg-.*win64/.test(entry.name)) {
    const bin = path.join(full, 'bin');
    try {
      const files = await readdir(bin);
      for (const f of files) {
        if (/^(ffmpeg|ffprobe|ffplay)\.exe$/i.test(f)) {
          await rm(path.join(target, 'bin', f), { force: true });
          await mkdir(path.join(target, 'bin'), { recursive: true });
          await rename(path.join(bin, f), path.join(target, 'bin', f));
          console.log(`[fetch] -> bin/${f}`);
        }
      }
    } catch {  }
  }
}
console.log('[fetch] 完成');
