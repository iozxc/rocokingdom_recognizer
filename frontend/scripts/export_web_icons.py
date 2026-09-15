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
  assets/*              # 从 frontend/public/assets 同步的公共图片资源
  （其余 logo / hub / 资源不变）
"""
import io
import hashlib
import json
import math
import os
import re
import sys
import shutil
import sqlite3
import urllib.parse
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent.parent.parent  # RocoKingdom 根
DATASETS = ROOT / "datasets"
DB = DATASETS / "datasets.db"
POKEDEX = DATASETS / "roco_all_pets_info.json"
TRAITS_SKILLS = DATASETS / "traits_skills.json"
OUT = ROOT / "frontend" / "public-web"
# 构建缓存（node_modules 已被 gitignore）：输入没变就整段跳过重建，
# 因为 build:web 每次都会调本脚本，而拼雪碧图要 8 秒左右。
CACHE_FILE = ROOT / "frontend" / "node_modules" / ".cache" / "roco-web-icons.json"

# 识别资产由 tools/export_web_recognizer.py 产出，既不属于本脚本的输出，
# 也不能因为图鉴重建被清掉。
PRESERVE_IN_DATA = {
    "features.bin", "features.meta.json",
    "ocr_keys.json", "ocr_corrections.json",
    "recognizer-assets.json",
}


def resolve_ts_icons_src() -> Path:
    """技能/特性图标原始目录：优先仓库内的 train 数据集，缺失时回退旧路径。"""
    local = ROOT / "train" / "dataset" / "icons_ts"
    if local.exists():
        return local
    return Path(r"D:\game\RocoKingdom_Script\datasets\icons")


TS_ICONS_SRC = resolve_ts_icons_src()


# --------------------------------------------------------------------------- #
# 构建缓存：输入没变就跳过整个重建（build:web 每次都会调用本脚本）
# --------------------------------------------------------------------------- #
def _file_sha256(path: Path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(str(path), "rb") as f:
        for block in iter(lambda: f.read(chunk), b""):
            h.update(block)
    return h.hexdigest()


def _dir_fingerprint(directory: Path) -> str:
    """目录指纹：文件名 + 大小 + mtime（767 个图标做内容哈希不划算）。"""
    if not directory.exists():
        return "missing"
    h = hashlib.sha256()
    for p in sorted(directory.rglob("*")):
        if p.is_dir():
            continue
        st = p.stat()
        h.update(f"{p.relative_to(directory)}|{st.st_size}|{st.st_mtime_ns}".encode())
    return h.hexdigest()


def input_signature() -> str:
    """所有输入的内容/结构指纹：数据源、图鉴映射、公共静态资源、脚本自身。"""
    h = hashlib.sha256()
    # 1) 数据源（内容哈希：都不大，datasets.db 8.7MB）
    for p in [DB, POKEDEX, TRAITS_SKILLS, DATASETS / "glossary.json", ROOT / "config.py",
              ROOT / "version.json", ROOT / "icon.ico", Path(__file__).resolve()]:
        h.update(f"{p.name}:".encode())
        h.update((_file_sha256(p) if p.exists() else "missing").encode())
    # 2) 试炼 -> 图鉴映射（map_pets*.json）
    for p in sorted(DATASETS.glob("map_pets*.json")):
        h.update(f"{p.name}:{_file_sha256(p)}".encode())
    # 3) 技能/特性图标源目录（767 个文件）
    h.update(f"ts:{_dir_fingerprint(TS_ICONS_SRC)}".encode())
    # 4) 公共静态资源
    for d in [ROOT / "frontend" / "public" / "assets",
              ROOT / "frontend" / "public" / "elements",
              ROOT / "frontend" / "public" / "icon",
              ROOT / "resources",
              ROOT / "static"]:
        h.update(f"{d.name}:{_dir_fingerprint(d)}".encode())
    return h.hexdigest()


def _output_manifest() -> list:
    """本脚本产出的文件清单（排除识别资产），用于校验缓存是否仍然有效。"""
    items = []
    for p in sorted(OUT.rglob("*")):
        if p.is_dir():
            continue
        if p.parent.name == "data" and p.name in PRESERVE_IN_DATA:
            continue
        items.append(f"{p.relative_to(OUT)}|{p.stat().st_size}")
    return items


def _cache_hit(sig: str) -> bool:
    """输入指纹一致 + 上次记录的所有产出文件仍在且大小一致 => 可以直接跳过。"""
    try:
        with open(str(CACHE_FILE), "r", encoding="utf-8") as f:
            cache = json.load(f)
    except Exception:
        return False
    if not isinstance(cache, dict) or cache.get("inputSig") != sig:
        return False
    outputs = cache.get("outputs") or []
    if not outputs:
        return False
    for item in outputs:
        rel, _, size = str(item).rpartition("|")
        p = OUT / rel
        try:
            if not p.exists() or p.stat().st_size != int(size):
                return False
        except Exception:
            return False
    return True


def _write_cache(sig: str) -> None:
    try:
        CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(str(CACHE_FILE), "w", encoding="utf-8") as f:
            json.dump({"inputSig": sig, "outputs": _output_manifest()}, f, ensure_ascii=False)
    except Exception as e:  # noqa: BLE001
        print(f"[export_web_icons] 缓存写入失败（忽略，下次会重建）：{e}")

# ---- 雪碧图可调参数 ----
ICONS_PER_SPRITE = 100   # 每张精灵雪碧图最大格子数；387 只 → 4 张
PET_CELL = 128           # 宠物图统一 128x128
ELEM_CELL = 198          # 属性图统一 198x198
ELEM_COLS = 6            # 属性雪碧图列数（18 / 6 = 3 行）
TS_CELL = 96             # 技能/特性图标统一 96x96
TS_PER_SPRITE = 100      # 每张技能/特性雪碧图最大格子数
TS_COLS = 10             # 技能/特性雪碧图列数


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


def load_traits_skills() -> dict:
    """读取 traits_skills.json，失败回退空结构。"""
    if not TRAITS_SKILLS.exists():
        return {"traits": {}, "skills": {}}
    try:
        return json.loads(TRAITS_SKILLS.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return {"traits": {}, "skills": {}}


def resolve_pet_info(meta, traits):
    """把 map_pets 里的 trait_id / active_skills 解析成可展示对象。"""
    trait = None
    tid = meta.get("trait_id")
    if tid:
        t = (traits.get("traits") or {}).get(tid) or {}
        if t.get("name"):
            trait = {"id": tid, "name": t.get("name"), "desc": t.get("desc"), "glossary": t.get("glossary") or [], "icon_url": f"/ts_icons/{t.get("icon_id") or tid}.png"}
    skills = []
    for sid in meta.get("active_skills") or []:
        s = (traits.get("skills") or {}).get(sid) or {}
        if not s.get("name"):
            continue
        skills.append({
            "sid": sid,
            "name": s.get("name"),
            "desc": s.get("desc"),
            "skill_type": s.get("skill_type"),
            "element": s.get("element"),
            "damage_kind": s.get("damage_kind"),
            "energy_cost": s.get("energy_cost"),
            "power": s.get("power"),
            "glossary": s.get("glossary") or [],
            "icon_url": f"/ts_icons/{sid}.png",
        })
    return {"trait": trait, "skills": skills}


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
    """拷贝公共静态资源到 public-web，保证纯前端站点自包含。"""
    icons_dir.mkdir(parents=True, exist_ok=True)
    elements_dir.mkdir(parents=True, exist_ok=True)
    resources_dir.mkdir(parents=True, exist_ok=True)

    # public/assets 同时服务桌面端与 Web 端，Web 构建不能把它丢掉。
    assets_dir = OUT / "assets"
    src_assets = ROOT / "frontend" / "public" / "assets"
    if src_assets.exists():
        shutil.copytree(src_assets, assets_dir, dirs_exist_ok=True)
    else:
        assets_dir.mkdir(parents=True, exist_ok=True)

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


def build_ts_sprites(ts_src, icons_dir):
    """把技能/特性图标（Sxxx/Txxx）打包成多张雪碧图，返回 (ts_pos, sheet_meta)。"""
    files = sorted(ts_src.glob("*.png"), key=lambda p: p.stem)
    if not files:
        return {}, {}
    ts_pos = {}
    sheet_meta = {}
    sheet_count = math.ceil(len(files) / TS_PER_SPRITE)
    for sheet_idx in range(sheet_count):
        chunk = files[sheet_idx * TS_PER_SPRITE : (sheet_idx + 1) * TS_PER_SPRITE]
        images = []
        for f in chunk:
            im = Image.open(f).convert("RGBA")
            if im.size != (TS_CELL, TS_CELL):
                im = im.resize((TS_CELL, TS_CELL), Image.LANCZOS)
            images.append(im)
        cols = min(TS_COLS, max(1, len(images)))
        sheet, ccols, crows = _paste_into_sheet(images, TS_CELL, cols)
        sprite_name = f"ts-sprite-{sheet_idx + 1}.png"
        sheet.save(icons_dir / sprite_name, "PNG", optimize=True)
        sheet_meta[sprite_name] = {"cols": ccols, "rows": crows}
        for offset, f in enumerate(chunk):
            ts_pos[f.stem] = {
                "sprite": sprite_name,
                "col": offset % ccols,
                "row": offset // ccols,
            }
    return ts_pos, sheet_meta


def main():
    if not DB.exists():
        raise SystemExit(f"[export_web_icons] 找不到数据库: {DB}")

    force = ("--force" in sys.argv[1:]) or (os.environ.get("ROCO_FORCE_ICONS") == "1")
    sig = input_signature()
    if not force and _cache_hit(sig):
        print(f"[export_web_icons] 输入未变化，跳过重建（雪碧图/图鉴数据已是最新）-> {OUT}")
        return

    # 只清理本脚本生成的内容，保留 assets 等公共静态资源，避免 Web 构建反复丢文件。
    # 注意：data/ 下的识别资产（特征库/OCR 字符表/资产清单）由 tools/export_web_recognizer.py
    # 产出，不能随图鉴重建一起清掉，否则纯前端识别会报「特征库 meta 格式异常」。
    for dirname in ("data", "icons", "elements", "resources", "icon"):
        generated_dir = OUT / dirname
        if not generated_dir.exists():
            continue
        if dirname == "data":
            for child in generated_dir.iterdir():
                if child.name in PRESERVE_IN_DATA:
                    continue
                if child.is_dir():
                    shutil.rmtree(child)
                else:
                    child.unlink()
        else:
            shutil.rmtree(generated_dir)
    OUT.mkdir(parents=True, exist_ok=True)

    trials = discover_trials()
    if not trials:
        raise SystemExit("[export_web_icons] 未发现任何 map_pets*.json（含 mapN 键）")

    elements = load_pet_elements()

    icons_dir = OUT / "icons"
    data_dir = OUT / "data"
    elements_dir = OUT / "elements"
    resources_dir = OUT / "resources"
    prepare_public_assets(icons_dir, elements_dir, resources_dir)
    icon_dir = OUT / "icon"
    icon_dir.mkdir(parents=True, exist_ok=True)
    public_icon_src = ROOT / "frontend" / "public" / "icon"
    if public_icon_src.exists():
        for webp in public_icon_src.glob("*.webp"):
            shutil.copy2(webp, icon_dir / webp.name)
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
    ts_pos, ts_sheet_meta = build_ts_sprites(TS_ICONS_SRC, icons_dir)
    sprites_meta.update(elem_sheet_meta)
    sprites_meta.update(ts_sheet_meta)

    icons_structure = {}
    total_items = 0
    traits = load_traits_skills()
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
                extra = resolve_pet_info(meta, traits)
                items.append({
                    "name": _strip_id_prefix(filename),
                    "id": pet_id,
                    "seq": seq_val,
                    "elements": elements.get((pet_id, seq_val), []),
                    "url": f"/icons/{urllib.parse.quote(filename)}",
                    "sprite": cell["sprite"],
                    "col": cell["col"],
                    "row": cell["row"],
                    **extra,
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
    (data_dir / "ts_sprites.json").write_text(
        json.dumps(ts_pos, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    (data_dir / "elements.json").write_text(
        json.dumps(elements_meta, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    glossary_src = DATASETS / "glossary.json"
    if glossary_src.exists():
        shutil.copy2(glossary_src, data_dir / "glossary.json")
    db.close()

    print(
        f"[export_web_icons] 完成: {total_items} 条图鉴 / "
        f"{unique_total} 张去重精灵图 + {len(ts_pos)} 张技能/特性图 "
        f"→ {len(sprites_meta)} 张雪碧图 -> {OUT}"
    )
    _write_cache(sig)


if __name__ == "__main__":
    main()
