import os
import json

img_folder = r"dataset/images"
out_label_folder = r"dataset/labels"
classes = ["title", "item", "name"]

os.makedirs(out_label_folder, exist_ok=True)

for fname in os.listdir(img_folder):
    if not fname.endswith(".json"):
        continue
    json_path = os.path.join(img_folder, fname)
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    img_w = data["imageWidth"]
    img_h = data["imageHeight"]
    yolo_lines = []

    for shape in data["shapes"]:
        label = shape["label"]
        if label not in classes:
            continue
        cls_id = classes.index(label)
        points = shape["points"]
        x1 = min(points[0][0], points[1][0])
        y1 = min(points[0][1], points[1][1])
        x2 = max(points[0][0], points[1][0])
        y2 = max(points[0][1], points[1][1])

        dw = 1.0 / img_w
        dh = 1.0 / img_h
        xc = (x1 + x2) / 2 * dw
        yc = (y1 + y2) / 2 * dh
        w = (x2 - x1) * dw
        h = (y2 - y1) * dh
        yolo_lines.append(f"{cls_id} {xc:.6f} {yc:.6f} {w:.6f} {h:.6f}")

    txt_name = fname.replace(".json", ".txt")
    txt_out_path = os.path.join(out_label_folder, txt_name)
    with open(txt_out_path, "w", encoding="utf-8") as f:
        f.write("\n".join(yolo_lines))

print("转换完成！输出到", out_label_folder)
