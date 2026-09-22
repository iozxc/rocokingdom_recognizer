"""跟随识别「自动模式」监控：每 0.25 秒截图一次，纯固定 ROI 门控（不跑 YOLO）。

两个子功能：
1. 自动识别（auto_scan）：检测到三卡选择界面（三个黑色卡面板的暗像素门，含「重置奖励」）
   时，等价于自动点一次「立即识别」（通过 evaluate_js 调用前端 __rocoTriggerSingleScan，
   复用现有识别全流程）；逐卡头像差分检测玩家花叶子刷新，NPC 单卡界面不触发。
2. 自动点亮（auto_mark）：进入战斗后，用右上角敌方绿血条 / Boss 同伴槽位 / 敌方头像
   DINO + 名字 OCR 三道门，把对战的精灵自动置为遇见（推 __rocoAutoEncounter 事件给前端）。

所有 ROI 都是相对全窗口（含标题栏）的比例坐标，随窗口分辨率自适应缩放。
"""
import threading
import time
from difflib import SequenceMatcher

import numpy as np
import pygetwindow as gw
from PIL import Image, ImageFilter

import config
from core.infra.capture import capture_by_hwnd, capture_by_grab
from core.infra.logger import logger

# 识别流程与自动监控共用的推理锁：避免两个 ONNX 会话并发跑同一份 DINO（DirectML 不保证并发安全）
watch_infer_lock = threading.RLock()

# ---------------- 固定 ROI（相对全窗口比例） ----------------
# 敌方绿血条
HP_BAR = (0.715, 0.066, 0.895, 0.104)
# Boss 同伴槽位行（精灵球圆圈）
STAR_ROW = (0.745, 0.105, 0.900, 0.145)
# 敌方圆形头像（收紧到圆盘本体，避开左上血条/右侧属性徽章；实测 1942/1295/960 三档
# 分辨率下与目标卡 DINO 相似度 0.877/0.842/0.699，旧框分别仅 0.728/0.79/0.84）
AVATAR = (0.93, 0.07, 0.975, 0.14)
# 敌方名字行（右对齐，单行；只裁名字行 y≈0.100~0.130，下面的“NN级”在 0.13 之后不能一起裁，
# 否则 rec 模型会被等级文字干扰、只读“4级”而丢掉名字）
NAME_LINE = (0.852, 0.100, 0.925, 0.130)
# 选择界面 3 张卡圆形头像的中心区域（逐张卡检测，玩家可单独刷新某一张）。
# 以 Hough 实测的圆心为准（三卡圆心 x≈0.318/0.507/0.695、y≈0.34），取直径约 0.06
# 的方形，主要覆盖精灵本体，尽量排除左上角属性徽章（星星/水滴）和卡名文字。
# 旧坐标（0.273…0.317）在 2560×1440 下偏移到圆形头像左缘，只裁到属性徽章、没裁到
# 精灵本体，导致同属性换卡（如布鲁斯→水蛇锁）差分过小、漏检刷新。
# 1920×1080（1942×1136）与 2560×1440（2568×1497）两档均目视确认覆盖精灵本体。
CARD_PORTRAITS = [
    (0.295, 0.305, 0.347, 0.370),
    (0.481, 0.305, 0.533, 0.370),
    (0.669, 0.305, 0.721, 0.370),
]
# 3 张卡的黑色信息面板（含「重置奖励」/「击败后获得」）：三卡选择界面判别门。
# 纯像素门，无需 OCR/推理锁，对窗口比例变化鲁棒；NPC 单卡界面只有中间一个面板。
CARD_PANELS = [
    (0.180, 0.420, 0.390, 0.600),
    (0.390, 0.420, 0.610, 0.600),
    (0.610, 0.420, 0.820, 0.600),
]
# 技能选择弹窗（叠势/吹火/回旋踢这种「三技能卡」）也有三块黑色面板，会误过暗像素门。
# 它底部中央有一个大的黄色「选择」按钮，三卡精灵选择界面没有；用该区域亮黄像素占比排除。
SKILL_BTN = (0.42, 0.90, 0.58, 0.98)

