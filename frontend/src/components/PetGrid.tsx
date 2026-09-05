import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Sparkles, Check, Sparkle, Filter, Info, Bug, RotateCcw } from 'lucide-react';
import { MapConfig, PetItem, EncounterRecord, AdvancedFilterState } from '../types';
import { sound } from '../services/sound';
import { IS_STATIC } from '../services/staticMode';
import { formatPetName, isPetEncounteredInRecords, getBasePetName, getPetSpecialType } from '../utils/petHelper';
import { ElementBadges } from './ElementBadges';
import { PetSprite } from './PetSprite';
import { PetSpecialTag } from './PetSpecialTag';
import { PetSkillPanel } from './PetSkillPanel';
import { petKeyOf } from '../services/atlasCollector';
import { storage } from '../services/storage';

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
  onOpenPetDetail,
  onOpenFeedback,
  advancedFilters,
  communityAtlas,
  minAgreeRatio = 0,
  onAtlasVote,
  communityCard = false,
}) => {
  // Track keys of pets that were just toggled to encountered / unencountered
  const [animatingKeys, setAnimatingKeys] = useState<Record<string, boolean>>({});
  const [unanimatingKeys, setUnanimatingKeys] = useState<Record<string, boolean>>({});
  const [contextMenu, setContextMenu] = useState<{ pet: PetItem; x: number; y: number } | null>(null);
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

  const totalCount = pets.length;

  useEffect(() => {
    const unsub = storage.subscribeSettings((settings) => {
      if (typeof settings.showPetSkillHover === 'boolean') {
        setShowSkillHover(settings.showPetSkillHover);
      }
    });
    return unsub;
  }, []);

  // 悬浮显示（设定 380ms 适当防抖等待，避免滑过即闪烁）与鼠标移开即刻消失
  const handleCardMouseEnter = (e: React.MouseEvent<HTMLDivElement>, pet: PetItem) => {
    if (!showSkillHover) return;
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    const rect = e.currentTarget.getBoundingClientRect();
    const placement = rect.right + 330 > window.innerWidth ? 'left' : 'right';
    const placementY = rect.top + 260 > window.innerHeight ? 'bottom' : 'top';
    const x = placement === 'right' ? rect.right + 10 : rect.left - 10;
    const y = placementY === 'bottom' ? rect.bottom : rect.top;

    hoverTimerRef.current = setTimeout(() => {
      setHoveredPet({ pet, x, y, placement, placementY });
    }, 380);
  };

  const handleCardMouseLeave = () => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    // 鼠标移出卡片，立即清空消失，绝不滞留
    setHoveredPet(null);
  };

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

      // 社区赞同率过滤（minAgreeRatio>0 时仅显示达到阈值的社区精灵）
      if (minAgreeRatio && minAgreeRatio > 0) {
        const pk = petKeyOf(pet.name, pet.id, pet.seq);
        const ci = pk ? communityAtlas?.[`${currentMap.id}:${pk}`] : undefined;
        if (!ci || (ci.agree_ratio ?? 0) < minAgreeRatio) return false;
      }

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
        const specialType = getPetSpecialType(pet);
        const matchesSpecial =
            (advancedFilters.specialTypes.includes('boss') && specialType === 'boss') ||
            (advancedFilters.specialTypes.includes('multiform') && specialType === 'multiform');
        if (!matchesSpecial) return false;
      }

      return true;
    });
  }, [pets, records, currentMap.id, filterMode, searchQuery, advancedFilters, minAgreeRatio, communityAtlas]);


  return (
      <div className="bg-white dark:bg-slate-800 roco-card p-5 sm:p-6 border-2 border-transparent dark:border-slate-700/80 transition-colors">
        {/* Section Header */}
        <div className="flex items-center justify-between gap-3 pb-4 border-b-2 border-[#F1F5F9] dark:border-slate-700/80 mb-5">
          <div className="flex items-center gap-2.5">
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

        {/* Empty State */}
        {filteredPets.length === 0 ? (
            <div className="py-16 text-center text-slate-400 flex flex-col items-center">
              <Sparkles className="w-10 h-10 text-slate-300 dark:text-slate-600 mb-2" />
              <p className="text-sm font-black text-slate-600 dark:text-slate-300">未找到符合条件的精灵</p>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">请尝试调整搜索关键词或切换筛选条件</p>
            </div>
        ) : (
            /* Uniform Grid of Scaled Pet Icons - Responsive density on mobile phones & desktop */
            <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] sm:grid-cols-[repeat(auto-fill,150px)] justify-center gap-2.5 sm:gap-4">
              {filteredPets.map((pet) => {
                const key = `${currentMap.id}_${pet.name}`;
                const isEnc = isPetEncounteredInRecords(records, currentMap.id, pet.name);
                const isJustEncountered = !!animatingKeys[key];
                const petKey = petKeyOf(pet.name, pet.id, pet.seq);
                const communityInfo = petKey ? communityAtlas?.[`${currentMap.id}:${petKey}`] : undefined;

                return (
                  <div
                    key={pet.name}
                    id={`pet-card-${currentMap.id}-${pet.name.replace('.', '-')}`}
                    onClick={() => handleCardClick(pet.name, isEnc)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
                      setHoveredPet(null);
                      setContextMenu({ pet, x: e.clientX, y: e.clientY });
                    }}
                    onMouseEnter={(e) => handleCardMouseEnter(e, pet)}
                    onMouseLeave={handleCardMouseLeave}
                    className={`group relative rounded-2xl p-2 sm:p-3 flex flex-col items-center cursor-pointer transition-all duration-200 select-none ${
                      isJustEncountered
                        ? 'encounter-pop-active bg-[#F2FBF0] dark:bg-emerald-950/40 border-2 border-[#95D151] ring-2 ring-[#95D151]/40'
                        : isEnc
                          ? 'bg-gradient-to-b from-[#F2FBF0] to-[#EAF7E8] dark:from-emerald-950/30 dark:to-slate-900/60 border-2 border-[#95D151] dark:border-emerald-600 hover:border-[#76B032] shadow-xs'
                          : 'bg-white dark:bg-slate-800/80 border-2 border-slate-200/80 dark:border-slate-700/80 hover:border-sky-400 dark:hover:border-sky-500 hover:shadow-md'
                    }`}
                  >
                    {/* Floating sparkle badge during encounter activation */}
                    {isJustEncountered && (
                      <div className="absolute -top-3.5 z-20 encounter-sparkle-active bg-gradient-to-r from-[#95D151] to-[#76B032] text-white text-[10px] font-black px-2 py-0.5 rounded-full border border-white flex items-center gap-1 pointer-events-none shadow-md">
                        <Sparkle className="w-2.5 h-2.5 fill-white text-white" />
                        <span>点亮图鉴</span>
                      </div>
                    )}

                    {/* Quick Info Button for direct modal access */}
                    <button
                      id={`pet-card-info-btn-${pet.name.replace('.', '-')}`}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenPetDetail?.(pet);
                      }}
                      className="opacity-0 group-hover:opacity-100 sm:opacity-0 focus:opacity-100 transition-opacity absolute top-1.5 right-1.5 z-20 w-5 h-5 rounded-md bg-white/90 dark:bg-slate-800/90 hover:bg-sky-500 hover:text-white text-slate-400 dark:text-slate-300 flex items-center justify-center shadow-xs cursor-pointer border border-slate-200 dark:border-slate-700"
                      title="查看精灵详情与全技能"
                    >
                      <Info className="w-3 h-3" />
                    </button>

                    {/* Fixed Uniform Image Container - 1:1 Aspect Ratio with object-contain */}
                    {communityCard ? (
                      /* 共创图鉴（火系）：头部行吃进立绘容器顶部 */
                      <div className="relative w-full aspect-square rounded-xl bg-slate-50 dark:bg-slate-900/90 p-1 sm:p-1.5 flex flex-col overflow-hidden border border-slate-100 dark:border-slate-800">
                        {/* 头部行：左系别图标、右图鉴编号 */}
                        <div className="flex items-start justify-between w-full shrink-0 z-10">
                          <ElementBadges elements={pet?.elements} size="sm" />
                          {pet.id != null && (
                            <span className="text-[9px] font-mono font-bold text-slate-400 dark:text-slate-500 leading-none">
                              #{pet.id}
                            </span>
                          )}
                        </div>

                        {/* 置信度 */}
                        {(() => {
                          const conf = communityInfo?.confidence ?? 0;
                          const tcls = conf >= 0.7 ? 'text-emerald-600 dark:text-emerald-400' : conf >= 0.3 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400';
                          return (
                            <div className="absolute -top-[3px] left-0 right-0 z-[2] text-center pointer-events-none">
                              <span className={`text-[8px] sm:text-[9px] font-mono font-black px-1 py-0.5 rounded-full ${tcls}`}>
                                置信度：{Math.round(conf * 100)}%
                              </span>
                            </div>
                          );
                        })()}

                        {/* 立绘 */}
                        <div className="flex-1 min-h-0 w-full flex items-center justify-center">
                          <PetSprite
                            pet={pet}
                            alt={pet.name}
                            className={`w-full h-full object-contain pointer-events-none transition-transform duration-200 ${
                              isJustEncountered ? 'scale-110' : 'group-hover:scale-108'
                            }`}
                          />
                        </div>

                        {/* 进度条 */}
                        {communityInfo && onAtlasVote && (() => {
                          const vr = communityInfo.vote_ratio ?? 0;
                          const vc = communityInfo.voter_count ?? 0;
                          const tc = communityInfo.total_users ?? 0;
                          const barCls = vr >= 0.5 ? 'bg-emerald-500' : vr >= 0.25 ? 'bg-amber-400' : 'bg-rose-400';
                          return (
                            <div className="flex items-center gap-1 w-full shrink-0 pt-0.5">
                              <div className="flex-1 h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${barCls}`}
                                  style={{ width: `${Math.min(100, Math.round(vr * 100))}%` }}
                                />
                              </div>
                              <span className="text-[9px] font-mono font-bold leading-none shrink-0 text-slate-500 dark:text-slate-400">
                                {vc}/{tc}
                              </span>
                            </div>
                          );
                        })()}

                        {/* 多形态/首领化 */}
                        <div className="absolute right-0.5 top-1/2 -translate-y-1/2 z-[1] pointer-events-none">
                          <PetSpecialTag pet={pet} vertical />
                        </div>
                      </div>
                    ) : (
                      /* 经典布局：编号/系别图标叠加在立绘上 */
                      <div className="relative w-full aspect-square rounded-xl bg-slate-50/70 dark:bg-slate-900/70 p-1 sm:p-1.5 flex items-center justify-center overflow-hidden border border-slate-100 dark:border-slate-800/80">
                        {pet.id != null && (
                          <span className="absolute top-1 right-1 z-[1] text-[8px] sm:text-[9px] font-mono font-black px-1.5 py-0.5 rounded-md bg-slate-900/60 text-white/90 backdrop-blur-xs">
                            #{pet.id}
                          </span>
                        )}
                        <ElementBadges
                          elements={pet?.elements}
                          className="absolute top-1 left-1 sm:top-1.5 sm:left-1.5 z-10 drop-shadow-xs"
                          size="sm"
                        />
                        <PetSprite
                          pet={pet}
                          alt={pet.name}
                          className={`w-full h-full object-contain pointer-events-none transition-transform duration-200 ${
                            isJustEncountered ? 'scale-110' : 'group-hover:scale-108'
                          }`}
                        />
                        {/* 多形态/首领化 */}
                        <div className="absolute bottom-1 left-0 right-0 z-[1] flex justify-center pointer-events-none">
                          <PetSpecialTag pet={pet} />
                        </div>
                      </div>
                    )}

                    {/* Pet Name Label */}
                    <div className="mt-1.5 w-full text-center">
                      <p
                        className={`text-[11px] sm:text-xs font-black truncate transition-colors duration-200 ${
                          isEnc ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-800 dark:text-slate-100'
                        }`}
                        title={formatPetName(pet.name)}
                      >
                        {formatPetName(pet.name)}
                      </p>
                    </div>

                    {/* 社区图鉴 / 状态 indicator */}
                    {communityCard && onAtlasVote ? (
                      <div className="mt-1.5 flex items-center justify-between w-full">
                        {(() => {
                          const myVote = communityInfo?.my_vote ?? 'none';
                          const renderBtn = (type: 'agree' | 'disagree', label: string) => {
                            const active = type === 'agree' ? myVote === 'agree' : myVote === 'disagree';
                            return (
                              <button
                                key={type}
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onAtlasVote(currentMap.id, petKey, pet.name, type);
                                }}
                                className={`text-[10px] font-black w-5 h-5 sm:w-6 sm:h-6 rounded-md border flex items-center justify-center transition-colors select-none ${
                                  active
                                    ? type === 'agree' ? 'bg-emerald-500 border-emerald-500 text-white' : 'bg-rose-500 border-rose-500 text-white'
                                    : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400 dark:text-slate-500 hover:border-slate-300 dark:hover:border-slate-600 hover:text-slate-500 dark:hover:text-slate-300'
                                } cursor-pointer`}
                                title={type === 'agree' ? '赞同' : '不赞同'}
                              >
                                {label}
                              </button>
                            );
                          };
                          return (
                            <>
                              {renderBtn('agree', '✓')}
                              <span className={`text-[10px] sm:text-[11px] font-black leading-none truncate ${
                                isEnc ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500'
                              }`}>
                                {isEnc ? '已遇见' : '未探索'}
                              </span>
                              {renderBtn('disagree', '✕')}
                            </>
                          );
                        })()}
                      </div>
                    ) : (
                      /* 遇见状态微药丸 */
                      <div className="mt-1.5 flex items-center justify-center w-full">
                        {isEnc ? (
                          <span className="text-[10px] sm:text-[11px] font-black text-emerald-700 dark:text-emerald-300 bg-emerald-500/15 dark:bg-emerald-950/60 px-2 py-0.5 rounded-lg w-full text-center border border-emerald-500/30 dark:border-emerald-600/40 truncate">
                            已遇见
                          </span>
                        ) : (
                          <span className="text-[10px] sm:text-[11px] font-semibold text-slate-400 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/80 px-2 py-0.5 rounded-lg w-full text-center border border-slate-200 dark:border-slate-700 group-hover:border-sky-300 dark:group-hover:border-sky-600 group-hover:text-sky-600 dark:group-hover:text-sky-300 transition-colors truncate">
                            未探索
                          </span>
                        )}
                      </div>
                    )}
                  </div>
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
                    <span>标记为【未探索】</span>
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
