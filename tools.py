import os
from pathlib import Path

from logger import logger


def clean_debug_folder(folder_path: str, max_count: int = 30):
    """
    清理debug截图文件夹，最多保留max_count张，删除最旧的文件
    :param folder_path: 文件夹路径
    :param max_count: 最大保留文件数量
    """
    folder = Path(folder_path)
    if not folder.exists():
        return

    # 获取所有jpg图片，按修改时间升序（旧的在前）
    files = list(folder.glob("*.jpg"))
    if len(files) <= max_count:
        return

    # 按文件修改时间排序，旧文件放前面
    files.sort(key=lambda x: x.stat().st_mtime)
    need_remove = files[: len(files) - max_count]
    for f in need_remove:
        try:
            os.remove(f)
            logger.info(f"删除过期debug截图: {f.name}")
        except Exception as e:
            logger.warning(f"删除文件失败 {f.name}: {str(e)}")
