
'use strict';

const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const { buildDecodeArgs } = require('./ffmpeg');
const { EqProcessor } = require('./eq');


const BACKEND_ALIASES = {
  auto: process.platform === 'linux' ? 'alsa' : 'wasapi-shared',
  wasapi: 'wasapi-shared',
  shared: 'wasapi-shared',
  exclusive: 'wasapi-exclusive',
  dsound: 'directsound',
  winmm: 'mme',
  alsa: 'alsa',
};

function loadAddon(appRoot, extraRoots = []) {
  const roots = [
    appRoot,
    appRoot.includes('app.asar') ? appRoot.replace('app.asar', 'app.asar.unpacked') : appRoot,
    ...extraRoots,
  ].filter(Boolean);
  const candidates = [];
  for (const root of roots) {
    candidates.push(path.join(root, 'native', 'build', 'Release', 'aurora_audio.node'));
    candidates.push(path.join(root, 'native', 'build', 'Debug', 'aurora_audio.node'));
    candidates.push(path.join(root, 'native', 'aurora_audio.node'));
  }
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'native', 'aurora_audio.node'));
  }
  const errors = [];
  for (const c of candidates) {
    if (!fs.existsSync(c)) { errors.push(`${c} 不存在`); continue; }
    try {
      return { engine: require(c), addonPath: c };
    } catch (err) {
      errors.push(`${c}: ${err.message}`);
    }
  }
  const error = new Error(`无法加载原生音频引擎模块:\n${errors.join('\n')}`);
  error.code = 'ADDON_LOAD_FAILED';
  throw error;
}

class PlayerSession extends EventEmitter {
  constructor({ appRoot, extraRoots = [] }) {
    super();
    this.appRoot = appRoot;
    const { engine, addonPath } = loadAddon(appRoot, extraRoots);
    this.engine = engine;
    this.addonPath = addonPath;

    this.output = null;          
    this.engineKey = null;       
    this.tools = { ffmpeg: null, ffprobe: null };
    this.child = null;           
    this.track = null;
    this.status = 'idle';        
    this.seekOffset = 0;
    this.baseFrames = 0;
    this.baseSilence = 0;
    this.framesWritten = 0;
    this.duration = 0;
    this.lastError = null;
    this.lastEngineError = '';
    this.generation = 0;         
    this.pendingChunk = null;
    this.progressTimer = null;
    this.drainWaiters = [];
    this.volume = 0.8;
    this.underruns = 0;
    this.pendingSeek = 0;
    this.eq = new EqProcessor({ sampleRate: 48000 });
    this.eqChannels = 2;
  }

  
  setEq(config) {
    this.eq.setConfig(config);
    return this.eq.config;
  }

  eqState() {
    return { config: this.eq.config, stats: this.eq.stats() };
  }

  setTools(tools) {
    this.tools = tools;
  }

  
  settingsKey(s) {
    return JSON.stringify({
      backend: s.backend, deviceId: s.deviceId, sampleRate: s.sampleRate, channels: s.channels,
      bits: s.bits, exclusive: s.exclusive, bufferMs: s.bufferMs, periodMs: s.periodMs,
      ringMs: s.ringMs, allowFormatFallback: s.allowFormatFallback, inputSampleRate: s.inputSampleRate,
      backendChain: s.backendChain || null,       
    });
  }

  openEngine(settings) {
    const key = this.settingsKey(settings);
    if (this.output && this.engineKey === key) return this.output;
    this.closeEngine();

    
    const preferred = BACKEND_ALIASES[settings.backend] || settings.backend ||
      (process.platform === 'linux' ? 'alsa' : 'wasapi-shared');
    const chain = settings.backendChain && settings.backendChain.length ? settings.backendChain : [preferred];
    const attempts = chain.length ? chain : [preferred];
    let lastErr = null;
    for (let i = 0; i < attempts.length; i++) {
      const backend = attempts[i];
      try {
        return this.openEngineWith(settings, backend, key, i > 0 ? preferred : null);
      } catch (err) {
        lastErr = err;
        this.lastEngineError = err.message;
        if (i < attempts.length - 1) {
          this.emit('engine', { opened: false, backend, error: err.message, fallingBack: attempts[i + 1] });
        }
      }
    }
    throw lastErr || new Error('无法打开音频设备');
  }

