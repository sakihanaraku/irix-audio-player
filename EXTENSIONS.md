# `.xtxs` 插件开发指南（社区投稿版）

> 适用：**iRix Audio Player 1.0.2-extUpdate 及以后** · 扩展接口 **ext**
> 文档版本：2026-10-21 · 仓库：<https://github.com/sakihanaraku/irix-audio-player>

本指南面向想为 iRix Audio Player 编写插件的社区开发者：从最小可运行示例、清单与模块规范，
到设置/命令、启动窗口、调试和投稿流程，全部以当前版本的实际行为为准。

> **布局**：插件源码已作为独立目录 `irix-extension/` 放在工作区根（与 `music-player/` 同级）。
> 本指南位于 `music-player/EXTENSIONS.md`，所以下文文件路径相对 `music-player/` 根目录，
> 插件路径写作 `../irix-extension/...`；第 11 节投稿流程对应独立的扩展仓库。

**30 秒版**

1. 复制模板目录：`../irix-extension/community/irix-extension-template/`
   （独立仓库：<https://github.com/sakihanaraku/irix-extension-template>，可直接 clone）；
2. 改 `extension.json`（id/name/version/extensions）和 `index.js`（你的容器格式）；
3. `tar -cf my-plugin.xtxs -C 你的插件目录 .`；
4. 应用 → 设置 → 扩展 → 安装扩展… → 重启；
5. 测试通过后向扩展仓库提 PR（源码放 `irix-extension/community/<id>/`，或提交 `.xtxs` 目录条目）。

---

## 1. 插件是什么

播放器用 ffmpeg 解码常规音频（FLAC/WAV/MP3/…）。插件让你可以：

- **让播放器认识一种新容器**（自定义/加密格式），并在播放前还原成普通音频；
- 为这些文件提供**元数据**（标题/艺术家/专辑/时长）与**封面**；
- 在「设置 → 扩展」里提供**声明式设置项**（开关/下拉/数字/文本）；
- 提供**命令按钮**（例如清缓存、生成示例、打开自检窗口）；
- 通过生命周期钩子做初始化/清理，或声明**启动时激活**（适合弹测试窗口等场景）。

### 1.1 插件能做什么

| 能力 | 对应接口 |
|---|---|
| 容器解码 | `decode(buffer, { name })` |
| 快速读元数据（不解码整段音频） | `readMeta(buffer, { name })` |
| 快速取封面（不落缓存） | `extractCover(buffer, { name })` |
| 文件级音频后处理（归一化/重采样等） | `processAudio(data, ctx)` |
| 生命周期 | `activate(ctx)` / `deactivate()` |
| 声明式设置 | `extension.json` 的 `settings` + `onSettingsChanged(values, key)` |
| 命令按钮 | `extension.json` 的 `commands` + `module.exports.commands` |
| 启动激活 | `extension.json` 的 `"startup": true` |

### 1.2 插件不能做什么

- ❌ **不能注入任意界面**：只能通过清单里的 `settings` / `commands` 生成声明式控件；
  不能注入 HTML/JS/CSS，不能改播放器主界面布局；
- ❌ **不能做实时 DSP/音效**：没有实时音频回调；`processAudio` 只处理"已经解码出的整段文件"；
- ❌ **不能做在线音乐源/搜索**：插件只在「本地文件 → 可播放音频」这一步被调用；
- ❌ **不能流式解密**：`decode` / `readMeta` 拿到的是一整个文件的 `Buffer`，必须同步返回；
- ❌ **不能后台常驻**：插件模块只为需要时加载一次，没有自己的常驻定时器/生命周期 API。

> 需要以上之外的能力，请先开 Issue 讨论接口设计，不要直接写依赖未公开行为的插件。

---

## 2. 快速开始

### 2.1 目录结构

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

复制后先改这些：

| 改什么 | 改成什么 |
|---|---|
| 目录名 | 你的插件 id（小写字母/数字/`.-_`） |
| `extension.json` 的 `id` | 与目录名一致 |
| `extension.json` 的 `name` / `description` / `author` / `version` | 你的信息 |
| `extension.json` 的 `extensions` | 你的容器后缀（不带点、小写） |
| `index.js` 的 `MAGIC` / 解析逻辑 / `match` | 你的容器格式 |
| `index.js` 的 `module.exports.id` | 与 manifest 的 `id` 一致（便于阅读；加载器以 manifest 为准） |

### 2.2 `extension.json`（可直接复制的完整示例）

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

