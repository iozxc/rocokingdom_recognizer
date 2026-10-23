"""插件管理器：发现、导入、启停、挂载。

设计要点
--------
* 每个插件一个独立目录，根目录下有 plugin.json；
* 插件后端是一个独立的 WSGI 应用（plugin.create_app(ctx)），
  管理器用一个「按前缀分流」的 WSGI 调度器（_PluginDispatcher）把它挂到
  /api/plugin-run/<插件id>/ 下，与主应用同源；
* 插件前端是纯静态资源，由 /plugin-ui/<插件id>/ 提供，主程序用 iframe 展示；
* 启停不需要重启：mounts 字典在请求时读取，动态增删即可。
"""
from __future__ import annotations

import importlib.util
import json
import re
import shutil
import sys
import tempfile
import threading
import time
import zipfile
from pathlib import Path

import config
from core.infra.logger import logger
from core.plugins.context import PluginContext
from core.plugins.manifest import PluginManifest, PluginManifestError, parse_manifest
from core.plugins.report import report_plugin_usage
from core.plugins.version import describe_range, is_compatible

MOUNT_PREFIX = "/api/plugin-run/"
UI_PREFIX = "/plugin-ui/"
STATE_FILE = "plugins_state.json"


class PluginError(RuntimeError):
    pass


class InstalledPlugin:
    def __init__(self, manifest: PluginManifest, path: Path, source: str = "installed") -> None:
        self.manifest = manifest
        self.path = Path(path)
        self.source = source
        self.enabled = False
        self.error = ""
        self.app = None              # WSGI 应用（启用时创建）
        self.module = None
        self.installed_at = 0.0

    @property
    def id(self) -> str:
        return self.manifest.id

    @property
    def ui_dir(self) -> Path | None:
        if not self.manifest.entry_frontend:
            return None
        return (self.path / self.manifest.entry_frontend).resolve().parent

    @property
    def entry_file(self) -> str:
        if not self.manifest.entry_frontend:
            return ""
        return Path(self.manifest.entry_frontend).name

    def public(self) -> dict:
        data = self.manifest.to_public()
        ok, reason = is_compatible(
            config.APP_VERSION,
            self.manifest.min_app_version,
            self.manifest.max_app_version,
        )
        data.update(
            {
                # 版本兼容：不兼容时前端要挡住「启用」，并说明原因
                "compatible": ok,
                "compatibleReason": reason,
                "requiredRange": describe_range(self.manifest.min_app_version, self.manifest.max_app_version),
                "enabled": self.enabled,
                "error": self.error,
                "source": self.source,
                "installedAt": self.installed_at,
                "uiUrl": f"{UI_PREFIX}{self.id}/" if self.manifest.entry_frontend else "",
                "apiBase": f"{MOUNT_PREFIX}{self.id}" if self.manifest.entry_backend else "",
            }
        )
        return data


