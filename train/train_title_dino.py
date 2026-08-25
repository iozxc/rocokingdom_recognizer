#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成 DINOv2 版 title(地图标题) 特征库，并用 ONNX 推理端验证。

现有用 resnet50 提取的 title 特征库是 onnx/features_title_db_1.pkl(features 3x2048)。
本脚本改用 DINOv2 backbone(onnx/dino_backbone.onnx, 输入 518, 输出 384)，
对 train/dataset/title_1 的 1.png/2.png/3.png 生成多视角(多 view)特征，
输出成 onnx/features_title_db_1.pkl(features 3x384)，供 MapClassifier 使用。

说明：DINOv2 特征维度 384；MapClassifier 已改为自动适配 518 输入。
用法(GPU 环境，无训练，纯前向，几秒到几十秒)：
  D:...python.exe train/train_title_dino.py --views 8 --device cuda
"""

import argparse
import os
import sys
import pickle
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
if str(ROOT / "train") not in sys.path:
    sys.path.insert(0, str(ROOT / "train"))

os.environ["PYTHONIOENCODING"] = "utf-8"
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

import numpy as np
import torch
import torch.nn.functional as F
import torchvision.transforms as T
from PIL import Image

from train_dinov2_zeroshot import DinoRaw, DINO_IMG_SIZE

DATASET = ROOT / "train" / "dataset" / "title_1"
OUT_PKL = ROOT / "onnx" / "features_title_db_1.pkl"
ONNX_BACKBONE = ROOT / "onnx" / "dino_backbone.onnx"
PT_BACKBONE = ROOT / "train" / "onnx_dino" / "dino_backbone.pt"  # 参考用，可选


def load_img(p):
    im = Image.open(p).convert("RGB")
    if im.mode == "RGBA" or "A" in im.getbands():
        bg = Image.new("RGB", im.size, (255, 255, 255))
        bg.paste(im, mask=im.split()[-1] if im.mode == "RGBA" else None)
        im = bg
    return im


def pad_resize(im, sz=DINO_IMG_SIZE):
    """保持长宽比：长边缩放到 sz，短边居中 pad 到 sz，避免标题变形。"""
    w, h = im.size
    scale = sz / max(w, h)
    nw, nh = max(1, int(w * scale)), max(1, int(h * scale))
    im2 = im.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new("RGB", (sz, sz), (255, 255, 255))
    canvas.paste(im2, ((sz - nw) // 2, (sz - nh) // 2))
    return canvas


def build_eval():
    return T.Compose([
        T.Lambda(lambda im: pad_resize(im)),
        T.ToTensor(),
        T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
    ])


def build_views():
    """轻微多视角：缩放/平移/轻微旋转/亮度（保留主体）。"""
    return [
        lambda im: pad_resize(im),
        T.Compose([T.Lambda(lambda im: pad_resize(im)),
                   T.RandomAffine(degrees=2, translate=(0.02, 0.02), scale=(0.97, 1.03), fill=(255, 255, 255),
                                  interpolation=T.InterpolationMode.BILINEAR)]),
        T.Compose([T.Lambda(lambda im: pad_resize(im)),
                   T.ColorJitter(brightness=0.1, contrast=0.1, saturation=0.1)]),
    ]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--views", type=int, default=1,
                    help="title 每类只有1张且类间极相似，多view平均反而降低区分度，默认1")
    ap.add_argument("--device", default="auto")
    ap.add_argument("--title-dir", default=str(DATASET))
    ap.add_argument("--out", default=str(OUT_PKL))
    ap.add_argument("--backbone", default=str(ONNX_BACKBONE))
    args = ap.parse_args()

    device = args.device
    if device == "auto":
        device = "cuda" if torch.cuda.is_available() else "cpu"
    if device == "cuda" and not torch.cuda.is_available():
        device = "cpu"
    print(f"设备: {device}", flush=True)

    # 加载 DINOv2 backbone（PIL 前向，与 zeroshot 一致）
    m = DinoRaw().to(device).eval()
    eval_pp = build_eval()
    views = build_views()
    files = sorted(
        f for f in os.listdir(args.title_dir)
        if f.lower().endswith((".png", ".jpg", ".jpeg"))
    )
    print(f"title 图：{files}", flush=True)
    feats, paths = [], []
    for f in files:
        img = load_img(os.path.join(args.title_dir, f))
        # title 每类 1 张：用单图(保持比例 padding)提特征，绝不平均(平均会降低区分度)
        t = eval_pp(img).unsqueeze(0).to(device)
        with torch.no_grad():
            feat = m(t).cpu().numpy().flatten()
        feat /= max(np.linalg.norm(feat), 1e-12)
        feats.append(feat)
        paths.append(f)
        print(f"  {f}: -> {feat.shape} 已归一化", flush=True)

    feats = np.array(feats, dtype=np.float32)
    feats /= np.maximum(np.linalg.norm(feats, axis=1, keepdims=True), 1e-12)
    db = {"features": feats, "paths": paths}
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists():
        out.with_suffix(".bak").write_bytes(out.read_bytes())
    pickle.dump(db, open(out, "wb"))
    print(f"已写入 {out}（features {feats.shape}, paths {paths}）", flush=True)

    # 验证 ONNX 推理端(MapClassifier 会用)能正常加载
    import onnxruntime as ort
    import cv2
    sess = ort.InferenceSession(args.backbone, providers=["CPUExecutionProvider"])
    in_sz = sess.get_inputs()[0].shape[2]
    print(f"backbone 输入尺寸: {in_sz}（MapClassifier 将自动适配）", flush=True)


if __name__ == "__main__":
    main()
