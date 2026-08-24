import os
from flask import Blueprint, Response, current_app, request, send_from_directory, url_for

from core.api.response import error, success
from core.db import get_db
from core.icon_names import load_map_pets, sprite_to_file, sprite_to_file_any
from core.logger import logger
from core.services.trials import get_trial_or_default
from core.utils import strip_id_prefix

bp = Blueprint("main", __name__)

ICONS = {}
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
    """读取指定试炼每个 map 的精灵（数据集文件名）及其访问 URL，按图鉴 id 排序。"""
    trial_key = request.args.get("trial", "grass")
    try:
        if trial_key in ICONS:
            logger.debug(f"[GET /icons] icons已缓存 trial={trial_key}")
            return success(data=ICONS[trial_key])

        trial = get_trial_or_default(trial_key)
        icons_structure = {}
        map_pets = load_map_pets(trial_key)
        for map_name in trial.get("map_list", []):
            entries = map_pets.get(map_name, {})
            items = []
            for filename, meta in sorted(
                    entries.items(),
                    key=lambda kv: (kv[1].get("id", float("inf")), kv[0])):
                items.append({
                    # 对外/用户数据不保留 id 前缀；URL 仍指向真实数据集文件
                    "name": strip_id_prefix(filename),
                    "id": meta.get("id"),
                    "url": url_for('main.get_icon_file', filename=filename, _external=True)
                })
            icons_structure[map_name] = {"count": len(items), "items": items}

        ICONS[trial_key] = icons_structure
        return success(data=icons_structure)

    except Exception as e:
        logger.error(f"[GET /icons] 异常: {e}", exc_info=True)
        return error(str(e), 500)

@bp.route('/icons/<filename>')
def get_icon_file(filename):
    """从缓存/datasets.db 返回图片二进制流（不再依赖地图约束）。"""
    return _serve_icon(filename)


@bp.route('/icons/<map_name>/<filename>')
def get_icon_file_with_map(map_name, filename):
    """兼容旧地址 /icons/<map>/<filename>，行为与新地址一致。"""
    return _serve_icon(filename, map_name=map_name)


def _serve_icon(filename, map_name=None):
    """从缓存/datasets.db 返回图片二进制流；兼容旧命名（精灵名）反查。"""
    global ICON_FILE_CACHE
    trial_key = request.args.get("trial", "grass")
    try:
        db_path = filename[:-4] if filename.lower().endswith('.png') else filename

        # 缓存命中直接返回
        if db_path in ICON_FILE_CACHE:
            return Response(ICON_FILE_CACHE[db_path], mimetype='image/png')

        db = get_db()
        row = db.execute("SELECT data FROM icons WHERE path = ?", (db_path,)).fetchone()

        if row is None:
            # 旧命名（如 乌达_极夜.png）通过关联 JSON 反查数据集文件名
            mapped = None
            if map_name:
                mapped = sprite_to_file(map_name, filename, trial_key)
            if mapped is None:
                mapped = sprite_to_file_any(filename, trial_key)
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
        logger.error(f"[GET /icons] 获取图标异常 {filename}: {e}", exc_info=True)
        return str(e), 500
