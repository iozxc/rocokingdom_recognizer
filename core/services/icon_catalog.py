"""图标目录服务：负责从 map_pets1.json 读取并缓存精灵名称。"""
from core.icon_names import scan_icon_names


class IconCatalog:
    """图标名目录缓存（进程内单例，API 与桌面桥接共用一份）。"""

    def __init__(self):
        self._names_dict = None

    def get_names(self, app=None):
        """返回 {"map1": ["小拉塔", ...], ...}；首次调用时扫描并缓存。

        - 在 Flask 请求上下文内调用可省略 app；
        - 在请求上下文外（如桌面桥接线程）需传入 Flask app 实例。
        """
        if self._names_dict is None:
            self._names_dict = scan_icon_names(app)
        return self._names_dict

    def invalidate(self):
        """清空缓存（图标库变化后调用）。"""
        self._names_dict = None


# 全局单例
icon_catalog = IconCatalog()