### 2.3 `index.js`（可直接复制的完整示例）

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

### 2.4 打包、安装、验证

```powershell
# 1) 打包（.xtxs 就是 tar 包；-C 指定源目录，. 表示把目录内容放在包根）
tar -cf iRix-Extension-irix-extension-template-1.0.0.xtxs -C ..\irix-extension\community\irix-extension-template .

# 2) 检查包内容（应看到 extension.json / index.js / README.md）
tar -tf iRix-Extension-irix-extension-template-1.0.0.xtxs
```

1. 播放器 → **设置 → 扩展 → 安装扩展…** → 选 `.xtxs`；
2. 出现「已更改，重启应用后生效」→ 点 **重启应用**；
3. 生成测试文件（把任意 flac/mp3 包成 `.hello`）：

```powershell
node ..\irix-extension\community\irix-extension-template\make-sample.mjs .\song.flac .\song.hello
```

4. 重启后文件浏览器可见 `.hello` 文件；加入播放列表：
   - 条目应**立即出现**（走 `readMeta` 快速路径）；
   - 播放时标题/艺术家/专辑/时长来自容器元数据；
   - 设置页能看到模板的开关设置与测试命令，修改/点击应即时反馈。

---

## 3. `.xtxs` 包格式

- `.xtxs` = **tar 包**（不压缩），扩展名只是约定；
- 包内**根目录**必须有 `extension.json`；推荐带 `index.js`、`README.md`、可选 `LICENSE`；
- 允许包里再套一层目录（安装器会自动去掉单层包装），但请直接把文件放在包根；
- 安装时应用用系统 `tar -xf` 解压（Windows 10+ 自带 bsdtar，零第三方依赖）；
- `.zip` 对话框也接受，但依赖 bsdtar；**Linux/macOS 请使用标准 `.xtxs`（tar）**；
- 文件命名建议：`iRix-Extension-<id>-<version>.xtxs`；
- 不要放 `node_modules`、原生 `.node` 模块、可执行文件（见第 8 节安全规则）。

安装后位置（由应用管理）：

```
<userData>/extensions/<id>/extension.json
<userData>/extensions/<id>/index.js
```

- 便携版：`userData` = exe 同级目录下的 `iRixAudioPlayer-data/`；
- 安装版：`userData` = 系统应用数据目录（`%APPDATA%` 下）。

安装 = 解压 → 校验清单 → 复制到 `extensions/<id>/` → 自动启用。
**安装/卸载/启用切换后都需要重启应用生效**（文件后缀表与模块缓存都在启动时建立）。
设置的持久化值保存在 `settings.json` 的 `extensionSettings.<id>`；卸载时自动清除。

---

## 4. `extension.json` 字段规范

| 字段 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `id` | ✅ | string | 唯一 id：`^[a-z0-9][a-z0-9._-]{1,48}$`（大小写不敏感，建议全小写）；目录名 = id |
| `name` | ✅ | string | 显示名 |
| `version` | ✅ | string | 版本号，推荐语义化版本 |
| `description` | ✅ | string | 一句话说明 |
| `entry` | 可选 | string | 入口文件（相对插件目录），默认 `index.js` |
| `extensions` | 推荐 | string[] | 能处理的容器后缀（不带点、小写）。重启后文件浏览器才会显示 |
| `minAppVersion` | 可选 | string | 最低应用版本；**当前仅做元数据展示，加载器不强制校验** |
| `author` | 推荐 | string | 作者名/ID |
| `homepage` | 可选 | string | 插件主页/源码地址（加载器忽略，供目录展示） |
| `license` | 可选 | string | 许可证标识（加载器忽略，供目录展示） |
| `startup` | 可选 | boolean | `true` = 应用启动时自动 `activate()`（弹窗/后台辅助类插件用） |
| `settings` | 可选 | array | 声明式设置项（最多 32 项） |
| `commands` | 可选 | array | 命令按钮（最多 16 项） |

### 4.1 `settings` 设置项

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

- `number` 支持 `min` / `max` / `step`，越界值会被 clamp；
- `boolean` 默认 `true`（除非显式 `default: false`）；
- `select` 的 `options` 最多 24 项，值必须在白名单内；
- 文本值最长 4096 字符；不合法/未知的项会被丢弃或拒绝，不会导致应用崩溃。

设置值由主进程保存并在插件 `activate(ctx)` 时通过 `ctx.settings` 提供（默认值 + 已保存值）。
用户改设置时调用 `onSettingsChanged(values, key)`；插件未实现该钩子时设置页会提示重启。

