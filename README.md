# iRix Audio Player

[中文](README.zh-CN.md) | **English** | [日本語](README.ja.md)

> Latest version: **1.0.2-extUpdate**

Based on **Electron** + **N-API** + **ffmpeg**. (!!The Linux version is not stable yet, so there is no build script)
> UI: left column cover / info / controls, lyrics, WebGL peak meter and status cells; right column playlist + file browser. Default window 1366×768.
![Interface](docs/v1.0.2-release-main.png)
![Fullscreen lyrics (customizable background)](docs/Fullscreen-lrc.png)
![Light theme](docs/light-scene.png)
![Playback modes on Windows](docs/dac-settings.png)

## Features
| | |
| --- | --- |
| **Formats** | Recognized by ffprobe / `ffmpeg -i`; known to be supported so far: mp3 m4a flac wav ogg wma |
| **Sound card** | WASAPI exclusive / shared, DirectSound, MME; each of the four modes enumerates devices, negotiates formats and probes availability |
| **Playback** | Drag the progress bar to seek, volume (wheel ±5%), mute (`M`), repeat mode cycling (no repeat → list repeat → single repeat → shuffle) |
| **Playlist** | Drag files into the whole window / multi-select / folders, dedup, persistence, drag to reorder, `.playlist` save/load |
| **Lyrics** | Embedded lyrics → `.lrc` in the same directory → manual selection; current line highlighted + collapsible calibration bar |
| **Equalizer** | 8 bands (20Hz–19kHz, ±12dB) + preamp, applied in real time, 8 presets, `.eq` config save/load |
| **Appearance** | 10 preset theme colors + color picker, light/dark theme toggle, custom title bar |
| **Info & cover** | Embedded cover + title/artist/album/year/genre/codec/container/sample rate/bit depth/channels/bitrate/duration/path |
| **Peak meter** | WebGL (falls back to 2D canvas when unavailable), scale labels -40/-20/-10/-6/-3/0 dBFS, linear amplitude mapping; value floor **-90 dBFS** (= silence, bar width drops to zero), colors follow the theme, 60FPS (if available) |
| **Conversion** | Right-click to convert → FLAC Wave MP3 AAC Vorbis |
| **Play ranking** | Ranked by number of complete plays |
| **Full-window lyrics** | Shows cover + title/artist/album/lyrics (new in v1.0.2-release); the background follows the main background from settings |
| **Installable extensions** | Extensions in .xtxs format can be installed |
| **Extension interface ext-v2** | Lifecycle `activate(ctx)` / `deactivate()`, fast metadata `readMeta()`, cover `extractCover()`, file-level post-processing `processAudio()`, declarative settings/commands, `startup:true` activation at startup (new in v1.0.2-extUpdate) |
| **Extension fix** | Fixed the issue where container plugin files (e.g. `.testext` / `.ncm`) were still handed to ffmpeg as the original container after being added to the playlist, which caused `Invalid data found` (v1.0.2-extUpdate) |

## Extensions

