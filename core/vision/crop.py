import os
import threading
import time
import numpy as np
import cv2
from PIL import Image, ImageDraw, ImageFont  # 增加了 ImageDraw 和 ImageFont

import config
from core.infra.logger import logger
from core.infra.capture import clean_debug_folder, debug_enabled

# --- 配置 ---
MODEL_PATH = config.SCANNER_MODEL if config.SCANNER_MODEL.endswith(".onnx") else config.SCANNER_MODEL.replace(".pt", ".onnx")
INFER_IMGSZ = 1920
CONF_THRESH = 0.1
NMS_THRESH = 0.4

# 类别映射（根据模型逻辑：0是标题，1是精灵物品，2是名字）
CLASS_NAMES = {0: "Title", 1: "Item", 2: "Name"}
# 可视化颜色
COLORS = {0: (255, 0, 0), 1: (0, 255, 0), 2: (0, 0, 255)}  # RGB


class YOLOv8ORT:
    def __init__(self, model_path):
        # 延迟导入 onnxruntime，避免启动阶段加载重模块
        import onnxruntime as ort
        logger.info(f"正在加载YOLO模型: {model_path}")
        providers = ['CUDAExecutionProvider', 'CPUExecutionProvider']
        if ort.get_device() == 'CPU':
            providers = ['CPUExecutionProvider']

        logger.info(f"ONNX Runtime 推理后端: {providers[0]}")
        self.session = ort.InferenceSession(model_path, providers=providers)
        self.input_name = self.session.get_inputs()[0].name
        self.output_names = [o.name for o in self.session.get_outputs()]

        input_shape = self.session.get_inputs()[0].shape
        self.model_h = int(input_shape[2]) if isinstance(input_shape[2], int) else INFER_IMGSZ
        self.model_w = int(input_shape[3]) if isinstance(input_shape[3], int) else INFER_IMGSZ

        logger.info(f"YOLO模型加载成功，输入尺寸: {self.model_w}x{self.model_h}")

    def preprocess(self, pil_img):
        orig_w, orig_h = pil_img.size
        img = np.array(pil_img.convert('RGB'))
        # letterbox：保持宽高比，缩放到模型输入内并补黑边。
        # 之前用 cv2.resize 直接拉伸，16:9 画面被竖向拉长，导致小目标（头像/名字）检测崩掉。
        scale = min(self.model_w / orig_w, self.model_h / orig_h)
        new_w = int(round(orig_w * scale))
        new_h = int(round(orig_h * scale))
        resized = cv2.resize(img, (new_w, new_h))
        canvas = np.full((self.model_h, self.model_w, 3), 114, np.uint8)
        pad_x = (self.model_w - new_w) // 2
        pad_y = (self.model_h - new_h) // 2
        canvas[pad_y:pad_y + new_h, pad_x:pad_x + new_w] = resized
        img = canvas
        img = img.astype(np.float32) / 255.0
        img = img.transpose(2, 0, 1)
        img = np.expand_dims(img, axis=0)
        logger.debug(
            f"预处理(letterbox): 原图 {orig_w}x{orig_h} -> {new_w}x{new_h} 补边({pad_x},{pad_y})"
        )
        return img, orig_w, orig_h, (scale, pad_x, pad_y)

    def postprocess(self, outputs, orig_w, orig_h, lb, conf_threshold=0.25):
        predictions = np.squeeze(outputs[0])
        predictions = predictions.T
        scale, pad_x, pad_y = lb

        boxes = []
        scores = []
        class_ids = []

        for pred in predictions:
            cls_scores = pred[4:]
            max_score = np.max(cls_scores)

            if max_score >= conf_threshold:
                class_id = np.argmax(cls_scores)
                cx, cy, w, h = pred[0:4]
                # 模型空间(含letterbox补边) -> 原图坐标
                cx = (cx - pad_x) / scale
                cy = (cy - pad_y) / scale
                w = w / scale
                h = h / scale
                x1 = cx - w / 2
                y1 = cy - h / 2
                boxes.append([float(x1), float(y1), float(w), float(h)])
                scores.append(float(max_score))
                class_ids.append(int(class_id))

        logger.debug(f"后处理: 阈值过滤后 {len(boxes)} 个候选框")

        indices = cv2.dnn.NMSBoxes(boxes, scores, conf_threshold, NMS_THRESH)
        results = []
        if len(indices) > 0:
            for i in indices.flatten():
                x, y, w, h = boxes[i]
                # 裁剪到原图范围内，避免越界
                rx1 = max(0, int(round(x)))
                ry1 = max(0, int(round(y)))
                rx2 = min(orig_w, int(round(x + w)))
                ry2 = min(orig_h, int(round(y + h)))
                results.append({
                    "box": (rx1, ry1, rx2, ry2),
                    "conf": scores[i],
                    "class": class_ids[i]
                })
        logger.debug(f"后处理: NMS后最终 {len(results)} 个检测结果")
        return results

    def predict(self, pil_image, conf_threshold=0.25):
        t0 = time.time()
        blob, orig_w, orig_h, lb = self.preprocess(pil_image)
        outputs = self.session.run(self.output_names, {self.input_name: blob})
        results = self.postprocess(outputs, orig_w, orig_h, lb, conf_threshold)
        elapsed = (time.time() - t0) * 1000
        logger.debug(f"YOLO推理耗时: {elapsed:.1f}ms, 检测到 {len(results)} 个目标")
        return results


