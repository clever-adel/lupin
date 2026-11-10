"""Derive web assets from the supplied master logo WITHOUT redrawing anything.

Only two operations are applied to the original pixels:
  1. background removal: alpha = brightness relative to the artwork colour, colour = artwork colour.
     Composited back onto black this reproduces the original image.
  2. rectangular crops (whole lockup, L mark, wordmark row).
"""
import sys
sys.path.insert(0, sys.argv[1])
import pymupdf

src, out = sys.argv[2], sys.argv[3]
pix = pymupdf.Pixmap(src)
if pix.alpha:
    pix = pymupdf.Pixmap(pix, 0)
if pix.n != 3:
    pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
w, h, s = pix.width, pix.height, pix.samples
print("size", w, h, "corner", tuple(s[0:3]), "n", pix.n)

r, g, b = s[0::3], s[1::3], s[2::3]
lum = bytes(map(max, r, g, b))
peak = max(lum)
# artwork colour = most common fully-lit pixel
from collections import Counter
art = Counter((r[i], g[i], b[i]) for i in range(0, w * h, 7) if lum[i] >= peak - 2).most_common(1)[0][0]
print("artwork colour", art, "peak", peak)
bg = max(s[0:3])
scale = 255.0 / (peak - bg)
print("background noise: pixels with brightness 1..6 =", sum(1 for v in lum[::5] if 0 < v <= 6) * 5)
# brightness <= 6/255 is compression noise in the black background, not artwork
alpha = bytes(0 if v <= 6 else min(255, round((v - bg) * scale)) for v in lum)

stray = [x for x in range(w) if alpha[x] and alpha[(h - 1) * w + x]]
print("stray columns present in the first and last (empty) rows:", stray, [alpha[x] for x in stray])
if stray:
    al = bytearray(alpha)
    for x in stray:
        al[x::w] = bytes(h)
    alpha = bytes(al)
rowsum = [sum(alpha[y * w:(y + 1) * w]) for y in range(h)]
print("rowsum samples", [(y, rowsum[y]) for y in range(0, h, 60)])
rows = [v > 255 * 3 for v in rowsum]
runs, start = [], None
for y, on in enumerate(rows + [False]):
    if on and start is None:
        start = y
    elif not on and start is not None:
        runs.append((start, y)); start = None
merged = []
for a, bnd in runs:
    if merged and a - merged[-1][1] < 24:
        merged[-1] = (merged[-1][0], bnd)
    else:
        merged.append((a, bnd))
print("row bands", merged)

def xbounds(y0, y1):
    cols = [False] * w
    for y in range(y0, y1):
        row = alpha[y * w:(y + 1) * w]
        for x in range(w):
            if row[x]:
                cols[x] = True
    xs = [x for x, on in enumerate(cols) if on]
    return xs[0], xs[-1] + 1

def save(name, x0, y0, x1, y1, pad):
    x0, y0, x1, y1 = max(0, x0 - pad), max(0, y0 - pad), min(w, x1 + pad), min(h, y1 + pad)
    cw, ch = x1 - x0, y1 - y0
    buf = bytearray(cw * ch * 4)
    for y in range(ch):
        a = alpha[(y0 + y) * w + x0:(y0 + y) * w + x1]
        base = y * cw * 4
        buf[base + 0:base + cw * 4:4] = bytes([art[0]]) * cw
        buf[base + 1:base + cw * 4:4] = bytes([art[1]]) * cw
        buf[base + 2:base + cw * 4:4] = bytes([art[2]]) * cw
        buf[base + 3:base + cw * 4:4] = a
    p = pymupdf.Pixmap(pymupdf.csRGB, cw, ch, bytes(buf), True)
    p.save(f"{out}/{name}")
    print(name, cw, ch)
    return p

mark, word = merged[0], merged[1]
fx0, fx1 = xbounds(merged[0][0], merged[-1][1])
save("lupin-logo.png", fx0, merged[0][0], fx1, merged[-1][1], 24)
mx0, mx1 = xbounds(*mark)
mp = save("lupin-mark.png", mx0, mark[0], mx1, mark[1], 8)
wx0, wx1 = xbounds(*word)
save("lupin-wordmark.png", wx0, word[0], wx1, word[1], 8)

# App icon exactly as on PDF page 4: the L mark centred on a brand-black square.
size = 512
icon = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, size, size), False)
icon.set_rect(icon.irect, (11, 11, 12))
k = (size * 0.56) / max(mp.width, mp.height)
tw, th = round(mp.width * k), round(mp.height * k)
small = pymupdf.Pixmap(mp, tw, th)  # scaled copy
ox, oy = (size - tw) // 2, (size - th) // 2
sa = small.samples
for y in range(th):
    for x in range(tw):
        a = sa[(y * tw + x) * 4 + 3]
        if a:
            f = a / 255.0
            icon.set_pixel(ox + x, oy + y, tuple(round(11 + (art[c] - (11, 11, 12)[c]) * f) if c < 2 else round(12 + (art[2] - 12) * f) for c in range(3)))
icon.save(f"{out}/app-icon-512.png")
pymupdf.Pixmap(icon, 180, 180).save(f"{out}/apple-touch-icon.png")
pymupdf.Pixmap(icon, 48, 48).save(f"{out}/favicon.png")

# Verification sheet: derived assets composited on brand black, to compare with the original by eye.
sheet = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 1400, 700), False)
sheet.set_rect(sheet.irect, (11, 11, 12))
def paste(p, ox, oy, maxw):
    k = min(1.0, maxw / p.width)
    q = pymupdf.Pixmap(p, round(p.width * k), round(p.height * k)) if k < 1 else p
    d = q.samples
    for y in range(q.height):
        for x in range(q.width):
            a = d[(y * q.width + x) * 4 + 3]
            if a:
                f = a / 255.0
                sheet.set_pixel(ox + x, oy + y, tuple(round(bgc + (art[c] - bgc) * f) for c, bgc in enumerate((11, 11, 12))))
paste(pymupdf.Pixmap(f"{out}/lupin-logo.png"), 40, 40, 620)
paste(pymupdf.Pixmap(f"{out}/lupin-mark.png"), 760, 60, 140)
paste(pymupdf.Pixmap(f"{out}/lupin-wordmark.png"), 760, 260, 600)
sheet.save(sys.argv[4])
print("ok")
