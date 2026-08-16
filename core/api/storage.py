import json
import os
from flask import  request, jsonify

import config

def init_routes(app):
    # 读取本地存储数据
    @app.route('/api/storage', methods=['GET'])
    def get_storage():
        if os.path.exists(config.DATA_FILE):
            try:
                with open(config.DATA_FILE, 'r', encoding='utf-8') as f:
                    return jsonify(json.load(f))
            except Exception as e:
                return jsonify({"error": str(e)}), 500
        # 默认空数据
        return jsonify({
            "encounteredPets": {},
            "thresholds": {},
            "appSettings": {}
        })


    # 保存数据到本地磁盘
    @app.route('/api/storage', methods=['POST'])
    def save_storage():
        try:
            data = request.json
            with open(config.DATA_FILE, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            return jsonify({"status": "success", "message": "Saved to local disk"})
        except Exception as e:
            return jsonify({"error": str(e)}), 500
