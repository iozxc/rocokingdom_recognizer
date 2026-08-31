#!/usr/bin/env python3
"""导出【纯前端图鉴版】所需的静态资源到 frontend/public-web/。

纯前端部署（Vercel）无法运行 Flask/Python/ONNX/SQLite，所以把：
  - 图中列表 map1/map2/map3（含 id/seq/name/elements/url）
  - 精灵 PNG（datasets.db 的 icons.data BLOB）
一次性导出为静态文件，供 `vite build --mode web` 使用。

输出目录与桌面构建完全隔离：
  frontend/public-web/data/icons.json   <- 图鉴数据（url 指向 /icons/<file>）
  frontend/public-web/icons/*.png       <- 精灵图片

只影响 web 构建，不会进入桌面 dist/ 与 static/，不改变原项目体积与行为。
"""

import json
import re
import shutil
import sqlite3
import urllib.parse
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent.parent  # RocoKingdom 根
DATASETS = ROOT / "datasets"
DB = DATASETS / "datasets.db"
MAP_PETS = DATASETS / "map_pets1.json"
POKEDEX = DATASETS / "roco_all_pets_info.json"
OUT = ROOT / "frontend" / "public-web"

MAP_KEYS = ["map1", "map2", "map3"]


def _split_pet_filename(filename: str):
    """复刻 core/pet_path.split_pet_filename 的解析逻辑。"""
    name = str(filename).strip()
    m = re.match(r"^(\d{1,4})_(?:(\d{1,3})_)?(.+)\.(png|jpg|jpeg|webp|gif|bmp|svg)$", name)
    if m:
        return {"id": int(m.group(1)), "seq": int(m.group(2)) if m.group(2) else None,
                "name": m.group(3), "ext": m.group(4)}
    m = re.match(r"^(\d{1,4})_(?:(\d{1,3})_)?(.+)$", name)
    if m:
        return {"id": int(m.group(1)), "seq": int(m.group(2)) if m.group(2) else None,
                "name": m.group(3), "ext": None}
    bare = re.sub(r"\.(png|jpg|jpeg|webp|gif|bmp|svg)$", "", name)
    return {"id": None, "seq": None, "name": bare or name, "ext": None}


def _strip_id_prefix(name: str) -> str:
    """复刻 core/utils.strip_id_prefix：去掉 <id>_<seq>_ 前缀，保留展示名与扩展名。"""
    info = _split_pet_filename(name)
    if info and info["id"] is not None:
        return (info["name"] or "") + ("." + info["ext"] if info.get("ext") else "")
    m = re.match(r"^\d+_(.*)$", name)
    return m.group(1) if m else name


def _sort_key(filename: str):
    """复刻 core/pet_path.sort_key：按 id、形态序号、名字排序。"""
    info = _split_pet_filename(filename)
    if not info:
        return (1 << 30, 0, filename)
    return (info["id"] if info["id"] is not None else (1 << 30),
            info["seq"] if info["seq"] is not None else 0,
            info["name"] or "")


def load_pet_elements() -> dict:
    """复刻 core/services/trials.load_pet_elements：{(id, seq): [元素]}。"""
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


