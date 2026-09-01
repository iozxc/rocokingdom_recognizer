"""图标名目录：按试炼读取对应 map_pets JSON 下的精灵名称。"""
import json
import re

import config
from core.infra.logger import logger
from core.infra.pet_path import format_display_name, split_pet_filename, sort_key
from core.services.trials import get_trial_or_default, trial_has_map_pets_file


_map_pets_cache = {}


def load_map_pets(trial_key="grass"):
    """读取指定试炼的关联 JSON（模块级缓存，按试炼隔离）。

    结构: {"map1": {"258_乌达_极夜.png": {"id": 258, "name": "乌达"}, ...}, ...}
    key 即精灵图片在 datasets.db / dataset/image 中的文件名。
    数据更新由 data_updater 负责，这里只读本地文件。
    """
    if trial_key in _map_pets_cache:
        return _map_pets_cache[trial_key]

    trial = get_trial_or_default(trial_key)
    data = _read_local_map_pets(trial.get("map_pets_json_list"), trial_key)
    _map_pets_cache[trial_key] = data
    return data


def _read_local_map_pets(path, trial_key):
    """读取试炼关卡-精灵 JSON 文件（map_petsN.json，按图1-3组织）；失败返回空 dict。"""
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        logger.warning(f"试炼 {trial_key} 的本地地图数据不存在: {path}，返回空结构")
        return {}
    except Exception as e:
        logger.error(f"读取试炼 {trial_key} 本地地图数据失败 {path}: {e}", exc_info=True)
        return {}


def invalidate_map_pets_cache(trial_key=None):
    """清空地图数据缓存（数据更新后调用）；不传则清空全部试炼。"""
    global _map_pets_cache
    if trial_key is None:
        _map_pets_cache = {}
    else:
        _map_pets_cache.pop(trial_key, None)


def sprite_to_file(map_name, sprite_name, trial_key="grass"):
    """把精灵名反查为数据集文件名，如 "乌达_极夜" -> "258_乌达_极夜.png"。

    兼容传入：
      - 精灵名（乌达_极夜）
      - 完整数据集文件名（258_乌达_极夜.png / 258_02_乌达_极夜.png / 不带 .png）
      - 带 id 但缺形态序号（064_蹦蹦草_象牙球）——按 id+名字匹配到带序号的完整文件
    找不到时返回 None。
    """
    data = load_map_pets(trial_key).get(map_name, {})
    if sprite_name in data:
        return sprite_name
    base = sprite_name[:-4] if sprite_name.lower().endswith(".png") else sprite_name
    if base in data:
        return base

    # 解析传入名字：拿到 (id, name)；缺失序号也没关系，用 id+名字去匹配。
    _info = split_pet_filename(base)
    _q_id = _info["id"] if _info else None
    _q_name = _info["name"] if _info else base
    _q_name_norm = re.sub(r"[_\\s]+", "", _q_name or "")

    for fname in data:
        if fname[:-4] == base:
            return fname
        info = split_pet_filename(fname)
        display = info["name"] if info else fname[:-4]
        if display == base:
            return fname
        # id 相同 + 名字（去下划线）相同 -> 命中（即使形态序号不同/缺失）
        if info and _q_id is not None and info["id"] == _q_id:
            if _q_name == info["name"] or _q_name_norm == re.sub(r"[_\\s]+", "", info["name"] or ""):
                return fname
    return None


def sprite_to_file_any(sprite_name, trial_key="grass"):
    """跨该试炼的所有关卡（图1-3）反查数据集文件名（图标访问不再受关卡约束）。"""
    data = load_map_pets(trial_key)
    for map_name in data:
        found = sprite_to_file(map_name, sprite_name, trial_key)
        if found:
            return found
    return None


def scan_icon_names(trial_key="grass"):
    """读取指定试炼的所有精灵名（去掉 id 前缀与 .png 后缀）。

    返回 {"map1": ["叶冕魔力猫", "迪莫"], ...}（已去掉 id 前缀与形态序号）。
    """
    trial = get_trial_or_default(trial_key)
    names_dict = {map_name: [] for map_name in trial.get("map_list", [])}
    try:
        if not trial_has_map_pets_file(trial_key):
            # 开荒期全图鉴自选：不做每关白名单，每个关卡都放全图鉴展示名，
            # 识别可覆盖所有精灵（等正式图鉴定型后再切回 map_pets，按图限制）。
            from core.services.trials import _load_pokedex_raw
            all_names = []
            seen_names = set()
            for _pet in _load_pokedex_raw():
                if not isinstance(_pet, dict):
                    continue
                _name = str(_pet.get("form_name") or _pet.get("name") or "").strip()
                if _name and _name not in seen_names:
                    seen_names.add(_name)
                    all_names.append(_name)
            for map_name in trial.get("map_list", []):
                names_dict[map_name].extend(all_names)
        else:
            data = load_map_pets(trial_key)
            for map_name in trial.get("map_list", []):
                # 按原始文件名排序（sort_key 能解析 id+形态序号），再取展示名，
                # 保证多形态顺序稳定（普通在前、首领在后）。
                for fname in sorted(data.get(map_name, {}), key=sort_key):
                    names_dict[map_name].append(format_display_name(fname))

        total = sum(len(v) for v in names_dict.values())
        logger.info(f"图标名扫描完成，共 {total} 个图标: " +
                    ", ".join(f"{k}={len(v)}" for k, v in names_dict.items()))
    except Exception as e:
        logger.error(f"试炼 {trial_key} 扫描图标名失败: {e}", exc_info=True)
    return names_dict
