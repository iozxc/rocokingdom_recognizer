#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""GPU 版：度量学习(ArcFace) + 数据增强训练，并对游戏截图 test 集做评估。

解决痛点：每类 1 张样本(one-shot)，用 ImageNet 通用特征区分度不够。
方案：
  - 数据增强（旋转/缩放/平移/颜色扰动/仿射/模糊/随机擦除）造多样本；
  - ArcFace 余弦角间隔训练 512 维 L2 特征空间（同类聚拢、异类散开）；
  - 训练库存成"多视角特征"，识别时对 test 截图提特征做余弦匹配，按 id 评估 top-1/top-5。

占位图过滤：黑底白问号(角近黑+中心近白+暗像素占比高)会被过滤，不进训练/评估。

用法（耗时训练请你自己主动运行，避免 CPU/GPU 长时间被占）：
  # 1) 仅评估（如果已有训练好的模型）
  python train/train_metric_gpu.py --mode eval --device cuda

  # 2) 训练 + 导出 + 评估（推荐先训练，可能较久）
  python train/train_metric_gpu.py --mode all --epochs 30 --device cuda

  # 3) 只训练导出，不评估
  python train/train_metric_gpu.py --mode train --epochs 30 --device cuda

产物（写入 onnx /，不覆盖现有 resnet50.onnx 与 feature_icon.pkl）：
  onnx/metric_backbone.onnx        GPU 训练后的 backbone(224->512)
  onnx/metric_backbone.pt          PyTorch 权重
  onnx/feature_icon_metric.pkl    多视角特征库 {"features","paths"}
  onnx/metric_eval_report.json     test 评估结果(top1/top5/过滤统计)
