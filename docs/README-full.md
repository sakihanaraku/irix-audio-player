# iRix Audio Player

Windows 桌面音乐播放器：**Electron 前端** + **N-API 原生音频引擎** + **ffmpeg 解码后端**。

播放链路完全绕开 HTML5 `<audio>`：

![iRix Audio Player 播放链路架构：渲染进程 → contextBridge(preload) → 主进程（playlist/ffmpeg/player）→ ffmpeg 子进程 + aurora_audio.node(C++17，WASAPI/DirectSound/MME) → 系统声卡（含独占直通）](docs/architecture.png)

> 内部标识符沿用 `aurora_audio.node` / `AURORA_*` / `window.aurora`（原生模块与桥的内部名字），
> 界面上显示的软件名是 **iRix Audio Player**。

## 功能

| 需求 | 实现 |
| --- | --- |
| Electron 前端 | `src/main` + `src/preload` + `src/renderer`，零第三方 UI 依赖 |
| N-API 音频引擎 | `native/`，C++17 写成的 N-API v8 模块（`aurora_audio.node`），ABI 稳定，Node 与 Electron 通用 |
| ffmpeg 后端 | 主进程 spawn `ffmpeg` 解码为 `f32le` 裸 PCM，经 stdout 送入引擎 |
| 基本音乐控件 | 播放/暂停、停止、上一首/下一首、进度条拖动定位、音量、**播放方式按钮**（不循环 / 列表循环 / 单曲循环 / 随机播放，一个按钮循环切换） |
| 多种格式识别 | 用 ffprobe（无则解析 `ffmpeg -i`）识别容器/编码/采样率/位深/声道/时长/码率，**flac / wav / mp3** 已逐一实测，另支持 m4a(aac)/ogg(vorbis)/opus/wma/ape/aiff/dsf 等 |
| 窗口外拖入的播放列表 | 整窗拖放区域 + 高亮遮罩；支持拖入**单个文件、多选文件、整个文件夹**（递归扫描音频扩展名）；去重、持久化、列表内拖动排序。外部文件拖放走**捕获阶段**处理，播放列表行无法把它吞掉（拖动排序状态残留也不会影响拖入） |
| 播放列表保存 / 打开 | 「保存」把当前列表另存为 `.playlist`（`Ctrl+S`），**每次都弹 Windows 资源管理器「另存为」，文件名由你决定**；「打开」读取 `.playlist` 并导入（`Ctrl+Shift+O`，自动去重、支持目录） |
| 自定义主题色 | 设置 → 外观：10 个预设色 + 任意取色器（实时预览）+ 恢复默认；进度条、按钮、高亮、状态点整套跟随，设置持久化 |
| 声卡工作模式 | **WASAPI 共享 / WASAPI 独占 / DirectSound / MME (waveOut)** 四种，可分别枚举设备、协商采样率/位深/声道、探测可用性；统一放在「总设置界面」里 |
| 自定义标题栏 | 关闭系统标题栏（`frame: false`），自绘标题栏提供**设置 / 最小化 / 最大化(还原) / 关闭**；四个控件统一用 15×15 的 SVG 图标（不依赖字形基线，彻底避免对不齐）、等间距、整条可拖动、双击最大化；**默认与最小窗口都是 1366×768** |
| 底部状态栏 | N-API 引擎版本与加载状态、ffmpeg 版本与就绪状态、当前声卡与输出格式，右侧显示导入进度 |
| 专辑封面与音乐信息 | 用 ffmpeg 从音频流读出**内嵌封面**（attached_pic）并缩放为 512px 以内的 JPEG；下框展示标题/艺术家/专辑/年份/流派/音轨/编码/容器/采样率/位深/声道/码率/时长/大小/输出格式/文件路径；未播放或无封面时显示默认封面（不会出现破图） |
| WebGL 峰值计 | 下框下方的两条实心电平条（FL/FR）+ 峰值保持线，**用 WebGL 绘制**（不可用时自动退 2D canvas），颜色跟随主题色，外部圆角与其他面板一致。量程 **0 dBFS → -∞**（线性幅度刻度：-40/-20/-10/-6/-3/0 dB）；电平取自 N-API 引擎的**写入侧**（**文件本身的电平，不受音量与输出格式/后端影响**），并按**音频时钟**校准显示位置（主进程随进度下发"已写入帧 / 正在响的帧"，界面显示正在响的那一帧）——新会话时等效延迟从 0 平滑爬升，开头不迟滞；设置 → 峰值计里还有**对齐偏移滑动条**（±400ms）供你手动微调；电平条回落 90 dB/秒、最大峰值保持 300ms，绘制锁 **60fps**，数据源 20Hz || 多语言（中/日/英） | 设置标题栏的 🌐 下拉即可切换「跟随系统 / 简体中文 / 日本語 / English」，界面文案与系统对话框（另存为/打开）一起切换，选择被持久化 |
| 音量滚轮 | 光标放在音量条（含图标与数值）上滚动即可调音量，向上增大、向下减小，每档 5% |
| 静音 | **点音量图标即静音、再点即还原**（快捷键 `M`）：图标在「静音 / 低音量 / 高音量」三态间自动切换，静音时变红并显示「静音」，滑杆位置保留；静音时拖滑杆会自动取消静音；音量本来是 0 时取消静音会回落到 80%，不会"点了没声"。状态记在设置里，重启保持 |
| 播放方式 | 「下一首」右边的按钮，点一下换一档：**不循环 → 列表循环 → 单曲循环 → 随机播放**。循环档用主题色高亮，随机档用青色（一眼区分）；随机已整合进这里，播放列表里不再单独放「随机」勾选框 |
| 长文本下拉 | 设备名等**超长文本**：选中栏单行 + … 省略，展开后的待选项**自动换行**；控件按列宽收缩，不会把设置面板撑宽 |
| 下拉框 | 全应用的下拉（工作模式 / 输出设备 / 采样率 / 位深 / 声道 / 独占周期 / 缓冲 / 语言 / 背景来源 / Wine 兼容）都换成了**自定义弹层**：原生 `<select>` 的下拉由系统绘制、加不了动画也跟不上主题，现在展开时会有**入场动画**、跟随主题配色、当前项带 ✓；支持点击、`Enter`/`↑`/`↓` 展开与选择、`Esc` 收起、点空白处收起，同时只展开一个 |
| 标题栏正在播放 | 标题栏**正中间**一行淡淡的字样「正在播放：艺术家 - 标题」，随曲目自动变化；**暂停时前缀变「暂停」**，**停止 / 结束 / 无曲目时显示「等待媒体..」**（比播放中更淡）；超长省略、悬停看全，不拦截标题栏拖动；**文字变化时先淡出再淡入**（内容没变不重播，首次显示不等动画） |
| 右键菜单 | 播放列表行右键：**播放 / 移除 / 转换 ▸ / 属性**（动画与其它窗口一致）。**转换**支持 FLAC / Wave / MP3 / AAC / Vorbis：首栏是可编辑文件名，参数按格式给（FLAC 压缩等级 0–8、Wave 位深、MP3/AAC/Vorbis 的 VBR/CBR + 码率或质量），滑块填充实时跟手、切换格式有淡入淡出过渡，输出到源文件同目录、带进度条与取消；右键**不再**顺带打开文件所在目录 |\n| 播放排行榜 | 标题栏**均衡器左边的柱状图按钮**（首次单击打开、再按关闭，与设置同一套弹出动画）：按**完整播完的次数**排行，次数前带播放图标；同一首按「艺术家 + 标题 + 专辑」判定（换路径/改名仍算同一首，不同专辑的同名曲分开统计）；列表可滚动，概要在头部；右上角**「编辑」**进入编辑态后每行可勾选，底部「移除选中 / 全选 / 完成」可按需删掉记录（按下编辑时勾选框从左侧展开、文字右移，底部三个按钮从下往上错开弹出）；设置 / 均衡器 / 排行榜三个弹窗互斥：打开新的会先把旧的收起来 |
| Docker 编译 | 没有 Linux 机器也能出 Linux 包：`npm run docker:linux`（AppImage / deb / tar.gz / **pacman**）；`npm run docker:win` 用 Wine 出 NSIS 安装包。命令、耗时与边界见 [docker/README.md](docker/README.md) |
| Arch Linux | 三条路：`npm run dist:linux:arch` 出 `*.pacman`（`sudo pacman -U` 装）、AppImage + `fuse2`、或 `packaging/arch/` 里的 PKGBUILD（`makepkg -si`，AUR 正规做法）。见 [packaging/arch/README.md](packaging/arch/README.md) |
| 安装包 | `npm run dist:setup` 生成 `iRixAudioPlayer-<版本>-setup.exe`（标准 NSIS）：带界面、可自选安装目录、默认按用户安装（不需要管理员），自动建开始菜单 + 桌面快捷方式，并在「设置 → 应用」里登记（自带 `Uninstall iRix Audio Player.exe`）；卸载不删用户设置 |

