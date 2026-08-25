# -*- coding: utf-8 -*-
"""Extract all uniquely-named pet sprite images into train/dataset/image.

Source layout:
    train/features/assets/pic/icons_only/map1|map2|map3/*.png

Each image is copied once (duplicates across maps are skipped, map1 takes
priority) and renamed with its pet id from roco_all_pets_info.json:

    乌达_极夜.png  ->  258_乌达_极夜.png

Images whose name cannot be matched to any pet in the JSON are copied without
a numeric prefix and reported separately.
"""

import argparse
import json
import os
import shutil
import sys
from collections import Counter


def load_pets(json_path):
    with open(json_path, encoding="utf-8") as f:
        data = json.load(f)
    pets = data["pets"]
    seen = set()
    unique_pets = []
    name_to_id = {}
    for p in pets:
        name = p["name"]
        if name in seen:
            continue
        seen.add(name)
        unique_pets.append(p)
        name_to_id[p["name"]] = p["id"]
    return unique_pets, name_to_id


def match_pet_id(filename, name_to_id):
    """Return the pet id for an image filename, or None.

    Match rules, in order:
      1. exact name match        (乌达.png      -> 乌达)
      2. prefix + "_" form match (乌达_极夜.png -> 乌达)
      3. substring form match    (叶冕魔力猫.png -> 魔力猫, longest name wins)
    """
    base, _ = os.path.splitext(filename)
    if base in name_to_id:
        return name_to_id[base]
    hits = [name for name in name_to_id if base.startswith(name + "_")]
    if hits:
        return name_to_id[max(hits, key=len)]
    hits = [name for name in name_to_id if name in base]
    if hits:
        return name_to_id[max(hits, key=len)]
    return None


def collect_unique_files(map_dirs):
    """Deduplicate by filename; earlier map dirs take priority."""
    seen = {}
    source_of = {}
    for mdir in map_dirs:
        for name in sorted(os.listdir(mdir)):
            full = os.path.join(mdir, name)
            if not os.path.isfile(full):
                continue
            if name not in seen:
                seen[name] = mdir
                source_of[name] = full
    return source_of


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pic-root", default=os.path.join(
        os.path.dirname(__file__), "features", "assets", "pic", "icons_only"))
    parser.add_argument("--maps", nargs="+", default=["map1", "map2", "map3"])
    parser.add_argument("--json", default=os.path.join(
        os.path.dirname(os.path.dirname(__file__)), "datasets", "roco_all_pets_info.json"))
    parser.add_argument("--out", default=os.path.join(
        os.path.dirname(__file__), "dataset", "image"))
    args = parser.parse_args()

    pets, name_to_id = load_pets(args.json)
    map_dirs = [os.path.join(args.pic_root, m) for m in args.maps]
    for mdir in map_dirs:
        if not os.path.isdir(mdir):
            print(f"ERROR: source map dir not found: {mdir}", file=sys.stderr)
            sys.exit(1)

    os.makedirs(args.out, exist_ok=True)
    files = collect_unique_files(map_dirs)

    copied = 0
    skipped = 0
    unmatched = []
    found_ids = set()
    name_used = Counter()

    for name in sorted(files):
        pid = match_pet_id(name, name_to_id)
        out_name = f"{pid}_{name}" if pid is not None else name
        out_path = os.path.join(args.out, out_name)
        if os.path.exists(out_path):
            # Same target already written (e.g. same id + same sprite name).
            skipped += 1
            continue
        shutil.copy2(files[name], out_path)
        copied += 1
        if pid is not None:
            found_ids.add(pid)
        else:
            unmatched.append(name)

    missing = [(p["id"], p["name"]) for p in pets if p["id"] not in found_ids]

    print(f"source maps : {', '.join(map_dirs)}")
    print(f"output dir  : {args.out}")
    print(f"unique sprites found : {len(files)}")
    print(f"copied               : {copied}")
    print(f"skipped (dup target) : {skipped}")
    print(f"no id in JSON (copied without prefix): {len(unmatched)}")
    for name in unmatched:
        print(f"    {name}")
    print(f"missing ids ({len(missing)}):")
    for pid, pname in missing:
        print(f"    {pid} {pname}")


if __name__ == "__main__":
    main()
