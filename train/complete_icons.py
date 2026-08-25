# -*- coding: utf-8 -*-
"""Normalize sprite name prefixes to 3 digits and generate missing placeholder icons.

1. Rename every PNG in train/dataset/image whose numeric prefix is shorter
   than 3 digits:
       1_迪莫.png   -> 001_迪莫.png
       10_水灵.png  -> 010_水灵.png
       100_xxx.png  -> 100_xxx.png (unchanged)

2. Generate 100x100 black-background PNGs with a centered white question mark
   for the missing sprites listed in MISSING_FILES. Existing files are never
   overwritten.

Name notes:
   * id 19 is 冬羽雀 in the JSON and in the existing seasonal forms
     (19_冬羽雀_夏天/春天/秋天.png); the requested 冬雨雀 is treated as a typo.
   * id 382 is 晶尾蝎 per the game (碎晶蝎 -> 晶尾蝎 -> 蝎子王); roco_all_pets_info.json
     currently contains the typo 品尾蝎.
"""

import os
import re
import shutil
import sys

from PIL import Image, ImageDraw, ImageFont


ICON_DIR = os.path.join(os.path.dirname(__file__), "dataset", "image")
SIZE = 100
FONT_PATH = r"C:\Windows\Fonts\arialbd.ttf"

# Files to generate placeholders for (prefixes already 3-digit).
MISSING_FILES = [
    "019_冬羽雀_冬天",
    "118_旋叶虫_枯叶",
    "235_香草甜甜_杨桃",
    "235_香草甜甜_蓝莓",
    "277_地鼠_储水期",
    "278_遁鼠_储水期",
    "279_遁地鼠_储水期",
    "348_钨丝贝贝",
    "349_辉光幕机",
    "350_机幕方舟",
    "381_碎晶蝎",
    "382_晶尾蝎",
    "383_蝎子王",
    "384_森豆丁",
    "385_森蛮人",
    "386_森巨人",
    "387_霹雳宝宝",
    "388_雷鸣小子",
    "389_雷神之子",
    "390_雪灵兽",
    "391_幻雪兽",
    "392_饮雪狂兽",
    "396_友爱天天",
    "397_友爱星飞",
    "403_觅觅蝠",
    "404_翻翻蝠",
    "405_夜游魔",
    "406_芽眼魔",
    "407_叶眼魔",
    "410_点点",
    "412_不咕钟",
    "414_加灵",
    "415_加益",
    "418_咬咬小子",
    "419_胡桃王子",
    "420_足尖元件",
    "421_离心舞者",
    "422_蝴蝶陶陶",
    "423_铆钉毛毛",
    "424_徘徊爪爪",
    "425_苞米仔",
    "426_炮米花",
    "427_十字蝌蚪",
    "428_十字蛙",
    "429_深渊蛙",
    "430_卡波",
    "431_卡拉波斯",
    "432_守夜烛",
    "433_流明坎德拉",
    "434_蜜果骸",
    "435_半朽蜜果灵",
    "436_稻草人",
    "437_稻草守护者",
]


def normalize_prefixes(icon_dir):
    """Zero-pad numeric prefixes to 3 digits. Returns (renamed, skipped)."""
    pattern = re.compile(r"^(\d+)(_.*)$")
    plan = []
    for name in sorted(os.listdir(icon_dir)):
        m = pattern.match(name)
        if not m:
            continue
        digits, rest = m.group(1), m.group(2)
        if len(digits) >= 3:
            continue
        plan.append((name, digits.zfill(3) + rest))

    # Collision check: two sources mapping to the same target, or a target
    # that already exists and is not itself a planned source (a planned
    # source's name is freed during the temp-rename phase).
    targets = {}
    skipped = []
    ok = []
    planned_sources = {old for old, _ in plan}
    for old, new in plan:
        if new in targets:
            skipped.append((old, new, "collision with " + targets[new]))
            continue
        targets[new] = old
        ok.append((old, new))
    for old, new in ok:
        if (os.path.exists(os.path.join(icon_dir, new))
                and new not in planned_sources):
            skipped.append((old, new, "target already exists"))

    # Two-phase rename so no intermediate name collides.
    renamed = []
    for old, new in ok:
        tmp = os.path.join(icon_dir, old + ".tmp")
        os.rename(os.path.join(icon_dir, old), tmp)
        os.rename(tmp, os.path.join(icon_dir, new))
        renamed.append((old, new))
    return renamed, skipped


def make_placeholder(path):
    """100x100 black image with a centered white question mark."""
    img = Image.new("RGB", (SIZE, SIZE), "black")
    draw = ImageDraw.Draw(img)
    font = ImageFont.truetype(FONT_PATH, 80)
    x0, y0, x1, y1 = draw.textbbox((0, 0), "?", font=font)
    w, h = x1 - x0, y1 - y0
    x = (SIZE - w) / 2 - x0
    y = (SIZE - h) / 2 - y0
    draw.text((x, y), "?", font=font, fill="white")
    img.save(path)


def main():
    if not os.path.isdir(ICON_DIR):
        print(f"ERROR: icon dir not found: {ICON_DIR}", file=sys.stderr)
        sys.exit(1)

    renamed, skipped = normalize_prefixes(ICON_DIR)
    print(f"renamed to 3-digit prefix: {len(renamed)}")
    for old, new in renamed:
        print(f"    {old} -> {new}")
    for old, new, reason in skipped:
        print(f"SKIPPED {old} -> {new}: {reason}")

    made, existed = [], []
    for base in MISSING_FILES:
        path = os.path.join(ICON_DIR, base + ".png")
        if os.path.exists(path):
            existed.append(base)
            continue
        make_placeholder(path)
        made.append(base)
    print(f"placeholder icons created: {len(made)}")
    print(f"placeholder icons skipped (already exist): {len(existed)}")
    for base in existed:
        print(f"    {base}")

    total = len(os.listdir(ICON_DIR))
    print(f"total files in {ICON_DIR}: {total}")


if __name__ == "__main__":
    main()
