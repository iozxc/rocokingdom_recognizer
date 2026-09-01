import subprocess
import requests
import sys
import time
import hmac
import hashlib
import os

import config


# ⚠️签名密钥不写在源码里（项目开源）。
# 读取优先级：
#   1) 环境变量 ROCO_AUTH_SECRET（测试/覆盖用）
#   2) 打包环境(sys.frozen)：只信任构建期注入的 core._auth_secret，忽略外部文件，避免“换文件绕过”
#   3) 开发环境：项目根目录 auth_secret.txt（已 gitignore）；找不到再回退到注入模块
# 始终找不到会直接报错，绝不回退到内置默认值。
def _default_secret_path():
    """开发环境的 auth_secret.txt 路径（本文件位于 core/，上一级即项目根目录）。"""
    return os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "auth_secret.txt")


def _load_embedded_secret():
    """读取构建期注入的 core._auth_secret 模块（打包进 PYZ，无外部文件）。"""
    try:
        from core.auth._auth_secret import SECRET
        if SECRET:
            return bytes(SECRET)
    except Exception:
        pass
    raise RuntimeError(
        "未找到授权签名密钥：请设置环境变量 ROCO_AUTH_SECRET，"
    )


def _load_secret_key():
    env_val = os.getenv("ROCO_AUTH_SECRET")
    if env_val:
        return env_val.encode("utf-8")

    # 打包环境：只认内嵌密钥，忽略外部 auth_secret.txt（防替换绕过）
    if getattr(sys, "frozen", False):
        return _load_embedded_secret()

    # 开发环境：优先项目根目录的 auth_secret.txt
    key_path = _default_secret_path()
    if os.path.isfile(key_path):
        with open(key_path, "r", encoding="utf-8") as f:
            secret = f.read().strip()
        if secret:
            return secret.encode("utf-8")

    # 开发兜底：尝试构建期注入的模块
    return _load_embedded_secret()


SECRET_KEY = _load_secret_key()
# 服务器地址：优先本地 config（环境变量/内置默认）；远程 meta 里的地址作为“主地址连不上”的备用。
SERVER_BASE = config.ROCO_AUTH_SERVER.rstrip("/")
# meta 下发的备用授权服务器（config 主地址连不上时回退；为空则无回退）
_META_BASE = (getattr(config, "META_AUTH_SERVER", "") or "").rstrip("/") or None
REQUEST_PATH = "/api/auth/request"
STATUS_PATH = "/api/auth/status"
CHECK_PATH = "/api/auth_check"
REFRESH_PATH = "/api/auth/refresh_code"

requests.packages.urllib3.disable_warnings()

# 机器码缓存：启动时多次调用，避免重复启动子进程指令
_MACHINE_CODE_CACHE = {"code": None, "ts": 0.0}
_MACHINE_CODE_TTL = 600


def get_machine_code(force: bool = False):
    """读取本机硬盘序列号作为 machine_code（带缓存，降低重复子进程开销）。"""
    if not force and _MACHINE_CODE_CACHE["code"]:
        if time.time() - _MACHINE_CODE_CACHE["ts"] < _MACHINE_CODE_TTL:
            return _MACHINE_CODE_CACHE["code"]
    code = _read_machine_code()
    _MACHINE_CODE_CACHE["code"] = code
    _MACHINE_CODE_CACHE["ts"] = time.time()
    return code


def _read_machine_code():
    """主机器码：硬件/系统稳定指纹（SF-<hash>），不随磁盘/外设变化。

    优先 SMBIOS 系统 UUID（硬件级，重装系统也稳定），其不可用则用 MachineGuid，
    都不可用再回退 MG-<uuid.getnode>。避免“插个U盘/多块盘就变身份”。
    """
    return _read_stable_fingerprint() or _stable_fallback_id()


def _read_stable_fingerprint():
    """读取硬件/系统稳定标识并哈希成 SF-<hash>。"""
    import hashlib
    bad = {"none", "null", "not specified", "default string", "to be filled by o.e.m.",
           "00000000-0000-0000-0000-000000000000", "ffffffff-ffff-ffff-ffff-ffffffffffff",
           "system serial number"}
    try:
        cmd = 'powershell "Get-CimInstance Win32_ComputerSystemProduct | Select-Object -ExpandProperty UUID"'
        out = subprocess.check_output(cmd, shell=True).decode("utf-8", errors="ignore").strip()
        if out and out.lower() not in bad:
            return "SF-" + hashlib.sha256(out.encode("utf-8")).hexdigest()[:16]
    except Exception:
        pass
    try:
        import winreg
        key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Cryptography")
        val, _ = winreg.QueryValueEx(key, "MachineGuid")
        winreg.CloseKey(key)
        if val and str(val).strip():
            return "SF-" + hashlib.sha256(str(val).encode("utf-8")).hexdigest()[:16]
    except Exception:
        pass
    return None


