"""单实例保护：防止用户重复打开程序导致本地用户数据互相覆盖。"""
import ctypes
import sys

from core.logger import logger

# 会话级命名互斥体：进程正常退出或崩溃后由系统自动释放，不会残留锁文件
_MUTEX_NAME = "Local\\RocoKingdomRecognizer_SingleInstance"
# 新标题优先；保留旧标题，便于唤起仍在运行的旧版本实例
_MAIN_WINDOW_TITLES = ("洛克王国徽章试炼助手", "洛克王国草系徽章试炼助手")

# 持有句柄直到进程结束，防止句柄被 GC 回收导致锁失效
_held_mutex = None


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
            logger.info("检测到程序已在运行，仅唤起已有窗口")
            _activate_existing_window()
            return False

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
