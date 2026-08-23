"""图标名目录：从 assets.db 扫描各地图下的图标名称。"""
import os

import config
from core.db import get_db
from core.logger import logger


def scan_icon_names(app=None):
    """从数据库扫描所有图片名，返回 {"map1": ["小拉塔", "迪莫"], ...}。

    在 Flask 请求上下文内可直接调用；在请求上下文外（如桌面桥接线程）
    需要传入 Flask app 实例，函数会自行创建应用上下文。
    """
    if app is not None:
        with app.app_context():
            return _scan()
    return _scan()


def _scan():
    names_dict = {map_name: [] for map_name in config.MAP_LIST}
    try:
        conn = get_db()
        cursor = conn.cursor()
        # 只需要查询路径字段，格式示例: "map1/迪莫.png"
        cursor.execute("SELECT path FROM icons")
        for row in cursor.fetchall():
            parts = row[0].split('/')
            if len(parts) == 2:
                map_name, filename = parts[0], parts[1]
                if map_name in names_dict:
                    names_dict[map_name].append(os.path.splitext(filename)[0])
        conn.close()

        total = sum(len(v) for v in names_dict.values())
        logger.info(f"图标名扫描完成，共 {total} 个图标: " +
                    ", ".join(f"{k}={len(v)}" for k, v in names_dict.items()))
    except Exception as e:
        logger.error(f"从数据库扫描图标名失败: {e}", exc_info=True)
    return names_dict
