


import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const rendererDir = path.join(projectRoot, 'src', 'renderer');
const artifacts = path.join(projectRoot, 'test', 'artifacts');
fs.mkdirSync(artifacts, { recursive: true });

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  process.env.CHROME_PATH || '',
];
const edge = EDGE_CANDIDATES.find((p) => p && fs.existsSync(p));
if (!edge) {
  console.error('未找到 Edge/Chromium，无法执行 UI 渲染测试');
  process.exit(2);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  let filePath;
  let body;
  if (url.pathname === '/' || url.pathname === '/index.html') {
    
    let html = fs.readFileSync(path.join(rendererDir, 'index.html'), 'utf8');
    html = html.replace('<script src="renderer.js"></script>',
      '<script src="/mock-bridge.js"></script>\n<script src="renderer.js"></script>');
    body = html;
    res.writeHead(200, { 'Content-Type': MIME['.html'] });
    res.end(body);
    return;
  }
  if (url.pathname === '/mock-bridge.js') {
    filePath = path.join(projectRoot, 'test', 'ui', 'mock-bridge.js');
  } else {
    filePath = path.join(rendererDir, path.basename(url.pathname));
  }
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
  res.end(fs.readFileSync(filePath));
});

const port = await new Promise((resolve) => {
  server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});
const base = `http://127.0.0.1:${port}`;
console.log('UI 测试服务:', base);
console.log('浏览器    :', edge);

function runEdge(args, timeoutMs = 60000) {
  return new Promise((resolve) => {
    const child = spawn(edge, args, { windowsHide: true });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { try { child.kill(); } catch {} }, timeoutMs);
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('exit', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
  });
}

const profile = path.join(os.tmpdir(), 'aurora-ui-profile');
fs.mkdirSync(profile, { recursive: true });
const commonFlags = [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${profile}`, '--window-size=1366,768', '--hide-scrollbars',
];





const domRun = await runEdge([...commonFlags, '--virtual-time-budget=90000', '--dump-dom', `${base}/`]);
const match = domRun.out.match(/<pre id="__results">([\s\S]*?)<\/pre>/);
let report = null;
if (match) {
  const json = match[1]
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  try { report = JSON.parse(json); } catch (e) { console.error('解析断言结果失败:', e.message); }
}

console.log('\n=== 渲染层交互断言 ===');
if (!report) {
  console.error('✗ 未取到断言结果；页面可能加载失败');
  console.error(domRun.err.split('\n').slice(-8).join('\n'));
  fs.writeFileSync(path.join(artifacts, 'ui-dump-dom.html'), domRun.out, 'utf8');
  server.close();
  process.exit(1);
}
for (const r of report.results) {
  console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.ok ? '' : ' — ' + r.detail}`);
}
console.log(`  小计: ${report.passed}/${report.results.length} 通过`);


const shot = path.join(artifacts, 'ui-screenshot.png');
fs.rmSync(shot, { force: true });
await runEdge([...commonFlags, '--virtual-time-budget=4000', `--screenshot=${shot}`, `${base}/?mode=shot`]);
const shotOk = fs.existsSync(shot) && fs.statSync(shot).size > 5000;
console.log(`\n${shotOk ? '✓' : '✗'} 界面截图: ${shot} ${shotOk ? `(${(fs.statSync(shot).size / 1024).toFixed(0)} KB)` : ''}`);


const shotSettings = path.join(artifacts, 'ui-settings.png');
fs.rmSync(shotSettings, { force: true });
await runEdge([...commonFlags, '--virtual-time-budget=4000', `--screenshot=${shotSettings}`, `${base}/?mode=settings`]);

const shotLangManaged = path.join(artifacts, 'ui-settings-lang-managed.png');
fs.rmSync(shotLangManaged, { force: true });
await runEdge([...commonFlags, '--virtual-time-budget=4000', `--screenshot=${shotLangManaged}`, `${base}/?mode=settings-lang-managed`]);
console.log(`${fs.existsSync(shotLangManaged) ? '✓' : '✗'} 语言扩展接管截图: ${shotLangManaged}`);
const domLangManaged = await runEdge([...commonFlags, '--virtual-time-budget=6000', '--dump-dom', `${base}/?mode=settings-lang-managed`]);
const langDebug = (domLangManaged.out.match(/<pre id="langDebug"[^>]*>([^<]*)<\/pre>/) || [])[1] || '';
console.log(`${langDebug.includes('"disabled":true') && langDebug.includes('"btnDisabled":true') ? '✓' : '✗'} 语言选择禁用态: ${langDebug || '(未读到)'}`);
const shotSettingsOk = fs.existsSync(shotSettings) && fs.statSync(shotSettings).size > 5000;
console.log(`${shotSettingsOk ? '✓' : '✗'} 设置界面截图: ${shotSettings}`);


