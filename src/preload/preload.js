
'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

const EVENT_CHANNELS = [
  'player:state', 'player:progress', 'player:ended', 'player:error',
  'playlist:changed', 'playlist:progress', 'playlist:scanning', 'playlist:added-external',
  'engine:changed', 'player:volume', 'window:maximized', 'plays:changed', 'convert:progress',
  'convert:done',
  'menu:add-files', 'menu:toggle', 'menu:prev', 'menu:next',
];

contextBridge.exposeInMainWorld('aurora', {
  info: () => ipcRenderer.invoke('app:info'),

  
  win: {
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  },

  
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return file?.path || '';
    }
  },

  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
  },

  ffmpeg: {
    set: (ffmpegPath) => ipcRenderer.invoke('ffmpeg:set', { ffmpegPath }),
    browse: () => ipcRenderer.invoke('ffmpeg:browse'),
  },

  
  eq: {
    get: () => ipcRenderer.invoke('eq:get'),
    set: (config) => ipcRenderer.invoke('eq:set', { config }),
    save: (config, filePath) => ipcRenderer.invoke('eq:save', { config, filePath }),
    load: (filePath) => ipcRenderer.invoke('eq:load', { filePath }),
  },

  
  plays: {
    get: () => ipcRenderer.invoke('plays:get'),
    count: (trackId) => ipcRenderer.invoke('plays:count', { trackId }),
    remove: (keys) => ipcRenderer.invoke('plays:remove', { keys }),
  },

  
  lyrics: {
    get: (trackId) => ipcRenderer.invoke('lyrics:for', { trackId }),
    pick: (trackId) => ipcRenderer.invoke('lyrics:pick', { trackId }),
    forget: (trackId) => ipcRenderer.invoke('lyrics:forget', { trackId }),
    read: (trackId) => ipcRenderer.invoke('lyrics:read', { trackId }),
    save: (trackId, text) => ipcRenderer.invoke('lyrics:save', { trackId, text }),
  },

  
  convert: {
    formats: () => ipcRenderer.invoke('convert:formats'),
    start: (trackId, formatId, options) => ipcRenderer.invoke('convert:start', { trackId, formatId, options }),
    cancel: () => ipcRenderer.invoke('convert:cancel'),
  },

  devices: {
    list: (backend) => ipcRenderer.invoke('devices:list', { backend }),
    probe: (opts) => ipcRenderer.invoke('devices:probe', opts),
  },

  
  cover: {
    get: (trackId) => ipcRenderer.invoke('cover:get', { trackId }),
  },

  
  fs: {
    home: () => ipcRenderer.invoke('fs:home'),
    list: (dir) => ipcRenderer.invoke('fs:list', { dir }),
    stat: (input) => ipcRenderer.invoke('fs:stat', { input }),
  },

  
  bg: {
    get: () => ipcRenderer.invoke('bg:get'),
    pick: () => ipcRenderer.invoke('bg:pick'),
    fetch: () => ipcRenderer.invoke('bg:fetch'),
  },

  playlist: {
    get: () => ipcRenderer.invoke('playlist:get'),
    add: (paths) => ipcRenderer.invoke('playlist:add', { paths }),
    remove: (id) => ipcRenderer.invoke('playlist:remove', { id }),
    clear: () => ipcRenderer.invoke('playlist:clear'),
    reorder: (id, toIndex) => ipcRenderer.invoke('playlist:reorder', { id, toIndex }),
    browse: () => ipcRenderer.invoke('playlist:browse'),
    
    save: (filePath) => ipcRenderer.invoke('playlist:save', { filePath }),
    load: (filePath) => ipcRenderer.invoke('playlist:load', { filePath }),
  },

  player: {
    play: (trackId, start) => ipcRenderer.invoke('player:play', { trackId, start }),
    pause: () => ipcRenderer.invoke('player:pause'),
    resume: () => ipcRenderer.invoke('player:resume'),
    stop: () => ipcRenderer.invoke('player:stop'),
    seek: (seconds) => ipcRenderer.invoke('player:seek', { seconds }),
    volume: (value) => ipcRenderer.invoke('player:volume', { value }),
    release: () => ipcRenderer.invoke('player:release'),
    reopen: () => ipcRenderer.invoke('player:reopen'),
    state: () => ipcRenderer.invoke('player:state'),
  },

  probeFile: (file) => ipcRenderer.invoke('probe:file', { file }),
  showItem: (file) => ipcRenderer.invoke('shell:showItem', { file }),

  on: (channel, callback) => {
    if (!EVENT_CHANNELS.includes(channel)) return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