  openEngineWith(settings, backend, key, fallbackFrom) {
    const opts = {
      backend,
      deviceId: settings.deviceId || '',
      sampleRate: settings.sampleRate || 0,
      channels: settings.channels || 2,
      bits: settings.bits || 32,
      isFloat: settings.bits ? settings.bits === 32 || settings.bits === 64 : true,
      exclusive: backend === 'wasapi-exclusive' || !!settings.exclusive,
      bufferMs: settings.bufferMs || 100,
      periodMs: settings.periodMs || 10,
      ringMs: settings.ringMs || 800,
      allowFormatFallback: settings.allowFormatFallback !== false,
      hwndHex: '',
    };
    
    if (!settings.bits) { opts.bits = 32; opts.isFloat = true; }
    else { opts.bits = settings.bits; opts.isFloat = settings.bits >= 32; }

    this.output = new this.engine.AudioOutput(opts);
    this.output.setVolume(this.volume);
    this.engineKey = key;
    this.lastEngineError = '';
    this.actualBackend = backend;
    this.emit('engine', {
      format: this.format(), deviceName: this.output.deviceName, backend, opened: true,
      fallbackFrom: fallbackFrom || null,
    });
    return this.output;
  }

  closeEngine() {
    if (this.output) {
      try { this.output.close(); } catch {  }
      this.output = null;
      this.engineKey = null;
      this.emit('engine', { opened: false });
    }
  }

  format() {
    return this.output ? this.output.format : null;
  }

  listDevices(backend) {
    const id = BACKEND_ALIASES[backend] || backend;
    return this.engine.listDevices(id);
  }

  probe(opts) {
    const backend = BACKEND_ALIASES[opts.backend] || opts.backend;
    return this.engine.probeFormat({ ...opts, backend });
  }

  
  async play(track, settings, { startSeconds = 0 } = {}) {
    if (!this.tools.ffmpeg) throw new Error('未找到 ffmpeg，无法解码');
    this.stopSource();
    this.track = track;
    this.duration = Number(track.duration || track.meta?.duration || 0);
    this.seekOffset = startSeconds || 0;
    this.framesWritten = 0;
    this.underruns = 0;
    this.lastError = null;

    const output = this.openEngine(settings);
    output.flush();
    output.resume();
    const base = output.stats();
    this.baseFrames = base.framesRendered;
    this.baseSilence = base.framesSilence;
    this.status = 'playing';
    this.emitState();

    const fmt = output.format;
    const rate = fmt.inputSampleRate;
    const channels = fmt.inputChannels;
    const gen = ++this.generation;

    
    
    this.eq.setSampleRate(rate);
    this.eqChannels = channels;

    const args = buildDecodeArgs({      file: track.playPath || track.path, sampleRate: rate, channels, seekSeconds: this.seekOffset,
    });
    const child = spawn(this.tools.ffmpeg, args, {
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child = child;
    let stderrTail = '';

    child.stdout.on('data', (chunk) => {
      if (gen !== this.generation) return;
      child.stdout.pause();
      
      
      try {
        this.eq.processInterleaved(chunk, this.eqChannels || channels);
      } catch (err) {
        this.lastError = `均衡器处理失败: ${err.message}`;
      }
      this.pendingChunk = chunk;
      this.pump(gen);
    });
    child.stderr.on('data', (d) => {
      stderrTail = (stderrTail + d.toString()).slice(-2000);
    });
    child.on('error', (err) => {
      if (gen !== this.generation) return;
      this.fail(`启动 ffmpeg 失败: ${err.message}`);
    });
    child.on('close', (code) => {
      if (gen !== this.generation) return;
      if (code !== 0 && code !== null) {
        this.fail(`ffmpeg 解码失败 (exit ${code}): ${stderrTail.trim().split('\n').slice(-3).join(' | ')}`);
        return;
      }
      this.sourceEnded = true;
      this.checkEnded();
    });

    this.startProgressTimer();
    return this.state();
  }

  
  pump(gen) {
    if (gen !== this.generation || !this.output) return;
    const chunk = this.pendingChunk;
    if (!chunk) {
      if (this.child?.stdout) this.child.stdout.resume();
      return;
    }
    const bytesPerFrame = 4 * this.output.format.inputChannels;
    let accepted = 0;
    try {
      accepted = this.output.write(chunk);
    } catch (err) {
      this.fail(`写入音频引擎失败: ${err.message}`);
      return;
    }
    if (accepted * bytesPerFrame >= chunk.length) {
      this.framesWritten += accepted;
      this.pendingChunk = null;
      if (this.child?.stdout) this.child.stdout.resume();
      return;
    }
    this.framesWritten += accepted;
    this.pendingChunk = chunk.subarray(accepted * bytesPerFrame);
    setTimeout(() => this.pump(gen), 4);
  }

  startProgressTimer() {
    if (this.progressTimer) return;
    
    this.progressTimer = setInterval(() => this.tick(), 50);
  }

  tick() {
    if (!this.output) return;
    const stats = this.output.stats();
    if (stats.lastError && stats.lastError !== this.lastEngineError) {
      this.lastEngineError = stats.lastError;
      this.fail(`音频设备错误: ${stats.lastError}`);
      return;
    }
    this.underruns = stats.underrunEvents;
    const played = stats.framesRendered - this.baseFrames;
    const elapsed = played / (this.output.format.sampleRate || 48000);
    const position = Math.min(this.seekOffset + Math.max(0, elapsed),
                              this.duration > 0 ? this.duration : Number.MAX_SAFE_INTEGER);
    const rate = this.output.format.sampleRate || 48000;
    
    
    const playedFrames = stats.framesRendered - this.baseFrames;
    const silenceFrames = stats.framesSilence - (this.baseSilence || 0);
    const pending = Math.max(0, this.framesWritten - playedFrames - silenceFrames);
    const latencyMs = Math.min(2000, Math.round((pending / rate) * 1000));
    this.emit('progress', {
      position: Number.isFinite(position) ? position : 0,
      duration: this.duration,
      bufferedMs: Math.round((stats.bufferedFrames / rate) * 1000),
      latencyMs,
      underruns: stats.underrunEvents,
      status: this.status,
      peaks: Array.isArray(stats.peaks) ? stats.peaks : [],     
      
      
      writtenFrames: this.framesWritten,
      playedFrames,
      sampleRate: rate,
    });
    this.checkEnded();
  }

  checkEnded() {
    if (this.status !== 'playing') return;
    if (!this.sourceEnded) return;
    const stats = this.output.stats();
    const played = stats.framesRendered - this.baseFrames;
    if (played >= this.framesWritten - 64) {
      this.status = 'ended';
      this.stopSource();
      this.emitState();
      this.emit('ended', { trackId: this.track?.id ?? null });
    }
  }

  pause() {
    if (!this.output || this.status !== 'playing') return this.state();
    this.output.pause();
    if (this.child?.stdout) this.child.stdout.pause();
    this.status = 'paused';
    this.emitState();
    return this.state();
  }

  resume() {
    if (!this.output || this.status !== 'paused') return this.state();
    this.output.resume();
    if (this.child?.stdout) this.child.stdout.resume();
    this.status = 'playing';
    this.emitState();
    return this.state();
  }

  async seek(seconds, settings) {
    const target = Math.max(0, Math.min(seconds, this.duration || seconds));
    if (!this.track) return this.state();
    const wasPaused = this.status === 'paused';
    const st = await this.play(this.track, settings, { startSeconds: target });
    if (wasPaused) this.pause();
    return st;
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, Number(v)));
    if (this.output) this.output.setVolume(this.volume);
    this.emit('volume', this.volume);
    return this.volume;
  }

  
  stop() {
    this.stopSource();
    if (this.output) this.output.flush();
    this.track = null;
    this.status = 'idle';
    this.seekOffset = 0;
    this.duration = 0;
    this.framesWritten = 0;
    this.underruns = 0;
    this.lastError = null;
    this.sourceEnded = false;
    this.baseFrames = this.output ? this.output.stats().framesRendered : 0;
    this.emitState();
    return this.state();
  }

  
  release() {
    this.stopSource();
    this.closeEngine();
    this.status = 'idle';
    this.track = null;
    this.emitState();
  }

