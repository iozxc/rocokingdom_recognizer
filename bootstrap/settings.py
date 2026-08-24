"""读取本地用户设置（提示开关等），只依赖轻量模块，可在启动早期安全调用。"""

from core.services.user_storage import user_storage


def hints_enabled() -> bool:
    """是否显示启动/退出提示窗口（默认显示，可在系统设置里关闭）。"""
    try:
        return bool(user_storage.get_app_settings().get("showHints", True))
    except Exception:
        return True