# --- 核心新增：可视化函数 ---
def visualize_detections(pil_image, detections, save_name="yolo_debug.png"):
    """
    在图片上画框并保存，用于查看识别是否准确
    """
    if not debug_enabled():
        logger.debug("debug 截图保存已关闭，跳过 YOLO 可视化")
        return None

    logger.debug(f"开始可视化检测结果，共 {len(detections)} 个框")

    draw_img = pil_image.copy()
    draw = ImageDraw.Draw(draw_img)

    # 尝试加载字体，如果加载失败则使用默认字体
    try:
        font = ImageFont.truetype("arial.ttf", 24)
    except:
        font = ImageFont.load_default()

    for det in detections:
        box = det["box"]  # (x1, y1, x2, y2)
        cid = det["class"]
        conf = det["conf"]
        label = f"{CLASS_NAMES.get(cid, 'Unknown')} {conf:.2f}"
        color = COLORS.get(cid, (255, 255, 255))

        # 画矩形框 (增加宽度方便查看)
        draw.rectangle(box, outline=color, width=4)

        # 在框上方写文字
        text_pos = (box[0], box[1] - 30 if box[1] > 30 else box[1])
        draw.text(text_pos, label, fill=color, font=font)

    # 保存到 debug 目录
    debug_dir = os.path.join("debug", "yolo_viz")
    if not os.path.exists(debug_dir):
        os.makedirs(debug_dir)
    clean_debug_folder(debug_dir)
    file_name = time.strftime("%Y%m%d_%H%M%S") + ".jpg"
    save_path = os.path.join(debug_dir, file_name)
    draw_img.save(save_path)
    logger.debug(f"--> [DEBUG] YOLO可视化结果已保存至: {save_path}")
    return save_path


_yolo_model = None
_yolo_lock = threading.Lock()


def get_yolo_model():
    """YOLO 模型懒加载单例：首次裁剪时才加载，不拖慢启动。"""
    global _yolo_model
    if _yolo_model is None:
        with _yolo_lock:
            if _yolo_model is None:
                _yolo_model = YOLOv8ORT(MODEL_PATH)
    return _yolo_model


def crop_sections_from_pil_by_YOLOv8(pil_image: Image.Image, debug=True):
    """
    使用 ONNX 推理进行动态裁剪，并可选开启可视化调试
    """
    logger.debug("开始YOLO动态裁剪")
    detections = get_yolo_model().predict(pil_image, conf_threshold=CONF_THRESH)

    # --- 调用可视化 ---
    if debug:
        visualize_detections(pil_image, detections)

    title_pil = None
    name_boxes = []
    item_boxes = []

    for det in detections:
        cid = det["class"]
        box = det["box"]
        if cid == 0:
            title_pil = pil_image.crop(box)
        elif cid == 2:
            name_boxes.append(box)
        elif cid == 1:
            item_boxes.append(box)

    logger.debug(f"检测分类: Title={len([d for d in detections if d['class']==0])}, "
                 f"Name={len(name_boxes)}, Item={len(item_boxes)}")

    # 排序与裁剪逻辑...
    name_boxes.sort(key=lambda b: b[0])
    item_boxes.sort(key=lambda b: b[0])

    def boxes_to_pil_list(box_list, target_len=3):
        out = []
        for b in box_list[:target_len]:
            out.append(pil_image.crop(b))
        while len(out) < target_len:
            out.append(None)
        return out

    if title_pil is None:
        logger.warning("未检测到Title区域，裁剪结果中title为None")
    name_result = boxes_to_pil_list(name_boxes, 3)
    item_result = boxes_to_pil_list(item_boxes, 3)
    logger.debug(f"裁剪完成: title={'OK' if title_pil else 'NONE'}, "
                 f"name有效={sum(1 for x in name_result if x is not None)}/3, "
                 f"item有效={sum(1 for x in item_result if x is not None)}/3")

    return title_pil, name_result, item_result