  stopSource() {
    if (this.progressTimer) {
      clearInterval(this.progressTimer);
      this.progressTimer = null;
    }
    this.sourceEnded = false;
    this.pendingChunk = null;
    const child = this.child;
    this.child = null;
    if (child && !child.killed) {
      try {
        if (child.stdout) child.stdout.removeAllListeners();
        child.removeAllListeners();
        child.kill('SIGKILL');
      } catch {  }
    }
    this.generation++;
  }

  fail(message) {
    this.lastError = message;
    this.status = 'error';
    this.stopSource();
    this.emitState();
    this.emit('error', { message });
  }

  dispose() {
    this.stopSource();
    this.closeEngine();
  }

  emitState() {
    this.emit('state', this.state());
  }

  state() {
    const stats = this.output ? this.output.stats() : null;
    const played = stats ? stats.framesRendered - this.baseFrames : 0;
    const rate = this.output?.format?.sampleRate || 48000;
    return {
      status: this.status,
      trackId: this.track?.id ?? null,
      trackPath: this.track?.path ?? null,
      position: this.duration
        ? Math.min(this.seekOffset + Math.max(0, played / rate), this.duration)
        : Math.max(0, this.seekOffset + played / rate),
      duration: this.duration,
      volume: this.volume,
      underruns: stats ? stats.underrunEvents : 0,
      bufferedMs: stats ? Math.round((stats.bufferedFrames / rate) * 1000) : 0,
      error: this.lastError,
      format: this.format(),
      deviceName: this.output ? this.output.deviceName : null,
      backend: this.output ? this.output.backend : null,
    };
  }
}

module.exports = { PlayerSession, BACKEND_ALIASES };
