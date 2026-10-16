











import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

export function pickFragment() {
  if (process.env.AURORA_TEST_DEVICE) return process.env.AURORA_TEST_DEVICE;
  try {
    return JSON.parse(fs.readFileSync(path.join(here, '.device.local.json'), 'utf8')).device || '';
  } catch { return ''; }
}


export function pickDeviceId(engine, backend = 'wasapi-shared', { strict = true } = {}) {
  const frag = pickFragment();
  if (!frag) return { id: '', name: '(系统默认)' };
  const enumBackend = backend === 'wasapi-exclusive' ? 'wasapi-shared' : backend;
  const list = engine.listDevices(enumBackend);
  const frags = String(frag).split('|').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const hit = list.find((d) => d.id.startsWith(frag) ||
    frags.some((f) => String(d.name).toLowerCase().includes(f)));
  if (!hit) {
    const msg = `找不到匹配 "${frag}" 的输出设备（后端 ${backend}）—— 请检查 test/.device.local.json ` +
      `或 AURORA_TEST_DEVICE；当前该后端设备：${list.map((d) => d.name).join(' / ')}`;
    if (strict) throw new Error(msg);
    return { id: '', name: `(未匹配 ${frag} → 默认)` };
  }
  return { id: hit.id, name: hit.name };
}


export function testDeviceId(session, backend = 'wasapi-shared') {
  const engine = require(session.addonPath);
  const { id, name } = pickDeviceId(engine, backend, { strict: true });
  console.log(`  [测试设备] ${backend} → ${name}`);
  return id;
}
