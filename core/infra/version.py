import requests
from packaging import version

import config
from core.infra.logger import logger

CURRENT_VERSION = config.APP_VERSION
CHECK_URL = config.UPDATE_CHECK_URL


def get_update_info():
    """
    从远程 JSON 文件检查更新信息
    """
    logger.debug(f"开始检查更新，当前版本: {CURRENT_VERSION}")
    try:
        # 模拟浏览器请求头，防止部分平台（如 GitHub）拦截无 Header 的请求
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Cache-Control': 'no-cache'  # 强制获取最新内容，防止缓存
        }

        logger.debug(f"请求更新地址: {CHECK_URL}")

        # 发起请求，超时设为 5 秒
        response = requests.get(CHECK_URL, headers=headers, timeout=5)

        if response.status_code == 200:
            remote_data = response.json()
            remote_v_str = remote_data.get("version", "0.0.0")
            logger.debug(f"远程版本: {remote_v_str}")

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
                    "auto_update": remote_data.get("auto_update", {}),
                    "delta": remote_data.get("delta", {}),
                    "deltas": remote_data.get("deltas", [])
                }
            else:
                logger.debug(f"当前已是最新版本 ({CURRENT_VERSION})")
        else:
            logger.warning(f"检查更新请求失败，状态码: {response.status_code}")

    except Exception as e:
        logger.error(f"检查更新失败 (网络问题或JSON格式错误): {e}")

    # 默认返回无更新
    return {"has_update": False, "current_version": CURRENT_VERSION}
