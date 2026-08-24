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
    _enable_dpi_awareness()

    # 单实例保护：已有实例在运行时直接退出，避免两个进程同时读写用户数据
    from desktop.single_instance import acquire
    if not acquire():
        return

    # 启动提示：模型加载可能较慢，先给用户一个“正在启动”的反馈，避免误以为闪退
    from desktop.splash import show_splash
    splash = show_splash()

    logger.info("=" * 50)
    logger.info(f"程序启动，初始化模块 版本：{config.APP_VERSION}")

    from core import create_app
    from desktop import run

    app = create_app()
    run(app, splash=splash)


if __name__ == '__main__':
    main()
