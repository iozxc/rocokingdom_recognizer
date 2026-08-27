"""实时地图玩家定位(零训练视觉方案)。

输入：一帧游戏窗口/全屏截图。输出：玩家在「前端地图世界坐标系」(8192x8192，
即 mapdata / static/map/level_13_* 的像素坐标) 下的 (x, y)，以及可选朝向。

小地图固定位于右上角且为圆形(玩家箭头恒在圆心)，所以：
1) capture_minimap：按相对位置取右上角小 ROI，再 HoughCircles 精确定圆；
2) 归一化到固定 200x200；
3) 与参考底图做 归一化互相关(NCC)定位；首帧全局搜索，后续帧用「时序连续性」
   (在上一位置附近受限搜索 + 相似帧保持 + 场景切换检测) 实现实时监控。

线程安全：用锁保护内部状态(定位状态、参考图缓存)，供 Flask/监控线程调用。
"""
from __future__ import annotations

import threading
import time
from typing import Any, Dict, Optional

import cv2
import numpy as np
from PIL import Image

import config
from core.logger import logger

# —— 归一化与尺度先验 ——
TEMPLATE = 200          # 归一化小地图(圆盘所在正方形)边长
VIEW_R = 100.0          # 小地图显示的世界视半径(像素, 前端 0..8192 坐标系)
QUAD = 0.46             # 圆盘半径占小地图短边比例(老口径,保留)

# —— 时序连续性 ——
# 相邻帧最大“正常移动”距离(px)。跳跃大于此值才判为场景切换。
# 该值应随采样周期一起放宽：0.7s 循环里玩家帧间移动通常 <70px，
# 但若把 MAP_MONITOR_INTERVAL 调到 1.2~1.5s，帧间移动会更大，这里要相应放大，
# 否则正常走路会被误判成传送到别处，反复进入 switch-pending 并偶尔锁错位置。
MAX_JUMP = getattr(config, "MAP_LOCALIZE_MAX_JUMP", 150.0)
WIDE_JUMP = 900.0       # 场景切换时的宽局部搜索范围(px), 更远才回退全图
TRACK_MIN = 0.38        # 接受“连续跟踪”匹配的最小 NCC 得分
TRACK_CONF_MIN = getattr(config, "MAP_LOCALIZE_TRACK_CONF_MIN", 0.52)
                        # 真正更新位置所需的最低得分(低于此只保持旧位置)。
                        # 0.38~0.52 之间属于“能匹配但很弱”，更新会飘，故降级为 weak-hold。
SWITCH_MIN = 0.48       # 接受“场景切换候选”的最小 NCC 得分(更高，避免金色区假匹配)
SIM_HOLD = 0.93         # 相邻帧相似度阈值, 高于则判为同一位置(保持)
SIM_CHANGE = getattr(config, "MAP_LOCALIZE_SIM_CHANGE", 0.62)
                        # 相邻帧小地图相似度低于此值 => 场景可能突变(传送/切图),
                        # 此时不再接受弱匹配的 track，而走 switch-pending 重新定位。
INIT_MIN = getattr(config, "MAP_LOCALIZE_INIT_MIN", 0.50)    # 首次确认(init)所需的最低得分
INIT_CONFIRM_FRAMES = getattr(config, "MAP_LOCALIZE_INIT_CONFIRM_FRAMES", 2)  # 多帧确认帧数
PENDING_LIMIT = getattr(config, "MAP_LOCALIZE_PENDING_LIMIT", 3)              # 待确认候选存活上限
CANDIDATE_KEEP = getattr(config, "MAP_LOCALIZE_CANDIDATE_KEEP", 4)            # 候选短名单长度

# —— 小地图截取先验(右上角, 相对位置) ——
EXP_X = 0.935           # 圆心 x 坐标占宽比例
EXP_Y = 0.153           # 圆心 y 坐标占高比例
EXP_R = 0.042           # 半径占宽比例
ROI_SCALE = 2.7         # 截取边长为 2.7*半径

DEFAULT_REFERENCE = config.MAP_LOCALIZE_REFERENCE


