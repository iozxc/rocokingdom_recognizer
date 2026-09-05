import json
import os
import re
import time

from flask import Blueprint, Response, current_app, request, send_from_directory, url_for

import config
from core.api.response import error, success
from core.infra.db import get_db, get_ts_db
from core.infra.icon_names import load_map_pets, sprite_to_file, sprite_to_file_any
from core.infra.logger import logger
from core.infra.pet_path import sort_key
from core.services.trials import get_trial_or_default, load_pet_elements
from core.infra.utils import strip_id_prefix

bp = Blueprint("main", __name__)

ICONS = {}
ICON_FILE_CACHE = {}
TS_ICON_CACHE = {}
_TRAITS_CACHE = None


def _load_traits_skills():
    """读取 traits_skills.json，失败回退空结构。"""
    global _TRAITS_CACHE
    if _TRAITS_CACHE is not None:
        return _TRAITS_CACHE
    path = config.get_resource_path(os.path.join("datasets", "traits_skills.json"))
    if not os.path.exists(path):
        path = config.TRAITS_SKILLS_JSON
    try:
        with open(path, "r", encoding="utf-8") as f:
            _TRAITS_CACHE = json.load(f)
    except Exception as e:
        logger.error(f"读取 traits_skills.json 失败 {path}: {e}", exc_info=True)
        _TRAITS_CACHE = {"traits": {}, "skills": {}}
    return _TRAITS_CACHE


def _resolve_pet_info(meta, traits):
    """把 map_pets 里的 trait_id / active_skills 解析成可展示对象。"""
    trait = None
    tid = meta.get("trait_id")
    if tid:
        t = (traits.get("traits") or {}).get(tid) or {}
        if t.get("name"):
            trait = {
                "id": tid,
                "name": t.get("name"),
                "desc": t.get("desc"),
                "glossary": t.get("glossary") or [],
                "icon_url": url_for("main.ts_icon_file", filename=t.get("icon_id") or tid, _external=True),
            }

    skills = []
    for sid in meta.get("active_skills") or []:
        s = (traits.get("skills") or {}).get(sid) or {}
        if not s.get("name"):
            continue
        skills.append({
            "sid": sid,
            "name": s.get("name"),
            "desc": s.get("desc"),
            "skill_type": s.get("skill_type"),
            "element": s.get("element"),
            "damage_kind": s.get("damage_kind"),
            "energy_cost": s.get("energy_cost"),
            "power": s.get("power"),
            "glossary": s.get("glossary") or [],
            "icon_url": url_for("main.ts_icon_file", filename=sid, _external=True),
        })
    return {"trait": trait, "skills": skills}


def invalidate_icons_cache():
    """清空 /icons 列表缓存（图鉴数据更新后调用）。"""
    global ICONS
    global _TRAITS_CACHE
    global TS_ICON_CACHE
    ICONS.clear()
    TS_ICON_CACHE.clear()
    _TRAITS_CACHE = None


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
        traits = _load_traits_skills()
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
                extra = _resolve_pet_info(meta, traits)
                items.append({
                    # 对外/用户数据不保留 id 前缀；URL 仍指向真实数据集文件
                    "name": strip_id_prefix(filename),
                    "id": pet_id,
                    "seq": seq_val,
                    "elements": elements_map.get((pet_id, seq_val), []),
                    "url": url_for('main.get_icon_file', filename=filename, _external=True),
                    **extra,
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


@bp.route('/ts_icons/<path:filename>')
def ts_icon_file(filename):
    """从 datasets_ts.db 返回技能/特性图标。"""
    key = filename[:-4] if filename.lower().endswith(".png") else filename
    # 首领特性 T005a/T005b 与基础 T005 共用图标：直接回退到基础编号
    keys = [key]
    base_match = re.match(r"^(T\d+)[a-z]$", key)
    if base_match:
        keys.append(base_match.group(1))
    for candidate in keys:
        if candidate in TS_ICON_CACHE:
            return Response(TS_ICON_CACHE[candidate], mimetype="image/png")
    try:
        conn = get_ts_db()
        for candidate in keys:
            row = conn.execute("SELECT data FROM icons WHERE path = ?", (candidate,)).fetchone()
            if row:
                TS_ICON_CACHE[candidate] = row[0]
                TS_ICON_CACHE[key] = row[0]
                return Response(row[0], mimetype="image/png")
        return "Icon Not Found", 404
    except Exception as e:
        logger.error(f"ts_icon_file {filename}: {e}", exc_info=True)
        return str(e), 500


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
            # 纯展示名（如火系跟随识别返回的“乌达_极夜.png”，已被去掉 id 前缀）按 icons.name 反查
            row = db.execute("SELECT data FROM icons WHERE name = ?", (db_path,)).fetchone()
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
