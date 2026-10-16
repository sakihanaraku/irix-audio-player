
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pc = require('../src/main/playcounts.js');

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: !!ok });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

console.log('=== 播放次数 / 排行榜 单测 ===');


console.log('\n[A] 同一首的判定（元数据，不用路径）');
{
  const base = { artist: 'Eagles', title: 'Hotel California', album: 'Hotel California' };
  check('相同三项 → 同一个 key',
    pc.songKey(base) === pc.songKey({ ...base }), '');
  check('大小写/空白差异视为同一首',
    pc.songKey(base) === pc.songKey({ artist: '  EAGLES ', title: 'hotel   california', album: 'Hotel California ' }),
    pc.songKey({ artist: '  EAGLES ', title: 'hotel   california', album: 'Hotel California ' }));
  check('换专辑名 → 不同 key（现场版/精选集分开统计）',
    pc.songKey(base) !== pc.songKey({ ...base, album: 'Hell Freezes Over' }), '');
  check('换艺术家 → 不同 key', pc.songKey(base) !== pc.songKey({ ...base, artist: 'Somebody' }), '');
  check('换标题 → 不同 key', pc.songKey(base) !== pc.songKey({ ...base, title: 'Hotel California (Live)' }), '');
  check('缺字段不会与"空字段"撞车',
    pc.songKey({ artist: 'A', title: 'B' }) !== pc.songKey({ artist: 'A', title: 'B', album: 'C' }),
    `${pc.songKey({ artist: 'A', title: 'B' })} vs ${pc.songKey({ artist: 'A', title: 'B', album: 'C' })}`);
  check('专辑艺术家可在缺 artist 时顶替',
    pc.songKey({ albumArtist: 'VA', title: 'T', album: 'A' }) === pc.songKey({ artist: 'va', title: 'T', album: 'a' }), '');
}


console.log('\n[B] 计数（完播 +1）');
{
  const data = pc.emptyData();
  const song = { artist: 'Eagles', title: 'Hotel California', album: 'Hotel California' };
  check('初始为空', pc.ranking(data).length === 0 && pc.summary(data).totalPlays === 0, '');
  check('第一次 +1 → 1', pc.addPlay(data, song) === 1, '');
  check('第二次 +1 → 2', pc.addPlay(data, song) === 2, '');
  check('同一首只占一条', pc.ranking(data).length === 1, `${pc.ranking(data).length} 条`);
  const other = { artist: 'Queen', title: 'Bohemian Rhapsody', album: 'A Night at the Opera' };
  pc.addPlay(data, other);
  check('换一首各记各的', pc.ranking(data).length === 2 && pc.summary(data).totalPlays === 3,
    `total=${pc.summary(data).totalPlays}`);
  check('记录了最近播放时间',
    typeof pc.ranking(data).find((e) => e.title === 'Hotel California').lastPlayedAt === 'string', '');
  check('记录了时长（可选）', (() => {
    pc.addPlay(data, other, { durationMs: 354000 });
    return pc.ranking(data).find((e) => e.title === 'Bohemian Rhapsody').durationMs === 354000;
  })(), '');
}


console.log('\n[C] 排行榜排序');
{
  const data = pc.emptyData();
  const mk = (t, n) => { for (let i = 0; i < n; i++) pc.addPlay(data, { artist: 'X', title: t, album: 'A' }); };
  mk('三', 3); mk('五', 5); mk('一', 1);
  const r = pc.ranking(data);
  check('次数从多到少', r.map((e) => e.plays).join(',') === '5,3,1', r.map((e) => `${e.title}:${e.plays}`).join(' '));
  check('同次数时最近播放的在前', (() => {
    const d2 = pc.emptyData();
    pc.addPlay(d2, { artist: 'X', title: '早', album: 'A' }, { now: '2026-01-01T00:00:00.000Z' });
    pc.addPlay(d2, { artist: 'X', title: '晚', album: 'A' }, { now: '2026-06-01T00:00:00.000Z' });
    return pc.ranking(d2)[0].title === '晚';
  })(), '');
  check('排行榜条目带 key 便于定位', typeof r[0].key === 'string' && r[0].key.length > 0, '');
}