_LEGACY_CODE_CACHE = {"code": None, "ts": 0.0}


def _read_legacy_code():
    """读取旧版规范化短码（MC-<hash>，基于磁盘序列号），仅用于服务端认领老设备。"""
    import time
    if _LEGACY_CODE_CACHE["code"] and (time.time() - _LEGACY_CODE_CACHE["ts"] < 600):
        return _LEGACY_CODE_CACHE["code"]
    code = _canonicalize_mc(_read_raw_serials())
    if code:
        _LEGACY_CODE_CACHE["code"] = code
        _LEGACY_CODE_CACHE["ts"] = time.time()
    return code


def _read_raw_serials():
    """读取所有磁盘序列号（可能多行）。优先 PowerShell CIM，失败回退 wmic。"""
    try:
        # 优先使用新版PowerShell指令（适配Win11）
        cmd = 'powershell "Get-CimInstance Win32_DiskDrive | Select-Object -ExpandProperty SerialNumber"'
        out = subprocess.check_output(cmd, shell=True).decode("utf-8", errors="ignore")
        if out.strip():
            return out
    except Exception:
        pass
    try:
        # 降级使用wmic指令（适配Win10全系）
        out = subprocess.check_output('wmic diskdrive get serialnumber', shell=True).decode(
            "utf-8", errors="ignore"
        )
        if out.strip():
            return out
    except Exception:
        pass
    return ""


def _canonicalize_mc(raw):
    """与服务端 _canonicalize 完全一致：把序列号集合规范化成 MC-<hash>。"""
    if not raw:
        return None
    import hashlib
    placeholders = {"unknown", "error_device", "none", "null", "empty"}
    serials = []
    for line in str(raw).splitlines():
        s = line.strip().rstrip(".").strip().rstrip("\x00\r\n ")
        s = "".join(s.split()).strip()
        low = s.lower()
        if not s or low in placeholders or low in {"0", "0.0", "0000000000", "0000000000000000"}:
            continue
        if set(s) <= {"0", "."}:
            continue
        serials.append(s)
    if not serials:
        return None
    serials.sort()
    return "MC-" + hashlib.sha256("\n".join(serials).encode("utf-8")).hexdigest()[:16]


def _stable_fallback_id():
    """读取 Windows 安装唯一标识 MachineGuid，作为无磁盘序列号时的稳定机器码。"""
    try:
        import winreg
        key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Cryptography")
        val, _ = winreg.QueryValueEx(key, "MachineGuid")
        winreg.CloseKey(key)
        if val and str(val).strip():
            return "MG-" + str(val).strip()
    except Exception:
        pass
    try:
        import uuid
        return "MG-" + str(uuid.getnode())
    except Exception:
        return "ERROR_DEVICE"


def make_sign(machine_code):
    ts = str(int(time.time()))
    raw = f"{machine_code}{ts}".encode()
    sign = hmac.new(SECRET_KEY, raw, hashlib.sha256).hexdigest()
    return ts, sign


def _post_api(path, payload, timeout=10):
    """向授权服务器发请求；主地址(config)连不上时回退到 meta 备用地址。

    仅对“连接层面”失败（ConnectionError / Timeout）回退，避免把服务器返回的
    业务错误(4xx/5xx)误判为“地址失效”。meta 备用地址为空或与主地址相同则不回退。
    """
    try:
        return requests.post(SERVER_BASE + path, json=payload, timeout=timeout, verify=False)
    except (requests.exceptions.ConnectionError, requests.exceptions.Timeout):
        if _META_BASE and _META_BASE != SERVER_BASE:
            try:
                from core.infra.logger import logger
                logger.warning(f"授权服务器主地址连不上({SERVER_BASE})，回退 meta 备用地址({_META_BASE})")
            except Exception:
                pass
            return requests.post(_META_BASE + path, json=payload, timeout=timeout, verify=False)
        raise


