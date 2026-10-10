from __future__ import annotations

import json
import threading
from pathlib import Path

from core.infra.logger import logger


def _load_reported(path: Path) -> set[str]:
    try:
        raw = json.loads(path.read_text("utf-8"))
    except Exception:  # noqa: BLE001
        return set()
    items = raw.get("reported") if isinstance(raw, dict) else raw
    if not isinstance(items, list):
        return set()
    return {str(x) for x in items if str(x).strip()}


def _save_reported(path: Path, items: set[str]) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps({"reported": sorted(items)}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except Exception as exc:  # noqa: BLE001
        logger.debug("插件使用上报：写入本地记录失败（忽略）：%s", exc)


def _run(plugin_id: str, version: str, state_path: Path | None) -> None:
    try:
        import config
        import requests

        from core.auth.client import SERVER_BASE, get_machine_code, make_sign

        machine_code = get_machine_code()
        if not machine_code:
            return
        ts, sign = make_sign(machine_code)
        payload = {
            "machine_code": machine_code,
            "timestamp": ts,
            "sign": sign,
            "plugin_id": plugin_id,
            "plugin_version": version,
            "app_version": str(getattr(config, "APP_VERSION", "") or ""),
            "platform": "pc",
        }
        resp = requests.post(
            SERVER_BASE.rstrip("/") + "/api/plugins/report_usage",
            json=payload,
            timeout=8,
            verify=False,
        )
        data = resp.json() if getattr(resp, "ok", False) else {}
        if getattr(resp, "ok", False) and data.get("ok"):
            if state_path is not None:
                _save_reported(state_path, _load_reported(state_path) | {plugin_id})
            logger.info(
                "插件使用上报：%s v%s -> recorded=%s（该插件使用人数 %s）",
                plugin_id, version, data.get("recorded"), data.get("users"),
            )
        else:
            logger.debug(
                "插件使用上报未确认（下次启动会重试）：HTTP %s %s",
                getattr(resp, "status_code", "?"), data.get("msg"),
            )
    except Exception as exc:  # noqa: BLE001
        logger.debug("插件使用上报失败（下次启动会重试）：%s", exc)


def report_plugin_usage(plugin_id: str, version: str = "", state_path: Path | None = None) -> None:
    """首次使用某插件时异步上报一次；已上报过则直接跳过（不发请求）。"""
    pid = str(plugin_id or "").strip()
    if not pid:
        return
    if state_path is not None and pid in _load_reported(state_path):
        return
    threading.Thread(
        target=_run,
        args=(pid, str(version or ""), state_path),
        name="plugin-usage-report",
        daemon=True,
    ).start()