class PluginManager:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self.root, self.data_root = _resolve_storage()
        self.extra_roots = self._resolve_extra_roots()
        self.mounts: dict[str, object] = {}
        self.plugins: dict[str, InstalledPlugin] = {}
        self._app = None
        self._initialized = False

    # ------------------------------------------------------------------ 目录
    def _resolve_extra_roots(self) -> list[Path]:
        """ROCO_PLUGIN_DIRS：额外的（只读）插件目录，便于插件开发时直接挂载仓库。"""
        import os
        raw = os.environ.get("ROCO_PLUGIN_DIRS") or ""
        roots = []
        for item in raw.split(";"):
            item = item.strip()
            if item and Path(item).is_dir():
                roots.append(Path(item))
        return roots

    @property
    def usage_state_path(self) -> Path:
        """记录「哪些插件已经上报过使用」的本地文件（放在插件数据目录下）。"""
        return self.data_root / "plugin_usage_reported.json"

    def plugin_data_dir(self, plugin_id: str) -> Path:
        path = self.data_root / plugin_id
        path.mkdir(parents=True, exist_ok=True)
        return path

    # ------------------------------------------------------------------ 生命周期
    def initialize(self, app) -> None:
        """create_app 阶段调用：扫描插件、恢复启用状态、挂载。"""
        with self._lock:
            self._app = app
            self.root.mkdir(parents=True, exist_ok=True)
            self.data_root.mkdir(parents=True, exist_ok=True)
            self.scan()
            state = self._load_state()
            for plugin_id in state.get("enabled", []):
                plugin = self.plugins.get(plugin_id)
                if plugin is None:
                    continue
                try:
                    self.enable(plugin_id, persist=False)
                except Exception as exc:  # noqa: BLE001
                    plugin.error = str(exc)
                    logger.warning("插件 %s 启动失败: %s", plugin_id, exc)
            # 主应用处理其余所有请求；/api/plugin-run/<id> 交给对应插件。
            # 注意：必须用引用同一份 mounts 字典的调度器，否则运行期启停插件
            # （动态增删 mounts）不会生效。
            app.wsgi_app = _PluginDispatcher(app.wsgi_app, self.mounts)
            self._initialized = True
            logger.info("插件系统就绪：已安装 %d 个，启用 %d 个", len(self.plugins), len(self.mounts))

    def scan(self) -> dict[str, InstalledPlugin]:
        """重新扫描插件目录（含用户手工解压放进去的文件夹）。"""
        with self._lock:
            found: dict[str, InstalledPlugin] = {}
            for base, source in [(self.root, "installed")] + [(r, "dev") for r in self.extra_roots]:
                if not base.is_dir():
                    continue
                for child in sorted(base.iterdir()):
                    if not child.is_dir() or child.name.startswith("."):
                        continue
                    manifest_path = child / "plugin.json"
                    if not manifest_path.is_file():
                        continue
                    try:
                        raw = json.loads(manifest_path.read_text("utf-8"))
                        manifest = parse_manifest(raw, child)
                    except (OSError, ValueError, PluginManifestError) as exc:
                        logger.warning("跳过非法插件 %s: %s", child.name, exc)
                        continue
                    if manifest.platform not in ("pc", "all", ""):
                        logger.info("跳过非 PC 插件 %s（platform=%s）", manifest.id, manifest.platform)
                        continue
                    plugin = InstalledPlugin(manifest, child, source)
                    try:
                        plugin.installed_at = manifest_path.stat().st_mtime
                    except OSError:
                        plugin.installed_at = 0.0
                    found[manifest.id] = plugin

            # 保留旧实例的启用态（rescan 时不要丢）
            for plugin_id, plugin in found.items():
                previous = self.plugins.get(plugin_id)
                if previous is not None:
                    plugin.enabled = previous.enabled
                    plugin.app = previous.app
                    plugin.error = previous.error
            self.plugins = found
            self._sync_mounts()
            return found

    def _sync_mounts(self) -> None:
        """让 mounts 与当前「已启用且已加载」的插件保持一致。"""
        for plugin_id in list(self.mounts):
            if plugin_id not in self.plugins or not self.plugins[plugin_id].enabled:
                self.mounts.pop(f"{MOUNT_PREFIX}{plugin_id}", None)
        for plugin_id, plugin in self.plugins.items():
            if plugin.enabled and plugin.app is not None and plugin.manifest.entry_backend:
                self.mounts[f"{MOUNT_PREFIX}{plugin_id}"] = plugin.app

    @staticmethod
    def _compat(manifest: PluginManifest) -> tuple[bool, str]:
        return is_compatible(
            config.APP_VERSION,
            manifest.min_app_version,
            manifest.max_app_version,
        )

    # ------------------------------------------------------------------ 启停
    def enable(self, plugin_id: str, persist: bool = True) -> InstalledPlugin:
        with self._lock:
            plugin = self._require(plugin_id)
            ok, reason = self._compat(plugin.manifest)
            if not ok:
                raise PluginError(f"插件「{plugin.manifest.name}」与当前主程序不兼容：{reason}")
            if plugin.manifest.entry_backend and plugin.app is None:
                plugin.app = self._load_backend(plugin)
            plugin.enabled = True
            plugin.error = ""
            self._sync_mounts()
            if persist:
                self._save_state()
            # 首次启用/使用该插件时上报一次（本地已记录过就不再发请求）
            report_plugin_usage(plugin.id, plugin.manifest.version, self.usage_state_path)
            return plugin

    def disable(self, plugin_id: str, persist: bool = True) -> InstalledPlugin:
        with self._lock:
            plugin = self._require(plugin_id)
            plugin.enabled = False
            self.mounts.pop(f"{MOUNT_PREFIX}{plugin_id}", None)
            app = plugin.app
            plugin.app = None
            if app is not None:
                shutdown = getattr(app, "plugin_shutdown", None)
                if callable(shutdown):
                    try:
                        shutdown()
                    except Exception as exc:  # noqa: BLE001
                        logger.warning("插件 %s 停止回调异常: %s", plugin_id, exc)
            if persist:
                self._save_state()
            return plugin

    def set_enabled(self, plugin_id: str, enabled: bool) -> InstalledPlugin:
        return self.enable(plugin_id) if enabled else self.disable(plugin_id)

    # ------------------------------------------------------------------ 导入
    def import_zip(self, file_storage) -> InstalledPlugin:
        """导入上传的 zip：解压后把含 plugin.json 的目录安装到插件根。"""
        filename = getattr(file_storage, "filename", "") or "plugin.zip"
        with tempfile.TemporaryDirectory(prefix="roco_plugin_") as tmp:
            archive = Path(tmp) / "upload.zip"
            file_storage.save(str(archive))
            if not zipfile.is_zipfile(archive):
                raise PluginError("上传的文件不是合法的 zip")
            extract_dir = Path(tmp) / "extract"
            with zipfile.ZipFile(archive) as zf:
                _safe_extract(zf, extract_dir)
            return self._install_from_dir(_locate_plugin_root(extract_dir), origin=filename)

    def import_folder(self, folder: str) -> InstalledPlugin:
        """导入一个本机文件夹（解压后手动放进来、或插件仓库里的子项目目录）。"""
        src = Path(str(folder or "").strip())
        if not src.is_dir():
            raise PluginError(f"目录不存在：{src}")
        return self._install_from_dir(_locate_plugin_root(src), origin=str(src))

    def _install_from_dir(self, src: Path, origin: str) -> InstalledPlugin:
        raw = json.loads((src / "plugin.json").read_text("utf-8"))
        manifest = parse_manifest(raw, src)

        dest = self.root / manifest.id
        with self._lock:
            # 覆盖安装（含"更新"）时记住原本是否启用，装完自动恢复
            was_enabled = bool(self.plugins.get(manifest.id) and self.plugins[manifest.id].enabled)
            if dest.exists():
                if was_enabled:
                    self.disable(manifest.id, persist=False)
                shutil.rmtree(dest)
            shutil.copytree(src, dest, ignore=shutil.ignore_patterns("__pycache__", "*.pyc", ".git"))
            logger.info("插件已安装：%s ← %s", manifest.id, origin)
        self.scan()
        plugin = self.plugins.get(manifest.id)
        if plugin is None:
            raise PluginError("安装后未能识别插件清单")
        # 本地导入的插件即使跟当前主程序不兼容也**不删**（避免用户白装一遍），
        # 但标记出来并且拒绝启用：前端会显示「不兼容」和原因。
        compat_ok, compat_why = self._compat(manifest)
        if not compat_ok:
            plugin.error = compat_why
            logger.warning("插件 %s 与当前主程序不兼容：%s", manifest.id, compat_why)
        if was_enabled and compat_ok:
            try:
                self.enable(manifest.id, persist=False)
            except Exception as exc:  # noqa: BLE001
                plugin.error = str(exc)
                logger.warning("更新后自动启用失败 %s: %s", manifest.id, exc)
        self._save_state()
        return plugin

    def remove(self, plugin_id: str) -> None:
        with self._lock:
            plugin = self._require(plugin_id)
            if plugin.source == "dev":
                raise PluginError("开发目录（ROCO_PLUGIN_DIRS）里的插件不能从这里删除")
            # 删除前一定要先停：disable() 会调插件的 plugin_shutdown()，
            # 抓包插件的 dumpcap 子进程就是在这里被收掉的。
            # 条件放宽到「启用中 或 后端还挂着」，避免任何状态下留下后台进程。
            if plugin.enabled or plugin.app is not None:
                self.disable(plugin_id, persist=False)
            if plugin.path.exists():
                shutil.rmtree(plugin.path, ignore_errors=True)
            self.plugins.pop(plugin_id, None)
            self.mounts.pop(f"{MOUNT_PREFIX}{plugin_id}", None)
            self._save_state()

    # ------------------------------------------------------------------ 退出
    def shutdown_all(self) -> None:
        """停止全部已启用插件（主程序退出时调用，用于释放抓包子进程等资源）。"""
        with self._lock:
            for plugin in list(self.plugins.values()):
                app = plugin.app
                plugin.app = None
                if app is None:
                    continue
                shutdown = getattr(app, "plugin_shutdown", None)
                if callable(shutdown):
                    try:
                        shutdown()
                    except Exception as exc:  # noqa: BLE001
                        logger.warning("插件 %s 退出清理异常: %s", plugin.id, exc)
            self.mounts.clear()
            self._initialized = False

    # ------------------------------------------------------------------ 更新
    @property
    def manifest_url(self) -> str:
        return str(getattr(config, "PLUGIN_MANIFEST_URL", "") or "")

    def manifest_urls(self) -> list[str]:
        urls = [self.manifest_url]
        for extra in getattr(config, "PLUGIN_MANIFEST_FALLBACK_URLS", []) or []:
            if extra and extra not in urls:
                urls.append(str(extra))
        return [u for u in urls if u]

    def check_updates(self) -> dict:
        """拉取 version_ext.json，返回「已安装且有新版本」与「清单里可安装」的插件。

        多个清单地址会依次尝试；全部失败时报**可读的错误**（而不是抛 500）。
        """
        import requests

        urls = self.manifest_urls()
        if not urls:
            raise PluginError("未配置插件更新源（ROCO_PLUGIN_MANIFEST_URL）")

        data = None
        used_url = ""
        problems: list[str] = []
        for url in urls:
            try:
                resp = requests.get(url, timeout=8, headers={"Cache-Control": "no-cache"})
                if resp.status_code != 200:
                    hint = "（仓库或文件不是公开可访问）" if resp.status_code in (401, 403) else ""
                    problems.append(f"{url} → HTTP {resp.status_code}{hint}")
                    continue
                parsed = resp.json()
                if not isinstance(parsed, dict):
                    problems.append(f"{url} → 返回的不是 JSON 对象")
                    continue
                data = parsed
                used_url = url
                break
            except Exception as exc:  # noqa: BLE001
                problems.append(f"{url} → {type(exc).__name__}: {exc}")

        if data is None:
            detail = "；".join(problems) if problems else "未知错误"
            raise PluginError(f"读取插件更新清单失败：{detail}")

        entries = data.get("plugins") or []
        if not isinstance(entries, list):
            raise PluginError(f"更新清单格式不正确（缺少 plugins 数组）：{used_url}")

        updates, installable, catalog = [], [], []
        for entry in entries:
            if not isinstance(entry, dict) or not entry.get("id"):
                continue
            pid = str(entry["id"])
            current = self.plugins.get(pid)
            public = {
                "id": pid,
                "name": entry.get("name") or pid,
                "version": str(entry.get("version") or ""),
                "url": entry.get("url") or "",
                "md5": str(entry.get("md5") or ""),
                "size": entry.get("size") or 0,
                "changelog": entry.get("changelog") or "",
                "description": entry.get("description") or "",
                "author": entry.get("author") or "",
                "tags": entry.get("tags") or [],
                "icon": entry.get("icon") or "",
                "platform": entry.get("platform") or "pc",
                # 把版本范围一并透出：前端展示用，也是 update_plugin 早期拦截的依据
                "min_app_version": entry.get("min_app_version") or "",
                "max_app_version": entry.get("max_app_version") or "",
                # 依赖的其它插件（市场上也要能看到/自动一起装）
                "requires": entry.get("requires") or [],
            }
            # 版本兼容：清单条目也带 min/max_app_version，按当前主程序版本判断。
            # 不兼容的**不进** updates / installable，只在市场里展示原因，
            # 避免主程序升级后还把不适配的插件更新上去。
            entry_min = str(entry.get("min_app_version") or "")
            entry_max = str(entry.get("max_app_version") or "")
            entry_ok, entry_why = is_compatible(config.APP_VERSION, entry_min, entry_max)
            public["compatible"] = entry_ok
            public["compatibleReason"] = entry_why
            public["requiredRange"] = describe_range(entry_min, entry_max)

            # 版本号 < 1.0.0 = 测试阶段：只允许开发模式下载，普通人只能手动导入
            blocked = is_download_blocked(public["version"])
            if blocked:
                continue

            # 市场里也要能看到已安装的（标成已安装/可更新）
            public["installed"] = current is not None
            if current is not None:
                public["installedVersion"] = current.manifest.version
                public["enabled"] = bool(current.enabled)
                has_new = _version_gt(public["version"], current.manifest.version)
                public["updateAvailable"] = has_new
            else:
                public["installedVersion"] = ""
                public["enabled"] = False
                public["updateAvailable"] = False

            catalog.append(public)
            if not entry_ok:
                # 不兼容：既不提供安装也不提供更新（原因已在 public.compatibleReason 里）
                public["updateAvailable"] = False
                continue
            if current is None:
                installable.append(public)
            elif public["updateAvailable"]:
                public["currentVersion"] = current.manifest.version
                updates.append(public)

        return {
            "url": used_url,
            "updated": data.get("updated") or "",
            "appVersion": config.APP_VERSION,
            "updates": updates,
            "installable": installable,
            "catalog": catalog,
        }

    def update_plugin(
        self,
        plugin_id: str,
        entry: dict | None = None,
        _seen: set[str] | None = None,
    ) -> InstalledPlugin:
        """下载并安装插件新版本（md5 校验 + 覆盖安装 + 保留启用状态）。"""
        info = entry
        if info is None:
            checked = self.check_updates()
            info = next((u for u in checked["updates"] if u["id"] == plugin_id), None)
        if not info:
            raise PluginError("没有可用的插件更新")
        url = str(info.get("url") or "").strip()
        # 测试阶段（< 1.0.0）只允许开发模式下载；人工导入不受这条限制
        if is_download_blocked(str(info.get("version") or "")):
            raise PluginError(TEST_STAGE_HINT)
        # 先按清单声明的版本范围把关（放在下载之前，省得白下几十 KB）
        ok, why = is_compatible(
            config.APP_VERSION,
            str(info.get("min_app_version") or ""),
            str(info.get("max_app_version") or ""),
        )
        if not ok:
            raise PluginError(f"已阻止安装/更新：该插件与当前主程序不兼容。{why}")
        if not url:
            raise PluginError("更新清单里缺少下载地址（version_ext.json 的 url 字段）")
        if not url.lower().startswith(("http://", "https://")):
            raise PluginError(
                f"更新清单里的下载地址不是完整网址：{url}\n"
                "请用 build.py --url-base <下载目录> 重新生成 version_ext.json 后再发布。"
            )

        import hashlib
        import requests

        logger.info("插件更新下载：%s ← %s", plugin_id, url)
        resp = requests.get(url, timeout=120)
        resp.raise_for_status()
        payload = resp.content
        expect = str(info.get("md5") or "").lower()
        if expect:
            actual = hashlib.md5(payload).hexdigest().lower()
            if actual != expect:
                raise PluginError(f"更新包校验失败（md5 {actual} != {expect}）")

        with tempfile.TemporaryDirectory(prefix="roco_plugin_upd_") as tmp:
            archive = Path(tmp) / "update.zip"
            archive.write_bytes(payload)
            if not zipfile.is_zipfile(archive):
                raise PluginError("更新包不是合法的 zip")
            extract_dir = Path(tmp) / "extract"
            with zipfile.ZipFile(archive) as zf:
                _safe_extract(zf, extract_dir)
            root = _locate_plugin_root(extract_dir)
            # 再按**下载包里的 plugin.json** 复核一次：清单可能过期或被人改过
            try:
                downloaded = parse_manifest(json.loads((root / "plugin.json").read_text("utf-8")), root)
            except (OSError, ValueError, PluginManifestError) as exc:
                raise PluginError(f"更新包里的 plugin.json 不合法：{exc}") from exc
            ok2, why2 = self._compat(downloaded)
            if not ok2:
                raise PluginError(f"已阻止安装/更新：更新包与当前主程序不兼容。{why2}")
            # 市场清单是发布方声明的依赖，下载包里的 plugin.json 则是安装包本身的
            # 声明。两者取并集，避免旧安装包漏写 requires 时绕过前置组件安装。
            declared_ids = {str(req.get("id") or "") for req in downloaded.requires}
            for raw_req in info.get("requires") or []:
                if not isinstance(raw_req, dict):
                    continue
                rid = str(raw_req.get("id") or "").strip()
                if rid and rid not in declared_ids:
                    downloaded.requires.append(
                        {"id": rid, "min_version": str(raw_req.get("min_version") or "").strip()}
                    )
                    declared_ids.add(rid)
            # 先把前置插件装好并启用，再落地主插件。这样依赖失败时不会留下
            # “主插件显示已安装、实际却完全不能用”的半成品状态。
            seen = set(_seen or ()) | {plugin_id}
            self._install_required_plugins(downloaded, seen=seen)
            plugin = self._install_from_dir(root, origin=f"update:{url}")
        return plugin

    def _install_required_plugins(self, manifest: PluginManifest, seen: set[str] | None = None) -> list[str]:
        """把 manifest.requires 里缺的（或版本过低的）插件一并安装。

        依赖是插件的运行前提：安装成功后会自动启用；任何一个无法满足都会直接
        抛错，让上层保持“可重新安装”的状态，而不是静默留下坏掉的插件。
        """
        seen = set(seen or ())
        reqs = list(manifest.requires or [])
        if not reqs:
            return []
        try:
            catalog = self.check_updates().get("catalog") or []
        except Exception as exc:  # noqa: BLE001
            raise PluginError(f"读取插件清单失败，无法安装前置插件：{exc}") from exc
        by_id = {str(e.get("id") or ""): e for e in catalog}
        installed: list[str] = []
        problems: list[str] = []
        for req in reqs:
            rid = str(req.get("id") or "").strip()
            min_version = str(req.get("min_version") or "").strip()
            if not rid:
                continue
            if rid in seen:
                problems.append(f"检测到循环依赖：{rid}")
                continue
            current = self.plugins.get(rid)
            if current is not None and not (min_version and _version_gt(min_version, current.manifest.version)):
                # 已装且版本够：如果用户之前停用了前置插件，这里一并恢复。
                if not current.enabled:
                    try:
                        self.enable(rid)
                    except Exception as exc:  # noqa: BLE001
                        problems.append(f"{rid} 启用失败：{exc}")
                continue
            entry = by_id.get(rid)
            if not entry:
                problems.append(
                    f"{manifest.id} 依赖 {rid}"
                    f"{f' ≥ {min_version}' if min_version else ''}，但插件市场里没有可用的对应条目"
                )
                continue
            try:
                dep = self.update_plugin(rid, entry, _seen=seen)
                if not dep.enabled:
                    dep = self.enable(rid)
                seen.add(rid)
                installed.append(rid)
                logger.info("已随 %s 一起安装依赖插件 %s v%s", manifest.id, rid, dep.manifest.version)
            except Exception as exc:  # noqa: BLE001
                problems.append(f"{rid} 安装失败：{exc}")
        if problems:
            raise PluginError(
                f"插件「{manifest.name}」的前置组件没有准备完成："
                + "；".join(problems)
                + "。请检查网络后重试安装。"
            )
        return installed

    # ------------------------------------------------------------------ 查询
    def list_public(self) -> list[dict]:
        with self._lock:
            items = [p.public() for p in self.plugins.values()]
        items.sort(key=lambda it: (not it["enabled"], it["title"]))
        return items

    def get(self, plugin_id: str) -> InstalledPlugin | None:
        return self.plugins.get(plugin_id)

    def _require(self, plugin_id: str) -> InstalledPlugin:
        plugin = self.plugins.get(plugin_id)
        if plugin is None:
            raise PluginError(f"插件不存在：{plugin_id}")
        return plugin

    # ------------------------------------------------------------------ 加载
    def _load_backend(self, plugin: InstalledPlugin):
        entry = plugin.path / plugin.manifest.entry_backend
        if not entry.is_file():
            raise PluginError(f"插件后端入口不存在：{plugin.manifest.entry_backend}")
        module_name = "roco_plugin_" + re.sub(r"[^0-9A-Za-z_]", "_", plugin.id)
        for name in [n for n in list(sys.modules) if n == module_name or n.startswith(module_name + ".")]:
            sys.modules.pop(name, None)
        spec = importlib.util.spec_from_file_location(
            module_name, entry, submodule_search_locations=[str(entry.parent)]
        )
        if spec is None or spec.loader is None:
            raise PluginError("无法加载插件后端模块")
        module = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = module
        spec.loader.exec_module(module)
        if not hasattr(module, "create_app"):
            raise PluginError("插件后端缺少 create_app(ctx) 入口")
        ctx = PluginContext(
            plugin_id=plugin.id,
            version=plugin.manifest.version,
            plugin_dir=plugin.path,
            data_dir=self.plugin_data_dir(plugin.id),
            app_version=config.APP_VERSION,
            log=logger.getChild(f"plugin.{plugin.id}"),
        )
        app = module.create_app(ctx)
        if app is None:
            raise PluginError("插件 create_app(ctx) 返回空")
        plugin.module = module
        return app

    # ------------------------------------------------------------------ 状态
    @property
    def _state_path(self) -> Path:
        return self.root / STATE_FILE

    def _load_state(self) -> dict:
        try:
            data = json.loads(self._state_path.read_text("utf-8"))
            if isinstance(data, dict):
                return data
        except Exception:  # noqa: BLE001
            pass
        return {"enabled": []}

    def _save_state(self) -> None:
        enabled = [p.id for p in self.plugins.values() if p.enabled]
        payload = {"enabled": enabled, "updated_at": time.time()}
        try:
            self.root.mkdir(parents=True, exist_ok=True)
            self._state_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), "utf-8")
        except OSError as exc:
            logger.warning("保存插件状态失败: %s", exc)