def request_auth(machine_code=None, timeout=10):
    """申请/查询授权码。返回服务端 JSON（含 auth_code / is_authorized）。"""
    mc = machine_code or get_machine_code()
    ts, sign = make_sign(mc)
    payload = {"machine_code": mc, "timestamp": ts, "sign": sign}
    payload["version"] = str(config.APP_VERSION)  # 客户端版本（供 admin 版本统计）
    payload["platform"] = "app"  # 客户端平台：桌面端固定 app（未带该字段的按旧设备/app 处理）
    legacy = _read_legacy_code()
    if legacy:
        payload["legacy_code"] = legacy
    resp = _post_api(REQUEST_PATH, payload, timeout=timeout)
    resp.raise_for_status()
    return resp.json()


def status_auth(machine_code=None, auth_code=None, event=None, timeout=10):
    """查询授权状态；可携带 event（open/close）上报事件。返回服务端 JSON。"""
    mc = machine_code or get_machine_code()
    ts, sign = make_sign(mc)
    payload = {"machine_code": mc, "timestamp": ts, "sign": sign}
    payload["version"] = str(config.APP_VERSION)  # 客户端版本（供 admin 版本统计）
    payload["platform"] = "app"  # 客户端平台：桌面端固定 app
    if auth_code:
        payload["auth_code"] = auth_code
    if event:
        payload["event"] = event
    legacy = _read_legacy_code()
    if legacy:
        payload["legacy_code"] = legacy
    resp = _post_api(STATUS_PATH, payload, timeout=timeout)
    resp.raise_for_status()
    return resp.json()


def refresh_code(machine_code=None, reset_binding=True, timeout=10):
    """为指定设备重新生成授权码（客户端自服务换码）。

    reset_binding=True：同管理端“刷新授权码”，清空绑定信息并置为未授权，
    客户端可拿到新授权码重新绑定；旧授权码随即失效。
    """
    mc = machine_code or get_machine_code()
    ts, sign = make_sign(mc)
    payload = {
        "machine_code": mc,
        "timestamp": ts,
        "sign": sign,
        "reset_binding": reset_binding,
    }
    legacy = _read_legacy_code()
    if legacy:
        payload["legacy_code"] = legacy
    resp = _post_api(REFRESH_PATH, payload, timeout=timeout)
    resp.raise_for_status()
    return resp.json()


def report_app_event(event, machine_code=None, timeout=10):
    """App 打开/关闭事件上报（新增，用于统计流量与使用时长）。

    event = 'open'  : App 打开，记 1 次流量并开启会话
    event = 'close' : App 关闭，关闭会话并计算使用时长
    example:
        report_app_event("open")   # 在 App 启动校验过期后调用
        report_app_event("close")  # 在 App 退出前调用
    """
    try:
        return status_auth(machine_code=machine_code, event=event, timeout=timeout)
    except Exception as e:
        logger = None
        try:
            from core.infra.logger import logger as _logger
            logger = _logger
        except Exception:
            pass
        if logger is not None:
            logger.warning(f"事件上报失败: {e}")
        else:
            print(f"❌ 事件上报失败：{e}")
        return None


def cloud_auth():
    machine_code = get_machine_code()
    print(f"本机设备码 machine_code = [{machine_code}]")

    # 第一步：带机器码申请授权码
    try:
        res = request_auth(machine_code)
    except Exception as e:
        print(f"❌ 无法连接授权服务器：{e}")
        return False

    if not res.get("ok"):
        print(f"❌ 获取授权码失败：{res.get('msg')}")
        return False

    auth_code = res.get("auth_code")
    print(f"📟 本机授权码：{auth_code}")

    if res.get("is_authorized"):
        print("✅ 当前已授权，可直接启动程序")
        return True

    # 第二步：提示用户到 QQ 群 @机器人 绑定，并轮询直到绑定成功
    print(f"⚠️ 请到 QQ 群 @机器人 发送：bind {auth_code}")
    print("⏳ 等待 QQ 群绑定中（每 5 秒检查一次）...")

    for _ in range(120):  # 最长约 10 分钟
        time.sleep(5)
        try:
            res = status_auth(machine_code=machine_code, auth_code=auth_code)
        except Exception as e:
            print(f"❌ 轮询异常：{e}")
            continue

        if res.get("is_authorized"):
            print(f"✅ 绑定成功！授权到期：{res.get('expire_time')}")
            return True
        if not res.get("ok"):
            print(f"❌ 授权状态异常：{res.get('msg')}")
            return False
        # 仍是等待状态，继续轮询

    print("⏰ 等待绑定超时，请确认已在 QQ 群绑定授权码。")
    return False


if __name__ == "__main__":
    ok = cloud_auth()
    if not ok:
        sys.exit(0)
