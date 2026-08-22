from ultralytics import YOLO

# 填你的best.pt完整路径
model = YOLO(r"D:\game\RocoKingdom\yolo\runs\detect\runs\detect\roco_ui-5\weights\best.pt")

onnx_out = model.export(
    format="onnx",
    imgsz=1280,
    opset=17,
    simplify=True,    # 简化onnx，去掉冗余算子，CPU推理提速，必开
    dynamic=True     # False固定尺寸，CPU速度更快；不需要动态输入不要改成True
)

print("导出完成，onnx路径：", onnx_out)
