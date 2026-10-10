"""插件中心的后端接口 + 插件前端静态资源服务。"""
from __future__ import annotations

from flask import Blueprint, jsonify, redirect, request, send_from_directory

from core.api.response import error, success
from core.infra.logger import logger
from core.plugins.manager import PluginError, plugin_manager

bp = Blueprint("plugins", __name__)


# ---------------------------------------------------------------------- 管理
@bp.get("/api/plugins")
def list_plugins():
    return success({"items": plugin_manager.list_public(), "root": str(plugin_manager.root)})


@bp.post("/api/plugins/check_update")
def check_update():
    """检查插件更新（读取远程 version_ext.json）。"""
    try:
        result = plugin_manager.check_updates()
    except PluginError as exc:
        return error(str(exc), 400)
    except Exception as exc:  # noqa: BLE001
        logger.warning("检查插件更新失败: %s", exc)
        return error(f"检查更新失败：{exc}", 500)
    return success(result)


@bp.post("/api/plugins/install")
def install_plugin():
    """从插件市场一键安装（下载清单里的 zip → md5 校验 → 解压导入）。"""
    body = request.get_json(silent=True) or {}
    plugin_id = str(body.get("id") or "").strip()
    entry = body.get("entry") if isinstance(body.get("entry"), dict) else None
    if not plugin_id:
        return error("缺少插件 id", 400)
    try:
        plugin = plugin_manager.update_plugin(plugin_id, entry)
    except PluginError as exc:
        return error(str(exc), 400)
    except Exception as exc:  # noqa: BLE001
        logger.error("安装插件 %s 失败: %s", plugin_id, exc, exc_info=True)
        return error(f"安装失败：{exc}", 500)
    return success({"plugin": plugin.public()})


@bp.post("/api/plugins/<plugin_id>/update")
def update_plugin(plugin_id: str):
    """下载并安装插件新版本。"""
    body = request.get_json(silent=True) or {}
    entry = body.get("entry") if isinstance(body.get("entry"), dict) else None
    try:
        plugin = plugin_manager.update_plugin(plugin_id, entry)
    except PluginError as exc:
        return error(str(exc), 400)
    except Exception as exc:  # noqa: BLE001
        logger.error("更新插件 %s 失败: %s", plugin_id, exc, exc_info=True)
        return error(f"更新失败：{exc}", 500)
    return success({"plugin": plugin.public()})


@bp.post("/api/plugins/rescan")
def rescan():
    plugin_manager.scan()
    return success({"items": plugin_manager.list_public()})


@bp.post("/api/plugins/import")
def import_zip():
    file = request.files.get("file")
    if file is None or not (file.filename or "").strip():
        return error("请选择要导入的插件 zip", 400)
    try:
        plugin = plugin_manager.import_zip(file)
    except (PluginError, PluginManifestError, ValueError) as exc:
        return error(str(exc), 400)
    except Exception as exc:  # noqa: BLE001
        logger.error("导入插件失败: %s", exc, exc_info=True)
        return error(f"导入失败：{exc}", 500)
    return success({"plugin": plugin.public()})


@bp.post("/api/plugins/import-folder")
def import_folder():
    body = request.get_json(silent=True) or {}
    folder = str(body.get("path") or "").strip()
    if not folder:
        return error("请提供插件文件夹路径", 400)
    try:
        plugin = plugin_manager.import_folder(folder)
    except (PluginError, PluginManifestError, ValueError) as exc:
        return error(str(exc), 400)
    except Exception as exc:  # noqa: BLE001
        logger.error("导入插件文件夹失败: %s", exc, exc_info=True)
        return error(f"导入失败：{exc}", 500)
    return success({"plugin": plugin.public()})


@bp.post("/api/plugins/<plugin_id>/enable")
def enable_plugin(plugin_id: str):
    try:
        plugin = plugin_manager.set_enabled(plugin_id, True)
    except PluginError as exc:
        return error(str(exc), 404)
    except Exception as exc:  # noqa: BLE001
        logger.error("启用插件 %s 失败: %s", plugin_id, exc, exc_info=True)
        return error(f"启用失败：{exc}", 500)
    return success({"plugin": plugin.public()})


@bp.post("/api/plugins/<plugin_id>/disable")
def disable_plugin(plugin_id: str):
    try:
        plugin = plugin_manager.set_enabled(plugin_id, False)
    except PluginError as exc:
        return error(str(exc), 404)
    except Exception as exc:  # noqa: BLE001
        logger.error("停用插件 %s 失败: %s", plugin_id, exc, exc_info=True)
        return error(f"停用失败：{exc}", 500)
    return success({"plugin": plugin.public()})


@bp.delete("/api/plugins/<plugin_id>")
def remove_plugin(plugin_id: str):
    try:
        plugin_manager.remove(plugin_id)
    except PluginError as exc:
        return error(str(exc), 404)
    except Exception as exc:  # noqa: BLE001
        logger.error("删除插件 %s 失败: %s", plugin_id, exc, exc_info=True)
        return error(f"删除失败：{exc}", 500)
    return success({"id": plugin_id})


# ---------------------------------------------------------------------- 界面
@bp.get("/plugin-ui/<plugin_id>/")
def plugin_ui_index(plugin_id: str):
    return _serve_ui(plugin_id, None)


@bp.get("/plugin-ui/<plugin_id>")
def plugin_ui_index_no_slash(plugin_id: str):
    return redirect(f"/plugin-ui/{plugin_id}/")


@bp.get("/plugin-ui/<plugin_id>/<path:subpath>")
def plugin_ui_asset(plugin_id: str, subpath: str):
    return _serve_ui(plugin_id, subpath)


def _serve_ui(plugin_id: str, subpath: str | None):
    plugin = plugin_manager.get(plugin_id)
    if plugin is None or plugin.ui_dir is None:
        return error("插件不存在或没有前端界面", 404)
    ui_dir = plugin.ui_dir
    if not ui_dir.is_dir():
        return error("插件前端目录缺失", 404)
    filename = subpath or plugin.entry_file
    try:
        resp = send_from_directory(str(ui_dir), filename)
    except Exception:  # noqa: BLE001
        return error("资源不存在", 404)
    if filename.lower().endswith(".html"):
        resp.headers["Cache-Control"] = "no-store"
    return resp


# 延迟导入，避免循环依赖
from core.plugins.manifest import PluginManifestError  # noqa: E402