const shot3 = path.join(artifacts, 'ui-browser-drag.png');
fs.rmSync(shot3, { force: true });
await runEdge([...commonFlags, '--virtual-time-budget=4000', `--screenshot=${shot3}`, `${base}/?mode=drag`]);
const shot3Ok = fs.existsSync(shot3) && fs.statSync(shot3).size > 5000;
console.log(`${shot3Ok ? '✓' : '✗'} 文件浏览器拖放截图: ${shot3}`);


const shotIdle = path.join(artifacts, 'ui-idle.png');
fs.rmSync(shotIdle, { force: true });
await runEdge([...commonFlags, '--virtual-time-budget=3000', `--screenshot=${shotIdle}`, `${base}/?mode=idle`]);
const shotIdleOk = fs.existsSync(shotIdle) && fs.statSync(shotIdle).size > 5000;
console.log(`${shotIdleOk ? '✓' : '✗'} 未播放状态截图: ${shotIdle}`);


const shotTheme = path.join(artifacts, 'ui-theme.png');
fs.rmSync(shotTheme, { force: true });
await runEdge([...commonFlags, '--virtual-time-budget=4000', `--screenshot=${shotTheme}`, `${base}/?mode=theme`]);
const shotThemeOk = fs.existsSync(shotTheme) && fs.statSync(shotTheme).size > 5000;
console.log(`${shotThemeOk ? '✓' : '✗'} 主题色截图: ${shotTheme}`);


for (const lang of ['en', 'ja']) {
  const file = path.join(artifacts, `ui-lang-${lang}.png`);
  fs.rmSync(file, { force: true });
  await runEdge([...commonFlags, '--virtual-time-budget=4000', `--screenshot=${file}`, `${base}/?mode=${lang}`]);
  const ok = fs.existsSync(file) && fs.statSync(file).size > 5000;
  console.log(`${ok ? '✓' : '✗'} ${lang === 'en' ? '英文' : '日文'}界面截图: ${file}`);
}


const shotLight = path.join(artifacts, 'ui-light.png');
fs.rmSync(shotLight, { force: true });
await runEdge([...commonFlags, '--virtual-time-budget=4000', `--screenshot=${shotLight}`, `${base}/?mode=light`]);
const shotLightOk = fs.existsSync(shotLight) && fs.statSync(shotLight).size > 5000;
console.log(`${shotLightOk ? '✓' : '✗'} 浅色主题截图: ${shotLight}`);


const shotMany = path.join(artifacts, 'ui-browser-many.png');
fs.rmSync(shotMany, { force: true });
await runEdge([...commonFlags, '--virtual-time-budget=4000', `--screenshot=${shotMany}`, `${base}/?mode=many`]);
const shotManyOk = fs.existsSync(shotMany) && fs.statSync(shotMany).size > 5000;
console.log(`${shotManyOk ? '✓' : '✗'} 文件浏览器多条目截图: ${shotMany}`);


const shotRoot = path.join(artifacts, 'ui-browser-root.png');
fs.rmSync(shotRoot, { force: true });
await runEdge([...commonFlags, '--virtual-time-budget=5000', `--screenshot=${shotRoot}`, `${base}/?mode=root`]);
const shotRootOk = fs.existsSync(shotRoot) && fs.statSync(shotRoot).size > 5000;
console.log(`${shotRootOk ? '✓' : '✗'} 盘根路径截图: ${shotRoot}`);


const shotToast = path.join(artifacts, 'ui-path-toast.png');
fs.rmSync(shotToast, { force: true });
await runEdge([...commonFlags, '--virtual-time-budget=2200', `--screenshot=${shotToast}`, `${base}/?mode=toast`]);
const shotToastOk = fs.existsSync(shotToast) && fs.statSync(shotToast).size > 5000;
console.log(`${shotToastOk ? '✓' : '✗'} 地址栏提示截图: ${shotToast}`);


