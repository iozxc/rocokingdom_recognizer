"""基于 Windows 游戏窗口截图的「实时小地图/玩家」观测。

采用「后台监控线程 + 缓存最近一次观测」的方式：识别(截图+定位)在后台线程进行，
`/map_observation` 立即返回最近结果，避免 HTTP 请求线程被识别阻塞造成卡顿。
无小地图时视为玩家原地不动，保持上次位置并标记 map_found=False。
"""

import threading
import time
import os
from typing import Any, Dict, Optional

import cv2
import numpy as np
import pygetwindow as gw
from PIL import Image

import config
from core.logger import logger
from core.tools import capture_window


def _window(title: str):
    windows = gw.getWindowsWithTitle(title)
    if not windows:
        return None
    win = windows[0]
    if getattr(win, "isMinimized", False):
        win.restore()
    return win


# 把定位器状态/原因翻译成给用户看的简短中文提示。
# 前端在顶部展示，告诉用户“现在在做什么”，尤其说明哪些是正常等待、哪些是异常。
def _status_message(reason: str, status: Optional[str], map_found: bool) -> str:
    if reason == "game-window-not-found":
        return "未找到游戏窗口，请先打开「洛克王国：世界」"
    if reason == "capture-failed":
        return "截图失败，正在重试"
    if reason == "warming-up":
        return "地图感知正在启动…"
    if not map_found:
        return "当前画面没有识别到小地图，玩家位置保持不变"
    if status == "init-pending":
        return "正在全图搜索你的位置…"
    if status in ("pending-hint", "pending-wait"):
        return "位置匹配中，暂以上一位置为准…"
    if status == "switch-pending":
        return "检测到位置跳变，正在重新定位…"
    if status == "confirmed":
        return "已确定当前位置"
    if status == "track":
        return "正在跟踪你的位置"
    if status == "weak-hold":
        return "位置匹配稍弱，保持上一位置"
    if status == "hold":
        return "你站在原地，位置保持不变"
    if status == "no-map":
        return "画面没有小地图，玩家位置保持不变"
    if status == "unconfirmed":
        return "位置不确定，保持上一位置"
    if status == "low-conf":
        return "匹配置信度低，正在等待更清晰的画面"
    return "正在获取位置…"


