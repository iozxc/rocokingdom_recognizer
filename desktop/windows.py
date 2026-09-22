"""桌面窗口管理：主窗口与“跟随识别”子窗口的创建、关闭、移动与自适应。"""
import ctypes
import json
import os
import tempfile
import threading

import pygetwindow as gw
import webview

import config
from core.infra.logger import logger
from desktop.auto_watch import AutoWatchManager
from desktop.hotkey import DEFAULT_FOLLOW_HOTKEY, GlobalHotkeyManager

# 主窗口最小尺寸（min_size 与异常几何判定共用）
_MAIN_WINDOW_MIN_WIDTH = 555
_MAIN_WINDOW_MIN_HEIGHT = 300
# 首次打开时窗口占屏幕工作区（排除任务栏后的可用区域）的比例上限
_MAIN_WINDOW_DESKTOP_COVERAGE = 0.9
# 超大屏（如 4K）上首次打开窗口的最大尺寸，避免窗口被放得过大
_MAIN_WINDOW_MAX_WIDTH = 1920
_MAIN_WINDOW_MAX_HEIGHT = 1080
_MAIN_WINDOW_STATE_FILE = "window_state.json"
_MAIN_WINDOW_STATE_KEY = "mainWindow"


def _get_screen_size():
    """返回主显示器分辨率 (宽, 高)；读取失败时回退 1920x1080。"""
    try:
        width = int(ctypes.windll.user32.GetSystemMetrics(0))  # SM_CXSCREEN
        height = int(ctypes.windll.user32.GetSystemMetrics(1))  # SM_CYSCREEN
        if width > 0 and height > 0:
            return width, height
    except Exception as e:
        logger.warning(f"读取屏幕分辨率失败，使用默认 1920x1080: {e}")
    return 1920, 1080


def _get_work_area_rect():
    """返回主显示器工作区 (左, 上, 宽, 高)，物理像素；已排除任务栏/停靠栏。

    SystemParametersInfoW 的 SPI_GETWORKAREA 在 System-DPI-Aware 进程里
    返回物理像素，需要再除以 DPI 缩放比换算成 pywebview 使用的逻辑像素。
    """
    try:
        from ctypes import wintypes
        rect = wintypes.RECT()
        ok = ctypes.windll.user32.SystemParametersInfoW(0x0030, 0, ctypes.byref(rect), 0)
        if ok:
            width = rect.right - rect.left
            height = rect.bottom - rect.top
            if width > 0 and height > 0:
                return rect.left, rect.top, width, height
    except Exception as e:
        logger.warning(f"读取屏幕工作区失败，使用整屏: {e}")
    width, height = _get_screen_size()
    return 0, 0, width, height


def _get_virtual_screen_bounds():
    """返回整个虚拟桌面的 (左, 上, 宽, 高)，用于多显示器坐标校验。"""
    try:
        user32 = ctypes.windll.user32
        left = int(user32.GetSystemMetrics(76))    # SM_XVIRTUALSCREEN
        top = int(user32.GetSystemMetrics(77))     # SM_YVIRTUALSCREEN
        width = int(user32.GetSystemMetrics(78))   # SM_CXVIRTUALSCREEN
        height = int(user32.GetSystemMetrics(79))  # SM_CYVIRTUALSCREEN
        if width > 0 and height > 0:
            return left, top, width, height
    except Exception as e:
        logger.warning(f"读取虚拟桌面范围失败，使用主显示器: {e}")

    width, height = _get_screen_size()
    return 0, 0, width, height


def _get_dpi_scale():
    """返回系统级“逻辑像素 -> 物理像素”缩放比（如 150% 缩放返回 1.5）。

    main.py 已把进程设为 System-DPI-Aware，此后 GetSystemMetrics 返回的是
    物理像素；而 pywebview 的窗口坐标/尺寸（window.x、保存的 window_state.json）
    全部使用逻辑像素。两套坐标必须换算到同一坐标系后再比较，否则在高 DPI 屏幕
    上做边界钳制会失真。System-Aware 下系统级缩放即窗口缩放，二者等价。
    """
    try:
        # DEVICE_PRIMARY=0，返回主显示器缩放百分比（如 150）
        percent = int(ctypes.windll.shcore.GetScaleFactorForDevice(0))
        if percent >= 100:
            return percent / 100.0
    except Exception as e:
        logger.debug(f"读取系统缩放比例失败，尝试 GetDpiForSystem: {e}")
    try:
        dpi = int(ctypes.windll.user32.GetDpiForSystem())
        if dpi >= 96:
            return dpi / 96.0
    except Exception:
        pass
    return 1.0


