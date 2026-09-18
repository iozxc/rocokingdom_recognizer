import json
import threading
import time

from core.auth import client as auth_client
from core.services import account_store
from core.services.user_storage import CLIENT_LEVEL_KEYS, CLOUD_SYNC_STATE_KEY, user_storage

try:
    from core.infra.logger import logger
except Exception:  # pragma: no cover
    import logging
    logger = logging.getLogger(__name__)

PAIR_PATH = "/api/user_data/pair_code"
GET_PATH = "/api/user_data/get"
PUT_PATH = "/api/user_data/put"
META_PATH = "/api/user_data/meta"
BINDINGS_PATH = "/api/user_data/bindings"
REVOKE_PATH = "/api/user_data/bindings/revoke"

REQUEST_TIMEOUT = 12

_sync_lock = threading.Lock()
_applying_remote = False
_last_sync_at = 0.0
_last_error = None

_last_push_at = 0.0
_cloud_updated_at = None
_cloud_updated_ts = 0
_last_seen_cloud_ts = 0

# 上面这几个时间存在用户自己的 roco_user_data.json 顶层（客户端级字段），
# 用户没法拿它们做对比。字段名在 user_storage.CLIENT_LEVEL_KEYS 里受保护，
_CLIENT_STATE_KEY = CLOUD_SYNC_STATE_KEY
_client_state_loaded = False


def _to_float(value):
    try:
        return float(value) or 0.0
    except (TypeError, ValueError):
        return 0.0


def _load_client_state():
    """首次用到时把上次的同步时间从用户 JSON 读回内存（跨重启保留）。"""
    global _client_state_loaded, _last_sync_at, _last_push_at
    global _cloud_updated_at, _cloud_updated_ts, _last_seen_cloud_ts
    if _client_state_loaded:
        return
    _client_state_loaded = True
    try:
        state = (user_storage.load() or {}).get(_CLIENT_STATE_KEY)
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[cloud] 读取本机同步时间失败: {e}")
        return
    if not isinstance(state, dict):
        return
    _last_sync_at = _to_float(state.get("lastSyncAt"))
    _last_push_at = _to_float(state.get("lastPushAt"))
    _last_seen_cloud_ts = int(_to_float(state.get("lastSeenCloudTs")))
    _cloud_updated_ts = int(_to_float(state.get("cloudUpdatedTs")))
    at = state.get("cloudUpdatedAt")
    _cloud_updated_at = at if isinstance(at, str) and at else None


def _save_client_state():
    """把同步时间写回用户 JSON（失败不影响同步本身）。"""
    try:
        user_storage.save({
            _CLIENT_STATE_KEY: {
                "lastSyncAt": _last_sync_at,
                "lastPushAt": _last_push_at,
                "lastSeenCloudTs": _last_seen_cloud_ts,
                "cloudUpdatedAt": _cloud_updated_at,
                "cloudUpdatedTs": _cloud_updated_ts,
            }
        })
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[cloud] 保存本机同步时间失败: {e}")


# --------------------------------------------------------------------------- #
# HTTP
# --------------------------------------------------------------------------- #
def _signed(extra=None):
    """构造带 HMAC 签名的请求体。"""
    mc = auth_client.get_machine_code()
    ts, sign = auth_client.make_sign(mc)
    body = {"machine_code": mc, "timestamp": ts, "sign": sign}
    if extra:
        body.update(extra)
    return body


def _post(path, body, timeout=REQUEST_TIMEOUT):
    resp = auth_client._post_api(path, body, timeout=timeout)
    try:
        data = resp.json()
    except Exception:
        data = {}
    if not isinstance(data, dict):
        data = {}
    data["_status"] = resp.status_code
    return data


def request_pair_code():
    """申请一次性配对码（给网页端绑定用）。"""
    try:
        data = _post(PAIR_PATH, _signed())
    except Exception as e:
        logger.warning(f"[cloud] 申请配对码失败: {e}")
        return {"ok": False, "msg": f"无法连接云端：{e}"}
    if not data.get("ok"):
        return {"ok": False, "msg": data.get("msg") or f"HTTP {data.get('_status')}"}
    return data


def pull():
    try:
        return _post(GET_PATH, _signed())
    except Exception as e:
        return {"ok": False, "msg": f"无法连接云端：{e}"}


def list_bindings():
    try:
        data = _post(BINDINGS_PATH, _signed())
    except Exception as e:
        return {"ok": False, "msg": f"无法连接云端：{e}"}
    if not data.get("ok"):
        return {"ok": False, "msg": data.get("msg") or f"HTTP {data.get('_status')}"}
    return data


def revoke_binding(web_code):
    """撤销某个网页端的同步权限。"""
    try:
        data = _post(REVOKE_PATH, _signed({"target_web_code": web_code}))
    except Exception as e:
        return {"ok": False, "msg": f"无法连接云端：{e}"}
    if not data.get("ok"):
        return {"ok": False, "msg": data.get("msg") or f"HTTP {data.get('_status')}"}
    return data


def push(payload, version):
    try:
        return _post(PUT_PATH, _signed({"version": int(version), "platform": "app", "payload": payload}))
    except Exception as e:
        return {"ok": False, "msg": f"无法连接云端：{e}"}


# --------------------------------------------------------------------------- #
# 合并（与网页端规则一致）
# --------------------------------------------------------------------------- #
def _local_archive():
    archive = account_store.export_archive()
    for entry in archive.get("accounts") or []:
        payload = entry.get("payload") if isinstance(entry, dict) else None
        if isinstance(payload, dict):
            for key in CLIENT_LEVEL_KEYS:
                payload.pop(key, None)
    return archive


