import { Puzzle } from 'lucide-react';
import React, { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef, useDeferredValue } from 'react';
import { Header } from './components/Header';
import { SubHeaderToolbar } from './components/SubHeaderToolbar';
import { StatsBanner } from './components/StatsBanner';
import { PetSearchBox } from './components/PetSearchBox';
import { BatchRecognizerCard } from './components/BatchRecognizerCard';
import { SinglePetRecognizerModal } from './components/SinglePetRecognizerModal';
import { PetGrid } from './components/PetGrid';
import { PetDetailModal } from './components/PetDetailModal';
import { ManualSelectModal } from './components/ManualSelectModal';
import { BatchInitModal } from './components/BatchInitModal';
import { GlobalFloatingSearch } from './components/GlobalFloatingSearch';
import { BackToTopStandalone } from './components/BackToTopButton';
import { FloatingFilterSwitch } from './components/FloatingFilterSwitch';
import { FeedbackContactModal } from './components/FeedbackContactModal';
import { EncounterHistoryModal } from './components/EncounterHistoryModal';
import { UserManualModal } from './components/UserManualModal';
import { UpdateModal } from './components/UpdateModal';
import { DataUpdateModal } from './components/DataUpdateModal';
import { DownloadAppModal } from './components/DownloadAppModal';
import { DataManageModal } from './components/DataManageModal';
import { AppSettingsModal } from './components/AppSettingsModal';
import { HomeScrollbar } from './components/HomeScrollbar';
import { applyScrollbarSetting, DEFAULT_SCROLLBAR_WIDTH, DEFAULT_SHOW_SCROLLBAR } from './services/scrollbarSetting';
import { AssistantHub } from './components/AssistantHub';
import { PluginCenterModal } from './components/PluginCenterModal';
import { PluginPage } from './components/plugins/PluginPage';
import { MerchantSubscriptionModal } from './components/MerchantSubscriptionModal';
import { SyncPopNotification, SyncPopType } from './components/SyncPopNotification';
import { AuthBadge } from './components/AuthBadge';
import { FireBadgeTrial } from './components/Trial/FireBadgeTrial';
import { MAP_CONFIGS } from './data/mockPets';
import { resolveTrialMaps } from './data/trials';
import { api } from './services/api';
import { pluginApi, PluginInfo } from './services/pluginApi';
import { findSyncPlugin, runTrialSync, trialSignature, usePluginTrial } from './services/pluginSync';
import { CAPTURE_CONFLICT_MSG, isCaptureLive, setCaptureLive } from './services/captureMode';
import { storage } from './services/storage';
import { fireStorage } from './services/fireStorage';
import { getFireTrialPetsCached, invalidateFireTrialData } from './services/fireTrialData';
import { sound } from './services/sound';
import { updateStore } from './services/updateStore';
import { fireEncounterConfetti, fireUnencounterEffect } from './services/effect';
import { IS_STATIC } from './services/staticMode';
import { MapConfig, PetItem, PredictResult, EncounterRecord, EffectLevel, FloatingButtonsMode, Trial, AdvancedFilterState, SearchFilterPosition, StatsLayoutMode } from './types';
import { isPetEncounteredInRecords } from './utils/petHelper';
import { PetSearchMode } from './utils/skillSearch';


const SHOW_WEB_ICP_FILING = false;

