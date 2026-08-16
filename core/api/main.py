from flask import send_from_directory

import os
from flask import jsonify, url_for
import config


def init_routes(app):
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

    # ---  获取所有图标列表（带图片URL） ---
    @app.route('/icons', methods=['GET'])
    def list_icons():
        """返回所有图片的名字及其对应的访问 URL"""
        try:
            icons_structure = {}

            for map_name in config.MAP_LIST:
                folder_path = os.path.join(config.ICONS_DIR, map_name)

                if os.path.exists(folder_path):
                    files = [f for f in os.listdir(folder_path) if f.endswith('.png')]

                    # 生成每张图片的完整访问链接
                    file_links = []
                    for f in sorted(files):
                        file_links.append({
                            "name": f,
                            "url": url_for('get_icon_file', map_name=map_name, filename=f, _external=True)
                        })

                    icons_structure[map_name] = {
                        "count": len(files),
                        "items": file_links
                    }
                else:
                    icons_structure[map_name] = {"count": 0, "items": []}

            return jsonify({"status": "success", "data": icons_structure})

        except Exception as e:
            return jsonify({"status": "error", "message": str(e)}), 500

    # --- 获取具体图片文件的接口 ---
    # 访问示例: http://127.0.0.1:5000/icons/map1/0
    @app.route('/icons/<map_name>/<filename>')
    def get_icon_file(map_name, filename):
        """直接返回图片二进制流"""
        # 构造文件夹路径：icons/map1
        directory = os.path.join(config.ICONS_DIR, map_name)
        # 安全地发送文件
        return send_from_directory(directory, filename)
