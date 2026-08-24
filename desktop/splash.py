"""启动提示窗口：在应用完全就绪前显示一个与前端风格一致的小提示，避免用户误以为闪退。"""
import ctypes
import threading
import time

from core.logger import logger

# 与前端 Header 保持一致的主色调
_BG_COLOR = "#7ABCF4"        # 前端主色
_BORDER_COLOR = "#5DA8E8"    # 前端描边色
_TEXT_COLOR = "#FFFFFF"
_SUBTITLE_COLOR = "#EAF4FF"

_DEFAULT_TITLE = "洛克王国徽章试炼助手"
_DEFAULT_MESSAGE = "正在启动，请稍候..."
# 最长展示时间，避免异常情况下提示窗口一直挂着
_MAX_LIFETIME_SECONDS = 30


class _Splash:
    def __init__(self, title: str, message: str):
        self._stop = threading.Event()
        self._thread = threading.Thread(
            target=self._run,
            args=(title, message),
            daemon=True,
            name="startup-splash",
        )
        self._thread.start()

    def _run(self, title: str, message: str):
        try:
            import tkinter as tk
        except Exception as e:
            logger.debug(f"无法加载 tkinter，跳过启动提示: {e}")
            return

        root = None
        try:
            root = tk.Tk()
            root.overrideredirect(True)
            root.attributes("-topmost", True)
            root.configure(bg=_BORDER_COLOR, padx=3, pady=3)

            # 外层模拟 3px 描边，内层为主色内容区
            inner = tk.Frame(root, bg=_BG_COLOR)
            inner.pack(fill="both", expand=True)

            tk.Label(
                inner,
                text=title,
                bg=_BG_COLOR,
                fg=_TEXT_COLOR,
                font=("Microsoft YaHei", 16, "bold"),
            ).pack(pady=(28, 6))

            tk.Label(
                inner,
                text=message,
                bg=_BG_COLOR,
                fg=_SUBTITLE_COLOR,
                font=("Microsoft YaHei", 10),
            ).pack(pady=(0, 6))

            tk.Label(
                inner,
                text="·  ·  ·",
                bg=_BG_COLOR,
                fg=_SUBTITLE_COLOR,
                font=("Microsoft YaHei", 12, "bold"),
            ).pack(pady=(0, 22))

            root.update_idletasks()
            width = root.winfo_reqwidth()
            height = root.winfo_reqheight()
            x = (root.winfo_screenwidth() - width) // 2
            y = (root.winfo_screenheight() - height) // 2
            root.geometry(f"+{x}+{y}")
            root.deiconify()
            start_time = time.monotonic()

            # Windows 11 下开启圆角，贴近前端卡片风格
            try:
                hwnd = ctypes.windll.user32.GetParent(root.winfo_id())
                preference = ctypes.c_int(2)  # DWMWCP_ROUND
                ctypes.windll.dwmapi.DwmSetWindowAttribute(
                    hwnd, 33, ctypes.byref(preference), ctypes.sizeof(preference)
                )
            except Exception:
                pass

            def _tick():
                if self._stop.is_set():
                    root.destroy()
                    return
                if time.monotonic() - start_time > _MAX_LIFETIME_SECONDS:
                    root.destroy()
                    return
                root.after(100, _tick)

            root.after(100, _tick)
            root.mainloop()
        except Exception as e:
            if root is not None:
                try:
                    root.destroy()
                except Exception:
                    pass
            logger.debug(f"启动提示窗口创建失败，忽略: {e}")

    def close(self):
        """请求关闭提示窗口并等待线程退出。"""
        self._stop.set()
        self._thread.join(timeout=2)


def show_splash(title=_DEFAULT_TITLE, message=_DEFAULT_MESSAGE):
    """显示启动提示窗口，返回可 close 的对象；创建失败时返回 None。"""
    try:
        return _Splash(title, message)
    except Exception as e:
        logger.debug(f"启动提示创建失败: {e}")
        return None
