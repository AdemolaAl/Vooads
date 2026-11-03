#!/usr/bin/env python3
"""Builds the animated email headers in public/assets/img/email/ from our own Vooads videos (all AI presenters).

    python3 server/email/art/build-gifs.py [--src DIR] [--only name,name]

Needs ffmpeg and Pillow. Every GIF:
  * is cut from creator footage only (no end cards), 1.6-2.2 s, 12-14 fps;
  * loops seamlessly: the last frames cross-fade into the first, and the output starts on a clean frame, so Outlook
    (which shows only frame one) still gets a solid picture;
  * sits on the studio-navy panel colour, so it looks the same in light and dark mode;
  * is quantised with ffmpeg palettegen/paletteuse and kept under BUDGET bytes (fps and colours step down if needed).
Nothing here pulses or blinks: chips drift a couple of pixels on a slow sine, captions highlight word by word.
"""
import argparse, math, os, shutil, subprocess, sys, tempfile
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
OUT = os.path.join(ROOT, 'public', 'assets', 'img', 'email')
FONT = os.path.join(ROOT, 'public', 'assets', 'fonts', 'geist-latin.woff2')
NAVY = (10, 15, 31)          # --ink #0A0F1F, the header panel behind every GIF
BLUE = (30, 77, 255)         # #1E4DFF
WHITE = (255, 255, 255)
INK = (10, 15, 31)
GLASS = (21, 28, 51)         # chip fill on navy
GLASS_LINE = (44, 55, 92)
BUDGET = 350_000

def font(size, weight=600):
    f = ImageFont.truetype(FONT, size)
    try: f.set_variation_by_axes([weight])
    except Exception: pass
    return f

# ---------------------------------------------------------------- footage
def probe_size(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path], capture_output=True, text=True).stdout.strip()
    w, h = out.split(',')[:2]
    return int(w), int(h)

def footage(src, start, dur, size, fps, center=(0.5, 0.35), zoom=1.0, tmp=None, still=None):
    """Frames of a seamless loop: `dur` seconds at `fps`, cropped to `size` around `center` (0-1 of the source).
    zoom=1 uses the widest crop that fits; zoom=2 crops half as wide (closer on the face).
    still=(cx, cy, rx, ry): cinemagraph. Only a soft ellipse around the creator moves; the rest holds the first frame.
    Used on tripod shots, where it keeps the motion and cuts the file size by half."""
    W, H = size
    sw, sh = probe_size(src)
    aspect = W / H
    cw = min(sw, sh * aspect) / zoom
    ch = cw / aspect
    cx = min(max(center[0] * sw - cw / 2, 0), sw - cw)
    cy = min(max(center[1] * sh - ch / 2, 0), sh - ch)
    n = int(round(dur * fps))
    k = max(3, int(round(0.3 * fps)))     # cross-fade length
    d = os.path.join(tmp, 'f%d' % abs(hash((src, start, size, center, zoom))))
    os.makedirs(d, exist_ok=True)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(start), '-t', '%.3f' % ((n + k + 1) / fps), '-i', src,
                    '-vf', 'fps=%d,crop=%d:%d:%d:%d,scale=%d:%d:flags=lanczos,hqdn3d=1.5:1.5:14:14,eq=saturation=1.04:contrast=1.02' % (fps, cw, ch, cx, cy, W, H),
                    os.path.join(d, '%03d.png')], check=True)
    raw = [Image.open(os.path.join(d, f)).convert('RGB') for f in sorted(os.listdir(d))]
    if len(raw) < n + k: raise SystemExit('Not enough frames in %s at %s' % (src, start))
    loop = []
    for j in range(n):
        if j < k:  # tail (frames n..n+k) dissolves into the head (frames 0..k)
            a = (j + 1) / (k + 1)
            loop.append(Image.blend(raw[n + j], raw[j], a))
        else:
            loop.append(raw[j])
    # Start on a clean frame (Outlook shows frame one only).
    loop = loop[k:] + loop[:k]
    if still:
        sx, sy, rx, ry = still
        m = Image.new('L', (W, H), 0)
        ImageDraw.Draw(m).ellipse(((sx - rx) * W, (sy - ry) * H, (sx + rx) * W, (sy + ry) * H), fill=255)
        m = m.filter(ImageFilter.GaussianBlur(max(6, W * 0.035)))
        loop = [loop[0]] + [Image.composite(f, loop[0], m) for f in loop[1:]]
    return loop

