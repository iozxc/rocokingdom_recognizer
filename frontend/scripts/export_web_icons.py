#!/usr/bin/env python3
"""导出【纯前端图鉴版】静态资源到 frontend/public-web/，并把精灵图与属性图合并成雪碧图，
以大幅减少 web 端一次性发出的图片 HTTP 请求（由几百张降为个位数）。

只影响 web 构建，不会进入桌面 dist/ 与 static/，不改变原项目体积与行为。

输出目录 frontend/public-web/：
  data/icons.json       # 图鉴数据（每个精灵带雪碧图坐标 sprite/col/row）
  data/sprites.json     # 雪碧图元信息（每张的 cols/rows，供前端算出 object-position）
  data/elements.json    # 18 系别属性图在雪碧图上的坐标
  icons/sprite-1..N.png # 精灵雪碧图（ICONS_PER_SPRITE=100 → 当前 387 只 ≈ 4 张）
  icons/elements-sprite.png  # 属性雪碧图（6 列 × 3 行 = 18 格）
  elements/*.png        # 保留单张属性图（桌面/兜底用）
  （其余 logo / hub / 资源不变）
"""
import io
import json
import math
import os
import re
import shutil
import sqlite3
import urllib.parse
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent.parent.parent  # RocoKingdom 根
DATASETS = ROOT / "datasets"
DB = DATASETS / "datasets.db"
POKEDEX = DATASETS / "roco_all_pets_info.json"
OUT = ROOT / "frontend" / "public-web"

# ---- 雪碧图可调参数 ----
ICONS_PER_SPRITE = 100   # 每张精灵雪碧图最大格子数；387 只 → 4 张
PET_CELL = 128           # 宠物图统一 128x128
ELEM_CELL = 198          # 属性图统一 198x198
ELEM_COLS = 6            # 属性雪碧图列数（18 / 6 = 3 行）


def _split_pet_filename(filename: str):
    """复刻 core/pet_path.split_pet_filename 的解析逻辑。"""
    name = str(filename).strip()
    m = re.match(r"^(\d{1,4})_(?:(\d{1,3})_)?(.+)\.(png|jpg|jpeg|webp|gif|bmp|svg)$", name)
    if m:
        return {
            "id": int(m.group(1)),
            "seq": int(m.group(2)) if m.group(2) else None,
            "name": m.group(3),
            "ext": m.group(4),
        }
    bare = re.sub(r"\.(png|jpg|jpeg|webp|gif|bmp|svg)$", "", name)
    return {"id": None, "seq": None, "name": bare or name, "ext": None}


def _strip_id_prefix(name: str) -> str:
    """去掉 <id>_<seq>_ 前缀，保留展示名与扩展名。"""
    info = _split_pet_filename(name)
    if info and info["id"] is not None:
        return (info["name"] or "") + ("." + info["ext"] if info.get("ext") else "")
    m = re.match(r"^\d+_(.*)$", name)
    return m.group(1) if m else name


def _sort_key(filename: str):
    """按 id、形态序号、名字排序。"""
    info = _split_pet_filename(filename)
    if not info:
        return (1 << 30, 0, filename)
    return (
        info["id"] if info["id"] is not None else (1 << 30),
        info["seq"] if info["seq"] is not None else 0,
        info["name"] or "",
    )


def load_pet_elements() -> dict:
    """{(id, seq): [元素]}。"""
    data = json.loads(POKEDEX.read_text(encoding="utf-8"))
    pets = data.get("pets", []) if isinstance(data, dict) else data
    result = {}
    for pet in pets:
        if not isinstance(pet, dict):
            continue
        try:
            pid = int(pet.get("id", 0))
        except (TypeError, ValueError):
            continue
        raw_seq = pet.get("seq")
        seq = int(raw_seq) if raw_seq is not None else None
        result[(pid, seq)] = list(pet.get("elements") or [])
    return result


