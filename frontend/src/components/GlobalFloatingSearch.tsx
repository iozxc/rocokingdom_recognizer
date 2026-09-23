import React, { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import { PetSprite } from './PetSprite';
import {
  Search,
  X,
  Sparkles,
  Check,
  MapPin,
  ArrowRight,
  ExternalLink,
  SlidersHorizontal,
  HelpCircle,
  Layers,
  ChevronRight,
  ChevronLeft,
  Database,
  ListFilter,
  Flame,
  Wand2,
} from 'lucide-react';
import { MapConfig, PetItem, EncounterRecord, FloatingButtonsMode } from '../types';
import { PetSearchMode, petMatchesSkillQuery } from '../utils/skillSearch';
import { resolvePetSkillsAndTrait } from '../data/petSkillMock';
import { MAP_CONFIGS } from '../data/mockPets';
import { sound } from '../services/sound';
import { storage } from '../services/storage';
import { openFollowScanner } from '../services/followScanner';
import { isWebFollowSupported } from '../services/recognition/capture';
import { formatPetName, isPetEncounteredInRecords, getBasePetName } from '../utils/petHelper';
import { ElementBadges } from './ElementBadges';
import { IS_STATIC } from '../services/staticMode';
import { BackToTopHeaderButton, BackToTopCircle } from './BackToTopButton';
import { ModalHeader, ModalHeaderBadge } from './ModalHeader';

/**
 * 地图主题色，按图号区分。
 *
 * 必须用 Tailwind 类而不是内联色值：内联 style 优先级最高且不认 `dark:`，
 * 原来写死 #E1F7DB/#FEF9E6 等浅色，导致暗黑模式下这几个地图 tag 变成刺眼的亮块。
 */
function mapTone(num: number) {
  if (num === 1) {
    return {
      tag: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30',
      chip: 'bg-emerald-100 text-emerald-800 ring-emerald-300 dark:bg-emerald-500/20 dark:text-emerald-200 dark:ring-emerald-500/40',
    };
  }
  if (num === 2) {
    return {
      tag: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30',
      chip: 'bg-amber-100 text-amber-800 ring-amber-300 dark:bg-amber-500/20 dark:text-amber-200 dark:ring-amber-500/40',
    };
  }
  return {
    tag: 'bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/30',
    chip: 'bg-sky-100 text-sky-800 ring-sky-300 dark:bg-sky-500/20 dark:text-sky-200 dark:ring-sky-500/40',
  };
}

export interface GlobalSearchPetResult {
  pet: PetItem;
  mapConfig: MapConfig;
  isEncountered: boolean;
  rawName: string;
  cleanName: string;
}

interface GlobalFloatingSearchProps {
  allMapsPets: Record<string, { count: number; items: PetItem[] }>;
  records: Record<string, EncounterRecord>;
  onNavigateToPet: (mapNum: number, petName: string) => void;
  onToggleEncounter: (mapId: string, filename: string) => void;
  onOpenDataManage?: () => void;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  mapsConfig?: MapConfig[];
  searchOnly?: boolean;
  // 火系共创图鉴相关（FireBadgeTrial 传入时，在本悬浮按钮组内追加对应按钮）
  onOpenFireAtlas?: () => void;
  // 首页图鉴数据源切换：community=共创图鉴(按图) | pokedex=全图鉴自选(每图全量)
  atlasMode?: 'community' | 'pokedex';
  onToggleAtlasMode?: () => void;
  // 跟随识别：打开扫描窗口时写入的试炼 key（保证窗口初始试炼与来源页面一致）
  followTrialKey?: string;
}

export const GlobalFloatingSearch: React.FC<GlobalFloatingSearchProps> = ({
                                                                            allMapsPets,
                                                                            records,
                                                                            onNavigateToPet,
                                                                            onToggleEncounter,
                                                                            onOpenDataManage,
                                                                            isOpen: controlledIsOpen,
            onOpenChange,
            mapsConfig,
            searchOnly,
            onOpenFireAtlas,
            atlasMode,
            onToggleAtlasMode,
            followTrialKey,
          }) => {
  const maps = mapsConfig && mapsConfig.length > 0 ? mapsConfig : MAP_CONFIGS;
  const [internalIsOpen, setInternalIsOpen] = useState<boolean>(false);
  const isSearchOpen = controlledIsOpen !== undefined ? controlledIsOpen : internalIsOpen;

  const setIsOpen = (open: boolean) => {
    if (onOpenChange) {
      onOpenChange(open);
    }
    setInternalIsOpen(open);
  };

  const [isFABCollapsed, setIsFABCollapsed] = useState<boolean>(() => {
    return storage.getSetting<boolean>('isFABCollapsed', false);
  });

  // 收起/展开切换时，新挂载的按钮会在按住鼠标的 :active 期间先渲染到 active:scale-95，
  // 松手后再用 transition-all 过渡回 scale-1，看起来像“跟随识别等按钮从小到大放大”。
  // 解决：切换后的前两帧给容器加 fab-enter-noanim 禁用过渡，等 :active 释放、按钮已回到
  // scale-1 后再恢复（hover / active 的按压反馈不受影响）。
  const [fabEnterGuard, setFabEnterGuard] = useState(false);
  useLayoutEffect(() => {
    setFabEnterGuard(true);
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setFabEnterGuard(false));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [isFABCollapsed]);
  const [floatingMode, setFloatingMode] = useState<FloatingButtonsMode>(() => {
    return storage.getSetting<FloatingButtonsMode>('floatingButtonsMode', 'normal');
  });
  // 火系共创图鉴相关按钮（任一个回调存在即启用）
  const hasFireAtlas = !!onOpenFireAtlas || !!onToggleAtlasMode;

  const [searchQuery, setSearchQuery] = useState<string>('');
  // 搜索模式：'name'=精灵名/图鉴id/地图（默认）；'skill'=技能名/描述、特性名/描述
  const [searchMode, setSearchMode] = useState<PetSearchMode>('name');
  const [selectedMapFilter, setSelectedMapFilter] = useState<number | 'all'>('all');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<'all' | 'unencountered' | 'encountered'>('all');
  const [focusedIndex, setFocusedIndex] = useState<number>(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const resultsContainerRef = useRef<HTMLDivElement>(null);

  // Sync settings when storage updates from remote roco_user_data.json
  useEffect(() => {
    const unsubscribe = storage.subscribeSettings((settings) => {
      if (typeof settings.isFABCollapsed === 'boolean') {
        setIsFABCollapsed(settings.isFABCollapsed);
      }
      if (settings.floatingButtonsMode) {
        setFloatingMode(settings.floatingButtonsMode);
      }
    });
    return () => unsubscribe();
  }, []);

  const handleToggleCollapse = (collapsed: boolean) => {
    sound.playClick();
    setIsFABCollapsed(collapsed);
    storage.setSetting('isFABCollapsed', collapsed);
  };

  // Global Shortcut listener (Ctrl+K, Cmd+K, or '/')
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is already typing in an input/textarea (unless it's our search modal)
      const target = e.target as HTMLElement;
      const isInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        // 浏览器保留 Ctrl+K 给地址栏搜索，纯 Web 端不拦截（键帽提示也只在桌面端显示）
        if (IS_STATIC) return;
        e.preventDefault();
        sound.playClick();
        setIsOpen(!isSearchOpen);
      } else if (e.key === '/' && !isInput && !isSearchOpen) {
        e.preventDefault();
        sound.playClick();
        setIsOpen(true);
      } else if (e.key === 'Escape' && isSearchOpen) {
        setIsOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSearchOpen]);

  // Focus input when modal opens (only on desktop non-touch devices to avoid popping mobile soft keyboard)
  useEffect(() => {
    if (isSearchOpen) {
      const isTouchOrMobile =
        typeof window !== 'undefined' &&
        (('ontouchstart' in window) || navigator.maxTouchPoints > 0 || window.innerWidth < 768);

      if (!isTouchOrMobile) {
        setTimeout(() => {
          inputRef.current?.focus();
        }, 100);
      }
      setFocusedIndex(0);
    } else {
      setSearchQuery('');
      setSearchMode('name');
    }
  }, [isSearchOpen]);

  // Compile all pets across all maps into a searchable array
  const allPetsList: GlobalSearchPetResult[] = useMemo(() => {
    const list: GlobalSearchPetResult[] = [];

    maps.forEach((map) => {
      const mapKey = `map${map.num}`;
      const items = allMapsPets[mapKey]?.items || [];

      items.forEach((pet) => {
        const isEnc = isPetEncounteredInRecords(records, map.id, pet.name);
        const cleanName = formatPetName(pet.name);

        list.push({
          pet,
          mapConfig: map,
          isEncountered: isEnc,
          rawName: pet.name,
          cleanName,
        });
      });
    });

    return list;
  }, [allMapsPets, records, maps]);

  // Filtered search list
  const filteredResults = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();

    return allPetsList.filter((item) => {
      // Filter by map
      if (selectedMapFilter !== 'all' && item.mapConfig.num !== selectedMapFilter) {
        return false;
      }

      // Filter by status
      if (selectedStatusFilter === 'unencountered' && item.isEncountered) {
        return false;
      }
      if (selectedStatusFilter === 'encountered' && !item.isEncountered) {
        return false;
      }

      // Filter by text search (clean name, raw name, base name, map name)
      if (q) {
        const cleanMatch = item.cleanName.toLowerCase().includes(q);
        const rawMatch = item.rawName.toLowerCase().includes(q);
        const baseMatch = getBasePetName(item.rawName).toLowerCase().includes(q);
        const mapMatch = item.mapConfig.name.toLowerCase().includes(q);
        const idMatch = String(item.pet.id ?? '').includes(q);
        if (searchMode === 'skill') return petMatchesSkillQuery(item.pet, q);
        return cleanMatch || rawMatch || baseMatch || mapMatch || idMatch;
      }

      return true;
    });
  }, [allPetsList, searchQuery, searchMode, selectedMapFilter, selectedStatusFilter]);

  // Overall Statistics for Search Palette
  const totalAllPets = allPetsList.length;
  const totalEncounteredAll = allPetsList.filter((i) => i.isEncountered).length;
  const totalUnencounteredAll = totalAllPets - totalEncounteredAll;

  // Keyboard navigation within list
  const handleKeyDownInInput = (e: React.KeyboardEvent) => {
    if (filteredResults.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusedIndex((prev) => (prev + 1) % filteredResults.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusedIndex((prev) => (prev - 1 + filteredResults.length) % filteredResults.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const targetItem = filteredResults[focusedIndex];
      if (targetItem) {
        handleSelectPet(targetItem);
      }
    }
  };

  // 技能/特性模式下，找出某只精灵命中关键词的技能/特性名称（用于卡片标注命中来源）
  const getMatchedSkillTags = (item: GlobalSearchPetResult): { type: 'skill' | 'trait'; label: string }[] => {
    if (searchMode !== 'skill') return [];
    const q = searchQuery.toLowerCase().trim();
    if (!q) return [];
    const { trait, skills } = resolvePetSkillsAndTrait(item.pet);
    const hits: { type: 'skill' | 'trait'; label: string }[] = [];
    if (trait?.name && (trait.name.toLowerCase().includes(q) || (trait.desc || '').toLowerCase().includes(q))) {
      hits.push({ type: 'trait', label: trait.name });
    }
    for (const s of skills) {
      if (s?.name && (s.name.toLowerCase().includes(q) || (s.desc || '').toLowerCase().includes(q))) {
        hits.push({ type: 'skill', label: s.name });
        if (hits.length >= 3) break;
      }
    }
    return hits;
  };

  const handleSelectPet = (item: GlobalSearchPetResult) => {
    sound.playClick();
    onNavigateToPet(item.mapConfig.num, item.pet.name);
    setIsOpen(false);
  };

  /**
   * 跟随识别悬浮按钮是否显示。
   * 桌面版一直显示（点开的是 pywebview 悬浮窗）；纯前端版只在浏览器支持屏幕捕获时显示
   * （点开的是网页版跟随识别面板）—— 入口完全一样，只是各自执行各自的效果。
   */
  const showFollowFab = !searchOnly || isWebFollowSupported();
  // 全域搜索两端都提供；纯 Web 端只隐藏 Ctrl+K 键帽（浏览器占用该组合键），功能本身保留。
  const showSearchFab = true;

  return (
      <>
        {/* 1. Global Floating Action Buttons (FABs) on Screen (Bottom-Right) */}
        {floatingMode === 'hidden' ? null : floatingMode === 'compact' ? (
            /* Compact Mode: Icon-only circular buttons, no text, clean & minimalist */
            <div
                id="global-floating-fabs-compact"
                className="fixed bottom-6 right-6 z-40 flex flex-col items-center gap-2 select-none animate-in fade-in zoom-in-95 duration-200"
            >
              {/* 回到顶部（向下滚动后出现） */}
              <BackToTopCircle size="md" />

              {/* 1. 跟随识别 Icon（桌面版常显；Web 版需浏览器支持屏幕捕获） */}
              {showFollowFab && (
                  <button
                      type="button"
                      id="global-compact-follow-fab"
                      onClick={() => {
                        sound.playClick();
                        openFollowScanner(followTrialKey);
                      }}
                      className="w-11 h-11 rounded-full bg-white/95 dark:bg-slate-800/95 backdrop-blur-md text-violet-600 dark:text-violet-300 flex items-center justify-center ring-1 ring-inset ring-slate-200/80 dark:ring-slate-700 shadow-lg shadow-slate-900/5 dark:shadow-black/20 hover:ring-violet-300 dark:hover:ring-violet-600 transition-all hover:scale-110 active:scale-95 cursor-pointer"
                      title="游戏窗口跟随识别 (AI 智能实时识别)"
                  >
                    <Sparkles className="w-5 h-5" />
                  </button>
              )}

               {/* 4. 数据管理（web 版：导入/导出，精简模式下隐藏） */}
              {onOpenDataManage && (
                  <button
                      type="button"
                      id="global-compact-data-fab"
                      onClick={() => {
                        sound.playClick();
                        onOpenDataManage();
                      }}
                      className="w-11 h-11 rounded-full bg-white/95 dark:bg-slate-800/95 backdrop-blur-md text-emerald-600 dark:text-emerald-300 flex items-center justify-center ring-1 ring-inset ring-slate-200/80 dark:ring-slate-700 shadow-lg shadow-slate-900/5 dark:shadow-black/20 hover:ring-emerald-300 dark:hover:ring-emerald-600 transition-all hover:scale-110 active:scale-95 cursor-pointer"
                      title="数据管理 (导入/导出)"
                  >
                    <Database className="w-5 h-5" />
                  </button>
              )}

              {/* 5. 全域搜索 Icon */}
              {showSearchFab && (
              <button
                  type="button"
                  id="global-compact-search-fab"
                  onClick={() => {
                    sound.playClick();
                    setIsOpen(true);
                  }}
                  className="w-11 h-11 rounded-full bg-white/95 dark:bg-slate-800/95 backdrop-blur-md text-[#2B78C4] dark:text-sky-300 flex items-center justify-center ring-1 ring-inset ring-slate-200/80 dark:ring-slate-700 shadow-lg shadow-slate-900/5 dark:shadow-black/20 hover:ring-sky-300 dark:hover:ring-sky-600 transition-all hover:scale-110 active:scale-95 cursor-pointer"
                  title={IS_STATIC ? '全域图鉴搜索' : '全域图鉴搜索 (Ctrl+K)'}
              >
                <Search className="w-5 h-5" />
              </button>
              )}

              {/* 火系共创图鉴相关按钮 */}
              {hasFireAtlas && (
                  <>
                    {onOpenFireAtlas && (
                        <button
                            type="button"
                            id="global-compact-fire-atlas-fab"
                            onClick={() => {
                              sound.playClick();
                              onOpenFireAtlas();
                            }}
                            className="w-11 h-11 rounded-full bg-white/95 dark:bg-slate-800/95 backdrop-blur-md text-orange-600 dark:text-orange-400 flex items-center justify-center ring-1 ring-inset ring-slate-200/80 dark:ring-slate-700 shadow-lg shadow-slate-900/5 dark:shadow-black/20 hover:ring-orange-300 dark:hover:ring-orange-600 transition-all hover:scale-110 active:scale-95 cursor-pointer"
                            title="共创图鉴"
                        >
                          <Flame className="w-5 h-5" />
                        </button>
                    )}
                    {onToggleAtlasMode && (
                        <button
                            type="button"
                            id="global-compact-fire-atlas-mode-fab"
                            onClick={() => {
                              sound.playClick();
                              onToggleAtlasMode();
                            }}
                            className="w-11 h-11 rounded-full bg-white/95 dark:bg-slate-800/95 backdrop-blur-md text-violet-600 dark:text-violet-300 flex items-center justify-center ring-1 ring-inset ring-slate-200/80 dark:ring-slate-700 shadow-lg shadow-slate-900/5 dark:shadow-black/20 hover:ring-violet-300 dark:hover:ring-violet-600 transition-all hover:scale-110 active:scale-95 cursor-pointer"
                            title={`切换图鉴（当前 - ${atlasMode === 'pokedex' ? '全图鉴' : '共创图鉴'}）`}
                        >
                          <Layers className="w-5 h-5" />
                        </button>
                    )}
                  </>
              )}

            </div>
        ) : (
            <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end select-none">
              {isFABCollapsed ? (
                  /* Collapsed 小圆球：回到顶部在上、展开钮在下 */
                  <div className={`flex flex-col items-center gap-2 ${fabEnterGuard ? 'fab-enter-noanim' : ''}`}>
                    <BackToTopCircle size="sm" />
                    <button
                      type="button"
                      id="global-floating-expand-fab"
                      onClick={() => handleToggleCollapse(false)}
                      className="w-10 h-10 rounded-full bg-white/95 dark:bg-slate-800/95 backdrop-blur-md text-[#2B78C4] dark:text-sky-300 flex items-center justify-center ring-1 ring-inset ring-slate-200/80 dark:ring-slate-700 shadow-lg shadow-slate-900/5 dark:shadow-black/20 hover:ring-sky-300 dark:hover:ring-sky-600 transition-all duration-200 cursor-pointer hover:scale-105 active:scale-95"
                      title="展开右侧快捷功能悬浮栏 (跟随识别 / 数据管理 / 全域图鉴搜索)"
                  >
                    <Search className="w-5 h-5" />
                    </button>
                  </div>
              ) : (
                  /* Expanded FABs Stack */
                  <div className={`flex flex-col items-end gap-2 ${fabEnterGuard ? 'fab-enter-noanim' : ''}`}>
                    {/* Header Toolbar: 精简模式图标切换 + 收起按钮 */}
                    <div className="flex items-center gap-1 p-1 bg-white/95 dark:bg-slate-800/95 backdrop-blur-md rounded-2xl ring-1 ring-inset ring-slate-200/80 dark:ring-slate-700 shadow-md shadow-slate-900/5 dark:shadow-black/20 self-end">
                      <BackToTopHeaderButton />
                      <button
                          type="button"
                          id="global-floating-collapse-fab"
                          onClick={() => handleToggleCollapse(true)}
                          className="w-7 h-7 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 flex items-center justify-center transition-colors cursor-pointer"
                          title="收起右侧快捷悬浮栏"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>

                    {/* 1. 跟随识别（桌面版常显；Web 版需浏览器支持屏幕捕获） */}
                    {showFollowFab && (
                        <button
                            id="global-floating-follow-fab"
                            type="button"
                            onClick={() => {
                              sound.playClick();
                              openFollowScanner(followTrialKey);
                            }}
                            className="relative flex items-center gap-2 pl-1.5 pr-3.5 sm:pl-2 sm:pr-4 py-1.5 bg-gradient-to-r from-violet-100 dark:from-violet-500/25 to-white dark:to-slate-800 backdrop-blur-md text-slate-700 dark:text-slate-100 font-black rounded-full ring-1 ring-inset ring-slate-200/80 dark:ring-slate-700 shadow-lg shadow-slate-900/5 dark:shadow-black/20 hover:ring-violet-300 dark:hover:ring-violet-600 transition-all duration-200 hover:-translate-y-0.5 active:scale-95 cursor-pointer"
                            title="窗口跟随识别"
                        >
                          <div className="w-7 h-7 rounded-full bg-violet-100 dark:bg-violet-500/15 text-violet-600 dark:text-violet-300 flex items-center justify-center shrink-0">
                            <Sparkles className="w-3.5 h-3.5" />
                          </div>

                          <span className="text-xs sm:text-sm tracking-wide">
                    跟随识别
                  </span>
                        </button>
                    )}

                    {/* 4. 数据管理（web 版：导入/导出，精简模式下隐藏） */}
                    {onOpenDataManage && (
                        <button
                            id="global-floating-data-fab"
                            type="button"
                            onClick={() => {
                              sound.playClick();
                              onOpenDataManage();
                            }}
                            className="relative flex items-center gap-2 pl-1.5 pr-3.5 sm:pl-2 sm:pr-4 py-1.5 bg-gradient-to-r from-emerald-100 dark:from-emerald-500/25 to-white dark:to-slate-800 backdrop-blur-md text-slate-700 dark:text-slate-100 font-black rounded-full ring-1 ring-inset ring-slate-200/80 dark:ring-slate-700 shadow-lg shadow-slate-900/5 dark:shadow-black/20 hover:ring-emerald-300 dark:hover:ring-emerald-600 transition-all duration-200 hover:-translate-y-0.5 active:scale-95 cursor-pointer"
                            title="数据管理 (导入/导出 roco_user_data.json)"
                        >
                          <div className="w-7 h-7 rounded-full bg-emerald-100 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 flex items-center justify-center shrink-0">
                            <Database className="w-3.5 h-3.5" />
                          </div>
                          <span className="text-xs sm:text-sm tracking-wide">
                    数据管理
                  </span>
                        </button>
                    )}

                    {/* 火系共创图鉴相关按钮 */}
                    {hasFireAtlas && (
                        <>
                          {onOpenFireAtlas && (
                              <button
                                  id="global-floating-fire-atlas-fab"
                                  type="button"
                                  onClick={() => {
                                    sound.playClick();
                                    onOpenFireAtlas();
                                  }}
                                  className="relative flex items-center gap-2 pl-1.5 pr-3.5 sm:pl-2 sm:pr-4 py-1.5 bg-gradient-to-r from-orange-100 dark:from-orange-500/25 to-white dark:to-slate-800 backdrop-blur-md text-slate-700 dark:text-slate-100 font-black rounded-full ring-1 ring-inset ring-slate-200/80 dark:ring-slate-700 shadow-lg shadow-slate-900/5 dark:shadow-black/20 hover:ring-orange-300 dark:hover:ring-orange-600 transition-all duration-200 hover:-translate-y-0.5 active:scale-95 cursor-pointer"
                                  title="共创图鉴"
                              >
                                <div className="w-7 h-7 rounded-full bg-orange-100 dark:bg-orange-500/15 text-orange-600 dark:text-orange-400 flex items-center justify-center shrink-0">
                                  <Flame className="w-3.5 h-3.5" />
                                </div>
                                <span className="text-xs sm:text-sm tracking-wide">共创图鉴</span>
                              </button>
                          )}

                        </>
                    )}

                    {/* 5. 全域图鉴搜索 */}
                    {showSearchFab && (
                    <button
                        id="global-floating-search-fab"
                        type="button"
                        onClick={() => {
                          sound.playClick();
                          setIsOpen(true);
                        }}
                        className="relative flex items-center gap-2 pl-1.5 pr-3.5 sm:pl-2 sm:pr-4 py-1.5 bg-gradient-to-r from-sky-100 dark:from-sky-500/25 to-white dark:to-slate-800 backdrop-blur-md text-slate-700 dark:text-slate-100 font-black rounded-full ring-1 ring-inset ring-slate-200/80 dark:ring-slate-700 shadow-lg shadow-slate-900/5 dark:shadow-black/20 hover:ring-sky-300 dark:hover:ring-sky-600 transition-all duration-200 hover:-translate-y-0.5 active:scale-95 cursor-pointer"
                        title={IS_STATIC ? '全局全图鉴智能搜索' : '全局全图鉴智能搜索 (快捷键: Ctrl+K 或 /)'}
                    >
                      <div className="w-7 h-7 rounded-full bg-sky-100 dark:bg-sky-500/15 text-[#2B78C4] dark:text-sky-300 flex items-center justify-center shrink-0">
                        <Search className="w-3.5 h-3.5" />
                      </div>

                      <span className="text-xs sm:text-sm tracking-wide">
                  全域图鉴搜索
                </span>

                      {!IS_STATIC && (
                        <span className="hidden sm:inline-flex items-center gap-0.5">
                          <kbd className="inline-flex items-center text-[10px] font-mono font-bold bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 px-1.5 py-0.5 rounded-lg ring-1 ring-inset ring-slate-200 dark:ring-slate-600">Ctrl</kbd>
                          <kbd className="inline-flex items-center text-[10px] font-mono font-bold bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 px-1.5 py-0.5 rounded-lg ring-1 ring-inset ring-slate-200 dark:ring-slate-600">K</kbd>
                        </span>
                      )}
                    </button>
                    )}

                    {/* 切换图鉴：放在全域搜索按钮下方 */}
                    {onToggleAtlasMode && (
                        <button
                            id="global-floating-fire-atlas-mode-fab"
                            type="button"
                            onClick={() => {
                              sound.playClick();
                              onToggleAtlasMode();
                            }}
                            className="relative flex items-center gap-2 pl-1.5 pr-3.5 sm:pl-2 sm:pr-4 py-1.5 bg-gradient-to-r from-violet-100 dark:from-violet-500/25 to-white dark:to-slate-800 backdrop-blur-md text-slate-700 dark:text-slate-100 font-black rounded-full ring-1 ring-inset ring-slate-200/80 dark:ring-slate-700 shadow-lg shadow-slate-900/5 dark:shadow-black/20 hover:ring-violet-300 dark:hover:ring-violet-600 transition-all duration-200 hover:-translate-y-0.5 active:scale-95 cursor-pointer"
                            title={`切换图鉴（当前 - ${atlasMode === 'pokedex' ? '全图鉴' : '共创图鉴'}）`}
                        >
                          <div className="w-7 h-7 rounded-full bg-violet-100 dark:bg-violet-500/15 text-violet-600 dark:text-violet-300 flex items-center justify-center shrink-0">
                            <Layers className="w-3.5 h-3.5" />
                          </div>
                          <span className="text-xs sm:text-sm tracking-wide">切换图鉴（当前 - {atlasMode === 'pokedex' ? '全图鉴' : '共创图鉴'}）</span>
                        </button>
                    )}

                  </div>
              )}
            </div>
        )}

        {/* 2. Global Floating Search Modal Palette */}
        {isSearchOpen && (
            <div
                className="fixed inset-0 z-50 flex items-start justify-center p-3 sm:p-6 pt-12 sm:pt-20 bg-slate-900/55 backdrop-blur-sm overflow-y-auto overscroll-contain animate-in fade-in duration-150"
                onClick={() => setIsOpen(false)}
            >
              <div
                  className="relative w-full max-w-3xl bg-white dark:bg-slate-900 rounded-[26px] shadow-2xl ring-1 ring-slate-900/5 dark:ring-white/10 overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-200 transition-colors"
                  onClick={(e) => e.stopPropagation()}
              >
                {/* Header */}
                <ModalHeader
                    icon={Search}
                    tone="sky"
                    title="全域精灵图鉴检索"
                    badge={
                      <ModalHeaderBadge>
                        跨 {maps.length} 张地图 · 共 {totalAllPets} 只
                      </ModalHeaderBadge>
                    }
                    subtitle="支持拼音与模糊查询，方向键选择、回车跳转"
                    onClose={() => setIsOpen(false)}
                    closeTitle="关闭 (Esc)"
                    actions={
                      <span className="hidden sm:inline-flex items-center text-[11px] text-slate-400 dark:text-slate-500 mr-0.5">
                        按
                        <kbd className="mx-1 font-mono bg-white dark:bg-slate-700 px-1.5 py-0.5 rounded-md text-slate-500 dark:text-slate-300 ring-1 ring-inset ring-slate-200 dark:ring-slate-600">ESC</kbd>
                        退出
                      </span>
                    }
                />

                {/* ── 搜索与筛选面板（独立于渐变头部，保持输入区可读性） ── */}
                <div className="px-4 sm:px-5 pt-3 pb-3 bg-slate-50/80 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800 shrink-0">
                  {/* Large Input Box */}
                  <div className="relative">
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5">
                      <Search className={`absolute inset-0 w-5 h-5 text-[#7ABCF4] transition-opacity duration-200 ${searchMode === 'skill' ? 'opacity-0' : 'opacity-100'}`} />
                      <Sparkles className={`absolute inset-0 w-5 h-5 text-violet-500 transition-opacity duration-200 ${searchMode === 'skill' ? 'opacity-100' : 'opacity-0'}`} />
                    </div>
                    <input
                        ref={inputRef}
                        type="text"
                        value={searchQuery}
                        onChange={(e) => {
                          setSearchQuery(e.target.value);
                          setFocusedIndex(0);
                        }}
                        onKeyDown={handleKeyDownInInput}
                        placeholder={searchMode === 'skill' ? '输入技能/特性名或描述，查找拥有它的精灵...' : '输入精灵名、图鉴id实时查找...'}
                        className={`w-full pl-12 ${searchQuery ? 'pr-24' : 'pr-14'} h-11 text-sm sm:text-[15px] bg-white dark:bg-slate-800 ring-1 ring-inset rounded-xl outline-hidden text-slate-800 dark:text-slate-100 font-bold transition-all duration-200 placeholder:font-normal shadow-sm ${
                            searchMode === 'skill'
                                ? 'ring-violet-300 dark:ring-violet-500/60 focus:ring-2 focus:ring-violet-500 dark:focus:ring-violet-400 bg-violet-50/60 dark:bg-slate-800 placeholder:text-violet-400'
                                : 'ring-slate-200 dark:ring-slate-700 focus:ring-2 focus:ring-[#7ABCF4] dark:focus:ring-sky-500 placeholder:text-slate-400'
                        }`}
                    />
                    <button
                        type="button"
                        onClick={() => {
                          sound.playClick();
                          setSearchMode(searchMode === 'skill' ? 'name' : 'skill');
                          setFocusedIndex(0);
                          inputRef.current?.focus();
                        }}
                        title={searchMode === 'skill' ? '当前为技能/特性搜索，点击切回精灵名/图鉴id搜索' : '开启技能/特性搜索（按技能名、技能描述、特性名、特性描述查找精灵）'}
                        className={`absolute right-2.5 top-1/2 -translate-y-1/2 w-9 h-9 rounded-xl flex items-center justify-center transition-colors cursor-pointer border focus:outline-none ${
                            searchMode === 'skill'
                                ? 'bg-violet-100 dark:bg-violet-500/25 border-violet-300 text-violet-600 dark:text-violet-300'
                                : 'bg-transparent border-transparent text-slate-400 hover:text-violet-500 hover:bg-violet-50 dark:hover:bg-violet-500/10'
                        }`}
                    >
                      <Wand2 className="w-4 h-4" />
                    </button>
                    {searchQuery && (
                        <button
                            onClick={() => {
                              setSearchQuery('');
                              inputRef.current?.focus();
                            }}
                            className="absolute right-[52px] top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer focus:outline-none"
                        >
                          <X className="w-4 h-4" />
                        </button>
                    )}
                  </div>

                  {/* Filter Tabs Row */}
                  <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                    {/* Map Filter */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 shrink-0">地图</span>
                      <button
                          onClick={() => {
                            sound.playClick();
                            setSelectedMapFilter('all');
                            setFocusedIndex(0);
                          }}
                          className={`h-7 px-2.5 rounded-lg text-[11px] font-black transition-all cursor-pointer ring-1 ring-inset ${
                              selectedMapFilter === 'all'
                                  ? 'bg-slate-700 dark:bg-sky-600 text-white ring-transparent shadow-sm'
                                  : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 ring-slate-200 dark:ring-slate-700 hover:ring-slate-300 dark:hover:ring-slate-600'
                          }`}
                      >
                        全部
                      </button>
                      {maps.map((m) => (
                          <button
                              key={m.id}
                              onClick={() => {
                                sound.playClick();
                                setSelectedMapFilter(m.num);
                                setFocusedIndex(0);
                              }}
                              className={`h-7 px-2.5 rounded-lg text-[11px] font-black transition-all cursor-pointer flex items-center gap-1 ring-1 ring-inset ${
                                  selectedMapFilter === m.num
                                      ? `${mapTone(m.num).chip} shadow-sm`
                                      : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 ring-slate-200 dark:ring-slate-700 hover:ring-slate-300 dark:hover:ring-slate-600'
                              }`}
                          >
                            <span>{m.num}、{m.name.replace('记忆中的', '')}</span>
                          </button>
                      ))}
                    </div>

                    {/* Status Filter */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 shrink-0">状态</span>
                      <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800">
                        {([
                          { id: 'all', label: '全部', count: totalAllPets, tone: 'text-[#2B78C4] dark:text-sky-400', icon: null },
                          { id: 'unencountered', label: '未遇见', count: totalUnencounteredAll, tone: 'text-emerald-600 dark:text-emerald-400', icon: Sparkles },
                          { id: 'encountered', label: '已遇见', count: totalEncounteredAll, tone: 'text-amber-600 dark:text-amber-400', icon: Check },
                        ] as const).map((s) => {
                          const active = selectedStatusFilter === s.id;
                          const Icon = s.icon;
                          return (
                            <button
                              key={s.id}
                              onClick={() => {
                                sound.playClick();
                                setSelectedStatusFilter(s.id);
                                setFocusedIndex(0);
                              }}
                              className={`h-7 px-2 rounded-lg text-[11px] font-black flex items-center gap-1 transition-all cursor-pointer ${
                                active
                                  ? `bg-white dark:bg-slate-900 shadow-sm ${s.tone}`
                                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                              }`}
                            >
                              {Icon && <Icon className="w-2.5 h-2.5" />}
                              {s.label}
                              <span className={`text-[10px] font-mono ${active ? 'opacity-70' : 'opacity-60'}`}>{s.count}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Results Counter Banner */}
                <div className="px-5 py-2 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 font-bold shrink-0">
                  <span>
                    {searchMode === 'skill' ? '找到 ' : '找到 '}
                    <strong className="text-[#2B78C4] dark:text-sky-400">{filteredResults.length}</strong>
                    {searchMode === 'skill' ? ' 只拥有相关技能/特性的精灵' : ' 只相关精灵'}
                  </span>
                  <span className="text-[11px] text-slate-400 hidden sm:inline-block">
                点击精灵卡片即可快速跳转至该地图并定位 · 或点击右侧快捷勾选
              </span>
                </div>

                {/* Scrollable Results List */}
                <div
                    ref={resultsContainerRef}
                    className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-2.5 max-h-[50vh]"
                >
                  {filteredResults.length === 0 ? (
                      <div className="py-16 text-center text-slate-400 flex flex-col items-center justify-center">
                        <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 mb-2">
                          <Search className="w-6 h-6" />
                        </div>
                        <p className="text-sm font-black text-slate-700 dark:text-slate-200">未找到符合条件的精灵</p>
                        <p className="text-xs text-slate-400 mt-1">
                          {searchMode === 'skill'
                            ? '请尝试更换技能/特性关键词，或点输入框右侧按钮切回精灵名搜索'
                            : '请尝试检查拼写，或切换地图/遇见状态筛选条件'}
                        </p>
                      </div>
                  ) : (
                      filteredResults.map((item, index) => {
                        const isFocused = focusedIndex === index;

                        return (
                            <div
                                key={`${item.mapConfig.id}_${item.rawName}`}
                                onClick={() => handleSelectPet(item)}
                                className={`group relative p-3 rounded-2xl ring-inset transition-all flex items-center justify-between gap-3 cursor-pointer ${
                                    isFocused
                                        ? 'bg-sky-50 dark:bg-sky-950/40 ring-2 ring-[#7ABCF4] dark:ring-sky-500 shadow-sm'
                                        : item.isEncountered
                                            ? 'bg-emerald-50/50 dark:bg-emerald-950/20 ring-1 ring-emerald-100 dark:ring-emerald-900/40 hover:ring-emerald-300 dark:hover:ring-emerald-700'
                                            : 'bg-white dark:bg-slate-800/70 ring-1 ring-slate-200 dark:ring-slate-700 hover:ring-slate-300 dark:hover:ring-slate-600 hover:shadow-sm'
                                }`}
                            >
                              {/* Left: Avatar + Details */}
                              <div className="flex items-center gap-3.5 min-w-0">
                                {/* Pet Image Avatar */}
                                <div className="relative w-12 h-12 rounded-xl bg-white dark:bg-slate-900 p-1 ring-1 ring-inset ring-slate-200/70 dark:ring-slate-700 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                                  <PetSprite
                                      pet={item.pet}
                                      alt={item.cleanName}
                                      className="w-full h-full object-contain"
                                  />
                                  {item.pet.id != null && (
                                      <span className="absolute top-0.5 right-0.5 z-10 text-[8px] font-mono font-black leading-none px-1 py-0.5 rounded bg-slate-800/70 text-white/90">
                                        #{item.pet.id}
                                      </span>
                                  )}
                                  <ElementBadges
                                      elements={item?.pet?.elements}
                                      className="absolute top-0.5 left-0.5 z-10"
                                      size="sm"
                                  />
                                  {item.isEncountered && (
                                      <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-[#95D151] rounded-full flex items-center justify-center text-white shadow-xs border border-white">
                                        <Check className="w-2.5 h-2.5 stroke-[3]" />
                                      </div>
                                  )}
                                </div>

                                {/* Text Info */}
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <h4 className="text-sm font-black text-slate-800 dark:text-slate-100 truncate" title={item.cleanName}>
                                      {item.cleanName}
                                    </h4>

                                    {/* Map Tag */}
                                    <span
                                        className={`text-[10px] font-black px-2 py-0.5 rounded-md border flex items-center gap-1 ${mapTone(item.mapConfig.num).tag}`}
                                    >
                              <MapPin className="w-2.5 h-2.5" />
                                      {item.mapConfig.num}、{item.mapConfig.name.replace('记忆中的', '')}
                            </span>
                                  </div>

                                  {searchMode === 'skill' && (
                                    <div className="mt-0.5 flex flex-wrap gap-1">
                                      {getMatchedSkillTags(item).map((tag) => (
                                        <span key={tag.label} className={`text-[10px] font-black px-1.5 py-0.5 rounded-md border ${
                                            tag.type === 'skill'
                                                ? 'bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:border-violet-500/30'
                                                : 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30'
                                        }`}>{tag.type === 'skill' ? '技能 · ' : '特性 · '}{tag.label}</span>
                                      ))}
                                    </div>
                                  )}
                                  {/* Secondary status text */}
                                  <p className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1.5">
                                    {item.isEncountered ? (
                                        <span className="text-[#2D6613] dark:text-emerald-400 font-bold flex items-center gap-1">
                                <Check className="w-3 h-3 text-[#2D6613] dark:text-emerald-400" /> 已在当前关卡点亮
                              </span>
                                    ) : (
                                        <span className="text-amber-600 dark:text-amber-400 font-bold flex items-center gap-1">
                                <Sparkles className="w-3 h-3 text-amber-500" /> 尚未在图鉴中遇见
                              </span>
                                    )}
                              </p>
                                </div>
                              </div>

                              {/* Right: Quick Actions */}
                              <div className="flex items-center gap-2 shrink-0">
                                {/* Direct Toggle Encounter Button */}
                                <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      sound.playClick();
                                      onToggleEncounter(item.mapConfig.id, item.rawName);
                                    }}
                                    className={`px-2.5 py-1.5 rounded-xl text-xs font-black border transition-all flex items-center gap-1 cursor-pointer ${
                                        item.isEncountered
                                            ? 'bg-[#E1F7DB] dark:bg-emerald-950/60 hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:text-rose-700 dark:hover:text-rose-400 hover:border-rose-300 text-[#2D6613] dark:text-emerald-300 border-[#95D151]'
                                            : 'bg-white dark:bg-slate-700 hover:bg-[#E1F7DB] dark:hover:bg-emerald-950/60 hover:text-[#2D6613] dark:hover:text-emerald-300 hover:border-[#95D151] text-slate-600 dark:text-slate-200 border-slate-200 dark:border-slate-600 shadow-2xs'
                                    }`}
                                    title={item.isEncountered ? '点击取消该精灵图鉴遇见' : '快捷标记为【已遇见】'}
                                >
                                  <Check className="w-3.5 h-3.5" />
                                  <span className="hidden xs:inline-block">
                            {item.isEncountered ? '已遇见' : '标记遇见'}
                          </span>
                                </button>

                                {/* Navigate Button */}
                                <div className="w-8 h-8 rounded-xl bg-[#F5F9FF] dark:bg-slate-700 group-hover:bg-[#7ABCF4] dark:group-hover:bg-sky-500 group-hover:text-white text-[#2B78C4] dark:text-sky-300 flex items-center justify-center transition-colors border border-[#E6EEF8] dark:border-slate-600">
                                  <ArrowRight className="w-4 h-4" />
                                </div>
                              </div>
                            </div>
                        );
                      })
                  )}
                </div>

                {/* Bottom Keyboard Hints & Summary */}
                <div className="p-3.5 bg-slate-50 dark:bg-slate-800/60 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400 shrink-0">
                  <div className="flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <kbd className="font-mono bg-white dark:bg-slate-700 px-1.5 py-0.5 rounded text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-600 shadow-2xs">↑</kbd>
                  <kbd className="font-mono bg-white dark:bg-slate-700 px-1.5 py-0.5 rounded text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-600 shadow-2xs">↓</kbd>
                  <span>选择</span>
                </span>
                    <span className="flex items-center gap-1">
                  <kbd className="font-mono bg-white dark:bg-slate-700 px-1.5 py-0.5 rounded text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-600 shadow-2xs">Enter</kbd>
                  <span>跳转到对应关卡</span>
                </span>
                  </div>

                  <div className="text-[11px] text-slate-400">
                    {IS_STATIC ? (
                      <>支持拼音与模糊查询</>
                    ) : (
                      <>支持拼音与模糊查询 · 随时随地按 <kbd className="font-mono bg-white dark:bg-slate-700 px-1 py-0.5 rounded text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-600">Ctrl+K</kbd> 唤出</>
                    )}
                  </div>
                </div>
              </div>
            </div>
        )}
      </>
  );
};
