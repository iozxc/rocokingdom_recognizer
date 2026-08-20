from flask import jsonify
import pygetwindow as gw

from logger import logger


def find_roco_window():
    logger.debug("查找洛克王国游戏窗口...")
    windows = gw.getWindowsWithTitle('洛克王国：世界')
    if windows and len(windows) > 0:
        win = windows[0]
        logger.debug(f"找到游戏窗口: title='{win.title}', pos=({win.left},{win.top}), size={win.width}x{win.height}")
        return windows[0]
    logger.debug("未找到洛克王国游戏窗口")
    return None


def init_routes(app):
    @app.route('/game_status', methods=['GET'])
    def check_game_status():
        logger.debug("[GET /game_status] 检查游戏运行状态")

        win = find_roco_window()
        if not win or win.width <= 0:
            logger.info("[GET /game_status] 游戏未运行或窗口无效")
            return jsonify({
                "code": 404,
                "is_running": False,
                "msg": "未检测到\"洛克王国\"游戏窗口，请确认是否已开启游戏。"
            })

        logger.info(f"[GET /game_status] 游戏运行中: {win.title} ({win.width}x{win.height})")
        return jsonify({
            "code": 200,
            "is_running": True,
            "window_title": win.title,
            "rect": {
                "left": win.left,
                "top": win.top,
                "width": win.width,
                "height": win.height
            }
        })
