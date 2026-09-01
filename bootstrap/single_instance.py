"""单实例保护：防止用户重复打开程序导致本地用户数据互相覆盖。"""
import ctypes
import sys
import time

from core.infra.logger import logger

# 会话级命名互斥体：进程正常退出或崩溃后由系统自动释放，不会残留锁文件
_MUTEX_NAME = "Local\\RocoKingdomRecognizer_SingleInstance"
# 旧实例正在退出时，新实例最多等待它完全退出再接管
_WAIT_EXIT_SECONDS = 5.0
# 新标题优先；保留旧标题，便于唤起仍在运行的旧版本实例
_MAIN_WINDOW_TITLES = ("洛克王国徽章试炼助手", "洛克王国草系徽章试炼助手")

# 持有句柄直到进程结束，防止句柄被 GC 回收导致锁失效
_held_mutex = None


def activate_existing_if_visible() -> bool:
    """若已存在可见的应用主窗口，唤起它并返回 True（本进程应直接退出，不弹提示）。"""
    try:
        if _find_main_window() is not None:
            logger.info("检测到程序已在运行，仅唤起已有窗口")
            _activate_existing_window()
            return True
    except Exception as e:
        logger.warning(f"检查已有窗口失败: {e}")
    return False


def acquire() -> bool:
    """尝试成为唯一实例。返回 False 表示已有实例在运行（已尝试唤起其窗口）。"""
    global _held_mutex

    if sys.platform != "win32":
        # 应用本身依赖 Windows API，非 Windows 环境不限制
        return True

    try:
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        handle = kernel32.CreateMutexW(None, False, _MUTEX_NAME)
        if not handle:
            logger.error("创建单实例互斥体失败，按单实例继续启动")
            return True

        error_code = ctypes.get_last_error()
        if error_code == 183:  # ERROR_ALREADY_EXISTS
            kernel32.CloseHandle(handle)
            # 有可见主窗口：实例正在运行，唤起后退出
            if _find_main_window() is not None:
                logger.info("检测到程序已在运行，仅唤起已有窗口")
                _activate_existing_window()
                return False
            # 没有可见窗口：旧实例正在退出/启动中，等它释放互斥体再继续
            logger.info("检测到程序正在退出，等待其完全退出后继续启动")
            return _wait_for_exit(kernel32)

        _held_mutex = handle
        # 兜底：互斥体虽由本进程创建成功，但屏幕上已存在同名主窗口
        # （例如旧版本实例未使用互斥体），此时仍视为已有实例在运行。
        if _find_main_window() is not None:
            logger.info("检测到已有实例窗口，仅唤起已有窗口")
            _activate_existing_window()
            return False
        return True
    except Exception as e:
        logger.warning(f"单实例检查异常，放行启动: {e}")
        return True


def _wait_for_exit(kernel32) -> bool:
    """等待旧实例完全退出并尝试接管互斥体。返回 True 表示本进程已成为唯一实例。"""
    global _held_mutex
    deadline = time.monotonic() + _WAIT_EXIT_SECONDS
    while time.monotonic() < deadline:
        time.sleep(0.15)
        # 等待期间另一实例的窗口出现了（并发启动/旧实例恢复），直接唤起后退出
        if _find_main_window() is not None:
            _activate_existing_window()
            return False
        handle = kernel32.CreateMutexW(None, False, _MUTEX_NAME)
        if not handle:
            return False
        if ctypes.get_last_error() != 183:
            _held_mutex = handle
            return True
        kernel32.CloseHandle(handle)
    logger.warning("等待旧实例退出超时，放弃本次启动")
    return False


def _find_main_window(user32=None):
    """按标题查找应用主窗口（含旧标题），找不到返回 None。"""
    user32 = user32 or ctypes.WinDLL("user32", use_last_error=True)
    for title in _MAIN_WINDOW_TITLES:
        hwnd = user32.FindWindowW(None, title)
        if hwnd:
            return hwnd
    return None


def _activate_existing_window() -> None:
    """找到已有实例的主窗口并带到前台（不弹窗打扰用户）。"""
    try:
        user32 = ctypes.WinDLL("user32", use_last_error=True)
        hwnd = _find_main_window(user32)
        if hwnd:
            if user32.IsIconic(hwnd):
                user32.ShowWindow(hwnd, 9)  # SW_RESTORE
            user32.SetForegroundWindow(hwnd)
        else:
            logger.info("未找到已有实例的主窗口")
    except Exception as e:
        logger.warning(f"唤起已有窗口失败: {e}")
