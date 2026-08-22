import ctypes
import json

import config

try:
    ctypes.windll.shcore.SetProcessDpiAwareness(1)
except Exception:
    ctypes.windll.user32.SetProcessDPIAware()

import ctypes
import os
from pathlib import Path

import win32gui
import win32ui
from PIL import Image, ImageGrab

from logger import logger

USER_SETTINGS = {}
SCENE_FEATURES = [
    # 记忆中的索米亚草原：索、米、亚；OCR经常识别错成 素
    ("map1", {"索", "米", "亚", "素"}),
    # 记忆中的巨石阵：巨、石
    ("map2", {"巨", "石"}),
    # 记忆中的普拉塔草原：普、拉、塔
    ("map3", {"普", "拉", "塔"})
]


def clean_debug_folder(folder_path: str, max_count: int = 30):
    """
    清理debug截图文件夹，最多保留max_count张，删除最旧的文件
    :param folder_path: 文件夹路径
    :param max_count: 最大保留文件数量
    """
    logger.debug(f"开始清理debug文件夹: path={folder_path}, max_count={max_count}")

    folder = Path(folder_path)
    if not folder.exists():
        logger.debug(f"debug文件夹不存在，跳过清理: {folder_path}")
        return

    # 获取所有jpg图片，按修改时间升序（旧的在前）
    files = list(folder.glob("*.jpg"))
    if len(files) <= max_count:
        logger.debug(f"debug截图数量({len(files)})未超过上限({max_count})，无需清理")
        return

    # 按文件修改时间排序，旧文件放前面
    files.sort(key=lambda x: x.stat().st_mtime)
    need_remove = files[: len(files) - max_count]
    logger.info(f"共 {len(files)} 张截图，将删除最旧的 {len(need_remove)} 张")
    for f in need_remove:
        try:
            os.remove(f)
            logger.info(f"删除过期debug截图: {f.name}")
        except Exception as e:
            logger.warning(f"删除文件失败 {f.name}: {str(e)}")


def load_setting_from_file_json():
    global USER_SETTINGS
    if not os.path.exists(config.DATA_FILE):
        logger.debug("配置文件不存在，将使用默认配置")
        return

    try:
        with open(config.DATA_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)

        USER_SETTINGS = data.get("appSettings", {})

    except json.JSONDecodeError:
        logger.warning("配置文件格式损坏，将使用默认配置")
    except Exception as e:
        logger.warning(f"配置文件加载失败: {e}")


def get_version_from_file_json():
    print("==")
    if not os.path.exists(config.DATA_FILE):
        logger.debug("配置文件不存在，将使用默认配置")
        return

    try:
        with open(config.DATA_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)

        return data.get("version", 0)

    except json.JSONDecodeError:
        logger.warning("配置文件格式损坏，将使用默认配置")
    except Exception as e:
        logger.warning(f"配置文件加载失败: {e}")


