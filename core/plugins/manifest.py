"""插件清单（plugin.json）的解析与校验。

一个插件就是一个目录，根目录下必须有 plugin.json。清单示例见
RocoKingdom_Extension/packet_helper/plugin.json。
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{1,63}$")
SAFE_REL_RE = re.compile(r"^[^\\/:*?\"<>|]+(?:[\\/][^\\/:*?\"<>|]+)*$")


class PluginManifestError(ValueError):
    """清单缺失或非法。"""


@dataclass
class PluginManifest:
    id: str
    name: str
    version: str
    description: str = ""
    author: str = ""
    homepage: str = ""
    platform: str = "pc"
    # 版本兼容范围（见 core/plugins/version.py）：
    #   min_app_version = 主程序最低版本（含），低于它视为不兼容；
    #   max_app_version = 主程序最高版本（含），高于它视为不兼容（主程序升级后接口可能变了），空 = 不限。
    min_app_version: str = "0.0.0"
    max_app_version: str = ""
    # 需要管理员权限才用得起来（如抓包）：主程序在「启用」时会主动申请提权
    require_admin: bool = False
    # 依赖的其它插件：[{"id": "roco.packet_helper", "min_version": "0.4.0"}]
    # 安装时会自动把缺的/版本不够的依赖一起装上
    requires: list[dict] = field(default_factory=list)
    entry_backend: str = ""
    entry_frontend: str = ""
    ui_title: str = ""
    ui_subtitle: str = ""
    ui_icon: str = ""
    ui_accent: str = "#38bdf8"
    ui_tags: list[str] = field(default_factory=list)
    # 插件页面要不要按"整页"打开（如生育规划器这类需要大画布的工具）
    ui_fullscreen: bool = False
    # 可选的「同步源」声明：主程序据此在首页/插件页显示「同步」按钮
    sync_kind: str = ""
    sync_endpoint: str = ""
    sync_label: str = ""
    sync_description: str = ""
    raw: dict[str, Any] = field(default_factory=dict)

    # ------------------------------------------------------------------ 派生
    @property
    def title(self) -> str:
        return self.ui_title or self.name or self.id

    def to_public(self) -> dict:
        """给前端用的公开字段（不含原始清单全文）。"""
        return {
            "id": self.id,
            "name": self.name,
            "title": self.title,
            "version": self.version,
            "description": self.description,
            "author": self.author,
            "homepage": self.homepage,
            "platform": self.platform,
            "minAppVersion": self.min_app_version,
            "maxAppVersion": self.max_app_version,
            # ui.icon：可以是相对图片路径，也可以是一个语义图标名（如 radar / radio）
            "icon": self.ui_icon,
            "requireAdmin": self.require_admin,
            "requires": [dict(r) for r in self.requires],
            "subtitle": self.ui_subtitle,
            "accent": self.ui_accent,
            "tags": list(self.ui_tags),
            "fullscreen": self.ui_fullscreen,
            "hasBackend": bool(self.entry_backend),
            "hasFrontend": bool(self.entry_frontend),
            "sync": self.sync_public(),
        }

    def sync_public(self) -> dict | None:
        if not (self.sync_endpoint and self.sync_kind):
            return None
        return {
            "kind": self.sync_kind,
            "endpoint": self.sync_endpoint,
            "label": self.sync_label or "同步",
            "description": self.sync_description,
        }


def _require(cond: bool, message: str) -> None:
    if not cond:
        raise PluginManifestError(message)


def _safe_rel(value: str, label: str) -> str:
    value = str(value or "").strip().replace("\\", "/")
    if not value:
        return ""
    _require(".." not in value.split("/"), f"{label} 不能包含 '..'")
    _require(SAFE_REL_RE.match(value) is not None, f"{label} 含非法路径字符: {value}")
    return value


def _parse_requires(value) -> list[dict]:
    """解析 requires：只允许 [{id, min_version}]，非法项直接丢掉（不阻断加载）。"""
    out: list[dict] = []
    if not isinstance(value, list):
        return out
    for item in value:
        if not isinstance(item, dict):
            continue
        pid = str(item.get("id") or "").strip()
        if not ID_RE.match(pid):
            continue
        out.append({"id": pid, "min_version": str(item.get("min_version") or "").strip()})
    return out


def _is_icon_name(value: str) -> bool:
    """判断 ui.icon 是不是「语义图标名」（而不是相对图片路径）。"""
    raw = str(value or "").strip()
    return bool(raw) and "/" not in raw and "\\" not in raw and "." not in raw


def _parse_icon(value) -> str:
    """ui.icon 既允许是相对图片路径，也允许是语义图标名（前端映射到内置图标）。

    判定：不含路径分隔符、也不带扩展名 → 当成图标名（如 radar / radio / wifi）。
    """
    raw = str(value or "").strip()
    if not raw:
        return ""
    if "/" in raw or "\\" in raw or "." in raw:
        return _safe_rel(raw, "ui.icon")
    lowered = raw.lower()
    _require(
        re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,31}", lowered) is not None,
        f"ui.icon 图标名不合法（只允许小写字母/数字/-/_）：{raw}",
    )
    return lowered


def parse_manifest(raw: dict, base_dir: Path) -> PluginManifest:
    """把解析好的 plugin.json dict 变成 PluginManifest，并做基本校验。"""
    _require(isinstance(raw, dict), "plugin.json 必须是 JSON 对象")

    plugin_id = str(raw.get("id") or "").strip()
    _require(bool(plugin_id), "缺少 id 字段")
    _require(ID_RE.match(plugin_id) is not None, f"id 非法（只允许字母数字和 _ . -）：{plugin_id}")

    name = str(raw.get("name") or plugin_id).strip()
    version = str(raw.get("version") or "0.0.0").strip()

    entry = raw.get("entry") or {}
    _require(isinstance(entry, dict), "entry 必须是对象")
    entry_backend = _safe_rel(entry.get("backend") or "", "entry.backend")
    entry_frontend = _safe_rel(entry.get("frontend") or "", "entry.frontend")
    _require(bool(entry_backend or entry_frontend), "entry 至少要声明 backend 或 frontend 之一")

    ui = raw.get("ui") or {}
    _require(isinstance(ui, dict), "ui 必须是对象")
    tags = ui.get("tags") or []
    if isinstance(tags, str):
        tags = [tags]

    sync = raw.get("sync") or {}
    if not isinstance(sync, dict):
        sync = {}
    sync_endpoint = str(sync.get("endpoint") or "").strip()
    if sync_endpoint:
        _require(sync_endpoint.startswith("/"), "sync.endpoint 必须以 / 开头")
        _require(".." not in sync_endpoint, "sync.endpoint 不能包含 '..'")

    manifest = PluginManifest(
        id=plugin_id,
        name=name,
        version=version,
        description=str(raw.get("description") or "").strip(),
        author=str(raw.get("author") or "").strip(),
        homepage=str(raw.get("homepage") or "").strip(),
        platform=str(raw.get("platform") or "pc").strip().lower() or "pc",
        min_app_version=str(raw.get("min_app_version") or "0.0.0").strip(),
        max_app_version=str(raw.get("max_app_version") or "").strip(),
        require_admin=bool(raw.get("require_admin")),
        requires=_parse_requires(raw.get("requires")),
        entry_backend=entry_backend,
        entry_frontend=entry_frontend,
        ui_title=str(ui.get("title") or "").strip(),
        ui_subtitle=str(ui.get("subtitle") or "").strip(),
        ui_icon=_parse_icon(ui.get("icon") or ""),
        ui_accent=str(ui.get("accent") or "#38bdf8").strip() or "#38bdf8",
        ui_fullscreen=bool(ui.get("fullscreen")),
        ui_tags=[str(t) for t in tags if str(t).strip()],
        sync_kind=str(sync.get("kind") or "").strip(),
        sync_endpoint=sync_endpoint,
        sync_label=str(sync.get("label") or "").strip(),
        sync_description=str(sync.get("description") or "").strip(),
        raw=raw,
    )

    _validate_files(manifest, base_dir)
    return manifest


def _validate_files(manifest: PluginManifest, base_dir: Path) -> None:
    """确认清单里声明的入口文件真实存在且没跑出插件目录。"""
    base = base_dir.resolve()
    for label, rel in (("entry.backend", manifest.entry_backend), ("entry.frontend", manifest.entry_frontend)):
        if not rel:
            continue
        target = (base / rel).resolve()
        _require(str(target).startswith(str(base)), f"{label} 越出插件目录")
        _require(target.is_file(), f"{label} 指向的文件不存在：{rel}")
    if manifest.ui_icon and _is_icon_name(manifest.ui_icon):
        return  # 语义图标名（如 radar）不是文件，不用做存在性校验
    if manifest.ui_icon:
        icon = (base / manifest.ui_icon).resolve()
        if str(icon).startswith(str(base)) and not icon.is_file():
            manifest.ui_icon = ""
