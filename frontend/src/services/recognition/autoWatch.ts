/**
 * 纯前端版「自动模式」监控 —— 1:1 移植 desktop/auto_watch.py 的状态机。
 *
 * 浏览器没有窗口句柄/PrintWindow，帧统一来自 screenCapture.grab()（getDisplayMedia）；
 * 状态判定全部走固定 ROI 像素门（webGates.ts，不跑 YOLO）；只有进入战斗后的「敌方头像
 * 比对」才复用跟随识别的 DINO + OCR（worker battle-probe），且和识别共用同一把 worker，
 * 所以本控制器串行化：识别/探测任一在飞，本轮直接跳过。
 *
 * 两个子功能（与桌面一致）：
 *  1) 自动识别：三卡选择界面出现 / 玩家花叶子刷新时，等价自动点一次「立即识别」；
 *  2) 自动点亮：进入战斗后用绿血条 / Boss 白盘 / 头像 DINO+名字 OCR 三档融合，
 *     把对战精灵自动置为遇见（Boss 战不记录）。
 */
import { screenCapture } from './capture';
import {
  FrameProbe,
  CardTile,
  tileDiff,
  GREEN_MIN,
  BOSS_CIRCLES_MIN,
  PANEL_DARK_MIN,
  SKILL_BTN_MIN,
  CARD_CHANGE_MIN,
  CARD_STABLE_MAX,
} from './webGates';
import { localRecognizer } from './localRecognizer';
import { sequenceRatio } from './textSim';
import type { FollowRecognizeResult } from './followRecognizer';

// 敌方圆形头像 / 名字行（相对全帧比例，与桌面端一致）
const AVATAR_BOX: [number, number, number, number] = [0.93, 0.07, 0.975, 0.14];
const NAME_BOX: [number, number, number, number] = [0.852, 0.1, 0.925, 0.13];

// DINO 头像 / OCR 名字融合阈值（与桌面一致）
const DINO_MIN = 0.65;
const DINO_MARGIN = 0.1;
const DINO_MIN_STRICT = 0.6;
const DINO_FALLBACK_MIN = 0.75;
const DINO_FALLBACK_MARGIN = 0.15;
const NAME_RATIO_MIN = 0.67;
const NAME_RATIO_STRICT_MIN = 0.85;
const VOTE_CONFIRM = 2;
const VOTE_CONFIRM_DINO_ONLY = 3;

const BATTLE_MARK_TIMEOUT = 30; // 战斗开始后最多尝试确认秒数
const BATTLE_PROBE_TICK = 0.18; // 战斗中为尽快确认，比对间隔上限（秒）；非战斗仍用用户设置的扫描间隔
const CACHE_TTL = 1800; // 识别缓存有效期
const TICK_DEFAULT = 0.25;
const TICK_MIN = 0.2;
const TICK_MAX = 5;
const MIN_SCAN_INTERVAL = 4; // 两次自动识别最小间隔
const CARD_CONFIRM_FRAMES = 2; // 刷新后连续稳定帧数
const SELECT_ABSENT_FRAMES = 3; // 面板连续消失多少帧算离开选择界面
const FEAT_DIM = 384;

export type AutoPhase =
  | 'idle'
  | 'select'
  | 'battle'
  | 'boss'
  | 'marked'
  | 'no_window'
  | 'minimized';

export interface AutoCandidate {
  name: string;
  dinoScore: number;
  nameText: string;
  nameRatio: number;
}

export interface AutoStatus {
  phase: AutoPhase;
  message: string;
  autoScan: boolean;
  autoMark: boolean;
  candidate?: AutoCandidate | null;
  lastMarked?: { name: string; time: string } | null;
  ts: number;
}

export interface AutoEncounterPayload {
  stage_num: number;
  filename: string;
  trial_key: string;
  dino_score: number;
  name_text: string;
}

