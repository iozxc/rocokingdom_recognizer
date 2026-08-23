from flask import Blueprint, request

from core.api.response import error, success
from core.services.user_storage import user_storage
from logger import logger

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
