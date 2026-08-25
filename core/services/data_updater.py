"""图鉴/关键数据更新服务：md5 对比 + 异步下载替换。

数据清单（data_manifest.json）由 tools/pack_update.py 生成，
结构: {"version": "1.3.3", "files": [{"name": "datasets/datasets.db",
"md5": "...", "url": "...", "size": 123}]}
运行时可从服务器拉取该清单，与本地文件 md5 对比后异步下载更新。
"""
import hashlib
import json
import os
import shutil
import threading
import time

import config
from core.logger import logger

_PROJECT_ROOT = os.path.dirname(os.path.abspath(config.__file__))

_JOB_LOCK = threading.Lock()
_JOB = {
    "state": "idle",  # idle | running | done | error
    "files": [],
    "message": "",
    "started_at": None,
    "finished_at": None,
}


def md5_file(path, chunk=1024 * 1024):
    h = hashlib.md5()
    with open(path, "rb") as f:
        while True:
            block = f.read(chunk)
            if not block:
                break
            h.update(block)
    return h.hexdigest()


def _read_manifest(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        files = data.get("files", [])
        return files if isinstance(files, list) else []
    except Exception as e:
        logger.warning(f"读取数据清单失败 {path}: {e}")
        return []


def load_local_manifest():
    """读取本地 datasets/data_manifest.json 的文件列表。"""
    return _read_manifest(config.DATA_MANIFEST_JSON)


def fetch_remote_manifest():
    """从服务器拉取数据清单；未配置 URL 或失败返回空列表。"""
    url = config.DATA_MANIFEST_URL
    if not url:
        return []
    try:
        import requests
        logger.info(f"获取图鉴数据清单: {url}")
        resp = requests.get(url, timeout=8)
        resp.raise_for_status()
        data = resp.json()
        files = data.get("files", [])
        return files if isinstance(files, list) else []
    except Exception as e:
        logger.warning(f"获取图鉴数据清单失败: {e}")
        return []


def resolve_target_path(name):
    """把清单里的相对路径（如 datasets/datasets.db）解析到本地目标路径。"""
    safe = name.replace("\\", "/").lstrip("/")
    return os.path.normpath(os.path.join(_PROJECT_ROOT, safe))


def check_data_updates():
    """对比本地文件与数据清单，返回需要更新的文件列表。"""
    manifest = fetch_remote_manifest()
    if not manifest:
        # 远程不可用时，用本地清单自检（仅提示本地缺失/损坏）
        manifest = load_local_manifest()
    if not manifest:
        return {"has_update": False, "updates": [], "message": "未配置或未获取到数据清单"}

    updates = []
    for item in manifest:
        if not isinstance(item, dict):
            continue
        name = item.get("name")
        expect_md5 = str(item.get("md5") or "").lower()
        if not name or not expect_md5:
            continue
        target = resolve_target_path(name)
        if not os.path.exists(target):
            updates.append({**item, "status": "missing"})
            continue
        try:
            if md5_file(target) != expect_md5:
                updates.append({**item, "status": "changed"})
        except Exception as e:
            logger.warning(f"计算 {target} md5 失败: {e}")
            updates.append({**item, "status": "changed"})

    return {
        "has_update": len(updates) > 0,
        "updates": updates,
        "message": f"发现 {len(updates)} 个文件需要更新" if updates else "数据已是最新",
    }


def start_data_update():
    """启动异步下载更新任务，返回任务状态快照。"""
    global _JOB
    with _JOB_LOCK:
        if _JOB["state"] == "running":
            return get_job_status()
        check = check_data_updates()
        files = check.get("updates", [])
        if not files:
            _JOB = {
                "state": "done",
                "files": [],
                "message": "没有需要更新的文件",
                "started_at": time.time(),
                "finished_at": time.time(),
            }
            return get_job_status()

        _JOB = {
            "state": "running",
            "files": [{"name": f["name"], "status": "pending", "progress": 0, "error": None} for f in files],
            "message": "开始下载更新",
            "started_at": time.time(),
            "finished_at": None,
        }
        payload = files

    threading.Thread(
        target=_run_download_job,
        args=(payload,),
        daemon=True,
        name="data-update-download",
    ).start()
    return get_job_status()


def _run_download_job(files):
    try:
        import requests
        from core.icon_names import invalidate_map_pets_cache
        from core.services.icon_catalog import icon_catalog

        total = len(files)
        for index, item in enumerate(files):
            name = item.get("name")
            url = item.get("url")
            expect_md5 = str(item.get("md5") or "").lower()
            target = resolve_target_path(name)

            with _JOB_LOCK:
                _JOB["files"][index]["status"] = "downloading"

            if not url:
                with _JOB_LOCK:
                    _JOB["files"][index]["status"] = "error"
                    _JOB["files"][index]["error"] = "未配置下载地址"
                continue

            tmp_path = f"{target}.tmp"
            try:
                os.makedirs(os.path.dirname(target), exist_ok=True)
                with requests.get(url, stream=True, timeout=30) as resp:
                    resp.raise_for_status()
                    total_size = int(resp.headers.get("Content-Length") or 0)
                    downloaded = 0
                    with open(tmp_path, "wb") as f:
                        for block in resp.iter_content(chunk_size=1024 * 256):
                            if not block:
                                continue
                            f.write(block)
                            downloaded += len(block)
                            with _JOB_LOCK:
                                if total_size > 0:
                                    _JOB["files"][index]["progress"] = min(100, round(downloaded / total_size * 100))
                with _JOB_LOCK:
                    _JOB["files"][index]["progress"] = 100

                if expect_md5 and md5_file(tmp_path) != expect_md5:
                    raise RuntimeError("MD5 校验失败")

                os.replace(tmp_path, target)
                with _JOB_LOCK:
                    _JOB["files"][index]["status"] = "done"
            except Exception as e:
                if os.path.exists(tmp_path):
                    try:
                        os.remove(tmp_path)
                    except Exception:
                        pass
                logger.error(f"下载更新失败 {name}: {e}", exc_info=True)
                with _JOB_LOCK:
                    _JOB["files"][index]["status"] = "error"
                    _JOB["files"][index]["error"] = str(e)

            logger.info(f"数据更新进度 {index + 1}/{total}: {name}")

        # 数据落盘后清空相关缓存，保证新数据立即生效
        try:
            invalidate_map_pets_cache()
            icon_catalog.invalidate()
        except Exception as e:
            logger.warning(f"更新后清空缓存失败: {e}")

        with _JOB_LOCK:
            errors = [f for f in _JOB["files"] if f["status"] == "error"]
            _JOB["state"] = "done" if not errors else "error"
            _JOB["message"] = "更新完成" if not errors else f"{len(errors)} 个文件下载失败"
            _JOB["finished_at"] = time.time()
    except Exception as e:
        logger.error(f"数据更新任务异常: {e}", exc_info=True)
        with _JOB_LOCK:
            _JOB["state"] = "error"
            _JOB["message"] = str(e)
            _JOB["finished_at"] = time.time()


def get_job_status():
    with _JOB_LOCK:
        return dict(_JOB, files=[dict(f) for f in _JOB["files"]])

