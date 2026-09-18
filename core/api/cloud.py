"""云端同步的本机接口（供前端「数据管理 → 云端同步」使用）。

真正的同步逻辑在 core/services/cloud_sync.py：它用机器签名直连授权服务器的
/api/user_data/*，本机这些接口只是把它暴露给前端 UI。
"""
from flask import Blueprint

from core.api.response import success, error
from core.services import cloud_sync

bp = Blueprint("cloud", __name__)


@bp.route("/api/cloud/pair_code", methods=["GET"])
def api_cloud_pair_code():
    """生成一次性配对码（给网页端绑定用），10 分钟内有效。"""
    res = cloud_sync.request_pair_code()
    if res.get("ok"):
        return success(code=res.get("code"), expiresIn=res.get("expires_in"))
    return error(res.get("msg") or "申请配对码失败", 502)


@bp.route("/api/cloud/pull", methods=["POST"])
def api_cloud_pull():
    """用云端那份直接覆盖本地（不合并）。"""
    res = cloud_sync.pull_overwrite("manual")
    if res.get("ok"):
        return success()
    return error(res.get("msg") or "拉取失败", 502)


@bp.route("/api/cloud/push", methods=["POST"])
def api_cloud_push():
    """用本地那份直接覆盖云端（不合并）。"""
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
    from flask import request as _req
    payload = _req.get_json(silent=True) or {}
    web_code = str(payload.get("webCode") or "").strip()
    if not web_code:
        return error("缺少 webCode", 400)
    res = cloud_sync.revoke_binding(web_code)
    if res.get("ok"):
        return success()
    return error(res.get("msg") or "撤销失败", 502)


@bp.route("/api/cloud/status", methods=["GET"])
def api_cloud_status():
    """同步状态（上次成功时间 / 错误 / 是否正在同步）。"""
    return success(**cloud_sync.get_status())
