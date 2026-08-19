from flask import jsonify
import pygetwindow as gw

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
