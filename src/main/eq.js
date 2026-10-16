'use strict';













const EQ_BAND_FREQS = [20, 50, 140, 380, 1000, 2700, 7100, 19000];
const EQ_BAND_LABELS = ['20', '50', '140', '380', '1k', '2.7k', '7.1k', '19k'];
const EQ_DEFAULT_Q = 1.2;
const EQ_GAIN_LIMIT = 12;          
const EQ_PREAMP_MIN = -12;
const EQ_PREAMP_MAX = 12;
const EQ_FILE_FORMAT = 'irix-eq';


const EQ_PRESETS = {
  flat: [0, 0, 0, 0, 0, 0, 0, 0],
  pop: [-1, 1, 3, 4, 2, 0, -1, -2],
  rock: [4, 3, 1, -1, -1, 1, 3, 4],
  jazz: [3, 2, 1, 1, -1, -1, 1, 2],
  classical: [3, 2, 0, 0, -1, -1, 0, 2],
  vocal: [-2, -1, 1, 3, 4, 3, 1, -1],
  bass: [7, 6, 4, 2, 0, -1, -2, -3],
  treble: [-3, -2, -1, 0, 2, 4, 6, 7],
};

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);


function defaultEqConfig() {
  return {
    enabled: false,
    preampDb: 0,
    bands: EQ_BAND_FREQS.map((freq) => ({ freq, gainDb: 0, q: EQ_DEFAULT_Q })),
  };
}


function eqConfigFromPreset(name, base = defaultEqConfig()) {
  const gains = EQ_PRESETS[name];
  if (!gains) return normalizeEqConfig(base);
  const cfg = normalizeEqConfig(base);
  cfg.enabled = true;
  cfg.bands = cfg.bands.map((b, i) => ({ ...b, gainDb: gains[i] ?? 0 }));
  return cfg;
}






function normalizeEqConfig(input) {
  const src = input && typeof input === 'object' ? input : {};
  const bands = EQ_BAND_FREQS.map((freq, i) => {
    const b = Array.isArray(src.bands) ? src.bands[i] : null;
    const gain = b && isFiniteNum(b.gainDb) ? clamp(b.gainDb, -EQ_GAIN_LIMIT, EQ_GAIN_LIMIT) : 0;
    const q = b && isFiniteNum(b.q) && b.q > 0.1 && b.q < 20 ? b.q : EQ_DEFAULT_Q;
    return { freq, gainDb: Math.round(gain * 10) / 10, q };
  });
  const preamp = isFiniteNum(src.preampDb) ? clamp(src.preampDb, EQ_PREAMP_MIN, EQ_PREAMP_MAX) : 0;
  return {
    enabled: src.enabled === true,
    preampDb: Math.round(preamp * 10) / 10,
    bands,
  };
}


function eqConfigEquals(a, b) {
  const x = normalizeEqConfig(a);
  const y = normalizeEqConfig(b);
  if (x.enabled !== y.enabled || x.preampDb !== y.preampDb) return false;
  return x.bands.every((band, i) => band.gainDb === y.bands[i].gainDb && band.q === y.bands[i].q);
}






function biquadPeaking(freq, gainDb, q, sampleRate) {
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * freq) / sampleRate;
  const cosW = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Math.max(0.05, q));
  const a0 = 1 + alpha / A;
  return {
    b0: (1 + alpha * A) / a0,
    b1: (-2 * cosW) / a0,
    b2: (1 - alpha * A) / a0,
    a1: (-2 * cosW) / a0,
    a2: (1 - alpha / A) / a0,
  };
}









class EqProcessor {
  constructor({ sampleRate = 48000, config = defaultEqConfig() } = {}) {
    this.sampleRate = sampleRate;
    this.config = normalizeEqConfig(config);
    this.state = [];          
    this.clipped = 0;
    this.processedFrames = 0;
    this.rebuild();
  }

  setSampleRate(fs) {
    const rate = Number(fs);
    if (!isFiniteNum(rate) || rate < 8000 || rate === this.sampleRate) return;
    this.sampleRate = rate;
    this.rebuild();
    this.resetState();
  }

  
  setConfig(config) {
    this.config = normalizeEqConfig(config);
    this.rebuild();
  }

  setEnabled(enabled) {
    this.config.enabled = enabled === true;
  }

  setBandGain(index, gainDb) {
    if (index < 0 || index >= this.config.bands.length) return;
    this.config.bands[index].gainDb = clamp(isFiniteNum(gainDb) ? gainDb : 0, -EQ_GAIN_LIMIT, EQ_GAIN_LIMIT);
    this.rebuild();
  }

  setPreamp(db) {
    this.config.preampDb = clamp(isFiniteNum(db) ? db : 0, EQ_PREAMP_MIN, EQ_PREAMP_MAX);
  }

  
  get bypassed() {
    if (!this.config.enabled) return true;
    if (this.config.preampDb !== 0) return false;
    return this.config.bands.every((b) => b.gainDb === 0);
  }

