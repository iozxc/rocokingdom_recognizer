import os
from pathlib import Path

os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"
from ultralytics import YOLO

if __name__ == '__main__':
    # 自动使用 runs 目录下最新的 best.onnx
    runs_dir = Path(__file__).resolve().parent / "runs"
    onnx_candidates = sorted(
        runs_dir.glob("**/weights/best.onnx"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    if not onnx_candidates:
        raise SystemExit(f"未找到 best.onnx，请先运行 export_onnx.py（期望目录: {runs_dir}）")
    model_path = onnx_candidates[0]
    print(f"使用模型: {model_path}")
    model = YOLO(str(model_path))

    img_path = str(Path(__file__).resolve().parent / "test.jpg")
    # 重点！！加上 imgsz=1920，和训练保持一致
    res = model(img_path, conf=0.25, imgsz=1280)

    annotated_img = res[0].plot()
    import cv2
    cv2.imwrite(str(Path(__file__).resolve().parent / "result.jpg"), annotated_img)
    print("已保存 result.jpg")

    name_boxes = []
    item_boxes = []
    cls_names = {0:"title",1:"item",2:"name"}

    for box in res[0].boxes:
        cid = int(box.cls[0])
        x1,y1,x2,y2 = map(int, box.xyxy[0])
        conf = float(box.conf[0])
        print(f"cid={cid} {cls_names[cid]} conf={conf:.3f} | [{x1},{y1},{x2},{y2}]")

        if cid == 2:
            name_boxes.append((x1,y1,x2,y2))
        elif cid == 1:
            item_boxes.append((x1,y1,x2,y2))

    name_boxes.sort(key=lambda b: b[0])
    item_boxes.sort(key=lambda b: b[0])
    print("\n排序后角色name框列表：", name_boxes)
