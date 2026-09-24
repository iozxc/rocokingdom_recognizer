"""微信小程序提醒服务（客户端 → 云授权服务器）。

本模块只做本地代理，不持有小程序 AppSecret。AppSecret 只存在云服务器。
所有请求都复用现有设备授权 HMAC 签名，云服务器按 machine_code 找到对应绑定。
"""
from __future__ import annotations

from typing import Any

from core.auth import client as auth_client


def _call(path: str, extra: dict[str, Any] | None = None, timeout: int = 20) -> dict[str, Any]:
    try:
        machine_code = auth_client.get_machine_code()
        ts, sign = auth_client.make_sign(machine_code)
        body: dict[str, Any] = {
            "machine_code": machine_code,
            "timestamp": ts,
            "sign": sign,
        }
        if extra:
            body.update(extra)
        resp = auth_client._post_api(path, body, timeout=timeout)
        try:
            data = resp.json()
        except Exception:
            data = {"ok": False, "msg": f"云端返回了非 JSON 响应（HTTP {resp.status_code}）"}
        if not isinstance(data, dict):
            data = {"ok": False, "msg": "云端返回格式异常"}
        data.setdefault("_status", resp.status_code)
        if not data.get("ok") and resp.status_code >= 400 and not data.get("msg"):
            data["msg"] = f"云端请求失败（HTTP {resp.status_code}）"
        return data
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "msg": f"无法连接微信小程序提醒服务：{exc}"}


def get_binding() -> dict[str, Any]:
    """查询当前设备是否已绑定微信小程序。"""
    return _call("/api/mini/binding")


def get_promo_qr(target: str = "merchant") -> dict[str, Any]:
    """生成只用于引流的小程序码，不建立桌面绑定。"""
    return _call("/api/mini/qr", {"target": target}, timeout=25)


def start_binding(target: str = "merchant") -> dict[str, Any]:
    """兼容旧接口：创建一次性绑定二维码。当前独立小程序流程不使用。"""
    return _call("/api/mini/bind/start", {"target": target}, timeout=25)


def get_bind_status(ticket: str) -> dict[str, Any]:
    """轮询绑定状态。客户端轮询本机代理，由本机代理查询云服务器。"""
    return _call("/api/mini/bind/status", {"ticket": ticket}, timeout=25)


def unbind() -> dict[str, Any]:
    """解除当前设备的微信小程序绑定。"""
    return _call("/api/mini/unbind")


def send_test() -> dict[str, Any]:
    """发送一条微信小程序测试消息。"""
    return _call("/api/mini/test", timeout=25)


def get_progress() -> dict[str, Any]:
    """拉取云端图鉴进度。"""
    return _call("/api/mini/progress")


def save_progress(encounters: dict[str, Any]) -> dict[str, Any]:
    """上传本机图鉴进度。"""
    return _call("/api/mini/progress", {"payload": {"encounters": encounters}}, timeout=20)


def get_subscriptions() -> dict[str, Any]:
    """读取当前设备的提醒偏好。"""
    return _call("/api/mini/subscriptions")


def save_subscriptions(rules: dict[str, Any]) -> dict[str, Any]:
    """保存当前设备的提醒偏好。"""
    return _call("/api/mini/subscriptions", {"rules": rules}, timeout=20)


def device_tag() -> dict[str, Any]:
    """统一设备标识码（base64(归属码) 前 24 位），PC / Web / 小程序一致。"""
    return _call("/api/device/tag")
