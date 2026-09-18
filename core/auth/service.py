import threading
import time
import datetime

from core.auth import client as auth
from core.infra.logger import logger
from config import meta_reachable

# 快模式轮询间隔（秒）：用户正在“未授权”弹窗中（正在授权）。
POLL_INTERVAL = 1.0
# 慢模式轮询间隔（秒）：用户关掉了“未授权”弹窗（暂不想授权）。
POLL_SLOW = 5.0
# 等待授权上限（秒）：超过 2 分钟仍未授权，则停止轮询（不再发请求）。
POLL_TIMEOUT = 120

EVENT_TIMEOUT = 2.0
INITIAL_TIMEOUT = 6.0
# 网络异常/设备被删除后的重新验证间隔（秒）；设为较快，让删除后尽快回到新用户授权流程。
RETRY_DELAY = 1.0


class AuthState:
    """线程安全的授权状态。"""

    def __init__(self):
        self._lock = threading.Lock()
        self.status = "pending"        # pending / waiting / banned / expired / authorized / error
        self.machine_code = ""
        self.auth_code = ""
        self.expire_time = ""
        self.qq_id = ""
        self.msg = ""
        self.error = ""
        self.is_authorized = False
        self.offline_badge = False   

    def update(self, **kwargs):
        with self._lock:
            for key, value in kwargs.items():
                setattr(self, key, value)

    def snapshot(self):
        with self._lock:
            return {
                "status": self.status,
                "machine_code": self.machine_code,
                "auth_code": self.auth_code,
                "expire_time": self.expire_time,
                "qq_id": self.qq_id,
                "msg": self.msg,
                "error": self.error,
                "is_authorized": self.is_authorized,
                "offline_badge": self.offline_badge,
            }


_state = AuthState()
_start_lock = threading.Lock()
_report_lock = threading.Lock()
_thread = None
_open_reported = False
# 用户点“重新授权”后置 True：强制把设备当作“待绑定新用户”，不再被“已过期”弹回。
_force_rebind = False
# 当前等待态的轮询间隔（秒），可由前端弹窗开关切换快/慢。
_wait_poll_interval = POLL_INTERVAL
# 工作线程代数：刷新授权码/重新授权会自增，让旧轮询线程识别到后自行退出。
_worker_gen = 0
_HEARTBEAT_INTERVAL = 180  
_heartbeat_stop = threading.Event()
_heartbeat_thread = None


def get_state():
    """返回当前授权状态快照（给本地 Flask 接口用）。"""
    return _state.snapshot()


def is_authorized():
    s = _state.snapshot().get("status")
    return s in ("authorized", "offline")


def _report_open(machine_code):
    global _open_reported
    with _report_lock:
        if _open_reported:
            return
    try:
        result = auth.report_app_event("open", machine_code=machine_code, timeout=EVENT_TIMEOUT)
        # 避免 open 未落库却在退出时补发一次无意义的 close。
        if result and result.get("ok"):
            with _report_lock:
                _open_reported = True
    except Exception as e:
        logger.warning(f"上报 open 事件失败: {e}")


def report_app_close():
    # 先停掉心跳，避免退出瞬间的心跳把刚关闭的会话又“重开”
    stop_heartbeat()
    with _report_lock:
        if not _open_reported:
            return
    try:
        auth.report_app_event(
            "close", machine_code=_state.snapshot().get("machine_code") or None,
            timeout=EVENT_TIMEOUT,
        )
    except Exception as e:
        logger.warning(f"上报 close 事件失败: {e}")


