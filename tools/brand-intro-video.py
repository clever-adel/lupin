"""LUPIN brand introduction video — "THE NAME IS LUPIN."

30 s, 1080x1920 (9:16), 30 fps, H.264 + AAC, for Reels / TikTok / Shorts.
Built only from real LUPIN material in this repo: product photos (demo/public/products),
the logo (demo/public/brand), the site walkthrough (brand-assets/video/lupin-site-demo.mp4)
and the packaging artwork (brand-assets/packaging/bag-mockup.png). Nothing is generated or invented.

    python -m pip install pillow imageio-ffmpeg
    python tools/brand-intro-video.py            # -> brand-assets/video/lupin-brand-intro.mp4
"""
import functools
import os
import random
import shutil
import subprocess
import sys
import tempfile

import imageio_ffmpeg
from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = lambda *a: os.path.join(ROOT, *a)
W, H, FPS, DUR = 1080, 1920, 30, 30
N = FPS * DUR
OUT = P("brand-assets", "video", "lupin-brand-intro.mp4")
FF = imageio_ffmpeg.get_ffmpeg_exe()

BLACK = (8, 8, 9)
OFF = (236, 233, 226)
BEIGE = (216, 200, 176)
GOLD = (168, 139, 74)
BROWN = (43, 30, 22)
FONT = P("demo", "node_modules", "@fontsource", "michroma", "files", "michroma-latin-400-normal.woff")
random.seed(7)


# ---------- timing helpers ----------
def clamp(x, a=0.0, b=1.0):
    return max(a, min(b, x))


def ease(x):
    x = clamp(x)
    return x * x * (3 - 2 * x)


def eout(x):
    x = clamp(x)
    return 1 - (1 - x) ** 3


def env(t, a, b, fi=0.5, fo=0.5):
    """0 -> 1 from a over fi seconds, 1 -> 0 ending at b over fo seconds."""
    return ease((t - a) / fi) * (1 - ease((t - (b - fo)) / fo))


def lerp(a, b, x):
    return a + (b - a) * x


# ---------- image helpers ----------
def product(name):
    return Image.open(P("demo", "public", "products", name)).convert("RGB")


def cover(img, scale=1.0, fx=0.5, fy=0.5, size=(W, H)):
    """Crop-zoom img to fill size; scale > 1 pushes in; (fx, fy) is the focus point."""
    w, h = size
    iw, ih = img.size
    s = max(w / iw, h / ih) * scale
    cw, ch = w / s, h / s
    l = clamp(fx * iw - cw / 2, 0, iw - cw)
    t = clamp(fy * ih - ch / 2, 0, ih - ch)
    return img.resize(size, Image.BILINEAR, box=(l, t, l + cw, t + ch))


@functools.lru_cache(maxsize=None)
def radial(cx, cy, r0, r1, inner=255, outer=0, size=(W, H)):
    """Soft radial mask (L). r0/r1 are fractions of the frame width."""
    sw, sh = size[0] // 10, size[1] // 10
    m = Image.new("L", (sw, sh))
    px = m.load()
    for y in range(sh):
        for x in range(sw):
            d = (((x / sw - cx) ** 2) + ((y / sw - cy * sh / sw) ** 2)) ** 0.5
            k = ease((d - r0) / max(1e-6, r1 - r0))
            px[x, y] = int(lerp(inner, outer, k))
    return m.resize(size, Image.BICUBIC)


def vgrad(top, bottom, size=(W, H)):
    """Vertical L gradient from top value to bottom value."""
    g = Image.new("L", (1, 256))
    for y in range(256):
        g.putpixel((0, y), int(lerp(top, bottom, y / 255)))
    return g.resize(size, Image.BICUBIC)


def solid(c):
    return Image.new("RGB", (W, H), c)


def darken(frame, mask_l):
    """Keep frame where mask is white, black where mask is black."""
    return Image.composite(frame, solid(BLACK), mask_l)


def tritone(img, dark, mid, light, contrast=1.3):
    g = ImageEnhance.Contrast(ImageOps.grayscale(img)).enhance(contrast)
    return ImageOps.colorize(g, dark, light, mid=mid)


def grade(img, bright=0.84, contrast=1.14, color=0.86):
    img = ImageEnhance.Brightness(img).enhance(bright)
    img = ImageEnhance.Contrast(img).enhance(contrast)
    img = ImageEnhance.Color(img).enhance(color)
    return ImageChops.multiply(img, Image.new("RGB", img.size, (250, 242, 232)))


