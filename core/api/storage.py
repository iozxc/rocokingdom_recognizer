from flask import Blueprint, request

from core.api.response import error, success
from core.services.user_storage import user_storage
from core.services.user_map_storage import user_map_storage
from core.infra.logger import logger

bp = Blueprint("storage", __name__)


@bp.route("/api/storage/<version>", methods=["GET"])
def api_get_storage(version):
    try:
        client_version = int(version)
    except (ValueError, TypeError):
        logger.warning(f"版本参数非法 {version}")
        return user_storage.load()

    if client_version == user_storage.version:
        return {"status": "ok"}
    return user_storage.load()


@bp.route("/api/storage", methods=["POST"])
def api_post_storage():
    payload = request.get_json()
    if not payload:
        logger.warning("[POST /api/storage] 请求体为空或非JSON")
        return error("Invalid JSON", 400)

    try:
        new_data = user_storage.save(payload)
        return success(version=new_data["version"])
    except Exception as e:
        logger.error(f"[POST /api/storage] 保存异常: {e}", exc_info=True)
        return error(str(e), 500)


@bp.route("/api/accounts", methods=["GET"])
def api_accounts_list():
    """列出本地账号与当前激活账号。"""
    try:
        from core.services.account_store import current_account, list_accounts
        accounts = list_accounts()
        return success(data={"accounts": accounts, "current": current_account()})
    except Exception as e:
        logger.error(f"[GET /api/accounts] 异常: {e}", exc_info=True)
        return error(str(e), 500)


@bp.route("/api/accounts/create", methods=["POST"])
def api_account_create():
    try:
        from core.services.account_store import create_account
        data = request.get_json(silent=True) or {}
        name = str(data.get("name") or "").strip()
        if not name:
            return error("账号名称不能为空", 400)
        created = create_account(name)
        return success(data=created)
    except Exception as e:
        logger.error(f"[POST /api/accounts/create] 异常: {e}", exc_info=True)
        return error(str(e), 500)


@bp.route("/api/accounts/rename", methods=["POST"])
def api_account_rename():
    try:
        from core.services.account_store import rename_account
        data = request.get_json(silent=True) or {}
        old_name = str(data.get("old_name") or "").strip()
        new_name = str(data.get("new_name") or "").strip()
        if not old_name or not new_name:
            return error("参数不完整", 400)
        result = rename_account(old_name, new_name)
        return success(data=result)
    except ValueError as e:
        return error(str(e), 400)
    except Exception as e:
        logger.error(f"[POST /api/accounts/rename] 异常: {e}", exc_info=True)
        return error(str(e), 500)


@bp.route("/api/accounts/switch", methods=["POST"])
def api_account_switch():
    try:
        from core.services.account_store import switch_account
        data = request.get_json(silent=True) or {}
        name = str(data.get("name") or "").strip()
        if not switch_account(name):
            return error("账号不存在", 404)
        return success(data={"name": name})
    except Exception as e:
        logger.error(f"[POST /api/accounts/switch] 异常: {e}", exc_info=True)
        return error(str(e), 500)


@bp.route("/api/accounts/delete", methods=["POST"])
def api_account_delete():
    try:
        from core.services.account_store import delete_account
        data = request.get_json(silent=True) or {}
        name = str(data.get("name") or "").strip()
        if not name:
            return error("账号名称不能为空", 400)
        result = delete_account(name)
        return success(data=result)
    except Exception as e:
        logger.error(f"[POST /api/accounts/delete] 异常: {e}", exc_info=True)
        return error(str(e), 500)


@bp.route("/api/map_storage/<version>", methods=["GET"])
def api_get_map_storage(version):
    try:
        client_version = int(version)
    except (ValueError, TypeError):
        logger.warning(f"地图版本参数非法 {version}")
        return user_map_storage.load()

    if client_version == user_map_storage.version:
        return {"status": "ok"}
    return user_map_storage.load()


@bp.route("/api/map_storage", methods=["POST"])
def api_post_map_storage():
    payload = request.get_json()
    if not payload:
        logger.warning("[POST /api/map_storage] 请求体为空或非JSON")
        return error("Invalid JSON", 400)

    try:
        new_data = user_map_storage.save(payload)
        return success(version=new_data["version"])
    except Exception as e:
        logger.error(f"[POST /api/map_storage] 地图数据保存异常: {e}", exc_info=True)
        return error(str(e), 500)