def _fmt_ms(d: Dict[str, float]) -> str:
    return ", ".join("%s=%.1fms" % (k, v * 1000) for k, v in d.items())


def _to_np_rgb(img: Any) -> np.ndarray:
    """把 PIL 图像或 numpy(RGB/BGR)统一成 numpy RGB."""
    if isinstance(img, Image.Image):
        return np.array(img.convert("RGB"))
    arr = np.asarray(img)
    if arr.ndim == 2:
        return cv2.cvtColor(arr, cv2.COLOR_GRAY2RGB)
    return arr[..., :3]


def capture_minimap(frame: np.ndarray) -> tuple[np.ndarray, float, float, float, bool]:
    """定位右上角圆形小地图；返回(方形 crop, 圆心x, 圆心y, 半径, found)，坐标为全帧坐标。

    之后不再把 crop 交给 `normalize_disc` 二次定圆——那样会在小 ROI 里抓到错误的大圆，
    导致裁剪区域被 UI 背景/边框填充、匹配退化为“只认橙色/水色”的假匹配。
    因此这里把「已知圆心 + 半径」一并返回，供 `normalize_disc(frame, cx, cy, r)` 直接用。
    """
    H, W = frame.shape[:2]
    ex, ey, r0 = EXP_X * W, EXP_Y * H, EXP_R * W
    side = int(ROI_SCALE * r0)
    x0, y0 = max(0, int(ex - side / 2)), max(0, int(ey - side / 2))
    x1, y1 = min(W, int(ex + side / 2)), min(H, int(ey + side / 2))
    crop = frame[y0:y1, x0:x1]
    gb = cv2.GaussianBlur(cv2.cvtColor(crop, cv2.COLOR_RGB2GRAY), (5, 5), 0)
    rmin, rmax = int(min(crop.shape[:2]) * 0.32), int(min(crop.shape[:2]) * 0.5) + 1
    circles = cv2.HoughCircles(gb, cv2.HOUGH_GRADIENT, dp=1.5,
                               minDist=min(crop.shape[:2]) // 2, param1=120,
                               param2=25, minRadius=rmin, maxRadius=rmax)
    if circles is None:
        return crop, x0 + crop.shape[1] / 2, y0 + crop.shape[0] / 2, crop.shape[1] / 2, False
    c = circles[0][0]
    r = float(c[2])
    cx_full, cy_full = float(c[0] + x0), float(c[1] + y0)
    tol = 0.07 * min(W, H)
    center_ok = abs(cx_full - ex) < tol and abs(cy_full - ey) < tol
    # 半径先验(EXP_R*W)对高分屏/窗口缩放并不总是准确，这里放宽为 0.65*r0 的容差，
    # 且不因半径略偏而误判为“没有小地图”-> 避免把本来有效的圆盘当成 no-map。
    radius_ok = abs(r - r0) < 0.65 * r0
    found = center_ok and radius_ok
    return crop, cx_full, cy_full, r, found


def _disc_center(img: np.ndarray) -> tuple[float, float, float]:
    h, w = img.shape[:2]
    gb = cv2.GaussianBlur(cv2.cvtColor(img, cv2.COLOR_RGB2GRAY), (5, 5), 0)
    rmin, rmax = int(min(h, w) * 0.36), int(min(h, w) * 0.52) + 1
    circles = cv2.HoughCircles(gb, cv2.HOUGH_GRADIENT, dp=1.5,
                               minDist=min(h, w) // 2, param1=120,
                               param2=25, minRadius=rmin, maxRadius=rmax)
    if circles is None:
        return w / 2.0, h / 2.0, min(h, w) / 2.0
    c = circles[0][0]
    return float(c[0]), float(c[1]), float(c[2])


