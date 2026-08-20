import os
import time
import numpy as np
import cv2
from PIL import Image, ImageDraw, ImageFont  # 增加了 ImageDraw 和 ImageFont
import onnxruntime as ort

import config
from logger import logger
from tools import clean_debug_folder

# --- 配置 ---
MODEL_PATH = config.SCANNER if config.SCANNER.endswith(".onnx") else config.SCANNER.replace(".pt", ".onnx")
INFER_IMGSZ = 1920
CONF_THRESH = 0.1
NMS_THRESH = 0.4

# 类别映射（根据模型逻辑：0是标题，1是精灵物品，2是名字）
CLASS_NAMES = {0: "Title", 1: "Item", 2: "Name"}
# 可视化颜色
COLORS = {0: (255, 0, 0), 1: (0, 255, 0), 2: (0, 0, 255)}  # RGB


class YOLOv8ORT:
    def __init__(self, model_path):
        providers = ['CUDAExecutionProvider', 'CPUExecutionProvider']
        if ort.get_device() == 'CPU':
            providers = ['CPUExecutionProvider']

        self.session = ort.InferenceSession(model_path, providers=providers)
        self.input_name = self.session.get_inputs()[0].name
        self.output_names = [o.name for o in self.session.get_outputs()]

        input_shape = self.session.get_inputs()[0].shape
        self.model_h = int(input_shape[2]) if isinstance(input_shape[2], int) else INFER_IMGSZ
        self.model_w = int(input_shape[3]) if isinstance(input_shape[3], int) else INFER_IMGSZ

    def preprocess(self, pil_img):
        orig_w, orig_h = pil_img.size
        img = np.array(pil_img.convert('RGB'))
        img = cv2.resize(img, (self.model_w, self.model_h))
        img = img.astype(np.float32) / 255.0
        img = img.transpose(2, 0, 1)
        img = np.expand_dims(img, axis=0)
        return img, orig_w, orig_h

    def postprocess(self, outputs, orig_w, orig_h, conf_threshold=0.25):
        predictions = np.squeeze(outputs[0])
        predictions = predictions.T

        boxes = []
        scores = []
        class_ids = []

        for pred in predictions:
            cls_scores = pred[4:]
            max_score = np.max(cls_scores)

            if max_score >= conf_threshold:
                class_id = np.argmax(cls_scores)
                cx, cy, w, h = pred[0:4]
                x1 = cx - w / 2
                y1 = cy - h / 2
                boxes.append([float(x1), float(y1), float(w), float(h)])
                scores.append(float(max_score))
                class_ids.append(int(class_id))

        indices = cv2.dnn.NMSBoxes(boxes, scores, conf_threshold, NMS_THRESH)
        results = []
        if len(indices) > 0:
            scale_w = orig_w / self.model_w
            scale_h = orig_h / self.model_h
            for i in indices.flatten():
                x, y, w, h = boxes[i]
                rx1 = int(x * scale_w)
                ry1 = int(y * scale_h)
                rx2 = int((x + w) * scale_w)
                ry2 = int((y + h) * scale_h)
                results.append({
                    "box": (rx1, ry1, rx2, ry2),
                    "conf": scores[i],
                    "class": class_ids[i]
                })
        return results

    def predict(self, pil_image, conf_threshold=0.25):
        blob, orig_w, orig_h = self.preprocess(pil_image)
        outputs = self.session.run(self.output_names, {self.input_name: blob})
        return self.postprocess(outputs, orig_w, orig_h, conf_threshold)


# --- 核心新增：可视化函数 ---
def visualize_detections(pil_image, detections, save_name="yolo_debug.png"):
    """
    在图片上画框并保存，用于查看识别是否准确
    """
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
    clean_debug_folder(debug_dir, max_count=100)
    file_name = time.strftime("%Y%m%d_%H%M%S") + ".jpg"
    save_path = os.path.join(debug_dir, file_name)
    draw_img.save(save_path)
    logger.debug(f"--> [DEBUG] YOLO可视化结果已保存至: {save_path}")
    return save_path


# --- 初始化逻辑 ---
yolo_model = YOLOv8ORT(MODEL_PATH)


def crop_sections_from_pil_by_YOLOv8(pil_image: Image.Image, debug=True):
    """
    使用 ONNX 推理进行动态裁剪，并可选开启可视化调试
    """
    detections = yolo_model.predict(pil_image, conf_threshold=CONF_THRESH)

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

    return title_pil, boxes_to_pil_list(name_boxes, 3), boxes_to_pil_list(item_boxes, 3)
