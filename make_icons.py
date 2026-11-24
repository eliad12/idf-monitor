# Draws the app icon (radar on deep green). Run once: python make_icons.py
from PIL import Image, ImageDraw

S = 2048  # draw big, scale down for smooth edges


def icon(pad=0.0, rounded=True):
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    # vertical gradient background
    bg = Image.new("RGBA", (S, S))
    top, bot = (59, 107, 80), (22, 38, 29)
    px = bg.load()
    for y in range(S):
        t = y / (S - 1)
        c = tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)) + (255,)
        for x in range(S):
            px[x, y] = c
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22) if rounded else 0, fill=255)
    img.paste(bg, (0, 0), mask)

    overlay = Image.new("RGBA", (S, S), (0, 0, 0, 0))  # translucent shapes blend only via a separate layer
    d = ImageDraw.Draw(overlay)
    cx, cy = S / 2, S / 2
    R = S * (0.36 - pad * 0.5)
    # sweep wedge
    d.pieslice([cx - R, cy - R, cx + R, cy + R], start=-90, end=-35, fill=(232, 185, 58, 90))
    # rings
    for k, a in ((1.0, 210), (0.68, 170), (0.36, 140)):
        r = R * k
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(255, 255, 255, a), width=int(S * 0.018))
    # cross hairs
    w = int(S * 0.008)
    d.line([cx - R, cy, cx + R, cy], fill=(255, 255, 255, 70), width=w)
    d.line([cx, cy - R, cx, cy + R], fill=(255, 255, 255, 70), width=w)
    # sweep line
    import math
    ang = math.radians(-35)
    d.line([cx, cy, cx + R * math.cos(ang), cy + R * math.sin(ang)], fill=(232, 185, 58, 255), width=int(S * 0.02))
    # blips
    for bx, by, br in ((0.20, -0.17, 0.045), (-0.16, 0.12, 0.03), (0.07, 0.23, 0.025)):
        x, y, r = cx + S * bx * (1 - pad), cy + S * by * (1 - pad), S * br
        d.ellipse([x - r * 1.9, y - r * 1.9, x + r * 1.9, y + r * 1.9], fill=(232, 185, 58, 60))
        d.ellipse([x - r, y - r, x + r, y + r], fill=(245, 200, 80, 255))
    r = S * 0.03
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 255, 255, 255))
    img = Image.alpha_composite(img, overlay)
    img.putalpha(mask)
    return img


base = icon()
for size, name in ((192, "icon-192.png"), (512, "icon-512.png")):
    base.resize((size, size), Image.LANCZOS).save(name)
# iOS adds its own rounded corners and dislikes transparency
icon(rounded=False).resize((180, 180), Image.LANCZOS).convert("RGB").save("apple-touch-icon.png")
# Android "maskable": full-bleed background, artwork inside the safe zone
icon(pad=0.18, rounded=False).resize((512, 512), Image.LANCZOS).save("icon-maskable-512.png")
print("icons written")