### 界面布局

```
┌──────────────────────────────────────────────────────────────┐
│ ◎ iRix Audio Player                      [🌙] [⚙] [─] [□] [✕] │ ← 自定义标题栏（可拖动）
├───────────────────────────────┬──────────────────────────────┤
│ ┌─ 上框：封面 + 标题 + 控件 ─┐ │  播放列表（上半）             │
│ │ [封面] 标题 / 艺术家 / 标签 │ │  （添加/打开/保存/清空）      │
│ │ ──────●────────  02:17/06:31│ │  列表行：标题 / 元信息 /      │
│ │ ⏮ ▶ ⏹ ⏭ ⤨      🔊 ──○── 80 │ │  格式徽标 / 时长 / 删除       │
│ └────────────────────────────┘ │                              │
│ ┌─ 下框：音乐信息 / 属性 ────┐ │──────── 可拖动分隔条 ────────│
│ │ 标题 艺术家 专辑 年份 流派   │ │  文件（下半，默认「音乐」）    │
│ │ 编码 容器 采样率 位深 声道   │ │  ↑上级 刷新 全部添加          │
│ │ 码率 时长 大小 输出 文件路径 │ │  C:\Users\…\Music            │
│ └────────────────────────────┘ │  📁 Albums   📁 王菲          │
│ ┌─ 峰值计（WebGL，FL/FR）────┐ │  ♫ Hotel California.flac     │
│ │████████████████▏  -40 -20 …│ │  ♫ Bohemian Rhapsody.mp3     │
│ │███████████▏        -10 -6 …│ │  → 拖到上面的播放列表即可添加  │
│ └────────────────────────────┘ │                              │
│ ┌缓冲┐┌输出┐┌欠载┐┌状态┐       │                              │
└──┴───┴┴───┴┴───┴┴───┴─────────┴──────────────────────────────┘
│ ● N-API 引擎 · napi 8 · 已加载  ● ffmpeg 7.1 · 就绪  ● 扬声器…  │ ← 底部状态栏
└──────────────────────────────────────────────────────────────┘
```