  rebuild() {
    this.coeffs = this.config.bands.map((b) => biquadPeaking(b.freq, b.gainDb, b.q, this.sampleRate));
    this.preampGain = Math.pow(10, this.config.preampDb / 20);
    if (!this.state.length) {
      this.state = this.coeffs.map(() => []);
    }
  }

  resetState() {
    for (const perBand of this.state) perBand.length = 0;
  }

  




  processInterleaved(data, channels = 2) {
    if (this.bypassed || !data) return data;
    const ch = Math.max(1, channels | 0);
    const samples = data instanceof Float32Array
      ? data
      : new Float32Array(data.buffer, data.byteOffset, Math.floor(data.byteLength / 4));
    const frames = Math.floor(samples.length / ch);
    const hasPreamp = this.preampGain !== 1;

    for (let f = 0; f < frames; f++) {
      const base = f * ch;
      for (let c = 0; c < ch; c++) {
        let x = samples[base + c];
        if (hasPreamp) x *= this.preampGain;
        for (let b = 0; b < this.coeffs.length; b++) {
          const k = this.coeffs[b];
          if (k.b0 === 1 && k.b1 === 0 && k.b2 === 0 && k.a1 === 0 && k.a2 === 0) continue;   
          let st = this.state[b][c];
          if (!st) st = this.state[b][c] = { x1: 0, x2: 0, y1: 0, y2: 0 };
          const y = k.b0 * x + k.b1 * st.x1 + k.b2 * st.x2 - k.a1 * st.y1 - k.a2 * st.y2;
          st.x2 = st.x1;
          st.x1 = x;
          st.y2 = st.y1;
          st.y1 = y;
          x = y;
        }
        if (x > 1) { x = 1; this.clipped++; } else if (x < -1) { x = -1; this.clipped++; }
        samples[base + c] = x;
      }
    }
    this.processedFrames += frames;
    return data;
  }

  
  magnitudeDbAt(freq) {
    if (!this.config.enabled) return 0;
    const w = (2 * Math.PI * freq) / this.sampleRate;
    let mag = this.preampGain;
    for (const k of this.coeffs) {
      const cw = Math.cos(w);
      const c2w = Math.cos(2 * w);
      const sw = Math.sin(w);
      const s2w = Math.sin(2 * w);
      
      const numRe = k.b0 + k.b1 * cw + k.b2 * c2w;
      const numIm = -(k.b1 * sw + k.b2 * s2w);
      const denRe = 1 + k.a1 * cw + k.a2 * c2w;
      const denIm = -(k.a1 * sw + k.a2 * s2w);
      const den = Math.hypot(denRe, denIm);
      if (den > 0) mag *= Math.hypot(numRe, numIm) / den;
    }
    return 20 * Math.log10(Math.max(1e-9, mag));
  }

  
  curve(points = 64, minHz = 20, maxHz = 20000) {
    const out = [];
    for (let i = 0; i < points; i++) {
      const f = minHz * Math.pow(maxHz / minHz, i / (points - 1));
      out.push({ freq: f, gainDb: this.magnitudeDbAt(f) });
    }
    return out;
  }

  stats() {
    return { clipped: this.clipped, processedFrames: this.processedFrames, bypassed: this.bypassed };
  }
}


function eqToFile(config, { appName = 'iRix Audio Player' } = {}) {
  const cfg = normalizeEqConfig(config);
  return JSON.stringify({
    format: EQ_FILE_FORMAT,
    version: 1,
    app: appName,
    savedAt: new Date().toISOString(),
    enabled: cfg.enabled,
    preampDb: cfg.preampDb,
    bands: cfg.bands.map((b) => ({ freq: b.freq, gainDb: b.gainDb, q: b.q })),
  }, null, 2);
}





function eqFromFile(text) {
  let json = null;
  try {
    json = JSON.parse(String(text || ''));
  } catch {
    return { ok: false, error: 'bad-json' };
  }
  if (!json || typeof json !== 'object') return { ok: false, error: 'bad-json' };
  if (json.format && json.format !== EQ_FILE_FORMAT) return { ok: false, error: 'bad-format' };
  if (!Array.isArray(json.bands)) return { ok: false, error: 'bad-bands' };
  return { ok: true, config: normalizeEqConfig(json) };
}

module.exports = {
  EQ_BAND_FREQS,
  EQ_BAND_LABELS,
  EQ_DEFAULT_Q,
  EQ_GAIN_LIMIT,
  EQ_PREAMP_MIN,
  EQ_PREAMP_MAX,
  EQ_FILE_FORMAT,
  EQ_PRESETS,
  EqProcessor,
  defaultEqConfig,
  eqConfigFromPreset,
  normalizeEqConfig,
  eqConfigEquals,
  biquadPeaking,
  eqToFile,
  eqFromFile,
};
