"""WebView2 运行环境自检与白屏兜底。

pywebview 在 Windows 上默认使用 EdgeChromium（WebView2）后端渲染界面。
部分精简版 Windows / 网吧镜像会移除 WebView2 Runtime，此时主窗口会直接白屏，
而白屏窗口本身无法再向用户提示任何信息。因此检测必须满足：

1. 只依赖标准库（winreg 读注册表 + tkinter 画提示框），不依赖 WebView2/.NET，
   在运行时缺失的机器上也一定能执行；
2. 在任何 webview 窗口创建之前完成，确认缺失就弹出与主界面同风格的引导框并
   终止启动，绝不进入会白屏的渲染流程；
3. 检测不确定（非 Windows、winreg 不可用）时不拦截，避免误伤正常用户；
4. tkinter 极端情况下不可用时，回退到 Win32 原生 MessageBox，保证一定有提示。

下载地址（Evergreen Standalone Installer）：
https://developer.microsoft.com/zh-cn/microsoft-edge/webview2/
"""
import ctypes
import os
import sys

from core.infra.logger import logger

# WebView2 Runtime 在注册表 EdgeUpdate\Clients 下固定的 CLSID
_WV2_CLSID = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
# 中文下载页（由需求指定）
_WV2_DOWNLOAD_URL = 'https://developer.microsoft.com/zh-cn/microsoft-edge/webview2/'

# ---- 与主界面 / 启动提示一致的品牌配色 ----
_C_BRAND = '#2B78C4'        # 主品牌蓝（深）
_C_BRAND_MID = '#7ABCF4'    # 品牌蓝（中，标题栏/边框）
_C_BRAND_LIGHT = '#5DA8E8'  # 品牌蓝（渐变收尾）
_C_BG_SOFT = '#EBF4FE'      # 浅蓝底
_C_BG_FOOTER = '#F5F9FF'    # 底部按钮区底色
_C_TEXT = '#1F2D3D'         # 主文字
_C_TEXT_SUB = '#51607A'     # 次要文字（步骤说明）
_C_BORDER_SOFT = '#D7E7F8'  # 浅蓝描边

# 原生 MessageBox 回退标志
_MB_ICONERROR = 0x00000010
_MB_YESNO = 0x00000004
_MB_TASKMODAL = 0x00002000
_MB_SETFOREGROUND = 0x00010000
_MB_TOPMOST = 0x00040000
_MB_FLAGS = (
    _MB_ICONERROR | _MB_YESNO | _MB_TASKMODAL | _MB_SETFOREGROUND | _MB_TOPMOST
)
_IDYES = 6


# --------------------------------------------------------------------------- #
# 运行环境检测
# --------------------------------------------------------------------------- #
def _read_reg_pv(root, sub_path: str):
    """读取注册表某路径下的 pv（版本）值；任何失败都返回 None。"""
    try:
        import winreg
        with winreg.OpenKey(root, sub_path) as key:
            value, _ = winreg.QueryValueEx(key, 'pv')
            return str(value) if value else None
    except OSError:
        # 键不存在属于正常情况（该视图下没装），不算异常
        return None
    except Exception as e:
        logger.debug(f"读取注册表 WebView2 版本失败 {sub_path}: {e}")
        return None


