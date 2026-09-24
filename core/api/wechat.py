"""本地微信小程序提醒代理接口。

前端只访问本机 Flask；由本模块用现有设备签名请求云端授权服务器。
小程序 AppSecret 不进入客户端。
"""
from flask import Blueprint, request

from core.api.response import error, success
from core.services import wechat_push

bp = Blueprint("wechat", __name__)


def _relay(result: dict):
    if result.get("ok"):
        return success(data=result)
    message = result.get("msg") or "微信小程序提醒服务暂不可用"
    status = int(result.get("_status") or 502)
    if status < 400:
        status = 502
    return error(message, status)


@bp.route("/api/wechat/binding", methods=["GET"])
def api_wechat_binding():
    """查询当前设备的微信小程序绑定状态。"""
    return _relay(wechat_push.get_binding())


@bp.route("/api/wechat/promo/qr", methods=["POST"])
def api_wechat_promo_qr():
    """桌面端引流：生成小程序码，不建立绑定。target 决定扫码落哪一页。"""
    payload = request.get_json(silent=True) or {}
    target = str(payload.get("target") or "merchant").strip().lower()
    if target not in ("merchant", "trial"):
        target = "merchant"
    return _relay(wechat_push.get_promo_qr(target))


@bp.route("/api/wechat/bind/start", methods=["POST"])
def api_wechat_bind_start():
    """开始扫码绑定：target 决定扫码落哪一页。"""
    payload = request.get_json(silent=True) or {}
    target = str(payload.get("target") or "merchant").strip().lower()
    if target not in ("merchant", "trial"):
        target = "merchant"
    return _relay(wechat_push.start_binding(target))


@bp.route("/api/wechat/bind/status", methods=["GET", "POST"])
def api_wechat_bind_status():
    """查询扫码绑定状态。ticket 走查询参数或 JSON body。"""
    payload = request.get_json(silent=True) or {}
    ticket = str(request.args.get("ticket") or payload.get("ticket") or "").strip()
    if not ticket:
        return error("缺少绑定票据 ticket", 400)
    return _relay(wechat_push.get_bind_status(ticket))


@bp.route("/api/wechat/unbind", methods=["POST"])
def api_wechat_unbind():
    """解除当前设备的微信小程序绑定。"""
    return _relay(wechat_push.unbind())


@bp.route("/api/wechat/test", methods=["POST"])
def api_wechat_test():
    """发送测试微信小程序通知。"""
    return _relay(wechat_push.send_test())


@bp.route("/api/wechat/progress", methods=["GET", "POST"])
def api_wechat_progress():
    """图鉴进度云端同步：GET 拉取 / POST 上传。"""
    if request.method == "GET":
        return _relay(wechat_push.get_progress())
    payload = request.get_json(silent=True) or {}
    encounters = payload.get("payload", {}).get("encounters", payload.get("encounters"))
    if not isinstance(encounters, dict):
        return error("缺少进度 encounters", 400)
    return _relay(wechat_push.save_progress(encounters))


@bp.route("/api/wechat/subscriptions", methods=["GET", "POST"])
def api_wechat_subscriptions():
    """读取或保存当前设备的提醒偏好。"""
    if request.method == "GET":
        return _relay(wechat_push.get_subscriptions())
    payload = request.get_json(silent=True) or {}
    rules = payload.get("rules")
    if not isinstance(rules, dict):
        return error("缺少提醒设置 rules", 400)
    return _relay(wechat_push.save_subscriptions(rules))


@bp.route("/api/wechat/device_tag", methods=["GET"])
def api_wechat_device_tag():
    """返回当前设备的统一标识码与绑定状态（供「数据管理」显示）。"""
    return _relay(wechat_push.device_tag())
