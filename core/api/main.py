import difflib
import json

from flask import send_from_directory, g, Response

import os
from flask import jsonify, url_for

import config
from core.db import get_db
from logger import logger

PET_NAME_TO_ID = {}
try:
    with open(config.PETS_FILE, "r", encoding="utf-8") as f:
        root = json.load(f)
    pet_list = root.get("pets", [])
    PET_NAME_TO_ID = {item["name"]: item["id"] for item in pet_list}
    logger.info(f"宠物图鉴加载成功: {len(PET_NAME_TO_ID)} 个宠物")
except Exception as e:
    # 读取失败，降级：所有图标排末尾
    logger.warning(f"宠物图鉴加载失败，将降级排序: {e}", exc_info=True)
    PET_NAME_TO_ID = {}



def init_routes(app):
    @app.teardown_appcontext
    def close_connection(exception):
        """请求结束后自动关闭连接"""
        db = getattr(g, '_database', None)
        if db is not None:
            db.close()

    @app.route('/')
    def index():
        return send_from_directory(app.static_folder, 'index.html')

    @app.route('/<path:path>')
    def serve_file(path):
        # 优先检查 static 目录下是否存在该文件
        full_path = os.path.join(app.static_folder, path)
        if os.path.exists(full_path) and os.path.isfile(full_path):
            return send_from_directory(app.static_folder, path)
        # 否则返回 index.html (支持 SPA 路由)
        return send_from_directory(app.static_folder, 'index.html')

    @app.route('/icons', methods=['GET'])
    def list_icons():
        """从数据库读取所有图片的名字及其对应的访问 URL，按图鉴id排序"""
        logger.info("[GET /icons] 请求图标列表")
        try:
            db = get_db()
            cursor = db.execute("SELECT path FROM icons ORDER BY path ASC")
            all_paths = [row[0] for row in cursor.fetchall()]

            icons_structure = {}

            for p in all_paths:
                parts = p.split('/')
                if len(parts) != 2:
                    continue

                map_name, filename = parts[0], parts[1]

                if map_name not in icons_structure:
                    icons_structure[map_name] = {
                        "count": 0,
                        "items": []
                    }

                icons_structure[map_name]["items"].append({
                    "name": filename,
                    "url": url_for('get_icon_file', map_name=map_name, filename=filename, _external=True)
                })
                icons_structure[map_name]["count"] += 1

            # 对每个分组内的 items，按图鉴id排序；找不到id的排末尾
            def sort_key(item):
                pure_name = item["name"].rsplit(".", 1)[0]
                return PET_NAME_TO_ID.get(pure_name, float("inf"))

            for map_name in icons_structure:
                icons_structure[map_name]["items"].sort(key=sort_key)

            total = sum(v["count"] for v in icons_structure.values())
            logger.debug(f"[GET /icons] 返回 {len(icons_structure)} 个地图, 共 {total} 个图标")
            return jsonify({"status": "success", "data": icons_structure})

        except Exception as e:
            logger.error(f"[GET /icons] 异常: {e}", exc_info=True)
            return jsonify({"status": "error", "message": str(e)}), 500

    @app.route('/icons/<map_name>/<filename>')
    def get_icon_file(map_name, filename):
        """从数据库直接返回图片二进制流"""
        logger.debug(f"[GET /icons] 获取图标: {map_name}/{filename}")
        try:
            # 数据库中存储的路径格式是 "map_name/filename"
            db_path = f"{map_name}/{filename}"

            db = get_db()
            cursor = db.execute("SELECT data FROM icons WHERE path = ?", (db_path,))
            row = cursor.fetchone()

            if row:
                # 直接返回二进制数据，mimetype 设置为 image/png
                return Response(row[0], mimetype='image/png')
            else:
                logger.warning(f"[GET /icons] 图标不存在: {db_path}")
                return "Icon Not Found", 404

        except Exception as e:
            logger.error(f"[GET /icons] 获取图标异常 {map_name}/{filename}: {e}", exc_info=True)
            return str(e), 500
