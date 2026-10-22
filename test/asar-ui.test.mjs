

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const asarPath = path.join(projectRoot, 'dist', 'win-unpacked', 'resources', 'app.asar');
const out = path.join(projectRoot, 'dist', 'asar-check');

if (!fs.existsSync(asarPath)) {
  console.log('未构建打包产物（dist/win-unpacked），跳过');
  process.exit(0);
}

const asar = require('@electron/asar');
fs.rmSync(out, { recursive: true, force: true });
asar.extractAll(asarPath, out);
const read = (rel) => fs.readFileSync(path.join(out, rel), 'utf8');

const html = read('src/renderer/index.html');
const main = read('src/main/main.js');
const renderer = read('src/renderer/renderer.js');
const ffmpeg = read('src/main/ffmpeg.js');
const css = read('src/renderer/styles.css');
const preload = read('src/preload/preload.js');
const playlistSrc = read('src/main/playlist.js');
const playerSrc = read('src/main/player.js');
const i18nSrc = read('src/renderer/i18n.js');
const extSource = read('src/main/extensions.js');
const playableSrc = read('src/main/playable.js');

const sfxSrc = fs.readFileSync(path.join(projectRoot, 'native', 'sfx', 'sfx.cpp'), 'utf8');

const taskbarNativeSrc = fs.readFileSync(path.join(projectRoot, 'native', 'src', 'taskbar_win.cc'), 'utf8');

