












import sys
import numpy as np
from PIL import Image

try:                                   
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass


def hex_to_rgb(text):
    t = text.strip().lstrip('#')
    return tuple(int(t[i:i + 2], 16) for i in (0, 2, 4))


def main():
    if len(sys.argv) < 2:
        print('需要截图路径')
        return 2
    accent = hex_to_rgb(sys.argv[2] if len(sys.argv) > 2 else '#35d07f')
    a = np.array(Image.open(sys.argv[1]).convert('RGB')).astype(int)
    tb = a[0:48, :]

    
    white = (tb[:, :, 0] > 200) & (tb[:, :, 1] > 200) & (tb[:, :, 2] > 200)
    name_cols = np.where(white.any(axis=0))[0]
    wys = np.where(white[:, 60:180].any(axis=1))[0]
    if not len(name_cols) or not len(wys):
        print('✗ 没检测到软件名字形')
        return 1
    glyph_top, glyph_bottom = int(wys.min()), int(wys.max())
    cap_bottom = glyph_bottom - (3 if glyph_bottom - glyph_top > 10 else 0)
    cap_center = (glyph_top + cap_bottom) / 2
    full_center = (glyph_top + glyph_bottom) / 2

    
    x_start = int(name_cols.max()) + 4
    x_end = min(tb.shape[1], x_start + 120)
    dist = np.abs(tb - np.array(accent)).sum(axis=2)
    exact = dist <= 60
    sub = exact[:, x_start:x_end]
    cols = np.where(sub.any(axis=0))[0]
    if not len(cols):
        print(f'✗ 没检测到主题色 {sys.argv[2] if len(sys.argv) > 2 else "#35d07f"} 的徽标文字')
        return 1
    x0, x1 = int(cols.min()) + x_start, int(cols.max()) + x_start
    rows = np.where(exact[:, x0:x1 + 1].any(axis=1))[0]
    b_top, b_bottom = int(rows.min()), int(rows.max())
    badge_center = (b_top + b_bottom) / 2

    print(f'软件名字形 y={glyph_top}..{glyph_bottom}'
          f'（大写带中心 {cap_center:.1f}，整条带中心 {full_center:.1f}）')
    print(f'徽标文字   y={b_top}..{b_bottom}（中心 {badge_center:.1f}，x={x0}..{x1}）')
    d_cap = badge_center - cap_center
    d_full = badge_center - full_center
    print(f'徽标文字 vs 大写带中心 {d_cap:+.2f}px · vs 整条字形带中心 {d_full:+.2f}px')
    inside = glyph_top <= badge_center <= glyph_bottom
    near = min(abs(d_cap), abs(d_full)) <= 2.0
    ok = inside and near
    print('✓ 徽标与软件名文字对齐' if ok else '✗ 徽标偏离软件名文字')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
