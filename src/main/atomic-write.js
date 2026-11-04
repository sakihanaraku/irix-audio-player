




'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');

let seq = 0;
const chains = new Map();

async function renameWithRetry(tmp, file) {
  let lastErr = null;
  for (let i = 0; i < 6; i++) {
    try {
      await fsp.rename(tmp, file);
      return;
    } catch (err) {
      lastErr = err;
      if (err.code !== 'EPERM' && err.code !== 'EBUSY' && err.code !== 'EACCES') throw err;
      await new Promise((r) => setTimeout(r, 20 * (i + 1)));   
    }
  }
  throw lastErr;
}

async function writeNow(file, data, encoding) {
  const tmp = `${file}.${process.pid}.${Date.now()}.${++seq}.tmp`;
  let handle = null;
  try {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    handle = await fsp.open(tmp, 'w');
    if (Buffer.isBuffer(data) || data instanceof Uint8Array) await handle.writeFile(data);
    else await handle.writeFile(String(data), { encoding });
    await handle.sync();
    await handle.close();
    handle = null;
    await renameWithRetry(tmp, file);
  } catch (err) {
    try { if (handle) await handle.close(); } catch {  }
    try { await fsp.rm(tmp, { force: true }); } catch {  }
    throw err;
  }
}







function atomicWriteFile(file, data, opts = {}) {
  const target = path.resolve(String(file));
  const prev = chains.get(target) || Promise.resolve();
  const run = prev.catch(() => {  })
    .then(() => writeNow(target, data, opts.encoding || 'utf8'));
  chains.set(target, run);
  const cleanup = () => { if (chains.get(target) === run) chains.delete(target); };
  run.then(cleanup, cleanup);
  return run;
}

module.exports = { atomicWriteFile };
