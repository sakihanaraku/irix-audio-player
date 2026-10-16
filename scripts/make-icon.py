#!/usr/bin/env python

"""生成 Android Material 风格的应用图标（绿色为主）。

    build/icon.ico（多尺寸）+ build/icon.png（512）
    build/icons/*.png 由 scripts/make-linux-icons.py 从 icon.png 派生。

设计（按用户选定的方案）：
  · 浅绿瓷砖：Material Green 300 → Green 400 的竖向渐变，圆角方形；左上留白、右下留出空间
  · 瓷砖自带柔和落影（两层）+ 顶缘极淡高光
  · 白色 Material「music_note」音符（连通多边形 + 圆符头，直角，无缺口）
  · 音符向右下投出**一整条长斜影**（沿对角连续铺开取并集，再轻微模糊，裁剪在瓷砖内）

用法: python scripts/make-icon.py
"""
import os
from PIL import Image, ImageDraw, ImageFilter, ImageChops

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, "build")
os.makedirs(BUILD, exist_ok=True)

S = 1024                                 
TILE = (0.045, 0.035, 0.905, 0.895)      
SHAPE = "circle"                         
CORNER = 0.235                           
GREEN_TOP = (0x4C, 0xAF, 0x50)           
GREEN_BOT = (0x43, 0xA0, 0x47)           
SHADOW_TINT = (0x2E, 0x6E, 0x33)         
NOTE_RATIO = 0.46                        

CAST_DX, CAST_DY = 0.470, 0.570
CAST_ALPHA = 0.48
CAST_BLUR = 0.005
CAST_STEPS = 80


def shape_mask(size: int) -> Image.Image:
    """图形轮廓：圆形（默认）或圆角方形"""
    x0, y0, x1, y1 = [int(v * size) for v in TILE]
    w, h = x1 - x0, y1 - y0
    m = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(m)
    if SHAPE == "circle":
        d.ellipse([0, 0, w - 1, h - 1], fill=255)
    else:
        d.rounded_rectangle([0, 0, w - 1, h - 1], radius=int(min(w, h) * CORNER), fill=255)
    full = Image.new("L", (size, size), 0)
    full.paste(m, (x0, y0))
    return full


def rounded_mask(size: int) -> Image.Image:      
    return shape_mask(size)


def tile_layer(size: int) -> Image.Image:
    """浅绿瓷砖：竖向渐变 + 圆角 + 顶缘极淡高光"""
    x0, y0, x1, y1 = [int(v * size) for v in TILE]
    w, h = x1 - x0, y1 - y0
    grad = Image.new("RGBA", (w, h))
    px = grad.load()
    for y in range(h):
        t = y / float(h - 1)
        row = tuple(int(GREEN_TOP[i] + (GREEN_BOT[i] - GREEN_TOP[i]) * t) for i in range(3)) + (255,)
        for x in range(w):
            px[x, y] = row
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(grad, (x0, y0), shape_mask(size).crop((x0, y0, x1, y1)))
    
    return out


def note_layer(size: int) -> Image.Image:
    """白色 Material music_note：符干+符尾是**一个连通多边形**（直角），符头是圆。
    参照 24dp 网格：M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z
    （拆成两个圆角矩形会在交接处留缺口 —— 踩过）"""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    white = (255, 255, 255, 255)
    bw = (TILE[2] - TILE[0]) * size
    bh = (TILE[3] - TILE[1]) * size
    scale = bh * NOTE_RATIO / 18.5       
    gw = 12.6 * scale
    cx0 = TILE[0] * size + bw / 2.0
    cy0 = TILE[1] * size + bh / 2.0
    ox = cx0 - gw / 2.0 - 6.0 * scale
    oy = cy0 - 18.5 * scale / 2.0 - 3.0 * scale

    def pt(x, y):
        return (ox + x * scale, oy + y * scale)

    d.polygon([pt(12, 3), pt(18.6, 3), pt(18.6, 7.2), pt(14.4, 7.2), pt(14.4, 17), pt(12, 17)], fill=white)
    cx, cy, r = pt(10, 17.5)[0], pt(10, 17.5)[1], 4.4 * scale
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=white)
    return img


def long_cast_shadow(note: Image.Image, size: int) -> Image.Image:
    """沿右下方向连续铺开音符轮廓（取并集）→ 一整条长斜影，轻微模糊"""
    sil = Image.new("L", (size, size), 0)
    sil.paste(255, (0, 0), note.split()[3])
    band = Image.new("L", (size, size), 0)
    for i in range(CAST_STEPS + 1):
        t = i / float(CAST_STEPS)
        shifted = sil.transform(sil.size, Image.AFFINE,
                                (1, 0, -CAST_DX * size * t, 0, 1, -CAST_DY * size * t),
                                resample=Image.BILINEAR)
        band = ImageChops.lighter(band, shifted)
    band = band.filter(ImageFilter.GaussianBlur(max(1.0, size * CAST_BLUR)))
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(Image.new("RGBA", (size, size), SHADOW_TINT + (int(255 * CAST_ALPHA),)), (0, 0), band)
    return out


def render(size: int) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    tile = tile_layer(size)
    tm = Image.new("L", (size, size), 0)
    tm.paste(255, (0, 0), tile.split()[3])
    
    for dx, dy, blur, alpha in ((0.020, 0.026, 0.030, 0.26), (0.008, 0.010, 0.012, 0.18)):
        sh = Image.new("RGBA", (size, size), (0, 0, 0, int(255 * alpha)))
        sh.putalpha(ImageChops.multiply(sh.split()[3], tm))
        sh = sh.filter(ImageFilter.GaussianBlur(max(1.0, size * blur)))
        sh = sh.transform(sh.size, Image.AFFINE, (1, 0, -dx * size, 0, 1, -dy * size), resample=Image.BICUBIC)
        canvas.alpha_composite(sh)
    canvas.alpha_composite(tile)
    note = note_layer(size)
    
    clipped = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    clipped.paste(long_cast_shadow(note, size), (0, 0), tile.split()[3])
    canvas.alpha_composite(clipped)
    canvas.alpha_composite(note)
    return canvas


def main():
    icon = render(S)
    icon.resize((512, 512), Image.LANCZOS).save(os.path.join(BUILD, "icon.png"))

    sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)]
    frames = [icon.resize(s, Image.LANCZOS) for s in sizes]
    ico = os.path.join(BUILD, "icon.ico")
    frames[0].save(ico, format="ICO", sizes=sizes, append_images=frames[1:])
    print("已生成:", ico, os.path.getsize(ico), "bytes")
    print("已生成:", os.path.join(BUILD, "icon.png"))


if __name__ == "__main__":
    main()
