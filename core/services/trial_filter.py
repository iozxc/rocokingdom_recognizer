"""按试炼过滤识别候选。

识别统一使用全图鉴特征库（feature_icon.pkl），拿到 topk 后由服务端按试炼过滤：
- 草系：只保留 map_pets1.json 白名单里的精灵；
- 火系等无图鉴试炼（pets_source == "pokedex"）：不过滤，直接返回全图鉴候选。
"""
import os
import re

from core.infra.pet_path import format_display_name
from core.services.trials import get_trial

_ID_PREFIX_RE = re.compile(r"^\d+_(.*)$")
_IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".svg")


def _strip_ext(name):
    n = str(name or "").strip()
    lower = n.lower()
    for ext in _IMAGE_EXTS:
        if lower.endswith(ext):
            return n[: -len(ext)]
    return n


def _pet_name(candidate):
    """从候选里取出标准化精灵名（去掉 id 前缀与扩展名）。"""
    name = candidate.get("name") or os.path.basename(candidate.get("filename") or "")
    name = _strip_ext(name)
    # 去掉 id 前缀与形态序号（新命名 <id>_<seq>_<name>），得到展示名。
    return format_display_name(name)


def allowed_pet_names(trial_key, map_name=None):
    """返回允许的精灵名集合；无图鉴白名单的试炼返回 None（表示不限制）。

    传 map_name 时只放行该地图的精灵（如 map1 识别不会出现 map2/map3 的精灵）；
    不传时返回整试炼的并集。
    """
    trial = get_trial(trial_key)
    if trial is None or trial.get("pets_source") == "pokedex":
        return None

    from core.infra.icon_names import scan_icon_names

    names = scan_icon_names(trial_key)
    if map_name:
        return set(names.get(map_name, []))

    allowed = set()
    for map_names in names.values():
        allowed.update(map_names)
    return allowed


def filter_candidates_by_trial(candidates, trial_key, map_name=None):
    """把识别候选按试炼/地图白名单过滤；无白名单时原样返回。"""
    if not candidates:
        return candidates
    allowed = allowed_pet_names(trial_key, map_name)
    if allowed is None:
        return candidates
    return [c for c in candidates if _pet_name(c) in allowed]