def _check_account_limit(archive):
    """账号数超上限就拒绝上传（不主动删用户已有账号）。"""
    count = len((archive or {}).get("accounts") or [])
    limit = getattr(account_store, "MAX_ACCOUNTS", 5)
    if count > limit:
        return f"本机有 {count} 个账号，超过了 {limit} 个的上限。请先删到只剩 {limit} 个再同步。"
    return None


# --------------------------------------------------------------------------- #
# 同步
# --------------------------------------------------------------------------- #
def pull_overwrite(reason="manual"):
    global _applying_remote, _last_sync_at, _last_error
    _load_client_state()
    if not _sync_lock.acquire(blocking=False):
        return {"ok": False, "msg": "正在同步中"}
    try:
        cloud = pull()
        if not cloud.get("ok"):
            msg = cloud.get("msg") or "拉取云端数据失败"
            _last_error = msg
            return {"ok": False, "msg": msg}
        if not cloud.get("exists"):
            _last_error = None
            return {"ok": False, "msg": "云端还没有数据，请先点「本地覆盖云端」"}

        payload = cloud.get("payload") or {}
        _applying_remote = True
        try:
            # 多账号存档 → 整体替换本机全部账号；旧格式（单账号）走原来的写法
            if account_store.is_multi_archive(payload):
                result = account_store.replace_from_archive(payload)
                msg = f"已用云端数据覆盖本地（{result.get('count')} 个账号）"
            else:
                user_storage.save({
                    "encounteredPets": payload.get("encounteredPets") or {},
                    "encounteredPets2": payload.get("encounteredPets2") or {},
                    "thresholds": payload.get("thresholds") or {},
                })
                msg = "已用云端数据覆盖本地"
        finally:
            _applying_remote = False
        global _cloud_updated_at, _cloud_updated_ts, _last_seen_cloud_ts
        _last_sync_at = time.time()
        _cloud_updated_at = cloud.get("updated_at") or _cloud_updated_at
        _cloud_updated_ts = int(cloud.get("updated_at_ts") or _cloud_updated_ts or 0)
        if _cloud_updated_ts:
            _last_seen_cloud_ts = _cloud_updated_ts
        _last_error = None
        _save_client_state()
        logger.info(f"[cloud] {msg}（{reason}）")
        return {"ok": True, "msg": msg}
    except Exception as e:
        _last_error = str(e)
        logger.warning(f"[cloud] 覆盖本地失败（{reason}）: {e}", exc_info=True)
        return {"ok": False, "msg": str(e)}
    finally:
        _sync_lock.release()


def push_overwrite(reason="manual"):
    global _last_sync_at, _last_error
    _load_client_state()
    if not _sync_lock.acquire(blocking=False):
        return {"ok": False, "msg": "正在同步中"}
    try:
        archive = _local_archive()
        limit_msg = _check_account_limit(archive)
        if limit_msg:
            _last_error = limit_msg
            return {"ok": False, "msg": limit_msg}
        cloud = pull()
        remote_version = int(cloud.get("version") or 0) if cloud.get("ok") else 0
        version = max(int(time.time() * 1000), remote_version + 1)
        res = push(archive, version)
        if not res.get("ok"):
            msg = res.get("msg") or "上传云端失败"
            _last_error = msg
            return {"ok": False, "msg": msg}
        global _last_push_at, _cloud_updated_at, _cloud_updated_ts, _last_seen_cloud_ts
        _last_sync_at = time.time()
        _last_push_at = _last_sync_at
        _cloud_updated_at = res.get("updated_at") or _cloud_updated_at
        _cloud_updated_ts = int(res.get("updated_at_ts") or _cloud_updated_ts or 0)
        if _cloud_updated_ts:
            _last_seen_cloud_ts = _cloud_updated_ts
        _last_error = None
        _save_client_state()
        count = len((archive or {}).get("accounts") or [])
        logger.info(f"[cloud] 已用本地数据覆盖云端（{reason}，{count} 个账号）")
        return {"ok": True, "msg": f"已用本地数据覆盖云端（{count} 个账号）"}
    except Exception as e:
        _last_error = str(e)
        logger.warning(f"[cloud] 覆盖云端失败（{reason}）: {e}", exc_info=True)
        return {"ok": False, "msg": str(e)}
    finally:
        _sync_lock.release()


def refresh_meta():
    global _cloud_updated_at, _cloud_updated_ts
    _load_client_state()
    try:
        data = _post(META_PATH, _signed())
    except Exception as e:
        return {"ok": False, "msg": f"无法连接云端：{e}"}
    if not data.get("ok"):
        return {"ok": False, "msg": data.get("msg") or f"HTTP {data.get('_status')}"}
    exists = bool(data.get("exists"))
    if exists:
        _cloud_updated_at = data.get("updated_at") or _cloud_updated_at
        _cloud_updated_ts = int(data.get("updated_at_ts") or _cloud_updated_ts or 0)
    else:
        _cloud_updated_at = None
        _cloud_updated_ts = 0
    _save_client_state()
    return {
        "ok": True,
        "exists": exists,
        "version": int(data.get("version") or 0),
        "bytes": int(data.get("bytes") or 0),
        "updatedAt": _cloud_updated_at,
        "updatedAtTs": _cloud_updated_ts,
    }


def get_status():
    _load_client_state()
    return {
        "ok": True,
        "lastSyncAt": _last_sync_at,
        "lastPushAt": _last_push_at,
        "cloudUpdatedAt": _cloud_updated_at,
        "cloudAhead": bool(_cloud_updated_ts and _last_seen_cloud_ts and _cloud_updated_ts > _last_seen_cloud_ts),
        "lastError": _last_error,
        "syncing": _sync_lock.locked(),
    }