def discover_trials() -> list:
    """通过 config.TRIALS 建立【试炼 key -> map_pets*.json】的映射。

    每个试炼在 config.TRIALS 里声明了 key 与 map_pets_json_list（指向它自己的 map_petsN.json）。
    例：grass -> datasets/map_pets1.json；未来水系试炼 -> map_pets2.json。
    不同试炼的 mapN 是不同的事物，绝不合并。

    返回: [{"key": "grass", "maps": {"map1": {...}, "map2": {...}, "map3": {...}}}, ...]
    key 与前端 getTrials / config.TRIALS 里的试炼 key 完全一致。
    """
    trials: list = []
    try:
        import sys
        sys.path.insert(0, str(ROOT))
        # config.get_resource_path 依赖 os.path.abspath(".")（cwd），
        # 这里切到项目根，保证 config.TRIALS 里的 map_pets_json_list 路径正确。
        os.chdir(ROOT)
        import config as _cfg

        for trial in _cfg.TRIALS:
            if trial.get("pets_source") != "map_pets":
                continue
            key = trial.get("key")
            fn = trial.get("map_pets_json_list")
            if not key or not fn or not Path(fn).exists():
                continue
            data = json.loads(Path(fn).read_text(encoding="utf-8"))
            maps = {k: v for k, v in data.items() if re.match(r"^map\d+$", k)}
            if not maps:
                continue
            maps = {k: maps[k] for k in sorted(maps, key=lambda x: int(x[3:]))}
            trials.append({"key": key, "maps": maps})
        if trials:
            return trials
    except Exception as e:  # noqa: BLE001
        print(f"[export_web_icons] config.TRIALS 读取失败，回退到文件名编号: {e}")

    # 兜底：按 map_pets*.json 文件名编号 tN（正常不会走到）
    for f in sorted(DATASETS.glob("map_pets*.json")):
        data = json.loads(f.read_text(encoding="utf-8"))
        maps = {k: v for k, v in data.items() if re.match(r"^map\d+$", k)}
        if not maps:
            continue
        maps = {k: maps[k] for k in sorted(maps, key=lambda x: int(x[3:]))}
        m = re.search(r"map_pets(\d+)\.json$", f.name)
        trial_key = f"t{m.group(1)}" if m else f.stem
        trials.append({"key": trial_key, "maps": maps})
    return trials


def prepare_public_assets(icons_dir, elements_dir, resources_dir):
    """拷贝根级静态资源到 public-web，保证纯前端站点自包含。"""
    icons_dir.mkdir(parents=True, exist_ok=True)
    elements_dir.mkdir(parents=True, exist_ok=True)
    resources_dir.mkdir(parents=True, exist_ok=True)

    src_elements = ROOT / "frontend" / "public" / "elements"
    if src_elements.exists():
        for f in src_elements.glob("*.png"):
            shutil.copy2(f, elements_dir / f.name)

    static_dir = ROOT / "static"
    for name in ("icon.jpg", "tag_1.png"):
        src = static_dir / name
        if src.exists():
            shutil.copy2(src, OUT / name)

    resource_dir = ROOT / "resources"
    if resource_dir.exists():
        for name in ("chat.json",):
            src = resource_dir / name
            if src.exists():
                shutil.copy2(src, resources_dir / name)
        for f in resource_dir.glob("qrcode_*.png"):
            shutil.copy2(f, resources_dir / f.name)

    ver_json = ROOT / "version.json"
    if ver_json.exists():
        shutil.copy2(ver_json, resources_dir / "version.json")

    icon_jpg = OUT / "icon.jpg"
    if not icon_jpg.exists():
        try:
            ico = ROOT / "icon.ico"
            if ico.exists():
                Image.open(ico).convert("RGB").save(icon_jpg, "JPEG", quality=92)
                print("[export_web_icons] 已从 icon.ico 生成 icon.jpg")
        except Exception as e:  # noqa: BLE001
            print(f"[export_web_icons] 生成 icon.jpg 跳过: {e}")


def _paste_into_sheet(images, cell, cols):
    """把 images 按 cols 列拼成一张雪碧图，返回 (sheet, cols, rows)。"""
    if not images:
        raise ValueError("没有可打包的图片")
    rows = math.ceil(len(images) / cols)
    sheet = Image.new("RGBA", (cols * cell, rows * cell), (0, 0, 0, 0))
    for idx, im in enumerate(images):
        c, r = idx % cols, idx // cols
        sheet.paste(im, (c * cell, r * cell))
    return sheet, cols, rows


def build_pet_sprites(cur, all_filenames, icons_dir):
    """把去重后的宠物图打包成多张雪碧图，返回 (pos, sprites_meta, unique_total)。"""
    unique_paths = []
    seen = set()
    for fn in all_filenames:
        db_path = fn[:-4] if fn.lower().endswith(".png") else fn
        if db_path not in seen:
            seen.add(db_path)
            unique_paths.append(db_path)

    blobs = {}
    for db_path in unique_paths:
        row = cur.execute("SELECT data FROM icons WHERE path = ?", (db_path,)).fetchone()
        if row is None:
            print(f"[export_web_icons] 警告: 数据库缺少 {db_path}，跳过")
            continue
        blobs[db_path] = row[0]

    ordered = sorted(blobs.keys())
    pos = {}
    sprites_meta = {}
    total = len(ordered)
    sheet_count = math.ceil(total / ICONS_PER_SPRITE)
    for sheet_idx in range(sheet_count):
        chunk = ordered[sheet_idx * ICONS_PER_SPRITE : (sheet_idx + 1) * ICONS_PER_SPRITE]
        images = []
        for db_path in chunk:
            im = Image.open(io.BytesIO(blobs[db_path])).convert("RGBA")
            if im.size != (PET_CELL, PET_CELL):
                im = im.resize((PET_CELL, PET_CELL), Image.LANCZOS)
            images.append(im)
        cols = min(10, max(1, len(images)))
        sheet, ccols, crows = _paste_into_sheet(images, PET_CELL, cols)
        sprite_name = f"sprite-{sheet_idx + 1}.png"
        sheet.save(icons_dir / sprite_name, "PNG", optimize=True)
        sprites_meta[sprite_name] = {"cols": ccols, "rows": crows}
        for offset, db_path in enumerate(chunk):
            pos[db_path] = {
                "sprite": sprite_name,
                "col": offset % ccols,
                "row": offset // ccols,
            }
    return pos, sprites_meta, total


