/**
 * 纯前端版「跟随识别」界面（IS_STATIC 时挂在 ?view=scanner）。
 *
 * 视觉与交互刻意对齐桌面版 ScannerApp：同一套骨架（内容区 p-3 + 卡片堆叠 + 底部动作区 +
 * 底部状态栏）、同一套配色与圆角（#FDF9F3 / #7ABCF4 / roco-card / roco-btn-*）。
 * 差异只来自浏览器能力的边界：
 *   - 没有标题栏（窗口由浏览器管理），画面源改为底部一个独立按钮；
 *   - 连接状态放在底部状态栏（绿点 + LIVE）；
 *   - 悬浮窗按钮（Document PiP）也收进状态栏，不支持时自动隐藏。
 *
 * 桌面版继续走 ScannerApp.tsx，两边互不影响。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  BookOpen,
  Bot,
  Camera,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Crown,
  Download,
  History,
  Layers,
  Loader2,
  MapPin,
  Minus,
  MonitorPlay,
  Moon,
  Pin,
  PinOff,
  RefreshCw,
  Settings,
  Sparkle,
  Square,
  Sun,
  Unplug,
  X,
} from 'lucide-react';
import {
  screenCapture,
  isWebFollowSupported,
  type CaptureState,
} from '../services/recognition/capture';
import {
  webFollowRecognize,
  releaseFollowAssets,
  FollowCaptureError,
} from '../services/recognition/followRecognizer';
import { localRecognizer, CANCELED } from '../services/recognition/localRecognizer';
import type { FollowRecognizeResult } from '../services/recognition/followRecognizer';
import { AutoWatchManager, type AutoStatus } from '../services/recognition/autoWatch';
import { getTrialOrDanger } from '../services/recognition/trialConfig';
import { splitPetFilename } from '../services/recognition/petPath';
import { IS_STATIC } from '../services/staticMode';
import { runtimeGuard } from '../services/runtimeGuard';
import { storage } from '../services/storage';
import { api } from '../services/api';
import { sound } from '../services/sound';
import { formatPetName, isPetEncounteredInRecords } from '../utils/petHelper';
import { PetSprite } from './PetSprite';
import { ElementBadges } from './ElementBadges';
import { PetSpecialTag } from './PetSpecialTag';
import { ScannerMapGalleryModal } from './ScannerMapGalleryModal';
import { EncounterHistoryModal } from './EncounterHistoryModal';
import { ModelAssetsModal } from './ModelAssetsModal';
import { themeService } from '../services/theme';
import { MAP_CONFIGS } from '../data/mockPets';
import type { PetItem } from '../types';

interface SlotCandidate {
  filename: string;
  score: number;
  pet: PetItem | null;
}

interface SlotView {
  index: number;
  status: 'matched' | 'unmatched';
  reason?: string;
  cropUrl: string | null;
  candidates: SlotCandidate[];
  selected: number;
}

const TRIAL_KEY = 'grass';
const CANDIDATE_PAGE_SIZE = 3;
/**
 * 默认窗口宽度，同时也是面板的最小宽度。
 * 打开跟随识别时按这个宽度开窗（services/followScanner.ts 里同步），
 * 面板本身再兜一层 min-width —— 浏览器不允许网站限制窗口最小尺寸，
 * 用户把窗口拖窄时至少不会把布局压坏（出现横向滚动而不是挤成一团）。
 */
const SCANNER_WIDTH = 480;
/** 默认开窗高度（与 services/followScanner.ts 的开窗尺寸同步）。 */
const SCANNER_HEIGHT = 760;
/** 窗口高度的下限：内容再少也不低于这个值（对齐桌面版 ScannerApp 的 614）。 */
const SCANNER_MIN_HEIGHT = 620;

function nowTime(): string {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false });
}

function pctOf(score: number): string {
  return `${(score * 100).toFixed(1)}%`;
}

