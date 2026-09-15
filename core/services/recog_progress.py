"""识别进度上报（PC 端进度条用）。

Flask 在 waitress 里多线程处理请求：识别本身跑在 /init_batch 的请求线程里，
前端另起一个轻量轮询请求读快照。所以这里只需要一个进程内的线程安全字典，
带 TTL 自动清理，不落盘、不依赖任何外部服务。

约定 phase 取值（前端只做展示，用不到也不影响）：
    prepare / ocr / segment / infer / finish
"""
from __future__ import annotations

import threading
import time

_TTL_SECONDS = 600.0
_MAX_ENTRIES = 32

_lock = threading.Lock()
_tasks: dict[str, dict] = {}


def _prune_locked() -> None:
    now = time.time()
    stale = [k for k, v in _tasks.items() if now - v.get("updated_at", now) > _TTL_SECONDS]
    for k in stale:
        _tasks.pop(k, None)
    if len(_tasks) > _MAX_ENTRIES:
        for k, _v in sorted(_tasks.items(), key=lambda kv: kv[1].get("updated_at", 0))[: len(_tasks) - _MAX_ENTRIES]:
            _tasks.pop(k, None)


def begin(task_id: str | None, phase: str = "prepare", text: str | None = None,
          total: int = 0, done: int = 0) -> None:
    """登记一个新任务；task_id 为空（老前端/未传）时静默忽略。"""
    if not task_id:
        return
    now = time.time()
    with _lock:
        _tasks[task_id] = {
            "phase": phase,
            "text": text or "",
            "pct": 0,
            "done": int(done),
            "total": int(total),
            "started_at": now,
            "updated_at": now,
            "finished": False,
            "error": None,
        }
        _prune_locked()


def update(task_id: str | None, *, phase: str | None = None, pct: int | None = None,
           done: int | None = None, total: int | None = None, text: str | None = None) -> None:
    """更新进度快照（未登记过的任务自动补登记，方便漏调 begin 的分支）。"""
    if not task_id:
        return
    with _lock:
        rec = _tasks.get(task_id)
        if rec is None:
            rec = {"phase": "prepare", "text": "", "pct": 0, "done": 0, "total": 0,
                   "started_at": time.time(), "updated_at": time.time(),
                   "finished": False, "error": None}
            _tasks[task_id] = rec
        if phase is not None:
            rec["phase"] = phase
        if text is not None:
            rec["text"] = text
        if pct is not None:
            rec["pct"] = max(0, min(100, int(pct)))
        if done is not None:
            rec["done"] = int(done)
        if total is not None:
            rec["total"] = int(total)
        rec["updated_at"] = time.time()


def finish(task_id: str | None, error: str | None = None) -> None:
    if not task_id:
        return
    with _lock:
        rec = _tasks.get(task_id)
        if rec is None:
            return
        # 幂等：已经收尾过的任务不再被后续的 finish()（比如 finally）覆盖成 100%
        if rec.get("finished") and not error:
            return
        rec["finished"] = True
        rec["updated_at"] = time.time()
        if error:
            rec["error"] = str(error)
            rec["phase"] = "error"
            rec["text"] = str(error)
        else:
            rec["pct"] = 100
            rec["phase"] = "finish"


def snapshot(task_id: str | None) -> dict | None:
    """读取快照；未知任务返回 None（前端据此判断有没有进度可用）。"""
    if not task_id:
        return None
    with _lock:
        rec = _tasks.get(task_id)
        if rec is None:
            return None
        out = dict(rec)
    out.pop("started_at", None)
    out.pop("updated_at", None)
    return out