# ---------------------------------------------------------------- drawing helpers (2x supersampled)
def rounded_mask(size, r, scale=4):
    W, H = size
    m = Image.new('L', (W * scale, H * scale), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, W * scale - 1, H * scale - 1), r * scale, fill=255)
    return m.resize(size, Image.LANCZOS)

def circle_mask(d, scale=4):
    m = Image.new('L', (d * scale, d * scale), 0)
    ImageDraw.Draw(m).ellipse((0, 0, d * scale - 1, d * scale - 1), fill=255)
    return m.resize((d, d), Image.LANCZOS)

def backdrop(size, glows=((0.82, 0.1, 0.55), (0.1, 1.0, 0.35))):
    """Studio navy with soft blue light. Static, so it costs almost nothing in the GIF."""
    W, H = size
    base = Image.new('RGB', size, NAVY)
    for gx, gy, strength in glows:
        g = Image.new('L', (W, H), 0)
        r = int(max(W, H) * 0.45)
        ImageDraw.Draw(g).ellipse((gx * W - r, gy * H - r * 0.7, gx * W + r, gy * H + r * 0.7), fill=int(255 * strength))
        g = g.filter(ImageFilter.GaussianBlur(r * 0.45))
        base = Image.composite(Image.new('RGB', size, (24, 52, 170)), base, g.point(lambda v: int(v * 0.55)))
    return base

def check_icon(d, fg=WHITE, bg=BLUE, scale=4):
    im = Image.new('RGBA', (d * scale, d * scale), (0, 0, 0, 0))
    dr = ImageDraw.Draw(im)
    dr.ellipse((0, 0, d * scale - 1, d * scale - 1), fill=bg)
    s = d * scale
    dr.line([(s * 0.28, s * 0.52), (s * 0.44, s * 0.67), (s * 0.73, s * 0.36)], fill=fg, width=max(2, int(s * 0.11)), joint='curve')
    return im.resize((d, d), Image.LANCZOS)

def glyph_icon(kind, d, fg, bg, scale=4):
    """Small, plain icons for chips: plus, spark (four-point star), clock, lock, coin, arrow."""
    s = d * scale
    im = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    dr = ImageDraw.Draw(im)
    dr.ellipse((0, 0, s - 1, s - 1), fill=bg)
    w = max(2, int(s * 0.1))
    c = s / 2
    if kind == 'plus':
        dr.line([(c, s * 0.28), (c, s * 0.72)], fill=fg, width=w); dr.line([(s * 0.28, c), (s * 0.72, c)], fill=fg, width=w)
    elif kind == 'spark':
        pts = [(c, s * 0.2), (c + s * 0.08, c - s * 0.08), (s * 0.8, c), (c + s * 0.08, c + s * 0.08), (c, s * 0.8), (c - s * 0.08, c + s * 0.08), (s * 0.2, c), (c - s * 0.08, c - s * 0.08)]
        dr.polygon(pts, fill=fg)
    elif kind == 'clock':
        dr.ellipse((s * 0.24, s * 0.24, s * 0.76, s * 0.76), outline=fg, width=w)
        dr.line([(c, s * 0.34), (c, c), (s * 0.62, s * 0.58)], fill=fg, width=w)
    elif kind == 'lock':
        dr.rounded_rectangle((s * 0.28, s * 0.46, s * 0.72, s * 0.76), s * 0.06, fill=fg)
        dr.arc((s * 0.34, s * 0.22, s * 0.66, s * 0.6), 180, 360, fill=fg, width=w)
    elif kind == 'coin':
        dr.ellipse((s * 0.24, s * 0.24, s * 0.76, s * 0.76), outline=fg, width=w)
        dr.line([(c, s * 0.36), (c, s * 0.64)], fill=fg, width=w)
    elif kind == 'arrow':
        dr.line([(s * 0.3, c), (s * 0.7, c)], fill=fg, width=w)
        dr.line([(s * 0.55, s * 0.35), (s * 0.71, c), (s * 0.55, s * 0.65)], fill=fg, width=w, joint='curve')
    elif kind == 'hd':
        f = font(int(s * 0.36), 800); dr.text((c, c), 'HD', font=f, fill=fg, anchor='mm')
    elif kind == 'play':
        dr.polygon([(s * 0.4, s * 0.3), (s * 0.4, s * 0.7), (s * 0.72, c)], fill=fg)
    elif kind == 'warn':
        dr.line([(c, s * 0.28), (c, s * 0.58)], fill=fg, width=w); dr.ellipse((c - w * 0.7, s * 0.68, c + w * 0.7, s * 0.68 + w * 1.4), fill=fg)
    return im.resize((d, d), Image.LANCZOS)

