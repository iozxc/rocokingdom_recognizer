import concurrent
import ctypes
import time

from PIL import ImageGrab

import config

try:
    ctypes.windll.shcore.SetProcessDpiAwareness(1)
except Exception:
    ctypes.windll.user32.SetProcessDPIAware()

import os
import waitress

from core import create_app
import webview
from threading import Thread
import pygetwindow as gw
from logger import logger
from core.ocr import ocr
from core.map_classifier import MapClassifier
from core.api.predict import recognizer as recog
from core.utils import get_top_k_matches, scan_icon_names, get_icon_full_path, \
    clean_debug_folder, crop_sections_from_pil_by_YOLOv8

app = create_app()

main_window = None
scanner_window = None
api_instance = None  # 全局保存api实例
names_dict = None
map_classifier_recognizer = None


def process_single_item(i, name_img, item_img, map_num, map_name):
    """单个槽位的并行处理函数"""
    t_start = time.perf_counter()

    # 1. OCR 识别 (使用单例且跳过检测)
    engine = ocr()
    ocr_name = engine.recognize_crop_only(name_img)

    # 特殊情况处理
    if ocr_name in ["魔力之源", "远行商人"]:
        return {
            "filename": f"{ocr_name}.png",
            "score": 1,
            "status": "matched",
            "candidates": [{"name": f"{ocr_name}.png", "score": 1}]
        }

    # 2. 特征匹配与 OCR 模糊匹配并行 (此处可以继续细化，但主要瓶颈在 OCR)
    feat_results = recog().match(item_img, map_num, 0.25, 3)

    # OCR 辅助匹配
    global names_dict
    if not names_dict:
        names_dict = scan_icon_names()

    ocr_results = get_top_k_matches(ocr_name, map_name, names_dict, k=3)

    # 合并逻辑 (保持你原有的逻辑)
    combined_results = feat_results[0] + ocr_results
    unique_results = {}
    for res in combined_results:
        path = res['name']
        if path not in unique_results or res['score'] > unique_results[path]['score']:
            unique_results[path] = res

    final_list = sorted(unique_results.values(), key=lambda x: x['score'], reverse=True)[:3]

    ocr_match_results = []
    for m in final_list:
        full_path = get_icon_full_path(map_name, m['name'])
        if full_path:
            ocr_match_results.append({
                "filename": os.path.basename(full_path),
                "score": m['score']
            })

    return {
        "filename": ocr_match_results[0]["filename"] if ocr_match_results else "unknown",
        "score": ocr_match_results[0]["score"] if ocr_match_results else 0,
        "status": "matched",
        "candidates": ocr_match_results
    }


class AppApi:
    def open_scanner_to_app(self, target_app_name="计算器"):
        global scanner_window, api_instance
        logger.info(f"--> [Python] 收到前端打开子窗口请求: {target_app_name}")

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
                    logger.info("子窗口被手动关闭")

                scanner_window.events.closed += on_closed
                scanner_window.show()
                logger.info("--> [Python] 子窗口已成功 show()")
            except Exception as e:
                logger.error(f"--> [Python] 创建子窗口失败: {e}")

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
                logger.error(f"destroy异常: {e}")
            scanner_window = None
        return {"status": "closed"}

    def move_scanner_window(self, dx, dy):
        global scanner_window
        win = scanner_window
        if win:
            x, y = win.position
            win.move(x + dx, y + dy)

    def capture_and_recognize(self, target_title="计算器"):
        global map_classifier_recognizer, names_dict
        import time
        # t_all = time.perf_counter()
        try:
            # t = time.perf_counter()
            windows = gw.getWindowsWithTitle(target_title)
            if not windows:
                return {"status": "error", "message": f"未找到窗口: {target_title}"}
            win = windows[0]
            if win.isMinimized:
                win.restore()
            # print(f"【窗口查找】 {time.perf_counter() - t:.3f}s")

            # t = time.perf_counter()
            bbox = (win.left, win.top, win.right, win.bottom)
            img = ImageGrab.grab(bbox)
            # print(f"【截图Grab】 {time.perf_counter() - t:.3f}s")

            # t = time.perf_counter()
            title_pil, names_pil, items_pil = crop_sections_from_pil_by_YOLOv8(img)
            # print(f"【YOLO裁剪推理】 {time.perf_counter() - t:.3f}s")

            # t = time.perf_counter()
            debug_dir = os.path.join("debug", "capture")
            if not os.path.exists(debug_dir):
                os.makedirs(debug_dir)
            clean_debug_folder(debug_dir, max_count=30)
            file_name = time.strftime("%Y%m%d_%H%M%S") + ".jpg"
            save_path = os.path.join(debug_dir, file_name)
            img.save(save_path, "JPEG", quality=90)
            logger.debug(f"--> [DEBUG] 截图已保存至: {os.path.abspath(save_path)}")
            # print(f"【Debug保存图片】 {time.perf_counter() - t:.3f}s")

            # t = time.perf_counter()
            if not map_classifier_recognizer:
                map_classifier_recognizer = MapClassifier(config.MAP_CLASSIFIER, config.MAP_CLASSES)
            map_name = map_classifier_recognizer.predict_label(title_pil)
            map_num = int(map_name[3])
            logger.debug(f"mapname : {map_name}")
            # print(f"【地图分类推理】 {time.perf_counter() - t:.3f}s")

            # t = time.perf_counter()
            all_results = []
            with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
                futures = [
                    executor.submit(process_single_item, i, names_pil[i], items_pil[i], map_num, map_name)
                    for i in range(3)
                ]
                for future in futures:
                    all_results.append(future.result())
            # print(f"【OCR】 {time.perf_counter() - t:.3f}s")

            # print(f"【总耗时】 {time.perf_counter() - t_all:.3f}s")
            return {"code": 200, "map_num": map_num, "results": all_results}

        except Exception as e:
            logger.error(f"截图异常: {e}")
            return {"status": "error", "message": str(e)}


def start_server():
    waitress.serve(app, host="127.0.0.1", port=5000)
    # app.run(host='127.0.0.1', port=5000, threaded=True, debug=False)


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

    # 主窗口关闭，销毁子窗口
    def main_window_on_closed():
        global scanner_window
        logger.info("主窗口关闭，销毁子识别窗口")
        if scanner_window is not None:
            try:
                scanner_window.destroy()
            except Exception as e:
                logger.error(f"销毁子窗口异常:{e}")
            scanner_window = None

    main_window.events.closed += main_window_on_closed

    webview.start(start_logic)


if __name__ == '__main__':
    start_webview()
