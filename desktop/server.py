"""Flask 服务启动：动态端口、waitress 配置与可控关闭。"""
import multiprocessing
import socket

from waitress.server import create_server as _create_waitress_server

from core.logger import logger


def pick_free_port() -> int:
    """动态挑选一个空闲端口，避免固定 5000 被其他程序占用"""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def get_waitress_threads() -> int:
    """
    桌面端自适应计算 waitress 线程数。
    仅限本机访问的本地客户端，IO 密集场景：
    下限 2，上限 6（防止高核数机器开太多线程，桌面程序不需要）。
    """
    cpu = multiprocessing.cpu_count() or 4
    threads = max(2, min(cpu * 2, 6))
    logger.debug(f"waitress线程计算: CPU逻辑核数={cpu}, 最终线程数={threads}")
    return threads


def create_server(app, port: int, host: str = "127.0.0.1"):
    """
    创建 waitress 服务器对象（不阻塞）。
    调用方负责 server.run() 启动、退出时 server.close() 停止，以便窗口关闭后能立即退出进程。
    """
    threads = get_waitress_threads()
    logger.info(f"waitress create, threads={threads}")
    return _create_waitress_server(
        app,
        host=host,
        port=port,
        threads=threads,
        connection_limit=60,   # 最大并发连接
        channel_timeout=90,    # 慢请求超时，避免僵死连接占住线程
    )


def start_server(app, port: int, host: str = "127.0.0.1") -> None:
    """以 waitress 启动 Flask 应用（阻塞）。桌面客户端只监听本机。"""
    server = create_server(app, port=port, host=host)
    server.run()
