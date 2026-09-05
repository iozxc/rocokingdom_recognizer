"""桌面窗口管理：主窗口与“跟随识别”子窗口的创建、关闭、移动与自适应。"""
import ctypes
import threading

import pygetwindow as gw
import webview

from core.infra.logger import logger

# 主窗口的默认配置尺寸；低分辨率屏幕下会自动降级为全屏
_MAIN_WINDOW_WIDTH = 1680
_MAIN_WINDOW_HEIGHT = 1080
_MAIN_WINDOW_MIN_WIDTH = 555
_MAIN_WINDOW_MIN_HEIGHT = 300


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

        如果配置的窗口尺寸大于桌面分辨率（低分辨率小屏幕），
        则直接以全屏方式显示，避免窗口超出屏幕无法操作。
        """
        screen_w, screen_h = _get_screen_size()
        use_fullscreen = (
            _MAIN_WINDOW_WIDTH > screen_w or _MAIN_WINDOW_HEIGHT > screen_h
        )

        window_kwargs = {
            "title": '洛克王国徽章试炼助手',
            "url": self.base_url,
            "width": screen_w if use_fullscreen else _MAIN_WINDOW_WIDTH,
            "height": screen_h if use_fullscreen else _MAIN_WINDOW_HEIGHT,
            "js_api": self.js_api,
        }
        if use_fullscreen:
            logger.info(
                f"桌面分辨率 {screen_w}x{screen_h} 小于配置窗口尺寸，"
                f"主窗口改为全屏显示"
            )
            window_kwargs["fullscreen"] = True
        else:
            window_kwargs["min_size"] = (
                _MAIN_WINDOW_MIN_WIDTH,
                _MAIN_WINDOW_MIN_HEIGHT,
            )

        self.main_window = webview.create_window(**window_kwargs)
        self.main_window.events.closed += self._on_main_closed
        logger.info("主窗口创建完成")
        return self.main_window

    def _on_main_closed(self):
        """主窗口关闭时销毁子识别窗口"""
        logger.info("主窗口关闭，销毁子识别窗口")
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