def normalize_disc(mm: np.ndarray, cx: Optional[float] = None, cy: Optional[float] = None,
                   r: Optional[float] = None) -> np.ndarray:
    """把小地图圆盘裁成 TEMPLATE x TEMPLATE 的方块。

    优先使用调用方已检测到的 (cx, cy, r) —— 直接以全帧坐标裁边长为 2r 的正方形，
    避免在 ROI 内二次 HoughCircles 抓到错误的大圆而混入 UI 背景。
    未提供圆心/半径时退化为旧的 `_disc_center` 逻辑(兼容旧调用)。
    """
    if cx is not None and cy is not None and r is not None and r > 0:
        side = int(2 * r)
        x0, y0 = int(cx - side / 2), int(cy - side / 2)
        h, w = mm.shape[:2]
        out = np.zeros((side, side, 3), np.uint8)
        sx0, sy0 = max(0, x0), max(0, y0)
        sx1, sy1 = min(w, x0 + side), min(h, y0 + side)
        out[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0] = mm[sy0:sy1, sx0:sx1]
        return cv2.resize(out, (TEMPLATE, TEMPLATE), interpolation=cv2.INTER_AREA)
    cx, cy, r = _disc_center(mm)
    h, w = mm.shape[:2]
    side = int(2 * r)
    x0, y0 = int(cx - side / 2), int(cy - side / 2)
    crop = np.zeros((side, side, 3), np.uint8)
    sx0, sy0 = max(0, x0), max(0, y0)
    sx1, sy1 = min(w, x0 + side), min(h, y0 + side)
    crop[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0] = mm[sy0:sy1, sx0:sx1]
    return cv2.resize(crop, (TEMPLATE, TEMPLATE), interpolation=cv2.INTER_AREA)


def make_template(norm: np.ndarray, rad: int = 16) -> np.ndarray:
    """灰度归一化小地图；抹掉圆心箭头；圆盘外填均值避免 NCC 退化."""
    c = TEMPLATE / 2.0
    mask = np.zeros((TEMPLATE, TEMPLATE), np.uint8)
    cv2.circle(mask, (int(c), int(c)), rad, 255, -1)
    inp = cv2.inpaint(norm, mask, 5, cv2.INPAINT_TELEA)
    g = cv2.cvtColor(inp, cv2.COLOR_RGB2GRAY).astype(np.float32)
    disc = np.zeros((TEMPLATE, TEMPLATE), np.uint8)
    cv2.circle(disc, (int(c), int(c)), int(TEMPLATE * 0.46), 255, -1)
    mean = float(g[disc > 0].mean())
    g[disc == 0] = mean
    return g


def disc_similarity(a: np.ndarray, b: np.ndarray) -> float:
    c = TEMPLATE / 2.0
    m = np.zeros((TEMPLATE, TEMPLATE), np.uint8)
    cv2.circle(m, (int(c), int(c)), int(TEMPLATE * 0.44), 1, -1)
    mask = m > 0
    ga = cv2.cvtColor(a, cv2.COLOR_RGB2GRAY).astype(np.float32)[mask]
    gb = cv2.cvtColor(b, cv2.COLOR_RGB2GRAY).astype(np.float32)[mask]
    if ga.std() < 1e-6 or gb.std() < 1e-6:
        return 0.0
    return float(np.corrcoef(ga.ravel(), gb.ravel())[0, 1])


def global_localize(tpl: np.ndarray, ref_g25: np.ndarray, wk: float = 0.25, step: float = 0.03):
    """整图粗定位：返回 (score, f, (x, y)) 的最佳候选。"""
    return global_localize_topk(tpl, ref_g25, wk=wk, step=step, k=1)[0]


