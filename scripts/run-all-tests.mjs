
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const steps = [
  ['生成测试媒体', 'scripts/make-test-media.mjs', []],
  ['N-API 音频引擎（四种后端实际出声）', 'test/engine.test.mjs', ['--seconds', '1.0']],
  ['ffmpeg 解码 + 格式识别 + 封面', 'test/decode.test.mjs', ['--seconds', '1.0']],
  ['主进程业务流程端到端', 'test/app.test.mjs', []],
  ['多语言词条一致性', 'test/i18n-keys.test.mjs', []],
  ['改名后的数据目录迁移', 'test/migrate-unit.mjs', []],
  ['Wine 兼容层（检测 / 降级链 / 保守默认值）', 'test/wine-unit.mjs', []],
  ['Linux 构建支持（ALSA 后端 / 打包配置 / CI）', 'test/linux-unit.mjs', []],
  ['地址栏路径校验（格式 / 环境变量 / 平台差异）', 'test/paths-unit.mjs', []],
  ['8 段均衡器（DSP 频率响应 / 预设 / .eq 文件）', 'test/eq-unit.mjs', []],
  ['播放次数与排行榜（元数据判定 / 计数 / 排序 / 存档）', 'test/playcounts-unit.mjs', []],
  ['音频转换（FLAC/Wave/MP3/AAC/Vorbis 真实转码 + 参数生效）', 'test/convert-unit.mjs', []],
  ['歌词（LRC 解析 / 元数据与同目录 .lrc 查找顺序 / 当前行换算）', 'test/lyrics-unit.mjs', []],
  ['IPC 契约（真实 main.js + preload.js）', 'test/main-smoke.mjs', []],
  ['原生任务栏接口（Windows Thumbbar 冒烟）', 'test/taskbar-native-unit.mjs', []],
  ['渲染层 UI（真实 Chromium 渲染）', 'test/ui/run-ui-test.mjs', []],
];


if (fs.existsSync(path.join(projectRoot, 'dist', 'win-unpacked', 'resources', 'app.asar'))) {
  steps.push(['打包产物运行期校验', 'test/packaged.test.mjs', []]);
  steps.push(['打包内界面校验', 'test/asar-ui.test.mjs', []]);
  steps.push(['PE 版本资源校验', 'test/version-info.test.mjs', []]);
}

const summary = [];
for (const [name, script, args] of steps) {
  console.log(`\n${'='.repeat(72)}\n▶ ${name}\n${'='.repeat(72)}`);
  const r = spawnSync(process.execPath, [path.join(projectRoot, script), ...args], {
    cwd: projectRoot, stdio: 'inherit', windowsHide: true,
  });
  summary.push({ name, code: r.status });
}

console.log(`\n${'='.repeat(72)}\n测试汇总\n${'='.repeat(72)}`);
let failed = 0;
for (const s of summary) {
  console.log(`  ${s.code === 0 ? '✓ 通过' : '✗ 失败'}  ${s.name}`);
  if (s.code !== 0) failed++;
}
console.log(`\n${failed ? `✗ ${failed} 项失败` : '✓ 全部通过'}`);
process.exit(failed ? 1 : 0);