console.log('\n[D] 存档读写');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'irix-plays-'));
  const file = path.join(dir, 'play-counts.json');
  const data = pc.emptyData();
  pc.addPlay(data, { artist: 'Eagles', title: 'Hotel California', album: 'HC' });
  pc.addPlay(data, { artist: 'Eagles', title: 'Hotel California', album: 'HC' });
  pc.addPlay(data, { artist: 'Queen', title: 'BR', album: 'ANATO' });
  pc.save(file, data);
  check('文件写出来了', fs.existsSync(file), file);
  const back = pc.load(file);
  check('读回来次数一致', pc.ranking(back).map((e) => e.plays).join(',') === '2,1',
    pc.ranking(back).map((e) => `${e.title}:${e.plays}`).join(' '));
  check('读回来元数据保留', pc.ranking(back)[0].artist === 'Eagles' && pc.ranking(back)[0].album === 'HC', '');

  fs.writeFileSync(file, '{ 坏 JSON', 'utf8');
  check('存档损坏时退回空数据（不抛异常）', pc.ranking(pc.load(file)).length === 0, '');
  check('文件不存在也安全', pc.ranking(pc.load(path.join(dir, 'nope.json'))).length === 0, '');
  fs.rmSync(dir, { recursive: true, force: true });
}


console.log('\n[E] 上限与健壮性');
{
  const data = pc.emptyData();
  for (let i = 0; i < pc.MAX_ENTRIES + 40; i++) {
    pc.addPlay(data, { artist: 'X', title: `曲目${i}`, album: 'A' });
  }
  check(`条目数被限制在 ${pc.MAX_ENTRIES} 以内`, Object.keys(data.songs).length <= pc.MAX_ENTRIES,
    `${Object.keys(data.songs).length} 条`);
  const data2 = pc.emptyData();
  check('非法次数被忽略（读档时）', (() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'irix-plays2-'));
    const f = path.join(dir, 'p.json');
    fs.writeFileSync(f, JSON.stringify({ version: 1, songs: { k: { plays: -3 }, ok: { plays: 2 } } }), 'utf8');
    const loaded = pc.load(f);
    fs.rmSync(dir, { recursive: true, force: true });
    return pc.ranking(loaded).length === 1 && pc.ranking(loaded)[0].plays === 2;
  })(), '');
  check('空元数据也不会崩', (() => {
    pc.addPlay(data2, {});
    return pc.ranking(data2).length === 1;
  })(), '');
  check('summary 结构正确', (() => {
    const s = pc.summary(data2);
    return typeof s.songs === 'number' && typeof s.totalPlays === 'number' && s.totalPlays === 1;
  })(), JSON.stringify(pc.summary(data2)));
}


console.log('\n[F] 编辑（移除记录）');
{
  const data = pc.emptyData();
  const a = { artist: 'Eagles', title: 'Hotel California', album: 'HC' };
  const b = { artist: 'Queen', title: 'BR', album: 'ANATO' };
  const c = { artist: 'Aurora', title: 'Tone', album: 'Self' };
  pc.addPlay(data, a);
  pc.addPlay(data, b);
  pc.addPlay(data, c);
  pc.addPlay(data, b);
  check('移除前 3 首 / 4 次', pc.summary(data).songs === 3 && pc.summary(data).totalPlays === 4,
    JSON.stringify(pc.summary(data)));
  const removed = pc.removeSongs(data, [pc.songKey(b)]);
  check('按 key 移除一条', removed === 1 && pc.summary(data).songs === 2, `removed=${removed}`);
  check('被移除的不再出现在排行榜',
    !pc.ranking(data).some((e) => e.title === 'BR'), pc.ranking(data).map((e) => e.title).join(','));
  check('其它记录不受影响', pc.summary(data).totalPlays === 2, JSON.stringify(pc.summary(data)));
  check('不存在的 key 被忽略（返回 0）', pc.removeSongs(data, ['nope']) === 0, '');
  check('空数组/非数组都安全', pc.removeSongs(data, []) === 0 && pc.removeSongs(data, null) === 0, '');
  check('一次移除多条', (() => {
    const d2 = pc.emptyData();
    pc.addPlay(d2, a); pc.addPlay(d2, b); pc.addPlay(d2, c);
    return pc.removeSongs(d2, [pc.songKey(a), pc.songKey(c)]) === 2 && pc.summary(d2).songs === 1;
  })(), '');
  check('移除后存档一致', (() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'irix-plays3-'));
    const f = path.join(dir, 'p.json');
    pc.save(f, data);
    const back = pc.load(f);
    fs.rmSync(dir, { recursive: true, force: true });
    return back.songs && !pc.ranking(back).some((e) => e.title === 'BR');
  })(), '');
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n=== 播放次数: ${checks.length - failed.length}/${checks.length} 通过 ===`);
if (failed.length) {
  for (const f of failed) console.log(`  ✗ ${f.name}`);
  process.exit(1);
}
