"""桌面端：Flask 服务与 pywebview 窗口的启动编排。"""
import socket
import threading
import time

import webview

from desktop.bridge import AppApi
from desktop.server import pick_free_port, start_server
from desktop.windows import WindowManager
from core.logger import logger


def run(app) -> None:
    """启动 Flask 服务与主窗口（阻塞直到全部窗口关闭）。"""
    port = pick_free_port()
    logger.info(f"动态端口已分配: {port}")

    # 先启动 Flask 服务器并等待端口就绪，再创建窗口，
    # 避免 WebView 先加载页面时服务器未就绪导致白屏
    server_thread = threading.Thread(
        target=start_server,
        kwargs={"app": app, "port": port},
        daemon=True,
    )
    server_thread.start()
    _wait_for_server(port)

    window_manager = WindowManager(server_port=port)
    api = AppApi(window_manager=window_manager, app=app)
    window_manager.js_api = api

    logger.info("启动主窗口...")
    window_manager.create_main_window()
    webview.start()


def _wait_for_server(port: int, timeout_seconds: int = 30) -> None:
    """等待 waitress 监听端口就绪；超时只告警，不阻塞启动。"""
    for _ in range(timeout_seconds * 10):
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                return
        except OSError:
            time.sleep(0.1)
    logger.error("Flask 服务器启动超时，主窗口可能白屏")