def global_localize_topk(tpl: np.ndarray, ref_g25: np.ndarray, wk: float = 0.25,
                         step: float = 0.03, k: int = 1):
    """整图粗定位，返回 (score, f, (x, y)) 的前 k 个候选(按分数降序, 世界坐标)。

    保持与 `global_localize` 完全一致的搜索，仅在最后保留 top-k 峰；首候选即原结果，
    因此对既有调用(switch 回退/init)不改变精度，只是额外给出候选短名单供多帧确认复用。

    始终返回 list[(score, f, (x, y))]，长度至多为 k。
    """
    fp = VIEW_R / (TEMPLATE / 2.0)
    H, W = ref_g25.shape
    peaks: list[tuple[float, float, tuple[float, float]]] = []
    for f in np.arange(0.80 * fp, 1.30 * fp, step):
        tw = int(TEMPLATE * f * wk)
        if tw < 24 or tw >= min(H, W) - 4:
            continue
        t = cv2.resize(tpl, (tw, tw), interpolation=cv2.INTER_AREA)
        res = cv2.matchTemplate(ref_g25, t, cv2.TM_CCOEFF_NORMED)
        res = np.nan_to_num(res, nan=-1.0, posinf=-1.0, neginf=-1.0)
        mx = float(res.max())
        loc = np.unravel_index(int(res.argmax()), res.shape)
        pw = (loc[1] / wk + (TEMPLATE / 2) * f, loc[0] / wk + (TEMPLATE / 2) * f)
        peaks.append((mx, float(f), (float(pw[0]), float(pw[1]))))
    peaks.sort(key=lambda p: p[0], reverse=True)
    # 世界坐标 NMS：过滤相互过近的重复峰(同一位置跨尺度会重复出现)
    picked: list[tuple[float, float, tuple[float, float]]] = []
    for score, f, pos in peaks:
        if all(np.hypot(pos[0] - q[2][0], pos[1] - q[2][1]) > 200.0 for q in picked):
            picked.append((score, f, pos))
        if len(picked) >= max(1, k):
            break
    if not picked:
        fallback_pos = (float(W / 2.0 / wk), float(H / 2.0 / wk))
        return [(-1.0, fp, fallback_pos)]
    return picked


def refine_local(tpl: np.ndarray, ref_g: np.ndarray, x0: float, y0: float, f0: float,
                 R: int = 300, step: float = 0.01, wk: float = 0.25):
    """在全参考图的给定比例(wk)下，于 (x0,y0) 附近的局部窗口做细搜。"""
    fp = VIEW_R / (TEMPLATE / 2.0)
    x0, y0 = int(x0), int(y0)
    best = (-1.0, f0, (float(x0), float(y0)))
    for f in np.arange(max(0.82 * fp, f0 - 0.15), min(1.28 * fp, f0 + 0.15), step):
        tw = int(TEMPLATE * f * wk)
        Rw = int(R * wk)
        cx0 = max(0, int(x0 * wk - Rw)); cy0 = max(0, int(y0 * wk - Rw))
        cx1 = min(ref_g.shape[1], int(x0 * wk + Rw)); cy1 = min(ref_g.shape[0], int(y0 * wk + Rw))
        crop = ref_g[cy0:cy1, cx0:cx1]
        if tw >= crop.shape[0] - 2 or tw >= crop.shape[1] - 2:
            continue
        t = cv2.resize(tpl, (tw, tw), interpolation=cv2.INTER_AREA)
        res = cv2.matchTemplate(crop, t, cv2.TM_CCOEFF_NORMED)
        res = np.nan_to_num(res, nan=-1.0, posinf=-1.0, neginf=-1.0)
        mx = float(res.max())
        loc = np.unravel_index(int(res.argmax()), res.shape)
        pw = ((cx0 + loc[1]) / wk + (TEMPLATE / 2) * f,
              (cy0 + loc[0]) / wk + (TEMPLATE / 2) * f)
        if mx > best[0]:
            best = (mx, float(f), pw)
    return best


