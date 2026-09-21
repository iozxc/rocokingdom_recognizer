"""Windows 全局热键（跟随识别 显示/隐藏）。

用系统原生 RegisterHotKey 实现，而不是低级键盘钩子：

- 由操作系统统一分发，**不会和 QQ（Ctrl+Alt+A/Z）、微信（Alt+A）等已注册的
  全局热键冲突**——如果某个组合键已被别的程序注册，RegisterHotKey 会直接失败
  （ERROR_HOTKEY_ALREADY_REGISTERED），我们据此提示用户换一个。
- 热键按下时系统消费这组按键，组合键不会再送进游戏窗口触发动作。

热键注册具有线程亲和性（注册到创建消息循环的线程），所以本模块在一个独立的
后台线程里创建"仅消息窗口"（message-only window），并在同一个线程里完成
注册/反注册与 WM_HOTKEY 派发；外部通过线程安全的命令队列请求修改热键。
"""
import ctypes
import queue
import re
import threading
from ctypes import wintypes

from core.infra.logger import logger


DEFAULT_FOLLOW_HOTKEY = "Ctrl+D"

# RegisterHotKey 修饰键标志
MOD_ALT = 0x0001
MOD_CONTROL = 0x0002
MOD_SHIFT = 0x0004
MOD_WIN = 0x0008
MOD_NOREPEAT = 0x4000  # 按住不重复触发（Win7+）

WM_HOTKEY = 0x0312
HWND_MESSAGE = -3
ERROR_HOTKEY_ALREADY_REGISTERED = 1409

_HOTKEY_ID = 1

user32 = ctypes.WinDLL("user32", use_last_error=True)
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

# 64 位安全的函数原型
LRESULT = ctypes.c_ssize_t
LONG_PTR = ctypes.c_ssize_t
HINSTANCE = wintypes.HINSTANCE

WNDPROCTYPE = ctypes.WINFUNCTYPE(
    LRESULT, wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM
)


class WNDCLASSW(ctypes.Structure):
    _fields_ = [
        ("style", wintypes.UINT),
        ("lpfnWndProc", WNDPROCTYPE),
        ("cbClsExtra", ctypes.c_int),
        ("cbWndExtra", ctypes.c_int),
        ("hInstance", HINSTANCE),
        ("hIcon", wintypes.HICON),
        ("hCursor", wintypes.HANDLE),
        ("hbrBackground", wintypes.HBRUSH),
        ("lpszMenuName", wintypes.LPCWSTR),
        ("lpszClassName", wintypes.LPCWSTR),
    ]


class MSG(ctypes.Structure):
    _fields_ = [
        ("hwnd", wintypes.HWND),
        ("message", wintypes.UINT),
        ("wParam", wintypes.WPARAM),
        ("lParam", wintypes.LPARAM),
        ("time", wintypes.DWORD),
        ("pt", wintypes.POINT),
    ]


def _setup_prototypes():
    user32.RegisterClassW.argtypes = [ctypes.POINTER(WNDCLASSW)]
    user32.RegisterClassW.restype = wintypes.ATOM
    user32.UnregisterClassW.argtypes = [wintypes.LPCWSTR, HINSTANCE]
    user32.UnregisterClassW.restype = wintypes.BOOL
    user32.CreateWindowExW.argtypes = [
        wintypes.DWORD, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD,
        ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int,
        wintypes.HWND, wintypes.HMENU, HINSTANCE, wintypes.LPVOID,
    ]
    user32.CreateWindowExW.restype = wintypes.HWND
    user32.DestroyWindow.argtypes = [wintypes.HWND]
    user32.DestroyWindow.restype = wintypes.BOOL
    user32.DefWindowProcW.argtypes = [
        wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM
    ]
    user32.DefWindowProcW.restype = LRESULT
    user32.PeekMessageW.argtypes = [
        ctypes.POINTER(MSG), wintypes.HWND, wintypes.UINT, wintypes.UINT, wintypes.UINT
    ]
    user32.PeekMessageW.restype = wintypes.BOOL
    user32.TranslateMessage.argtypes = [ctypes.POINTER(MSG)]
    user32.TranslateMessage.restype = wintypes.BOOL
    user32.DispatchMessageW.argtypes = [ctypes.POINTER(MSG)]
    user32.DispatchMessageW.restype = LRESULT
    user32.RegisterHotKey.argtypes = [
        wintypes.HWND, ctypes.c_int, wintypes.UINT, wintypes.UINT
    ]
    user32.RegisterHotKey.restype = wintypes.BOOL
    user32.UnregisterHotKey.argtypes = [wintypes.HWND, ctypes.c_int]
    user32.UnregisterHotKey.restype = wintypes.BOOL
    user32.IsWindowVisible.argtypes = [wintypes.HWND]
    user32.IsWindowVisible.restype = wintypes.BOOL
    kernel32.GetModuleHandleW.argtypes = [wintypes.LPCWSTR]
    kernel32.GetModuleHandleW.restype = HINSTANCE
    kernel32.GetCurrentThreadId.restype = wintypes.DWORD


