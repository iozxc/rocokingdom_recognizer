import concurrent.futures
import ctypes
import sqlite3
import time

from PIL import ImageGrab
from flask import g

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
from core.utils import get_top_k_matches, get_icon_full_path
from crop import crop_sections_from_pil_by_YOLOv8
from tools import clean_debug_folder

app = create_app()

main_window = None
scanner_window = None
api_instance = None  # 全局保存api实例
names_dict = None
map_classifier_recognizer = None


def get_db():
    """获取数据库连接（Flask 推荐写法）"""
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(config.ASSETS_FILE)
    return db


def scan_icon_names():
    """
    从数据库扫描所有图片名
    返回: {"map1": ["小拉塔", "迪莫"], "map2": []}
    """
    # 初始化字典，确保 config.MAP_LIST 里的地图都有对应的 Key
    with app.app_context():
        names_dict = {map_name: [] for map_name in config.MAP_LIST}

        try:
            # 这里建议直接创建一个临时的连接，或者使用你之前的 get_db()
            # 注意：如果是独立脚本，请确保 DB_PATH 正确
            conn = get_db()
            cursor = conn.cursor()

            # 只需要查询路径字段
            cursor.execute("SELECT path FROM icons")
            rows = cursor.fetchall()

            for row in rows:
                # row[0] 格式示例: "map1/迪莫.png"
                db_path = row[0]

                # 使用 / 拆分
                parts = db_path.split('/')
                if len(parts) == 2:
                    map_name, filename = parts[0], parts[1]

                    # 如果这个地图在我们的配置列表中
                    if map_name in names_dict:
                        # 去掉后缀名，例如 "迪莫.png" -> "迪莫"
                        name_without_ext = os.path.splitext(filename)[0]
                        names_dict[map_name].append(name_without_ext)

            conn.close()

        except Exception as e:
            # 如果报错（比如数据库还没创建），记录日志
            if 'logger' in globals():
                logger.error(f"从数据库扫描图标名失败: {e}")
            else:
                logger.error(f"Error: {e}")

        return names_dict


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

    # OCR 辅助匹配
    global names_dict
    if not names_dict:
        names_dict = scan_icon_names()

    ocr_results = get_top_k_matches(ocr_name, map_name, names_dict, k=3)

    # 2. 特征匹配与 OCR 模糊匹配并行 (此处可以继续细化，但主要瓶颈在 OCR)
    feat_results = [[]]
    if item_img:
        feat_results = recog().match(item_img, map_num, 0.25, 3)

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
            clean_debug_folder(debug_dir, max_count=100)
            file_name = time.strftime("%Y%m%d_%H%M%S") + ".jpg"
            save_path = os.path.join(debug_dir, file_name)
            img.save(save_path, "JPEG", quality=90)
            logger.debug(f"--> [DEBUG] 截图已保存至: {os.path.abspath(save_path)}")
            # print(f"【Debug保存图片】 {time.perf_counter() - t:.3f}s")

            # t = time.perf_counter()
            if not map_classifier_recognizer:
                map_classifier_recognizer = MapClassifier(config.RESNET50, config.FEATURES2_DB)
            map_name = map_classifier_recognizer.match(title_pil)
            map_num = int(map_name[3])
            logger.debug(f"mapname : {map_name}")
            # print(f"【地图分类推理】 {time.perf_counter() - t:.3f}s")

            # t = time.perf_counter()
            all_results = []
            for i in range(0, 3):
                _items_pil = None
                _names_pil = None
                if len(items_pil) > i:
                    _items_pil = items_pil[i]
                if len(names_pil) > i:
                    _names_pil = names_pil[i]
                result = process_single_item(i, _names_pil, _items_pil, map_num, map_name)
                all_results.append(result)

            # print(f"【总耗时】 {time.perf_counter() - t_all:.3f}s")
            return {"code": 200, "map_num": map_num, "results": all_results}

        except Exception as e:
            print(f"截图异常: {e}")
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
        '洛克王国草系徽章试炼助手',
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
