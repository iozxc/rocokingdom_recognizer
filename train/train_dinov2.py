#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""DINOv2 版 icon 度量学习训练 + 评估。

与 ResNet50 版(train_metric_gpu.py)的区别：
  - backbone: DINOv2 ViT-S/14（timm，本地权重 assets/dino/...），对卡通/细粒度更强；
  - 输入尺寸: 518x518（DINOv2 要求，非 224）；
  - 特征: cls token -> 384 维 -> 映射成 512 维 -> L2 -> ArcFace；
  - 其余（数据增强/多视角入库/防过拟合/评估）流程复用。

依赖：GPU 环境已装 timm；本地权重 assets/dino/vit_small_patch14_dinov2.safetensors。

用法（耗时训练请你自己主动跑）：
  # 先检查
  python train/train_dinov2.py --check --device cuda
  # 训练 + 导出 + 评估（带防过拟合）
  python train/train_dinov2.py --mode all --epochs 60 --device cuda --eval-every 5 --patience 4 --views 8
  # 只重建特征库
  python train/train_dinov2.py --mode rebuild --device cuda --views 8
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
import torch.optim as optim
import torchvision.transforms as T
from PIL import Image

import timm
from tqdm import tqdm

from core.infra.pet_path import split_pet_filename, sort_key


DINO_CKPT = str(PROJECT_ROOT / "assets" / "dino" / "vit_small_patch14_dinov2.safetensors")
DINO_IMG_SIZE = 518

IMG_DIR = str(PROJECT_ROOT / "train" / "dataset" / "image")
TEST_DIR = str(PROJECT_ROOT / "train" / "dataset" / "test")
ONNX_DIR = PROJECT_ROOT / "train" / "onnx_dino"
ONNX_BACKBONE = ONNX_DIR / "dino_backbone.onnx"
ONNX_PT = ONNX_DIR / "dino_backbone.pt"
ARC_PT = ONNX_DIR / "arcface_weight.pt"
PICKLE_DB = ONNX_DIR / "feature_icon_dino.pkl"
EVAL_REPORT = ONNX_DIR / "dino_eval_report.json"
HISTORY_JSON = ONNX_DIR / "dino_train_history.json"
BEST_PT = ONNX_DIR / "dino_backbone_best.pt"
AUG_CACHE = ONNX_DIR / "dino_train_aug_cache.pt"   # 持久化的增强训练集