def chip(text, icon=None, light=False, size=12, pad=9, h=28):
    """A pill with an optional icon. light=True: white pill, ink text (the 'hero' chip); else navy glass."""
    f = font(size * 2, 600)
    tw = int(ImageDraw.Draw(Image.new('L', (1, 1))).textlength(text, font=f) / 2)
    iw = (h - 10) if icon else 0
    W = pad * 2 + tw + (iw + 6 if icon else 0)
    S = 2
    im = Image.new('RGBA', (W * S, h * S), (0, 0, 0, 0))
    dr = ImageDraw.Draw(im)
    fill = WHITE + (255,) if light else GLASS + (240,)
    dr.rounded_rectangle((0, 0, W * S - 1, h * S - 1), h * S // 2, fill=fill, outline=None if light else GLASS_LINE + (255,), width=2)
    x = pad * S
    if icon:
        ic = icon(iw * S)
        im.alpha_composite(ic, (x - 3 * S, (h * S - iw * S) // 2))
        x += (iw + 6) * S - 3 * S
    dr.text((x, h * S / 2 + 1), text, font=f, fill=INK if light else (232, 236, 247), anchor='lm')
    return im.resize((W, h), Image.LANCZOS)

def shadow(size, r, blur=14, alpha=150, spread=4):
    W, H = size
    pad = blur * 2 + spread
    im = Image.new('RGBA', (W + pad * 2, H + pad * 2), (0, 0, 0, 0))
    ImageDraw.Draw(im).rounded_rectangle((pad - spread, pad - spread + 6, pad + W + spread, pad + H + spread + 6), r + spread, fill=(0, 0, 0, alpha))
    return im.filter(ImageFilter.GaussianBlur(blur)), pad

def drift(i, n, phase, amp=2.0):
    return round(math.sin(2 * math.pi * (i / n) + phase) * amp)

# ---------------------------------------------------------------- styles
def style_phone(frames, chips, caption=None, size=(560, 300)):
    """1. Phone mock-up with a creator talking inside, chips floating around it."""
    W, H = size
    pw, ph = frames[0].size
    bez = 7
    bw, bh = pw + bez * 2, ph + bez * 2
    bg = backdrop(size)
    px, py = (W - bw) // 2, (H - bh) // 2 + 4
    sh, pad = shadow((bw, bh), 30, blur=18, alpha=170)
    bg.paste(sh, (px - pad, py - pad), sh)
    body = Image.new('RGBA', (bw, bh), (0, 0, 0, 0))
    body.paste(Image.new('RGBA', (bw, bh), (20, 26, 46, 255)), (0, 0), rounded_mask((bw, bh), 30))
    rim = Image.new('RGBA', (bw * 4, bh * 4), (0, 0, 0, 0))
    ImageDraw.Draw(rim).rounded_rectangle((0, 0, bw * 4 - 1, bh * 4 - 1), 120, outline=(58, 70, 112, 255), width=6)
    body.alpha_composite(rim.resize((bw, bh), Image.LANCZOS))
    bg.paste(body, (px, py), body)
    screen_mask = rounded_mask((pw, ph), 23)
    notch = Image.new('RGBA', (44, 12), (0, 0, 0, 0)); ImageDraw.Draw(notch).rounded_rectangle((0, 0, 43, 11), 6, fill=(6, 9, 20, 255))
    cap_font = font(13, 700)
    built = [chip(t, ic, light=(k == 0)) for k, (t, ic) in enumerate(chips)]
    # chip anchors: two left of the phone, two right
    spots = [(px - 30, py + 52, 'r'), (px - 18, py + bh - 92, 'r'), (px + bw + 22, py + 86, 'l'), (px + bw + 30, py + bh - 64, 'l')]
    out = []
    n = len(frames)
    for i, fr in enumerate(frames):
        im = bg.copy()
        scr = fr.copy()
        if caption:
            words = caption.split()
            on = min(len(words) - 1, int(i / n * len(words)))
            d = ImageDraw.Draw(scr)
            total = sum(d.textlength(w + ' ', font=cap_font) for w in words)
            x = (pw - total) / 2
            y = ph - 46
            d.rounded_rectangle((x - 8, y - 12, x + total + 2, y + 12), 9, fill=(6, 9, 20))
            for k, w in enumerate(words):
                d.text((x, y), w, font=cap_font, fill=(255, 214, 10) if k == on else WHITE, anchor='lm')
                x += d.textlength(w + ' ', font=cap_font)
        im.paste(scr, (px + bez, py + bez), screen_mask)
        im.paste(notch, (px + bw // 2 - 22, py + bez + 6), notch)
        for k, (c, (x, y, side)) in enumerate(zip(built, spots)):
            dy = drift(i, n, k * 1.7)
            ax = x - c.width if side == 'r' else x
            im.paste(c, (ax, y + dy), c)
        out.append(im)
    return out

def style_film(clips, labels, size=(560, 222)):
    """2. Film strip of 3-4 small creators, each playing its own loop, slightly staggered like contact prints."""
    W, H = size
    bg = backdrop(size, glows=((0.5, -0.1, 0.5),))
    tw, th = clips[0][0].size
    gap = (W - len(clips) * tw) // (len(clips) + 1)
    offs = [14, 4, 18, 8][:len(clips)]
    mask = rounded_mask((tw, th), 16)
    labs = [chip(l, None, light=False, size=11, pad=8, h=22) for l in labels]
    for k in range(len(clips)):
        x = gap + k * (tw + gap)
        sh, pad = shadow((tw, th), 16, blur=10, alpha=140, spread=2)
        bg.paste(sh, (x - pad, offs[k] - pad), sh)
    out = []
    n = len(clips[0])
    for i in range(n):
        im = bg.copy()
        for k, c in enumerate(clips):
            x = gap + k * (tw + gap)
            im.paste(c[i % len(c)], (x, offs[k]), mask)
            im.paste(labs[k], (x + 8, offs[k] + th - 30), labs[k])
        out.append(im)
    return out

def style_hero(frames, chips, play=True, size=(560, 280)):
    """3. One big loop. The vertical clip plays full height in the middle and melts into blurred ambient sides made from
    its own first frame (static, so nearly free); a soft navy fade at the bottom carries the title, which sits under it
    in HTML. The play mark sits low right, off the face."""
    W, H = size
    fw, fh = frames[0].size
    amb = frames[0].resize((W, int(W * fh / fw)), Image.LANCZOS)
    amb = amb.crop((0, (amb.height - H) // 2, W, (amb.height - H) // 2 + H)).filter(ImageFilter.GaussianBlur(16))
    amb = Image.blend(amb, Image.new('RGB', size, NAVY), 0.62)
    # A fixed film grain on the still sides: it dithers the blur for free (it never changes between frames).
    import random
    rnd = random.Random(7)
    grain = Image.new('L', size)
    grain.putdata([128 + rnd.randint(-7, 7) for _ in range(W * H)])
    amb = Image.merge('RGB', [Image.eval(Image.merge('RGB', (c, c, c)).split()[0], lambda v: v) for c in amb.split()])
    amb = Image.composite(Image.eval(amb, lambda v: min(255, v + 6)), Image.eval(amb, lambda v: max(0, v - 6)), grain.point(lambda v: 255 if v > 128 else 0))
    x0 = (W - fw) // 2
    edge = Image.new('L', (fw, 1), 255)
    for x in range(fw):
        e = min(x, fw - 1 - x) / 34.0
        edge.putpixel((x, 0), int(255 * min(1.0, e)))
    edge = edge.resize((fw, fh))
    fade = Image.new('L', (1, H), 0)
    for y in range(H):
        t = max(0.0, (y / H - 0.6) / 0.4)
        fade.putpixel((0, y), int(255 * (t ** 1.5)))
    fade = fade.resize((W, H))
    top = Image.new('L', (1, H), 0)
    for y in range(H):
        top.putpixel((0, y), int(100 * max(0.0, 1 - y / (H * 0.24))))
    top = top.resize((W, H))
    navy = Image.new('RGB', size, NAVY)
    built = [chip(t, ic, light=(k == 0)) for k, (t, ic) in enumerate(chips)]
    pb = None
    if play:
        d = 52
        pb = Image.new('RGBA', (d * 4, d * 4), (0, 0, 0, 0))
        dr = ImageDraw.Draw(pb)
        dr.ellipse((0, 0, d * 4 - 1, d * 4 - 1), fill=(255, 255, 255, 240))
        dr.polygon([(d * 1.62, d * 1.22), (d * 1.62, d * 2.78), (d * 2.9, d * 2)], fill=BLUE + (255,))
        pb = pb.resize((d, d), Image.LANCZOS)
    out = []
    n = len(frames)
    for i, fr in enumerate(frames):
        im = amb.copy()
        im.paste(fr, (x0, 0), edge)
        im = Image.composite(navy, im, fade)
        im = Image.composite(navy, im, top)
        if pb: im.paste(pb, (W - pb.width - 20, H - pb.height - 18), pb)
        x = 16
        for k, c in enumerate(built):
            im.paste(c, (x, 16 + drift(i, n, k * 1.9, 1.5)), c)
            x += c.width + 8
        out.append(im)
    return out

def style_split(frames, chip_spec, size=(220, 264)):
    """4. Portrait creator card for the left half of a split header; a chip 'pops' off its lower edge."""
    W, H = size
    bg = Image.new('RGB', size, NAVY)  # flat: it sits on the navy panel beside the stat card, edges invisible
    fw, fh = frames[0].size
    x, y = (W - fw) // 2, 10
    sh, pad = shadow((fw, fh), 20, blur=12, alpha=150)
    bg.paste(sh, (x - pad, y - pad), sh)
    mask = rounded_mask((fw, fh), 20)
    c = chip(*chip_spec, light=True, size=12, h=30)
    out = []
    n = len(frames)
    for i, fr in enumerate(frames):
        im = bg.copy()
        im.paste(fr, (x, y), mask)
        im.paste(c, ((W - c.width) // 2, y + fh - 22 + drift(i, n, 0.6, 2)), c)
        out.append(im)
    return out

def style_avatar(frames, d=128, ring=True):
    """5. Round moving avatar (2x; shown at 64px) on navy, with a thin blue ring."""
    out = []
    inner = d - 12
    m = circle_mask(inner)
    ring_im = Image.new('RGBA', (d * 4, d * 4), (0, 0, 0, 0))
    ImageDraw.Draw(ring_im).ellipse((4, 4, d * 4 - 5, d * 4 - 5), outline=BLUE + (255,), width=10)
    ring_im = ring_im.resize((d, d), Image.LANCZOS)
    for fr in frames:
        im = Image.new('RGB', (d, d), NAVY)
        im.paste(fr, (6, 6), m)
        if ring: im.paste(ring_im, (0, 0), ring_im)
        out.append(im)
    return out

# ---------------------------------------------------------------- encode
def encode(frames, fps, path, budget=BUDGET, tmp=None):
    d = tempfile.mkdtemp(dir=tmp)
    for k, f in enumerate(frames): f.save(os.path.join(d, '%03d.png' % k))
    # Ordered (bayer) dither keeps still areas byte-identical between frames, so diff_mode=rectangle and the GIF
    # encoder's transparency diff skip them. Step down colours, then fps (never below 12), until it fits.
    tries = [(fps, 160, 'bayer:bayer_scale=5'), (fps, 112, 'bayer:bayer_scale=5'), (fps, 96, 'none'), (max(12, fps - 2), 80, 'none'), (12, 64, 'none')]
    for k, (f, colors, dither) in enumerate(tries):
        step = fps / f
        keep = [int(round(j * step)) for j in range(int(len(frames) / step))]
        d2 = os.path.join(d, 'k%d' % k); os.makedirs(d2)
        for j, src in enumerate(keep): os.link(os.path.join(d, '%03d.png' % min(src, len(frames) - 1)), os.path.join(d2, '%03d.png' % j))
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-framerate', str(f), '-i', os.path.join(d2, '%03d.png'),
                        '-vf', 'split[a][b];[a]palettegen=max_colors=%d:stats_mode=full[p];[b][p]paletteuse=dither=%s:diff_mode=rectangle' % (colors, dither),
                        '-loop', '0', path], check=True)
        used = '%d fps, %d colours, %s' % (f, colors, dither.split(':')[0])
        if os.path.getsize(path) <= budget: break
    print('   ', used, file=sys.stderr)
    shutil.rmtree(d, ignore_errors=True)
    return os.path.getsize(path)

# ---------------------------------------------------------------- the set
def jobs(src):
    S = lambda n: os.path.join(src, n + '.mp4')
    ic = lambda kind, fg=WHITE, bg=BLUE: (lambda d: glyph_icon(kind, d, fg, bg))
    ok = lambda d: check_icon(d)
    return {
        # 1 Phone mock-ups (only the 124x248 screen moves)
        'phone-ready': lambda t: ('phone', 12, style_phone(footage(S('sample-cafe'), 2.6, 1.8, (124, 248), 12, (0.5, 0.42), 1.05, t, still=(0.5, 0.55, 0.5, 0.6)),
                                   [('Ready', ok), ('+ captions', ic('plus')), ('1080p', ic('hd')), ('Made with Vooads', ic('spark'))], caption='best latte ever')),
        'phone-code': lambda t: ('phone', 12, style_phone(footage(S('sample-podcast'), 3.0, 1.8, (124, 248), 12, (0.5, 0.34), 1.3, t, still=(0.5, 0.5, 0.5, 0.55)),
                                  [('Sign-in code', ok), ('Valid 10 min', ic('clock')), ('Only for you', ic('lock')), ('Vooads', ic('spark'))])),
        'phone-plan': lambda t: ('phone', 12, style_phone(footage(S('sample-founder'), 7.4, 1.8, (124, 248), 12, (0.52, 0.42), 1.9, t, still=(0.5, 0.45, 0.48, 0.5)),
                                  [('Plan active', ok), ('Monthly credits', ic('coin')), ('1080p', ic('hd')), ('+ captions', ic('plus'))], caption='we ship faster')),
        'phone-pause': lambda t: ('phone', 12, style_phone(footage(S('sample-street'), 0.3, 1.6, (124, 248), 12, (0.42, 0.34), 1.15, t, still=(0.45, 0.42, 0.5, 0.5)),
                                  [('Plan ended', ic('clock', INK, (255, 214, 10))), ('Videos kept', ok), ('Restart anytime', ic('arrow')), ('1080p', ic('hd'))])),
        # 2 Film strips (four small creators)
        'film-welcome': lambda t: ('film', 12, style_film([
            footage(S('sample-podcast'), 3.0, 1.6, (108, 184), 12, (0.5, 0.32), 1.35, t, still=(0.5, 0.55, 0.5, 0.6)),
            footage(S('sample-cafe'), 2.6, 1.6, (108, 184), 12, (0.5, 0.33), 1.35, t, still=(0.5, 0.55, 0.5, 0.6)),
            footage(S('sample-skincare'), 7.6, 1.6, (108, 184), 12, (0.52, 0.3), 1.3, t, still=(0.5, 0.45, 0.5, 0.5)),
            footage(S('sample-founder'), 3.4, 1.6, (108, 184), 12, (0.52, 0.4), 2.2, t, still=(0.5, 0.45, 0.5, 0.55))], ['Podcast', 'Cafe', 'Skincare', 'Founder'])),
        'film-digest': lambda t: ('film', 12, style_film([
            footage(S('sample-cafe'), 8.0, 1.5, (108, 184), 12, (0.45, 0.4), 1.25, t, still=(0.5, 0.55, 0.5, 0.6)),
            footage(S('sample-founder'), 1.6, 1.5, (108, 184), 12, (0.52, 0.4), 2.2, t, still=(0.5, 0.45, 0.5, 0.55)),
            footage(S('sample-street'), 4.2, 1.5, (108, 184), 12, (0.45, 0.34), 1.3, t, still=(0.5, 0.42, 0.5, 0.5)),
            footage(S('sample-podcast'), 7.2, 1.5, (108, 184), 12, (0.5, 0.32), 1.35, t, still=(0.5, 0.55, 0.5, 0.6))], ['Cafe', 'SaaS', 'Street', 'Podcast'])),
        # 3 Hero loops (cinemagraph: the creator moves, the room holds)
        'hero-ready': lambda t: ('hero', 12, style_hero(footage(S('sample-cafe'), 3.0, 1.6, (330, 280), 12, (0.5, 0.36), 1.25, t, still=(0.5, 0.42, 0.3, 0.46)),
                                 [('Ready', ok), ('1080p', ic('hd'))])),
        'hero-attention': lambda t: ('hero', 12, style_hero(footage(S('ugc-desk-creator'), 11.3, 1.6, (330, 280), 12, (0.5, 0.48), 1.0, t, still=(0.5, 0.5, 0.42, 0.6)),
                                     [('One part needs a choice', ic('warn', INK, (255, 214, 10)))], play=False)),
        # 4 Split cards (a creator beside the HTML stat card)
        'split-receipt': lambda t: ('split', 12, style_split(footage(S('sample-cafe'), 2.6, 1.8, (168, 224), 12, (0.5, 0.4), 1.25, t, still=(0.5, 0.55, 0.5, 0.6)), ('Paid', ok))),
        'split-credits': lambda t: ('split', 12, style_split(footage(S('sample-fitness'), 6.9, 1.6, (168, 224), 12, (0.55, 0.3), 1.25, t, still=(0.55, 0.45, 0.48, 0.55)), ('Credits added', ic('plus')))),
        'split-low': lambda t: ('split', 12, style_split(footage(S('sample-founder'), 1.6, 1.8, (168, 224), 12, (0.52, 0.4), 2.1, t, still=(0.5, 0.45, 0.48, 0.55)), ('Running low', ic('coin', INK, (255, 214, 10))))),
        'split-refund': lambda t: ('split', 12, style_split(footage(S('sample-podcast'), 0.4, 1.8, (168, 224), 12, (0.5, 0.34), 1.3, t, still=(0.5, 0.55, 0.5, 0.6)), ('Credits back', ic('arrow')))),
        'split-referral': lambda t: ('split', 12, style_split(footage(S('sample-skincare'), 0.2, 1.6, (168, 224), 12, (0.5, 0.33), 1.25, t, still=(0.5, 0.45, 0.48, 0.55)), ('Referral reward', ic('spark')))),
        # 5 Round avatars (2x)
        'avatar-support': lambda t: ('avatar', 14, style_avatar(footage(S('sample-podcast'), 7.1, 1.8, (116, 116), 14, (0.5, 0.36), 2.5, t, still=(0.5, 0.5, 0.42, 0.5)))),
        'avatar-review': lambda t: ('avatar', 14, style_avatar(footage(S('sample-founder'), 7.4, 1.8, (116, 116), 14, (0.53, 0.43), 3.2, t, still=(0.5, 0.5, 0.42, 0.5)))),
    }

def mark_png(path, d=64):
    s = d * 8
    im = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    dr = ImageDraw.Draw(im)
    u = s / 64
    dr.rounded_rectangle((0, 0, s - 1, s - 1), 18 * u, fill=BLUE)
    dr.ellipse(((23 - 10) * u, (32 - 10) * u, (23 + 10) * u, (32 + 10) * u), outline=WHITE, width=int(4.4 * u))
    dr.ellipse(((41 - 10) * u, (32 - 10) * u, (41 + 10) * u, (32 + 10) * u), fill=WHITE)
    dr.polygon([(38.3 * u, 26.6 * u), (38.3 * u, 37.4 * u), (46.9 * u, 32 * u)], fill=BLUE)
    im.resize((d, d), Image.LANCZOS).save(path, optimize=True)

def play_png(path, d=52):
    """The play mark that server/email/preview.js lays over a customer's own video preview."""
    s = d * 4
    im = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    dr = ImageDraw.Draw(im)
    dr.ellipse((0, 0, s - 1, s - 1), fill=(255, 255, 255, 240))
    dr.polygon([(d * 1.62, d * 1.22), (d * 1.62, d * 2.78), (d * 2.9, d * 2)], fill=BLUE + (255,))
    im.resize((d, d), Image.LANCZOS).save(path, optimize=True)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', default=os.environ.get('VOOADS_CLIPS', os.path.join(ROOT, '..', '..', 'new-samples')))
    ap.add_argument('--only', default='')
    a = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    mark_png(os.path.join(OUT, 'mark.png'), 64)
    play_png(os.path.join(OUT, 'play.png'))
    tmp = tempfile.mkdtemp(prefix='va-gifs-')
    only = [x for x in a.only.split(',') if x]
    try:
        for name, make in jobs(a.src).items():
            if only and name not in only: continue
            kind, fps, frames = make(tmp)
            size = encode(frames, fps, os.path.join(OUT, name + '.gif'), tmp=tmp)
            print('%-16s %-7s %4dx%-4d %3d frames %6.1f KB' % (name, kind, frames[0].width, frames[0].height, len(frames), size / 1024))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

if __name__ == '__main__':
    main()
