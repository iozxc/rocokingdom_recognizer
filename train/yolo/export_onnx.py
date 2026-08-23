"""将训练好的 best.pt 导出为 ONNX。"""
from pathlib import Path

from ultralytics import YOLO

RUNS_DIR = Path(__file__).resolve().parent / "runs"


def find_latest_best_pt() -> Path:
    """在 runs 目录下查找最新的 best.pt"""
    candidates = sorted(
        RUNS_DIR.glob("**/weights/best.pt"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    if not candidates:
        raise SystemExit(f"未找到 best.pt，请先训练（期望目录: {RUNS_DIR}）")
    return candidates[0]


if __name__ == '__main__':
    best_pt = find_latest_best_pt()
    print(f"使用模型: {best_pt}")
    model = YOLO(str(best_pt))

    onnx_out = model.export(
        format="onnx",
        imgsz=1280,
        opset=17,
        simplify=True,    # 简化onnx，去掉冗余算子，CPU推理提速，必开
        dynamic=True,     # False固定尺寸，CPU速度更快；不需要动态输入不要改成True
    )
    print("导出完成，onnx路径：", onnx_out)
