

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

const sfxSrc = fs.readFileSync(path.join(projectRoot, 'native', 'sfx', 'sfx.cpp'), 'utf8');

const checks = [
  ['应用名为 iRix Audio Player', html.includes('<title>iRix Audio Player</title>') &&
    html.includes('>iRix Audio Player</span>') && main.includes("APP_DISPLAY_NAME = 'iRix Audio Player'")],
  ['第三方组件声明随包分发，且写明本仓库不含 ncm（THIRD-PARTY-NOTICES.md）',
    (() => {
      try {
        const n = read('THIRD-PARTY-NOTICES.md');
        return n.includes('Electron') && n.includes('Apache-2.0') && n.includes('FFmpeg') &&
          n.includes('本仓库不包含该功能');   
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
  ['版本号为 1.0.1-release；标题栏已无版本徽标，版本显示在设置里',
    JSON.parse(fs.readFileSync(path.join(out, 'package.json'), 'utf8')).version === '1.0.1-release' &&
    
    !html.includes('app-version') && !html.includes('id="appVersion"') &&
    
    html.includes('id="aboutVersion"') &&
    renderer.includes('aboutVersion') && renderer.includes('info.appVersion') && !renderer.includes('appVersion\'')],
  ['多语言（中/日/英）已打包',
    fs.existsSync(path.join(out, 'src', 'renderer', 'i18n.js')) &&
    html.includes('src="i18n.js"') && html.includes('id="selLanguage"') &&
    ['zh', 'ja', 'en'].every((l) => i18nSrc.includes(`${l}: {`))],
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
    renderer.includes('function applyWineInfo') && css.includes('body.no-glass') &&
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
];
let failed = 0;
for (const [name, ok] of checks) {
  console.log(`  ${ok ? '✓' : '✗'} ${name}`);
  if (!ok) failed++;
}
fs.rmSync(out, { recursive: true, force: true });
console.log(`\n=== 打包内界面校验: ${checks.length - failed}/${checks.length} 通过 ===`);
process.exit(failed ? 1 : 0);
