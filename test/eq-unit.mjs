


import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eq = require('../src/main/eq.js');

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: !!ok });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

const FS = 48000;


function measureGainDb(processor, freq, { seconds = 0.5, amplitude = 0.25 } = {}) {
  const ch = 2;
  const frames = Math.floor(FS * seconds);
  const buf = new Float32Array(frames * ch);
  for (let i = 0; i < frames; i++) {
    const v = amplitude * Math.sin((2 * Math.PI * freq * i) / FS);
    buf[i * ch] = v;
    buf[i * ch + 1] = v;
  }
  processor.resetState();
  processor.processInterleaved(buf, ch);
  
  const skip = Math.floor(frames * 0.2);
  let sumIn = 0;
  let sumOut = 0;
  let n = 0;
  for (let i = skip; i < frames; i++) {
    const inV = amplitude * Math.sin((2 * Math.PI * freq * i) / FS);
    sumIn += inV * inV;
    sumOut += buf[i * ch] * buf[i * ch];
    n++;
  }
  const rmsIn = Math.sqrt(sumIn / n);
  const rmsOut = Math.sqrt(sumOut / n);
  return 20 * Math.log10(rmsOut / rmsIn);
}

console.log('=== 8 段 EQ 单测 ===');


console.log('\n[A] 频段与量程');
{
  const cfg = eq.defaultEqConfig();
  check('一共 8 段', cfg.bands.length === 8, `${cfg.bands.length} 段`);
  check('覆盖 20Hz 到 19kHz',
    cfg.bands[0].freq === 20 && cfg.bands[7].freq === 19000,
    `${cfg.bands.map((b) => b.freq).join(' / ')}`);
  check('频点按对数等分（相邻比值近似）', (() => {
    const ratios = cfg.bands.slice(1).map((b, i) => b.freq / cfg.bands[i].freq);
    return ratios.every((r) => r > 2.4 && r < 2.9);
  })(), cfg.bands.slice(1).map((b, i) => (b.freq / cfg.bands[i].freq).toFixed(2)).join(' '));
  check('标签与频点一一对应', eq.EQ_BAND_LABELS.length === 8 &&
    eq.EQ_BAND_LABELS[4] === '1k' && eq.EQ_BAND_LABELS[7] === '19k', eq.EQ_BAND_LABELS.join(','));
  check('默认关闭且全 0dB', cfg.enabled === false && cfg.bands.every((b) => b.gainDb === 0));
}


console.log('\n[B] 配置规整（越界/缺字段/脏数据）');
{
  const cfg = eq.normalizeEqConfig({ enabled: 'yes', preampDb: 99, bands: [{ gainDb: 40 }, { gainDb: -40 }, {}] });
  check('增益被限制在 ±12dB', cfg.bands[0].gainDb === 12 && cfg.bands[1].gainDb === -12,
    `${cfg.bands[0].gainDb} / ${cfg.bands[1].gainDb}`);
  check('前级被限制在 ±12dB', cfg.preampDb === 12, String(cfg.preampDb));
  check('缺段自动补 0dB，段数固定 8', cfg.bands.length === 8 && cfg.bands[7].gainDb === 0);
  check('enabled 只认 true', cfg.enabled === false, String(cfg.enabled));
  const dirty = eq.normalizeEqConfig({ bands: [{ gainDb: NaN }, { gainDb: 'x' }, null] });
  check('脏数据不产生 NaN', dirty.bands.every((b) => Number.isFinite(b.gainDb)), '');
  check('Q 非法时回落到默认', eq.normalizeEqConfig({ bands: [{ q: 0 }] }).bands[0].q === eq.EQ_DEFAULT_Q);
}


