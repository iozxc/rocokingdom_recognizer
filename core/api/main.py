import sqlite3

from flask import send_from_directory, g, Response

import os
from flask import jsonify, url_for
import config

def get_db():
    """获取数据库连接（Flask 推荐写法）"""
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(config.ASSETS_FILE)
    return db



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

    # --- 1. 修改后的列表接口 ---
    @app.route('/icons', methods=['GET'])
    def list_icons():
        """从数据库读取所有图片的名字及其对应的访问 URL"""
        try:
            db = get_db()
            # 从数据库一次性查出所有路径，并按路径排序
            cursor = db.execute("SELECT path FROM icons ORDER BY path ASC")
            all_paths = [row[0] for row in cursor.fetchall()]

            icons_structure = {}

            # 处理数据库中的路径，例如: "map1/0.png"
            for p in all_paths:
                # 拆分 map_name 和 filename
                parts = p.split('/')
                if len(parts) != 2:
                    continue

                map_name, filename = parts[0], parts[1]

                # 初始化结构
                if map_name not in icons_structure:
                    icons_structure[map_name] = {
                        "count": 0,
                        "items": []
                    }

                # 生成访问链接（逻辑与原来完全一致）
                icons_structure[map_name]["items"].append({
                    "name": filename,
                    "url": url_for('get_icon_file', map_name=map_name, filename=filename, _external=True)
                })
                icons_structure[map_name]["count"] += 1

            return jsonify({"status": "success", "data": icons_structure})

        except Exception as e:
            return jsonify({"status": "error", "message": str(e)}), 500

    # --- 2. 修改后的获取图片接口 ---
    @app.route('/icons/<map_name>/<filename>')
    def get_icon_file(map_name, filename):
        """从数据库直接返回图片二进制流"""
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
                return "Icon Not Found", 404

        except Exception as e:
            return str(e), 500

