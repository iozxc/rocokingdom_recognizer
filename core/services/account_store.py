"""多账号（磁盘持久化）管理。

账号数据存放在主数据文件同级的 accounts/ 目录下，每个账号一个 JSON 文件；
当前正在使用的数据始终是主 roco_user_data.json，切换时自动把主数据保存回原账号，
再把目标账号写回主文件。账号与数据都落在磁盘，关闭 App 后依然保留。
"""
import json
import os
import re
import time

import config
from core.infra.logger import logger
from core.services.user_storage import user_storage

DEFAULT_ACCOUNT = "默认账号"
_ILLEGAL = re.compile(r'[\\/:*?"<>|\s]+')
_DIR = None


def _account_dir():
    global _DIR
    if _DIR is None:
        _DIR = os.path.join(os.path.dirname(config.DATA_JSON), "accounts")
    try:
        os.makedirs(_DIR, exist_ok=True)
    except OSError as e:
        logger.error(f"创建账号目录失败 {_DIR}: {e}")
    return _DIR


def _safe_name(name: str) -> str:
    name = _ILLEGAL.sub("_", str(name or "").strip())
    return name[:60] or DEFAULT_ACCOUNT


def _profile_path(name: str) -> str:
    return os.path.join(_account_dir(), f"{_safe_name(name)}.json")


def _active_path() -> str:
    return os.path.join(_account_dir(), ".active")


def _write_json(path, data):
    tmp = path + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            try:
                os.remove(tmp)
            except OSError:
                pass


def _read_json(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _write_active(name: str):
    try:
        with open(_active_path(), "w", encoding="utf-8") as f:
            f.write(_safe_name(name))
    except OSError:
        pass


def _read_active() -> str:
    try:
        with open(_active_path(), "r", encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return DEFAULT_ACCOUNT


def _ensure_default():
    files = [f for f in os.listdir(_account_dir()) if f.endswith(".json")]
    if files:
        return
    payload = user_storage.get_payload()
    save_account(DEFAULT_ACCOUNT, payload=payload)
    _write_active(DEFAULT_ACCOUNT)


def _count_map_pets(payload: dict | None, collection: str = "encounteredPets"):
    """统计某个集合里 map1/map2/map3 各自已点亮的数量。"""
    counts = {"map1": 0, "map2": 0, "map3": 0}
    if not isinstance(payload, dict):
        return counts
    pets = payload.get(collection) or {}
    if not isinstance(pets, dict):
        return counts
    for key, rec in pets.items():
        if not isinstance(rec, dict) or not rec.get("encountered"):
            continue
        map_id = str(rec.get("mapId") or key.split("_", 1)[0] or "")
        if map_id in counts:
            counts[map_id] += 1
    return counts


def list_accounts():
    """返回账号列表（元数据 + 三张地图点亮统计，不含完整 payload）。

    每次列出前先把“当前账号”的最新主数据同步到其账号文件，
    保证切回/重开时看到的是最新三图进度。
    """
    _ensure_default()
    active = _read_active()
    if active and os.path.isfile(_profile_path(active)):
        save_account(active)
    result = []
    for fname in os.listdir(_account_dir()):
        if not fname.endswith(".json"):
            continue
        path = os.path.join(_account_dir(), fname)
        try:
            mtime = os.path.getmtime(path)
        except OSError:
            continue
        payload = _read_json(path) or {}
        result.append({
            "name": fname[: -len(".json")],
            "updated_at": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(mtime)),
            "maps": _count_map_pets(payload, "encounteredPets"),
            "fire_maps": _count_map_pets(payload, "encounteredPets2"),
        })
    return result


def current_account():
    """当前激活账号名。"""
    _ensure_default()
    active = _read_active()
    names = {a["name"] for a in list_accounts()}
    return active if active in names else DEFAULT_ACCOUNT


def save_account(name: str, payload: dict | None = None) -> str:
    """把当前主数据保存到指定账号文件。"""
    safe = _safe_name(name)
    data = dict(payload) if payload is not None else user_storage.get_payload()
    _write_json(_profile_path(safe), data)
    return safe


def _activate(safe: str):
    """加载指定账号并设为当前（不自动保存原账号）。"""
    payload = _read_json(_profile_path(safe))
    if not payload:
        raise ValueError("账号数据缺失")
    user_storage.set_payload(payload)
    _write_active(safe)
    logger.info(f"已切换账号: {safe}")


def create_account(name: str) -> dict:
    """新建空账号（只清空精灵数据，保留全局/系统设置）并切换过去。"""
    _ensure_default()
    safe = _safe_name(name)
    if os.path.isfile(_profile_path(safe)):
        raise ValueError(f"账号「{safe}」已存在")
    # 自动保存当前账号（新建前）
    active = current_account()
    if active != safe:
        save_account(active)
    # 新账号：保留全局字段，只清空两只精灵集合
    current = user_storage.get_payload()
    new_payload = dict(current)
    new_payload["encounteredPets"] = {}
    new_payload["encounteredPets2"] = {}
    _write_json(_profile_path(safe), new_payload)
    # 新建后不切换，留在当前账号；用户需要时自行点击“切换”
    return {"name": safe}


def switch_account(name: str) -> bool:
    safe = _safe_name(name)
    if not os.path.isfile(_profile_path(safe)):
        return False
    _ensure_default()
    active = current_account()
    if active != safe:
        save_account(active)  # 离开前自动保存，不需要用户手动保存
    _activate(safe)
    return True


def delete_account(name: str) -> dict:
    """删除账号（不能删最后一个）。返回新的当前账号名。"""
    _ensure_default()
    accounts = list_accounts()
    if len(accounts) <= 1:
        raise ValueError("至少需要保留一个账号")
    safe = _safe_name(name)
    path = _profile_path(safe)
    if not os.path.isfile(path):
        raise ValueError("账号不存在")

    was_active = current_account() == safe
    if was_active:
        save_account(safe)  # 删除前自动保存
    os.remove(path)

    if not was_active:
        return {"name": current_account()}

    rest = list_accounts()
    fallback = rest[0]["name"] if rest else DEFAULT_ACCOUNT
    _activate(_safe_name(fallback))
    return {"name": fallback}


def rename_account(old_name: str, new_name: str) -> dict:
    """重命名账号；若重命名的是当前账号则同步更新激活标记。"""
    old_safe = _safe_name(old_name)
    new_safe = _safe_name(new_name)
    old_path = _profile_path(old_safe)
    new_path = _profile_path(new_safe)
    if not os.path.isfile(old_path):
        raise ValueError("账号不存在")
    if os.path.isfile(new_path):
        raise ValueError("账号已存在")
    os.replace(old_path, new_path)
    if _read_active() == old_safe:
        _write_active(new_safe)
    return {"name": new_safe}