# ---------------------------------------------------------------------------
# 占位图过滤（复用原逻辑）
# ---------------------------------------------------------------------------
def is_placeholder_image(img):
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
    for x in range(0, w, max(1, w // 12)):
        for y in range(0, h, max(1, h // 12)):
            p = px[x, y]
            n += 1
            if p[0] < 40 and p[1] < 40 and p[2] < 40:
                dark += 1
    dark_ratio = dark / max(n, 1)
    return dark_corners >= 2 and white_center and dark_ratio > 0.4


def filter_dir(image_dir):
    all_files = sorted(
        (f for f in os.listdir(image_dir) if f.lower().endswith((".png", ".jpg", ".jpeg"))),
        key=sort_key,
    )
    ok, ph = [], []
    for f in all_files:
        try:
            if is_placeholder_image(Image.open(os.path.join(image_dir, f))):
                ph.append(f)
            else:
                ok.append(f)
        except Exception:
            ph.append(f)
    return ok, ph


def load_image(path, pad_white=True):
    img = Image.open(path).convert("RGB")
    if pad_white and (img.mode == "RGBA" or "A" in img.getbands()):
        bg = Image.new("RGB", img.size, (255, 255, 255))
        bg.paste(img, mask=img.split()[-1] if img.mode == "RGBA" else None)
        img = bg
    return img


# DINOv2 需要 518 输入 + 自己的一套归一化
def build_train_aug():
    return T.Compose([
        T.RandomResizedCrop(DINO_IMG_SIZE, scale=(0.85, 1.0), ratio=(0.9, 1.1)),
        T.RandomAffine(degrees=8, translate=(0.06, 0.06), scale=(0.9, 1.1), shear=3,
                       fill=0, interpolation=T.InterpolationMode.BILINEAR),
        T.ColorJitter(brightness=0.25, contrast=0.25, saturation=0.2, hue=0.05),
        T.RandomGrayscale(p=0.05),
        T.GaussianBlur(kernel_size=3, sigma=(0.1, 0.5)),
    ])


def build_eval():
    return T.Compose([
        T.Resize((DINO_IMG_SIZE, DINO_IMG_SIZE)),
        T.ToTensor(),
        T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
    ])


def make_train_loader(image_dir, n_aug=8, batch_size=32, cache_path=None,
                      rebuild=False):
    """构建增强训练集，并缓存到磁盘（下次直接加载）。

    缓存内容：{imgs: (N,3,H,W) float, labels: (N,), ids: [..], id2label: {..}}
    rebuild=True 或缓存缺失/参数改变时重新生成。
    """
    cache_path = cache_path or AUG_CACHE
    # 缓存是否可用：cache 存在 且 未强制重建
    if cache_path and Path(cache_path).exists() and not rebuild:
        try:
            c = torch.load(cache_path, map_location="cpu")
            if c.get("imgs") is not None:
                imgs = c["imgs"]
                labs = torch.tensor(c["labels"], dtype=torch.long)
                ids = list(c["ids"])
                id2label = c["id2label"]
                ds = torch.utils.data.TensorDataset(c["imgs"], labs)
                loader = torch.utils.data.DataLoader(ds, batch_size=batch_size, shuffle=True)
                print(f"已从缓存加载增强训练集: {cache_path}（{len(labs)} 样本, 跳过构建）", flush=True)
                return loader, ids, id2label, len(labs)
        except Exception as e:
            print(f"缓存加载失败，重新构建: {e}", flush=True)

    print("构建增强训练集（首次，将缓存到磁盘）...", flush=True)
    dataset = {}
    for f in filter_dir(image_dir)[0]:
        info = split_pet_filename(f)
        if info and info.get("id") is not None:
            dataset.setdefault(info["id"], []).append(os.path.join(image_dir, f))
    ids = sorted(dataset.keys())
    id2label = {pid: i for i, pid in enumerate(ids)}
    aug = build_train_aug()
    to_t = T.Compose([
        T.ToTensor(),
        T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        T.RandomErasing(p=0.15, scale=(0.02, 0.08), ratio=(0.6, 1.6), value=(0, 0, 0)),
    ])
    images, labels = [], []
    for pbar_pid in tqdm(ids, desc="增强视角", unit="id", ncols=100):
        for p in dataset[pbar_pid]:
            img = load_image(p)
            for _ in range(n_aug):
                images.append(to_t(aug(img)))
                labels.append(id2label[pbar_pid])
    imgs = torch.stack(images)
    labs = torch.tensor(labels, dtype=torch.long)
    # 存缓存
    if cache_path:
        Path(cache_path).parent.mkdir(parents=True, exist_ok=True)
        torch.save({"imgs": imgs.cpu(), "labels": labs.cpu(), "ids": ids, "id2label": id2label},
                   cache_path)
        print(f"增强训练集已缓存: {cache_path}（{len(labs)} 样本）", flush=True)
    ds = torch.utils.data.TensorDataset(imgs, labs)
    return torch.utils.data.DataLoader(ds, batch_size=batch_size, shuffle=True), ids, id2label, len(labs)


# ---------------------------------------------------------------------------
# 模型：DINOv2 backbone -> cls token(384) -> 512 -> L2 -> ArcFace
# ---------------------------------------------------------------------------
class DinoEmbedding(nn.Module):
    def __init__(self, emb_dim=512, pretrained=True, freeze_backbone=False):
        super().__init__()
        self.backbone = timm.create_model(
            "vit_small_patch14_dinov2.lvd142m",
            pretrained=False,
            num_classes=0,
            checkpoint_path=DINO_CKPT if (pretrained and os.path.exists(DINO_CKPT)) else None,
        )
        self.backbone.eval()
        for p in self.backbone.parameters():
            p.requires_grad = not freeze_backbone
        in_dim = self.backbone.embed_dim  # 384
        self.proj = nn.Sequential(
            nn.Linear(in_dim, emb_dim),
            nn.BatchNorm1d(emb_dim),
        )

    def forward(self, x):
        f = self.backbone.forward_features(x)  # (B, N, D)
        cls = f[:, 0, :]                       # (B, D)
        e = self.proj(cls)                     # (B, emb_dim)
        return F.normalize(e, p=2, dim=1)


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
# 训练（防过拟合版，与 ResNet50 版一致）
# ---------------------------------------------------------------------------
def train(model, arc, loader, device, epochs, lr, start_epoch=0,
          weight_decay=1e-3, label_smoothing=0.05,
          eval_every=0, eval_fn=None, patience=0, best_path=None):
    model.to(device)
    arc.to(device)
    trainable = [p for p in model.parameters() if p.requires_grad]
    opt = optim.SGD(trainable + list(arc.parameters()),
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
        pbar = tqdm(loader, desc=f"Epoch {ep+1}/{epochs}", unit="batch", ncols=100,
                    leave=True)
        for x, y in pbar:
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
            pbar.set_postfix(loss=f"{tl/tot:.4f}", acc=f"{ok/tot:.4f}")
        sched.step()
        loss = tl / tot
        acc = ok / tot
        history.append({"epoch": ep + 1, "loss": round(loss, 4), "acc": round(acc, 4)})
        line = f"  epoch {ep+1}/{epochs}  loss={loss:.4f}  acc={acc:.4f}"
        if eval_every > 0 and eval_fn is not None and (ep + 1) % eval_every == 0:
            model.eval()
            t1 = eval_fn(model)
            model.train()
            if t1 > best["top1"]:
                best = {"epoch": ep + 1, "top1": round(float(t1), 4), "is_best": True}
                stall = 0
                if best_path is not None:
                    torch.save(model.state_dict(), best_path)
                    line += f"   [best] test-top1={t1:.4f} -> 已保存 {Path(best_path).name}"
            else:
                best["is_best"] = False
                stall += 1
                line += f"   test-top1={t1:.4f} (best={best['top1']:.4f}, stall={stall})"
            if patience > 0 and stall >= patience:
                print(line + "   [early-stop]", flush=True)
                break
        print(line, flush=True)
    return model, history, best


def export_onnx(model, device, path):
    model.to(device).eval()
    dummy = torch.randn(1, 3, DINO_IMG_SIZE, DINO_IMG_SIZE, device=device)
    torch.onnx.export(model, dummy, str(path), input_names=["input"], output_names=["output"],
                      opset_version=17, dynamo=False,
                      dynamic_axes={"input": {0: "batch"}, "output": {0: "batch"}})
    print(f"ONNX 导出: {path}")


def build_feature_db(model, image_dir, device, n_views=6):
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
    for f in filter_dir(image_dir)[0]:
        img = load_image(os.path.join(image_dir, f))
        for _ in range(n_views):
            tr = random.choices(views, weights=weights, k=1)[0]
            v = tr(img) if tr is not None else img
            t = eval_pp(v).unsqueeze(0).to(device)
            with torch.no_grad():
                feats.append(model(t).cpu().numpy().flatten())
            paths.append(f)
    feats = np.array(feats, dtype=np.float32)
    feats /= np.maximum(np.linalg.norm(feats, axis=1, keepdims=True), 1e-12)
    return feats, paths


def eval_test(model, feats_db, paths_db, device, topk=5, test_dir=None):
    test_dir = test_dir or TEST_DIR
    ok_files, ph = filter_dir(test_dir)
    model.eval()
    eval_pp = build_eval()
    path_ids = []
    for p in paths_db:
        info = split_pet_filename(p)
        path_ids.append(info["id"] if info else None)
    fb = feats_db / np.maximum(np.linalg.norm(feats_db, axis=1, keepdims=True), 1e-12)
    total = top1 = top5 = 0
    for f in ok_files:
        info = split_pet_filename(f)
        if not info or info.get("id") is None:
            continue
        gt = info["id"]
        img = load_image(os.path.join(test_dir, f))
        t = eval_pp(img).unsqueeze(0).to(device)
        with torch.no_grad():
            q = model(t).cpu().numpy().flatten()
        q /= max(np.linalg.norm(q), 1e-12)
        sims = fb @ q
        order = np.argsort(sims)[::-1]
        best = {}
        for i in order:
            pid0 = path_ids[i]
            s = float(sims[i])
            if pid0 not in best or s > best[pid0]:
                best[pid0] = s
        ranks = sorted(best, key=lambda p: -best[p])
        total += 1
        if ranks and ranks[0] == gt:
            top1 += 1
        if gt in ranks[:topk]:
            top5 += 1
    report = {"test_total": total, "placeholder_filtered": len(ph),
              "top1": top1, "top1_acc": round(top1 / max(total, 1), 4),
              f"top{topk}": top5, f"top{topk}_acc": round(top5 / max(total, 1), 4)}
    print(f"评估: test 有效 {total}（过滤占位 {len(ph)}）")
    print(f"  top-1 = {top1} ({report['top1_acc']:.2%})")
    print(f"  top-{topk} = {top5} ({report[f'top{topk}_acc']:.2%})")
    return report


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", default="eval", choices=["train", "eval", "all", "rebuild", "check"])
    ap.add_argument("--epochs", type=int, default=40)
    ap.add_argument("--batch", type=int, default=8)
    ap.add_argument("--lr", type=float, default=1e-4)
    ap.add_argument("--emb-dim", type=int, default=512)
    ap.add_argument("--n-aug", type=int, default=8)
    ap.add_argument("--views", type=int, default=8)
    ap.add_argument("--weight-decay", type=float, default=1e-3)
    ap.add_argument("--label-smoothing", type=float, default=0.05)
    ap.add_argument("--eval-every", type=int, default=0)
    ap.add_argument("--patience", type=int, default=0)
    ap.add_argument("--topk", type=int, default=5)
    ap.add_argument("--device", default="auto")
    ap.add_argument("--image-dir", default=IMG_DIR)
    ap.add_argument("--test-dir", default=TEST_DIR)
    ap.add_argument("--resume", action="store_true",
                    help="从 checkpoint(dino_backbone.pt) 继续训练")
    ap.add_argument("--rebuild-cache", action="store_true",
                    help="强制重建增强训练集缓存（默认用已有缓存）")
    ap.add_argument("--freeze-backbone", action="store_true",
                    help="冻结 DINOv2 backbone，只训投影层+ArcFace头（轻量微调，快、省显存）")
    args = ap.parse_args()

    if args.device == "auto":
        device = "cuda" if torch.cuda.is_available() else "cpu"
    else:
        device = args.device
    if device == "cuda" and not torch.cuda.is_available():
        device = "cpu"
    print(f"设备: {device}", flush=True)

    test_dir = args.test_dir or TEST_DIR
    ok_train, ph_train = filter_dir(args.image_dir)
    ok_test, ph_test = filter_dir(test_dir)
    print(f"训练库: {len(ok_train)} 张（过滤占位 {len(ph_train)}）", flush=True)
    print(f"测试集: {len(ok_test)} 张（过滤占位 {len(ph_test)}）", flush=True)

    if args.mode == "check":
        m = DinoEmbedding(args.emb_dim, pretrained=True).to(device).eval()
        x = torch.randn(1, 3, DINO_IMG_SIZE, DINO_IMG_SIZE, device=device)
        with torch.no_grad():
            f = m(x)
        print(f"CHECK 前向 {tuple(f.shape)} 设备={f.device}", flush=True)
        return

    model = DinoEmbedding(args.emb_dim, pretrained=True, freeze_backbone=args.freeze_backbone)
    model_trained = False

    if args.mode in ("train", "all"):
        print("构建增强训练集 ...", flush=True)
        loader, ids, id2label, n = make_train_loader(
            args.image_dir, args.n_aug, args.batch, cache_path=AUG_CACHE, rebuild=args.rebuild_cache)
        print(f"  类别 {len(ids)}，样本 {n}（含增强）", flush=True)
        arc = ArcFaceHead(args.emb_dim, len(ids), s=30.0, m=0.35)
        start_epoch = 0
        prev_history = []
        if args.resume and ONNX_PT.exists():
            model.load_state_dict(torch.load(ONNX_PT, map_location="cpu"))
            print("已加载 DINO backbone 权重", flush=True)
        if HISTORY_JSON.exists():
            try:
                prev_history = json.loads(HISTORY_JSON.read_text(encoding="utf-8"))
                start_epoch = len(prev_history)
            except Exception:
                start_epoch = 0

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
            eval_every=args.eval_every, eval_fn=_eval_on_test if args.eval_every > 0 else None,
            patience=args.patience, best_path=BEST_PT,
        )
        if best.get("top1"):
            print(f"  最佳 test-top1={best['top1']:.4f} @ epoch {best['epoch']}", flush=True)
        ONNX_DIR.mkdir(parents=True, exist_ok=True)
        export_onnx(model, device, ONNX_BACKBONE)
        torch.save(model.state_dict(), ONNX_PT)
        torch.save(arc.state_dict(), ARC_PT)
        (ONNX_DIR / "dino_train_history.json").write_text(
            json.dumps(list(prev_history) + new_history, ensure_ascii=False, indent=2), encoding="utf-8")
        feats, paths = build_feature_db(model, args.image_dir, device, args.views)
        db = {"features": feats, "paths": paths}
        pickle.dump(db, open(PICKLE_DB, "wb"))
        print(f"特征库 {feats.shape} 已存 {PICKLE_DB}", flush=True)
        model_trained = True

    if args.mode == "rebuild":
        m = DinoEmbedding(args.emb_dim, pretrained=False)
        m.load_state_dict(torch.load(ONNX_PT, map_location="cpu"))
        m = m.to(device).eval()
        print("重建 DINO 特征库（多视角）...", flush=True)
        feats, paths = build_feature_db(m, args.image_dir, device, args.views)
        pickle.dump({"features": feats, "paths": paths}, open(PICKLE_DB, "wb"))
        print(f"特征库 {feats.shape} 已存 {PICKLE_DB}", flush=True)
        model = m
        model_trained = True

    if args.mode in ("eval", "all", "rebuild"):
        if not model_trained:
            if ONNX_PT.exists():
                m = DinoEmbedding(args.emb_dim, pretrained=False)
                m.load_state_dict(torch.load(ONNX_PT, map_location="cpu"))
                model = m.to(device)
            else:
                print("评估需要已训练的 DINO backbone")
                return
        db = pickle.load(open(PICKLE_DB, "rb"))
        report = eval_test(model, db["features"], db["paths"], device, args.topk, test_dir=test_dir)
        EVAL_REPORT.parent.mkdir(parents=True, exist_ok=True)
        EVAL_REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"评估报告: {EVAL_REPORT}")


if __name__ == "__main__":
    main()
