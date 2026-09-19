# -*- coding: utf-8 -*-
"""颜色签名（HSV 直方图）—— PC 运行期与 train/ 构建脚本共用的**唯一实现**。

为什么要它
----------
当前识别链路是「零训练 DINOv2 预训练特征 + 余弦匹配」，拿到的是 384 维**全局**描述子：
实测同一形态、只差眼环配色的候选之间余弦差距只有 ~1.9pp，而库内/量化噪声更大，
于是「雪绒鸟 冬/春/夏/秋」这类候选的排序基本靠抽签（实测 200 次重排 100% 选错）。

这套签名把「有彩色像素」的 HSV 分布单独抽出来（深色圆框、浅色背景都被掩码排除），
作为打分的一个**有界微调项**参与排序：

    最终分 = DINO 余弦 + w * (颜色相关度 - 0.5)      # w 默认 0.04，即最多 ±2pp

这样颜色只能在「近分候选之间」起作用，不会推翻 DINO 已经给出的明显判断。
"""

from __future__ import annotations

import cv2
import numpy as np

# 与 train/_build_color_db.py、前端 colorSig.ts 必须完全一致
COLOR_BINS = (12, 4, 4)
COLOR_SAT_MIN = 60
COLOR_VAL_MIN = 60
COLOR_DIM = int(np.prod(COLOR_BINS))
COLOR_SCHEMA = "color-hsv-v1"


def color_signature(rgb: np.ndarray) -> np.ndarray:
    """输入 HWC RGB uint8，返回 uint8 的 HSV 直方图签名（长度 COLOR_DIM，和≈255）。"""
    if rgb.ndim != 3 or rgb.shape[2] < 3:
        raise ValueError("color_signature 需要 HWC RGB 图像")
    hsv = cv2.cvtColor(np.ascontiguousarray(rgb[..., :3], dtype=np.uint8), cv2.COLOR_RGB2HSV)
    s, v = hsv[..., 1], hsv[..., 2]
    mask = ((s > COLOR_SAT_MIN) & (v > COLOR_VAL_MIN)).astype(np.uint8)
    if int(mask.sum()) < 20:      # 几乎没有彩色像素（纯黑白图）：退回全图统计
        mask = np.ones_like(s, np.uint8)
    hist = cv2.calcHist([hsv], [0, 1, 2], mask, list(COLOR_BINS),
                        [0, 180, 0, 256, 0, 256]).reshape(-1)
    total = float(hist.sum())
    if total <= 0:
        return np.zeros(COLOR_DIM, np.uint8)
    return np.clip(hist / total * 255.0, 0, 255).astype(np.uint8)


def color_rows_normalized(rows: np.ndarray) -> np.ndarray:
    """把 (N, D) 的 uint8 签名矩阵转成「去均值 + L2 归一化」的 float32，便于批量算相关度。"""
    c = np.asarray(rows, np.float32)
    c = c - c.mean(axis=1, keepdims=True)
    n = np.linalg.norm(c, axis=1, keepdims=True)
    return c / np.maximum(n, 1e-9)


def query_normalized(sig: np.ndarray) -> np.ndarray:
    """单个签名 -> 去均值 + L2 归一化。"""
    q = np.asarray(sig, np.float32).reshape(-1)
    q = q - q.mean()
    return q / max(float(np.linalg.norm(q)), 1e-9)


def color_corr(a: np.ndarray, b: np.ndarray) -> float:
    """两个签名的 Pearson 相关度（-1~1）。"""
    af, bf = np.asarray(a, np.float32).reshape(-1), np.asarray(b, np.float32).reshape(-1)
    af = af - af.mean()
    bf = bf - bf.mean()
    denom = float(np.linalg.norm(af) * np.linalg.norm(bf))
    return float(af @ bf / denom) if denom > 1e-9 else 0.0


def color_corr_batch(norm_rows: np.ndarray, norm_query: np.ndarray) -> np.ndarray:
    """批量相关度：norm_rows 为 (N,D)（已归一化），norm_query 为 (D,)。"""
    return norm_rows @ norm_query


def color_meta() -> dict:
    return {
        "schema": COLOR_SCHEMA,
        "bins": list(COLOR_BINS),
        "dim": COLOR_DIM,
        "sat_min": COLOR_SAT_MIN,
        "val_min": COLOR_VAL_MIN,
    }