def with_alpha(rgba, a):
    if a >= 0.999:
        return rgba
    out = rgba.copy()
    out.putalpha(rgba.getchannel("A").point(lambda v: int(v * a)))
    return out


def place(frame, rgba, cx, cy, a=1.0):
    if a <= 0.003:
        return
    layer = with_alpha(rgba, a)
    frame.paste(layer, (int(cx - layer.width / 2), int(cy - layer.height / 2)), layer)


def text(s, size, color=OFF, tracking=0.22):
    f = ImageFont.truetype(FONT, size)
    tr = size * tracking
    widths = [f.getlength(c) for c in s]
    w = int(sum(widths) + tr * (len(s) - 1)) + 8
    asc, desc = f.getmetrics()
    img = Image.new("RGBA", (w, asc + desc + 8), color + (0,))
    d = ImageDraw.Draw(img)
    x = 4
    for c, cw in zip(s, widths):
        d.text((x, 4), c, font=f, fill=color + (255,))
        x += cw + tr
    return img


def lines(rows, size, color=OFF, tracking=0.22, gap=0.55):
    imgs = [text(r, size, color, tracking) for r in rows]
    w = max(i.width for i in imgs)
    h = sum(i.height for i in imgs) + int(size * gap) * (len(imgs) - 1)
    out = Image.new("RGBA", (w, h), color + (0,))
    y = 0
    for i in imgs:
        out.paste(i, ((w - i.width) // 2, y), i)
        y += i.height + int(size * gap)
    return out


def headline(frame, rgba, cx, cy, t, a, b):
    """Text reveal: fade + 24px rise in, fade out."""
    k = env(t, a, b, 0.7, 0.45)
    place(frame, rgba, cx, cy + 24 * (1 - eout((t - a) / 0.9)), k)


def scale_rgba(rgba, s):
    return rgba.resize((max(1, int(rgba.width * s)), max(1, int(rgba.height * s))), Image.LANCZOS)


# ---------- light & texture layers (precomputed) ----------
BAND = Image.new("L", (W * 3, H))
ImageDraw.Draw(BAND).polygon([(W * 1.5 - 90, 0), (W * 1.5 + 90, 0), (W * 1.5 - 260, H), (W * 1.5 - 440, H)], fill=255)
BAND = BAND.filter(ImageFilter.GaussianBlur(70))


def sweep_crop(pos, box):
    """Band position pos in [0,1] travels left -> right across the frame; returns crop for box (x, y, w, h)."""
    x, y, w, h = box
    off = int(lerp(W * 2.4, 0, pos))  # band centre at 1.5W in BAND
    return BAND.crop((off + x, y, off + x + w, y + h))


def glint(frame, rgba, cx, cy, pos, strength=0.85):
    """Light passing over a logo: brightens only its own pixels."""
    if not 0 < pos < 1:
        return
    x, y = int(cx - rgba.width / 2), int(cy - rgba.height / 2)
    band = sweep_crop(pos, (x, y, rgba.width, rgba.height))
    m = ImageChops.multiply(band, rgba.getchannel("A")).point(lambda v: int(v * strength))
    frame.paste(Image.new("RGB", rgba.size, (255, 250, 240)), (x, y), m)


def soft_sweep(frame, pos, strength):
    if not 0 < pos < 1 or strength <= 0:
        return frame
    m = sweep_crop(pos, (0, 0, W, H)).point(lambda v: int(v * strength))
    return Image.composite(solid(BEIGE), frame, m)


BOKEH = Image.new("RGB", (1500, 2600), (0, 0, 0))
_d = ImageDraw.Draw(BOKEH)
for _ in range(70):
    r = random.randint(14, 70)
    x, y = random.randint(0, 1500), random.randint(0, 2600)
    c = random.choice([(150, 110, 60), (120, 90, 55), (60, 80, 115), (90, 95, 110), (160, 130, 85)])
    k = random.uniform(0.25, 0.9)
    _d.ellipse((x - r, y - r, x + r, y + r), fill=tuple(int(v * k) for v in c))
BOKEH = BOKEH.filter(ImageFilter.GaussianBlur(16))

GRAIN = [Image.effect_noise((W // 2, H // 2), 6).resize((W, H), Image.NEAREST).convert("RGB") for _ in range(6)]
VIG = radial(0.5, 0.5, 0.42, 1.05, 255, 90)
VIG_HARD = radial(0.5, 0.42, 0.18, 0.78, 255, 0)
BOTTOM = vgrad(255, 255).copy()
BOTTOM.paste(vgrad(255, 40, (W, H // 2)), (0, H // 2))
TOP = vgrad(70, 255, (W, H // 2))
TOPFULL = Image.new("L", (W, H), 255)
TOPFULL.paste(TOP, (0, 0))
GLOW_C = radial(0.5, 0.45, 0.0, 0.75, 255, 0)


def glow_bg(strength, cy=0.45, color=BROWN):
    m = radial(0.5, cy, 0.0, 0.75).point(lambda v: int(v * clamp(strength)))
    return Image.composite(solid(color), solid(BLACK), m)


# ---------- assets ----------
print("preparing assets ...")
S1 = tritone(product("alibi-5.webp"), (3, 3, 4), (30, 25, 22), (128, 118, 104), 1.55)

S2 = [  # (image, focus x, focus y, start scale, end scale)
    (grade(product("alibi-4.webp")), 0.5, 0.62, 1.04, 1.16),
    (grade(product("brooklyn-5.webp")), 0.5, 0.55, 1.12, 1.0),
    (grade(product("masterkey-3.webp")), 0.5, 0.52, 1.55, 1.7),
    (grade(product("alibi-6.webp")), 0.5, 0.42, 1.0, 1.07),
]

LOGO = Image.open(P("demo", "public", "brand", "lupin-logo.png")).convert("RGBA")
LOGO_TOP = LOGO.crop((0, 0, LOGO.width, 530))  # mark + LUPIN. wordmark, without the small tagline
LOGO_TOP = LOGO_TOP.crop(LOGO_TOP.getbbox())
MARK = Image.open(P("demo", "public", "brand", "lupin-mark.png")).convert("RGBA")
WORD = Image.open(P("demo", "public", "brand", "lupin-wordmark.png")).convert("RGBA")
MARK_S3 = scale_rgba(MARK, 470 / MARK.width)
WORD_S3 = scale_rgba(WORD, 720 / WORD.width)
WORD_SMALL = scale_rgba(WORD, 300 / WORD.width)
LOGO_S5 = scale_rgba(LOGO_TOP, 860 / LOGO_TOP.width)

PIECES = [
    ("alibi-1.webp", "THE ALIBI"),
    ("masterkey-2.webp", "THE MASTER KEY"),
    ("brooklyn-1.webp", "THE BROOKLYN JOB"),
    ("getaway-1.webp", "THE GETAWAY DRIVER"),
    ("stealth-1.webp", "THE STEALTH"),
]
CARD_W, CARD_H = 780, 975


def card(img):
    c = ImageEnhance.Brightness(img).enhance(0.93).resize((CARD_W, CARD_H), Image.LANCZOS)
    out = Image.new("RGBA", (CARD_W + 2, CARD_H + 2), BEIGE + (255,))
    out.paste(c, (1, 1))
    return out


CARDS = [(card(product(f)), text(f"OPERATION 0{i + 1}", 22, GOLD, 0.5), text(n, 44, OFF, 0.12)) for i, (f, n) in enumerate(PIECES)]

bag = Image.open(P("brand-assets", "packaging", "bag-mockup.png")).convert("RGB").crop((780, 200, 1460, 1040))
BAG = grade(bag, 0.9, 1.1, 0.9)
BAG_W, BAG_H = 900, int(900 * 840 / 680)

T1 = lines(["NOT JUST ANOTHER", "CLOTHING BRAND."], 50)
T2 = lines(["STYLE IS", "AN IDENTITY."], 64)
T3 = text("MEET LUPIN WEAR.", 44, BEIGE, 0.28)
T4 = lines(["DISCOVER", "YOUR NEXT LOOK."], 54)
T5 = text("STEAL THE LOOK.", 46, BEIGE, 0.3)
T5_URL = text("LUPINWEAR.STORE", 24, GOLD, 0.6)

tmp = tempfile.mkdtemp(prefix="lupin-intro-")
print("extracting site walkthrough frames ...")
subprocess.run([FF, "-hide_banner", "-loglevel", "error", "-ss", "3", "-t", "11", "-i",
                P("brand-assets", "video", "lupin-site-demo.mp4"), "-vf", "crop=700:1450:190:270,fps=30",
                os.path.join(tmp, "p%04d.png")], check=True)
PHONE = sorted(f for f in os.listdir(tmp) if f.endswith(".png"))
PHONE_H = 1280
PHONE_W = int(700 * PHONE_H / 1450)


def phone_frame(k):
    f = PHONE[int(clamp(k) * (len(PHONE) - 1))]
    return Image.open(os.path.join(tmp, f)).convert("RGB").resize((PHONE_W, PHONE_H), Image.LANCZOS)


# ---------- scenes ----------
def scene1(t):  # 0-5 The Mystery
    k = t / 5
    f = cover(S1, lerp(1.32, 1.48, ease(k)), 0.5, lerp(0.36, 0.33, k))
    off = int(lerp(0, 600, k))
    bok = BOKEH.crop((150, 300 + off, 150 + W, 300 + off + H))
    f = ImageChops.screen(f, bok)
    f = darken(f, VIG_HARD)
    f = soft_sweep(f, (t - 0.4) / 3.6, 0.10)
    f = darken(f, BOTTOM)
    headline(f, T1, W / 2, 1530, t, 1.1, 4.75)
    return f


def scene2(t):  # 5-10 The Identity
    lt = t - 5
    seg, xf = 1.25, 0.22
    i = min(int(lt // seg), 3)

    def shot(j, u):
        img, fx, fy, s0, s1 = S2[j]
        return cover(img, lerp(s0, s1, ease(u)), fx, fy)

    u = (lt - i * seg) / seg
    f = shot(i, u)
    if i < 3 and lt > (i + 1) * seg - xf:
        f = Image.blend(f, shot(i + 1, 0), ease((lt - ((i + 1) * seg - xf)) / xf))
    f = darken(f, VIG)
    f = darken(f, BOTTOM)
    headline(f, T2, W / 2, 1540, t, 5.45, 9.85)
    return f


def scene3(t):  # 10-17 The Brand
    if t < 12.9:
        f = glow_bg(0.85 * env(t, 10.0, 12.9, 0.8, 0.4))
        a = env(t, 10.15, 12.85, 0.7, 0.35)
        s = lerp(1.1, 1.0, eout((t - 10.15) / 1.4))
        m = scale_rgba(MARK_S3, s)
        place(f, m, W / 2, 800, a)
        glint(f, m, W / 2, 800, (t - 10.6) / 1.3)
        place(f, WORD_S3, W / 2, 1060 + 18 * (1 - eout((t - 10.7) / 0.9)), env(t, 10.7, 12.85, 0.7, 0.35))
        headline(f, T3, W / 2, 1290, t, 11.3, 12.85)
        return f
    lt = t - 12.9
    seg = 4.1 / 5
    i = min(int(lt // seg), 4)
    f = glow_bg(0.75 * ease(lt / 0.4), 0.44)
    place(f, WORD_SMALL, W / 2, 170, ease(lt / 0.5) * (1 - ease((t - 16.7) / 0.3)))
    for j in (i - 1, i):
        if j < 0:
            continue
        u = (lt - j * seg) / seg
        cimg, lab, name = CARDS[j]
        a_in = ease((lt - j * seg) / 0.12) if j > 0 else ease(lt / 0.35)
        a_out = 1 - ease((lt - ((j + 1) * seg - 0.12)) / 0.12) if j < 4 else 1 - ease((t - 16.7) / 0.3)
        a = a_in * a_out
        s = lerp(1.04, 1.0, eout(u * 1.3))
        place(f, scale_rgba(cimg, s), W / 2, 860, a)
        place(f, lab, W / 2, 1440, a)
        place(f, name, W / 2, 1520, a)
    return f


def scene4(t):  # 17-23 The Experience
    f = glow_bg(0.8 * ease((t - 17) / 0.4), 0.55)
    a_phone = ease((t - 17.0) / 0.35) * (1 - ease((t - 20.2) / 0.4))
    if a_phone > 0:
        ph = phone_frame((t - 17.0) / 3.55)
        s = lerp(1.0, 1.04, ease((t - 17) / 3.6))
        ph = ph.resize((int(PHONE_W * s), int(PHONE_H * s)), Image.BILINEAR).convert("RGBA")
        place(f, ph, W / 2, 1110, a_phone)
    a_bag = ease((t - 20.2) / 0.4) * (1 - ease((t - 22.75) / 0.25))
    if a_bag > 0:
        b = cover(BAG, lerp(1.0, 1.08, ease((t - 20.2) / 2.8)), 0.5, 0.5, (BAG_W, BAG_H)).convert("RGBA")
        place(f, b, W / 2, 1110, a_bag)
    f = darken(f, TOPFULL)
    headline(f, T4, W / 2, 300, t, 17.3, 22.85)
    return f


def scene5(t):  # 23-30 Final reveal
    bloom = env(t, 23.0, 30.0, 1.2, 0.6)
    breathe = 0.85 + 0.15 * ((t - 23) / 7)
    f = glow_bg(0.9 * bloom * breathe, 0.43)
    f = soft_sweep(f, (t - 23.1) / 2.6, 0.05 * bloom)
    end = 1 - ease((t - 29.35) / 0.65)
    s = lerp(1.07, 1.0, eout((t - 23.3) / 1.8))
    lg = scale_rgba(LOGO_S5, s)
    place(f, lg, W / 2, 820, ease((t - 23.3) / 1.0) * end)
    glint(f, lg, W / 2, 820, (t - 24.2) / 1.4)
    rule = clamp((t - 25.0) / 0.8)
    if rule > 0:
        rw = int(eout(rule) * 240)
        ImageDraw.Draw(f).rectangle((W / 2 - rw / 2, 1108, W / 2 + rw / 2, 1110), fill=tuple(int(c * end) for c in GOLD))
    headline(f, T5, W / 2, 1200, t, 25.4, 30.6)
    place(f, T5_URL, W / 2, 1300, ease((t - 26.4) / 0.8) * end)
    return f


def frame_at(n):
    t = n / FPS
    if t < 5:
        f = scene1(t)
    elif t < 10:
        f = scene2(t)
    elif t < 17:
        f = scene3(t)
    elif t < 23:
        f = scene4(t)
    else:
        f = scene5(t)
    # scene dips: short fades through black at each cut
    for c in (5, 10, 17, 23):
        d = abs(t - c)
        if d < 0.18:
            f = Image.blend(solid(BLACK), f, ease(d / 0.18))
    if t < 0.8:
        f = Image.blend(solid(BLACK), f, ease(t / 0.8))
    return ImageChops.add(f, GRAIN[n % len(GRAIN)], 1.0, -128)


# ---------- sound: low drone + soft hits on each cut, shimmer on the logo ----------
def hit(T, a):
    return f"{a}*(sin(2*PI*46*(t-{T}))+0.5*sin(2*PI*92*(t-{T})))*exp(-2.6*(t-{T}))*gte(t\\,{T})"


AUDIO = "+".join([
    "0.06*sin(2*PI*55*t)*(0.7+0.3*sin(2*PI*0.2*t))",
    "0.035*sin(2*PI*110.4*t)*(0.5+0.5*sin(2*PI*0.13*t))",
    "0.02*sin(2*PI*164.8*t)*(0.5+0.5*sin(2*PI*0.09*t+1))",
    hit(5, 0.22), hit(10, 0.26), hit(17, 0.22), hit(23, 0.42),
    "0.03*sin(2*PI*880*t)*exp(-0.9*(t-23.2))*gte(t\\,23.2)",
    "0.02*sin(2*PI*1318.5*t)*exp(-0.9*(t-23.5))*gte(t\\,23.5)",
])


def main():
    stills = "--stills" in sys.argv
    if stills:
        for s in (2.5, 6.0, 8.6, 11.8, 14.0, 16.3, 18.8, 21.5, 26.0, 28.5):
            frame_at(int(s * FPS)).save(os.path.join(tmp, f"still-{s:04.1f}.png"))
        print(tmp)
        return
    cmd = [FF, "-hide_banner", "-loglevel", "error", "-y",
           "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
           "-f", "lavfi", "-i", f"aevalsrc='{AUDIO}':s=48000:d={DUR}",
           "-filter:a", "afade=t=in:d=0.8,afade=t=out:st=28.8:d=1.2,alimiter=limit=0.9",
           "-map", "0:v", "-map", "1:a", "-ac", "2",
           "-c:v", "libx264", "-preset", "slow", "-crf", "19", "-maxrate", "16M", "-bufsize", "32M", "-pix_fmt", "yuv420p", "-profile:v", "high",
           "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest", OUT]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for n in range(N):
        p.stdin.write(frame_at(n).tobytes())
        if n % 90 == 0:
            print(f"frame {n}/{N}", flush=True)
    p.stdin.close()
    if p.wait() != 0:
        sys.exit("ffmpeg failed")
    shutil.rmtree(tmp, ignore_errors=True)
    print("wrote", OUT)


if __name__ == "__main__":
    main()
