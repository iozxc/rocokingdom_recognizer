"""云端同步的本机接口（供前端「数据管理 → 云端同步」使用）。

真正的同步逻辑在 core/services/cloud_sync.py：它用机器签名直连授权服务器的
/api/user_data/*，本机这些接口只是把它暴露给前端 UI。
"""
from flask import Blueprint, request

from core.api.response import success, error
from core.services import cloud_sync
from core.services.user_storage import CLOUD_SYNC_AGREED_KEY, user_storage
from core.infra.logger import logger

bp = Blueprint("cloud", __name__)

# 《云端同步协议》同意标记在 roco_user_data.json 顶层用的键名
# （列在 user_storage.CLIENT_LEVEL_KEYS 里，账号切换 / 云端覆盖时不会被换掉）
AGREEMENT_KEY = CLOUD_SYNC_AGREED_KEY


def _agreement_accepted() -> bool:
    """《云端同步协议》是否已同意。

    标记存在**用户自己的 roco_user_data.json 顶层**，不是 localStorage：
    桌面端 WebView 是 private 模式，localStorage 关掉 App 就没了，
    依赖它会出现「每次都重新弹协议」的问题。
    """
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


@bp.route("/api/cloud/agreement", methods=["GET"])
def api_cloud_agreement_get():
    """读取《云端同步协议》的同意状态（桌面端）。"""
    return success(agreed=_agreement_accepted())


@bp.route("/api/cloud/agreement", methods=["POST"])
def api_cloud_agreement_set():
    """写入《云端同步协议》的同意状态（桌面端，落在 roco_user_data.json 顶层）。

    body = {"agreed": true/false}
    user_storage.save 是「合并写入」：只更新这一个顶层字段，不会碰账号数据。
    """
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
    gate = _agreement_required()
    if gate is not None:
        return gate
    res = cloud_sync.request_pair_code()
    if res.get("ok"):
        return success(code=res.get("code"), expiresIn=res.get("expires_in"))
    return error(res.get("msg") or "申请配对码失败", 502)


@bp.route("/api/cloud/pull", methods=["POST"])
def api_cloud_pull():
    """用云端那份直接覆盖本地（不合并）。"""
    gate = _agreement_required()
    if gate is not None:
        return gate
    res = cloud_sync.pull_overwrite("manual")
    if res.get("ok"):
        return success()
    return error(res.get("msg") or "拉取失败", 502)


@bp.route("/api/cloud/push", methods=["POST"])
def api_cloud_push():
    """用本地那份直接覆盖云端（不合并）。"""
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
    """手动刷新「云端最后更新时间」（只读元信息，不动任何数据）。

    面板上原本显示的是「上次同步时看到的云端时间」，点这个按钮才会去服务器取当前值，
    用户据此判断云端有没有被别的设备改过（cloudAhead）。
    """
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
