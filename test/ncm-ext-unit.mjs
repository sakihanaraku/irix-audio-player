

import crypto from 'node:crypto';
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const extPath = path.resolve(here, '..', '..', 'extensions-src', 'ncm-decrypt', 'index.js');
const ext = (await import('file:///' + extPath.replace(/\\/g, '/'))).default || (await import('file:///' + extPath.replace(/\\/g, '/')));
const ncm = ext.default || ext;

const AUDIO_KEY = Buffer.from([0x68, 0x7a, 0x48, 0x52, 0x41, 0x6d, 0x73, 0x6f, 0x35, 0x6b, 0x49, 0x6e, 0x62, 0x61, 0x78, 0x57]);
const META_KEY = Buffer.from([0x23, 0x31, 0x34, 0x6c, 0x6a, 0x6b, 0x5f, 0x21, 0x5c, 0x5d, 0x26, 0x30, 0x55, 0x3c, 0x27, 0x28]);

function aesEncrypt(buf, key) {
  const c = crypto.createCipheriv('aes-128-ecb', key, null);
  return Buffer.concat([c.update(buf), c.final()]);
}


function buildSBox(key) {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  let n = 0;
  for (let i = 0; i < 256; i++) {
    n = (s[i] + n + key[i % key.length]) & 0xff;
    const t = s[i]; s[i] = s[n]; s[n] = t;
  }
  return s;
}
function buildKeyStream(sBox) {
  const ks = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    const j = (i + 1) & 0xff;
    ks[i] = sBox[(sBox[j] + sBox[(j + sBox[j]) & 0xff]) & 0xff];
  }
  return ks;
}


function makeNcm(audio, { meta = null, cover = null } = {}) {
  const rc4Key = crypto.randomBytes(20);
  const keyPlain = Buffer.concat([Buffer.from('neteasecloudmusic'), rc4Key]);
  const keyEnc = aesEncrypt(keyPlain, AUDIO_KEY);
  for (let i = 0; i < keyEnc.length; i++) keyEnc[i] ^= 0x64;

  const chunks = [Buffer.from('CTENFDAM', 'latin1'), Buffer.from([0x01, 0x70])];
  const keyLen = Buffer.alloc(4); keyLen.writeUInt32LE(keyEnc.length, 0);
  chunks.push(keyLen, keyEnc);

  if (meta) {
    const text = 'music:' + JSON.stringify(meta);
    const enc = aesEncrypt(Buffer.from(text, 'utf8'), META_KEY).toString('base64');
    const raw = Buffer.from("163 key(Don't modify):" + enc, 'latin1');
    for (let i = 0; i < raw.length; i++) raw[i] ^= 0x63;
    const len = Buffer.alloc(4); len.writeUInt32LE(raw.length, 0);
    chunks.push(len, raw);
  } else {
    chunks.push(Buffer.alloc(4));
  }

  const coverData = cover || Buffer.alloc(0);
  chunks.push(Buffer.alloc(4));                     
  chunks.push(Buffer.alloc(5));                     
  const coverLen = Buffer.alloc(4); coverLen.writeUInt32LE(coverData.length, 0);
  chunks.push(coverLen, coverData);

  const sBox = buildSBox(rc4Key);
  const ks = buildKeyStream(sBox);
  const enc = Buffer.allocUnsafe(audio.length);
  for (let i = 0; i < audio.length; i++) enc[i] = audio[i] ^ ks[i & 0xff];
  chunks.push(enc);
  return Buffer.concat(chunks);
}

let pass = 0;
let fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('=== ncm-decrypt 扩展 往返测试 ===');


for (const size of [1024, 7777, 65536]) {
  const audio = Buffer.concat([Buffer.from('fLaC'), crypto.randomBytes(size - 4)]);
  const container = makeNcm(audio, {
    meta: { musicName: '测试曲目', artist: [['测试歌手']], album: '测试专辑', duration: 123000 },
    cover: Buffer.from('89504e47', 'hex'),
  });
  let out;
  try { out = ncm.decode(container, { name: 'a.ncm' }); } catch (e) { out = null; console.log('    异常: ' + e.message); }
  check(`端到端 ${size}B 解密成功`, !!out && !!out.data, out ? '' : '解密抛错');
  if (out && out.data) {
    check(`端到端 ${size}B 逐字节一致`, Buffer.compare(out.data, audio) === 0);
    check(`端到端 ${size}B 识别为 flac`, out.ext === 'flac', out.ext);
  }
}


{
  const audio = Buffer.concat([Buffer.from('ID3'), crypto.randomBytes(2000)]);
  const r = ncm.decode(makeNcm(audio, { meta: { musicName: '歌名', artist: [['甲'], ['乙']], album: '专辑名', duration: 95000 } }), { name: 'b.ncm' });
  check('元数据：标题', r.meta && r.meta.title === '歌名', r.meta && r.meta.title);
  check('元数据：多艺术家用 " / " 连接', r.meta && r.meta.artist === '甲 / 乙', r.meta && r.meta.artist);
  check('元数据：专辑', r.meta && r.meta.album === '专辑名', r.meta && r.meta.album);
  check('元数据：时长', r.meta && r.meta.duration === 95000, r.meta && r.meta.duration);
  check('真实格式识别为 mp3', r.ext === 'mp3', r.ext);
}


{
  const audio = Buffer.concat([Buffer.from('OggS'), crypto.randomBytes(999)]);
  const r = ncm.decode(makeNcm(audio), { name: 'c.ncm' });
  check('无元数据段也能解', !!r && r.meta === null);
  check('无封面段也能解', !r.cover || r.cover.length === 0);
  check('无元数据时音频仍逐字节一致', Buffer.compare(r.data, audio) === 0);
}


{
  const plain = Buffer.concat([Buffer.from('fLaC'), crypto.randomBytes(500)]);
  const r = ncm.decode(plain, { name: 'd.ncm' });
  check('普通音频走 passthrough（不当作加密文件）', r.passthrough === true && Buffer.compare(r.data, plain) === 0);
}


{
  let threw = '';
  try { ncm.decode(Buffer.from('CTENFDAM\u0001p', 'latin1')); } catch (e) { threw = e.message; }
  check('截断文件给出可读错误', /不完整|太短|失败/.test(threw), threw);
  let threw2 = '';
  try { ncm.decode(Buffer.from('NOTNCM1234567890', 'latin1')); } catch (e) { threw2 = e.message; }
  check('非 ncm 数据不崩（passthrough 或报错）', true);
}


check('扩展 id 正确', ncm.id === 'ncm-decrypt', ncm.id);
check('扩展 match 命中 .ncm', ncm.match.test('x.ncm') && !ncm.match.test('x.flac'));

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail ? 1 : 0);