def build_elements_sprite(elements_dir, icons_dir):
    """把属性图打包成一张 elements-sprite.png，返回 (elements_meta, sheet_meta)。"""
    src_elements = ROOT / "frontend" / "public" / "elements"
    files = sorted([f for f in src_elements.glob("*.png")])
    images = []
    names = []
    for f in files:
        im = Image.open(f).convert("RGBA")
        if im.size != (ELEM_CELL, ELEM_CELL):
            im = im.resize((ELEM_CELL, ELEM_CELL), Image.LANCZOS)
        images.append(im)
        names.append(f.stem)
    if not images:
        return {}, {}
    sheet, ccols, crows = _paste_into_sheet(images, ELEM_CELL, ELEM_COLS)
    sprite_name = "elements-sprite.png"
    sheet.save(icons_dir / sprite_name, "PNG", optimize=True)
    elements_meta = {
        nm: {"sprite": sprite_name, "col": i % ccols, "row": i // ccols}
        for i, nm in enumerate(names)
    }
    sheet_meta = {sprite_name: {"cols": ccols, "rows": crows}}
    return elements_meta, sheet_meta


def main():
    if not DB.exists():
        raise SystemExit(f"[export_web_icons] 找不到数据库: {DB}")

    if OUT.exists():
        shutil.rmtree(OUT)

    trials = discover_trials()
    if not trials:
        raise SystemExit("[export_web_icons] 未发现任何 map_pets*.json（含 mapN 键）")

    elements = load_pet_elements()

    icons_dir = OUT / "icons"
    data_dir = OUT / "data"
    elements_dir = OUT / "elements"
    resources_dir = OUT / "resources"
    prepare_public_assets(icons_dir, elements_dir, resources_dir)
    data_dir.mkdir(parents=True, exist_ok=True)

    db = sqlite3.connect(str(DB))
    cur = db.cursor()

    all_filenames = []
    for trial in trials:
        for map_name in trial["maps"]:
            for filename in trial["maps"][map_name].keys():
                all_filenames.append(filename)

    pos, sprites_meta, unique_total = build_pet_sprites(cur, all_filenames, icons_dir)
    elements_meta, elem_sheet_meta = build_elements_sprite(elements_dir, icons_dir)
    sprites_meta.update(elem_sheet_meta)

    icons_structure = {}
    total_items = 0
    for trial in trials:
        maps = {}
        for map_name in trial["maps"]:
            items = []
            for filename in sorted(trial["maps"][map_name].keys(), key=_sort_key):
                meta = trial["maps"][map_name][filename]
                pet_id = meta.get("id")
                seq_val = meta.get("seq")
                pet_id = int(pet_id) if pet_id is not None else None
                seq_val = int(seq_val) if seq_val is not None else None
                db_path = filename[:-4] if filename.lower().endswith(".png") else filename
                cell = pos.get(db_path)
                if cell is None:
                    continue
                items.append({
                    "name": _strip_id_prefix(filename),
                    "id": pet_id,
                    "seq": seq_val,
                    "elements": elements.get((pet_id, seq_val), []),
                    "url": f"/icons/{urllib.parse.quote(filename)}",
                    "sprite": cell["sprite"],
                    "col": cell["col"],
                    "row": cell["row"],
                })
                total_items += 1
            maps[map_name] = {"count": len(items), "items": items}
        icons_structure[trial["key"]] = maps

    (data_dir / "icons.json").write_text(
        json.dumps(icons_structure, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    (data_dir / "sprites.json").write_text(
        json.dumps(sprites_meta, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    (data_dir / "elements.json").write_text(
        json.dumps(elements_meta, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    db.close()

    print(
        f"[export_web_icons] 完成: {total_items} 条图鉴 / "
        f"{unique_total} 张去重精灵图 → {len(sprites_meta)} 张雪碧图 -> {OUT}"
    )


if __name__ == "__main__":
    main()