右栏上下各占一半：**上半是播放列表，下半是文件浏览器**，中间那条**分隔条可以拖动**（键盘 `↑`/`↓` 也行，
比例会记住）。文件浏览器默认打开 Windows 的**「音乐」文件夹**：双击文件夹进入、双击音频加入播放列表、
`全部添加` 一次加完当前目录，也可以把行**直接拖到上面的播放列表**。
**滚轮一格 = 一个项目**（不再是默认那种"一滑就过头"，触摸板的连续小步长会攒够一格再走一行）。
到盘根再按「上级」会进入**「此电脑」磁盘选择**（只列盘符，双击进入；这一层「上级」禁用）。

路径栏**点击即可直接输入**：回车跳转（支持 `%USERPROFILE%`、`~` 这类写法），
会先校验路径格式、再判断目录或文件是否真的存在 —— 目录直接跳过去，文件会跳到它所在目录并高亮；
出错（格式不对 / 路径不存在）时输入框标红，并在窗口顶部**弹出带弹出动画的提示**。

底部状态栏左侧三个状态点是**固定语义色**（不跟随主题色）：正常=绿、异常/警告=黄、缺失/未知=灰。
峰值计显示的是**文件本身的电平**：把音量拉到 0 或切换到别的声卡后端/格式，电平条都不会变。
左栏是弹性布局：**音乐信息面板会占用剩余空间、一直延伸到峰值计上方**（信息多到放不下时面板内部滚动）。

左栏分三段：**上框**放封面/标题与全部播放控件，**下框**放音乐信息与文件属性（超出高度时内部滚动），
底部是 4 格播放状态，与右侧播放列表底边齐平（两栏等高 `align-items: stretch`）。
点标题栏齿轮（`Esc` 关闭）打开「总设置界面」，声卡工作模式、输出格式、设备缓冲、解码后端都在这里。

## 快速开始

```powershell
cd music-player

# 1. 安装 Electron（国内建议走镜像，几十秒即可）
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
npm install

# 2. 构建 N-API 原生音频引擎（需要 VS 生成工具 + Python）
npm run build:native

# 3. 启动
npm start
```

ffmpeg 已经内置在 `vendor/ffmpeg/bin/`（`ffmpeg.exe` + `ffprobe.exe`）。
如需更新到最新构建：`npm run fetch:ffmpeg`（从 BtbN 官方 release 下载）。
也可以在界面里点「指定 ffmpeg.exe」，或设置环境变量 `AURORA_FFMPEG`。

### 环境要求

- Windows 10/11 x64
- Node.js ≥ 18（实测 Node 24）
- Visual Studio Build Tools（C++ 工作负载）+ Python 3（node-gyp 需要）
- Electron（`npm install` 自动装）

## 声卡工作模式

| 模式 | 说明 | 输出格式 |
| --- | --- | --- |
| `wasapi-shared` | 经系统混音器，可与其它程序同时出声。请求格式与混音格式不同时自动带 `AUTOCONVERTPCM`，由 Windows 做重采样/上混 | 跟随设置，默认 48kHz/2ch/f32 |
| `wasapi-exclusive` | **独占直通**：`AUDCLNT_SHAREMODE_EXCLUSIVE` + 事件驱动，绕过混音器，其它程序静音 | 优先请求格式 → 设备原生格式（`PKEY_AudioEngine_DeviceFormat`）→ 系统给出的最接近格式 |
| `directsound` | DirectX 传统通道，`IDirectSound8` + 通知点分段填充 | 16bit PCM（引擎内从 f32 转换） |
| `mme` | WinMM `waveOut`，4 块轮转缓冲 | 16bit PCM |

