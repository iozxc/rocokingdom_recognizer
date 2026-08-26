"""地图专用用户数据存储服务：roco_user_mapdata.json 的读写、内存缓存与原子持久化。"""
import json
import os
import time

import config
from core.logger import logger

MAP_DATA_FILE = config.MAP_DATA_JSON

DEFAULT_MAP_STRUCTURE = {
    "version": 0,
    "mapFootprints": {
        "pathHistory": [],
        "revealedCircles": [],
        "updatedAt": 0,
    },
    "mapDesignStyles": {
        "fogStyle": {
            "color": "#334155",
            "opacity": 0.45,
        },
        "pathStyle": {
            "color": "#38BDF8",
            "lineStyle": "dashed",
            "lineWidth": 3,
            "glow": True,
        },
        "layers": {
            "poi": True,
            "rarePoi": False,
            "wild": True,
            "seeds": False,
            "collect": False,
            "fogOfWar": False,
            "showPath": True,
        },
    },
}


class UserMapStorage:
    """负责地图足迹与样式设计的独立持久化，存储于 roco_user_mapdata.json。"""

    def __init__(self, data_file=MAP_DATA_FILE):
        self._data_file = data_file
        self._cache = None

    def load(self) -> dict:
        """返回当前地图存储数据（内存缓存优先，首次读取磁盘）。"""
        if self._cache is not None:
            return self._cache

        logger.debug(f"加载地图存储文件: {self._data_file}")
        if not os.path.exists(self._data_file):
            logger.debug("地图存储文件不存在，返回默认空结构")
            self._cache = dict(DEFAULT_MAP_STRUCTURE)
            return self._cache

        try:
            with open(self._data_file, "r", encoding="utf-8") as f:
                self._cache = json.load(f)

            for key in ("mapFootprints", "mapDesignStyles"):
                if not isinstance(self._cache.get(key), dict):
                    self._cache[key] = {}

            logger.debug(
                f"地图存储文件加载成功: version={self._cache.get('version')}, "
                f"路径点数={len(self._cache.get('mapFootprints', {}).get('pathHistory', []))}"
            )
        except Exception as e:
            logger.error(f"地图存储文件加载失败，返回默认结构: {e}", exc_info=True)
            self._cache = dict(DEFAULT_MAP_STRUCTURE)
        return self._cache

    @property
    def version(self) -> int:
        """当前地图数据版本号。"""
        return int(self.load().get("version", 0))

    def save(self, payload: dict) -> dict:
        """写回地图存储文件，更新内存缓存并刷新版本号。"""
        data = dict(self.load() or {})
        if payload:
            data.update(payload)

        data.setdefault("mapFootprints", {})
        data.setdefault("mapDesignStyles", {})

        try:
            result = self._persist(data)
            logger.info(
                f"保存地图存储文件: "
                f"路径点数={len(data.get('mapFootprints', {}).get('pathHistory', []))}, "
                f"version={result['version']}"
            )
        except Exception as e:
            logger.error(f"地图存储文件保存失败: {e}", exc_info=True)
            raise
        return result

    def _persist(self, payload: dict) -> dict:
        """落盘并刷新内存缓存与版本号。"""
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
user_map_storage = UserMapStorage()