def detect_webview2_runtime():
    """检测系统是否安装 WebView2 Runtime。

    返回：
    - 版本字符串（如 "151.0.4129.78"）：已安装；
    - None：确定未检测到（Windows 但三个注册表位置都没有）；
    - "unknown"：非 Windows 或无法使用 winreg，无法判断，调用方不应拦截启动。
    """
    # 测试钩子：设置 ROCO_SIMULATE_NO_WEBVIEW2=1 可在“已安装 WebView2”的开发机上
    # 强制判定为未安装，用于复现缺失弹窗与启动拦截。正常用户不会有此变量，不影响生产。
    if os.environ.get("ROCO_SIMULATE_NO_WEBVIEW2") == "1":
        logger.warning("[模拟] ROCO_SIMULATE_NO_WEBVIEW2=1，强制判定未安装 WebView2")
        return None

    if sys.platform != 'win32':
        return 'unknown'
    try:
        import winreg
        # 依次覆盖：64 位系统下的 32 位安装、64 位本机安装、当前用户按需安装
        candidates = [
            (winreg.HKEY_LOCAL_MACHINE,
             f'SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{_WV2_CLSID}'),
            (winreg.HKEY_LOCAL_MACHINE,
             f'SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\{_WV2_CLSID}'),
            (winreg.HKEY_CURRENT_USER,
             f'SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\{_WV2_CLSID}'),
        ]
    except Exception as e:
        logger.debug(f"无 winreg，跳过 WebView2 检测: {e}")
        return 'unknown'

    for root, sub in candidates:
        ver = _read_reg_pv(root, sub)
        if ver:
            logger.info(f"检测到 WebView2 Runtime: {ver}")
            return ver

    logger.warning("未检测到 WebView2 Runtime")
    return None


# --------------------------------------------------------------------------- #
# 打开外部链接（多重兜底，解决点按钮不跳转）
# --------------------------------------------------------------------------- #
def open_download_page(url: str = _WV2_DOWNLOAD_URL) -> bool:
    """用系统默认浏览器打开下载页，三级兜底；任一成功即返回 True。"""
    # 1) ShellExecuteW：走系统外壳关联，windowed 打包后最可靠
    try:
        instance = ctypes.windll.shell32.ShellExecuteW(
            None, "open", url, None, None, 1  # SW_SHOWNORMAL
        )
        if int(instance) > 32:  # ShellExecute 返回值 >32 才算成功
            return True
    except Exception as e:
        logger.debug(f"ShellExecuteW 打开下载页失败: {e}")
    # 2) os.startfile
    try:
        os.startfile(url)  # type: ignore[attr-defined]
        return True
    except Exception as e:
        logger.debug(f"os.startfile 打开下载页失败: {e}")
    # 3) webbrowser
    try:
        import webbrowser
        if webbrowser.open(url):
            return True
    except Exception as e:
        logger.debug(f"webbrowser 打开下载页失败: {e}")
    logger.error("所有方式均无法打开浏览器下载页")
    return False


def _ui_scale() -> float:
    """高 DPI 屏（如 150%）下整体放大 UI，保证清晰且比例一致。"""
    try:
        percent = int(ctypes.windll.shcore.GetScaleFactorForDevice(0))
        if percent >= 100:
            return percent / 100.0
    except Exception:
        pass
    try:
        dpi = int(ctypes.windll.user32.GetDpiForSystem())
        if dpi >= 96:
            return dpi / 96.0
    except Exception:
        pass
    return 1.0


def _hex_to_rgb(hex_color: str):
    h = hex_color.lstrip('#')
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


