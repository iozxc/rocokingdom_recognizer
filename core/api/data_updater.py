"""图鉴数据更新 API：检查、异步下载、进度查询。"""
from flask import Blueprint

from core.api.response import error, success
from core.services.data_updater import (
    check_data_updates,
    get_job_status,
    start_data_update,
)
from core.infra.logger import logger

bp = Blueprint("data_updater", __name__)


@bp.route("/api/data_updates/check", methods=["GET"])
def api_check_data_updates():
    """对比数据清单与本地文件，返回需要更新的文件列表。"""
    try:
        result = check_data_updates()
        return success(data=result)
    except Exception as e:
        logger.error(f"[GET /api/data_updates/check] 异常: {e}", exc_info=True)
        return error(str(e), 500)


@bp.route("/api/data_updates/download", methods=["POST"])
def api_start_data_update():
    """异步开始下载更新。"""
    try:
        result = start_data_update()
        return success(data=result)
    except Exception as e:
        logger.error(f"[POST /api/data_updates/download] 异常: {e}", exc_info=True)
        return error(str(e), 500)


@bp.route("/api/data_updates/status", methods=["GET"])
def api_data_update_status():
    """查询当前下载任务状态与进度。"""
    try:
        return success(data=get_job_status())
    except Exception as e:
        logger.error(f"[GET /api/data_updates/status] 异常: {e}", exc_info=True)
        return error(str(e), 500)