**引擎缓冲（`ringMs`）默认 300 ms**：它同时决定播放延迟与峰值计的对齐延迟，越小越"跟手"
（可在设置里选 150 / 300 / 800 / 2000 ms）。默认值下的实测：`buffered ≈ 280 ms`、`latency ≈ 280 ms`。

界面里可对每种模式分别选择输出设备、采样率（含「跟随设备」）、位深、声道、独占周期、设备缓冲、引擎缓冲，并支持「探测能力」查看该设备在所选模式下到底能不能用、会协商成什么格式。

独占模式的几个实现要点（都在 `native/src/backend_wasapi.cc`）：

- **`GetCurrentPadding` 语义在独占模式下与共享模式相反**（独占下返回的是"可写帧数"），写错会一直喂不进数据、表现为 0 帧输出。
- 独占模式 `hnsBufferDuration` 必须等于 `hnsPeriodicity`，且不得小于设备最小周期。
- 处理 `AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED`：取出对齐后的缓冲帧数，重建 `IAudioClient` 再初始化。
- 若设备拒绝独占（不少虚拟声卡如此），会依次尝试设备原生格式并给出明确错误提示。

## Linux 构建与运行

音频输出在 Linux 上走 **ALSA**（`native/src/backend_alsa.cc` + `devices_linux.cc`），
Windows 那三个通道（WASAPI/DirectSound/MME）不参与编译 —— 由 `native/binding.gyp` 的
`OS=="win"` / `OS=="linux"` 条件分源文件。

### 在 Linux 上打包（AppImage / deb / tar.gz）

```bash
sudo apt-get update && sudo apt-get install -y build-essential python3 libasound2-dev ffmpeg
npm ci
npm run dist:linux          # 一条命令：编引擎 → 出 AppImage + deb + tar.gz
npm run dist:linux:dir      # 只出未打包目录（调试用，更快）
```

`scripts/package-linux.mjs` 会先做前置检查（缺 `libasound2-dev` / 编译器会直接给出 apt 命令），
再构建原生引擎，最后交给 electron-builder。

产物：`dist/iRixAudioPlayer-<版本>-linux-x64.AppImage` / `.deb` / `.tar.gz`。

### 只有 Windows 机器怎么办

用仓库里的 GitHub Actions 工作流 **`.github/workflows/build-linux.yml`**：
推到 GitHub 后 Actions → `build-linux` → Run workflow（或 push 触发），
它在 `ubuntu-22.04` 上装好 ALSA 开发库、编引擎、跑一次出声自检，最后把
AppImage/deb/tar.gz 作为 artifact 上传。

> 为什么不能在这台 Windows 上直接交叉编译：原生引擎需要 Linux 头文件与 gcc，
> AppImage 还依赖 linuxdeploy 等 Linux 工具；electron-builder 也不支持从 Windows 生成 AppImage/deb。

### 运行时差异

| 项目 | Windows | Linux |
| --- | --- | --- |
| 输出后端 | WASAPI 共享/独占、DirectSound、MME | **ALSA**（`default` / `plughw:N,0` / `hw:N,0`） |
| 设备列表 | 系统渲染设备（含混音格式） | 读 `/proc/asound/cards` 列出各声卡 |
| 独占模式 | WASAPI 独占 | 无（`hw:N,0` 直接占用硬件，可近似当独占用） |
| ffmpeg | `vendor/ffmpeg/bin/ffmpeg.exe`，另找 PATH/WinGet/scoop/choco | PATH 与 `/usr/bin`、`/usr/local/bin`、`/snap/bin`、flatpak、`~/.local/bin`、AppImage 内 `usr/bin` |
| 单文件便携版 | 自解压 SFX（PE 桩） | AppImage（本身就是单文件，用 `--appimage-extract-and-run` 可在无 FUSE 环境跑） |
| 数据目录 | exe 同级 `iRixAudioPlayer-data`（便携）或 `%APPDATA%` | `~/.config/iRix Audio Player`（XDG） |
| 快捷键/标题栏 | 自定义无边框标题栏 | 同样可用（Electron 在 Linux 上照样支持无边框与 `-webkit-app-region`） |

已知限制：

- **没有 Linux 真机/CI 时无法验证实际出声** —— 本仓库的自动化测试只覆盖"配置与代码路径"，
  真正的 ALSA 编译与播放由上面那条 CI 工作流负责验证；
- 高端设备（多声道、DSD）在 ALSA 下的表现取决于发行版与 `asoundrc` 配置；
- 若默认设备忙：在设置里把「输出设备」换成 `plughw:N,0`，或用 `default` 走 dmix 混音。

## 在 Wine 下运行（Linux / macOS）

程序是纯 Win32/PE 的，不需要 .NET、不需要 VC++ 运行库（N-API 引擎静态链接 CRT，实测不导入
`VCRUNTIME140/MSVCP210/ucrtbase`），因此 **Wine 开箱即用，无需 winetricks**：