# ---------------- 门控阈值（均在 train/dataset/roi 的 8 张样本上实测） ----------------
GREEN_MIN = 0.05            # 血条亮绿像素占比：非战斗 0.2%，战斗 18%+
BOSS_CIRCLES_MIN = 3        # 同伴槽位圆圈数：普通战斗 0，Boss 5
DINO_MIN = 0.65             # 头像与本次 3 卡特征的最高余弦
DINO_MARGIN = 0.10          # 最高分相对次高分的领先间隔
DINO_MIN_STRICT = 0.60      # 名字 OCR 几乎确定时，头像只需达到的兜底余弦
DINO_FALLBACK_MIN = 0.75    # OCR 缺失时 DINO 单模态的高分阈值
DINO_FALLBACK_MARGIN = 0.15
NAME_RATIO_MIN = 0.67       # 名字 OCR 与卡名的相似度（3 字名允许错 1 字 ≈ 0.67）
NAME_RATIO_STRICT_MIN = 0.85  # 名字几乎确定（游戏右上角名字是权威标签）时，放宽 DINO 间隔要求
VOTE_CONFIRM = 2            # 双模态一致：连续 2 帧确认
VOTE_CONFIRM_DINO_ONLY = 3  # 仅 DINO 高分：连续 3 帧确认
BATTLE_MARK_TIMEOUT = 30    # 战斗开始后最多尝试确认的秒数
CACHE_TTL = 1800            # 识别结果缓存有效期（秒）
TICK_SECONDS = 0.25         # 轮询间隔默认值：越快越早发现选择界面/刷新（可在前端设置里改，运行时生效）
TICK_MIN = 0.2              # 允许的最小轮询间隔（再小会频繁截图/占用 GPU，性价比低）
TICK_MAX = 5.0              # 允许的最大轮询间隔
MIN_SCAN_INTERVAL = 4.0     # 两次自动识别的最小间隔，防单帧抖动导致同界面重复触发
CARD_TILE_SIZE = 32         # 头像中心区域归一化尺寸
CARD_TILE_BLUR = 3          # 高斯模糊半径：吃掉 ±2px 位移/压缩噪声
CARD_CHANGE_MIN = 0.08      # 换卡差异（HSV 与 RGB 差异取大者）：同卡地板 0.04、亮度±5% 0.04，
                            # 实测换卡最低 0.147（毛毛→石肤蜥这类同亮度换色 0.185）
CARD_STABLE_MAX = 0.05      # 相邻帧差小于该值视为翻牌动画结束、画面稳定
CARD_CONFIRM_FRAMES = 2     # 刷新后的卡需连续稳定帧数（0.25s 默认轮询下≈0.5s）
PANEL_DARK_MIN = 0.40       # 单个卡面板暗像素占比阈值：三卡实测最低 0.506，NPC/走路/战斗<0.35
SELECT_ABSENT_FRAMES = 3    # 三卡面板连续消失帧数（0.25s 默认轮询下≈0.75s）才视为离开选择界面
SKILL_BTN_MIN = 0.20        # 技能选择弹窗底部「选择」按钮亮黄占比：技能弹窗 0.43，精灵三卡/走路=0

SCANNER_WINDOW_TITLE = '精灵识别跟随'


def _crop_rel(img: Image.Image, rel):
    """按比例裁 PIL 图。"""
    w, h = img.size
    return img.crop((int(rel[0] * w), int(rel[1] * h), int(rel[2] * w), int(rel[3] * h)))


def _green_fraction(arr: np.ndarray) -> float:
    """血条区域亮绿色像素占比（HSV）。"""
    import cv2
    hsv = cv2.cvtColor(arr, cv2.COLOR_RGB2HSV)
    mask = cv2.inRange(hsv, (40, 110, 120), (95, 255, 255))
    return float(mask.mean() / 255.0)


def _count_star_circles(arr: np.ndarray) -> int:
    """Boss 同伴槽位行的灰色圆圈数量（HoughCircles）。"""
    import cv2
    gray = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)
    gray = cv2.medianBlur(gray, 3)
    h, w = gray.shape
    r = max(8, int(round(w * 0.011)))
    circles = cv2.HoughCircles(
        gray, cv2.HOUGH_GRADIENT, dp=1, minDist=int(r * 1.6),
        param1=80, param2=18,
        minRadius=max(6, int(r * 0.7)), maxRadius=int(r * 1.35),
    )
    if circles is None:
        return 0
    return len(circles[0])