class _MapMonitor:
    def __init__(self):
        self._title = config.GAME_WINDOW_TITLE
        self._interval = config.MAP_MONITOR_INTERVAL
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._started = False
        self._latest: Dict[str, Any] = self._empty_obs()
        self._ref_thumb: Optional[np.ndarray] = None  # 小色参考缩略图(调试用)

    @staticmethod
    def _empty_obs() -> Dict[str, Any]:
        return {
            "source": "window-image",
            "timestamp": int(time.time() * 1000),
            "window_found": False,
            "window_title": config.GAME_WINDOW_TITLE,
            "confidence": None,
            "screenshot": None,
            "position": None,
            "heading": None,
            "map_found": False,
            "reason": "warming-up",
            "status_message": "地图感知正在启动…",
            "elapsed_ms": 0,
        }

    def start(self, title: Optional[str] = None) -> None:
        if self._started:
            return
        if title:
            self._title = title
        self._started = True
        threading.Thread(target=self._loop, name="map-observer", daemon=True).start()
        logger.info("map observer background thread started (interval=%.2fs)", self._interval)

    def stop(self) -> None:
        self._stop.set()

    def _loop(self) -> None:
        try:
            from core.map_localizer import get_localizer

            get_localizer()
        except Exception as exc:  # noqa: BLE001
            logger.warning("map localizer prewarm failed: %s", exc)

        while not self._stop.is_set():
            t0 = time.perf_counter()
            obs = self._observe_once()
            obs["server_ts"] = int(time.time() * 1000)
            obs["monitor_elapsed_ms"] = round((time.perf_counter() - t0) * 1000, 1)
            with self._lock:
                self._latest = obs
            # 每帧一行简洁结果，并带保存的截图文件名，便于排查「飘到很远」
            pos = "-" if obs.get("position") is None else "(%d,%d)" % (
                obs["position"]["x"], obs["position"]["y"])
            conf = "-" if obs.get("confidence") is None else "%.3f" % obs["confidence"]
            logger.info("[map] reason=%s found=%s status=%s conf=%s pos=%s cap=%s took=%.0fms",
                        obs.get("reason"), obs.get("map_found"),
                        (obs.get("localize") or {}).get("status", "-"),
                        conf, pos, obs.get("capture_file", "-"), obs["monitor_elapsed_ms"])
            if obs["monitor_elapsed_ms"] > 800:
                logger.info("[map] SLOW obs %.0fms", obs["monitor_elapsed_ms"])
            self._stop.wait(self._interval)

    def _observe_once(self) -> Dict[str, Any]:
        started = time.perf_counter()
        now_ts = int(time.time() * 1000)
        win = _window(self._title)
        base = {
            "source": "window-image",
            "timestamp": now_ts,
            "window_found": bool(win),
            "window_title": getattr(win, "title", self._title) if win else self._title,
            "confidence": None,
            "screenshot": None,
            "position": None,
            "heading": None,
            "map_found": False,
            "status_message": "正在获取位置…",
        }
        if not win or win.width <= 0 or win.height <= 0:
            base["reason"] = "game-window-not-found"
            base["status_message"] = _status_message("game-window-not-found", None, False)
            base["elapsed_ms"] = round((time.perf_counter() - started) * 1000, 1)
            return base

        bbox = (win.left, win.top, win.right, win.bottom)
        image = capture_window(bbox=bbox, hwnd=getattr(win, "_hWnd", None))
        if image is None:
            base["reason"] = "capture-failed"
            base["status_message"] = _status_message("capture-failed", None, False)
            base["elapsed_ms"] = round((time.perf_counter() - started) * 1000, 1)
            return base

        base["screenshot"] = {
            "width": image.width,
            "height": image.height,
            "bbox": {"x": win.left, "y": win.top, "width": win.width, "height": win.height},
        }
        base["reason"] = "ok"

        try:
            from core.map_localizer import get_localizer

            loc = get_localizer()
            obs = loc.localize(image, ts_ms=now_ts)
            if obs:
                base["map_found"] = bool(obs.get("map_found", False))
                if obs.get("x") is not None:
                    base["position"] = {"x": obs["x"], "y": obs["y"], "captured_at": obs["captured_at"]}
                base["confidence"] = obs.get("confidence")
                if obs.get("heading") is not None:
                    base["heading"] = obs["heading"]
                base["localize"] = {
                    "confidence": obs.get("confidence"),
                    "source": obs.get("source"),
                    "status": obs.get("status"),
                }
                if obs.get("timings_ms"):
                    base["localize"]["timings_ms"] = obs["timings_ms"]
            # 保存截图(无论是否定位成功)，便于排查“飘到很远”
            cap_path = self._save_capture(image, obs, now_ts)
            if cap_path:
                base["capture_file"] = cap_path
        except Exception as exc:  # noqa: BLE001
            logger.error("玩家定位失败: %s", exc, exc_info=True)
            base["localize_error"] = str(exc)

        base["elapsed_ms"] = round((time.perf_counter() - started) * 1000, 1)
        base["status_message"] = _status_message(
            base.get("reason", "ok"),
            (base.get("localize") or {}).get("status"),
            bool(base.get("map_found", False)),
        )
        return base

    def _save_capture(self, image: Any, obs: Optional[Dict], ts_ms: int) -> Optional[str]:
        """把本帧 窗口截图/小地图/定位结果 拼成一张调试图存到 debug/map_capture."""
        if not config.MAP_SAVE_CAPTURE:
            return None
        d = config.MAP_CAPTURE_DIR
        try:
            os.makedirs(d, exist_ok=True)
            status = (obs or {}).get("status", "?")
            conf = (obs or {}).get("confidence")
            x, y = (obs or {}).get("x"), (obs or {}).get("y")
            timings_ms = (obs or {}).get("timings_ms") or {}
            coarse = float(timings_ms.get("coarse_search", 0))
            refine = float(timings_ms.get("refine", 0))
            total = float(sum(timings_ms.values()))
            # 文件名带上 conf / 坐标 / 耗时，排序即可直观看“哪帧飘了”。
            name_val = "--" if conf is None else ("%.2f" % conf).replace(".", "p")
            pos_val = "--" if (x is None or y is None) else "%d-%d" % (int(x), int(y))
            name = "%s_%s_c%s_pos%s_%dms_%dms_%dms.png" % (
                ts_ms, status, name_val, pos_val,
                int(total), int(coarse), int(refine))
            path = os.path.join(d, name)

            frame = np.array(Image.fromarray(np.asarray(image).astype(np.uint8)).convert("RGB")) \
                if not isinstance(image, Image.Image) else np.array(image.convert("RGB"))
            from core.map_localizer import capture_minimap, normalize_disc
            crop, cx, cy, r, found = capture_minimap(frame)
            norm = normalize_disc(frame, cx, cy, r)

            # 面板1：整帧(缩小) + 小地图 ROI 圆
            fh, fw = frame.shape[:2]
            sc = 420.0 / fw
            p1 = cv2.resize(frame, (420, int(fh * sc)), interpolation=cv2.INTER_AREA)
            cv2.circle(p1, (int(cx * sc), int(cy * sc)), int(r * sc), (0, 255, 0), 2)

            # 面板2：归一化小地图(200x200)
            p2 = norm

            # 面板3：参考图缩略 + 定位点标记
            p3 = self._ref_view(obs)

            gap = np.full((max(p1.shape[0], 200), 4, 3), 255, np.uint8)
            row1 = [p1, gap, p2, gap, p3]
            h = max(x.shape[0] for x in row1)
            row1 = [np.pad(x, ((0, h - x.shape[0]), (0, 0), (0, 0)), constant_values=255) for x in row1]
            debug = np.concatenate(row1, axis=1)
            conf_txt = "--" if not obs or obs.get("confidence") is None else "%.3f" % obs["confidence"]
            pos_txt = "--" if not obs or obs.get("x") is None else "(%d,%d)" % (obs["x"], obs["y"])
            found_txt = "Y" if (obs or {}).get("map_found") else "N"
            cv2.putText(debug, "%s  status=%s conf=%s pos=%s map_found=%s" % (
                ts_ms, status, conf_txt, pos_txt, found_txt),
                (4, 14), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (255, 0, 0), 2)
            cv2.putText(debug, "total=%dms coarse=%dms refine=%dms  cap=%d norm=%d sim=%d" % (
                int(total), int(coarse), int(refine),
                int(timings_ms.get("capture", 0)), int(timings_ms.get("normalize", 0)),
                int(timings_ms.get("similarity", 0))),
                (4, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (128, 0, 0), 1)
            cv2.imwrite(path, cv2.cvtColor(debug, cv2.COLOR_RGB2BGR))

            # 控制文件数量
            try:
                files = sorted((f for f in (os.path.join(d, x) for x in os.listdir(d))
                                if os.path.isfile(f)), key=os.path.getmtime)
                while len(files) > config.MAP_CAPTURE_MAX:
                    os.remove(files.pop(0))
            except Exception:
                pass
            return name
        except Exception as exc:  # noqa: BLE001
            logger.debug("save capture failed: %s", exc)
            return None

    def _ref_view(self, obs: Optional[Dict]) -> np.ndarray:
        """参考图缩略图上标出定位点；未定位时显示整图缩略。"""
        if self._ref_thumb is None:
            img = Image.open(config.MAP_LOCALIZE_REFERENCE).convert("RGB")
            self._ref_thumb = np.array(img.resize((1024, 1024), Image.LANCZOS))
        view = self._ref_thumb.copy()
        if obs and obs.get("x") is not None:
            x, y = obs["x"], obs["y"]
            px, py = int(x / 8), int(y / 8)
            cv2.circle(view, (px, py), 12, (255, 0, 0), 3)
            cv2.circle(view, (px, py), 3, (0, 0, 255), -1)
        return view

    def latest(self) -> Dict[str, Any]:
        with self._lock:
            return dict(self._latest)


_monitor: Optional["_MapMonitor"] = None


def get_monitor() -> "_MapMonitor":
    global _monitor
    if _monitor is None:
        _monitor = _MapMonitor()
    return _monitor


def observe_map(title: Optional[str] = None) -> Dict[str, Any]:
    """返回最近一次后台观测(启动监控线程后立即返回，不被识别阻塞)。"""
    mon = get_monitor()
    mon.start(title or config.GAME_WINDOW_TITLE)
    return mon.latest()
