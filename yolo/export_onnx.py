import os
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"
from ultralytics import YOLO

if __name__ == '__main__':
    model = YOLO(r"runs/detect/roco_ui/weights/best.pt")
    # 导出onnx，支持任意输入图片尺寸
    model.export(
        format="onnx",
        dynamic=True,
        simplify=True
    )
