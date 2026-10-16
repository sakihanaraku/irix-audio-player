

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const lyrics = require('../src/main/lyrics.js');
const ffmpegMod = require('../src/main/ffmpeg.js');

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail !== undefined && !ok ? ` — ${detail}` : ''}`);
};

console.log('=== 歌词内核（解析 / 查找顺序 / 偏移） ===\n');


{
  const lrc = [
    '[ti:测试曲目]',
    '[ar:测试歌手]',
    '[offset:+500]',
    '[00:01.00]第一行',
    '[00:05.50][00:10.25]副歌（两个时间戳）',
    '[00:20]没有小数的时间戳',
    '[00:30:50]冒号百分秒',
    '',
    '[99.9]这一行时间戳不合法，但文本要保留成静态行',
  ].join('\n');
  const p = lyrics.parseLrc(lrc);
  check('解析出元数据（ti / ar / offset）', p.meta.ti === '测试曲目' && p.meta.ar === '测试歌手' && p.meta.offset === '+500',
    JSON.stringify(p.meta));
  const first = p.lines.find((l) => l.text === '第一行');
  check('offset 加到每一行上（1.0s + 500ms = 1.5s）', first && first.time === 1.5, first ? first.time : '没找到第一行');
  check('一行多个时间戳会展开', p.lines.filter((l) => l.text === '副歌（两个时间戳）').length === 2,
    p.lines.filter((l) => l.text === '副歌（两个时间戳）').length);
  check('无小数 / 冒号百分秒两种写法都认',
    p.lines.some((l) => l.text === '没有小数的时间戳' && l.time === 20.5) &&
    p.lines.some((l) => l.text === '冒号百分秒' && l.time === 31), JSON.stringify(p.lines.map((l) => [l.time, l.text])));
  check('按时间排序', p.lines.every((l, i) => i === 0 || (p.lines[i - 1].time ?? -1) <= (l.time ?? -1)),
    JSON.stringify(p.lines.map((l) => l.time)));
  check('synced 判定为真', p.synced === true, p.synced);
}

{
  const plain = '第一段\n第二段\n第三段';
  const p = lyrics.parseLrc(plain);
  check('纯文本歌词：无时间轴，行序保留',
    p.synced === false && p.lines.length === 3 && p.lines[0].text === '第一段', JSON.stringify(p.lines));
  check('空文本不报错', (() => {
    const e = lyrics.parseLrc('');
    return e.lines.length === 0 && e.synced === false;
  })(), '');
}


{
  check('从 tags 里挑歌词（键名含 lyric，大小写不敏感）',
    lyrics.lyricsFromTags({ TITLE: 'x', UNSYNCEDLYRICS: '[00:01.00]你好' }) === '[00:01.00]你好', '');
  check('没有歌词标签时返回 null',
    lyrics.lyricsFromTags({ title: 'x', artist: 'y' }) === null, '');
}


const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'lyrics-test-'));
try {
  const audio = path.join(tmp, 'Hotel California.flac');
  await fsp.writeFile(audio, Buffer.from('fake'));
  const track = { path: audio, name: 'Hotel California.flac', title: 'Hotel California', artist: 'Eagles' };

  check('没有 .lrc 时 found=false', lyrics.resolveLyrics(track).found === false, '');

  
  const same = path.join(tmp, 'Hotel California.lrc');
  await fsp.writeFile(same, '[00:01.00]同名歌词', 'utf8');
  let res = lyrics.resolveLyrics(track);
  check('同目录同名 .lrc 会被找到', res.found && res.source === 'file' && res.file === same, res.file);
  check('内容解析正确', res.lines[0].text === '同名歌词', JSON.stringify(res.lines));

  
  fs.rmSync(same);
  await fsp.writeFile(path.join(tmp, 'hotel california.LRC'), '[00:02.00]大写扩展名', 'utf8');
  res = lyrics.resolveLyrics(track);
  check('扩展名大小写不敏感（.LRC 也认作同一文件）', res.found && /hotel california\.lrc$/i.test(res.file), res.file);

  
  const withTag = { ...track, lyricsTag: '[00:03.00]元数据里的歌词' };
  res = lyrics.resolveLyrics(withTag);
  check('元数据里有歌词时优先用它', res.found && res.source === 'metadata' && res.lines[0].text === '元数据里的歌词',
    `${res.source} / ${res.lines[0].text}`);

  
  fs.rmSync(path.join(tmp, 'hotel california.LRC'));
  await fsp.writeFile(path.join(tmp, 'Eagles - Hotel California.lrc'), '[00:04.00]按艺人标题匹配', 'utf8');
  res = lyrics.resolveLyrics(track);
  check('同名找不到时退回「艺术家 - 标题.lrc」', res.found && /Eagles - Hotel California\.lrc$/.test(res.file),
    res.file);

  check('空的 .lrc 视为没有歌词', (() => {
    fs.writeFileSync(path.join(tmp, 'Eagles - Hotel California.lrc'), '   \n  ');
    return lyrics.resolveLyrics(track).found === false;
  })(), '');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}


{
  const lines = [{ time: 1, text: 'a' }, { time: 5, text: 'b' }, { time: 12, text: 'c' }];
  check('0.5s → 还没到第一行', lyrics.activeLineIndex(lines, 0.5) === -1, lyrics.activeLineIndex(lines, 0.5));
  check('5s → 第二行', lyrics.activeLineIndex(lines, 5) === 1, lyrics.activeLineIndex(lines, 5));
  check('30s → 最后一行', lyrics.activeLineIndex(lines, 30) === 2, lyrics.activeLineIndex(lines, 30));
  check('静态歌词（无时间轴）返回 -1',
    lyrics.activeLineIndex([{ time: null, text: 'x' }], 100) === -1, '');
}


{
  
  const tmp2 = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'artifacts', '_lyrics-tag');
  fs.rmSync(tmp2, { recursive: true, force: true });
  fs.mkdirSync(tmp2, { recursive: true });
  try {
    const ff = await ffmpegMod.resolveTools();
    if (!ff || !ff.ffmpeg) {
      check('ffmpeg 可用（跳过内嵌歌词实测）', true, '未检测到 ffmpeg，跳过');
    } else {
      const wav = path.join(tmp2, 'tag.wav');
      const flac = path.join(tmp2, 'tag.flac');
      const gen = spawnSync(ff.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', wav], { encoding: 'utf8' });
      check('生成测试音频', gen.status === 0, gen.stderr && gen.stderr.slice(0, 120));

      const tagged = spawnSync(ff.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', wav,
        '-metadata', 'title=Tagged Song', '-metadata', 'artist=Tagged Artist',
        '-metadata', 'lyrics=[00:01.00]内嵌第一句\n[00:03.50]内嵌第二句',
        '-c:a', 'flac', flac], { encoding: 'utf8' });
      check('把歌词写进 FLAC 元数据', tagged.status === 0, tagged.stderr && tagged.stderr.slice(0, 160));

      if (tagged.status === 0) {
        const probe = await ffmpegMod.probeFile(flac, ff);
        check('ffprobe 读回内嵌歌词（lyricsTag）',
          typeof probe.lyricsTag === 'string' && /内嵌第一句/.test(probe.lyricsTag),
          JSON.stringify(probe.lyricsTag || null).slice(0, 80));
        const res = lyrics.resolveLyrics({
          path: flac, name: 'tag.flac', title: probe.title, artist: probe.artist, lyricsTag: probe.lyricsTag,
        });
        check('内嵌歌词被解析成两行', res.found && res.source === 'metadata' && res.lines.length === 2,
          `${res.source} / ${res.lines && res.lines.length}`);
        check('内嵌歌词的时间轴正确', res.lines[0].time === 1 && res.lines[1].time === 3.5,
          JSON.stringify(res.lines.map((l) => l.time)));
      }
    }
  } finally {
    fs.rmSync(tmp2, { recursive: true, force: true });
  }
}


{
  const lrc = [
    '本歌词由某某网站提供',
    '演唱：某人',
    '',
    '[00:01.00]第一句',
    '翻译：无时间轴的内插行',
    '[00:05.00]第二句',
  ].join('\n');
  const p = lyrics.parseLrc(lrc);
  check('歌词起始之前的非时间轴行被直接跳过',
    p.lines.length === 3 && p.lines[0].text === '第一句' && p.lines[0].time === 1,
    JSON.stringify(p.lines.map((l) => [l.time, l.text])));
  check('正文中间的无时间轴行沿用上一行时间（不会被漏掉）',
    p.lines[1].text.startsWith('翻译') && p.lines[1].time === 1,
    JSON.stringify(p.lines.map((l) => [l.time, l.text])));
  check('跳过后仍然 synced 且时间单调不减',
    p.synced === true && p.lines.every((l, i) => i === 0 || p.lines[i - 1].time <= l.time), '');

  
  const plain = lyrics.parseLrc('第一段\n第二段\n第三段');
  check('纯文本歌词不会被"跳过"规则清空', plain.lines.length === 3 && plain.synced === false,
    JSON.stringify(plain.lines));

  
  const big = Array.from({ length: 5000 }, (_, i) => `[${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.00]第 ${i} 句`).join('\n');
  const t0 = process.hrtime.bigint();
  const parsed = lyrics.parseLrc(big);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  check('解析是同步的、没有额外延迟（5000 行 < 100ms）',
    parsed.lines.length === 5000 && ms < 100, `${ms.toFixed(1)}ms / ${parsed.lines.length} 行`);
}


{
  const dir = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'artifacts', '_lyrics-save');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  try {
    const audio = path.join(dir, 'song.flac');
    fs.writeFileSync(audio, 'fake');
    const track = { path: audio, name: 'song.flac', title: 'song' };

    const target = lyrics.lrcPathFor(track);
    check('没有 .lrc 时落点是同目录同名 .lrc', target === path.join(dir, 'song.lrc'), target);

    const saved = lyrics.saveLyrics(target, '[00:03.00]写进去的歌词\n');
    check('保存成功并真的落盘', saved.ok && fs.readFileSync(target, 'utf8').includes('写进去的歌词'), JSON.stringify(saved));

    const re = lyrics.resolveLyrics(track);
    check('保存后立刻能被查到（直接应用的前提）',
      re.found && re.source === 'file' && re.lines[0].text === '写进去的歌词' && re.lines[0].time === 3,
      `${re.source} / ${re.lines && re.lines[0] && re.lines[0].text}`);

    const bad = lyrics.saveLyrics(path.join(dir, 'no-such-dir\u0000x.lrc'), 'x');
    check('写不进去时返回 ok=false + 可读原因（用于右下角提示）',
      bad.ok === false && typeof bad.error === 'string' && bad.error.length > 0, JSON.stringify(bad));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;
console.log(`\n=== 歌词内核: ${passed}/${results.length} 通过${failed ? `（${failed} 失败）` : ''} ===`);
process.exit(failed ? 1 : 0);
