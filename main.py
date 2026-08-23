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

    logger.info("=" * 50)
    logger.info(f"程序启动，初始化模块 版本：{config.APP_VERSION}")

    from core import create_app
    from desktop import run

    app = create_app()
    run(app)


if __name__ == '__main__':
    main()
