"""桌面端：Flask 服务与 pywebview 窗口的启动编排。"""
import os
import socket
import sys
import threading
import time

import webview

from desktop.bridge import AppApi
from desktop.server import create_server, pick_free_port
from desktop.windows import WindowManager
from core.logger import logger

# 窗口关闭后给前端最后一批请求（页面卸载时的 sendBeacon 落盘）留出的处理时间
_EXIT_GRACE_SECONDS = 0.6
# 主窗口关闭后，若 webview 事件循环超过该时间仍未返回，强制退出进程
_WATCHDOG_TIMEOUT_SECONDS = 3.0


def run(app, splash=None) -> None:
    """启动 Flask 服务与主窗口（阻塞直到全部窗口关闭）。"""
    port = pick_free_port()
    logger.info(f"动态端口已分配: {port}")

    server = create_server(app, port=port)
    server_thread = threading.Thread(
        target=server.run,
        name="flask-server",
        daemon=True,
    )
    # 先启动 Flask 服务器并等待端口就绪，再创建窗口，
    # 避免 WebView 先加载页面时服务器未就绪导致白屏
    server_thread.start()
    _wait_for_server(port)

    window_manager = WindowManager(server_port=port)
    api = AppApi(window_manager=window_manager)
    window_manager.js_api = api

    logger.info("启动主窗口...")
    window_manager.create_main_window()
    _install_exit_watchdog(window_manager.main_window)
    # 主窗口显示后关闭启动提示
    if splash is not None:
        try:
            window_manager.main_window.events.shown += lambda *args: splash.close()
        except Exception as e:
            logger.debug(f"绑定主窗口 shown 事件失败: {e}")
            splash.close()
    # PyInstaller 打包后 sys.frozen 为 True：自动关闭 webview 调试模式，无需手动改
    debug_mode = not bool(getattr(sys, "frozen", False))
    logger.info(f"webview 调试模式: {debug_mode}")
    webview.start(debug=debug_mode)

    # 所有窗口已关闭：先给最后一批 HTTP 请求一点落盘时间，再关闭服务并强制退出，
    # 避免 waitress 工作线程等非守护线程把进程拖在后台，导致用户再次启动 exe 时报错。
    _shutdown(server, server_thread)


def _install_exit_watchdog(main_window) -> None:
    """主窗口关闭后兜底：若 webview.start() 迟迟不返回，强制结束进程。"""

    def _watchdog():
        time.sleep(_WATCHDOG_TIMEOUT_SECONDS)
        logger.warning("窗口已关闭但进程未正常退出，强制执行退出")
        os._exit(0)

    def _on_main_closed():
        threading.Thread(
            target=_watchdog,
            daemon=True,
            name="force-exit-watchdog",
        ).start()

    main_window.events.closed += _on_main_closed


def _shutdown(server, server_thread) -> None:
    """窗口全部关闭后停止 Flask 服务，并确保进程立即退出。"""
    time.sleep(_EXIT_GRACE_SECONDS)
    try:
        server.close()
        server_thread.join(timeout=2)
        logger.info("Flask 服务器已停止")
    except Exception as e:
        logger.warning(f"停止 Flask 服务器异常: {e}", exc_info=True)
    # 兜底：强制退出，确保进程不再驻留
    os._exit(0)


def _wait_for_server(port: int, timeout_seconds: int = 30) -> None:
    """等待 waitress 监听端口就绪；超时只告警，不阻塞启动。"""
    for _ in range(timeout_seconds * 10):
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                return
        except OSError:
            time.sleep(0.1)
    logger.error("Flask 服务器启动超时，主窗口可能白屏")