```bash
# 1) 建议单独建一个 prefix（可选）
export WINEPREFIX="$HOME/.wine-irix"; wineboot -i

# 2) 单文件便携版：会自解压到 %TEMP% 再启动
wine iRixAudioPlayer-1.0.2-release-portable.exe

# 或者用解压目录版
wine "dist/win-unpacked/iRix Audio Player.exe"
```

**Wine 兼容模式**（设置 → Wine 兼容，默认「自动」）：

| 检测信号 | `HKCU\Software\Wine` / `HKLM\Software\Wine` 注册表键、或 `WINEPREFIX`/`WINEARCH`/`WINEDLLOVERRIDES` 等环境变量 |
| --- | --- |
| 检测到之后 | 状态栏出现 `Wine 9.0 · 兼容模式`，设置里显示被改写了哪些项 |

自动做的事情：

| 项目 | 原生 Windows | Wine 兼容模式 |
| --- | --- | --- |
| 默认后端 | WASAPI 共享 | **DirectSound**（Wine 的 dsound → winealsa/winepulse 通路最稳） |
| WASAPI 独占 | 可选 | **排除**（Wine 没有对应实现）；播放时按 `首选 → 共享 → DirectSound → MME` 逐个尝试，直到能打开设备 |
| 设备缓冲 / 周期 / 引擎缓冲 | 100 / 10 / 300 ms | **200 / 20 / 800 ms**（容忍 Wine 音频通路更大的抖动） |
| 界面玻璃效果 | `backdrop-filter` | **关闭**，改用不透明面板（Wine 的 GPU 合成下可能失效） |
| 启动开关 | — | 自动加 `--no-sandbox` / `--disable-gpu-sandbox` 并关闭硬件加速（Chromium 沙箱与 GPU 在 Wine 下常初始化失败） |
| UAC 提权检测 | `whoami /groups` | 跳过（Wine 无提权概念，`whoami` 也可能不存在） |

> 兼容模式**只覆盖你还没动过的默认值**：如果你手动把后端设成 MME 或把缓冲改成 400ms，它不会改回去，
> 设置界面里会显示「保留了你手动设置过的项：…」。

已知限制：

- **从 Linux 文件管理器拖文件进窗口不行**：X11/Wayland 的拖放不会转成 Windows 的 `WM_DROPFILES`。
  请用工具栏「＋ 添加」或 `Ctrl+O`（文件对话框在 Wine 下正常工作）。
- 音频延迟比原生 Windows 大（多一层 winepulse/ALSA 转发），峰值计的**对齐偏移**滑杆可以按需微调。
- 首次启动（解压 + 字体缓存）会慢一些；若窗口没出现，试试 `WINEDEBUG=-all wine ...`。
- 没声音时：先在设置里把「工作模式」换成 MME 或 DirectSound，再用 `WINEDEBUG=+dsound,+mmdevapi wine ...` 看日志。
- Linux 上的文件路径在 Wine 里是 `Z:\home\you\Music\...`，播放列表 `.playlist` 里保存的就是这种路径
  （换到原生 Windows 打开会找不到文件，这是 Wine 的固有行为）。

## 播放控件与快捷键

| 操作 | 快捷键 |
| --- | --- |
| 播放 / 暂停 | `Space` |
| 上一首 / 下一首 | 界面按钮（菜单里也可） |
| 快进 / 快退 5 秒 | `→` / `←` |
| 音量 ±5% | `↑` / `↓` 或在音量条上滚轮 |
| 添加文件 | `Ctrl+O` |
| 另存播放列表（.playlist） | `Ctrl+S` |
| 打开播放列表文件 | `Ctrl+Shift+O` |
| 打开设置 / 关闭设置 | 标题栏 ⚙ / `Esc`（带弹出 / 收起动画） |
| 切换浅色 / 深色主题 | 标题栏 ⚙ 左侧的按钮（一键切换，整屏交叉渐变） |
| 打开均衡器 | 标题栏最左的推子按钮（8 段 EQ，`Esc` 关闭） |
| 最大化 / 还原 | 双击标题栏空白处 |

## 8 段均衡器（EQ）

标题栏最左的按钮弹出 EQ 面板（与设置**同一套弹出动画**）：

- **8 段**按对数等分覆盖 **20Hz–19kHz**：20 · 50 · 140 · 380 · 1k · 2.7k · 7.1k · 19k，
  每段 **±12dB**（RBJ peaking 双二阶，Q=1.2），另有 **前级 ±12dB**；
- **实时生效**：拖动滑杆立刻作用于正在播放的音频（只换系数、保留滤波器状态，不会有咔哒声），
  关掉或全部归零时自动直通，不浪费 CPU；界面按 60ms 节流下发，跟手又不刷爆 IPC；
