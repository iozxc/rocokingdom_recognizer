"""桌面窗口管理：主窗口与“跟随识别”子窗口的创建、关闭、移动与自适应。"""
import threading

import webview

from core.logger import logger


class WindowManager:
    """管理主窗口与子窗口的生命周期，供 JS 桥接层调用。"""

    def __init__(self, server_port: int, js_api=None):
        self.server_port = server_port
        self.js_api = js_api
        self.main_window = None
        self.scanner_window = None
        # 防止连点“跟随识别”并发创建多个子窗口导致卡死
        self._scanner_open_lock = threading.Lock()

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.server_port}"

    def create_main_window(self):
        """创建主窗口。"""
        self.main_window = webview.create_window(
            '洛克王国徽章试炼助手',
            self.base_url,
            width=1500,
            height=1000,
            min_size=(1200, 700),
            js_api=self.js_api,
        )
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
                if self.scanner_window is not None:
                    self.scanner_window.show()
                    self.scanner_window.restore()
                    self.scanner_window.on_top = True
                    logger.debug("子窗口已存在，执行show/restore")
                    return

                self.scanner_window = webview.create_window(
                    title='精灵识别跟随',
                    url=f'{self.base_url}/?view=scanner',
                    width=420,
                    height=546,
                    frameless=True,
                    transparent=False,
                    on_top=True,
                    resizable=True,
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
        if self.scanner_window is not None:
            try:
                self.scanner_window.destroy()
                logger.info("子窗口已关闭")
            except Exception as e:
                logger.error(f"destroy异常: {e}")
            self.scanner_window = None
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
            height = max(480, min(int(height), 1600))
            win.resize(width, height)
            logger.debug(f"子窗口自适应: {width}x{height}")
            return {"status": "ok", "width": width, "height": height}
        except Exception as e:
            logger.error(f"resize_scanner_window 异常: {e}")
            return {"status": "error", "message": str(e)}
