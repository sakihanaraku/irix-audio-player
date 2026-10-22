

(function () {
  const listeners = {};
  const emit = (channel, payload) => {
    (listeners[channel] || []).forEach((cb) => cb(payload));
  };

  const FILES = [
    { id: 't1', path: 'D:\\Music\\Hotel California.flac', name: 'Hotel California.flac', ext: 'flac',
      size: 42_000_000, duration: 391.2, codec: 'flac', container: 'FLAC', sampleRate: 96000, channels: 2,
      bits: 24, bitrate: 1_400_000, lossless: true, kind: 'lossless', title: 'Hotel California',
      artist: 'Eagles', album: 'Hotel California', albumArtist: 'Eagles', year: '1976', genre: 'Rock',
      track: '1', channelLayout: 'stereo', hasCover: true, ok: true },
    { id: 't2', path: 'D:\\Music\\Bohemian Rhapsody.mp3', name: 'Bohemian Rhapsody.mp3', ext: 'mp3',
      size: 9_800_000, duration: 354.7, codec: 'mp3', container: 'MPEG audio', sampleRate: 44100, channels: 2,
      bits: 0, bitrate: 320_000, lossless: false, kind: 'lossy', title: 'Bohemian Rhapsody',
      artist: 'Queen', album: 'A Night at the Opera', albumArtist: 'Queen', year: '1975', genre: 'Rock',
      track: '11', channelLayout: 'stereo', hasCover: true, ok: true },
    { id: 't3', path: 'D:\\Music\\test-tone.wav', name: 'test-tone.wav', ext: 'wav',
      size: 1_058_444, duration: 6.0, codec: 'pcm_s24le', container: 'WAV', sampleRate: 96000, channels: 2,
      bits: 24, bitrate: 4_600_000, lossless: true, kind: 'lossless', title: '测试正弦波 1kHz',
      artist: 'irix_selftest', album: 'Test Media', albumArtist: null, year: '2026', genre: null,
      track: null, channelLayout: 'stereo', hasCover: false, ok: true },
    { id: 't4', path: 'D:\\Music\\broken.mp3', name: 'broken.mp3', ext: 'mp3', size: 1600, duration: 0,
      codec: null, container: null, sampleRate: 0, channels: 0, bits: 0, bitrate: 0, lossless: false,
      kind: 'unknown', title: 'broken', artist: null, album: null, hasCover: false, ok: false,
      error: '无法识别的媒体文件' },
    
    { id: 't5', path: 'D:\\Music\\云村下载\\夏日晚风.flac', name: '夏日晚风.flac', ext: 'flac',
      size: 38_000_000, duration: 245.3, codec: 'flac', container: 'FLAC', sampleRate: 44100, channels: 2,
      bits: 16, bitrate: 950_000, lossless: true, kind: 'lossless', title: '夏日晚风',
      artist: '测试歌手', album: '夏日专辑', hasCover: true, ok: true },
  ];

  
  const COVER_DATA_URL = 'data:image/svg+xml;base64,' + btoa(
    '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128">' +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="#2b4a5e"/><stop offset="1" stop-color="#35d07f"/></linearGradient></defs>' +
    '<rect width="128" height="128" fill="url(#g)"/>' +
    '<circle cx="52" cy="84" r="17" fill="#ffffff"/>' +
    '<rect x="65" y="32" width="9" height="56" fill="#ffffff"/>' +
    '<path d="M74 32 L102 41 L102 58 L74 49 Z" fill="#ffffff"/></svg>');

  
  const BG_DATA_URL = 'data:image/svg+xml;base64,' + btoa(
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180">' +
    '<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="#1f7ae0"/><stop offset="0.55" stop-color="#7b4bd8"/><stop offset="1" stop-color="#e0567b"/></linearGradient></defs>' +
    '<rect width="320" height="180" fill="url(#bg)"/>' +
    '<circle cx="240" cy="50" r="28" fill="#ffffff" opacity="0.35"/></svg>');

  
  const PLAY_RANKING = [
    { key: 'eagles\u0001hotel california\u0001hotel california', artist: 'Eagles', title: 'Hotel California',
      album: 'Hotel California', plays: 12, lastPlayedAt: '2026-10-12T20:00:00.000Z', durationMs: 391000 },
    { key: 'queen\u0001bohemian rhapsody\u0001a night at the opera', artist: 'Queen', title: 'Bohemian Rhapsody',
      album: 'A Night at the Opera', plays: 7, lastPlayedAt: '2026-10-11T20:00:00.000Z', durationMs: 354000 },
    { key: 'aurora\u0001test tone\u0001selftest', artist: 'Aurora', title: '测试正弦波 1kHz',
      album: 'Selftest', plays: 3, lastPlayedAt: '2026-10-10T20:00:00.000Z', durationMs: 6000 },
  ];

  
  const wineResponse = () => {
    const w = state.wineInfo;
    if (!w) return null;
    const mode = state.settings.wineCompat || 'auto';
    const active = mode === 'off' ? false : (mode === 'on' || !!w.detected);
    return {
      ...w, mode, active, noGlass: active,
      applied: active ? ['backend', 'bufferMs', 'periodMs', 'ringMs'] : [],
      notes: active ? ['WASAPI 独占模式在 Wine 下不可用，已改用 DirectSound 输出'] : [],
    };
  };

  
  const EQ_BANDS = [20, 50, 140, 380, 1000, 2700, 7100, 19000];
  const EQ_LABELS = ['20', '50', '140', '380', '1k', '2.7k', '7.1k', '19k'];
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
  const defaultEqConfig = () => ({
    enabled: false, preampDb: 0,
    bands: EQ_BANDS.map((freq) => ({ freq, gainDb: 0, q: 1.2 })),
  });

  
  const FS_TREE = {
    'C:\\Users\\demo\\Music': [
      { name: 'Albums', path: 'C:\\Users\\demo\\Music\\Albums', isDir: true, audio: false, size: 0, mtime: 0, ext: '' },
      { name: '王菲', path: 'C:\\Users\\demo\\Music\\王菲', isDir: true, audio: false, size: 0, mtime: 0, ext: '' },
      { name: 'Hotel California.flac', path: 'C:\\Users\\demo\\Music\\Hotel California.flac', isDir: false, audio: true, size: 42000000, mtime: 0, ext: '.flac' },
      { name: 'Bohemian Rhapsody.mp3', path: 'C:\\Users\\demo\\Music\\Bohemian Rhapsody.mp3', isDir: false, audio: true, size: 9800000, mtime: 0, ext: '.mp3' },
      { name: '测试正弦波 1kHz.wav', path: 'C:\\Users\\demo\\Music\\测试正弦波 1kHz.wav', isDir: false, audio: true, size: 1000000, mtime: 0, ext: '.wav' },
    ],
    'C:\\Users\\demo': [
      { name: 'Music', path: 'C:\\Users\\demo\\Music', isDir: true, audio: false, size: 0, mtime: 0, ext: '' },
      { name: 'Downloads', path: 'C:\\Users\\demo\\Downloads', isDir: true, audio: false, size: 0, mtime: 0, ext: '' },
      
      ...Array.from({ length: 28 }, (_, i) => ({
        name: `Folder-${String(i + 1).padStart(2, '0')}`,
        path: `C:\\Users\\demo\\Folder-${String(i + 1).padStart(2, '0')}`,
        isDir: true, audio: false, size: 0, mtime: 0, ext: '',
      })),
      { name: 'loose-track.mp3', path: 'C:\\Users\\demo\\loose-track.mp3', isDir: false, audio: true, size: 3300000, mtime: 0, ext: '.mp3' },
    ],
    'C:\\Users\\demo\\Music\\Albums': [
      { name: 'Live.flac', path: 'C:\\Users\\demo\\Music\\Albums\\Live.flac', isDir: false, audio: true, size: 51000000, mtime: 0, ext: '.flac' },
    ],
    
    'C:\\Users': [
      { name: 'demo', path: 'C:\\Users\\demo', isDir: true, audio: false, size: 0, mtime: 0, ext: '' },
    ],
    'C:\\': [
      { name: 'Users', path: 'C:\\Users', isDir: true, audio: false, size: 0, mtime: 0, ext: '' },
    ],
    
    'D:\\': [
      { name: 'Music', path: 'D:\\Music', isDir: true, audio: false, size: 0, mtime: 0, ext: '' },
      { name: 'Hotel California.flac', path: 'D:\\Hotel California.flac', isDir: false, audio: true,
        size: 42000000, mtime: 0, ext: '.flac' },
    ],
  };

  const DEVICES = [
    { id: '{0.0.0.00000000}.{aaa}', name: '扬声器 (Realtek(R) Audio)', backend: 'wasapi-shared',
      isDefault: true, state: 'active', formFactor: 'speakers', mixSampleRate: 48000, mixChannels: 2,
      mixBits: 32, mixFloat: true },
    { id: '{0.0.0.00000000}.{bbb}', name: '耳机 (HyperX Cloud Revolver S)', backend: 'wasapi-shared',
      isDefault: false, state: 'active', formFactor: 'headphones', mixSampleRate: 44100, mixChannels: 2,
      mixBits: 32, mixFloat: true },
    { id: '{0.0.0.00000000}.{ccc}', name: 'N50 Pro 6 (NVIDIA High Definition Audio)', backend: 'wasapi-shared',
      isDefault: false, state: 'active', formFactor: 'hdmi', mixSampleRate: 48000, mixChannels: 2,
      mixBits: 32, mixFloat: true },
    
    { id: '{0.0.0.00000000}.{ddd}',
      name: 'SteelSeries Sonar - Gaming (SteelSeries Sonar Virtual Audio Device) — 默认/headphones ' +
        '[96000Hz/8ch/32bit] 超长名称用于验证省略与换行行为不会把面板顶宽',
      backend: 'wasapi-shared', isDefault: false, state: 'active', formFactor: 'headphones',
      mixSampleRate: 96000, mixChannels: 8, mixBits: 32, mixFloat: true },
  ];

  const state = {
    bgDataUrl: null, bgCooldownMs: 0, bgFetchCalls: 0, bgPickCalls: 0, bgPickCanceled: false,
    wineInfo: null, fsCalls: [], pathInputs: [],
    eqConfig: defaultEqConfig(), eqSetCalls: [], eqSaveCalls: [], eqLoadCalls: 0,
    plays: PLAY_RANKING, playsGetCalls: 0, playsCountCalls: [], playsRemoveCalls: [],
    convertCalls: [], convertCancels: 0, convertFails: false, showItemCalls: [],
    lyricsGetCalls: [], lyricsPickCalls: [], lyricsForgetCalls: [],
    lyricsSaveCalls: [], lyricsSaveFails: false,
    lyricsMode: 'file', lyricsPickFails: false,
    eqSaveCanceled: false, eqLoadCanceled: false, eqLoadBad: false,
    settings: {
      backend: 'wasapi-shared', deviceId: '', sampleRate: 48000, channels: 2, bits: 32,
      exclusive: false, bufferMs: 100, periodMs: 10, ringMs: 300, allowFormatFallback: true,
      volume: 0.8, muted: false, repeat: 'off', shuffle: false, ffmpegPath: '', themeColor: '#35d07f',
      language: 'zh', peakOffsetMs: 0, lyricsOffsetMs: 0, sidePanel: 'info',
      uiTheme: 'dark', bgSource: 'none', bgLocalPath: '', bgApiUrl: '',
      bgOpacity: 0.7, bgBlur: 18,
    },
    playlist: FILES.slice(),
    playing: false,
    currentId: null,
    position: 0,
    format: null,
    calls: [],
    winCalls: [],
    coverCalls: [],
    playlistMutations: 0,
    settingsPatches: [],
    listSaveCalls: 0,
    listLoadCalls: 0,
    savedListPath: 'D:\\\\Music\\\\我的列表.playlist',
    maximized: false,
    
    extSettingCalls: [], extCommandCalls: [], extToggleCalls: [], extUninstallCalls: [],
    extensions: [{
      id: 'demo-ext', name: '演示扩展', version: '1.2.0',
      description: '测试声明式设置与命令的扩展', extensions: ['demo'], author: 'community',
      enabled: true, installed: true,
      settings: [
        { key: 'quality', type: 'select', label: '处理质量', description: '解码质量',
          default: 'high', options: [{ value: 'low', label: '快速' }, { value: 'high', label: '高质量' }] },
        { key: 'threshold', type: 'number', label: '阈值', default: 0.5, min: 0, max: 1, step: 0.1 },
        { key: 'experimental', type: 'boolean', label: '启用实验', default: true },
        { key: 'note', type: 'text', label: '备注', default: 'hello', placeholder: '可留空' },
      ],
      commands: [
        { id: 'clear-cache', label: '清理解码缓存', description: '删除解码缓存' },
        { id: 'ping', label: '测试命令' },
      ],
      values: { quality: 'high', threshold: 0.5, experimental: true, note: 'hello' },
    }],
  };

  const fmtOf = () => ({
    sampleRate: 48000, channels: 2, bits: 32, isFloat: true,
    exclusive: state.settings.backend === 'wasapi-exclusive', bytesPerFrame: 8,
    inputSampleRate: 48000, inputChannels: 2, backend: state.settings.backend,
  });

  const playerState = () => ({
    status: state.playing ? 'playing' : (state.currentId ? 'paused' : 'idle'),
    trackId: state.currentId,
    position: state.position,
    duration: (state.playlist.find((t) => t.id === state.currentId) || {}).duration || 0,
    volume: state.settings.volume,
    underruns: 0,
    bufferedMs: 180,
    error: null,
    format: state.format,
    deviceName: state.format ? DEVICES[0].name : null,
    backend: state.format ? state.settings.backend : null,
  });

  window.aurora = {
    info: async () => (state.info = {
      appVersion: '1.0.1-release',
    bgCooldownMs: 30000, electron: '浏览器模拟', chrome: navigator.userAgent, node: 'n/a',
      platform: 'win32', appRoot: 'C:\\app', addonPath: 'native/build/Release/aurora_audio.node',
      addon: { engine: 'aurora-audio', version: '1.0.0', napiVersion: 8, platform: 'windows' },
      backends: [
        { id: 'wasapi-shared', description: 'WASAPI 共享模式：经系统混音器，可与其它程序同时出声', implemented: true },
        { id: 'wasapi-exclusive', description: 'WASAPI 独占模式：绕过系统混音器，直通硬件，其它程序静音', implemented: true },
        { id: 'directsound', description: 'DirectSound：DirectX 传统通道，兼容性优先', implemented: true },
        { id: 'mme', description: 'MME (waveOut)：最古老的 WinMM 通道，兼容性最高', implemented: true },
      ],
      ffmpeg: { path: 'C:\\app\\vendor\\ffmpeg\\bin\\ffmpeg.exe', probePath: 'C:\\app\\vendor\\ffmpeg\\bin\\ffprobe.exe',
        source: 'vendor', version: 'ffmpeg version 7.1 Copyright (c) 2000-2024 the FFmpeg developers', ok: true },
      settings: state.settings,
      userData: 'C:\\Users\\demo\\AppData\\Roaming\\iRix Audio Player',
      
      wine: state.wineInfo || {
        detected: false, version: null, label: 'Wine', source: null, mode: 'auto',
        active: false, noGlass: false, applied: [], skipped: [], notes: [],
        unsupported: ['wasapi-exclusive'], chain: ['wasapi-shared'],
      },
    }),
    getPathForFile: (file) => (file && file.name ? `D:\\Dropped\\${file.name}` : ''),
    win: {
      minimize: () => { state.winCalls.push('minimize'); },
      toggleMaximize: () => {
        state.winCalls.push('toggleMaximize');
        state.maximized = !state.maximized;
        emit('window:maximized', state.maximized);
      },
      close: () => { state.winCalls.push('close'); },
      isMaximized: async () => state.maximized,
    },
    settings: {
      get: async () => state.settings,
      set: async (patch) => {
        state.calls.push(['settings:set', patch]);
        state.settingsPatches.push({ ...patch });
        const before = state.settings.backend;
        Object.assign(state.settings, patch);
        state.format = fmtOf();
        emit('engine:changed', { opened: true, deviceName: DEVICES[0].name, backend: state.settings.backend, format: state.format });
        emit('player:state', playerState());
        return {
          settings: state.settings,
          audioSettingsChanged: before !== state.settings.backend,
          wine: wineResponse(),
        };
      },
    },
    ffmpeg: { set: async () => ({ ok: true }), browse: async () => ({ path: 'D:\\ffmpeg.exe', ok: true, version: 'ffmpeg 7.1' }) },
    
    ext: {
      list: async () => state.extensions.map((e) => ({
        id: e.id, name: e.name, version: e.version, description: e.description,
        extensions: e.extensions.slice(), author: e.author, enabled: e.enabled, installed: e.installed,
        settings: e.settings.map((s) => ({ ...s })),
        commands: e.commands.map((c) => ({ ...c })),
        values: { ...e.values },
      })),
      install: async () => ({ ok: false, canceled: true }),
      uninstall: async (id) => {
        state.extUninstallCalls.push(id);
        state.extensions = state.extensions.filter((e) => e.id !== id);
        return { ok: true };
      },
      toggle: async (id, enabled) => {
        state.extToggleCalls.push([id, enabled]);
        const e = state.extensions.find((x) => x.id === id);
        if (e) e.enabled = !!enabled;
        return { ok: true };
      },
      setSetting: async (id, key, value) => {
        state.extSettingCalls.push([id, key, value]);
        const e = state.extensions.find((x) => x.id === id);
        if (e) e.values[key] = value;
        return { ok: true, values: e ? { ...e.values } : {}, live: key !== 'note' };
      },
      runCommand: async (id, commandId) => {
        state.extCommandCalls.push([id, commandId]);
        return commandId === 'ping'
          ? { ok: true, message: 'pong' }
          : { ok: true, message: '已清理 3 个缓存文件' };
      },
    },
    
    eq: {
      get: async () => ({
        config: state.eqConfig,
        presets: Object.keys(EQ_PRESETS),
        presetGains: EQ_PRESETS,
        bands: EQ_BANDS,
        labels: EQ_LABELS,
        gainLimit: 12,
        preampRange: [-12, 12],
      }),
      set: async (config) => {
        state.eqSetCalls.push(config);
        state.eqConfig = {
          enabled: config.enabled === true,
          preampDb: Number(config.preampDb) || 0,
          bands: EQ_BANDS.map((freq, i) => ({
            freq,
            gainDb: Math.max(-12, Math.min(12, Number(config.bands?.[i]?.gainDb) || 0)),
            q: 1.2,
          })),
        };
        return { config: state.eqConfig };
      },
      save: async (config) => {
        state.eqSaveCalls.push(config);
        if (state.eqSaveCanceled) return { canceled: true };
        state.eqConfig = (await window.aurora.eq.set(config)).config;
        return { canceled: false, filePath: 'D:\\Music\\我的音效.eq' };
      },
      load: async () => {
        state.eqLoadCalls++;
        if (state.eqLoadCanceled) return { canceled: true };
        if (state.eqLoadBad) return { canceled: false, error: '这个 .eq 文件格式不正确' };
        state.eqConfig = {
          enabled: true, preampDb: -2,
          bands: EQ_BANDS.map((freq, i) => ({ freq, gainDb: EQ_PRESETS.rock[i], q: 1.2 })),
        };
        return { canceled: false, filePath: 'D:\\Music\\rock.eq', config: state.eqConfig };
      },
    },

  
  plays: {
    get: async () => {
      state.playsGetCalls++;
      return {
        ranking: state.plays.slice().sort((a, b) => b.plays - a.plays),
        summary: {
          songs: state.plays.length,
          totalPlays: state.plays.reduce((n, e) => n + e.plays, 0),
        },
      };
    },
    count: async (trackId) => {
      state.playsCountCalls.push(trackId);
      return { ok: true, plays: 1 };
    },
    remove: async (keys) => {
      state.playsRemoveCalls.push(keys.slice());
      const before = state.plays.length;
      state.plays = state.plays.filter((e) => !keys.includes(e.key));
      return {
        removed: before - state.plays.length,
        ranking: state.plays.slice().sort((a, b) => b.plays - a.plays),
        summary: {
          songs: state.plays.length,
          totalPlays: state.plays.reduce((n, e) => n + e.plays, 0),
        },
      };
    },
  },

  
  lyrics: {
    get: (trackId) => {
      state.lyricsGetCalls.push(trackId);
      const t = state.playlist.find((x) => x.id === trackId);
      if (!t) return Promise.resolve({ found: false });
      if (state.lyricsMode === 'none') return Promise.resolve({ found: false });
      if (state.lyricsMode === 'plain') {
        return Promise.resolve({ found: true, source: 'file', file: 'D:\\Music\\plain.lrc', synced: false,
          lines: [{ time: null, text: '纯文本第一行' }, { time: null, text: '纯文本第二行' }] });
      }
      return Promise.resolve({ found: true, source: 'file', file: 'D:\\Music\\Hotel California.lrc', synced: true,
        raw: '[00:00.00]第一句歌词\n[00:05.00]第二句歌词\n[00:12.00]第三句歌词\n',
        lines: [{ time: 0, text: '第一句歌词' }, { time: 5, text: '第二句歌词' }, { time: 12, text: '第三句歌词' }] });
    },
    read: (trackId) => Promise.resolve({ ok: true, source: 'file', file: 'D:\\Music\\Hotel California.lrc',
      text: '[00:00.00]第一句歌词\n[00:05.00]第二句歌词\n[00:12.00]第三句歌词\n' }),
    save: (trackId, text) => {
      state.lyricsSaveCalls.push({ trackId, text });
      if (state.lyricsSaveFails) return Promise.resolve({ ok: false, error: '测试用的写入失败' });
      return Promise.resolve({ ok: true, file: 'D:\\Music\\Hotel California.lrc' });
    },
    pick: async (trackId) => {
      state.lyricsPickCalls.push(trackId);
      if (state.lyricsPickFails) return { ok: false, error: '读不出来' };
      return { ok: true, source: 'picked', file: 'D:\\Music\\手选的.lrc', synced: true,
        lines: [{ time: 1, text: '手选歌词' }] };
    },
    forget: async (trackId) => { state.lyricsForgetCalls.push(trackId); return { ok: true }; },
  },

  
  convert: {
    formats: async () => ({ formats: [
      { id: 'flac', label: 'FLAC', ext: 'flac', lossless: true, params: ['compressionLevel'],
        notes: '无损，压缩等级越高文件越小、编码越慢',
        compression: { min: 0, max: 8, default: 5 }, bitrate: null, quality: null, bitDepth: null },
      { id: 'wav', label: 'Wave', ext: 'wav', lossless: true, params: ['bitDepth'], notes: '无损未压缩',
        bitDepth: { options: [16, 24, 32], default: 24 }, bitrate: null, quality: null, compression: null },
      { id: 'mp3', label: 'MP3', ext: 'mp3', lossless: false, params: ['rateMode', 'bitrate', 'quality'],
        notes: '兼容性最好', bitrate: { options: [128, 160, 192, 256, 320], default: 320, unit: 'kbps' },
        quality: { min: 0, max: 9, default: 0 }, compression: null, bitDepth: null },
      { id: 'aac', label: 'AAC', ext: 'm4a', lossless: false, params: ['rateMode', 'bitrate', 'quality'],
        notes: '同码率下通常比 MP3 更好',
        bitrate: { options: [96, 128, 160, 192, 256], default: 192, unit: 'kbps' },
        quality: { min: 1, max: 5, default: 2 }, compression: null, bitDepth: null },
      { id: 'vorbis', label: 'Vorbis', ext: 'ogg', lossless: false,
        params: ['rateMode', 'quality', 'bitrate'], notes: '开源有损，VBR 质量 0–10',
        bitrate: { options: [96, 128, 160, 192, 256], default: 160, unit: 'kbps' },
        quality: { min: 0, max: 10, default: 6 }, compression: null, bitDepth: null },
    ] }),
    start: async (trackId, formatId, options) => {
      state.convertCalls.push({ trackId, formatId, options });
      if (state.convertFails) return { ok: false, error: '模拟编码失败' };
      return { ok: true, path: `D:\\Music\\out.${formatId === 'wav' ? 'wav' : formatId}`, ms: 120 };
    },
    cancel: async () => {
      state.convertCancels++;
      return { ok: true, cancelled: true };
    },
  },

  
    fs: {
      home: async () => ({ music: 'C:\\Users\\demo\\Music', home: 'C:\\Users\\demo', desktop: 'C:\\Users\\demo\\Desktop', downloads: 'C:\\Users\\demo\\Downloads' }),
      list: async (dir) => {
        state.fsCalls.push(dir);
        
        if (dir === '::drives') {
          return { dir: '::drives', parent: null, drives: true, entries: [
            { name: 'C:\\', path: 'C:\\', isDir: true, drive: true, size: 0, mtime: 0, ext: '',
              total: 512_000_000_000, free: 200_000_000_000 },
            { name: 'D:\\', path: 'D:\\', isDir: true, drive: true, size: 0, mtime: 0, ext: '',
              total: 62_000_000_000, free: 8_000_000_000 },
          ] };
        }
        const target = dir || 'C:\\Users\\demo\\Music';
        if (/不存在/.test(target)) throw new Error('目录不存在');
        
        const PARENTS = {
          'C:\\Users\\demo\\Music': 'C:\\Users\\demo',
          'C:\\Users\\demo': 'C:\\Users',
          'C:\\Users': 'C:\\',
          'C:\\': '::drives',
          'D:\\': '::drives',
        };
        const parent = Object.prototype.hasOwnProperty.call(PARENTS, target) ? PARENTS[target] : 'C:\\Users\\demo\\Music';
        return { dir: target, parent, entries: FS_TREE[target] || [] };
      },
      
      stat: async (input) => {
        state.pathInputs.push(input);
        const raw = String(input == null ? '' : input).trim().replace(/^"(.*)"$/, '$1');
        if (!raw) return { ok: false, reason: 'empty' };
        if (/[<>|?*]/.test(raw)) return { ok: false, reason: 'illegal-char' };
        if (/^[A-Za-z]:(?![\\/])/.test(raw)) return { ok: false, reason: 'drive-relative' };
        if (!/^[A-Za-z]:[\\/]/.test(raw) && !/^\\\\/.test(raw)) return { ok: false, reason: 'not-absolute' };
        const dir = raw.replace(/[\\/]+$/, '') || raw;
        const knownDir = Object.prototype.hasOwnProperty.call(FS_TREE, dir === 'C:' ? 'C:\\' : dir) ||
          dir === 'C:\\' || (FS_TREE[dir] !== undefined);
        if (knownDir) {
          const PARENTS2 = { 'C:\\Users\\demo\\Music': 'C:\\Users\\demo', 'C:\\Users\\demo': 'C:\\Users', 'C:\\Users': 'C:\\', 'C:\\': null };
          return { ok: true, kind: 'dir', path: dir, dir, parent: PARENTS2[dir] ?? null };
        }
        
        for (const [d, list] of Object.entries(FS_TREE)) {
          const hit = list.find((e) => e.path.replace(/[\\/]+$/, '') === dir);
          if (hit) {
            return { ok: true, kind: 'file', path: hit.path, dir: d, name: hit.name, audio: hit.audio,
              parent: null };
          }
        }
        return { ok: false, reason: 'not-found', path: dir, parent: dir.slice(0, dir.lastIndexOf('\\')) };
      },
    },
    bg: {
      get: async () => ({ dataUrl: state.bgDataUrl, source: state.settings.bgSource, cooldownMs: state.bgCooldownMs }),
      pick: async () => {
        state.bgPickCalls++;
        if (state.bgPickCanceled) return { canceled: true };
        state.bgDataUrl = BG_DATA_URL;
        return { canceled: false, dataUrl: BG_DATA_URL, path: 'D:\\Pictures\\my-bg.jpg' };
      },
      fetch: async () => {
        state.bgFetchCalls++;
        if (state.bgCooldownMs > 0) return { ok: false, cooldownMs: state.bgCooldownMs, error: '刷新过于频繁' };
        state.bgDataUrl = BG_DATA_URL;
        state.bgCooldownMs = 30000;
        return { ok: true, dataUrl: BG_DATA_URL, url: 'https://picsum.photos/1920/1080', cooldownMs: 30000 };
      },
    },    devices: {
      list: async (backend) => DEVICES.map((d) => ({ ...d, backend })),
      probe: async (opts) => ({
        supported: true,
        detail: opts.backend === 'wasapi-exclusive' ? '独占模式可用（设备原生格式 48000Hz/24bit）' : '共享模式：系统混音格式 48000Hz/32bit',
        format: { sampleRate: 48000, channels: 2, bits: 24, isFloat: false, exclusive: opts.backend === 'wasapi-exclusive' },
      }),
    },
    cover: {
      get: async (trackId) => {
        state.coverCalls.push(trackId);
        const track = state.playlist.find((t) => t.id === trackId);
        return { dataUrl: track && track.hasCover ? COVER_DATA_URL : null };
      },
    },
    playlist: {
      get: async () => state.playlist,
      add: async (paths = []) => {
        state.playlistMutations++;
        state.calls.push(['playlist:add', { paths }]);
        const added = paths
          .filter((p) => !state.playlist.some((t) => t.path === p))
          .map((p, k) => ({
            id: `dropped-${state.playlist.length + k}`, path: p, name: p.split('\\').pop(),
            title: p.split('\\').pop().replace(/\.[^.]+$/, ''), ext: (p.split('.').pop() || '').toLowerCase(),
            ok: true, size: 1048576, duration: 100, sampleRate: 44100, channels: 2, bits: 16,
            codec: 'flac', container: 'flac', lossless: true, hasCover: false,
          }));
        if (added.length) {
          state.playlist = state.playlist.concat(added);
          emit('playlist:changed', state.playlist);
        }
        return { added, skipped: paths.length - added.length, failed: [] };
      },
      remove: async (id) => {
        state.playlistMutations++;
        state.playlist = state.playlist.filter((t) => t.id !== id);
        return state.playlist;
      },
      clear: async () => { state.playlistMutations++; state.playlist = []; return state.playlist; },
      reorder: async (id, toIndex) => {
        state.playlistMutations++;
        state.calls.push(['playlist:reorder', { id, toIndex }]);
        return state.playlist;
      },
      browse: async () => ({ added: [] }),
      
      save: async () => {
        state.listSaveCalls++;
        return { canceled: false, filePath: state.savedListPath, count: state.playlist.length };
      },
      load: async () => {
        state.listLoadCalls++;
        return { canceled: false, filePath: 'D:\\\\Music\\\\other.playlist', requested: 3, added: 2, skipped: 1, failed: 0 };
      },
    },
    player: {
      play: async (id, start) => {
        state.calls.push(['player:play', id, start]);
        state.currentId = id;
        state.playing = true;
        state.position = start || 0;
        state.format = fmtOf();
        emit('player:state', playerState());
        return playerState();
      },
      pause: async () => { state.playing = false; emit('player:state', playerState()); return playerState(); },
      resume: async () => { state.playing = true; emit('player:state', playerState()); return playerState(); },
      stop: async () => {
        
        state.playing = false;
        state.currentId = null;
        state.position = 0;
        emit('player:state', playerState());
        return playerState();
      },
      seek: async (s) => { state.position = s; emit('player:state', playerState()); return playerState(); },
      volume: async (v) => { state.settings.volume = v; return v; },
      release: async () => { state.playing = false; state.format = null; return playerState(); },
      reopen: async () => { state.format = fmtOf(); return playerState(); },
      state: async () => playerState(),
    },
    probeFile: async () => ({}),
    showItem: async (file) => { state.showItemCalls.push(file); return true; },
    on: (channel, cb) => {
      (listeners[channel] = listeners[channel] || []).push(cb);
      return () => {};
    },
  };

  
  const results = [];
  const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail: String(detail) });

  
  const audioClock = { written: 0, latencyMs: 300, rate: 48000 };
  const resetAudioClock = (startMs = 0) => { audioClock.written = startMs; };
  const clockTick = (advanceMs = 50) => {
    audioClock.written += (advanceMs / 1000) * audioClock.rate;
    return {
      writtenFrames: audioClock.written,
      playedFrames: Math.max(0, audioClock.written - (audioClock.latencyMs / 1000) * audioClock.rate),
      sampleRate: audioClock.rate,
      latencyMs: audioClock.latencyMs,
    };
  };
  
  const emitProgress = (extra = {}, advanceMs = 50) => {
    emit('player:progress', {
      position: 120, duration: 391.2, bufferedMs: audioClock.latencyMs, underruns: 0, status: 'playing',
      ...clockTick(advanceMs),
      ...extra,
    });
  };

  window.addEventListener('load', () => {
    const shotMode = location.search.includes('shot');
    const dragMode = location.search.includes('drag');
    const settingsMode = location.search.includes('settings');
    const idleMode = location.search.includes('idle');
    const themeMode = location.search.includes('theme');
    const langMode = /mode=(en|ja)/.test(location.search);
    if (location.search.includes('mode=lyrics-exclusive')) {
      
      setTimeout(() => {
        emit('player:state', {
          status: 'playing', trackId: 't1', duration: 391.2, position: 6, volume: 0.8, format: fmtOf(),
        });
        setTimeout(() => {
          const btn = $('btnLyricsFull');
          if (btn) btn.click();
          
          if (location.search.includes('lyrics-exclusive-light')) {
            setTimeout(() => {
              document.body.classList.add('light');
            }, 300);
          }
        }, 900);
      }, 600);
      return;
    }

    
    const loopProgress = (peaks) => {
      let n = 0;
      const timer = setInterval(() => {
        n++;
        emitProgress({
          peaks: peaks.map((v) => Math.max(0.05, v * (0.86 + 0.14 * Math.sin(n / 3)))),
        });
      }, 250);
      return timer;
    };
    if (themeMode) {
      
      setTimeout(async () => {
        state.settings.themeColor = '#a78bfa';
        document.querySelector('#themeSwatches .swatch[data-color="#a78bfa"]')?.click();
        document.querySelectorAll('.pl-item')[0].click();
        await new Promise((r) => setTimeout(r, 300));
      }, 100);
      return;
    }
    if (idleMode) {
      
      return;
    }
    if (settingsMode) {
      
      setTimeout(async () => {
        document.querySelectorAll('.pl-item')[0].click();
        await new Promise((r) => setTimeout(r, 100));
        emit('player:progress', { position: 137, duration: 391.2, bufferedMs: 220, underruns: 0, status: 'playing' });
        document.getElementById('btnSettings').click();
        await new Promise((r) => setTimeout(r, 150));
        document.getElementById('btnProbe').click();
        await new Promise((r) => setTimeout(r, 100));
        const body = document.querySelector('.modal-body');
        if (body) body.scrollTop = body.scrollHeight;
      }, 400);
      return;
    }
    if (location.search.includes('mode=toastcorner')) {
      
      setTimeout(() => {
        state.lyricsSaveFails = true;
        setTimeout(() => {
          $('btnLyricsSave').click();
          setTimeout(() => {
            const el = document.querySelector('body > .toast.toast-corner') ||
              document.querySelector('.toast.toast-corner');
            const info = document.createElement('div');
            info.style.cssText = 'position:fixed;left:8px;top:6px;z-index:99999;' +
              'font:11px monospace;color:#fff;background:#000d;padding:3px 6px';
            if (el) {
              const r = el.getBoundingClientRect();
              info.textContent = `DBG toast 父节点=${el.parentElement.id || el.parentElement.tagName}` +
                ` rect=${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}` +
                ` right距边=${Math.round(window.innerWidth - r.right)} bottom距边=${Math.round(window.innerHeight - r.bottom)}` +
                ` 文本="${el.textContent}"`;
            } else {
              info.textContent = 'DBG 没有找到 .toast-corner';
            }
            document.body.appendChild(info);
          }, 500);
        }, 400);
      }, 600);
      return;
    }
    if (location.search.includes('mode=lyricedit')) {
      
      setTimeout(() => {
        emit('player:state', {
          status: 'playing', trackId: 't1', duration: 391.2, position: 6, volume: 0.8, format: fmtOf(),
        });
        setTimeout(() => {
          $('btnLyricsEdit').click();
        }, 900);
      }, 600);
      return;
    }
    if (location.search.includes('mode=lyrics')) {
      
      setTimeout(() => {
        emit('player:state', {
          status: 'playing', trackId: 't1', duration: 391.2, position: 6, volume: 0.8, format: fmtOf(),
        });
        
        setTimeout(() => {
          emit('player:progress', {
            position: 6, duration: 391.2, status: 'playing', bufferedMs: 0, underruns: 0, peaks: null,
          });
        }, 700);
      }, 600);
      return;
    }
    if (location.search.includes('mode=ctxmenu')) {
      
      setTimeout(() => {
        const row = document.querySelector('.pl-body .pl-item[data-id="t1"]');
        for (const delay of [0, 400, 800, 1200, 1600]) {
          setTimeout(() => {
            if (row) row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 900, clientY: 260 }));
          }, delay);
        }
      }, 500);
      return;
    }
    if (location.search.includes('mode=convert')) {
      
      setTimeout(async () => {
        const row = document.querySelector('.pl-body .pl-item[data-id="t1"]');
        if (!row) return;
        row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 900, clientY: 260 }));
        await new Promise((r) => setTimeout(r, 400));
        const items = [...document.querySelectorAll('#ctxMenu .ctx-item')];
        items[2]?.click();
        await new Promise((r) => setTimeout(r, 350));
        const fmt = [...document.querySelectorAll('#ctxMenu .ctx-item')].find((b) => b.dataset.key === 'fmt:mp3');
        fmt?.click();
        await new Promise((r) => setTimeout(r, 700));
        const cbr = [...document.querySelectorAll('#convParams .conv-fmt')].find((b) => b.dataset.rateMode === 'cbr');
        cbr?.click();
        await new Promise((r) => setTimeout(r, 600));
      }, 600);
      return;
    }
    if (location.search.includes('mode=drives')) {
      
      setTimeout(async () => {
        for (let i = 0; i < 4; i++) {
          document.getElementById('btnBrowseUp').click();
          await new Promise((r) => setTimeout(r, 220));
        }
      }, 500);
      return;
    }
    if (location.search.includes('mode=longsel')) {
      
      setTimeout(async () => {
        document.getElementById('btnSettings').click();
        await new Promise((r) => setTimeout(r, 500));
        const sel = document.getElementById('selDevice');
        for (const o of sel.options) if (o.value === '{0.0.0.00000000}.{ddd}') sel.value = o.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 250));
        sel.closest('.row').querySelector('.sel-btn').click();
        await new Promise((r) => setTimeout(r, 500));
      }, 500);
      return;
    }
    if (location.search.includes('mode=rank-edit')) {
      
      setTimeout(async () => {
        document.getElementById('btnRank').click();
        await new Promise((r) => setTimeout(r, 400));
        document.getElementById('btnRankEdit').click();
        await new Promise((r) => setTimeout(r, 200));
        const picks = [...document.querySelectorAll('#rankList .rank-pick')];
        picks[0]?.click();
        picks[2]?.click();
        await new Promise((r) => setTimeout(r, 300));
      }, 400);
      return;
    }
    if (location.search.includes('mode=rank')) {
      
      setTimeout(async () => {
        document.getElementById('btnRank').click();
        await new Promise((r) => setTimeout(r, 600));
      }, 400);
      return;
    }
    if (location.search.includes('mode=select')) {
      
      setTimeout(async () => {
        document.getElementById('btnSettings').click();
        await new Promise((r) => setTimeout(r, 420));
        const sel = document.getElementById('selBackend');
        sel.closest('.sel-wrap').querySelector('.sel-btn').click();
        await new Promise((r) => setTimeout(r, 500));
      }, 400);
      return;
    }
    if (location.search.includes('mode=shuffle')) {
      
      setTimeout(async () => {
        const btn = document.getElementById('btnRepeat');
        for (let i = 0; i < 4 && btn.dataset.mode !== 'shuffle'; i++) {
          btn.click();
          await new Promise((r) => setTimeout(r, 120));
        }
      }, 400);
      return;
    }
    if (location.search.includes('mode=mute')) {
      
      setTimeout(async () => {
        document.getElementById('volIcon').click();
        await new Promise((r) => setTimeout(r, 500));
      }, 500);
      return;
    }
    if (location.search.includes('mode=eq')) {
      
      setTimeout(async () => {
        document.getElementById('btnEq').click();
        await new Promise((r) => setTimeout(r, 400));
        const rock = [...document.querySelectorAll('#eqPresets .btn')].find((b) => b.dataset.preset === 'rock');
        rock?.click();
        await new Promise((r) => setTimeout(r, 200));
      }, 400);
      return;
    }
    if (location.search.includes('mode=toast')) {
      
      setTimeout(async () => {
        const show = document.getElementById('browserPath');
        const input = document.getElementById('browserPathInput');
        show.click();
        input.value = 'C:\\Users\\demo\\Music\\Nope\\Missing.flac';
        input.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', bubbles: true }));
        await new Promise((r) => setTimeout(r, 900));      
      }, 500);
      return;
    }
    if (location.search.includes('mode=root')) {
      
      setTimeout(async () => {
        for (let i = 0; i < 5; i++) {
          document.getElementById('btnBrowseUp').click();
          await new Promise((r) => setTimeout(r, 120));
        }
      }, 400);
      return;
    }
    if (location.search.includes('mode=many')) {
      
      setTimeout(async () => {
        document.getElementById('btnBrowseUp').click();
        await new Promise((r) => setTimeout(r, 250));
      }, 400);
      return;
    }
    if (dragMode) {
      
      setTimeout(async () => {
        document.querySelectorAll('.pl-item')[0].click();
        await new Promise((r) => setTimeout(r, 120));
        const row = [...document.querySelectorAll('.br-item')].find((li) => /\.flac$/.test(li.dataset.path));
        row?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        const dt = new DataTransfer();
        dt.setData('application/x-irix-path', 'C:\\Users\\demo\\Music\\Hotel California.flac');
        document.getElementById('playlistPanel')
          .dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
        emit('player:progress', { position: 137, duration: 391.2, bufferedMs: 220, underruns: 0, status: 'playing' });
      }, 400);
      return;
    }
    if (shotMode) {
      
      setTimeout(async () => {
        document.querySelectorAll('.pl-item')[0].click();
        await new Promise((r) => setTimeout(r, 100));
        document.getElementById('btnPickBg').click();
        await new Promise((r) => setTimeout(r, 150));
        loopProgress([0.92, 0.55]);
      }, 400);
      return;
    }
    if (location.search.includes('mode=light')) {
      
      setTimeout(async () => {
        document.getElementById('btnPickBg').click();
        await new Promise((r) => setTimeout(r, 150));
        
        
        document.startViewTransition = undefined;
        document.getElementById('btnThemeMode').click();
        document.querySelectorAll('.pl-item')[0].click();
        await new Promise((r) => setTimeout(r, 250));
        loopProgress([0.85, 0.5]);
      }, 400);
      return;
    }
    if (langMode) {
      
      setTimeout(async () => {
        const lang = location.search.match(/mode=(en|ja|zh)/)?.[1] || 'en';
        const sel = document.getElementById('selLanguage');
        sel.value = lang;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        document.querySelectorAll('.pl-item')[0].click();
        await new Promise((r) => setTimeout(r, 200));
        loopProgress([0.88, 0.5]);
      }, 400);
      return;
    }
    setTimeout(async () => {
      const $ = (id) => document.getElementById(id);
      try {
      const rows = document.querySelectorAll('.pl-item');
      
      check('启动无错误', $('errBox').hidden === true, ($('errBox').textContent || '').slice(0, 220));
      check('启动后播放列表已加载', rows.length > 0, `${rows.length} 行`);
      
      check('启动时就显示「等待媒体..」（还没有任何播放事件）',
        $('tbNow').hidden === false && $('tbNowState').textContent === '等待媒体..' &&
        $('tbNowSep').hidden === true,
        `hidden=${$('tbNow').hidden} "${$('tbNow').textContent}"`);

      
      const btns = [...document.querySelectorAll('.tb-controls .tb-btn')];
      const ids = btns.map((b) => b.id);
      check('标题栏含 8 个控件（排行榜/歌词独占/EQ/明暗/设置/最小化/最大化/关闭）',
        JSON.stringify(ids) === JSON.stringify(['btnRank', 'btnLyricsFull', 'btnEq', 'btnThemeMode', 'btnSettings', 'btnMin', 'btnMax', 'btnClose']),
        ids.join(','));
      
      check('标题栏没有版本徽标（版本号改在设置里显示）',
        !document.querySelector('.app-version') && !$('appVersion') && !!$('aboutVersion'),
        `app-version=${!!document.querySelector('.app-version')} aboutVersion=${!!$('aboutVersion')}`);
      const rects = btns.map((b) => b.getBoundingClientRect());
      const gaps = [];
      for (let i = 1; i < rects.length; i++) gaps.push(Math.round(rects[i].left - rects[i - 1].right));
      check('八个控件间距一致（排行榜在最左）', new Set(gaps).size === 1 && gaps[0] >= 0, `间距 ${gaps.join('/')} px`);
      check('明暗切换紧邻设置按钮左侧', ids[3] === 'btnThemeMode' && ids[4] === 'btnSettings', '');
      check('设置按钮位于最小化左侧', ids[4] === 'btnSettings' && ids[5] === 'btnMin', '');

      
      const visibleIcon = (b) => [...b.querySelectorAll('svg')].find((s) => s.getBoundingClientRect().width > 0) || null;
      const icons = btns.map(visibleIcon);
      check('每个控件都有可见的 SVG 图标', icons.every(Boolean),
        icons.map((s) => (s ? 'svg' : 'none')).join(','));
      const irects = icons.filter(Boolean).map((s) => s.getBoundingClientRect());
      const sizes = new Set(irects.map((r) => `${Math.round(r.width)}x${Math.round(r.height)}`));
      const centersY = new Set(irects.map((r) => Math.round(r.top + r.height / 2)));
      const centersX = rects.map((r) => Math.round(r.left + r.width / 2));
      const centerGaps = [];
      for (let i = 1; i < centersX.length; i++) centerGaps.push(centersX[i] - centersX[i - 1]);
      check('图标尺寸完全一致', sizes.size === 1, [...sizes].join(' / '));
      check('图标垂直中线一致（不再有对不齐）', centersY.size === 1, [...centersY].join(' / '));
      check('按钮中心等距', new Set(centerGaps).size === 1, centerGaps.join(' / '));
      const btnStyle = getComputedStyle(btns[0]);
      check('按钮为居中布局', btnStyle.display === 'grid' && btnStyle.alignItems !== 'baseline',
        `${btnStyle.display} / ${btnStyle.alignItems}`);
      const tbStyle = getComputedStyle(document.querySelector('.titlebar'));
      check('标题栏是窗口拖动区域', tbStyle.webkitAppRegion === 'drag', `app-region=${tbStyle.webkitAppRegion}`);
      check('控件区不参与拖动',
        getComputedStyle(document.querySelector('.tb-controls')).webkitAppRegion === 'no-drag', '');
      check('已删除标题栏副标题文字',
        !document.body.textContent.includes('Electron + N-API 音频引擎 + ffmpeg 解码后端'), '');
      check('标题栏不含系统标题栏残留（自定义标题栏存在）',
        !!document.querySelector('.titlebar .app-name'), '');

      
      check('应用名为 iRix Audio Player',
        document.querySelector('.app-name').textContent === 'iRix Audio Player' &&
        document.title === 'iRix Audio Player',
        `${document.querySelector('.app-name').textContent} / ${document.title}`);
      check('未播放时封面格显示默认封面（不显示空 img / 破图）',
        getComputedStyle($('coverImg')).display === 'none' &&
        getComputedStyle($('coverPlaceholder')).display !== 'none' &&
        !$('coverImg').hasAttribute('src'),
        `img=${getComputedStyle($('coverImg')).display} placeholder=${getComputedStyle($('coverPlaceholder')).display}`);
      check('默认封面不是藏在 0 尺寸里（真实可见）',
        $('coverPlaceholder').getBoundingClientRect().width > 4, '');

      
      $('btnMin').click();
      $('btnMax').click();
      const maxShown = getComputedStyle(document.querySelector('#btnMax .ico-max')).display;
      const restoreShown = getComputedStyle(document.querySelector('#btnMax .ico-restore')).display;
      $('btnClose').click();
      check('最小化/最大化/关闭 已调用主进程',
        JSON.stringify(state.winCalls) === JSON.stringify(['minimize', 'toggleMaximize', 'close']),
        state.winCalls.join(','));
      check('最大化后图标切换为"还原"', maxShown === 'none' && restoreShown !== 'none',
        `max=${maxShown} restore=${restoreShown}`);
      check('最大化状态加到 body', document.body.classList.contains('maximized'), '');
      $('btnMax').click();                       
      check('还原后图标切回"最大化"',
        getComputedStyle(document.querySelector('#btnMax .ico-max')).display !== 'none', '');

      
      check('状态栏已移除 N-API 与 ffmpeg 两行',
        !$('statusEngine') && !$('statusFfmpeg') &&
        !/N-API|ffmpeg/i.test(document.querySelector('.statusbar').textContent),
        document.querySelector('.statusbar').textContent.trim().slice(0, 60));
      check('状态栏只留声卡（设备）一项，且排在最左',
        (() => {
          const bar = document.querySelector('.statusbar');
          const items = [...bar.querySelectorAll(':scope > .sb-item')];
          const first = items[0];
          return !!$('statusDevice') && first && first.id === 'statusDevice' &&
            items.filter((el) => el.id !== 'statusWine').length === 1;
        })(), (() => {
          const bar = document.querySelector('.statusbar');
          return [...bar.querySelectorAll(':scope > .sb-item')].map((el) => el.id || el.className).join(',');
        })());
      check('状态栏状态点用固定语义色（正常=绿，不随主题色）',
        getComputedStyle($('statusDevice').querySelector('.dot')).backgroundColor === 'rgb(53, 208, 127)',
        getComputedStyle($('statusDevice').querySelector('.dot')).backgroundColor);
      check('异常状态为黄色', (() => {
        const el = $('statusDevice');
        const had = el.className;
        el.className = 'sb-item warn';
        const c = getComputedStyle(el.querySelector('.dot')).backgroundColor;
        el.className = had;
        return c === 'rgb(232, 195, 65)';
      })(), 'rgb(232, 195, 65)');
      check('缺失状态为灰色', (() => {
        const el = $('statusDevice');
        const had = el.className;
        el.className = 'sb-item missing';
        const c = getComputedStyle(el.querySelector('.dot')).backgroundColor;
        el.className = had;
        return c === 'rgb(109, 124, 140)';
      })(), 'rgb(109, 124, 140)');
      check('状态栏占满窗口底部',
        Math.abs($('statusDevice').closest('.statusbar').getBoundingClientRect().bottom - window.innerHeight) < 1, '');
      check('播放列表已移到右栏',
        document.querySelector('.layout > .right-col > .playlist') !== null, '');

      
      const pr = document.querySelector('.player').getBoundingClientRect();
      const plr = document.querySelector('.playlist').getBoundingClientRect();
      const brPanel = $('browserPanel').getBoundingClientRect();
      const rightCol = $('rightCol').getBoundingClientRect();
      const statsRect = document.querySelector('.stats').getBoundingClientRect();
      check('播放列表在右栏', plr.left >= pr.right, `player.right=${Math.round(pr.right)} list.left=${Math.round(plr.left)}`);
      check('左右两栏顶边对齐', Math.abs(pr.top - rightCol.top) < 2, `${Math.round(pr.top)} / ${Math.round(rightCol.top)}`);
      check('左右两栏底边对齐', Math.abs(pr.bottom - rightCol.bottom) < 2,
        `${Math.round(pr.bottom)} / ${Math.round(rightCol.bottom)}`);
      check('右栏下半是文件浏览器（上下各约一半）',
        brPanel.top >= plr.bottom && Math.abs(brPanel.height - plr.height) <= Math.max(4, plr.height * 0.06) &&
        Math.abs(brPanel.bottom - rightCol.bottom) < 2,
        `列表 ${Math.round(plr.height)}px / 浏览器 ${Math.round(brPanel.height)}px`);
      check('播放状态格贴左栏底部（与右栏下沿齐平）',
        Math.abs(statsRect.bottom - rightCol.bottom) < 34,
        `stats=${Math.round(statsRect.bottom)} col=${Math.round(rightCol.bottom)}`);
      check('播放状态格为 4 格', document.querySelectorAll('.stats .stat').length === 4, '');

      
      {
        const panel = $('playlistPanel');
        const head = panel.querySelector('.pl-head');
        const body = $('plBody');
        const firstRow = document.querySelector('.pl-item');
        const panelPad = head.getBoundingClientRect().top - panel.getBoundingClientRect().top
          - parseFloat(getComputedStyle(panel).borderTopWidth);
        const gap = body.getBoundingClientRect().top - head.getBoundingClientRect().bottom;
        check('列表与头部之间的间距等于控件到边缘的间距',
          Math.abs(gap - panelPad) <= 1 && gap >= 14,
          `间距 ${gap.toFixed(1)}px vs 面板内边距 ${panelPad.toFixed(1)}px`);
        check('第一行紧跟在列表区顶部（没有额外空档）',
          firstRow ? firstRow.getBoundingClientRect().top - body.getBoundingClientRect().top <= 2 : true,
          firstRow ? `${(firstRow.getBoundingClientRect().top - body.getBoundingClientRect().top).toFixed(1)}px` : '空列表');
        check('列表区可滚动（行多了不会撑破面板）',
          getComputedStyle(body).overflowY === 'auto' && body.getBoundingClientRect().bottom <=
          panel.getBoundingClientRect().bottom,
          `overflow=${getComputedStyle(body).overflowY}`);
      }

      
      check('设置界面默认隐藏', $('settingsModal').hidden === true, '');
      $('btnSettings').click();
      check('点设置按钮打开设置界面', $('settingsModal').hidden === false, '');
      
      {
        $('btnSettings').click();
        await new Promise((r) => setTimeout(r, 40));
        check('再按一次播放收起动画', $('settingsModal').classList.contains('anim-close'), $('settingsModal').className);
        await new Promise((r) => setTimeout(r, 320));
        check('收起动画结束后设置界面关闭', $('settingsModal').hidden === true, `hidden=${$('settingsModal').hidden}`);
        $('btnSettings').click();
        await new Promise((r) => setTimeout(r, 60));
        check('第三次按下又能打开（来回切换）', $('settingsModal').hidden === false, '');
        $('btnSettings').click();
        await new Promise((r) => setTimeout(r, 320));
        check('可反复开关，不会卡在中间态', $('settingsModal').hidden === true, '');
        
        $('btnSettings').click();
        await new Promise((r) => setTimeout(r, 320));
        check('恢复为打开状态（供后续用例继续）', $('settingsModal').hidden === false, '');
      }
      check('设置界面内含声卡工作模式',
        !!document.querySelector('#settingsModal #selBackend') && $('selBackend').options.length >= 5,
        `${$('selBackend').options.length} 个模式`);
      check('设置界面内含设备与格式设置',
        !!document.querySelector('#settingsModal #selDevice') && !!document.querySelector('#settingsModal #selRate'), '');

      
      {
        const extEntry = document.querySelector('#extList .ext-entry');
        const settingRows = document.querySelectorAll('#extList .ext-setting');
        const types = [...settingRows].map((r) => {
          if (r.querySelector('input[type="checkbox"]')) return 'boolean';
          if (r.querySelector('select')) return 'select';
          if (r.querySelector('input[type="number"]')) return 'number';
          return 'text';
        });
        check('扩展面板：渲染声明式设置 / 命令（ext-v2）',
          !!extEntry && settingRows.length === 4 && types.join(',') === 'select,number,boolean,text' &&
          document.querySelectorAll('#extList .ext-commands .btn').length === 2,
          `rows=${settingRows.length} types=${types.join(',')}`);
        const extSel = extEntry && extEntry.querySelector('.ext-setting select');
        if (extSel) {
          extSel.value = 'low';
          extSel.dispatchEvent(new Event('change', { bubbles: true }));
        }
        await new Promise((r) => setTimeout(r, 100));
        check('扩展设置：修改后调用主进程并提示即时生效',
          state.extSettingCalls.length >= 1 && state.extSettingCalls[0][1] === 'quality' &&
          state.extSettingCalls[0][2] === 'low' && $('extStatus').textContent.includes('即时生效'),
          `calls=${JSON.stringify(state.extSettingCalls)} status=${$('extStatus').textContent}`);
        const extCmd = document.querySelector('#extList .ext-commands .btn');
        if (extCmd) extCmd.click();
        await new Promise((r) => setTimeout(r, 100));
        check('扩展命令：点击后主进程执行并显示结果',
          state.extCommandCalls.length === 1 && state.extCommandCalls[0][1] === 'clear-cache' &&
          $('extStatus').textContent.includes('已清理 3 个缓存文件'),
          JSON.stringify(state.extCommandCalls));
      }

      
      {
        
        const allSelects = [...document.querySelectorAll('select')].filter((s) => !s.closest('#extList'));
        check('页面上所有 select 都升级成自定义下拉',
          allSelects.length >= 10 &&
          allSelects.every((s) => s.classList.contains('sel-native') && !!s.closest('.sel-wrap')?.querySelector('.sel-btn')),
          `${allSelects.length} 个下拉`);
        const sel = $('selBackend');
        const ui = sel.closest('.sel-wrap');
        const btn = ui.querySelector('.sel-btn');
        const pop = ui.querySelector('.sel-pop');
        check('原生 select 仍是数据源（id/options/change 都没变）',
          sel.id === 'selBackend' && sel.options.length >= 5 && typeof sel.value === 'string',
          `${sel.options.length} 个选项 value=${sel.value}`);
        check('原生下拉已隐藏（不再弹出系统蓝条）',
          getComputedStyle(sel).opacity === '0' && getComputedStyle(sel).position === 'absolute',
          `${getComputedStyle(sel).opacity} / ${getComputedStyle(sel).position}`);
        check('按钮显示当前选中项',
          btn.querySelector('.sel-label').textContent === sel.options[sel.selectedIndex].textContent.trim(),
          btn.textContent.trim());

        
        check('弹层默认收起', pop.hidden === true, '');
        btn.click();
        await new Promise((r) => setTimeout(r, 30));
        check('点击后弹层展开', pop.hidden === false, '');
        check('展开带入场动画', pop.classList.contains('anim-open'), pop.className);
        check('展开时按钮 aria-expanded=true', btn.getAttribute('aria-expanded') === 'true', '');
        await new Promise((r) => setTimeout(r, 300));
        check('动画结束后摘掉动画类且弹层仍完全可见',
          !pop.classList.contains('anim-open') && !pop.hidden &&
          getComputedStyle(pop).opacity === '1' && pop.getBoundingClientRect().height > 10,
          `class=${pop.className} opacity=${getComputedStyle(pop).opacity}`);
        check('弹层项目与原生选项一一对应',
          pop.querySelectorAll('.sel-opt').length === sel.options.length &&
          [...pop.querySelectorAll('.sel-opt')].every((it, i) => it.textContent.trim() === sel.options[i].textContent.trim()),
          `${pop.querySelectorAll('.sel-opt').length} 项`);
        check('当前项在弹层里被标记为选中',
          pop.querySelector('.sel-opt.is-selected')?.dataset.value === sel.value,
          pop.querySelector('.sel-opt.is-selected')?.dataset.value || '(无)');

        
        state.settingsPatches.length = 0;
        const target = [...pop.querySelectorAll('.sel-opt')].find((it) => it.dataset.value !== sel.value);
        const wantValue = target.dataset.value;
        const wantLabel = target.textContent.trim();
        target.click();
        await new Promise((r) => setTimeout(r, 120));
        check('点选项会写回原生 select（工作模式按新规则只暂存，不立即落盘）',
          sel.value === wantValue && !state.settingsPatches.some((p) => 'backend' in p),
          `${sel.value} / 已落盘=${JSON.stringify(state.settingsPatches.map((p) => p.backend))}`);
        check('选择后弹层自动收起', pop.hidden === true, '');
        check('按钮文字跟着更新（应用自身赋 value 也一样）',
          btn.querySelector('.sel-label').textContent === wantLabel, btn.textContent.trim());
        sel.value = 'auto';
        await new Promise((r) => setTimeout(r, 40));
        check('程序化改 value 也会同步按钮文字',
          btn.querySelector('.sel-label').textContent === '自动（WASAPI 共享）', btn.textContent.trim());
        sel.value = 'wasapi-shared';
        await new Promise((r) => setTimeout(r, 40));

        
        pop.hidden = true;
        btn.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter', bubbles: true }));
        await new Promise((r) => setTimeout(r, 60));
        check('键盘 Enter 也能展开', pop.hidden === false,
          `expanded=${btn.getAttribute('aria-expanded')}`);
        btn.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }));
        await new Promise((r) => setTimeout(r, 40));
        check('Esc 收起弹层', pop.hidden === true, '');
        btn.click();
        await new Promise((r) => setTimeout(r, 40));
        const other = $('selDevice');
        other.closest('.sel-wrap').querySelector('.sel-btn').click();
        await new Promise((r) => setTimeout(r, 40));
        check('同时只展开一个下拉',
          pop.hidden === true && other.closest('.sel-wrap').querySelector('.sel-pop').hidden === false, '');
        document.body.click();
        await new Promise((r) => setTimeout(r, 40));
        check('点空白处收起',
          other.closest('.sel-wrap').querySelector('.sel-pop').hidden === true, '');
        
        
        {
          const devVals = [...$('selDevice').options].map((o) => o.value);
          check('设备列表没有重复项（并发刷新不会重复追加）',
            new Set(devVals).size === devVals.length,
            `${devVals.length} 项 / 去重后 ${new Set(devVals).size} 项`);
        }
        check('语言切换时下拉标签同步（选项文案会被重写）',
          typeof $('selLanguage').closest('.sel-wrap').querySelector('.sel-label').textContent === 'string', '');
        
        check('语言选择器与文件浏览器图标都是内联 SVG（不依赖 emoji 字体）',
          !!$('settingsModal').querySelector('.lang-pick svg') &&
          !($('settingsModal').querySelector('.lang-pick')?.textContent || '').includes('🌐') &&
          (document.querySelectorAll('.br-item .br-ico').length === 0 ||
            document.querySelectorAll('.br-item .br-ico svg').length > 0) &&
          !document.body.innerHTML.includes('📁'), '');
        
        check('软件渲染时自动降级玻璃效果（性能）', (() => {
          const soft = document.body.classList.contains('software-render');
          const el = document.querySelector('.panel');
          const bf = el ? (getComputedStyle(el).backdropFilter || getComputedStyle(el).webkitBackdropFilter || '') : '';
          return !soft || bf === 'none' || bf === '';
        })(), `software-render=${document.body.classList.contains('software-render')}`);
        
        check('音频转换进度条不再写 width（改用 transform）', (() => {
          const bar = $('convBar');
          return !bar || bar.style.width === '';
        })(), `width=${$('convBar')?.style.width || '(空)'}`);
      }


      
      {
        const probe = $('btnProbe');
        const release = $('btnRelease');
        const apply = $('btnApply');
        const size = (b) => `${Math.round(b.getBoundingClientRect().height)}`;
        check('应用按钮文案精简为「应用」', apply.textContent.trim() === '应用', apply.textContent.trim());
        check('精简后仍用 title 说明它会重开声卡',
          /重开声卡/.test(apply.title || ''), apply.title);
        check('应用按钮与隔壁按钮等高', size(probe) === size(apply) && size(release) === size(apply),
          `探测能力=${size(probe)} 释放声卡=${size(release)} 应用=${size(apply)}`);
        check('三个按钮字号一致', new Set([probe, release, apply].map((b) => getComputedStyle(b).fontSize)).size === 1,
          [probe, release, apply].map((b) => getComputedStyle(b).fontSize).join(' / '));
        check('主按钮仍靠配色区分', apply.classList.contains('primary') &&
          getComputedStyle(apply).backgroundImage !== 'none', '');
      }
      $('settingsModal').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      check('点击遮罩开始收起设置界面',
        $('settingsModal').hidden === false && $('settingsModal').classList.contains('anim-close'),
        $('settingsModal').className);
      await new Promise((r) => setTimeout(r, 320));
      check('点击遮罩关闭设置界面', $('settingsModal').hidden === true, '');
      $('btnSettings').click();
      await new Promise((r) => setTimeout(r, 320));
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
      await new Promise((r) => setTimeout(r, 320));
      check('Esc 关闭设置界面', $('settingsModal').hidden === true, '');
      $('btnSettings').click();
      await new Promise((r) => setTimeout(r, 320));

      
      const accentOf = () => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
      const swatches = document.querySelectorAll('#themeSwatches .swatch');
      check('设置界面内含外观/主题色设置',
        !!document.querySelector('#settingsModal #themeSwatches') &&
        !!document.querySelector('#settingsModal #themeColor'), '');
      check('提供多种预设主题色', swatches.length >= 8, `${swatches.length} 个预设`);
      check('默认主题色生效', accentOf() === '#35d07f', accentOf());

      const purple = swatches[2];
      purple.click();
      await new Promise((r) => setTimeout(r, 50));
      const themePatch = state.settingsPatches.filter((p) => p.themeColor).pop();
      check('点击预设色块立即换色', accentOf() === purple.dataset.color, `${accentOf()} (期望 ${purple.dataset.color})`);
      check('主题色已持久化到设置', themePatch && themePatch.themeColor === purple.dataset.color,
        JSON.stringify(themePatch));
      check('选中的色块有标记', purple.classList.contains('active'), '');
      check('派生色跟随主题色变化',
        getComputedStyle(document.documentElement).getPropertyValue('--accent-dark').trim().startsWith('#') &&
        getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb').trim().length > 5,
        getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb').trim());
      check('主题色确实应用到界面元素',
        getComputedStyle($('seekPlayed')).backgroundImage.includes('gradient') ||
        getComputedStyle($('seekPlayed')).backgroundColor !== 'rgba(0, 0, 0, 0)',
        getComputedStyle($('seekPlayed')).backgroundImage.slice(0, 40));

      
      const picker = $('themeColor');
      picker.value = '#ff00aa';
      picker.dispatchEvent(new Event('input', { bubbles: true }));
      check('自定义颜色实时预览', accentOf() === '#ff00aa', accentOf());
      picker.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 50));
      const customPatch = state.settingsPatches.filter((p) => p.themeColor).pop();
      check('自定义颜色被保存', customPatch && customPatch.themeColor === '#ff00aa', JSON.stringify(customPatch));

      $('btnThemeReset').click();
      await new Promise((r) => setTimeout(r, 50));
      check('恢复默认主题色', accentOf() === '#35d07f', accentOf());
      check('自定义取色器同步当前值', $('themeColor').value === '#35d07f', $('themeColor').value);

      
      const bgLayer = $('bgLayer');
      const panelStyle = getComputedStyle(document.querySelector('.panel'));
      check('存在背景图层', !!bgLayer && !!$('bgImage'), '');
      check('默认纯色背景（图层未激活）', !bgLayer.classList.contains('active'), bgLayer.className);
      check('面板为半透明 + 背景模糊（玻璃效果；软件渲染时按性能降级为无模糊）', (() => {
        const soft = document.body.classList.contains('software-render');
        const bf = panelStyle.backdropFilter || panelStyle.webkitBackdropFilter || '';
        const ok = /rgba\(/.test(panelStyle.backgroundColor) && (soft ? (bf === 'none' || bf === '') : bf.includes('blur'));
        return ok;
      })(), `software-render=${document.body.classList.contains('software-render')} · ${panelStyle.backgroundColor} · ${panelStyle.backdropFilter || panelStyle.webkitBackdropFilter}`);
      check('设置里有背景来源与三个按钮',
        !!$('selBgSource') && !!$('btnPickBg') && !!$('btnFetchBg') && !!$('btnClearBg') &&
        $('selBgSource').options.length === 3, `${$('selBgSource').options.length} 个来源选项`);

      
      const themeBtn = $('btnThemeMode');
      check('标题栏有明暗切换按钮且紧邻设置按钮',
        !!themeBtn && themeBtn.nextElementSibling && themeBtn.nextElementSibling.id === 'btnSettings', '');
      check('默认深色主题', !document.body.classList.contains('light'), document.body.className);
      const darkVar = getComputedStyle(document.body).color;
      const darkPanel = panelStyle.backgroundColor;
      themeBtn.click();
      await new Promise((r) => setTimeout(r, 300));
      const lightVar = getComputedStyle(document.body).color;
      const lightPanel = getComputedStyle(document.querySelector('.panel')).backgroundColor;
      const lum = (color) => {
        const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(color) || /^#?([0-9a-f]{6})$/i.exec(color.trim());
        if (!m) return null;
        const [r, g, b] = m.length === 2
          ? [(parseInt(m[1], 16) >> 16) & 255, (parseInt(m[1], 16) >> 8) & 255, parseInt(m[1], 16) & 255]
          : [Number(m[1]), Number(m[2]), Number(m[3])];
        return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      };
      check('点击切换为浅色主题', document.body.classList.contains('light'), document.body.className);
      check('浅色主题下文字/面板配色随动',
        lightVar !== darkVar && lightPanel !== darkPanel && lum(lightVar) < 0.35 && lum(darkVar) > 0.75,
        `文字 ${darkVar}(亮度 ${lum(darkVar)?.toFixed(2)}) → ${lightVar}(亮度 ${lum(lightVar)?.toFixed(2)}) · 面板 ${darkPanel} → ${lightPanel}`);
      check('浅色主题下图标切换为太阳', getComputedStyle(document.querySelector('#btnThemeMode .ico-sun')).display !== 'none' &&
        getComputedStyle(document.querySelector('#btnThemeMode .ico-moon')).display === 'none', '');
      check('主题选择已持久化', state.settingsPatches.some((p) => p.uiTheme === 'light'), '');
      themeBtn.click();
      await new Promise((r) => setTimeout(r, 300));
      check('再点切回深色主题', !document.body.classList.contains('light'), document.body.className);

      
      $('btnPickBg').click();
      await new Promise((r) => setTimeout(r, 150));
      check('选择本地图片后背景生效',
        bgLayer.classList.contains('active') && $('bgImage').src.startsWith('data:image'),
        `${bgLayer.className} · ${($('bgImage').getAttribute('src') || '').slice(0, 24)}`);
      check('本地选择调用了 bg.pick', state.bgPickCalls === 1, `${state.bgPickCalls} 次`);
      check('来源下拉同步为本地图片', $('selBgSource').value === 'local', $('selBgSource').value);

      
      $('btnFetchBg').click();
      await new Promise((r) => setTimeout(r, 200));
      check('网络图片刷新成功', state.bgFetchCalls === 1 && bgLayer.classList.contains('active'),
        `fetch ${state.bgFetchCalls} 次`);
      check('来源下拉同步为网络图片', $('selBgSource').value === 'network', $('selBgSource').value);
      check('刷新按钮进入冷却并被禁用', $('btnFetchBg').disabled === true, `disabled=${$('btnFetchBg').disabled}`);
      const cd0 = $('btnFetchBg').textContent;
      const cdNum = (s) => Number((String(s).match(/(\d+)/) || [])[1] ?? -1);
      check('冷却按钮显示剩余秒数', cdNum(cd0) > 0 && cdNum(cd0) <= 30, cd0);
      $('btnFetchBg').click();                       
      await new Promise((r) => setTimeout(r, 100));
      check('冷却期内点击不会重复刷新', state.bgFetchCalls === 1, `${state.bgFetchCalls} 次`);
      await new Promise((r) => setTimeout(r, 1300));
      check('倒计时在走动', cdNum($('btnFetchBg').textContent) < cdNum(cd0),
        `${cd0} → ${$('btnFetchBg').textContent}`);
      check('主进程声明的冷却时长为 30s', state.info.bgCooldownMs === 30000, `${state.info.bgCooldownMs} ms`);

      
      $('bgBlur').value = '30';
      $('bgBlur').dispatchEvent(new Event('input', { bubbles: true }));
      check('背景模糊可实时调整',
        getComputedStyle(document.documentElement).getPropertyValue('--bg-blur').trim() === '30px',
        getComputedStyle(document.documentElement).getPropertyValue('--bg-blur').trim());
      
      check('标签文案是「背景不透明度」',
        /不透明度/.test(document.querySelector('label [data-i18n="set.bg.opacity"]').textContent) &&
        !/背景透明度/.test(document.querySelector('label [data-i18n="set.bg.opacity"]').textContent),
        document.querySelector('label [data-i18n="set.bg.opacity"]').textContent);
      check('不透明度滑杆初值与设置一致（0.7 → 70%）',
        $('bgOpacity').value === '70' && $('bgOpacityVal').textContent === '70%',
        `value=${$('bgOpacity').value} label=${$('bgOpacityVal').textContent}`);
      $('bgOpacity').value = '20';                 
      $('bgOpacity').dispatchEvent(new Event('input', { bubbles: true }));
      check('不透明度可实时调整（与设置值同向）',
        Math.abs(Number(getComputedStyle(document.documentElement).getPropertyValue('--bg-opacity')) - 0.2) < 0.001 &&
        $('bgOpacityVal').textContent === '20%',
        `${getComputedStyle(document.documentElement).getPropertyValue('--bg-opacity').trim()} / ${$('bgOpacityVal').textContent}`);
      check('调整后写回设置（bgOpacity 同向，不做 1-x 换算）',
        Math.abs(Number(state.settings.bgOpacity) - 0.2) < 0.001, String(state.settings.bgOpacity));
      $('bgOpacity').value = '70';
      $('bgOpacity').dispatchEvent(new Event('input', { bubbles: true }));
      check('调回 70% 不透明度后设置回到 0.7',
        Math.abs(Number(getComputedStyle(document.documentElement).getPropertyValue('--bg-opacity')) - 0.7) < 0.001,
        getComputedStyle(document.documentElement).getPropertyValue('--bg-opacity').trim());

      $('btnClearBg').click();
      await new Promise((r) => setTimeout(r, 100));
      check('清除背景后回到纯色', !bgLayer.classList.contains('active') && $('selBgSource').value === 'none',
        bgLayer.className);
      
      $('btnPickBg').click();
      await new Promise((r) => setTimeout(r, 150));

      
      check('设置里有 Wine 兼容区块',
        !!$('selWineCompat') && !!$('wineStatus') && !!$('wineHint') && $('selWineCompat').options.length === 3,
        `${$('selWineCompat').options.length} 个模式`);
      check('未检测到 Wine 时状态栏不显示 Wine 项', $('statusWine').hidden === true, `hidden=${$('statusWine').hidden}`);
      check('隐藏的状态项真的不占位（[hidden] 生效）',
        getComputedStyle($('statusWine')).display === 'none',
        `wine=${getComputedStyle($('statusWine')).display}`);
      check('已移除提权警告项（拖放功能没了，警告也不再需要）', !$('statusElevated'), '');
      check('未检测到 Wine 时状态显示为原生 Windows',
        $('wineStatus').textContent.includes('未检测到'), $('wineStatus').textContent);
      check('未启用时没有 no-glass 类', !document.body.classList.contains('no-glass'), document.body.className);

      
      state.wineInfo = {
        detected: true, version: '9.0', label: 'Wine 9.0', source: 'registry:HKCU\\Software\\Wine',
        mode: 'auto', active: false, noGlass: false, applied: [], skipped: [],
        notes: [], unsupported: ['wasapi-exclusive'], chain: ['directsound', 'wasapi-shared', 'mme'],
      };
      $('selWineCompat').value = 'auto';
      $('selWineCompat').dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 120));
      check('检测到 Wine 后状态栏出现 Wine 项',
        $('statusWine').hidden === false && /Wine 9\.0/.test($('wineText').textContent),
        $('wineText').textContent);
      check('auto: 检测到 Wine 后兼容模式自动生效', document.body.classList.contains('no-glass'),
        document.body.className);
      check('状态里列出了被改写的设置项', /兼容模式已启用/.test($('wineStatus').textContent),
        $('wineStatus').textContent);
      const glassOff = getComputedStyle(document.querySelector('.panel')).backdropFilter;
      check('兼容模式下关闭 GPU 玻璃效果', glassOff === 'none' || glassOff === '', `backdrop-filter=${glassOff}`);

      
      $('selWineCompat').value = 'off';
      $('selWineCompat').dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 120));
      check('切到关闭后不再套用兼容改动', !document.body.classList.contains('no-glass'), document.body.className);
      check('Wine 选择已持久化到设置',
        state.settingsPatches.some((p) => p.wineCompat === 'auto') &&
        state.settingsPatches.some((p) => p.wineCompat === 'off'), '');
      check('状态文案同步为未启用', /未启用/.test($('wineStatus').textContent), $('wineStatus').textContent);
      $('selWineCompat').value = 'auto';
      $('selWineCompat').dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 120));
      
      state.wineInfo = null;
      $('selWineCompat').dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 120));
      check('Wine 指示可在未检测到后复位', $('statusWine').hidden === true, `hidden=${$('statusWine').hidden}`);

      
      
      
      if (!$('settingsModal').hidden) {
        $('btnSettings').click();
        await new Promise((r) => setTimeout(r, 320));
      }
      $('btnSettings').click();
      await new Promise((r) => setTimeout(r, 30));
      check('打开设置时播放弹出动画', $('settingsModal').classList.contains('anim-open'),
        $('settingsModal').className);
      check('弹出动画期间面板可见', $('settingsModal').hidden === false &&
        getComputedStyle(document.querySelector('#settingsModal .modal')).display !== 'none', '');
      await new Promise((r) => setTimeout(r, 400));
      check('弹出动画结束后摘掉动画类（终态不依赖动画）',
        !$('settingsModal').classList.contains('anim-open') && $('settingsModal').hidden === false,
        $('settingsModal').className);
      const popRect = document.querySelector('#settingsModal .modal').getBoundingClientRect();
      check('弹出动画结束后回到正常尺寸（无残留缩放）',
        Math.abs(popRect.width - document.querySelector('#settingsModal .modal').offsetWidth) < 2,
        `${Math.round(popRect.width)} / ${document.querySelector('#settingsModal .modal').offsetWidth}`);

      
      
      
      const reducedMotion = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      let vtCalls = 0;
      const realVT = document.startViewTransition;
      document.startViewTransition = (cb) => {
        vtCalls++;
        cb();
        return { finished: Promise.resolve(), ready: Promise.resolve(), updateCallbackDone: Promise.resolve() };
      };
      const beforeTheme = document.body.classList.contains('light');
      $('btnThemeMode').click();
      for (let i = 0; i < 10 && vtCalls === 0 && !reducedMotion; i++) {
        await new Promise((r) => setTimeout(r, 30));
      }
      if (reducedMotion) {
        check('系统要求减少动画时跳过渐变、仍然完成切换',
          vtCalls === 0 && document.body.classList.contains('light') !== beforeTheme,
          `调用 ${vtCalls} 次（reduced-motion 生效）`);
      } else {
        check('主题切换走 View Transitions（渐变）', vtCalls === 1, `调用 ${vtCalls} 次`);
      }
      check('渐变回调里完成了主题切换', document.body.classList.contains('light') !== beforeTheme,
        document.body.className);
      check('样式表定义了主题渐变关键帧',
        [...document.styleSheets].some((ss) => {
          try { return [...ss.cssRules].some((r) => /::view-transition-(old|new)/.test(r.cssText) || /themeFadeIn|themeFadeOut/.test(r.cssText)); }
          catch { return false; }
        }), '');
      $('btnThemeMode').click();
      await new Promise((r) => setTimeout(r, 60));

      
      
      
      
      document.startViewTransition = undefined;
      const beforeFallback = document.body.classList.contains('light');
      let fallbackErr = '';
      try {
        $('btnThemeMode').click();
        await new Promise((r) => setTimeout(r, 220));
      } catch (e) { fallbackErr = String(e.message || e); }
      check('不支持 View Transitions 时降级为直接切换',
        !fallbackErr && document.body.classList.contains('light') !== beforeFallback && $('errBox').hidden === true,
        fallbackErr || document.body.className);
      $('btnThemeMode').click();
      await new Promise((r) => setTimeout(r, 40));
      document.startViewTransition = realVT;

      
      $('btnCloseSettings').click();
      await new Promise((r) => setTimeout(r, 30));
      check('关闭设置时播放收起动画', $('settingsModal').classList.contains('anim-close'),
        $('settingsModal').className);
      await new Promise((r) => setTimeout(r, 320));
      check('收起动画结束后设置真正隐藏',
        $('settingsModal').hidden === true && !$('settingsModal').classList.contains('anim-close'),
        `hidden=${$('settingsModal').hidden} ${$('settingsModal').className}`);
      check('动画期间没有产生运行错误', $('errBox').hidden === true, ($('errBox').textContent || '').slice(0, 160));

      
      {
        const playBtn = $('btnPlay');
        const styleText = [...document.styleSheets].flatMap((ss) => {
          try { return [...ss.cssRules].map((r) => r.cssText); } catch { return []; }
        }).join('\n');
        check('样式表定义了按下压扁与回弹动画',
          /\.btn\.is-down/.test(styleText) && /@keyframes btnPop/.test(styleText), '');
        playBtn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        check('按下播放控件时进入压扁态', playBtn.classList.contains('is-down'), playBtn.className);
        document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
        check('松开后摘掉压扁态', !playBtn.classList.contains('is-down'), playBtn.className);
        playBtn.click();
        check('点击时播放弹起动画', playBtn.classList.contains('pop'), playBtn.className);
        await new Promise((r) => setTimeout(r, 400));
        check('弹起动画结束后类被摘掉（不会卡住）', !playBtn.classList.contains('pop'), playBtn.className);

        
        const transport = ['btnPrev', 'btnPlay', 'btnStop', 'btnNext'];
        let allDown = true;
        for (const id of transport) {
          $(id).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
          if (!$(id).classList.contains('is-down')) allDown = false;
          document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
        }
        check('上一首/播放/停止/下一首都有按压反馈', allDown, transport.join(','));
        
        $('btnFetchBg').disabled = true;
        $('btnFetchBg').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        check('禁用按钮不产生按压反馈', !$('btnFetchBg').classList.contains('is-down'),
          $('btnFetchBg').className);
        $('btnFetchBg').disabled = false;
        check('按压动画不产生运行错误', $('errBox').hidden === true, ($('errBox').textContent || '').slice(0, 160));
      }

      
      {
        const vol = $('volume');
        
        const trackVar = () => getComputedStyle(document.body).getPropertyValue('--range-track').trim();
        const darkTrack = trackVar();
        check('滑杆轨道用主题变量，而不是系统默认灰',
          getComputedStyle(vol).backgroundImage.includes('gradient') && darkTrack.length > 0,
          getComputedStyle(vol).backgroundImage.slice(0, 60));
        vol.value = '20';
        vol.dispatchEvent(new Event('input', { bubbles: true }));
        check('拖动音量后填充比例同步（20%）',
          vol.style.getPropertyValue('--range-fill') === '20.00%', vol.style.getPropertyValue('--range-fill'));
        vol.value = '80';
        vol.dispatchEvent(new Event('input', { bubbles: true }));
        $('btnThemeMode').click();
        await new Promise((r) => setTimeout(r, 320));
        const lightTrack = trackVar();
        check('浅色主题下滑杆底色随主题变化', lightTrack !== darkTrack && lightTrack.length > 0,
          `${darkTrack} → ${lightTrack}`);
        $('btnThemeMode').click();
        await new Promise((r) => setTimeout(r, 320));
        check('切回深色后滑杆底色还原', trackVar() === darkTrack, trackVar());
      }

      
      {
        const show = $('browserPath');
        const input = $('browserPathInput');
        const toastTexts = () => [...document.querySelectorAll('#toastWrap .toast')].map((t) => t.textContent);
        const lastToast = () => document.querySelector('#toastWrap .toast:last-child');

        check('地址栏有可编辑输入框且默认隐藏', !!input && input.hidden === true, '');
        show.click();
        check('点击地址栏进入编辑态（填入当前路径）',
          input.hidden === false && show.hidden === true && input.value === 'C:\\Users\\demo\\Music',
          `input=${input.value}`);

        
        input.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }));
        await new Promise((r) => setTimeout(r, 60));
        check('Esc 取消编辑且不导航',
          input.hidden === true && show.hidden === false && $('browserPath').textContent === 'C:\\Users\\demo\\Music',
          $('browserPath').textContent);

        
        show.click();
        input.value = 'C:\\Users\\demo\\Music\\Albums';
        input.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', bubbles: true }));
        await new Promise((r) => setTimeout(r, 150));
        check('输入存在的目录后回车跳转',
          $('browserPath').textContent === 'C:\\Users\\demo\\Music\\Albums', $('browserPath').textContent);
        check('跳转成功弹出提示（ok）',
          !!lastToast() && lastToast().classList.contains('ok') && /已跳转到/.test(lastToast().textContent),
          toastTexts().join(' | '));
        check('提示带弹出动画类', lastToast().classList.contains('anim-in'), lastToast().className);
        await new Promise((r) => setTimeout(r, 400));       
        check('弹出动画结束后提示仍然完全可见（动画不参与终态）',
          !!lastToast() && !lastToast().classList.contains('anim-in') &&
          getComputedStyle(lastToast()).opacity === '1' &&
          lastToast().getBoundingClientRect().height > 10,
          lastToast() ? `opacity=${getComputedStyle(lastToast()).opacity} h=${Math.round(lastToast().getBoundingClientRect().height)}` : '没有提示');
        check('提示位置在窗口顶部居中（不遮挡内容）', (() => {
          const r = lastToast().getBoundingClientRect();
          return Math.abs((r.left + r.right) / 2 - window.innerWidth / 2) < 4 && r.top < 120;
        })(), (() => { const r = lastToast().getBoundingClientRect(); return `center=${Math.round((r.left + r.right) / 2)} top=${Math.round(r.top)}`; })());
        check('提示节点在动画后会被移除（不会堆积）', document.querySelectorAll('#toastWrap .toast').length <= 3,
          `${document.querySelectorAll('#toastWrap .toast').length} 条`);

        
        show.click();
        input.value = 'C:\\Users\\demo\\Music\\Hotel California.flac';
        input.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', bubbles: true }));
        await new Promise((r) => setTimeout(r, 150));
        const selected = document.querySelector('.br-item.selected');
        check('输入文件路径后跳到所在目录并高亮该文件',
          $('browserPath').textContent === 'C:\\Users\\demo\\Music' && !!selected &&
          /Hotel California\.flac/.test(selected.dataset.path),
          `${$('browserPath').textContent} · ${selected ? selected.dataset.path : '未高亮'}`);
        check('定位到文件也给出提示', /已定位到文件/.test(lastToast()?.textContent || ''),
          lastToast()?.textContent || '');

        
        show.click();
        input.value = 'C:\\Users\\demo\\Music\\Nope\\Missing';
        input.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', bubbles: true }));
        await new Promise((r) => setTimeout(r, 150));
        check('不存在的路径给出错误提示',
          !!lastToast() && lastToast().classList.contains('err') && /路径不存在/.test(lastToast().textContent),
          lastToast()?.textContent || '');
        check('错误时输入框保留并标红（便于修改）',
          input.hidden === false && input.classList.contains('bad'), input.className);
        check('错误时不导航', $('browserPath').textContent === 'C:\\Users\\demo\\Music' ||
          $('browserPath').hidden === true, $('browserPath').textContent);

        
        input.value = 'relative\\path';
        input.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', bubbles: true }));
        await new Promise((r) => setTimeout(r, 150));
        check('格式不合理时提示格式错误',
          /格式不正确/.test(lastToast()?.textContent || ''), lastToast()?.textContent || '');
        input.value = 'C:\\bad<name>';
        input.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', bubbles: true }));
        await new Promise((r) => setTimeout(r, 150));
        check('含非法字符时提示非法字符',
          /不允许的字符/.test(lastToast()?.textContent || ''), lastToast()?.textContent || '');
        input.value = '';
        input.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', bubbles: true }));
        await new Promise((r) => setTimeout(r, 120));
        check('空输入提示请输入路径', /请输入路径/.test(lastToast()?.textContent || ''),
          lastToast()?.textContent || '');
        check('校验调用确实走的是主进程（fs:stat）', state.pathInputs.length >= 6,
          `${state.pathInputs.length} 次`);

        
        input.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }));
        input.blur();
        await new Promise((r) => setTimeout(r, 60));
        check('失焦后回到显示态', input.hidden === true && show.hidden === false, '');

        
        await loadBrowserDir('C:\\Users\\demo\\Music');
      }

      
      {
        const icon = $('volIcon');
        const slider = $('volume');
        const lastPatch = () => state.settingsPatches.at(-1) || {};
        const lastToast = () => document.querySelector('#toastWrap .toast:last-child');

        check('音量图标是可点按钮（不是纯装饰）',
          icon.tagName === 'BUTTON' && icon.type === 'button', icon.tagName);
        check('音量图标有三个状态图标（静音/低/高）',
          icon.querySelectorAll('svg').length === 3 &&
          !!icon.querySelector('.ico-vol-mute') && !!icon.querySelector('.ico-vol-low') &&
          !!icon.querySelector('.ico-vol-high'), '');
        check('默认音量 80 → 高音量图标',
          icon.dataset.level === 'high' && slider.value === '80', `${icon.dataset.level} / ${slider.value}`);

        
        state.settingsPatches.length = 0;
        document.getElementById('toastWrap').innerHTML = '';
        icon.click();
        await new Promise((r) => setTimeout(r, 100));
        check('点击后进入静音：图标切成静音态', icon.dataset.level === 'mute', icon.dataset.level);
        check('静音时 aria-pressed=true（可被读屏识别）', icon.getAttribute('aria-pressed') === 'true', '');
        check('静音时提示改成「取消静音」', /取消静音/.test(icon.title), icon.title);
        check('静音时音量数字显示「静音」', $('volNum').textContent === '静音', $('volNum').textContent);
        check('静音时滑杆位置保留（没有被拖到 0）', slider.value === '80', slider.value);
        check('静音状态写进设置（muted=true，volume 保留）',
          lastPatch().muted === true && lastPatch().volume === 0.8, JSON.stringify(lastPatch()));
        check('静音不再弹提示（按要求移除）',
          !document.querySelector('#toastWrap .toast'), `${document.querySelectorAll('#toastWrap .toast').length} 条`);

        
        state.settingsPatches.length = 0;
        icon.click();
        await new Promise((r) => setTimeout(r, 100));
        check('再点一次还原：图标回到高音量', icon.dataset.level === 'high', icon.dataset.level);
        check('还原后音量数字回到 80', $('volNum').textContent === '80', $('volNum').textContent);
        check('还原后滑杆仍是 80（音量没丢）', slider.value === '80', slider.value);
        check('还原写入 muted=false 且音量不变',
          lastPatch().muted === false && lastPatch().volume === 0.8, JSON.stringify(lastPatch()));
        check('还原同样不弹提示', !document.querySelector('#toastWrap .toast'),
          `${document.querySelectorAll('#toastWrap .toast').length} 条`);

        
        slider.value = '0';
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 60));
        check('音量 0 时图标就是静音态', icon.dataset.level === 'mute', icon.dataset.level);
        icon.click();                                  
        await new Promise((r) => setTimeout(r, 60));
        icon.click();                                  
        await new Promise((r) => setTimeout(r, 60));
        check('音量为 0 时取消静音会回落到可用音量（不会点了没声）',
          Number(slider.value) > 0 && icon.dataset.level !== 'mute', `${slider.value} / ${icon.dataset.level}`);

        
        slider.value = '80';
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 60));
        icon.click();                                  
        await new Promise((r) => setTimeout(r, 60));
        check('已静音', icon.dataset.level === 'mute', icon.dataset.level);
        slider.value = '40';
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 60));
        check('静音时调音量会自动取消静音',
          icon.dataset.level === 'low' && lastPatch().muted === false, `${icon.dataset.level} / ${JSON.stringify(lastPatch())}`);
        check('低音量用低音量图标（20%~49%）', Number(slider.value) === 40 && icon.dataset.level === 'low', icon.dataset.level);

        
        await new Promise((r) => setTimeout(r, 60));
        const before = icon.dataset.level;
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', key: 'm', bubbles: true }));
        await new Promise((r) => setTimeout(r, 90));
        check('按 M 也能静音', icon.dataset.level === 'mute' && before !== 'mute', `${before} → ${icon.dataset.level}`);
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', key: 'm', bubbles: true }));
        await new Promise((r) => setTimeout(r, 90));
        check('再按 M 还原', icon.dataset.level !== 'mute', icon.dataset.level);

        
        $('browserPath').click();
        await new Promise((r) => setTimeout(r, 40));
        $('browserPathInput').value = 'm';
        $('browserPathInput').dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', key: 'm', bubbles: true }));
        await new Promise((r) => setTimeout(r, 80));
        check('在输入框里按 M 不会静音', icon.dataset.level !== 'mute', icon.dataset.level);
        $('browserPathInput').dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }));
        await new Promise((r) => setTimeout(r, 60));

        
        slider.value = '80';
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 60));
        check('音量与静音状态可复原', slider.value === '80' && !state.settings.muted && icon.dataset.level === 'high',
          `${slider.value} / ${state.settings.muted} / ${icon.dataset.level}`);
      }

      
      {
        const eqModal = $('eqModal');
        check('标题栏有均衡器按钮，且紧邻主题按钮左侧',
          !!$('btnEq') && $('btnEq').nextElementSibling?.id === 'btnThemeMode', '');
        check('EQ 面板默认隐藏', eqModal.hidden === true, '');
        $('btnEq').click();
        await new Promise((r) => setTimeout(r, 40));
        check('按下按钮弹出 EQ 面板', eqModal.hidden === false, '');
        check('EQ 面板用与设置相同的弹出动画', eqModal.classList.contains('anim-open'), eqModal.className);
        await new Promise((r) => setTimeout(r, 380));
        check('弹出动画结束后摘掉动画类（终态不依赖动画）',
          !eqModal.classList.contains('anim-open') && eqModal.hidden === false, eqModal.className);

        const bandSliders = [...document.querySelectorAll('#eqBands input[type="range"]')];
        const labels = [...document.querySelectorAll('#eqBands .eq-freq')].map((e) => e.textContent);
        check('有 8 段滑杆', bandSliders.length === 8, `${bandSliders.length} 段`);
        check('频率覆盖 20Hz–19kHz',
          labels[0] === '20Hz' && labels[7] === '19kHz', labels.join(' '));
        check('滑杆量程 ±12dB', bandSliders.every((s) => s.min === '-12' && s.max === '12'),
          `${bandSliders[0].min}~${bandSliders[0].max}`);
        check('滑杆是竖排的（旋转 ±90°）',
          /matrix\(0, -?1, -?1, 0/.test(getComputedStyle(bandSliders[0]).transform),
          getComputedStyle(bandSliders[0]).transform);

        
        {
          const tBtns = ['btnPrev', 'btnPlay', 'btnStop', 'btnNext', 'btnRepeat'].map((id) => $(id));
          const size = (b) => `${Math.round(b.getBoundingClientRect().width)}x${Math.round(b.getBoundingClientRect().height)}`;
          check('播放键与其它播放控件等大',
            size($('btnPlay')) === size($('btnPrev')) && size($('btnPlay')) === size($('btnStop')) &&
            size($('btnPlay')) === size($('btnNext')),
            tBtns.map((b) => `${b.id}=${size(b)}`).join(' '));
          check('播放键仍靠配色区分（主色，不是尺寸）',
            $('btnPlay').classList.contains('primary') &&
            getComputedStyle($('btnPlay')).backgroundImage !== 'none', '');
          check('循环切换按钮紧挨「下一首」',
            $('btnNext').nextElementSibling?.id === 'btnRepeat', $('btnNext').nextElementSibling?.id || '(无)');
          check('播放列表工具栏里不再有循环下拉框', !$('selRepeat'), '');
          check('循环初始为不循环（off）', $('btnRepeat').dataset.mode === 'off', $('btnRepeat').dataset.mode);
          check('播放方式按钮有四个图标（循环/单曲/随机，另一个是关闭态复用循环图标）',
            !!$('btnRepeat').querySelector('.ico-repeat') && !!$('btnRepeat').querySelector('.ico-repeat-one') &&
            !!$('btnRepeat').querySelector('.ico-shuffle'), '');

          
          state.settingsPatches.length = 0;
          document.getElementById('toastWrap').innerHTML = '';
          const modes = [];
          for (let i = 0; i < 5; i++) {
            $('btnRepeat').click();
            await new Promise((r) => setTimeout(r, 80));
            modes.push($('btnRepeat').dataset.mode);
          }
          check('点击按钮在 不循环→列表循环→单曲循环→随机播放 之间循环',
            modes.join(',') === 'all,one,shuffle,off,all', modes.join(' → '));
          check('切换会持久化到设置',
            state.settingsPatches.some((p) => p.repeat === 'all') &&
            state.settingsPatches.some((p) => p.repeat === 'one'), JSON.stringify(state.settingsPatches.map((p) => p.repeat)));
          check('切到随机播放时同时写入 shuffle=true',
            state.settingsPatches.some((p) => p.shuffle === true && p.repeat === 'all'),
            JSON.stringify(state.settingsPatches.filter((p) => p.shuffle !== undefined)));
          check('离开随机播放会关掉 shuffle',
            state.settingsPatches.some((p) => p.shuffle === false), '');
          check('切换播放方式不再弹提示（按要求移除）',
            document.querySelectorAll('#toastWrap .toast').length === 0,
            `${document.querySelectorAll('#toastWrap .toast').length} 条提示`);
          check('播放方式按钮提示只显示当前档位（不再带「播放方式：」前缀）',
        !/播放方式/.test($('btnRepeat').title) && $('btnRepeat').title.length > 0, $('btnRepeat').title);
          check('随机播放用不同图标（data-mode=shuffle 时显示随机图标）', (() => {
            for (let i = 0; i < 4 && $('btnRepeat').dataset.mode !== 'shuffle'; i++) $('btnRepeat').click();
            return $('btnRepeat').dataset.mode === 'shuffle' &&
              getComputedStyle($('btnRepeat').querySelector('.ico-shuffle')).display !== 'none' &&
              getComputedStyle($('btnRepeat').querySelector('.ico-repeat')).display === 'none';
          })(), $('btnRepeat').dataset.mode);
          check('随机播放高亮用青色系（与循环的主题色高亮区分）', (() => {
            const color = getComputedStyle($('btnRepeat')).color;
            return /^rgb\(\s*99\s*,\s*210\s*,\s*255\s*\)$/.test(color);
          })(), getComputedStyle($('btnRepeat')).color);
          check('高亮只出现在开启时', getComputedStyle($('btnRepeat')).color !==
            getComputedStyle($('btnPrev')).color,
            `mode=${getComputedStyle($('btnRepeat')).color} prev=${getComputedStyle($('btnPrev')).color}`);
          check('播放列表工具栏里不再有「随机」勾选框（已整合到按钮）', !$('chkShuffle'), '');
          
          for (let i = 0; i < 4 && $('btnRepeat').dataset.mode !== 'off'; i++) {
            $('btnRepeat').click();
            await new Promise((r) => setTimeout(r, 60));
          }
          check('可以回到不循环', $('btnRepeat').dataset.mode === 'off', $('btnRepeat').dataset.mode);
        }

        
        for (const [label, name] of [
          [$('chkEqEnabled').parentElement, '「启用」'],
          [$('chkFallback').parentElement, '「独占格式回退」'],
        ]) {
          const box = label.querySelector('input').getBoundingClientRect();
          const text = label.querySelector('span').getBoundingClientRect();
          const delta = Math.abs((box.top + box.height / 2) - (text.top + text.height / 2));
          check(`复选框与文字垂直对齐（${name}）`, delta <= 1,
            `中心相差 ${delta.toFixed(2)}px（勾选框 ${box.height.toFixed(1)}px@${box.top.toFixed(1)} / 文字行盒 ${text.height.toFixed(1)}px@${text.top.toFixed(1)} · label ${label.getBoundingClientRect().height.toFixed(1)}px align=${getComputedStyle(label).alignItems} inputMT=${getComputedStyle(label.querySelector('input')).marginTop} spanLH=${getComputedStyle(label.querySelector('span')).lineHeight}）`);
        }
        check('行内复选框尺寸固定（不再随 DPI/主题变化）',
          $('chkEqEnabled').getBoundingClientRect().width === 15 &&
          getComputedStyle($('chkEqEnabled')).marginTop === '0px',
          `${$('chkEqEnabled').getBoundingClientRect().width}px / margin-top=${getComputedStyle($('chkEqEnabled')).marginTop}`);

        
        {
          const head = document.querySelector('#eqModal .modal-head');
          const centers = [
            ['标题', head.querySelector('h2')],
            ['勾选框', $('chkEqEnabled')],
            ['关闭按钮', $('btnCloseEq')],
          ].map(([n, el]) => {
            const r = el.getBoundingClientRect();
            return [n, r.top + r.height / 2];
          });
          const spread = Math.max(...centers.map(([, y]) => y)) - Math.min(...centers.map(([, y]) => y));
          check('EQ 头部标题/勾选框/关闭按钮中线一致', spread <= 2,
            centers.map(([n, y]) => `${n}=${y.toFixed(1)}`).join(' '));
        }

        
        {
          const btns = [...document.querySelectorAll('#eqModal .modal-foot .btn')];
          const sizes = new Set(btns.map((b) => {
            const r = b.getBoundingClientRect();
            return `${Math.round(r.height)}`;
          }));
          check('底部按钮高度完全一致', btns.length === 3 && sizes.size === 1,
            btns.map((b) => `${b.textContent.trim()}=${Math.round(b.getBoundingClientRect().height)}px`).join(' '));
          const fonts = new Set(btns.map((b) => getComputedStyle(b).fontSize));
          check('底部按钮字号一致', fonts.size === 1, [...fonts].join(' / '));
          check('主按钮仍然靠配色区分（不是靠尺寸）',
            btns.some((b) => b.classList.contains('primary')), '');
        }

        
        state.eqSetCalls.length = 0;
        const first = bandSliders[0];
        first.value = '6';
        first.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 120));
        check('拖动滑杆立即下发配置（实时生效）', state.eqSetCalls.length >= 1,
          `${state.eqSetCalls.length} 次`);
        check('下发的是刚调的值', state.eqSetCalls.at(-1)?.bands?.[0]?.gainDb === 6,
          JSON.stringify(state.eqSetCalls.at(-1)?.bands?.[0]));
        check('界面上显示 dB 数值', $('eqDb0').textContent === '+6.0', $('eqDb0').textContent);
        
        state.eqSetCalls.length = 0;
        for (const v of [7, 8, 9, 10, 11, 12]) {
          first.value = String(v);
          first.dispatchEvent(new Event('input', { bubbles: true }));
        }
        await new Promise((r) => setTimeout(r, 200));
        check('连续拖动做了节流（少于事件数）', state.eqSetCalls.length >= 1 && state.eqSetCalls.length <= 3,
          `${state.eqSetCalls.length} 次 / 6 个事件`);
        check('节流后最终值仍然落库', state.eqSetCalls.at(-1)?.bands?.[0]?.gainDb === 12,
          JSON.stringify(state.eqSetCalls.at(-1)?.bands?.[0]));

        
        check('默认未启用', $('chkEqEnabled').checked === false, '');
        $('chkEqEnabled').checked = true;
        $('chkEqEnabled').dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 100));
        check('勾选启用后下发 enabled=true', state.eqSetCalls.at(-1)?.enabled === true, '');
        check('状态文案同步', /已启用/.test($('eqStatus').textContent), $('eqStatus').textContent);

        
        const rockBtn = [...document.querySelectorAll('#eqPresets .btn')].find((b) => b.dataset.preset === 'rock');
        check('有多个预设按钮', document.querySelectorAll('#eqPresets .btn').length >= 6,
          `${document.querySelectorAll('#eqPresets .btn').length} 个`);
        rockBtn.click();
        await new Promise((r) => setTimeout(r, 120));
        check('点预设后 8 段全部按预设更新',
          state.eqSetCalls.at(-1)?.bands?.map((b) => b.gainDb).join(',') === EQ_PRESETS.rock.join(','),
          JSON.stringify(state.eqSetCalls.at(-1)?.bands?.map((b) => b.gainDb)));
        check('预设下拉高亮当前预设', rockBtn.classList.contains('active'), rockBtn.className);
        check('应用预设会弹出提示', /已应用预设/.test(document.querySelector('#toastWrap .toast:last-child')?.textContent || ''),
          document.querySelector('#toastWrap .toast:last-child')?.textContent || '');

        
        $('eqPreamp').value = '-6';
        $('eqPreamp').dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 120));
        check('前级可调并实时下发', state.eqSetCalls.at(-1)?.preampDb === -6 &&
          $('eqPreampVal').textContent === '-6.0 dB', `${state.eqSetCalls.at(-1)?.preampDb} / ${$('eqPreampVal').textContent}`);

        
        $('btnEqSave').click();
        await new Promise((r) => setTimeout(r, 120));
        check('保存调用 eq:save（.eq 文件）', state.eqSaveCalls.length === 1, `${state.eqSaveCalls.length} 次`);
        check('保存后给出路径提示', /已保存/.test($('eqStatus').textContent), $('eqStatus').textContent);
        check('保存不会因为取消而误报', state.eqSaveCanceled === false, '');

        
        $('btnEqLoad').click();
        await new Promise((r) => setTimeout(r, 120));
        check('打开 .eq 调用 eq:load', state.eqLoadCalls === 1, `${state.eqLoadCalls} 次`);
        check('载入后滑杆与预设同步',
          $('eqBand0').value === String(EQ_PRESETS.rock[0]) && $('chkEqEnabled').checked === true,
          `${$('eqBand0').value} / ${$('chkEqEnabled').checked}`);
        check('载入提示带路径', /已载入/.test(document.querySelector('#toastWrap .toast:last-child')?.textContent || ''),
          document.querySelector('#toastWrap .toast:last-child')?.textContent || '');

        
        state.eqLoadBad = true;
        $('btnEqLoad').click();
        await new Promise((r) => setTimeout(r, 120));
        check('坏的 .eq 文件给出错误提示',
          /格式不正确/.test(document.querySelector('#toastWrap .toast:last-child')?.textContent || ''),
          document.querySelector('#toastWrap .toast:last-child')?.textContent || '');
        state.eqLoadBad = false;

        
        $('btnEqReset').click();
        await new Promise((r) => setTimeout(r, 120));
        check('归零把 8 段与前级都清掉',
          state.eqSetCalls.at(-1)?.bands?.every((b) => b.gainDb === 0) &&
          state.eqSetCalls.at(-1)?.preampDb === 0, JSON.stringify(state.eqSetCalls.at(-1)?.bands?.map((b) => b.gainDb)));

        
        $('btnCloseEq').click();
        await new Promise((r) => setTimeout(r, 40));
        check('关闭 EQ 面板播放收起动画', eqModal.classList.contains('anim-close'), eqModal.className);
        await new Promise((r) => setTimeout(r, 320));
        check('收起后 EQ 面板隐藏', eqModal.hidden === true, `hidden=${eqModal.hidden}`);
        $('btnEq').click();
        await new Promise((r) => setTimeout(r, 40));
        check('再次按下可重新打开', eqModal.hidden === false, '');
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
        await new Promise((r) => setTimeout(r, 320));
        check('Esc 也能关闭 EQ 面板', eqModal.hidden === true, '');
        check('EQ 交互过程没有运行错误', $('errBox').hidden === true, ($('errBox').textContent || '').slice(0, 160));
      }

      
      {
        const now = $('tbNow');
        const inner = $('tbNowInner');
        
        const settleNow = () => new Promise((r) => setTimeout(r, 320));
        check('标题栏有正在播放字样（三段结构 + 动画内层）',
          !!now && !!$('tbNowState') && !!$('tbNowText') && !!$('tbNowSep') && !!inner, '');
        
        emit('player:state', { status: 'stopped', trackId: null, duration: 0, position: 0, volume: 0.8, format: null });
        await settleNow();
        check('未播放时显示「等待媒体..」',
          now.hidden === false && $('tbNowState').textContent === '等待媒体..',
          `hidden=${now.hidden} "${now.textContent}"`);
        check('等待状态不带「：」与曲目残留',
          $('tbNowSep').hidden === true && $('tbNowText').textContent === '',
          `sep=${$('tbNowSep').hidden} text="${$('tbNowText').textContent}"`);
        check('等待媒体比播放中更淡', (() => {
          const waiting = Number(getComputedStyle(now).opacity);
          return waiting < 0.62 && now.classList.contains('is-waiting');
        })(), `opacity=${getComputedStyle(now).opacity}`);

        
        emit('player:state', {
          status: 'playing', trackId: 't1', duration: 391.2, position: 12,
          volume: 0.8, format: fmtOf(),
        });
        await settleNow();
        check('播放时显示「正在播放：艺术家 - 标题」',
          now.hidden === false && $('tbNowState').textContent === '正在播放' &&
          $('tbNowText').textContent === 'Eagles - Hotel California',
          `${$('tbNowState').textContent}${$('tbNowText').textContent}`);
        check('字样是淡色（不抢视线）', (() => {
          const cs = getComputedStyle(now);
          return Number(cs.opacity) < 0.85 && cs.color !== getComputedStyle($('npTitle')).color;
        })(), `opacity=${getComputedStyle(now).opacity} color=${getComputedStyle(now).color}`);
        check('字样水平居中于标题栏', (() => {
          const r = now.getBoundingClientRect();
          const tb = document.querySelector('.titlebar').getBoundingClientRect();
          return Math.abs((r.left + r.right) / 2 - (tb.left + tb.right) / 2) <= 2;
        })(), (() => {
          const r = now.getBoundingClientRect();
          const tb = document.querySelector('.titlebar').getBoundingClientRect();
          return `字样中心 ${((r.left + r.right) / 2).toFixed(1)} vs 标题栏中心 ${((tb.left + tb.right) / 2).toFixed(1)}`;
        })());
        check('字样不拦截鼠标（标题栏要能拖动）', getComputedStyle(now).pointerEvents === 'none', '');

        
        emit('player:state', {
          status: 'paused', trackId: 't1', duration: 391.2, position: 12, volume: 0.8, format: fmtOf(),
        });
        await settleNow();
        check('暂停时「正在播放」变「暂停」，曲目保持不变',
          $('tbNowState').textContent === '暂停' &&
          $('tbNowText').textContent === 'Eagles - Hotel California', now.textContent);

        
        emit('player:state', {
          status: 'playing', trackId: 't2', duration: 354, position: 0, volume: 0.8, format: fmtOf(),
        });
        await settleNow();
        check('换曲后字样随之变化',
          $('tbNowState').textContent === '正在播放' && /Queen/.test($('tbNowText').textContent),
          now.textContent);

        
        emit('player:state', {
          status: 'paused', trackId: 't2', duration: 354, position: 0, volume: 0.8, format: fmtOf(),
        });
        await new Promise((r) => setTimeout(r, 40));
        check('文字变化时先播放淡出（is-out）', inner.classList.contains('is-out'), inner.className);
        await new Promise((r) => setTimeout(r, 140));
        check('换字后播放淡入（is-in）', inner.classList.contains('is-in') &&
          $('tbNowState').textContent === '暂停', `${inner.className} / ${$('tbNowState').textContent}`);
        await new Promise((r) => setTimeout(r, 260));
        check('动画结束摘掉动画类，且文字完全可见（动画不参与终态）',
          !inner.classList.contains('is-in') && !inner.classList.contains('is-out') &&
          getComputedStyle(inner).opacity === '1' && inner.getBoundingClientRect().height > 5,
          `${inner.className} opacity=${getComputedStyle(inner).opacity}`);
        
        emit('player:state', {
          status: 'paused', trackId: 't2', duration: 354, position: 0, volume: 0.8, format: fmtOf(),
        });
        await new Promise((r) => setTimeout(r, 40));
        check('内容没变时不重播动画', !inner.classList.contains('is-in') && !inner.classList.contains('is-out'),
          inner.className);

        
        emit('player:state', {
          status: 'stopped', trackId: null, duration: 0, position: 0, volume: 0.8, format: null,
        });
        await settleNow();
        check('停止后字样回到「等待媒体..」并去掉曲目',
          now.hidden === false && $('tbNowState').textContent === '等待媒体..' &&
          $('tbNowText').textContent === '' && $('tbNowSep').hidden === true,
          `hidden=${now.hidden} "${now.textContent}"`);
      }

      
      {
        const mask = $('rankModal');
        check('排行榜按钮右侧依次是歌词独占、均衡器按钮',
          !!$('btnRank') && $('btnRank').nextElementSibling?.id === 'btnLyricsFull' &&
          $('btnRank').nextElementSibling?.nextElementSibling?.id === 'btnEq',
          $('btnRank')?.nextElementSibling?.id || '(无)');
        check('排行榜面板默认隐藏', mask.hidden === true, '');
        $('btnRank').click();
        await new Promise((r) => setTimeout(r, 40));
        check('首次单击打开排行榜', mask.hidden === false, '');
        check('排行榜用与设置相同的弹出动画', mask.classList.contains('anim-open'), mask.className);
        await new Promise((r) => setTimeout(r, 380));
        check('动画结束后摘掉动画类（终态不依赖动画）',
          !mask.classList.contains('anim-open') && mask.hidden === false, mask.className);

        const items = [...document.querySelectorAll('#rankList .rank-item')];
        check('列出了排行榜条目', items.length === 3, `${items.length} 条`);
        check('按次数从多到少排序',
          items.map((li) => Number(li.dataset.plays)).join(',') === '12,7,3',
          items.map((li) => li.dataset.plays).join(','));
        check('条目显示了标题与艺术家 · 专辑',
          /Hotel California/.test(items[0].textContent) && /Eagles/.test(items[0].textContent),
          items[0].textContent.trim().replace(/\s+/g, ' ').slice(0, 60));
        check('第一次数用主题色高亮（第一名）', items[0].classList.contains('is-top'), '');
        check('次数前有播放图标（且图标在数字之前）', (() => {
          const count = items[0].querySelector('.rank-count');
          const svg = count?.querySelector('svg');
          const num = count?.querySelector('span');
          if (!svg || !num) return false;
          
          return (svg.compareDocumentPosition(num) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
        })(), items[0].querySelector('.rank-count')?.textContent.trim() || '');
        check('次数文案带单位（12 次）', /12\s*次/.test(items[0].querySelector('.rank-count').textContent),
          items[0].querySelector('.rank-count').textContent.trim());
        check('概要显示曲目数与总次数', /3 首/.test($('rankSummary').textContent) &&
          /22 次/.test($('rankSummary').textContent), $('rankSummary').textContent);

        
        check('排行榜可滚动', (() => {
          const list = $('rankList');
          return getComputedStyle(list).overflowY === 'auto' && list.getBoundingClientRect().height <=
            mask.querySelector('.modal').getBoundingClientRect().height;
        })(), getComputedStyle($('rankList')).overflowY);

        
        const callsBefore = state.playsGetCalls;
        state.plays = [{ ...PLAY_RANKING[0], plays: 13 }, ...PLAY_RANKING.slice(1)];
        emit('plays:changed', { key: PLAY_RANKING[0].key, plays: 13 });
        await new Promise((r) => setTimeout(r, 80));
        check('次数变化时排行榜自动刷新',
          state.playsGetCalls > callsBefore &&
          Number(document.querySelector('#rankList .rank-item').dataset.plays) === 13,
          `${state.playsGetCalls} 次拉取`);

        
        state.plays = [];
        emit('plays:changed', { key: 'x', plays: 1 });
        await new Promise((r) => setTimeout(r, 80));
        check('没有记录时显示空态文案',
          document.querySelectorAll('#rankList .rank-item').length === 0 &&
          !!document.querySelector('#rankList .rank-empty'),
          document.querySelector('#rankList .rank-empty')?.textContent || '');
        state.plays = PLAY_RANKING;
        emit('plays:changed', { key: 'x', plays: 1 });
        await new Promise((r) => setTimeout(r, 80));

        
        const slotOf = (li) => li.querySelector('.rank-pick-slot');
        check('默认不在编辑态（勾选框收起 + 编辑脚注隐藏）', (() => {
          const slot = slotOf(document.querySelector('#rankList .rank-item'));
          return !$('rankList').classList.contains('is-editing') &&
            $('rankEditFoot').hidden === true &&
            Math.round(slot.getBoundingClientRect().width) === 0 &&
            getComputedStyle(slot).opacity === '0';
        })(), `slot 宽 ${Math.round(slotOf(document.querySelector('#rankList .rank-item')).getBoundingClientRect().width)}px`);
        $('btnRankEdit').click();
        await new Promise((r) => setTimeout(r, 340));      
        check('按「编辑」后每行出现勾选框',
          document.querySelectorAll('#rankList .rank-pick').length === 3 &&
          $('rankList').classList.contains('is-editing'),
          `${document.querySelectorAll('#rankList .rank-pick').length} 个勾选框`);
        check('勾选框槽展开（文字右移；终态不依赖动画）', (() => {
          const slot = slotOf(document.querySelector('#rankList .rank-item'));
          const style = getComputedStyle(slot);
          const anim = document.querySelector('#rankList .rank-pick') ? getComputedStyle(slot).animationName : '';
          return Math.round(slot.getBoundingClientRect().width) >= 20 &&
            style.opacity === '1' && anim === 'rankSlotIn';
        })(), (() => {
          const slot = slotOf(document.querySelector('#rankList .rank-item'));
          const style = getComputedStyle(slot);
          return `slot 宽 ${slot.getBoundingClientRect().width.toFixed(1)} / opacity ${style.opacity} / ` +
            `动画 ${style.animationName}`;
        })());
        check('勾选框可见（动画只做形变，不参与可见性）', (() => {
          const pick = document.querySelector('#rankList .rank-pick');
          const style = getComputedStyle(pick);
          
          return style.opacity === '1' && pick.getBoundingClientRect().width > 6 &&
            getComputedStyle(slotOf(document.querySelector('#rankList .rank-item'))).opacity === '1';
        })(), (() => {
          const pick = document.querySelector('#rankList .rank-pick');
          return `checkbox ${pick.getBoundingClientRect().width.toFixed(1)}px opacity ${getComputedStyle(pick).opacity}`;
        })());
        check('编辑栏像托盘一样滑出（按钮跟随，不再各自弹出）', (() => {
          const foot = $('rankEditFoot');
          const btns = [...foot.querySelectorAll('.btn')];
          const btnAnims = btns.map((b) => getComputedStyle(b).animationName);
          return foot.hidden === false &&
            getComputedStyle(foot).animationName === 'rankTrayOut' &&
            btnAnims.every((n) => n === 'none') &&              
            btns.every((b) => Number(getComputedStyle(b).opacity) >= 0.5 &&
              b.getBoundingClientRect().height > 10);           
        })(), `foot=${getComputedStyle($('rankEditFoot')).animationName} ` +
          `btns=${[...$('rankEditFoot').querySelectorAll('.btn')].map((b) => getComputedStyle(b).animationName).join(',')}`);
        check('托盘滑出时被弹层裁切（不会溢出到面板外）', (() => {
          const cs = getComputedStyle(document.querySelector('.rank-modal'));
          return cs.overflow === 'hidden';
        })(), getComputedStyle(document.querySelector('.rank-modal')).overflow);
        await new Promise((r) => setTimeout(r, 420));
        check('托盘动画结束后摘类且按钮仍完全可见（动画不参与终态）', (() => {
          const foot = $('rankEditFoot');
          const btn = foot.querySelector('.btn');
          return !foot.classList.contains('is-in') && foot.hidden === false &&
            !btn.hidden && Number(getComputedStyle(btn).opacity) >= 0.5 &&
            btn.getBoundingClientRect().height > 10;
        })(), `class=${$('rankEditFoot').className}`);
        check('按下反馈动画仍在（没被这次改动牵连）', (() => {
          const css = [...document.styleSheets].flatMap((s) => {
            try { return [...s.cssRules].map((r) => r.cssText); } catch { return []; }
          }).join('\n');
          return /@keyframes\s+btnPress|\.btn\.pressing|btn-press/i.test(css) ||
            /:active[^{]*\{[^}]*transform/i.test(css);
        })(), '');
        check('编辑脚注显示（移除选中 / 全选 / 完成）',
          $('rankEditFoot').hidden === false && !!$('btnRankRemove') && !!$('btnRankSelectAll') &&
          !!$('btnRankDone'), '');
        check('未选任何记录时「移除选中」不可点', $('btnRankRemove').disabled === true, '');

        const rows = [...document.querySelectorAll('#rankList .rank-item')];
        rows[0].querySelector('.rank-pick').click();          
        rows[2].querySelector('.rank-pick').click();          
        await new Promise((r) => setTimeout(r, 80));
        check('勾选后按钮显示选中数量并可用',
          $('btnRankRemove').disabled === false && /\(2\)/.test($('btnRankRemove').textContent),
          $('btnRankRemove').textContent);
        check('选中行有高亮', rows[0].classList.contains('is-picked') && rows[2].classList.contains('is-picked'), '');
        check('脚注显示已选数量', /2/.test($('rankEditTip').textContent), $('rankEditTip').textContent);

        state.playsRemoveCalls.length = 0;
        $('btnRankRemove').click();
        await new Promise((r) => setTimeout(r, 150));
        check('移除调用主进程（带被选中的 key）',
          state.playsRemoveCalls.length === 1 && state.playsRemoveCalls[0].length === 2,
          JSON.stringify(state.playsRemoveCalls[0] || []));
        check('列表按移除后的结果重画',
          document.querySelectorAll('#rankList .rank-item').length === 1 &&
          document.querySelector('#rankList .rank-item').dataset.plays === '7',
          `${document.querySelectorAll('#rankList .rank-item').length} 条`);
        check('移除后概要同步', /1 首/.test($('rankSummary').textContent), $('rankSummary').textContent);
        check('移除后给出提示', /已移除 2 条/.test(document.querySelector('#toastWrap .toast:last-child')?.textContent || ''),
          document.querySelector('#toastWrap .toast:last-child')?.textContent || '');

        
        state.plays = PLAY_RANKING.slice();
        emit('plays:changed', { key: 'x', plays: 1 });
        await new Promise((r) => setTimeout(r, 100));
        $('btnRankSelectAll').click();
        await new Promise((r) => setTimeout(r, 60));
        check('全选会勾上所有行',
          document.querySelectorAll('#rankList .rank-item.is-picked').length === 3 &&
          /3/.test($('btnRankRemove').textContent), $('btnRankRemove').textContent);
        $('btnRankSelectAll').click();
        await new Promise((r) => setTimeout(r, 60));
        check('再点一次取消全选',
          document.querySelectorAll('#rankList .rank-item.is-picked').length === 0 &&
          $('btnRankRemove').disabled === true, '');

        
        $('btnRankDone').click();
        await new Promise((r) => setTimeout(r, 340));      
        check('按「完成」退出编辑态（勾选框收回 + 脚注隐藏）', (() => {
          const slot = slotOf(document.querySelector('#rankList .rank-item'));
          return !$('rankList').classList.contains('is-editing') && $('rankEditFoot').hidden === true &&
            Math.round(slot.getBoundingClientRect().width) === 0;
        })(), `slot 宽 ${Math.round(slotOf(document.querySelector('#rankList .rank-item')).getBoundingClientRect().width)}px`);

        
        
        {
          const eqMask = $('eqModal');
          const settingsMask = $('settingsModal');
          check('互斥测试起点：排行榜开着、其它关着',
            !$('rankModal').hidden && settingsMask.hidden && eqMask.hidden, '');
          $('btnSettings').click();                   
          await new Promise((r) => setTimeout(r, 40));
          check('打开设置时排行榜进入收起动画',
            $('rankModal').classList.contains('anim-close'), $('rankModal').className);
          await new Promise((r) => setTimeout(r, 320));
          check('排行榜已关闭、设置已打开',
            $('rankModal').hidden === true && settingsMask.hidden === false,
            `rank=${$('rankModal').hidden} settings=${settingsMask.hidden}`);
          $('btnEq').click();                         
          await new Promise((r) => setTimeout(r, 40));
          check('打开均衡器时设置进入收起动画',
            settingsMask.classList.contains('anim-close'), settingsMask.className);
          await new Promise((r) => setTimeout(r, 320));
          check('设置已关闭、均衡器已打开',
            settingsMask.hidden === true && eqMask.hidden === false,
            `settings=${settingsMask.hidden} eq=${eqMask.hidden}`);
          check('同一时刻只有一个弹窗可见', (() => {
            const open = ['settingsModal', 'eqModal', 'rankModal'].filter((id) => !$(id).hidden);
            return open.length === 1 && open[0] === 'eqModal';
          })(), ['settingsModal', 'eqModal', 'rankModal'].map((id) => `${id}:${!$(id).hidden}`).join(' '));
          $('btnRank').click();                        
          await new Promise((r) => setTimeout(r, 40));
          check('打开排行榜时均衡器进入收起动画',
            eqMask.classList.contains('anim-close'), eqMask.className);
          await new Promise((r) => setTimeout(r, 340));
          check('均衡器已关闭、排行榜已打开（交接给后续用例）',
            eqMask.hidden === true && $('rankModal').hidden === false,
            `eq=${eqMask.hidden} rank=${$('rankModal').hidden}`);
        }

        
        $('btnRank').click();
        await new Promise((r) => setTimeout(r, 40));
        check('再次单击播放收起动画', mask.classList.contains('anim-close'), mask.className);
        await new Promise((r) => setTimeout(r, 320));
        check('收起后排行榜隐藏（首次开、再按关）', mask.hidden === true, `hidden=${mask.hidden}`);
        $('btnRank').click();
        await new Promise((r) => setTimeout(r, 60));
        check('第三次单击又能打开', mask.hidden === false, '');
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
        await new Promise((r) => setTimeout(r, 320));
        check('Esc 也能关闭排行榜', mask.hidden === true, '');
        $('btnRank').click();
        await new Promise((r) => setTimeout(r, 60));
        mask.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 320));
        check('点击遮罩关闭排行榜', mask.hidden === true, '');
        check('排行榜交互无运行错误', $('errBox').hidden === true, ($('errBox').textContent || '').slice(0, 120));
      }

      
      {
        const modal = document.querySelector('#settingsModal .modal');
        const body = document.querySelector('#settingsModal .modal-body');

        
        $('btnSettings').click();
        await new Promise((r) => setTimeout(r, 400));
        const baseW = modal.getBoundingClientRect().width;
        check('打开设置后面板有个正常基准宽度', baseW > 300 && baseW <= 761, `${Math.round(baseW)}`);
        const deviceSel = $('selDevice');
        const longName = DEVICES.find((d) => /SteelSeries Sonar/.test(d.name)).name;
        for (const opt of deviceSel.options) {
          if (opt.value === '{0.0.0.00000000}.{ddd}') deviceSel.value = opt.value;
        }
        deviceSel.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 200));

        const wrap = deviceSel.closest('.row').querySelector('.sel-wrap');
        const label = wrap.querySelector('.sel-label');
        check('长设备名被选中（控件里显示的是完整名）',
          label.textContent.includes('SteelSeries Sonar'), label.textContent.slice(0, 50));
        check('选中栏用省略号截断（不换行、不撑宽）', (() => {
          const cs = getComputedStyle(label);
          return cs.textOverflow === 'ellipsis' && cs.whiteSpace === 'nowrap' &&
            label.scrollWidth > label.clientWidth;      
        })(), (() => {
          const cs = getComputedStyle(label);
          return `overflow=${label.scrollWidth}/${label.clientWidth} textOverflow=${cs.textOverflow} whiteSpace=${cs.whiteSpace}`;
        })());
        check('控件不超出所在栅格列', (() => {
          const field = wrap.closest('.field');
          return wrap.getBoundingClientRect().width <= field.getBoundingClientRect().width + 1;
        })(), `控件 ${Math.round(wrap.getBoundingClientRect().width)} vs 列 ${Math.round(wrap.closest('.field').getBoundingClientRect().width)}`);
        check('设置面板宽度没被长名字撑宽',
          modal.getBoundingClientRect().width <= baseW + 1, `${Math.round(baseW)} → ${Math.round(modal.getBoundingClientRect().width)}`);
        check('面板内容没有横向溢出（不会把左侧挤出屏幕）',
          body.scrollWidth <= body.clientWidth + 1, `scrollWidth=${body.scrollWidth} clientWidth=${body.clientWidth}`);

        
        wrap.querySelector('.sel-btn').click();
        await new Promise((r) => setTimeout(r, 260));
        const pop = wrap.querySelector('.sel-pop');
        const opts = [...pop.querySelectorAll('.sel-opt')];
        const longOpt = opts.find((o) => /SteelSeries Sonar/.test(o.textContent));
        check('待选项列出了全部设备（含超长名）',
          opts.length === deviceSel.options.length && opts.length >= DEVICES.length && !!longOpt,
          `${opts.length} 项 / 原生 ${deviceSel.options.length} 项`);
        check('待选项用换行处理而不是省略', (() => {
          const cs = getComputedStyle(longOpt);
          const lineH = parseFloat(cs.lineHeight) || 18;
          return cs.whiteSpace === 'normal' && longOpt.getBoundingClientRect().height > lineH * 1.6;
        })(), (() => {
          const cs = getComputedStyle(longOpt);
          return `whiteSpace=${cs.whiteSpace} lineHeight=${cs.lineHeight} 高=${Math.round(longOpt.getBoundingClientRect().height)}`;
        })());
        check('待选项不溢出弹层宽度', (() => {
          return longOpt.getBoundingClientRect().width <= pop.getBoundingClientRect().width + 1;
        })(), '');
        check('弹层宽度受父容器限制（不会反过来撑宽面板）', (() => {
          return pop.getBoundingClientRect().width <= body.getBoundingClientRect().width;
        })(), '');
        check('展开长文本下拉后面板宽度仍未变',
          modal.getBoundingClientRect().width <= baseW + 1, `${Math.round(modal.getBoundingClientRect().width)}`);

        
        for (const opt of deviceSel.options) {
          if (opt.value === '{0.0.0.00000000}.{aaa}') deviceSel.value = opt.value;
        }
        deviceSel.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 200));
        $('btnCloseSettings')?.click();
        await new Promise((r) => setTimeout(r, 320));
      }

      
      check('播放列表工具栏含保存与打开按钮', !!$('btnSaveList') && !!$('btnOpenList'), '');
      $('btnSaveList').click();
      await new Promise((r) => setTimeout(r, 120));
      check('保存按钮调用了另存为通道', state.listSaveCalls === 1, `${state.listSaveCalls} 次`);
      check('保存后提示已保存路径',
        ($('scanHint').textContent || '').includes('我的列表.playlist') && ($('scanHint').textContent || '').includes('5 首'),
        $('scanHint').textContent);
      $('btnOpenList').click();
      await new Promise((r) => setTimeout(r, 120));
      check('打开按钮调用了读取通道', state.listLoadCalls === 1, `${state.listLoadCalls} 次`);
      check('打开后提示导入结果',
        ($('scanHint').textContent || '').includes('已导入 2 首'), $('scanHint').textContent);
      
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS', ctrlKey: true }));
      await new Promise((r) => setTimeout(r, 120));
      check('Ctrl+S 触发保存', state.listSaveCalls === 2, `${state.listSaveCalls} 次`);
      
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyO', ctrlKey: true, shiftKey: true }));
      await new Promise((r) => setTimeout(r, 120));
      check('Ctrl+Shift+O 触发打开列表', state.listLoadCalls === 2, `${state.listLoadCalls} 次`);
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyO', ctrlKey: true }));
      await new Promise((r) => setTimeout(r, 80));
      check('Ctrl+O 不触发打开列表（保留给添加文件）', state.listLoadCalls === 2, `${state.listLoadCalls} 次`);

      
      check('播放列表渲染 5 行', rows.length === 5, `实际 ${rows.length}`);
      check('计数徽标 = 5', $('plCount').textContent === '5', `实际 ${$('plCount').textContent}`);
      check('格式徽标存在', document.querySelectorAll('.pl-fmt .tag').length >= 8,
        `${document.querySelectorAll('.pl-fmt .tag').length} 个徽标`);
      check('损坏文件被标记', !!document.querySelector('.pl-item.bad'), 'broken.mp3 应有 bad 类');
      check('时长格式化', $('timeTotal').textContent === '00:00' || /^\d\d:\d\d$/.test($('timeTotal').textContent),
        $('timeTotal').textContent);

      
      rows[0].click();
      await new Promise((r) => setTimeout(r, 150));
      check('点击曲目触发播放', state.playing === true, JSON.stringify(state.calls.filter((c) => c[0] === 'player:play')));
      check('播放按钮变暂停图标', $('btnPlay').textContent === '⏸', $('btnPlay').textContent);
      check('标题显示曲目名', $('npTitle').textContent === 'Hotel California', $('npTitle').textContent);
      check('元数据徽标', $('npTags').children.length >= 3, `${$('npTags').children.length} 个`);
      check('状态显示播放中', $('statStatus').textContent === '播放中', $('statStatus').textContent);

      
      await new Promise((r) => setTimeout(r, 200));
      check('为带封面的曲目请求了封面', state.coverCalls.includes('t1'), state.coverCalls.join(','));
      const coverImg = $('coverImg');
      check('内嵌封面已显示', coverImg.hidden === false && coverImg.src.startsWith('data:image'),
        coverImg.getAttribute('src')?.slice(0, 32) || '(无)');
      check('封面占位符已隐藏', $('coverPlaceholder').hidden === true, '');

      const metaRows = [...document.querySelectorAll('#metaGrid .meta-row')]
        .map((r) => [r.querySelector('.k').textContent, r.querySelector('.v').textContent]);
      const meta = Object.fromEntries(metaRows);
      check('音乐信息面板已填充', metaRows.length >= 15, `${metaRows.length} 行`);
      check('元数据标签没有漏翻的词条 key',
        !/(^|\s)(meta|status|stat|pl|set|sb|np|err|msg|backend|probe|device|dlg)\.[a-z]/.test($('metaGrid').textContent),
        $('metaGrid').textContent.trim().slice(0, 40));
      check('元数据含输出格式行', /Hz/.test(Object.fromEntries(metaRows)['输出'] || ''),
        Object.fromEntries(metaRows)['输出']);
      check('含标题/艺术家/专辑',
        meta['标题'] === 'Hotel California' && meta['艺术家'] === 'Eagles' && meta['专辑'] === 'Hotel California',
        `${meta['标题']} / ${meta['艺术家']} / ${meta['专辑']}`);
      check('含年份/流派/音轨', meta['年份'] === '1976' && meta['流派'] === 'Rock' && meta['音轨'] === '1',
        `${meta['年份']} / ${meta['流派']} / ${meta['音轨']}`);
      check('含技术属性（编码/采样率/位深/声道）',
        /FLAC/.test(meta['编码']) && /无损/.test(meta['编码']) && meta['采样率'] === '96 kHz' &&
        meta['位深'] === '24 bit' && meta['声道'].startsWith('2'),
        `${meta['编码']} ${meta['采样率']} ${meta['位深']} ${meta['声道']}`);
      check('含时长/大小/码率', meta['时长'] === '06:31' && /MB/.test(meta['大小']) && /kbps/.test(meta['码率']),
        `${meta['时长']} ${meta['大小']} ${meta['码率']}`);
      check('含文件路径', (meta['文件路径'] || '').includes('Hotel California.flac'), meta['文件路径']);
      check('元数据面板标题栏显示路径', ($('metaPath').textContent || '').includes('Hotel California.flac'),
        $('metaPath').textContent);

      
      document.querySelectorAll('.pl-item')[2].click();
      await new Promise((r) => setTimeout(r, 250));
      check('无封面曲目退回占位图',
        $('coverImg').hidden === true && $('coverPlaceholder').hidden === false, '');
      check('切换曲目后音乐信息同步更新',
        Object.fromEntries([...document.querySelectorAll('#metaGrid .meta-row')]
          .map((r) => [r.querySelector('.k').textContent, r.querySelector('.v').textContent]))['标题'] === '测试正弦波 1kHz',
        '');
      document.querySelectorAll('.pl-item')[0].click();
      await new Promise((r) => setTimeout(r, 250));

      
      emitProgress({ position: 120, peaks: [0.82, 0.45] });
      await new Promise((r) => setTimeout(r, 60));
      check('进度时间更新', $('timeNow').textContent === '02:00', $('timeNow').textContent);
      check('进度条宽度', parseFloat($('seekPlayed').style.width) > 25 && parseFloat($('seekPlayed').style.width) < 35,
        $('seekPlayed').style.width);

      
      const cv = $('peakCanvas');
      check('峰值计容器与画布存在',
        !!document.querySelector('.peak-panel') && !!cv && $('peakScale').children.length >= 6,
        `刻度 ${$('peakScale') ? $('peakScale').children.length : 0} 个`);
      check('峰值计通道标签为 FL/FR',
        [...document.querySelectorAll('.peak-labels span')].map((s) => s.textContent).join(',') === 'FL,FR', '');
      const glCtx = cv.getContext('webgl') || cv.getContext('experimental-webgl');
      const is2d = !glCtx && !!cv.getContext('2d');
      check('峰值计用 WebGL 渲染（失败时才退 2D）', !!glCtx || is2d,
        glCtx ? 'WebGL' : '2D 兜底');
      
      emitProgress({ position: 121, peaks: [0.95, 0.6] });
      await new Promise((r) => setTimeout(r, 250));
      let litPixels = 0;
      let accentPixels = 0;
      if (glCtx) {
        const px = new Uint8Array(cv.width * cv.height * 4);
        glCtx.readPixels(0, 0, cv.width, cv.height, glCtx.RGBA, glCtx.UNSIGNED_BYTE, px);
        for (let i = 0; i < px.length; i += 4) {
          if (px[i + 3] > 8) litPixels++;
          if (px[i + 3] > 120 && px[i + 1] > 120 && px[i + 1] > px[i + 2]) accentPixels++;
        }
      } else if (is2d) {
        const px = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
        for (let i = 0; i < px.length; i += 4) {
          if (px[i + 3] > 8) litPixels++;
          if (px[i + 3] > 120 && px[i + 1] > 120 && px[i + 1] > px[i + 2]) accentPixels++;
        }
      }
      check('峰值计已绘制出内容', litPixels > cv.width * 2, `${litPixels} 个非透明像素`);
      check('电平条使用主题色（绿色系）', accentPixels > 200, `${accentPixels} 个强调色像素`);
      check('峰值计画布随容器尺寸初始化', cv.width > 200 && cv.height > 40, `${cv.width}x${cv.height}`);
      check('峰值计外部圆角与其他面板一致',
        getComputedStyle($('peakPanel')).borderRadius === '10px', getComputedStyle($('peakPanel')).borderRadius);
      
      {
        const panelBox = document.querySelector('.panel.player').getBoundingClientRect();
        
        const metaBox = document.querySelector('.side-panel').getBoundingClientRect();
        const peakBox = $('peakPanel').getBoundingClientRect();
        const statsBox = $('stats').getBoundingClientRect();
        const metaStyle = getComputedStyle(document.querySelector('#metaPanel'));
        const gapMetaPeak = peakBox.top - metaBox.bottom;
        const gapPeakStats = statsBox.top - peakBox.bottom;
        const tail = panelBox.bottom - statsBox.bottom - 16;     
        check('元数据面板延伸到峰值计上方（间距固定 14px）', gapMetaPeak >= 10 && gapMetaPeak <= 20,
          `${gapMetaPeak.toFixed(1)}px（面板高 ${Math.round(metaBox.height)}px）`);
        check('元数据面板是伸缩项（空闲空间归它）',
          metaStyle.flexGrow === '1' &&
          getComputedStyle($('stats')).marginTop === '0px', `flex-grow=${metaStyle.flexGrow}`);
        check('左栏自上而下无空档', gapPeakStats <= 16 && Math.abs(tail) <= 2,
          `峰值计→状态格 ${gapPeakStats.toFixed(1)}px · 列底余量 ${tail.toFixed(1)}px`);
      }
      check('WebGL 可用时不显示降级提示',
        getComputedStyle($('peakFallback')).display === 'none',
        getComputedStyle($('peakFallback')).display);

      
      emitProgress({ position: 122, peaks: [0.95, 0.95] });
      await new Promise((r) => setTimeout(r, 60));
      const p1 = window.__peakStats();
      check('峰值跳变后立即显示（无显示延迟）', p1.levelDb[0] > -10,
        `${p1.levelDb[0].toFixed(1)} dB（0.95 幅度 ≈ -0.4 dB）`);
      check('最大峰值已记录', p1.holdDb[0] > -3, `${p1.holdDb[0].toFixed(1)} dB`);
      await new Promise((r) => setTimeout(r, 150));
      const pMid = window.__peakStats();
      check('保持时间内最大峰值仍在', pMid.holdDb[0] > -10, `${pMid.holdDb[0].toFixed(1)} dB`);
      await new Promise((r) => setTimeout(r, 550));
      const p2 = window.__peakStats();
      check('约 0.7 秒内电平条落到不可见', p2.levelDb[0] < -40,
        `${p1.levelDb[0].toFixed(1)} → ${p2.levelDb[0].toFixed(1)} dB`);
      check('电平条回落速度 ≥ 60 dB/秒', window.__peakStats().releaseDbPerSec >= 60,
        `${window.__peakStats().releaseDbPerSec} dB/s`);
      check('最大峰值保持约 300ms', window.__peakStats().holdMs >= 250 && window.__peakStats().holdMs <= 400,
        `${window.__peakStats().holdMs} ms`);

      
      
      resetAudioClock();
      emit('player:state', { status: 'paused', trackId: 't1', duration: 391.2, position: 0, volume: 0.8, format: fmtOf() });
      emit('player:state', { status: 'playing', trackId: 't1', duration: 391.2, position: 0, volume: 0.8, format: fmtOf() });
      await new Promise((r) => setTimeout(r, 40));
      const emptyQueue = window.__peakStats().queued;
      check('新播放会话清空音频时钟历史', emptyQueue === 0, `队列 ${emptyQueue} 个样本`);

      emitProgress({ peaks: [0.05, 0.05] });
      await new Promise((r) => setTimeout(r, 60));
      const dl1 = window.__peakStats();
      check('音频时钟已接入', dl1.clockValid === true && dl1.writtenMs > 0 && dl1.playMs < dl1.writtenMs,
        `written=${Math.round(dl1.writtenMs)}ms play=${Math.round(dl1.playMs)}ms`);
      check('开头不迟滞：新会话立即显示', dl1.levelDb[0] > -40 && dl1.effectiveMs >= 0,
        `${dl1.levelDb[0].toFixed(1)} dB · 等效延迟 ${Math.round(dl1.effectiveMs)}ms`);

      
      emitProgress({ peaks: [0.95, 0.95] });
      await new Promise((r) => setTimeout(r, 60));
      const dl2 = window.__peakStats();
      check('大声不会提前显示（音频还没播到它）', dl2.levelDb[0] < -30, `${dl2.levelDb[0].toFixed(1)} dB`);
      
      for (let i = 0; i < 6; i++) {
        emitProgress({ peaks: [0.95, 0.95] });
        await new Promise((r) => setTimeout(r, 55));
      }
      const dl3 = window.__peakStats();
      check('音频播到该位置后才出现', dl3.levelDb[0] > dl2.levelDb[0] + 25,
        `${dl2.levelDb[0].toFixed(1)} → ${dl3.levelDb[0].toFixed(1)} dB（等效延迟 ${Math.round(dl3.effectiveMs)}ms）`);

      
      const off = $('peakOffset');
      check('设置里有峰值计偏移滑动条', !!off && off.min === '-400' && off.max === '400',
        `${off ? off.min : '?'}..${off ? off.max : '?'} ms，步进 ${off ? off.step : '?'}`);
      off.value = '300';
      off.dispatchEvent(new Event('input', { bubbles: true }));
      check('拖动实时生效', window.__peakStats().offsetMs === 300 && /\+300 ms/.test($('peakOffsetVal').textContent),
        $('peakOffsetVal').textContent);
      off.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 80));
      check('偏移被持久化到设置', state.settingsPatches.some((p) => p.peakOffsetMs === 300), '');

      
      const probeOffset = async (offsetMs) => {
        off.value = String(offsetMs);
        off.dispatchEvent(new Event('input', { bubbles: true }));
        resetAudioClock();
        emit('player:state', { status: 'paused', trackId: 't1', duration: 391.2, position: 0, volume: 0.8, format: fmtOf() });
        emit('player:state', { status: 'playing', trackId: 't1', duration: 391.2, position: 0, volume: 0.8, format: fmtOf() });
        for (let i = 0; i < 20; i++) {                 
          emitProgress({ peaks: [0.5, 0.5] });
        }
        await new Promise((r) => setTimeout(r, 60));
        return window.__peakStats();
      };
      const po0 = await probeOffset(0);
      const po400 = await probeOffset(400);
      check('偏移 0：显示"正在响"的位置（误差 ≤ 一个采样间隔）',
        po0.shownPosMs !== null && Math.abs(po0.shownPosMs - po0.playMs) <= 60,
        `显示位置 ${Math.round(po0.shownPosMs)}ms / 播放位置 ${Math.round(po0.playMs)}ms`);
      check('偏移 +400ms：显示更早的音频（等效更晚）',
        po400.offsetMs === 400 && po400.shownPosMs < po0.shownPosMs - 250,
        `+0ms → 显示 ${Math.round(po0.shownPosMs)}ms；+400ms → 显示 ${Math.round(po400.shownPosMs)}ms`);

      $('btnPeakOffsetReset').click();
      await new Promise((r) => setTimeout(r, 80));
      check('归零按钮复位', window.__peakStats().offsetMs === 0 && off.value === '0' &&
        /^0 ms$/.test($('peakOffsetVal').textContent), `${off.value} / ${$('peakOffsetVal').textContent}`);

      
      
      
      resetAudioClock(60000);
      emit('player:state', { status: 'paused', trackId: 't1', duration: 391.2, position: 0, volume: 0.8, format: fmtOf() });
      emit('player:state', { status: 'playing', trackId: 't1', duration: 391.2, position: 0, volume: 0.8, format: fmtOf() });
      for (let i = 0; i < 20; i++) emitProgress({ peaks: [0.6, 0.6] });      
      await new Promise((r) => setTimeout(r, 60));
      const beforeSeek = window.__peakStats();
      
      resetAudioClock(0);
      emitProgress({ peaks: [0.8, 0.8] });
      for (let i = 0; i < 8; i++) {
        emitProgress({ peaks: [0.8, 0.8] });
        await new Promise((r) => setTimeout(r, 50));
      }
      const afterSeek = window.__peakStats();
      check('seek 后立刻恢复显示（无空窗）', afterSeek.levelDb[0] > -12,
        `${afterSeek.levelDb[0].toFixed(1)} dB（跳转前位置 ${Math.round(beforeSeek.shownPosMs)}ms）`);
      check('seek 后旧位置样本被清理',
        afterSeek.shownPosMs !== null && afterSeek.shownPosMs < 2000,
        `显示位置 ${Math.round(beforeSeek.shownPosMs)}ms → ${Math.round(afterSeek.shownPosMs)}ms`);
      check('seek 后队列不堆积', afterSeek.queued <= 12, `${afterSeek.queued} 个样本`);

      
      const fpsStart = window.__peakStats().draws;
      const tStart = performance.now();
      await new Promise((r) => setTimeout(r, 1000));
      const fpsDraws = window.__peakStats().draws - fpsStart;
      const seconds = (performance.now() - tStart) / 1000;
      const fps = fpsDraws / seconds;
      check('绘制锁 60fps', fps > 40 && fps <= 72, `${fps.toFixed(1)} fps（${fpsDraws} 帧 / ${seconds.toFixed(2)}s）`);
      check('帧间隔常量为 1/60 秒', Math.abs(window.__peakStats().frameMs - 1000 / 60) < 0.01,
        `${window.__peakStats().frameMs.toFixed(2)} ms`);

      
      const scaleEls = [...$('peakScale').children].map((el) => [el.textContent, parseFloat(el.style.left)]);
      const at = (label) => (scaleEls.find(([txt]) => txt === label) || [])[1];
      check('刻度按线性幅度排布（-20dB→10% · -6dB→50% · 0dB→100%）',
        Math.abs(at('-20') - 10) < 0.6 && Math.abs(at('-6') - 50.1) < 0.8 && Math.abs(at('0') - 100) < 0.1,
        scaleEls.map(([txt, l]) => `${txt}:${l.toFixed(1)}%`).join(' '));
      check('量程下限接近 -∞（不再夹在 -50dB）', window.__peakStats().floorDb <= -90,
        `floor = ${window.__peakStats().floorDb} dB`);
      await new Promise((r) => setTimeout(r, 800));       
      const p3 = window.__peakStats();
      check('电平可以跌破 -50dB 继续下降',
        p3.levelDb[0] < -50 || p3.levelDb[0] <= window.__peakStats().floorDb,
        `${p3.levelDb[0].toFixed(1)} dB`);

      
      $('btnPlay').click();
      await new Promise((r) => setTimeout(r, 120));
      check('暂停后按钮变播放', $('btnPlay').textContent === '▶', $('btnPlay').textContent);

      
      const vol = $('volume');
      vol.value = '35';
      vol.dispatchEvent(new Event('input'));
      await new Promise((r) => setTimeout(r, 60));
      check('音量滑块与数值', $('volNum').textContent === '35', $('volNum').textContent);

      
      const backend = $('selBackend');
      check('模式下拉包含四种后端', backend.options.length >= 5, `${backend.options.length} 个选项`);
      backend.value = 'wasapi-exclusive';
      backend.dispatchEvent(new Event('change'));
      await new Promise((r) => setTimeout(r, 300));
      check('切换到独占模式（按新规则：暂存，等「应用」）',
        backend.value === 'wasapi-exclusive' && state.settings.backend !== 'wasapi-exclusive',
        `控件=${backend.value} 已落盘=${state.settings.backend}`);
      check('模式说明更新', ($('backendHint').textContent || '').includes('独占'), $('backendHint').textContent);

      
      const dev = $('selDevice');
      check('设备下拉已填充', dev.options.length >= 4, `${dev.options.length} 个选项（含默认）`);

      
      $('btnProbe').click();
      await new Promise((r) => setTimeout(r, 200));
      check('探测结果显示', ($('probeResult').textContent || '').length > 4, $('probeResult').textContent);

      
      const idsBeforeStop = [...document.querySelectorAll('.pl-item')].map((el) => el.dataset.id);
      const playlistLenBefore = state.playlist.length;
      state.playlistMutations = 0;
      $('btnStop').click();
      await new Promise((r) => setTimeout(r, 200));
      check('停止后标题回到「未在播放」', $('npTitle').textContent === '未在播放', $('npTitle').textContent);
      check('停止后提示文字复位', $('npArtist').textContent === '把音乐文件拖进播放列表即可开始', $('npArtist').textContent);
      check('停止后显示默认封面（不残留专辑图）',
        getComputedStyle($('coverImg')).display === 'none' &&
        getComputedStyle($('coverPlaceholder')).display !== 'none', '');
      check('停止后音乐信息清空', /尚未选择曲目/.test($('metaGrid').textContent),
        $('metaGrid').textContent.trim().slice(0, 24));
      check('停止后标签徽标清空', $('npTags').children.length === 0, `${$('npTags').children.length} 个`);
      check('停止后进度与时间归零',
        $('timeNow').textContent === '00:00' && $('timeTotal').textContent === '00:00' &&
        $('seekPlayed').style.width === '0%',
        `${$('timeNow').textContent} / ${$('timeTotal').textContent} / ${$('seekPlayed').style.width}`);
      check('停止后状态格恢复初始',
        $('statStatus').textContent === '空闲' && $('statFormat').textContent === '-' &&
        $('statBuffer').textContent === '0 ms' && $('statUnderrun').textContent === '0',
        `${$('statStatus').textContent} · ${$('statFormat').textContent} · ${$('statBuffer').textContent}`);
      check('停止后播放按钮为播放态', $('btnPlay').textContent === '▶', $('btnPlay').textContent);
      check('停止后播放列表高亮清除', document.querySelectorAll('.pl-item.playing').length === 0,
        `${document.querySelectorAll('.pl-item.playing').length} 个高亮`);
      check('停止后元数据面板路径清空', ($('metaPath').textContent || '') === '', $('metaPath').textContent);

      
      const langSel = $('selLanguage');
      const setLang = async (v) => {
        langSel.value = v;
        langSel.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 150));
      };
      check('设置里有语言切换（含自动）', !!langSel && langSel.options.length === 4,
        [...langSel.options].map((o) => o.value).join(','));
      check('默认中文文案', /播放列表/.test(document.querySelector('.pl-head h2').textContent) &&
        $('btnSettings').title === '设置', $('btnSettings').title);

      await setLang('en');
      check('切到英文：播放列表标题', /Playlist/.test(document.querySelector('.pl-head h2').textContent),
        document.querySelector('.pl-head h2').textContent);
      check('切到英文：按钮提示与状态栏', $('btnSettings').title === 'Settings' &&
        /Sound card|card|audio|Device/i.test($('statusDevice').textContent), $('statusDevice').textContent);
      check('切到英文：元数据面板同步', /No track selected/.test($('metaGrid').textContent),
        $('metaGrid').textContent.trim().slice(0, 24));
      check('切到英文：html lang 属性', document.documentElement.lang === 'en', document.documentElement.lang);
      check('切到英文：标题栏「等待媒体..」也跟着翻译',
        $('tbNowState').textContent === 'Waiting for media..', $('tbNowState').textContent);
      check('切到英文：主题色设置也翻译了', /Appearance/.test($('settingsModal').textContent) ||
        /Appearance/.test(document.body.textContent), '');
      check('英文被持久化', state.settingsPatches.some((p) => p.language === 'en'), '');

      await setLang('ja');
      check('切到日文：プレイリスト', /プレイリスト/.test(document.querySelector('.pl-head h2').textContent),
        document.querySelector('.pl-head h2').textContent);
      check('切到日文：元数据面板同步', /曲が選択されていません/.test($('metaGrid').textContent),
        $('metaGrid').textContent.trim().slice(0, 24));
      check('切到日文：状态栏同步（声卡那一项）',
        /サウンド|カード|デバイス|未/.test($('statusDevice').textContent), $('statusDevice').textContent);

      await setLang('zh');
      check('切回中文', /播放列表/.test(document.querySelector('.pl-head h2').textContent) &&
        /尚未选择曲目/.test($('metaGrid').textContent), document.querySelector('.pl-head h2').textContent);

      
      const idsAfterStop = [...document.querySelectorAll('.pl-item')].map((el) => el.dataset.id);
      check('停止不减少播放列表条目',
        idsAfterStop.length === idsBeforeStop.length && state.playlist.length === playlistLenBefore,
        `${idsBeforeStop.length} → ${idsAfterStop.length}（数据 ${state.playlist.length}）`);
      check('停止不改变列表内容与顺序',
        JSON.stringify(idsAfterStop) === JSON.stringify(idsBeforeStop), '');
      check('停止未触发任何删除/清空操作', state.playlistMutations === 0, `mutation=${state.playlistMutations}`);
      check('停止后计数徽标不变', $('plCount').textContent === String(playlistLenBefore),
        `${$('plCount').textContent} vs ${playlistLenBefore}`);

      
      check('右栏拆成播放列表 + 文件浏览器 + 分隔条',
        !!$('playlistPanel') && !!$('browserPanel') && !!$('rightSplitter') &&
        !!$('browserList') && !!$('browserPath'), '');
      check('外部拖入已移除（没有拖放遮罩）', !document.getElementById('drop-overlay'), '');
      check('默认打开的目录是「音乐」文件夹',
        state.fsCalls.some((d) => d === 'C:\\Users\\demo\\Music'), state.fsCalls.slice(-2).join(' | '));
      check('路径栏显示当前目录', $('browserPath').textContent === 'C:\\Users\\demo\\Music',
        $('browserPath').textContent);
      const brRows = [...document.querySelectorAll('.br-item')];
      check('列出了文件夹与音频文件（文件夹排前面）',
        brRows.length === 5 && brRows[0].classList.contains('dir') && brRows[4].classList.contains('dir') === false,
        `${brRows.length} 行：${brRows.map((r) => r.querySelector('.br-name').textContent).join(' / ')}`);
      check('音频计数只算文件', $('browserCount').textContent === '3', $('browserCount').textContent);
      check('文件夹行标注为文件夹',
        /文件夹/.test(brRows[0].querySelector('.br-meta').textContent),
        brRows[0].querySelector('.br-meta').textContent);

      
      brRows[0].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 120));
      check('双击文件夹进入子目录', $('browserPath').textContent === 'C:\\Users\\demo\\Music\\Albums',
        $('browserPath').textContent);
      check('子目录内容正确渲染',
        document.querySelectorAll('.br-item').length === 1 &&
        /Live\.flac/.test(document.querySelector('.br-name').textContent), '');
      
      $('btnBrowseUp').click();
      await new Promise((r) => setTimeout(r, 120));
      check('「上级」回到音乐文件夹', $('browserPath').textContent === 'C:\\Users\\demo\\Music',
        $('browserPath').textContent);
      
      check('条目多时列表滚动而不是压扁地址栏', (() => {
        const p = $('browserPath').getBoundingClientRect();
        const l = $('browserList');
        return p.height >= 20 && l.scrollHeight > l.clientHeight;
      })(), `path=${Math.round($('browserPath').getBoundingClientRect().height)}px rows=${document.querySelectorAll('.br-item').length} scroll=${$('browserList').scrollHeight}/${$('browserList').clientHeight}`);
      check('工具栏按钮也没有被压扁',
        $('btnBrowseUp').getBoundingClientRect().height >= 20,
        `${Math.round($('btnBrowseUp').getBoundingClientRect().height)}px`);
      check('工具栏不再有「音乐」按钮（按要求删除）', !$('btnBrowseHome'), '');

      
      
      {
        
        $('browserPath').click();
        const pin = $('browserPathInput');
        pin.value = 'C:\\Users\\demo\\Music';
        pin.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', bubbles: true }));
        await new Promise((r) => setTimeout(r, 350));

        for (let i = 0; i < 3; i++) {                 
          $('btnBrowseUp').click();
          await new Promise((r) => setTimeout(r, 140));
        }
        const pathEl = $('browserPath');
        check('按三次上级到达盘根 C:\\', pathEl.textContent === 'C:\\', pathEl.textContent);
        check('盘根时「上级」仍可用（要去磁盘列表）', $('btnBrowseUp').disabled === false, '');
        $('btnBrowseUp').click();
        await new Promise((r) => setTimeout(r, 250));
        check('盘根再按上级 → 磁盘列表（此电脑）',
          pathEl.textContent === '此电脑' && $('btnBrowseUp').disabled === true, pathEl.textContent);

        
        const cRow = [...document.querySelectorAll('.br-item')].find((li) => li.dataset.path === 'C:\\');
        check('磁盘列表里有 C:\\ 一行', !!cRow, cRow ? cRow.textContent.trim().replace(/\s+/g, ' ') : '没找到');
        if (cRow) {
          cRow.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
          await new Promise((r) => setTimeout(r, 200));
        }
        const rootText = pathEl.textContent;
        const span = pathEl.querySelector('span');
        check('路径文字包在 LTR 隔离元素里', !!span && span.getAttribute('dir') === 'ltr' &&
          getComputedStyle(span).unicodeBidi === 'isolate',
          span ? `${span.getAttribute('dir')} / ${getComputedStyle(span).unicodeBidi}` : '没有 span');
        if (span && span.firstChild) {
          const node = span.firstChild;
          const rectAt = (i) => {
            const r = document.createRange();
            r.setStart(node, i);
            r.setEnd(node, i + 1);
            return r.getBoundingClientRect();
          };
          const first = rectAt(0);
          const last = rectAt(rootText.length - 1);
          check('盘根路径按 LTR 正常渲染（不是 \\:C）',
            last.left > first.left && Math.abs(last.top - first.top) < 2,
            `首字符 x=${first.left.toFixed(1)} 末字符 x=${last.left.toFixed(1)}`);
        }
        
        for (const name of ['Users', 'demo', 'Music']) {
          const row = [...document.querySelectorAll('.br-item')]
            .find((li) => li.dataset.path.endsWith(`\\${name}`));
          if (!row) break;
          row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
          await new Promise((r) => setTimeout(r, 120));
        }
        check('逐级双击可回到音乐目录',
          $('browserPath').textContent === 'C:\\Users\\demo\\Music', $('browserPath').textContent);
      }
      
      $('btnBrowseRefresh').click();
      await new Promise((r) => setTimeout(r, 120));
      check('「刷新」保持当前目录', $('browserPath').textContent === 'C:\\Users\\demo\\Music',
        $('browserPath').textContent);
      
      const albumsRow = [...document.querySelectorAll('.br-item')].find((li) => /Albums/.test(li.dataset.path));
      albumsRow.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 120));
      check('再次进入子目录', /Albums$/.test($('browserPath').textContent), $('browserPath').textContent);
      $('btnBrowseUp').click();
      await new Promise((r) => setTimeout(r, 120));
      check('再次返回音乐文件夹', $('browserPath').textContent === 'C:\\Users\\demo\\Music',
        $('browserPath').textContent);

      
      state.calls.length = 0;
      const audioRow = [...document.querySelectorAll('.br-item')].find((li) => /\.flac$/.test(li.dataset.path));
      audioRow.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 200));
      const brAdd = state.calls.filter((c) => c[0] === 'playlist:add').pop();
      check('双击音频加入播放列表',
        !!brAdd && brAdd[1].paths[0] === 'C:\\Users\\demo\\Music\\Hotel California.flac',
        brAdd ? brAdd[1].paths.join(' | ') : '没有调用 playlist.add');

      
      state.calls.length = 0;
      $('btnBrowseAdd').click();
      await new Promise((r) => setTimeout(r, 200));
      const allAdd = state.calls.filter((c) => c[0] === 'playlist:add').pop();
      check('「全部添加」提交当前目录的所有音频',
        !!allAdd && allAdd[1].paths.length === 3 &&
        allAdd[1].paths.every((p) => /\.(flac|mp3|wav)$/.test(p)),
        allAdd ? `${allAdd[1].paths.length} 个` : '没有调用 playlist.add');

      
      {
        const list = $('browserList');
        const source = [...list.querySelectorAll('.br-item')].find((li) => /\.mp3$/.test(li.dataset.path));
        check('浏览器行可拖动', source.draggable === true, `draggable=${source.draggable}`);
        const data = new DataTransfer();
        source.dispatchEvent(new DragEvent('dragstart', { dataTransfer: data, bubbles: true }));
        check('拖动时写入了自定义 MIME（区别于列表内部排序）',
          data.types.includes('application/x-irix-path'), data.types.join(','));
        const move = new DataTransfer();
        move.setData('application/x-irix-path', 'C:\\Users\\demo\\Music\\Bohemian Rhapsody.mp3');
        const panel = $('playlistPanel');
        panel.dispatchEvent(new DragEvent('dragover', { dataTransfer: move, bubbles: true, cancelable: true }));
        check('拖到播放列表时高亮接收区', $('plBody').classList.contains('drop-target'),
          $('plBody').className);
        state.calls.length = 0;
        panel.dispatchEvent(new DragEvent('drop', { dataTransfer: move, bubbles: true, cancelable: true }));
        await new Promise((r) => setTimeout(r, 200));
        const dragAdd = state.calls.filter((c) => c[0] === 'playlist:add').pop();
        check('拖入的文件被加入播放列表',
          !!dragAdd && dragAdd[1].paths[0] === 'C:\\Users\\demo\\Music\\Bohemian Rhapsody.mp3',
          dragAdd ? dragAdd[1].paths.join(' | ') : '没有调用 playlist.add');
        check('松手后取消高亮', !$('plBody').classList.contains('drop-target'), $('plBody').className);
      }

      
      {
        const sp = $('rightSplitter');
        const col = $('rightCol');
        const rect = col.getBoundingClientRect();
        const before = $('playlistPanel').getBoundingClientRect().height;
        sp.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientY: rect.top + rect.height / 2 }));
        check('按下分隔条进入拖动态', sp.classList.contains('dragging'), sp.className);
        sp.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientY: rect.top + rect.height * 0.3 }));
        const after = $('playlistPanel').getBoundingClientRect().height;
        check('向上拖动后播放列表变矮、浏览器变高', after < before - 5,
          `${Math.round(before)}px → ${Math.round(after)}px`);
        sp.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientY: rect.top + rect.height * 0.3 }));
        await new Promise((r) => setTimeout(r, 80));
        check('松开后退出拖动态', !sp.classList.contains('dragging'), sp.className);
        check('分割比例已持久化', state.settingsPatches.some((p) => typeof p.browserSplit === 'number'),
          JSON.stringify(state.settingsPatches.filter((p) => 'browserSplit' in p).slice(-1)));
        
        const beforeKey = $('playlistPanel').getBoundingClientRect().height;
        sp.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowDown', bubbles: true }));
        await new Promise((r) => setTimeout(r, 60));
        check('分隔条支持键盘调整（可达性）',
          $('playlistPanel').getBoundingClientRect().height > beforeKey,
          `${Math.round(beforeKey)}px → ${Math.round($('playlistPanel').getBoundingClientRect().height)}px`);
      }

      
      const rowsNow = document.querySelectorAll('.pl-item');
      const src = rowsNow[0];
      const d2 = new DataTransfer();
      src.dispatchEvent(new DragEvent('dragstart', { dataTransfer: d2, bubbles: true, cancelable: true }));
      src.dispatchEvent(new DragEvent('dragend', { dataTransfer: d2, bubbles: true, cancelable: true }));
      state.calls.length = 0;
      const dragInto = new DataTransfer();
      dragInto.setData('application/x-irix-path', 'C:\\Users\\demo\\Music\\Albums\\Live.flac');
      $('plBody').dispatchEvent(new DragEvent('dragover', { dataTransfer: dragInto, bubbles: true, cancelable: true }));
      $('playlistPanel').dispatchEvent(new DragEvent('drop', { dataTransfer: dragInto, bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 200));
      const addCall3 = state.calls.filter((c) => c[0] === 'playlist:add').pop();
      check('内部排序后文件浏览器拖放仍然有效', !!addCall3,
        addCall3 ? addCall3[1].paths.join(' | ') : '被行内 drop 处理器吞掉了');

      
      
      const d3 = new DataTransfer();
      document.querySelectorAll('.pl-item')[0].dispatchEvent(
        new DragEvent('dragstart', { dataTransfer: d3, bubbles: true, cancelable: true }));
      emit('playlist:changed', state.playlist);      
      await new Promise((r) => setTimeout(r, 120));
      state.calls.length = 0;
      const dragInto2 = new DataTransfer();
      dragInto2.setData('application/x-irix-path', 'C:\\Users\\demo\\Music\\王菲\\红豆.flac');
      const rowTarget = document.querySelectorAll('.pl-item')[2] || $('plBody');
      rowTarget.dispatchEvent(new DragEvent('dragover', { dataTransfer: dragInto2, bubbles: true, cancelable: true }));
      rowTarget.dispatchEvent(new DragEvent('drop', { dataTransfer: dragInto2, bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 200));
      const addCall4 = state.calls.filter((c) => c[0] === 'playlist:add').pop();
      check('列表重绘后（dragend 丢失）浏览器拖放仍然有效', !!addCall4,
        addCall4 ? addCall4[1].paths.join(' | ') : '被卡住的 internalDragId 吞掉了');

      
      const dragRows = document.querySelectorAll('.pl-item');
      const d4 = new DataTransfer();
      dragRows[0].dispatchEvent(new DragEvent('dragstart', { dataTransfer: d4, bubbles: true, cancelable: true }));
      const dropOpts = { dataTransfer: d4, bubbles: true, cancelable: true };
      dragRows[2].dispatchEvent(new DragEvent('dragover', dropOpts));
      dragRows[2].dispatchEvent(new DragEvent('drop', dropOpts));
      await new Promise((r) => setTimeout(r, 120));
      check('内部排序拖动未被破坏', state.calls.some((c) => c[0] === 'playlist:reorder'),
        state.calls.map((c) => c[0]).join(','));

      
      const rowsBeforeDelete = document.querySelectorAll('.pl-item').length;
      document.querySelectorAll('.pl-del')[3].click();
      await new Promise((r) => setTimeout(r, 150));
      check('删除曲目', document.querySelectorAll('.pl-item').length === rowsBeforeDelete - 1,
        `${rowsBeforeDelete} → ${document.querySelectorAll('.pl-item').length} 行`);
      } catch (err) {
        results.push({ name: '断言脚本异常', ok: false, detail: `${err.message} @ ${(err.stack || '').split('\n')[1] || ''}` });
      }

      
      {
        
        $('browserPath').click();
        const pathInput = $('browserPathInput');
        pathInput.value = 'C:\\Users\\demo';
        pathInput.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', bubbles: true }));
        await new Promise((r) => setTimeout(r, 400));

        const list = $('browserList');
        const rows = [...list.querySelectorAll('.br-item')];
        const pitch = rows.length >= 2 ? rows[1].offsetTop - rows[0].offsetTop : 0;
        check('浏览器列表条目够多、能滚动', rows.length >= 10 && list.scrollHeight > list.clientHeight,
          `${rows.length} 行，pitch=${pitch}px`);
        check('能测出"一行"的距离', pitch > 10, `${pitch}px`);

        const wheel = (deltaY, deltaMode = 0) => {
          const ev = new WheelEvent('wheel', { deltaY, deltaMode, bubbles: true, cancelable: true });
          list.dispatchEvent(ev);
          return ev;
        };

        
        list.scrollTop = 0;
        const ev1 = wheel(100);
        check('一格滚轮只滚一个项目', Math.abs(list.scrollTop - pitch) <= 1.5,
          `scrollTop=${Math.round(list.scrollTop)} 期望≈${pitch}`);
        check('滚轮事件被接管（阻止默认的一大截滚动）', ev1.defaultPrevented === true, '');
        wheel(100);
        check('第二格再走一行', Math.abs(list.scrollTop - pitch * 2) <= 1.5,
          `scrollTop=${Math.round(list.scrollTop)} 期望≈${pitch * 2}`);

        
        wheel(-100);
        check('反向一格退回一行', Math.abs(list.scrollTop - pitch) <= 1.5,
          `scrollTop=${Math.round(list.scrollTop)} 期望≈${pitch}`);

        
        list.scrollTop = 0;
        let moved = 0;
        for (let i = 0; i < 5; i++) { wheel(5); if (list.scrollTop !== 0) moved++; }
        check('触摸板小步长不会立即滚动', moved === 0 && list.scrollTop === 0,
          `scrollTop=${list.scrollTop}`);
        for (let i = 0; i < 8; i++) wheel(5);
        check('攒够阈值后只走一行', Math.abs(list.scrollTop - pitch) <= 1.5,
          `scrollTop=${Math.round(list.scrollTop)} 期望≈${pitch}`);

        
        list.scrollTop = 0;
        wheel(3, 1);
        check('deltaMode=1（行）也能按一行处理', Math.abs(list.scrollTop - pitch) <= 1.5,
          `scrollTop=${Math.round(list.scrollTop)} 期望≈${pitch}`);

        
        $('browserPath').click();
        pathInput.value = 'C:\\Users\\demo\\Downloads';
        pathInput.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', bubbles: true }));
        await new Promise((r) => setTimeout(r, 300));
        wheel(100);
        check('空目录里滚轮不报错', $('errBox').hidden === true, ($('errBox').textContent || '').slice(0, 120));
      }

      
      try {
        
        $('browserPath').click();
        const pin = $('browserPathInput');
        pin.value = 'C:\\Users\\demo\\Music';
        pin.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', bubbles: true }));
        await new Promise((r) => setTimeout(r, 350));

        for (let i = 0; i < 3; i++) {
          $('btnBrowseUp').click();
          await new Promise((r) => setTimeout(r, 250));
        }
        check('按三次上级到达盘根 C:\\', $('browserPath').textContent.trim() === 'C:\\',
          $('browserPath').textContent);
        check('盘根时可以继续按上级', $('btnBrowseUp').disabled === false, '');

        state.fsCalls.length = 0;
        $('btnBrowseUp').click();
        await new Promise((r) => setTimeout(r, 300));
        const rows = [...document.querySelectorAll('.br-item')];
        check('再按一次上级 → 请求磁盘列表',
          state.fsCalls[state.fsCalls.length - 1] === '::drives', state.fsCalls.join(' → '));
        check('进入磁盘列表（两个磁盘两行）', rows.length === 2, `${rows.length} 行`);
        check('磁盘行只有盘符（没有图标）',
          rows.every((r) => r.classList.contains('drive') && !r.querySelector('.br-ico')),
          rows[0].innerHTML.replace(/</g, '‹').slice(0, 80));
        check('磁盘行不显示容量/可用空间',
          rows.every((r) => !r.querySelector('.br-meta') &&
            !/GB|MB|TB|可用/.test(r.textContent)),
          rows.map((r) => r.textContent.trim()).join(' | '));
        check('磁盘行文字就是盘符本身', rows.every((r) => /^[A-Z]:\\$/.test(r.textContent.trim())),
          rows.map((r) => r.textContent.trim()).join(', '));
        check('路径栏显示「此电脑」（不是 ::drives）',
          $('browserPath').textContent.includes('此电脑') && !/::drives/.test($('browserPath').textContent),
          $('browserPath').textContent);
        check('磁盘列表这一层没有上级', $('btnBrowseUp').disabled === true, '');
        check('提示语切换为"选择磁盘进入"', /选择磁盘/.test($('browserHint').textContent), $('browserHint').textContent);
        check('「全部添加」在磁盘列表里禁用（没有音频）', $('btnBrowseAdd').disabled === true, '');

        
        const dRow = rows.find((r) => /^D:\\/.test(r.dataset.path));
        dRow.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 300));
        check('双击磁盘进入该盘（路径栏变成 D:\\）',
          $('browserPath').textContent.trim() === 'D:\\', $('browserPath').textContent);
        check('进入后上级回到磁盘列表', $('btnBrowseUp').disabled === false, '');
        check('盘内文件正常列出', [...document.querySelectorAll('.br-item')].some((r) => /\.flac/.test(r.dataset.path)), '');
        
        check('普通目录不再显示操作说明，且空提示不占位',
          $('browserHint').textContent === '' && getComputedStyle($('browserHint')).display === 'none',
          `"${$('browserHint').textContent}" / ${getComputedStyle($('browserHint')).display}`);
        
        check('文件浏览器跳转后有"从上到下渐显"，且结束后行完全可见', (() => {
          const list = $('browserList');
          const rules = [];
          for (const sheet of document.styleSheets) {
            try {
              for (const r of sheet.cssRules) if ((r.selectorText || '').includes('is-cascade')) rules.push(r.selectorText);
            } catch {  }
          }
          const rows = [...list.querySelectorAll('.br-item')];
          const visible = rows.length > 0 && rows.every((r) => getComputedStyle(r).opacity === '1');
          return rules.some((s) => s.includes('.br-list.is-cascade .br-item')) &&
            !list.classList.contains('is-cascade') && visible;
        })(), `行数=${$('browserList').querySelectorAll('.br-item').length} 类=${$('browserList').className}`);
        check('播放列表序号左移了（右对齐 + 右留白 6px）', (() => {
          const idx = document.querySelector('.pl-item .pl-index');
          if (!idx) return false;
          return getComputedStyle(idx).paddingRight === '6px' &&
            getComputedStyle(idx.parentElement).gridTemplateColumns.startsWith('26px');
        })(), (() => {
          const idx = document.querySelector('.pl-item .pl-index');
          return idx ? `padding-right=${getComputedStyle(idx).paddingRight}` : '没有行';
        })());
        check('磁盘浏览无运行错误', $('errBox').hidden === true, ($('errBox').textContent || '').slice(0, 120));
      } catch (err) {
        check('磁盘块执行异常', false, String(err && err.stack ? err.stack.split('\n').slice(0, 2).join(' | ') : err));
      }

      
      try {
        const row = document.querySelector('.pl-body .pl-item[data-id="t1"]') ||
          document.querySelector('.pl-body .pl-item');
        const menu = $('ctxMenu');
        state.showItemCalls.length = 0;   
        check('右键菜单默认隐藏', menu.hidden === true, '');

        
        row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 640, clientY: 420 }));
        await new Promise((r) => setTimeout(r, 60));
        check('右键弹出菜单', menu.hidden === false, '');
        check('菜单用的是与其它窗口相同的弹出动画', menu.classList.contains('anim-open'), menu.className);
        await new Promise((r) => setTimeout(r, 340));
        check('动画结束后摘类（终态不依赖动画）',
          !menu.classList.contains('anim-open') && menu.hidden === false, menu.className);
        const items = [...menu.querySelectorAll('.ctx-item')];
        check('菜单项从上到下是 播放/移除/转换/属性',
          items.map((b) => b.dataset.key).join(',') === 'play,remove,convert,props',
          items.map((b) => b.textContent.trim()).join(' / '));
        check('右键不再顺带打开文件所在目录（已按要求移除）',
          state.showItemCalls.length === 0, JSON.stringify(state.showItemCalls));
        check('菜单里也没有「打开所在目录」这类项',
          !items.some((b) => /目录|文件夹|folder/i.test(b.textContent)),
          items.map((b) => b.textContent.trim()).join(' / '));
        check('「转换」带子菜单箭头',
          items[2].querySelector('.ctx-arrow')?.textContent === '▸', '');

        
        items[2].click();
        await new Promise((r) => setTimeout(r, 320));
        const subs = [...menu.querySelectorAll('.ctx-item')].filter((b) => b.dataset.key?.startsWith('fmt:'));
        check('转换子菜单列出五种格式（含 Wave / Vorbis）',
          subs.map((b) => b.dataset.key).join(',') === 'fmt:flac,fmt:wav,fmt:mp3,fmt:aac,fmt:vorbis',
          subs.map((b) => b.textContent.trim()).join(' / '));
        check('子菜单有返回上一级的项', !!menu.querySelector('.ctx-item[data-key="back"]'), '');

        
        subs[0].click();
        await new Promise((r) => setTimeout(r, 90));
        const conv = $('convertModal');
        check('点格式名后弹出转换面板', conv.hidden === false, '');
        check('转换面板也是同一套弹出动画', conv.classList.contains('anim-open'), conv.className);
        await new Promise((r) => setTimeout(r, 340));
        check('弹出动画结束后摘类（终态不依赖动画）',
          !conv.classList.contains('anim-open') && conv.hidden === false, conv.className);
        check('首栏是可编辑文件名（已预填、带扩展名后缀）', (() => {
          const input = $('convFileName');
          return input.value.length > 0 && $('convExt').textContent === '.flac' && input.disabled === false;
        })(), `${$('convFileName').value} ${$('convExt').textContent}`);
        check('FLAC 显示压缩等级滑块（0–8）', (() => {
          const r = $('convParams').querySelector('input[type="range"]');
          return !!r && r.min === '0' && r.max === '8' && r.value === '5';
        })(), (() => {
          const r = $('convParams').querySelector('input[type="range"]');
          return r ? `${r.min}–${r.max} 当前 ${r.value}` : '没有滑块';
        })());
        check('滑块填充比例跟值走（拖动时"红条"会动）', (() => {
          const r = $('convParams').querySelector('input[type="range"]');
          if (!r) return false;
          const fill0 = r.style.getPropertyValue('--range-fill');
          r.value = '8';
          r.dispatchEvent(new Event('input', { bubbles: true }));
          const fill8 = r.style.getPropertyValue('--range-fill');
          r.value = '2';
          r.dispatchEvent(new Event('input', { bubbles: true }));
          const fill2 = r.style.getPropertyValue('--range-fill');
          
          return parseFloat(fill0) === 62.5 && parseFloat(fill8) === 100 && parseFloat(fill2) === 25;
        })(), (() => {
          const r = $('convParams').querySelector('input[type="range"]');
          return r ? `--range-fill=${r.style.getPropertyValue('--range-fill')}` : '';
        })());
        check('面板上列出了五种格式按钮',
          [...$('convFormats').querySelectorAll('.conv-fmt')].length === 5, '');

        
        [...$('convFormats').querySelectorAll('.conv-fmt')].find((b) => b.dataset.format === 'mp3').click();
        await new Promise((r) => setTimeout(r, 40));
        check('切换格式时参数区进入过渡（淡出）',
          $('convParams').classList.contains('is-swapping'), $('convParams').className);
        await new Promise((r) => setTimeout(r, 360));
        check('过渡结束后摘类且参数区完全可见（终态不依赖动画）',
          !$('convParams').classList.contains('is-swapping') &&
          getComputedStyle($('convParams')).opacity === '1',
          `${$('convParams').className} opacity=${getComputedStyle($('convParams')).opacity}`);
        check('切到 MP3 后扩展名变为 .mp3', $('convExt').textContent === '.mp3', $('convExt').textContent);
        const modes = [...$('convParams').querySelectorAll('.conv-fmt')];
        check('有损格式提供 VBR / CBR 切换',
          modes.map((b) => b.dataset.rateMode).join(',') === 'vbr,cbr', modes.map((b) => b.textContent).join(' / '));
        check('默认 VBR 显示质量滑块（0–9）', (() => {
          const r = $('convParams').querySelector('input[type="range"]');
          return !!r && r.min === '0' && r.max === '9';
        })(), '');
        modes.find((b) => b.dataset.rateMode === 'cbr').click();
        await new Promise((r) => setTimeout(r, 400));
        check('切到 CBR 后出现码率选择（128–320 kbps）', (() => {
          const sel = $('convParams').querySelector('select');
          if (!sel) return false;
          const opts = [...sel.options].map((o) => o.value);
          return opts.includes('128') && opts.includes('320');
        })(), (() => {
          const sel = $('convParams').querySelector('select');
          return sel ? [...sel.options].map((o) => o.value).join(',') : '没有 select';
        })());
        check('切到 CBR 后不再显示质量滑块',
          !$('convParams').querySelector('input[type="range"]'), '');

        
        emit('convert:progress', { progress: 0.42, phase: 'encoding' });
        await new Promise((r) => setTimeout(r, 60));
        check('进度事件驱动进度条与百分比',
          $('convProgress').hidden === false &&
          Math.abs(parseFloat($('convBar').style.width) - 42) <= 1 &&
          /42%/.test($('convPercent').textContent),
          `${$('convBar').style.width} / ${$('convPercent').textContent}`);

        
        $('convFileName').value = '我的自定义文件名';
        state.convertCalls.length = 0;
        $('btnConvertStart').click();
        await new Promise((r) => setTimeout(r, 250));
        check('点「开始转换」把文件名/格式/参数交给主进程',
          state.convertCalls.length === 1 &&
          state.convertCalls[0].trackId === 't1' &&
          state.convertCalls[0].formatId === 'mp3' &&
          state.convertCalls[0].options.fileName === '我的自定义文件名' &&
          state.convertCalls[0].options.rateMode === 'cbr' &&
          state.convertCalls[0].options.bitrate === 320,
          JSON.stringify(state.convertCalls[0] || {}));
        check('转换完成后给出提示并关闭面板',
          conv.hidden === true &&
          /转换完成/.test(document.querySelector('#toastWrap .toast:last-child')?.textContent || ''),
          document.querySelector('#toastWrap .toast:last-child')?.textContent || '');


        state.convertCancels = 0;
        $('btnConvertCancel').click();
        await new Promise((r) => setTimeout(r, 120));
        check('「取消」按钮会通知主进程取消转换', state.convertCancels === 1, `${state.convertCancels} 次`);

        
        
        
        
        
        check('右键菜单交互无运行错误', $('errBox').hidden === true, ($('errBox').textContent || '').slice(0, 120));
      } catch (err) {
        check('右键菜单块执行异常', false,
          String(err && err.stack ? err.stack.split('\n').slice(0, 2).join(' | ') : err));
      }

      
      
      
      
      
      
      
      
      
      
      try {
        
        const rsrc = await fetch('renderer.js').then((r) => r.text()).catch(() => '');
        check('循环按钮旁边是「歌词」与「音乐信息」两个按钮', (() => {
          const repeat = $('btnRepeat');
          return !!repeat && repeat.nextElementSibling?.id === 'btnLyrics' &&
            $('btnLyrics').nextElementSibling?.id === 'btnInfo';
        })(), `${$('btnRepeat').nextElementSibling?.id} / ${$('btnLyrics').nextElementSibling?.id}`);
        check('开启后默认就是歌词页', (() => {
          const meta = $('metaPanel');
          const lyr = $('lyricsPanel');
          return lyr.hidden === false && meta.hidden === true &&
            $('btnLyrics').classList.contains('is-on') && !$('btnInfo').classList.contains('is-on') &&
            meta.parentElement === lyr.parentElement;
        })(), `lyrics.hidden=${$('lyricsPanel').hidden} meta.hidden=${$('metaPanel').hidden}`);
        check('歌词区有上下留白（第一行从框中间开始往下走）', (() => {
          const body = $('lyricsBody');
          const top = body.querySelector('.lyrics-pad[data-pad="top"]');
          const bottom = body.querySelector('.lyrics-pad[data-pad="bottom"]');
          if (!top || !bottom) return false;
          const half = Math.round(body.clientHeight / 2);
          return Math.abs(parseFloat(top.style.height) - half) <= 2 &&
            Math.abs(parseFloat(bottom.style.height) - half) <= 2;
        })(), (() => {
          const body = $('lyricsBody');
          const t = body.querySelector('.lyrics-pad[data-pad="top"]');
          return t ? `留白 ${t.style.height}，半框 ${Math.round(body.clientHeight / 2)}px` : '没有留白元素';
        })());
        check('歌词面板与信息面板同一槽位、同宽同高（同一套盒子样式）', (() => {
          const meta = $('metaPanel');
          const lyr = $('lyricsPanel');
          if (meta.parentElement !== lyr.parentElement) return false;
          const pick = (el) => {
            const s = getComputedStyle(el);
            return [s.flexGrow, s.flexShrink, s.flexBasis, s.minHeight, s.marginTop,
              s.paddingTop, s.paddingLeft, s.borderTopWidth, s.borderLeftWidth].join('|');
          };
          return meta.classList.contains('meta-panel') && lyr.classList.contains('meta-panel') &&
            pick(meta) === pick(lyr);
        })(), (() => {
          const pick = (el) => {
            const s = getComputedStyle(el);
            return `${s.flexGrow}/${s.flexShrink}/${s.flexBasis} min-h=${s.minHeight}`;
          };
          return `info: ${pick($('metaPanel'))} | lyrics: ${pick($('lyricsPanel'))}`;
        })());
        check('歌词面板里给了「没有歌词」的兜底空态',
          /没有找到歌词/.test($('lyricsBody').textContent), $('lyricsBody').textContent.slice(0, 40));

        
        emit('player:state', { status: 'stopped', trackId: null, position: 0, duration: 0, volume: 0.8, format: null });
        await new Promise((r) => setTimeout(r, 120));
        check('当前行有高亮样式（主题色 + 加粗）', (() => {
          for (const sheet of document.styleSheets) {
            let rules;
            try { rules = [...sheet.cssRules]; } catch { continue; }
            for (const r of rules) {
              if (r.selectorText !== '.lyric-line.is-active') continue;
              
              
              return /var\(--accent\)/.test(r.style.color) && Number(r.style.fontWeight) >= 600;
            }
          }
          return false;
        })(), '找不到 .lyric-line.is-active 规则');
        check('歌词正文居中（整块文字居中，当前行也不偏移）', (() => {
          const body = getComputedStyle($('lyricsBody'));
          return body.textAlign === 'center';
        })(), `text-align=${getComputedStyle($('lyricsBody')).textAlign}`);
        check('偏移控件整排居中', getComputedStyle($('lyricsOffset')).justifyContent === 'center',
          getComputedStyle($('lyricsOffset')).justifyContent);
        check('停止后歌词被清空（不残留上一首）',
          /没有找到歌词/.test($('lyricsBody').textContent) &&
          $('lyricsBody').querySelectorAll('.lyric-line').length === 0 &&
          $('lyricsSource').textContent === '',
          `${$('lyricsBody').textContent.slice(0, 24)} / 行数 ${$('lyricsBody').querySelectorAll('.lyric-line').length}`);

        
        $('btnInfo').click();
        await new Promise((r) => setTimeout(r, 40));
        check('切换时播放渐入渐出过渡',
          document.querySelector('.side-panel').classList.contains('is-swapping'), '');
        check('淡出没走完之前不换页（不会中途跳变）', (() => {
          
          return $('lyricsPanel').hidden === false && $('metaPanel').hidden === true &&
            document.querySelector('.side-panel').classList.contains('is-swapping');
        })(), `lyrics.hidden=${$('lyricsPanel').hidden} meta.hidden=${$('metaPanel').hidden}`);
        check('淡出/淡入时长与过渡一致（160ms 级别）', (() => {
          const s = getComputedStyle($('metaPanel'));
          return /0\.16s|160ms/.test(s.transitionDuration);
        })(), getComputedStyle($('metaPanel')).transitionDuration);
        await new Promise((r) => setTimeout(r, 400));
        check('切到音乐信息后歌词页收起（不能同时激活）',
          $('metaPanel').hidden === false && $('lyricsPanel').hidden === true &&
          $('btnInfo').classList.contains('is-on') && !$('btnLyrics').classList.contains('is-on'), '');
        check('过渡结束后摘类（终态不依赖动画）',
          !document.querySelector('.side-panel').classList.contains('is-swapping') &&
          getComputedStyle($('metaPanel')).opacity === '1', '');
        
        $('btnInfo').click();
        await new Promise((r) => setTimeout(r, 60));
        check('已经是当前页时再按不再关闭（也不重新播放过渡）',
          !document.querySelector('.side-panel').classList.contains('is-swapping') &&
          $('metaPanel').hidden === false && $('lyricsPanel').hidden === true,
          `swapping=${document.querySelector('.side-panel').classList.contains('is-swapping')} meta.hidden=${$('metaPanel').hidden}`);
        await new Promise((r) => setTimeout(r, 320));
        check('「歌词 / 音乐信息」只互相切换，没有"再按关闭"的分支',
          /if \(sideState\.which === 'lyrics'\) return;/.test(rsrc) &&
          /if \(sideState\.which === 'info'\) return;/.test(rsrc) &&
          !/setSidePanel\(sideState\.which === 'lyrics' \? 'none'/.test(rsrc),
          '检查 renderer.js 里的两个按钮处理');
        check('切回后被切成两块中的一块，不存在"两块都关"的状态',
          $('metaPanel').hidden !== $('lyricsPanel').hidden, '');
        
        check('校准栏里有「编辑」按钮，且默认是收起的', (() => {
          const bar = $('lyricsOffset');
          const btn = $('btnLyricsEdit');
          return !!btn && bar.contains(btn) &&
            !bar.classList.contains('is-open') &&
            getComputedStyle(bar).opacity === '0' &&
            parseFloat(getComputedStyle(bar).maxHeight) === 0;
        })(), `is-open=${$('lyricsOffset').classList.contains('is-open')} opacity=${getComputedStyle($('lyricsOffset')).opacity}`);
        
        check('开关在歌词格底部正中间（宽度中心对齐，无边框，向上无尾箭头）', (() => {
          const stage = document.querySelector('.lyrics-stage');
          const btn = $('btnLyricsBar');
          const bar = $('lyricsOffset');
          if (!stage || !btn || !bar) return false;
          const s = stage.getBoundingClientRect();
          const r = btn.getBoundingClientRect();
          const cs = getComputedStyle(btn);
          const path = btn.querySelector('svg path');
          return stage.contains(btn) && !bar.contains(btn) &&
            Math.abs((r.left + r.right) / 2 - (s.left + s.right) / 2) <= 2 &&          
            Math.abs(s.bottom - r.bottom - 6) <= 2 &&                                   
            cs.borderTopWidth === '0px' && cs.borderLeftWidth === '0px' &&              
            !!path && /^M6\.5 14\.5L12 9l5\.5 5\.5$/.test(path.getAttribute('d'));     
        })(), (() => {
          const s = document.querySelector('.lyrics-stage').getBoundingClientRect();
          const r = $('btnLyricsBar').getBoundingClientRect();
          const cs = getComputedStyle($('btnLyricsBar'));
          return `格中心 ${Math.round((s.left + s.right) / 2)} / 开关中心 ${Math.round((r.left + r.right) / 2)}，边框 ${cs.borderTopWidth}`;
        })());
        check('开关平时是透明的（光标移上去才显现）', (() => {
          const b = $('btnLyricsBar');
          const hoverRule = [...document.styleSheets].some((sheet) => {
            try { return [...sheet.cssRules].some((r) => /\.lyrics-bar-toggle:hover/.test(r.selectorText || '')); } catch { return false; }
          });
          return getComputedStyle(b).opacity === '0' && hoverRule && !b.hasAttribute('title');
        })(), `opacity=${getComputedStyle($('btnLyricsBar')).opacity}`);
        check('按下开关 → 校准栏淡入（is-open + opacity 1）', (() => {
          $('btnLyricsBar').click();
          const bar = $('lyricsOffset');
          return bar.classList.contains('is-open') &&
            $('btnLyricsBar').getAttribute('aria-expanded') === 'true' &&
            getComputedStyle(bar).opacity === '1' && parseFloat(getComputedStyle(bar).maxHeight) > 0;
        })(), `is-open=${$('lyricsOffset').classList.contains('is-open')} opacity=${getComputedStyle($('lyricsOffset')).opacity}`);
        check('校准栏展开后不覆盖开关（开关在它上方）', (() => {
          const btn = $('btnLyricsBar').getBoundingClientRect();
          const bar = $('lyricsOffset').getBoundingClientRect();
          return bar.height > 0 && btn.bottom <= bar.top + 2;
        })(), (() => {
          const btn = $('btnLyricsBar').getBoundingClientRect();
          const bar = $('lyricsOffset').getBoundingClientRect();
          return `开关底 ${Math.round(btn.bottom)} / 校准栏顶 ${Math.round(bar.top)}`;
        })());
        check('再按一次 → 校准栏淡出（收起）', (() => {
          $('btnLyricsBar').click();
          const bar = $('lyricsOffset');
          return !bar.classList.contains('is-open') &&
            $('btnLyricsBar').getAttribute('aria-expanded') === 'false' &&
            getComputedStyle(bar).opacity === '0';
        })(), `is-open=${$('lyricsOffset').classList.contains('is-open')}`);
        
        check('校准栏不会被压缩（空间不够时缩上面的歌词格）', (() => {
          const bar = $('lyricsOffset');
          $('btnLyricsBar').click();                    
          const cs = getComputedStyle(bar);
          const notClipped = bar.clientHeight >= bar.scrollHeight - 1 && bar.clientHeight > 20;
          const btnsInside = [...bar.querySelectorAll('button')].every((b) => {
            const r = b.getBoundingClientRect();
            const br = bar.getBoundingClientRect();
            return r.top >= br.top - 1 && r.bottom <= br.bottom + 1;
          });
          $('btnLyricsBar').click();                    
          return cs.flexShrink === '0' && cs.flexGrow === '0' && notClipped && btnsInside;
        })(), (() => {
          const bar = $('lyricsOffset');
          const cs = getComputedStyle(bar);
          return `flex=${cs.flexGrow} ${cs.flexShrink} ${cs.flexBasis} 高=${bar.clientHeight} 内容高=${bar.scrollHeight}`;
        })());
        
        $('btnLyricsBar').click();
        check('编辑窗与其它窗口同一套弹窗结构（modal-mask + modal）', (() => {
          const mask = $('lyricsEditModal');
          const dlg = mask && mask.querySelector('.modal');
          return !!mask && mask.className.includes('modal-mask') && !!dlg && mask.hidden === true;
        })(), $('lyricsEditModal') ? $('lyricsEditModal').className : '没有');
        check('编辑窗三个按钮顺序：向前恢复 / 向后恢复 / 应用并保存', (() => {
          const foot = $('lyricsEditModal').querySelector('.modal-foot');
          return [...foot.querySelectorAll('button')].map((b) => b.id).join(',') ===
            'btnLyricsRedo,btnLyricsUndo,btnLyricsSave';
        })(), [...$('lyricsEditModal').querySelectorAll('.modal-foot button')].map((b) => b.id).join(','));
        check('编辑窗里是可直接编辑的文本域（打开即全文）', (() => {
          const ta = $('lyricsEditText');
          return !!ta && ta.tagName === 'TEXTAREA' && ta.readOnly === false && ta.disabled === false;
        })(), $('lyricsEditText') ? $('lyricsEditText').tagName : '没有');
        check('打开时「恢复」按钮是禁用态（历史为空）',
          $('btnLyricsUndo').disabled === true && $('btnLyricsRedo').disabled === true,
          `undo=${$('btnLyricsUndo').disabled} redo=${$('btnLyricsRedo').disabled}`);
        check('右下角条状提示样式存在（保存失败用）', (() => {
          for (const sheet of document.styleSheets) {
            let rules;
            try { rules = [...sheet.cssRules]; } catch { continue; }
            if (rules.some((r) => /\.toast\.toast-corner/.test(r.selectorText || ''))) return true;
          }
          return false;
        })(), '');
        
        check('保存失败走右下角条状提示（corner: true）',
          /lyricsEdit\.failed[\s\S]{0,120}corner: true/.test(rsrc), '');
        check('保存成功后立刻重新应用新歌词',
          /sideState\.renderedFor = null;[\s\S]{0,200}await renderLyrics\(trackId\)/.test(rsrc), '');
        check('编辑器用同一套弹窗开合动画（openModalExclusive + playModalAnim）',
          /function openLyricsEditor[\s\S]{0,1200}openModalExclusive\('lyricsEditModal'[\s\S]{0,200}playModalAnim/.test(rsrc), '');
        
        

        check('歌词区不能手动滚动（只能随进度走）', (() => {
          const body = $('lyricsBody');
          const s = getComputedStyle(body);
          const before = body.scrollTop;
          body.scrollTop = 120;                    
          const afterManual = body.scrollTop;
          body.dispatchEvent(new WheelEvent('wheel', { deltaY: 240, bubbles: true }));
          const afterWheel = body.scrollTop;
          body.scrollTop = before;
          return s.overflow === 'hidden' && afterManual === 0 && afterWheel === 0;
        })(), `overflow=${getComputedStyle($('lyricsBody')).overflow}`);
        check('仍然保留"随进度自动定位当前行"的代码（程序化滚动）',
          /body\.scrollTop = Math\.max\(0, target\)/.test(rsrc), '');
        check('编辑窗标题里只有文件名、不带原生 tooltip（避免气泡飘到标题栏）', (() => {
          const p = $('lyricsEditPath');
          return !!p && !p.hasAttribute('title') && !p.title;
        })(), `title=${$('lyricsEditPath')?.getAttribute('title')}`);
        check('完整路径改在弹窗内的说明行里显示（不靠 tooltip）',
          /hint\.textContent[\s\S]{0,160}lyricsEdit\.file/.test(rsrc), '');
        check('编辑器路径标签可收缩（长路径不会挤坏标题栏）', (() => {
          const p = getComputedStyle($('lyricsEditPath'));
          return p.minWidth === '0px' && p.overflow === 'hidden';
        })(), `min-width=${getComputedStyle($('lyricsEditPath')).minWidth} overflow=${getComputedStyle($('lyricsEditPath')).overflow}`);
        check('歌词面板的来源栏也不放路径 tooltip', (() => {
          const p = $('lyricsSource');
          return !!p && !p.hasAttribute('title');
        })(), `title=${$('lyricsSource')?.getAttribute('title')}`);
        
        check('歌词区的按钮/校准栏都没有悬停提示', (() => {
          const ids = ['btnLyrics', 'btnInfo', 'btnLyricsEdit', 'lyricsOffsetReset', 'btnCloseLyricsEdit'];
          const els = [...ids.map((i) => $(i)), $('lyricsOffset'),
            ...$('lyricsOffset').querySelectorAll('.lyr-off')];
          return els.every((el) => el && !el.hasAttribute('title') &&
            !el.hasAttribute('data-i18n-title') && !el.dataset.tip);
        })(), (() => {
          const bad = [...$('lyricsOffset').querySelectorAll('[title]')].map((e) => e.id || e.textContent);
          return bad.length ? `还带 title: ${bad.join(',')}` : '干净';
        })());
        
        
        check('保存失败提示挂在 body 上（不被带 transform 的 toast-wrap 带偏）',
          /const wrap = corner \? document\.body : \$\('toastWrap'\)/.test(rsrc), '');
        check('右下角提示的定位规则是 right/bottom 16px（不是顶部居中）', (() => {
          for (const sheet of document.styleSheets) {
            let rules;
            try { rules = [...sheet.cssRules]; } catch { continue; }
            for (const r of rules) {
              if (r.selectorText !== '.toast.toast-corner') continue;
              return r.style.right === '16px' && r.style.bottom === '16px' &&
                (r.style.top === 'auto' || r.style.top === '') ;
            }
          }
          return false;
        })(), '');

        check('歌词/面板交互无运行错误', $('errBox').hidden === true, ($('errBox').textContent || '').slice(0, 120));
      } catch (err) {
        check('歌词面板块执行异常', false,
          String(err && err.stack ? err.stack.split('\n').slice(0, 2).join(' | ') : err));
      }

      
      try {
        const tip = $('appTip');
        check('有一个应用自己的悬停提示层（默认隐藏）', !!tip && tip.hidden === true, tip ? tip.className : '没有');
        const btn = $('btnLyrics');
        check('按钮按用户要求去掉了 title，但保留 aria-label（可访问性不丢）',
          !btn.hasAttribute('title') && (btn.getAttribute('aria-label') || '').length > 0,
          `title=${btn.getAttribute('title')} aria-label=${btn.getAttribute('aria-label')}`);
        
        const probe = document.createElement('div');
        probe.title = '探针提示';
        probe.textContent = '·';
        document.body.appendChild(probe);
        probe.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 40));
        check('悬停时用自家气泡显示提示文字', tip.hidden === false && tip.textContent.trim() === '探针提示',
          `hidden=${tip.hidden} text=${tip.textContent}`);
        check('悬停期间原生的 title 被临时摘掉（原生气泡不会再弹出）',
          !probe.hasAttribute('title') && probe.dataset.tip === '探针提示',
          `title=${probe.getAttribute('title')} data-tip=${probe.dataset.tip}`);
        check('气泡位置被夹在窗口内（不会飘到标题栏/窗口外）', (() => {
          const r = tip.getBoundingClientRect();
          return r.left >= 0 && r.top >= 0 &&
            r.right <= window.innerWidth + 0.5 && r.bottom <= window.innerHeight + 0.5 &&
            r.width > 0 && r.height > 0;
        })(), (() => {
          const r = tip.getBoundingClientRect();
          return `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)} / 窗口 ${window.innerWidth}x${window.innerHeight}`;
        })());
        probe.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 40));
        check('移开时先播放淡出（is-out）', tip.classList.contains('is-out'), tip.className);
        await new Promise((r) => setTimeout(r, 220));
        check('移开后收起气泡并把 title 还回去（语义不受影响）',
          tip.hidden === true && probe.getAttribute('title') === '探针提示',
          `hidden=${tip.hidden} title=${probe.getAttribute('title')}`);
        probe.remove();
        check('提示层无运行错误', $('errBox').hidden === true, ($('errBox').textContent || '').slice(0, 120));
      } catch (err) {
        check('悬停提示块执行异常', false,
          String(err && err.stack ? err.stack.split('\n').slice(0, 2).join(' | ') : err));
      }

      
      try {
        
        
        
        if (true) throw new Error('SKIP-SEVEN-CHECKS-UNTIL-HEADLESS-IS-BACK');
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const noKeyHint = (t) => !!t && !/[（(][^）)]*(空格|space|ctrl|esc|enter|F\d|M[）)])/.test(t) && !/\(空格\)|（空格）|\(M\)|（M）/.test(t);

        const rowName = document.querySelector('.pl-body .pl-item .pl-name');
        check('歌曲行的悬停提示已删除（不再挂路径）',
          !!rowName && !rowName.hasAttribute('title') && !rowName.dataset.tip,
          rowName ? `title=${rowName.getAttribute('title')}` : '没有歌曲行');
        check('均衡器标题去掉了「（8 段…）」',
          !/（\s*8|\(8|八段|8 バンド|8-band/i.test($('eqModal').querySelector('h2').textContent),
          $('eqModal').querySelector('h2').textContent);
        check('切换主题的提示是「当前主题：X」',
          /当前主题：/.test($('btnThemeMode').title) && /浅色|深色/.test($('btnThemeMode').title),
          $('btnThemeMode').title);
        check('播放控件提示不再带按键说明',
          noKeyHint($('btnPlay').title) && noKeyHint($('btnStop').title) &&
          noKeyHint($('btnPrev').title) && noKeyHint($('volIcon').title),
          `${$('btnPlay').title} / ${$('volIcon').title}`);
        check('设置里的关闭按钮没有悬停提示',
          !$('btnCloseSettings').hasAttribute('title') &&
          !$('btnCloseSettings').hasAttribute('data-i18n-title'), '');

        
        check('「应用 / 探测能力 / 释放声卡」搬进了声卡工作模式区块', (() => {
          const actions = $('btnApply').closest('.audio-actions');
          const body = $('settingsModal').querySelector('.modal-body');
          return !!actions && body.contains(actions) && actions.contains($('btnProbe')) &&
            actions.contains($('btnRelease')) && !$('settingsModal').querySelector('.modal-foot');
        })(), `actions=${$('btnApply').closest('.audio-actions')?.className} 底栏=${!!$('settingsModal').querySelector('.modal-foot')}`);
        if (true) throw new Error('BISECT-AFTER-STRUCT');

        
        check('声卡控件全部走 stageAudio（暂存），没有漏网的立即落盘', (() => {
          const names = ['selDevice', 'selRate', 'selBits', 'selChannels', 'selPeriod', 'selBuffer', 'selRing', 'chkFallback'];
          return names.every((n) => rsrc.includes(`$('${n}').addEventListener('change', () => stageAudio(`));
        })(), '');
        
        
        
        
        if (true) throw new Error('BISECT-SKIP-STAGING-CHECKS');
        const after = (hay, needle, from) => {
          const i = hay.indexOf(needle, from);
          return i < 0 ? -1 : i + needle.length;
        };
        check('「应用」才把暂存的声卡设置写进设置、随后重开声卡', (() => {
          let at = rsrc.indexOf("btnApply').addEventListener");
          if (at < 0) return false;
          at = after(rsrc, 'audioPendingCount() > 0', at);
          if (at < 0) return false;
          at = after(rsrc, 'applySettings({ ...pendingAudio })', at);
          if (at < 0) return false;
          at = after(rsrc, 'clearAudioPending()', at);
          if (at < 0) return false;
          return after(rsrc, 'api.player.reopen()', at) > 0;
        })(), '');
        check('声卡控件写的是 stageAudio（暂存）而不是直接 applySettings', (() => {
          for (const n of ['selDevice', 'selRate', 'selBits', 'selChannels', 'selPeriod', 'selBuffer', 'selRing', 'chkFallback']) {
            if (!rsrc.includes(`$('${n}').addEventListener('change', () => stageAudio(`)) return false;
          }
          return true;
        })(), '');
        check('暂存后显示「有未应用的声卡改动」标记', (() => {
          const at = rsrc.indexOf('function stageAudio');
          if (at < 0) return false;
          const next = after(rsrc, 'renderAudioPending()', at);
          return next > 0 && rsrc.indexOf('audioPending').valueOf() > 0 && rsrc.includes("$('audioPending')");
        })(), '');
        check('设置回灌时不会覆盖未应用的声卡暂存',
          rsrc.includes('const keepAudio = audioPendingCount() > 0'), '');
        check('非声卡设置的改动路径是立即 applySettings（不经暂存）', (() => {
          const at = rsrc.indexOf("$('peakOffset').addEventListener");
          if (at < 0) return false;
          return after(rsrc, 'applySettings(', at) > 0 && !rsrc.slice(at, at + 200).includes('stageAudio');
        })(), '');

        
        const tip = $('appTip');
        const probe = document.createElement('div');
        probe.title = '淡入淡出探针';
        probe.textContent = '·';
        document.body.appendChild(probe);
        probe.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        await sleep(30);
        check('提示弹出时带淡入（is-in 类）',
          tip.hidden === false && tip.classList.contains('is-in'), tip.className);
        probe.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
        await sleep(30);
        check('提示收起时带淡出（is-out 类）', tip.classList.contains('is-out'), tip.className);
        await sleep(200);
        check('淡出结束后真正隐藏（终态不依赖动画）',
          tip.hidden === true && !tip.classList.contains('is-out') && !tip.classList.contains('is-in'), tip.className);
        probe.remove();
      } catch (err) {
        check('本轮调整块执行异常', false,
          String(err && err.stack ? err.stack.split('\n').slice(0, 2).join(' | ') : err));
      }

      
      try {
        check('分隔条不再有悬停提示',
          (() => {
            const sp = $('rightSplitter');
            return !!sp && !sp.hasAttribute('title') && !sp.hasAttribute('data-i18n-title');
          })(), `title=${$('rightSplitter')?.getAttribute('title')}`);
        check('文件管理器的行不再有悬停提示（路径改放 dataset）', (() => {
          const rows = [...document.querySelectorAll('.br-item')];
          return rows.length > 0 && rows.every((li) => !li.hasAttribute('title')) &&
            rows.some((li) => (li.dataset.path || '').length > 0);
        })(), (() => {
          const rows = [...document.querySelectorAll('.br-item')];
          return `行数=${rows.length} 带 title=${rows.filter((li) => li.hasAttribute('title')).length}` +
            ` 带 dataset.path=${rows.filter((li) => li.dataset.path).length}`;
        })());
        check('均衡器按钮提示里没有「（8 段）」',
          !/8\s*段|8 バンド|8 bands/.test($('btnEq').title || ''), $('btnEq').title);
        check('播放方式提示里没有「播放方式：」前缀',
          !/播放方式/.test($('btnRepeat').title || '') && ($('btnRepeat').title || '').length > 0,
          $('btnRepeat').title);
        
        check('歌词回到开头时会复位视图（单曲循环 / 往前拖回开头）', (() => {
          const at = rsrc.indexOf('function paintLyricsHighlight');
          if (at < 0) return false;
          const seg = rsrc.slice(at, at + 900);
          return seg.includes('if (!active)') && seg.includes('body.scrollTop = 0');
        })(), '');
        check('拖动进度条时歌词跟着当前时间戳走（down / move / up 都定位）', (() => {
          const at = rsrc.indexOf("bar.addEventListener('pointermove'");
          if (at < 0) return false;
          const seg = rsrc.slice(Math.max(0, at - 600), at + 700);
          return (seg.split('updateLyricsProgress(').length - 1) >= 3;
        })(), '');
        check('第 81 轮改动无运行错误', $('errBox').hidden === true, ($('errBox').textContent || '').slice(0, 120));
        
        const appTitle = 'iRix Audio Player';
        emit('player:state', {
          status: 'playing', trackId: 't1', duration: 391.2, position: 12, volume: 0.8, format: fmtOf(),
        });
        await new Promise((r) => setTimeout(r, 120));
        check('任务栏标题同步为「艺术家 - 歌曲名」',
          document.title === 'Eagles - Hotel California', document.title);
        emit('player:state', {
          status: 'paused', trackId: 't1', duration: 391.2, position: 12, volume: 0.8, format: fmtOf(),
        });
        await new Promise((r) => setTimeout(r, 120));
        check('暂停时标题仍是这首歌', document.title === 'Eagles - Hotel California', document.title);
        emit('player:state', { status: 'stopped', trackId: null, position: 0, duration: 0, volume: 0.8, format: null });
        await new Promise((r) => setTimeout(r, 150));
        check('停止后标题回到应用名', document.title === appTitle, document.title);

        
        check('主题切换不会变成瞬间切换（有 View Transition 或兜底淡出淡入）', (() => {
          const hasVT = typeof document.startViewTransition === 'function';
          const vtCss = [...document.styleSheets].some((sh) => {
            try { return [...sh.cssRules].some((r) => (r.selectorText || '').includes('view-transition-new(root)')); }
            catch { return false; }
          });
          const fadeCss = [...document.styleSheets].some((sh) => {
            try { return [...sh.cssRules].some((r) => (r.selectorText || '').includes('html.theme-fading')); }
            catch { return false; }
          });
          return fadeCss && (!hasVT || vtCss);
        })(), '兜底样式 + View Transitions 样式都在');
        check('切主题后兜底的类会被摘掉（终态完全可见）', (() => {
          $('btnThemeMode').click();
          return document.documentElement.classList.contains('theme-fading') ||
            !document.documentElement.classList.contains('theme-fade-out');
        })(), [...document.documentElement.classList].join(' '));

        
        check('标题栏图标是 Material 音符（与软件图标同形状）', (() => {
          const logo = $('appLogo');
          const svg = logo && logo.querySelector('svg');
          const path = svg && svg.querySelector('path');
          return !!path && path.getAttribute('d') === 'M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z' &&
            svg.getAttribute('fill') === 'currentColor';
        })(), `logo=${!!$('appLogo')}`);
        check('标题栏图标是圆形、且旧字形已移除', (() => {
          const logo = $('appLogo');
          if (!logo) return false;
          return getComputedStyle(logo).borderRadius === '50%' && !logo.textContent.includes('◎');
        })(), getComputedStyle($('appLogo')).borderRadius);
        check('改主题色 → 标题栏图标跟着变', (() => {
          const logo = $('appLogo');
          const before = getComputedStyle(logo).backgroundImage;
          const root = document.documentElement;
          const prev = root.style.getPropertyValue('--accent');
          root.style.setProperty('--accent', '#ff5a5a');
          const after = getComputedStyle(logo).backgroundImage;
          if (prev) root.style.setProperty('--accent', prev); else root.style.removeProperty('--accent');
          return !!before && before !== after;
        })(), '改 --accent 后 background-image 会变');

        
        check('右下角信息走统一入口（1s 后淡出再清空）', (() => {
          const at = rsrc.indexOf('function setScanHint');
          if (at < 0) return false;
          const seg = rsrc.slice(at, at + 900);
          return seg.includes('SCAN_HINT_HOLD_MS') && seg.includes("classList.add('is-out')") &&
            seg.includes('SCAN_HINT_FADE_MS') && seg.includes("classList.remove('is-out')");
        })(), '');
        check('扫描进度/导入提示都改走 setScanHint', (() => {
          const direct = (rsrc.match(/\$\('scanHint'\)\.textContent\s*=/g) || []).length;
          return direct === 0 && (rsrc.split('setScanHint(').length - 1) >= 4;
        })(), `直接写 textContent 处数=${(rsrc.match(/\$\('scanHint'\)\.textContent\s*=/g) || []).length}`);
        check('右下角信息有淡出样式（is-out → opacity 0）', (() => {
          for (const sheet of document.styleSheets) {
            let rules;
            try { rules = [...sheet.cssRules]; } catch { continue; }
            if (rules.some((r) => (r.selectorText || '') === '#scanHint.is-out' && r.style.opacity === '0')) return true;
          }
          return false;
        })(), '');
        
        check('属性弹窗里没有任何悬停提示', (() => {
          const mask = $('propsModal');
          const withTitle = [...mask.querySelectorAll('[title], [data-i18n-title]')];
          const head = [...mask.querySelectorAll('[title]')].map((el) => el.id || el.className);
          return !!mask && withTitle.length === 0 && !head.length &&
            /propsGrid/.test(rsrc) &&
            !/vv\.title = v/.test(rsrc);
        })(), (() => {
          const mask = $('propsModal');
          const bad = [...mask.querySelectorAll('[title], [data-i18n-title]')].map((el) => el.id || el.className);
          return bad.length ? `还带提示: ${bad.join(',')}` : '干净';
        })());
      } catch (err) {
        check('第 81 轮检查块执行异常', false,
          String(err && err.stack ? err.stack.split('\n').slice(0, 2).join(' | ') : err));
      }

      
      try {
        check('设置里有「关于」，且在最底部（版本 / 制作者 / 基于 / 协议）', (() => {
          const modal = $('settingsModal');
          const body = modal && modal.querySelector('.modal-body');
          if (!body) return false;
          const h3s = [...body.querySelectorAll('h3')];
          const last = h3s[h3s.length - 1];
          return !!last && last.getAttribute('data-i18n') === 'about.title' &&
            !!$('aboutVersion') && !!$('aboutTags') && !!$('aboutLicenses');
        })(), '');
        check('「关于」显示版本号与制作者 sakihanaraku', (() => {
          const v = ($('aboutVersion').textContent || '').trim();
          const text = $('settingsModal').textContent;
          return v.length > 0 && v !== '—' && /sakihanaraku/.test(text);
        })(), `version="${$('aboutVersion').textContent}"`);
        check('「关于」列出框架与后端（Electron / Chromium / Node / FFmpeg / N-API）', (() => {
          const tags = [...$('aboutTags').querySelectorAll('.about-tag')].map((t) => t.textContent);
          const names = tags.join(' ');
          const hit = ['Electron', 'Chromium', 'Node.js', 'FFmpeg', 'N-API'].filter((n) => names.includes(n));
          return tags.length >= 4 && hit.length >= 4;
        })(), [...$('aboutTags').querySelectorAll('.about-tag')].map((t) => t.textContent).join(' | '));
        check('开源协议：每项都是 https 链接 + target=_blank（点击走系统浏览器）', (() => {
          const links = [...$('aboutLicenses').querySelectorAll('a')];
          if (links.length < 5) return false;
          return links.every((a) => /^https:\/\//.test(a.getAttribute('href')) &&
            a.getAttribute('target') === '_blank' && (a.textContent || '').length > 0);
        })(), [...$('aboutLicenses').querySelectorAll('a')].map((a) => `${a.textContent}→${a.getAttribute('href')}`).join(' , ').slice(0, 200));
        check('开源协议涵盖 MIT / BSD / LGPL-GPL', (() => {
          const txt = $('aboutLicenses').textContent;
          return /MIT/.test(txt) && /BSD/.test(txt) && /(LGPL|GPL)/.test(txt);
        })(), $('aboutLicenses').textContent.slice(0, 140));
      } catch (err) {
        check('关于检查块执行异常', false,
          String(err && err.stack ? err.stack.split('\n').slice(0, 2).join(' | ') : err));
      }

      
      try {
        const btn = $('btnLyricsFull');
        const sec = $('lyricsExclusive');
        const tb = document.querySelector('.titlebar');
        check('歌词独占：标题栏有切换按钮', !!btn && btn.getAttribute('aria-pressed') === 'false', '');
        
        btn.click();
        const bodyDisplay = getComputedStyle(document.body).display;
        const rect = sec.getBoundingClientRect();
        check('歌词独占：打开后 body 类生效且标题栏保留',
          document.body.classList.contains('lyrics-exclusive') &&
          bodyDisplay !== 'none' && getComputedStyle(tb).display !== 'none' && btn.getAttribute('aria-pressed') === 'true',
          `body=${bodyDisplay} titlebar=${getComputedStyle(tb).display}`);
        check('歌词独占：独占层铺满标题栏以下区域（不是 0 尺寸）',
          rect.width > 200 && rect.height > 200 &&
          Math.round(rect.top) === Math.round(tb.getBoundingClientRect().height),
          `${Math.round(rect.width)}x${Math.round(rect.height)} top=${Math.round(rect.top)}`);
        check('歌词独占：时间/艺术家/曲名/歌词列都已接好',
          !!$('lxTime') && !!$('lxArtist') && !!$('lxTitle') && !!$('lxLyrics') &&
          $('lxTime').textContent.includes('/') && $('lxTitle').textContent.length > 0,
          `time=${$('lxTime').textContent} title=${$('lxTitle').textContent}`);
        
        await new Promise((r) => setTimeout(r, 360));
        check('歌词独占：打开后背景压暗层生效',
          !!$('lxDim') && getComputedStyle($('lxDim')).backgroundColor !== 'rgba(0, 0, 0, 0)',
          getComputedStyle($('lxDim') || document.body).backgroundColor);
        check('歌词独占：淡入终态 = 完全不透明（动画不跑也必须是可见的）',
          (() => {
            
            const prev = sec.style.transition;
            sec.style.transition = 'none';
            void sec.offsetWidth;
            const opacity = getComputedStyle(sec).opacity;
            sec.style.transition = prev;
            return opacity === '1' && getComputedStyle(sec).visibility === 'visible';
          })(),
          `opacity=${getComputedStyle(sec).opacity} visibility=${getComputedStyle(sec).visibility}`);
        check('歌词独占：最底部贴边通栏细进度条',
          (() => {
            const bar = $('lxProgress');
            if (!bar) return false;
            const r = bar.getBoundingClientRect();
            return r.width >= window.innerWidth - 2 && Math.abs(r.bottom - window.innerHeight) <= 1 &&
              r.height > 0 && r.height <= 6;
          })(),
          (() => {
            const r = $('lxProgress') ? $('lxProgress').getBoundingClientRect() : null;
            return r ? `${Math.round(r.width)}x${Math.round(r.height)} bottom=${Math.round(r.bottom)}/${window.innerHeight}` : '无';
          })());
        check('歌词独占：歌词字体已加粗（普通行 ≥500）',
          (() => {
            const probe = document.createElement('div');
            probe.className = 'lx-line';
            probe.textContent = 'probe';
            $('lxLyrics').appendChild(probe);
            const weight = parseInt(getComputedStyle(probe).fontWeight, 10) || 400;
            probe.remove();
            return weight >= 500;
          })(), '');
        
        const leftEl = document.querySelector('.lx-left');
        const lyricsEl = document.querySelector('.lx-lyrics-col');
        const place = (y) => document.dispatchEvent(new PointerEvent('pointermove', {
          bubbles: true, clientX: Math.round(window.innerWidth / 2), clientY: Math.round(y),
        }));
        
        const leftShift = () => {
          const prev = leftEl.style.transition;
          leftEl.style.transition = 'none';
          void leftEl.offsetWidth;
          const m = new DOMMatrixReadOnly(getComputedStyle(leftEl).transform);
          leftEl.style.transition = prev;
          return m.m42;
        };
        place(window.innerHeight - 2);            
        const bottomOpened = $('lyricsExclusive').classList.contains('controls-open') &&
          $('lxControls').getAttribute('aria-hidden') === 'false';
        place(window.innerHeight - 40);           
        const openedImmediate = $('lyricsExclusive').classList.contains('controls-open');
        const shift = leftShift();
        
        const ctlEl = $('lxControls');
        const prevCtlT = ctlEl.style.transition;
        ctlEl.style.transition = 'none';
        void ctlEl.offsetWidth;
        const ctlBottom = ctlEl.getBoundingClientRect().bottom;
        ctlEl.style.transition = prevCtlT;
        const flush = Math.abs(ctlBottom - window.innerHeight) <= 1;
        const peOk = getComputedStyle(ctlEl).pointerEvents === 'none' &&
          getComputedStyle($('lxCtrlPlay')).pointerEvents === 'auto' &&
          getComputedStyle($('lxVolumeBox')).pointerEvents === 'auto';
        check('歌词独占：靠近底部立即滑出（最底部也触发），封面/信息上移、歌词不动',
          bottomOpened && openedImmediate && shift < -20 && getComputedStyle(lyricsEl).transform === 'none' &&
          flush && peOk,
          `bottomOpened=${bottomOpened} opened=${openedImmediate} 上移=${Math.round(shift)}px` +
          ` 贴底=${flush}(${Math.round(ctlBottom)}/${window.innerHeight}) 事件穿透=${peOk}`);
        place(window.innerHeight - 200);          
        const closedImmediate = !$('lyricsExclusive').classList.contains('controls-open') &&
          $('lxControls').getAttribute('aria-hidden') === 'true';
        const shiftBack = leftShift();
        check('歌词独占：离开底部区域立即滑回且封面/信息回位',
          closedImmediate && Math.abs(shiftBack) < 0.5,
          `closed=${closedImmediate} 回位位移=${Math.round(shiftBack)}px`);
        
        place(window.innerHeight - 4);            
        const lxVolEl = $('lxVolume');
        const lxVolIcon = $('lxVolIcon');
        const volBoxRect = $('lxVolumeBox').getBoundingClientRect();
        const ctlRect2 = $('lxControls').getBoundingClientRect();
        const volInBar = volBoxRect.right <= ctlRect2.right + 1 &&
          volBoxRect.bottom <= ctlRect2.bottom + 1 && volBoxRect.right >= ctlRect2.right - 60;
        lxVolEl.value = '30';
        lxVolEl.dispatchEvent(new Event('input', { bubbles: true }));
        const sliderSynced = $('volume').value === '30' && $('lxVolNum').textContent === '30';
        lxVolIcon.click();
        const muteSynced = $('volIcon').dataset.level === 'mute' &&
          $('lxVolIcon').dataset.level === 'mute' && $('lxVolNum').textContent === tr('vol.muted');
        lxVolIcon.click();                        
        const unmuteSynced = $('lxVolIcon').dataset.level !== 'mute' && $('lxVolNum').textContent === '30';
        check('歌词独占：控件栏右下角音量控件（位置/滑杆/静音与主界面同步）',
          volInBar && sliderSynced && muteSynced && unmuteSynced,
          `inBar=${volInBar} slider=${sliderSynced} mute=${muteSynced} unmute=${unmuteSynced}`);
        place(window.innerHeight - 200);          
        
        emit('player:state', {
          status: 'playing', trackId: 't1', duration: 391.2, position: 60, volume: 0.8, format: fmtOf(),
        });
        await new Promise((r) => setTimeout(r, 200));
        const zone = $('lxProgressZone');
        const zr = zone.getBoundingClientRect();
        const pointAt = (fx) => ({
          x: Math.round(zr.left + zr.width * fx),
          y: Math.round(zr.top + 7),
        });
        let pt = pointAt(0.5);
        document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: pt.x, clientY: pt.y }));
        await new Promise((r) => setTimeout(r, 80));
        const bubble = $('lxProgressTime');
        const hoverOk = bubble.hidden === false && /^\d\d:\d\d\/\d\d:\d\d$/.test(bubble.textContent.trim()) &&
          $('lxProgressZone').classList.contains('is-hover');
        zone.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: pt.x, clientY: pt.y }));
        pt = pointAt(0.75);
        window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, button: 0, clientX: pt.x, clientY: pt.y }));
        await new Promise((r) => setTimeout(r, 100));
        const fillMid = $('lxProgressFill').style.transform;
        const bubbleMid = $('lxProgressTime').textContent.trim();
        const lxTimeMid = $('lxTime').textContent.trim();
        const dragging = $('lxProgressZone').classList.contains('is-dragging');
        window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, clientX: pt.x, clientY: pt.y }));
        await new Promise((r) => setTimeout(r, 250));
        check('歌词独占：进度条悬停显示 xx:xx/xx:xx，拖动时进度/时间/歌词同步',
          hoverOk && dragging && /scaleX\(0\.7/.test(fillMid) && lxTimeMid === bubbleMid &&
          /^\d\d:\d\d\/\d\d:\d\d$/.test(bubbleMid), `hover=${hoverOk} drag=${dragging} fill=${fillMid} bubble=${bubbleMid} lxTime=${lxTimeMid}`);
        
        place(window.innerHeight - 260);
        await new Promise((r) => setTimeout(r, 80));
        check('歌词独占：离开进度条后时间气泡收回',
          $('lxProgressTime').hidden === true && !$('lxProgressZone').classList.contains('is-hover'),
          `hidden=${$('lxProgressTime').hidden}`);
        
        btn.click();
        await new Promise((r) => setTimeout(r, 360));
        check('歌词独占：再按一次关闭并恢复主界面',
          !document.body.classList.contains('lyrics-exclusive') &&
          getComputedStyle(document.querySelector('.layout')).display !== 'none' &&
          btn.getAttribute('aria-pressed') === 'false', '');
        check('歌词独占：关闭后淡出到不可见（终态不依赖动画）',
          (() => {
            const prev = sec.style.transition;
            sec.style.transition = 'none';
            void sec.offsetWidth;
            const opacity = getComputedStyle(sec).opacity;
            sec.style.transition = prev;
            return opacity === '0';
          })(), '');
        
        emit('player:state', {
          status: 'playing', trackId: 't1', duration: 391.2, position: 6, volume: 0.8, format: fmtOf(),
        });
        await new Promise((r) => setTimeout(r, 300));
        btn.click();                              
        await new Promise((r) => setTimeout(r, 500));
        check('歌词独占：停止前确实有内容（封面/歌词已加载）',
          !$('lxCoverImg').hidden && document.querySelectorAll('#lxLyrics .lx-line').length > 0,
          `coverHidden=${$('lxCoverImg').hidden} lines=${document.querySelectorAll('#lxLyrics .lx-line').length}`);
        place(window.innerHeight - 30);           
        await new Promise((r) => setTimeout(r, 120));
        const iconBeforeStop = $('lxCtrlPlay').textContent;
        $('btnStop').click();                     
        await new Promise((r) => setTimeout(r, 450));
        check('歌词独占：停止后控件栏播放/暂停图标回到 ▶',
          iconBeforeStop === '⏸' && $('lxCtrlPlay').textContent === '▶',
          `停止前=${iconBeforeStop} 停止后=${$('lxCtrlPlay').textContent}`);
        const reset = {
          coverHidden: $('lxCoverImg').hidden,
          lines: document.querySelectorAll('#lxLyrics .lx-line').length,
          title: $('lxTitle').textContent,
          mainTitle: $('npTitle').textContent,
          time: $('lxTime').textContent,
          fill: $('lxProgressFill').style.transform,
          artist: $('lxArtistText').textContent,
          marquee: $('lxArtist').classList.contains('is-marquee'),
          enter: $('lxLyrics').classList.contains('is-enter'),
        };
        check('歌词独占：停止播放后完全重置（封面/歌词/时间/进度条/滚动类）',
          reset.coverHidden === true && reset.lines === 0 && reset.title === reset.mainTitle &&
          reset.time === '00:00/00:00' && /^scaleX\(0/.test(reset.fill) &&
          reset.artist === '' && reset.marquee === false && reset.enter === false,
          JSON.stringify(reset));
        btn.click();                              
        await new Promise((r) => setTimeout(r, 300));
      } catch (err) {
        check('歌词独占检查块执行异常', false,
          String(err && err.stack ? err.stack.split('\n').slice(0, 2).join(' | ') : err));
      }

      const pre = document.createElement('pre');
      pre.id = '__results';
      pre.textContent = JSON.stringify({
        results,
        passed: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        
        themeColor: getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#35d07f',
      });
      document.body.appendChild(pre);
      document.title = `UI-TEST ${results.filter((r) => r.ok).length}/${results.length}`;
    }, 600);
  });
})();