- **预设**：平直 / 流行 / 摇滚 / 爵士 / 古典 / 人声 / 低音增强 / 高音增强；
- **存档**：`保存为 .eq` 用系统「另存为」写出 `.eq` 文件（JSON，带格式标识与版本），
  `打开 .eq` 读回并立即应用；配置同时记在设置里，重启后仍然生效；
- 容错：坏 JSON / 别的格式 / 缺频段会分别报错，少几段自动补 0dB、越界增益自动夹紧。

## 背景与主题

- **背景图**（设置 → 背景）：可选 `纯色` / `本地图片…` / `网络图片 API`。
  - 本地图片：系统文件对话框选择，主进程读取后按需等比缩小（>2560px）再转 data URL 交给界面；
  - 网络图片：默认 `https://picsum.photos/1920/1080`（地址可在设置里改），由**主进程**下载
    （避开 CORS / CSP）并缓存到 `userData/background-cache.img`，重启仍在；
  - **刷新冷却 30 秒**：刷新后按钮置灰并显示 `30s 后可刷新` 倒计时，冷却期内点击无效
    （主进程同样拒绝，返回值带剩余毫秒数，界面据此恢复倒计时）；
  - 可调 **背景不透明度**（0–100%，越大图片越实、越小越淡）与 **背景模糊**（0–40px）。
    界面数值与设置里的 `bgOpacity`（0~1）**同向、一一对应**，不做倒数换算，旧设置值无需迁移。
- **玻璃拟态**：背景层半透明 + 高斯模糊，面板/标题栏/状态栏用 `backdrop-filter: blur()` 做半透明玻璃，
  背景之上再压一层底色，保证面板与文字在任何图片上都清晰。
- **浅色 / 深色主题**：标题栏**设置按钮左侧**的按钮一键切换（深色显示月亮、浅色显示太阳），
  切换时用 View Transitions 做整屏交叉渐变；浅色主题为明亮背景准备，文字与面板配色整套随动，任何色调背景下都看得清。
  `prefers-reduced-motion` 时跳过渐变，直接切换。
- **动画的两个守则**（都是踩坑换来的）：
  1. 动画只是"加一层类"，基础样式就是终态，并且超时后一定会把类摘掉 ——
     在被遮挡的窗口、无头截图这类不推进动画的环境里不会卡在 `opacity:0` / 缩放态；
  2. 状态变更（切主题、关面板）**绝不只挂在动画回调上**，否则动画跑不起来时状态就永远不生效。
- 一处刻意取舍：**主题切换时颜色立即生效、不参与过渡**（过渡只保留位移/描边）。
  原因是颜色若走过渡，在动画不推进的渲染路径（被遮挡的窗口、无头截图）里会滞留在旧主题配色上，
  出现"白底白字"。

### 播放列表文件（.playlist）

「保存」写出的是一个 UTF-8 的 JSON 文本文件，扩展名固定为 `.playlist`，可以直接用记事本打开查看或手工编辑：

```json
{
  "format": "irix-playlist",
  "version": 1,
  "app": "iRix Audio Player",
  "savedAt": "2026-10-12T04:12:33.918Z",
  "count": 12,
  "items": [
    {
      "path": "D:\\Music\\Hotel California.flac",
      "title": "Hotel California", "artist": "Eagles", "album": "Hotel California",
      "year": "1976", "genre": "Rock", "track": "1",
      "duration": 391.2, "codec": "flac", "container": "flac",
      "sampleRate": 96000, "channels": 2, "bits": 24, "bitrate": 1400000,
      "size": 42000000, "ext": "flac", "lossless": true
    }
  ]
}
```

- 「打开」时只用到 `path` 字段，因此**手写一个纯路径数组**（`["D:\\a.flac", "D:\\b.mp3"]`）也能被识别；
- 保存对话框默认文件名形如 `iRix-播放列表-20261012-1212.playlist`，默认目录是系统「音乐」文件夹；
- 没写扩展名会自动补 `.playlist`；列表为空时不会弹对话框，而是给出提示。

**「停止」的行为**：结束当前曲目并把整个播放区复位到初始状态 —— 标题回到「未在播放」、
封面回到默认封面、音乐信息清空、进度与时间归零、状态格回到「空闲」、列表里的播放高亮取消。
**播放列表本身不受任何影响**：条目、顺序、磁盘上的 `playlist.json` 都不动，再按播放会从列表重新开始。
（这一点有专门的测试守着：`停止不减少播放列表条目 / 不改变内容与顺序 / 未触发任何删除清空操作 /
不写播放列表文件`。）

## 目录结构