_setup_prototypes()

# 修饰键规范名（前端按同一套规范串生成，如 "Ctrl+Alt+R"）
_MOD_FLAGS = {
    "CTRL": MOD_CONTROL,
    "ALT": MOD_ALT,
    "SHIFT": MOD_SHIFT,
    "WIN": MOD_WIN,
}


def _virtual_key_for(token: str):
    """把规范串里的非修饰键 token 翻译成 Windows 虚拟键码；无法识别返回 None。"""
    t = token.strip()
    if len(t) == 1 and "A" <= t.upper() <= "Z":
        return ord(t.upper())
    if len(t) == 1 and t.isdigit():
        return ord(t)
    m = re.fullmatch(r"F(\d{1,2})", t)
    if m:
        n = int(m.group(1))
        if 1 <= n <= 24:
            return 0x70 + (n - 1)
    named = {
        "SPACE": 0x20,
        "ENTER": 0x0D,
        "ESC": 0x1B,
        "TAB": 0x09,
        "HOME": 0x24,
        "END": 0x23,
        "PAGEUP": 0x21,
        "PAGEDOWN": 0x22,
        "INSERT": 0x2D,
        "DELETE": 0x2E,
        "BACKSPACE": 0x08,
        "UP": 0x26,
        "DOWN": 0x28,
        "LEFT": 0x25,
        "RIGHT": 0x27,
    }
    return named.get(t.upper())


def parse_chord(chord: str):
    """解析 "Ctrl+Alt+R" 为 (mod_flags, vk)；非法/缺修饰键/含 Win 键返回错误。

    返回 (flags, vk, reason)，成功时 reason 为 None。
    """
    if chord is None:
        return None, None, "invalid"
    parts = [p.strip() for p in str(chord).split("+") if p.strip()]
    if not parts:
        return None, None, "invalid"
    key_token = parts[-1]
    mod_tokens = parts[:-1]
    flags = 0
    for tok in mod_tokens:
        flag = _MOD_FLAGS.get(tok.upper())
        if flag is None:
            return None, None, "invalid"
        flags |= flag
    # 不允许单键（没有任何修饰键），避免影响正常打字
    if flags == 0:
        return None, None, "modifier_required"
    # Win 键组合被系统占用，不能注册
    if flags & MOD_WIN:
        return None, None, "win_reserved"
    vk = _virtual_key_for(key_token)
    if vk is None:
        return None, None, "invalid_key"
    return flags, vk, None


