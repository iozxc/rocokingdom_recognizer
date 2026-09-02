import React, { useState, useMemo, useEffect } from 'react';
import { Sparkles, Check, Sparkle, Filter, Info, Bug } from 'lucide-react';
import { MapConfig, PetItem, EncounterRecord, AdvancedFilterState } from '../types';
import { sound } from '../services/sound';
import { IS_STATIC } from '../services/staticMode';
import { formatPetName, isPetEncounteredInRecords, getBasePetName } from '../utils/petHelper';
import { ElementBadges } from './ElementBadges';
import { PetSprite } from './PetSprite';
import { petKeyOf } from '../services/atlasCollector';

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
  }, [pets, records, currentMap.id, filterMode, searchQuery, advancedFilters, minAgreeRatio, communityAtlas]);


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
              <Sparkles className="w-10 h-10 text-slate-300 dark:text-slate-600 mb-2" />
              <p className="text-sm font-black text-slate-600 dark:text-slate-300">未找到符合条件的精灵</p>
              <p className="text-xs text-slate-400 mt-1">请尝试调整搜索关键词或切换筛选条件</p>
            </div>
        ) : (
            /* Uniform Grid of Scaled Pet Icons - Responsive density on mobile phones & desktop */
            <div className="grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] sm:grid-cols-[repeat(auto-fill,145px)] justify-center gap-2 sm:gap-4">
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
                                ? 'encounter-pop-active bg-[#F2FBF0] dark:bg-emerald-950/40 border-2 border-[#95D151] ring-2 ring-[#95D151]/40'
                                : isEnc
                                    ? 'bg-[#F2FBF0] dark:bg-emerald-950/30 border-2 border-[#95D151] dark:border-emerald-600 hover:border-[#76B032]'
                                    : 'bg-[#F5F9FF] dark:bg-slate-800 border-2 border-[#E6EEF8] dark:border-slate-700 hover:border-[#7ABCF4] dark:hover:border-sky-500 hover:bg-white dark:hover:bg-slate-750'
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
                      {communityCard ? (
                          /* 共创图鉴（火系）：头部行吃进立绘容器顶部（aspect-square 不变，卡片高度与草系一致） */
                          <div className="relative w-full aspect-square rounded-lg sm:rounded-xl bg-white dark:bg-slate-900 p-1 sm:p-1.5 flex flex-col overflow-hidden border border-[#E6EEF8] dark:border-slate-700">
                            {/* 头部行：左系别图标、右图鉴编号（轻量小元素） */}
                            <div className="flex items-start justify-between w-full shrink-0">
                              <ElementBadges
                                  elements={pet?.elements}
                                  size="xs"
                              />
                              {pet.id != null && (
                                  <span className="text-[8px] sm:text-[9px] font-mono font-black text-slate-400 leading-none">
                                    #{pet.id}
                                  </span>
                              )}
                            </div>
                            {/* 置信度（Wilson 下界）：悬浮在精灵图标顶部居中 */}
                            {(() => {
                              const conf = communityInfo?.confidence ?? 0;
                              const tcls = conf >= 0.7 ? 'text-green-600 dark:text-green-400' : conf >= 0.3 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400';
                              return (
                                  <div className="absolute -top-[3px] left-0 right-0 z-[2] text-center">
                                    <span className={`text-[8px] sm:text-[9px] font-mono font-black px-1 py-0.5 rounded-full ${tcls}`}>
                                      置信度：{Math.round(conf * 100)}%
                                    </span>
                                  </div>
                              );
                            })()}
                            {/* 立绘：核心视觉区，占据剩余全部空间 */}
                            <div className="flex-1 min-h-0 w-full flex items-center justify-center">
                              <PetSprite
                                  pet={pet}
                                  alt={pet.name}
                                  className={`w-full h-full object-contain pointer-events-none transition-transform duration-200 ${
                                      isJustEncountered
                                          ? 'scale-105'
                                          : 'group-hover:scale-105'
                                  }`}
                              />
                            </div>
                            {/* 票数/总人数进度条：叠在立绘下方（投票数占比），有共创数据才显示 */}
                            {communityInfo && onAtlasVote && (() => {
                              const vr = communityInfo.vote_ratio ?? 0;
                              const vc = communityInfo.voter_count ?? 0;
                              const tc = communityInfo.total_users ?? 0;
                              const barCls = vr >= 0.5 ? 'bg-green-500' : vr >= 0.25 ? 'bg-amber-400' : 'bg-rose-400';
                              return (
                                  <div className="flex items-center gap-1 w-full shrink-0 pt-0.5">
                                    <div className="flex-1 h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                      <div
                                          className={`h-full rounded-full ${barCls}`}
                                          style={{ width: `${Math.min(100, Math.round(vr * 100))}%` }}
                                      />
                                    </div>
                                    <span className="text-[9px] sm:text-[10px] font-mono font-black leading-none shrink-0 text-slate-600 dark:text-slate-400">
                                      {vc}/{tc}
                                    </span>
                                  </div>
                              );
                            })()}
                          </div>
                      ) : (
                          /* 草系经典：编号/系别图标叠加在立绘上 */
                          <div className="relative w-full aspect-square rounded-lg sm:rounded-xl bg-white dark:bg-slate-900 p-1 sm:p-1.5 flex items-center justify-center overflow-hidden border border-[#E6EEF8] dark:border-slate-700">
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
                            <PetSprite
                                pet={pet}
                                alt={pet.name}
                                className={`w-full h-full object-contain pointer-events-none transition-transform duration-200 ${
                                    isJustEncountered
                                        ? 'scale-105'
                                        : 'group-hover:scale-105'
                                }`}
                            />
                          </div>
                      )}

                      {/* Pet Name Label */}
                      <div className="mt-1 sm:mt-2 w-full text-center">
                        <p
                            className={`text-[11px] sm:text-xs font-black truncate transition-colors duration-200 ${
                                isEnc ? 'text-[#2D6613] dark:text-emerald-400' : 'text-slate-700 dark:text-slate-200'
                            }`}
                            title={formatPetName(pet.name)}
                        >
                          {formatPetName(pet.name)}
                        </p>
                      </div>

                      {/* 社区图鉴：✓左 状态文本 ✕右一行（进度条已叠入立绘容器底部），按钮默认浅灰线框。
                          共创图鉴卡（communityCard）全部可投票——无社区数据时按未投票/0% 处理 */}
                      {communityCard && onAtlasVote ? (
                          <div className="mt-1 flex items-center justify-between w-full">
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
                                                ? type === 'agree' ? 'bg-green-500 border-green-500 text-white' : 'bg-rose-500 border-rose-500 text-white'
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
                                        isEnc ? 'text-[#2D6613] dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500'
                                    }`}>
                                      {isEnc ? '已遇见' : '未探索'}
                                    </span>
                                    {renderBtn('disagree', '✕')}
                                  </>
                              );
                            })()}
                          </div>
                      ) : (
                          /* Status indicator pill（非社区宠保留） */
                          <div className="mt-1 sm:mt-2 flex items-center justify-center w-full">
                            {isEnc ? (
                                <span className="text-[10px] sm:text-[11px] font-black text-[#2D6613] dark:text-emerald-300 bg-[#E1F7DB] dark:bg-emerald-950/60 px-1.5 sm:px-2.5 py-0.5 rounded-md w-full text-center border border-[#95D151]/40 dark:border-emerald-600/40 truncate">
                          已遇见
                        </span>
                            ) : (
                                <span className="text-[10px] sm:text-[11px] font-medium text-slate-400 dark:text-slate-400 bg-white dark:bg-slate-800 px-1.5 sm:px-2 py-0.5 rounded-md w-full text-center border border-slate-200 dark:border-slate-700 group-hover:border-[#BCD7F2] dark:group-hover:border-sky-500 group-hover:text-slate-600 dark:group-hover:text-slate-200 transition-colors truncate">
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

        {/* 右键菜单：精灵详情 / 反馈 */}
        {contextMenu && (
            <div
                className="fixed z-50 w-48 bg-white dark:bg-slate-800 rounded-xl border-2 border-slate-200 dark:border-slate-700 shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-100"
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
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-black text-slate-700 dark:text-slate-200 hover:bg-[#F0F7FF] dark:hover:bg-slate-700 hover:text-[#2B78C4] dark:hover:text-sky-300 transition-colors cursor-pointer"
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
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:text-rose-600 dark:hover:text-rose-400 transition-colors cursor-pointer"
              >
                <Bug className="w-4 h-4 text-slate-400" />
                反馈错误
              </button>
            </div>
        )}
      </div>
  );
};
