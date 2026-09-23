import React, { useState, useMemo, useEffect, useRef, useId, useCallback } from 'react';
import { Sparkles, Check, Info, Bug, RotateCcw, MapPin, ArrowUpCircle } from 'lucide-react';
import { MapConfig, PetItem, EncounterRecord, AdvancedFilterState, SearchFilterPosition, StatsLayoutMode } from '../types';
import { sound } from '../services/sound';
import { IS_STATIC } from '../services/staticMode';
import { formatPetName, isPetEncounteredInRecords, getBasePetName, getPetSpecialType } from '../utils/petHelper';
import { PetSearchMode, petMatchesSkillQuery } from '../utils/skillSearch';
import { ElementBadges } from './ElementBadges';
import { PetSprite } from './PetSprite';
import { PetSkillPanel } from './PetSkillPanel';
import { petKeyOf } from '../services/atlasCollector';
import { storage } from '../services/storage';
import { SearchFilterToolbar } from './SearchFilterToolbar';
import { ConfirmDialog } from './ConfirmDialog';
import { PetCard, PetCardCommunityInfo } from './PetCard';

// merged 标题区环形进度环参数（46px 外环，中心显示百分比）
const PROGRESS_RING_SIZE = 46;
const PROGRESS_RING_STROKE = 4.5;
const PROGRESS_RING_RADIUS = (PROGRESS_RING_SIZE - PROGRESS_RING_STROKE) / 2;
const PROGRESS_RING_CIRC = 2 * Math.PI * PROGRESS_RING_RADIUS;

interface PetGridProps {
  currentMap: MapConfig;
  pets: PetItem[];
  records: Record<string, EncounterRecord>;
  onToggleEncounter: (mapId: string, filename: string) => void;
  filterMode: 'all' | 'encountered' | 'unencountered';
  onFilterChange?: (mode: 'all' | 'encountered' | 'unencountered') => void;
  searchQuery: string;
  /** 搜索模式：'name'=精灵名/图鉴id（默认），'skill'=技能/特性搜索。 */
  searchMode?: PetSearchMode;
  onOpenPetDetail?: (pet: PetItem) => void;
  onOpenFeedback?: (type: string, pet: PetItem) => void;
  advancedFilters: AdvancedFilterState;
  /** 搜索/筛选位置：position2 时显示在 PetGrid 标题栏右侧。 */
  searchFilterPosition?: SearchFilterPosition;
  /** 地图信息栏布局：merged=地图信息/进度卡并入本组件标题区（默认）| separate=顶部独立 StatsBanner 经典版。 */
  statsLayoutMode?: StatsLayoutMode;
  /** 遇见进度百分比（merged 模式进度卡使用；缺省时按已遇见/总数现算）。 */
  percentage?: number;
  /** merged 模式：清空当前地图遇见记录（提供后进度卡显示「重置记录」并弹确认框）。 */
  onResetEncounters?: () => void;
  /** merged 模式：图鉴数据库有更新时显示提示条。 */
  dataUpdateAvailable?: boolean;
  /** merged 模式：点击「前往更新」。 */
  onOpenDataUpdate?: () => void;
  /** 顶部悬浮搜索栏出现时，隐藏原位搜索框（避免重复）。 */
  hideSearchInput?: boolean;
  onSearchChange?: (query: string) => void;
  onSearchModeChange?: (mode: PetSearchMode) => void;
  onAdvancedFilterChange?: (filters: AdvancedFilterState) => void;
  /** 开荒图鉴：按展示名 -> 社区数据（含赞同率 / 我是否已投）。 */
  communityAtlas?: Record<string, {
    confirmed_by: number;
    confidence: number;
    agree_ratio?: number;
    my_vote?: 'agree' | 'disagree' | 'none';
  }>;
  /** 只显示社区赞同率 >= 该值的精灵（0 表示不过滤）。 */
  minAgreeRatio?: number;
  /** 对社区图鉴条目投票（agree / disagree）。 */
  onAtlasVote?: (mapId: string, petKey: string, petName: string, type: 'agree' | 'disagree') => void;
  /** 共创图鉴卡片布局（火系专用）：头部行（系别图标+#编号）吃进立绘容器；默认 false 保持草系经典叠加布局。 */
  communityCard?: boolean;
}

