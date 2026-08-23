import React, { useState, useEffect, useMemo } from 'react';
import { Filter, Check, EyeOff, MapPin, RefreshCw, ChevronLeft, ChevronRight, ChevronsDown, ChevronsUp, Layers } from 'lucide-react';
import { PetItem, EncounterRecord, MapConfig, FloatingButtonsMode } from '../types';
import { sound } from '../services/sound';
import { storage } from '../services/storage';
import { MAP_CONFIGS } from '../data/mockPets';
import { isPetEncounteredInRecords } from '../utils/petHelper';

interface FloatingFilterSwitchProps {
    currentMap: MapConfig;
    pets: PetItem[];
    records: Record<string, EncounterRecord>;
    filterMode: 'all' | 'encountered' | 'unencountered';
    onFilterChange: (mode: 'all' | 'encountered' | 'unencountered') => void;
    onCycleMap?: () => void;
}

export const FloatingFilterSwitch: React.FC<FloatingFilterSwitchProps> = ({
                                                                              currentMap,
                                                                              pets,
                                                                              records,
                                                                              filterMode,
                                                                              onFilterChange,
                                                                              onCycleMap,
                                                                          }) => {
    const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
        return storage.getSetting<boolean>('isFilterSwitchCollapsed', false);
    });

    const [floatingMode, setFloatingMode] = useState<FloatingButtonsMode>(() => {
        return storage.getSetting<FloatingButtonsMode>('floatingButtonsMode', 'normal');
    });

    // Sync settings when storage updates
    useEffect(() => {
        const unsubscribe = storage.subscribeSettings((settings) => {
            if (typeof settings.isFilterSwitchCollapsed === 'boolean') {
                setIsCollapsed(settings.isFilterSwitchCollapsed);
            }
            if (settings.floatingButtonsMode) {
                setFloatingMode(settings.floatingButtonsMode);
            }
        });
        return () => unsubscribe();
    }, []);

    const handleToggleCollapse = (collapsed: boolean) => {
        sound.playClick();
        setIsCollapsed(collapsed);
        storage.setSetting('isFilterSwitchCollapsed', collapsed);
    };

    const totalCount = pets.length;

    const encounteredCount = useMemo(() => {
        return pets.filter((p) => isPetEncounteredInRecords(records, currentMap.id, p.name)).length;
    }, [pets, records, currentMap.id]);

    const unencounteredCount = Math.max(0, totalCount - encounteredCount);

    // Next map name for tooltip
    const nextMap = useMemo(() => {
        const nextNum = (currentMap.num % MAP_CONFIGS.length) + 1;
        return MAP_CONFIGS.find((m) => m.num === nextNum) || MAP_CONFIGS[0];
    }, [currentMap.num]);

    // If hidden, do not render floating UI
    if (floatingMode === 'hidden') {
        return null;
    }

    // If compact mode: icon-only minimalist floating column
    if (floatingMode === 'compact') {
        return (
            <div
                id="floating-filter-switch-compact"
                className="fixed bottom-6 left-6 z-40 flex flex-col items-center gap-2 select-none animate-in fade-in zoom-in-95 duration-200"
            >
                {/* Map Switcher Icon Circle */}
                <button
                    type="button"
                    id="floating-map-switcher-compact-btn"
                    onClick={() => {
                        sound.playClick();
                        if (onCycleMap) onCycleMap();
                    }}
                    className="w-11 h-11 rounded-full flex items-center justify-center text-white text-xs font-black shadow-xl shadow-slate-900/15 border-2 border-white transition-transform hover:scale-110 active:scale-95 cursor-pointer"
                    style={{ backgroundColor: currentMap.themeColor }}
                    title={`当前: ${currentMap.name} (${encounteredCount}/${totalCount}) - 点击切换到【${nextMap.name}】`}
                >
                    <span className="drop-shadow-xs">{currentMap.num}</span>
                </button>

                {/* Filter Mode Icon Pills */}
                <div className="flex flex-col gap-1.5 p-1 bg-white/95 backdrop-blur-md rounded-2xl border-2 border-white shadow-xl shadow-slate-900/10">
                    <button
                        type="button"
                        onClick={() => {
                            sound.playClick();
                            onFilterChange('all');
                        }}
                        className={`w-9 h-9 rounded-xl flex items-center justify-center text-xs font-black transition-all cursor-pointer ${
                            filterMode === 'all'
                                ? 'bg-[#7ABCF4] text-white shadow-sm'
                                : 'text-slate-600 hover:bg-slate-100'
                        }`}
                        title={`全部精灵 (${totalCount})`}
                    >
                        <Filter className="w-4 h-4" />
                    </button>

                    <button
                        type="button"
                        onClick={() => {
                            sound.playClick();
                            onFilterChange('encountered');
                        }}
                        className={`w-9 h-9 rounded-xl flex items-center justify-center text-xs font-black transition-all cursor-pointer ${
                            filterMode === 'encountered'
                                ? 'bg-[#95D151] text-white shadow-sm'
                                : 'text-slate-600 hover:bg-slate-100'
                        }`}
                        title={`已遇见精灵 (${encounteredCount})`}
                    >
                        <Check className="w-4 h-4 stroke-[3]" />
                    </button>

                    <button
                        type="button"
                        onClick={() => {
                            sound.playClick();
                            onFilterChange('unencountered');
                        }}
                        className={`w-9 h-9 rounded-xl flex items-center justify-center text-xs font-black transition-all cursor-pointer ${
                            filterMode === 'unencountered'
                                ? 'bg-amber-500 text-white shadow-sm'
                                : 'text-slate-600 hover:bg-slate-100'
                        }`}
                        title={`未遇见精灵 (${unencounteredCount})`}
                    >
                        <EyeOff className="w-4 h-4" />
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div
            id="floating-filter-switch-container"
            className="fixed bottom-6 left-6 z-40 flex flex-col items-start select-none"
        >
            {isCollapsed ? (
                /* Collapsed 小圆球 */
                <button
                    type="button"
                    id="floating-filter-expand-btn"
                    onClick={() => handleToggleCollapse(false)}
                    className="w-10 h-10 rounded-full flex items-center justify-center text-white shadow-xl shadow-slate-900/10 hover:shadow-2xl transition-all duration-200 cursor-pointer hover:scale-105 active:scale-95 border-2 border-white"
                    style={{ backgroundColor: currentMap.themeColor }}
                    title={`当前: ${currentMap.name} (${encounteredCount}/${totalCount}) - 点击展开左侧筛选栏`}
                >
                    <span className="text-sm font-black drop-shadow-xs">{currentMap.num}</span>
                </button>
            ) : (
                /* Expanded Stack (Arranged vertically from bottom to top) */
                <div className="flex flex-col-reverse items-start gap-2">
                    {/* Bottom-most Bar: Map Switcher Button + Collapse Toggle */}
                    <div className="flex items-center gap-1.5 p-1 bg-white/95 backdrop-blur-md rounded-2xl border-2 border-white shadow-xl shadow-slate-900/10">
                        {/* 1. Map Switcher (First Button) - Clicking cycles through maps */}
                        <button
                            type="button"
                            id="floating-map-switcher-btn"
                            onClick={() => {
                                sound.playClick();
                                if (onCycleMap) {
                                    onCycleMap();
                                }
                            }}
                            className="flex items-center gap-2 px-3 py-2 rounded-xl text-white text-xs font-black shadow-xs transition-all duration-200 hover:brightness-110 active:scale-95 cursor-pointer group"
                            style={{ backgroundColor: currentMap.themeColor }}
                            title={`点击切换地图: 当前【${currentMap.name}】 ➜ 下一张【${nextMap.name}】`}
                        >
                            <MapPin className="w-3.5 h-3.5 text-[#FEE061]" />
                            <span className="tracking-wide">{currentMap.num}、{currentMap.name.replace('记忆中的', '')}</span>
                            <span className="font-mono text-[10px] bg-black/20 px-1.5 py-0.5 rounded-full font-bold">
                {encounteredCount}/{totalCount}
              </span>
                            <RefreshCw className="w-3 h-3 opacity-75 group-hover:rotate-180 transition-transform duration-500" />
                        </button>

                        {/* Collapse Button */}
                        <button
                            type="button"
                            id="floating-filter-collapse-btn"
                            onClick={() => handleToggleCollapse(true)}
                            className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-400 hover:text-slate-700 flex items-center justify-center transition-colors cursor-pointer"
                            title="收起左侧悬浮筛选栏"
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </button>
                    </div>

                    {/* Above the map switcher: Vertical Filter Modes Stack (From bottom to top: 全部 -> 已遇见 -> 未遇见) */}
                    <div className="flex flex-col gap-1.5 p-1.5 bg-white/95 backdrop-blur-md rounded-2xl border-2 border-white shadow-lg shadow-slate-900/10">
                        {/* Filter 1: 全部 */}
                        <button
                            type="button"
                            id="floating-filter-all-btn"
                            onClick={() => {
                                sound.playClick();
                                onFilterChange('all');
                            }}
                            className={`w-full min-w-[130px] px-3 py-1.5 rounded-xl text-xs font-black transition-all duration-200 flex items-center justify-between gap-2 cursor-pointer ${
                                filterMode === 'all'
                                    ? 'bg-gradient-to-r from-[#7ABCF4] to-[#5DA8E8] text-white shadow-md shadow-sky-500/20'
                                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80'
                            }`}
                            title="显示所有精灵"
                        >
                            <div className="flex items-center gap-1.5">
                                <Filter className="w-3.5 h-3.5" />
                                <span>全部</span>
                            </div>
                            <span
                                className={`font-mono text-[10px] px-1.5 py-0.2 rounded-full ${
                                    filterMode === 'all'
                                        ? 'bg-white/25 text-white'
                                        : 'bg-slate-100 text-slate-500'
                                }`}
                            >
                {totalCount}
              </span>
                        </button>

                        {/* Filter 2: 已遇见 */}
                        <button
                            type="button"
                            id="floating-filter-encountered-btn"
                            onClick={() => {
                                sound.playClick();
                                onFilterChange('encountered');
                            }}
                            className={`w-full min-w-[130px] px-3 py-1.5 rounded-xl text-xs font-black transition-all duration-200 flex items-center justify-between gap-2 cursor-pointer ${
                                filterMode === 'encountered'
                                    ? 'bg-gradient-to-r from-[#95D151] to-[#7CB342] text-white shadow-md shadow-emerald-500/20'
                                    : 'text-[#2D6613] hover:bg-[#E1F7DB]/60'
                            }`}
                            title="只查看已遇见的精灵"
                        >
                            <div className="flex items-center gap-1.5">
                                <Check className="w-3.5 h-3.5" />
                                <span>已遇见</span>
                            </div>
                            <span
                                className={`font-mono text-[10px] px-1.5 py-0.2 rounded-full ${
                                    filterMode === 'encountered'
                                        ? 'bg-white/25 text-white font-black'
                                        : 'bg-[#E1F7DB] text-[#2D6613]'
                                }`}
                            >
                {encounteredCount}
              </span>
                        </button>

                        {/* Filter 3: 未遇见 */}
                        <button
                            type="button"
                            id="floating-filter-unencountered-btn"
                            onClick={() => {
                                sound.playClick();
                                onFilterChange('unencountered');
                            }}
                            className={`w-full min-w-[130px] px-3 py-1.5 rounded-xl text-xs font-black transition-all duration-200 flex items-center justify-between gap-2 cursor-pointer ${
                                filterMode === 'unencountered'
                                    ? 'bg-gradient-to-r from-[#FEE061] to-[#F59E0B] text-[#854D0E] shadow-md shadow-amber-500/20'
                                    : 'text-slate-600 hover:text-slate-900 hover:bg-amber-50/70'
                            }`}
                            title="只查看未遇见的精灵"
                        >
                            <div className="flex items-center gap-1.5">
                                <EyeOff className="w-3.5 h-3.5" />
                                <span>未遇见</span>
                            </div>
                            <span
                                className={`font-mono text-[10px] px-1.5 py-0.2 rounded-full ${
                                    filterMode === 'unencountered'
                                        ? 'bg-[#854D0E]/20 text-[#673B08] font-black'
                                        : 'bg-amber-100 text-amber-800'
                                }`}
                            >
                {unencounteredCount}
              </span>
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
