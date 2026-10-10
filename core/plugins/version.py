"""插件 ↔ 主程序 的版本兼容判断。

插件清单里用两个字段声明它适配的主程序版本范围：

    min_app_version   主程序最低版本（含）；低于它 → 不兼容
    max_app_version   主程序最高版本（含）；高于它 → 不兼容；留空 = 不限

放在单独模块里，保证「检查更新 / 市场安装 / 更新 / 启用」用的是同一套判断，
不会出现某个入口漏判（例如主程序升级后仍把不适配的插件更新上去）。
"""
from __future__ import annotations

FLOOR = "0.0.0"


def _ver(text: str):
    """把版本号转成可比较对象；解析不了返回 None（调用方退回字符串比较）。"""
    raw = str(text or "").strip()
    if not raw:
        return None
    try:
        from packaging.version import InvalidVersion, Version

        try:
            return Version(raw)
        except InvalidVersion:
            return None
    except Exception:  # noqa: BLE001
        return None


def compare(a: str, b: str) -> int:
    """a > b 返回 1，a < b 返回 -1，相等 0。非法版本号退回字符串比较。"""
    va, vb = _ver(a), _ver(b)
    if va is not None and vb is not None:
        return (va > vb) - (va < vb)
    sa, sb = str(a or "").strip(), str(b or "").strip()
    return (sa > sb) - (sa < sb)


def describe_range(min_app: str = "", max_app: str = "") -> str:
    """给用户看的中文范围描述。"""
    lo = str(min_app or "").strip()
    hi = str(max_app or "").strip()
    if lo in ("", FLOOR) and not hi:
        return "不限"
    if not hi:
        return f"主程序 ≥ {lo}"
    if lo in ("", FLOOR):
        return f"主程序 ≤ {hi}"
    return f"主程序 {lo} ~ {hi}"


def is_compatible(app_version: str, min_app: str = "", max_app: str = "") -> tuple[bool, str]:
    """返回 (是否兼容, 不兼容原因)；兼容时原因为空串。"""
    app = str(app_version or "").strip()
    lo = str(min_app or "").strip() or FLOOR
    hi = str(max_app or "").strip()
    if not app:
        return False, "无法确定主程序版本"
    if compare(app, lo) < 0:
        return False, f"需要{describe_range(lo, hi)}，当前主程序 {app} 过低，请先更新主程序"
    if hi and compare(app, hi) > 0:
        return False, f"需要{describe_range(lo, hi)}，当前主程序 {app} 过高（该插件还没适配新版本主程序），请等待插件更新"
    return True, ""
