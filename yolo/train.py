import os
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"

from ultralytics import YOLO

if __name__ == '__main__':
    model = YOLO("yolov8n.pt")

    results = model.train(
        data="roco.yaml",
        epochs=80,
        imgsz=1920,
        batch=8,
        device=0,
        scale=0.5,
        mosaic=1.0,
        patience=15,
        workers=0,
        project="runs/detect",
        name="roco_ui"
    )