const shotEq = path.join(artifacts, 'ui-eq.png');
fs.rmSync(shotEq, { force: true });
await runEdge([...commonFlags, '--virtual-time-budget=3000', `--screenshot=${shotEq}`, `${base}/?mode=eq`]);
const shotEqOk = fs.existsSync(shotEq) && fs.statSync(shotEq).size > 5000;
console.log(`${shotEqOk ? '✓' : '✗'} 均衡器截图: ${shotEq}`);


const shotMute = path.join(artifacts, 'ui-mute.png');
fs.rmSync(shotMute, { force: true });
await runEdge([...commonFlags, '--virtual-time-budget=2200', `--screenshot=${shotMute}`, `${base}/?mode=mute`]);
const shotMuteOk = fs.existsSync(shotMute) && fs.statSync(shotMute).size > 5000;
console.log(`${shotMuteOk ? '✓' : '✗'} 静音状态截图: ${shotMute}`);


const shotShuffle = path.join(artifacts, 'ui-shuffle.png');
fs.rmSync(shotShuffle, { force: true });
await runEdge([...commonFlags, '--virtual-time-budget=2200', `--screenshot=${shotShuffle}`, `${base}/?mode=shuffle`]);
const shotShuffleOk = fs.existsSync(shotShuffle) && fs.statSync(shotShuffle).size > 5000;
console.log(`${shotShuffleOk ? '✓' : '✗'} 随机播放截图: ${shotShuffle}`);


const shotRank = path.join(artifacts, 'ui-rank.png');
fs.rmSync(shotRank, { force: true });
await runEdge([...commonFlags, '--virtual-time-budget=2600', `--screenshot=${shotRank}`, `${base}/?mode=rank`]);
const shotRankOk = fs.existsSync(shotRank) && fs.statSync(shotRank).size > 5000;
console.log(`${shotRankOk ? '✓' : '✗'} 排行榜截图: ${shotRank}`);


const shotRankEdit = path.join(artifacts, 'ui-rank-edit.png');
fs.rmSync(shotRankEdit, { force: true });
await runEdge([...commonFlags, '--virtual-time-budget=2800', `--screenshot=${shotRankEdit}`, `${base}/?mode=rank-edit`]);
const shotRankEditOk = fs.existsSync(shotRankEdit) && fs.statSync(shotRankEdit).size > 5000;
console.log(`${shotRankEditOk ? '✓' : '✗'} 排行榜编辑态截图: ${shotRankEdit}`);


const shotLongSel = path.join(artifacts, 'ui-long-select.png');
fs.rmSync(shotLongSel, { force: true });
await runEdge([...commonFlags, '--virtual-time-budget=3200', `--screenshot=${shotLongSel}`, `${base}/?mode=longsel`]);
const shotLongSelOk = fs.existsSync(shotLongSel) && fs.statSync(shotLongSel).size > 5000;
console.log(`${shotLongSelOk ? '✓' : '✗'} 长文本下拉截图: ${shotLongSel}`);


const shotDrives = path.join(artifacts, 'ui-drives.png');
fs.rmSync(shotDrives, { force: true });
await runEdge([...commonFlags, '--virtual-time-budget=3000', `--screenshot=${shotDrives}`, `${base}/?mode=drives`]);
const shotDrivesOk = fs.existsSync(shotDrives) && fs.statSync(shotDrives).size > 5000;
console.log(`${shotDrivesOk ? '✓' : '✗'} 磁盘列表截图: ${shotDrives}`);


const shotCtx = path.join(artifacts, 'ui-ctxmenu.png');
fs.rmSync(shotCtx, { force: true });
await runEdge([...commonFlags, '--virtual-time-budget=2000', `--screenshot=${shotCtx}`, `${base}/?mode=ctxmenu`]);
console.log(`${fs.existsSync(shotCtx) ? '✓' : '✗'} 右键菜单截图: ${shotCtx}`);


const shotLyrics = path.join(artifacts, 'ui-lyrics.png');
fs.rmSync(shotLyrics, { force: true });
await runEdge([...commonFlags, '--virtual-time-budget=3000', `--screenshot=${shotLyrics}`, `${base}/?mode=lyrics`]);
console.log(`${fs.existsSync(shotLyrics) ? '✓' : '✗'} 歌词页截图: ${shotLyrics}`);

const shotLyricsEdit = path.join(artifacts, 'ui-lyrics-edit.png');
fs.rmSync(shotLyricsEdit, { force: true });
await runEdge([...commonFlags, '--virtual-time-budget=3600', `--screenshot=${shotLyricsEdit}`, `${base}/?mode=lyricedit`]);
console.log(`${fs.existsSync(shotLyricsEdit) ? '✓' : '✗'} 歌词编辑窗截图: ${shotLyricsEdit}`);

