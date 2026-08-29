"""RocoKingdomRecognizer 桌面端入口。"""
import ctypes

import config
from core.logger import logger


def _enable_dpi_awareness() -> None:
    """开启 Windows 进程级 DPI 感知，避免界面模糊。"""
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(1)
    except Exception:
        ctypes.windll.user32.SetProcessDPIAware()


def main() -> None:
    # 启动分隔符必须最先打印：desktop 包的导入会触发模型/用户数据加载，
    # 如果放在 acquire() 之后，那些加载日志会排在分隔符前面
    logger.info("=" * 50)
    logger.info(f"程序启动，初始化模块 版本：{config.APP_VERSION}")

    _enable_dpi_awareness()

    # 已有实例窗口可见：直接唤起后退出（不弹提示，避免重复点击闪出弹窗）
    from bootstrap.single_instance import activate_existing_if_visible
    if activate_existing_if_visible():
        return

    # 启动提示：立即给出反馈，避免模型加载慢时误以为闪退（可在系统设置里关闭）
    hint = None
    from bootstrap.settings import hints_enabled
    if hints_enabled():
        from bootstrap.splash import show_hint
        hint = show_hint(message="正在启动，请稍候...")

    # 单实例保护：已有实例在运行时直接退出，避免两个进程同时读写用户数据
    from bootstrap.single_instance import acquire
    if not acquire():
        if hint is not None:
            hint.close()
        return

    # 启动后台授权校验：未授权时前端弹窗引导绑定，不阻塞 UI。
    from core.auth_service import start_auth_check
    start_auth_check()

    from core import create_app
    from desktop import run

    app = create_app()
    run(app, hint=hint)


if __name__ == '__main__':
    main()
