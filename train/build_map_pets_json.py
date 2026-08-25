# -*- coding: utf-8 -*-
"""Build a single JSON that maps each map sprite to its dataset image file.

The image database is train/dataset/image, where filenames are
    {id}_{pet_name}[_{form}].png            例：258_乌达_极夜.png
或（多形态） {id}_{seq}_{pet_name}[_{form}].png  例：001_01_迪莫.png

For every PNG in the three source maps
    train/features/assets/pic/icons_only/map1|map2|map3
the corresponding dataset filename is chosen as the JSON key:

    1. unique file whose content (md5) is identical to the map image;
    2. otherwise the dataset file with the same sprite name;
    3. otherwise (base form with no dataset counterpart, e.g. map has
       "小星光.png" but the database only has "080_小星光_星光.png")
       the closest image of the same pet, picked by perceptual hash,
       and reported on stdout for review.

Output (JSON key 使用新命名，与 datasets.db 的 icons.path 完全一致):
    {
      "map1": {
        "008_水蓝蓝.png":   {"id": 8,   "seq": null,  "name": "水蓝蓝"},
        "001_01_迪莫.png": {"id": 1,   "seq": 1,     "name": "迪莫"}
      },
      "map2": { ... },
      "map3": { ... }
    }
"""

import json
import os
import re
import sys
from collections import defaultdict
from hashlib import md5
from pathlib import Path

from PIL import Image

# 保证能 import 到 core.pet_path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))
from core.pet_path import split_pet_filename  # noqa: E402


ROOT = os.path.dirname(__file__)
DATASET_DIR = os.path.join(ROOT, "dataset", "image")
PIC_ROOT = os.path.join(ROOT, "assets", "pic", "icons_only")
MAPS = ["map1", "map2", "map3"]
OUT_PATH = os.path.join(ROOT, "dataset", "map_pets.json")


def file_md5(path):
    h = md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def dhash(path, size=9):
    """64-bit perceptual hash (difference hash)."""
    img = Image.open(path).convert("L").resize((size + 1, size))
    px = list(img.getdata())
    bits = 0
    for i in range(size):
        row = i * (size + 1)
        for j in range(size):
            bits = (bits << 1) | (1 if px[row + j] > px[row + j + 1] else 0)
    return bits


def hamming(a, b):
    return bin(a ^ b).count("1")


def load_pet_names():
    pets_path = os.path.join(os.path.dirname(ROOT), "resource", "roco_all_pets.json")
    if not os.path.exists(pets_path):
        # 兼容路径：项目根/资源
        pets_path = os.path.join(PROJECT_ROOT, "resource", "roco_all_pets.json")
    with open(pets_path, encoding="utf-8") as f:
        pets = json.load(f)["pets"]
    return {p["id"]: p["name"] for p in pets}


def build_dataset_index():
    """Dataset filename -> (id, rest, md5, dhash, seq)。

    用 core.pet_path 解析新命名 <id>_<seq>_<name>.png，rest 为去掉 id 与序号后的
    展示名（含形态后缀），确保 by_rest 匹配一致。
    """
    files = {}
    for fname in sorted(os.listdir(DATASET_DIR)):
        if not fname.lower().endswith(".png"):
            continue
        info = split_pet_filename(fname)
        if not info or info.get("id") is None:
            continue
        rest = info["name"]
        path = os.path.join(DATASET_DIR, fname)
        files[fname] = (info["id"], rest, file_md5(path), dhash(path), info.get("seq"))
    return files


def resolve_pet(rest, pet_names):
    """Pet id/name for a map sprite name, using JSON pet names."""
    if rest in pet_names:
        pid = pet_names[rest]
        return pid, rest
    prefix = [n for n in pet_names if rest.startswith(n + "_")]
    if prefix:
        n = max(prefix, key=len)
        return pet_names[n], n
    embedded = [n for n in pet_names if n in rest]
    if embedded:
        n = max(embedded, key=len)
        return pet_names[n], n
    return None, None


def pick_by_name(rest, candidates):
    """Prefer exact sprite name, then the '_本来' base form, else first."""
    for fname in candidates:
        info = split_pet_filename(fname)
        if info and info["name"] == rest:
            return fname
    for fname in candidates:
        if "_本来" in fname:
            return fname
    return sorted(candidates)[0]


def main():
    name_by_id = load_pet_names()
    pet_names = {name: pid for pid, name in name_by_id.items()}
    ds = build_dataset_index()
    by_hash = defaultdict(list)
    by_rest = defaultdict(list)
    by_pid = defaultdict(list)
    for fname, (pid, rest, h, _d, seq) in ds.items():
        by_hash[h].append(fname)
        by_rest[rest].append(fname)
        by_pid[pid].append(fname)

    result = {}
    guessed = []
    nulls = []
    for mp in MAPS:
        mdir = os.path.join(PIC_ROOT, mp)
        entries = {}
        for fname in sorted(os.listdir(mdir)):
            if not fname.lower().endswith(".png"):
                continue
            rest = os.path.splitext(fname)[0]
            pid, pname = resolve_pet(rest, pet_names)
            path = os.path.join(mdir, fname)
            h = file_md5(path)

            key = None
            method = None
            if by_hash.get(h):
                key = pick_by_name(rest, by_hash[h])
                method = "content"
            elif by_rest.get(rest):
                key = by_rest[rest][0]
                method = "name"
            elif pid is not None and by_pid.get(pid):
                target = dhash(path)
                best = min(by_pid[pid], key=lambda f: hamming(target, ds[f][3]))
                key = best
                method = "perceptual"

            if key is None:
                entries[rest + ".png"] = {"id": None, "seq": None, "name": None}
                nulls.append((mp, fname))
                continue

            kid = ds[key][0]
            kseq = ds[key][4]
            if pid is not None and kid != pid:
                print(f"WARNING: {mp}/{fname} -> {key} (id {kid}), "
                      f"expected id {pid} ({pname})")
            entries[key] = {"id": kid, "seq": kseq, "name": name_by_id.get(kid)}
            if method == "perceptual":
                guessed.append((mp, fname, key))
        result[mp] = entries

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    total = sum(len(v) for v in result.values())
    print(f"written: {OUT_PATH}")
    print(f"map entries: map1={len(result['map1'])}, "
          f"map2={len(result['map2'])}, map3={len(result['map3'])} (total {total})")
    print(f"perceptual guesses (no same-name or same-content file): {len(guessed)}")
    for mp, src, key in guessed:
        print(f"    {mp}/{src} -> {key}")
    print(f"unresolved (null): {len(nulls)}")
    for mp, src in nulls:
        print(f"    {mp}/{src}")


if __name__ == "__main__":
    main()
