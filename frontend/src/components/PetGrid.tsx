import React, { useState, useMemo, useEffect } from 'react';
import { Sparkles, Check, Sparkle, Filter, Info, Bug } from 'lucide-react';
import { MapConfig, PetItem, EncounterRecord, AdvancedFilterState } from '../types';
import { sound } from '../services/sound';
import { IS_STATIC } from '../services/staticMode';
import { formatPetName, isPetEncounteredInRecords, getBasePetName } from '../utils/petHelper';
import { ElementBadges } from './ElementBadges';

interface PetGridProps {
  currentMap: MapConfig;
  pets: PetItem[];
  records: Record<string, EncounterRecord>;
  onToggleEncounter: (mapId: string, filename: string) => void;
  filterMode: 'all' | 'encountered' | 'unencountered';
  onFilterChange?: (mode: 'all' | 'encountered' | 'unencountered') => void;
  searchQuery: string;
  onOpenPetDetail?: (pet: PetItem) => void;
  onOpenFeedback?: (type: string, pet: PetItem) => void;
  advancedFilters: AdvancedFilterState;
}

export const PetGrid: React.FC<PetGridProps> = ({
                                                  currentMap,
                                                  pets,
                                                  records,
                                                  onToggleEncounter,
                                                  filterMode,
                                                  onFilterChange,
                                                  searchQuery,
                                                  onOpenPetDetail,
                                                  onOpenFeedback,
                                                  advancedFilters,
                                                }) => {
  // Track keys of pets that were just toggled to encountered / unencountered
  const [animatingKeys, setAnimatingKeys] = useState<Record<string, boolean>>({});
  const [unanimatingKeys, setUnanimatingKeys] = useState<Record<string, boolean>>({});
  const [contextMenu, setContextMenu] = useState<{ pet: PetItem; x: number; y: number } | null>(null);
  const totalCount = pets.length;

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

  const handleCardClick = (petName: string, currentlyEncountered: boolean) => {
    const key = `${currentMap.id}_${petName}`;

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

    onToggleEncounter(currentMap.id, petName);
  };


  // Filter pets by mode, query and advanced filters
  const filteredPets = useMemo(() => {
    return pets.filter((pet) => {
      const isEnc = isPetEncounteredInRecords(records, currentMap.id, pet.name);

      if (filterMode === 'encountered' && !isEnc) return false;
      if (filterMode === 'unencountered' && isEnc) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const cleanName = formatPetName(pet.name).toLowerCase();
        const baseName = getBasePetName(pet.name).toLowerCase();
        const rawName = pet.name.toLowerCase();
        const idMatch = String(pet.id ?? '').includes(q);
        const matchesSearch = cleanName.includes(q) || rawName.includes(q) || baseName.includes(q) || idMatch;
        if (!matchesSearch) return false;
      }

      // Elements Filter
      if (advancedFilters.elements.length > 0) {
        if (!pet.elements || !pet.elements.some((el) => advancedFilters.elements.includes(el))) {
          return false;
        }
      }

      // Special Types Filter (Boss / Multi-form)
      if (advancedFilters.specialTypes.length > 0) {
        const isSeqGreater = pet.seq !== undefined && pet.seq > 1;
        const cleanName = formatPetName(pet.name);
        const hasUnderscore = cleanName.includes('_');

        const isBoss = isSeqGreater && !hasUnderscore;
        const isMultiForm = isSeqGreater && hasUnderscore;

        let matchesSpecial = false;
        if (advancedFilters.specialTypes.includes('boss') && isBoss) {
          matchesSpecial = true;
        }
        if (advancedFilters.specialTypes.includes('multiform') && isMultiForm) {
          matchesSpecial = true;
        }

        if (!matchesSpecial) return false;
      }

      return true;
    });
  }, [pets, records, currentMap.id, filterMode, searchQuery, advancedFilters]);


  return (
      <div className="bg-white roco-card p-5 sm:p-6">
        {/* Section Header */}
        <div className="flex items-center justify-between gap-3 pb-4 border-b-2 border-[#F1F5F9] mb-5">
          <div className="flex items-center gap-2.5">
            <div
                className="w-10 h-10 rounded-2xl flex items-center justify-center text-white font-black text-sm shrink-0"
                style={{ backgroundColor: currentMap.themeColor }}
            >
              {currentMap.num}
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-black text-slate-800 tracking-tight flex items-center gap-2 flex-wrap">
                <span>{currentMap.name}</span>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-[#F5F9FF] text-[#2B78C4] font-mono font-black border border-[#E6EEF8] flex items-center gap-1">
                <span>已遇见 <strong className="text-[#2D6613] font-black">{encounteredCount}</strong> / {totalCount}</span>
                  {filterMode !== 'all' && (
                      <span className="text-[10px] text-slate-400 font-normal">
                    (当前显示 {filteredPets.length})
                  </span>
                  )}
              </span>
              </h3>
              <p className="text-xs text-slate-500">
                点击卡片即可直接切换【已遇见 / 未遇见】状态
              </p>
            </div>
          </div>
        </div>

        {/* Empty State */}
        {filteredPets.length === 0 ? (
            <div className="py-16 text-center text-slate-400 flex flex-col items-center">
              <Sparkles className="w-10 h-10 text-slate-300 mb-2" />
              <p className="text-sm font-black text-slate-600">未找到符合条件的精灵</p>
              <p className="text-xs text-slate-400 mt-1">请尝试调整搜索关键词或切换筛选条件</p>
            </div>
        ) : (
            /* Uniform Grid of Scaled Pet Icons - Responsive density on mobile phones & desktop */
            <div className="grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] sm:grid-cols-[repeat(auto-fill,145px)] justify-center gap-2 sm:gap-4">
              {filteredPets.map((pet) => {
                const key = `${currentMap.id}_${pet.name}`;
                const isEnc = isPetEncounteredInRecords(records, currentMap.id, pet.name);
                const isJustEncountered = !!animatingKeys[key];

                return (
                    <div
                        key={pet.name}
                        id={`pet-card-${currentMap.id}-${pet.name.replace('.', '-')}`}
                        onClick={() => handleCardClick(pet.name, isEnc)}
                        onContextMenu={IS_STATIC ? (e) => {
                          // web 版删除右键菜单：拦截默认菜单但不打开自定义菜单
                          e.preventDefault();
                          e.stopPropagation();
                        } : (e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setContextMenu({ pet, x: e.clientX, y: e.clientY });
                        }}
                        className={`group relative rounded-xl sm:rounded-2xl p-1.5 sm:p-2.5 flex flex-col items-center cursor-pointer transition-all duration-200 select-none ${
                            isJustEncountered
                                ? 'encounter-pop-active bg-[#F2FBF0] border-2 border-[#95D151] ring-2 ring-[#95D151]/40'
                                : isEnc
                                    ? 'bg-[#F2FBF0] border-2 border-[#95D151] hover:border-[#76B032]'
                                    : 'bg-[#F5F9FF] border-2 border-[#E6EEF8] hover:border-[#7ABCF4] hover:bg-white'
                        }`}
                    >
                      {/* Floating sparkle badge during encounter activation */}
                      {isJustEncountered && (
                          <div className="absolute -top-3.5 z-20 encounter-sparkle-active bg-gradient-to-r from-[#95D151] to-[#76B032] text-white text-[10px] font-black px-2 py-0.5 rounded-full border border-white flex items-center gap-1 pointer-events-none">
                            <Sparkle className="w-2.5 h-2.5 fill-white text-white" />
                            <span>点亮图鉴</span>
                          </div>
                      )}

                      {/* Fixed Uniform Image Container - 1:1 Aspect Ratio with object-contain */}
                      <div className="relative w-full aspect-square rounded-lg sm:rounded-xl bg-white p-1 sm:p-1.5 flex items-center justify-center overflow-hidden border border-[#E6EEF8]">
                        {pet.id != null && (
                            <span className="absolute top-1 right-1 z-[1] text-[8px] sm:text-[9px] font-mono font-black px-1 sm:px-1.5 py-0.2 sm:py-0.5 rounded-md bg-slate-800/70 text-white/90">
                              #{pet.id}
                            </span>
                        )}
                        <ElementBadges
                            elements={pet?.elements}
                            className="absolute top-1 left-1 z-10 scale-90 sm:scale-100 origin-top-left"
                            size="xs"
                        />
                        <img
                            src={pet.url}
                            alt={pet.name}
                            draggable={false}
                            className={`w-full h-full object-contain pointer-events-none transition-transform duration-200 ${
                                isJustEncountered
                                    ? 'scale-105'
                                    : 'group-hover:scale-105'
                            }`}
                            loading="lazy"
                        />
                      </div>

                      {/* Pet Name Label */}
                      <div className="mt-1 sm:mt-2 w-full text-center">
                        <p
                            className={`text-[11px] sm:text-xs font-black truncate transition-colors duration-200 ${
                                isEnc ? 'text-[#2D6613]' : 'text-slate-700'
                            }`}
                            title={formatPetName(pet.name)}
                        >
                          {formatPetName(pet.name)}
                        </p>
                      </div>

                      {/* Status indicator pill */}
                      <div className="mt-1 sm:mt-2 flex items-center justify-center w-full">
                        {isEnc ? (
                            <span className="text-[10px] sm:text-[11px] font-black text-[#2D6613] bg-[#E1F7DB] px-1.5 sm:px-2.5 py-0.5 rounded-md w-full text-center border border-[#95D151]/40 truncate">
                      已遇见
                    </span>
                        ) : (
                            <span className="text-[10px] sm:text-[11px] font-medium text-slate-400 bg-white px-1.5 sm:px-2 py-0.5 rounded-md w-full text-center border border-slate-200 group-hover:border-[#BCD7F2] group-hover:text-slate-600 transition-colors truncate">
                      未探索
                    </span>
                        )}
                      </div>
                    </div>
                );
              })}
            </div>
        )}

        {/* 右键菜单：精灵详情 / 反馈 */}
        {contextMenu && (
            <div
                className="fixed z-50 w-48 bg-white rounded-xl border-2 border-slate-200 shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-100"
                style={{
                  left: Math.min(contextMenu.x, window.innerWidth - 200),
                  top: Math.min(contextMenu.y, window.innerHeight - 250),
                }}
                onClick={(e) => e.stopPropagation()}
            >
              <button
                  type="button"
                  onClick={() => {
                    onOpenPetDetail?.(contextMenu.pet);
                    setContextMenu(null);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-black text-slate-700 hover:bg-[#F0F7FF] hover:text-[#2B78C4] transition-colors cursor-pointer"
              >
                <Info className="w-4 h-4 text-[#7ABCF4]" />
                精灵详情
              </button>

              <button
                  type="button"
                  onClick={() => {
                    onOpenFeedback?.('精灵图鉴纠错', contextMenu.pet);
                    setContextMenu(null);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-bold text-slate-600 hover:bg-rose-50 hover:text-rose-600 transition-colors cursor-pointer"
              >
                <Bug className="w-4 h-4 text-slate-400" />
                反馈错误
              </button>
            </div>
        )}
      </div>
  );
};
