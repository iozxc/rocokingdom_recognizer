"""图标目录服务：按试炼读取并缓存精灵名称。"""
from core.icon_names import scan_icon_names


class IconCatalog:
    """图标名目录缓存（进程内单例，API 与桌面桥接共用一份）。"""

    def __init__(self):
        self._names_dict = {}

    def get_names(self, trial_key="grass"):
        """返回 {"map1": ["小拉塔", ...], ...}；按试炼首次调用时扫描并缓存。

        - 在 Flask 请求上下文内调用可省略 app；
        - 在请求上下文外（如桌面桥接线程）需传入 Flask app 实例。
        """
        if trial_key not in self._names_dict:
            self._names_dict[trial_key] = scan_icon_names(trial_key)
        return self._names_dict[trial_key]

    def invalidate(self, trial_key=None):
        """清空缓存（图标库变化后调用）；不传则清空全部试炼。"""
        if trial_key is None:
            self._names_dict = {}
        else:
            self._names_dict.pop(trial_key, None)


# 全局单例
icon_catalog = IconCatalog()
