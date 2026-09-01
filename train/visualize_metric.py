#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""训练/评估结果可视化（纯 numpy + PIL，无需 matplotlib/sklearn）。

生成 4 张图到 train/onnx/viz/：
  1) train_curve.png      每 epoch loss / acc 曲线（读 metric_train_history.json）
  2) eval_topk.png         test top-1 / top-5 柱状（读 metric_eval_report.json）
  3) feature_pca.png       训练库特征 PCA 降维散点（同类同色，看聚拢程度）
  4) match_samples.png     随机抽 test 图，显示训练库 top-3 候选 + 分数（标红对错）

用法（GPU 环境）：
  python train/visualize_metric.py
  python train/visualize_metric.py --samples 8 --pca-n 300
"""

import argparse
import json
import os
import random
import sys
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
from PIL import Image, ImageDraw, ImageFont

from core.infra.pet_path import split_pet_filename

ONNX_DIR = PROJECT_ROOT / "train" / "onnx"
VIZ_DIR = ONNX_DIR / "viz"
HISTORY_JSON = ONNX_DIR / "metric_train_history.json"
EVAL_REPORT = ONNX_DIR / "metric_eval_report.json"
PICKLE_DB = ONNX_DIR / "feature_icon_metric.pkl"
TEST_DIR = PROJECT_ROOT / "train" / "dataset" / "test"


def _font(size=12):
    for p in [r"C:\Windows\Fonts\msyh.ttc", r"C:\Windows\Fonts\simhei.ttf", r"C:\Windows\Fonts\arial.ttf"]:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return ImageFont.load_default()


def draw_text(d, xy, text, fill=(0, 0, 0), size=12):
    d.text(xy, str(text), fill=fill, font=_font(size))


def plot_curve(history, out_path):
    if not history:
        print("无训练历史，跳过 train_curve")
        return
    W, H = 900, 420
    img = Image.new("RGB", (W, H), (255, 255, 255))
    d = ImageDraw.Draw(img)
    draw_text(d, (20, 12), "Training Loss / Acc", size=16)
    epochs = [h["epoch"] for h in history]
    losses = [h["loss"] for h in history]
    accs = [h["acc"] for h in history]
    # 双 y 轴：loss 左，acc 右
    pad_l, pad_r, pad_t, pad_b = 60, 60, 40, 40
    plot_w = W - pad_l - pad_r
    plot_h = H - pad_t - pad_b
    max_loss = max(losses) if losses else 1
    # loss 轴刻度
    for i in range(6):
        y = pad_t + plot_h * (1 - i / 5)
        d.line([(pad_l, y), (W - pad_r, y)], fill=(230, 230, 230))
        draw_text(d, (pad_l - 40, y - 6), f"{max_loss * i / 5:.1f}", size=10)
    # 折线
    def px(e): return pad_l + plot_w * (e - 1) / max(len(epochs) - 1, 1)
    def py(v, lo, hi): return pad_t + plot_h * (1 - (v - lo) / max(hi - lo, 1e-6))
    lo_l, hi_l = min(losses), max(losses)
    d.line([(px(e), py(v, lo_l, hi_l)) for e, v in zip(epochs, losses)], fill=(220, 60, 60), width=2)
    d.line([(px(e), py(v, 0, 1)) for e, v in zip(epochs, accs)], fill=(60, 120, 220), width=2)
    draw_text(d, (pad_l + 4, pad_t + 4), "loss(红)", fill=(220, 60, 60), size=12)
    draw_text(d, (pad_l + 4, pad_t + 22), "acc(蓝)", fill=(60, 120, 220), size=12)
    img.save(out_path)
    print(f"曲线图: {out_path}")


def plot_eval(report, out_path):
    top1 = round(report.get("top1_acc", 0) * 100, 1)
    top5 = round(report.get("top5_acc", 0) * 100, 1)
    W, H = 520, 360
    img = Image.new("RGB", (W, H), (255, 255, 255))
    d = ImageDraw.Draw(img)
    draw_text(d, (20, 12), "Test Top-k Accuracy", size=16)
    labels = ["Top-1", "Top-5"]
    vals = [top1, top5]
    colors = [(220, 60, 60), (60, 120, 220)]
    base_x, base_y = 90, 250
    bar_w = 120
    for i, (lb, v, c) in enumerate(zip(labels, vals, colors)):
        x = base_x + i * 180
        h = int(200 * v / 100)
        d.rectangle([x, base_y - h, x + bar_w, base_y], fill=c)
        draw_text(d, (x, base_y + 10), f"{lb}: {v}%", size=14)
        draw_text(d, (x, base_y - h - 20), f"{v}%", fill=c, size=14)
    draw_text(d, (20, base_y + 40),
              f"test 有效 {report.get('test_total')}，过滤占位 {report.get('placeholder_filtered')}", size=12)
    img.save(out_path)
    print(f"评估图: {out_path}")


def pca_2d(feats, n_components=2):
    """numpy 实现 PCA，返回 (投影后 Nx2, 解释方差)。"""
    X = feats - feats.mean(axis=0)
    U, S, Vt = np.linalg.svd(X, full_matrices=False)
    comp = X @ Vt[:n_components].T
    return comp, S


def plot_pca(db, out_path, max_points=3000):
    feats = db["features"]
    paths = db["paths"]
    # 每个 id 只取一条特征避免过多点
    seen = {}
    for f, p in zip(feats, paths):
        info = split_pet_filename(p)
        pid = info["id"] if info else None
        if pid is None:
            continue
        seen.setdefault(pid, f)
    ids = list(seen.keys())[:max_points]
    arr = np.array([seen[i] for i in ids])
    if arr.shape[0] < 3:
        print("样本太少，跳过 PCA")
        return
    comp, _ = pca_2d(arr)
    comp = comp / max(np.abs(comp).max(), 1e-6)
    W, H = 700, 700
    img = Image.new("RGB", (W, H), (255, 255, 255))
    d = ImageDraw.Draw(img)
    draw_text(d, (16, 10), "Feature PCA (same id = one dot, color by id)", size=13)
    # 用 id 做颜色（hsv 环）
    import colorsys
    for i, pid in enumerate(ids):
        x = 30 + (comp[i, 0] * 0.5 + 0.5) * (W - 60)
        y = 30 + (comp[i, 1] * 0.5 + 0.5) * (H - 60)
        r, g, b = colorsys.hsv_to_rgb((pid % 360) / 360, 0.9, 0.9)
        d.ellipse([x - 2, y - 2, x + 2, y + 2], fill=(int(r * 255), int(g * 255), int(b * 255)))
    img.save(out_path)
    print(f"PCA 图: {out_path}  (点数 {len(ids)})")


def plot_samples_need_db(img_dir, db, out_path, n_samples=8, topk=3, device="cpu"):
    import torch
    # 加载模型
    from train_metric_gpu import EmbeddingModel, build_eval
    from train_metric_gpu import is_placeholder_image, load_image
    pt = ONNX_DIR / "metric_backbone.pt"
    if not pt.exists():
        print("缺少 metric_backbone.pt，跳过匹配示例")
        return
    model = EmbeddingModel(512, pretrained=False)
    model.load_state_dict(torch.load(pt, map_location=device))
    model = model.to(device).eval()
    eval_pp = build_eval()
    feats = db["features"]
    paths = db["paths"]
    fb = feats / np.maximum(np.linalg.norm(feats, axis=1, keepdims=True), 1e-12)
    ok_files = []
    for f in os.listdir(img_dir):
        if not f.lower().endswith(".png"):
            continue
        try:
            if is_placeholder_image(Image.open(os.path.join(img_dir, f))):
                continue
        except Exception:
            continue
        ok_files.append(f)
    random.seed(3)
    sample = random.sample(ok_files, min(n_samples, len(ok_files)))
    cell = 130
    W = cell * (topk + 1)
    H = cell * len(sample)
    canvas = Image.new("RGB", (W, H), (245, 245, 245))
    d = ImageDraw.Draw(canvas)
    for r, f in enumerate(sample):
        info = split_pet_filename(f)
        gt = info["id"] if info else None
        # 原图
        orig = Image.open(os.path.join(img_dir, f)).convert("RGB")
        orig = orig.resize((cell - 8, cell - 8))
        canvas.paste(orig, (4, r * cell + 4))
        draw_text(d, (4, r * cell + cell - 20), f"{f[:10]}", size=9)
        # 特征匹配
        t = eval_pp(orig).unsqueeze(0).to(device)
        with torch.no_grad():
            q = model(t).cpu().numpy().flatten()
        q /= max(np.linalg.norm(q), 1e-12)
        sims = fb @ q
        idx = np.argsort(sims)[::-1][:topk]
        best = {}
        # 去重 id
        cands = []
        for i in idx:
            p = paths[i]
            pid0 = split_pet_filename(p)["id"]
            if pid0 in best:
                continue
            best[pid0] = float(sims[i])
            cands.append((pid0, p, float(sims[i])))
            if len(cands) >= topk:
                break
        for c, (pid0, p, s) in enumerate(cands):
            x = (c + 1) * cell
            # 候选图
            cp = os.path.join(IMG_DIR2, p)
            try:
                ci = Image.open(cp).convert("RGB").resize((cell - 8, cell - 8))
                canvas.paste(ci, (x + 4, r * cell + 4))
            except Exception:
                draw_text(d, (x + 4, r * cell + 4), "?", size=20)
            hit = (pid0 == gt)
            col = (0, 150, 0) if hit else (200, 60, 60)
            draw_text(d, (x + 4, r * cell + cell - 34), f"id {pid0}", fill=col, size=10)
            draw_text(d, (x + 4, r * cell + cell - 20), f"{s:.2f}", fill=col, size=10)
    canvas.save(out_path)
    print(f"匹配示例图: {out_path}")


IMG_DIR2 = os.path.join(PROJECT_ROOT, "train", "dataset", "image")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--samples", type=int, default=8)
    ap.add_argument("--pca-n", type=int, default=3000)
    ap.add_argument("--device", default="auto")
    args = ap.parse_args()
    VIZ_DIR.mkdir(parents=True, exist_ok=True)

    history = []
    if HISTORY_JSON.exists():
        history = json.loads(HISTORY_JSON.read_text(encoding="utf-8"))
    plot_curve(history, VIZ_DIR / "train_curve.png")

    report = {}
    if EVAL_REPORT.exists():
        report = json.loads(EVAL_REPORT.read_text(encoding="utf-8"))
    plot_eval(report, VIZ_DIR / "eval_topk.png")

    db = None
    if PICKLE_DB.exists():
        import pickle as _pk
        db = _pk.load(open(PICKLE_DB, "rb"))
        plot_pca(db, VIZ_DIR / "feature_pca.png", args.pca_n)

    if db is not None and os.path.isdir(TEST_DIR):
        dev = args.device
        if dev == "auto":
            dev = "cuda" if __import__("torch").cuda.is_available() else "cpu"
        plot_samples_need_db(TEST_DIR, db, VIZ_DIR / "match_samples.png", args.samples, 3, dev)

    print(f"可视化完成，输出目录: {VIZ_DIR}")


if __name__ == "__main__":
    main()