```
music-player/
├── native/                     # N-API 原生音频引擎（C++17）
│   ├── binding.gyp
│   ├── sfx/                    # 免安装单文件启动器（sfx.cpp / sfx.rc）
│   └── src/
│       ├── addon.cc            # N-API 绑定层（AudioOutput 类 + 设备/探测函数）
│       ├── engine.{h,cc}       # 无锁环形缓冲、通道映射、f32→s16/s24/s32、线性重采样、统计
│       ├── backend.h           # 后端抽象 / 设备描述 / 格式探测
│       ├── backend_wasapi.cc   # WASAPI 共享 + 独占
│       ├── backend_dsound.cc   # DirectSound 8
│       ├── backend_mme.cc      # WinMM waveOut
│       ├── devices.cc          # 四种后端的设备枚举与格式探测
│       ├── win_common.h        # PROPERTYKEY / KS 子格式 / COM RAII / 格式互转
│       └── util.{h,cc}         # 字符串、HRESULT 描述、文件日志
├── src/
│   ├── main/main.js            # 窗口、自定义标题栏 IPC、菜单、设置持久化
│   ├── main/player.js          # 播放会话（引擎生命周期 + ffmpeg 解码泵 + 背压）
│   ├── main/playlist.js        # 播放列表存储 / 目录扫描 / 元数据
│   ├── main/ffmpeg.js          # ffmpeg 定位 / 探测 / 封面提取 / 解码命令
│   ├── main/selftest.js        # Electron 端到端自测
│   ├── preload/preload.js      # contextBridge 白名单桥（含 webUtils.getPathForFile）
│   └── renderer/               # index.html + styles.css + renderer.js
├── docs/                       # 文档配图（README 顶部的架构图 architecture.png）
├── scripts/                    # 构建 / 启动 / 图标 / 测试媒体 / 打包 / 全量测试
├── test/                       # 引擎、解码、业务流程、IPC、UI、打包 等测试
└── vendor/ffmpeg/bin/          # 可选：放自备的 ffmpeg + ffprobe（不进仓库，打包也不含它）
                                #   查找顺序：显式配置 → 环境变量 → vendor → 工作区工具目录 → PATH → 常见安装位置
```

## 测试与验证

```powershell
npm test                  # 全部测试（含打包产物校验，若 dist 已构建）
npm run test:engine       # 四种声卡后端逐个实际出声
npm run test:decode       # 格式识别 + 逐个解码播放 + 内嵌封面/标签
npm run test:app          # 主进程业务流程（导入/去重/播放/定位/切模式）
npm run test:ipc          # 真实 main.js + preload.js 的 IPC 契约
npm run test:ui           # 真实 Chromium 渲染 + 交互断言 + 截图
npm run test:packaged     # 用包内 ffmpeg + 原生模块真实出声
npm run selftest          # 在 Electron 内跑端到端自测（需要能启动 Electron GUI）
```

实测结果见 [`VERIFICATION.md`](VERIFICATION.md)。

### N-API 引擎 API

```js
const engine = require('./native/build/Release/aurora_audio.node');

engine.version();                       // { engine:'aurora-audio', version:'1.0.0', napiVersion:8 }
engine.backends();                      // 后端列表 + 说明
engine.listDevices('wasapi-exclusive'); // 设备枚举（含默认/状态/外形/混音格式）
engine.probeFormat({ backend, deviceId, sampleRate, channels, bits, isFloat, exclusive });

const out = new engine.AudioOutput({
  backend: 'wasapi-exclusive', deviceId: '', sampleRate: 96000, channels: 2, bits: 24,
  isFloat: false, exclusive: true, periodMs: 10, bufferMs: 100, ringMs: 800,
  allowFormatFallback: true,
});
out.format;              // 协商后的真实设备格式（含 inputSampleRate/inputChannels）
out.write(float32Buffer); // 返回本次接受的帧数（0 = 缓冲已满，需自行背压）
out.pause(); out.resume(); out.flush(); out.setVolume(0.8);
out.stats();             // framesRendered / framesSilence / underrunEvents / bufferedFrames
out.close();
```

引擎内部：写入侧是 JS 线程，消费侧是各自后端的渲染线程，中间用单生产者单消费者环形缓冲解耦；
不匹配的采样率会走内置线性重采样，`SetInputFormat()` 可在播放前切换输入格式。

## 打包为免安装（portable）可执行程序

```powershell
npm run make:icon      # 生成 build/icon.ico（Python + Pillow；仓库里已带一份成品）
npm run dist:portable  # → dist/iRixAudioPlayer-1.0.0-portable.exe  单文件绿色版（约 174 MB）
npm run dist:dir       # → dist/win-unpacked/  仅解包目录（绿色文件夹版）
npm run dist:sfx       # 复用已有 win-unpacked，只重做单文件拼接
npm run dist:nsis      # 走 electron-builder 自带 NSIS portable（需要 NSIS 在本机可用）
```

### 单文件是怎么做出来的

**没有用 NSIS**（本机 NSIS 无法创建大输出映射，独立复现见 VERIFICATION）。改为三段拼接：

```
[ sfx-stub.exe ] [ payload.zip ] [ 24 字节尾部索引 ]
   C++ 启动器        win-unpacked     offset + size + "AURORASX"
```