console.log('\n[C] 频率响应（解析 vs 实测）');
{
  const cfg = eq.normalizeEqConfig({ enabled: true, bands: [{ gainDb: 0 }, { gainDb: 0 }, { gainDb: 0 }, { gainDb: 0 }, { gainDb: 0 }, { gainDb: 0 }, { gainDb: 0 }, { gainDb: 0 }] });
  const flat = new eq.EqProcessor({ sampleRate: FS, config: cfg });
  check('全 0dB 时判为直通（不做无谓计算）', flat.bypassed === true, '');

  
  const boosted = eq.defaultEqConfig();
  boosted.enabled = true;
  boosted.bands[4].gainDb = 6;
  const p = new eq.EqProcessor({ sampleRate: FS, config: boosted });
  const analytic = p.magnitudeDbAt(1000);
  const measured = measureGainDb(p, 1000);
  check('1kHz 段 +6dB：解析值与实测值都接近 6dB',
    Math.abs(analytic - 6) < 0.6 && Math.abs(measured - 6) < 0.8,
    `解析 ${analytic.toFixed(2)}dB / 实测 ${measured.toFixed(2)}dB`);
  const far = measureGainDb(p, 60);
  check('远离该频段时基本不提升（±1dB 内）', Math.abs(far) < 1, `${far.toFixed(2)}dB @60Hz`);

  
  const cut = eq.defaultEqConfig();
  cut.enabled = true;
  cut.bands[1].gainDb = -9;
  const pc = new eq.EqProcessor({ sampleRate: FS, config: cut });
  const cutMeasured = measureGainDb(pc, 50);
  check('50Hz 段 -9dB：实测接近 -9dB', Math.abs(cutMeasured + 9) < 1, `${cutMeasured.toFixed(2)}dB`);

  
  const multi = eq.eqConfigFromPreset('bass');
  const pm = new eq.EqProcessor({ sampleRate: FS, config: multi });
  const bass = measureGainDb(pm, 20);
  const treble = measureGainDb(pm, 19000);
  check('bass 预设：低频提升、高频衰减', bass > 4 && treble < 0,
    `20Hz ${bass.toFixed(1)}dB / 19kHz ${treble.toFixed(1)}dB`);

  
  const pre = eq.defaultEqConfig();
  pre.enabled = true;
  pre.preampDb = -6;
  const pp = new eq.EqProcessor({ sampleRate: FS, config: pre });
  const preMeasured = measureGainDb(pp, 1000);
  check('前级 -6dB 是整体衰减', Math.abs(preMeasured + 6) < 0.5, `${preMeasured.toFixed(2)}dB`);
}


console.log('\n[D] 处理器行为');
{
  const proc = new eq.EqProcessor({ sampleRate: FS });
  const flat = new Float32Array([0.1, -0.2, 0.3, -0.4]);
  const copy = Float32Array.from(flat);
  proc.processInterleaved(flat, 2);
  check('关闭时不动样本', flat.every((v, i) => v === copy[i]), '');

  const cfg = eq.eqConfigFromPreset('rock');
  proc.setConfig(cfg);
  check('设置配置后可处理', proc.bypassed === false, '');
  const buf = new Float32Array(4800 * 2);
  for (let i = 0; i < 4800; i++) {
    const v = 0.8 * Math.sin((2 * Math.PI * 100 * i) / FS);
    buf[i * 2] = v;
    buf[i * 2 + 1] = v;
  }
  proc.processInterleaved(buf, 2);
  check('输出没有 NaN/Inf', buf.every((v) => Number.isFinite(v)), '');
  check('输出被限制在 [-1,1]（不会让后端爆音）', buf.every((v) => v >= -1 && v <= 1), '');
  check('统计里有削波计数（低音段 +4dB 会碰到上限）', proc.stats().clipped > 0,
    `${proc.stats().clipped} 个样本`);

  
  const p44 = new eq.EqProcessor({ sampleRate: 44100, config: cfg });
  const g44 = measureGainDbAt(p44, 1000, 44100);
  check('44.1kHz 下 1kHz 增益依然正确（系数随采样率重算）', Math.abs(g44 - 0) < 1.2, `${g44.toFixed(2)}dB`);

  
  const isolated = new eq.EqProcessor({ sampleRate: FS, config: eq.eqConfigFromPreset('pop') });
  const stereo = new Float32Array(4800 * 2);
  for (let i = 0; i < 4800; i++) {
    stereo[i * 2] = 0.5 * Math.sin((2 * Math.PI * 1000 * i) / FS);
    stereo[i * 2 + 1] = 0;
  }
  isolated.processInterleaved(stereo, 2);
  let rightEnergy = 0;
  for (let i = 0; i < 4800; i++) rightEnergy += Math.abs(stereo[i * 2 + 1]);
  check('声道之间没有串扰', rightEnergy === 0, `右声道能量 ${rightEnergy}`);

  
  const curve = isolated.curve(16);
  check('curve() 返回可画图的采样点', curve.length === 16 &&
    curve.every((pt) => Number.isFinite(pt.gainDb) && pt.freq >= 20), '');
}

