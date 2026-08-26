"""基于 Windows 游戏窗口截图的地图观测。

该模块只负责从当前画面提取可观测事实，不伪造世界坐标、朝向或野生精灵实体。
这些字段只有在抓包协议或专门训练的视觉模型提供证据时才会填充。
"""

import time
from typing import Any, Dict

import pygetwindow as gw

import config
from core.crop import crop_sections_from_pil_by_YOLOv8
from core.logger import logger
from core.services.trials import get_trial_or_default
from core.services.recognizers import models
from core.tools import capture_window
from core.utils import match_scene_unique_char


def _window(title: str):
    windows = gw.getWindowsWithTitle(title)
    if not windows:
        return None
    win = windows[0]
    if getattr(win, "isMinimized", False):
        win.restore()
    return win


def observe_map(title: str = config.GAME_WINDOW_TITLE, trial_key: str = "grass") -> Dict[str, Any]:
    """捕获游戏窗口并识别地图标题。

    返回值是稳定的 JSON 结构；识别失败时保留 ``null`` 和 reason，避免回退到
    一个看似可信但实际错误的地图或坐标。
    """
    started = time.perf_counter()
    now_ts = int(time.time() * 1000)
    trial = get_trial_or_default(trial_key)
    win = _window(title)
    base: Dict[str, Any] = {
        "source": "window-image",
        "timestamp": now_ts,
        "window_found": bool(win),
        "window_title": getattr(win, "title", title) if win else title,
        "map_name": None,
        "map_num": None,
        "ocr_text": "",
        "confidence": None,
        "screenshot": None,
        "position": None,
        "heading": None,
        "wild_pets": [],
        "limitations": [
            "截图模式不能可靠恢复世界坐标和朝向",
            "截图模式不能确认服务器下发的野生精灵实体列表",
        ],
    }
    if not win or win.width <= 0 or win.height <= 0:
        base["reason"] = "game-window-not-found"
        return base

    bbox = (win.left, win.top, win.right, win.bottom)
    image = capture_window(bbox=bbox, hwnd=getattr(win, "_hWnd", None))
    if image is None:
        base["reason"] = "capture-failed"
        return base

    base["screenshot"] = {
        "width": image.width,
        "height": image.height,
        "bbox": {"x": win.left, "y": win.top, "width": win.width, "height": win.height},
    }
    try:
        title_image, _, _ = crop_sections_from_pil_by_YOLOv8(image, debug=False)
        if title_image is None:
            base["reason"] = "title-region-not-detected"
            return base

        from core.ocr import ocr

        raw_text = ocr().recognize_text(title_image)
        base["ocr_text"] = raw_text or ""
        map_name = match_scene_unique_char(raw_text, trial_key)
        classifier = models.get_map_classifier(trial_key)
        if map_name is None and classifier is not None:
            map_name = classifier.match(title_image, fallback_map=trial.get("map_list", ["map1"])[0])
            base["confidence"] = "embedding-match"
        elif map_name is not None:
            base["confidence"] = "ocr-scene-character"

        if map_name:
            base["map_name"] = map_name
            try:
                base["map_num"] = int(str(map_name).replace("map", ""))
            except ValueError:
                base["map_num"] = None
            base["reason"] = "ok"
        else:
            base["reason"] = "map-not-recognized"
    except Exception as exc:
        logger.error("地图图像观测失败: %s", exc, exc_info=True)
        base["reason"] = "recognition-error"
        base["error"] = str(exc)
    finally:
        base["elapsed_ms"] = round((time.perf_counter() - started) * 1000, 1)
    return base
