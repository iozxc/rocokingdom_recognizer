from flask import request, jsonify
import base64
import io
from PIL import Image
import pygetwindow as gw

def find_roco_window():
    # windows = gw.getWindowsWithTitle('洛克王国：世界')
    windows = gw.getWindowsWithTitle('计算器')
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

    @app.route('/follow_recognize', methods=['POST'])
    def follow_recognize():
        win = find_roco_window()
        if not win:
            return jsonify({
                "code": 404,
                "is_game_running": False,
                "msg": "游戏窗口已关闭或丢失",
                "results": []
            })

        data = request.json
        image_b64 = data.get('image_data')  # 获取前端传来的Base64

        if image_b64:
            # 如果带有 data:image/jpeg;base64, 前缀，需要去掉
            if "," in image_b64:
                image_b64 = image_b64.split(",")[1]

            # 将 Base64 转回 PIL 图片对象，供你的识别算法使用
            img_bytes = base64.b64decode(image_b64)
            image = Image.open(io.BytesIO(img_bytes))

            # --- 这里执行你原来的识别算法逻辑 ---
            # results = my_recognition_model.detect(image)
            # ----------------------------------

        # 在这里调用您的 PyTorch / OpenCV / EasyOCR 识别逻辑
        # 识别当前地图与画面中的精灵，构造 results 列表
        # ...
        return jsonify({
            "code": 200,
            "is_game_running": True,
            "map_num": 1,
            "results": [
                {
                    "filename": "书魔虫.png",
                    "score": 0.965,
                    "status": "matched",
                    "candidates": [
                        {"filename": "书魔虫.png", "score": 0.965},
                        {"filename": "多彩方方.png", "score": 0.724},
                        {"filename": "奇丽果.png", "score": 0.453}
                    ]
                },
                {
                    "filename": "书魔虫.png",
                    "score": 0.965,
                    "status": "matched",
                    "candidates": [
                        {"filename": "书魔虫.png", "score": 0.965},
                        {"filename": "蒲公英.png", "score": 0.721},
                        {"filename": "奇丽草.png", "score": 0.452}
                    ]
                },
                {
                    "filename": "书魔虫.png",
                    "score": 0.965,
                    "status": "matched",
                    "candidates": [
                        {"filename": "书魔虫.png", "score": 0.965},
                        {"filename": "蒲公英.png", "score": 0.726},
                        {"filename": "奇丽草.png", "score": 0.457}
                    ]
                }
            ]
        })