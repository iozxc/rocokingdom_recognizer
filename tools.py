import os
from pathlib import Path

from logger import logger


def clean_debug_folder(folder_path: str, max_count: int = 30):
    """
    清理debug截图文件夹，最多保留max_count张，删除最旧的文件
    :param folder_path: 文件夹路径
    :param max_count: 最大保留文件数量
    """
    logger.debug(f"开始清理debug文件夹: path={folder_path}, max_count={max_count}")

    folder = Path(folder_path)
    if not folder.exists():
        logger.debug(f"debug文件夹不存在，跳过清理: {folder_path}")
        return

    # 获取所有jpg图片，按修改时间升序（旧的在前）
    files = list(folder.glob("*.jpg"))
    if len(files) <= max_count:
        logger.debug(f"debug截图数量({len(files)})未超过上限({max_count})，无需清理")
        return

    # 按文件修改时间排序，旧文件放前面
    files.sort(key=lambda x: x.stat().st_mtime)
    need_remove = files[: len(files) - max_count]
    logger.info(f"共 {len(files)} 张截图，将删除最旧的 {len(need_remove)} 张")
    for f in need_remove:
        try:
            os.remove(f)
            logger.info(f"删除过期debug截图: {f.name}")
        except Exception as e:
            logger.warning(f"删除文件失败 {f.name}: {str(e)}")