1. `scripts/package.mjs` 调 electron-builder `--dir`，产出 `dist/win-unpacked`
   （`app.asar` + `app.asar.unpacked/native/.../*.node` + `resources/ffmpeg/bin/*`）；
2. `scripts/build-sfx.mjs` 用 `cl.exe` 编译 `native/sfx/sfx.cpp`（静态 CRT、约 190 KB，带图标与版本信息）；
3. 用 7-Zip 把 `win-unpacked` 压成 zip，与启动器、尾部索引拼成最终 exe，并自检 9 项。

### 运行时行为

- **首次运行**把 payload 解到可写目录，之后复用（靠 `.payload-<size>` 标记，体积变化会自动重解）；
- **解包目录按优先级自动选择**：`--unpack-dir=<目录>` → `%LOCALAPPDATA%\iRixAudioPlayer`
  → `%TEMP%\iRixAudioPlayer` → `<exe 同级>\iRixAudioPlayer-unpacked`（逐个探测可写性）；
- **数据目录**：设置与播放列表写在 exe 同级的 `iRixAudioPlayer-data/`（通过 `PORTABLE_EXECUTABLE_DIR`），
  删目录即彻底清理，不写注册表；从旧版 `Aurora Player` 升级时会**按文件补齐**原 `AuroraPlayer-data/`
  里的设置与播放列表 —— 目标已存在时只补缺失/空文件，**绝不覆盖已有有效数据**（用户列表不会因改名丢失）；
- 启动应用前会**剥掉 `ELECTRON_RUN_AS_NODE`**（该变量会让 Electron 退化成纯 Node 而打不开窗口）；
- 日志写在 `%TEMP%\iRixAudioPlayer-sfx.log`（该位置不可写时写到 exe 同级），排错时先看它。

### 启动器命令行

| 参数 | 作用 |
| --- | --- |
| `--extract-only` | 只解包不启动（自检用） |
| `--force` | 强制重新解包 |
| `--clean` | 启动前清空解包目录 |
| `--unpack-dir=<目录>` | 指定解包目录 |
| `--quiet` | 出错时不弹对话框（脚本/CI 用） |

其余参数原样透传给应用（例如 `iRixAudioPlayer-1.0.0-portable.exe --selftest`）。

### 打包布局

```
dist/iRixAudioPlayer-1.0.0-portable.exe     # 双击即用
dist/win-unpacked/                          # 绿色文件夹版（可直接运行，也可自行压缩分发）
├── iRix Audio Player.exe
├── 使用说明.txt
└── resources/
    ├── app.asar                            # src/**（主进程/预加载/渲染层）
    ├── app.asar.unpacked/native/build/Release/aurora_audio.node   # N-API 原生模块
    └── ffmpeg/bin/{ffmpeg.exe,ffprobe.exe}                         # extraResources
```

打包脚本会自动把 Electron 下载切到 npmmirror 镜像、把构建缓存放到项目外的
`.tools/electron-builder-cache`，并把自检结果写到 `dist/package-report.json`、
`dist/sfx-report.json`、`dist/packaged-report.json`。

## 已知限制

- **ffmpeg 为外部进程**：首次播放有几十毫秒的进程启动延迟；暂停时仍持有声卡（独占模式下表现为持续独占）。点「释放声卡」可立即归还设备。
- 内置的 ffmpeg 是 `@ffmpeg-installer` 提供的构建（2018/N-92722），支持常用格式；需要更新的编解码器（如 AV1、DSD）时用 `npm run fetch:ffmpeg` 换成 BtbN 最新构建。
- 引擎内的重采样是线性插值，不是高质量 SRC。最佳音质路径是让 ffmpeg 直接输出采样率（默认行为），或在独占模式下选择设备原生格式。
- DirectSound / MME 固定输出 16bit PCM（这两个 API 不支持 24/32bit 输出）。
- 拖入来自压缩包/虚拟文件系统的条目拿不到真实路径，此时请用「＋ 添加」。
- 某些受限环境（无交互桌面、被沙箱/安全软件拦截）下 Chromium 沙箱初始化会失败、窗口起不来。
  这时可以试 `iRixAudioPlayer-1.0.2-release-portable.exe --no-sandbox`（启动器会把未知参数透传给应用）；
  普通桌面双击运行即可，不需要该参数。同理，调试自测可以跑 `npm run selftest -- --no-sandbox`。
- **不要以管理员身份运行**：Windows 的 UIPI 会阻止「资源管理器 → 提权进程」的拖放，
  表现就是拖文件进去只出现红色禁止光标、什么都不发生。本项目已给启动器加 `asInvoker` 清单
  （正常情况不会提权），应用启动时也会检测提权状态并在状态栏给出黄色提示。

## 打包提示

原生模块会随应用一起打包；用 electron-builder 时需要把 `native/build/Release/aurora_audio.node`
和 `vendor/ffmpeg/bin/*.exe` 放进 `extraResources` 或 `asarUnpack`，因为二者都必须是磁盘上的真实文件。
