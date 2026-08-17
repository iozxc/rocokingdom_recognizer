import ctypes
import io
import json
import os
import time

from config import DATA_FILE
from core import create_app
import webview
from threading import Thread
import pygetwindow as gw
from PIL import ImageGrab
import base64
from flask_socketio import SocketIO, emit

app = create_app()
app.config['SECRET_KEY'] = 'secret!'
# allow cors，pywebview本地访问
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet")

main_window = None
scanner_window = None
api_instance = None  # ✅全局保存api实例

try:
    ctypes.windll.shcore.SetProcessDpiAwareness(1)
except Exception:
    ctypes.windll.user32.SetProcessDPIAware()

def load_storage_file():
    if not os.path.exists(DATA_FILE):
        return {
            "version": 0,
            "encounteredPets": {},
            "thresholds": {},
            "appSettings": {}
        }
    try:
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"version":0,"encounteredPets":{},"thresholds":{},"appSettings":{}}

def save_storage_file(payload: dict):
    data = load_storage_file()
    data["encounteredPets"] = payload.get("encounteredPets", data["encounteredPets"])
    data["thresholds"] = payload.get("thresholds", data["thresholds"])
    data["appSettings"] = payload.get("appSettings", data["appSettings"])
    data["version"] = int(time.time() * 1000)
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return data

@socketio.on("storage_save")
def handle_storage_save(payload):
    new_data = save_storage_file(payload)
    # broadcast=True 是参数，不需要导入broadcast
    emit("storage_updated", {"version": new_data["version"]}, broadcast=True)

@socketio.on("connect")
def on_connect():
    print("前端ws客户端已连接")

@socketio.on("disconnect")
def on_disconnect():
    print("前端ws客户端断开")
class AppApi:
    def open_scanner_to_app(self, target_app_name="计算器"):
        global scanner_window, api_instance
        print(f"--> [Python] 收到前端打开子窗口请求: {target_app_name}")

        def _open():
            global scanner_window, api_instance
            try:
                if scanner_window is not None:
                    scanner_window.show()
                    scanner_window.restore()
                    scanner_window.on_top = True
                    return

                scanner_window = webview.create_window(
                    title='精灵识别跟随',
                    url='http://127.0.0.1:5000/?view=scanner',
                    width=420,
                    height=680,
                    frameless=True,
                    transparent=False,
                    on_top=True,
                    resizable=True,
                    background_color='#F0F6FC',
                    js_api=api_instance  # ✅这里传入全局api实例！！
                )

                def on_closed():
                    global scanner_window
                    scanner_window = None
                    print("子窗口被手动关闭")

                scanner_window.events.closed += on_closed
                scanner_window.show()
                print("--> [Python] 子窗口已成功 show()")
            except Exception as e:
                print(f"--> [Python] 创建子窗口失败: {e}")

        t = Thread(target=_open)
        t.daemon = True
        t.start()

        return {"status": "ok"}

    def close_current_window(self):
        global scanner_window
        if scanner_window is not None:
            try:
                scanner_window.destroy()
            except Exception as e:
                print(f"destroy异常: {e}")
            scanner_window = None
        return {"status": "closed"}

    def move_scanner_window(self, dx, dy):
        global scanner_window
        win = scanner_window
        if win:
            x, y = win.position
            win.move(x + dx, y + dy)

    def capture_and_recognize(self, target_title="计算器"):
        try:
            # 1. 查找窗口
            windows = gw.getWindowsWithTitle(target_title)
            if not windows:
                return {"status": "error", "message": f"未找到窗口: {target_title}"}

            win = windows[0]
            # 确保窗口不是最小化的
            if win.isMinimized:
                win.restore()

            # 2. 执行截图
            # 获取窗口坐标 (left, top, right, bottom)
            bbox = (win.left, win.top, win.right, win.bottom)
            img = ImageGrab.grab(bbox)

            # ----- 【测试代码：保存到本地】 -----
            # 创建 debug 文件夹
            debug_dir = "debug_caps"
            if not os.path.exists(debug_dir):
                os.makedirs(debug_dir)

            # 以时间命名文件名：例如 20231027_143005.jpg
            file_name = time.strftime("%Y%m%d_%H%M%S") + ".jpg"
            save_path = os.path.join(debug_dir, file_name)
            img.save(save_path, "JPEG", quality=90)
            print(f"--> [DEBUG] 截图已保存至: {os.path.abspath(save_path)}")
            # ----------------------------------

            # 3. 转为 Base64 供前端和后端接口使用
            buffered = io.BytesIO()
            img.save(buffered, format="JPEG", quality=80)
            img_base64 = base64.b64encode(buffered.getvalue()).decode('utf-8')

            return {
                "status": "ok",
                "image_data": f"data:image/jpeg;base64,{img_base64}",
                "local_path": os.path.abspath(save_path)  # 把路径也传回前端方便查看
            }
        except Exception as e:
            print(f"截图异常: {e}")
            return {"status": "error", "message": str(e)}

def start_server():
    # app.run(host='127.0.0.1', port=5000, threaded=True, debug=False, use_reloader=False)
    socketio.run(app, host="127.0.0.1", port=5000, debug=False)


def start_webview():
    global main_window, api_instance
    def start_logic():
        t = Thread(target=start_server)
        t.daemon = True
        t.start()

    api = AppApi()
    api_instance = api  # ✅赋值给全局变量，子窗口可以拿到

    main_window = webview.create_window(
        '洛克王国草系徽章试炼',
        'http://127.0.0.1:5000',
        width=1500,
        height=1000,
        min_size=(1200, 700),
        js_api=api
    )

    webview.start(start_logic, debug=True)


if __name__ == '__main__':
    start_webview()