def _handle_request_result(res, machine_code, force_rebind=False):
    """处理 /api/auth/request 的返回（ok=True），更新状态并返回是否需继续轮询。"""
    auth_code = res.get("auth_code") or ""
    expire_time = res.get("expire_time") or ""
    status_msg = res.get("msg") or res.get("error") or ""
    _state.update(auth_code=auth_code, expire_time=expire_time)
    logger.info(f"本机授权码: {auth_code}")

    # _report_open 内部有 _open_reported 锁，只会真正上报一次。
    _report_open(machine_code)

    if res.get("is_authorized"):
        if _is_expired_by_date(expire_time):
            _state.update(
                status="expired", is_authorized=False,
                msg="授权已过期，请联系管理员续期", expire_time=expire_time,
            )
            logger.info(f"授权已过期（防御性校验），到期日={expire_time}")
            return False
        _state.update(status="authorized", is_authorized=True, msg="已授权")
        return False

    # 未授权：按 msg 区分“封禁 / 过期”；都没有且 expire_time 有值则按过期兜底。
    if "封禁" in status_msg:
        _state.update(status="banned", msg=status_msg or "授权已被封禁")
        logger.info(f"授权已被封禁: {status_msg}")
        return False
    if force_rebind:
        _state.update(status="waiting", msg="重新授权，等待QQ群绑定授权码")
        logger.info("主动重新授权：进入绑定流程")
        return True
    if "过期" in status_msg:
        _state.update(status="expired", msg=status_msg or "授权已过期")
        logger.info(f"授权已过期: {status_msg}")
        return False
    if expire_time:
        _state.update(status="expired", msg="授权已过期，请联系管理员续期")
        logger.info("授权已过期，等待管理员续期")
        return False

    _state.update(status="waiting", msg="等待QQ群绑定授权码")
    logger.info("未授权，等待 QQ 群绑定授权码...")
    return True


def _is_expired_by_date(expire_time):
    if not expire_time:
        return False
    try:
        exp = datetime.date.fromisoformat(str(expire_time)[:10])
    except (ValueError, TypeError):
        return False
    return exp < datetime.date.today()


def _request_until_ok(machine_code):
    while True:
        try:
            res = auth.request_auth(machine_code, timeout=INITIAL_TIMEOUT)
        except Exception as e:
            logger.warning(f"无法连接授权服务器: {e}")
            if meta_reachable():
                _state.update(
                    status="offline",
                    offline_badge=False,
                    msg="授权服务器暂时不可用，已进入临时使用模式",
                    error=f"无法连接授权服务器：{e}",
                )
            else:
                # 用户主动断网：仍可用（宽限），但右上角显示“未授权”，不弹授权框
                _state.update(
                    status="offline",
                    offline_badge=True,
                    msg="网络异常，暂时以未授权状态使用",
                    error=f"无法连接授权服务器：{e}",
                )
            time.sleep(RETRY_DELAY)
            continue

        if res.get("ok"):
            return res

        msg = res.get("msg") or res.get("error") or ""
        logger.error(f"获取授权码失败: {msg}")
        _state.update(status="error", msg=msg, error=msg)
        return None