export default function App() {
  const [activeStageNum, setActiveStageNum] = useState<number>(1);

  /**
   * 上一次从「设置」里同步过来的当前试炼图号。
   *
   * 为什么要有它：storage 的设置订阅回调并不只在你改了图号时触发 —— 改主题、
   * 切静音、调特效都会带着整份 settings 再来一次。之前这里无条件跟随
   * `newSettings.activeStageNum`，于是跟随识别窗口早先写进去的旧图号会在你点
   * 静音 / 切换明暗时被重新盖回当前选择：明明在 图2/图3，一下跳回 图1。
   * 现在改为「只有图号这个键真的被改动，或跨窗口场景下值确实变了」才跟随，
   * 既修掉跳图，又保留跟随识别 ↔ 主页面的地图联动。
   */
  const syncedStageRef = useRef<number | null>(
      typeof storage.getSettings().activeStageNum === 'number'
          ? (storage.getSettings().activeStageNum as number)
          : null,
  );
  // 首页批量识别进行中：锁定顶部 / 悬浮的地图切换
  const [isBatchScanning, setIsBatchScanning] = useState<boolean>(false);
  const [mapsData, setMapsData] = useState<Record<string, { count: number; items: PetItem[] }>>({});
  const [records, setRecords] = useState<Record<string, EncounterRecord>>({});
  const [filterMode, setFilterMode] = useState<'all' | 'encountered' | 'unencountered'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchMode, setSearchMode] = useState<PetSearchMode>('name');
  const [searchFilterPosition, setSearchFilterPosition] = useState<SearchFilterPosition>(() => {
    return storage.getSetting<SearchFilterPosition>('searchFilterPosition', 'position2');
  });
  // 地图信息栏布局：merged=并入 PetGrid 标题区（默认）| separate=顶部独立统计栏经典版
  const [statsLayoutMode, setStatsLayoutMode] = useState<StatsLayoutMode>(() => {
    return storage.getSetting<StatsLayoutMode>('statsLayoutMode', 'merged');
  });
  // 下滑浏览结果时，把搜索框固定在 header 下方（搜索行滚出可视区即显示）
  const [floatingSearch, setFloatingSearch] = useState<{ visible: boolean; top: number }>({
    visible: false,
    top: 0,
  });
  const statsBannerWrapRef = useRef<HTMLDivElement>(null);
  const petGridWrapRef = useRef<HTMLDivElement>(null);
  const floatingSearchCacheRef = useRef({ visible: false, top: 0 });
  // 记录「悬浮输入时」的滚动位置，筛选列表变短导致页面收缩时仍回到原处，避免闪回顶部
  const searchScrollCaptureRef = useRef<number | null>(null);

  const handleSearchChange = (q: string) => {
    if (floatingSearch.visible) {
      const y = window.scrollY;
      if (y > 0) searchScrollCaptureRef.current = y;
    }
    setSearchQuery(q);
  };

  const handleSearchModeChange = (m: PetSearchMode) => {
    if (floatingSearch.visible) {
      const y = window.scrollY;
      if (y > 0) searchScrollCaptureRef.current = y;
    }
    setSearchMode(m);
  };
  const [advancedFilters, setAdvancedFilters] = useState<AdvancedFilterState>({
    elements: [],
    specialTypes: [],
  });
  const [isSoundMuted, setIsSoundMuted] = useState<boolean>(() => {
    return storage.getSetting<boolean>('isSoundMuted', sound.getMuted());
  });
  const [isHistoryOpen, setIsHistoryOpen] = useState<boolean>(false);
  const [isManualOpen, setIsManualOpen] = useState<boolean>(false);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState<boolean>(false);
  const [detailPet, setDetailPet] = useState<PetItem | null>(null);
  const [feedbackInitialType, setFeedbackInitialType] = useState<string>('');
  const [isUpdateOpen, setIsUpdateOpen] = useState<boolean>(false);
  const [isDownloadOpen, setIsDownloadOpen] = useState<boolean>(false);
  const [isDataManageOpen, setIsDataManageOpen] = useState<boolean>(false);
  const [isDataUpdateOpen, setIsDataUpdateOpen] = useState<boolean>(false);
  const [dataUpdateAvailable, setDataUpdateAvailable] = useState<boolean>(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isMerchantSubscriptionOpen, setIsMerchantSubscriptionOpen] = useState<boolean>(false);
  const [isPluginCenterOpen, setIsPluginCenterOpen] = useState<boolean>(false);
  const [pluginToOpen, setPluginToOpen] = useState<string | null>(null);
  // ui.fullscreen 的插件走整页（替换整个界面），不走弹窗
  const [pluginPage, setPluginPage] = useState<PluginInfo | null>(null);
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  /**
   * 被「固定」到右下角悬浮栏的插件。
   * ⚠ 必须走 storage（后端 roco_user_data.json），**不能只存 localStorage**：
   *   桌面端 pywebview 是 private_mode，退出即清空 WebView 存储 —— 那就是"固定重启就没了"的原因。
   */
  const [pinnedPlugins, setPinnedPlugins] = useState<{ id: string; label: string }[]>(
    // getSettingCached：桌面端 appSettings 是异步从后端拉的，同步版本先给上次缓存值，
    // 不然重启后首帧读到空数组，看起来又像"固定没保存"。
    () => storage.getSettingCached<{ id: string; label: string }[]>('pinnedPlugins', []) || [],
  );

  // 后端设置到位后同步一次（首次启动时 appSettings 还没拉回来）
  useEffect(() => storage.subscribeSettings((st) => {
    const list = (st as { pinnedPlugins?: { id: string; label: string }[] }).pinnedPlugins;
    if (Array.isArray(list)) setPinnedPlugins(list);
  }), []);

  const savePinned = useCallback((next: { id: string; label: string }[]) => {
    setPinnedPlugins(next);
    try { storage.setSetting('pinnedPlugins', next); } catch { /* ignore */ }
  }, []);
  const [syncing, setSyncing] = useState<boolean>(false);
  // 抓包插件的草系试炼数据（静默同步用：用户界面不出现任何相关按钮/提示）
  const [view, setView] = useState<'assistant' | 'hub'>('assistant');
  const [trials, setTrials] = useState<Trial[]>([
    { key: 'grass', title: '草系徽章试炼', element: 'grass', collection_key: 'encounteredPets', dev_only: false },
  ]);
  const [activeTrialKey, setActiveTrialKey] = useState<'grass' | 'fire'>('grass');
  const activeTrialMaps = useMemo(() => resolveTrialMaps(trials, activeTrialKey), [trials, activeTrialKey]);

  // 同步当前试炼到 localStorage，供独立扫描窗口（跟随识别 ScannerApp）做开荒采集判断
  useEffect(() => {
    try {
      localStorage.setItem('roco_active_trial', activeTrialKey);
    } catch {
      // ignore
    }
  }, [activeTrialKey]);

  const [effectLevel, setEffectLevel] = useState<EffectLevel>(() => {
    return storage.getSetting<EffectLevel>('effectLevel', 0);
  });
  const [floatingMode, setFloatingMode] = useState<FloatingButtonsMode>(() => {
    return storage.getSetting<FloatingButtonsMode>('floatingButtonsMode', 'normal');
  });
  const [showHomeScrollbar, setShowHomeScrollbar] = useState<boolean>(() => {
    return storage.getSettingCached<boolean>('showHomeScrollbar', DEFAULT_SHOW_SCROLLBAR);
  });
  const [homeScrollbarWidth, setHomeScrollbarWidth] = useState<number>(() => {
    return storage.getSettingCached<number>('homeScrollbarWidth', DEFAULT_SCROLLBAR_WIDTH);
  });

  /**
   * 滚动条设置 → <html>。
   *
   * 全站滚动条样式（含各弹窗内部滚动条）都由这一个开关驱动：开启 = 统一极简样式 +
   * 首页右侧覆盖条；关闭 = 全站不显示滚动条（仍可滚动）。
   * 具体应用逻辑在 services/scrollbarSetting 里，跟随识别那两个独立文档复用同一套，
   * 它自己会订阅设置变化 + 等远程数据到达后重放，所以这里只需挂载一次。
   */
  useEffect(() => applyScrollbarSetting(), []);

  // Modal States
  const [isSingleRecognizerOpen, setIsSingleRecognizerOpen] = useState<boolean>(false);
  const [isBatchInitOpen, setIsBatchInitOpen] = useState<boolean>(false);
  const [isManualSelectOpen, setIsManualSelectOpen] = useState<boolean>(false);
  const [isGlobalSearchOpen, setIsGlobalSearchOpen] = useState<boolean>(false);
  const [predictResultForManual, setPredictResultForManual] = useState<PredictResult | null>(null);
  const [recognizerKey, setRecognizerKey] = useState<number>(0);
  const [activeEffectLevel, setActiveEffectLevel] = useState<EffectLevel>(0);
  const [syncPopState, setSyncPopState] = useState<{
    isVisible: boolean;
    message: string;
    subMessage?: string;
    type: SyncPopType;
  }>({
    isVisible: false,
    message: '图鉴已同步',
    type: 'encounter',
  });
  const syncPopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isAnyModalOpen = Boolean(
    isSingleRecognizerOpen ||
    isBatchInitOpen ||
    isManualSelectOpen ||
    isGlobalSearchOpen ||
    isHistoryOpen ||
    isManualOpen ||
    isFeedbackOpen ||
    isUpdateOpen ||
    isDownloadOpen ||
    isDataManageOpen ||
    isDataUpdateOpen ||
    isSettingsOpen ||
    isMerchantSubscriptionOpen ||
    isPluginCenterOpen ||
    detailPet !== null
  );

  // 桌面端：启动时拉一次插件列表，用于首页「插件中心」与右下角入口角标。
  // Web 版没有插件系统，直接跳过。
  useEffect(() => {
    if (IS_STATIC) return;
    pluginApi.list().then(setPlugins).catch(() => {});
  }, []);

  // 声明了「同步」能力且已启用的插件（目前是抓包插件的草系试炼同步）。
  const syncPlugin = useMemo(
      () => (IS_STATIC ? null : findSyncPlugin(plugins)),
      [plugins],
  );

  // 试炼数据统一走 usePluginTrial：内部是「轻量指纹轮询 + 变化才拉全量」，
  // 避免每次轮询都解析几十 KB 造成卡顿。
  const { trial: hookTrial, running: trialRunning } = usePluginTrial();
  const trial = hookTrial;

  // 抓包中 → 全局标记：其它页面（跟随识别 / 图鉴）据此拦截手动点亮/取消
  useEffect(() => {
    setCaptureLive(Boolean(syncPlugin && trialRunning));
    return () => setCaptureLive(false);
  }, [syncPlugin, trialRunning]);

  // 插件中心已并入悬浮按钮组，不再需要为独立入口留位置 —— 按钮组直接贴底
  const floatingBottomClass = 'bottom-6';

  // 任意弹窗打开时，锁住底层页面滚动（防止在弹窗外滚动滚轮时背景首页错误滚动）
  useEffect(() => {
    if (isAnyModalOpen) {
      const originalBodyOverflow = document.body.style.overflow;
      const originalHtmlOverflow = document.documentElement.style.overflow;
      const originalPaddingRight = document.body.style.paddingRight;

      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
      document.body.style.overflow = 'hidden';
      document.documentElement.style.overflow = 'hidden';
      if (scrollbarWidth > 0) {
        document.body.style.paddingRight = `${scrollbarWidth}px`;
      }
      return () => {
        document.body.style.overflow = originalBodyOverflow;
        document.documentElement.style.overflow = originalHtmlOverflow;
        document.body.style.paddingRight = originalPaddingRight;
      };
    }
  }, [isAnyModalOpen]);

  // Trigger celebration confetti & sleek pop notification
  const triggerScanSyncEffect = useCallback(
      (
          type: SyncPopType = 'encounter',
          customLevel?: EffectLevel,
          customMessage?: string,
          customSub?: string
      ) => {
        const levelToUse =
            typeof customLevel === 'number'
                ? customLevel
                : storage.getSetting<EffectLevel>('effectLevel', 0);
        setActiveEffectLevel(levelToUse);

        if (type === 'encounter') {
          fireEncounterConfetti(levelToUse);
        } else if (type === 'unencounter') {
          fireUnencounterEffect(levelToUse);
        }

        // Pop brief feedback badge
        setSyncPopState({
          isVisible: true,
          type,
          message:
              customMessage ||
              (type === 'encounter' ? '已记录为已遇见' : '已恢复为未遇见'),
          subMessage: customSub,
        });

        if (syncPopTimerRef.current) {
          clearTimeout(syncPopTimerRef.current);
        }
        syncPopTimerRef.current = setTimeout(() => {
          setSyncPopState((prev) => ({ ...prev, isVisible: false }));
          syncPopTimerRef.current = null;
        }, 2200);
      },
      []
  );

  // Load encounter records from local/backend storage
  const refreshRecords = useCallback(() => {
    setRecords(storage.getAll());
  }, []);

  // Fetch pet icons silently
  const fetchIconsData = useCallback(async () => {
    const iconsRes = await api.getIcons(activeTrialKey);
    setMapsData(iconsRes.data);
  }, [activeTrialKey]);

  useEffect(() => {
    refreshRecords();
    fetchIconsData();
    if (!IS_STATIC) {
      updateStore.init();
    }

    // 拉取后端可见的试炼列表（火系仅开发环境返回）
    api.getTrials().then((res) => {
      const fetchedTrials = Array.isArray(res.trials) ? res.trials : [];
      setTrials(fetchedTrials);
      // 仅当本次响应里真的包含可见的火系试炼时才预热全图鉴；
      // 生产后端会过滤掉 dev_only 火系，因此不再启动时白白拉一遍火系图鉴
      if (!IS_STATIC && fetchedTrials.some((t) => t.key === 'fire')) {
        getFireTrialPetsCached().catch(() => {});
      }
    });
    // 启动时异步检测图鉴数据是否需要更新（不阻塞界面）
    if (!IS_STATIC) {
      api.checkDataUpdates()
          .then((res) => setDataUpdateAvailable(res.has_update))
          .catch(() => {});
    }

    // 订阅 storage 变更（当从 Flask 后端加载完成时自动更新 UI）
    const unsubscribeRecords = storage.subscribe((newRecords) => {
      setRecords(newRecords);
    });

    const unsubscribeSettings = storage.subscribeSettings((newSettings, changedKeys) => {
      if (typeof newSettings.isSoundMuted === 'boolean') {
        setIsSoundMuted(newSettings.isSoundMuted);
      }
      if (typeof newSettings.effectLevel === 'number') {
        setEffectLevel(newSettings.effectLevel);
      }
      if (newSettings.floatingButtonsMode) {
        setFloatingMode(newSettings.floatingButtonsMode);
      }
      if (typeof newSettings.showHomeScrollbar === 'boolean') {
        setShowHomeScrollbar(newSettings.showHomeScrollbar);
      }
      if (typeof newSettings.homeScrollbarWidth === 'number') {
        setHomeScrollbarWidth(newSettings.homeScrollbarWidth);
      }
      if (newSettings.searchFilterPosition === 'position1' || newSettings.searchFilterPosition === 'position2') {
        setSearchFilterPosition(newSettings.searchFilterPosition);
      }
      if (newSettings.statsLayoutMode === 'merged' || newSettings.statsLayoutMode === 'separate') {
        setStatsLayoutMode(newSettings.statsLayoutMode);
      }
      // 只有「图号这个设置本身被改动」（changedKeys 里有 activeStageNum）才跟随；
      // changedKeys 为空表示跨窗口 storage 事件 / 云端同步这类无法辨别具体键的场景，
      // 此时退化为「值确实变了才跟随」，避免无关设置变化把旧图号盖回来。
      const stage = newSettings.activeStageNum;
      if (typeof stage === 'number' && [1, 2, 3].includes(stage)) {
        const explicit = !!changedKeys?.includes('activeStageNum');
        const changed = stage !== syncedStageRef.current;
        if (explicit || changed) {
          syncedStageRef.current = stage;
          setActiveStageNum(stage);
          // activeStageNum 变化不再触发特效，避免扫描识别后弹出特效
        }
      }
    });

    // 监听跨窗口/标签页的通信（BroadcastChannel, window.message, window.storage）
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'SWITCH_MAP' && event.data?.mapNum) {
        const num = Number(event.data.mapNum);
        if ([1, 2, 3].includes(num)) {
          setActiveStageNum(num);
          // SWITCH_MAP 不再触发特效，避免扫描识别后弹出特效
        }
      }
      if (event.data?.type === 'SCAN_TRIGGERED') {
        // 立即识别不再触发特效，特效已移至点亮图鉴按钮
      }
    };
    window.addEventListener('message', handleMessage);

    const handleStorageEvent = (event: StorageEvent) => {
      // 兼容旧版本写入的 localStorage 键 roco_active_map_num（新键为 roco_active_stage_num）
      if ((event.key === 'roco_active_stage_num' || event.key === 'roco_active_map_num') && event.newValue) {
        const num = Number(event.newValue);
        if ([1, 2, 3].includes(num)) {
          setActiveStageNum(num);
          // SWITCH_MAP 不再触发特效，避免扫描识别后弹出特效
        }
      }
      if (event.key === 'roco_scan_trigger') {
        // 立即识别不再触发特效，特效已移至点亮图鉴按钮
      }
    };
    window.addEventListener('storage', handleStorageEvent);

    let bc: BroadcastChannel | null = null;
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      bc = new BroadcastChannel('roco_channel');
      bc.onmessage = (event) => {
        if (event.data?.type === 'SWITCH_MAP' && event.data?.mapNum) {
          const num = Number(event.data.mapNum);
          if ([1, 2, 3].includes(num)) {
            setActiveStageNum(num);
            // SWITCH_MAP 不再触发特效，避免扫描识别后弹出特效
          }
        }
        if (event.data?.type === 'SCAN_TRIGGERED') {
          // 立即识别不再触发特效，特效已移至点亮图鉴按钮
        }
      };
    }

    return () => {
      unsubscribeRecords();
      unsubscribeSettings();
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('storage', handleStorageEvent);
      if (bc) {
        bc.close();
      }
    };
  }, [refreshRecords, fetchIconsData, triggerScanSyncEffect]);

  /**
   * 窗口重新获得焦点 / 重新可见时，主动从数据源刷新一遍遇见记录。
   *
   * 背景：跟随识别窗口与主窗口各自持有一份内存副本，主窗口此前只靠
   * `roco_follow_active` 期间的轮询从后端拉数据；切回主界面（或跟随窗口被遮挡/
   * 隐藏）时可能错过最后一次点亮，表现为“跟随识别里点了遇见，主页还是未遇见，
   * 要刷新才变”。这里在重新聚焦/可见时补一次拉取，保证主页最终一致。
   *
   * - 桌面端：refreshFromSource → 拉本机后端；
   * - 纯前端静态版：refreshFromSource → 重读 localStorage。
   * 桌面端桥接（关闭跟随识别窗口前）也会调用挂在 window 上的 __rocoRefreshStorage。
   */
  useEffect(() => {
    const refreshStores = () => {
      void storage.refreshFromSource();
      void fireStorage.refreshFromSource();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshStores();
    };
    const w = window as unknown as { __rocoRefreshStorage?: () => void };
    w.__rocoRefreshStorage = refreshStores;
    window.addEventListener('focus', refreshStores);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('focus', refreshStores);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      try {
        delete w.__rocoRefreshStorage;
      } catch {
        w.__rocoRefreshStorage = undefined;
      }
    };
  }, []);

  // 监听滚动：当页面搜索行滚出 header 下方时显示悬浮搜索栏
  useEffect(() => {
    let rafId = 0;
    const update = () => {
      rafId = 0;
      const headerEl = document.querySelector('header');
      // 以「原位搜索框」为唯一锚点：它被顶部 header 遮住时，用悬浮搜索框接力
      const inputEl = document.getElementById('search-pet-input');
      if (!headerEl || !inputEl) {
        if (floatingSearchCacheRef.current.visible) {
          floatingSearchCacheRef.current.visible = false;
          setFloatingSearch((prev) => (prev.visible ? { ...prev, visible: false } : prev));
        }
        return;
      }
      // header 可能随内容滚走（sticky 受外层影响），但高度基本恒定：
      // 悬浮栏始终固定在「页面顶部往下一行 header 高度」的位置
      const headerHeight = headerEl.getBoundingClientRect().height || 56;
      const inputTop = inputEl.getBoundingClientRect().top;
      const floatingInput = document.getElementById('floating-search-pet-input');
      const floatingFocused = !!floatingInput && document.activeElement === floatingInput;
      const cache = floatingSearchCacheRef.current;
      // 带回差的显隐（只由滚动位置决定）：原位框顶部滚到 header 下沿即显示，
      // 回到 header 下方 28px 才隐藏（临界区间不抖动）；不监听 focusout，
      // 因此点击页面空白处让输入框失焦，悬浮框也不会消失；
      // 仅当正在悬浮框里输入时保持显示，避免筛选导致页面收缩把框藏掉。
      const showAt = headerHeight + 2;
      const hideAt = headerHeight + 28;
      let visible: boolean;
      if (window.scrollY <= 4 && !floatingFocused) {
        visible = false;
      } else if (cache.visible) {
        visible = floatingFocused || inputTop <= hideAt;
      } else {
        visible = floatingFocused || inputTop < showAt;
      }
      const top = headerHeight + 8;
      if (cache.visible !== visible || Math.abs(cache.top - top) > 0.5) {
        cache.visible = visible;
        cache.top = top;
        setFloatingSearch({ visible, top });
      }
    };
    const schedule = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  // 在悬浮搜索里输入时，页面筛选后高度骤降会被浏览器钳回顶部；
  // 这里在下一帧绘制前把滚动位置恢复到原来的位置（若页面仍足够高）。
  useLayoutEffect(() => {
    const captured = searchScrollCaptureRef.current;
    if (captured == null) return;
    searchScrollCaptureRef.current = null;
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const target = Math.min(captured, maxScroll);
    if (Math.abs(window.scrollY - target) > 1) {
      window.scrollTo(0, target);
    }
  }, [searchQuery, searchMode]);

  // Current Map configuration
  const currentMap: MapConfig = useMemo(() => {
    return MAP_CONFIGS.find((m) => m.num === activeStageNum) || MAP_CONFIGS[0];
  }, [activeStageNum]);

  // Current Map pets
  const currentMapPets: PetItem[] = useMemo(() => {
    const mapKey = `map${activeStageNum}`;
    return mapsData[mapKey]?.items || [];
  }, [activeStageNum, mapsData]);

  // Total count of pets across all 3 maps
  const totalAllPetsCount = useMemo(() => {
    let total = 0;
    activeTrialMaps.forEach((m) => {
      const k = m.id;
      const items = mapsData[k]?.items || [];
      total += items.length;
    });
    return total;
  }, [mapsData, activeTrialMaps]);

  // Total encountered pets count across all maps
  const totalEncounteredCount = useMemo(() => {
    let total = 0;
    activeTrialMaps.forEach((m) => {
      const k = m.id;
      const items = mapsData[k]?.items || [];
      total += items.filter((p) => isPetEncounteredInRecords(records, k, p.name)).length;
    });
    return total;
  }, [mapsData, records, activeTrialMaps]);

  // Per-map stats for 3 maps
  const allMapsStats = useMemo(() => {
    return MAP_CONFIGS.map((map) => {
      const list = mapsData[map.id]?.items || [];
      const stats = storage.getMapStats(map.id, list.length, list);
      return {
        num: map.num,
        id: map.id,
        name: map.name.replace('记忆中的', ''),
        encountered: stats.encounteredCount,
        total: list.length,
      };
    });
  }, [mapsData, records]);

  // Current map stats
  const currentMapStats = useMemo(() => {
    return storage.getMapStats(currentMap.id, currentMapPets.length, currentMapPets);
  }, [currentMap.id, currentMapPets, records]);

  // 大图鉴（每张地图数百只精灵）切换时，网格重建是重活：
  // 把当前图号做成延迟值，Header 胶囊/计数立即响应（紧急更新），
  // 识别卡与网格跟随延迟值在低优先级过渡中渲染，避免阻塞胶囊滑动动画。
  const deferredStageNum = useDeferredValue(activeStageNum);
  const deferredMap: MapConfig = useMemo(() => {
    return MAP_CONFIGS.find((m) => m.num === deferredStageNum) || MAP_CONFIGS[0];
  }, [deferredStageNum]);
  const deferredMapPets: PetItem[] = useMemo(() => {
    return mapsData[`map${deferredStageNum}`]?.items || [];
  }, [deferredStageNum, mapsData]);
  const deferredMapStats = useMemo(() => {
    return storage.getMapStats(deferredMap.id, deferredMapPets.length, deferredMapPets);
  }, [deferredMap.id, deferredMapPets, records]);

  // Check if a specific pet is encountered
  const isPetEncountered = useCallback(
      (mapId: string, filename: string) => {
        return isPetEncounteredInRecords(records, mapId, filename);
      },
      [records]
  );

  // Handle Encounter Success (via Image Recognition or Manual Confirmation)
  const handleEncounterSuccess = (mapId: string, filename: string, note?: string) => {
    const isAlreadyEnc = isPetEncountered(mapId, filename);
    storage.markEncountered(mapId, filename, note);
    refreshRecords();
    setRecognizerKey((prev) => prev + 1);
    if (!isAlreadyEnc) {
      sound.playEncounter();
      triggerScanSyncEffect('encounter', undefined, '图鉴已成功点亮');
    }
  };

  // Toggle Encounter (from grid click / history / global search)
  const handleToggleEncounter = (mapId: string, filename: string) => {
    // 抓包中禁止手动点亮/取消（会和同步互相覆盖）
    if (isCaptureLive()) {
      triggerScanSyncEffect('info', undefined, CAPTURE_CONFLICT_MSG);
      return;
    }
    const isCurrentlyEncountered = isPetEncountered(mapId, filename);
    storage.toggleEncountered(mapId, filename, '手动');
    refreshRecords();
    if (!isCurrentlyEncountered) {
      sound.playEncounter();
      triggerScanSyncEffect('encounter', undefined, '已记录为已遇见');
    } else {
      sound.playToggleOff();
      triggerScanSyncEffect('unencounter', undefined, '已恢复为未遇见');
    }
  };

  // 详情弹窗内的点亮/取消（弹窗自己播放音效与动效，这里只落库刷新）
  const handleDetailToggleEncounter = (mapId: string, filename: string) => {
    storage.toggleEncountered(mapId, filename, '详情页点亮图鉴');
    refreshRecords();
  };

  // 详情弹窗内修改备注（弹窗自己播放音效，这里只落库刷新）
  const handleDetailUpdateNote = (mapId: string, filename: string, note: string) => {
    storage.updateNote(mapId, filename, note);
    refreshRecords();
  };

  /**
   * 抓包数据 → 本机图鉴的「静默同步」。
   *
   * 没有任何按钮、也没有提示：只要抓包在跑、试炼数据发生变化（重新打开精灵足迹、
   * 刷新三选一、推进节点……），就把三张图的足迹与当前三选一写进本机记录。
   * 关闭插件 / 停止抓包后自动停止，界面与操作完全不受影响。
   */
  const trialSig = useMemo(() => trialSignature(trial), [trial]);
  const lastSyncedSigRef = useRef<string>('');
  useEffect(() => {
    if (!syncPlugin || !trialSig || !trialRunning) return;
    if (trialSig === lastSyncedSigRef.current) return;
    // 数据抖动（连续几条包）时只同步最后一次
    const timer = setTimeout(async () => {
      try {
        const res = await runTrialSync('grass', mapsData);
        lastSyncedSigRef.current = trialSig;
        if (res.summary && (res.summary.marked > 0 || res.summary.unmarked > 0)) {
          refreshRecords();
          setRecognizerKey((prev) => prev + 1);
        }
      } catch {
        /* 静默：同步失败不打扰用户 */
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [trialSig, trialRunning, syncPlugin, refreshRecords]);

  /**
   * 「游戏画面识别」卡片标题行上的「同步」按钮：手动触发一次抓包同步。
   * 平时数据变化会静默自动同步，这个按钮只是给用户一个"立刻同步 / 确认"的入口。
   */
  const handleTrialSync = useCallback(async () => {
    setSyncing(true);
    try {
      const res = await runTrialSync('grass', mapsData, { manual: true });
      if (!res.summary) {
        triggerScanSyncEffect('info', undefined, '没有可同步的抓包数据');
        return;
      }
      refreshRecords();
      setRecognizerKey((prev) => prev + 1);
      triggerScanSyncEffect(
          'encounter',
          undefined,
          `抓包同步完成：点亮 ${res.summary.marked} 只`,
          res.summary.unmarked > 0 ? `并对齐取消了 ${res.summary.unmarked} 只` : undefined,
      );
    } catch (err) {
      triggerScanSyncEffect('info', undefined, '同步失败', (err as Error).message);
    } finally {
      setSyncing(false);
    }
  }, [refreshRecords, triggerScanSyncEffect]);

  // Reset Encounters for Current Map（mapId 可显式传入，配合延迟渲染的网格）
  const handleResetCurrentMap = (mapId?: string) => {
    storage.resetMap(mapId ?? currentMap.id);
    refreshRecords();
    sound.playToggleOff();
    triggerScanSyncEffect('unencounter', undefined, '已重置当前关卡图鉴状态');
  };

  const handleToggleSound = () => {
    const muted = sound.toggleMute();
    setIsSoundMuted(muted);
    storage.setSetting('isSoundMuted', muted);
  };

  const handleOpenManualSelect = (predictRes: PredictResult | null) => {
    setPredictResultForManual(predictRes);
    setIsManualSelectOpen(true);
  };

  // Handle Batch Encounter Success
  const handleBatchEncounterSuccess = (
      items: Array<{ mapId: string; filename: string; note?: string }>
  ) => {
    storage.batchMarkEncountered(items);
    refreshRecords();
    sound.playEncounter();
    triggerScanSyncEffect('encounter', undefined, `已批量点亮 ${items.length} 只精灵`);
  };

  // Handle Global Search Navigate & Scroll to pet
  const handleNavigateToPet = (mapNum: number, petName: string) => {
    setActiveStageNum(mapNum);
    setIsGlobalSearchOpen(false);

    // Allow DOM update after switching active map, then scroll and highlight
    setTimeout(() => {
      const targetMap = MAP_CONFIGS.find((m) => m.num === mapNum);
      if (!targetMap) return;
      const elementId = `pet-card-${targetMap.id}-${petName.replace('.', '-')}`;
      const el = document.getElementById(elementId);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('highlight-pet-target');
        setTimeout(() => {
          el.classList.remove('highlight-pet-target');
        }, 2500);
      }
    }, 150);
  };

  /**
   * 打开插件：声明 fullscreen 的走整页，其余仍用插件中心弹窗里的内嵌界面。
   *
   * ⚠ 必须用 useCallback：这个函数会作为 prop 传给 PluginCenterModal，
   * 而弹窗里「打开时刷新一次」的 useEffect 依赖它 —— 一旦它每次渲染都换新引用，
   * 就会变成「effect → setPlugins → App 重渲染 → 新函数 → effect…」的无限循环，
   * 表现就是插件中心在疯狂调用「检查更新」。
   */
  const openPlugin = useCallback((plugin: PluginInfo) => {
    setIsPluginCenterOpen(false);
    setPluginToOpen(null);
    if (plugin.fullscreen) setPluginPage(plugin);
    else { setPluginToOpen(plugin.id); setIsPluginCenterOpen(true); }
  }, []);

  const closePluginPage = useCallback(() => setPluginPage(null), []);

  /** 右下角悬浮入口：打开被固定的插件 */
  const openPinned = useCallback((id: string) => {
    const p = plugins.find((x) => x.id === id);
    if (!p) return;
    setIsPluginCenterOpen(false);
    setPluginToOpen(null);
    if (p.fullscreen) setPluginPage(p);
    else { setPluginToOpen(p.id); setIsPluginCenterOpen(true); }
  }, [plugins]);

  // 整页插件的 iframe 通过 postMessage 跟主程序通信：
  //   roco-plugin-close → 收起整页；roco-plugin-pin → 固定/取消固定到右下角
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const data = e.data as { type?: string; plugin?: string; label?: string; pinned?: boolean } | null;
      if (!data) return;
      if (data.type === 'roco-plugin-close') { setPluginPage(null); return; }
      if (data.type === 'roco-plugin-pin' && data.plugin) {
        setPinnedPlugins((prev) => {
          const next = data.pinned
            ? [...prev.filter((x) => x.id !== data.plugin), { id: data.plugin as string, label: data.label || '插件' }]
            : prev.filter((x) => x.id !== data.plugin);
          try { storage.setSetting('pinnedPlugins', next); } catch { /* ignore */ }
          return next;
        });
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  const fireTrialAvailable = trials.some((t) => t.key === 'fire');

  if (pluginPage) {
    return <PluginPage plugin={pluginPage} onClose={closePluginPage} />;
  }

  if (view === 'assistant' && activeTrialKey === 'fire' && fireTrialAvailable) {
    return (
        <FireBadgeTrial
            maps={activeTrialMaps}
            onBack={() => {
              setActiveTrialKey('grass');
              setView('hub');
            }}
        />
    );
  }

  return (
      <div className="min-h-screen flex flex-col selection:bg-sky-200 selection:text-sky-900 pb-12 relative">
        {/* Sleek Commercial Feedback Pop Notification & Confetti */}
        <SyncPopNotification
            isVisible={syncPopState.isVisible}
            message={syncPopState.message}
            subMessage={syncPopState.subMessage}
            level={activeEffectLevel}
            type={syncPopState.type}
        />

        {/* Top Header with Settings Button */}
        <Header
            modalActive={isAnyModalOpen}
            activeStageNum={activeStageNum}
            onSelectMap={(num) => setActiveStageNum(num)}
            mapsStats={allMapsStats}
            totalEncountered={totalEncounteredCount}
            totalPetsCount={totalAllPetsCount}
            isSoundMuted={isSoundMuted}
            onToggleSound={handleToggleSound}
            onOpenHistory={() => setIsHistoryOpen(true)}
            onOpenManual={() => setIsManualOpen(true)}
            onOpenFeedback={IS_STATIC ? undefined : () => setIsFeedbackOpen(true)}
            onOpenUpdate={IS_STATIC ? undefined : () => {
              updateStore.clearDot();
              setIsUpdateOpen(true);
            }}
            onOpenDownloadApp={IS_STATIC ? () => setIsDownloadOpen(true) : undefined}
            onOpenSettings={() => setIsSettingsOpen(true)}
            onOpenHub={() => {
              // 先归零滚动，避免切换后内容高度变化导致浏览器夹回滚动位置产生跳动
              window.scrollTo(0, 0);
              setView((v) => (v === 'hub' ? 'assistant' : 'hub'));
            }}
            showMapNav={view === 'assistant'}
            mapsConfig={activeTrialMaps}
            mapNavDisabled={isBatchScanning}
            rightStatus={IS_STATIC ? undefined : <AuthBadge />}
        />

        {/* 首页自定义滚动条（设置里开启后显示，始终位于 Header 下方，不触及 Header） */}
        <HomeScrollbar visible={showHomeScrollbar && !isAnyModalOpen} width={homeScrollbarWidth} />

        {/* Sub-Header Toolbar: Displayed only when floating buttons are in 'hidden' mode */}
        {view === 'assistant' && floatingMode === 'hidden' && (
            <>
            <SubHeaderToolbar
                onOpenPluginCenter={IS_STATIC ? undefined : () => { setPluginToOpen(null); setIsPluginCenterOpen(true); }}
                filterMode={filterMode}
                onFilterChange={(mode) => setFilterMode(mode)}
                encounteredCount={currentMapStats.encounteredCount}
                totalCount={currentMapPets.length}
                showFollow={!IS_STATIC}
                onOpenDataManage={() => setIsDataManageOpen(true)}
                onOpenGlobalSearch={() => setIsGlobalSearchOpen(true)}
            />
            {/* 悬浮按钮隐藏时：右下角仍保留独立的「回到顶部」 */}
            <BackToTopStandalone bottomClass={floatingBottomClass} />
            </>
        )}

        {/* Main Content Area */}
        <main className="flex-1 w-full mx-auto px-3 sm:px-8 lg:px-16 pt-4 sm:pt-6">
          {view === 'hub' ? (
              <AssistantHub
                  trials={trials}
                  plugins={plugins}
                  onOpenPluginCenter={IS_STATIC ? undefined : () => setIsPluginCenterOpen(true)}
                  onOpenPlugin={(plugin) => openPlugin(plugin)}
                  onSelectAssistant={(trialKey) => {
                    if (trialKey === 'merchant') {
                      setIsMerchantSubscriptionOpen(true);
                      return;
                    }
                    window.scrollTo(0, 0);
                    setActiveTrialKey(trialKey === 'fire' ? 'fire' : 'grass');
                    setView('assistant');
                  }}
              />
          ) : (
              <>
                {/* 经典版（separate）：顶部独立统计栏；合并版（merged，默认）已把这些信息并入 PetGrid 标题区 */}
                {statsLayoutMode === 'separate' && (
                  <div ref={statsBannerWrapRef}>
                  <StatsBanner
                      currentMap={deferredMap}
                      encounteredCount={deferredMapStats.encounteredCount}
                      totalMapPets={deferredMapPets.length}
                      pets={deferredMapPets}
                      searchMode={searchMode}
                      onSearchModeChange={handleSearchModeChange}
                      percentage={deferredMapStats.percentage}
                      filterMode={filterMode}
                      onFilterChange={(mode) => setFilterMode(mode)}
                      searchQuery={searchQuery}
                      onSearchChange={handleSearchChange}
                      onResetEncounters={() => handleResetCurrentMap(deferredMap.id)}
                      onOpenDataUpdate={() => setIsDataUpdateOpen(true)}
                      dataUpdateAvailable={dataUpdateAvailable}
                      advancedFilters={advancedFilters}
                      onAdvancedFilterChange={(filters) => setAdvancedFilters(filters)}
                      searchFilterPosition={searchFilterPosition}
                      hideSearchInput={floatingSearch.visible}
                  />
                  </div>
                )}

                {/* Pet Image Recognition Module (BatchRecognizerCard: 首页单图识别；纯前端走浏览器内 LocalRecognizer) */}
                <BatchRecognizerCard
                        key={`${deferredMap.id}_${recognizerKey}`}
                        currentMap={deferredMap}
                        trialKey={activeTrialKey}
                        allMapsPets={mapsData}
                        records={records}
                        isEncountered={isPetEncountered}
                        onBatchEncounterSuccess={handleBatchEncounterSuccess}
                        onSelectMap={(num) => setActiveStageNum(num)}
                        onScanningChange={setIsBatchScanning}
                        // 只要装了「带同步能力的插件」就显示同步按钮；还没抓到数据时置灰 + 「!」提示，
                        // 告诉用户去游戏里打开一次精灵足迹。没插件则完全不显示。
                        onSyncTrial={syncPlugin ? handleTrialSync : undefined}
                        syncTrialReady={Boolean(trial?.available)}
                        syncLive={trialRunning}
                        syncTrialBusy={syncing}
                        captureLive={Boolean(syncPlugin && trialRunning)}
                    />

                {/* Map Pets Grid（跟随延迟图号，切换时不阻塞头部动画） */}
                <div ref={petGridWrapRef} className={searchQuery.trim() ? 'min-h-[80vh]' : undefined}>
                <PetGrid
                    currentMap={deferredMap}
                    pets={deferredMapPets}
                    records={records}
                    onToggleEncounter={handleToggleEncounter}
                    filterMode={filterMode}
                    onFilterChange={(mode) => setFilterMode(mode)}
                    searchQuery={searchQuery}
                    searchMode={searchMode}
                    onOpenPetDetail={(pet) => setDetailPet(pet)}
                    onOpenFeedback={IS_STATIC ? undefined : (type) => {
                      setFeedbackInitialType(type);
                      setIsFeedbackOpen(true);
                    }}
                    advancedFilters={advancedFilters}
                    searchFilterPosition={searchFilterPosition}
                    statsLayoutMode={statsLayoutMode}
                    percentage={deferredMapStats.percentage}
                    onResetEncounters={() => handleResetCurrentMap(deferredMap.id)}
                    dataUpdateAvailable={dataUpdateAvailable}
                    onOpenDataUpdate={() => setIsDataUpdateOpen(true)}
                    hideSearchInput={floatingSearch.visible}
                    onSearchChange={handleSearchChange}
                    onSearchModeChange={handleSearchModeChange}
                    onAdvancedFilterChange={(filters) => setAdvancedFilters(filters)}
                />
                </div>
              </>
          )}
        </main>

        {/* 下滑浏览搜索结果时：搜索框悬浮固定在 header 下方（丝滑滑入/淡出） */}
        {view === 'assistant' && (
            <div
                aria-hidden={!floatingSearch.visible}
                className={`fixed left-0 right-0 z-40 px-3 sm:px-6 transition-[opacity,transform] duration-300 ease-out will-change-transform ${
                    floatingSearch.visible
                        ? 'translate-y-0 opacity-100'
                        : '-translate-y-3 opacity-0 pointer-events-none invisible'
                }`}
                style={{ top: floatingSearch.top }}
            >
              <div className="mx-auto w-full max-w-3xl">
                <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-[#7ABCF4]/60 dark:border-slate-700 rounded-2xl shadow-lg p-2">
                  <PetSearchBox
                      pets={currentMapPets}
                      searchQuery={searchQuery}
                      searchMode={searchMode}
                      onSearchChange={handleSearchChange}
                      onSearchModeChange={handleSearchModeChange}
                      containerClassName="relative w-full"
                      inputId="floating-search-pet-input"
                  />
                </div>
              </div>
            </div>
        )}

        {/* Footer */}
        <footer className="mt-12 text-center text-xs text-slate-400">
          <p>洛克王国徽章试炼 · 精灵图鉴识别 · 支持本地离线存储</p>
          {IS_STATIC && SHOW_WEB_ICP_FILING && (
              <p className="mt-1.5">
                <a
                    href="https://beian.miit.gov.cn/"
                    target="_blank"
                    rel="noreferrer noopener"
                    className="hover:text-slate-600"
                >
                  湘ICP备2021012842号-1
                </a>
              </p>
          )}
        </footer>

        {/* Modals */}
        {/* 1. Single Pet Recognizer Modal */}
        <SinglePetRecognizerModal
            isOpen={isSingleRecognizerOpen}
            onClose={() => setIsSingleRecognizerOpen(false)}
            currentMap={currentMap}
            allMapsPets={mapsData}
            records={records}
            onEncounterSuccess={handleEncounterSuccess}
            onOpenManualSelect={handleOpenManualSelect}
            isEncountered={isPetEncountered}
        />

        {/* 2. Batch Recognition Modal */}
        <BatchInitModal
            isOpen={isBatchInitOpen}
            onClose={() => setIsBatchInitOpen(false)}
            currentMap={currentMap}
            allMapsPets={mapsData}
            records={records}
            isEncountered={isPetEncountered}
            onBatchEncounterSuccess={handleBatchEncounterSuccess}
        />

        {/* 3. Manual Pet Selection Modal */}
        <ManualSelectModal
            isOpen={isManualSelectOpen}
            onClose={() => setIsManualSelectOpen(false)}
            currentMap={currentMap}
            pets={currentMapPets}
            predictResult={predictResultForManual}
            records={records}
            isEncountered={isPetEncountered}
            onConfirmSelection={handleEncounterSuccess}
        />

        {/* 4. App Settings Modal (Effect Levels & Floating Buttons Mode) */}
        <MerchantSubscriptionModal
            isOpen={isMerchantSubscriptionOpen}
            onClose={() => setIsMerchantSubscriptionOpen(false)}
        />

        <AppSettingsModal
            isOpen={isSettingsOpen}
            onClose={() => setIsSettingsOpen(false)}
            onTestEffect={(level, type) => triggerScanSyncEffect(type, level)}
            onOpenDataUpdate={IS_STATIC ? undefined : () => setIsDataUpdateOpen(true)}
        />


        {/* Floating Filter Switch on the bottom left */}
        {view === 'assistant' && (
            <FloatingFilterSwitch
                currentMap={currentMap}
                pets={currentMapPets}
                records={records}
                filterMode={filterMode}
                onFilterChange={(mode) => setFilterMode(mode)}
                onCycleMap={() => {
                  setActiveStageNum((prev) => (prev % MAP_CONFIGS.length) + 1);
                }}
                mapsConfig={activeTrialMaps}
                mapSwitchDisabled={isBatchScanning}
                advancedFilters={advancedFilters}
                onAdvancedFilterChange={(filters) => setAdvancedFilters(filters)}
            />
        )}

        {/* Global Floating Actions Component on the bottom right（单个识别/批量导入已整合进首页识别，不再重复展示） */}
        {view === 'assistant' && floatingMode !== 'hidden' && (
            <GlobalFloatingSearch
                bottomClass={floatingBottomClass}
                pinnedPlugins={pinnedPlugins.map((x) => ({ ...x, icon: plugins.find((p) => p.id === x.id)?.icon }))}
                onOpenPinned={openPinned}
                onOpenPluginCenter={IS_STATIC ? undefined : () => { setPluginToOpen(null); setIsPluginCenterOpen(true); }}
                isOpen={isGlobalSearchOpen}
                onOpenChange={(open) => setIsGlobalSearchOpen(open)}
                allMapsPets={mapsData}
                records={records}
                onNavigateToPet={handleNavigateToPet}
                onToggleEncounter={handleToggleEncounter}
                searchOnly={IS_STATIC}
                onOpenDataManage={() => setIsDataManageOpen(true)}
                mapsConfig={activeTrialMaps}
                followTrialKey={activeTrialKey === 'fire' ? 'fire' : 'grass'}
            />
        )}

        {/* Feedback and Contact QQ Group Modal */}
        <FeedbackContactModal
            isOpen={isFeedbackOpen}
            onClose={() => setIsFeedbackOpen(false)}
            initialType={feedbackInitialType}
        />

        {/* Encounter History Modal */}
        <EncounterHistoryModal
            isOpen={isHistoryOpen}
            onClose={() => setIsHistoryOpen(false)}
            records={records}
            allMapsPets={mapsData}
            mapsConfig={activeTrialMaps}
            onToggleEncounter={handleToggleEncounter}
            onNavigateToPet={handleNavigateToPet}
        />

        {/* User Manual Modal */}
        {/*<UserManualModal*/}
        {/*    isOpen={isManualOpen}*/}
        {/*    onClose={() => setIsManualOpen(false)}*/}
        {/*/>*/}

        {/* 精灵详情弹窗（右键菜单进入） */}
        <PetDetailModal
            isOpen={detailPet !== null}
            onClose={() => setDetailPet(null)}
            pet={detailPet}
            currentMap={currentMap}
            record={detailPet ? storage.getRecord(currentMap.id, detailPet.name) : undefined}
            onToggleEncounter={handleDetailToggleEncounter}
            onUpdateNote={handleDetailUpdateNote}
        />

        {/* Check Update Modal */}
        <UpdateModal
            isOpen={isUpdateOpen}
            onClose={() => setIsUpdateOpen(false)}
        />

        {/* 下载桌面APP弹窗（web 版专用） */}
        <DownloadAppModal
            isOpen={isDownloadOpen}
            onClose={() => setIsDownloadOpen(false)}
        />

        {/* 数据管理弹窗（web 版：导入/导出） */}
        <DataManageModal
            isOpen={isDataManageOpen}
            onClose={() => setIsDataManageOpen(false)}
        />

        {/* 图鉴数据更新弹窗 */}
        <DataUpdateModal
            isOpen={isDataUpdateOpen}
            onClose={() => setIsDataUpdateOpen(false)}
            onUpdated={() => {
              setDataUpdateAvailable(false);
              // 重新拉取图鉴数据，让新下载的数据立即生效
              fetchIconsData();
              invalidateFireTrialData();
            }}
        />
        {/* 插件中心：导入 / 管理插件 */}
        <PluginCenterModal
            isOpen={isPluginCenterOpen}
            initialPluginId={pluginToOpen}
            onOpenFullscreen={openPlugin}
            pinnedIds={pinnedPlugins.map((x) => x.id)}
            onTogglePin={(plugin) => setPinnedPlugins((prev) => {
              const has = prev.some((x) => x.id === plugin.id);
              const next = has ? prev.filter((x) => x.id !== plugin.id)
                : [...prev, { id: plugin.id, label: plugin.id === 'roco.breed_planner' ? '生蛋规划器' : plugin.title }];
              try { storage.setSetting('pinnedPlugins', next); } catch { /* ignore */ }
              return next;
            })}
            onClose={() => { setIsPluginCenterOpen(false); setPluginToOpen(null); }}
            onPluginsChanged={setPlugins}
        />

      </div>
  );
}
