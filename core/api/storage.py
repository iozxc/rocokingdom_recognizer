import json
import os
import time

from flask import jsonify, request

import tools
from config import DATA_FILE
from logger import logger


VERSION = tools.get_version_from_file_json()

def load_storage_file():
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


def save_storage_file(payload: dict):
    global VERSION
    pet_count = len(payload.get("encounteredPets", {}))
    logger.debug(f"保存存储文件: 遇到精灵数={pet_count}, 阈值数={len(payload.get('thresholds', {}))}")

    data = load_storage_file()
    data["encounteredPets"] = payload.get("encounteredPets", data["encounteredPets"])
    data["thresholds"] = payload.get("thresholds", data["thresholds"])
    data["appSettings"] = payload.get("appSettings", data["appSettings"])
    data["version"] = int(time.time() * 1000)

    try:
        with open(DATA_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            VERSION  = data["version"]
        logger.info(f"存储文件保存成功: version={data['version']}, 遇到精灵数={len(data['encounteredPets'])}")
    except Exception as e:
        logger.error(f"存储文件保存失败: {e}", exc_info=True)
        raise

    return data


def init_routes(app):
    @app.route("/api/storage/<version>", methods=["GET"])
    def api_get_storage(version):
        if int(version) == VERSION:
            return {"status": "ok"}
        return load_storage_file()

    @app.route("/api/storage", methods=["POST"])
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
