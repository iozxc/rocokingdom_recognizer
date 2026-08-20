import threading

import numpy as np
from PIL import Image
from ultralytics import YOLO

import config

# 全局初始化一次模型
yolo_model = YOLO(config.SCANNER)
INFER_IMGSZ = 1920
CONF_THRESH = 0.25

warmup_done = threading.Event()  # 预热完成信号


def yolo_warmup_background():
    """后台线程执行预热；模型加载+预热全部放在这个线程内"""
    global yolo_model
    try:
        print("后台线程：开始加载YOLO模型...")
        # 构造虚拟BGR图片
        dummy_bgr_img = np.random.randint(0, 255, (INFER_IMGSZ, INFER_IMGSZ, 3), dtype=np.uint8)
        print("后台线程：执行YOLO预热 imgsz=", INFER_IMGSZ)
        # 跑两次预热
        for _ in range(2):
            _ = yolo_model.predict(
                dummy_bgr_img,
                imgsz=INFER_IMGSZ,
                conf=0.99,
                verbose=False,
                save=False
            )
        print("YOLO异步预热完成")
    except Exception as e:
        print(f"预热异常: {e}")
    finally:
        warmup_done.set()  # 不管成功失败，标记完成


# 程序启动时，启动后台预热线程（不会阻塞主线程）
warmup_thread = threading.Thread(target=yolo_warmup_background, daemon=True)
warmup_thread.start()


def crop_sections_from_pil_by_YOLOv8(pil_image: Image.Image):
    """
    替换原来硬坐标裁剪，使用YOLO动态检测框
    返回: (title_pil, [name1_pil, name2_pil, name3_pil], [item1_pil, item2_pil, item3_pil])
    检测不到的目标填充 None
    """
    # PIL图片直接给yolo推理
    res = yolo_model(pil_image, conf=CONF_THRESH, imgsz=INFER_IMGSZ)
    boxes = res[0].boxes

    title_pil = None
    name_boxes = []
    item_boxes = []

    for box in boxes:
        cid = int(box.cls[0])
        x1, y1, x2, y2 = map(int, box.xyxy[0])
        if cid == 0:
            # title
            title_pil = pil_image.crop((x1, y1, x2, y2))
        elif cid == 2:
            # name
            name_boxes.append((x1, y1, x2, y2))
        elif cid == 1:
            # item
            item_boxes.append((x1, y1, x2, y2))

    # 按X从左到右排序（场上1、2、3号位）
    name_boxes.sort(key=lambda b: b[0])
    item_boxes.sort(key=lambda b: b[0])

    # 补齐长度到3，不足填充None，兼容2人对战场景
    def boxes_to_pil_list(box_list, target_len=3):
        out = []
        for b in box_list[:target_len]:
            x1, y1, x2, y2 = b
            out.append(pil_image.crop((x1, y1, x2, y2)))
        # 不够补None
        while len(out) < target_len:
            out.append(None)
        return out

    name_pil_list = boxes_to_pil_list(name_boxes, 3)
    item_pil_list = boxes_to_pil_list(item_boxes, 3)

    return title_pil, name_pil_list, item_pil_list
