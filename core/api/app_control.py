"""主程序控制类接口：管理员权限检查 / 以管理员身份重启。"""
from __future__ import annotations

from flask import Blueprint, jsonify

bp = Blueprint("app_control", __name__)


@bp.get("/api/app/is_admin")
def app_is_admin():
    from core.services.elevation import is_admin

    return jsonify({"ok": True, "admin": bool(is_admin())})


@bp.post("/api/app/restart_as_admin")
def app_restart_as_admin():
    """以管理员身份重启主程序（会弹 UAC；确认后当前进程退出）。"""
    from core.infra.logger import logger
    from core.services.elevation import exit_process_soon, restart_as_admin

    ok, reason = restart_as_admin()
    if ok:
        exit_process_soon(1.0)
    else:
        logger.info("以管理员身份重启未成功：%s", reason)
    return jsonify({"ok": ok, "reason": reason})
