# Third-Party Components and Notices

[中文](THIRD-PARTY-NOTICES.zh-CN.md) | **English** | [日本語](THIRD-PARTY-NOTICES.ja.md)

iRix Audio Player itself is released under the MIT license (see `LICENSE`). The following third-party components are **distributed with the package or required at runtime**.
This file is distributed with the installer (`package.json`'s `build.files` includes it).

## 1. Components distributed with the app

| Component | License | Notes / obligations |
|---|---|---|
| **Electron** | MIT | Application shell. Its distribution includes `LICENSE.electron.txt` and `LICENSES.chromium.html` (the latter is 14.8 MB and covers Chromium and all of its third-party libraries); both are distributed with the package ✓ |
| **Chromium** | BSD-3-Clause | Built into Electron; includes libraries under Apache-2.0 / LGPL / MIT and others, all listed in `LICENSES.chromium.html` |
| **Node.js** | MIT | Runtime bundled with Electron |
| **Material Symbols / Icons** | Apache-2.0 | The "music note" icon in the title bar uses its `music_note` glyph. License text: <https://www.apache.org/licenses/LICENSE-2.0>; upstream: <https://github.com/google/material-design-icons> |

> Complete license texts for Electron/Chromium/Node are provided by Electron's own packaging process (see `LICENSE.electron.txt` and `LICENSES.chromium.html` in the product root); this file does not reproduce them.

## 2. External programs distributed with the package: FFmpeg / ffprobe (**GPLv3**)

> ⚠️ **Correction 2026-10-16**: this section previously said "not distributed with the package" ✗ — that was **wrong**. In reality `build.extraResources` in `package.json` copies `vendor/ffmpeg/bin/` into the installer (`resources/ffmpeg/bin/`), and `vendor/` does contain those two binaries. The corrected description follows.

| Item | Details |
|---|---|
| Files distributed | `vendor/ffmpeg/bin/ffmpeg.exe` (61.5 MB), `vendor/ffmpeg/bin/ffprobe.exe` (77.2 MB) |
| Build version | `ffmpeg version N-92722-gf22fcd4483` (built in 2018 with gcc 8.2.1) |
| Key configure flags | `--enable-gpl --enable-version3 --enable-libx264 --enable-libmp3lame` → therefore **GPLv3** (not LGPL) |
| License text | Bundled: [`LICENSES/GPL-3.0.txt`](LICENSES/GPL-3.0.txt) |
| Relationship to this app | This app invokes them via **child processes** (`spawn` / `execFile`); it does **not link or embed** their code → this is **"aggregate distribution of independent programs"**: GPLv3 **does not change this app's own MIT license** ✓, but **distributing the whole installer must also comply with GPLv3** (include the license text + provide a way to obtain the source) ✓ |

### Obtaining the ffmpeg source (GPLv3 requirement)
The bundled binaries are **BtbN's Windows builds** (<https://github.com/BtbN/FFmpeg-Builds>), corresponding to the **official FFmpeg source** (<https://ffmpeg.org/download.html>) plus the configure flags listed above.
Anyone who receives this installer can obtain the complete corresponding source from those links; if you need us to provide it, please open an issue at <https://github.com/sakihanaraku/irix-audio-player/issues>.

> If you want to **reduce the installer size / avoid this GPL obligation**: delete `vendor/ffmpeg/bin/` (about 139 MB) and remove `build.extraResources` from `package.json`; the app will automatically fall back to the ffmpeg on the user's machine (specified in Settings, or via `AURORA_FFMPEG` / `PATH`).

## 3. Original parts of this project

- Native audio engine (`native/`, N-API + WASAPI / DirectSound / WinMM / ALSA, plus a Wine fallback chain);
- All renderer UI code and hand-drawn SVG icons (of the 26 `<path>` elements, only the `music_note` above comes from Material);
- Lyrics (LRC), equalizer (DSP), audio conversion, playback statistics, and other modules;
- **All test media is generated in-house**: `scripts/make-test-media.mjs` synthesizes audio and cover art in code; it contains no third-party assets;
- No third-party fonts, icon fonts, or frontend libraries are embedded (no jQuery / CryptoJS / lodash / Bootstrap / webpack output).
