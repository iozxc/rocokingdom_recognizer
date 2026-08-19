import json
import os
import time

from flask import jsonify, request

from config import DATA_FILE


def load_storage_file():
    if not os.path.exists(DATA_FILE):
        return {
            "version": 0,
            "encounteredPets": {},
            "thresholds": {},
            "appSettings": {}
        }
    try:
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"version": 0, "encounteredPets": {}, "thresholds": {}, "appSettings": {}}


def save_storage_file(payload: dict):
    data = load_storage_file()
    data["encounteredPets"] = payload.get("encounteredPets", data["encounteredPets"])
    data["thresholds"] = payload.get("thresholds", data["thresholds"])
    data["appSettings"] = payload.get("appSettings", data["appSettings"])
    data["version"] = int(time.time() * 1000)
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return data


def init_routes(app):
    @app.route("/api/storage", methods=["GET"])
    def api_get_storage():
        data = load_storage_file()
        return jsonify(data)

    @app.route("/api/storage", methods=["POST"])
    def api_post_storage():
        payload = request.get_json()
        new_data = save_storage_file(payload)
        return jsonify({"ok": True, "version": new_data["version"]})