### 4.2 `commands` 命令按钮

```js
{ id: 'clear-cache', label: '清理解码缓存', description: '删除本扩展的解码缓存' }
```

模块里导出同名函数：

```js
module.exports = {
  commands: {
    async 'clear-cache'(ctx) {
      return '已清理 3 个缓存文件';   // 返回值显示在设置页状态行
    },
  },
};
```

- 命令在主进程执行，可 async；
- 抛错显示「执行失败：…」，不影响应用；
- 没有实现同名函数显示「插件未实现该命令」。

---

## 5. `index.js` 模块接口

插件入口是 **CommonJS** 模块，在**主进程**加载（不运行在渲染层），因此可使用
`node:fs` / `node:crypto` 等 Node 内置模块。

### 5.1 导出形状

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

- 必须是 **RegExp**（加载器用 `instanceof RegExp` 判断）；
- 只对**文件名**（basename）测试，不匹配完整路径；
- 多个插件同时匹配时，按扩展显示名排序后第一个生效 → `match` 要尽量精确，
  例如 `/\.hello$/i`，不要 `/hello/i`；
- 大小写按需加 `i`。

### 5.3 核心接口

| 接口 | 必需 | 说明 |
|---|---|---|
| `decode(buffer, { name })` | 是（仅做元数据的插件可省） | **必须同步**，返回 `{ data, ext, meta?, cover?, passthrough? }` |
| `readMeta(buffer, { name })` | 可选 | **必须同步**，只返回 `meta`（`duration` 毫秒）或 `null`。用于加入播放列表快速路径；返回 `null` 回退完整解码 |
| `extractCover(buffer, { name })` | 可选 | **必须同步**，返回 JPEG/PNG `Buffer`（>64 字节）或 `null`；封面读取优先调用，不写缓存 |
| `processAudio(data, ctx)` | 可选 | **必须同步**，返回 `Buffer` 或 `{ data, ext }`；`ctx = { name, ext, meta, sourcePath }`。这是**文件级后处理**，不是实时 DSP |

调用时机（同一文件可能被调用多次，必须**无副作用、可重复**）：

1. **加入播放列表**：优先 `readMeta()`；没有/失败 → 完整 `decode()` + ffprobe；
2. **播放**：完整 `decode()` 后走可选的 `processAudio()`，结果写入解码缓存；
3. **封面**：优先 `extractCover()`；否则从解码音频/sidecar 读取。

**同步要求**：播放器直接读取返回值，不会 `await`。返回 `Promise` 会被当成"没有结果"，
表现为**不报错但不生效**（最常见的新手坑）。

**性能与内存**：整个文件在内存里且主进程同步执行 → 不要长时间阻塞；
大文件请评估内存占用；能只读头部就不要全量扫描。

**健壮性**：必须校验长度/偏移（参考模板的 `headLen` 检查）；坏文件应抛错，
而不是越界分配内存或死循环。

### 5.4 `decode` 返回值

| 键 | 类型 | 说明 |
|---|---|---|
| `data` | Buffer | **必需**（`passthrough` 除外）。原始音频字节 |
| `ext` | string | **必需**（`passthrough` 除外）。真实格式：`flac`/`mp3`/`wav`/`ogg`/`m4a`/`aac`/`opus` 等 |
| `meta` | object | 可选。字段见下表 |
| `cover` | Buffer | 可选。JPEG/PNG；建议 ≤ 2 MB、≤ 1024×1024 |
| `passthrough` | boolean | 可选。`true` = 不是我的容器/解出来就是普通音频，播放器用原文件继续 |

`meta` 字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `title` | string | 标题 |
| `artist` | string | 艺术家 |
| `album` | string | 专辑 |
| `duration` | number | **毫秒**（3 分 15 秒 = `195000`）；播放器内部会 `/1000` |

### 5.5 生命周期、设置与命令

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

- `activate` 可以返回 Promise（应用不等待它完成；异步失败只记日志，不影响其他功能）；
- `deactivate` 在卸载/禁用/应用退出时调用（best effort）；
- `ctx.settings` 是只读快照；不要自己写 `settings.json`，持久化设置请用 manifest `settings`；
- `commands` 的实现放在 `module.exports.commands` 对象里，参数同 `ctx`。

### 5.6 错误处理