def capture_by_hwnd(hwnd):
    """
    通过 PrintWindow 直接捕获窗口画面（不经过屏幕截图）。
    窗口被遮挡、部分在屏幕外也能抓到。
    返回 PIL Image，失败返回 None。
    """
    logger.debug(f"capture_window_by_hwnd: hwnd={hwnd}")

    # 获取窗口尺寸（整个窗口，含标题栏，与原 ImageGrab 行为一致）
    left, top, right, bottom = win32gui.GetWindowRect(hwnd)
    width = right - left
    height = bottom - top
    if width <= 0 or height <= 0:
        logger.warning(f"capture_window_by_hwnd: 窗口尺寸异常 ({width}x{height}), hwnd={hwnd}")
        return None

    hwndDC = None
    mfcDC = None
    saveDC = None
    saveBitMap = None

    try:
        hwndDC = win32gui.GetWindowDC(hwnd)
        mfcDC = win32ui.CreateDCFromHandle(hwndDC)
        saveDC = mfcDC.CreateCompatibleDC()

        saveBitMap = win32ui.CreateBitmap()
        saveBitMap.CreateCompatibleBitmap(mfcDC, width, height)
        saveDC.SelectObject(saveBitMap)

        result = ctypes.windll.user32.PrintWindow(hwnd, saveDC.GetSafeHdc(), 2)

        if result == 0:
            logger.warning(f"capture_window_by_hwnd: PrintWindow返回失败, hwnd={hwnd}")

        bmpinfo = saveBitMap.GetInfo()
        bmpstr = saveBitMap.GetBitmapBits(True)

        img = Image.frombuffer(
            'RGB',
            (bmpinfo['bmWidth'], bmpinfo['bmHeight']),
            bmpstr, 'raw', 'BGRX', 0, 1
        )

        logger.debug(f"capture_window_by_hwnd: 捕获成功 {width}x{height}, result={result}")
        return img if result else None

    except Exception as e:
        logger.error(f"capture_window_by_hwnd: 捕获异常 hwnd={hwnd}: {e}", exc_info=True)
        return None

    finally:
        try:
            if saveBitMap is not None:
                win32gui.DeleteObject(saveBitMap.GetHandle())
            if saveDC is not None:
                saveDC.DeleteDC()
            if mfcDC is not None:
                mfcDC.DeleteDC()
            if hwndDC is not None:
                win32gui.ReleaseDC(hwnd, hwndDC)
        except Exception as e:
            logger.warning(f"capture_window_by_hwnd: GDI资源释放异常: {e}")


def capture_by_grab(bbox):
    """
    模式1：通过 PIL ImageGrab 截取屏幕指定区域
    窗口被遮挡时会截到遮挡内容，速度快，兼容性好
    :param bbox: (left, top, right, bottom) 屏幕坐标四元组
    """
    logger.debug(f"capture_by_grab: bbox={bbox}")
    try:
        left, top, right, bottom = bbox
        width = right - left
        height = bottom - top
        if width <= 0 or height <= 0:
            logger.warning(f"capture_by_grab: 区域尺寸异常 ({width}x{height})")
            return None

        img = ImageGrab.grab(bbox)
        logger.debug(f"capture_by_grab: 捕获成功 {width}x{height}")
        return img
    except Exception as e:
        logger.error(f"capture_by_grab: 捕获异常 bbox={bbox}: {e}", exc_info=True)
        return None


def capture_window(bbox=None, hwnd=None):
    if "captureMode" not in USER_SETTINGS:
        mode = "grab"
    else:
        mode = USER_SETTINGS["captureMode"]

    if mode not in ("hwnd", "grab"):
        logger.error(f"capture_window: 不支持模式 {mode}，可选 grab/hwnd")
        return None

    # hwnd模式：先试hwnd，失败就走grab
    if mode == "hwnd":
        try:
            if hwnd is not None:
                img = capture_by_hwnd(hwnd)
                if img is not None:
                    return img
        except Exception as e:
            logger.warning(f"hwnd截图失败，降级grab: {e}")
        # 降级grab
        if bbox is None:
            logger.error("hwnd降级grab缺少bbox")
            return None
        try:
            return capture_by_grab(bbox)
        except Exception as e:
            logger.error(f"grab截图异常:{e}")
            return None

    # grab模式
    if mode == "grab":
        if bbox is None:
            logger.error("grab模式需要bbox")
            return None
        try:
            return capture_by_grab(bbox)
        except Exception as e:
            logger.error(f"grab截图异常:{e}")
            return None
    return None


def clean_text(raw_text: str):
    if raw_text is None:
        return ""
    s = str(raw_text)
    for ch in [' ', '\n', '\r', '\t']:
        s = s.replace(ch, "")
    return s


def match_scene_unique_char(ocr_raw_text: str):
    """
    独有单字匹配：只要命中该场景任意一个独有字符，返回场景名；都不命中返回None
    """
    txt = clean_text(ocr_raw_text)
    for scene_name, char_set in SCENE_FEATURES:
        for c in char_set:
            if c in txt:
                return scene_name
    return None


load_setting_from_file_json()
