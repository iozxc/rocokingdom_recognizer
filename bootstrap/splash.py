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

# 存活的提示窗口注册表：进程退出前统一 close，避免 Tk 解释器在错误的线程被清理
_LIVE_HINTS = set()
_LIVE_HINTS_LOCK = threading.Lock()


def _round_rect(canvas, x1, y1, x2, y2, r, **kwargs):
    """在 Canvas 上画圆角矩形，返回 item id。"""
    r = min(r, (x2 - x1) / 2, (y2 - y1) / 2)
    points = (
        x1 + r, y1, x2 - r, y1, x2, y1, x2, y1 + r,
        x2, y2 - r, x2, y2, x2 - r, y2, x1 + r, y2,
        x1, y2, x1, y2 - r, x1, y1 + r, x1, y1,
    )
    return canvas.create_polygon(points, smooth=True, **kwargs)


class _TkThread:
    """单一 tkinter 后台线程 + 共享 Tk root。

    所有提示窗口(Toplevel)的创建、动画、关闭都在这条线程内执行，
    保证 Tcl/Tk 对象只被同一线程访问，从根本上避免
    "Tcl_AsyncDelete: async handler deleted by the wrong thread"。
    """
    def __init__(self):
        self._tk = None
        self._root = None
        self._ready = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True, name="tk-hint-thread")
        self._thread.start()

    def _run(self):
        try:
            import tkinter as tk
        except Exception as e:
            logger.debug(f"无法加载 tkinter，跳过提示窗口: {e}")
            self._ready.set()
            return
        self._tk = tk
        try:
            self._root = tk.Tk()
            self._root.withdraw()  # 隐藏根窗口，只用 Toplevel 子窗口
        except Exception as e:
            logger.debug(f"创建 Tk root 失败: {e}")
            self._root = None
        self._ready.set()
        if self._root is not None:
            try:
                self._root.mainloop()
            except Exception:
                pass

    def wait_ready(self, timeout=3.0):
        self._ready.wait(timeout=timeout)

    def after(self, ms, fn):
        """把 fn 调度到 tk 线程执行，保证线程安全。"""
        root = self._root
        if root is None:
            return False
        try:
            root.after(ms, fn)
            return True
        except Exception:
            return False

    def shutdown(self):
        root = self._root
        if root is not None:
            try:
                root.after(0, root.destroy)
            except Exception:
                pass


_TK = None
_TK_LOCK = threading.Lock()


def _get_tk():
    global _TK
    if _TK is None:
        with _TK_LOCK:
            if _TK is None:
                t = _TkThread()
                t.wait_ready()
                _TK = t
    return _TK


