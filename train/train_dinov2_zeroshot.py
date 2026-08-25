#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""DINOv2 零训练基线：纯预训练特征 + 余弦匹配，不微调。

用途：在花时间训练前，先判断 DINOv2 预训练特征本身对"精灵 icon 细粒度"的判别力。
快速（无训练，只有前向），几分钟出 top-1/top-5。

与 train_dinov2.py 的区别：这里**不训练**，直接取 DINOv2 的 cls token(384维)，
不经任何随机 proj，保证是纯净的 DINOv2 预训练特征。

用法：
  python train/train_dinov2_zeroshot.py --device cuda --views 8 --topk 5
"""

import argparse
import os
import sys
import random
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))
if str(Path(__file__).resolve().parent) not in sys.path:
    sys.path.insert(0, str(Path(__file__).resolve().parent))

os.environ["PYTHONIOENCODING"] = "utf-8"
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
import torchvision.transforms as T
from PIL import Image, ImageDraw

import timm
from tqdm import tqdm

from core.pet_path import split_pet_filename
from train_dinov2 import (
    DINO_CKPT, DINO_IMG_SIZE, IMG_DIR, TEST_DIR,
    filter_dir, load_image, build_eval, eval_test,
)


class DinoRaw(nn.Module):
    """只取 DINOv2 cls token，L2 归一化，无任何额外层。"""
    def __init__(self):
        super().__init__()
        self.backbone = timm.create_model(
            "vit_small_patch14_dinov2.lvd142m",
            pretrained=False, num_classes=0,
            checkpoint_path=DINO_CKPT if os.path.exists(DINO_CKPT) else None,
        )
        self.emb_dim = self.backbone.embed_dim  # 384

    def forward(self, x):
        f = self.backbone.forward_features(x)   # (B, N, D)
        cls = f[:, 0, :]                         # (B, D)
        return F.normalize(cls, p=2, dim=1)


def _paste_into_test_style(icon_rgba, canvas=512):
    """把训练库透明 icon 合成到 test 截图风格：米白外背景 + 深色圆框 + 立绘主体。

    icon_rgba: PIL RGBA(透明)的 icon。返回 PIL RGB (canvas, canvas)。
    """
    # 外背景：米白/浅色
    bg = Image.new("RGB", (canvas, canvas), (232, 223, 203))
    # 深色圆框：画一个大的深色圆
    import math, random
    d = ImageDraw.Draw(bg)
    cx = canvas // 2 + random.randint(-6, 6)
    cy = canvas // 2 + random.randint(-6, 6)
    r = int(canvas * random.uniform(0.42, 0.5))
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(28, 26, 24))  # 近黑圆框
    # 精灵主体：透明 icon，(pad 白底)
    icon = icon_rgba.convert("RGBA")
    iw = icon.size[0]
    scale = random.uniform(1.5, 1.9)   # 训练库 128 icon 放大占满圆框
    new_size = int(iw * scale)
    icon = icon.resize((new_size, new_size), Image.LANCZOS)
    # 剪裁到圆框半径避免溢出太多
    paste_x = max(0, cx - new_size // 2)
    paste_y = max(0, cy - new_size // 2)
    # 限制到画布内
    ax0 = max(0, paste_x); ay0 = max(0, paste_y)
    ax1 = min(canvas, paste_x + new_size); ay1 = min(canvas, paste_y + new_size)
    # 贴图
    bg.paste(icon, (paste_x, paste_y), icon.split()[-1])
    return bg


def build_feature_db_raw(model, image_dir, device, n_views=8):
    model.to(device).eval()
    eval_pp = build_eval()
    views = [
        None,
        T.Compose([T.RandomResizedCrop(DINO_IMG_SIZE, scale=(0.86, 1.0), ratio=(0.92, 1.08)),
                   T.RandomAffine(degrees=6, translate=(0.05, 0.05), scale=(0.9, 1.08), fill=0,
                                  interpolation=T.InterpolationMode.BILINEAR)]),
        T.Compose([T.Resize((DINO_IMG_SIZE, DINO_IMG_SIZE)),
                   T.ColorJitter(brightness=0.2, contrast=0.2, saturation=0.2)]),
        T.Compose([T.Resize((DINO_IMG_SIZE, DINO_IMG_SIZE)),
                   T.GaussianBlur(kernel_size=3, sigma=(0.1, 0.4))]),
        T.Compose([T.RandomResizedCrop(DINO_IMG_SIZE, scale=(0.75, 0.95), ratio=(0.9, 1.1))]),
    ]
    weights = [0.25, 0.25, 0.25, 0.12, 0.13]
    feats, paths = [], []
    files = filter_dir(image_dir)[0]
    for i, f in enumerate(files):
        img = load_image(os.path.join(image_dir, f))
        for _ in range(n_views):
            tr = random.choices(views, weights=weights, k=1)[0]
            v = tr(img) if tr is not None else img
            t = eval_pp(v).unsqueeze(0).to(device)
            with torch.no_grad():
                feats.append(model(t).cpu().numpy().flatten())
            paths.append(f)
        if (i + 1) % 100 == 0:
            print(f"  入库 {i+1}/{len(files)}", flush=True)
    feats = np.array(feats, dtype=np.float32)
    feats /= np.maximum(np.linalg.norm(feats, axis=1, keepdims=True), 1e-12)
    return feats, paths


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--device", default="auto")
    ap.add_argument("--views", type=int, default=8)
    ap.add_argument("--topk", type=int, default=5)
    ap.add_argument("--image-dir", default=IMG_DIR,
                    help="特征库来源目录。默认训练库 image；传 image_full 可包含截图")
    ap.add_argument("--test-dir", default=TEST_DIR)
    args = ap.parse_args()

    if args.device == "auto":
        device = "cuda" if torch.cuda.is_available() else "cpu"
    else:
        device = args.device
    print(f"设备: {device}", flush=True)

    ok_train, ph_train = filter_dir(args.image_dir)
    ok_test, ph_test = filter_dir(args.test_dir or TEST_DIR)
    print(f"特征库来源: {len(ok_train)} 张（过滤占位 {len(ph_train)}）", flush=True)
    print(f"测试集: {len(ok_test)} 张（过滤占位 {len(ph_test)}）", flush=True)

    print("加载 DINOv2 预训练 backbone（零训练）...", flush=True)
    model = DinoRaw().to(device).eval()
    print(f"  cls 维度: {model.emb_dim}", flush=True)

    print(f"构建多视角特征库（views={args.views}）...", flush=True)
    feats, paths = build_feature_db_raw(model, args.image_dir, device, args.views)
    print(f"  库大小: {feats.shape}", flush=True)

    print("在 test 上评估（纯 DINOv2 预训练特征，无微调）...", flush=True)
    report = eval_test(model, feats, paths, device, args.topk,
                       test_dir=args.test_dir or TEST_DIR)
    print("=" * 60)
    print(f"[零训练基线] DINOv2 预训练特征  test top-1 = {report['top1_acc']:.2%}  "
          f"top-{args.topk} = {report[f'top{args.topk}_acc']:.2%}")
    print("=" * 60)
    print("（对比：ResNet50+ArcFace 微调后 top-1 92.77%）")


if __name__ == "__main__":
    main()
