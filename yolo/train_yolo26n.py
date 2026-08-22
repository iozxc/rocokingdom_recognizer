import os
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"

from ultralytics import YOLO

if __name__ == '__main__':
    # 换成yolo26n.pt，nano轻量版，适合CPU部署
    model = YOLO("yolo26n.pt")

    results = model.train(
        data="roco.yaml",
        epochs=80,
        imgsz=1280,
        batch=4,
        device=0,
        scale=0.3,
        mosaic=0.0,
        mixup=0.0,
        copy_paste=0.0,
        patience=12,
        workers=0,
        project="runs/detect",
        name="roco_ui_yolo26",
        val=True,
        cos_lr=True,
        lr0=0.0008,            # yolo26推荐更小初始学习率，小样本更稳
        weight_decay=0.0005,
        hsv_h=0.015,
        hsv_s=0.4,
        hsv_v=0.4,
        flipud=0.0,
        fliplr=0.5,
        freeze=10,             # 冻结主干前10层，对抗小样本过拟合
    )

    best_model = YOLO(results.save_dir / "weights/best.pt")
    onnx_file = best_model.export(
        format="onnx",
        imgsz=1280,
        opset=17,
        simplify=True,
        dynamic=False
    )
    print(f"YOLO26 ONNX导出完成：{onnx_file}")
