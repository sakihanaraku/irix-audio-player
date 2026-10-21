# `.xtxs` Extension Development Guide (Community Edition)

[中文](EXTENSIONS.md) | **English** | [日本語](EXTENSIONS.ja.md)

> Applies to: **iRix Audio Player 1.0.2-extUpdate and later** · Extension interface **ext**
> Document version: 2026-10-21 · Repository: <https://github.com/sakihanaraku/irix-audio-player>

This guide is for community developers who want to write extensions for iRix Audio Player: from the minimal runnable example, manifest and module specification,
to settings/commands, startup windows, debugging and the submission process — all based on the actual behavior of the current version.

> **Layout**: the extension source now lives in a standalone directory `irix-extension/` at the workspace root (a sibling of `music-player/`).
> This guide is at `music-player/EXTENSIONS.md`, so file paths below are relative to the `music-player/` root,
> and extension paths are written as `../irix-extension/...`; the submission process in Section 11 corresponds to the standalone extension repository.

**30-second version**

1. Copy the template directory: `../irix-extension/community/irix-extension-template/`
   (standalone repository: <https://github.com/sakihanaraku/irix-extension-template>, ready to clone);
2. Edit `extension.json` (id/name/version/extensions) and `index.js` (your container format);
3. `tar -cf my-plugin.xtxs -C your-plugin-dir .`;
4. App → Settings → Extensions → Install extension… → restart;
5. Once tests pass, open a Pull Request against the extension repository (put the source under `irix-extension/community/<id>/`, or submit a `.xtxs` catalog entry).

---

## 1. What is an extension

The player uses ffmpeg to decode ordinary audio (FLAC/WAV/MP3/…). Extensions let you:

- **Teach the player a new container** (custom/encrypted format) and restore it to ordinary audio before playback;
- Provide **metadata** (title/artist/album/duration) and **cover art** for those files;
- Provide **declarative setting items** (toggle/dropdown/number/text) under "Settings → Extensions";
- Provide **command buttons** (for example clear cache, generate sample, open self-test window);
- Run initialization/cleanup through lifecycle hooks, or declare **activation at startup** (useful for popping up test windows and similar).

### 1.1 What an extension can do

| Capability | Corresponding interface |
|---|---|
| Container decoding | `decode(buffer, { name })` |
| Fast metadata read (without decoding the whole audio) | `readMeta(buffer, { name })` |
| Fast cover extraction (no cache written) | `extractCover(buffer, { name })` |
| File-level audio post-processing (normalization/resampling, etc.) | `processAudio(data, ctx)` |
| Lifecycle | `activate(ctx)` / `deactivate()` |
| Declarative settings | `settings` in `extension.json` + `onSettingsChanged(values, key)` |
| Command buttons | `commands` in `extension.json` + `module.exports.commands` |
| Startup activation | `"startup": true` in `extension.json` |

### 1.2 What an extension cannot do

- ❌ **Cannot inject arbitrary UI**: it can only generate declarative controls from `settings` / `commands` in the manifest;
  it cannot inject HTML/JS/CSS or change the player's main layout;
- ❌ **Cannot do real-time DSP/audio effects**: there is no real-time audio callback; `processAudio` only handles "an entire file that has already been decoded";
- ❌ **Cannot be an online music source/search**: extensions are only invoked at the "local file → playable audio" step;
- ❌ **Cannot decrypt as a stream**: `decode` / `readMeta` receive the `Buffer` of one whole file and must return synchronously;
- ❌ **Cannot stay resident in the background**: the extension module is loaded only once, on demand, and has no resident timer/lifecycle API of its own.

> If you need capabilities beyond the above, open an Issue to discuss the interface design first; do not write extensions that depend on undocumented behavior.

---

## 2. Quick start

### 2.1 Directory structure

```
deepseek-harness/
├── music-player/                       ← 主应用（本指南所在）
└── irix-extension/                     ← 插件源码（独立目录）
    └── community/
        └── irix-extension-template/    ← 复制这个目录，改成你自己的插件
            ├── extension.json          ← 清单（必须有）
            ├── index.js                ← 入口模块（必须有，默认 index.js）
            ├── README.md               ← 插件说明（社区投稿必须有）
            └── make-sample.mjs         ← 模板自带：生成测试用 .hello 文件
```

After copying, change these first:

| What to change | Change to |
|---|---|
| Directory name | your extension id (lowercase letters/digits/`.-_`) |
| `id` in `extension.json` | same as the directory name |
| `name` / `description` / `author` / `version` in `extension.json` | your info |
| `extensions` in `extension.json` | your container suffix (no dot, lowercase) |
| `MAGIC` / parsing logic / `match` in `index.js` | your container format |
| `module.exports.id` in `index.js` | same as the manifest `id` (for readability; the loader uses the manifest) |

### 2.2 `extension.json` (complete example, ready to copy)

```json
{
  "id": "irix-extension-template",
  "name": "Irix Extension Template",
  "version": "1.0.0",
  "description": "iRix Audio Player 扩展模板：示例容器 .hello → 可播放音频，包含 decode/readMeta/extractCover/processAudio/生命周期/声明式设置/命令的完整写法。",
  "entry": "index.js",
  "extensions": ["hello"],
  "minAppVersion": "1.0.2-extUpdate",
  "author": "your-name",
  "license": "MIT",
  "settings": [
    {
      "key": "passthroughUnknown",
      "type": "boolean",
      "label": "未知音频头时原样放行",
      "default": false,
      "description": "识别不出真实格式时，不返回音频而是 passthrough（交给播放器原文件处理）"
    }
  ],
  "commands": [
    {
      "id": "ping",
      "label": "测试命令",
      "description": "返回插件 id/版本，验证命令接口是否接通"
    }
  ]
}
```

### 2.3 `index.js` (complete example, ready to copy)

```js
'use strict';

// 示例容器格式：
//   [0, 8)         magic "HELLOXTS"
//   [8, 12)        元数据 JSON 长度 N（uint32 LE）
//   [12, 12+N)     元数据 JSON：{ title, artist, album, duration }（duration 单位毫秒）
//   [12+N, ...)    原始音频数据（FLAC/MP3/WAV/OGG/...）

const MAGIC = Buffer.from('HELLOXTS');
const MAX_HEADER = 64 * 1024;

function detectExt(buf) {
  const head = (n) => buf.subarray(0, n).toString('latin1');
  if (head(4) === 'fLaC') return 'flac';
  if (head(4) === 'OggS') return 'ogg';
  if (head(4) === 'RIFF') return 'wav';
  if (head(3) === 'ID3') return 'mp3';
  if (buf.length > 1 && buf[0] === 0xff && (buf[1] & 0xf6) === 0xf0) return 'aac';
  if (head(4) === 'ftyp') return 'm4a';
  return null;
}

function splitContainer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) throw new Error('文件太短，不是 HELLOXTS 容器');
  if (!buffer.subarray(0, 8).equals(MAGIC)) throw new Error('魔数不匹配（不是 .hello 容器）');
  const headLen = buffer.readUInt32LE(8);
  if (headLen < 2 || headLen > MAX_HEADER || 12 + headLen > buffer.length) {
    throw new Error('容器头部长度不合法');
  }
  let meta = null;
  try {
    const j = JSON.parse(buffer.subarray(12, 12 + headLen).toString('utf8'));
    if (j && typeof j === 'object') {
      meta = {
        title: String(j.title || ''),
        artist: String(j.artist || ''),
        album: String(j.album || ''),
        duration: Number(j.duration) || 0,   // 毫秒
      };
    }
  } catch { meta = null; }
  return { meta, data: buffer.subarray(12 + headLen) };
}

let currentSettings = { passthroughUnknown: false };

function decode(buffer) {
  const { meta, data } = splitContainer(buffer);
  if (!data.length) throw new Error('容器里没有音频数据');
  const ext = detectExt(data);
  if (!ext && currentSettings.passthroughUnknown) {
    return { data: Buffer.alloc(0), ext: 'bin', meta, passthrough: true };
  }
  if (!ext) throw new Error('无法识别容器里的音频格式');
  return { data, ext, meta, passthrough: false };
}

/** 加入列表快速路径：只读元数据，不复制音频 */
function readMeta(buffer) {
  try { return splitContainer(buffer).meta; } catch { return null; }
}

module.exports = {
  id: 'irix-extension-template',
  match: /\.hello$/i,

  activate(ctx) {
    currentSettings = { ...ctx.settings };
    ctx.log('irix-extension-template activated', ctx.extension.version);
  },
  deactivate() { /* 释放资源 */ },
  onSettingsChanged(values) { currentSettings = { ...values }; },
  commands: {
    async ping(ctx) { return `irix-extension-template v${ctx.extension.version} OK`; },
  },

  decode,
  readMeta,
};
```

### 2.4 Packaging, installing, verifying

```powershell
# 1) 打包（.xtxs 就是 tar 包；-C 指定源目录，. 表示把目录内容放在包根）
tar -cf iRix-Extension-irix-extension-template-1.0.0.xtxs -C ..\irix-extension\community\irix-extension-template .

# 2) 检查包内容（应看到 extension.json / index.js / README.md）
tar -tf iRix-Extension-irix-extension-template-1.0.0.xtxs
```

1. Player → **Settings → Extensions → Install extension…** → choose the `.xtxs`;
2. When "Changed; takes effect after restarting the app" appears → click **Restart app**;
3. Generate a test file (wrap any flac/mp3 into `.hello`):

```powershell
node ..\irix-extension\community\irix-extension-template\make-sample.mjs .\song.flac .\song.hello
```

4. After restarting, the file browser shows the `.hello` file; add it to the playlist:
   - The entry should **appear immediately** (via the `readMeta` fast path);
   - During playback, title/artist/album/duration come from the container metadata;
   - The settings page shows the template's toggle setting and test command; changes/clicks should give immediate feedback.

---

## 3. The `.xtxs` package format

- `.xtxs` = a **tar package** (uncompressed); the file extension is only a convention;
- The package **root** must contain `extension.json`; `index.js`, `README.md`, and optionally `LICENSE` are recommended;
- One extra directory level inside the package is allowed (the installer automatically strips a single wrapper), but please put the files directly at the package root;
- On install, the app extracts with the system `tar -xf` (Windows 10+ ships bsdtar; zero third-party dependencies);
- The dialog also accepts `.zip`, but it depends on bsdtar; **on Linux/macOS please use the standard `.xtxs` (tar)**;
- Suggested file name: `iRix-Extension-<id>-<version>.xtxs`;
- Do not include `node_modules`, native `.node` modules, or executables (see the security rules in Section 8).

Installed location (managed by the app):

```
<userData>/extensions/<id>/extension.json
<userData>/extensions/<id>/index.js
```

- Portable build: `userData` = `iRixAudioPlayer-data/` in the directory next to the exe;
- Installed build: `userData` = the system application data directory (under `%APPDATA%`).

Install = extract → validate the manifest → copy to `extensions/<id>/` → enable automatically.
**Install/uninstall/toggling enabled all require an app restart to take effect** (the file-extension table and the module cache are both built at startup).
Persisted setting values are stored under `extensionSettings.<id>` in `settings.json`; they are cleared automatically on uninstall.

---

## 4. `extension.json` field specification

| Field | Required | Type | Description |
|---|---|---|---|
| `id` | ✅ | string | Unique id: `^[a-z0-9][a-z0-9._-]{1,48}$` (case-insensitive, all-lowercase recommended); directory name = id |
| `name` | ✅ | string | Display name |
| `version` | ✅ | string | Version number; semantic versioning recommended |
| `description` | ✅ | string | One-sentence description |
| `entry` | optional | string | Entry file (relative to the extension directory), defaults to `index.js` |
| `extensions` | recommended | string[] | Container suffixes it can handle (no dot, lowercase). Only shown in the file browser after a restart |
| `minAppVersion` | optional | string | Minimum app version; **currently displayed as metadata only — the loader does not enforce it** |
| `author` | recommended | string | Author name/ID |
| `homepage` | optional | string | Extension homepage/source URL (ignored by the loader; for catalog display) |
| `license` | optional | string | License identifier (ignored by the loader; for catalog display) |
| `startup` | optional | boolean | `true` = automatically `activate()` at app startup (for popup/background-helper extensions) |
| `settings` | optional | array | Declarative setting items (max 32) |
| `commands` | optional | array | Command buttons (max 16) |

### 4.1 `settings` items

```js
{
  key: 'quality',                 // ^[a-z0-9][a-z0-9._-]{0,63}$
  type: 'select',                 // text | number | boolean | select
  label: '处理质量',               // 最长 80 字符
  description: '可选说明',         // 最长 240 字符
  default: 'high',
  options: [{ value: 'low', label: '快速' }, { value: 'high', label: '高质量' }]
}
```

- `number` supports `min` / `max` / `step`; out-of-range values are clamped;
- `boolean` defaults to `true` (unless `default: false` is given explicitly);
- `select` allows at most 24 `options`, and values must be in the allow-list;
- Text values are at most 4096 characters; invalid/unknown items are dropped or rejected and will not crash the app.

Setting values are saved by the main process and provided via `ctx.settings` when the extension is activated with `activate(ctx)` (defaults + saved values).
When the user changes a setting, `onSettingsChanged(values, key)` is called; if the extension does not implement that hook, the settings page prompts for a restart.

### 4.2 `commands` command buttons

```js
{ id: 'clear-cache', label: '清理解码缓存', description: '删除本扩展的解码缓存' }
```

Export a function with the same name from the module:

```js
module.exports = {
  commands: {
    async 'clear-cache'(ctx) {
      return '已清理 3 个缓存文件';   // 返回值显示在设置页状态行
    },
  },
};
```

- Commands run in the main process and may be async;
- A thrown error shows "Execution failed: …" and does not affect the app;
- If no function with that name is implemented, it shows "The extension does not implement this command".

---

## 5. `index.js` module interface

The extension entry is a **CommonJS** module loaded in the **main process** (it does not run in the renderer), so it can use
Node built-in modules such as `node:fs` / `node:crypto`.

### 5.1 Export shape

```js
module.exports = {
  id: 'my-plugin',                  // 可选，与 manifest.id 一致
  match: /\.xyz$/i,                 // 必须：RegExp（对文件名 basename 测试）

  decode(buffer, { name }) {        // 容器解码，必须同步
    return {
      data: Buffer,                 // 解码出的原始音频
      ext: 'flac',                  // 真实格式（不带点）
      meta: { title, artist, album, duration }, // 可选，duration 单位毫秒
      cover: Buffer,                // 可选：JPEG/PNG 封面
      passthrough: false,           // 可选：true = 原样交给播放器
    };
  },

  readMeta(buffer, { name }) { /* 可选：只读元数据，返回 meta 或 null */ },
  extractCover(buffer, { name }) { /* 可选：返回封面 Buffer 或 null */ },
  processAudio(data, ctx) { /* 可选：返回 Buffer 或 { data, ext } */ },
  activate(ctx) { /* 可选：模块加载完成 */ },
  deactivate() { /* 可选：卸载/禁用/退出 */ },
  onSettingsChanged(values, key) { /* 可选：设置变更 */ },
  commands: { /* 可选：与 manifest.commands 对应 */ },
};
```

### 5.2 `match`

- Must be a **RegExp** (the loader checks with `instanceof RegExp`);
- Tested only against the **file name** (basename), not the full path;
- When several extensions match at the same time, the first one after sorting by extension display name takes effect → make `match` as precise as possible,
  for example `/\.hello$/i`, not `/hello/i`;
- Add `i` for case-insensitivity when needed.

### 5.3 Core interfaces

| Interface | Required | Description |
|---|---|---|
| `decode(buffer, { name })` | Yes (can be omitted for metadata-only extensions) | **Must be synchronous**; returns `{ data, ext, meta?, cover?, passthrough? }` |
| `readMeta(buffer, { name })` | Optional | **Must be synchronous**; returns only `meta` (`duration` in ms) or `null`. Used by the add-to-playlist fast path; returning `null` falls back to full decoding |
| `extractCover(buffer, { name })` | Optional | **Must be synchronous**; returns a JPEG/PNG `Buffer` (>64 bytes) or `null`; cover reads call it first and do not write the cache |
| `processAudio(data, ctx)` | Optional | **Must be synchronous**; returns a `Buffer` or `{ data, ext }`; `ctx = { name, ext, meta, sourcePath }`. This is **file-level post-processing**, not real-time DSP |

Call timing (the same file may be called several times; it must be **side-effect free and repeatable**):

1. **Add to playlist**: `readMeta()` first; missing/failed → full `decode()` + ffprobe;
2. **Playback**: full `decode()` then the optional `processAudio()`; the result is written to the decode cache;
3. **Cover**: `extractCover()` first; otherwise read from the decoded audio/sidecar.

**Synchronous requirement**: the player reads the return value directly and does not `await`. A returned `Promise` is treated as "no result",
which manifests as **no error but no effect** (the most common beginner trap).

**Performance and memory**: the entire file is in memory and executes synchronously in the main process → do not block for long;
estimate memory use for large files; if reading only the header suffices, do not scan everything.

**Robustness**: always validate lengths/offsets (see the template's `headLen` check); a corrupt file should throw,
rather than allocate out of bounds or loop forever.

### 5.4 `decode` return value

| Key | Type | Description |
|---|---|---|
| `data` | Buffer | **Required** (except `passthrough`). Raw audio bytes |
| `ext` | string | **Required** (except `passthrough`). Real format: `flac`/`mp3`/`wav`/`ogg`/`m4a`/`aac`/`opus`, etc. |
| `meta` | object | Optional. Fields in the table below |
| `cover` | Buffer | Optional. JPEG/PNG; ≤ 2 MB, ≤ 1024×1024 recommended |
| `passthrough` | boolean | Optional. `true` = not my container / the result is ordinary audio; the player continues with the original file |

`meta` fields:

| Field | Type | Description |
|---|---|---|
| `title` | string | Title |
| `artist` | string | Artist |
| `album` | string | Album |
| `duration` | number | **Milliseconds** (3 min 15 s = `195000`); the player divides by `/1000` internally |

### 5.5 Lifecycle, settings and commands

```js
activate(ctx) {
  // ctx = {
  //   appVersion: '1.0.2-extUpdate',
  //   extension: { id, name, version, dir },
  //   settings: { ...默认值 + 已保存值 },
  //   log: (...args) => void,   // 主进程日志
  // }
}
deactivate() { /* 释放资源 */ }
onSettingsChanged(values, key) { /* 用户改了设置 */ }
```

- `activate` may return a Promise (the app does not wait for it to finish; async failures are only logged and do not affect other features);
- `deactivate` is called on uninstall/disable/app exit (best effort);
- `ctx.settings` is a read-only snapshot; do not write `settings.json` yourself — use manifest `settings` for persisted settings;
- Implement `commands` in the `module.exports.commands` object; the argument is the same `ctx`.

### 5.6 Error handling

- Just `throw new Error('readable reason')`;
- Playback errors show "Extension decryption failed: …"; `processAudio` failures show "Extension failed to process audio: …";
  add-to-list failures are marked "Cannot decode"; settings/command errors are shown in the settings page status line;
- Do not `process.exit()` / call `app.quit()` / show a system dialog;
- Do not start resident timers or listen on ports — extensions are only called on demand and have no lifecycle management of their own.

---

## 6. Runtime and caching

- Decode results are cached by the app; extensions do not write files themselves:
  - Location: `<userData>/decode-cache/`;
  - Cache key: `sha1(original file path + file size + mtime + extension id@version)` → after an extension upgrade, old caches are not hit;
  - Cache files: `<key>.<ext>` plus same-name `.meta.json` / `.cover.img` sidecars;
- The `readMeta` fast path **does not write the decode cache**; decoding and caching happen only on actual playback;
- If you change extension code without bumping `version`, old files may still hit the old cache → delete `decode-cache/` or use a different test file;
- The original file is never modified/moved; extensions do not need to write their own cache;
- The extension module is `require`d only once per process → you must restart the app after code changes;
- The enabled list is in `settings.enabledExtensions`; setting values are in `settings.extensionSettings`;
- Extensions that fail to load are silently skipped (startup is unaffected) → when debugging, check the main-process log first / use Node unit tests.

---

## 7. Startup activation and windows

Extensions that declare `"startup": true` in the manifest get `activate(ctx)` called automatically at app startup (after the main window is created).
This suits extensions that need a **test window** or background assistance (`../irix-extension/qa/test-interfaces/` in the workspace is an example).

In the Electron main process, an extension can `require('electron')` to create windows, but it is recommended to follow:

- `contextIsolation: true`, `nodeIntegration: false`;
- Use `preload.js` + `contextBridge` to expose a minimal API; window pages must not access Node directly;
- Use a unique prefix for IPC channels (for example `irix-test-interfaces:*`); on `deactivate()` remove the `ipcMain` handlers and close the window;
- Log window-creation failures via `ctx.log` only; do not let app startup fail (try/catch inside `activate`);
- In a non-Electron environment (Node unit tests) `require('electron')` cannot get a BrowserWindow → skip gracefully.

> Extensions run in the main process and have full Node privileges; declarative settings/commands **only constrain the UI** and do not isolate permissions.
> Write only the capabilities you need, and follow the security review in Section 8.

---

## 8. Security model and submission review

> **An extension = trusted local code**. It runs in the main process with the same Node privileges as the app
> (file read/write, spawning subprocesses, network access…). The app has no extension sandbox.
> Installing an extension = agreeing to run that code; install only from sources you trust.

Submission review checklist:

- [ ] **Pure JavaScript**: no native `.node` modules, no npm dependencies (there is no install step for the extension directory);
- [ ] **No remote code loading**: no `eval` / `new Function` / downloading and executing code;
- [ ] **Least privilege**: do not write paths outside the extension directory (caching is the app's responsibility), do not modify the user's music files;
- [ ] **Network optional and declared**: no network requests by default; if unavoidable, state it clearly in the README;
- [ ] **No subprocesses**: do not use `child_process` to call external programs; if truly necessary, explain why in the Pull Request;
- [ ] **No telemetry/privacy collection**: do not upload user paths, file names, or audio content;
- [ ] **Robust**: do not crash or OOM on truncated/forged/oversized files (at minimum check lengths and offsets);
- [ ] **Performance**: synchronous hooks should take < 1 second per file where possible (large files are a separate matter);
- [ ] **Settings/command safety**: validate inputs in command logic; never splice user setting values directly into shell commands;
- [ ] **No copyright issues**: code is your own or under a compatible license; no third-party libraries/assets;
      handle only files the user **legitimately owns**; do not embed copyright-protected keys/content;
- [ ] **Documentation**: a `README.md` in the directory (features, format, known limitations, how to test);
- [ ] **Valid manifest**: id is unique and matches the regex, version is incremented, extensions suffixes are accurate, settings/commands are readable.

Before merging, maintainers will actually install it + play real files + verify settings/commands.

---

## 9. Packaging

### 9.1 Windows PowerShell

```powershell
tar -cf "iRix-Extension-myplugin-1.0.0.xtxs" -C "..\irix-extension\community\myplugin" .
tar -tf "iRix-Extension-myplugin-1.0.0.xtxs"
Get-FileHash "iRix-Extension-myplugin-1.0.0.xtxs" -Algorithm SHA256 | Format-List
```

### 9.2 Linux / macOS / Git Bash

```bash
tar -cf "iRix-Extension-myplugin-1.0.0.xtxs" -C "../irix-extension/community/myplugin" .
tar -tf "iRix-Extension-myplugin-1.0.0.xtxs"
sha256sum "iRix-Extension-myplugin-1.0.0.xtxs"
```

### 9.3 Official built-in extensions (maintainers)

Official extension source is kept outside the repository at `../extensions-src/<id>/`; use:

```bash
node scripts/build-extension.mjs
# 输出：dist/iRix-Extension-<id>-<version>.xtxs
```

Community extensions are packaged directly inside `../irix-extension/community/<id>/` following 9.1.

### 9.4 Packaging the template extension shipped with the repository

The main repository provides a packaging script for the template extension (output goes to `dist/`; install it in the app to verify):

```bash
node scripts/build-template-plugin.mjs
# 输出：dist/iRix-Extension-irix-extension-template-1.0.0.xtxs
# 或：npm run pack:template-plugin
```

Installation steps are the same as Section 10: Settings → Extensions → Install extension… → choose the `.xtxs` → restart.
The template extension's `.hello` sample file can be generated with `../irix-extension/community/irix-extension-template/make-sample.mjs`.

---

## 10. Installation and debugging

### 10.1 Installing with the app (recommended)

Settings → **Extensions** → **Install extension…** → choose the `.xtxs` → click "Restart app".
Enabled by default after installation; the settings list shows name/version/description and allows toggling and uninstalling;
extensions that declare `settings` / `commands` get the corresponding controls/buttons rendered in their card.

### 10.2 Manual installation (development debugging)

1. After installing once, edit files under `<userData>/extensions/<id>/` directly;
2. Restart the app after every change (modules are cached in-process);
3. Or start from source with `npm start`; main-process `console.log` output appears in the terminal.

> Portable build example: `<exe directory>\iRixAudioPlayer-data\extensions\<id>\`;
> for the installed build, use the actual data directory.

### 10.3 Node unit tests without launching the app (strongly recommended)

`index.js` is an ordinary CommonJS module and can be run directly in Node:

```js
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const plugin = require('../irix-extension/community/irix-extension-template/index.js');

const buf = fs.readFileSync('song.hello');
const r = plugin.decode(buf, { name: 'song.hello' });
console.log(r.ext, r.meta, r.data.length);
console.log(plugin.readMeta(buf, { name: 'song.hello' }));
```

Recommended coverage:

- Normal container → correct `ext` / `meta` / `cover` / `data` length;
- `readMeta` returns only metadata; a corrupt file returns `null`;
- Truncated/wrong magic/empty file → throws a readable error, does not crash;
- Ordinary audio masquerading as a container → `passthrough: true` (if the format supports it);
- Calling twice with the same input gives identical results (no side effects).

Reference: `test/ncm-ext-unit.mjs` (22 round-trip tests for the official NCM extension).

### 10.4 Template and interface test extensions

```bash
node ../irix-extension/community/irix-extension-template/make-sample.mjs input.flac song.hello
node test/extensions-guide-unit.mjs     # 文档/模板/真实 .xtxs 安装流程（23 项，含三语指南）
node test/extensions-api-unit.mjs       # 生命周期/设置/命令（14 项）
node test/extensions-test-plugin-unit.mjs  # 测试插件（17 项）
```

The workspace also includes a **development self-test extension** `../irix-extension/qa/test-interfaces/`:

- manifest `"startup": true` → automatically opens the "iRix extension interface test" window at app startup;
- The window can check `ctx/settings/readMeta/decode/extractCover/processAudio/commands/window` all at once or item by item,
  and generate a **playable `.testext`** (containing 1 second of silent WAV) for end-to-end verification;
- The settings page also shows its setting items and three commands (open window/self-test/generate test file).

```powershell
tar -cf dist/iRix-Extension-test-interfaces-1.0.0.xtxs -C ..\irix-extension\qa\test-interfaces .
```

---

## 11. Community submission process

Main project public repository: <https://github.com/sakihanaraku/irix-audio-player>
Extension source repository: the standalone workspace directory `irix-extension/` (a sibling of `music-player/`; not yet published as a separate GitHub repository)

### 11.1 Option A: source goes into the extension repository (recommended)

1. Fork/copy the extension repository;
2. Commit under `irix-extension/community/<your-plugin-id>/`:
   - `extension.json` (required)
   - `index.js` (required, or the entry specified by the manifest)
   - `README.md` (required: features, format, limitations, how to test)
   - `LICENSE` (optional, recommended)
   - `test/` or `fixtures/` (optional: synthetic samples/unit tests; **do not commit copyright-protected music files**)
3. Package locally per Section 9 and verify installation per Section 10;
4. Open a Pull Request titled: `[extension] <name> v<version>`;
5. In the Pull Request description include: extension id/version/supported suffixes/declared settings and commands, the tested app version and platform,
   how the test files were generated, and the SHA-256 of the `.xtxs`.

### 11.2 Option B: self-hosted release, submit a catalog entry

1. Publish the `.xtxs` in your repository's GitHub Releases (with SHA-256);
2. Open a Pull Request adding one line to `irix-extension/community/CATALOG.md` (format in that file);
3. Maintainers download → verify SHA-256 → install → verify actual playback/settings/commands, then merge.

### 11.3 Versions and updates

- Installing the same `id` again overwrites the old version (the whole `extensions/<id>/` is replaced);
- Increment `version` for every release; record a CHANGELOG in the README;
- The cache key includes `id@version`: after an upgrade, old caches are not hit;
- For breaking format changes, bump the major version and state the required app version in `minAppVersion`
  (the loader currently does not enforce it; it is metadata only).

### 11.4 Review outcome

- Approved: merge the Pull Request; maintainers build the `.xtxs` and attach it to a Release/catalog;
- Needs changes: noted in the Pull Request (security, performance, manifest, docs, etc.);
- Not accepted: remote code, native modules, copyrighted content, malicious behavior, or extensions beyond the current interface scope.

---

## 12. FAQ (frequently asked questions)

| Symptom | Possible cause / handling |
|---|---|
| Install says "This is not an extension package (missing extension.json)" | The package has an extra directory level; use `tar -cf x.xtxs -C <dir> .` |
| Install says "Invalid extension id" | The id does not match `^[a-z0-9][a-z0-9._-]{1,48}$` (2–49 characters, lowercase start) |
| After installation the file browser does not show the suffix | The suffix is not listed in `extensions` / the app was not restarted / the suffix includes a dot |
| The file can be added to the list but playback says it cannot be decoded | `decode` threw, returned a Promise, `ext` is wrong, or `data` is not a Buffer |
| `decode` is implemented but has no effect at all | Forgot to restart; `match` does not match the basename; `decode` is not exported |
| Adding to the list is slow/stuck | Implement the `readMeta()` fast path; do not do heavy work in `decode` |
| Extension code changes do not take effect | Module/decode cache → restart the app; delete `decode-cache/` during development |
| Duration shows 0 or is wrong | `meta.duration` was written in seconds; it should be **milliseconds** |
| Cover does not show | `cover` is too small (<64 bytes is ignored) or not JPEG/PNG; `extractCover` returned a non-Buffer |
| Settings do not take effect after saving | If the extension does not export `onSettingsChanged`, the app prompts for a restart; implementing it makes changes take effect immediately |
| Command says "The extension does not implement this command" | The manifest declares the command, but `module.exports.commands` has no function with that name |
| Startup popup crashes/hangs | Window creation not wrapped in try/catch, IPC channel conflict, preload uses nodeIntegration; see Section 7 |
| Multiple extensions fight over the same files | `match` is too broad; use a precise regex |
| Opening a file/playback hangs | `decode`/`readMeta`/`processAudio` loops forever or allocates a huge amount of memory |
| The file was modified but the sound is still the old one | `decode-cache/` is hit and the extension version did not change; delete the cache directory or touch the file |

---

## 13. English summary (for international contributors)

An extension is a **tar package (`.xtxs`)** containing `extension.json` and a CommonJS entry
(`index.js`) loaded in the Electron **main process**.

```js
module.exports = {
  match: /\.xyz$/i,
  decode(buffer, { name }) {           // SYNCHRONOUS
    return {
      data: Buffer,                    // decoded audio bytes
      ext: 'flac',                     // real format, no dot
      meta: { title, artist, album, duration /* ms */ },
      cover: Buffer,                   // optional JPEG/PNG
      passthrough: false,
    };
  },
  readMeta(buffer, { name }) { /* optional sync: meta or null */ },
  extractCover(buffer, { name }) { /* optional sync: Buffer or null */ },
  processAudio(data, ctx) { /* optional sync: Buffer or { data, ext } */ },
  activate(ctx) {},                 // ctx: { appVersion, extension, settings, log }
  deactivate() {},
  onSettingsChanged(values, key) {},
  commands: { async ping(ctx) { return 'pong'; } },
};
```

`extension.json` may declare `settings` (text/number/boolean/select) and `commands`,
which are rendered as declarative controls in Settings → Extensions.
`"startup": true` activates the extension when the app starts.

Rules: pure JavaScript only (no native modules, no npm dependencies), no remote code,
no child processes, validate all lengths/offsets, be idempotent and reasonably fast.
Plugins are trusted local code with main-process privileges — review carefully.
Declarative UI only constrains the interface, **not** runtime permissions.

Build / contribute:

```bash
tar -cf iRix-Extension-my-plugin-1.0.0.xtxs -C ../irix-extension/community/my-plugin .
node test/extensions-guide-unit.mjs
node test/extensions-api-unit.mjs
# Pull Request: add irix-extension/community/<id>/{extension.json,index.js,README.md}
```

The runnable template lives at `irix-extension/community/irix-extension-template/` (workspace sibling of `music-player/`).

---

## Appendix A: Template container format (example only)

```
偏移   长度     内容
0      8        "HELLOXTS"（ASCII 魔数）
8      4        头部 JSON 长度 N（uint32 little-endian）
12     N        头部 JSON（UTF-8）：{ title, artist, album, duration }
12+N   ...      原始音频数据（FLAC/MP3/WAV/OGG/...）
```

`duration` is in **milliseconds**. This is only the template's own format; real extensions should implement their actual format.

## Appendix B: Directory and file checklist

```
irix-extension/community/<id>/
├── extension.json      # 必填；id 与目录名一致；settings/commands 可选
├── index.js            # 必填；CommonJS；同步钩子；match 精确
├── README.md           # 必填；功能/格式/限制/测试方式
├── LICENSE             # 推荐；MIT 等兼容许可证
└── (可选) test/ fixtures/ make-sample.mjs …
```

After packaging, `tar -tf` should look like:

```
./
./extension.json
./index.js
./README.md
```

> Before submitting, make sure `node test/extensions-guide-unit.mjs`, `node test/extensions-api-unit.mjs`,
> `node test/extensions-test-plugin-unit.mjs` pass, and that real playback/settings/commands in the app succeed as described in Section 10.
