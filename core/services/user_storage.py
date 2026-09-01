"""用户数据存储服务：roco_user_data.json 的读写、内存缓存与版本管理。"""
import json
import os
import time

import config
from core.infra.logger import logger

DATA_FILE = config.DATA_JSON

_IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".svg")


def _strip_ext(name):
    if not name:
        return ""
    n = str(name).strip()
    lower = n.lower()
    for ext in _IMAGE_EXTS:
        if lower.endswith(ext):
            return n[: -len(ext)]
    return n


def _load_renames():
    """读取宠物改名映射：{旧名字: 新名字}（不含扩展名）。"""
    try:
        with open(config.RENAMES_JSON, "r", encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        return {}
    except Exception as e:
        logger.warning(f"加载宠物改名映射失败: {e}")
        return {}
    if not isinstance(data, dict):
        return {}
    renames = data.get("renames", {}) or {}
    return {
        _strip_ext(k): _strip_ext(v)
        for k, v in renames.items()
        if k and v
    }


def get_renames():
    """对外暴露改名映射（供前端同步规范化本地记录）。"""
    return _load_renames()


def _apply_renames(pets):
    """把遇到记录里的旧名字迁成新名字，保留 count 与时间。返回 (结果, 是否有变化)。"""
    if not isinstance(pets, dict):
        return pets, False
    renames = _load_renames()
    if not renames:
        return pets, False

    changed = False
    out = {}
    for key, rec in pets.items():
        if not isinstance(rec, dict):
            out[key] = rec
            continue
        rec = dict(rec)
        fn = str(rec.get("filename") or "")
        base = _strip_ext(fn)
        if base and base in renames:
            new_base = renames[base]
            ext = fn[len(base):]  # 原扩展名，如 .png
            rec["filename"] = new_base + ext
            map_id = str(rec.get("mapId") or key.split("_", 1)[0])
            rec["mapId"] = map_id
            rec["key"] = f"{map_id}_{new_base}{ext}"
            changed = True

        new_key = rec.get("key") or key
        if new_key in out:
            prev = out[new_key]
            prev["count"] = int(prev.get("count", 0)) + int(rec.get("count", 0))
            prev["encountered"] = True
            first_a = prev.get("firstSeenAt") or ""
            first_b = rec.get("firstSeenAt") or ""
            prev["firstSeenAt"] = (min(first_a, first_b) if first_a and first_b else (first_a or first_b))
            last_a = prev.get("lastSeenAt") or ""
            last_b = rec.get("lastSeenAt") or ""
            prev["lastSeenAt"] = (max(last_a, last_b) if last_a and last_b else (last_a or last_b))
            out[new_key] = prev
        else:
            out[new_key] = rec
    return out, changed

DEFAULT_STRUCTURE = {
    "version": 0,
    "encounteredPets": {},
    "encounteredPets2": {},
    "thresholds": {},
    "appSettings": {},
}


class UserStorage:
    """负责用户数据的持久化，供 /api/storage 接口与桌面层共用。"""

    def __init__(self, data_file=DATA_FILE):
        self._data_file = data_file
        self._cache = None

    def load(self) -> dict:
        """返回当前存储数据（内存缓存优先，首次读取磁盘）。"""
        if self._cache is not None:
            return self._cache

        logger.debug(f"加载存储文件: {self._data_file}")
        if not os.path.exists(self._data_file):
            logger.debug("存储文件不存在，返回默认空结构")
            self._cache = dict(DEFAULT_STRUCTURE)
            return self._cache

        try:
            with open(self._data_file, "r", encoding="utf-8") as f:
                self._cache = json.load(f)

            # 归一化：确保所有集合字段（草系/火系/阈值/设置）都存在。
            # 只修正内存结构、不主动落盘，避免每次启动都刷新版本号；
            # 下次 save() 时这些默认值会随合并写入一起持久化。
            for key in ("encounteredPets", "encounteredPets2", "thresholds", "appSettings"):
                if not isinstance(self._cache.get(key), dict):
                    self._cache[key] = {}

            pets, changed = _apply_renames(self._cache.get("encounteredPets", {}))
            if changed:
                self._cache["encounteredPets"] = pets
                self._persist(self._cache)
                logger.info("检测到宠物改名，已自动迁移遇到记录")
            pet_count = len(self._cache.get("encounteredPets", {}))
            # fire_pet_count = len(self._cache.get("encounteredPets2", {}))
            logger.debug(
                f"存储文件加载成功: version={self._cache.get('version')}, "
                f"遇到精灵数={pet_count}"
                # f"遇到精灵数={pet_count}, 火系精灵数={fire_pet_count}"
            )
        except Exception as e:
            logger.error(f"存储文件加载失败，返回默认结构: {e}", exc_info=True)
            self._cache = dict(DEFAULT_STRUCTURE)
        return self._cache

    @property
    def version(self) -> int:
        """当前数据版本号（前端轮询比对用）。"""
        return int(self.load().get("version", 0))

    def get_app_settings(self) -> dict:
        """返回 appSettings（文件损坏时返回空 dict）。"""
        app_settings = self.load().get("appSettings", {})
        if not isinstance(app_settings, dict):
            logger.warning("appSettings 格式异常，忽略")
            return {}
        return app_settings

    def update_app_settings(self, app_settings: dict) -> dict:
        """合并更新 appSettings 并落盘，保持内存缓存一致。"""
        data = self.load()
        current = data.get("appSettings", {})
        if not isinstance(current, dict):
            logger.warning("appSettings 格式异常，重置为空")
            current = {}
        data["appSettings"] = {**current, **(app_settings or {})}
        return self.save(data)

    def save(self, payload: dict) -> dict:
        """写回存储文件，更新内存缓存并刷新版本号。

        与既有缓存合并：这样前端只提交某个试炼的字段时，不会误删其他试炼的数据
        （例如草系前端提交时不会抹掉火系的 encounteredPets2）。
        """
        data = dict(self.load() or {})
        if payload:
            data.update(payload)

        data.setdefault("encounteredPets", {})
        data.setdefault("encounteredPets2", {})
        data.setdefault("thresholds", {})
        data.setdefault("appSettings", {})

        pets, _ = _apply_renames(data.get("encounteredPets", {}))
        data["encounteredPets"] = pets
        pet_count = len(data.get("encounteredPets", {}))
        try:
            result = self._persist(data)
            logger.info(
                f"保存存储文件: 遇到精灵数={pet_count}, "
                f"阈值={len(data.get('thresholds', {}))} version={result['version']}"
            )
        except Exception as e:
            logger.error(f"存储文件保存失败: {e}", exc_info=True)
            raise
        return result

    def _persist(self, payload: dict) -> dict:
        """落盘并刷新内存缓存与版本号（不打印日志，供 load/save 复用）。

        采用“临时文件 + os.replace”的原子写入：即使进程在写入中途被杀，
        也不会留下截断/损坏的 roco_user_data.json。
        """
        payload["version"] = int(time.time() * 1000)
        tmp_path = f"{self._data_file}.tmp"
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, self._data_file)
        self._cache = payload
        return payload


# 全局单例
user_storage = UserStorage()
