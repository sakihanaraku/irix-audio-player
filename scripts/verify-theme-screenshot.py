"""采样 ui-theme.png 的关键像素，验证自定义主题色在真实渲染中生效（开发用工具）。

用法:
  python scripts/verify-theme-screenshot.py [截图路径]
"""
import sys
from PIL import Image

path = sys.argv[1] if len(sys.argv) > 1 else \
    r"test\artifacts\ui-theme.png"
img = Image.open(path).convert("RGB")
W, H = img.size
print(f"image: {W}x{H}  ({path})")


def avg(cx, cy, r=3):
    px = [img.getpixel((x, y)) for x in range(cx - r, cx + r + 1) for y in range(cy - r, cy + r + 1)]
    return tuple(sum(c[i] for c in px) // len(px) for i in range(3))


def name(rgb):
    r, g, b = rgb
    if g > r + 25 and g > b + 15:
        return "GREEN"
    if r > 90 and b > 150 and b > g:
        return "PURPLE"
    if b > r and b > g:
        return "BLUE"
    return "OTHER"


points = {
    "logo": (32, 21),
    "play-button": (113, 267),
    "volume-slider": (440, 267),
    "status-dot": (12, 706),
    "titlebar-icon": (996, 21),
}
bad = []
for label, (x, y) in points.items():
    rgb = avg(x, y)
    kind = name(rgb)
    print(f"  {label:16s} ({x:4d},{y:3d}) rgb={rgb} -> {kind}")
    if kind == "GREEN":
        bad.append(label)

print()
if bad:
    print("FAIL: still green (theme color not applied): " + ", ".join(bad))
    sys.exit(1)
print("OK: all accent elements follow the custom theme color")