def constrained_localize(tpl: np.ndarray, ref_g25: np.ndarray, prev_x: float, prev_y: float,
                         max_jump: float = MAX_JUMP, wk: float = 0.25, step: float = 0.03):
    fp = VIEW_R / (TEMPLATE / 2.0)
    Rfull = int(max_jump + VIEW_R)
    x0, y0 = int(prev_x), int(prev_y)
    cxf0, cyf0 = max(0, x0 - Rfull), max(0, y0 - Rfull)
    cxf1, cyf1 = min(ref_g25.shape[1] / wk, x0 + Rfull), min(ref_g25.shape[0] / wk, y0 + Rfull)
    c0x, c0y = int(cxf0 * wk), int(cyf0 * wk)
    c1x, c1y = int(cxf1 * wk), int(cyf1 * wk)
    win = ref_g25[c0y:c1y, c0x:c1x]
    if win.shape[0] < 24 or win.shape[1] < 24:
        return (-1.0, fp, (float(prev_x), float(prev_y)))
    best = (-1.0, fp, (float(prev_x), float(prev_y)))
    for f in np.arange(0.80 * fp, 1.30 * fp, step):
        tw = int(TEMPLATE * f * wk)
        if tw >= win.shape[0] - 2 or tw >= win.shape[1] - 2:
            continue
        t = cv2.resize(tpl, (tw, tw), interpolation=cv2.INTER_AREA)
        res = cv2.matchTemplate(win, t, cv2.TM_CCOEFF_NORMED)
        res = np.nan_to_num(res, nan=-1.0, posinf=-1.0, neginf=-1.0)
        mx = float(res.max())
        loc = np.unravel_index(int(res.argmax()), res.shape)
        pw = (cxf0 + loc[1] / wk + (TEMPLATE / 2) * f, cyf0 + loc[0] / wk + (TEMPLATE / 2) * f)
        if mx > best[0]:
            best = (mx, float(f), pw)
    return best


