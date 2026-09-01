#!/usr/bin/env python3
"""从 1024x1024 候选源图生成标准 macOS iconset + icns。

用法:
    python3 make-iconset.py

源图来自 build/icon-candidates/（AI 生成的概念图），
输出落到 Resources/icons/candidate-X/（持久目录，不被 build-app.sh 清空）。
"""
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
CANDIDATES = {
    "candidate-A": ("macOS_app_icon_1024x1024_in_th_2026-09-01T02-18-38.png", "极简鲸鱼"),
    "candidate-B": ("macOS_app_icon_1024x1024_in_ic_2026-09-01T02-18-32.png", "菜单栏+鲸鱼"),
    "candidate-C": ("macOS_app_icon_1024x1024_in_ic_2026-09-01T02-18-31.png", "鲸鱼+火箭"),
    "candidate-D": ("macOS_app_icon_1024x1024_in_ic_2026-09-01T02-18-28.png", "DHL 字母标"),
}

# 标准 iconset 成员: 文件名 -> 像素尺寸
ICONSET_MEMBERS = [
    ("icon_16x16.png", 16),
    ("icon_16x16@2x.png", 32),
    ("icon_32x32.png", 32),
    ("icon_32x32@2x.png", 64),
    ("icon_128x128.png", 128),
    ("icon_128x128@2x.png", 256),
    ("icon_256x256.png", 256),
    ("icon_256x256@2x.png", 512),
    ("icon_512x512.png", 512),
    ("icon_512x512@2x.png", 1024),
]

SRC_DIR = ROOT / "build" / "icon-candidates"
OUT_ROOT = ROOT / "Resources" / "icons"


def step_down_resize(img: Image.Image, target: int) -> Image.Image:
    """逐级折半降采样再精修，避免 1024->16 一步到底糊掉。"""
    current = img
    while current.width // 2 >= target:
        current = current.resize(
            (current.width // 2, current.height // 2), Image.LANCZOS
        )
    if current.width != target:
        current = current.resize((target, target), Image.LANCZOS)
    return current


def build_one(name: str, src_name: str, label: str) -> Path | None:
    src = SRC_DIR / src_name
    if not src.exists():
        print(f"  !! 跳过 {name}: 源图不存在 {src}")
        return None

    out_dir = OUT_ROOT / name
    iconset = out_dir / "DHL.iconset"
    if iconset.exists():
        shutil.rmtree(iconset)
    iconset.mkdir(parents=True, exist_ok=True)

    # 保留一份源图，后续微调不用重新生图
    shutil.copy2(src, out_dir / "source-1024.png")

    with Image.open(src) as raw:
        img = raw.convert("RGBA")
        if img.width != img.height:
            side = min(img.width, img.height)
            left = (img.width - side) // 2
            top = (img.height - side) // 2
            img = img.crop((left, top, left + side, top + side))
        for filename, size in ICONSET_MEMBERS:
            resized = step_down_resize(img, size)
            resized.save(iconset / filename, "PNG", optimize=True)

    icns = out_dir / "DHL.icns"
    if icns.exists():
        icns.unlink()
    result = subprocess.run(
        ["iconutil", "-c", "icns", str(iconset), "-o", str(icns)],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(f"  !! {name} iconutil 失败: {result.stderr.strip()}")
        return None

    print(f"  OK {name} ({label}) -> {icns.relative_to(ROOT)}")
    return icns


def main() -> int:
    OUT_ROOT.mkdir(parents=True, exist_ok=True)
    print(f"输出根目录: {OUT_ROOT}")
    built = []
    for name, (src_name, label) in CANDIDATES.items():
        icns = build_one(name, src_name, label)
        if icns:
            built.append((name, label, icns))

    print(f"\n完成 {len(built)}/{len(CANDIDATES)} 套图标")
    for name, label, icns in built:
        size_kb = icns.stat().st_size // 1024
        print(f"  {name}: {label} ({size_kb} KB)")
    return 0 if built else 1


if __name__ == "__main__":
    sys.exit(main())