const checks = [
  ['应用名为 iRix Audio Player', html.includes('<title>iRix Audio Player</title>') &&
    html.includes('>iRix Audio Player</span>') && main.includes("APP_DISPLAY_NAME = 'iRix Audio Player'")],
  ['第三方组件声明随包分发（THIRD-PARTY-NOTICES.md 含 Electron/Apache-2.0/FFmpeg）',
    (() => {
      try {
        const n = read('THIRD-PARTY-NOTICES.md');
        return n.includes('Electron') && n.includes('Apache-2.0') && n.includes('FFmpeg');
      } catch { return false; }
    })()],
  ['随包分发的 GPLv3 许可文本存在（LICENSES/GPL-3.0.txt）',
    (() => {
      try {
        const g = read('LICENSES/GPL-3.0.txt');
        const n = read('THIRD-PARTY-NOTICES.md');
        return g.includes('GNU GENERAL PUBLIC LICENSE') && n.includes('GPLv3') && n.includes('GPL-3.0.txt');
      } catch { return false; }
    })()],
  ['MIT 许可文本随包分发（LICENSE + package.json 的 license 字段）',
    (() => {
      try {
        const lic = read('LICENSE');
        const pkg = JSON.parse(read('package.json'));
        return lic.includes('MIT License') && /Copyright \(c\)/.test(lic) && pkg.license === 'MIT';
      } catch { return false; }
    })()],
  ['版本号为 1.0.2-extUpdate；标题栏已无版本徽标，版本显示在设置里',
    JSON.parse(fs.readFileSync(path.join(out, 'package.json'), 'utf8')).version === '1.0.2-extUpdate' &&
    
    !html.includes('app-version') && !html.includes('id="appVersion"') &&
    
    html.includes('id="aboutVersion"') &&
    renderer.includes('aboutVersion') && renderer.includes('info.appVersion') && !renderer.includes('appVersion\'')],
  ['多语言（中/日/英）已打包',
    fs.existsSync(path.join(out, 'src', 'renderer', 'i18n.js')) &&
    html.includes('src="i18n.js"') && html.includes('id="selLanguage"') &&
    ['zh', 'ja', 'en'].every((l) => i18nSrc.includes(`${l}: {`))],
  ['NSIS 安装器多语言（跟随系统：en_US / zh_CN / ja_JP，不弹语言选择）',
    (() => {
      try {
        
        const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
        const nsis = (pkg.build && pkg.build.nsis) || {};
        const langs = nsis.installerLanguages || [];
        return ['en_US', 'zh_CN', 'ja_JP'].every((l) => langs.includes(l)) &&
          nsis.multiLanguageInstaller !== false &&
          nsis.displayLanguageSelector !== true;
      } catch { return false; }
    })()],
  ['语言选择器 / 文件浏览器的图标用内联 SVG（Linux 无 emoji 字体时不会显示成豆腐块）',
    html.includes('class="lang-globe"') && !html.includes('🌐') &&
    renderer.includes('br-ico') && !renderer.includes('📁') &&
    css.includes('.lang-pick svg') && css.includes('.br-ico svg')],
  ['软件渲染时自动关闭玻璃模糊（backdrop-filter 每帧重算背景模糊，很贵）',
    renderer.includes('detectSoftwareRender') && renderer.includes("classList.toggle('software-render'") &&
    css.includes('body:is(.no-glass, .software-render)')],
  ['进度条用 transform: scaleX（不动 width，避免触发布局）',
    /\.conv-bar > i[\s\S]{0,260}transform: scaleX/.test(css) &&
    !renderer.includes("$('convBar').style.width")],
  ['尊重系统「减少动态效果」设置（prefers-reduced-motion）',
    css.includes('prefers-reduced-motion') && css.includes('animation-duration: .01ms')],
  ['长列表滚动优化（屏幕外的行不参与绘制 + 滚轮行高缓存）',
    css.includes('content-visibility: auto') && css.includes('contain-intrinsic-size') &&
    css.includes('contain: layout paint style') && css.includes('overflow-anchor: none') &&
    
    renderer.includes('pitchRows') && renderer.includes('rowPitch()')],
  ['扩展系统（.xtxs 可选插件 + 安装/卸载/启用 + 重启生效）',
    main.includes('getExtensions') && main.includes('ext:install') && main.includes('ext:list') &&
    main.includes('resolvePlayablePath') && main.includes('setPathResolver') && main.includes('.cover.img') && main.includes("extensions: ['xtxs', 'zip']") &&
    preload.includes('ext:') && html.includes('id="extList"') && html.includes('id="btnExtInstall"') &&
    renderer.includes('bindExtensions') && renderer.includes('renderExtensions') &&
    css.includes('.ext-item')],
  ['扩展接口 ext-v2：生命周期 / 快速元数据 / 封面 / 音频后处理',
    extSource.includes('normalizeSettings') && extSource.includes('activate') && extSource.includes('deactivate') &&
    extSource.includes('readMeta') && extSource.includes('extractCover') && extSource.includes('processAudio') &&
    extSource.includes('onSettingsChanged') && extSource.includes('runCommand') && extSource.includes('setSetting') &&
    extSource.includes('activateStartup') && extSource.includes('startup') &&
    main.includes('activateStartup') &&
    main.includes('metaOnly') && main.includes('pluginTag') && main.includes('extractCover') && main.includes('processAudio')],
  ['容器播放路径归一化（readMeta 快速路径后仍播放真实音频）',
    main.includes("require('./playable')") &&
    main.includes('resolvePlayableTarget(await resolvePlayablePath(track.path), track)') &&
    main.includes('playPath: target.path') &&
    main.includes('resolvePlayableTarget(resolved, { path: file, playPath: file })') &&
    playableSrc.includes('function resolvePlayableTarget') &&
    playableSrc.includes('metaOnly')],
  ['扩展接口 ext-v2：声明式设置 + 命令（主进程校验 / 渲染层只按描述建控件）',
    main.includes("ipcMain.handle('ext:set-setting'") && main.includes("ipcMain.handle('ext:command'") &&
    preload.includes('setSetting') && preload.includes('runCommand') &&
    renderer.includes('function renderExtensionSettings') && renderer.includes('function renderExtensionCommands') &&
    renderer.includes('function setExtStatus') && renderer.includes('entry.appendChild(box)') &&
    css.includes('.ext-settings') && css.includes('.ext-setting') && css.includes('.ext-commands') &&
    i18nSrc.includes("'ext.settingsSaved'") && i18nSrc.includes("'ext.commandDone'")],
  ['数据安全网：写前自动备份 + 读失败自动从备份恢复',
    main.includes('backupFileBeforeWrite') && main.includes('restoreFromBackup') &&
    main.includes('BACKUPS_DIR_NAME') && main.includes('BACKUP_KEEP')],
  ['渲染层由本地 http(127.0.0.1) 承载（file:// 是 opaque origin ✗ → 媒体元素/媒体键/媒体卡片全被拒）',
    main.includes('startRendererServer') && main.includes('127.0.0.1') &&
    main.includes('loadURL(') && main.includes('rendererServer.close')],
  ['歌词还没到第一句时视图回到歌词头（-1 === -1 的 early return 会吞掉首次定位 ✗）',
    renderer.includes('idx !== -1') && renderer.includes('新歌词从"头"开始')],
  ['渲染层不得使用 Node 的 Buffer（contextIsolation 下没有 ✗，用了会静默抛错）',
    !renderer.includes('Buffer.from') && !renderer.includes('Buffer.alloc')],
  ['SMTC 保活音频用 data URL（blob:file:// 会被 Electron 拦 ✗）+ 封面不再因 hasCover=false 跳过',
    renderer.includes('data:audio/wav;base64,') && !renderer.includes('URL.createObjectURL(new Blob') &&
    main.includes('silentWavUrl') &&
    renderer.includes("if (!track) return showPlaceholder();")],
  ['WebGL 优先恢复（preventDefault + webglcontextrestored 重建），实在不行才 2D 兜底',
    renderer.includes('switchPeakMeterTo2D') && renderer.includes('e.preventDefault()') &&
    renderer.includes('setupPeakGL') && renderer.includes('webglcontextrestored') &&
    renderer.includes('PEAK_RESTORE_WAIT_MS')],
  ['玻璃面板不发糊（不在 backdrop-filter 元素上叠 will-change / paint 隔离）',
    !/\.modal,[\s\S]{0,80}will-change: transform/.test(css) && !/\.modal-body,\s*\.rank-list/.test(css)],
  ['便携版换文件夹后能找回旧设置（findLegacySettingsSource）',
    main.includes('findLegacySettingsSource') && main.includes('settings.json') &&
    main.includes("app.getPath('appData')")],
  ['Windows 任务栏：缩略图播放控件 + 用专辑封面做缩略图',
    main.includes('setThumbarButtons') && main.includes('setThumbnailClip') &&
    main.includes('taskbar:thumb-clip') && preload.includes('thumbClip') &&
    renderer.includes('bindTaskbarCommands') && renderer.includes('syncThumbnailClip') &&
    renderer.includes("taskbar:command")],
  
  
  
  
  
  ['任务栏点击走原生实现 + 管理员权限下发消息放行（UIPI）',
    main.includes('taskbarInstall') && main.includes('taskbarUpdate') &&
    main.includes('taskbarDispose') && main.includes('ensureNativeTaskbar') &&
    main.includes("getNativeWindowHandle()") &&
    taskbarNativeSrc.includes('ThumbBarAddButtons') &&
    taskbarNativeSrc.includes('THBN_CLICKED') && taskbarNativeSrc.includes('WM_COMMAND') &&
    taskbarNativeSrc.includes('SetWindowLongPtrW') &&
    taskbarNativeSrc.includes('napi_create_threadsafe_function') &&
    taskbarNativeSrc.includes('ChangeWindowMessageFilterEx') &&
    taskbarNativeSrc.includes('MSGFLT_ALLOW')],
  ['Windows AppUserModelID 与 build.appId 一致（任务栏按钮归属稳定）',
    main.includes("setAppUserModelId('com.irix.audioplayer')") &&
    (() => {
      try {
        
        const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
        return pkg.build && pkg.build.appId === 'com.irix.audioplayer';
      } catch { return false; }
    })()],
  
  
  ['渲染层监听的通道都在 preload 事件白名单里',
    (() => {
      const block = (preload.match(/EVENT_CHANNELS = \[([\s\S]*?)\]/) || [, ''])[1];
      const wl = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
      const listened = [...renderer.matchAll(/api\.on\('([^']+)'/g)].map((m) => m[1]);
      return listened.length > 3 && listened.every((c) => wl.includes(c));
    })()],
  ['系统媒体控件（Windows SMTC / 媒体键）已接入',
    renderer.includes('navigator.mediaSession') && renderer.includes('setActionHandler') &&
    renderer.includes('MediaMetadata') && renderer.includes('bindMediaSession') &&
    renderer.includes('updateMediaMetadata') && renderer.includes('setPositionState')],
  ['窗口圆角用 setShape 区域裁剪（Win10/Win11/Linux 通用；最大化直角）',
    main.includes('applyWindowShape') && main.includes('win.setShape') &&
    main.includes('WINDOW_RADIUS = 12') &&
    
    !main.includes('transparent: true') &&
    css.includes('html.rounded-shell body::before') && css.includes('border-radius: 12px') &&
    
    !css.includes('clip-path: inset(0 round')],
  ['多语言三语词条数量一致',
    (() => {
      const counts = ['zh', 'ja', 'en'].map((l) => {
        const start = i18nSrc.indexOf(`${l}: {`);
        const end = i18nSrc.indexOf('\n    },', start);
        return (i18nSrc.slice(start, end).match(/^\s+'[^']+':/gm) || []).length;
      });
      return counts[0] > 100 && counts[0] === counts[1] && counts[1] === counts[2];
    })()],
  ['界面文案已全部改为词条（无硬编码中文）',
    !/\$\('statStatus'\)\.textContent = '[^']*[\u4e00-\u9fff]/.test(renderer) &&
    !/showError\('[^']*[\u4e00-\u9fff][^']*'\)/.test(renderer)],
  ['WebGL 峰值计已打包（60fps 锁帧 + 音频时钟校准）',
    html.includes('id="peakCanvas"') && renderer.includes('getContext(\'webgl\'') &&
    renderer.includes('function drawPeakMeter') && renderer.includes('preserveDrawingBuffer') &&
    renderer.includes('PEAK_FRAME_MS = 1000 / 60') && renderer.includes('function pickDisplaySample') &&
    renderer.includes('function resetPeakHistory') &&
    playerSrc.includes('writtenFrames') && playerSrc.includes('playedFrames') &&
    css.includes('.peak-panel') && css.includes('border-radius: 10px')],
  ['设置里提供峰值计偏移滑动条',
    html.includes('id="peakOffset"') && html.includes('id="btnPeakOffsetReset"') &&
    main.includes('peakOffsetMs') && renderer.includes('peakOffsetMs')],
  ['背景图与玻璃拟态已打包',
    html.includes('id="bgLayer"') && html.includes('id="bgImage"') && html.includes('id="selBgSource"') &&
    html.includes('id="btnPickBg"') && html.includes('id="btnFetchBg"') &&
    css.includes('#bgLayer') && css.includes('backdrop-filter: blur(var(--glass-blur)') &&
    main.includes('bg:pick') && main.includes('bg:fetch') && main.includes('bg:get')],
  ['网络背景 30s 冷却已打包',
    main.includes('BG_COOLDOWN_MS = 30000') && renderer.includes('function startBgCooldown') &&
    renderer.includes('set.bg.cooldown')],
  ['标题栏明暗主题切换已打包',
    html.includes('id="btnThemeMode"') && html.includes('body.light') === false &&
    renderer.includes('function applyUiTheme') && css.includes('body.light {')],
  ['Wine 兼容层已打包（检测 + 降级链 + 保守默认值）',
    read('src/main/wine.js').includes('backendChain') &&
    read('src/main/wine.js').includes('WINE_UNSUPPORTED_BACKENDS') &&
    playerSrc.includes('fallingBack') && main.includes('wineSafeOverrides') &&
    main.includes("appendSwitch('no-sandbox')") && main.includes('disableHardwareAcceleration'),
    ''],
  ['Wine 兼容界面已打包',
    html.includes('id="selWineCompat"') && html.includes('id="statusWine"') &&
    renderer.includes('function applyWineInfo') &&
    
    
    css.includes('.no-glass') &&
    main.includes('wineInfoForUi')],
  ['提权警告已彻底移除（拖放功能下线后不再提示）',
    !html.includes('statusElevated') && !renderer.includes('statusElevated') &&
    !i18nSrc.includes('sb.elevated') && !/拖放被系统阻止/.test(i18nSrc), ''],
  ['单文件启动器找的是新应用名（改名不再漏 .cpp）',
    sfxSrc.includes('L"iRix Audio Player.exe"') && !sfxSrc.includes('IRiX'),
    ''],
  ['歌词已打包（内核 + 元数据/lrc 查找 + 面板与偏移控件 + 编辑窗）',
    fs.existsSync(path.join(projectRoot, 'src', 'main', 'lyrics.js')) &&
    read('src/main/lyrics.js').includes('resolveLyrics') &&
    read('src/main/lyrics.js').includes('activeLineIndex') &&
    read('src/main/lyrics.js').includes('function saveLyrics') &&
    main.includes("ipcMain.handle('lyrics:for'") && main.includes("ipcMain.handle('lyrics:pick'") &&
    main.includes("ipcMain.handle('lyrics:read'") && main.includes("ipcMain.handle('lyrics:save'") &&
    main.includes("require('./lyrics')") && preload.includes("invoke('lyrics:for'") &&
    preload.includes("invoke('lyrics:save'") &&
    
    html.includes('id="lyricsPanel"') && html.includes('id="lyricsBody"') &&
    html.includes('id="lyricsOffset"') && html.includes('id="btnLyrics"') &&
    html.includes('id="btnInfo"') && html.includes('id="btnLyricsPick"') &&
    html.includes('id="btnLyricsEdit"') && html.includes('id="lyricsEditModal"') &&
    html.includes('id="lyricsEditText"') && html.includes('id="btnLyricsUndo"') &&
    html.includes('id="btnLyricsRedo"') && html.includes('id="btnLyricsSave"') &&
    renderer.includes("setSidePanel('lyrics', { persist: false })") &&
    renderer.includes('layoutLyricsSpacers') && renderer.includes('bindLyricsOffset') &&
    renderer.includes('openLyricsEditor') && renderer.includes('saveLyricsEdit') &&
    renderer.includes('toast-corner') &&
    css.includes('.lyrics-pad') && css.includes('.lyrics-offset') &&
    
    !css.includes('.lyrics-offset:hover') &&
    css.includes('.toast.toast-corner') &&
    i18nSrc.includes("'lyrics.title'") && i18nSrc.includes("'lyricsEdit.save'")],
  ['悬停提示自己接管（原生 title 提示会飘出窗口）',
    html.includes('id="appTip"') && css.includes('.app-tip') &&
    renderer.includes('function bindTooltips') && renderer.includes('function tipAdopt') &&
    renderer.includes("tipEl.hidden = false") && renderer.includes('window.innerWidth - w - 6') &&
    
    /bindTooltips\(\)/.test(renderer) && !/\/\/ bindTooltips\(\)/.test(renderer)],
  ['设置最底部有「关于」（版本 / 制作者 sakihanaraku / 框架与后端 / 开源协议带链接）',
    html.includes('data-i18n="about.title"') && html.includes('id="aboutVersion"') &&
    html.includes('id="aboutTags"') && html.includes('id="aboutLicenses"') &&
    html.includes('sakihanaraku') &&
    
    html.indexOf('id="btnPickFfmpeg"') < html.indexOf('id="aboutVersion"') &&
    renderer.includes('const ABOUT_LICENSES = [') &&
    (renderer.match(/url: 'https:\/\//g) || []).length >= 5 &&
    renderer.includes("a.target = '_blank'") &&
    renderer.includes('renderAbout()') &&
    css.includes('.about-lic a') &&
    
    main.includes('openExternalSafely') && main.includes("u.protocol === 'http:'")],
  ['任务栏/窗口标题同步正在播放（艺术家 - 歌曲名）',
    renderer.includes('const APP_TITLE =') &&
    renderer.includes('document.title = (!waiting && nextText) ? nextText : APP_TITLE;') &&
    renderer.includes("[track.artist, track.title].filter(Boolean).join(' - ')")],
  ['播放次数与排行榜已打包（主进程计数 + 元数据判定 + 排行榜界面）',
    fs.existsSync(path.join(projectRoot, 'src', 'main', 'playcounts.js')) &&
    read('src/main/playcounts.js').includes('songKey') &&
    main.includes("ipcMain.handle('plays:get'") && main.includes('countCompletedPlay') &&
    main.includes("player.on('ended'") && preload.includes("invoke('plays:get'") &&
    html.includes('id="btnRank"') && html.includes('id="rankList"') &&
    renderer.includes('function renderRankList') && css.includes('.rank-list')],
  ['音量图标即静音按钮（点击静音 / 再点还原 + M 快捷键）',
    html.includes('id="volIcon"') && html.includes('ico-vol-mute') && html.includes('ico-vol-low') &&
    html.includes('ico-vol-high') && renderer.includes('function toggleMute') &&
    renderer.includes('function renderVolumeUI') && renderer.includes("e.code === 'KeyM'") &&
    main.includes('function effectiveVolume') && main.includes('muted: false') &&
    css.includes('.vol-btn[data-level="mute"]')],
  ['8 段均衡器已打包（DSP + 实时下发 + .eq 存取）',
    fs.existsSync(path.join(projectRoot, 'src', 'main', 'eq.js')) &&
    read('src/main/eq.js').includes('EQ_BAND_FREQS') &&
    main.includes("ipcMain.handle('eq:set'") && main.includes("ipcMain.handle('eq:save'") &&
    preload.includes("invoke('eq:set'") && playerSrc.includes('EqProcessor') &&
    playerSrc.includes('this.eq.processInterleaved')],
  ['均衡器界面已打包（标题栏按钮 + 同款弹出动画 + 8 条竖向滑杆）',
    html.includes('id="btnEq"') && html.includes('id="eqModal"') && html.includes('id="eqBands"') &&
    html.includes('id="btnEqSave"') && html.includes('id="btnEqLoad"') &&
    renderer.includes('function buildEqUi') && renderer.includes('openEqModal') &&
    renderer.includes("playModalAnim(mask, 'open')") && css.includes('.eq-band input[type="range"]')],
  ['地址栏可编辑并校验（fs:stat + 弹出提示）',
    html.includes('id="browserPathInput"') && html.includes('id="toastWrap"') &&
    main.includes("ipcMain.handle('fs:stat'") && preload.includes("invoke('fs:stat'") &&
    css.includes('@keyframes toastPop') && renderer.includes('function submitPathInput') &&
    renderer.includes('function showToast')],
  ['路径文字用 LTR 隔离（根目录 C:\\ 不会被重排成 \\:C）',
    renderer.includes("span.setAttribute('dir', 'ltr')") &&
    css.includes('unicode-bidi: isolate')],
  ['文件浏览器已打包（默认音乐目录 + 只读 fs IPC）',
    html.includes('id="browserPanel"') && html.includes('id="browserList"') &&
    html.includes('id="btnBrowseUp"') && html.includes('id="browserPath"') &&
    main.includes("ipcMain.handle('fs:list'") && main.includes("app.getPath('music')") &&
    preload.includes("invoke('fs:list'") && renderer.includes('function loadBrowserDir')],
  ['播放列表与文件浏览器之间有可拖动分隔条',
    html.includes('id="rightSplitter"') && html.includes('id="rightCol"') &&
    css.includes('.splitter') && renderer.includes('function bindSplitter') &&
    main.includes('browserSplit')],
  ['文件浏览器可拖到播放列表（自定义 MIME，避免与内部排序冲突）',
    renderer.includes("BROWSER_DRAG_MIME = 'application/x-irix-path'") &&
    renderer.includes('function bindPlaylistDropTarget') && renderer.includes('function isBrowserFileDrag')],
  ['外部拖入已移除',
    !html.includes('drop-overlay') && !renderer.includes('bindDropZone') &&
    !css.includes('.drop-card'), ''],
  ['播放控件按压/弹起动画已打包',
    css.includes('@keyframes btnPop') && css.includes('.btn.is-down') &&
    renderer.includes('function bindPressFeedback') && renderer.includes('function popButton')],
  ['应用名已改为 iRix Audio Player',
    html.includes('<span class="app-name">iRix Audio Player</span>') &&
    main.includes("APP_DISPLAY_NAME = 'iRix Audio Player'") &&
    main.includes("DATA_DIR_NAME = 'iRixAudioPlayer-data'") &&
    main.includes("'IRiXAudioPlayer-data'"),          
    ''],
  ['设置弹出动画与主题渐变已打包',
    css.includes('@keyframes modalPop') && css.includes('@keyframes modalDrop') &&
    css.includes('::view-transition-old(root)') && css.includes('@keyframes themeFadeIn') &&
    renderer.includes('function playModalAnim') && renderer.includes('startViewTransition') &&
    renderer.includes('THEME_FALLBACK_MS')],
  ['明暗主题不再让颜色滞留在旧值（过渡只含非颜色属性）',
    !/\.btn \{[^}]*transition: \.15s/.test(css) && !/\.tb-btn[^{]*\{[^}]*transition: background/.test(css)],
  ['默认引擎缓冲 300ms（对齐延迟随之降低）',
    main.includes('ringMs: 300') && html.includes('<option value="300" selected>')],
  ['峰值计外部圆角与面板一致且 fallback 不误显',
    css.includes('.peak-fallback[hidden] { display: none; }')],
  ['原生引擎提供峰值统计',
    fs.readFileSync(path.join(projectRoot, 'native', 'src', 'engine.h'), 'utf8').includes('kMaxPeakChannels') &&
    fs.readFileSync(path.join(projectRoot, 'native', 'src', 'addon.cc'), 'utf8').includes('"peaks"')],
  ['状态栏状态点用固定语义色（不随主题）',
    css.includes('.sb-item.ok .dot { background: #35d07f') &&
    css.includes('.sb-item.warn .dot { background: #e8c341') &&
    !/\.sb-item\.ok \.dot \{ background: var\(--accent\)/.test(css)],
  ['状态栏只留声卡一项（N-API / ffmpeg 两行已按要求移除）',
    !renderer.includes('statusEngine') && !renderer.includes('statusFfmpeg') &&
    !html.includes('id="statusEngine"') && !html.includes('id="statusFfmpeg"') &&
    html.includes('id="statusDevice"') &&
    
    html.indexOf('id="statusDevice"') < html.indexOf('sb-grow') &&
    
    html.includes('id="ffmpegInfo"') && renderer.includes('setStatusItem')],
  ['音量条支持滚轮调节',
    renderer.includes("addEventListener('wheel'") && renderer.includes('VOLUME_STEP')],
  ['启动器带 asInvoker 清单（不主动提权）',
    fs.existsSync(path.join(projectRoot, 'native', 'sfx', 'sfx.manifest')) &&
    fs.readFileSync(path.join(projectRoot, 'native', 'sfx', 'sfx.manifest'), 'utf8').includes('asInvoker')],
  ['主进程仍上报提权状态（仅诊断，界面不再提示）',
    main.includes('S-1-16-12288') && main.includes('isElevatedProcess') &&
    main.includes('elevated: isElevatedProcess()')],
  ['播放列表保存/打开按钮已打包',
    html.includes('id="btnSaveList"') && html.includes('id="btnOpenList"') &&
    main.includes("ipcMain.handle('playlist:save'") && main.includes("ipcMain.handle('playlist:load'") &&
    preload.includes("invoke('playlist:save'") && preload.includes("invoke('playlist:load'")],
  ['.playlist 文件读写实现已打包',
    playlistSrc.includes('irix-playlist') && playlistSrc.includes('async saveTo(file)') &&
    playlistSrc.includes('static async readPaths(file)')],
  ['主题色设置已打包（预设 + 自定义）',
    html.includes('id="themeSwatches"') && html.includes('id="themeColor"') &&
    html.includes('id="btnThemeReset"') && renderer.includes('THEME_PRESETS') &&
    renderer.includes('function applyTheme') && css.includes('--accent-rgb')],
  ['主题色贯通到各组件（无硬编码强调色）',
    css.includes('var(--accent-2)') && css.includes('var(--accent-darker)') &&
    css.includes('rgb(var(--accent-rgb) / .09)') &&
    
    !/#1fae83|#17b6a4/.test(css) &&
    !css.replace(/\/\*[\s\S]*?\*\//g, '').includes('rgba(53, 208, 127, .09)')],
  ['浏览器拖放不会被列表行吞掉（行内先放行自定义 MIME）',
    (renderer.match(/if \(isBrowserFileDrag\(e\)\) return;/g) || []).length >= 2 &&
    renderer.includes('const isBrowserDrag = isBrowserFileDrag;') &&
    
    renderer.includes('if (!state.internalDragId) return;')],
  ['停止后播放区复位且不动播放列表',
    renderer.includes('function renderIdleState') && renderer.includes('ensureDefaultCover')],
  ['默认封面不会显示成破图（[hidden] 显式压过 display）',
    css.includes('.cover img[hidden] { display: none; }')],
  ['便携版数据目录已更名且带旧数据迁移',
    main.includes("'iRixAudioPlayer-data'") && main.includes('migrateLegacyData') && main.includes('AuroraPlayer-data')],
  ['标题栏四个控件齐全', (html.match(/id="btn(Settings|Min|Max|Close)"/g) || []).length === 4],
  ['标题栏图标与新图标同形状且随主题色（Material music_note + currentColor + 主题变量）',
    html.includes('id="appLogo"') && html.includes('M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z') &&
    html.includes('fill="currentColor"') && !html.includes('>◎<') &&
    css.includes('border-radius: 50%') && css.includes('var(--accent-2), var(--accent-darker)')],
  ['标题栏图标全部为 SVG（对齐问题已修）', (html.match(/<svg/g) || []).length >= 6 && !/>⚙<|>─<|>□<|>✕</.test(html)],
  ['最大化按钮含 max/restore 两态图标', html.includes('ico-max') && html.includes('ico-restore')],
  ['图标统一尺寸样式', css.includes('.tb-btn svg { width: 15px; height: 15px')],
  ['默认与最小窗口均为 1366×768',
    main.includes('width: 1366') && main.includes('height: 768') &&
    main.includes('minWidth: 1366') && main.includes('minHeight: 768')],
  ['音乐信息面板（下框）', html.includes('meta-panel') && html.includes('metaGrid')],
  ['上框为播放控件、下框为音乐信息', html.indexOf('player-main') < html.indexOf('meta-panel')],
  ['封面 img + 占位符', html.includes('coverImg') && html.includes('coverPlaceholder')],
  ['封面提取走 ffmpeg attached_pic', ffmpeg.includes('extractCover') && ffmpeg.includes('attached_pic')],
  ['渲染层加载封面并渲染元数据', renderer.includes('loadCover') && renderer.includes('renderMeta')],
  ['无音频流文件不再判定可播放', ffmpeg.includes('文件中没有音频流')],
  ['封面 IPC 与 preload API 已接好',
    main.includes("ipcMain.handle('cover:get'") && preload.includes("invoke('cover:get'")],
  ['音乐信息含文件路径行（多语言词条）',
    renderer.includes("tr('meta.path')") && i18nSrc.includes("'meta.path':")],
  ['歌词独占：标题栏「排行榜」旁边的切换按钮 + 三语词条',
    html.includes('id="btnLyricsFull"') && html.includes('data-i18n-title="tip.lyricsExclusive"') &&
    (i18nSrc.match(/'tip\.lyricsExclusive':/g) || []).length === 3 &&
    renderer.includes("addEventListener('click', toggleLyricsExclusive)") &&
    renderer.includes('function bindLyricsExclusive')],
  ['歌词独占：全窗口结构 = 封面 + 时间 + 艺术家/专辑 + 曲名 + 歌词列',
    html.includes('id="lyricsExclusive"') && html.includes('id="lxCoverImg"') &&
    html.includes('id="lxTime"') && html.includes('id="lxArtist"') &&
    html.includes('id="lxTitle"') && html.includes('id="lxLyrics"')],
  ['歌词独占：时间显示 "xx:xx/xx:xx" 且在艺术家行上面',
    /fmtTime\(Math\.max\(0, pos\)\)\}\/\$\{fmtTime\(total\)\}/.test(renderer) &&
    html.indexOf('id="lxTime"') < html.indexOf('id="lxArtist"') &&
    html.indexOf('id="lxArtist"') < html.indexOf('id="lxTitle"')],
  ['歌词独占：切歌 / 进度 / 歌词偏移 / 拖动进度都会同步',
    renderer.includes('function syncLyricsExclusiveMeta') &&
    renderer.includes('updateLyricsExclusiveProgress(p.position || 0)') &&
    renderer.includes('syncLyricsExclusiveMeta(track)') &&
    renderer.includes('updateLyricsExclusiveProgress(state.playerState.position || 0)')],
  ['歌词独占：按钮为切换式（aria-pressed + body 类），Esc 也能关',
    renderer.includes("btn.setAttribute('aria-pressed', String(next))") &&
    renderer.includes("document.body.classList.toggle('lyrics-exclusive', next)") &&
    renderer.includes("if (e.code === 'Escape' && lxState.open)")],
  ['歌词独占：保留顶部导航栏、背景沿用设置（独占层不自绘背景、不画分隔框）',
    css.includes('top: var(--titlebar-h);') &&
    css.includes('body.lyrics-exclusive .layout') && css.includes('body.lyrics-exclusive .statusbar') &&
    !/#lyricsExclusive \{[^}]*background/.test(css)],
  ['歌词独占：独占层样式必须用 id 选择器（body 上同名类不能把整页隐藏/定位）',
    /#lyricsExclusive \{/.test(css) && !/^\.lyrics-exclusive\s*\{/m.test(css) &&
    !css.includes('body.lyrics-exclusive .lyrics-exclusive') &&
    /body\.lyrics-exclusive #lyricsExclusive \{[^}]*opacity: 1/.test(css)],
  ['歌词独占：打开时背景压暗（内容下半透明暗层，深浅主题各一套强度）',
    html.includes('id="lxDim"') && css.includes('.lx-dim {') && css.includes('background: var(--lx-dim);') &&
    (css.match(/--lx-dim:/g) || []).length === 2],
  ['歌词独占：打开淡入 / 关闭淡出（终态由 body 类决定，不依赖动画）',
    /#lyricsExclusive \{[^}]*opacity: 0/.test(css) &&
    /#lyricsExclusive \{[^}]*visibility: hidden/.test(css) &&
    /#lyricsExclusive \{[^}]*transition: opacity/.test(css) &&
    css.includes('body.lyrics-exclusive #lyricsExclusive')],
  ['歌词独占：歌词字体加粗（普通 500 / 当前行 700）',
    /\.lx-line \{[^}]*font-weight: 500/.test(css) && /\.lx-line\.is-active \{[^}]*font-weight: 700/.test(css)],
  ['歌词独占：艺术家-专辑放不下时左右滚动（先量溢出再加 is-marquee）',
    html.includes('id="lxArtistText"') && renderer.includes('function layoutLyricsExclusiveArtist') &&
    renderer.includes("classList.add('is-marquee')") && css.includes('.lx-artist.is-marquee') &&
    css.includes('@keyframes lxArtistMarquee')],
  ['歌词独占：切换歌词时滑动入场 + 换行平滑滚动',
    renderer.includes("classList.add('is-enter')") && css.includes('@keyframes lxLyricsIn') &&
    renderer.includes("behavior = smooth && !reduce ? 'smooth' : 'auto'")],
  ['歌词独占：最底部通栏细进度条（贴边全长、scaleX 更新、不触发布局）',
    html.includes('id="lxProgress"') && html.includes('id="lxProgressFill"') &&
    /\.lx-progress \{[^}]*position: absolute/.test(css) &&
    /\.lx-progress \{[^}]*bottom: 0/.test(css) &&
    renderer.includes('function updateLyricsExclusiveBar') &&
    renderer.includes('fill.style.transform = `scaleX(')],
  ['歌词独占：停止播放后完全重置（封面/歌词/时间/进度条/滚动动画）',
    renderer.includes('function resetLyricsExclusive') &&
    renderer.includes('resetLyricsExclusive();') &&
    renderer.includes('lxState.coverToken += 1;') &&
    renderer.includes("$('lxTime').textContent = '00:00/00:00'") &&
    renderer.includes("fill.style.transform = 'scaleX(0)'") &&
    renderer.includes("artist.classList.remove('is-marquee')")],
  ['歌词独占：底部播放控件栏结构齐全（上一曲/播放暂停/停止/下一曲/循环）',
    html.includes('id="lxControls"') && html.includes('id="lxCtrlPrev"') &&
    html.includes('id="lxCtrlPlay"') && html.includes('id="lxCtrlStop"') &&
    html.includes('id="lxCtrlNext"') && html.includes('id="lxCtrlRepeat"')],
  ['歌词独占：靠近底部（≈控件栏高度，最底部也算）立即滑出，无悬停时长',
    !renderer.includes('LX_CONTROLS_EDGE_GAP') &&
    renderer.includes('function lxControlsHit') &&
    renderer.includes('window.innerHeight - e.clientY') &&
    renderer.includes('distance >= 0 && distance <= bandH + 2') &&
    !renderer.includes('LX_CONTROLS_SHOW_DELAY') &&
    renderer.includes('function onLyricsExclusivePointerMove') &&
    renderer.includes("wire('lxCtrlPrev', 'btnPrev')") &&
    renderer.includes("wire('lxCtrlPlay', 'btnPlay')") &&
    renderer.includes("wire('lxCtrlStop', 'btnStop')") &&
    renderer.includes("wire('lxCtrlNext', 'btnNext')") &&
    renderer.includes("wire('lxCtrlRepeat', 'btnRepeat')")],
  ['歌词独占：进度条可拖动/点击（加高命中区 + 时间气泡 + 进度头）',
    html.includes('id="lxProgressZone"') && html.includes('id="lxProgressTime"') &&
    html.includes('id="lxProgressHead"') &&
    /\.lx-progress-zone \{[^}]*height: 14px/.test(css) &&
    /\.lx-progress-zone \{[^}]*cursor: pointer/.test(css) &&
    css.includes('.lx-progress-time') && css.includes('.lx-progress-head')],
  ['歌词独占：进度条悬停显示 xx:xx/xx:xx，拖动同步歌词并 seek',
    renderer.includes('function bindLyricsExclusiveProgressBar') &&
    renderer.includes('bindPointerDrag(zone') &&
    renderer.includes('function showLyricsExclusiveBarBubble') &&
    renderer.includes('function previewLyricsExclusiveSeek') &&
    renderer.includes('lyricsExclusiveIndexAt(preview') === false &&
    renderer.includes('function lyricsExclusiveIndexAt') &&
    renderer.includes('if (!lxState.open || lxSeeking) return;') &&
    renderer.includes('api.player.seek(target)')],
  ['歌词独占：控件栏右下角音量控件（滑杆/静音/数字，逻辑转发主界面）',
    html.includes('id="lxVolumeBox"') && html.includes('id="lxVolIcon"') &&
    html.includes('id="lxVolume"') && html.includes('id="lxVolNum"') &&
    renderer.includes('function syncLyricsExclusiveVolume') &&
    renderer.includes('main.click();') &&
    renderer.includes("main.dispatchEvent(new Event('input', { bubbles: true }));") &&
    /\.lx-volume \{[^}]*position: absolute/.test(css) &&
    /\.lx-volume \{[^}]*right: clamp\(14px, 2vw, 24px\)/.test(css) &&
    css.includes('.lx-vol-btn[data-level="mute"]')],
  ['歌词独占：停止后控件栏播放/暂停图标跟随复位（不能停在 ⏸）',
    /function resetLyricsExclusive[\s\S]{0,1800}syncLyricsExclusiveControls/.test(renderer) &&
    /function resetLyricsExclusive[\s\S]{0,1800}syncLyricsExclusiveVolume/.test(renderer) &&
    renderer.includes('if (lxControlsShown) {')],
  ['歌词独占：底部控件栏贴底无缝隙，背景不抢进度条事件',
    /\.lx-controls \{[^}]*bottom: 0/.test(css) &&
    /\.lx-controls \{[^}]*pointer-events: none/.test(css) &&
    /\.lx-controls-inner \{[^}]*pointer-events: none/.test(css) &&
    /\.lx-ctl \{[^}]*pointer-events: auto/.test(css) &&
    /\.lx-volume \{[^}]*pointer-events: auto/.test(css) &&
    renderer.includes('ctl.offsetHeight - 14 + 6') &&
    css.includes('--lx-controls-top')],
  ['歌词独占：滑出/滑回是 CSS 过渡（连续触发可中途反向），不是一次性动画重播',
    /\.lx-controls \{[^}]*transition: transform/.test(css) &&
    !/\.lx-controls \{[^}]*animation:/.test(css) &&
    !/\.lx-left \{[^}]*animation:/.test(css) &&
    renderer.includes("sec.classList.add('controls-open')") &&
    renderer.includes("sec.classList.remove('controls-open')")],
  ['歌词独占：控件栏滑出时封面/信息上移、歌词列不动（CSS 过渡，终态由类决定）',
    /\.lx-controls \{[^}]*translateY\(calc\(100% \+ 6px\)\)/.test(css) &&
    css.includes('#lyricsExclusive.controls-open .lx-controls') &&
    /\.lx-left \{[^}]*transition: transform/.test(css) &&
    css.includes('#lyricsExclusive.controls-open .lx-left') &&
    /#lyricsExclusive\.controls-open \.lx-left \{[^}]*translateY\(calc\(-1 \* var\(--lx-controls-rise/.test(css)],
  ['歌词独占：控件栏半透明，鼠标离开立即滑回去',
    /\.lx-controls \{[^}]*rgba\(6, 10, 16, \.58\)/.test(css) &&
    css.includes('backdrop-filter: blur(10px)') &&
    renderer.includes('hideLyricsExclusiveControls();') &&
    renderer.includes("sec.addEventListener('pointerleave'")],
  ['歌词独占：歌词行居中高亮（程序化滚动定位 + 换行平滑滑动 + 当前行样式）',
    renderer.includes('function paintLyricsExclusiveHighlight') &&
    renderer.includes('active.offsetTop - box.clientHeight / 2 + active.offsetHeight / 2') &&
    renderer.includes('box.scrollTo({ top: target, behavior })') &&
    css.includes('.lx-line.is-active')],
  ['歌词独占：与侧栏歌词共用同一套歌词偏移语义（正值 = 延后）',
    renderer.includes('function updateLyricsExclusiveProgress') &&
    /lyricsOffsetMs/.test(renderer)],
];
let failed = 0;
for (const [name, ok] of checks) {
  console.log(`  ${ok ? '✓' : '✗'} ${name}`);
  if (!ok) failed++;
}
fs.rmSync(out, { recursive: true, force: true });
console.log(`\n=== 打包内界面校验: ${checks.length - failed}/${checks.length} 通过 ===`);
process.exit(failed ? 1 : 0);