def _locate_plugin_root(base: Path) -> Path:
    """在解压结果里定位插件根（plugin.json 在最外层，或只套了一层目录）。"""
    if (base / "plugin.json").is_file():
        return base
    candidates = [c for c in base.iterdir() if c.is_dir() and (c / "plugin.json").is_file()]
    if len(candidates) == 1:
        return candidates[0]
    if not candidates:
        raise PluginError("压缩包 / 文件夹里没有找到 plugin.json")
    raise PluginError("找到多个插件，请一次只导入一个")


def _safe_extract(zf: zipfile.ZipFile, dest: Path) -> None:
    """防止 zip slip：所有成员必须落在目标目录内。"""
    dest = dest.resolve()
    for member in zf.namelist():
        target = (dest / member).resolve()
        if not str(target).startswith(str(dest)):
            raise PluginError(f"压缩包含非法路径：{member}")
    zf.extractall(dest)


class _PluginDispatcher:
    """把一个主应用和若干「按前缀挂载」的插件应用合成一个 WSGI 应用。

    与 werkzeug 的 DispatcherMiddleware 行为一致，但关键区别是：这里始终引用
    传入的 mounts 字典本身，因此在运行期新增/移除插件（启停）会立即生效。
    """

    def __init__(self, app, mounts: dict) -> None:
        self.app = app
        self.mounts = mounts

    def __call__(self, environ, start_response):
        script = environ.get("PATH_INFO", "")
        path_info = ""
        while "/" in script:
            if script in self.mounts:
                app = self.mounts[script]
                break
            script, last_item = script.rsplit("/", 1)
            path_info = f"/{last_item}{path_info}"
        else:
            app = self.mounts.get(script, self.app)
        environ["SCRIPT_NAME"] = environ.get("SCRIPT_NAME", "") + script
        environ["PATH_INFO"] = path_info
        return app(environ, start_response)


