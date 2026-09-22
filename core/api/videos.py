"""首页「视频攻略」配置与封面代理 API。

设计目标（对齐 version.json / changelog.json 的热更方式）：
- 视频清单放在仓库根 `resources/videos.json`，同时镜像一份到 Gitee master；
  使用者每次只要改 JSON 再 push，客户端下次打开弹窗即拿到最新列表，无需发版。
- `embed` 字段允许直接粘贴 B 站投稿页那段 <iframe ...> 代码，前端会抽取 src。
- 桌面端从本机 origin 请求 hdslb 封面会被防盗链 403（已实测），
  所以封面统一走后端 /api/media/bili_cover 代理，由后端带 Referer 取图。
"""
import re
import threading
import time

from flask import Blueprint, Response, request

import config
from core.api.response import error, success
from core.infra.logger import logger

bp = Blueprint("videos", __name__)

# videos.json 进程内缓存：避免每次打开弹窗都联网阻塞 waitress 线程
_CACHE = {"data": None, "expires_at": 0.0}
_LOCK = threading.Lock()
_REFRESHING = False
_TTL = 600  # 10 分钟（与 chat.json 一致）

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Cache-Control": "no-cache",
}


def _videos_url() -> str:
    return getattr(config, "VIDEOS_URL", "") or ""


def _fetch_remote_videos():
    """从 Gitee raw 拉 videos.json（bytes）；失败返回 None。"""
    import concurrent.futures
    import requests

    url = _videos_url()
    if not url:
        return None
    # gitee raw 有两个等价入口，并行请求取最快成功的那个（和 chat.json 的做法一致）
    urls = [url]
    if "raw.giteeusercontent.com" not in url:
        urls.append(url.replace("https://gitee.com/", "https://raw.giteeusercontent.com/"))

    def _get(u):
        try:
            r = requests.get(u, timeout=4, headers=_HEADERS)
            if r.status_code == 200 and r.content:
                return r.content
        except Exception:
            pass
        return None

    with concurrent.futures.ThreadPoolExecutor(max_workers=len(urls)) as ex:
        for fut in concurrent.futures.as_completed([ex.submit(_get, u) for u in urls]):
            data = fut.result()
            if not data:
                continue
            try:
                import json as _json

                _json.loads(data)
            except Exception:
                continue
            return data
    return None


def _local_videos_bytes():
    """读取打包/本地的 resources/videos.json；不存在返回 None。"""
    import os

    try:
        path = os.path.join(config.get_resource_path("resources"), "videos.json")
        if os.path.isfile(path):
            with open(path, "rb") as f:
                return f.read()
    except Exception as e:
        logger.debug(f"读取本地 videos.json 失败: {e}")
    return None


def _update_cache(data: bytes):
    """写入缓存。内容没变则只续期，避免无谓改动 mtime / 反复落盘。"""
    with _LOCK:
        prev = _CACHE["data"]
        _CACHE["data"] = data
        _CACHE["expires_at"] = time.time() + _TTL
    return prev != data


def _bg_refresh(safe_path: str):
    """有旧缓存时后台刷新，避免请求卡在网络。"""
    global _REFRESHING
    try:
        content = _fetch_remote_videos()
        if content:
            try:
                import os

                os.makedirs(os.path.dirname(safe_path), exist_ok=True)
                with open(safe_path, "wb") as f:
                    f.write(content)
            except Exception:
                pass
            _update_cache(content)
            logger.debug("videos.json 后台刷新成功")
    except Exception as e:
        logger.warning(f"videos.json 后台刷新失败: {e}")
    finally:
        with _LOCK:
            _REFRESHING = False


@bp.route("/api/videos", methods=["GET"])
def api_videos():
    """返回视频攻略清单。命中 TTL 缓存直接返回；否则远程优先、本地兜底。"""
    global _REFRESHING
    import json as _json
    import os

    try:
        base = os.path.normpath(config.get_resource_path("resources"))
        safe_path = os.path.normpath(os.path.join(base, "videos.json"))

        with _LOCK:
            cached = _CACHE["data"]
            fresh = cached is not None and time.time() < _CACHE["expires_at"]
            refreshing = _REFRESHING

        if fresh:
            return Response(cached, mimetype="application/json; charset=utf-8")

        # 有旧缓存：先返回旧内容，后台刷新
        if cached is not None:
            if not refreshing:
                with _LOCK:
                    _REFRESHING = True
                threading.Thread(target=_bg_refresh, args=(safe_path,), daemon=True).start()
            return Response(cached, mimetype="application/json; charset=utf-8")

        # 无缓存：同步拉一次远程；失败回退本地
        content = _fetch_remote_videos()
        if content:
            changed = _update_cache(content)
            # 只在内容真的变了才落盘，避免每次冷启动都重写同一个文件
            if changed:
                try:
                    os.makedirs(os.path.dirname(safe_path), exist_ok=True)
                    with open(safe_path, "wb") as f:
                        f.write(content)
                except Exception:
                    pass
            return Response(content, mimetype="application/json; charset=utf-8")

        local = _local_videos_bytes()
        if local:
            _update_cache(local)
            return Response(local, mimetype="application/json; charset=utf-8")

        logger.warning("视频攻略配置远程与本地均不可用")
        return Response(
            _json.dumps({"status": "error", "message": "视频配置不可用"}, ensure_ascii=False),
            mimetype="application/json; charset=utf-8",
            status=200,
        )
    except Exception as e:
        logger.error(f"[GET /api/videos] 异常: {e}", exc_info=True)
        return error(str(e), 500)


def _is_allowed_cover(url: str) -> bool:
    """只允许代理已知的 B 站图片 CDN 域名，避免被当成任意 URL 代理（SSRF）。"""
    from urllib.parse import urlparse

    try:
        p = urlparse(url)
    except Exception:
        return False
    if p.scheme not in ("http", "https"):
        return False
    host = (p.hostname or "").lower()
    return any(host == h or host.endswith("." + h) for h in config.BILI_COVER_HOSTS)


@bp.route("/api/media/bili_cover", methods=["GET"])
def api_bili_cover():
    """B 站封面代理：带 Referer 取图并透传，规避 hdslb 对本机请求的 403。"""
    import requests

    url = (request.args.get("url") or "").strip()
    # 协议相对写法（//i1.hdslb.com/...）先补全，再校验域名白名单
    if url.startswith("//"):
        url = "https:" + url
    if not url or not _is_allowed_cover(url):
        return error("非法封面地址", 400)

    try:
        headers = dict(_HEADERS)
        headers["Referer"] = getattr(config, "BILI_COVER_REFERER", "https://www.bilibili.com/")
        resp = requests.get(url, headers=headers, timeout=8, stream=True)
        if resp.status_code != 200:
            return error(f"封面获取失败: {resp.status_code}", 502)
        ctype = resp.headers.get("Content-Type") or "image/jpeg"
        if not ctype.startswith("image/"):
            ctype = "image/jpeg"
        body = resp.content
        out = Response(body, mimetype=ctype)
        # 封面基本不变，允许浏览器缓存，减少重复代理
        out.headers["Cache-Control"] = "public, max-age=86400"
        return out
    except Exception as e:
        logger.warning(f"封面代理失败: {e}")
        return error("封面获取异常", 502)
