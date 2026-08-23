import json

import os
from flask import Blueprint, Response, current_app, send_from_directory, url_for

import config
from core.api.response import error, success
from core.db import get_db
from core.logger import logger

bp = Blueprint("main", __name__)

PET_NAME_TO_ID = {}
ICONS = None
ICON_FILE_CACHE = {}

try:
    with open(config.PETS_FILE, "r", encoding="utf-8") as f:
        root = json.load(f)
    pet_list = root.get("pets", [])
    PET_NAME_TO_ID = {item["name"]: item["id"] for item in pet_list}
except Exception as e:
    # 读取失败，降级：所有图标排末尾
    logger.warning(f"宠物图鉴加载失败，将降级排序: {e}", exc_info=True)
    PET_NAME_TO_ID = {}


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
    """从数据库读取所有图片的名字及其对应的访问 URL，按图鉴id排序；支持_后缀变体形态"""
    try:
        if ICONS:
            logger.debug(f"[GET /icons] icons已缓存")
            return success(data=ICONS)
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
                "url": url_for('main.get_icon_file', map_name=map_name, filename=filename, _external=True)
            })
            icons_structure[map_name]["count"] += 1

        # 排序key：去掉后缀，按下划线切分取主名查图鉴ID；无匹配返回无穷大放末尾
        def sort_key(item):
            filename = item["name"]
            # 去除文件扩展名
            no_ext = filename.rsplit(".", 1)[0]
            # 按下划线分割，取前面主体名字
            main_name = no_ext.split("_")[0]
            pet_id = PET_NAME_TO_ID.get(main_name, float("inf"))
            # 次要key：保留原始文件名，同一个主宠的多个变体内部按文件名字典序排
            return (pet_id, filename)

        for map_name in icons_structure:
            icons_structure[map_name]["items"].sort(key=sort_key)

        ICONS = icons_structure
        return success(data=icons_structure)

    except Exception as e:
        logger.error(f"[GET /icons] 异常: {e}", exc_info=True)
        return error(str(e), 500)

@bp.route('/icons/<map_name>/<filename>')
def get_icon_file(map_name, filename):
    """从缓存/数据库直接返回图片二进制流，无锁版本"""
    global ICON_FILE_CACHE
    try:
        db_path = f"{map_name}/{filename}"

        # 缓存命中直接返回
        if db_path in ICON_FILE_CACHE:
            return Response(ICON_FILE_CACHE[db_path], mimetype='image/png')

        db = get_db()
        cursor = db.execute("SELECT data FROM icons WHERE path = ?", (db_path,))
        row = cursor.fetchone()

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