def prepare_public_assets():
    """把首页会引用到的根级静态资源拷到 public-web，保证纯前端站点自包含。

    - elements/*.png：属性图标（git 跟踪）
    - icon.jpg / tag_1.png：站内 logo 与 hub 卡片图（通常位于 static/，本地存在则拷贝；
      若缺失，icon.jpg 尝试用 icon.ico 生成，tag_1.png 缺失不影响首页主体功能）
    """
    icons_dir = OUT / "icons"
    elements_dir = OUT / "elements"
    resources_dir = OUT / "resources"
    icons_dir.mkdir(parents=True, exist_ok=True)
    elements_dir.mkdir(parents=True, exist_ok=True)
    resources_dir.mkdir(parents=True, exist_ok=True)

    # 1) 属性图标（来源：frontend/public/elements，git 已跟踪）
    src_elements = ROOT / "frontend" / "public" / "elements"
    if src_elements.exists():
        for f in src_elements.glob("*.png"):
            shutil.copy2(f, elements_dir / f.name)

    # 2) 站内 logo / hub 图（来源：static/）
    static_dir = ROOT / "static"
    for name in ("icon.jpg", "tag_1.png"):
        src = static_dir / name
        if src.exists():
            shutil.copy2(src, OUT / name)

    # 3) 联系方式 / 版本 / 二维码（供 web 版“群聊反馈 / 下载APP”使用）
    resource_dir = ROOT / "resources"
    if resource_dir.exists():
        for name in ("chat.json",):
            src = resource_dir / name
            if src.exists():
                shutil.copy2(src, resources_dir / name)
        # 只拷群二维码（其它大图如 README 配图在 web 版用不到）
        for f in resource_dir.glob("qrcode_*.png"):
            shutil.copy2(f, resources_dir / f.name)

    # 4) 版本信息（含镜像下载地址） -> resources/version.json
    ver_json = ROOT / "version.json"
    if ver_json.exists():
        shutil.copy2(ver_json, resources_dir / "version.json")

    # 3) 若 icon.jpg 缺失，尝试从 icon.ico 生成一张（用 PIL，缺失则忽略）
    icon_jpg = OUT / "icon.jpg"
    if not icon_jpg.exists():
        try:
            from PIL import Image
            ico = ROOT / "icon.ico"
            if ico.exists():
                im = Image.open(ico).convert("RGB")
                im.save(icon_jpg, "JPEG", quality=92)
                print("[export_web_icons] 已从 icon.ico 生成 icon.jpg")
        except Exception as e:  # noqa: BLE001
            print(f"[export_web_icons] 生成 icon.jpg 跳过: {e}")


def main():
    if not DB.exists():
        raise SystemExit(f"[export_web_icons] 找不到数据库: {DB}")

    # 先清空再生成，保证 public-web 是干净、可复现的快照（避免旧文件残留）。
    if OUT.exists():
        shutil.rmtree(OUT)

    map_pets = json.loads(MAP_PETS.read_text(encoding="utf-8"))
    elements = load_pet_elements()

    prepare_public_assets()

    icons_dir = OUT / "icons"
    data_dir = OUT / "data"
    icons_dir.mkdir(parents=True, exist_ok=True)
    data_dir.mkdir(parents=True, exist_ok=True)

    db = sqlite3.connect(str(DB))
    cur = db.cursor()

    icons_structure = {}
    total = 0
    for map_name in MAP_KEYS:
        entries = map_pets.get(map_name, {})
        items = []
        for filename in sorted(entries.keys(), key=_sort_key):
            meta = entries[filename]
            pet_id = meta.get("id")
            seq_val = meta.get("seq")
            pet_id = int(pet_id) if pet_id is not None else None
            seq_val = int(seq_val) if seq_val is not None else None

            db_path = filename[:-4] if filename.lower().endswith(".png") else filename
            row = cur.execute("SELECT data FROM icons WHERE path = ?", (db_path,)).fetchone()
            if row is None:
                print(f"[export_web_icons] 警告: 数据库缺少 {filename}，跳过")
                continue

            png = row[0]
            (icons_dir / filename).write_bytes(png)

            items.append({
                "name": _strip_id_prefix(filename),
                "id": pet_id,
                "seq": seq_val,
                "elements": elements.get((pet_id, seq_val), []),
                # 用 URL 编码后的路径，保证中文文件名在静态托管下能正确命中
                "url": f"/icons/{urllib.parse.quote(filename)}",
            })
            total += 1

        icons_structure[map_name] = {"count": len(items), "items": items}

    (data_dir / "icons.json").write_text(
        json.dumps(icons_structure, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    db.close()

    print(f"[export_web_icons] 完成: 共导出 {total} 只精灵 -> {OUT}")


if __name__ == "__main__":
    main()
