"""pywebview JS 桥接层：前端可调用的桌面能力（窗口控制 + 截图识别）。"""
import os
import time

import pygetwindow as gw

import config
from core.ocr import ocr
from core.services.icon_catalog import icon_catalog
from core.services.recognizers import models
from core.utils import get_icon_full_path, get_top_k_matches
from crop import crop_sections_from_pil_by_YOLOv8
from logger import logger
from tools import capture_window, clean_debug_folder, match_scene_unique_char

# OCR 命中这些名称时直接匹配，无需模糊匹配
SPECIAL_DIRECT_MATCH = ("魔力之源", "远行商人")


class AppApi:
    """暴露给前端 window.pywebview.api 的对象。"""

    def __init__(self, window_manager, app):
        self._windows = window_manager
        self._app = app

    # ---------------- 窗口控制 ----------------

    def open_scanner_to_app(self, target_app_name="计算器"):
        logger.info(f"--> [Python] 收到前端打开子窗口请求: {target_app_name}")
        self._windows.open_scanner()
        return {"status": "ok"}

    def close_current_window(self):
        return self._windows.close_scanner()

    def move_scanner_window(self, dx, dy):
        self._windows.move_scanner(dx, dy)

    def resize_scanner_window(self, width, height):
        return self._windows.resize_scanner(width, height)

    # ---------------- 截图识别 ----------------

    def capture_and_recognize(self, target_title="计算器", map_num=None):
        t_total = time.perf_counter()
        logger.info(f"开始截图识别，目标窗口: {target_title}")

        try:
            windows = gw.getWindowsWithTitle(target_title)
            if not windows:
                logger.warning(f"未找到目标窗口: {target_title}")
                return {"status": "error", "message": f"未找到窗口: {target_title}"}
            win = windows[0]
            if win.isMinimized:
                win.restore()
                logger.debug("目标窗口已最小化，执行restore")

            bbox = (win.left, win.top, win.right, win.bottom)
            hwnd = win._hWnd

            img = capture_window(bbox=bbox, hwnd=hwnd)
            if img is None:
                return {"status": "error", "message": "截图失败，请检查捕获模式与窗口状态"}

            logger.debug(f"截图尺寸: {img.size}, 窗口bbox={bbox}")

            title_pil, names_pil, items_pil = crop_sections_from_pil_by_YOLOv8(img)

            debug_dir = os.path.join("debug", "capture")
            if not os.path.exists(debug_dir):
                os.makedirs(debug_dir)
            clean_debug_folder(debug_dir, max_count=100)
            file_name = time.strftime("%Y%m%d_%H%M%S") + ".jpg"
            save_path = os.path.join(debug_dir, file_name)
            img.save(save_path, "JPEG", quality=90)
            logger.debug(f"--> [DEBUG] 截图已保存至: {os.path.abspath(save_path)}")

            map_classifier = models.get_map_classifier()
            if map_num is None:
                ocr_map_name = ocr().recognize_text(title_pil)
                map_name = match_scene_unique_char(ocr_map_name)
                if map_name is None:
                    map_name = map_classifier.match(title_pil)
                    logger.info(f"map_name : ocr匹配失败")
                else:
                    logger.info(f"map_name : ocr匹配{map_name}")
                map_num = int(map_name[3])
                logger.debug(f"mapname : {map_name}")
            else:
                map_name = f"map{map_num}"

            all_results = []
            for i in range(0, 3):
                _items_pil = None
                _names_pil = None
                if len(items_pil) > i:
                    _items_pil = items_pil[i]
                if len(names_pil) > i:
                    _names_pil = names_pil[i]
                result = self._process_single_item(i, _names_pil, _items_pil, map_num, map_name)
                all_results.append(result)

            elapsed_total = (time.perf_counter() - t_total) * 1000
            summary = " | ".join(
                f"槽位{i}:{r['filename']}({r['score']:.2f})" for i, r in enumerate(all_results)
            )
            logger.info(f"识别完成 [{map_name}] 总耗时={elapsed_total:.1f}ms -> {summary}")

            return {"code": 200, "map_num": map_num, "results": all_results}

        except Exception as e:
            logger.error(f"截图识别异常: {e}", exc_info=True)
            return {"status": "error", "message": str(e)}

    def capture_and_recognize_by_map(self, map_num):
        return self.capture_and_recognize(config.GAME_WINDOW_TITLE, map_num)

    def _process_single_item(self, i, name_img, item_img, map_num, map_name):
        """单个槽位的识别与匹配流程"""
        t_start = time.perf_counter()
        logger.debug(f"[槽位{i}] 开始处理，地图={map_name}(map{map_num})")

        # 1. OCR 识别 (使用单例且跳过检测)
        engine = ocr()
        ocr_name = engine.recognize_crop_only(name_img)
        logger.debug(f"[槽位{i}] OCR识别结果: '{ocr_name}'")

        # 特殊情况处理
        if ocr_name in SPECIAL_DIRECT_MATCH:
            logger.info(f"[槽位{i}] 特殊物品直接匹配: {ocr_name}")
            return {
                "filename": f"{ocr_name}.png",
                "score": 1,
                "status": "matched",
                "candidates": [{"name": f"{ocr_name}.png", "score": 1}]
            }

        # OCR 辅助匹配（图标目录缓存由 IconCatalog 统一管理）
        names_dict = icon_catalog.get_names(self._app)
        ocr_results = get_top_k_matches(ocr_name, map_name, names_dict, k=9)
        logger.debug(f"[槽位{i}] OCR模糊匹配候选数: {len(ocr_results)}")

        # 2. 特征匹配（主要瓶颈在 OCR，保持原有逻辑）
        feat_results = [[]]
        if item_img:
            feat_results = models.get_icon_recognizer().match(item_img, map_num, 0.25, 9)
        logger.debug(f"[槽位{i}] 特征匹配候选数: {len(feat_results[0]) if feat_results else 0}")

        # 合并逻辑（保持原有逻辑）
        combined_results = feat_results[0] + ocr_results
        unique_results = {}
        for res in combined_results:
            path = res['name']
            if path not in unique_results or res['score'] > unique_results[path]['score']:
                unique_results[path] = res

        # 按分数降序排序（全量，用于回退）
        sorted_all = sorted(unique_results.values(), key=lambda x: x['score'], reverse=True)

        # 剔除置信度低于 0.25 的结果
        filtered = [r for r in sorted_all if r['score'] >= 0.25]

        # 最少 3 个：过滤后不足 3 个则回退到原始排序的前 3 个
        if len(filtered) < 3:
            logger.debug(f"[槽位{i}] 过滤后仅{len(filtered)}个，不足3个，回退保留原始前3个")
            final_list = sorted_all[:3]
        else:
            # 最多 9 个
            final_list = filtered[:9]

        ocr_match_results = []
        for m in final_list:
            full_path = get_icon_full_path(map_name, m['name'])
            if full_path:
                ocr_match_results.append({
                    "filename": os.path.basename(full_path),
                    "score": m['score']
                })

        result = {
            "filename": ocr_match_results[0]["filename"] if ocr_match_results else "unknown",
            "score": ocr_match_results[0]["score"] if ocr_match_results else 0,
            "status": "matched",
            "candidates": ocr_match_results
        }

        elapsed = (time.perf_counter() - t_start) * 1000
        logger.debug(
            f"[槽位{i}] 最终匹配: {result['filename']} (score={result['score']:.3f}), "
            f"候选数={len(ocr_match_results)}, 耗时={elapsed:.1f}ms")

        return result