def _poll_until_authorized(machine_code, force_rebind=False, gen=None):
    """每秒轮询等待 QQ 群绑定。

    返回 True 表示已到达终态（授权/过期/超时/错误）。
    """
    auth_code = _state.snapshot().get("auth_code") or ""
    start = time.time()
    polls = 0
    while True:
        # 授权任务已被更替（刷新授权码/重新授权），退出旧轮询，避免用旧码覆盖状态
        if gen is not None and gen != _worker_gen:
            logger.info("授权任务已更新，退出旧轮询")
            return True
        if POLL_TIMEOUT and (time.time() - start) > POLL_TIMEOUT:
            # 超过 2 分钟仍未授权：停止轮询（保留 waiting，不置 error，避免来回弹窗）
            logger.info("等待授权超时（2 分钟），停止轮询")
            return True

        time.sleep(_wait_poll_interval)
        polls += 1
        try:
            res = auth.status_auth(machine_code=machine_code, auth_code=auth_code)
        except Exception as e:
            logger.warning(f"轮询授权状态异常（第 {polls} 次）: {e}")
            if meta_reachable():
                _state.update(status="offline", offline_badge=False, msg="授权服务器暂时不可用，已进入临时使用模式")
            else:
                _state.update(status="offline", offline_badge=True, msg="网络异常，暂时以未授权状态使用")
            continue

        # 任务已被更替（刷新授权码/重新授权）：丢弃本次旧结果，避免覆盖新状态
        if gen is not None and gen != _worker_gen:
            logger.info("授权任务已更新，忽略旧轮询结果")
            return True

        # App 已打开：确保上报一次 open；若首次上报失败，这里会作为重试兜底
        _report_open(machine_code)

        if res.get("is_authorized"):
            if _is_expired_by_date(res.get("expire_time") or ""):
                _state.update(
                    status="expired", is_authorized=False,
                    msg="授权已过期，请联系管理员续期",
                    expire_time=res.get("expire_time") or "",
                )
                logger.info("授权已过期（防御性校验）")
                return True
            expire_time = res.get("expire_time") or ""
            msg = res.get("msg", "绑定成功")
            _state.update(
                status="authorized", is_authorized=True,
                expire_time=expire_time, msg=msg, qq_id=res.get("qq_id") or "",
            )
            logger.info(f"绑定成功！授权到期：{expire_time or '长期有效'}")
            return True

        status_msg = res.get("msg") or ""
        # 主动重新授权期间，忽略“已过期”，持续等待重新绑定，避免来回弹窗
        if not force_rebind and "过期" in status_msg:
            _state.update(
                status="expired", msg=status_msg, qq_id=res.get("qq_id") or "",
                expire_time=res.get("expire_time") or "",
            )
            logger.info(f"授权已过期: {status_msg}")
            return True

        if "封禁" in status_msg:
            _state.update(
                status="banned", msg=status_msg, qq_id=res.get("qq_id") or "",
                expire_time=res.get("expire_time") or "",
            )
            logger.info(f"授权已被封禁: {status_msg}")
            return True

        if not res.get("ok"):
            _state.update(status="error", msg=status_msg, error=status_msg or "授权状态异常")
            logger.error(f"授权状态异常: {status_msg}")
            return True


def _worker():
    """后台授权校验线程主体。"""
    global _force_rebind
    gen = _worker_gen
    # 消费“重新授权”标志：只对本次校验生效
    force_rebind = _force_rebind
    _force_rebind = False

    machine_code = auth.get_machine_code()
    _state.update(machine_code=machine_code)
    logger.info(f"本机设备码 machine_code = [{machine_code}]")

    res = _request_until_ok(machine_code)
    if res is None:
        return
    if not _handle_request_result(res, machine_code, force_rebind):
        return
    # 未授权：轮询等待绑定
    _poll_until_authorized(machine_code, force_rebind, gen)


def start_auth_check():
    """幂等启动后台授权校验线程。"""
    global _thread
    with _start_lock:
        if _thread is not None and _thread.is_alive():
            return _thread
        _state.update(status="pending", error="")
        _thread = threading.Thread(target=_worker, name="auth-check", daemon=True)
        _thread.start()
        start_heartbeat()
        return _thread


def _heartbeat_loop():
    while not _heartbeat_stop.wait(_HEARTBEAT_INTERVAL):
        try:
            auth.report_app_event(
                "heartbeat",
                machine_code=auth.get_machine_code(),
                timeout=EVENT_TIMEOUT,
            )
        except Exception as e:
            logger.debug(f"心跳上报失败: {e}")


def start_heartbeat():
    """启动心跳线程（幂等）。"""
    global _heartbeat_thread
    with _report_lock:
        if _heartbeat_thread is not None and _heartbeat_thread.is_alive():
            return _heartbeat_thread
        _heartbeat_stop.clear()
        _heartbeat_thread = threading.Thread(
            target=_heartbeat_loop,
            name="auth-heartbeat",
            daemon=True,
        )
        _heartbeat_thread.start()
        return _heartbeat_thread


def stop_heartbeat():
    global _heartbeat_thread
    _heartbeat_stop.set()
    th = _heartbeat_thread
    if th is not None and th.is_alive():
        try:
            th.join(timeout=EVENT_TIMEOUT)
        except Exception:
            pass


def retry_auth():
    """网络异常后重试授权校验（重置状态并重新拉起线程）。"""
    global _open_reported
    with _report_lock:
        # 重试是全新一次校验，重新允许上报 open（避免旧标志残留）
        _open_reported = False
    return start_auth_check()


