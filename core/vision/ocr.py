import os
import re
import time
import warnings
from PIL import Image
from rapidocr_onnxruntime import RapidOCR  # 导入 RapidOCR

import config
from core.infra.logger import logger
from core.infra.ort_session import get_ort_intra_threads
from core.vision.ocr_corrections import correct_ocr_text

# 彻底移除对 torch 和 ssl 的依赖
warnings.filterwarnings("ignore", category=UserWarning)

_ocr = None


def ocr():
    try:
        global _ocr
        if not _ocr:
            logger.info("OCREngine首次初始化...")
            _ocr = OCREngine()
            logger.info("OCREngine初始化完成")
        return _ocr
    except Exception as e:
        logger.error(f"OCREngine初始化失败: {e}", exc_info=True)


def clean_ocr_text(text):
    if not text:
        return ""
    # 过滤掉所有特殊符号，只保留中文、数字和英文
    cleaned = re.sub(r'[^\u4e00-\u9fa5a-zA-Z0-9]', '', text)
    return cleaned


class OCREngine:
    def __init__(self):
        """
        初始化 RapidOCR 引擎
        无需检测 GPU，ONNX Runtime 会自动处理最快的推理方式
        """
        logger.debug("RapidOCR引擎初始化开始")

        det_model_path = config.DET_MODEL
        cls_model_path = config.CLS_MODEL
        rec_model_path = config.REC_MODEL

        for name, path in [("det", det_model_path), ("cls", cls_model_path), ("rec", rec_model_path)]:
            if not os.path.exists(path):
                logger.error(f"❌ OCR{name}模型不存在: {path}")
            else:
                logger.debug(f"OCR{name}模型路径确认: {path}")

        try:
            self.engine = RapidOCR(
                det_model_path=det_model_path,
                cls_model_path=cls_model_path,
                rec_model_path=rec_model_path,
                intra_op_num_threads=get_ort_intra_threads(),
                inter_op_num_threads=1,
            )
            logger.info("RapidOCR引擎初始化成功")
        except Exception as e:
            logger.error(f"RapidOCR引擎初始化失败: {e}", exc_info=True)
            raise

    def _do_ocr(self, img_input):
        """
        封装底层的推理动作
        RapidOCR 返回格式: [ [[box], text, conf], ... ]
        """
        t0 = time.perf_counter()
        # RapidOCR 支持文件路径、numpy 数组和 PIL Image
        try:
            result, _ = self.engine(img_input)
        except Exception as e:
            logger.error(f"OCR底层推理异常: {e}", exc_info=True)
            return []

        formatted_results = []
        if result:
            for res in result:
                # res 格式为: [[x1,y1],[x2,y2],[x3,y3],[x4,y4]], text, conf
                box, text, conf = res
                formatted_results.append((box, text, conf))

        elapsed = (time.perf_counter() - t0) * 1000
        logger.debug(f"OCR底层推理: 原始结果={len(formatted_results)}条, 耗时={elapsed:.1f}ms")
        return formatted_results

    def recognize_bottom_items(self, image_input, y_tolerance=30, min_confidence=0.3):
        """提取最底部名字行，返回带像素坐标的名字项（供"名字锚定切割"反推头像位置）。

        返回: [{"text", "cx", "cy", "nw", "nh", "x0","y0","x1","y1"}, ...]，行内按 x 升序。
        坐标基于输入图像素；blacklist 过滤"额外掉落/碎片"等噪声；复用同一次整图 OCR，不重复推理。
        """
        logger.debug(f"recognize_bottom_items: {image_input}")
        blacklist = ["额外", "掉落", "获取", "碎片", "额外掉落", "额外获取"]

        results = self._do_ocr(image_input)
        if not results:
            logger.debug("recognize_bottom_items: OCR无结果")
            return []

        blocks = []
        for box, text, conf in results:
            if conf < min_confidence:
                continue
            clean_raw = re.sub(r'\s+', '', text)
            if any(noise in clean_raw for noise in blacklist):
                continue
            xs = [p[0] for p in box]
            ys = [p[1] for p in box]
            x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
            cleaned = re.sub(r'[^\u4e00-\u9fa5a-zA-Z0-9]', '', clean_raw)
            if cleaned:
                blocks.append({
                    "text": cleaned,
                    "cx": (x0 + x1) / 2.0, "cy": (y0 + y1) / 2.0,
                    "nw": x1 - x0, "nh": y1 - y0,
                    "x0": x0, "y0": y0, "x1": x1, "y1": y1,
                })

        logger.debug(f"recognize_bottom_items: 过滤后有效块={len(blocks)}")
        if not blocks:
            return []

        # 按 Y 聚类（从下往上），取最底部一行
        lines = []
        blocks.sort(key=lambda b: b['cy'], reverse=True)
        for b in blocks:
            for line in lines:
                avg_y = sum(it['cy'] for it in line) / len(line)
                if abs(b['cy'] - avg_y) < y_tolerance:
                    line.append(b)
                    break
            else:
                lines.append([b])

        target_line = lines[0]
        target_line.sort(key=lambda b: b['cx'])
        for b in target_line:
            b['text'] = correct_ocr_text(b['text'])
        logger.debug(
            f"recognize_bottom_items: 聚类行数={len(lines)}, "
            f"底部行={[b['text'] for b in target_line]}"
        )
        return target_line

    def recognize_bottom_text(self, image_path, y_tolerance=30, min_confidence=0.3):
        """精确提取最底部的名字行（仅文本，顺序与 recognize_bottom_items 一致）。"""
        if not os.path.exists(image_path):
            logger.warning(f"recognize_bottom_text: 文件不存在 {image_path}")
            return []
        items = self.recognize_bottom_items(image_path, y_tolerance, min_confidence)
        return [b['text'] for b in items]

    def recognize_single_bottom_text(self, image_path, y_tolerance=30, min_confidence=0.3):
        """针对单图优化：优先定位正下方名字"""
        logger.debug(f"recognize_single_bottom_text: {image_path}")

        blacklist = ["额外", "掉落", "获取", "碎片"]

        if not os.path.exists(image_path):
            logger.warning(f"recognize_single_bottom_text: 文件不存在 {image_path}")
            return None

        # 获取图片宽度
        with Image.open(image_path) as img:
            img_w, _ = img.size
        center_x = img_w / 2

        results = self._do_ocr(image_path)
        if not results:
            logger.debug("recognize_single_bottom_text: OCR无结果")
            return None

        blocks = []
        for box, text, conf in results:
            if conf < min_confidence: continue
            clean_raw = re.sub(r'\s+', '', text)
            if any(noise in clean_raw for noise in blacklist):
                continue

            cur_x = (box[0][0] + box[1][0]) / 2
            cur_y = (box[0][1] + box[2][1]) / 2
            dist_to_center = abs(cur_x - center_x)

            cleaned = re.sub(r'[^\u4e00-\u9fa5a-zA-Z0-9]', '', clean_raw)
            if cleaned:
                blocks.append({
                    "text": cleaned, "x": cur_x, "y": cur_y,
                    "dist": dist_to_center, "conf": conf
                })

        if not blocks:
            logger.debug("recognize_single_bottom_text: 过滤后无有效块")
            return None

        blocks.sort(key=lambda b: b['y'], reverse=True)
        best_block = blocks[0]

        for i in range(1, len(blocks)):
            if abs(blocks[i]['y'] - best_block['y']) < 50:
                if blocks[i]['dist'] < best_block['dist'] * 0.5:
                    best_block = blocks[i]

        target_line = [best_block]
        for b in blocks:
            if b == best_block: continue
            if abs(b['y'] - best_block['y']) < y_tolerance:
                target_line.append(b)

        target_line.sort(key=lambda b: b['x'])
        final_name = "".join([b['text'] for b in target_line])
        final_name = correct_ocr_text(final_name)
        logger.debug(f"recognize_single_bottom_text: 结果='{final_name}', 候选块={len(blocks)}")
        return final_name if final_name else None

    def recognize_text(self, image, min_confidence=0.3):
        """通用识别"""
        logger.debug("recognize_text: 通用识别开始")

        # RapidOCR 内部会自动处理 PIL 转 Numpy
        results = self._do_ocr(image)
        if not results:
            logger.debug("recognize_text: OCR无结果")
            return ""

        blocks = []
        for box, text, conf in results:
            if conf < min_confidence: continue
            cleaned = re.sub(r'[^\u4e00-\u9fa5a-zA-Z0-9]', '', text)
            if cleaned:
                blocks.append({
                    "text": cleaned,
                    "x": (box[0][0] + box[1][0]) / 2,
                    "y": (box[0][1] + box[2][1]) / 2
                })

        if not blocks:
            logger.debug("recognize_text: 过滤后无有效块")
            return ""
        # 按行列排序
        blocks.sort(key=lambda b: (round(b['y'] / 15), b['x']))
        result = "".join(b['text'] for b in blocks)
        logger.debug(f"recognize_text: 结果='{result}', 有效块={len(blocks)}")
        return result

    def recognize_crop_only(self, pil_image):
        """专门用于处理已经裁剪好的文字区域，跳过检测环节"""
        import numpy as np
        if pil_image is None:
            logger.debug("recognize_crop_only: 输入图片为None，返回空字符串")
            return ""

        logger.debug(f"recognize_crop_only: 图片尺寸={pil_image.size}")

        # 将 PIL 转为 numpy
        img_array = np.array(pil_image.convert('RGB'))
        # RapidOCR 可以通过参数控制，或者直接调用内部的 rec 模型
        try:
            result, _ = self.engine(img_array, use_det=False, use_cls=False, use_rec=True)
        except Exception as e:
            logger.error(f"recognize_crop_only推理异常: {e}", exc_info=True)
            return ""

        if result:
            # result 格式会变化，只需提取文字
            text = clean_ocr_text(result[0][0])
            text = correct_ocr_text(text)
            logger.debug(f"recognize_crop_only: 识别结果='{text}'")
            return text
        logger.debug("recognize_crop_only: 无识别结果")
        return ""


if __name__ == "__main__":
    ocr = OCREngine()
    test_image = r"D:\game\RocoKingdom\core\1.png"
    if os.path.exists(test_image):
        result = ocr.recognize_bottom_text(test_image)
        print(f"识别结果: {result}")

    test_image = r"D:\game\RocoKingdom\core\2.png"
    if os.path.exists(test_image):
        result = ocr.recognize_bottom_text(test_image)
        print(f"识别结果: {result}")

    test_image = r"D:\game\RocoKingdom\core\3.png"
    if os.path.exists(test_image):
        result = ocr.recognize_bottom_text(test_image)
        print(f"识别结果: {result}")