- 直接 `throw new Error('可读的中文原因')`；
- 播放时错误显示「扩展解密失败：…」；`processAudio` 失败显示「扩展处理音频失败：…」；
  加入列表失败标记「无法解码」；设置/命令错误显示在设置页状态行；
- 不要 `process.exit()` / 调用 `app.quit()` / 弹系统对话框；
- 不要启动常驻定时器/监听端口 —— 插件只在需要时被调用，没有自己的生命周期管理。

---

## 6. 运行时与缓存

- 解码结果由应用缓存，插件自己不写文件：
  - 位置：`<userData>/decode-cache/`；
  - 缓存键：`sha1(原文件路径 + 文件大小 + mtime + 插件 id@version)` → 插件升级后不会命中旧缓存；
  - 缓存文件：`<key>.<ext>` + 同名 `.meta.json` / `.cover.img` sidecar；
- `readMeta` 快速路径**不写解码缓存**；真正播放时才解码并缓存；
- 改了插件代码但没升 `version` 时旧文件仍可能命中旧缓存 → 删 `decode-cache/` 或换测试文件；
- 原文件不会被修改/移动；插件不需要自己写缓存；
- 插件模块每个进程只 `require` 一次 → 改完代码必须重启应用；
- 启用列表在 `settings.enabledExtensions`，设置值在 `settings.extensionSettings`；
- 加载失败的插件会被静默跳过（不影响启动）→ 调试时先看主进程日志 / 用 Node 单测。

---

## 7. 启动激活与窗口

清单里声明 `"startup": true` 的插件，会在应用启动（主窗口创建后）自动调用 `activate(ctx)`。
这适合需要**测试窗口**或后台辅助的插件（工作区里的 `../irix-extension/qa/test-interfaces/` 就是示例）。

在 Electron 主进程里，插件可以 `require('electron')` 创建窗口，但建议遵循：

- `contextIsolation: true`、`nodeIntegration: false`；
- 用 `preload.js` + `contextBridge` 暴露最小 API，窗口页面不要直接拿 Node；
- IPC 通道用唯一前缀（例如 `irix-test-interfaces:*`），`deactivate()` 时移除 `ipcMain` handler 并关闭窗口；
- 窗口创建失败只记 `ctx.log`，不要让应用启动失败（`activate` 内部 try/catch）；
- 非 Electron 环境（Node 单测）中 `require('electron')` 拿不到 BrowserWindow → 优雅跳过。

> 插件运行在主进程，拥有完整 Node 权限；声明式设置/命令**只限制界面**，不隔离权限。
> 只写你需要的能力，并遵守第 8 节安全审查。

---

## 8. 安全模型与投稿审查

> **插件 = 受信任的本地代码**。它运行在主进程，拥有和应用同等的 Node 权限
> （读写文件、启动子进程、访问网络……）。应用没有插件沙箱。
> 用户装插件 = 同意运行该代码，请只在信任来源安装。

投稿审查清单：

- [ ] **纯 JavaScript**：无原生 `.node` 模块、无 npm 依赖（插件目录没有安装步骤）；
- [ ] **无远程代码加载**：不 `eval` / `new Function` / 下载并执行代码；
- [ ] **最小权限**：不写插件目录之外的路径（缓存由应用负责），不修改用户音乐文件；
- [ ] **网络可选且声明**：默认不发网络请求；必须时在 README 写清楚；
- [ ] **无子进程**：不要 `child_process` 调外部程序；确有必要请在 PR 说明原因；
- [ ] **无遥测/收集隐私**：不上传用户路径、文件名、音频内容；
- [ ] **健壮**：对截断/伪造/超大文件不崩溃、不 OOM（至少检查长度与偏移）；
- [ ] **性能**：同步钩子单文件尽量 < 1 秒（大文件另议）；
- [ ] **设置/命令安全**：命令逻辑校验输入；不要把用户设置值直接拼进 shell 命令；
- [ ] **无版权问题**：代码自写或使用兼容许可证，不带第三方库/素材；
      只处理**用户自己合法拥有**的文件，不得内置受版权保护的密钥/内容；
- [ ] **文档**：目录内有 `README.md`（功能、格式、已知限制、测试方式）；
- [ ] **清单合法**：id 唯一且符合正则、version 递增、extensions 后缀准确、settings/commands 可读。

维护者合并前会实际安装 + 真实文件播放 + 设置/命令验证。

---

## 9. 打包

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

### 9.3 官方内置扩展（维护者）

官方扩展源码放在仓库外 `../extensions-src/<id>/`，用：

