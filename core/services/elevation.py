"""以管理员身份重启主程序。

抓包（dumpcap + Npcap）在 Windows 上通常需要管理员权限。这里提供：
  * is_admin()          当前进程是否已是管理员
  * restart_as_admin()  用 ShellExecuteW(runas) 拉起一个提权实例

调用方负责在拉起成功后退出当前进程。
"""
from __future__ import annotations

import ctypes
import os
import sys
from pathlib import Path

from core.infra.logger import logger


def is_admin() -> bool:
    """当前进程是否具备管理员权限。"""
    if sys.platform != "win32":
        return False
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:  # noqa: BLE001
        return False


def restart_as_admin() -> tuple[bool, str]:
    """以管理员身份重新拉起主程序。返回 (是否成功, 失败原因)。"""
    if sys.platform != "win32":
        return False, "仅 Windows 支持以管理员身份重启"
    if is_admin():
        return False, "当前已经是管理员权限"

    # 打包版：直接提权 exe；源码运行：提权 python.exe + main.py
    argv0 = Path(sys.argv[0]).resolve() if sys.argv and sys.argv[0] else None
    frozen = bool(getattr(sys, "frozen", False))
    if frozen:
        exe = sys.executable
        params = ""
        workdir = str(Path(sys.executable).resolve().parent)
    else:
        exe = sys.executable
        if argv0 is None or not argv0.is_file():
            return False, "找不到主程序入口（main.py）"
        params = f'"{argv0}"'
        workdir = str(argv0.parent)

    try:
        # 1 = SW_SHOWNORMAL；返回值 >32 才算成功
        ret = ctypes.windll.shell32.ShellExecuteW(None, "runas", exe, params, workdir, 1)
    except Exception as exc:  # noqa: BLE001
        return False, f"调用提权接口失败：{exc}"
    if int(ret) <= 32:
        # 常见：5 = 用户拒绝了 UAC
        return False, ("用户取消了管理员权限申请" if int(ret) == 5 else f"提权失败（ShellExecute={int(ret)}）")
    logger.info("已以管理员身份拉起新实例，当前进程即将退出")
    return True, ""


def stop_plugins() -> None:
    """退出前先停掉插件（抓包子进程等），避免留下后台进程。"""
    try:
        from core.plugins import plugin_manager

        plugin_manager.shutdown_all()
    except Exception as exc:  # noqa: BLE001
        logger.debug("退出前停止插件失败（忽略）：%s", exc)


def exit_process_soon(delay: float = 1.0) -> None:
    """延迟退出当前进程，给 Flask 留时间把响应回给前端。"""
    import threading
    import time

    def _run() -> None:
        time.sleep(delay)
        stop_plugins()
        os._exit(0)

    threading.Thread(target=_run, name="restart-as-admin-exit", daemon=True).start()