class _HintWindow:
    """基于共享 _TkThread 的提示窗口(Toplevel)。"""
    def __init__(self, title, message):
        self._stop = threading.Event()
        self._tk_thread = _get_tk()
        self._started = threading.Event()
        self._tk_thread.after(0, lambda: self._run_on_tk(title, message))
        self._started.wait(timeout=3)

    def _run_on_tk(self, title, message):
        tk = self._tk_thread._tk
        root = self._tk_thread._root
        if tk is None or root is None:
            self._started.set()
            return
        try:
            top = tk.Toplevel(root)
            top.overrideredirect(True)
            top.attributes("-topmost", True)
            top.attributes("-alpha", ALPHA)
            top.configure(bg=BORDER_COLOR)
            screen_w = top.winfo_screenwidth()
            screen_h = top.winfo_screenheight()
            x = max(0, (screen_w - WIDTH) // 2)
            y = max(0, (screen_h - HEIGHT) // 2)
            top.geometry(f"{WIDTH}x{HEIGHT}+{x}+{y}")

            canvas = tk.Canvas(top, width=WIDTH, height=HEIGHT, bg=BODY_COLOR,
                               highlightthickness=0)
            canvas.pack(fill="both", expand=True)
            self._draw(canvas, title, message)
            top.update()
            self._top = top
            self._canvas = canvas

            start_time = time.monotonic()

            def _animate(frame=0):
                if self._stop.is_set():
                    self._destroy()
                    return
                if time.monotonic() - start_time > _MAX_LIFETIME_SECONDS:
                    self._destroy()
                    return
                self._move_bar(canvas, frame)
                self._tk_thread.after(30, lambda: _animate(frame + 1))

            self._tk_thread.after(30, lambda: _animate(0))
            self._started.set()
        except Exception as e:
            logger.debug(f"提示窗口创建失败: {e}")
            self._started.set()

    def _draw(self, canvas, title, message):
        canvas.create_rectangle(0, 0, WIDTH, HEADER_HEIGHT, fill=HEADER_COLOR, outline="")
        canvas.create_text(20, HEADER_HEIGHT // 2, anchor="w", text=title,
                           fill=TITLE_COLOR, font=("Microsoft YaHei", 15, "bold"))
        canvas.create_text(20, HEADER_HEIGHT + 40, anchor="w", text=message,
                           fill=BODY_TEXT_COLOR, font=("Microsoft YaHei", 11))
        bar_y1 = HEIGHT - 42
        bar_y2 = bar_y1 + BAR_HEIGHT
        canvas.create_rectangle(20, bar_y1, 20 + BAR_TROUGH_WIDTH, bar_y2,
                                fill=TRACK_COLOR, outline="")
        self._bar_item = _round_rect(canvas, 20, bar_y1, 20 + 60, bar_y2, 5,
                                     fill=BAR_COLOR, outline="")
        close_size = 20
        c_x = WIDTH - close_size - 12
        c_y = 12
        close_tag = "close"
        canvas.create_rectangle(c_x, c_y, c_x + close_size, c_y + close_size,
                                fill=CLOSE_BG, outline="", tags=(close_tag,))
        canvas.create_text(c_x + close_size // 2, c_y + close_size // 2,
                           text="×", fill="#3B82F6", font=("Microsoft YaHei", 13, "bold"),
                           tags=(close_tag,))
        canvas.tag_bind(close_tag, "<Button-1>", lambda e: self.close())

    def _move_bar(self, canvas, frame):
        bar_y1 = HEIGHT - 42
        bar_y2 = bar_y1 + BAR_HEIGHT
        bar_x1 = (WIDTH - BAR_TROUGH_WIDTH) / 2
        max_x = bar_x1 + BAR_TROUGH_WIDTH - 60
        x = bar_x1 + (frame * BAR_STEP) % max(1, int(max_x - bar_x1))
        canvas.delete(self._bar_item)
        self._bar_item = _round_rect(canvas, x, bar_y1, x + 60, bar_y2, 5,
                                     fill=BAR_COLOR, outline="")

    def _destroy(self):
        top = getattr(self, "_top", None)
        if top is not None:
            try:
                top.destroy()
            except Exception:
                pass

    def close(self):
        self._stop.set()
        self._tk_thread.after(0, self._destroy)
        with _LIVE_HINTS_LOCK:
            _LIVE_HINTS.discard(self)


def show_hint(title=_DEFAULT_TITLE, message=_DEFAULT_MESSAGE):
    """显示蓝白风格的启动/退出提示窗口，返回可 close 的对象；失败时返回 None。"""
    try:
        win = _HintWindow(title, message)
        with _LIVE_HINTS_LOCK:
            _LIVE_HINTS.add(win)
        return win
    except Exception as e:
        logger.debug(f"提示窗口创建失败: {e}")
        return None


def close_all_hints():
    """关闭所有存活的提示窗口（供进程退出前调用，避免 Tcl 跨线程清理报错）。"""
    with _LIVE_HINTS_LOCK:
        windows = list(_LIVE_HINTS)
    for win in windows:
        try:
            win.close()
        except Exception as e:
            logger.debug(f"关闭提示窗口失败: {e}")