class AutoWatchManager:
    """自动模式后台监控（单线程，start/stop 幂等）。"""

    def __init__(self, window_manager):
        self._wm = window_manager
        self._thread = None
        self._stop_event = threading.Event()
        self._running = False
        self._lock = threading.Lock()

        # 子功能开关
        self.auto_scan = True
        self.auto_mark = True
        # 轮询间隔（可在前端设置里改，运行时生效），默认 0.25 秒
        self.tick_seconds = float(TICK_SECONDS)

        # 最近一次识别缓存（识别按钮，无论手动/热键/自动，都会经 remember_cards 写入）
        self._cache = []  # [{slot, filename, base_name, feat, stage_num, trial_key, ts}]
        self._cache_lock = threading.Lock()

        # 上次自动识别时间（最小间隔节流）
        self._last_scan_ts = 0.0
        # 选择界面逐卡头像：上一帧 / 已识别基线 / 连续稳定确认计数
        self._tiles_prev = [None, None, None]
        self._tiles_base = [None, None, None]
        self._tile_confirm = [0, 0, 0]
        self._select_absent = 0
        # 三卡面板出现后“首次进入自动识别”是否已触发（三张卡可能错帧陆续稳定，
        # 不能要求同一 tick 建完基线，否则会漏掉首扫）
        self._initial_scan_done = False
        # 战斗标记状态
        self._battle_ticks = 0
        self._battle_start_ts = 0.0
        self._vote_slot = None
        self._vote_count = 0
        self._battle_marked = False
        self._was_battle = False
        self._last_marked = None
        self._phase = 'idle'
        self._message = ''
        self._candidate = None

    # ---------------- 生命周期 ----------------

    def start(self, auto_scan: bool = True, auto_mark: bool = True, tick_seconds=None):
        with self._lock:
            self.auto_scan = bool(auto_scan)
            self.auto_mark = bool(auto_mark)
            self._set_tick_seconds(tick_seconds)
            self._reset_cycle()
            if self._thread is not None and self._thread.is_alive():
                self._running = True
                return
            self._stop_event.clear()
            self._running = True
            self._thread = threading.Thread(
                target=self._run, name="auto-watch", daemon=True
            )
            self._thread.start()
            logger.info(
                "自动模式已启动（auto_scan=%s, auto_mark=%s, 间隔=%.2fs）",
                auto_scan, auto_mark, self.tick_seconds,
            )

    def stop(self):
        self._running = False
        self._stop_event.set()
        logger.info("自动模式已停止")

    def update_options(self, auto_scan=None, auto_mark=None, tick_seconds=None):
        if auto_scan is not None:
            self.auto_scan = bool(auto_scan)
        if auto_mark is not None:
            self.auto_mark = bool(auto_mark)
        self._set_tick_seconds(tick_seconds)
        logger.info(
            "自动模式选项更新：auto_scan=%s, auto_mark=%s, 间隔=%.2fs",
            self.auto_scan, self.auto_mark, self.tick_seconds,
        )

    def _set_tick_seconds(self, tick_seconds):
        if tick_seconds is None:
            return
        try:
            v = float(tick_seconds)
            if TICK_MIN <= v <= TICK_MAX:
                self.tick_seconds = v
            else:
                logger.warning("扫描间隔 %s 超出 [%s, %s]，忽略", v, TICK_MIN, TICK_MAX)
        except (TypeError, ValueError):
            logger.warning("扫描间隔参数非法，忽略：%r", tick_seconds)

    def is_running(self) -> bool:
        return self._running

    def _reset_tiles(self):
        """离开选择界面或刚触发识别后，重置逐卡基线。"""
        self._tiles_prev = [None, None, None]
        self._tiles_base = [None, None, None]
        self._tile_confirm = [0, 0, 0]
        self._initial_scan_done = False

    def _freeze_tiles(self, tiles):
        """把触发识别时的卡冻结为基线：识别期间玩家再刷新，识别结束后可被补检。"""
        self._tiles_base = [self._copy_tile(t) for t in tiles]
        self._tiles_prev = [self._copy_tile(t) for t in tiles]
        self._tile_confirm = [0, 0, 0]

    @staticmethod
    def _copy_tile(tile):
        """tile = (rgb(N,3), hsv(N,3))，深拷贝。"""
        return tile[0].copy(), tile[1].copy()

    def _reset_cycle(self):
        """一次战斗周期结束后的状态重置。"""
        self._reset_tiles()
        self._select_absent = 0
        self._battle_ticks = 0
        self._vote_slot = None
        self._vote_count = 0
        self._battle_marked = False
        self._candidate = None

    # ---------------- 识别缓存（由 bridge.capture_and_recognize 调用） ----------------

    def remember_cards(self, results, feature_by_slot, stage_num, trial_key):
        """识别完成后缓存 3 个槽位的文件名与 DINO 特征，供战斗头像比对。"""
        if not results:
            return
        cards = []
        now = time.time()
        for i, r in enumerate(results[:3]):
            filename = (r or {}).get('filename') or 'unknown'
            base = filename[:-4] if filename.lower().endswith('.png') else filename
            base = base.split('_')[0]
            cards.append({
                'slot': i,
                'filename': filename,
                'base_name': base,
                'feat': feature_by_slot.get(i) if feature_by_slot else None,
                'stage_num': stage_num,
                'trial_key': trial_key,
                'ts': now,
            })
        with self._cache_lock:
            self._cache = cards
        if self._running:
            self._push_status(
                'select',
                f"已识别 {len(cards)} 张卡，等待进入战斗",
            )

    # ---------------- 主循环 ----------------

    def _run(self):
        import cv2  # noqa: F401（确保进程里有 opencv，失败直接在日志里可见）
        while not self._stop_event.is_set():
            t0 = time.time()
            try:
                self._tick()
            except Exception as e:
                logger.warning(f"自动模式本轮监控异常: {e}", exc_info=True)
            dt = time.time() - t0
            sleep_s = max(0.0, self.tick_seconds - dt)
            self._stop_event.wait(sleep_s)
        self._running = False

    def _scanner_visible(self) -> bool:
        try:
            wins = gw.getWindowsWithTitle(SCANNER_WINDOW_TITLE)
            if not wins:
                return False
            import ctypes
            return bool(ctypes.windll.user32.IsWindowVisible(int(wins[0]._hWnd)))
        except Exception:
            return False

    def _grab_game_frame(self):
        """抓游戏窗口全帧（强制 hwnd/PrintWindow，避免被置顶跟随窗挡住）；返回 (PIL, 窗口)。"""
        wins = gw.getWindowsWithTitle(config.GAME_WINDOW_TITLE)
        if not wins:
            return None, None, 'no_window'
        win = wins[0]
        if win.isMinimized:
            return None, win, 'minimized'
        bbox = (win.left, win.top, win.right, win.bottom)
        try:
            img = capture_by_hwnd(int(win._hWnd))
            if img is None:
                img = capture_by_grab(bbox)
        except Exception as e:
            logger.debug(f"自动模式截图异常: {e}")
            img = None
            try:
                img = capture_by_grab(bbox)
            except Exception:
                img = None
        if img is None:
            return None, win, 'capture_failed'
        return img.convert('RGB'), win, None

    def _tick(self):
        # 跟随窗被隐藏时不抓帧（但线程保持存活，重新显示即恢复）
        if not self._scanner_visible():
            return

        img, _win, err = self._grab_game_frame()
        if img is not None:
            arr = np.asarray(img, dtype=np.uint8)
            hp = np.asarray(_crop_rel(img, HP_BAR), dtype=np.uint8)
            green = _green_fraction(hp)
        else:
            arr = None
            green = 0.0

        if err == 'no_window':
            self._on_battle_end()
            self._push_status('no_window', '未找到游戏窗口，等待中…')
            return
        if err == 'minimized':
            self._push_status('minimized', '游戏窗口已最小化，暂停监控')
            return
        if err == 'capture_failed' or img is None:
            self._push_status('no_window', '截图失败，等待下一帧…')
            return

        if green >= GREEN_MIN:
            # ---------- 战斗 ----------
            if not self._was_battle:
                self._battle_ticks = 0
                self._battle_start_ts = time.time()
                self._was_battle = True
            self._handle_battle(img, arr)
        else:
            # ---------- 非战斗：走路 / 选择界面 ----------
            self._on_battle_end()
            self._handle_non_battle(img)

    def _on_battle_end(self):
        """绿条消失（战斗结束）时复位战斗标记状态，并重新武装选择界面检测。"""
        if self._was_battle:
            self._was_battle = False
            self._reset_cycle()

    @staticmethod
    def _panel_dark(img: Image.Image):
        """三个卡信息面板的暗像素占比（灰度<80），用于判别三卡选择界面。"""
        fracs = []
        for rel in CARD_PANELS:
            gray = np.asarray(_crop_rel(img, rel).convert('L'), dtype=np.float32)
            fracs.append(float((gray < 80).mean()))
        return fracs

    @staticmethod
    def _skill_confirm_btn(img: Image.Image) -> float:
        """底部中央黄色「选择」按钮的亮黄像素占比：用于把技能选择弹窗（三技能卡）
        和三卡精灵选择界面区分开。"""
        import cv2
        c = np.asarray(_crop_rel(img, SKILL_BTN).convert('RGB'), dtype=np.uint8)
        hsv = cv2.cvtColor(c, cv2.COLOR_RGB2HSV)
        mask = cv2.inRange(hsv, (15, 120, 150), (35, 255, 255))
        return float(mask.mean() / 255.0)

    @staticmethod
    def _card_tiles(img: Image.Image):
        """选择界面 3 张卡头像中心区域分别提特征（高斯模糊 + 32x32 归一化），
        每个 tile 返回 (rgb, hsv) 两组特征：RGB 抓形状纹理、HSV 抓换色
        （例如黄的毛毛→绿的石肤蜥，灰度亮度几乎相同，灰度差分会漏检）。"""
        tiles = []
        for rel in CARD_PORTRAITS:
            tile = _crop_rel(img, rel).filter(ImageFilter.GaussianBlur(CARD_TILE_BLUR))
            tile = tile.resize((CARD_TILE_SIZE, CARD_TILE_SIZE), Image.LANCZOS)
            rgb = np.asarray(tile.convert('RGB'), dtype=np.float32).reshape(-1, 3) / 255.0
            hsv = np.asarray(tile.convert('HSV'), dtype=np.float32).reshape(-1, 3) / 255.0
            tiles.append((rgb, hsv))
        return tiles

    @staticmethod
    def _tile_diff(a, b) -> float:
        """两个 tile 的差异：HSV 加权差（H 取环形差）与 RGB 平均绝对差取大者。"""
        ra, ha = a
        rb, hb = b
        dh = np.abs(ha[:, 0] - hb[:, 0])
        dh = np.minimum(dh, 1.0 - dh)
        d_hsv = float(
            (dh * 0.7 + np.abs(ha[:, 1] - hb[:, 1]) * 0.2 + np.abs(ha[:, 2] - hb[:, 2]) * 0.1).mean()
        )
        d_rgb = float(np.abs(ra - rb).mean())
        return max(d_hsv, d_rgb)

    def _handle_non_battle(self, img: Image.Image):
        if not self.auto_scan:
            # 自动识别关闭：不做选择界面跟踪
            self._reset_tiles()
            self._select_absent = 0
            self._push_status('idle', '等待选择界面出现…')
            return

        dark = self._panel_dark(img)
        if all(d >= PANEL_DARK_MIN for d in dark):
            # 技能选择弹窗（叠势/吹火/回旋踢这种三技能卡）也有三块黑面板，会误过暗像素门；
            # 它底部中央有大黄色「选择」按钮，精灵三卡选择界面没有——据此排除，不识别
            if self._skill_confirm_btn(img) >= SKILL_BTN_MIN:
                self._reset_tiles()
                self._select_absent = 0
                self._push_status('idle', '技能选择界面，跳过识别')
                return
            # ---------- 三卡选择界面 ----------
            self._select_absent = 0
            tiles = self._card_tiles(img)
            cooldown_ok = (time.time() - self._last_scan_ts) >= MIN_SCAN_INTERVAL

            # 逐卡维护基线，并判断哪张卡被刷新（连续稳定确认）
            reroll_slot = None
            for i in range(3):
                cur = tiles[i]
                base = self._tiles_base[i]
                prev = self._tiles_prev[i]
                if base is None:
                    # 只在稳定帧建立基线（首帧 prev 为 None，仅记录不建基线），
                    # 避免把进选择界面时的滑入/翻牌动画定格成基线
                    if prev is not None and self._tile_diff(cur, prev) < CARD_STABLE_MAX:
                        self._tiles_base[i] = cur
                    self._tiles_prev[i] = cur
                    continue
                d_base = self._tile_diff(cur, base)
                d_prev = self._tile_diff(cur, prev) if prev is not None else 0.0
                changed = d_base > CARD_CHANGE_MIN
                stable = d_prev < CARD_STABLE_MAX
                if changed and stable:
                    self._tile_confirm[i] += 1
                elif not changed:
                    # 未变化的稳定帧吸收待机漂移
                    self._tile_confirm[i] = 0
                    if stable:
                        self._tiles_base[i] = cur
                else:
                    self._tile_confirm[i] = 0
                if self._tile_confirm[i] >= CARD_CONFIRM_FRAMES and reroll_slot is None:
                    reroll_slot = i
                self._tiles_prev[i] = cur

            # 三张卡可能错帧陆续滑入稳定，基线不要求同一 tick 建完，只要三卡都建稳即可
            all_based = all(b is not None for b in self._tiles_base)
            # 首次进入：三卡基线都建稳后触发首扫；即便冷却未到也每轮重试，避免漏掉
            if not self._initial_scan_done and all_based:
                if cooldown_ok:
                    self._fire_select_scan(False, tiles)
                else:
                    self._push_status('select', '选择界面（冷却中，即将自动识别…）')
            elif reroll_slot is not None and cooldown_ok:
                self._fire_select_scan(True, tiles)
            elif not all_based:
                self._push_status('select', '选择界面（卡片动画中…）')
            else:
                self._push_status('select', '选择界面（等待进入战斗/刷新）')
            return
        # ---------- 非三卡界面（走路 / NPC 单卡挑战 / 室内） ----------
        # 单帧漏判不立即重置（面板暗度受翻牌动画影响），连续多帧消失才算离开
        self._select_absent += 1
        if self._select_absent >= SELECT_ABSENT_FRAMES:
            self._reset_tiles()
            npc_like = dark[1] >= PANEL_DARK_MIN and (
                dark[0] < PANEL_DARK_MIN or dark[2] < PANEL_DARK_MIN
            )
            if npc_like:
                self._push_status('idle', 'NPC 单卡挑战，跳过识别')
            else:
                self._push_status('idle', '等待选择界面出现…')
        else:
            self._push_status('select', '选择界面（等待进入战斗/刷新）')

    def _fire_select_scan(self, is_reroll: bool, tiles) -> bool:
        """在选择界面触发一次识别（首次进入或检测到玩家刷新卡片）。
        仅当前端真正开始识别才冻结基线：识别期间玩家若又刷了卡，
        识别结束后当前帧与冻结基线不同，会被补检再触发一次。"""
        ok = self._trigger_scan()
        if ok:
            self._freeze_tiles(tiles)
            self._initial_scan_done = True
        self._push_status(
            'select',
            ('检测到刷新，自动重新识别中…' if is_reroll else '已到选择界面，自动识别中…')
            if ok else '等待当前识别结束后自动重试…',
        )
        return ok

    def _handle_battle(self, img: Image.Image, arr: np.ndarray):
        self._battle_ticks += 1

        # 门 2：Boss 同伴槽位圆圈
        star = np.asarray(_crop_rel(img, STAR_ROW), dtype=np.uint8)
        circles = _count_star_circles(star)
        if circles >= BOSS_CIRCLES_MIN:
            self._vote_slot = None
            self._vote_count = 0
            self._push_status('boss', 'Boss 战（同伴槽位），不记录')
            return

        if not self.auto_mark:
            self._push_status('battle', '战斗中（自动点亮已关闭）')
            return
        if self._battle_marked:
            name = self._last_marked[0] if self._last_marked else ''
            self._push_status('marked', f'已自动点亮：{name}')
            return
        if time.time() - self._battle_start_ts > BATTLE_MARK_TIMEOUT:
            self._battle_marked = True  # 不再重试，等战斗结束
            self._push_status('battle', '战斗中（未能确认敌方精灵）')
            return

        with self._cache_lock:
            cards = list(self._cache)
        cards = [c for c in cards if c.get('feat') is not None and c.get('base_name') != 'unknown']
        if not cards:
            self._push_status('battle', '战斗中（缺少本次识别结果，请先点一次识别）')
            return
        if time.time() - min(c['ts'] for c in cards) > CACHE_TTL:
            self._push_status('battle', '战斗中（识别结果已过期，跳过自动点亮）')
            return

        slot, info = self._match_enemy(img, cards)
        self._candidate = info
        if slot is None:
            # 模态不一致或不达标：清空连续确认，绝不点亮
            self._vote_slot = None
            self._vote_count = 0
            # 每 10 个 tick 打一次失败诊断（0.25s 默认轮询下≈2.5s），便于定位是 OCR 还是 DINO 拖后腿
            if self._battle_ticks % 10 == 1:
                scores = info.get('dino_sims') or []
                score_str = ', '.join(
                    f"{c['base_name']}={scores[i]:.2f}" if i < len(scores) else c['base_name']
                    for i, c in enumerate(cards)
                )
                logger.info(
                    "战斗比对未确认（%ss）：OCR=%r 名字相似度=%s；DINO[%s] margin=%.2f",
                    int(time.time() - self._battle_start_ts),
                    info.get('name_text', ''),
                    [f"{x:.2f}" for x in (info.get('name_ratios') or [])],
                    score_str, float(info.get('dino_margin', 0) or 0),
                )
            self._push_status('battle', '战斗中：正在比对敌方头像…', candidate=info)
            return

        if self._vote_slot == slot:
            self._vote_count += 1
        else:
            self._vote_slot = slot
            self._vote_count = 1

        need = VOTE_CONFIRM_DINO_ONLY if info.get('mode') == 'dino_only' else VOTE_CONFIRM
        self._push_status(
            'battle',
            f"战斗中：候选 {info.get('name', '')}（{info.get('dino_score', 0) * 100:.0f}%  {self._vote_count}/{need}）",
            candidate=info,
        )
        if self._vote_count >= need:
            self._fire_mark(cards[slot], info)

    def _match_enemy(self, img: Image.Image, cards):
        """门 3：头像 DINO + 名字 OCR 融合。返回 (slot, info)；无法确认时 slot=None。"""
        from core.services.recognizers import models
        recognizer = models.get_icon_recognizer()
        if recognizer is None:
            return None, {}

        avatar = _crop_rel(img, AVATAR)
        name_crop = _crop_rel(img, NAME_LINE)
        name_crop = name_crop.resize((name_crop.width * 2, name_crop.height * 2), Image.LANCZOS)

        # DINO 与 OCR 共用同一把推理锁；识别流程正在跑时跳过本轮
        if not watch_infer_lock.acquire(blocking=False):
            return None, {}
        try:
            feats = recognizer.get_feature_batch([avatar])
            af = feats[0]
            dino = [float((af * c['feat']).sum()) for c in cards]

            from core.vision.ocr import ocr
            name_text = ocr().recognize_crop_only(name_crop)
        finally:
            watch_infer_lock.release()

        name_ratios = [SequenceMatcher(None, name_text, c['base_name']).ratio() for c in cards]
        di = int(np.argmax(dino))
        ni = int(np.argmax(name_ratios))
        order = sorted(range(len(dino)), key=lambda i: dino[i], reverse=True)
        top, second = order[0], order[1] if len(order) > 1 else order[0]
        margin = dino[top] - dino[second]

        info = {
            'name': cards[di]['base_name'],
            'dino_score': dino[di],
            'dino_margin': margin,
            'name_text': name_text,
            'name_ratio': name_ratios[ni],
            'dino_sims': dino,
            'name_ratios': name_ratios,
        }

        # 双模态一致（头像最高分与名字 OCR 都指向同一只卡）。分两档：
        # 1) strict：名字 OCR 几乎确定（>=0.85）。战斗界面右上角的名字是游戏给出的权威
        #    标签，此时即便头像 DINO 与外形相似的其它精灵（如蒲公英 vs 菇菇丁/格兰种子都是
        #    白绒绿植物，margin 仅 0.05）间隔很小，也以名字为准，DINO 只做“确实是这只卡”
        #    的兜底（>=0.60）。
        if di == ni and name_ratios[ni] >= NAME_RATIO_STRICT_MIN and dino[di] >= DINO_MIN_STRICT:
            info['mode'] = 'dual'
            return di, info
        # 2) normal：名字一般确定（>=0.67），再要求头像 DINO 是明确最高（margin>=0.10）。
        if (dino[di] >= DINO_MIN and margin >= DINO_MARGIN and di == ni
                and name_ratios[ni] >= NAME_RATIO_MIN):
            info['mode'] = 'dual'
            return di, info
        # OCR 读不出，但 DINO 特别强：谨慎单模态
        if dino[di] >= DINO_FALLBACK_MIN and margin >= DINO_FALLBACK_MARGIN:
            info['mode'] = 'dino_only'
            return di, info
        # 模态冲突 / 不达标：不点亮
        return None, info

    def _fire_mark(self, card, info):
        """双模态连续确认后，推事件给前端点亮（前端再做去重、特效、撤销 toast）。"""
        self._battle_marked = True
        self._last_marked = (card['base_name'], time.strftime('%H:%M:%S'))
        payload = {
            'stage_num': card['stage_num'],
            'filename': card['filename'],
            'trial_key': card['trial_key'],
            'dino_score': round(float(info.get('dino_score', 0)), 4),
            'name_text': info.get('name_text', ''),
        }
        self._eval_js(
            f"window.__rocoAutoEncounter && window.__rocoAutoEncounter({self._js_obj(payload)})"
        )
        self._push_status('marked', f"已自动点亮：{card['base_name']}")
        logger.info(
            "自动点亮：%s（map=%s, trial=%s, mode=%s, dino=%.3f, ocr=%s）",
            card['filename'], card['stage_num'], card['trial_key'],
            info.get('mode', ''), float(info.get('dino_score', 0)), info.get('name_text', ''),
        )

    # ---------------- 前端通道 ----------------

    def _trigger_scan(self) -> bool:
        """等价于自动点一次「立即识别」（前端内部有 isRecognizingNow 并发保护）。
        成功触发（前端返回 true）才记节流时间戳；前端正忙则返回 False 供下轮重试。"""
        try:
            ok = self._eval_js(
                "(window.__rocoTriggerSingleScan && window.__rocoTriggerSingleScan()) || false"
            )
            if ok is True or str(ok).strip().lower() == 'true':
                self._last_scan_ts = time.time()
                logger.info('自动模式：已触发一次识别')
                return True
            logger.debug('自动模式：前端未就绪/识别中，本轮跳过')
        except Exception as e:
            logger.warning(f'自动模式触发识别失败: {e}')
        return False

    def _eval_js(self, script):
        win = self._wm.scanner_window
        if win is None:
            return None
        return win.evaluate_js(script)

    @staticmethod
    def _js_obj(obj: dict) -> str:
        import json
        return json.dumps(obj, ensure_ascii=False)

    def _push_status(self, phase, message, candidate=None):
        self._phase = phase
        self._message = message
        if candidate is not None:
            self._candidate = candidate
        status = {
            'phase': phase,
            'message': message,
            'autoScan': self.auto_scan,
            'autoMark': self.auto_mark,
            'candidate': {
                'name': self._candidate.get('name'),
                'dinoScore': self._candidate.get('dino_score'),
                'nameText': self._candidate.get('name_text'),
                'nameRatio': self._candidate.get('name_ratio'),
            } if isinstance(self._candidate, dict) and self._candidate.get('name') else None,
            'lastMarked': (
                {'name': self._last_marked[0], 'time': self._last_marked[1]}
                if self._last_marked else None
            ),
            'ts': int(time.time()),
        }
        script = (
            "window.__rocoAutoStatus && "
            f"window.__rocoAutoStatus({self._js_obj(status)})"
        )
        try:
            self._eval_js(script)
        except Exception:
            # 前端尚未注册回调 / 窗口重建中，本轮状态丢弃无妨
            pass
