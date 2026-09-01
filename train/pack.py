"""把精灵图片目录（train/dataset/image）打包进 SQLite 数据库（datasets/datasets.db）。

数据集文件名采用统一新命名：
    单形态： <id>_<名字>.png            例：002_喵喵.png
    多形态： <id>_<形态序号>_<名字>.png   例：001_01_迪莫.png

icons 表字段：
    path  TEXT PRIMARY KEY  去扩展名的数据集路径（保留形态序号），如 '001_01_迪莫'
    data  BLOB              图片二进制
    id    INTEGER           精灵图鉴 id（前端排序/识别用）
    seq   INTEGER           形态序号（同 id 多形态；单形态为 NULL）
    name  TEXT              精灵展示名（已去掉 id 前缀与形态序号）

这样前端可直接读取 id/seq/name 并按 (id, seq) 排序展示，无需再解析文件名。
"""
import os
import sqlite3
import sys
from pathlib import Path

# 本文件位于 <项目根>/train/pack.py，因此项目根是上上级目录。
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))
# train 目录作为包导入所需
if str(Path(__file__).resolve().parent) not in sys.path:
    sys.path.insert(0, str(Path(__file__).resolve().parent))

import train_config  # noqa: E402

from core.infra.pet_path import split_pet_filename  # noqa: E402


def build_assets_db(source_dir, db_path):
    """遍历 source_dir 下所有图片，按新命名解析并打包进 db_path。"""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    cursor.execute("DROP TABLE IF EXISTS icons")
    cursor.execute(
        """
        CREATE TABLE icons
        (
            path TEXT PRIMARY KEY,
            data BLOB,
            id INTEGER,
            seq INTEGER,
            name TEXT
        )
        """
    )

    count = 0
    skipped = 0
    for root, _dirs, files in os.walk(source_dir):
        for file in files:
            if not file.lower().endswith((".png", ".jpg", ".jpeg")):
                continue
            full_path = os.path.join(root, file)
            rel_path = os.path.relpath(full_path, source_dir).replace("\\", "/")
            # 去扩展名作为 path（保留形态序号），如 '001_01_迪莫'
            stem = os.path.splitext(rel_path)[0]

            info = split_pet_filename(stem)
            if info is None or info.get("id") is None:
                skipped += 1
                print(f"  ! 跳过（无法解析 id）: {file}")
                continue

            with open(full_path, "rb") as f:
                img_data = f.read()
            cursor.execute(
                "INSERT INTO icons (path, data, id, seq, name) VALUES (?, ?, ?, ?, ?)",
                (stem, img_data, info["id"], info["seq"], info["name"]),
            )
            count += 1

    conn.commit()
    conn.close()
    print(f"成功打包 {count} 张图片到 {db_path}（跳过 {skipped} 张无法解析的）")
    return count


if __name__ == "__main__":
    # 执行打包：将 train/dataset/image 目录打包进 app 读取的 datasets/datasets.db
    # 同时同步一份到 train/dataset/datasets.db，保持两处一致。
    n1 = build_assets_db(train_config.DATASET_PATH, train_config.DATASET_DB)
    n2 = build_assets_db(train_config.DATASET_PATH, train_config.DATASET_DB_TRAIN)
    print(f"app库: {train_config.DATASET_DB}（{n1} 张）")
    print(f"训练库: {train_config.DATASET_DB_TRAIN}（{n2} 张）")
