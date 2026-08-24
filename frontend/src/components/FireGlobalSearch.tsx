import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  X,
  Sparkles,
  Check,
  MapPin,
  ArrowRight,
  Command,
  ChevronRight,
} from 'lucide-react';
import { MapConfig, PetItem, EncounterRecord, FloatingButtonsMode } from '../types';
import { sound } from '../services/sound';
import { storage } from '../services/storage';
import { formatPetName, isPetEncounteredInRecords, getBasePetName } from '../utils/petHelper';

interface FireGlobalSearchProps {
  mapsConfig: MapConfig[];
  allMapsPets: Record<string, { count: number; items: PetItem[] }>;
  records: Record<string, EncounterRecord>;
  onNavigateToPet: (mapNum: number, petName: string) => void;
  onToggleEncounter: (mapId: string, filename: string) => void;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

interface SearchResultItem {
  pet: PetItem;
  mapConfig: MapConfig;
  isEncountered: boolean;
  cleanName: string;
  rawName: string;
}

export const FireGlobalSearch: React.FC<FireGlobalSearchProps> = ({
                                                                    mapsConfig,
                                                                    allMapsPets,
                                                                    records,
                                                                    onNavigateToPet,
                                                                    onToggleEncounter,
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
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedMapFilter, setSelectedMapFilter] = useState<number | 'all'>('all');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<'all' | 'unencountered' | 'encountered'>('all');
  const [focusedIndex, setFocusedIndex] = useState<number>(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [isFABCollapsed, setIsFABCollapsed] = useState<boolean>(() => {
    return storage.getSetting<boolean>('isFABCollapsed', false);
  });
  const [floatingMode, setFloatingMode] = useState<FloatingButtonsMode>(() => {
    return storage.getSetting<FloatingButtonsMode>('floatingButtonsMode', 'normal');
  });

  // 与草系同步悬浮快捷栏设置（标准 / 纯图标 / 隐藏）
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

  // Ctrl+K / Cmd+K / / 快捷唤起
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsOpen(!isSearchOpen);
      } else if (e.key === '/' && !isInput && !isSearchOpen) {
        e.preventDefault();
        setIsOpen(true);
      } else if (e.key === 'Escape' && isSearchOpen) {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSearchOpen]);

  useEffect(() => {
    if (isSearchOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
      setFocusedIndex(0);
    } else {
      setSearchQuery('');
    }
  }, [isSearchOpen]);

  const allPetsList: SearchResultItem[] = useMemo(() => {
    const list: SearchResultItem[] = [];
    mapsConfig.forEach((map) => {
      const items = allMapsPets[map.id]?.items || [];
      items.forEach((pet) => {
        const cleanName = formatPetName(pet.name);
        list.push({
          pet,
          mapConfig: map,
          isEncountered: isPetEncounteredInRecords(records, map.id, pet.name),
          cleanName,
          rawName: pet.name,
        });
      });
    });
    return list;
  }, [mapsConfig, allMapsPets, records]);

