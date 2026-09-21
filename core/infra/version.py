import json
import os
import time
from concurrent.futures import ThreadPoolExecutor

import requests
from packaging import version

import config
from core.infra.logger import logger

CURRENT_VERSION = config.APP_VERSION
CHECK_URL = config.UPDATE_CHECK_URL
CHANGELOG_URL = getattr(config, "CHANGELOG_URL", "")

# 模拟浏览器请求头，防止部分平台（如 GitHub）拦截无 Header 的请求
_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Cache-Control': 'no-cache'  # 强制获取最新内容，防止缓存
}

# changelog.json 进程内缓存：更新日志不常变，避免每次检查更新都重新下载。
_changelog_cache = {"data": [], "ts": 0.0}
_CHANGELOG_TTL = 30 * 60  # 30 分钟


def _load_local_changelog():
    """
    读取仓库根目录的本地 changelog.json（与 config.py 同级）。
    仅用于开发/源码环境，方便不传到 Gitee 就先验证时间线。
    成功返回 list，读不到或格式不对返回 []。
    """
    try:
        path = os.path.join(os.path.dirname(os.path.abspath(config.__file__)), "changelog.json")
        if not os.path.isfile(path):
            return []
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        entries = data if isinstance(data, list) else data.get("changelog", [])
        if isinstance(entries, list):
            logger.debug(f"[dev] 读取本地 changelog.json 成功（{len(entries)} 个版本）: {path}")
            return entries
    except Exception as e:
        logger.debug(f"[dev] 读取本地 changelog.json 失败: {e}")
    return []


def fetch_changelog():
    """
    获取极简更新日志时间线（独立 changelog.json）。

    - 开发/源码环境：优先读本地 changelog.json，便于即时测试；本地没有再走远程。
    - 打包后：从 CHANGELOG_URL 拉取。
    与 version.json 分离，失败/超时一律不影响更新检测，只让时间线为空；
    远程成功结果带 30 分钟进程内缓存，失败时回退到上一次的缓存。
    """
    # 开发测试：本地优先（每次都读，改了立即生效，不走缓存）
    if config.is_dev_environment():
        local = _load_local_changelog()
        if local:
            _changelog_cache["data"] = local
            _changelog_cache["ts"] = time.time()
            return local
        logger.debug("[dev] 未找到本地 changelog.json，回退远程地址")

    if not CHANGELOG_URL:
        return []
    now = time.time()
    if _changelog_cache["data"] and now - _changelog_cache["ts"] < _CHANGELOG_TTL:
        return _changelog_cache["data"]
    try:
        logger.debug(f"请求更新日志地址: {CHANGELOG_URL}")
        resp = requests.get(CHANGELOG_URL, headers=_HEADERS, timeout=4)
        if resp.status_code == 200:
            data = resp.json()
            entries = data if isinstance(data, list) else data.get("changelog", [])
            if isinstance(entries, list):
                _changelog_cache["data"] = entries
                _changelog_cache["ts"] = now
                logger.debug(f"获取更新日志成功，共 {len(entries)} 个版本")
                return entries
    except Exception as e:
        logger.debug(f"获取 changelog 失败（不影响更新检测）: {e}")
    return _changelog_cache["data"]


def get_update_info():
    """
    从远程 JSON 文件检查更新信息。
    version.json（版本/下载地址）与 changelog.json（更新日志时间线）并行拉取。
    """
    logger.debug(f"开始检查更新，当前版本: {CURRENT_VERSION}")
    try:
        logger.debug(f"请求更新地址: {CHECK_URL}")
        # 并行请求 version.json 和 changelog.json，避免串行叠加网络延迟
        with ThreadPoolExecutor(max_workers=2) as ex:
            f_ver = ex.submit(requests.get, CHECK_URL, headers=_HEADERS, timeout=5)
            f_log = ex.submit(fetch_changelog)
            response = f_ver.result()
            changelog = f_log.result()

        if response.status_code == 200:
            remote_data = response.json()
            remote_v_str = remote_data.get("version", "0.0.0")
            logger.debug(f"远程版本: {remote_v_str}")

            # 兼容：独立 changelog.json 没拿到时，退回 version.json 内联字段（若有）
            if not changelog:
                changelog = remote_data.get("changelog", [])

            # 无论是否有更新，都把极简更新日志时间线带回前端：
            # 已是最新版本的用户也能在“检查更新”里看到近期版本亮点。
            changelog = changelog if isinstance(changelog, list) else []

            # 使用 packaging.version 可靠地对比版本号 (例如 1.1.0 > 1.0.9)
            if version.parse(remote_v_str) > version.parse(CURRENT_VERSION):
                logger.info(f"发现新版本: {CURRENT_VERSION} -> {remote_v_str}")
                return {
                    "has_update": True,
                    "latest_version": remote_v_str,
                    "current_version": CURRENT_VERSION,
                    # 获取下载地址字典，如果不存在则返回空字典
                    "mirrors": remote_data.get("mirrors", {}),
                    "update_log": remote_data.get("update_log", "作者很懒，没写更新说明。"),
                    "changelog": changelog,
                    "auto_update": remote_data.get("auto_update", {}),
                    "delta": remote_data.get("delta", {}),
                    "deltas": remote_data.get("deltas", [])
                }
            else:
                logger.debug(f"当前已是最新版本 ({CURRENT_VERSION})")
                return {
                    "has_update": False,
                    "latest_version": remote_v_str,
                    "current_version": CURRENT_VERSION,
                    "changelog": changelog,
                }
        else:
            logger.warning(f"检查更新请求失败，状态码: {response.status_code}")

    except Exception as e:
        logger.error(f"检查更新失败 (网络问题或JSON格式错误): {e}")

    # 默认返回无更新
    return {"has_update": False, "current_version": CURRENT_VERSION}