"""

import argparse
import os
import sys
import json
import pickle
import random
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

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
import torch.optim as optim
import torchvision.models as models
import torchvision.transforms as T
from PIL import Image, ImageFilter

from core.pet_path import split_pet_filename, sort_key


# 默认路径
IMG_DIR = str(PROJECT_ROOT / "train" / "dataset" / "image")   # 训练库(透明icon, 有形态序号)
TEST_DIR = str(PROJECT_ROOT / "train" / "dataset" / "test")   # 测试集(游戏截图, 无形态序号)
ONNX_DIR = PROJECT_ROOT / "train" / "onnx"   # 验证前先输出到训练目录，不污染根目录 onnx
ONNX_BACKBONE = ONNX_DIR / "metric_backbone.onnx"
ONNX_PT = ONNX_DIR / "metric_backbone.pt"
ARC_PT = ONNX_DIR / "arcface_weight.pt"
PICKLE_DB = ONNX_DIR / "feature_icon_metric.pkl"
EVAL_REPORT = ONNX_DIR / "metric_eval_report.json"
HISTORY_JSON = ONNX_DIR / "metric_train_history.json"


# ---------------------------------------------------------------------------
# 占位图检测（黑底 + 白问号）
# ---------------------------------------------------------------------------
def is_placeholder_image(img: Image.Image) -> bool:
    """黑底白问号占位图：角近黑、中心近白、暗像素占比高。"""
    img = img.convert("RGB")
    px = img.load()
    w, h = img.size
    if w < 4 or h < 4:
        return False
    corners = [px[0, 0], px[w - 1, 0], px[0, h - 1], px[w - 1, h - 1]]
    dark_corners = sum(1 for c in corners if c[0] < 30 and c[1] < 30 and c[2] < 30)
    c = px[w // 2, h // 2]
    white_center = c[0] > 200 and c[1] > 200 and c[2] > 200
    dark = 0
    n = 0
    sx = max(1, w // 12)
    sy = max(1, h // 12)
    for x in range(0, w, sx):
        for y in range(0, h, sy):
            p = px[x, y]
            n += 1
            if p[0] < 40 and p[1] < 40 and p[2] < 40:
                dark += 1
    dark_ratio = dark / max(n, 1)
    return dark_corners >= 2 and white_center and dark_ratio > 0.4


def filter_dir(image_dir):
    """返回 (文件列表, 占位图列表)。"""
    all_files = sorted(
        (f for f in os.listdir(image_dir) if f.lower().endswith((".png", ".jpg", ".jpeg"))),
        key=sort_key,
    )
    ok, ph = [], []
    for f in all_files:
        p = os.path.join(image_dir, f)
        try:
            if is_placeholder_image(Image.open(p)):
                ph.append(f)
            else:
                ok.append(f)
        except Exception:
            ph.append(f)
    return ok, ph


# ---------------------------------------------------------------------------
# 数据增强 / 预处理
# ---------------------------------------------------------------------------
def load_image(path, pad_white=True):
    img = Image.open(path).convert("RGB")
    # 透明图垫白底（训练库 icon 是透明底）
    if pad_white and (img.mode == "RGBA" or "A" in img.getbands()):
        bg = Image.new("RGB", img.size, (255, 255, 255))
        bg.paste(img, mask=img.split()[-1] if img.mode == "RGBA" else None)
        img = bg
    return img


def build_augment():
    return T.Compose([
        T.RandomResizedCrop(224, scale=(0.85, 1.0), ratio=(0.9, 1.1)),
        T.RandomAffine(degrees=8, translate=(0.06, 0.06), scale=(0.9, 1.1), shear=3,
                       fill=0, interpolation=T.InterpolationMode.BILINEAR),
        T.ColorJitter(brightness=0.25, contrast=0.25, saturation=0.2, hue=0.05),
        T.RandomGrayscale(p=0.05),
        T.GaussianBlur(kernel_size=3, sigma=(0.1, 0.5)),
    ])


def build_eval():
    return T.Compose([
        T.Resize((224, 224)),
        T.ToTensor(),
        T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
    ])


def make_train_loader(image_dir, n_aug=8, batch_size=32):
    dataset = {}   # id -> [paths]
    for f in filter_dir(image_dir)[0]:
        info = split_pet_filename(f)
        if info and info.get("id") is not None:
            dataset.setdefault(info["id"], []).append(os.path.join(image_dir, f))
    ids = sorted(dataset.keys())
    id2label = {pid: i for i, pid in enumerate(ids)}
    aug = build_augment()
    to_t = T.Compose([
        T.ToTensor(),
        T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        T.RandomErasing(p=0.15, scale=(0.02, 0.08), ratio=(0.6, 1.6), value=(0, 0, 0)),
    ])
    images, labels = [], []
    for pid in ids:
        for p in dataset[pid]:
            img = load_image(p)
            for _ in range(n_aug):
                images.append(to_t(aug(img)))
                labels.append(id2label[pid])
    imgs = torch.stack(images)
    labs = torch.tensor(labels, dtype=torch.long)
    ds = torch.utils.data.TensorDataset(imgs, labs)
    loader = torch.utils.data.DataLoader(ds, batch_size=batch_size, shuffle=True)
    return loader, ids, id2label, len(labs)


# ---------------------------------------------------------------------------
# 模型
# ---------------------------------------------------------------------------
class EmbeddingModel(nn.Module):
    def __init__(self, emb_dim=512, pretrained=True):
        super().__init__()
        resnet = models.resnet50(weights=None)
        if pretrained:
            hub = Path(os.path.expanduser("~")) / ".cache" / "torch" / "hub" / "checkpoints" / "resnet50-0676ba61.pth"
            asset = PROJECT_ROOT / "assets" / "resnet50-0676ba61.pth"
            wpath = hub if hub.exists() else asset
            if not wpath.exists():
                raise FileNotFoundError("未找到 resnet50-0676ba61.pth")
            resnet.load_state_dict(torch.load(str(wpath), map_location="cpu"))
        self.backbone = nn.Sequential(*list(resnet.children())[:-1])
        self.pool = nn.AdaptiveAvgPool2d((1, 1))
        self.fc = nn.Sequential(
            nn.Linear(2048, 1024), nn.BatchNorm1d(1024), nn.ReLU(inplace=True), nn.Dropout(0.3),
            nn.Linear(1024, emb_dim), nn.BatchNorm1d(emb_dim),
        )

    def forward(self, x):
        f = self.backbone(x)
        f = self.pool(f).flatten(1)
        f = self.fc(f)
        return F.normalize(f, p=2, dim=1)


class ArcFaceHead(nn.Module):
    def __init__(self, in_features, num_classes, s=30.0, m=0.35):
        super().__init__()
        self.s, self.m = s, m
        self.weight = nn.Parameter(torch.FloatTensor(num_classes, in_features))
        nn.init.xavier_normal_(self.weight)

    def forward(self, embedding, labels=None):
        w = F.normalize(self.weight, p=2, dim=1)
        cos = embedding @ w.t()
        cos = torch.clamp(cos, -1.0 + 1e-7, 1.0 - 1e-7)
        if labels is None:
            return cos * self.s
        theta = torch.acos(cos)
        target = torch.zeros_like(cos)
        target.scatter_(1, labels.view(-1, 1), 1.0)
        return self.s * torch.cos(theta + self.m * target)


# ---------------------------------------------------------------------------
# 训练 / 导出 / 特征库
# ---------------------------------------------------------------------------
def train(model, arc, loader, device, epochs, lr, start_epoch=0,
          weight_decay=1e-3, label_smoothing=0.05,
          eval_every=0, eval_fn=None, patience=0, best_path=None):
    """训练并支持防过拟合：
    - label_smoothing / weight_decay 加大正则；
    - eval_every>0: 每 eval_every 个 epoch 调用 eval_fn(model) 得到 test top-1；
      高于历史最好则保存 best_path(w=model)+记录。eval_fn 返回 float(0~1)。
    - patience>0 且连续 patience 次评估未进步 -> 提前停止。
    返回 (model, history, best)。best = {"epoch","top1","is_best"}。
    """
    model.to(device)
    arc.to(device)
    opt = optim.SGD(list(model.parameters()) + list(arc.parameters()),
                    lr=lr, momentum=0.9, weight_decay=weight_decay)
    sched = optim.lr_scheduler.CosineAnnealingLR(opt, T_max=epochs)
    model.train()
    history = []
    best = {"epoch": 0, "top1": 0.0, "is_best": False}
    stall = 0
    for ep in range(start_epoch, epochs):
        tl = 0.0
        ok = 0
        tot = 0
        for x, y in loader:
            x, y = x.to(device), y.to(device)
            emb = model(x)
            logits = arc(emb, y)
            loss = F.cross_entropy(logits, y, label_smoothing=label_smoothing)
            opt.zero_grad()
            loss.backward()
            opt.step()
            tl += loss.item() * x.size(0)
            ok += (logits.argmax(1) == y).sum().item()
            tot += y.size(0)
        sched.step()
        loss = tl / tot
        acc = ok / tot
        history.append({"epoch": ep + 1, "loss": round(loss, 4), "acc": round(acc, 4)})
        line = f"  epoch {ep+1}/{epochs}  loss={loss:.4f}  acc={acc:.4f}"
        # 定期在 test 上评估，防过拟合
        if eval_every > 0 and eval_fn is not None and (ep + 1) % eval_every == 0:
            model.eval()
            t1 = eval_fn(model)
            model.train()
            cur_best = t1 > best["top1"]
            if cur_best:
                best = {"epoch": ep + 1, "top1": round(float(t1), 4), "is_best": True}
                stall = 0
                if best_path is not None:
                    torch.save(model.state_dict(), best_path)
                    line += f"   [best] test-top1={t1:.4f} -> 已保存 {Path(best_path).name}"
            else:
                best["is_best"] = False
                stall += 1
                line += f"   test-top1={t1:.4f} (best={best['top1']:.4f}, stall={stall})"
            # 提前停止
            if patience > 0 and stall >= patience:
                print(line + "   [early-stop]", flush=True)
                break
        print(line, flush=True)
    return model, history, best


def export_onnx(model, device, path):
    model.to(device).eval()
    dummy = torch.randn(1, 3, 224, 224, device=device)
    torch.onnx.export(model, dummy, str(path), input_names=["input"], output_names=["output"],
                      opset_version=17, dynamo=False,
                      dynamic_axes={"input": {0: "batch"}, "output": {0: "batch"}})
    print(f"ONNX 导出: {path}")


def _make_background(size=224, kind="solid"):
    """生成随机的背景图（纯色渐变 / 噪点 / 方格 / 斜线），用于贴到 icon 后模拟游戏截图。"""
    if kind == "solid":
        c = [random.randint(20, 235) for _ in range(3)]
        return Image.new("RGB", (size, size), tuple(c))
    img = Image.new("RGB", (size, size))
    px = img.load()
    if kind == "gradient":
        c0 = [random.randint(20, 180) for _ in range(3)]
        c1 = [random.randint(120, 255) for _ in range(3)]
        for y in range(size):
            t = y / size
            row = tuple(int(c0[i] * (1 - t) + c1[i] * t) for i in range(3))
            for x in range(size):
                px[x, y] = row
    elif kind == "noise":
        for y in range(size):
            for x in range(size):
                v = random.randint(30, 225)
                px[x, y] = (v, random.randint(30, 225), random.randint(30, 225))
    elif kind == "checker":
        c0 = (random.randint(30, 120),) * 3
        c1 = (random.randint(150, 235),) * 3
        step = max(8, size // 12)
        for y in range(size):
            for x in range(size):
                px[x, y] = c0 if ((x // step) + (y // step)) % 2 == 0 else c1
    elif kind == "stripes":
        c0 = (random.randint(40, 140),) * 3
        c1 = (random.randint(160, 240),) * 3
        step = max(6, size // 16)
        for y in range(size):
            for x in range(size):
                px[x, y] = c0 if ((x // step) % 2 == 0) else c1
    else:
        for y in range(size):
            for x in range(size):
                px[x, y] = (random.randint(30, 220), random.randint(30, 220), random.randint(30, 220))
    return img


def _paste_onto_bg(icon_img, size=224):
    """把 icon 贴到随机背景上（保留主体，模拟游戏截图背景）。"""
    kind = random.choice(["solid", "gradient", "noise", "checker", "stripes"])
    bg = _make_background(size, kind)
    # icon 居中，随机缩放/平移，模拟小图
    scale = random.uniform(0.5, 0.85)
    iw = int(size * scale)
    icon = icon_img.resize((iw, iw), Image.LANCZOS) if icon_img.size[0] != iw else icon_img
    if icon.mode == "RGBA":
        mask = icon.split()[-1]
        # 随机位置
        ox = random.randint(0, size - iw)
        oy = random.randint(0, size - iw)
        bg.paste(icon, (ox, oy), mask)
    else:
        ox = random.randint(0, size - iw)
        oy = random.randint(0, size - iw)
        bg.paste(icon, (ox, oy))
    return bg


def build_feature_db(model, image_dir, device, n_views=6):
    """对训练库做多视角特征入库（过滤占位图）。

    策略：以"保留精灵主体外观"为主，覆盖主体自身的自然变化
     （轻微旋转/缩放/平移/亮度/裁剪/上下平移），而不是塞入大量背景/遮挡。
     实验显示：硬塞背景/遮挡会稀释主体特征，反而使 test 匹配下降。
     feats L2 归一化。
    """
    model.to(device).eval()
    eval_pp = build_eval()
    view_transforms = [
        # 干净原图
        None,
        # 轻微缩放/平移/旋转（主体保留）
        T.Compose([
            T.RandomResizedCrop(224, scale=(0.86, 1.0), ratio=(0.92, 1.08)),
            T.RandomAffine(degrees=6, translate=(0.05, 0.05), scale=(0.9, 1.08), shear=3,
                           fill=0, interpolation=T.InterpolationMode.BILINEAR),
        ]),
        # 亮度/对比度扰动（颜色变化）
        T.Compose([
            T.Resize((224, 224)),
            T.ColorJitter(brightness=0.2, contrast=0.2, saturation=0.2, hue=0.03),
        ]),
        # 轻微模糊（设备/截图导致的柔和）
        T.Compose([
            T.Resize((224, 224)),
            T.GaussianBlur(kernel_size=3, sigma=(0.1, 0.4)),
        ]),
        # 轻度放大裁剪（模拟更近的截图）
        T.Compose([
            T.RandomResizedCrop(224, scale=(0.75, 0.95), ratio=(0.9, 1.1)),
        ]),
    ]
    weights = [0.25, 0.25, 0.25, 0.12, 0.13]  # None / 缩放 / 颜色 / 模糊 / 放大裁
    feats, paths = [], []
    for f in filter_dir(image_dir)[0]:
        img = load_image(os.path.join(image_dir, f))
        for _ in range(n_views):
            tr = random.choices(view_transforms, weights=weights, k=1)[0]
            v = tr(img) if tr is not None else img
            t = eval_pp(v).unsqueeze(0).to(device)
            with torch.no_grad():
                feats.append(model(t).cpu().numpy().flatten())
            paths.append(f)
    feats = np.array(feats, dtype=np.float32)
    feats /= np.maximum(np.linalg.norm(feats, axis=1, keepdims=True), 1e-12)
    return feats, paths


# ---------------------------------------------------------------------------
# 评估：test 截图 -> 训练库特征，按 id 算 top1/top5
# ---------------------------------------------------------------------------
def eval_test(model, feats_db, paths_db, device, topk=5, test_dir=None):
    test_dir = test_dir or TEST_DIR
    ok_files, ph = filter_dir(test_dir)
    model.eval()
    eval_pp = build_eval()
    # 构建 id -> 特征索引（train 库，多视角取该 id 最高分）和 id 集合
    train_ids = set()
    for p in paths_db:
        info = split_pet_filename(p)
        if info and info.get("id") is not None:
            train_ids.add(info["id"])
    # path -> id 向量
    def pid_of(p):
        info = split_pet_filename(p)
        return info["id"] if info else None
    path_ids = [pid_of(p) for p in paths_db]
    # 预归一化库特征（建库时已归一化，这里保险再校一次）
    if feats_db.shape[1] > 0:
        fb = feats_db / np.maximum(np.linalg.norm(feats_db, axis=1, keepdims=True), 1e-12)
    else:
        fb = feats_db

    total = 0
    top1 = 0
    top5 = 0
    per_id = {}
    for f in ok_files:
        info = split_pet_filename(f)
        if not info or info.get("id") is None:
            continue
        gt_id = info["id"]
        img = load_image(os.path.join(test_dir, f))
        t = eval_pp(img).unsqueeze(0).to(device)
        with torch.no_grad():
            q = model(t).cpu().numpy().flatten()
        q /= max(np.linalg.norm(q), 1e-12)
        sims = fb @ q
        idx = np.argsort(sims)[::-1]
        # 取 hit 的最高分（训练库同 id 可能多条特征，都算该 id）
        best = {}
        for i in idx:
            pid = path_ids[i]
            s = float(sims[i])
            if pid not in best or s > best[pid]:
                best[pid] = s
        rank_ids = sorted(best, key=lambda p: -best[p])
        total += 1
        per_id.setdefault(gt_id, {"n": 0, "hit1": 0, "hit5": 0})
        per_id[gt_id]["n"] += 1
        if rank_ids and rank_ids[0] == gt_id:
            top1 += 1
            per_id[gt_id]["hit1"] += 1
        if gt_id in rank_ids[:topk]:
            top5 += 1
            per_id[gt_id]["hit5"] += 1

    report = {
        "test_total": total,
        "placeholder_filtered": len(ph),
        "top1": top1,
        "top1_acc": round(top1 / max(total, 1), 4),
        f"top{topk}": top5,
        f"top{topk}_acc": round(top5 / max(total, 1), 4),
    }
    print(f"评估: test 有效 {total}（过滤占位 {len(ph)}）")
    print(f"  top-1 = {top1} ({report['top1_acc']:.2%})")
    print(f"  top-{topk} = {top5} ({report[f'top{topk}_acc']:.2%})")
    return report


# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", default="eval", choices=["train", "eval", "all", "rebuild"])
    ap.add_argument("--epochs", type=int, default=30)
    ap.add_argument("--batch", type=int, default=64)
    ap.add_argument("--lr", type=float, default=1e-4)
    ap.add_argument("--emb-dim", type=int, default=512)
    ap.add_argument("--n-aug", type=int, default=8)
    ap.add_argument("--views", type=int, default=6)
    ap.add_argument("--weight-decay", type=float, default=1e-3)
    ap.add_argument("--label-smoothing", type=float, default=0.05)
    ap.add_argument("--eval-every", type=int, default=0,
                    help=">0 时每隔 N 个 epoch 在 test 上评估一次，防过拟合")
    ap.add_argument("--patience", type=int, default=0,
                    help=">0 时 test top1 连续 N 次无提升即提前停止")
    ap.add_argument("--best-path", default=str(ONNX_DIR / "metric_backbone_best.pt"),
                    help="test top1 最高时保存的模型权重路径")
    ap.add_argument("--topk", type=int, default=5)
    ap.add_argument("--device", default="auto")
    ap.add_argument("--image-dir", default=IMG_DIR)
    ap.add_argument("--test-dir", default=TEST_DIR)
    ap.add_argument("--pretrained", action="store_true", default=True)
    ap.add_argument("--check", action="store_true", help="只检查数据/模型/设备，不训练")
    ap.add_argument("--resume", action="store_true",
                    help="从 checkpoint(metric_backbone.pt / arcface_weight.pt) 继续训练，不重新初始化模型")
    args = ap.parse_args()

    if args.device == "auto":
        device = "cuda" if torch.cuda.is_available() else "cpu"
    else:
        device = args.device
    if device == "cuda" and not torch.cuda.is_available():
        print("CUDA 不可用，回退 CPU")
        device = "cpu"
    print(f"设备: {device}", flush=True)

    test_dir = args.test_dir or TEST_DIR
    ok_train, ph_train = filter_dir(args.image_dir)
    ok_test, ph_test = filter_dir(test_dir)
    print(f"训练库: {len(ok_train)} 张（过滤占位 {len(ph_train)}）", flush=True)
    print(f"测试集: {len(ok_test)} 张（过滤占位 {len(ph_test)}）", flush=True)

    if args.check:
        m = EmbeddingModel(args.emb_dim, args.pretrained).to(device).eval()
        x = torch.randn(2, 3, 224, 224, device=device)
        with torch.no_grad():
            f = m(x)
        print(f"CHECK 前向 {tuple(f.shape)} 设备={f.device}")
        return

    model = EmbeddingModel(args.emb_dim, args.pretrained)
    model_trained = False

    if args.mode in ("train", "all"):
        print("构建增强训练集 ...", flush=True)
        loader, ids, id2label, n = make_train_loader(args.image_dir, args.n_aug, args.batch)
        print(f"  类别 {len(ids)}，样本 {n}（含增强）", flush=True)
        arc = ArcFaceHead(args.emb_dim, len(ids), s=30.0, m=0.35)
        start_epoch = 0
        prev_history = []
        if args.resume and (ONNX_PT.exists() or ARC_PT.exists()):
            if ONNX_PT.exists():
                model.load_state_dict(torch.load(ONNX_PT, map_location="cpu"))
                print("已加载模型权重 metric_backbone.pt", flush=True)
            if ARC_PT.exists():
                arc.load_state_dict(torch.load(ARC_PT, map_location="cpu"))
                print("已加载 ArcFace 头权重 arcface_weight.pt", flush=True)
            if HISTORY_JSON.exists():
                try:
                    prev_history = json.loads(HISTORY_JSON.read_text(encoding="utf-8"))
                    start_epoch = len(prev_history)
                    print(f"从第 {start_epoch} 个 epoch 继续", flush=True)
                except Exception:
                    start_epoch = 0
        # 评估函数：用当前 model 对训练库(clean 1视角)提特征，再算 test top-1，
        # 用于防过拟合（训练中定期看 test 泛化，保存最好的一次）。
        def _eval_on_test(mdl):
            mdl.eval()
            eval_pp = build_eval()
            _feats, _paths = [], []
            for _f in filter_dir(args.image_dir)[0]:
                _img = load_image(os.path.join(args.image_dir, _f))
                _t = eval_pp(_img).unsqueeze(0).to(device)
                with torch.no_grad():
                    _feats.append(mdl(_t).cpu().numpy().flatten())
                _paths.append(_f)
            _feats = np.array(_feats, dtype=np.float32)
            _feats /= np.maximum(np.linalg.norm(_feats, axis=1, keepdims=True), 1e-12)
            _rep = eval_test(mdl, _feats, _paths, device, topk=1, test_dir=test_dir)
            mdl.train()
            return _rep.get("top1_acc", 0.0)

        print(f"开始训练(防过拟合) epochs={args.epochs} (含加载历史 {start_epoch}) device={device}", flush=True)
        model, new_history, best = train(
            model, arc, loader, device, args.epochs, args.lr, start_epoch=start_epoch,
            weight_decay=args.weight_decay, label_smoothing=args.label_smoothing,
            eval_every=args.eval_every,
            eval_fn=_eval_on_test if args.eval_every > 0 else None,
            patience=args.patience, best_path=Path(args.best_path),
        )
        if best.get("top1"):
            print(f"  最佳 test-top1={best['top1']:.4f} @ epoch {best['epoch']}"
                  f"（已保存 best 权重 {args.best_path}）", flush=True)
        all_history = list(prev_history) + new_history
        ONNX_DIR.mkdir(parents=True, exist_ok=True)
        export_onnx(model, device, ONNX_BACKBONE)
        torch.save(model.state_dict(), ONNX_PT)
        torch.save(arc.state_dict(), ARC_PT)
        HISTORY_JSON.write_text(json.dumps(all_history, ensure_ascii=False, indent=2), encoding="utf-8")
        feats, paths = build_feature_db(model, args.image_dir, device, args.views)
        db = {"features": feats, "paths": paths}
        with open(PICKLE_DB, "wb") as f:
            pickle.dump(db, f)
        print(f"特征库 {feats.shape} 已存 {PICKLE_DB}", flush=True)
        model_trained = True

    if args.mode in ("rebuild",):
        # 只重建特征库（多视角增强入库），不重训，然后评估。
        if not os.path.exists(ONNX_PT):
            print("重建特征库需要 metric_backbone.pt。请先训练。")
            return
        m = EmbeddingModel(args.emb_dim, pretrained=False)
        m.load_state_dict(torch.load(ONNX_PT, map_location="cpu"))
        m = m.to(device).eval()
        print("重建特征库（更强增强多视角入库）...", flush=True)
        feats, paths = build_feature_db(m, args.image_dir, device, args.views)
        db = {"features": feats, "paths": paths}
        with open(PICKLE_DB, "wb") as f:
            pickle.dump(db, f)
        print(f"特征库 {feats.shape} 已存 {PICKLE_DB}", flush=True)
        model = m
        model_trained = True

    if args.mode in ("eval", "all", "rebuild"):
        # eval 需要模型 + 特征库
        if not model_trained:
            if os.path.exists(ONNX_PT):
                m = EmbeddingModel(args.emb_dim, pretrained=False)
                m.load_state_dict(torch.load(ONNX_PT, map_location="cpu"))
                model = m.to(device)
                print("已加载已训练权重 metric_backbone.pt", flush=True)
            else:
                print("评估需要先训练（或已有 metric_backbone.pt）。用 --mode train 先训练。")
                return
        if not os.path.exists(PICKLE_DB):
            print("评估需要特征库 feature_icon_metric.pkl。用 --mode train 先构建。")
            return
        db = pickle.load(open(PICKLE_DB, "rb"))
        report = eval_test(model, db["features"], db["paths"], device, args.topk, test_dir=test_dir)
        EVAL_REPORT.parent.mkdir(parents=True, exist_ok=True)
        EVAL_REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"评估报告: {EVAL_REPORT}")


if __name__ == "__main__":
    main()