def _resolve_storage() -> tuple[Path, Path]:
    r"""插件目录与插件数据目录。

    * 可用 ROCO_EXTENSIONS_DIR 显式指定；
    * **打包安装版**：固定放在 %LOCALAPPDATA%\RocoKingdomRecognizer\
      —— 插件是「用户数据」，不能跟 exe 一起放在 Program Files：那边可能没写权限，
      而且换目录重装/彻底卸载时会被连带清掉；
    * **源码运行（开发）**：放在项目目录下（extensions / extensions_data），方便直接放插件调试。
    """
    import os
    import sys

    env_root = (os.environ.get("ROCO_EXTENSIONS_DIR") or "").strip()
    if env_root:
        root = Path(env_root)
    elif getattr(sys, "frozen", False) or hasattr(sys, "_MEIPASS"):
        base = os.environ.get("LOCALAPPDATA") or os.path.join(os.path.expanduser("~"), "AppData", "Local")
        root = Path(base) / "RocoKingdomRecognizer" / "extensions"
    else:
        root = Path(config.get_external_path("extensions"))
    return root, root.parent / "extensions_data"


plugin_manager = PluginManager()



def _version_tuple(text: str) -> tuple[int, ...]:
    """把 "0.31.0" 解析成 (0, 31, 0)；解析不出来的部分直接停。"""
    parts: list[int] = []
    for chunk in re.split(r"[.\-+]", str(text or "").strip()):
        m = re.match(r"^(\d+)", chunk)
        if not m:
            break
        parts.append(int(m.group(1)))
    return tuple(parts) or (0,)


def is_test_stage(version: str) -> bool:
    """版本号 < 1.0.0 一律视为**测试阶段**。"""
    v = _version_tuple(version)
    return v < (1, 0, 0)


def is_download_blocked(version: str) -> bool:
    """测试阶段的插件，只允许**开发模式**（源码运行）下载；打包发行版一律拦住。

    注意：这条只挡「插件市场的一键下载 / 更新」，
    人工导入 zip 或把文件夹丢进 extensions/ 不受影响。
    """
    return is_test_stage(version) and not config.is_dev_environment()


TEST_STAGE_HINT = (
    "这个插件还在测试阶段（版本号 < 1.0.0），暂时不开放下载。"
    "拿测试包请手动导入 zip（插件管理 → 导入 zip），或把插件文件夹放进 extensions/。"
)


def _version_gt(candidate: str, current: str) -> bool:
    """candidate 是否比 current 新（用 packaging 比较，非法版本号按字符串兜底）。"""
    try:
        from packaging.version import InvalidVersion, Version

        try:
            return Version(str(candidate)) > Version(str(current))
        except InvalidVersion:
            return str(candidate) > str(current)
    except Exception:  # noqa: BLE001
        return str(candidate) > str(current)
