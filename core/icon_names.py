"""图标名目录：从 map_pets1.json 读取各地图下的精灵名称。"""
import json

import config
from core.logger import logger


_map_pets_cache = None


def load_map_pets():
    """读取关联 JSON map_pets1.json（模块级缓存）。

    结构: {"map1": {"258_乌达_极夜.png": {"id": 258, "name": "乌达"}, ...}, ...}
    key 即精灵图片在 datasets.db / dataset/image 中的文件名。
    """
    global _map_pets_cache
    if _map_pets_cache is None:
        with open(config.TRIALS[0]["map_pets_json_list"], "r", encoding="utf-8") as f:
            _map_pets_cache = json.load(f)
    return _map_pets_cache


def sprite_to_file(map_name, sprite_name):
    """把精灵名反查为数据集文件名，如 "乌达_极夜" -> "258_乌达_极夜.png"。

    兼容传入精灵名（乌达_极夜）、数据集文件名（带/不带 .png 均可）。
    找不到时返回 None。
    """
    data = load_map_pets().get(map_name, {})
    if sprite_name in data:
        return sprite_name
    base = sprite_name[:-4] if sprite_name.lower().endswith(".png") else sprite_name
    if base in data:
        return base
    for fname in data:
        if fname[:-4] == base:
            return fname
        stripped = fname.split("_", 1)[1][:-4] if "_" in fname else fname[:-4]
        if stripped == base:
            return fname
    return None


def scan_icon_names():
    """从 map_pets1.json 读取所有精灵名（去掉 id 前缀与 .png 后缀）。

    返回 {"map1": ["乌达_极夜", "迪莫"], ...}
    """
    names_dict = {map_name: [] for map_name in config.TRIALS[0]["map_list"]}
    try:
        data = load_map_pets()
        for map_name in config.TRIALS[0]["map_list"]:
            for fname in data.get(map_name, {}):
                base = fname[:-4]
                if "_" in base:
                    base = base.split("_", 1)[1]
                names_dict[map_name].append(base)

        total = sum(len(v) for v in names_dict.values())
        logger.info(f"图标名扫描完成，共 {total} 个图标: " +
                    ", ".join(f"{k}={len(v)}" for k, v in names_dict.items()))
    except Exception as e:
        logger.error(f"从 map_pets1.json 扫描图标名失败: {e}", exc_info=True)
    return names_dict