```bash
node scripts/build-extension.mjs
# 输出：dist/iRix-Extension-<id>-<version>.xtxs
```

社区插件直接在 `../irix-extension/community/<id>/` 里按 9.1 打包。

### 9.4 打包仓库自带的模板插件

主仓库提供了模板插件的打包脚本（输出到 `dist/`，可安装到应用里验证）：

```bash
node scripts/build-template-plugin.mjs
# 输出：dist/iRix-Extension-irix-extension-template-1.0.0.xtxs
# 或：npm run pack:template-plugin
```

安装步骤同第 10 节：设置 → 扩展 → 安装扩展… → 选 `.xtxs` → 重启。
模板插件的 `.hello` 示例文件可用 `../irix-extension/community/irix-extension-template/make-sample.mjs` 生成。

---

## 10. 安装与调试

### 10.1 用应用安装（推荐）

设置 → **扩展** → **安装扩展…** → 选 `.xtxs` → 点「重启应用」。
安装后默认启用；设置列表显示名称/版本/说明，可开关、卸载；
声明了 `settings` / `commands` 的插件会在卡片里生成对应控件/按钮。

### 10.2 手动安装（开发调试）

1. 安装一次后，直接编辑 `<userData>/extensions/<id>/` 下文件；
2. 每次改完重启应用（模块有进程内缓存）；
3. 或从源码启动 `npm start`，主进程 `console.log` 会显示在终端。

