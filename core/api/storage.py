import json
import os
import time

from flask import Blueprint, jsonify, request

import tools
from config import DATA_FILE
from logger import logger

bp = Blueprint("storage", __name__)


def load_storage_file():
    global _storage_cache
    # 命中内存缓存直接返回副本，不走磁盘
    if _storage_cache is not None:
        return _storage_cache

    logger.debug(f"加载存储文件: {DATA_FILE}")
    if not os.path.exists(DATA_FILE):
        logger.debug("存储文件不存在，返回默认空结构")
        return {
            "version": 0,
            "encounteredPets": {},
            "thresholds": {},
            "appSettings": {}
        }
    try:
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        pet_count = len(data.get("encounteredPets", {}))
        logger.debug(f"存储文件加载成功: version={data.get('version')}, 遇到精灵数={pet_count}")
        return data
    except Exception as e:
        logger.error(f"存储文件加载失败，返回默认结构: {e}", exc_info=True)
        return {"version": 0, "encounteredPets": {}, "thresholds": {}, "appSettings": {}}


_storage_cache = None
VERSION = 0

# 初始化：函数定义完再调用
_storage_cache = load_storage_file()
VERSION = _storage_cache["version"]


def save_storage_file(payload: dict):
    global VERSION, _storage_cache
    pet_count = len(payload.get("encounteredPets", {}))
    new_version = int(time.time() * 1000)
    payload["version"] = new_version
    try:
        with open(DATA_FILE, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        _storage_cache = payload
        VERSION = new_version
        logger.info(f"保存存储文件: 遇到精灵数={pet_count}, 阈值={len(payload.get('thresholds', {}))} version={payload['version']}")
    except Exception as e:
        logger.error(f"存储文件保存失败: {e}", exc_info=True)
        raise

    return payload


@bp.route("/api/storage/<version>", methods=["GET"])
def api_get_storage(version):
    try:
        client_version = int(version)
    except (ValueError, TypeError):
        logger.warning(f"版本参数非法 {version}")
        return load_storage_file()

    if client_version == VERSION:
        return {"status": "ok"}
    return load_storage_file()

@bp.route("/api/storage", methods=["POST"])
def api_post_storage():
    payload = request.get_json()
    if not payload:
        logger.warning("[POST /api/storage] 请求体为空或非JSON")
        return jsonify({"ok": False, "error": "Invalid JSON"}), 400

    try:
        new_data = save_storage_file(payload)
        tools.USER_SETTINGS = new_data["appSettings"]
        return jsonify({"ok": True, "version": new_data["version"]})
    except Exception as e:
        logger.error(f"[POST /api/storage] 保存异常: {e}", exc_info=True)
        return jsonify({"ok": False, "error": str(e)}), 500
