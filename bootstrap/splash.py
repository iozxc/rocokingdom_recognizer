"""启动/退出提示窗口：蓝白风格，与应用前端配色保持一致。

纯 Canvas 绘制，不依赖 ttk 主题，文字渲染更稳定。
开发调试可以直接改下面的颜色常量，或用 tools/preview_hint.py 即时预览。
"""
import ctypes
import threading
import time

from core.logger import logger

# ---- 配色（与前端 Header 一致；调试时可临时修改）----
BORDER_COLOR = "#5DA8E8"       # 外框蓝
HEADER_COLOR = "#7ABCF4"       # 顶部标题栏蓝
TITLE_COLOR = "#FFFFFF"        # 标题白字
BODY_COLOR = "#FFFFFF"         # 内容区白
BODY_TEXT_COLOR = "#2B78C4"    # 内容区文字蓝
TRACK_COLOR = "#EAF4FF"        # 进度条底槽浅蓝
BAR_COLOR = "#7ABCF4"          # 进度条滑块蓝
CLOSE_BG = "#E8F4FF"           # 右上角关闭按钮底色（浅蓝，近似半透明白）
ALPHA = 0.8                    # 窗口整体透明度（1=不透明，越小越透明）

# ---- 尺寸 ----
WIDTH = 400
HEIGHT = 180
HEADER_HEIGHT = 50
BAR_TROUGH_WIDTH = 240
BAR_HEIGHT = 10
BAR_STEP = 4                   # 进度条每帧移动像素

_DEFAULT_TITLE = "洛克王国徽章试炼助手"
_DEFAULT_MESSAGE = "正在启动，请稍候..."
# 最长展示时间，避免异常情况下提示窗口一直挂着
_MAX_LIFETIME_SECONDS = 30


def _round_rect(canvas, x1, y1, x2, y2, r, **kwargs):
    """在 Canvas 上画圆角矩形，返回 item id。"""
    r = min(r, (x2 - x1) / 2, (y2 - y1) / 2)
    points = (
        x1 + r, y1, x2 - r, y1, x2, y1, x2, y1 + r,
        x2, y2 - r, x2, y2, x2 - r, y2, x1 + r, y2,
        x1, y2, x1, y2 - r, x1, y1 + r, x1, y1,
    )
    return canvas.create_polygon(points, smooth=True, **kwargs)


