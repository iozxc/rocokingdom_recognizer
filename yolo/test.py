import os
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"
from ultralytics import YOLO

if __name__ == '__main__':
    model_path = r"D:\game\RocoKingdom\yolo\runs\detect\runs\detect\roco_ui\weights\best.onnx"
    model = YOLO(model_path)

    img_path = r"test.jpg"
    # 重点！！加上 imgsz=1920，和训练保持一致
    res = model(img_path, conf=0.25, imgsz=1920)

    annotated_img = res[0].plot()
    import cv2
    cv2.imwrite("result.jpg", annotated_img)
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
