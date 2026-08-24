# -*- coding: utf-8 -*-
"""生成精灵改名映射 pet_renames.json（叠加到已有 renames 上）。

对比 icons_only 三个 map 的旧文件名与 dataset/image 的新文件名：
同一张图（按内容 md5 / 同名 / 感知哈希配对）在新库里改了名字时，
生成 {旧名: 新名}，去掉新名的数字 id 前缀，但保留 _后缀。

输出叠加到项目根目录 pet_renames.json 的 "renames" 字段（保留原条目）。
感知哈希猜出的配对会单独打印出来供人工复核。
"""

import json
import os
import re
import sys
from collections import defaultdict
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from train.build_map_pets_json import (  # noqa: E402
    build_dataset_index,
    dhash,
    file_md5,
    hamming,
    load_pet_names,
    pick_by_name,
    resolve_pet,
)

ROOT = Path(__file__).resolve().parent
PIC = ROOT / "assets" / "pic" / "icons_only"
DATASET = ROOT / "dataset" / "image"
RENAMES_FILE = PROJECT_ROOT / "pet_renames.json"
MAPS = ["map1", "map2", "map3"]

_ID_RE = re.compile(r"^\d+_(.*)$")


def strip_id(name):
    m = _ID_RE.match(name)
    return m.group(1) if m else name


def main():
    name_by_id = load_pet_names()
    pet_names = {name: pid for pid, name in name_by_id.items()}
    ds = build_dataset_index()
    by_hash = defaultdict(list)
    by_rest = defaultdict(list)
    by_pid = defaultdict(list)
    for fname, (pid, rest, h, _) in ds.items():
        by_hash[h].append(fname)
        by_rest[rest].append(fname)
        by_pid[pid].append(fname)

    renames = {}
    conflicts = defaultdict(list)
    perceptual = []

    for mp in MAPS:
        mdir = PIC / mp
        if not mdir.is_dir():
            print(f"跳过 {mp}：目录不存在 {mdir}")
            continue
        for fname in sorted(os.listdir(mdir)):
            if not fname.lower().endswith(".png"):
                continue
            rest = os.path.splitext(fname)[0]
            pid, _ = resolve_pet(rest, pet_names)
            path = mdir / fname
            h = file_md5(str(path))

            key = None
            method = None
            if by_hash.get(h):
                key = pick_by_name(rest, by_hash[h])
                method = "content"
            elif by_rest.get(rest):
                key = by_rest[rest][0]
                method = "name"
            elif pid is not None and by_pid.get(pid):
                target = dhash(str(path))
                key = min(by_pid[pid], key=lambda f: hamming(target, ds[f][3]))
                method = "perceptual"
            if key is None:
                continue

            new_name = strip_id(os.path.splitext(key)[0])
            if rest == new_name:
                continue

            if rest in renames and renames[rest] != new_name:
                conflicts[rest].append((renames[rest], new_name, mp))
            renames[rest] = new_name
            if method == "perceptual":
                dist = hamming(dhash(str(path)), ds[key][3])
                perceptual.append((rest, new_name, dist, mp))

    if conflicts:
        print("冲突（同一旧名对应不同新名），已保留先出现的：")
        for k, v in conflicts.items():
            print(f"    {k}: {v}")

    with open(RENAMES_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)
    existing = data.get("renames", {}) or {}
    merged = dict(existing)
    for k in renames:
        merged[k] = renames[k]
    data["renames"] = dict(sorted(merged.items()))

    with open(RENAMES_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"写入: {RENAMES_FILE}")
    print(f"原 renames: {len(existing)} 条，本次新增 {len(renames)} 条，合并后 {len(merged)} 条")
    print()
    print("--- 新增条目（旧名 -> 新名）---")
    for k in sorted(renames):
        print(f"    {k!r} -> {renames[k]!r}")
    if perceptual:
        print()
        print("--- 感知哈希猜测（无同名/同内容文件，请人工复核）---")
        for old, new, dist, mp in perceptual:
            print(f"    {old!r} -> {new!r}  (hamming={dist}, {mp})")


if __name__ == "__main__":
    main()
