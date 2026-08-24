"""图标名目录：按试炼读取对应 map_pets JSON 下的精灵名称。"""
import json

import config
from core.logger import logger
from core.services.trials import get_trial_or_default


_map_pets_cache = {}


def load_map_pets(trial_key="grass"):
    """读取指定试炼的关联 JSON（模块级缓存，按试炼隔离）。

    结构: {"map1": {"258_乌达_极夜.png": {"id": 258, "name": "乌达"}, ...}, ...}
    key 即精灵图片在 datasets.db / dataset/image 中的文件名。
    """
    if trial_key in _map_pets_cache:
        return _map_pets_cache[trial_key]

    trial = get_trial_or_default(trial_key)
    path = trial.get("map_pets_json_list")
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        logger.warning(f"试炼 {trial_key} 的地图数据不存在: {path}，返回空结构")
        data = {}
    except Exception as e:
        logger.error(f"读取试炼 {trial_key} 地图数据失败 {path}: {e}", exc_info=True)
        data = {}
    _map_pets_cache[trial_key] = data
    return data


def sprite_to_file(map_name, sprite_name, trial_key="grass"):
    """把精灵名反查为数据集文件名，如 "乌达_极夜" -> "258_乌达_极夜.png"。

    兼容传入精灵名（乌达_极夜）、数据集文件名（带/不带 .png 均可）。
    找不到时返回 None。
    """
    data = load_map_pets(trial_key).get(map_name, {})
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


def sprite_to_file_any(sprite_name, trial_key="grass"):
    """跨该试炼的所有地图反查数据集文件名（图标访问不再受地图约束）。"""
    data = load_map_pets(trial_key)
    for map_name in data:
        found = sprite_to_file(map_name, sprite_name, trial_key)
        if found:
            return found
    return None


def scan_icon_names(trial_key="grass"):
    """读取指定试炼的所有精灵名（去掉 id 前缀与 .png 后缀）。

    返回 {"map1": ["乌达_极夜", "迪莫"], ...}
    """
    trial = get_trial_or_default(trial_key)
    names_dict = {map_name: [] for map_name in trial.get("map_list", [])}
    try:
        data = load_map_pets(trial_key)
        for map_name in trial.get("map_list", []):
            for fname in data.get(map_name, {}):
                base = fname[:-4]
                if "_" in base:
                    base = base.split("_", 1)[1]
                names_dict[map_name].append(base)

        total = sum(len(v) for v in names_dict.values())
        logger.info(f"图标名扫描完成，共 {total} 个图标: " +
                    ", ".join(f"{k}={len(v)}" for k, v in names_dict.items()))
    except Exception as e:
        logger.error(f"试炼 {trial_key} 扫描图标名失败: {e}", exc_info=True)
    return names_dict
