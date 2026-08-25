"""徽章试炼目录与全图鉴读取服务。

试炼相关的地图、数据文件与模型路径统一放在 config.TRIALS 里；
草系沿用原来的三张地图与 map_pets1.json，火系等新试炼按各自配置加载。
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
        _json_safe(dict(trial))
        for trial in config.TRIALS
        if not trial.get("dev_only") or dev
    ]


def _json_safe(value):
    """把配置里的 set 等非 JSON 类型转成可序列化结构（set -> 排序后的 list）。"""
    if isinstance(value, set):
        return sorted(_json_safe(v) for v in value)
    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    return value


def get_trial(trial_key):
    """按 key 获取试炼定义，找不到返回 None。"""
    for trial in config.TRIALS:
        if trial.get("key") == trial_key:
            return dict(trial)
    return None


def get_trial_or_default(trial_key):
    """按 key 获取试炼定义；未知 key 回退到第一个正式试炼（草系）。"""
    trial = get_trial(trial_key)
    if trial is not None:
        return trial
    for fallback in config.TRIALS:
        if not fallback.get("dev_only"):
            return dict(fallback)
    return {}


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


_PET_ELEMENTS_CACHE: dict | None = None


def load_pet_elements():
    """读取全图鉴信息 roco_all_pets_info.json，返回 {(id, seq): [元素]}。

    键用 (id, seq) 对齐数据集：单形态 seq 为 None，多形态为形态序号。
    返回的 elements 列表第一个为主属性（如 ["光"]、["光","草"]）。
    进程内缓存，调用 invalidate_pokedex_info_cache() 可清空。
    """
    global _PET_ELEMENTS_CACHE
    if _PET_ELEMENTS_CACHE is not None:
        return _PET_ELEMENTS_CACHE

    result = {}
    try:
        with open(config.POKEDEX_INFO_JSON, "r", encoding="utf-8") as f:
            data = json.load(f)
        pets = data.get("pets", []) if isinstance(data, dict) else data
        if isinstance(pets, list):
            for pet in pets:
                if not isinstance(pet, dict):
                    continue
                try:
                    pid = int(pet.get("id", 0))
                except (TypeError, ValueError):
                    continue
                raw_seq = pet.get("seq")
                seq = int(raw_seq) if raw_seq is not None else None
                elements = list(pet.get("elements") or [])
                result[(pid, seq)] = elements
    except FileNotFoundError:
        logger.warning(f"全图鉴信息文件不存在: {config.POKEDEX_INFO_JSON}")
        result = {}
    except Exception as e:
        logger.error(f"读取全图鉴信息失败: {e}", exc_info=True)
        result = {}

    _PET_ELEMENTS_CACHE = result
    return result


def invalidate_pokedex_info_cache():
    """清空全图鉴信息缓存（roco_all_pets_info.json 更新后调用）。"""
    global _PET_ELEMENTS_CACHE
    _PET_ELEMENTS_CACHE = None