/** 候选翻页区：与桌面版 CandidateCarousel 同款（3 个一页 + 左右翻页）。 */
const CandidateGrid: React.FC<{
  candidates: SlotCandidate[];
  selected: number;
  isLit: (filename: string) => boolean;
  onSelect: (index: number) => void;
}> = ({ candidates, selected, isLit, onSelect }) => {
  const [page, setPage] = useState(() => Math.floor(selected / CANDIDATE_PAGE_SIZE));
  const totalPages = Math.ceil(candidates.length / CANDIDATE_PAGE_SIZE);

  useEffect(() => {
    const p = Math.floor(selected / CANDIDATE_PAGE_SIZE);
    if (p >= 0 && p < totalPages) setPage(p);
  }, [selected, totalPages]);

  const shown = candidates.slice(page * CANDIDATE_PAGE_SIZE, (page + 1) * CANDIDATE_PAGE_SIZE);

  return (
      <div className="pt-2 border-t-2 border-[#F1F5F9] dark:border-slate-800">
        <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400 mb-1.5 font-bold">
          <div className="flex items-center gap-1.5">
            <span>候选置信度排行:</span>
            {totalPages > 1 && (
                <span className="text-[9px] font-bold bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded-full border border-slate-200 dark:border-slate-700">
                  第 {page + 1}/{totalPages} 页 (共 {candidates.length} 项)
                </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[#1E5B99] dark:text-sky-300">选定: #{selected + 1}</span>
            {totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <button
                      type="button"
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      disabled={page === 0}
                      className="w-5 h-5 rounded-md bg-white dark:bg-slate-800 border border-[#BCD7F2] dark:border-slate-700 text-[#1E5B99] dark:text-sky-300 flex items-center justify-center hover:bg-[#EBF5FE] disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <button
                      type="button"
                      onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                      disabled={page >= totalPages - 1}
                      className="w-5 h-5 rounded-md bg-white dark:bg-slate-800 border border-[#BCD7F2] dark:border-slate-700 text-[#1E5B99] dark:text-sky-300 flex items-center justify-center hover:bg-[#EBF5FE] disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          {shown.map((cand, i) => {
            const idx = page * CANDIDATE_PAGE_SIZE + i;
            const isSelected = idx === selected;
            const name = formatPetName(cand.filename);
            const lit = isLit(cand.filename);
            return (
                <button
                    key={`${cand.filename}-${idx}`}
                    type="button"
                    onClick={() => {
                      sound.playClick();
                      onSelect(idx);
                    }}
                    className={`p-1.5 rounded-xl text-left transition-all cursor-pointer border-2 ${
                        isSelected
                            ? 'bg-[#EBF5FE] dark:bg-sky-950/70 border-[#7ABCF4] dark:border-sky-500 text-[#1E5B99] dark:text-sky-300 font-black'
                            : 'bg-[#F8FBFE] dark:bg-slate-800 border-[#E2E8F0] dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-[#BCD7F2] hover:bg-[#E9F2FA]'
                    }`}
                >
                  <div className="flex items-center gap-1.5">
                    <div className="relative w-9 h-9 shrink-0 rounded-lg bg-white dark:bg-slate-900 border border-[#E2E8F0] dark:border-slate-700 p-0.5 flex items-center justify-center overflow-hidden">
                      {cand.pet
                          ? <PetSprite pet={cand.pet} className="w-full h-full" alt={name} />
                          : <span className="w-full h-full bg-slate-100 dark:bg-slate-700 rounded" />}
                      <ElementBadges elements={cand.pet?.elements} className="absolute top-0 left-0 z-10" size="xs" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1 text-[9px] font-mono">
                        {lit ? (
                            <span className="inline-flex items-center gap-0.5 text-[#2D6613] dark:text-emerald-300 bg-[#E1F7DB] dark:bg-emerald-950/60 px-1 rounded-full border border-[#95D151]/40">
                              <Check className="w-2 h-2 text-emerald-600 stroke-[3]" />#{idx + 1}
                            </span>
                        ) : (
                            <span className="inline-flex items-center gap-0.5 text-amber-800 dark:text-amber-300 bg-[#FEF9E6] dark:bg-amber-950/60 px-1 rounded-full border border-[#E5C43B]/60">
                              <Sparkle className="w-2 h-2 text-amber-600" />#{idx + 1}
                            </span>
                        )}
                        <span className={isSelected ? 'text-[#1E5B99] dark:text-sky-300 font-black' : 'text-slate-500'}>
                          {pctOf(cand.score)}
                        </span>
                      </div>
                      <div className="text-[10px] font-bold text-slate-800 dark:text-slate-100 truncate" title={name}>
                        {name}
                      </div>
                    </div>
                  </div>
                </button>
            );
          })}
        </div>
      </div>
  );
};
interface WebFollowScannerProps {
  /**
   * 由首页直接开的 Document PiP 小窗。
   * 传入表示「本面板当前就渲染在这个小窗里」——此时不再需要内置的置顶按钮，
   * 也不能再用 window.resizeTo（PiP 的尺寸由 requestWindow 决定）。
   */
  hostWindow?: Window | null;
}

export const WebFollowScanner: React.FC<WebFollowScannerProps> = ({ hostWindow = null }) => {
  const hostedInPip = !!hostWindow;
  /** 面板自身的 DOM 在哪个 document 里（托管到 PiP 时就不是当前 document 了）。 */
  const hostDoc = useCallback(
      () => (hostedInPip && hostWindow ? hostWindow.document : document),
      [hostedInPip, hostWindow],
  );
  const [capture, setCapture] = useState<CaptureState>(() => screenCapture.getState());
  const [slots, setSlots] = useState<SlotView[]>([]);
  const [busy, setBusy] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [errorText, setErrorText] = useState<string | null>(null);
  const [hintText, setHintText] = useState<string | null>(null);
  const [pinnedStage, setPinnedStage] = useState<number | null>(() => {
    try {
      const saved = storage.getSetting<number | null>('scannerPinnedStageNum', null);
      return typeof saved === 'number' ? saved : null;
    } catch {
      return null;
    }
  });
  /**
   * 三个「图」的概念与桌面版 ScannerApp 一致：
   *   detectedStage —— 上一次识别出的图（null = 还没识别过）
   *   selectedStage —— 用户在「切换地图」里手动选的图（null = 没手动选，跟随识别结果）
   *   pinnedStage   —— 用户钉住的图（持久化；非 null 时识别完视图不再跳回识别结果）
   */
  const [detectedStage, setDetectedStage] = useState<number | null>(null);
  const [selectedStage, setSelectedStage] = useState<number | null>(() => {
    try {
      const savedPin = storage.getSetting<number | null>('scannerPinnedStageNum', null);
      return typeof savedPin === 'number' ? savedPin : null;
    } catch {
      return null;
    }
  });
  const [stageFromTitle, setStageFromTitle] = useState(false);
  const [titleText, setTitleText] = useState('');
  const [lastMs, setLastMs] = useState<number | null>(null);
  const [lastMsDetail, setLastMsDetail] = useState('');
  const [lastCaptureAt, setLastCaptureAt] = useState('—');
  const [mapsPets, setMapsPets] = useState<Record<string, { count: number; items: PetItem[] }>>({});
  const [records, setRecords] = useState<ReturnType<typeof storage.getAll>>(() => storage.getAll());
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  // 纯前端版：模型列表（查看缓存状态 / 提前手动下载）
  const [isModelAssetsOpen, setIsModelAssetsOpen] = useState(false);
  const [isDarkTheme, setIsDarkTheme] = useState<boolean>(() => themeService.isDark());

  const mountedRef = useRef(true);
  /** 隐藏的 video 载体（浏览器对脱离文档的 video 会降频/暂停解码） */
  const videoHostRef = useRef<HTMLDivElement | null>(null);
  const trial = useMemo(() => getTrialOrDanger(TRIAL_KEY), []);

  // ---------------- 自动模式（自动识别 + 自动点亮） ----------------
  const [autoMode, setAutoMode] = useState(false);
  const [autoScanOn, setAutoScanOn] = useState(true);
  const [autoMarkOn, setAutoMarkOn] = useState(true);
  const [autoPanelOpen, setAutoPanelOpen] = useState(true);
  const [autoStatus, setAutoStatus] = useState<AutoStatus | null>(null);
  const [autoToasts, setAutoToasts] = useState<
    Array<{ key: string; mapKey: string; filename: string; displayName: string }>
  >([]);
  const [tickSeconds, setTickSeconds] = useState<number>(() => {
    try {
      const v = storage.getSetting<number>('autoWatchTickSeconds', 0.25);
      return typeof v === 'number' && v >= 0.2 && v <= 5 ? v : 0.25;
    } catch {
      return 0.25;
    }
  });
  const busyRef = useRef(false);
  const recognizeFnRef = useRef<(() => Promise<FollowRecognizeResult | null>) | null>(null);
  const autoManagerRef = useRef<AutoWatchManager | null>(null);
  if (!autoManagerRef.current) {
    autoManagerRef.current = new AutoWatchManager({
      // 自动识别与手动识别共用同一条链路（UI 会更新结果 + 缓存 3 卡特征）
      triggerScan: () => (recognizeFnRef.current ? recognizeFnRef.current() : Promise.resolve(null)),
      isRecognizing: () => busyRef.current,
      onStatus: (s) => {
        if (mountedRef.current) setAutoStatus(s);
      },
      onEncounter: (p) => {
        if (!mountedRef.current) return;
        const mapKey = `map${p.stage_num}`;
        if (storage.isEncountered(mapKey, p.filename)) return; // 已点亮，去重
        storage.toggleEncountered(mapKey, p.filename, '自动跟随识别点亮图鉴');
        setRecords(storage.getAll());
        try { sound.playEncounter(); } catch { /* ignore */ }
        const displayName = formatPetName(p.filename);
        const key = `${mapKey}:${p.filename}:${Date.now()}`;
        setAutoToasts((prev) => [...prev, { key, mapKey, filename: p.filename, displayName }]);
        window.setTimeout(() => {
          if (mountedRef.current) setAutoToasts((prev) => prev.filter((t) => t.key !== key));
        }, 6000);
      },
    });
  }


  /** 当前正在查看的图（null = 全图总览）——就是「切换地图」选中的那个 */
  const viewStage = selectedStage;
  /** 点亮图鉴时归到哪个图：正在看图就用看的图，看全图时归到识别出的图 */
  const lightStage = viewStage ?? detectedStage ?? 1;
  /** 用户手动切到了一个和上次识别结果不同的图 → 待重新识别 */
  const hasPendingMapChange = detectedStage !== null && selectedStage !== null && selectedStage !== detectedStage;
  /** 钉住 + 已指定图 = 按指定图识别（与桌面版 handleRecognize 的判断一致） */
  const isPinnedRecognition = pinnedStage !== null && selectedStage !== null;
  const isReRecognize = (hasPendingMapChange || isPinnedRecognition) && selectedStage !== null;
  /** 传给识别的目标图：null = 不指定，按标题自动判定 */
  const recognizeTarget = isReRecognize ? selectedStage : null;

  // ---------------- 基础订阅 ----------------

  useEffect(() => {
    mountedRef.current = true;
    const unsub = screenCapture.subscribe((s) => setCapture(s));
    const unsubStorage = storage.subscribe((next) => setRecords(next));
    const unsubTheme = themeService.subscribe((t) => setIsDarkTheme(t === 'dark'));
    return () => {
      mountedRef.current = false;
      autoManagerRef.current?.stop();
      unsub();
      unsubTheme();
      unsubStorage();
      releaseFollowAssets();
    };
  }, []);

  // 图鉴数据：既用于候选缩略图（雪碧图坐标），也用于关卡进度
  useEffect(() => {
    let alive = true;
    api.getIcons(TRIAL_KEY).then((res) => {
      if (!alive) return;
      const byMap: Record<string, { count: number; items: PetItem[] }> = {};
      Object.entries(res.data || {}).forEach(([mapId, group]) => {
        byMap[mapId] = { count: group?.count || 0, items: group?.items || [] };
      });
      setMapsPets(byMap);
    }).catch(() => {
      /* 图鉴拉取失败只影响缩略图与进度，不影响识别 */
    });
    return () => {
      alive = false;
    };
  }, []);

  const petIndex = useMemo(() => {
    const index = new Map<string, PetItem>();
    (Object.values(mapsPets) as { count: number; items: PetItem[] }[]).forEach((group) => {
      (group?.items || []).forEach((item) => {
        if (item.id != null) index.set(`${item.id}_${item.seq ?? 'x'}`, item);
        const byName = formatPetName(item.name).toLowerCase();
        if (byName && !index.has(`name:${byName}`)) index.set(`name:${byName}`, item);
      });
    });
    return index;
  }, [mapsPets]);

  const petOf = useCallback((filename: string): PetItem | null => {
    const info = splitPetFilename(filename);
    if (info?.id != null) {
      const hit = petIndex.get(`${info.id}_${info.seq ?? 'x'}`);
      if (hit) return hit;
    }
    return petIndex.get(`name:${formatPetName(filename).toLowerCase()}`) || null;
  }, [petIndex]);

  const isLit = useCallback(
      (filename: string) => isPetEncounteredInRecords(records, `map${lightStage}`, filename),
      [records, lightStage],
  );

  const mapStats = useMemo(() => {
    if (viewStage === null) {
      // 全图总览：三个图的并集统计
      let total = 0;
      let encountered = 0;
      trial.maps.forEach((m) => {
        const items = mapsPets[m.id]?.items || [];
        if (!items.length) return;
        total += items.length;
        encountered += storage.getMapStats(m.id, items.length, items).encounteredCount;
      });
      return {
        encountered,
        total,
        percent: total ? Math.round((encountered / total) * 100) : 0,
        remaining: total - encountered,
      };
    }
    const mapId = `map${viewStage}`;
    const items = mapsPets[mapId]?.items || [];
    if (!items.length) return { encountered: 0, total: 0, percent: 0, remaining: 0 };
    const { encounteredCount, percentage } = storage.getMapStats(mapId, items.length, items);
    return {
      encountered: encounteredCount,
      total: items.length,
      percent: percentage,
      remaining: items.length - encounteredCount,
    };
  }, [mapsPets, viewStage, records, trial.maps]);

  const currentMapDef = viewStage === null ? null : trial.maps.find((m) => m.num === viewStage);

  // ---------------- 操作 ----------------

  const handleStartCapture = async () => {
    setErrorText(null);
    setHintText(null);
    sound.playClick();
    const next = await screenCapture.start();
    if (!next.active && next.error) {
      setErrorText(next.error);
      return;
    }
    // 提示「点右上角可切置顶小窗」已按要求移除（置顶按钮本身仍在标题栏）
  };

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  const handleStopCapture = () => {
    sound.playClick();
    autoManagerRef.current?.stop();
    setAutoMode(false);
    setAutoStatus(null);
    screenCapture.stop();
    setSlots([]);
    setDetectedStage(null);
    setStatusText('');
  };

  const handleRecognize = async (): Promise<FollowRecognizeResult | null> => {
    if (busy) return null;
    if (runtimeGuard.isActive) {
      setErrorText('检测到调试环境，识别已停用');
      return null;
    }
    if (!capture.active) {
      setErrorText('请先点下面的「连接游戏画面」，在弹窗里选中《洛克王国：世界》的窗口');
      return null;
    }
    sound.playClick();
    setBusy(true);
    setErrorText(null);
    setHintText(null);
    setStatusText('正在智能识别画面...');
    try {
      const res = await webFollowRecognize({
        // 手动指定过图（切换过地图）或钉住了图 → 按指定图识别；否则交给标题自动判定
        stageNum: recognizeTarget,
        trialKey: TRIAL_KEY,
        onProgress: (phase, p, text) => {
          if (!mountedRef.current) return;
          const base = text || (phase === 'infer' ? '正在匹配候选…' : '正在准备识别…');
          setStatusText(typeof p === 'number' && p > 0 ? `${base}（${p}%）` : base);
        },
      });
      if (!mountedRef.current) return;

      setDetectedStage(res.stage_num);
      // 与桌面版 applyApiResults 一致：识别后视图跳到识别出的图；钉住时保持在钉住的图
      setSelectedStage(pinnedStage ?? res.stage_num);
      setStageFromTitle(res.meta.stageFromTitle);
      setTitleText(res.meta.titleText);
      setLastMs(Math.round(res.meta.ms.total));
      setLastCaptureAt(nowTime());
      setLastMsDetail(res.meta.reused
          ? '画面未变化，沿用上次结果'
          : `切图 ${Math.round(res.meta.ms.yolo)}ms · OCR ${Math.round(res.meta.ms.title + res.meta.ms.names)}ms · `
            + `特征 ${Math.round(res.meta.ms.dino)}ms · 匹配 ${Math.round(res.meta.ms.match)}ms`);
      setSlots(res.results.map((item) => ({
        index: item.index,
        status: item.status,
        reason: item.reason,
        cropUrl: item.cropUrl,
        selected: 0,
        candidates: item.candidates.map((c) => ({
          filename: c.filename,
          score: c.score,
          pet: petOf(c.filename),
        })),
      })));
      // 与主页面联动：把本次识别（或钉住）的关卡同步过去，
      // 与桌面版 ScannerApp::applyApiResults 的行为保持一致。
      const syncStage = pinnedStage ?? res.stage_num;
      try {
        storage.setSetting('activeStageNum', syncStage);
        localStorage.setItem('roco_active_stage_num', String(syncStage));
        if ('BroadcastChannel' in window) {
          const bc = new BroadcastChannel('roco_channel');
          bc.postMessage({ type: 'SWITCH_MAP', mapNum: syncStage });
          bc.close();
        }
        window.opener?.postMessage({ type: 'SWITCH_MAP', mapNum: syncStage }, '*');
      } catch {
        /* 跨窗口同步失败不影响识别本身 */
      }

      // 缓存本次 3 卡的文件名 + DINO 特征，供自动模式进入战斗后比对敌方头像
      autoManagerRef.current?.rememberCards(res, TRIAL_KEY);

      setStatusText('');
      if (res.meta.reused) setHintText(null);
      if (res.meta.counts.item === 0 && res.meta.counts.name === 0) {
        setHintText('没有在画面里找到精灵槽位，确认共享的是游戏窗口且停在试炼的战斗选择界面');
      } else if (res.meta.counts.item < 3) {
        setHintText(`本次只检出 ${res.meta.counts.item} 个精灵位（切图可能受窗口分辨率影响）`);
      }
      return res;
    } catch (err) {
      if (mountedRef.current) {
        if ((err as Error)?.message === CANCELED) {
          setStatusText('');
        } else if (err instanceof FollowCaptureError) {
          setErrorText(err.message);
          setStatusText('');
        } else {
          setErrorText((err as Error)?.message || '识别失败');
          setStatusText('');
        }
      }
      return null;
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  // 自动模式触发识别时复用上面这条链路（控制器通过 ref 调用，避免闭包过期）
  recognizeFnRef.current = handleRecognize;

  // ---------------- 自动模式控制 ----------------
  const handleToggleAuto = async () => {
    sound.playClick();
    const manager = autoManagerRef.current;
    if (!manager) return;
    if (autoMode) {
      manager.stop();
      setAutoMode(false);
      setAutoStatus(null);
      return;
    }
    // getDisplayMedia 必须在用户手势同步栈里调用，所以开启时在这里申请屏幕共享
    if (!screenCapture.isActive()) {
      setErrorText(null);
      setHintText(null);
      const st = await screenCapture.start();
      if (!st.active) {
        if (st.error) setErrorText(st.error);
        return;
      }
    }
    setErrorText(null);
    setAutoPanelOpen(true);
    setAutoMode(true);
    manager.start({ autoScan: autoScanOn, autoMark: autoMarkOn, tickSeconds });
  };

  const handleToggleAutoScan = () => {
    const v = !autoScanOn;
    setAutoScanOn(v);
    autoManagerRef.current?.updateOptions({ autoScan: v });
  };

  const handleToggleAutoMark = () => {
    const v = !autoMarkOn;
    setAutoMarkOn(v);
    autoManagerRef.current?.updateOptions({ autoMark: v });
  };

  const handleChangeTick = (v: number) => {
    setTickSeconds(v);
    try { storage.setSetting('autoWatchTickSeconds', v); } catch { /* ignore */ }
    autoManagerRef.current?.updateOptions({ tickSeconds: v });
  };

  const dismissAutoToast = (key: string) =>
      setAutoToasts((prev) => prev.filter((t) => t.key !== key));

  const undoAutoMark = (key: string, mapKey: string, filename: string) => {
    storage.toggleEncountered(mapKey, filename, '撤销自动点亮');
    setRecords(storage.getAll());
    try { sound.playToggleOff(); } catch { /* ignore */ }
    dismissAutoToast(key);
  };

  const phaseShort: Record<AutoStatus['phase'], string> = {
    idle: '等待', select: '选择', battle: '比对', boss: 'Boss',
    marked: '已点亮', no_window: '无画面', minimized: '最小化',
  };

  const renderPhaseIcon = (phase: AutoStatus['phase'], cls = 'w-3.5 h-3.5') => {
    switch (phase) {
      case 'select': return <Camera className={`${cls} text-[#1E5B99] dark:text-sky-300`} />;
      case 'battle': return <Loader2 className={`${cls} animate-spin text-amber-500`} />;
      case 'boss': return <Crown className={`${cls} text-amber-500`} />;
      case 'marked': return <CheckCircle2 className={`${cls} text-emerald-600`} />;
      case 'no_window':
      case 'minimized': return <AlertTriangle className={`${cls} text-rose-500`} />;
      default: return <Bot className={`${cls} text-slate-500`} />;
    }
  };

  /**
   * 切换地图（仅改变视图/下次识别的目标，不触发识别）——对齐桌面版 handleSelectMap：
   * 只切视图，钉住与否由「钉住」按钮单独决定。
   */
  const handleSelectMap = (mapNum: number | null) => {
    sound.playClick();
    setSelectedStage(mapNum);
  };

  /** 钉住/取消钉住当前关卡——对齐桌面版 handleTogglePin。 */
  const handleTogglePin = () => {
    sound.playClick();
    if (pinnedStage !== null) {
      setPinnedStage(null);
      try {
        storage.setSetting('scannerPinnedStageNum', null);
      } catch {
        /* ignore */
      }
    } else if (selectedStage !== null) {
      setPinnedStage(selectedStage);
      try {
        storage.setSetting('scannerPinnedStageNum', selectedStage);
      } catch {
        /* ignore */
      }
      setSelectedStage(selectedStage);
    }
  };

  /** 供「遇见历史 → 定位到某图」复用：等于切换地图。 */
  const handlePin = (stage: number | null) => handleSelectMap(stage);

  const handleToggleLight = (slot: SlotView) => {
    const candidate = slot.candidates[slot.selected];
    if (!candidate) return;
    const mapId = `map${lightStage}`;
    const wasLit = storage.isEncountered(mapId, candidate.filename);
    storage.toggleEncountered(mapId, candidate.filename, '跟随识别点亮图鉴');
    setRecords(storage.getAll());
    if (wasLit) sound.playToggleOff();
    else sound.playEncounter();
  };

  const handleSelectCandidate = (slotIndex: number, candidateIndex: number) => {
    setSlots((prev) => prev.map((s) => (s.index === slotIndex ? { ...s, selected: candidateIndex } : s)));
  };

  // ---------------- Document PiP（Chromium 113+）----------------

  const pipSupported = typeof window !== 'undefined' && 'documentPictureInPicture' in window && IS_STATIC;

  const handleOpenPip = async () => {
    if (!pipSupported) {
      setErrorText('当前浏览器不支持悬浮窗（需要 Chrome / Edge 113+），可把本窗口缩小后放到游戏旁边');
      return;
    }
    try {
      const pipApi = (window as unknown as {
        documentPictureInPicture: { requestWindow: (o: { width: number; height: number }) => Promise<Window> };
      }).documentPictureInPicture;
      const win = await pipApi.requestWindow({ width: SCANNER_WIDTH, height: SCANNER_HEIGHT });
      copyStylesTo(win);
      win.document.documentElement.className = document.documentElement.className;
      win.document.body.className = 'bg-[#FDF9F3] dark:bg-slate-900 m-0';
      win.addEventListener('pagehide', () => {
        // PiP 关闭后先把预览 video 摘出来，下一次渲染才能重新挂回主文档
        const video = screenCapture.getVideoElement();
        try {
          if (video?.parentElement) video.parentElement.removeChild(video);
        } catch {
          /* ignore */
        }
        setPipWindow(null);
      });
      setPipWindow(win);
    } catch (err) {
      setErrorText(`悬浮窗打开失败：${(err as Error)?.message || err}`);
    }
  };

  const handleCloseWindow = () => {
    sound.playClick();
    screenCapture.stop();
    releaseFollowAssets();
    // 托管在首页开的 PiP 小窗里时，这个组件的 JS 跑在**首页**的上下文里 ——
    // 直接 window.close() 关掉的是首页！要关的是那个小窗。
    if (hostedInPip && hostWindow) {
      try {
        hostWindow.close();
      } catch {
        /* ignore */
      }
      return;
    }
    try {
      window.close();
    } catch {
      /* ignore */
    }
    // 非脚本打开的窗口（直接粘地址访问的标签页）浏览器不允许脚本关闭，给个提示
    window.setTimeout(() => {
      if (mountedRef.current) setErrorText('浏览器不允许脚本关闭这个窗口，直接关掉标签页即可');
    }, 300);
  };

  const handleClosePip = () => {
    try {
      pipWindow?.close();
    } catch {
      /* ignore */
    }
    setPipWindow(null);
  };
  // ---------------- 渲染 ----------------

  // ---------------- 窗口高度随内容自适应 ----------------

  const lastOuterHeightRef = useRef<number | null>(null);
  const lastResizeAtRef = useRef(0);
  const resizeTrailingRef = useRef<number | null>(null);

  /**
   * 按内容自然高度调整窗口高度（与桌面版 ScannerApp::syncScannerWindowHeight 同款算法）：
   *
   *   target = max(最小高度, 标题栏 + 滚动区内容 + 底部动作区 + 状态栏)
   *
   * 桌面版是 pywebview 原生 resize；Web 版只能 resizeTo，而
   *   - resizeTo 设的是「含浏览器外框」的尺寸，所以要用 outer-inner 差值补偿；
   *   - 浏览器不允许窗口超过屏幕可用高度，超出部分只能靠滚动；
   *   - 普通标签页会忽略 resizeTo，此时退化成固定高度 + 滚动，不影响功能。
   */
  const syncWindowHeight = useCallback(() => {
    // PiP（无论是自己转的还是首页直接开的）尺寸由 requestWindow 决定，不做自适应
    if (pipWindow || hostedInPip) return;
    if (typeof window === 'undefined') return;
    const contentEl = hostDoc().getElementById('scanner-scroll-content');
    if (!contentEl) return;

    const doc = hostDoc();
    const hOf = (id: string, fallback: number) => {
      const el = doc.getElementById(id);
      return el ? el.getBoundingClientRect().height : fallback;
    };
    const titlebarH = hOf('scanner-titlebar', 44);
    const statusbarH = hOf('scanner-statusbar', 28);
    const actionH = hOf('scanner-actionbar', 0);

    // 滚动区内容的自然高度 = 各直接子元素高度之和 + 间距 + 上下内边距
    const children = Array.from(contentEl.children) as HTMLElement[];
    const gap = 10;
    let contentH = 0;
    children.forEach((child, i) => {
      contentH += child.getBoundingClientRect().height;
      if (i > 0) contentH += gap;
    });
    if (!children.length) contentH = contentEl.scrollHeight;
    const cs = getComputedStyle(contentEl);
    contentH += (parseFloat(cs.paddingTop) || 12) + (parseFloat(cs.paddingBottom) || 12);

    const contentTarget = Math.max(
        SCANNER_MIN_HEIGHT,
        Math.ceil(titlebarH + contentH + actionH + statusbarH),
    );

    const chromeW = Math.max(0, window.outerWidth - window.innerWidth);
    const chromeH = Math.max(0, window.outerHeight - window.innerHeight);
    const avail = window.screen?.availHeight || 0;
    const maxOuter = avail > 0 ? Math.max(480, avail - 24) : contentTarget + chromeH;
    const targetOuter = Math.round(Math.min(contentTarget + chromeH, maxOuter));

    const prev = lastOuterHeightRef.current;
    if (prev !== null && Math.abs(prev - targetOuter) <= 4) return;
    lastOuterHeightRef.current = targetOuter;
    try {
      window.resizeTo(SCANNER_WIDTH + chromeW, targetOuter);
    } catch {
      /* 浏览器拒绝 resize 时忽略 */
    }
  }, [pipWindow, hostedInPip, hostDoc]);

  /** 高度同步节流（leading + trailing）：内容一变先立刻调一次，高频变化合并到间隔后一次。 */
  const scheduleHeightSync = useCallback(() => {
    const INTERVAL = 120;
    const now = Date.now();
    const remaining = INTERVAL - (now - lastResizeAtRef.current);
    if (remaining <= 0) {
      lastResizeAtRef.current = now;
      syncWindowHeight();
    } else if (resizeTrailingRef.current === null) {
      resizeTrailingRef.current = window.setTimeout(() => {
        resizeTrailingRef.current = null;
        scheduleHeightSync();
      }, remaining);
    }
  }, [syncWindowHeight]);

  /**
   * 内容高度一变就同步窗口高度。
   *
   * 主路径是 ResizeObserver 盯着内层内容容器（它的高度只由内容决定、不受窗口高度影响，
   * 所以不会「resize -> 布局变 -> 再 resize」地自激）；再加一次定时兜底，等精灵图/字体加载完。
   */
  useEffect(() => {
    if (pipWindow) return;
    scheduleHeightSync();
    const timer = window.setTimeout(scheduleHeightSync, 350);

    const inner = hostDoc().getElementById('scanner-content-inner');
    const observer = inner && typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => scheduleHeightSync())
        : null;
    observer?.observe(inner as Element);

    return () => {
      window.clearTimeout(timer);
      observer?.disconnect();
    };
  }, [pipWindow, hostedInPip, hostDoc, scheduleHeightSync, slots, hintText, errorText, statusText, busy]);

  // 预览 video 必须留在文档里：脱离文档或 display:none 时浏览器会降频甚至暂停解码，
  // 抓帧就会拿到旧画面。所以用一个 1×1 透明容器挂着它（界面上看不见）。
  useEffect(() => {
    const host = videoHostRef.current;
    const video = screenCapture.getVideoElement();
    if (!host || !video) return;
    if (video.parentElement !== host) {
      host.innerHTML = '';
      host.appendChild(video);
    }
    video.className = 'w-px h-px';
    return () => {
      if (video.parentElement === host) host.removeChild(video);
    };
  }, [capture.active, pipWindow]);

  const body = (
      <div
          className="w-screen h-screen bg-[#FDF9F3] dark:bg-slate-900 text-slate-800 dark:text-slate-100 flex flex-col justify-between select-none overflow-hidden font-sans border-0 m-0 p-0 relative rounded-none"
          style={{
            minWidth: SCANNER_WIDTH,
            // 高度同样锁默认值；只有「窗口本身比默认高度还矮」（小屏 / 高 DPI 缩放）
            // 才退让到 100vh —— 否则会把底部状态栏顶到屏幕外，反而更难用。
            minHeight: `min(${SCANNER_HEIGHT}px, 100vh)`,
          }}
      >
        {busy && <div className="scanner-radar-active" />}

        {/* 自动模式：右下角状态面板 / 迷你胶囊 / 自动点亮撤销 toast（放在 body 内，PiP 里也渲染） */}
        {autoMode && (
          <div className="absolute right-2 bottom-[150px] z-40 w-[232px] flex flex-col items-end gap-2 pointer-events-none">
            {autoToasts.map((t) => (
              <div
                  key={t.key}
                  className="pointer-events-auto w-full rounded-2xl border-2 border-[#95D151]/60 bg-[#F1FBEC]/95 dark:bg-emerald-950/80 shadow-lg px-2.5 py-2"
              >
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span className="text-[11px] font-black text-[#2D6613] dark:text-emerald-300 flex-1 truncate">
                    已自动点亮：{t.displayName}
                  </span>
                  <button
                      type="button"
                      onClick={() => dismissAutoToast(t.key)}
                      title="关闭提示"
                      className="w-5 h-5 rounded-md flex items-center justify-center text-slate-500 hover:bg-black/5 cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
                <button
                    type="button"
                    onClick={() => undoAutoMark(t.key, t.mapKey, t.filename)}
                    className="mt-1 w-full text-[10px] font-black rounded-lg py-1 bg-white/70 dark:bg-slate-800 text-[#2D6613] dark:text-emerald-300 border border-[#95D151]/50 hover:bg-[#E1F7DB] transition-all cursor-pointer"
                >
                  撤销这次点亮
                </button>
              </div>
            ))}

            {autoPanelOpen ? (
              <div className="pointer-events-auto w-full rounded-2xl border-2 border-[#7BC363]/60 bg-white/95 dark:bg-slate-800/95 shadow-xl overflow-hidden">
                <div className="flex items-center justify-between px-2 py-1 bg-[#EAF7E4] dark:bg-emerald-950/50 border-b border-[#7BC363]/40">
                  <div className="flex items-center gap-1.5 text-[11px] font-black text-[#2D6613] dark:text-emerald-300">
                    <Bot className="w-3.5 h-3.5" />
                    自动状态
                  </div>
                  <div className="flex items-center gap-0.5">
                    <button
                        type="button"
                        onClick={() => setAutoPanelOpen(false)}
                        title="隐藏面板（右上角仍保留迷你状态）"
                        className="w-6 h-6 rounded-lg flex items-center justify-center text-[#2D6613] dark:text-emerald-300 hover:bg-black/5 cursor-pointer"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <button
                        type="button"
                        onClick={handleToggleAuto}
                        title="关闭自动模式"
                        className="w-6 h-6 rounded-lg flex items-center justify-center text-[#2D6613] dark:text-emerald-300 hover:bg-black/5 cursor-pointer"
                    >
                      <Square className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                <div className="px-2.5 py-2 space-y-1.5">
                  <div className="flex items-start gap-2 text-[11px] leading-snug min-h-[28px]">
                    <span className="mt-0.5 shrink-0">{renderPhaseIcon(autoStatus?.phase || 'idle')}</span>
                    <span className="font-bold text-slate-700 dark:text-slate-200 break-words">
                      {autoStatus?.message || '监控中…'}
                    </span>
                  </div>
                  {autoStatus?.lastMarked && (
                    <div className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 truncate">
                      最近点亮：{autoStatus.lastMarked.name} · {autoStatus.lastMarked.time}
                    </div>
                  )}
                  <button
                      type="button"
                      onClick={handleToggleAutoScan}
                      className={`w-full flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-black border transition-all cursor-pointer ${
                          autoScanOn
                              ? 'bg-[#E1F7DB] dark:bg-emerald-950/60 text-[#2D6613] dark:text-emerald-300 border-[#95D151]/50'
                              : 'bg-slate-50 dark:bg-slate-900 text-slate-400 border-slate-200 dark:border-slate-700'
                      }`}
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span className="flex-1 text-left">自动识别（选择界面/刷新）</span>
                    <span className={`text-[9px] px-1 rounded-full ${
                        autoScanOn ? 'bg-emerald-500 text-white' : 'bg-slate-300 text-slate-600'}`}>
                      {autoScanOn ? '开' : '关'}
                    </span>
                  </button>
                  <button
                      type="button"
                      onClick={handleToggleAutoMark}
                      className={`w-full flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-black border transition-all cursor-pointer ${
                          autoMarkOn
                              ? 'bg-[#E1F7DB] dark:bg-emerald-950/60 text-[#2D6613] dark:text-emerald-300 border-[#95D151]/50'
                              : 'bg-slate-50 dark:bg-slate-900 text-slate-400 border-slate-200 dark:border-slate-700'
                      }`}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span className="flex-1 text-left">自动点亮（对战精灵）</span>
                    <span className={`text-[9px] px-1 rounded-full ${
                        autoMarkOn ? 'bg-emerald-500 text-white' : 'bg-slate-300 text-slate-600'}`}>
                      {autoMarkOn ? '开' : '关'}
                    </span>
                  </button>
                  <div className="flex items-center justify-between gap-1 pt-0.5">
                    <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400">扫描间隔</span>
                    <div className="flex gap-1">
                      {[0.25, 0.5, 1].map((v) => (
                        <button
                            key={v}
                            type="button"
                            onClick={() => handleChangeTick(v)}
                            className={`px-1.5 py-0.5 rounded-md text-[10px] font-black border transition-all cursor-pointer ${
                                tickSeconds === v
                                    ? 'bg-[#7ABCF4] text-white border-[#5DA8E8]'
                                    : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-[#D5E3F0] dark:border-slate-700 hover:bg-[#EBF5FE]'
                            }`}
                        >
                          {v}s
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <button
                  type="button"
                  onClick={() => setAutoPanelOpen(true)}
                  title="展开自动状态"
                  className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-[#1E5B99]/95 dark:bg-sky-900/95 px-3 py-1.5 text-[11px] font-black text-white shadow-lg border-2 border-white/30 cursor-pointer hover:bg-[#17487a]"
              >
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#95D151]/80 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-[#95D151]" />
                </span>
                <span className="truncate">自动中 · {phaseShort[autoStatus?.phase || 'idle']}</span>
                <Settings className="w-3 h-3 opacity-80" />
              </button>
            )}
          </div>
        )}

        {/* 0. 顶部功能栏：与桌面版 ScannerApp 的标题栏同一套按钮
              （系别 / 关卡 / 主题 / 历史 / 查图鉴 / 置顶 / 关闭）。
              注意：浏览器窗口不能由网页拖动，这里不做拖拽区。 */}
        <div
            id="scanner-titlebar"
            className="h-11 px-3 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200/70 dark:border-slate-800 flex items-center justify-between gap-2 shrink-0 text-slate-800 dark:text-slate-100"
        >
          <div className="flex items-center gap-2 min-w-0">
            <div
                className="w-7 h-7 rounded-xl bg-white dark:bg-slate-800 ring-1 ring-inset ring-slate-200 dark:ring-slate-700 flex items-center justify-center shrink-0"
                title={`当前试炼：${trial.title}`}
            >
              <ElementBadges elements={['草']} size="md" />
            </div>
            <div className="flex items-center gap-1.5 min-w-0">
              <span
                  className="text-xs sm:text-sm font-black text-slate-800 dark:text-slate-100 truncate tracking-tight"
                  title={titleText ? `标题 OCR：${titleText}` : undefined}
              >
                {currentMapDef?.name || '跟随识别'}
              </span>
              <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-sky-100 dark:bg-sky-500/20 text-sky-700 dark:text-sky-300 ring-1 ring-inset ring-sky-200 dark:ring-sky-500/40 shrink-0 font-mono">
                {viewStage === null ? `全图 ${mapStats.encountered}/${mapStats.total}` : `地图 ${viewStage}`}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
                type="button"
                onClick={() => {
                  sound.playClick();
                  themeService.toggleTheme();
                }}
                className="w-7 h-7 rounded-xl bg-white dark:bg-slate-800 ring-1 ring-inset ring-slate-200 dark:ring-slate-700 hover:ring-slate-300 dark:hover:ring-slate-600 active:opacity-80 text-slate-500 dark:text-slate-300 flex items-center justify-center transition-all cursor-pointer"
                title={isDarkTheme ? '切换为明亮模式' : '切换为暗黑模式'}
            >
              {isDarkTheme
                  ? <Sun className="w-3.5 h-3.5 text-amber-500" />
                  : <Moon className="w-3.5 h-3.5 text-slate-500 dark:text-slate-300" />}
            </button>
            {/* 模型列表入口已移除：跟随识别用到的小模型在首次识别时自动下载 */}
            <button
                type="button"
                onClick={() => {
                  sound.playClick();
                  setIsHistoryOpen(true);
                }}
                className="px-2.5 py-1 rounded-xl bg-white dark:bg-slate-800 ring-1 ring-inset ring-slate-200 dark:ring-slate-700 hover:ring-slate-300 dark:hover:ring-slate-600 active:opacity-80 text-slate-600 dark:text-slate-300 flex items-center gap-1 text-xs font-black transition-all cursor-pointer"
                title="查看遇见历史与防止误点撤销"
            >
              <History className="w-3.5 h-3.5 text-amber-500" />
              <span>历史</span>
            </button>
            <button
                type="button"
                onClick={() => {
                  sound.playClick();
                  setIsGalleryOpen(true);
                }}
                className="px-2.5 py-1 rounded-xl bg-sky-100 dark:bg-sky-500/20 text-sky-700 dark:text-sky-300 ring-1 ring-inset ring-sky-200 dark:ring-sky-500/40 hover:bg-sky-200 dark:hover:bg-sky-500/30 active:opacity-80 flex items-center gap-1.5 text-xs font-black transition-all cursor-pointer mr-0.5"
                title="查看全部地图图鉴与全图名册"
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>查图鉴</span>
            </button>
            {!hostedInPip && (
            <button
                type="button"
                id="scanner-topmost-btn"
                onClick={pipWindow ? handleClosePip : handleOpenPip}
                title={pipWindow
                    ? '退出置顶小窗，回到本窗口'
                    : '置顶：打开无边框悬浮窗（没有浏览器工具栏和地址栏，始终在最前）'}
                className={`w-7 h-7 rounded-xl ring-1 ring-inset flex items-center justify-center transition-all cursor-pointer active:opacity-80 ${
                    pipWindow
                        ? 'bg-sky-100 dark:bg-sky-500/20 text-sky-700 dark:text-sky-300 ring-sky-200 dark:ring-sky-500/40'
                        : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-300 ring-slate-200 dark:ring-slate-700 hover:ring-slate-300 dark:hover:ring-slate-600'
                }`}
            >
              {pipWindow ? <Pin className="w-4 h-4" /> : <PinOff className="w-4 h-4" />}
            </button>
            )}
            <button
                type="button"
                id="scanner-standalone-close-btn"
                onClick={handleCloseWindow}
                className="w-7 h-7 rounded-xl bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-300 ring-1 ring-inset ring-slate-200 dark:ring-slate-700 hover:bg-rose-500 hover:text-white hover:ring-rose-500 flex items-center justify-center transition-all cursor-pointer active:opacity-80"
                title={hostedInPip ? '关闭小窗' : '关闭窗口'}
            >
              <X className="w-4 h-4 stroke-[2.5]" />
            </button>
          </div>
        </div>

        {/* 1. 内容区（与桌面版一致：p-3 + 卡片堆叠 + 底部动作区） */}
        <div
            id="scanner-scroll-content"
            className="flex-1 overflow-y-auto custom-roco-scrollbar bg-[#FDF9F3] dark:bg-slate-900 p-3 transition-colors"
        >
          <div id="scanner-content-inner" className="space-y-2.5">
            {/* 1.1 关卡卡：全图总览 / 指定图 + 切换地图 + 钉住
                   逻辑与桌面版 ScannerApp 一致 —— 切换地图只改视图与下次识别目标，
                   钉住与否由「钉住」按钮单独决定，都不再是「自动/手动」二选一。 */}
            <div className="p-3 bg-white dark:bg-slate-800 roco-card border-2 border-[#E6EEF8] dark:border-slate-700 rounded-2xl space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-800 dark:text-slate-100 font-black flex items-center gap-1.5 min-w-0">
                  <Layers className="w-4 h-4 text-[#7ABCF4] shrink-0" />
                  <span className="truncate">
                    {viewStage === null ? '王国各区域图鉴总览' : (currentMapDef?.name || '跟随识别')}
                  </span>
                </span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                      type="button"
                      onClick={handleTogglePin}
                      disabled={pinnedStage === null && selectedStage === null}
                      className={`px-2 py-1 rounded-lg text-[10px] font-black border flex items-center gap-1 transition-all cursor-pointer active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed ${
                          pinnedStage !== null
                              ? 'bg-[#FEE061] text-[#854D0E] border-[#E5C43B]'
                              : 'bg-[#F8FBFE] dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-[#D5E3F0] dark:border-slate-700 hover:border-[#7ABCF4]'
                      }`}
                      title={pinnedStage !== null
                          ? `已钉住【${trial.maps.find((m) => m.num === pinnedStage)?.name}】：再次识别后视图不再跳回`
                          : '钉住当前关卡：再次识别后视图不再跳回识别出的关卡'}
                  >
                    <MapPin className={`w-3 h-3 ${pinnedStage !== null ? 'fill-[#E5C43B]' : ''}`} />
                    {pinnedStage !== null ? '已钉住' : '钉住'}
                  </button>
                  <span className="text-xs font-mono font-black text-[#2D6613] dark:text-emerald-300 bg-[#E1F7DB] dark:bg-emerald-950/60 px-2 py-0.5 rounded-full border border-[#95D151]/50 dark:border-emerald-700/50">
                    {mapStats.encountered}/{mapStats.total}
                  </span>
                  {mapStats.remaining > 0 ? (
                      <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700">
                        余 {mapStats.remaining}
                      </span>
                  ) : (
                      <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700">
                        全收录 🎉
                      </span>
                  )}
                </div>
              </div>

              <div className="w-full h-2.5 bg-[#E9F2FA] dark:bg-slate-700/80 rounded-full overflow-hidden border-2 border-[#D5E3F0] dark:border-slate-600 p-0.5">
                <div
                    className="h-full rounded-full bg-gradient-to-r from-[#95D151] to-[#76B032] transition-all duration-300"
                    style={{ width: `${mapStats.percent}%` }}
                />
              </div>

              {/* 切换地图：全图 / 图1 / 图2 / 图3（与桌面版同一套文案） */}
              <div className="pt-1.5 border-t border-[#EDF2F7] dark:border-slate-700/80 flex items-center justify-between gap-1.5">
                <span className="text-[10px] font-black text-slate-500 dark:text-slate-400 shrink-0">
                  切换地图:
                </span>
                <div className="grid grid-cols-4 gap-1 flex-1">
                  <button
                      type="button"
                      onClick={() => handleSelectMap(null)}
                      className={`py-1 px-1 rounded-lg text-[10px] font-black border transition-all cursor-pointer truncate ${
                          viewStage === null
                              ? 'bg-[#7ABCF4] dark:bg-sky-600 text-white border-[#5DA8E8] dark:border-sky-500'
                              : 'bg-[#F8FBFE] dark:bg-slate-800 hover:bg-[#EBF5FE] dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border-[#D5E3F0] dark:border-slate-700'
                      }`}
                      title="查看王国各区域图鉴总览，且下次识别按画面标题自动判定关卡"
                  >
                    全图
                  </button>
                  {trial.maps.map((m) => (
                      <button
                          key={m.id}
                          type="button"
                          onClick={() => handleSelectMap(m.num)}
                          className={`py-1 px-1 rounded-lg text-[10px] font-black border transition-all cursor-pointer truncate ${
                              viewStage === m.num
                                  ? 'bg-[#7ABCF4] dark:bg-sky-600 text-white border-[#5DA8E8] dark:border-sky-500'
                                  : 'bg-[#F8FBFE] dark:bg-slate-800 hover:bg-[#EBF5FE] dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border-[#D5E3F0] dark:border-slate-700'
                          }`}
                          title={`${m.name}${viewStage === m.num && hasPendingMapChange ? '（已指定，下次识别用这张图）' : ''}`}
                      >
                        图{m.num} {m.short}
                      </button>
                  ))}
                </div>
              </div>
            </div>

            {/* 1.2 状态提示 */}
            {errorText && (
                <div className="text-[11px] font-bold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/50 border-2 border-rose-200 dark:border-rose-800 rounded-2xl px-2.5 py-2">
                  {errorText}
                </div>
            )}
            {hintText && (
                <div className="text-[11px] font-bold text-[#854D0E] dark:text-amber-200 bg-[#FEF9E6] dark:bg-amber-950/60 border-2 border-[#E5C43B] dark:border-amber-700 rounded-2xl px-2.5 py-2">
                  {hintText}
                </div>
            )}

            {/* 1.3 识别结果卡（与桌面版槽位卡同款） */}
            {slots.map((slot) => {
              const chosen = slot.candidates[slot.selected];
              if (!chosen) return null;
              const name = formatPetName(chosen.filename);
              const lit = isLit(chosen.filename);

              // 特殊点位（魔力之源 / 远行商人）：不是精灵，图鉴里没有它们，
              // 按桌面版 ScannerApp 的写法渲染成虚线占位卡，不给「点亮图鉴」按钮。
              const isSpecialPlaceholder = name === '魔力之源' || chosen.filename.includes('魔力之源')
                  || name === '远行商人' || chosen.filename.includes('远行商人');
              if (isSpecialPlaceholder) {
                return (
                    <div
                        key={slot.index}
                        className="rounded-2xl border-2 border-dashed border-[#BCD7F2] dark:border-sky-900/60 bg-[#F4F9FF] dark:bg-slate-800/90 p-3 text-center flex items-center justify-between gap-2.5"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-10 h-10 rounded-2xl bg-white dark:bg-slate-900 border-2 border-[#D5E3F0] dark:border-slate-700 flex items-center justify-center text-amber-500 font-bold text-base shrink-0">
                          {name.includes('魔力之源') ? '❤️' : '🎒'}
                        </div>
                        <div className="text-left min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-black text-slate-800 dark:text-slate-100 truncate">
                              【特殊点位】{name}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate font-medium">
                            场景特殊交互点，无需点亮图鉴
                          </p>
                        </div>
                      </div>
                    </div>
                );
              }

              return (
                  <div
                      key={slot.index}
                      className={`roco-card rounded-2xl border-2 p-3 transition-all ${
                          lit
                              ? 'bg-[#F8FBFE] dark:bg-slate-800/90 border-[#D5E3F0] dark:border-slate-700 text-slate-600 dark:text-slate-300'
                              : 'bg-white dark:bg-slate-800 border-[#7ABCF4] dark:border-sky-500 text-slate-800 dark:text-slate-100'
                      }`}
                  >
                    <div className="flex items-center justify-between gap-2.5 mb-2.5">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="relative shrink-0">
                          <div className="w-12 h-12 rounded-2xl bg-white dark:bg-slate-900 border-2 border-[#D5E3F0] dark:border-slate-700 p-1 flex items-center justify-center overflow-hidden">
                            {chosen.pet
                                ? <PetSprite pet={chosen.pet} className="w-full h-full" alt={name} />
                                : slot.cropUrl
                                    ? <img src={slot.cropUrl} alt={name} className="w-full h-full object-contain" />
                                    : <span className="w-full h-full rounded bg-slate-100 dark:bg-slate-700" />}
                          </div>
                          <ElementBadges elements={chosen.pet?.elements} className="absolute top-0.5 left-0.5 z-10" />
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs sm:text-sm font-black text-slate-800 dark:text-slate-100 truncate" title={name}>
                              {name}
                            </span>
                            <PetSpecialTag pet={chosen.pet} filename={chosen.filename} />
                            <span className="text-[10px] font-mono font-black text-emerald-800 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-950/60 px-2 py-0.5 rounded-full border border-emerald-300 dark:border-emerald-800">
                              {pctOf(chosen.score)}
                            </span>
                          </div>

                          <div className="flex items-center gap-1 mt-1">
                            {lit ? (
                                <span className="text-[10px] font-bold text-[#2D6613] dark:text-emerald-300 bg-[#E1F7DB] dark:bg-emerald-950/60 px-2 py-0.5 rounded-full border border-[#95D151]/50 dark:border-emerald-700/50 flex items-center gap-1">
                                  <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400 stroke-[3]" />
                                  已在图鉴
                                </span>
                            ) : (
                                <span className="text-[10px] font-black text-amber-800 dark:text-amber-300 bg-[#FEF9E6] dark:bg-amber-950/60 px-2 py-0.5 rounded-full border border-[#E5C43B] dark:border-amber-700/60 flex items-center gap-1">
                                  <Sparkle className="w-3 h-3 text-amber-600 dark:text-amber-400 fill-amber-500" />
                                  未遇新宠 (可点亮)
                                </span>
                            )}
                            {slot.reason && !lit && (
                                <span className="text-[10px] text-slate-400 dark:text-slate-500 font-bold truncate" title={slot.reason}>
                                  {slot.reason}
                                </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <button
                          type="button"
                          onClick={() => handleToggleLight(slot)}
                          className={`px-3 py-1.5 text-xs font-black rounded-xl flex items-center gap-1.5 transition-all cursor-pointer shrink-0 border-2 ${
                              lit
                                  ? 'roco-btn-secondary bg-[#E1F7DB]/80 dark:bg-emerald-950/60 hover:bg-[#D3F3CA] text-[#2D6613] dark:text-emerald-300 border-[#86EFAC]'
                                  : 'roco-btn-success text-white'
                          }`}
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>{lit ? '已遇见' : '点亮图鉴'}</span>
                      </button>
                    </div>

                    {slot.candidates.length > 1 && (
                        <CandidateGrid
                            candidates={slot.candidates}
                            selected={slot.selected}
                            isLit={isLit}
                            onSelect={(idx) => handleSelectCandidate(slot.index, idx)}
                        />
                    )}
                  </div>
              );
            })}

            {!slots.length && !busy && (
                <div className="p-3 bg-white dark:bg-slate-800 roco-card border-2 border-[#DCE8F5] dark:border-slate-700 rounded-2xl text-center">
                  <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
                    {capture.active ? '当前未检测到精灵' : '还没有连接游戏画面'}
                  </p>
                  {!capture.active && (
                      <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1 leading-relaxed">
                        点下面的「连接游戏画面」，在弹窗里选中《洛克王国：世界》的窗口即可。
                        <br />
                        列表里那个「识别窗口」就是这个网页（别选它）；
                        名字可能被浏览器截断，认<b>缩略图里的游戏画面</b>最稳。
                      </p>
                  )}
                </div>
            )}
          </div>

        </div>

          {/* 2. 底部动作区：连接画面（独立按钮）+ 识别 */}
        <div
            id="scanner-actionbar"
            className="px-3 pt-2 pb-2 bg-[#FDF9F3] dark:bg-slate-900 border-t-2 border-[#D5E3F0] dark:border-slate-700 space-y-2 shrink-0"
        >
            {/* 连接游戏画面：仅未连接时显示整条；选中窗口连接后自动消失，只在底部 LIVE 条保留“取消链接” */}
            {!capture.active && (
                <button
                    type="button"
                    onClick={handleStartCapture}
                    className="w-full h-10 rounded-2xl flex items-center justify-center gap-2 text-xs font-black transition-all cursor-pointer border-2 roco-btn-secondary"
                    title="选择要识别的游戏窗口"
                >
                  <MonitorPlay className="w-4 h-4 shrink-0" />
                  <span className="truncate">连接游戏画面</span>
                </button>
            )}

            <div className="grid grid-cols-[104px_1fr] gap-1.5">
              <div className="flex gap-1.5">
                {autoMode ? (
                    <>
                      <button
                          type="button"
                          onClick={handleToggleAuto}
                          title="自动模式运行中，点击关闭"
                          className="flex-1 h-10 rounded-2xl px-2 text-xs font-black flex items-center justify-center gap-1.5 text-white transition-all cursor-pointer active:scale-[0.99] bg-[#58A83F] hover:bg-[#4C9536] border-2 border-[#3F7E2E]"
                      >
                        <span className="relative flex h-2 w-2 shrink-0">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white/80 opacity-75" />
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
                        </span>
                        <span className="truncate">自动中</span>
                      </button>
                      <button
                          type="button"
                          onClick={() => setAutoPanelOpen((v) => !v)}
                          title="自动状态设置"
                          className={`w-7 h-10 shrink-0 rounded-2xl flex items-center justify-center transition-all cursor-pointer border-2 bg-[#EAF7E4] dark:bg-emerald-950/50 text-[#2D6613] dark:text-emerald-300 border-[#7BC363]/60 ${
                              autoPanelOpen ? 'ring-2 ring-[#7BC363]/50' : ''
                          }`}
                      >
                        <Settings className="w-4 h-4" />
                      </button>
                    </>
                ) : (
                    <button
                        type="button"
                        onClick={handleToggleAuto}
                        disabled={busy}
                        title="开启自动识别 / 自动点亮"
                        className="flex-1 h-10 rounded-2xl px-2 text-xs font-black flex items-center justify-center gap-1.5 transition-all cursor-pointer border-2 roco-btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Bot className="w-4 h-4" />
                      <span>自动</span>
                    </button>
                )}
              </div>
              <button
                  type="button"
                  id="scanner-single-recognize-btn"
                  onClick={handleRecognize}
                  disabled={busy}
                  className={`h-10 px-2 rounded-2xl text-xs sm:text-sm font-black flex items-center justify-center gap-1.5 transition-all cursor-pointer roco-btn-primary ${
                      busy ? 'opacity-60 cursor-not-allowed' : 'active:scale-[0.99]'
                  }`}
              >
                {busy ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>正在智能识别画面...</span>
                    </>
                ) : hasPendingMapChange ? (
                    <>
                      <RefreshCw className="w-4 h-4" />
                      <span className="truncate">重新识别 (地图{selectedStage})</span>
                    </>
                ) : isReRecognize && pinnedStage !== null ? (
                    <>
                      <MapPin className="w-4 h-4" />
                      <span className="truncate">识别 (已钉地图{pinnedStage})</span>
                    </>
                ) : (
                    <>
                      <Camera className="w-4 h-4 shrink-0" />
                      <span className="truncate">立即识别</span>
                    </>
                )}
              </button>
            </div>

            {statusText && (
                <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 text-center">{statusText}</p>
            )}
          </div>

        {/* 3. 底部状态栏：LIVE 状态 + 断开入口（连接后，紧跟 LIVE）；右侧上次捕获 + 悬浮窗 */}
        <div
            id="scanner-statusbar"
            className="h-7 px-3 bg-slate-50/90 dark:bg-slate-900/90 border-t border-slate-200/70 dark:border-slate-800 text-[11px] leading-tight font-mono text-slate-600 dark:text-slate-300 flex items-center justify-between gap-2 shrink-0 font-bold overflow-hidden"
        >
          <span className="flex items-center gap-1.5 shrink-0 min-w-0">
            <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                    capture.active ? 'bg-[#95D151] shadow-[0_0_0_3px_rgba(149,209,81,0.25)]' : 'bg-slate-400'
                }`}
            />
            {capture.active ? (
                // 只显示绿点 + LIVE；具体来源（浏览器给的窗口标题）放 title，鼠标悬停才看
                <span
                    className="text-[#2D6613] dark:text-emerald-300 truncate"
                    title={capture.label ? `当前画面来源：${capture.label}` : '已连接游戏画面'}
                >
                  LIVE
                </span>
            ) : (
                <span className="text-slate-500 dark:text-slate-400">未连接</span>
            )}
            {capture.active && (
                <button
                    type="button"
                    onClick={handleStopCapture}
                    title="取消链接（断开当前画面）"
                    className="w-4 h-4 p-0 leading-none rounded-full bg-white dark:bg-slate-700 border border-[#BCD7F2] dark:border-slate-600 text-slate-500 dark:text-slate-300 flex items-center justify-center self-center transition-colors hover:bg-slate-50 dark:hover:bg-slate-600 cursor-pointer shrink-0"
                >
                  <Unplug className="w-2.5 h-2.5" />
                </button>
            )}
          </span>
          <span className="flex items-center gap-2 min-w-0 flex-1 justify-end">
            {lastMs != null && (
                <span
                    className="text-[10px] font-sans font-normal text-slate-500 dark:text-slate-400 truncate"
                    title={lastMsDetail}
                >
                  上次捕获 {lastCaptureAt} · {lastMs}ms
                </span>
            )}
            <span className="text-[10px] leading-normal text-slate-400 dark:text-slate-500 font-sans font-normal shrink-0">
              洛克王国徽章试炼助手
            </span>
          </span>
        </div>

        {/* 4. 查图鉴 / 遇见历史（复用主 App 的弹窗，和桌面版同款） */}
        <ScannerMapGalleryModal
            isOpen={isGalleryOpen}
            onClose={() => setIsGalleryOpen(false)}
            initialMapNum={lightStage}
            mapsPets={mapsPets}
            records={records}
            mapsConfig={MAP_CONFIGS}
            onToggleEncounter={(mapId, filename) => {
              storage.toggleEncountered(mapId, filename, '跟随识别点亮图鉴');
              setRecords(storage.getAll());
            }}
            onOpenHistory={() => {
              setIsGalleryOpen(false);
              setIsHistoryOpen(true);
            }}
            trialKey={TRIAL_KEY}
        />

        {/* 模型列表（缓存状态 / 提前下载）—— 内联渲染，PiP 小窗里也能正常显示 */}
        <ModelAssetsModal isOpen={isModelAssetsOpen} onClose={() => setIsModelAssetsOpen(false)} />

        <EncounterHistoryModal
            isOpen={isHistoryOpen}
            onClose={() => setIsHistoryOpen(false)}
            records={records}
            allMapsPets={mapsPets}
            mapsConfig={MAP_CONFIGS}
            onToggleEncounter={(mapId, filename) => {
              storage.toggleEncountered(mapId, filename, '跟随识别点亮图鉴');
              setRecords(storage.getAll());
            }}
            onNavigateToPet={(mapNum) => {
              setIsHistoryOpen(false);
              handlePin(mapNum);
            }}
        />

        {/* 预览 video 的隐形载体（1×1 透明，仅为了让浏览器保持解码） */}
        <div
            ref={videoHostRef}
            aria-hidden
            className="fixed left-0 top-0 w-px h-px opacity-0 pointer-events-none overflow-hidden"
        />
      </div>
  );

  // 首页托管（hostWindow）时由 ScannerPipHost 负责 portal，这里直接输出内容
  if (hostedInPip) return body;
  return pipWindow ? createPortal(body, pipWindow.document.body) : body;
};

/** 把当前文档的样式表复制到 PiP 文档（跨域样式表退化为 <link>）。 */
export function copyStylesTo(win: Window): void {
  Array.from(document.styleSheets).forEach((sheet) => {
    try {
      const css = Array.from(sheet.cssRules).map((rule) => rule.cssText).join('\n');
      const style = win.document.createElement('style');
      style.textContent = css;
      win.document.head.appendChild(style);
    } catch {
      if (sheet.href) {
        const link = win.document.createElement('link');
        link.rel = 'stylesheet';
        link.href = sheet.href;
        win.document.head.appendChild(link);
      }
    }
  });
}

/** 供首页入口判断当前环境是否能用（不支持时给出说明而不是死按钮）。 */
export { isWebFollowSupported };

export default WebFollowScanner;
