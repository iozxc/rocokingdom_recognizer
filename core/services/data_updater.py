"""图鉴/关键数据更新服务：清单 md5 对比 + 异步下载替换。

数据清单（data_manifest.json）由 tools/pack_update.py 生成，
结构: {"version": "1.3.3", "files": [{"name": "datasets/datasets.db",
"md5": "...", "url": "...", "size": 123}]}

运行时可从服务器拉取远程清单，与本地清单中声明的 md5 逐项对比：
不一致的文件下载回来，并把本地清单同步为远程清单声明的 md5。
这里不校验本地文件本身的 md5，从而避免换行符/编码差异导致永远提示更新。
"""
import json
import os
import shutil
import threading
import time

import config
from core.logger import logger
from core.md5_utils import file_md5

_PROJECT_ROOT = os.path.dirname(os.path.abspath(config.__file__))

_JOB_LOCK = threading.Lock()
_JOB = {
    "state": "idle",  # idle | running | done | error
    "files": [],
    "message": "",
    "started_at": None,
    "finished_at": None,
}


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
    """对比远程清单与本地清单的文件 md5，返回需要更新的文件列表。

    不再逐个计算本地文件 md5（避免换行符/编码差异导致永远对不上且重复提示）：
    以远程清单声明为准，只要远程清单里某个文件的 md5 与本地清单不一致（或本地
    清单缺少该文件），就判定需要下载更新；下载成功后把本地清单同步为新的 md5。
    """
    remote = fetch_remote_manifest()
    if not remote:
        return {"has_update": False, "updates": [], "message": "未获取到远程数据清单"}

    local = load_local_manifest()
    local_by_name = {}
    for item in local:
        if isinstance(item, dict) and item.get("name"):
            local_by_name[item["name"]] = item

    updates = []
    for item in remote:
        if not isinstance(item, dict):
            continue
        name = item.get("name")
        remote_md5 = str(item.get("md5") or "").lower()
        url = item.get("url") or ""
        if not name or not remote_md5:
            continue
        # 没有下载地址就无法自动更新，跳过以免每次都提示更新、且下载阶段报错。
        if not url:
            continue
        local_item = local_by_name.get(name) or {}
        local_md5 = str(local_item.get("md5") or "").lower()
        if local_md5 != remote_md5:
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
    # 网络请求 + 清单对比放在锁外，避免阻塞 UI 线程的状态查询（get_job_status）。
    check = check_data_updates()
    files = check.get("updates", [])
    with _JOB_LOCK:
        # 拿锁期间可能已有任务被启动，二次确认
        if _JOB["state"] == "running":
            return get_job_status()
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
            done = False
            last_err = None
            # 下载 + md5 校验：失败自动重试一次；仍失败则置 error，不覆盖旧文件、不同步清单。
            for attempt in range(2):
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

                    actual_md5 = file_md5(tmp_path) if expect_md5 else None
                    if expect_md5 and actual_md5 != expect_md5:
                        # 下载文件与清单声明不一致：不覆盖旧文件、不同步清单，按失败处理，
                        # 避免把损坏/不完整的文件伪装成“已更新”。
                        raise RuntimeError(f"MD5 校验不一致（{actual_md5} != {expect_md5}）")

                    os.replace(tmp_path, target)
                    # 本地清单 md5 直接写远程清单声明的目标值，下次清单对比即一致，
                    # 避免下载后因本地文件与清单 md5 不一致而重复提示更新。
                    if expect_md5:
                        _update_local_manifest_entry(name, expect_md5, os.path.getsize(target))
                    with _JOB_LOCK:
                        _JOB["files"][index]["status"] = "done"
                    done = True
                    break
                except Exception as e:
                    last_err = e
                    if os.path.exists(tmp_path):
                        try:
                            os.remove(tmp_path)
                        except Exception:
                            pass
                    if attempt == 0:
                        logger.warning(f"下载更新失败 {name}，自动重试一次: {e}")
                    else:
                        logger.error(f"下载更新失败 {name}: {e}", exc_info=True)

            if not done:
                with _JOB_LOCK:
                    _JOB["files"][index]["status"] = "error"
                    _JOB["files"][index]["error"] = str(last_err)

            logger.info(f"数据更新进度 {index + 1}/{total}: {name}")

        # 数据落盘后清空相关缓存，保证新数据立即生效
        try:
            invalidate_map_pets_cache()
            icon_catalog.invalidate()
            from core.services.trials import invalidate_pokedex_info_cache
            invalidate_pokedex_info_cache()
            from core.api.main import invalidate_icons_cache
            invalidate_icons_cache()
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


def _update_local_manifest_entry(name, md5, size):
    """把本地 data_manifest.json 中某个文件的 md5 与 size 更新为实际值。"""
    try:
        path = config.DATA_MANIFEST_JSON
        if not os.path.exists(path):
            return
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        changed = False
        for item in data.get("files", []):
            if isinstance(item, dict) and item.get("name") == name:
                item["md5"] = md5
                item["size"] = size
                changed = True
        if changed:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            logger.info(f"已同步本地清单 md5/size: {name}")
    except Exception as e:
        logger.warning(f"更新本地清单 md5/size 失败 {name}: {e}")


def get_job_status():
    with _JOB_LOCK:
        return dict(_JOB, files=[dict(f) for f in _JOB["files"]])
