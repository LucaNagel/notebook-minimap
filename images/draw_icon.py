"""Notebook Minimap icon: left a single-column minimap with the viewport box,
right the notebook section that box stands for. Drawn at 4x and downsampled."""
import sys
from PIL import Image, ImageDraw

S = 4
N = 256
BG = (30, 34, 44, 255)
PANEL = (42, 48, 61, 255)
PAGE = (47, 54, 69, 255)
CELL = (34, 39, 50, 255)
WHITE = (228, 232, 240, 255)
GREY = (140, 150, 168, 255)
KEY = (110, 165, 235, 255)
STR = (214, 150, 110, 255)
RED = (226, 54, 82, 255)
BLUE = (55, 148, 255, 255)


def R(v):
    return [round(x * S) for x in v]


def draw(out):
    img = Image.new("RGBA", (N * S, N * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle(R([0, 0, N - 1, N - 1]), radius=50 * S, fill=BG)

    # ---------------------------------------------------- left: minimap strip
    mx0, my0, mx1, my1 = 24, 28, 84, 228
    d.rounded_rectangle(R([mx0, my0, mx1, my1]), radius=7 * S, fill=PANEL)

    def mini_plot(y, h):
        d.rectangle(R([mx0 + 8, y, mx1 - 8, y + h]), fill=(236, 236, 236, 255))
        w = mx1 - 8 - (mx0 + 8)
        pts = []
        for k in range(13):
            x = mx0 + 10 + k * (w - 4) / 12
            peak = 9 if k in (4, 9) else (4 if k in (3, 5, 8, 10) else 1)
            pts.append((x, y + h - 3 - peak * h / 16))
        d.line([(round(px * S), round(py * S)) for px, py in pts], fill=RED, width=round(1.4 * S))

    y = my0 + 8
    layout = ["h", "c3", "p14", "h", "c4", "c2", "p12", "h", "c3", "p14", "c2", "h", "c3"]
    for item in layout:
        if y > my1 - 8:
            break
        if item == "h":
            d.rounded_rectangle(R([mx0 + 8, y, mx0 + 36, y + 4]), radius=1.5 * S, fill=WHITE)
            y += 9
        elif item[0] == "c":
            n = int(item[1:])
            for i in range(n):
                w = [34, 26, 40, 22][i % 4]
                col = KEY if i % 3 == 0 else GREY
                d.rounded_rectangle(R([mx0 + 8, y, mx0 + 8 + w, y + 2]), radius=1 * S, fill=col)
                y += 4.5
            y += 4
        else:
            h = int(item[1:])
            mini_plot(y, h)
            y += h + 6

    # viewport box on the minimap; everything outside it dimmed
    by0, by1 = 98, 150
    dim = Image.new("RGBA", img.size, (0, 0, 0, 0))
    dd = ImageDraw.Draw(dim)
    dd.rounded_rectangle(R([mx0, my0, mx1, my1]), radius=7 * S, fill=(20, 23, 30, 120))
    dd.rectangle(R([mx0, by0, mx1, by1]), fill=(0, 0, 0, 0))
    img = Image.alpha_composite(img, dim)
    d = ImageDraw.Draw(img)

    # ------------------------------------------- right: the notebook itself
    px0, py0, px1, py1 = 108, 28, 234, 228
    # zoom wedge from the box to the page
    wedge = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(wedge).polygon(
        [(mx1 * S, by0 * S), (px0 * S, py0 * S), (px0 * S, py1 * S), (mx1 * S, by1 * S)],
        fill=(55, 148, 255, 46),
    )
    img = Image.alpha_composite(img, wedge)
    d = ImageDraw.Draw(img)
    d.line(R([mx1, by0, px0, py0]), fill=(55, 148, 255, 150), width=round(1.5 * S))
    d.line(R([mx1, by1, px0, py1]), fill=(55, 148, 255, 150), width=round(1.5 * S))

    d.rounded_rectangle(R([px0, py0, px1, py1]), radius=9 * S, fill=PAGE)
    x = px0 + 12
    # heading
    d.rounded_rectangle(R([x, py0 + 14, x + 70, py0 + 24]), radius=3 * S, fill=WHITE)
    # code cell
    cy = py0 + 34
    d.rounded_rectangle(R([x, cy, px1 - 12, cy + 44]), radius=5 * S, fill=CELL)
    rows = [(KEY, 22, STR, 30), (GREY, 46, None, 0), (KEY, 16, GREY, 40), (GREY, 34, STR, 18)]
    for i, (c1, w1, c2, w2) in enumerate(rows):
        yy = cy + 8 + i * 9
        d.rounded_rectangle(R([x + 7, yy, x + 7 + w1, yy + 4]), radius=1.5 * S, fill=c1)
        if c2:
            d.rounded_rectangle(R([x + 11 + w1, yy, x + 11 + w1 + w2, yy + 4]), radius=1.5 * S, fill=c2)
    # plot output
    gy0, gy1 = cy + 54, cy + 128
    d.rectangle(R([x, gy0, px1 - 12, gy1]), fill=(245, 245, 245, 255))
    ax0, ax1, ay0, ay1 = x + 8, px1 - 18, gy0 + 8, gy1 - 9
    d.line(R([ax0, ay0, ax0, ay1, ax1, ay1]), fill=(120, 120, 120, 255), width=round(1.2 * S))
    pts = []
    steps = 60
    for k in range(steps + 1):
        t = k / steps
        xx = ax0 + 3 + t * (ax1 - ax0 - 6)
        val = 0.06 + 0.82 / (1 + ((t - 0.34) / 0.045) ** 2) + 0.55 / (1 + ((t - 0.72) / 0.05) ** 2)
        pts.append((xx * S, (ay1 - 3 - val * (ay1 - ay0 - 8)) * S))
    d.line(pts, fill=RED, width=round(2.4 * S), joint="curve")
    # next heading, partially visible
    d.rounded_rectangle(R([x, gy1 + 14, x + 52, gy1 + 22]), radius=3 * S, fill=WHITE)

    # viewport box outline (drawn last so it sits on top)
    d.rounded_rectangle(R([mx0 - 3, by0, mx1 + 3, by1]), radius=4 * S, outline=BLUE, width=round(3.5 * S))

    out_img = img.resize((N, N), Image.LANCZOS)
    out_img.save(out)
    # small previews to judge legibility
    big = Image.new("RGBA", (N + 160, N), (255, 255, 255, 255))
    big.paste(out_img, (0, 0), out_img)
    for i, sz in enumerate([64, 32]):
        small = out_img.resize((sz, sz), Image.LANCZOS)
        big.paste(small, (N + 20 + i * 76, 20), small)
    big.save(out.replace(".png", "_preview.png"))


draw(sys.argv[1])
print("ok")
