import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Search,
  X,
  Sparkles,
  Check,
  MapPin,
  ArrowRight,
  ExternalLink,
  SlidersHorizontal,
  Command,
  HelpCircle,
  Layers,
  ChevronRight,
  ChevronLeft,
} from 'lucide-react';
import { MapConfig, PetItem, EncounterRecord } from '../types';
import { MAP_CONFIGS } from '../data/mockPets';
import { sound } from '../services/sound';
import { storage } from '../services/storage';
import { formatPetName } from '../utils/petHelper';

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
  onOpenBatchInit?: () => void;
  onOpenSingleRecognizer?: () => void;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export const GlobalFloatingSearch: React.FC<GlobalFloatingSearchProps> = ({
  allMapsPets,
  records,
  onNavigateToPet,
  onToggleEncounter,
  onOpenBatchInit,
  onOpenSingleRecognizer,
  isOpen: controlledIsOpen,
  onOpenChange,
}) => {
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
  const [searchQuery, setSearchQuery] = useState<string>('');
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

  // Focus input when modal opens
  useEffect(() => {
    if (isSearchOpen) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
      setFocusedIndex(0);
    } else {
      setSearchQuery('');
    }
  }, [isSearchOpen]);

  // Compile all pets across all maps into a searchable array
  const allPetsList: GlobalSearchPetResult[] = useMemo(() => {
    const list: GlobalSearchPetResult[] = [];

    MAP_CONFIGS.forEach((map) => {
      const mapKey = `map${map.num}`;
      const items = allMapsPets[mapKey]?.items || [];

      items.forEach((pet) => {
        const key = `${map.id}_${pet.name}`;
        const isEnc = !!records[key]?.encountered;
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
  }, [allMapsPets, records]);

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

      // Filter by text search (clean name, raw name, map name)
      if (q) {
        const cleanMatch = item.cleanName.toLowerCase().includes(q);
        const rawMatch = item.rawName.toLowerCase().includes(q);
        const mapMatch = item.mapConfig.name.toLowerCase().includes(q);
        return cleanMatch || rawMatch || mapMatch;
      }

      return true;
    });
  }, [allPetsList, searchQuery, selectedMapFilter, selectedStatusFilter]);

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

  const handleSelectPet = (item: GlobalSearchPetResult) => {
    sound.playClick();
    onNavigateToPet(item.mapConfig.num, item.pet.name);
    setIsOpen(false);
  };

  return (
    <>
      {/* 1. Global Floating Action Buttons (FABs) on Screen (Bottom-Right) */}
      <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end select-none">
        {isFABCollapsed ? (
          /* Collapsed Mini Floating FAB */
          <button
            type="button"
            id="global-floating-expand-fab"
            onClick={() => handleToggleCollapse(false)}
            className="flex items-center gap-2 px-3.5 py-2.5 bg-white/95 backdrop-blur-md hover:bg-white text-slate-700 rounded-full border-2 border-white shadow-xl shadow-slate-900/10 hover:shadow-2xl transition-all duration-200 group cursor-pointer hover:scale-105"
            title="展开右侧快捷功能悬浮栏 (搜索与批量初始化)"
          >
            <div className="w-5 h-5 rounded-full bg-slate-100 group-hover:bg-[#7ABCF4] group-hover:text-white text-slate-400 flex items-center justify-center transition-colors">
              <ChevronLeft className="w-3.5 h-3.5" />
            </div>

            <div className="w-6 h-6 rounded-full bg-gradient-to-r from-[#7ABCF4] to-[#5DA8E8] text-white flex items-center justify-center shadow-xs">
              <Search className="w-3.5 h-3.5" />
            </div>

            <span className="text-xs font-black text-slate-800">
              功能
            </span>

            <span className="text-xs font-mono font-black px-1.5 py-0.2 rounded-full bg-amber-100 text-[#854D0E]">
              📸
            </span>
          </button>
        ) : (
          /* Expanded FABs Stack */
          <div className="flex flex-col items-end gap-2">
            {/* Collapse Toggle Row */}
            <div className="flex items-center gap-1.5 p-1 bg-white/95 backdrop-blur-md rounded-2xl border-2 border-white shadow-md shadow-slate-900/5 self-end">
              <span className="text-[11px] font-black text-slate-500 px-2 py-0.5">
                快捷面板
              </span>
              <button
                type="button"
                id="global-floating-collapse-fab"
                onClick={() => handleToggleCollapse(true)}
                className="w-7 h-7 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-400 hover:text-slate-700 flex items-center justify-center transition-colors cursor-pointer"
                title="收起右侧快捷悬浮栏"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* 1. 跟随识别 (窗口跟随识别按钮 - 支持 pywebview open_scanner_to_app 独立窗口与直接打开兜底) */}
            <button
              id="global-floating-follow-fab"
              type="button"
              onClick={async () => {
                sound.playClick();

                let openedViaPywebview = false;

                // 尝试调用 pywebview API 打开独立窗口 (open_scanner_to_app)
                try {
                  const pyApi = (window as any).pywebview?.api;
                  if (pyApi) {
                    if (typeof pyApi.open_scanner_to_app === 'function') {
                      await pyApi.open_scanner_to_app('洛克王国：世界');
                      openedViaPywebview = true;
                    } else if (typeof pyApi.open_scanner_window === 'function') {
                      await pyApi.open_scanner_window();
                      openedViaPywebview = true;
                    }
                  }
                } catch (e) {
                  console.warn('调用 pywebview.api 失败，使用兜底直接打开:', e);
                }
              }}
              className="relative flex items-center gap-2 px-3.5 sm:px-4 py-2.5 bg-gradient-to-r from-[#8B5CF6] via-[#6366F1] to-[#4F46E5] hover:from-[#7C3AED] hover:via-[#4F46E5] hover:to-[#4338CA] text-white font-black rounded-full shadow-lg hover:shadow-xl border-2 border-white transition-all duration-200 transform hover:-translate-y-0.5 active:scale-95 cursor-pointer"
              title="打开游戏窗口跟随识别 (AI 智能实时识别 / 独立窗口)"
            >
              <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center shadow-2xs">
                <Sparkles className="w-3.5 h-3.5 text-white" />
              </div>

              <span className="text-xs sm:text-sm font-black tracking-wide drop-shadow-xs">
                跟随识别
              </span>

              <span className="text-[10px] font-mono font-black px-1.5 py-0.5 rounded-full bg-white/20 text-white border border-white/30">
                AI
              </span>
            </button>

            {/* 2. 单个识别 */}
            {onOpenSingleRecognizer && (
              <button
                id="global-floating-single-recognizer-fab"
                type="button"
                onClick={() => {
                  sound.playClick();
                  onOpenSingleRecognizer();
                }}
                className="relative flex items-center gap-2 px-3.5 sm:px-4 py-2.5 bg-gradient-to-r from-[#95D151] to-[#689F38] hover:from-[#84C242] hover:to-[#558B2F] text-white font-black rounded-full shadow-lg hover:shadow-xl border-2 border-white transition-all duration-200 transform hover:-translate-y-0.5 active:scale-95 cursor-pointer"
                title="打开单个精灵智能识别"
              >
                <div className="w-6 h-6 rounded-full bg-white/25 flex items-center justify-center text-white shadow-2xs">
                  <Sparkles className="w-3.5 h-3.5" />
                </div>

                <span className="text-xs sm:text-sm font-black tracking-wide drop-shadow-xs">
                  单个识别 🎯
                </span>
              </button>
            )}

            {/* 3. 批量初始化 */}
            {onOpenBatchInit && (
              <button
                id="global-floating-batch-init-fab"
                type="button"
                onClick={() => {
                  sound.playClick();
                  onOpenBatchInit();
                }}
                className="relative flex items-center gap-2 px-3.5 sm:px-4 py-2.5 bg-gradient-to-r from-[#FEE061] to-[#F59E0B] hover:from-[#FDD835] hover:to-[#D97706] text-[#854D0E] font-black rounded-full shadow-lg hover:shadow-xl border-2 border-white transition-all duration-200 transform hover:-translate-y-0.5 active:scale-95 cursor-pointer"
                title="整页图鉴智能批量初始化导入"
              >
                <div className="w-6 h-6 rounded-full bg-white/40 flex items-center justify-center text-[#854D0E] shadow-2xs">
                  <Layers className="w-3.5 h-3.5" />
                </div>

                <span className="text-xs sm:text-sm font-black tracking-wide drop-shadow-2xs">
                  批量初始化
                </span>

                <span className="text-xs font-mono font-black px-1.5 py-0.5 rounded-full bg-amber-900/15 text-[#673B08] border border-amber-900/20">
                  📸
                </span>
              </button>
            )}

            {/* 4. 全域图鉴搜索 */}
            <button
              id="global-floating-search-fab"
              type="button"
              onClick={() => {
                sound.playClick();
                setIsOpen(true);
              }}
              className="relative flex items-center gap-2 px-3.5 sm:px-4 py-2.5 bg-gradient-to-r from-[#7ABCF4] to-[#5DA8E8] hover:from-[#5DA8E8] hover:to-[#2B78C4] text-white font-black rounded-full shadow-lg hover:shadow-xl border-2 border-white transition-all duration-200 transform hover:-translate-y-0.5 active:scale-95 cursor-pointer"
              title="全局全图鉴智能搜索 (快捷键: Ctrl+K 或 /)"
            >
              {/* Pulsing ring indicator */}
              <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#FEE061] opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-[#FEE061] border-2 border-white"></span>
              </span>

              <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center">
                <Search className="w-3.5 h-3.5 text-white" />
              </div>

              <span className="text-xs sm:text-sm font-black tracking-wide drop-shadow-xs">
                全域图鉴搜索
              </span>

              <kbd className="hidden sm:inline-flex items-center gap-0.5 text-[10px] font-mono font-bold bg-white/25 px-2 py-0.5 rounded-lg border border-white/40 shadow-xs">
                <Command className="w-2.5 h-2.5" /> K
              </kbd>
            </button>
          </div>
        )}
      </div>

      {/* 2. Global Floating Search Modal Palette */}
      {isSearchOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center p-3 sm:p-6 pt-12 sm:pt-20 bg-slate-900/65 backdrop-blur-xs overflow-y-auto animate-in fade-in duration-150"
          onClick={() => setIsOpen(false)}
        >
          <div
            className="relative w-full max-w-3xl bg-white rounded-3xl border-4 border-[#7ABCF4] shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Top Search Input Bar */}
            <div className="p-4 sm:p-5 bg-gradient-to-r from-[#F5F9FF] to-white border-b-2 border-[#E6EEF8] shrink-0">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-[#7ABCF4] text-white flex items-center justify-center shadow-xs">
                    <Search className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-base font-black text-slate-800 flex items-center gap-2">
                      全域精灵图鉴检索
                      <span className="text-[11px] font-black px-2 py-0.5 rounded-full bg-[#EBF4FE] text-[#2B78C4] border border-[#BCD7F2]">
                        跨 3 张地图共 {totalAllPets} 只精灵
                      </span>
                    </h3>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-slate-400 hidden sm:inline-block">
                    按 <kbd className="font-mono bg-slate-100 px-1 py-0.5 rounded text-slate-600 border border-slate-200">ESC</kbd> 退出
                  </span>
                  <button
                    onClick={() => {
                      sound.playClick();
                      setIsOpen(false);
                    }}
                    className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 flex items-center justify-center transition-colors cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Large Input Box */}
              <div className="relative">
                <Search className="w-5 h-5 text-[#7ABCF4] absolute left-4 top-1/2 -translate-y-1/2" />
                <input
                  ref={inputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setFocusedIndex(0);
                  }}
                  onKeyDown={handleKeyDownInInput}
                  placeholder="输入任意精灵名称、拼音或地图名称实时查找..."
                  className="w-full pl-12 pr-10 py-3 text-sm sm:text-base bg-white border-2 border-[#BCD7F2] focus:border-[#7ABCF4] rounded-2xl outline-hidden text-slate-800 font-bold shadow-inner transition-all placeholder:text-slate-400 placeholder:font-normal"
                />
                {searchQuery && (
                  <button
                    onClick={() => {
                      setSearchQuery('');
                      inputRef.current?.focus();
                    }}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 rounded-full cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Filter Tabs Row */}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
                {/* Map Filter */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[11px] font-black text-slate-400">地图:</span>
                  <button
                    onClick={() => {
                      sound.playClick();
                      setSelectedMapFilter('all');
                      setFocusedIndex(0);
                    }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-black transition-all cursor-pointer ${
                      selectedMapFilter === 'all'
                        ? 'bg-[#7ABCF4] text-white shadow-xs'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    全部地图
                  </button>
                  {MAP_CONFIGS.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => {
                        sound.playClick();
                        setSelectedMapFilter(m.num);
                        setFocusedIndex(0);
                      }}
                      className={`px-2.5 py-1 rounded-lg text-xs font-black transition-all cursor-pointer flex items-center gap-1 ${
                        selectedMapFilter === m.num
                          ? 'bg-[#7ABCF4] text-white shadow-xs'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      <span>{m.num}、{m.name.replace('记忆中的', '')}</span>
                    </button>
                  ))}
                </div>

                {/* Status Filter */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[11px] font-black text-slate-400">状态:</span>
                  <button
                    onClick={() => {
                      sound.playClick();
                      setSelectedStatusFilter('all');
                      setFocusedIndex(0);
                    }}
                    className={`px-2 py-0.8 rounded-lg text-[11px] font-black transition-all cursor-pointer ${
                      selectedStatusFilter === 'all'
                        ? 'bg-slate-700 text-white shadow-xs'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    全部
                  </button>
                  <button
                    onClick={() => {
                      sound.playClick();
                      setSelectedStatusFilter('unencountered');
                      setFocusedIndex(0);
                    }}
                    className={`px-2 py-0.8 rounded-lg text-[11px] font-black transition-all cursor-pointer flex items-center gap-1 ${
                      selectedStatusFilter === 'unencountered'
                        ? 'bg-[#95D151] text-white shadow-xs'
                        : 'bg-[#E1F7DB] text-[#2D6613] hover:bg-[#d5f3cb]'
                    }`}
                  >
                    <Sparkles className="w-2.5 h-2.5" />
                    未遇见 ({totalUnencounteredAll})
                  </button>
                  <button
                    onClick={() => {
                      sound.playClick();
                      setSelectedStatusFilter('encountered');
                      setFocusedIndex(0);
                    }}
                    className={`px-2 py-0.8 rounded-lg text-[11px] font-black transition-all cursor-pointer flex items-center gap-1 ${
                      selectedStatusFilter === 'encountered'
                        ? 'bg-slate-600 text-white shadow-xs'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    <Check className="w-2.5 h-2.5" />
                    已遇见 ({totalEncounteredAll})
                  </button>
                </div>
              </div>
            </div>

            {/* Results Counter Banner */}
            <div className="px-5 py-2 bg-[#F5F9FF] border-b border-[#E6EEF8] flex items-center justify-between text-xs text-slate-500 font-bold shrink-0">
              <span>找到 <strong className="text-[#2B78C4]">{filteredResults.length}</strong> 只相关精灵</span>
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
                  <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400 mb-2">
                    <Search className="w-6 h-6" />
                  </div>
                  <p className="text-sm font-black text-slate-700">未找到符合条件的精灵</p>
                  <p className="text-xs text-slate-400 mt-1">
                    请尝试检查拼写，或切换地图/遇见状态筛选条件
                  </p>
                </div>
              ) : (
                filteredResults.map((item, index) => {
                  const isFocused = focusedIndex === index;

                  return (
                    <div
                      key={`${item.mapConfig.id}_${item.rawName}`}
                      onClick={() => handleSelectPet(item)}
                      className={`group relative p-3 rounded-2xl border-2 transition-all flex items-center justify-between gap-3 cursor-pointer ${
                        isFocused
                          ? 'border-[#7ABCF4] bg-[#F0F7FF] shadow-md ring-2 ring-[#7ABCF4]/40'
                          : item.isEncountered
                          ? 'border-[#95D151]/50 bg-[#F9FEF8] hover:border-[#95D151] hover:shadow-sm'
                          : 'border-[#E6EEF8] bg-white hover:border-[#7ABCF4] hover:bg-[#F8FAFC] hover:shadow-sm'
                      }`}
                    >
                      {/* Left: Avatar + Details */}
                      <div className="flex items-center gap-3.5 min-w-0">
                        {/* Pet Image Avatar */}
                        <div className="relative w-12 h-12 rounded-xl bg-white p-1 border border-[#E6EEF8] shadow-inner flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                          <img
                            src={item.pet.url}
                            alt={item.cleanName}
                            className="w-full h-full object-contain"
                            loading="lazy"
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
                            <h4 className="text-sm font-black text-slate-800 truncate" title={item.cleanName}>
                              {item.cleanName}
                            </h4>

                            {/* Map Tag */}
                            <span
                              className="text-[10px] font-black px-2 py-0.5 rounded-md border flex items-center gap-1"
                              style={{
                                backgroundColor: item.mapConfig.num === 1 ? '#E1F7DB' : item.mapConfig.num === 2 ? '#FEF9E6' : '#EBF4FE',
                                color: item.mapConfig.num === 1 ? '#2D6613' : item.mapConfig.num === 2 ? '#854D0E' : '#1D5E9E',
                                borderColor: item.mapConfig.num === 1 ? '#95D151' : item.mapConfig.num === 2 ? '#FEE061' : '#7ABCF4',
                              }}
                            >
                              <MapPin className="w-2.5 h-2.5" />
                              {item.mapConfig.num}、{item.mapConfig.name.replace('记忆中的', '')}
                            </span>
                          </div>

                          {/* Secondary status text */}
                          <p className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1.5">
                            {item.isEncountered ? (
                              <span className="text-[#2D6613] font-bold flex items-center gap-1">
                                <Check className="w-3 h-3 text-[#2D6613]" /> 已在当前地图点亮
                              </span>
                            ) : (
                              <span className="text-amber-600 font-bold flex items-center gap-1">
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
                              ? 'bg-[#E1F7DB] hover:bg-rose-50 hover:text-rose-700 hover:border-rose-300 text-[#2D6613] border-[#95D151]'
                              : 'bg-white hover:bg-[#E1F7DB] hover:text-[#2D6613] hover:border-[#95D151] text-slate-600 border-slate-200 shadow-2xs'
                          }`}
                          title={item.isEncountered ? '点击取消该精灵图鉴遇见' : '快捷标记为【已遇见】'}
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span className="hidden xs:inline-block">
                            {item.isEncountered ? '已遇见' : '标记遇见'}
                          </span>
                        </button>

                        {/* Navigate Button */}
                        <div className="w-8 h-8 rounded-xl bg-[#F5F9FF] group-hover:bg-[#7ABCF4] group-hover:text-white text-[#2B78C4] flex items-center justify-center transition-colors border border-[#E6EEF8]">
                          <ArrowRight className="w-4 h-4" />
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Bottom Keyboard Hints & Summary */}
            <div className="p-3.5 bg-slate-50 border-t-2 border-[#E6EEF8] flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500 shrink-0">
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <kbd className="font-mono bg-white px-1.5 py-0.5 rounded text-slate-700 border border-slate-300 shadow-2xs">↑</kbd>
                  <kbd className="font-mono bg-white px-1.5 py-0.5 rounded text-slate-700 border border-slate-300 shadow-2xs">↓</kbd>
                  <span>选择</span>
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="font-mono bg-white px-1.5 py-0.5 rounded text-slate-700 border border-slate-300 shadow-2xs">Enter</kbd>
                  <span>跳转地图定位</span>
                </span>
              </div>

              <div className="text-[11px] text-slate-400">
                支持拼音与模糊查询 · 随时随地按 <kbd className="font-mono bg-white px-1 py-0.5 rounded text-slate-600 border border-slate-300">Ctrl+K</kbd> 唤出
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