class PlayerLocalizer:
    """有状态的实时定位器(线程安全)。"""

    def __init__(self, reference: Optional[str] = None, enabled: bool = None):
        self._ref_path = reference or DEFAULT_REFERENCE
        self._enabled = config.MAP_LOCALIZE_ENABLED if enabled is None else enabled
        self._min_score = config.MAP_LOCALIZE_MIN_SCORE
        self._lock = threading.RLock()
        self._built = False
        self._ref_g25: Optional[np.ndarray] = None
        # 跟踪状态
        self._confirmed: Optional[tuple[float, float]] = None  # 已确认(可发布)位置
        self._pending: Optional[tuple[float, float]] = None    # 待确认位置(init/switch 临时)
        self._pending_count: int = 0   # 当前候选已连续达标的帧数(多帧确认)
        self._pending_age: int = 0     # 当前候选存活的帧数, 超过 PENDING_LIMIT 触发重搜
        self._pending_cands: list[tuple[float, float, tuple[float, float]]] = []  # 候选短名单
        self._pending_strict: bool = False  # True=场景切换候选(需更高置信度)
        self._norm: Optional[np.ndarray] = None
        self._hist: list[tuple[float, float, float]] = []   # (x, y, ts_ms)

    # ---------------- 参考图加载(懒加载,仅一次) ----------------
    def _ensure_built(self) -> bool:
        if self._built:
            return True
        if not self._enabled:
            logger.info("map localizer disabled.")
            return False
        try:
            path = self._ref_path
            arr = np.array(Image.open(path).convert("RGB"))
            h, w = arr.shape[:2]
            g = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY).astype(np.float32)
            del arr
            self._ref_g25 = cv2.resize(g, None, fx=0.25, fy=0.25,
                                       interpolation=cv2.INTER_AREA)
            del g
            self._built = True
            logger.info("map localizer reference loaded: %s (%dx%d frame)", path, h, w)
            return True
        except Exception as exc:  # noqa: BLE001
            logger.error("map localizer failed to load reference: %s", exc, exc_info=True)
            return False

    def reset(self) -> None:
        with self._lock:
            self._confirmed = None
            self._pending = None
            self._pending_count = 0
            self._pending_age = 0
            self._pending_cands = []
            self._pending_strict = False
            self._norm = None
            self._hist = []

    def _set_pending(self, pos: tuple[float, float], candidates: Optional[list] = None,
                     strict: bool = False) -> None:
        """设置待确认候选。若与上一候选相同则累加存活计数，否则重置计数器。"""
        if self._pending is not None and np.hypot(pos[0] - self._pending[0],
                                                 pos[1] - self._pending[1]) < MAX_JUMP:
            self._pending_age += 1
        else:
            self._pending_age = 0
            self._pending_cands = list(candidates) if candidates else []
            self._pending_strict = strict
        self._pending = pos

    def _clear_pending(self) -> None:
        self._pending = None
        self._pending_count = 0
        self._pending_age = 0
        self._pending_cands = []
        self._pending_strict = False

    def _confirm_pending(self, tpl, t_coarse, t_refine):
        """在候选短名单上做局部确认；连续达标多帧才提交，避免单帧抖动/重复全图搜索。

        返回 (ppos, score, status, t_coarse, t_refine)。
        """
        cands = self._pending_cands or [(0.0, 1.0, self._pending)]
        _t1 = time.perf_counter()
        best = (-1.0, None, None)
        for sc, f, coarse in cands:
            cs = constrained_localize(tpl, self._ref_g25, coarse[0], coarse[1])
            if cs[0] < TRACK_MIN:
                continue
            m2, f2, pred = refine_local(tpl, self._ref_g25, *cs[2], f0=cs[1])
            if m2 > best[0]:
                best = (m2, f2, pred)
        t_local = time.perf_counter() - _t1

        # init(首次确认)和场景切换是无先验锚点的“重新定位”，都必须用更高阈值；
        # 只有已经确认后的连续跟踪(track/hold)才用较低的 _min_score。
        need = SWITCH_MIN if self._pending_strict else INIT_MIN
        m2, f2, pred = best
        if m2 >= need:
            # 候选稳定且达标：多帧确认后提交。init 和场景切换都要求多帧一致，
            # 因为歧义小地图(金色区/低纹理)单帧峰值会给出错误目标，多帧能抑制。
            self._pending_count += 1
            self._pending_age += 1
            if self._pending_count >= INIT_CONFIRM_FRAMES:
                self._confirmed = pred
                self._clear_pending()
                return pred, m2, "confirmed", t_coarse, t_refine
            # 尚未攒够帧数：继续以旧位置发布(仍处于待确认)
            t_refine = t_local
            return self._confirmed, None, "pending-hint", t_coarse, t_refine

        # 本帧候选未达标：不立即丢弃，但每 PENDING_LIMIT 帧重新做一次全图搜索，
        # 避免场景切换因候选被本地窗口“锁死”而永远停在 switch-pending。
        self._pending_age += 1
        if self._pending_age >= PENDING_LIMIT:
            _t2 = time.perf_counter()
            cands = global_localize_topk(tpl, self._ref_g25, wk=0.25, step=0.03,
                                         k=CANDIDATE_KEEP)
            t_coarse = time.perf_counter() - _t2
            refined: list[tuple[float, float, tuple[float, float]]] = []
            best_global = (-1.0, None, None)
            for sc, f, coarse in cands:
                rb = refine_local(tpl, self._ref_g25, *coarse, f0=f)
                refined.append((rb[0], rb[1], rb[2]))
                if rb[0] > best_global[0]:
                    best_global = (rb[0], rb[1], rb[2])
            m2, f2, pred = best_global
            # 每次全图搜索后都重置存活计数，让“待确认”重新起步，直到拿到达标候选
            self._pending_age = 0
            self._pending_count = 0
            if m2 >= need:
                self._pending_cands = refined
                self._pending = pred
            else:
                self._clear_pending()
                return self._confirmed, None, "unconfirmed", t_coarse, t_refine
            t_refine = time.perf_counter() - _t2 - t_coarse
            return self._confirmed, None, "switch-pending", t_coarse, t_refine
        t_refine = t_local
        return self._confirmed, None, "pending-wait", t_coarse, t_refine

    # ---------------- 核心 ----------------
    def localize(self, frame: Any, ts_ms: Optional[int] = None) -> Optional[Dict[str, Any]]:
        """输入一帧(截图/窗口图像), 返回玩家观测 dict(在前端 0..8192 世界坐标), 失败返回 None."""
        with self._lock:
            if not self._ensure_built():
                return None
            img = _to_np_rgb(frame)
            ts_ms = ts_ms if ts_ms is not None else int(time.time() * 1000)

            _t0 = time.perf_counter()
            crop, cx, cy, r, map_found = capture_minimap(img)
            t_cap = time.perf_counter() - _t0

            if not map_found:
                # 没有小地图 => 玩家正在做其他事(一定在原地)，保持上次位置。
                if config.MAP_LOCALIZE_DEBUG:
                    logger.info("map localize NO-MINIMAP; hold last=%s", self._confirmed)
                return self._hold_obs(ts_ms, "no-map", map_found=False)

            _t0 = time.perf_counter()
            norm = normalize_disc(img, cx, cy, r)
            t_norm = time.perf_counter() - _t0
            _t0 = time.perf_counter()
            tpl = make_template(norm)
            t_tpl = time.perf_counter() - _t0
            _t0 = time.perf_counter()

            if self._norm is not None:
                sim = disc_similarity(self._norm, norm)
            else:
                sim = None
            t_sim = time.perf_counter() - _t0

            _t0 = time.perf_counter()

            # —— 决策：只发布「已确认」位置；待确认候选(init/switch)优先于旧位置确认 ——
            t_coarse = t_refine = 0.0
            if self._pending is not None:
                ppos, score, status, t_coarse, t_refine = self._confirm_pending(
                    tpl, t_coarse, t_refine)
            elif self._confirmed is not None and sim is not None and sim >= SIM_HOLD:
                ppos, score, status = self._confirmed, sim, "hold"
            elif self._confirmed is not None:
                cs = constrained_localize(tpl, self._ref_g25, self._confirmed[0], self._confirmed[1])
                t_coarse = time.perf_counter() - _t0
                dj = np.hypot(cs[2][0] - self._confirmed[0], cs[2][1] - self._confirmed[1])
                # 场景突变(小地图与上一帧差异很大)：大概率是传送/切图。
                # 此时哪怕局部峰值刚好超过 TRACK_MIN，也不能当成“正常小步移动”，
                # 否则会沿着错误位置“往前走一步”再等切图，观感很怪。
                scene_changed = (sim is not None and sim < SIM_CHANGE)
                if dj <= MAX_JUMP and not scene_changed:
                    # 位置没跳变：是“帧间移动很小”，不论分数高低都不该当成场景切换。
                    # 分数达标就更新为 track；分数偏低(低纹理/模糊)则保持上次位置即可。
                    _t1 = time.perf_counter()
                    m2, f2, pred = refine_local(tpl, self._ref_g25, *cs[2], f0=cs[1])
                    t_refine = time.perf_counter() - _t1
                    # 场景没突变但匹配弱：只接受足够高的匹配作为新位置，否则保持。
                    if m2 >= TRACK_CONF_MIN:
                        self._confirmed = pred
                        ppos, score, status = pred, m2, "track"
                    else:
                        # 位置在 MAX_JUMP 内、但匹配弱：原地玩家/低纹理，仅保持不重定位。
                        ppos, score, status = self._confirmed, None, "weak-hold"
                else:
                    # 真·位移跳变(> MAX_JUMP) 或 场景突变：当作场景切换重新定位。
                    # 先在上次位置附近做「宽局部」搜索(快)，仍失败才全图。
                    _t1 = time.perf_counter()
                    wl = constrained_localize(tpl, self._ref_g25, self._confirmed[0],
                                              self._confirmed[1], max_jump=WIDE_JUMP)
                    m2 = None
                    if wl[0] >= TRACK_MIN:
                        m2, f2, pred = refine_local(tpl, self._ref_g25, *wl[2], f0=wl[1])
                        t_coarse = time.perf_counter() - _t1
                        t_refine = time.perf_counter() - _t1 - t_coarse
                    if m2 is None or m2 < SWITCH_MIN:
                        # 宽局部不可靠(金色区假匹配或真传送过远) -> 回退全图搜索
                        sc, f, coarse = global_localize(tpl, self._ref_g25, wk=0.25, step=0.03)
                        t_coarse = time.perf_counter() - _t1
                        _t2 = time.perf_counter()
                        m2, f2, pred = refine_local(tpl, self._ref_g25, *coarse, f0=f)
                        t_refine = time.perf_counter() - _t2
                    if m2 >= SWITCH_MIN:
                        self._set_pending(pred, strict=True)
                    ppos, score, status = self._confirmed, None, "switch-pending"
            else:
                _t1 = time.perf_counter()
                cands = global_localize_topk(tpl, self._ref_g25, wk=0.25, step=0.03,
                                             k=CANDIDATE_KEEP)
                t_coarse = time.perf_counter() - _t1
                # 对候选短名单逐个 refine，选分数最高的作为待确认候选
                best = (-1.0, None, None)
                _t2 = time.perf_counter()
                refined: list[tuple[float, float, tuple[float, float]]] = []
                for sc, f, coarse in cands:
                    m2, f2, pred = refine_local(tpl, self._ref_g25, *coarse, f0=f)
                    refined.append((m2, f2, pred))
                    if m2 > best[0]:
                        best = (m2, f2, pred)
                t_refine = time.perf_counter() - _t2
                m2, f2, pred = best
                # 把最优候选设为 pending，让后续帧用“受限局部搜索”快速复核，而不是每帧全图重搜。
                # 真正的“是否提交”门槛在 _confirm_pending：init 需 INIT_MIN(0.50)。
                # 若一直达不到，_pending_age 累加并在 PENDING_LIMIT 后触发一次全图重搜，有界兜底。
                self._set_pending(pred, candidates=refined)
                ppos, score, status = None, m2, "init-pending"

            self._norm = norm
            # 只有“已确认/跟踪”位置才计入轨迹(朝向)，避免用跳变方向当朝向
            if status in ("track", "confirmed", "hold") and ppos is not None:
                self._hist.append((ppos[0], ppos[1], ts_ms))
                if len(self._hist) > 6:
                    self._hist.pop(0)
            elif status in ("init-pending", "switch-pending", "pending-hint",
                            "pending-wait", "unconfirmed"):
                self._hist = []

            timings = {"capture": t_cap, "normalize": t_norm, "template": t_tpl,
                       "similarity": t_sim, "coarse_search": t_coarse, "refine": t_refine}
            if status in ("init-pending", "switch-pending", "pending-hint", "pending-wait",
                          "confirmed", "weak-hold") or config.MAP_LOCALIZE_DEBUG:
                logger.info("map localize status=%s conf=%s pos=%s map_found=%s timings=%s",
                            status, None if score is None else round(score, 3),
                            self._confirmed, map_found, _fmt_ms(timings))
            if ppos is None:
                return self._hold_obs(ts_ms, status, map_found)
            return {
                "x": round(ppos[0], 1),
                "y": round(ppos[1], 1),
                "heading": self._heading_estimate(),
                "confidence": None if score is None else round(score, 4),
                "source": "minimap-vision",
                "status": status,
                "map_found": map_found,
                "captured_at": ts_ms,
                "timings_ms": {k: round(v * 1000, 1) for k, v in timings.items()},
            }

    def _hold_obs(self, ts_ms: int, status: str, map_found: bool) -> Dict[str, Any]:
        """小地图缺失/不可靠时：保持上次位置(玩家在原地)，并标记 map_found=False."""
        if self._confirmed is not None:
            return {
                "x": round(self._confirmed[0], 1),
                "y": round(self._confirmed[1], 1),
                "heading": self._heading_estimate(),
                "confidence": None,
                "source": "minimap-vision",
                "status": status,
                "map_found": map_found,
                "captured_at": ts_ms,
                "timings_ms": {},
            }
        return {"x": None, "y": None, "heading": None, "confidence": None,
                "source": "minimap-vision", "status": status, "map_found": map_found,
                "captured_at": ts_ms, "timings_ms": {}}

    def _heading_estimate(self) -> Optional[float]:
        """用最近两点的运动方向估计朝向(度)。无足够运动时返回 None。"""
        if len(self._hist) < 2:
            return None
        x0, y0, _ = self._hist[-2]
        x1, y1, _ = self._hist[-1]
        if np.hypot(x1 - x0, y1 - y0) < 5:
            return None
        return float((np.degrees(np.arctan2(y1 - y0, x1 - x0)) + 360) % 360)


_localizer: Optional[PlayerLocalizer] = None


def get_localizer() -> Optional[PlayerLocalizer]:
    """获取全局单例定位器。"""
    global _localizer
    if _localizer is None:
        _localizer = PlayerLocalizer()
    return _localizer
