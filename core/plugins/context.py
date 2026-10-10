"""插件运行上下文。

主程序加载插件后端时，把 PluginContext 传给插件的 create_app(ctx)。
插件只能用 ctx 暴露的能力，不直接依赖主程序的内部模块，保证插件可独立开发/打包。
"""
from __future__ import annotations

import logging
from pathlib import Path


class PluginContext:
    def __init__(
        self,
        *,
        plugin_id: str,
        version: str,
        plugin_dir: Path,
        data_dir: Path,
        app_version: str,
        log: logging.Logger,
    ) -> None:
        self.id = plugin_id
        self.version = version
        self.dir = Path(plugin_dir)
        self.data_dir = Path(data_dir)
        self.app_version = app_version
        self.log = log
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.captures_dir = self.data_dir / "captures"
        self.captures_dir.mkdir(parents=True, exist_ok=True)

    def resolve(self, relative: str) -> Path:
        """把插件内的相对路径解析成绝对路径（防止越出插件目录）。"""
        target = (self.dir / str(relative)).resolve()
        if not str(target).startswith(str(self.dir.resolve())):
            raise ValueError("路径越出插件目录")
        return target

    def log_line(self, message: str) -> None:
        self.log.info("[plugin:%s] %s", self.id, message)