# --------------------------------------------------------------------------- #
# 与主界面同风格的精致引导框（tkinter，不依赖 WebView2）
# --------------------------------------------------------------------------- #
class _MissingDialog:
    """蓝边白卡 + 渐变标题栏 + 分步教程的模态对话框，视觉对齐主界面弹窗。"""

    STEPS = [
        ("打开官方下载页",
         "点下方「打开下载页」会用浏览器打开微软官网；若没弹出，就点「复制链接」"
         "再粘贴到浏览器地址栏。"),
        ("找到独立安装程序",
         "在页面的 “Evergreen Standalone Installer（常青独立安装程序）” 一栏，"
         "点它旁边的下载按钮。"),
        ("选择电脑对应的版本",
         "列表里一般选 “x64”（绝大多数台式机 / 笔记本）；确认是 ARM 架构才选 ARM64。"),
        ("安装后重新打开本助手",
         "双击下载好的安装包，点「接受并安装」，几秒后提示成功即可（无需重启电脑），"
         "再重新打开本助手。"),
    ]

    def __init__(self, scale: float):
        self.s = scale
        self.root = None

    def S(self, v):
        """基准像素 -> 当前 DPI 像素。"""
        return int(round(v * self.s))

    def run(self):
        import tkinter as tk
        self.tk = tk
        root = tk.Tk()
        self.root = root
        root.title("__wv2_missing__")  # 仅用于测试/查找，overrideredirect 不显示
        root.overrideredirect(True)              # 自绘标题栏
        root.attributes("-topmost", True)
        # 固定 1pt=1px，字号统一交给 S() 按 DPI 放大，避免与 tk scaling 双重缩放
        try:
            root.tk.call("tk", "scaling", 1.0)
        except Exception:
            pass

        win_w = self.S(600)
        root.configure(bg=_C_BRAND_MID)
        # 先隐藏，按内容算出真实高度后再居中显示，避免固定高度裁掉内容/留大片空白
        root.withdraw()

        outer = tk.Frame(root, bg=_C_BRAND_MID)
        outer.pack(fill="both", expand=True, padx=self.S(3), pady=self.S(3))
        body = tk.Frame(outer, bg="white")
        body.pack(fill="both", expand=True)

        self._build_header(body)
        self._build_content(body)
        self._build_footer(body)

        # 依据子控件实际请求高度自适应，最高不超过屏幕的 92%
        root.update_idletasks()
        border = self.S(3) * 2
        win_h = min(body.winfo_reqheight() + border,
                    int(root.winfo_screenheight() * 0.92))
        sw, sh = root.winfo_screenwidth(), root.winfo_screenheight()
        x, y = max(0, (sw - win_w) // 2), max(0, (sh - win_h) // 2)
        root.geometry(f"{win_w}x{win_h}+{x}+{y}")
        root.resizable(False, False)
        root.deiconify()

        root.bind("<Escape>", lambda e: self.close())
        root.after(60, self._safe_grab)
        root.mainloop()

    def _safe_grab(self):
        try:
            self.root.grab_set()
        except Exception:
            pass

    # ---- 标题栏（横向渐变 + 可拖动 + 关闭）---- #
    def _build_header(self, parent):
        tk, S = self.tk, self.S
        h = S(52)
        cv = tk.Canvas(parent, height=h, highlightthickness=0, bd=0, bg=_C_BRAND_MID)
        cv.pack(fill="x")
        c1, c2 = _hex_to_rgb(_C_BRAND_MID), _hex_to_rgb(_C_BRAND_LIGHT)

        def paint(event=None):
            w = cv.winfo_width()
            cv.delete("grad")
            for i in range(w):
                t = i / max(1, w - 1)
                color = "#%02x%02x%02x" % (
                    int(c1[0] + (c2[0] - c1[0]) * t),
                    int(c1[1] + (c2[1] - c1[1]) * t),
                    int(c1[2] + (c2[2] - c1[2]) * t),
                )
                cv.create_line(i, 0, i, h, fill=color, tags="grad")
            cv.tag_lower("grad")
            cv.coords("title", S(18), h // 2)
            cv.coords("close", w - S(24), h // 2)

        cv.bind("<Configure>", paint)
        cv.create_text(0, 0, anchor="w", tags="title",
                       text="缺少必要组件 · WebView2 运行环境",
                       fill="white", font=("Microsoft YaHei", S(13), "bold"))
        close = cv.create_text(0, 0, tags="close", text="✕", fill="white",
                               font=("Microsoft YaHei", S(12), "bold"))
        cv.tag_bind(close, "<Button-1>", lambda e: self.close())
        cv.tag_bind(close, "<Enter>", lambda e: cv.itemconfig(close, fill="#FFE3E3"))
        cv.tag_bind(close, "<Leave>", lambda e: cv.itemconfig(close, fill="white"))

        # 按住标题栏拖动窗口
        drag = {"x": 0, "y": 0}

        def on_press(e):
            drag["x"], drag["y"] = e.x_root, e.y_root

        def on_drag(e):
            dx, dy = e.x_root - drag["x"], e.y_root - drag["y"]
            drag["x"], drag["y"] = e.x_root, e.y_root
            self.root.geometry(f"+{self.root.winfo_x()+dx}+{self.root.winfo_y()+dy}")

        cv.bind("<Button-1>", on_press)
        cv.bind("<B1-Motion>", on_drag)

    # ---- 内容区 ---- #
    def _build_content(self, parent):
        tk, S = self.tk, self.S
        content = tk.Frame(parent, bg="white")
        content.pack(fill="both", expand=True, padx=S(20), pady=(S(14), S(6)))

        # 顶部：下载图标 + 一句话说明
        intro = tk.Frame(content, bg="white")
        intro.pack(fill="x")
        icon = tk.Canvas(intro, width=S(38), height=S(38), bg="white",
                         highlightthickness=0)
        icon.create_oval(2, 2, S(38) - 2, S(38) - 2, fill=_C_BRAND, outline="")
        icon.create_text(S(19), S(20), text="↓", fill="white",
                         font=("Microsoft YaHei", S(18), "bold"))
        icon.pack(side="left", padx=(0, S(12)), anchor="n")
        tk.Label(
            intro, bg="white", fg=_C_TEXT, justify="left", anchor="w",
            text="本助手依靠微软的 WebView2 组件来显示界面，当前电脑未安装，\n"
                 "继续打开会白屏。跟着下面 4 步，约 2 分钟即可装好：",
            font=("Microsoft YaHei", S(10)), wraplength=S(496),
        ).pack(side="left", fill="x", expand=True)

        # 浅蓝提示条
        info = tk.Frame(content, bg=_C_BG_SOFT)
        info.pack(fill="x", pady=S(10))
        tk.Label(
            info, bg=_C_BG_SOFT, fg=_C_BRAND, justify="left",
            text="微软官方 · 免费 · 安全组件；Windows 11 一般已自带，无需额外设置。",
            font=("Microsoft YaHei", S(9)), wraplength=S(520),
            padx=S(10), pady=S(7),
        ).pack(fill="x")

        # 分步教程
        for idx, (title, desc) in enumerate(self.STEPS, 1):
            row = tk.Frame(content, bg="white")
            row.pack(fill="x", pady=S(3), anchor="w")
            num = tk.Canvas(row, width=S(24), height=S(24), bg="white",
                            highlightthickness=0)
            num.create_oval(1, 1, S(24) - 1, S(24) - 1,
                            fill=_C_BRAND_MID, outline="")
            num.create_text(S(12), S(13), text=str(idx), fill="white",
                            font=("Microsoft YaHei", S(10), "bold"))
            num.pack(side="left", padx=(0, S(10)), anchor="n", pady=S(2))
            col = tk.Frame(row, bg="white")
            col.pack(side="left", fill="x", expand=True)
            tk.Label(col, bg="white", fg=_C_TEXT, text=title, anchor="w",
                     justify="left",
                     font=("Microsoft YaHei", S(10), "bold")).pack(fill="x")
            tk.Label(col, bg="white", fg=_C_TEXT_SUB, text=desc, anchor="w",
                     justify="left", wraplength=S(490),
                     font=("Microsoft YaHei", S(9))).pack(fill="x")

        tk.Label(
            content, bg="white", fg="#94A3B8", justify="left",
            text="提示：公司 / 网吧 / 学校电脑若提示没有安装权限，请联系管理员协助。",
            font=("Microsoft YaHei", S(8)),
        ).pack(fill="x", pady=(S(8), 0))

    # ---- 底部按钮区 ---- #
    def _build_footer(self, parent):
        tk, S = self.tk, self.S
        footer = tk.Frame(parent, bg=_C_BG_FOOTER, height=S(58))
        footer.pack(fill="x", side="bottom")
        footer.pack_propagate(False)
        tk.Frame(footer, bg=_C_BORDER_SOFT, height=1).pack(fill="x", side="top")
        inner = tk.Frame(footer, bg=_C_BG_FOOTER)
        inner.pack(fill="both", expand=True, padx=S(16))

        tk.Button(
            inner, text="退出程序", relief="flat", bd=0, bg=_C_BG_FOOTER,
            fg="#94A3B8", activebackground=_C_BG_FOOTER, activeforeground=_C_BRAND,
            cursor="hand2", font=("Microsoft YaHei", S(10)),
            command=self.close,
        ).pack(side="left")

        right = tk.Frame(inner, bg=_C_BG_FOOTER)
        right.pack(side="right")

        copy_btn = tk.Button(
            right, text="复制下载链接", relief="flat", bd=1, bg="white",
            fg=_C_BRAND, activebackground="#EAF4FF", cursor="hand2",
            highlightthickness=1, highlightbackground=_C_BRAND_MID,
            highlightcolor=_C_BRAND_MID, font=("Microsoft YaHei", S(10), "bold"),
            padx=S(12), pady=S(6),
        )
        copy_btn.pack(side="left", padx=(0, S(10)))

        open_btn = tk.Button(
            right, text="打开下载页", relief="flat", bd=0, bg=_C_BRAND,
            fg="white", activebackground="#1C5FA8", activeforeground="white",
            cursor="hand2", font=("Microsoft YaHei", S(10), "bold"),
            padx=S(18), pady=S(6),
        )
        open_btn.pack(side="left")

        def do_copy():
            try:
                self.root.clipboard_clear()
                self.root.clipboard_append(_WV2_DOWNLOAD_URL)
                self.root.update()
                old = copy_btn.cget("text")
                copy_btn.config(text="已复制 ✓", fg="#16A34A")
                self.root.after(1600, lambda: copy_btn.config(text=old, fg=_C_BRAND))
            except Exception as e:
                logger.error(f"复制下载链接失败: {e}")

        def do_open():
            ok = open_download_page()
            open_btn.config(
                text="已打开，去浏览器查看" if ok else "打开失败，请点复制链接",
                bg=_C_BRAND if ok else "#D64545",
            )

        copy_btn.config(command=do_copy)
        open_btn.config(command=do_open)

    def close(self):
        try:
            self.root.grab_release()
        except Exception:
            pass
        try:
            self.root.destroy()
        except Exception:
            pass


def _show_native_fallback():
    """tkinter 不可用时的最后防线：Win32 原生消息框。"""
    text = (
        "程序界面依赖 Windows 组件「Microsoft Edge WebView2 Runtime」，\n"
        "当前系统未检测到该组件（精简版系统 / 网吧环境可能已被移除）。\n\n"
        "请下载安装「Evergreen Standalone Installer」后重新打开：\n"
        f"{_WV2_DOWNLOAD_URL}\n\n"
        "点「是」打开下载页，点「否」退出。"
    )
    try:
        result = ctypes.windll.user32.MessageBoxW(
            0, text, "缺少 WebView2 运行环境", _MB_FLAGS
        )
        if result == _IDYES:
            open_download_page()
    except Exception as e:
        logger.error(f"弹出 WebView2 缺失提示失败: {e}")


def show_runtime_missing_dialog():
    """弹出缺失引导框（优先精致 GUI，失败回退原生框），用户关闭后返回。"""
    try:
        _MissingDialog(_ui_scale()).run()
    except Exception as e:
        logger.error(f"创建精致引导框失败，回退原生消息框: {e}", exc_info=True)
        _show_native_fallback()


def ensure_webview2_ready() -> bool:
    """启动前的统一入口。

    返回 True 表示可以继续启动（已安装 / 无法判断时放行）；
    返回 False 表示确认缺失、已向用户弹窗引导，调用方应直接终止启动。
    """
    version = detect_webview2_runtime()
    if version is None:
        show_runtime_missing_dialog()
        return False
    return True
