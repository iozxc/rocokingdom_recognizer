import os
from flask import Blueprint, Response, current_app, send_from_directory, url_for

import config
from core.api.response import error, success
from core.db import get_db
from core.icon_names import load_map_pets, sprite_to_file
from core.logger import logger
from core.utils import strip_id_prefix

bp = Blueprint("main", __name__)

ICONS = None
ICON_FILE_CACHE = {}


@bp.route('/')
def index():
    return send_from_directory(current_app.static_folder, 'index.html')

@bp.route('/<path:path>')
def serve_file(path):
    # 优先检查 static 目录下是否存在该文件
    full_path = os.path.join(current_app.static_folder, path)
    if os.path.exists(full_path) and os.path.isfile(full_path):
        return send_from_directory(current_app.static_folder, path)
    # 否则返回 index.html (支持 SPA 路由)
    return send_from_directory(current_app.static_folder, 'index.html')

@bp.route('/icons', methods=['GET'])
def list_icons():
    global ICONS
    """从 map_pets1.json 读取每个 map 的精灵（数据集文件名）及其访问 URL，按图鉴 id 排序。"""
    try:
        if ICONS:
            logger.debug(f"[GET /icons] icons已缓存")
            return success(data=ICONS)

        icons_structure = {}
        map_pets = load_map_pets()
        for map_name in config.TRIALS[0]["map_list"]:
            entries = map_pets.get(map_name, {})
            items = []
            for filename, meta in sorted(
                    entries.items(),
                    key=lambda kv: (kv[1].get("id", float("inf")), kv[0])):
                items.append({
                    # 对外/用户数据不保留 id 前缀；URL 仍指向真实数据集文件
                    "name": strip_id_prefix(filename),
                    "url": url_for('main.get_icon_file', map_name=map_name,
                                   filename=filename, _external=True)
                })
            icons_structure[map_name] = {"count": len(items), "items": items}

        ICONS = icons_structure
        return success(data=icons_structure)

    except Exception as e:
        logger.error(f"[GET /icons] 异常: {e}", exc_info=True)
        return error(str(e), 500)

@bp.route('/icons/<map_name>/<filename>')
def get_icon_file(map_name, filename):
    """从缓存/datasets.db 返回图片二进制流；兼容旧命名（精灵名）反查。"""
    global ICON_FILE_CACHE
    try:
        db_path = filename[:-4] if filename.lower().endswith('.png') else filename

        # 缓存命中直接返回
        if db_path in ICON_FILE_CACHE:
            return Response(ICON_FILE_CACHE[db_path], mimetype='image/png')

        db = get_db()
        row = db.execute("SELECT data FROM icons WHERE path = ?", (db_path,)).fetchone()

        if row is None:
            # 旧命名（如 乌达_极夜.png）通过关联 JSON 反查数据集文件名
            mapped = sprite_to_file(map_name, filename)
            if mapped:
                db_path = mapped[:-4] if mapped.lower().endswith('.png') else mapped
                if db_path in ICON_FILE_CACHE:
                    return Response(ICON_FILE_CACHE[db_path], mimetype='image/png')
                row = db.execute("SELECT data FROM icons WHERE path = ?",
                                 (db_path,)).fetchone()

        if row:
            # 未命中，查询后存入缓存
            ICON_FILE_CACHE[db_path] = row[0]
            return Response(row[0], mimetype='image/png')
        else:
            logger.warning(f"[GET /icons] 图标不存在: {db_path}")
            return "Icon Not Found", 404

    except Exception as e:
        logger.error(f"[GET /icons] 获取图标异常 {map_name}/{filename}: {e}", exc_info=True)
        return str(e), 500