class GlobalHotkeyManager:
    """在独立线程中维护一个全局热键，触发时调用 on_trigger。"""

    def __init__(self, on_trigger=None):
        self._on_trigger = on_trigger
        self._thread = None
        self._started = threading.Event()
        self._cmds = queue.Queue()
        # 保存 WNDPROC 回调引用，防止被 GC
        self._wndproc_ref = None
        self._hwnd = None
        self._registered = False
        self._current_chord = ""

    # ---------- 对外 API（任意线程调用） ----------

    def start(self):
        if self._thread is not None:
            return
        self._thread = threading.Thread(
            target=self._run, name="global-hotkey", daemon=True
        )
        self._thread.start()
        self._started.wait(timeout=2.0)

    def set_chord(self, chord: str):
        """设置热键；chord 为空串/None 表示禁用（反注册）。

        返回 {"status": "ok", "chord": chord} 或
        {"status": "error", "reason": "conflict"|"invalid"|...}。
        """
        self.start()
        resp = {}
        done = threading.Event()
        self._cmds.put(("set", chord or "", resp, done))
        done.wait(timeout=2.0)
        return resp.get("result", {"status": "error", "reason": "timeout"})

    def stop(self):
        if self._thread is None:
            return
        done = threading.Event()
        self._cmds.put(("stop", None, None, done))
        done.wait(timeout=2.0)

    # ---------- 热键线程内部 ----------

    def _handle_hotkey(self):
        try:
            if self._on_trigger is not None:
                self._on_trigger()
        except Exception as e:
            logger.error(f"全局热键回调执行失败: {e}", exc_info=True)

    def _apply_chord(self, chord: str):
        # 先反注册旧热键
        if self._registered:
            try:
                user32.UnregisterHotKey(self._hwnd, _HOTKEY_ID)
            except Exception:
                pass
            self._registered = False
        chord = (chord or "").strip()
        if not chord:
            self._current_chord = ""
            return {"status": "ok", "chord": "", "disabled": True}

        flags, vk, reason = parse_chord(chord)
        if vk is None:
            logger.warning(f"跟随识别热键非法（{chord}）：{reason}")
            return {"status": "error", "reason": reason or "invalid"}

        ok = user32.RegisterHotKey(
            self._hwnd, _HOTKEY_ID, flags | MOD_NOREPEAT, vk
        )
        if not ok:
            err = ctypes.get_last_error()
            if err == ERROR_HOTKEY_ALREADY_REGISTERED:
                logger.warning(f"跟随识别热键已被其他程序占用：{chord}")
                return {"status": "error", "reason": "conflict"}
            logger.warning(f"注册跟随识别热键失败（{chord}），错误码={err}")
            return {"status": "error", "reason": f"error_{err}"}
        self._registered = True
        self._current_chord = chord
        logger.info(f"跟随识别全局热键已注册：{chord}")
        return {"status": "ok", "chord": chord}

    def _run(self):
        hinst = kernel32.GetModuleHandleW(None)
        class_name = "RocoGlobalHotkeyWnd"

        def wndproc(hwnd, msg, wparam, lparam):
            if msg == WM_HOTKEY and int(wparam) == _HOTKEY_ID:
                self._handle_hotkey()
                return 0
            return user32.DefWindowProcW(hwnd, msg, wparam, lparam)

        self._wndproc_ref = WNDPROCTYPE(wndproc)

        wc = WNDCLASSW()
        wc.lpfnWndProc = self._wndproc_ref
        wc.hInstance = hinst
        wc.lpszClassName = class_name
        atom = user32.RegisterClassW(ctypes.byref(wc))
        if not atom:
            # 类已存在（极少数情况）可忽略，CreateWindow 仍能复用
            logger.debug("RegisterClassW 未返回新 atom，可能已注册")

        hwnd = user32.CreateWindowExW(
            0, class_name, "RocoHotkey", 0,
            0, 0, 0, 0, wintypes.HWND(HWND_MESSAGE), None, hinst, None
        )
        if not hwnd:
            logger.error("创建全局热键消息窗口失败，跟随识别快捷键不可用")
            self._started.set()
            return
        self._hwnd = hwnd
        self._started.set()

        PM_REMOVE = 0x0001
        try:
            while True:
                # 先把窗口消息（含 WM_HOTKEY）取完
                msg = MSG()
                while user32.PeekMessageW(ctypes.byref(msg), None, 0, 0xFFFFFFFF, PM_REMOVE):
                    user32.TranslateMessage(ctypes.byref(msg))
                    user32.DispatchMessageW(ctypes.byref(msg))
                    if msg.message == 0x0012:  # WM_QUIT
                        return
                try:
                    cmd = self._cmds.get(timeout=0.05)
                except queue.Empty:
                    continue
                kind, payload, resp, done = cmd
                if kind == "stop":
                    break
                if kind == "set":
                    result = self._apply_chord(payload)
                    if resp is not None:
                        resp["result"] = result
                    if done is not None:
                        done.set()
        finally:
            try:
                if self._registered:
                    user32.UnregisterHotKey(self._hwnd, _HOTKEY_ID)
            except Exception:
                pass
            try:
                user32.DestroyWindow(self._hwnd)
            except Exception:
                pass
            try:
                user32.UnregisterClassW(class_name, hinst)
            except Exception:
                pass