- **Install**: Settings → Extensions → **Install extension…** (`.xtxs` = a tar archive); install/uninstall/toggle takes effect after restarting the app;
- **Developer guide**: [中文](EXTENSIONS.zh-CN.md) | [English](EXTENSIONS.md) | [日本語](EXTENSIONS.ja.md);
- **Template plugin**: [irix-extension-template](https://github.com/sakihanaraku/irix-extension-template) (standalone repository, includes `make-sample.mjs` / `self-test.mjs`);
- **Interface test plugin**: workspace `../irix-extension/qa/test-interfaces/`; pops up a window at startup to self-check every item, and can generate playable `.testext` test files;
- **Interface scope**: `decode` / `readMeta` / `extractCover` / `processAudio` / lifecycle / declarative settings and commands / startup activation;
  real-time DSP, arbitrary UI injection and online music sources are outside the current interface scope.

## Getting started

```powershell
# 1. Install dependencies
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
npm install

# 2. Build the audio engine (requires the C++ workload of VS Build Tools + Python 3)
npm run build:native

# 3. Start
npm start
```

If you'd rather not build manually, download a ready-to-use build from [Releases](https://github.com/sakihanaraku/irix-audio-player/releases).

- Environment: Windows 10/11 x64, Node ≥ 18;
- **ffmpeg is bundled** (`vendor/ffmpeg/bin/`, GPLv3 build, see [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md)); you can also specify ffmpeg.exe in settings, or override it with the `AURORA_FFMPEG` environment variable; to switch to the latest build run `npm run fetch:ffmpeg`;
- Lookup order: explicit setting → `AURORA_FFMPEG` → `vendor/ffmpeg/bin` → workspace tools directory → `PATH` → common install locations.

## Sound card modes

| Mode | Description | Output |
| --- | --- | --- |
| `wasapi-shared` | **Non-exclusive**; automatically adds `AUTOCONVERTPCM` when the format differs | Follows settings, default 48kHz/2ch/f32 |
| `wasapi-exclusive` | **Exclusive**: bypasses the mixer; tries the requested format → the device's native format → the closest format, in that order | Device default takes priority |
| `directsound` | `IDirectSound8` + notification-point segmented filling | 16bit (converted from f32bit) PCM |
| `mme` | WinMM `waveOut`, 4-block rotating buffer | 16bit PCM |

The engine buffer (`ringMs`, default 300ms, options 150/300/800/2000) determines both the playback latency and the peak-meter alignment latency. Each mode lets you choose the device / sample rate / bit depth / channels / exclusive period / device buffer separately, and use "Probe capabilities" to see whether that device actually works.

## Keyboard shortcuts

| Action | Key |
| --- | --- |
| Play / pause | `Space` |
| Rewind / forward 5 seconds | `←` / `→` |
| Volume ±5% | `↑` / `↓` (or the wheel on the volume bar) |
| Mute / restore | `M` (or click the volume icon) |
| Add files | `Ctrl+O` |
| Save as / open playlist | `Ctrl+S` / `Ctrl+Shift+O` |
| Maximize / restore | Double-click the title bar |

## Packaging

```powershell
npm run dist:portable     # single-file exe (self-extracts to %TEMP% and then launches)
npm run dist:setup        # NSIS installer (choose the directory, per-user install, no administrator required)
```

Remember to close any running instance before packaging (a locked exe cannot be written).

## Testing

```powershell
npm test                  # everything (including packaged-artifact checks, if dist has been built)
npm run test:engine       # actually produces sound through each of the four sound-card backends
npm run test:decode       # format detection + decode and play each file + embedded cover/tags
npm run test:app          # main-process business flow (import/dedup/play/seek/mode switching)
npm run test:ipc          # IPC contract of the real main.js + preload.js
npm run test:ui           # real Chromium rendering + interaction assertions + screenshots
npm run test:packaged     # real sound output using the bundled ffmpeg + native module
```

## Directory structure

```
src/main/       Main process: window and IPC, playback session, playlist, ffmpeg conversion, EQ, lyrics, stats
src/preload/    contextBridge allowlist bridge (renderer entry window.aurora)
src/renderer/   UI: index.html + styles.css + renderer.js + i18n.js (Chinese/Japanese/English)
native/         N-API audio engine (C++17): WASAPI / DirectSound / MME / ALSA + device enumeration for all four backends
scripts/        Build / packaging / icons / test media
test/           Engine, decode, business-flow, IPC, UI and packaging tests
docs/           Referenced by the README
LICENSES/       Licenses of the bundled third-party components
```

## Documentation

| File | Contents |
| --- | --- |
| [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md) | Third-party components and licenses (including notes on the GPLv3 ffmpeg distributed with the package) |
| [`EXTENSIONS.md`](EXTENSIONS.md) / [中文](EXTENSIONS.zh-CN.md) / [日本語](EXTENSIONS.ja.md) | `.xtxs` plugin development guide (ext-v2: manifest, interfaces, settings/commands, security, packaging, submission) |
| [irix-extension-template](https://github.com/sakihanaraku/irix-extension-template) | Ready-to-copy plugin template (standalone repository, README in Chinese/Japanese/English) |

## License

This project is released under **MIT**, see [`LICENSE`](LICENSE).
External programs distributed with the installer **have their own licenses**: the bundled ffmpeg/ffprobe is a **GPLv3** build, its license is at [`LICENSES/GPL-3.0.txt`](LICENSES/GPL-3.0.txt), and the origin and how to obtain the source are described in the third-party notices.

## Notice
> This project is developed with AI assistance; the maintainer will keep strictly reviewing and testing, and will keep providing new ideas for updates.
> Issues are welcome — your suggestions are the biggest motivation for our updates!