  const filteredResults = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return allPetsList.filter((item) => {
      if (selectedMapFilter !== 'all' && item.mapConfig.num !== selectedMapFilter) return false;
      if (selectedStatusFilter === 'unencountered' && item.isEncountered) return false;
      if (selectedStatusFilter === 'encountered' && !item.isEncountered) return false;
      if (q) {
        return (
            item.cleanName.toLowerCase().includes(q) ||
            item.rawName.toLowerCase().includes(q) ||
            getBasePetName(item.rawName).toLowerCase().includes(q) ||
            item.mapConfig.name.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [allPetsList, searchQuery, selectedMapFilter, selectedStatusFilter]);

  const totalAllPets = allPetsList.length;
  const totalEncounteredAll = allPetsList.filter((i) => i.isEncountered).length;
  const totalUnencounteredAll = totalAllPets - totalEncounteredAll;

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
      const target = filteredResults[focusedIndex];
      if (target) {
        sound.playClick();
        onNavigateToPet(target.mapConfig.num, target.rawName);
        setIsOpen(false);
      }
    }
  };

  const handleSelectPet = (item: SearchResultItem) => {
    sound.playClick();
    onNavigateToPet(item.mapConfig.num, item.rawName);
    setIsOpen(false);
  };

  return (
      <>
        {/* 右下角：与草系一致的悬浮快捷栏（标准 / 纯图标 / 隐藏 + 收起展开） */}
        {floatingMode === 'hidden' ? null : floatingMode === 'compact' ? (
            <div className="fixed bottom-6 right-6 z-40 select-none animate-in fade-in zoom-in-95 duration-200">
              <button
                  type="button"
                  id="fire-global-search-compact-fab"
                  onClick={() => {
                    sound.playClick();
                    setIsOpen(true);
                  }}
                  className="w-11 h-11 rounded-full bg-gradient-to-r from-[#7ABCF4] to-[#5DA8E8] hover:from-[#5DA8E8] hover:to-[#2B78C4] text-white flex items-center justify-center shadow-xl shadow-sky-500/20 border-2 border-white transition-transform hover:scale-110 active:scale-95 cursor-pointer"
                  title="全域图鉴搜索 (Ctrl+K)"
              >
                <Search className="w-5 h-5" />
              </button>
            </div>
        ) : (
            <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end select-none">
              {isFABCollapsed ? (
                  <button
                      type="button"
                      id="fire-global-expand-fab"
                      onClick={() => handleToggleCollapse(false)}
                      className="w-10 h-10 rounded-full bg-gradient-to-r from-[#7ABCF4] to-[#5DA8E8] hover:from-[#5DA8E8] hover:to-[#2B78C4] text-white flex items-center justify-center shadow-xl shadow-slate-900/10 hover:shadow-2xl transition-all duration-200 cursor-pointer hover:scale-105 active:scale-95 border-2 border-white"
                      title="展开右侧快捷功能悬浮栏"
                  >
                    <Search className="w-5 h-5" />
                  </button>
              ) : (
                  <div className="flex flex-col items-end gap-2">
                    {/* 收起开关行 */}
                    <div className="flex items-center gap-1.5 p-1 bg-white/95 backdrop-blur-md rounded-2xl border-2 border-white shadow-md shadow-slate-900/5 self-end">
                      <span className="text-[11px] font-black text-slate-500 px-2 py-0.5">
                        快捷面板
                      </span>
                      <button
                          type="button"
                          id="fire-global-collapse-fab"
                          onClick={() => handleToggleCollapse(true)}
                          className="w-7 h-7 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-400 hover:text-slate-700 flex items-center justify-center transition-colors cursor-pointer"
                          title="收起右侧快捷悬浮栏"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>

                    {/* 全域图鉴搜索按钮 */}
                    <button
                        type="button"
                        id="fire-global-search-fab"
                        onClick={() => {
                          sound.playClick();
                          setIsOpen(true);
                        }}
                        className="relative flex items-center gap-2 px-3.5 sm:px-4 py-2.5 bg-gradient-to-r from-[#7ABCF4] to-[#5DA8E8] hover:from-[#5DA8E8] hover:to-[#2B78C4] text-white font-black rounded-full shadow-lg hover:shadow-xl border-2 border-white transition-all duration-200 transform hover:-translate-y-0.5 active:scale-95 cursor-pointer"
                        title="全域图鉴搜索 (快捷键: Ctrl+K 或 /)"
                    >
                      <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#FEE061] opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-[#FEE061] border-2 border-white"></span>
                      </span>
                      <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center">
                        <Search className="w-3.5 h-3.5 text-white" />
                      </div>
                      <span className="text-xs sm:text-sm font-black tracking-wide drop-shadow-xs">全域图鉴搜索</span>
                      <kbd className="hidden sm:inline-flex items-center gap-0.5 text-[10px] font-mono font-bold bg-white/25 px-2 py-0.5 rounded-lg border border-white/40 shadow-xs">
                        <Command className="w-2.5 h-2.5" /> K
                      </kbd>
                    </button>
                  </div>
              )}
            </div>
        )}

        {/* 全域搜索弹窗 */}
        {isSearchOpen && (
            <div
                className="fixed inset-0 z-50 flex items-start justify-center p-3 sm:p-6 pt-12 sm:pt-20 bg-slate-900/65 backdrop-blur-xs overflow-y-auto animate-in fade-in duration-150"
                onClick={() => setIsOpen(false)}
            >
              <div
                  className="relative w-full max-w-3xl bg-white rounded-3xl border-4 border-[#7ABCF4] shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-200"
                  onClick={(e) => e.stopPropagation()}
              >
                <div className="p-4 sm:p-5 bg-gradient-to-r from-[#F5F9FF] to-white border-b-2 border-[#E6EEF8] shrink-0">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-xl bg-[#7ABCF4] text-white flex items-center justify-center shadow-xs">
                        <Search className="w-4 h-4" />
                      </div>
                      <div>
                        <h3 className="text-base font-black text-slate-800 flex items-center gap-2">
                          火系全域精灵图鉴检索
                          <span className="text-[11px] font-black px-2 py-0.5 rounded-full bg-[#EBF4FE] text-[#2B78C4] border border-[#BCD7F2]">
                            跨 3 张地图共 {totalAllPets} 只精灵
                          </span>
                        </h3>
                      </div>
                    </div>
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
                        placeholder="输入任意精灵名称实时查找..."
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

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
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
                      {mapsConfig.map((m) => (
                          <button
                              key={m.id}
                              onClick={() => {
                                sound.playClick();
                                setSelectedMapFilter(m.num);
                                setFocusedIndex(0);
                              }}
                              className={`px-2.5 py-1 rounded-lg text-xs font-black transition-all cursor-pointer ${
                                  selectedMapFilter === m.num
                                      ? 'bg-[#7ABCF4] text-white shadow-xs'
                                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                              }`}
                          >
                            {m.num}、{m.name.replace('火系徽章试炼', '')}
                          </button>
                      ))}
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[11px] font-black text-slate-400">状态:</span>
                      <button
                          onClick={() => {
                            sound.playClick();
                            setSelectedStatusFilter('all');
                            setFocusedIndex(0);
                          }}
                          className={`px-2.5 py-1 rounded-lg text-xs font-black transition-all cursor-pointer ${
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
                          className={`px-2.5 py-1 rounded-lg text-xs font-black transition-all cursor-pointer flex items-center gap-1 ${
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
                          className={`px-2.5 py-1 rounded-lg text-xs font-black transition-all cursor-pointer flex items-center gap-1 ${
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

                <div className="px-5 py-2 bg-[#F5F9FF] border-b border-[#E6EEF8] flex items-center justify-between text-xs text-slate-500 font-bold shrink-0">
                  <span>找到 <strong className="text-[#2B78C4]">{filteredResults.length}</strong> 只相关精灵</span>
                  <span className="text-[11px] text-slate-400 hidden sm:inline-block">
                    点击精灵卡片即可快速跳转至该地图并定位
                  </span>
                </div>

                <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-2.5 max-h-[50vh]">
                  {filteredResults.length === 0 ? (
                      <div className="py-16 text-center text-slate-400 flex flex-col items-center justify-center">
                        <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400 mb-2">
                          <Search className="w-6 h-6" />
                        </div>
                        <p className="text-sm font-black text-slate-700">未找到符合条件的精灵</p>
                        <p className="text-xs text-slate-400 mt-1">请尝试检查拼写，或切换地图/遇见状态筛选条件</p>
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
                              <div className="flex items-center gap-3.5 min-w-0">
                                <div className="relative w-12 h-12 rounded-xl bg-white p-1 border border-[#E6EEF8] shadow-inner flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                                  <img src={item.pet.url} alt={item.cleanName} className="w-full h-full object-contain" loading="lazy" />
                                  {item.isEncountered && (
                                      <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-[#95D151] rounded-full flex items-center justify-center text-white shadow-xs border border-white">
                                        <Check className="w-2.5 h-2.5 stroke-[3]" />
                                      </div>
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <h4 className="text-sm font-black text-slate-800 truncate" title={item.cleanName}>
                                      {item.cleanName}
                                    </h4>
                                    <span className="text-[10px] font-black px-2 py-0.5 rounded-md border flex items-center gap-1 bg-orange-50 text-orange-700 border-orange-200">
                                      <MapPin className="w-2.5 h-2.5" />
                                      {item.mapConfig.num}、{item.mapConfig.name.replace('火系徽章试炼', '')}
                                    </span>
                                  </div>
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

                              <div className="flex items-center gap-2 shrink-0">
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
                                  <span className="hidden xs:inline-block">{item.isEncountered ? '已遇见' : '标记遇见'}</span>
                                </button>
                                <div className="w-8 h-8 rounded-xl bg-[#F5F9FF] group-hover:bg-[#7ABCF4] group-hover:text-white text-[#2B78C4] flex items-center justify-center transition-colors border border-[#E6EEF8]">
                                  <ArrowRight className="w-4 h-4" />
                                </div>
                              </div>
                            </div>
                        );
                      })
                  )}
                </div>
              </div>
            </div>
        )}
      </>
  );
};