function measureGainDbAt(processor, freq, fs) {
  const ch = 2;
  const frames = Math.floor(fs * 0.4);
  const buf = new Float32Array(frames * ch);
  for (let i = 0; i < frames; i++) {
    const v = 0.25 * Math.sin((2 * Math.PI * freq * i) / fs);
    buf[i * ch] = v;
    buf[i * ch + 1] = v;
  }
  processor.resetState();
  processor.processInterleaved(buf, ch);
  const skip = Math.floor(frames * 0.25);
  let sumIn = 0;
  let sumOut = 0;
  let n = 0;
  for (let i = skip; i < frames; i++) {
    const inV = 0.25 * Math.sin((2 * Math.PI * freq * i) / fs);
    sumIn += inV * inV;
    sumOut += buf[i * ch] * buf[i * ch];
    n++;
  }
  return 20 * Math.log10(Math.sqrt(sumOut / n) / Math.sqrt(sumIn / n));
}


console.log('\n[E] 预设');
{
  const names = Object.keys(eq.EQ_PRESETS);
  check('内置多套预设', names.length >= 6, names.join(', '));
  check('每个预设都是 8 段且在范围内',
    names.every((n) => eq.EQ_PRESETS[n].length === 8 &&
      eq.EQ_PRESETS[n].every((g) => g >= -eq.EQ_GAIN_LIMIT && g <= eq.EQ_GAIN_LIMIT)),
    '');
  check('flat 预设等价于关闭处理', (() => {
    const cfg = eq.eqConfigFromPreset('flat');
    cfg.enabled = true;
    return new eq.EqProcessor({ sampleRate: FS, config: cfg }).bypassed === true;
  })(), '');
  check('未知预设名回落到原配置', eq.eqConfigFromPreset('nope', eq.defaultEqConfig()).bands[0].gainDb === 0);
}


console.log('\n[F] .eq 文件');
{
  const cfg = eq.eqConfigFromPreset('jazz');
  cfg.enabled = true;
  cfg.preampDb = -3;
  const text = eq.eqToFile(cfg);
  const json = JSON.parse(text);
  check('文件是 JSON 且带格式标识与版本',
    json.format === 'irix-eq' && json.version === 1 && typeof json.savedAt === 'string', '');
  check('文件里含 8 段频率与增益', Array.isArray(json.bands) && json.bands.length === 8 &&
    json.bands[0].freq === 20 && json.bands[7].freq === 19000, '');
  check('文件里不含内部字段（enabled/preamp 正常保留）',
    json.enabled === true && json.preampDb === -3, '');

  const back = eq.eqFromFile(text);
  check('读回来与写出去一致', back.ok === true && eq.eqConfigEquals(back.config, cfg), JSON.stringify(back.error || ''));

  check('坏 JSON 报 bad-json', eq.eqFromFile('{oops').error === 'bad-json', '');
  check('别的格式报 bad-format',
    eq.eqFromFile(JSON.stringify({ format: 'other', bands: [] })).error === 'bad-format', '');
  check('缺 bands 报 bad-bands', eq.eqFromFile(JSON.stringify({ format: 'irix-eq' })).error === 'bad-bands', '');
  check('少几段也能读（缺失补 0dB）', (() => {
    const r = eq.eqFromFile(JSON.stringify({ format: 'irix-eq', bands: [{ gainDb: 5 }] }));
    return r.ok && r.config.bands.length === 8 && r.config.bands[0].gainDb === 5 && r.config.bands[1].gainDb === 0;
  })(), '');
  check('越界增益读入时被夹紧', (() => {
    const r = eq.eqFromFile(JSON.stringify({ format: 'irix-eq', bands: [{ gainDb: 99 }] }));
    return r.ok && r.config.bands[0].gainDb === eq.EQ_GAIN_LIMIT;
  })(), '');
}


console.log('\n[G] 性能（实时性）');
{
  const proc = new eq.EqProcessor({ sampleRate: FS, config: eq.eqConfigFromPreset('rock') });
  const frames = FS * 10;                       
  const buf = new Float32Array(frames * 2);
  for (let i = 0; i < buf.length; i++) buf[i] = 0.3 * Math.sin(i / 50);
  const t0 = process.hrtime.bigint();
  proc.processInterleaved(buf, 2);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  check('处理 10 秒立体声远快于实时（<200ms）', ms < 200,
    `${ms.toFixed(1)}ms（实时倍率 ${(10000 / ms).toFixed(0)}x）`);
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n=== 8 段 EQ: ${checks.length - failed.length}/${checks.length} 通过 ===`);
if (failed.length) {
  for (const f of failed) console.log(`  ✗ ${f.name}`);
  process.exit(1);
}