const shotCorner = path.join(artifacts, 'ui-toast-corner.png');
fs.rmSync(shotCorner, { force: true });
await runEdge([...commonFlags, '--virtual-time-budget=3000', `--screenshot=${shotCorner}`, `${base}/?mode=toastcorner`]);
console.log(`${fs.existsSync(shotCorner) ? '✓' : '✗'} 右下角提示截图: ${shotCorner}`);

const shotConvert = path.join(artifacts, 'ui-convert.png');
fs.rmSync(shotConvert, { force: true });
await runEdge([...commonFlags, '--virtual-time-budget=3600', `--screenshot=${shotConvert}`, `${base}/?mode=convert`]);
console.log(`${fs.existsSync(shotConvert) ? '✓' : '✗'} 转换面板截图: ${shotConvert}`);


const shotSelect = path.join(artifacts, 'ui-select.png');
fs.rmSync(shotSelect, { force: true });
await runEdge([...commonFlags, '--virtual-time-budget=2200', `--screenshot=${shotSelect}`, `${base}/?mode=select`]);
const shotSelectOk = fs.existsSync(shotSelect) && fs.statSync(shotSelect).size > 5000;
console.log(`${shotSelectOk ? '✓' : '✗'} 下拉展开截图: ${shotSelect}`);


const shotLx = path.join(artifacts, 'ui-lyrics-exclusive.png');
fs.rmSync(shotLx, { force: true });
await runEdge([...commonFlags, '--virtual-time-budget=6000', `--screenshot=${shotLx}`, `${base}/?mode=lyrics-exclusive`]);
const shotLxOk = fs.existsSync(shotLx) && fs.statSync(shotLx).size > 5000;
console.log(`${shotLxOk ? '✓' : '✗'} 歌词独占截图: ${shotLx}`);


const shotLxLight = path.join(artifacts, 'ui-lyrics-exclusive-light.png');
fs.rmSync(shotLxLight, { force: true });
await runEdge([...commonFlags, '--virtual-time-budget=7000', `--screenshot=${shotLxLight}`, `${base}/?mode=lyrics-exclusive-light`]);
const shotLxLightOk = fs.existsSync(shotLxLight) && fs.statSync(shotLxLight).size > 5000;
console.log(`${shotLxLightOk ? '✓' : '✗'} 歌词独占浅色截图: ${shotLxLight}`);



{
  const shot = path.join(artifacts, 'ui-screenshot.png');
  const script = path.join(projectRoot, 'scripts', 'check-titlebar-align.py');
  const pyCandidates = [
    process.env.PYTHON,
    path.join(os.homedir(), '.dsh', 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'python', 'python.exe'),
    path.join(os.homedir(), '.dsh', 'dsh-runtimes', 'dsh-primary-runtime', 'python', 'python.exe'),
  ].filter(Boolean);
  const py = pyCandidates.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
  if (!py || !fs.existsSync(script)) {
    console.log('• 跳过标题栏像素级检查（未找到带 Pillow 的 python）');
  } else {
    const out = await new Promise((resolve) => {
      const child = spawn(py, [script, shot, report.themeColor || '#35d07f'], {
        cwd: projectRoot,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      });
      let text = '';
      child.stdout.on('data', (d) => { text += d.toString(); });
      child.stderr.on('data', (d) => { text += d.toString(); });
      child.on('close', (code) => resolve({ code, text }));
      child.on('error', (e) => resolve({ code: -1, text: String(e.message) }));
    });
    for (const line of out.text.trim().split('\n')) console.log(`  ${line}`);
    console.log(`${out.code === 0 ? '✓' : '✗'} 标题栏像素级对齐检查（徽标 vs 软件名字母带）`);
    if (out.code !== 0) report.results.push({ name: '标题栏像素级对齐检查', ok: false });
    else report.passed++;
  }
}

server.close();

const failed = report.results.filter((r) => !r.ok);
fs.writeFileSync(path.join(artifacts, 'ui-report.json'), JSON.stringify(report, null, 2), 'utf8');
console.log(`\n=== UI 验证汇总: ${report.passed}/${report.results.length} 通过，截图 ${shotOk ? '成功' : '失败'} ===`);
process.exit(failed.length || !shotOk ? 1 : 0);
