"""用户数据存储服务：roco_user_data.json 的读写、内存缓存与版本管理。"""
import json
import os
import time

from config import DATA_FILE
from logger import logger

DEFAULT_STRUCTURE = {
    "version": 0,
    "encounteredPets": {},
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
            pet_count = len(self._cache.get("encounteredPets", {}))
            logger.debug(f"存储文件加载成功: version={self._cache.get('version')}, 遇到精灵数={pet_count}")
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
        """写回存储文件，更新内存缓存并刷新版本号。"""
        pet_count = len(payload.get("encounteredPets", {}))
        new_version = int(time.time() * 1000)
        payload["version"] = new_version
        try:
            with open(self._data_file, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False, indent=2)
            self._cache = payload
            logger.info(
                f"保存存储文件: 遇到精灵数={pet_count}, "
                f"阈值={len(payload.get('thresholds', {}))} version={payload['version']}"
            )
        except Exception as e:
            logger.error(f"存储文件保存失败: {e}", exc_info=True)
            raise
        return payload


# 全局单例
user_storage = UserStorage()
