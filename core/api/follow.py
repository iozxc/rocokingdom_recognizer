import numpy as np
from flask import jsonify
from PIL import Image
import pygetwindow as gw

import config
from core.map_classifier import MapClassifier

recognizer = MapClassifier(config.MAP_MODEL_SAVE_PATH, device=config.DEVICE)

def crop_sections_from_pil(pil_image: Image.Image):
    arr = np.array(pil_image)  # shape [H,W,3] RGB

    # 切片 y_start:y_end , x_start:x_end
    title_arr = arr[40:145, 930:1650, :]
    cards_arr = arr[350:600, 600:2000, :]

    title_pil = Image.fromarray(title_arr)
    cards_pil = Image.fromarray(cards_arr)

    return {
        "title_pil": title_pil,
        "cards_pil": cards_pil
    }

def find_roco_window():
    windows = gw.getWindowsWithTitle('洛克王国：世界')
    if windows and len(windows) > 0:
        return windows[0]
    return None

def init_routes(app):
    @app.route('/game_status', methods=['GET'])
    def check_game_status():
        win = find_roco_window()
        if not win or win.width <= 0:
            return jsonify({
                "code": 404,
                "is_running": False,
                "msg": "未检测到“洛克王国”游戏窗口，请确认是否已开启游戏。"
            })
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