export interface AutoWatchOptions {
  autoScan: boolean;
  autoMark: boolean;
  tickSeconds: number;
}

interface CacheCard {
  slot: number;
  filename: string;
  baseName: string;
  feat: Float32Array;
  stageNum: number;
  trialKey: string;
  ts: number;
}

interface MatchInfo {
  name: string;
  dinoScore: number;
  dinoMargin: number;
  nameText: string;
  nameRatio: number;
  mode?: 'dual' | 'dino_only';
  // 名字 OCR 近乎确定 + 头像一致：单帧即可点亮，无需再等一帧投票
  fastConfirm?: boolean;
}

export interface AutoWatchConfig {
  /** 触发一次跟随识别（复用 UI 的同一条识别链路）；忙时返回 null。成功后 UI 自行 rememberCards。 */
  triggerScan: () => Promise<FollowRecognizeResult | null>;
  /** UI 是否正处在识别中（手动/自动），用于串行化，避免并发抓帧/推理。 */
  isRecognizing?: () => boolean;
  onStatus: (s: AutoStatus) => void;
  onEncounter: (p: AutoEncounterPayload) => void;
}

function nowSec(): number {
  return Date.now() / 1000;
}

function nowHMS(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function copyTile(t: CardTile | null): CardTile | null {
  if (!t) return null;
  return { rgb: t.rgb.slice(), hsv: t.hsv.slice() };
}

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

function featNorm(f: Float32Array): number {
  let s = 0;
  for (let i = 0; i < f.length; i++) s += f[i] * f[i];
  return Math.sqrt(s);
}

function safeClose(b: ImageBitmap | null): void {
  if (b) {
    try {
      b.close();
    } catch {
      /* 已被 transfer / 已关闭，无妨 */
    }
  }
}

/** 自动模式后台监控（setTimeout 自调度，start/stop 幂等）。 */
export class AutoWatchManager {
  private readonly cfg: AutoWatchConfig;

  private running = false;
  private timer: number | null = null;
  private generation = 0;

  autoScan = true;
  autoMark = true;
  tickSeconds = TICK_DEFAULT;

  private cache: CacheCard[] = [];
  private lastScanTs = 0;

  private tilesPrev: Array<CardTile | null> = [null, null, null];
  private tilesBase: Array<CardTile | null> = [null, null, null];
  private tileConfirm = [0, 0, 0];
  private selectAbsent = 0;
  private initialScanDone = false;

  private battleTicks = 0;
  private battleStartTs = 0;
  private voteSlot: number | null = null;
  private voteCount = 0;
  private battleMarked = false;
  private wasBattle = false;
  private lastMarked: { name: string; time: string } | null = null;
  private phase: AutoPhase = 'idle';
  private message = '';
  private candidate: MatchInfo | null = null;

  // 串行锁
  private scanInFlight = false;
  private probeInFlight = false;

  constructor(cfg: AutoWatchConfig) {
    this.cfg = cfg;
  }

  // ---------------- 生命周期 ----------------

  isRunning(): boolean {
    return this.running;
  }

  start(opts: AutoWatchOptions): void {
    this.autoScan = opts.autoScan;
    this.autoMark = opts.autoMark;
    this.setTickSeconds(opts.tickSeconds);
    this.resetCycle();
    if (this.running) return;
    this.running = true;
    this.generation++;
    // 后台预热 DINO + OCR，避免第一次进入战斗才加载模型造成确认延迟
    try {
      void (localRecognizer as { warmup?: () => Promise<void> }).warmup?.();
    } catch {
      /* 预热失败不影响主流程 */
    }
    this.schedule(0, this.generation);
  }

  stop(): void {
    this.running = false;
    this.generation++;
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  updateOptions(opts: Partial<AutoWatchOptions>): void {
    if (opts.autoScan !== undefined) this.autoScan = opts.autoScan;
    if (opts.autoMark !== undefined) this.autoMark = opts.autoMark;
    if (opts.tickSeconds !== undefined) this.setTickSeconds(opts.tickSeconds);
  }

  private setTickSeconds(v: number | undefined): void {
    if (v === undefined || v === null || Number.isNaN(v)) return;
    if (v >= TICK_MIN && v <= TICK_MAX) this.tickSeconds = v;
  }

  // ---------------- 识别缓存（每次识别后由 UI 调用，手动/自动都走这里） ----------------

  rememberCards(result: FollowRecognizeResult | null, trialKey: string): void {
    if (!result || !result.results || result.results.length === 0) return;
    const now = nowSec();
    const feats = result.feats;
    const cards: CacheCard[] = [];
    const n = Math.min(3, result.results.length);
    for (let i = 0; i < n; i++) {
      const r = result.results[i];
      const filename = r?.filename || 'unknown';
      let base = filename.toLowerCase().endsWith('.png') ? filename.slice(0, -4) : filename;
      base = base.split('_')[0];
      let feat = new Float32Array(FEAT_DIM);
      if (feats && feats.length >= (i + 1) * FEAT_DIM) {
        feat = feats.slice(i * FEAT_DIM, (i + 1) * FEAT_DIM);
      }
      cards.push({
        slot: i,
        filename,
        baseName: base,
        feat,
        stageNum: result.stage_num,
        trialKey,
        ts: now,
      });
    }
    this.cache = cards;
    if (this.running) {
      this.pushStatus('select', `已识别 ${cards.length} 张卡，等待进入战斗`);
    }
  }

  // ---------------- 主循环 ----------------

  private schedule(delaySec: number, gen: number): void {
    if (!this.running) return;
    this.timer = window.setTimeout(() => {
      if (!this.running || gen !== this.generation) return;
      void this.loop(gen);
    }, Math.max(0, delaySec * 1000));
  }

  private async loop(gen: number): Promise<void> {
    const t0 = performance.now();
    const extBusy = this.cfg.isRecognizing ? this.cfg.isRecognizing() : false;
    if (!this.scanInFlight && !this.probeInFlight && !extBusy) {
      try {
        await this.runOnce();
      } catch (e) {
        // 单轮异常不影响后续轮询
        this.pushStatus('idle', `自动监控异常，等待下一帧…（${(e as Error)?.message || e}）`);
      }
    }
    const dt = (performance.now() - t0) / 1000;
    // 战斗中用更短的间隔尽快完成多帧投票；非战斗沿用用户设置的扫描间隔
    const baseTick = this.wasBattle ? Math.min(this.tickSeconds, BATTLE_PROBE_TICK) : this.tickSeconds;
    this.schedule(Math.max(0, baseTick - dt), gen);
  }

  private async runOnce(): Promise<void> {
    let frame;
    try {
      frame = await screenCapture.grab();
    } catch {
      this.onBattleEnd();
      this.pushStatus('no_window', '共享未开始或已结束，请重新选择游戏窗口');
      return;
    }
    const bitmap = frame.bitmap;
    let probe: FrameProbe;
    try {
      probe = new FrameProbe(bitmap);
    } catch {
      safeClose(bitmap);
      return;
    }

    const green = probe.greenFraction();
    if (green >= GREEN_MIN) {
      if (!this.wasBattle) {
        this.battleTicks = 0;
        this.battleStartTs = nowSec();
        this.wasBattle = true;
      }
      await this.handleBattle(probe, bitmap);
    } else {
      this.onBattleEnd();
      this.handleNonBattle(probe, bitmap);
      safeClose(bitmap);
    }
  }

  private onBattleEnd(): void {
    if (this.wasBattle) {
      this.wasBattle = false;
      this.resetCycle();
    }
  }

  private resetTiles(): void {
    this.tilesPrev = [null, null, null];
    this.tilesBase = [null, null, null];
    this.tileConfirm = [0, 0, 0];
    this.initialScanDone = false;
  }

  private freezeTiles(tiles: CardTile[]): void {
    this.tilesBase = tiles.map((t) => copyTile(t));
    this.tilesPrev = tiles.map((t) => copyTile(t));
    this.tileConfirm = [0, 0, 0];
  }

  private resetCycle(): void {
    this.resetTiles();
    this.selectAbsent = 0;
    this.battleTicks = 0;
    this.voteSlot = null;
    this.voteCount = 0;
    this.battleMarked = false;
    this.candidate = null;
  }

  // ---------------- 非战斗：选择界面 / 刷新检测 ----------------

  private handleNonBattle(probe: FrameProbe, bitmap: ImageBitmap): void {
    void bitmap;
    if (!this.autoScan) {
      this.resetTiles();
      this.selectAbsent = 0;
      this.pushStatus('idle', '等待选择界面出现…');
      return;
    }

    const dark = probe.panelDarkFractions();
    const allDark = dark.every((d) => d >= PANEL_DARK_MIN);
    if (allDark) {
      // 技能选择弹窗（三技能卡）也有三块黑面板，用底部亮黄「选择」按钮排除
      if (probe.skillButtonFraction() >= SKILL_BTN_MIN) {
        this.resetTiles();
        this.selectAbsent = 0;
        this.pushStatus('idle', '技能选择界面，跳过识别');
        return;
      }

      // ---------- 三卡选择界面 ----------
      this.selectAbsent = 0;
      const tiles = probe.cardTiles();
      const cooldownOk = nowSec() - this.lastScanTs >= MIN_SCAN_INTERVAL;

      let rerollSlot: number | null = null;
      for (let i = 0; i < 3; i++) {
        const cur = tiles[i];
        const base = this.tilesBase[i];
        const prev = this.tilesPrev[i];
        if (base === null) {
          // 首帧仅记录；稳定帧才建基线，避免把滑入/翻牌动画定格成基线
          if (prev !== null && tileDiff(cur, prev) < CARD_STABLE_MAX) {
            this.tilesBase[i] = copyTile(cur);
          }
          this.tilesPrev[i] = copyTile(cur);
          continue;
        }
        const dBase = tileDiff(cur, base);
        const dPrev = prev !== null ? tileDiff(cur, prev) : 0;
        const changed = dBase > CARD_CHANGE_MIN;
        const stable = dPrev < CARD_STABLE_MAX;
        if (changed && stable) {
          this.tileConfirm[i] += 1;
        } else if (!changed) {
          this.tileConfirm[i] = 0;
          if (stable) this.tilesBase[i] = copyTile(cur);
        } else {
          this.tileConfirm[i] = 0;
        }
        if (this.tileConfirm[i] >= CARD_CONFIRM_FRAMES && rerollSlot === null) {
          rerollSlot = i;
        }
        this.tilesPrev[i] = copyTile(cur);
      }

      const allBased = this.tilesBase.every((b) => b !== null);
      if (!this.initialScanDone && allBased) {
        if (cooldownOk) {
          void this.fireSelectScan(false, tiles);
        } else {
          this.pushStatus('select', '选择界面（冷却中，即将自动识别…）');
        }
      } else if (rerollSlot !== null && cooldownOk) {
        void this.fireSelectScan(true, tiles);
      } else if (!allBased) {
        this.pushStatus('select', '选择界面（卡片动画中…）');
      } else {
        this.pushStatus('select', '选择界面（等待进入战斗/刷新）');
      }
      return;
    }

    // 非三卡界面：连续多帧消失才判定离开（单帧漏判不重置）
    this.selectAbsent += 1;
    if (this.selectAbsent >= SELECT_ABSENT_FRAMES) {
      this.resetTiles();
      const npcLike = dark[1] >= PANEL_DARK_MIN && (dark[0] < PANEL_DARK_MIN || dark[2] < PANEL_DARK_MIN);
      this.pushStatus('idle', npcLike ? 'NPC 单卡挑战，跳过识别' : '等待选择界面出现…');
    } else {
      this.pushStatus('select', '选择界面（等待进入战斗/刷新）');
    }
  }

  private async fireSelectScan(isReroll: boolean, tiles: CardTile[]): Promise<void> {
    this.scanInFlight = true;
    let ok = false;
    try {
      const result = await this.cfg.triggerScan();
      ok = result !== null && result !== undefined;
    } catch {
      ok = false;
    } finally {
      this.scanInFlight = false;
    }
    if (ok) {
      // 成功触发才冻结基线：识别期间玩家若又刷了卡，识别结束后可被补检
      this.freezeTiles(tiles);
      this.initialScanDone = true;
      this.lastScanTs = nowSec();
    }
    this.pushStatus(
      'select',
      ok
        ? isReroll
          ? '检测到刷新，自动重新识别中…'
          : '已到选择界面，自动识别中…'
        : '等待当前识别结束后自动重试…'
    );
  }

  // ---------------- 战斗：Boss 门 + 头像 DINO / 名字 OCR ----------------

  private async handleBattle(probe: FrameProbe, bitmap: ImageBitmap): Promise<void> {
    this.battleTicks += 1;

    // 门 2：Boss 同伴槽位白盘
    const discs = probe.bossDiscCount();
    if (discs >= BOSS_CIRCLES_MIN) {
      this.voteSlot = null;
      this.voteCount = 0;
      this.pushStatus('boss', 'Boss 战（同伴槽位），不记录');
      safeClose(bitmap);
      return;
    }

    if (!this.autoMark) {
      this.pushStatus('battle', '战斗中（自动点亮已关闭）');
      safeClose(bitmap);
      return;
    }
    if (this.battleMarked) {
      this.pushStatus('marked', this.lastMarked ? `已自动点亮：${this.lastMarked.name}` : '已自动点亮');
      safeClose(bitmap);
      return;
    }
    if (nowSec() - this.battleStartTs > BATTLE_MARK_TIMEOUT) {
      this.battleMarked = true; // 超时不再重试，等战斗结束
      this.pushStatus('battle', '战斗中（未能确认敌方精灵）');
      safeClose(bitmap);
      return;
    }

    // 过滤特殊点位（无 DINO 特征）与未知槽位
    const cards = this.cache.filter(
      (c) => c.baseName !== 'unknown' && featNorm(c.feat) > 0.01
    );
    if (cards.length === 0) {
      this.pushStatus('battle', '战斗中（缺少本次识别结果，请先点一次识别）');
      safeClose(bitmap);
      return;
    }
    if (nowSec() - Math.min(...cards.map((c) => c.ts)) > CACHE_TTL) {
      this.pushStatus('battle', '战斗中（识别结果已过期，跳过自动点亮）');
      safeClose(bitmap);
      return;
    }

    // 门 3：头像 DINO + 名字 OCR（bitmap 转移给 worker，不能再 close）
    let match: { slot: number | null; info: MatchInfo };
    this.probeInFlight = true;
    try {
      match = await this.matchEnemy(bitmap, cards);
    } catch {
      // 探测失败（worker 忙 / 模型未就绪）：bitmap 可能尚未转移，安全收尾
      this.probeInFlight = false;
      safeClose(bitmap);
      return;
    }
    this.probeInFlight = false;
    const { slot, info } = match;
    this.candidate = info;

    if (slot === null) {
      this.voteSlot = null;
      this.voteCount = 0;
      this.pushStatus('battle', '战斗中：正在比对敌方头像…', info);
      return;
    }

    if (this.voteSlot === slot) {
      this.voteCount += 1;
    } else {
      this.voteSlot = slot;
      this.voteCount = 1;
    }
    const need = info.fastConfirm
      ? 1
      : info.mode === 'dino_only'
        ? VOTE_CONFIRM_DINO_ONLY
        : VOTE_CONFIRM;
    this.pushStatus(
      'battle',
      `战斗中：候选 ${info.name}（${Math.round(info.dinoScore * 100)}%  ${this.voteCount}/${need}）`,
      info
    );
    if (this.voteCount >= need) {
      this.fireMark(cards[slot], info);
    }
  }

  private async matchEnemy(
    bitmap: ImageBitmap,
    cards: CacheCard[]
  ): Promise<{ slot: number | null; info: MatchInfo }> {
    // 注意：recognizeBattleProbe 会把 bitmap transfer 给 worker
    const { avatarFeat, nameText } = await localRecognizer.recognizeBattleProbe(
      bitmap,
      AVATAR_BOX,
      NAME_BOX
    );

    const dino = cards.map((c) => dot(avatarFeat, c.feat));
    const nameRatios = cards.map((c) => sequenceRatio(nameText, c.baseName));
    let di = 0;
    for (let i = 1; i < dino.length; i++) if (dino[i] > dino[di]) di = i;
    let ni = 0;
    for (let i = 1; i < nameRatios.length; i++) if (nameRatios[i] > nameRatios[ni]) ni = i;
    const order = [...dino.keys()].sort((a, b) => dino[b] - dino[a]);
    const top = order[0];
    const second = order.length > 1 ? order[1] : order[0];
    const margin = dino[top] - dino[second];

    const info: MatchInfo = {
      name: cards[di].baseName,
      dinoScore: dino[di],
      dinoMargin: margin,
      nameText,
      nameRatio: nameRatios[ni],
    };

    // 档 1：名字 OCR 几乎确定（权威标签），DINO 仅作兜底 → 单帧即可确认
    if (di === ni && nameRatios[ni] >= NAME_RATIO_STRICT_MIN && dino[di] >= DINO_MIN_STRICT) {
      info.mode = 'dual';
      info.fastConfirm = true;
      return { slot: di, info };
    }
    // 档 2：双模态一致，且头像 DINO 明确最高
    if (dino[di] >= DINO_MIN && margin >= DINO_MARGIN && di === ni && nameRatios[ni] >= NAME_RATIO_MIN) {
      info.mode = 'dual';
      return { slot: di, info };
    }
    // 档 3：OCR 读不出但 DINO 特别强
    if (dino[di] >= DINO_FALLBACK_MIN && margin >= DINO_FALLBACK_MARGIN) {
      info.mode = 'dino_only';
      return { slot: di, info };
    }
    return { slot: null, info };
  }

  private fireMark(card: CacheCard, info: MatchInfo): void {
    this.battleMarked = true;
    this.lastMarked = { name: card.baseName, time: nowHMS() };
    this.cfg.onEncounter({
      stage_num: card.stageNum,
      filename: card.filename,
      trial_key: card.trialKey,
      dino_score: Math.round(info.dinoScore * 10000) / 10000,
      name_text: info.nameText,
    });
    this.pushStatus('marked', `已自动点亮：${card.baseName}`);
  }

  // ---------------- 状态回调 ----------------

  private pushStatus(phase: AutoPhase, message: string, candidate?: MatchInfo): void {
    this.phase = phase;
    this.message = message;
    if (candidate !== undefined) this.candidate = candidate;
    const status: AutoStatus = {
      phase,
      message,
      autoScan: this.autoScan,
      autoMark: this.autoMark,
      candidate:
        this.candidate && this.candidate.name
          ? {
              name: this.candidate.name,
              dinoScore: this.candidate.dinoScore,
              nameText: this.candidate.nameText,
              nameRatio: this.candidate.nameRatio,
            }
          : null,
      lastMarked: this.lastMarked,
      ts: Math.floor(nowSec()),
    };
    try {
      this.cfg.onStatus(status);
    } catch {
      /* UI 未就绪，丢弃本轮状态无妨 */
    }
  }
}