class _HintWindow:
    def __init__(self, title: str, message: str):
        self._stop = threading.Event()
        self._thread = threading.Thread(
            target=self._run,
            args=(title, message),
            daemon=True,
            name="hint-window",
        )
        self._thread.start()

    def _run(self, title: str, message: str):
        try:
            import tkinter as tk
        except Exception as e:
            logger.debug(f"无法加载 tkinter，跳过提示窗口: {e}")
            return

        root = None
        try:
            root = tk.Tk()
            root.overrideredirect(True)
            root.attributes("-topmost", True)
            root.attributes("-alpha", ALPHA)
            root.configure(bg=BORDER_COLOR)

            screen_w = root.winfo_screenwidth()
            screen_h = root.winfo_screenheight()
            x = max(0, (screen_w - WIDTH) // 2)
            y = max(0, (screen_h - HEIGHT) // 2)
            root.geometry(f"{WIDTH}x{HEIGHT}+{x}+{y}")

            canvas = tk.Canvas(
                root,
                width=WIDTH,
                height=HEIGHT,
                bg=BODY_COLOR,
                highlightthickness=0,
            )
            canvas.pack(fill="both", expand=True)

            self._draw(canvas, title, message)
            self._bind_close_button(canvas, root)
            root.update()  # 先渲染一帧，避免首屏白屏/文字不显示
            start_time = time.monotonic()

            # Windows 11 下开启圆角
            try:
                hwnd = ctypes.windll.user32.GetParent(root.winfo_id())
                preference = ctypes.c_int(2)  # DWMWCP_ROUND
                ctypes.windll.dwmapi.DwmSetWindowAttribute(
                    hwnd, 33, ctypes.byref(preference), ctypes.sizeof(preference)
                )
            except Exception:
                pass

            def _animate(frame=0):
                if self._stop.is_set():
                    root.destroy()
                    return
                if time.monotonic() - start_time > _MAX_LIFETIME_SECONDS:
                    root.destroy()
                    return
                self._move_bar(canvas, frame)
                root.after(30, lambda: _animate(frame + 1))

            root.after(30, lambda: _animate(0))
            root.mainloop()
        except Exception as e:
            if root is not None:
                try:
                    root.destroy()
                except Exception:
                    pass
            logger.debug(f"提示窗口创建失败，忽略: {e}")

    def _draw(self, canvas, title, message):
        # 外框：白底 + 蓝描边
        _round_rect(
            canvas, 2, 2, WIDTH - 3, HEIGHT - 3, 16,
            fill=BODY_COLOR, outline=BORDER_COLOR, width=3,
        )
        # 顶部蓝色标题栏
        _round_rect(
            canvas, 2, 2, WIDTH - 3, HEADER_HEIGHT + 2, 16,
            fill=HEADER_COLOR, outline="",
        )
        canvas.create_text(
            WIDTH / 2, HEADER_HEIGHT / 2 + 2,
            text=title, fill=TITLE_COLOR, font=("Microsoft YaHei", 14, "bold"),
        )
        # 消息文字
        canvas.create_text(
            WIDTH / 2, HEADER_HEIGHT + 38,
            text=message, fill=BODY_TEXT_COLOR, font=("Microsoft YaHei", 10),
        )
        # 进度条底槽 + 初始滑块
        bar_y1 = HEIGHT - 42
        bar_y2 = bar_y1 + BAR_HEIGHT
        bar_x1 = (WIDTH - BAR_TROUGH_WIDTH) / 2
        bar_x2 = bar_x1 + BAR_TROUGH_WIDTH
        _round_rect(canvas, bar_x1, bar_y1, bar_x2, bar_y2, 5,
                    fill=TRACK_COLOR, outline="")
        self._bar_item = _round_rect(
            canvas, bar_x1, bar_y1, bar_x1 + 60, bar_y2, 5,
            fill=BAR_COLOR, outline="",
        )

    def _bind_close_button(self, canvas, root):
        """右上角“×”关闭按钮：点击后隐藏提示窗口，不影响应用继续启动/退出。"""
        cx = WIDTH - 28
        cy = HEADER_HEIGHT / 2 + 2
        radius = 13
        canvas.create_oval(
            cx - radius, cy - radius, cx + radius, cy + radius,
            fill=CLOSE_BG, outline="", tags=("close-circle",),
        )
        canvas.create_text(
            cx, cy, text="×", fill=BODY_TEXT_COLOR,
            font=("Microsoft YaHei", 13, "bold"),
            tags=("close-text",),
        )

        def _on_click(_event):
            self._dismiss(root)

        def _on_enter(_event):
            canvas.itemconfigure("close-circle", fill="#FFFFFF")
            canvas.itemconfigure("close-text", fill="#5DA8E8")

        def _on_leave(_event):
            canvas.itemconfigure("close-circle", fill=CLOSE_BG)
            canvas.itemconfigure("close-text", fill=BODY_TEXT_COLOR)

        for tag in ("close-circle", "close-text"):
            canvas.tag_bind(tag, "<Button-1>", _on_click)
            canvas.tag_bind(tag, "<Enter>", _on_enter)
            canvas.tag_bind(tag, "<Leave>", _on_leave)

    def _dismiss(self, root):
        """用户手动隐藏提示窗口（应用继续运行）。"""
        self._stop.set()
        try:
            root.destroy()
        except Exception:
            pass

    def _move_bar(self, canvas, frame):
        bar_y1 = HEIGHT - 42
        bar_y2 = bar_y1 + BAR_HEIGHT
        bar_x1 = (WIDTH - BAR_TROUGH_WIDTH) / 2
        max_x = bar_x1 + BAR_TROUGH_WIDTH - 60
        x = bar_x1 + (frame * BAR_STEP) % max(1, int(max_x - bar_x1))
        canvas.delete(self._bar_item)
        self._bar_item = _round_rect(
            canvas, x, bar_y1, x + 60, bar_y2, 5,
            fill=BAR_COLOR, outline="",
        )

    def close(self):
        """请求关闭提示窗口并等待线程退出。"""
        self._stop.set()
        self._thread.join(timeout=2)


def show_hint(title=_DEFAULT_TITLE, message=_DEFAULT_MESSAGE):
    """显示蓝白风格的启动/退出提示窗口，返回可 close 的对象；失败时返回 None。"""
    try:
        return _HintWindow(title, message)
    except Exception as e:
        logger.debug(f"提示窗口创建失败: {e}")
        return None
