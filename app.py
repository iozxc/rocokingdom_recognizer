import ctypes
import os
import time

import waitress

from core import create_app
import webview
from threading import Thread
import pygetwindow as gw

from core.api.predict import ocr
from core.map_classifier import recognizer
from core.api.predict import recognizer as recog
from core.utils import crop_sections_from_pil, get_top_k_matches, scan_icon_names, get_icon_full_path, \
    capture_window_by_hwnd

app = create_app()

main_window = None
scanner_window = None
api_instance = None  # 全局保存api实例

try:
    ctypes.windll.shcore.SetProcessDpiAwareness(1)
except Exception:
    ctypes.windll.user32.SetProcessDPIAware()

try:
    names_dict = scan_icon_names()
except Exception as e:
    print(e)


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
            hwnd = win._hWnd  # pygetwindow 在 Windows 上的窗口句柄
            img = capture_window_by_hwnd(hwnd)
            if img is None:
                return {"status": "error", "message": "窗口捕获失败，窗口可能已关闭或最小化"}

            title_pil, names_pil, items_pil = crop_sections_from_pil(img)

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

            # 拿到map名
            map_name = recognizer.predict_label(title_pil)
            map_num = int(map_name[3])
            print(map_num)

            all_results = []

            for i in range(0, 3):
                ocr_name = ocr.recognize_text(names_pil[i])

                if ocr_name == "魔力之源" or ocr_name == "远行商人":
                    all_results_item = {
                        "filename": f"{ocr_name}.png",
                        "score": 1,
                        "status": "matched",
                        "candidates": [{
                            "name": f"{ocr_name}.png",
                            "score": 1
                        }]
                    }
                    all_results.append(all_results_item)
                    continue

                feat_results = recog.match(items_pil[i], map_num, 0.25, 3)

                ocr_match_results = []
                match_results = []
                # 获取匹配列表
                ocr_results = get_top_k_matches(ocr_name, map_name, names_dict, k=3)

                combined_results = feat_results[0] + ocr_results

                # 去重：如果同一个文件既被特征匹配到，也被 OCR 匹配到，取分数高的那个
                unique_results = {}
                for res in combined_results:
                    path = res['name']
                    if path not in unique_results or res['score'] > unique_results[path]['score']:
                        unique_results[path] = res

                # 转回列表
                final_list = list(unique_results.values())

                # 排序：按 score 从高到低
                final_list.sort(key=lambda x: x['score'], reverse=True)

                # 截取 3 个
                final_list = final_list[:3]

                for m in final_list:
                    full_path = get_icon_full_path(map_name, m['name'])
                    if full_path:
                        ocr_match_results.append({
                            "filename": os.path.basename(full_path),
                            "score": m['score']
                        })
                if len(ocr_match_results):
                    all_results_item = {
                        "filename": ocr_match_results[0]["filename"],
                        "score": ocr_match_results[0]["score"],
                        "status": "matched",
                        "candidates": ocr_match_results
                    }
                    all_results.append(all_results_item)

            return {
                "code": 200,
                "is_game_running": True,
                "map_num": map_num,
                "results": all_results
            }

        except Exception as e:
            print(f"截图异常: {e}")
            return {"status": "error", "message": str(e)}


def start_server():
    waitress.serve(app, host="127.0.0.1", port=5000)


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
