
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { atomicWriteFile } = require('../src/main/atomic-write');
const { Playlist, idFor, trackPathKey } = require('../src/main/playlist');

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ ok: !!ok });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'irix-persist-'));

try {
  const file = path.join(tmp, 'atomic.json');
  await atomicWriteFile(file, '{"a":1}\n');
  check('atomicWriteFile 写出', fs.readFileSync(file, 'utf8') === '{"a":1}\n');
  await atomicWriteFile(file, '{"a":2}\n');
  check('atomicWriteFile 覆盖旧文件', fs.readFileSync(file, 'utf8') === '{"a":2}\n');
  check('atomicWriteFile 不残留临时文件', !fs.readdirSync(tmp).some((n) => n.includes('.tmp')));

  await Promise.all(Array.from({ length: 20 }, (_, i) => atomicWriteFile(file, `{"n":${i}}\n`)));
  const content = fs.readFileSync(file, 'utf8');
  check('并发原子写后文件仍是完整 JSON', (() => { try { JSON.parse(content); return true; } catch { return false; } })(), content.trim());

  const plFile = path.join(tmp, 'playlist.json');
  const playlist = new Playlist(plFile);
  playlist.items = Array.from({ length: 10 }, (_, i) => ({ id: `id-${i}`, path: path.join(tmp, `tone-${i}.flac`), name: `tone-${i}.flac` }));
  await Promise.all(Array.from({ length: 20 }, () => playlist.save()));
  const plRaw = fs.readFileSync(plFile, 'utf8');
  const plData = JSON.parse(plRaw);
  check('Playlist 并发 save 后 JSON 完整', Array.isArray(plData.items) && plData.items.length === 10);
  check('Playlist 不残留临时文件', !fs.readdirSync(tmp).some((n) => n.includes('.tmp')));

  const winA = idFor('C:\\Music\\Foo.flac', 'win32');
  const winB = idFor('c:\\music\\foo.flac', 'win32');
  check('Windows 路径 ID 大小写不敏感', winA === winB, `${winA} / ${winB}`);
  const linuxA = idFor('/music/Foo.flac', 'linux');
  const linuxB = idFor('/music/foo.flac', 'linux');
  check('Linux 路径 ID 保留大小写', linuxA !== linuxB, `${linuxA} / ${linuxB}`);
  check('trackPathKey 平台规则一致',
    trackPathKey('C:\\Music\\Foo.flac', 'win32') === trackPathKey('c:\\music\\foo.flac', 'win32') &&
    trackPathKey('/music/Foo.flac', 'linux') !== trackPathKey('/music/foo.flac', 'linux'));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

const failed = checks.filter((c) => !c.ok).length;
console.log(`\n=== 持久化/路径键: ${checks.length - failed}/${checks.length} 通过 ===`);
process.exit(failed ? 1 : 0);
