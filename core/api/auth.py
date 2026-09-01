"""本地授权状态接口。

供前端读取后台授权线程的实时状态：
- GET  /api/local/auth_status -> 当前授权状态快照
- POST /api/local/auth_retry  -> 网络异常后重试授权校验
"""
from flask import Blueprint, request

from core.api.response import error, success
from core.auth.service import (
    get_state,
    retry_auth,
    reauthorize_auth,
    set_poll_mode,
    refresh_auth_code,
    unbind_device,
)
from core.infra.logger import logger

bp = Blueprint("auth", __name__)


@bp.route("/api/local/auth_status", methods=["GET"])
def auth_status():
    """返回当前授权状态（供前端轮询）。"""
    return success(data=get_state())


@bp.route("/api/local/auth_retry", methods=["POST"])
def auth_retry():
    """网络异常后重新拉起授权校验线程。"""
    try:
        retry_auth()
    except Exception as e:
        logger.error(f"授权重试异常: {e}", exc_info=True)
        return error(f"授权重试失败: {e}", 500)
    return success(data=get_state())


@bp.route("/api/local/auth_reauthorize", methods=["POST"])
def auth_reauthorize():
    """主动“重新授权”：强制进入绑定流程（用于过期/删除后重新绑定）。"""
    try:
        reauthorize_auth()
    except Exception as e:
        logger.error(f"重新授权异常: {e}", exc_info=True)
        return error(f"重新授权失败: {e}", 500)
    return success(data=get_state())


@bp.route("/api/local/auth_poll_mode", methods=["POST"])
def auth_poll_mode():
    """切换授权轮询快/慢（前端未授权弹窗开关触发）。"""
    try:
        payload = request.get_json(silent=True) or {}
        mode = payload.get("mode", "slow")
        interval = set_poll_mode(mode)
    except Exception as e:
        logger.error(f"切换轮询模式异常: {e}", exc_info=True)
        return error(f"切换轮询模式失败: {e}", 500)
    return success(data={"mode": mode, "interval": interval})


@bp.route("/api/local/auth_refresh", methods=["POST"])
def auth_refresh():
    """授权前“换授权码”：重新生成授权码并重置为未绑定，返回新状态。"""
    try:
        state = refresh_auth_code()
    except Exception as e:
        logger.error(f"刷新授权码异常: {e}", exc_info=True)
        return error(f"刷新授权码失败: {e}", 500)
    return success(data=state)


@bp.route("/api/local/auth_unbind", methods=["POST"])
def auth_unbind():
    """解绑当前设备：清空绑定并重新生成授权码，返回新状态（未授权/待绑定）。"""
    try:
        state = unbind_device()
    except Exception as e:
        logger.error(f"解绑异常: {e}", exc_info=True)
        return error(f"解绑失败: {e}", 500)
    return success(data=state)
