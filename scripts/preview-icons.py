#!/usr/bin/env python3
"""把 4 个候选拼成一张对比图：大图 + 真实像素小图（16/32/64 菜单栏实际观感）。"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
ICONS = ROOT / "Resources" / "icons"
OUT = ICONS / "preview-compare.png"

CANDIDATES = [
    ("candidate-A", "A", "极简鲸鱼"),
    ("candidate-B", "B", "菜单栏+鲸鱼"),
    ("candidate-C", "C", "鲸鱼+火箭"),
    ("candidate-D", "D", "DHL 字母标"),
]

BG = (38, 38, 42, 255)
CARD = (52, 52, 58, 255)
TEXT = (235, 235, 240, 255)
SUBTEXT = (150, 150, 160, 255)

BIG = 256
SMALL_SIZES = [16, 32, 64]
PAD = 28
CARD_W = BIG + PAD * 2
HEADER = 78
SMALL_ROW = 108
FOOTER = 46
CARD_H = HEADER + BIG + SMALL_ROW + FOOTER

FONT_CANDIDATES = [
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/Helvetica.ttc",
]


def load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    for path in FONT_CANDIDATES:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def main() -> None:
    width = CARD_W * len(CANDIDATES) + PAD * (len(CANDIDATES) + 1)
    height = CARD_H + PAD * 2 + 56
    canvas = Image.new("RGBA", (width, height), BG)
    draw = ImageDraw.Draw(canvas)

    title_font = load_font(26)
    draw.text((PAD, PAD), "DHL 图标候选对比", font=title_font, fill=TEXT)
    draw.text(
        (PAD, PAD + 34),
        "上行 256px 主图 / 下行 16·32·64px 真实像素（菜单栏实际观感）",
        font=load_font(15),
        fill=SUBTEXT,
    )

    top = PAD + 56 + PAD
    for index, (folder, letter, label) in enumerate(CANDIDATES):
        x = PAD + index * (CARD_W + PAD)
        y = top
        draw.rounded_rectangle(
            [x, y, x + CARD_W, y + CARD_H], radius=18, fill=CARD
        )

        draw.text(
            (x + PAD, y + 20), f"{letter}", font=load_font(30), fill=TEXT
        )
        draw.text(
            (x + PAD + 30, y + 30), label, font=load_font(17), fill=TEXT
        )

        source = ICONS / folder / "DHL.iconset" / "icon_256x256.png"
        if source.exists():
            big = Image.open(source).convert("RGBA").resize(
                (BIG, BIG), Image.LANCZOS
            )
            canvas.paste(big, (x + PAD, y + HEADER), big)

        small_y = y + HEADER + BIG + 18
        cursor = x + PAD
        for size in SMALL_SIZES:
            small_src = (
                ICONS / folder / "DHL.iconset" / f"icon_{size}x{size}.png"
            )
            if not small_src.exists():
                continue
            icon = Image.open(small_src).convert("RGBA")
            canvas.paste(icon, (cursor, small_y), icon)
            draw.text(
                (cursor, small_y + 72),
                f"{size}px",
                font=load_font(12),
                fill=SUBTEXT,
            )
            cursor += 96

    OUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(OUT, "PNG")
    print(f"对比图已生成: {OUT.relative_to(ROOT)} ({width}x{height})")


if __name__ == "__main__":
    main()
