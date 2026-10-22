# 第三方组件与来源声明（THIRD-PARTY NOTICES）

**中文** | [English](THIRD-PARTY-NOTICES.md) | [日本語](THIRD-PARTY-NOTICES.ja.md)

iRix Audio Player 本体以 MIT 发布（见 `LICENSE`）。它**随包分发或运行时依赖**的第三方组件如下。
本文件随安装包一起分发（`package.json` 的 `build.files` 含它）。

## 一、随应用分发的组件

| 组件 | 许可 | 说明 / 义务 |
|---|---|---|
| **Electron** | MIT | 应用外壳。其发行版自带 `LICENSE.electron.txt` 与 `LICENSES.chromium.html`（后者 14.8 MB，覆盖 Chromium 及其全部第三方库），随包一并分发 ✓ |
| **Chromium** | BSD-3-Clause | Electron 内置；其中包含 Apache-2.0 / LGPL / MIT 等多种许可的库，全部列在 `LICENSES.chromium.html` 里 |
| **Node.js** | MIT | Electron 内置的运行时 |
| **Material Symbols / Icons** | Apache-2.0 | 标题栏的「音符」图标使用了其 `music_note` 图形。许可文本见 <https://www.apache.org/licenses/LICENSE-2.0> ；上游仓库 <https://github.com/google/material-design-icons> |

> Electron/Chromium/Node 的完整许可文本由 Electron 自己的打包流程提供（见产物根目录的
> `LICENSE.electron.txt`、`LICENSES.chromium.html`），本文件不重复张贴。

## 二、随包分发的外部程序：FFmpeg / ffprobe（**GPLv3**）

> ⚠️ **2026-10-16 更正**：本节原先写的是"不随包分发" ✗，**不对** —— 实际 `package.json` 的 `build.extraResources` 会把
> `vendor/ffmpeg/bin/` 拷进安装包（`resources/ffmpeg/bin/`），`vendor/` 里也确实有这两个二进制。下面是更正后的说明。

| 项目 | 内容 |
|---|---|
| 随包分发的文件 | `vendor/ffmpeg/bin/ffmpeg.exe`（61.5 MB）、`vendor/ffmpeg/bin/ffprobe.exe`（77.2 MB） |
| 构建版本 | `ffmpeg version N-92722-gf22fcd4483`（2018 年构建，gcc 8.2.1） |
| 关键编译开关 | `--enable-gpl --enable-version3 --enable-libx264 --enable-libmp3lame` → 因此是 **GPLv3**（不是 LGPL）|
| 许可文本 | 随包附带：[`LICENSES/GPL-3.0.txt`](LICENSES/GPL-3.0.txt) |
| 与本应用的关系 | 本应用通过**子进程**调用它们（`spawn` / `execFile`），**不链接、不内嵌**其代码 → 属"**独立程序聚合分发**"：GPLv3 **不改变本应用自身的 MIT 许可** ✓，但**分发整个安装包时要同时遵守 GPLv3**（附许可文本 + 提供源码获取方式）✓ |

### ffmpeg 的源码获取（GPLv3 要求）
内置的是 **BtbN 的 Windows 构建**（<https://github.com/BtbN/FFmpeg-Builds>），对应 **FFmpeg 官方源码**（<https://ffmpeg.org/download.html>）+ 上表那条 `configuration:` 里的编译开关。
任何拿到本安装包的人都可以据此获得**完整对应源码**；若需要我方代为提供，请在 <https://github.com/sakihanaraku/irix-audio-player/issues> 提出。

> 如果你想**减小安装包体积 / 免掉这份 GPL 义务**：删掉 `vendor/ffmpeg/bin/`（约 139 MB）并移除 `package.json` 里的 `build.extraResources`，
> 应用会自动回落到用户机器上的 ffmpeg（设置里可指定，或走 `AURORA_FFMPEG` / `PATH`）。

## 三、本项目的自研部分

- 原生音频引擎（`native/`，N-API + WASAPI / DirectSound / WinMM / ALSA，另有 Wine 降级链）；
- 渲染层全部界面代码与自绘 SVG 图标（26 条 `<path>` 中仅上面那一条 `music_note` 来自 Material）；
- 歌词（LRC）、均衡器（DSP）、音频转换、播放统计等模块；
- **测试素材全部自造**：`scripts/make-test-media.mjs` 用代码合成音频与封面，不含任何第三方素材；
- 未内嵌任何第三方字体、图标字体或前端库（无 jQuery / CryptoJS / lodash / Bootstrap / webpack 产物）。
