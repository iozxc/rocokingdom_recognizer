import os
import time

from flask import Blueprint, Response, current_app, request, send_from_directory, url_for

import config
from core.api.response import error, success
from core.infra.db import get_db
from core.infra.icon_names import load_map_pets, sprite_to_file, sprite_to_file_any
from core.infra.logger import logger
from core.infra.pet_path import sort_key
from core.services.trials import get_trial_or_default, load_pet_elements
from core.infra.utils import strip_id_prefix

bp = Blueprint("main", __name__)

ICONS = {}
ICON_FILE_CACHE = {}


def invalidate_icons_cache():
    """清空 /icons 列表缓存（图鉴数据更新后调用）。"""
    global ICONS
    ICONS.clear()


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
        elements_map = load_pet_elements()
        for map_name in trial.get("map_list", []):
            entries = map_pets.get(map_name, {})
            items = []
            for filename, meta in sorted(
                    entries.items(),
                    key=lambda kv: sort_key(kv[0])):
                pet_id = meta.get("id")
                seq_val = meta.get("seq")
                seq_val = int(seq_val) if seq_val is not None else None
                pet_id = int(pet_id) if pet_id is not None else None
                items.append({
                    # 对外/用户数据不保留 id 前缀；URL 仍指向真实数据集文件
                    "name": strip_id_prefix(filename),
                    "id": pet_id,
                    "seq": seq_val,
                    "elements": elements_map.get((pet_id, seq_val), []),
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
    """从缓存/datasets.db 返回图片二进制流（不再依赖试炼关卡约束）。"""
    return _serve_icon(filename)


@bp.route('/icons/<map_name>/<filename>')
def get_icon_file_with_map(map_name, filename):
    """兼容旧地址 /icons/<map>/<filename>，行为与新地址一致。"""
    return _serve_icon(filename, map_name=map_name)


@bp.route('/api/app/agreement_required', methods=['GET'])
def api_app_agreement_required():
    """是否仍需展示用户协议：以 roco_user_data.json 中 agreementAccepted 字段判断。

    无论新旧用户，只要尚未同意过（字段缺失/为空）就返回 True；同意后会写入该字段。
    """
    try:
        from core.services.user_storage import user_storage
        data = user_storage.load()
        return success(data={"required": not bool(data.get("agreementAccepted"))})
    except Exception as e:
        logger.error(f"[GET /api/app/agreement_required] 异常: {e}", exc_info=True)
        return error(str(e), 500)


@bp.route('/api/app/agreement_accept', methods=['POST'])
def api_app_agreement_accept():
    """用户同意后写入 agreementAccepted 顶层字段。

    两步：若 roco_user_data.json 已存在（老用户）则合并写入字段；
    若不存在（新用户）则先创建文件再写入字段。
    """
    try:
        from core.services.user_storage import user_storage
        user_storage.save({"agreementAccepted": True})
        return success(data={"ok": True})
    except Exception as e:
        logger.error(f"[POST /api/app/agreement_accept] 异常: {e}", exc_info=True)
        return error(str(e), 500)


@bp.route('/api/resources/<path:filename>', methods=['GET'])
def api_resources_file(filename):
    """读取 resources 目录下的资源文件。对于 chat.json 等动态配置，优先从 Gitee raw 拉取最新配置，失败时回退本地。"""
    try:
        base = os.path.normpath(config.get_resource_path('resources'))
        safe = os.path.normpath(os.path.join(base, filename))
        if not safe.startswith(base):
            return error('非法资源路径', 400)

        # 对于 chat.json 等需要动态修改生效的配置文件，优先请求 Gitee 远程仓库获取最新内容
        if filename.lower() == 'chat.json':
            try:
                import requests
                t = int(time.time())
                urls = [
                    f'https://raw.giteeusercontent.com/iozxc/rocokingdom_recognizer/raw/master/resources/chat.json?_t={t}',
                    f'https://gitee.com/iozxc/rocokingdom_recognizer/raw/master/resources/chat.json?_t={t}',
                ]
                for u in urls:
                    try:
                        r = requests.get(u, timeout=4, headers={'Cache-Control': 'no-cache', 'User-Agent': 'Mozilla/5.0'})
                        if r.status_code == 200 and r.content:
                            # 成功获取最新远程配置，同时同步写入本地文件作为离线缓存
                            if os.path.exists(base):
                                try:
                                    with open(safe, 'wb') as f:
                                        f.write(r.content)
                                except Exception:
                                    pass
                            return Response(r.content, mimetype='application/json; charset=utf-8')
                    except Exception:
                        continue
            except Exception as e:
                logger.warning(f"动态获取远程 chat.json 失败，回退本地文件: {e}")

        if os.path.exists(safe) and os.path.isfile(safe):
            return send_from_directory(base, filename)

        # 本地未找到（未打包进 exe）：由后端从 Gitee raw 拉取，
        # 避免前端跨域访问 Gitee 时遇到 302/CORS 问题。
        import requests
        url = f'https://raw.giteeusercontent.com/iozxc/rocokingdom_recognizer/raw/master/resources/{filename}'
        resp = requests.get(url, timeout=10)
        if resp.status_code != 200:
            url = f'https://gitee.com/iozxc/rocokingdom_recognizer/raw/master/resources/{filename}'
            resp = requests.get(url, timeout=10)
        if resp.status_code != 200:
            logger.warning(f"资源 {filename} 本地与远程均不存在")
            return error('资源不存在', 404)
        mime = 'application/json; charset=utf-8' if filename.lower().endswith('.json') else 'image/png'
        return Response(resp.content, mimetype=mime)
    except Exception as e:
        logger.error(f"[GET /api/resources/{filename}] 异常: {e}", exc_info=True)
        return error(str(e), 500)


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