def reauthorize_auth():
    """主动“重新授权”：把过期/删除的设备强制当作待绑定新用户，重新走绑定流程。"""
    global _open_reported, _force_rebind
    with _report_lock:
        _open_reported = False
    _force_rebind = True
    return start_auth_check()


def _ensure_waiting_thread():
    """若处于 waiting 且后台线程已因超时退出，则重新拉起以恢复轮询。"""
    global _thread
    if _state.snapshot().get("status") != "waiting":
        return
    with _start_lock:
        if _thread is None or not _thread.is_alive():
            _thread = threading.Thread(target=_worker, name="auth-check", daemon=True)
            _thread.start()


def set_poll_mode(mode):
    """由前端授权弹窗的开关控制更快/更慢轮询：fast=1s，slow=5s。

    用户打开“未授权”弹窗（正在授权）时用 fast；关掉（暂不想授权）用 slow。
    若等待线程已因 2 分钟超时停止，切回 fast 会重新拉起以恢复轮询。
    """
    global _wait_poll_interval
    _wait_poll_interval = POLL_INTERVAL if mode == "fast" else POLL_SLOW
    if mode == "fast":
        _ensure_waiting_thread()
    return _wait_poll_interval


def refresh_auth_code():
    global _worker_gen, _force_rebind, _thread
    machine_code = auth.get_machine_code()
    _state.update(machine_code=machine_code)

    try:
        res = auth.refresh_code(machine_code, reset_binding=True, timeout=INITIAL_TIMEOUT)
    except Exception as e:
        logger.warning(f"刷新授权码失败: {e}")
        _state.update(status="waiting", msg="刷新授权码失败，请稍后重试", error=str(e))
        return _state.snapshot()

    if not res.get("ok"):
        msg = res.get("msg") or "刷新授权码失败"
        logger.error(f"刷新授权码失败: {msg}")
        _state.update(status="waiting", msg=msg, error=msg)
        return _state.snapshot()

    # 刷新成功：让旧轮询退出，重新申请拿到新码并进入等待绑定
    logger.info(f"刷新授权码成功: {res.get('auth_code')}")
    _worker_gen += 1
    _force_rebind = True
    _state.update(status="pending", msg="", error="")
    with _start_lock:
        _thread = threading.Thread(target=_worker, name="auth-check", daemon=True)
        _thread.start()
    return _state.snapshot()


def unbind_device():
    """解绑当前设备：清空 QQ 绑定并重新生成授权码，随后进入待绑定状态。

    解绑后本机立即失去授权（status -> pending -> waiting），
    如需继续使用，需用新授权码在 QQ 群重新绑定。
    """
    global _worker_gen, _force_rebind, _thread
    machine_code = auth.get_machine_code()
    _state.update(machine_code=machine_code)

    try:
        res = auth.refresh_code(machine_code, reset_binding=True, timeout=INITIAL_TIMEOUT)
    except Exception as e:
        logger.warning(f"解绑失败: {e}")
        _state.update(status="authorized", msg="解绑失败，请稍后重试", error=str(e))
        return _state.snapshot()

    if not res.get("ok"):
        msg = res.get("msg") or "解绑失败"
        logger.error(f"解绑失败: {msg}")
        _state.update(status="authorized", msg=msg, error=msg)
        return _state.snapshot()

    new_code = res.get("auth_code") or ""
    logger.info(f"解绑成功，新授权码: {new_code}")
    _worker_gen += 1
    _force_rebind = True
    # 立即进入“等待绑定”，不必再等后台线程多走一次 /api/auth/request 来回。
    # 新授权码从解绑响应直接拿到并写入状态，前端可立刻展示 bind <新码>。
    _state.update(
        status="waiting",
        auth_code=new_code,
        is_authorized=False,
        expire_time="",
        msg="设备已解绑，如需继续使用请在QQ群重新绑定",
        error="",
    )
    with _start_lock:
        _thread = threading.Thread(target=_worker, name="auth-check", daemon=True)
        _thread.start()
    return _state.snapshot()