export const PetGrid: React.FC<PetGridProps> = ({
  currentMap,
  pets,
  records,
  onToggleEncounter,
  filterMode,
  onFilterChange,
  searchQuery,
  searchMode = 'name',
  onOpenPetDetail,
  onOpenFeedback,
  advancedFilters,
  searchFilterPosition = 'position2',
  statsLayoutMode = 'merged',
  percentage: percentageProp,
  onResetEncounters,
  dataUpdateAvailable = false,
  onOpenDataUpdate,
  hideSearchInput = false,
  onSearchChange,
  onSearchModeChange,
  onAdvancedFilterChange,
  communityAtlas,
  minAgreeRatio = 0,
  onAtlasVote,
  communityCard = false,
}) => {
  // Track keys of pets that were just toggled to encountered / unencountered
  const [animatingKeys, setAnimatingKeys] = useState<Record<string, boolean>>({});
  const [unanimatingKeys, setUnanimatingKeys] = useState<Record<string, boolean>>({});
  const [contextMenu, setContextMenu] = useState<{ pet: PetItem; x: number; y: number } | null>(null);
  // merged 模式：清空当前地图遇见记录的确认框
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState<boolean>(false);
  // merged 模式进度环渐变 id（页面可能同时挂多个 PetGrid，必须唯一）
  const progressRingId = useId().replace(/[^a-zA-Z0-9]/g, '');
  const [showSkillHover, setShowSkillHover] = useState<boolean>(() => storage.getSetting<boolean>('showPetSkillHover', true));

  // 智能悬浮面板位置状态
  const [hoveredPet, setHoveredPet] = useState<{
    pet: PetItem;
    x: number;
    y: number;
    placement: 'left' | 'right';
    placementY: 'top' | 'bottom';
  } | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 卡片回调通过 ref 读取最新 props，配合 React.memo 的 PetCard 保证所有卡片回调身份恒定
  const latestRef = useRef({ currentMapId: currentMap.id, onToggleEncounter, onOpenPetDetail, onOpenFeedback, onAtlasVote });
  latestRef.current = { currentMapId: currentMap.id, onToggleEncounter, onOpenPetDetail, onOpenFeedback, onAtlasVote };
  const showSkillHoverRef = useRef(showSkillHover);
  showSkillHoverRef.current = showSkillHover;

  const totalCount = pets.length;
  // merged 模式下 StatsBanner 已消失，搜索/筛选栏固定渲染在标题区；separate 经典版仅 position2 渲染在此
  const showSearchFilterToolbar = Boolean(
    onSearchChange && onSearchModeChange && onAdvancedFilterChange &&
    (statsLayoutMode === 'merged' || searchFilterPosition === 'position2'),
  );

  useEffect(() => {
    const unsub = storage.subscribeSettings((settings) => {
      if (typeof settings.showPetSkillHover === 'boolean') {
        setShowSkillHover(settings.showPetSkillHover);
      }
    });
    return unsub;
  }, []);

  // 悬浮显示（设定 380ms 适当防抖等待，避免滑过即闪烁）与鼠标移开即刻消失
  const handleCardMouseEnter = useCallback((e: React.MouseEvent<HTMLDivElement>, pet: PetItem) => {
    if (!showSkillHoverRef.current) return;
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    const rect = e.currentTarget.getBoundingClientRect();
    const placement = rect.right + 330 > window.innerWidth ? 'left' : 'right';
    const placementY = rect.top + 260 > window.innerHeight ? 'bottom' : 'top';
    const x = placement === 'right' ? rect.right + 10 : rect.left - 10;
    const y = placementY === 'bottom' ? rect.bottom : rect.top;

    hoverTimerRef.current = setTimeout(() => {
      setHoveredPet({ pet, x, y, placement, placementY });
    }, 380);
  }, []);

  const handleCardMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    // 鼠标移出卡片，立即清空消失，绝不滞留
    setHoveredPet(null);
  }, []);

  // 右键菜单（卡片自身的 React.memo 要求回调身份恒定）
  const handleCardContext = useCallback((e: React.MouseEvent<HTMLDivElement>, pet: PetItem) => {
    e.preventDefault();
    e.stopPropagation();
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    setHoveredPet(null);
    setContextMenu({ pet, x: e.clientX, y: e.clientY });
  }, []);

  const handleOpenDetail = useCallback((pet: PetItem) => {
    latestRef.current.onOpenPetDetail?.(pet);
  }, []);

  const handleVote = useCallback((mapId: string, petKey: string, petName: string, type: 'agree' | 'disagree') => {
    latestRef.current.onAtlasVote?.(mapId, petKey, petName, type);
  }, []);

  // 右键菜单：点击其他位置或按 ESC 关闭
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('click', close);
    window.addEventListener('contextmenu', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('contextmenu', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [contextMenu]);
  const encounteredCount = useMemo(() => {
    return pets.filter((p) => isPetEncounteredInRecords(records, currentMap.id, p.name)).length;
  }, [pets, records, currentMap.id]);
  const unencounteredCount = Math.max(0, totalCount - encounteredCount);
  const percentage = percentageProp ?? (totalCount > 0 ? Math.round((encounteredCount / totalCount) * 100) : 0);
  const mapEmoji = currentMap.num === 1 ? '🌿' : currentMap.num === 2 ? '🗿' : currentMap.num === 3 ? '🌱' : '🔥';

  const handleCardClick = useCallback((petName: string, currentlyEncountered: boolean) => {
    const { currentMapId, onToggleEncounter: toggle } = latestRef.current;
    const key = `${currentMapId}_${petName}`;

    if (!currentlyEncountered) {
      // 未遇见 -> 遇见
      setAnimatingKeys((prev) => ({ ...prev, [key]: true }));
      setTimeout(() => {
        setAnimatingKeys((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }, 700);
    } else {
      // 遇见 -> 未遇见 (静谧平滑重置)
      setUnanimatingKeys((prev) => ({ ...prev, [key]: true }));
      setTimeout(() => {
        setUnanimatingKeys((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }, 500);
    }

    toggle(currentMapId, petName);
  }, []);


  // Filter pets by mode, query and advanced filters
  const filteredPets = useMemo(() => {
    return pets.filter((pet) => {
      const isEnc = isPetEncounteredInRecords(records, currentMap.id, pet.name);

      if (filterMode === 'encountered' && !isEnc) return false;
      if (filterMode === 'unencountered' && isEnc) return false;

      // 社区赞同率过滤（minAgreeRatio>0 时仅显示达到阈值的社区精灵）
      if (minAgreeRatio && minAgreeRatio > 0) {
        const pk = petKeyOf(pet.name, pet.id, pet.seq);
        const ci = pk ? communityAtlas?.[`${currentMap.id}:${pk}`] : undefined;
        if (!ci || (ci.agree_ratio ?? 0) < minAgreeRatio) return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.trim();
        if (searchMode === 'skill') {
          // 技能/特性搜索：命中该精灵任一技能名/描述或特性名/描述即保留
          if (!petMatchesSkillQuery(pet, q)) return false;
        } else {
          const lower = q.toLowerCase();
          const cleanName = formatPetName(pet.name).toLowerCase();
          const baseName = getBasePetName(pet.name).toLowerCase();
          const rawName = pet.name.toLowerCase();
          const idMatch = String(pet.id ?? '').includes(lower);
          const matchesSearch = cleanName.includes(lower) || rawName.includes(lower) || baseName.includes(lower) || idMatch;
          if (!matchesSearch) return false;
        }
      }

      // Elements Filter
      if (advancedFilters.elements.length > 0) {
        if (!pet.elements || !pet.elements.some((el) => advancedFilters.elements.includes(el))) {
          return false;
        }
      }

      // Special Types Filter (Boss / Multi-form)
      if (advancedFilters.specialTypes.length > 0) {
        const specialType = getPetSpecialType(pet);
        const matchesSpecial =
            (advancedFilters.specialTypes.includes('boss') && specialType === 'boss') ||
            (advancedFilters.specialTypes.includes('multiform') && specialType === 'multiform');
        if (!matchesSpecial) return false;
      }

      return true;
    });
  }, [pets, records, currentMap.id, filterMode, searchQuery, searchMode, advancedFilters, minAgreeRatio, communityAtlas]);


  return (
      <div className="bg-white dark:bg-slate-800 roco-card p-5 sm:p-6 border-2 border-transparent dark:border-slate-700/80 transition-colors">
        {/* Section Header */}
        {statsLayoutMode === 'merged' ? (
          <div className="relative pb-4 border-b-2 border-[#F1F5F9] dark:border-slate-700/80 mb-5">
            {/* ===== 宽屏（md+）：地图信息与进度左右并排 ===== */}
            <div className="relative z-10 hidden md:flex md:items-center justify-between gap-4">
              {/* Left: Map Information & Level Badge (merged from StatsBanner) */}
              <div className="flex items-center gap-3.5 flex-1 min-w-0">
                <div
                  className="w-13 h-13 rounded-2xl flex items-center justify-center text-2xl border-2 shrink-0 bg-[#F5F9FF] dark:bg-slate-800 shadow-xs"
                  style={{ borderColor: currentMap.themeColor }}
                >
                  {mapEmoji}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[11px] font-black px-2 py-0.5 rounded-lg border ${currentMap.badgeBg} dark:bg-slate-800 dark:border-slate-700`}>
                      地图 #{currentMap.num}
                    </span>
                    <h3 className="text-lg lg:text-xl font-black text-slate-800 dark:text-slate-100 tracking-tight flex items-center gap-1.5 truncate">
                      <MapPin className="w-4 h-4 text-[#7ABCF4] shrink-0" />
                      <span>{currentMap.name}</span>
                    </h3>
                  </div>

                  {/* 合并版不展示地图描述（描述保留在经典版顶部统计栏） */}
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1 flex items-center gap-1.5 flex-wrap">
                    <span>点击卡片即可直接切换【已遇见 / 未遇见】状态</span>
                    {filterMode !== 'all' && (
                      <span className="text-[10px] font-mono">（当前显示 {filteredPets.length}）</span>
                    )}
                  </p>
                </div>
              </div>

              {/* Right: 集成式进度（环形进度 + 计数文字，与标题区融为一体，不再用独立卡片） */}
              <div className="flex items-center justify-end gap-4 shrink-0">
                <div className="relative w-[46px] h-[46px] shrink-0">
                  <svg width={PROGRESS_RING_SIZE} height={PROGRESS_RING_SIZE} viewBox={`0 0 ${PROGRESS_RING_SIZE} ${PROGRESS_RING_SIZE}`} className="-rotate-90">
                    <defs>
                      <linearGradient id={`${progressRingId}-grad`} x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#95D151" />
                        <stop offset="100%" stopColor="#7ABCF4" />
                      </linearGradient>
                    </defs>
                    <circle
                      cx={PROGRESS_RING_SIZE / 2}
                      cy={PROGRESS_RING_SIZE / 2}
                      r={PROGRESS_RING_RADIUS}
                      fill="none"
                      strokeWidth={PROGRESS_RING_STROKE}
                      className="stroke-[#EAF1F8] dark:stroke-slate-700"
                    />
                    <circle
                      cx={PROGRESS_RING_SIZE / 2}
                      cy={PROGRESS_RING_SIZE / 2}
                      r={PROGRESS_RING_RADIUS}
                      fill="none"
                      strokeWidth={PROGRESS_RING_STROKE}
                      strokeLinecap="round"
                      stroke={`url(#${progressRingId}-grad)`}
                      strokeDasharray={PROGRESS_RING_CIRC}
                      strokeDashoffset={PROGRESS_RING_CIRC * (1 - percentage / 100)}
                      className="transition-all duration-500 ease-out"
                    />
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center text-[10px] font-black font-mono text-[#2B78C4] dark:text-sky-300">
                    {percentage}%
                  </span>
                </div>

                <div className="flex flex-col gap-0.5 text-right min-w-0">
                  <div className="flex items-center justify-end gap-1.5 text-xs font-black">
                    <span className="text-slate-600 dark:text-slate-300">已遇见</span>
                    <span className="font-mono text-[#2B78C4] dark:text-sky-300">
                      {encounteredCount}<span className="text-slate-400 dark:text-slate-500"> / {totalCount}</span>
                    </span>
                  </div>
                  <div className="flex items-center justify-end gap-1.5 text-[10px] text-slate-400 dark:text-slate-500 font-medium">
                    <span>{unencounteredCount === 0 ? '🎉 已全部遇见' : `还差 ${unencounteredCount} 只完成`}</span>
                    {onResetEncounters && encounteredCount > 0 ? (
                      <button
                        type="button"
                        id="reset-map-encounters-btn"
                        onClick={() => {
                          sound.playClick();
                          setIsResetConfirmOpen(true);
                        }}
                        title="清空当前关卡遇见记录"
                        className="text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors flex items-center gap-0.5 cursor-pointer hover:underline"
                      >
                        <RotateCcw className="w-2.5 h-2.5" />
                        <span>重置记录</span>
                      </button>
                    ) : (
                      <span>{percentage >= 100 ? '已完成' : '收集进行中'}</span>
                    )}
                  </div>

                  {dataUpdateAvailable && onOpenDataUpdate && (
                    <div className="flex items-center justify-end gap-1 pt-0.5">
                      <span className="text-[10px] text-amber-700 dark:text-amber-400 font-medium flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                        图鉴数据库有更新
                      </span>
                      <button
                        type="button"
                        id="data-update-btn"
                        onClick={() => {
                          sound.playClick();
                          onOpenDataUpdate();
                        }}
                        className="text-[10px] font-bold text-sky-600 dark:text-sky-400 hover:text-sky-700 flex items-center gap-0.5 cursor-pointer hover:underline"
                      >
                        <ArrowUpCircle className="w-3 h-3 text-sky-500" />
                        <span>前往更新</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ===== 窄屏（<md）：紧凑四行布局——标题行内嵌进度环，全宽线性进度条，状态左右分布 ===== */}
            <div className="relative z-10 flex md:hidden flex-col gap-2">
              {/* 第一行：地图图标 + 编号徽章/标题 + 进度环 */}
              <div className="flex items-center gap-2.5">
                <div
                  className="w-10 h-10 rounded-2xl flex items-center justify-center text-xl border-2 shrink-0 bg-[#F5F9FF] dark:bg-slate-800 shadow-xs"
                  style={{ borderColor: currentMap.themeColor }}
                >
                  {mapEmoji}
                </div>
                <div className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap">
                  <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-lg border shrink-0 ${currentMap.badgeBg} dark:bg-slate-800 dark:border-slate-700`}>
                    地图 #{currentMap.num}
                  </span>
                  <h3 className="text-base font-black text-slate-800 dark:text-slate-100 tracking-tight flex items-center gap-1 min-w-0">
                    <MapPin className="w-3.5 h-3.5 text-[#7ABCF4] shrink-0" />
                    <span className="truncate">{currentMap.name}</span>
                  </h3>
                </div>
                {/* 进度环内嵌标题行右端 */}
                <div className="relative w-10 h-10 shrink-0">
                  <svg width={40} height={40} viewBox="0 0 40 40" className="-rotate-90">
                    <defs>
                      <linearGradient id={`${progressRingId}-grad-sm`} x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#95D151" />
                        <stop offset="100%" stopColor="#7ABCF4" />
                      </linearGradient>
                    </defs>
                    <circle
                      cx={20}
                      cy={20}
                      r={17.75}
                      fill="none"
                      strokeWidth={4.5}
                      className="stroke-[#EAF1F8] dark:stroke-slate-700"
                    />
                    <circle
                      cx={20}
                      cy={20}
                      r={17.75}
                      fill="none"
                      strokeWidth={4.5}
                      strokeLinecap="round"
                      stroke={`url(#${progressRingId}-grad-sm)`}
                      strokeDasharray={2 * Math.PI * 17.75}
                      strokeDashoffset={2 * Math.PI * 17.75 * (1 - percentage / 100)}
                      className="transition-all duration-500 ease-out"
                    />
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center text-[9px] font-black font-mono text-[#2B78C4] dark:text-sky-300">
                    {percentage}%
                  </span>
                </div>
              </div>

              {/* 第二行：操作提示 */}
              <p className="text-[11px] text-slate-400 dark:text-slate-500 flex items-center gap-1.5 flex-wrap">
                <span>点击卡片即可直接切换【已遇见 / 未遇见】状态</span>
                {filterMode !== 'all' && (
                  <span className="text-[10px] font-mono">（当前显示 {filteredPets.length}）</span>
                )}
              </p>

              {/* 第三行：计数在左，剩余提示/重置在右（进度已由标题行进度环表达，不再重复显示线性进度条） */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1 text-[11px] font-black shrink-0">
                  <span className="text-slate-600 dark:text-slate-300">已遇见</span>
                  <span className="font-mono text-[#2B78C4] dark:text-sky-300">
                    {encounteredCount}<span className="text-slate-400 dark:text-slate-500"> / {totalCount}</span>
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-slate-500 font-medium min-w-0">
                  <span className="truncate">{unencounteredCount === 0 ? '🎉 已全部遇见' : `还差 ${unencounteredCount} 只完成`}</span>
                  {onResetEncounters && encounteredCount > 0 ? (
                    <button
                      type="button"
                      id="reset-map-encounters-btn-sm"
                      onClick={() => {
                        sound.playClick();
                        setIsResetConfirmOpen(true);
                      }}
                      title="清空当前关卡遇见记录"
                      className="text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors flex items-center gap-0.5 cursor-pointer hover:underline shrink-0"
                    >
                      <RotateCcw className="w-2.5 h-2.5" />
                      <span>重置记录</span>
                    </button>
                  ) : (
                    <span className="shrink-0">{percentage >= 100 ? '已完成' : '收集进行中'}</span>
                  )}
                </div>
              </div>

              {/* 数据更新提示（窄屏独占一行，左对齐） */}
              {dataUpdateAvailable && onOpenDataUpdate && (
                <div className="flex items-center gap-1 pt-0.5">
                  <span className="text-[10px] text-amber-700 dark:text-amber-400 font-medium flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                    图鉴数据库有更新
                  </span>
                  <button
                    type="button"
                    id="data-update-btn-sm"
                    onClick={() => {
                      sound.playClick();
                      onOpenDataUpdate();
                    }}
                    className="text-[10px] font-bold text-sky-600 dark:text-sky-400 hover:text-sky-700 flex items-center gap-0.5 cursor-pointer hover:underline"
                  >
                    <ArrowUpCircle className="w-3 h-3 text-sky-500" />
                    <span>前往更新</span>
                  </button>
                </div>
              )}
            </div>

            {/* Filter tabs + search controls */}
            {showSearchFilterToolbar && (
              <div className="relative z-10 w-full pt-3 mt-3">
                <SearchFilterToolbar
                  pets={pets}
                  encounteredCount={encounteredCount}
                  totalCount={totalCount}
                  filterMode={filterMode}
                  onFilterChange={onFilterChange || (() => {})}
                  searchQuery={searchQuery}
                  searchMode={searchMode}
                  onSearchChange={onSearchChange!}
                  onSearchModeChange={onSearchModeChange!}
                  advancedFilters={advancedFilters}
                  onAdvancedFilterChange={onAdvancedFilterChange!}
                  layout="grid"
                  hideSearchInput={hideSearchInput}
                />
              </div>
            )}

            {/* Reset Confirmation Dialog */}
            <ConfirmDialog
              isOpen={isResetConfirmOpen}
              title="重置当前关卡遇见记录"
              description={`确定要清空【${currentMap.name}】的遇见记录吗？（已遇见 ${encounteredCount} 只）`}
              detail="此操作无法撤销，清空后该地图所有精灵的遇见记录与绿勾标记将重置。"
              confirmText="确认重置"
              cancelText="取消"
              danger
              onConfirm={() => {
                onResetEncounters?.();
              }}
              onClose={() => setIsResetConfirmOpen(false)}
            />
          </div>
        ) : (
          /* Classic header: number badge + name + encounter pill (separate StatsBanner above) */
          <div className="pb-4 border-b-2 border-[#F1F5F9] dark:border-slate-700/80 mb-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <div
                    className="w-10 h-10 rounded-2xl flex items-center justify-center text-white font-black text-sm shrink-0 shadow-xs"
                    style={{ backgroundColor: currentMap.themeColor }}
                >
                  {currentMap.num}
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-black text-slate-800 dark:text-slate-100 tracking-tight flex items-center gap-2 flex-wrap">
                    <span>{currentMap.name}</span>
                    <span className="text-xs px-2.5 py-0.5 rounded-full bg-[#F5F9FF] dark:bg-slate-800 text-[#2B78C4] dark:text-sky-300 font-mono font-black border border-[#E6EEF8] dark:border-slate-700 flex items-center gap-1">
                      <span>已遇见 <strong className="text-[#2D6613] dark:text-emerald-400 font-black">{encounteredCount}</strong> / {totalCount}</span>
                      {filterMode !== 'all' && (
                          <span className="text-[10px] text-slate-400 dark:text-slate-400 font-normal">
                            (当前显示 {filteredPets.length})
                          </span>
                      )}
                    </span>
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    点击卡片即可直接切换【已遇见 / 未遇见】状态
                  </p>
                </div>
              </div>
            </div>

            {showSearchFilterToolbar && (
              <div className="w-full pt-3 mt-3 border-t border-slate-100 dark:border-slate-700/70">
                <SearchFilterToolbar
                  pets={pets}
                  encounteredCount={encounteredCount}
                  totalCount={totalCount}
                  filterMode={filterMode}
                  onFilterChange={onFilterChange || (() => {})}
                  searchQuery={searchQuery}
                  searchMode={searchMode}
                  onSearchChange={onSearchChange!}
                  onSearchModeChange={onSearchModeChange!}
                  advancedFilters={advancedFilters}
                  onAdvancedFilterChange={onAdvancedFilterChange!}
                  layout="grid"
                  hideSearchInput={hideSearchInput}
                />
              </div>
            )}
          </div>
        )}
        {/* Empty State */}
        {filteredPets.length === 0 ? (
            <div className="py-16 text-center text-slate-400 flex flex-col items-center">
              <Sparkles className="w-10 h-10 text-slate-300 dark:text-slate-600 mb-2" />
              <p className="text-sm font-black text-slate-600 dark:text-slate-300">未找到符合条件的精灵</p>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">请尝试调整搜索关键词或切换筛选条件</p>
            </div>
        ) : (
            /* Uniform Grid of Scaled Pet Icons - Responsive density on mobile phones & desktop */
            <div className="grid grid-cols-[repeat(auto-fill,minmax(80px,1fr))] sm:grid-cols-[repeat(auto-fill,150px)] justify-center gap-2 sm:gap-4">
              {filteredPets.map((pet) => {
                const key = `${currentMap.id}_${pet.name}`;
                const isEnc = isPetEncounteredInRecords(records, currentMap.id, pet.name);
                const isJustEncountered = !!animatingKeys[key];
                const petKey = petKeyOf(pet.name, pet.id, pet.seq);
                const communityInfo: PetCardCommunityInfo | null = petKey ? (communityAtlas?.[`${currentMap.id}:${petKey}`] as PetCardCommunityInfo | undefined) ?? null : null;

                return (
                  <PetCard
                    key={pet.name}
                    mapId={currentMap.id}
                    pet={pet}
                    isEnc={isEnc}
                    isJustEncountered={isJustEncountered}
                    communityCard={communityCard}
                    communityInfo={communityInfo}
                    canVote={!!onAtlasVote}
                    onActivate={handleCardClick}
                    onOpenDetail={handleOpenDetail}
                    onVote={onAtlasVote ? handleVote : undefined}
                    onEnter={handleCardMouseEnter}
                    onLeave={handleCardMouseLeave}
                    onContext={handleCardContext}
                  />
                );
              })}
            </div>
        )}

        {/* 智能贴边悬浮面板：严格仅在 hover 卡片时展示，鼠标离开卡片瞬间消失，pointer-events-none 杜绝滞留与操作干扰 */}
        {hoveredPet && showSkillHover && (
          <div
            id="pet-grid-skill-hover-panel"
            className="fixed z-50 w-[315px] pointer-events-none transition-opacity duration-150 animate-in fade-in zoom-in-95 shadow-2xl drop-shadow-xl select-none"
            style={{
              left: hoveredPet.placement === 'right' ? Math.min(hoveredPet.x, window.innerWidth - 335) : undefined,
              right: hoveredPet.placement === 'left' ? Math.max(10, window.innerWidth - hoveredPet.x) : undefined,
              top: hoveredPet.placementY === 'top' ? Math.max(12, Math.min(hoveredPet.y, window.innerHeight - 300)) : undefined,
              bottom: hoveredPet.placementY === 'bottom' ? Math.max(12, window.innerHeight - hoveredPet.y) : undefined,
            }}
          >
            <PetSkillPanel pet={hoveredPet.pet} compact showHeader />
          </div>
        )}

        {/* 重新设计的现代游戏风格右键快捷菜单 */}
        {contextMenu && (
          <div
            id="pet-grid-context-menu"
            className="fixed z-50 w-56 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 text-slate-800 dark:text-slate-100"
            style={{
              left: Math.min(contextMenu.x, window.innerWidth - 240),
              top: Math.min(contextMenu.y, window.innerHeight - 280),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 菜单顶部精灵卡片小览 */}
            <div className="p-3 border-b border-slate-100 dark:border-slate-800/80 bg-gradient-to-r from-sky-50/70 to-transparent dark:from-slate-800/60 flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-xl bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700/60 p-1 shrink-0 flex items-center justify-center overflow-hidden shadow-2xs">
                <PetSprite pet={contextMenu.pet} alt={contextMenu.pet.name} className="w-full h-full object-contain" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-black text-slate-800 dark:text-slate-100 truncate">
                  {formatPetName(contextMenu.pet.name)}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {contextMenu.pet.elements && (
                    <ElementBadges elements={contextMenu.pet.elements} size="xs" horizontal />
                  )}
                  {contextMenu.pet.id != null && (
                    <span className="text-[9px] font-mono font-bold text-slate-400">
                      #{contextMenu.pet.id}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* 操作项 */}
            <div className="p-1.5 space-y-0.5 text-xs">
              <button
                id="context-menu-view-detail"
                type="button"
                onClick={() => {
                  onOpenPetDetail?.(contextMenu.pet);
                  setContextMenu(null);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-xl font-bold text-slate-700 dark:text-slate-200 hover:bg-sky-50 dark:hover:bg-sky-950/40 hover:text-sky-600 dark:hover:text-sky-300 transition-colors cursor-pointer"
              >
                <Info className="w-4 h-4 text-sky-500" />
                <span>精灵特性与技能全览</span>
              </button>

              <button
                id="context-menu-toggle-encounter"
                type="button"
                onClick={() => {
                  const isEnc = isPetEncounteredInRecords(records, currentMap.id, contextMenu.pet.name);
                  handleCardClick(contextMenu.pet.name, isEnc);
                  setContextMenu(null);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-xl font-bold text-slate-700 dark:text-slate-200 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 hover:text-emerald-600 dark:hover:text-emerald-300 transition-colors cursor-pointer"
              >
                {isPetEncounteredInRecords(records, currentMap.id, contextMenu.pet.name) ? (
                  <>
                    <RotateCcw className="w-4 h-4 text-rose-500" />
                    <span>标记为【未遇见】</span>
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4 text-emerald-500" />
                    <span>点亮图鉴 · 【已遇见】</span>
                  </>
                )}
              </button>

              {onOpenFeedback && (
                <button
                  id="context-menu-report-error"
                  type="button"
                  onClick={() => {
                    onOpenFeedback('精灵图鉴纠错', contextMenu.pet);
                    setContextMenu(null);
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-2 rounded-xl font-bold text-slate-500 dark:text-slate-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 hover:text-rose-600 dark:hover:text-rose-400 transition-colors cursor-pointer"
                >
                  <Bug className="w-4 h-4 text-slate-400" />
                  <span>反馈此精灵数据错误</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>
  );
};