def _get_logical_screen_size():
    """返回主显示器的逻辑分辨率（与 pywebview 坐标同坐标系）。"""
    phys_w, phys_h = _get_screen_size()
    scale = _get_dpi_scale()
    return int(round(phys_w / scale)), int(round(phys_h / scale))


def _get_logical_virtual_screen_bounds():
    """返回整个虚拟桌面的逻辑 (左, 上, 宽, 高)，用于多显示器坐标校验。"""
    left, top, width, height = _get_virtual_screen_bounds()
    scale = _get_dpi_scale()
    return (
        int(round(left / scale)),
        int(round(top / scale)),
        int(round(width / scale)),
        int(round(height / scale)),
    )


def _get_logical_work_area():
    """返回主显示器工作区的逻辑 (左, 上, 宽, 高)，已排除任务栏。"""
    left, top, width, height = _get_work_area_rect()
    scale = _get_dpi_scale()
    return (
        int(round(left / scale)),
        int(round(top / scale)),
        int(round(width / scale)),
        int(round(height / scale)),
    )


def _compute_default_window_geometry():
    """首次打开时按屏幕工作区计算 16:9 窗口大小并居中。

    小屏幕不再直接全屏：取工作区的 90% 作为可用范围，在其中放入最大的
    16:9 矩形；同时钳制在 [最小尺寸, 1920x1080] 之间，避免 4K 屏窗口过大。
    工作区本身已排除任务栏，窗口不会遮挡任务栏。
    """
    work_x, work_y, work_w, work_h = _get_logical_work_area()

    max_w = int(work_w * _MAIN_WINDOW_DESKTOP_COVERAGE)
    max_h = int(work_h * _MAIN_WINDOW_DESKTOP_COVERAGE)

    # 先按宽度铺满，超高则按高度反推宽度，保证严格 16:9
    width = max_w
    height = int(round(width * 9 / 16))
    if height > max_h:
        height = max_h
        width = int(round(height * 16 / 9))

    # 超大屏上限
    width = min(width, _MAIN_WINDOW_MAX_WIDTH)
    height = min(height, _MAIN_WINDOW_MAX_HEIGHT)

    # 屏幕过小放不下最小窗口时，由调用方退化为全屏兜底
    if width < _MAIN_WINDOW_MIN_WIDTH or height < _MAIN_WINDOW_MIN_HEIGHT:
        return None

    x = work_x + int(round((work_w - width) / 2))
    y = work_y + int(round((work_h - height) / 2))
    return {"x": x, "y": y, "width": width, "height": height}


def _load_main_window_geometry():
    """读取并校验上一次的主窗口位置、大小；无效或越界时返回 None。"""
    try:
        path = config.get_external_path(_MAIN_WINDOW_STATE_FILE)
        if not os.path.isfile(path):
            return None

        with open(path, "r", encoding="utf-8") as f:
            payload = json.load(f)
        state = payload.get(_MAIN_WINDOW_STATE_KEY, {}) if isinstance(payload, dict) else {}
        if not isinstance(state, dict):
            return None

        x = int(state["x"])
        y = int(state["y"])
        width = int(state["width"])
        height = int(state["height"])
    except (FileNotFoundError, KeyError, TypeError, ValueError, json.JSONDecodeError, OSError) as e:
        logger.debug(f"主窗口状态不可用，使用默认窗口配置: {e}")
        return None

    if width < _MAIN_WINDOW_MIN_WIDTH or height < _MAIN_WINDOW_MIN_HEIGHT:
        return None

    # window_state 与 pywebview 都是逻辑像素，这里也必须用逻辑虚拟屏比较，
    # 否则高 DPI（如 150%）下会拿物理分辨率去钳制逻辑坐标，结果失真。
    screen_x, screen_y, screen_w, screen_h = _get_logical_virtual_screen_bounds()
    if screen_w < _MAIN_WINDOW_MIN_WIDTH or screen_h < _MAIN_WINDOW_MIN_HEIGHT:
        return None

    # 分辨率降低或显示器被移除时，把窗口重新限制在仍然存在的桌面范围内。
    width = max(_MAIN_WINDOW_MIN_WIDTH, min(width, screen_w))
    height = max(_MAIN_WINDOW_MIN_HEIGHT, min(height, screen_h))
    x = max(screen_x, min(x, screen_x + screen_w - width))
    y = max(screen_y, min(y, screen_y + screen_h - height))
    return {"x": x, "y": y, "width": width, "height": height}


