# -*- coding: utf-8 -*-
"""重建 DINOv2 零训练 icon 特征库 feature_icon_dino_full.pkl。

- 这不是训练：只是用裸 DINOv2(vit_small_patch14_dinov2, cls 384 维) 对
  train/dataset/image_full（本体 + _shot 截图）× N 视角 逐图前向，得到特征库。
- 不需要 .pt / 不需要 pt2pkl。权重来自 assets/dino/vit_small_patch14_dinov2.safetensors。
- 默认 n_views=6（与现有 6312 = 1052*6 一致）。

用途：当 image_full 里的图片被改名/增删后，重跑生成一份与改后图片一致的新库。
D:\Dev\anaconda3\envs\rocokingdom_dev_gpu\python.exe train/features/rebuild_icon_dino_full.py --views 6 --device cuda
用法（GPU 环境）：
  D:\\Dev\\anaconda3\\envs\\rocokingdom_dev_gpu\\python.exe train/features/rebuild_icon_dino_full.py --views 6 --device cuda
"""

import os
import sys
import argparse
import pickle
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
for p in (str(ROOT), str(ROOT / "train")):
    if p not in sys.path:
        sys.path.insert(0, p)

os.environ["PYTHONIOENCODING"] = "utf-8"
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

import numpy as np

# 复用 zeroshot 的裸特征管线（同 backbone / 同 eval 预处理 / 同多视角）
from train_dinov2_zeroshot import DinoRaw, build_feature_db_raw, filter_dir

DEFAULT_IMAGE_DIR = ROOT / "train" / "dataset" / "image_full"
ONNX_OUT = ROOT / "onnx" / "feature_icon_dino_full.pkl"
TRAIN_OUT = ROOT / "train" / "onnx_dino" / "feature_icon_dino_full.pkl"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--image-dir", default=str(DEFAULT_IMAGE_DIR),
                    help="特征库来源目录（默认 train/dataset/image_full）")
    ap.add_argument("--views", type=int, default=6,
                    help="每个文件做的多视角增强次数（默认 6，与现有库一致）")
    ap.add_argument("--device", default="auto")
    ap.add_argument("--out", action="append", default=[],
                    help="额外输出路径，可重复传。默认写 onnx/ 与 train/onnx_dino/ 两处")
    args = ap.parse_args()

    device = args.device
    if device == "auto":
        device = "cuda" if __import__("torch").cuda.is_available() else "cpu"
    if device == "cuda" and not __import__("torch").cuda.is_available():
        device = "cpu"
    print(f"设备: {device}", flush=True)

    image_dir = Path(args.image_dir)
    ok_files, ph_files = filter_dir(str(image_dir))
    print(f"输入目录: {image_dir}  ->  {len(ok_files)} 张（过滤占位 {len(ph_files)}）", flush=True)

    print("加载 DINOv2 预训练 backbone（零训练）...", flush=True)
    model = DinoRaw().to(device).eval()
    print(f"  cls 维度: {model.emb_dim}", flush=True)

    print(f"构建多视角特征库（views={args.views}）...", flush=True)
    feats, paths = build_feature_db_raw(model, str(image_dir), device, args.views)
    print(f"  库大小: {feats.shape}", flush=True)

    db = {"features": feats.astype(np.float32), "paths": paths}
    outs = [str(ONNX_OUT), str(TRAIN_OUT)] + list(args.out)
    for o in outs:
        p = Path(o)
        p.parent.mkdir(parents=True, exist_ok=True)
        if p.exists():
            p.with_suffix(".bak").write_bytes(p.read_bytes())
        pickle.dump(db, open(p, "wb"), protocol=pickle.HIGHEST_PROTOCOL)
        print(f"已写入 {p}（features {feats.shape}, paths {len(paths)}）", flush=True)

    # 快速自检：确认库里是否含目标名字（仅提示）
    sample = sorted({x for x in paths if "疾光" in x})
    if sample:
        print("库内疾光条目:", sample[:4], "…", flush=True)


if __name__ == "__main__":
    main()
