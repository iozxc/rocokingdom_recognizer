from flask import Blueprint, request

from core.api.response import success, error
from core.auth.service import get_state, is_authorized
from core.services import cloud_sync
from core.services.user_storage import CLOUD_SYNC_AGREED_KEY, user_storage
from core.infra.logger import logger

bp = Blueprint("cloud", __name__)

AGREEMENT_KEY = CLOUD_SYNC_AGREED_KEY

# 设备门禁未放行时的统一文案：明确说明是未授权，与前端提示卡口径一致。
CLOUD_LOCK_MSG = "当前设备未授权，无法使用云端同步；请先完成授权后再试"


def _agreement_accepted() -> bool:
    try:
        return bool((user_storage.load() or {}).get(AGREEMENT_KEY))
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[cloud] 读取同步协议同意状态失败: {e}")
        return False


def _agreement_required():
    """未同意协议时返回统一错误响应，否则返回 None。"""
    if _agreement_accepted():
        return None
    return error("请先阅读并同意《云端同步协议》", 403)


def _device_required():
    """设备未放行（未授权/等待绑定/过期等）时返回统一错误响应，否则返回 None。

    is_authorized() 把 offline（授权服务器暂时不可达的宽限期）也视为放行，
    与前端 useFeatureLock 的口径一致；真正拦的是 waiting / expired / error / banned。
    """
    if is_authorized():
        return None
    status = ""
    try:
        status = (get_state() or {}).get("status", "")
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[cloud] 读取授权状态失败: {e}")
    logger.info(f"[cloud] 设备未放行，拒绝云端同步请求（status={status}）")
    return error(CLOUD_LOCK_MSG, 403)


@bp.route("/api/cloud/agreement", methods=["GET"])
def api_cloud_agreement_get():
    return success(agreed=_agreement_accepted())


@bp.route("/api/cloud/agreement", methods=["POST"])
def api_cloud_agreement_set():
    body = request.get_json(silent=True) or {}
    agreed = bool(body.get("agreed"))
    try:
        user_storage.save({AGREEMENT_KEY: agreed})
    except Exception as e:  # noqa: BLE001
        logger.error(f"[cloud] 保存同步协议同意状态失败: {e}", exc_info=True)
        return error("保存协议状态失败", 500)
    return success(agreed=agreed)


@bp.route("/api/cloud/pair_code", methods=["GET"])
def api_cloud_pair_code():
    """生成一次性配对码（给网页端绑定用），10 分钟内有效。"""
    gate = _device_required()
    if gate is not None:
        return gate
    gate = _agreement_required()
    if gate is not None:
        return gate
    res = cloud_sync.request_pair_code()
    if res.get("ok"):
        return success(code=res.get("code"), expiresIn=res.get("expires_in"))
    return error(res.get("msg") or "申请配对码失败", 502)


@bp.route("/api/cloud/pull", methods=["POST"])
def api_cloud_pull():
    gate = _device_required()
    if gate is not None:
        return gate
    gate = _agreement_required()
    if gate is not None:
        return gate
    res = cloud_sync.pull_overwrite("manual")
    if res.get("ok"):
        return success()
    return error(res.get("msg") or "拉取失败", 502)


@bp.route("/api/cloud/push", methods=["POST"])
def api_cloud_push():
    gate = _device_required()
    if gate is not None:
        return gate
    gate = _agreement_required()
    if gate is not None:
        return gate
    res = cloud_sync.push_overwrite("manual")
    if res.get("ok"):
        return success()
    return error(res.get("msg") or "上传失败", 502)


@bp.route("/api/cloud/bindings", methods=["GET"])
def api_cloud_bindings():
    """列出已配对的网页端（仅桌面端可调）。"""
    res = cloud_sync.list_bindings()
    if res.get("ok"):
        return success(bindings=res.get("bindings") or [])
    return error(res.get("msg") or "获取配对列表失败", 502)


@bp.route("/api/cloud/bindings/revoke", methods=["POST"])
def api_cloud_bindings_revoke():
    """撤销某个网页端的同步权限。body: {webCode}"""
    payload = request.get_json(silent=True) or {}
    web_code = str(payload.get("webCode") or "").strip()
    if not web_code:
        return error("缺少 webCode", 400)
    res = cloud_sync.revoke_binding(web_code)
    if res.get("ok"):
        return success()
    return error(res.get("msg") or "撤销失败", 502)


@bp.route("/api/cloud/refresh", methods=["POST"])
def api_cloud_refresh():
    gate = _device_required()
    if gate is not None:
        return gate
    gate = _agreement_required()
    if gate is not None:
        return gate
    res = cloud_sync.refresh_meta()
    if not res.get("ok"):
        return error(res.get("msg") or "获取云端更新时间失败", 502)
    status = cloud_sync.get_status()
    return success(
        exists=res.get("exists"),
        cloudUpdatedAt=res.get("updatedAt"),
        cloudUpdatedTs=res.get("updatedAtTs"),
        cloudBytes=res.get("bytes"),
        cloudVersion=res.get("version"),
        cloudAhead=status.get("cloudAhead"),
    )


@bp.route("/api/cloud/status", methods=["GET"])
def api_cloud_status():
    """同步状态（上次成功时间 / 错误 / 是否正在同步）。"""
    return success(**cloud_sync.get_status())
