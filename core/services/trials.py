"""徽章试炼目录与全图鉴读取服务。

草系徽章试炼沿用原来的三张地图（map1/map2/map3）与 map_pets1.json；
火系徽章试炼没有独立地图数据，因此使用全图鉴 roco_all_pets.json 提供自选入口。
"""
import json

import config
from core.logger import logger


def available_trials():
    """返回当前环境可用的试炼列表。

    开发环境返回全部；打包环境过滤掉 dev_only 试炼（如火系）。
    """
    dev = config.is_dev_environment()
    return [
        dict(trial)
        for trial in config.TRIALS
        if not trial.get("dev_only") or dev
    ]


def get_trial(trial_key):
    """按 key 获取试炼定义，找不到返回 None。"""
    for trial in config.TRIALS:
        if trial.get("key") == trial_key:
            return dict(trial)
    return None


def load_pokedex():
    """读取全图鉴 roco_all_pets.json，返回 [{"id": 1, "name": "迪莫"}, ...]。"""
    try:
        with open(config.ALL_PETS_JSON, "r", encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        logger.warning(f"全图鉴文件不存在: {config.ALL_PETS_JSON}")
        return []
    except Exception as e:
        logger.error(f"读取全图鉴失败: {e}", exc_info=True)
        return []

    pets = data.get("pets", []) if isinstance(data, dict) else data
    if not isinstance(pets, list):
        return []

    result = []
    for pet in pets:
        if not isinstance(pet, dict):
            continue
        name = str(pet.get("name") or "").strip()
        if not name:
            continue
        try:
            pet_id = int(pet.get("id", 0))
        except (TypeError, ValueError):
            pet_id = 0
        result.append({"id": pet_id, "name": name})
    return result