> 便携版示例：`<exe 所在目录>\iRixAudioPlayer-data\extensions\<id>\`；
> 安装版以实际数据目录为准。

### 10.3 不启动应用，先做 Node 单测（强烈推荐）

`index.js` 是普通 CommonJS 模块，可以直接在 Node 里跑：

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

建议覆盖：

- 正常容器 → `ext` / `meta` / `cover` / `data` 长度正确；
- `readMeta` 只返回元数据，坏文件返回 `null`；
- 截断/错误魔数/空文件 → 抛可读错误，不崩溃；
- 冒充容器的普通音频 → `passthrough: true`（如格式支持）；
- 同一输入连续调用两次结果一致（无副作用）。

参考：`test/ncm-ext-unit.mjs`（官方 NCM 扩展的 22 项往返测试）。

### 10.4 模板与接口测试插件

```bash
node ../irix-extension/community/irix-extension-template/make-sample.mjs input.flac song.hello
node test/extensions-guide-unit.mjs     # 文档/模板/真实 .xtxs 安装流程（21 项）
node test/extensions-api-unit.mjs       # 生命周期/设置/命令（14 项）
node test/extensions-test-plugin-unit.mjs  # 测试插件（17 项）
```

工作区还带一个**开发自测插件** `../irix-extension/qa/test-interfaces/`：

- manifest `"startup": true` → 应用启动时自动弹「iRix 扩展接口测试」窗口；
- 窗口可一键/逐项检查 `ctx/设置/readMeta/decode/extractCover/processAudio/commands/窗口`，
  并生成**可播放的 `.testext`**（内含 1 秒静音 WAV）用于端到端验证；
- 设置页也能看到它的设置项和三个命令（打开窗口/自检/生成测试文件）。

```powershell
tar -cf dist/iRix-Extension-test-interfaces-1.0.0.xtxs -C ..\irix-extension\qa\test-interfaces .
```

---

## 11. 社区投稿流程

主项目公开仓库：<https://github.com/sakihanaraku/irix-audio-player>
扩展源码仓库：工作区独立目录 `irix-extension/`（与 `music-player/` 同级；当前尚未单独发布 GitHub 仓库）

### 11.1 方式 A：源码进扩展仓库（推荐）

1. Fork/复制扩展仓库；
2. 在 `irix-extension/community/<your-plugin-id>/` 提交：
   - `extension.json`（必填）
   - `index.js`（必填，或 manifest 指定入口）
   - `README.md`（必填：功能、格式、限制、测试方式）
   - `LICENSE`（可选，推荐）
   - `test/` 或 `fixtures/`（可选：合成样本/单测；**不要提交受版权保护的音乐文件**）
3. 本地按第 9 节打包、按第 10 节安装验证；
4. 提 PR，标题：`[extension] <name> v<version>`；
5. PR 描述附：插件 id/版本/支持后缀/声明的设置与命令、测试过的应用版本与平台、
   测试文件生成方法、`.xtxs` 的 SHA-256。

### 11.2 方式 B：自行托管发布，提交目录条目

1. 在你的仓库 GitHub Releases 发布 `.xtxs`（附 SHA-256）；
2. 提 PR，在 `irix-extension/community/CATALOG.md` 增加一行（格式见该文件）；
3. 维护者下载 → 校验 SHA-256 → 安装 → 实际播放/设置/命令验证后合并。

### 11.3 版本与更新

- 同一 `id` 再次安装会覆盖旧版本（`extensions/<id>/` 整个替换）；
- 每次发布递增 `version`，README 记 CHANGELOG；
- 缓存键包含 `id@version`：升级后旧缓存不会被命中；
- 破坏性格式变更建议提升主版本号，并在 `minAppVersion` 写明所需应用版本
  （当前加载器不强制校验，只是元数据）。

### 11.4 审查结果

- 通过：合并 PR，维护者打 `.xtxs` 附到 Release/目录；
- 需修改：PR 里写明（安全、性能、清单、文档等）；
- 不接受：远程代码、原生模块、版权内容、恶意行为，或超出当前接口范围的插件。

---

## 12. 常见问题（FAQ）

| 现象 | 可能原因 / 处理 |
|---|---|
| 安装提示「这不是扩展包（缺 extension.json）」 | 打包时多套了一层目录；用 `tar -cf x.xtxs -C <dir> .` |
| 安装提示「扩展 id 不合法」 | id 不符合 `^[a-z0-9][a-z0-9._-]{1,48}$`（2–49 字符、小写开头） |
| 装好后文件浏览器看不到后缀 | `extensions` 没写该后缀 / 没重启 / 后缀带了点 |
| 文件能加入列表但播放提示解不了 | `decode` 抛错、返回了 Promise、`ext` 不对、`data` 不是 Buffer |
| `decode` 明明写了却完全不生效 | 忘记重启；`match` 没匹配上 basename；没有导出 `decode` |
| 加入列表很慢/卡住 | 实现 `readMeta()` 快速路径，不要在 `decode` 里做重活 |
| 改了插件代码不生效 | 模块/解码缓存 → 重启应用；开发期删 `decode-cache/` |
| 时长显示 0 或不对 | `meta.duration` 单位写成秒了，应为**毫秒** |
| 封面不显示 | `cover` 太小（<64 字节忽略）或不是 JPEG/PNG；`extractCover` 返回了非 Buffer |
| 设置保存后没生效 | 插件未导出 `onSettingsChanged` 时会提示重启；实现它可即时生效 |
| 命令提示「插件未实现该命令」 | manifest 声明了命令但 `module.exports.commands` 里没有同名函数 |
| 启动弹窗崩溃/无响应 | 窗口创建未 try/catch、IPC 通道冲突、preload 用了 nodeIntegration；参考第 7 节 |
| 多个插件互相抢文件 | `match` 太宽；改用精确正则 |
| 打开文件/播放时卡死 | `decode`/`readMeta`/`processAudio` 死循环或申请巨量内存 |
| 修改文件但声音还是旧的 | 命中 `decode-cache/` 且插件版本没变；删缓存目录或触摸文件 |

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
# PR: add irix-extension/community/<id>/{extension.json,index.js,README.md}
```

The runnable template lives at `irix-extension/community/irix-extension-template/` (workspace sibling of `music-player/`).

---

## 附录 A：模板容器格式（仅示例）

```
偏移   长度     内容
0      8        "HELLOXTS"（ASCII 魔数）
8      4        头部 JSON 长度 N（uint32 little-endian）
12     N        头部 JSON（UTF-8）：{ title, artist, album, duration }
12+N   ...      原始音频数据（FLAC/MP3/WAV/OGG/...）
```

`duration` 单位**毫秒**。这只是模板自己的格式，正式插件按你的真实格式实现。

## 附录 B：目录与文件清单

```
irix-extension/community/<id>/
├── extension.json      # 必填；id 与目录名一致；settings/commands 可选
├── index.js            # 必填；CommonJS；同步钩子；match 精确
├── README.md           # 必填；功能/格式/限制/测试方式
├── LICENSE             # 推荐；MIT 等兼容许可证
└── (可选) test/ fixtures/ make-sample.mjs …
```

打包后 `tar -tf` 应类似：

```
./
./extension.json
./index.js
./README.md
```

> 提交前确保：`node test/extensions-guide-unit.mjs`、`node test/extensions-api-unit.mjs`、
> `node test/extensions-test-plugin-unit.mjs` 通过，且按第 10 节在应用里真实播放/设置/命令成功。