def _save_main_window_geometry(state):
    """原子写入主窗口位置和大小，避免异常退出留下损坏的状态文件。"""
    path = config.get_external_path(_MAIN_WINDOW_STATE_FILE)
    directory = os.path.dirname(path) or "."
    os.makedirs(directory, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(
        dir=directory,
        prefix=os.path.basename(path) + ".tmp.",
        suffix=".json",
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(
                {_MAIN_WINDOW_STATE_KEY: state},
                f,
                ensure_ascii=False,
                indent=2,
            )
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, path)
    finally:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass


class WindowManager:
    """管理主窗口与子窗口的生命周期，供 JS 桥接层调用。"""

    def __init__(self, server_port: int, js_api=None):
        self.server_port = server_port
        self.js_api = js_api
        self.main_window = None
        self.scanner_window = None
        self.scanner_topmost = True
        # 防止连点“跟随识别”并发创建多个子窗口导致卡死
        self._scanner_open_lock = threading.Lock()
        # 主窗口位置/大小的运行期防抖落盘：开发态常用 IDE 强杀进程，
        # closing 事件来不及触发，只在关闭时保存会导致下次启动“读不到”上次位置
        self._geom_timer = None
        self._geom_timer_lock = threading.Lock()
        # 全局热键（跟随识别）：独立线程 + 系统 RegisterHotKey。
        # 热键按下时不弹窗口，而是在跟随识别窗口已开启时执行一次识别
        self._hotkey_scan_lock = threading.Lock()
        self.hotkey = GlobalHotkeyManager(on_trigger=self._on_hotkey_trigger)
        # 跟随识别「自动模式」监控（自动识别选择界面 + 自动点亮对战精灵）
        self.auto_watch = AutoWatchManager(self)

    def start_hotkey(self, chord: str = DEFAULT_FOLLOW_HOTKEY):
        """启动全局热键线程并按设置里的组合键注册（失败不阻断主程序）。"""
        try:
            self.hotkey.start()
            result = self.hotkey.set_chord(chord or DEFAULT_FOLLOW_HOTKEY)
            if result.get("status") != "ok":
                logger.warning(
                    f"跟随识别全局热键注册失败（{chord}）：{result.get('reason')}，"
                    "可在系统设置里更换快捷键"
                )
        except Exception as e:
            logger.warning(f"初始化跟随识别全局热键失败: {e}")

    def apply_hotkey(self, chord: str):
        """设置里修改热键时调用：重新注册；空串表示禁用。"""
        try:
            return self.hotkey.set_chord(chord or "")
        except Exception as e:
            logger.error(f"应用跟随识别热键异常: {e}", exc_info=True)
            return {"status": "error", "reason": "exception", "message": str(e)}

    def _on_hotkey_trigger(self):
        """热键按下（热键线程）：切到工作线程执行一次识别，避免阻塞消息循环。"""
        threading.Thread(
            target=self.trigger_follow_scan, name="hotkey-follow-scan", daemon=True
        ).start()

    def _is_scanner_visible(self) -> bool:
        """用原生 IsWindowVisible 判断跟随识别窗口当前是否可见（隐藏复用也能识别）。"""
        if self.scanner_window is None:
            return False
        try:
            windows = gw.getWindowsWithTitle('精灵识别跟随')
            if not windows:
                return False
            return bool(ctypes.windll.user32.IsWindowVisible(int(windows[0]._hWnd)))
        except Exception as e:
            logger.debug(f"读取跟随识别窗口可见性失败: {e}")
            return False

    def trigger_follow_scan(self):
        """全局热键：跟随识别窗口已开启且可见时，执行一次识别（等价于点「立即识别」）。

        窗口未打开/被隐藏时不做任何事——不会主动弹出窗口，避免打扰游戏画面。
        """
        with self._hotkey_scan_lock:
            if not self._is_scanner_visible() or self.scanner_window is None:
                logger.debug("跟随识别热键按下，但窗口未打开/不可见，忽略")
                return
            try:
                ok_raw = self.scanner_window.evaluate_js(
                    "(window.__rocoTriggerSingleScan && window.__rocoTriggerSingleScan()) || false"
                )
                # 兼容 pywebview 返回原生 bool 或字符串 "true"/"false"
                ok = ok_raw is True or str(ok_raw).strip().lower() == "true"
                if ok:
                    logger.info("全局热键已触发一次跟随识别")
                else:
                    logger.warning("跟随识别窗口未就绪（未注册扫描入口），本次热键忽略")
            except Exception as e:
                logger.warning(f"全局热键触发跟随识别失败: {e}")

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.server_port}"

    def set_scanner_topmost_native(self, flag):
        """用原生 SetWindowPos 设置跟随识别窗口是否置顶（线程安全，Win10/11 通用）。"""
        try:
            from ctypes import wintypes
            windows = gw.getWindowsWithTitle('精灵识别跟随')
            if not windows:
                return False
            hwnd = int(windows[0]._hWnd)
            # SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE
            swp_flags = 0x0001 | 0x0002 | 0x0010
            result = ctypes.windll.user32.SetWindowPos(
                wintypes.HWND(hwnd),
                wintypes.HWND(-1) if flag else wintypes.HWND(-2),
                0, 0, 0, 0,
                swp_flags,
            )
            if not result:
                return False
            self.scanner_topmost = bool(flag)
            return True
        except Exception as e:
            logger.error(f"设置跟随识别置顶失败: {e}", exc_info=True)
            return False

    def get_scanner_topmost(self):
        """读取跟随识别窗口真实置顶状态（读 WS_EX_TOPMOST 样式）。"""
        try:
            from ctypes import wintypes
            windows = gw.getWindowsWithTitle('精灵识别跟随')
            if not windows:
                return None
            hwnd = int(windows[0]._hWnd)
            user32 = ctypes.windll.user32
            get_style = getattr(user32, 'GetWindowLongPtrW', None) or getattr(user32, 'GetWindowLongW', None)
            ex_style = get_style(wintypes.HWND(hwnd), -20)
            on_top = bool(ex_style & 0x00000008)
            self.scanner_topmost = on_top
            return on_top
        except Exception as e:
            logger.error(f"获取跟随识别置顶失败: {e}", exc_info=True)
            return None

    def create_main_window(self):
        """创建主窗口。

        首次打开（没有保存过窗口状态）时，按屏幕工作区（排除任务栏）自适应
        计算一个 16:9 的窗口并居中，不再在小屏幕上强制全屏；
        只有工作区连最小窗口尺寸都放不下（极少见的超低分辨率）时才全屏兜底。
        """
        # 默认窗口常量与 pywebview 坐标都是逻辑像素，屏幕尺寸也取逻辑分辨率
        screen_w, screen_h = _get_logical_screen_size()
        saved_geometry = _load_main_window_geometry()

        window_kwargs = {
            "title": '洛克王国徽章试炼助手',
            "url": self.base_url,
            "js_api": self.js_api,
        }
        if saved_geometry:
            window_kwargs.update(saved_geometry)
            window_kwargs["min_size"] = (
                _MAIN_WINDOW_MIN_WIDTH,
                _MAIN_WINDOW_MIN_HEIGHT,
            )
            logger.info(
                "恢复主窗口位置和大小: "
                f"{saved_geometry['width']}x{saved_geometry['height']} "
                f"@ ({saved_geometry['x']}, {saved_geometry['y']})"
            )
        else:
            default_geometry = _compute_default_window_geometry()
            if default_geometry is None:
                logger.info(
                    f"桌面工作区 {screen_w}x{screen_h} 小于最小窗口尺寸，"
                    "主窗口改为全屏显示"
                )
                window_kwargs.update({
                    "width": screen_w,
                    "height": screen_h,
                })
                window_kwargs["fullscreen"] = True
            else:
                logger.info(
                    "首次打开，按屏幕工作区自适应主窗口（16:9）: "
                    f"{default_geometry['width']}x{default_geometry['height']} "
                    f"@ ({default_geometry['x']}, {default_geometry['y']})"
                )
                window_kwargs.update(default_geometry)
                window_kwargs["min_size"] = (
                    _MAIN_WINDOW_MIN_WIDTH,
                    _MAIN_WINDOW_MIN_HEIGHT,
                )

        self.main_window = webview.create_window(**window_kwargs)
        self.main_window.events.closing += self._on_main_closing
        self.main_window.events.closed += self._on_main_closed
        # 运行期防抖落盘：拖动/缩放停顿后即保存，IDE 强杀或崩溃也能保住最近位置
        self.main_window.events.moved += self._schedule_geometry_save
        self.main_window.events.resized += self._schedule_geometry_save
        logger.info("主窗口创建完成")
        return self.main_window

    def _is_main_window_minimized(self):
        """判断主窗口当前是否处于“最小化”状态（Win32 IsIconic）。

        关键：窗口最小化时，Win32 会把它挪到屏幕外（-32000,-32000）并给出一个
        极小的占位矩形。此时若读取 win.x/y/width/height 落盘，会把“恢复大小”
        污染成窗口最小值（555x300），下次启动就变成一个极小的窗口。
        """
        try:
            win = self.main_window
            if win is None:
                return False
            title = getattr(win, "title", None) or "洛克王国徽章试炼助手"
            for hw in gw.getWindowsWithTitle(title):
                try:
                    if hw.isMinimized:
                        return True
                except Exception:
                    continue
        except Exception as e:
            logger.debug(f"判断主窗口最小化状态失败: {e}")
        return False

    def _collect_main_geometry(self):
        """读取主窗口当前几何（逻辑像素）；窗口已销毁、最小化或读取异常时返回 None。

        最小化状态下窗口位置/尺寸是屏幕外的极小占位值，绝不能落盘，否则会把
        下次启动的“恢复大小”错误记成窗口最小值（555x300）。
        """
        win = self.main_window
        if win is None:
            return None
        try:
            if self._is_main_window_minimized():
                logger.debug("主窗口处于最小化状态，跳过本次几何保存")
                return None
            x, y = int(win.x), int(win.y)
            width, height = int(win.width), int(win.height)
        except Exception as e:
            logger.debug(f"读取主窗口几何失败: {e}")
            return None

        # 尺寸小于最小尺寸，或位置被系统放到屏幕外（最小化时的 -32000），
        # 都视为异常状态，本次不落盘，保留上一次的正常几何。
        if width < _MAIN_WINDOW_MIN_WIDTH or height < _MAIN_WINDOW_MIN_HEIGHT:
            logger.debug(f"主窗口几何尺寸异常（{width}x{height}），跳过保存")
            return None
        if x < -1000 or y < -1000:
            logger.debug(f"主窗口几何位置异常（{x},{y}），跳过保存")
            return None
        return {"x": x, "y": y, "width": width, "height": height}

    def _schedule_geometry_save(self, *args):
        """moved/resized 回调：0.8s 防抖后落盘，避免拖动过程中频繁写文件。"""
        with self._geom_timer_lock:
            if self._geom_timer is not None:
                self._geom_timer.cancel()
            timer = threading.Timer(0.8, self._persist_geometry_silent)
            timer.daemon = True
            self._geom_timer = timer
            timer.start()

    def _persist_geometry_silent(self):
        """防抖落盘实现：只写文件不打日志，避免拖动时刷屏。"""
        state = self._collect_main_geometry()
        if state is None:
            return
        try:
            _save_main_window_geometry(state)
        except Exception as e:
            logger.debug(f"防抖保存主窗口几何失败: {e}")

    def _on_main_closing(self):
        """关闭前记录主窗口位置和大小，供下次启动恢复。"""
        state = self._collect_main_geometry()
        if state is None:
            return
        try:
            # 取消尚未触发的防抖保存，改为立即落盘一次
            with self._geom_timer_lock:
                if self._geom_timer is not None:
                    self._geom_timer.cancel()
                self._geom_timer = None
            _save_main_window_geometry(state)
            logger.info(
                "已保存主窗口位置和大小: "
                f"{state['width']}x{state['height']} @ ({state['x']}, {state['y']})"
            )
        except Exception as e:
            logger.warning(f"保存主窗口位置和大小失败: {e}")

    def _on_main_closed(self):
        """主窗口关闭时销毁子识别窗口"""
        logger.info("主窗口关闭，销毁子识别窗口")
        try:
            self.auto_watch.stop()
        except Exception:
            pass
        scanner = self.scanner_window
        self.scanner_window = None
        if scanner is not None:
            try:
                scanner.destroy()
            except Exception as e:
                logger.error(f"销毁子窗口异常:{e}")

    def open_scanner(self):
        """打开（或复用）跟随识别子窗口，避免并发重复创建。"""
        if not self._scanner_open_lock.acquire(blocking=False):
            logger.debug("已有打开子窗口任务进行中，忽略本次点击")
            return

        def _open():
            try:
                # 读取“系统设置 -> 窗口设置”里的跟随识别置顶开关，创建/复用都要保持一致
                try:
                    from core.services.user_storage import user_storage
                    topmost = bool(user_storage.get_app_settings().get("followTopMost", True))
                except Exception as e:
                    logger.warning(f"读取跟随识别置顶设置失败，使用默认置顶: {e}")
                    topmost = True

                if self.scanner_window is not None:
                    try:
                        # 重新打开(show)：恢复“跟随识别开启”标志，恢复本地存储轮询
                        try:
                            self.scanner_window.evaluate_js(
                                "try{localStorage.setItem('roco_follow_active','1')}catch(e){}"
                            )
                        except Exception as e:
                            logger.warning(f"设置 roco_follow_active 异常: {e}")
                        self.scanner_window.show()
                        # 复用窗口时也按最新设置重新置顶，避免与系统设置不一致
                        self.set_scanner_topmost_native(topmost)
                        logger.debug("子窗口已存在，执行show并同步置顶")
                        return
                    except Exception as e:
                        logger.warning(f"复用跟随识别窗口失败: {e}")
                        self.scanner_window = None

                logger.info("正在创建跟随识别窗口...")
                self.scanner_topmost = topmost
                self.scanner_window = webview.create_window(
                    title='精灵识别跟随',
                    url=f'{self.base_url}/?view=scanner',
                    width=500,
                    height=650,
                    frameless=True,
                    transparent=False,
                    on_top=topmost,
                    resizable=False,
                    # 只允许标题栏（前端 pywebview-drag-region）拖动窗口
                    easy_drag=False,
                    background_color='#F0F6FC',
                    js_api=self.js_api,
                )
                self.scanner_window.events.closed += self._on_scanner_closed
                self.scanner_window.show()
                logger.info("--> [Python] 子窗口已成功 show()")
            except Exception as e:
                logger.error(f"--> [Python] 创建子窗口失败: {e}")
            finally:
                self._scanner_open_lock.release()

        threading.Thread(target=_open, daemon=True).start()

    def _on_scanner_closed(self):
        self.scanner_window = None
        logger.info("子窗口被手动关闭")

    def close_scanner(self):
        """关闭跟随识别窗口：隐藏复用，避免反复创建/销毁导致卡死。"""
        if self.scanner_window is not None:
            try:
                # 关闭=隐藏：通知前端清除“跟随识别开启”标志，停止本地存储轮询
                try:
                    self.scanner_window.evaluate_js(
                        "try{localStorage.removeItem('roco_follow_active')}catch(e){}"
                    )
                except Exception as e:
                    logger.warning(f"清除 roco_follow_active 异常: {e}")
                self.scanner_window.hide()
                logger.info("跟随识别窗口已隐藏（复用，不销毁）")
            except Exception as e:
                logger.error(f"跟随识别窗口 hide 异常: {e}")
        return {"status": "closed"}

    def move_scanner(self, dx, dy):
        win = self.scanner_window
        if win:
            x, y = win.position
            win.move(x + dx, y + dy)
            logger.debug(f"移动子窗口: dx={dx}, dy={dy}, 新位置=({x + dx}, {y + dy})")

    def resize_scanner(self, width, height):
        """前端内容变化时，按前端量出的尺寸动态调整子窗口大小"""
        win = self.scanner_window
        if win is None:
            return {"status": "no_window"}
        try:
            # 钳位，防止内容测量异常把窗口撑爆或缩没
            width = max(360, min(int(width), 1920))
            height = max(600, min(int(height), 1600))
            win.resize(width, height)
            logger.debug(f"子窗口自适应: {width}x{height}")
            return {"status": "ok", "width": width, "height": height}
        except Exception as e:
            logger.error(f"resize_scanner_window 异常: {e}")
            return {"status": "error", "message": str(e)}
