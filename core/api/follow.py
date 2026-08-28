import pygetwindow as gw
from flask import Blueprint, request

import config
from core.api.response import error, success
from core.logger import logger

bp = Blueprint("follow", __name__)


def find_roco_window():
    logger.debug("查找洛克王国游戏窗口...")
    windows = gw.getWindowsWithTitle(config.GAME_WINDOW_TITLE)
    if windows and len(windows) > 0:
        win = windows[0]
        logger.debug(f"找到游戏窗口: title='{win.title}', pos=({win.left},{win.top}), size={win.width}x{win.height}")
        return windows[0]
    logger.debug("未找到洛克王国游戏窗口")
    return None


@bp.route('/game_status', methods=['GET'])
def check_game_status():
    logger.debug("[GET /game_status] 检查游戏运行状态")

    win = find_roco_window()
    if not win or win.width <= 0:
        logger.info("[GET /game_status] 游戏未运行或窗口无效")
        return error(
            "未检测到\"洛克王国\"游戏窗口，请确认是否已开启游戏。",
            http_status=200,  # 保持 200：前端以此区分“游戏未开”而非“后端离线”
            is_running=False,
            window_found=False,
        )

    logger.info(f"[GET /game_status] 游戏运行中: {win.title} ({win.width}x{win.height})")
    return success(
        is_running=True,
        window_found=True,
        window_title=win.title,
        window_rect={
            "x": win.left,
            "y": win.top,
            "width": win.width,
            "height": win.height,
        },
    )


@bp.route('/map_observation', methods=['GET'])
def map_observation():
    """返回最近一次后台小地图观测(实时监控)；不返回模拟坐标。"""
    try:
        # 延迟加载图像模型，避免普通状态检查触发 ONNX/YOLO 初始化。
        from core.services.map_observer import observe_map
        result = observe_map()
        return success(data=result)
    except Exception as exc:
        logger.error("[GET /map_observation] 异常: %s", exc, exc_info=True)
        return error(str(exc), http_status=200, data={"reason": "observer-error"})
