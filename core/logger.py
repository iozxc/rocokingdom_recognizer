from config import get_external_path
import logging
from pathlib import Path

import config


# ----------------日志模块----------------
def setup_app_logger():
    """初始化应用日志，日志目录 ./logs，最多保留20个日志文件，单个最大5MB"""
    log_dir = Path(get_external_path("debug"))
    log_dir.mkdir(exist_ok=True)
    log_file = log_dir / "debug.log"

    from logging.handlers import RotatingFileHandler

    logger = logging.getLogger("rk_app")
    logger.setLevel(config.LOG_LEVEL)
    logger.propagate = False

    # 按大小轮转，单个5MB，最多20份
    handler = RotatingFileHandler(
        log_file,
        maxBytes=5 * 1024 * 1024,
        backupCount=20,
        encoding="utf‑8"
    )
    fmt = logging.Formatter("%(asctime)s - %(levelname)s - [%(filename)s:%(lineno)d - %(funcName)s] - %(message)s")
    handler.setFormatter(fmt)
    logger.addHandler(handler)
    return logger


logger = setup_app_logger()
