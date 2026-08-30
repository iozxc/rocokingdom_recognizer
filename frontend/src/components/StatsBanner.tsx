import React, { useState } from 'react';
import { Search, Sparkles, RotateCcw, MapPin, CheckCircle2, X, ArrowUpCircle, Filter } from 'lucide-react';
import { MapConfig, AdvancedFilterState } from '../types';
import { sound } from '../services/sound';
import { ConfirmDialog } from './ConfirmDialog';
import { AdvancedFilterPopover } from './AdvancedFilterPopover';

interface StatsBannerProps {
    currentMap: MapConfig;
    encounteredCount: number;
    totalMapPets: number;
    percentage: number;
    filterMode: 'all' | 'encountered' | 'unencountered';
    onFilterChange: (mode: 'all' | 'encountered' | 'unencountered') => void;
    searchQuery: string;
    onSearchChange: (query: string) => void;
    onResetEncounters: () => void;
    onOpenDataUpdate?: () => void;
    dataUpdateAvailable?: boolean;
    advancedFilters: AdvancedFilterState;
    onAdvancedFilterChange: (filters: AdvancedFilterState) => void;
}

export const StatsBanner: React.FC<StatsBannerProps> = ({
                                                            currentMap,
                                                            encounteredCount,
                                                            totalMapPets,
                                                            percentage,
                                                            filterMode,
                                                            onFilterChange,
                                                            searchQuery,
                                                            onSearchChange,
                                                            onResetEncounters,
                                                            onOpenDataUpdate,
                                                            dataUpdateAvailable,
                                                            advancedFilters,
                                                            onAdvancedFilterChange,
                                                        }) => {
    const [isConfirmOpen, setIsConfirmOpen] = useState<boolean>(false);
    const [isAdvancedOpen, setIsAdvancedOpen] = useState<boolean>(false);
    const unencounteredCount = Math.max(0, totalMapPets - encounteredCount);

    const activeAdvancedCount = advancedFilters.elements.length + advancedFilters.specialTypes.length;


    return (
        <div className="bg-white roco-card p-3 sm:p-5 relative mb-4 sm:mb-5 space-y-3 sm:space-y-3.5 shadow-xs border border-slate-100">
            {/* Decorative gradient aura container to handle overflow boundaries safely */}
            <div className="absolute inset-0 overflow-hidden rounded-3xl pointer-events-none">
                <div
                    className={`absolute top-0 right-0 w-96 h-96 bg-gradient-to-br ${currentMap.bgGradient} rounded-full blur-3xl -mr-20 -mt-20 opacity-40`}
                />
            </div>

            {/* Top Row: Map Header Info + Progress Tracker */}
            <div className="relative z-10 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 sm:gap-4">
                {/* Left: Map Information & Level Badge */}
                <div className="flex items-start sm:items-center gap-2.5 sm:gap-3.5 flex-1 min-w-0">
                    <div
                        className="w-10 h-10 sm:w-13 sm:h-13 rounded-2xl flex items-center justify-center text-xl sm:text-2xl border-2 shrink-0 bg-[#F5F9FF] shadow-xs"
                        style={{ borderColor: currentMap.themeColor }}
                    >
                        {currentMap.num === 1 ? '🌿' : currentMap.num === 2 ? '🗿' : currentMap.num === 3 ? '🌱' : '🔥'}
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                            <span className={`text-[10px] sm:text-[11px] font-black px-1.5 sm:px-2 py-0.5 rounded-lg border ${currentMap.badgeBg}`}>
                                地图 #{currentMap.num}
                            </span>
                            <h2 className="text-base sm:text-lg lg:text-xl font-black text-slate-800 tracking-tight flex items-center gap-1.5 truncate">
                                <MapPin className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#7ABCF4] shrink-0" />
                                <span>{currentMap.name}</span>
                            </h2>
                        </div>

                        {/* Description */}
                        <p className="text-[11px] sm:text-xs text-slate-500 mt-0.5 sm:mt-1 max-w-xl line-clamp-2 leading-relaxed">
                            {currentMap.description}
                        </p>
                    </div>
                </div>

                {/* Right: Map Dex Completion Progress Card */}
                <div className="shrink-0 w-full sm:w-72 md:w-80">
                    <div className="p-2.5 sm:p-3 bg-gradient-to-b from-[#F5F9FF] to-[#EFF6FF] rounded-2xl border border-[#D5E2F0] shadow-xs space-y-1.5">
                        <div className="flex items-center justify-between text-xs font-black text-slate-700">
                            <span className="flex items-center gap-1.5 text-[#2B78C4]">
                                <Sparkles className="w-3.5 h-3.5 text-[#FEE061]" />
                                <span>本图遇见进度</span>
                            </span>
                            <span className="font-mono text-[#2B78C4] font-black text-xs">
                                {encounteredCount} / {totalMapPets} ({percentage}%)
                            </span>
                        </div>

                        {/* Progress bar */}
                        <div className="w-full h-2.5 bg-slate-200/90 rounded-full overflow-hidden p-0.5">
                            <div
                                className="h-full rounded-full transition-all duration-500 ease-out bg-gradient-to-r from-[#95D151] to-[#7ABCF4]"
                                style={{ width: `${percentage}%` }}
                            />
                        </div>

                        {/* Progress Footer: Remaining count & Subtle Reset link */}
                        <div className="flex items-center justify-between text-[10px] text-slate-400 font-medium pt-0.5">
                            <span>{unencounteredCount === 0 ? '🎉 已全部遇见' : `还差 ${unencounteredCount} 只完成`}</span>
                            {encounteredCount > 0 ? (
                                <button
                                    type="button"
                                    id="reset-map-encounters-btn"
                                    onClick={() => {
                                        sound.playClick();
                                        setIsConfirmOpen(true);
                                    }}
                                    title="清空当前地图遇见记录"
                                    className="text-[10px] text-slate-400 hover:text-rose-600 transition-colors flex items-center gap-1 cursor-pointer hover:underline"
                                >
                                    <RotateCcw className="w-2.5 h-2.5 text-slate-400" />
                                    <span>重置记录</span>
                                </button>
                            ) : (
                                <span className="text-slate-400">{percentage >= 100 ? '已完成' : '收集进行中'}</span>
                            )}
                        </div>

                        {/* Optional subtle data update alert */}
                        {dataUpdateAvailable && onOpenDataUpdate && (
                            <div className="pt-1.5 mt-1 border-t border-[#D5E2F0]/70 flex items-center justify-between">
                                <span className="text-[10px] text-amber-700 font-medium flex items-center gap-1">
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
                                    className="text-[10px] font-bold text-sky-600 hover:text-sky-700 flex items-center gap-1 cursor-pointer hover:underline"
                                >
                                    <ArrowUpCircle className="w-3 h-3 text-sky-500" />
                                    <span>前往更新</span>
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Reset Confirmation Dialog */}
            <ConfirmDialog
                isOpen={isConfirmOpen}
                title="重置当前地图遇见记录"
                message={`确定要清空【${currentMap.name}】的遇见记录吗？（已遇见 ${encounteredCount} 只）此操作无法撤销。`}
                confirmText="确认重置"
                cancelText="取消"
                isDestructive={true}
                onConfirm={() => {
                    onResetEncounters();
                    setIsConfirmOpen(false);
                }}
                onCancel={() => setIsConfirmOpen(false)}
            />

            {/* Integrated Divider Line */}
            <div className="border-t border-[#E6EEF8] relative z-10" />

            {/* Bottom Row: Filter Tabs & Search Controls */}
            <div className="relative z-10 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 sm:gap-3 pt-0.5">
                {/* Filter Mode Buttons */}
                <div className="flex items-center gap-1 sm:gap-1.5 p-1 bg-[#F5F9FF] rounded-xl border border-[#E2E8F0] w-full sm:w-auto overflow-x-auto">
                    <button
                        type="button"
                        id="filter-all-btn"
                        onClick={() => {
                            sound.playClick();
                            onFilterChange('all');
                        }}
                        className={`flex-1 sm:flex-initial px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-black transition-colors flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap border ${
                            filterMode === 'all'
                                ? 'bg-white text-[#2B78C4] border-[#7ABCF4] shadow-2xs'
                                : 'bg-transparent text-slate-500 hover:text-slate-800 border-transparent'
                        }`}
                    >
                        全部 ({totalMapPets})
                    </button>
                    <button
                        type="button"
                        id="filter-encountered-btn"
                        onClick={() => {
                            sound.playClick();
                            onFilterChange('encountered');
                        }}
                        className={`flex-1 sm:flex-initial px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-black transition-colors flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap border ${
                            filterMode === 'encountered'
                                ? 'bg-[#95D151] text-white border-[#76B032] shadow-2xs'
                                : 'bg-transparent text-[#2D6613] hover:text-slate-800 border-transparent'
                        }`}
                    >
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        已遇 ({encounteredCount})
                    </button>
                    <button
                        type="button"
                        id="filter-unencountered-btn"
                        onClick={() => {
                            sound.playClick();
                            onFilterChange('unencountered');
                        }}
                        className={`flex-1 sm:flex-initial px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-black transition-colors flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap border ${
                            filterMode === 'unencountered'
                                ? 'bg-[#FEE061] text-[#854D0E] border-[#E5C43B] shadow-2xs'
                                : 'bg-transparent text-slate-500 hover:text-slate-800 border-transparent'
                        }`}
                    >
                        <X className="w-3.5 h-3.5 shrink-0" />
                        未遇 ({unencounteredCount})
                    </button>
                </div>

                {/* Search Input and Advanced Filter with Popover */}
                <div className="flex items-center gap-2 w-full sm:w-auto relative">
                    <div className="relative w-full sm:w-72 md:w-80">
                        <Search className="w-4 h-4 text-[#7ABCF4] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                            type="text"
                            id="search-pet-input"
                            value={searchQuery}
                            onChange={(e) => onSearchChange(e.target.value)}
                            placeholder="搜索精灵名、图鉴id..."
                            className="w-full pl-10 pr-9 py-2 text-xs sm:text-sm bg-white border border-[#7ABCF4]/60 focus:border-[#7ABCF4] rounded-xl shadow-2xs focus:shadow-xs outline-hidden transition-all text-slate-800 placeholder:text-slate-400 font-medium"
                        />
                        {searchQuery && (
                            <button
                                type="button"
                                id="clear-search-btn"
                                onClick={() => {
                                    sound.playClick();
                                    onSearchChange('');
                                }}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-slate-200/80 hover:bg-slate-300 text-slate-600 flex items-center justify-center transition-colors cursor-pointer"
                                title="清空输入内容"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>

                    <div className="relative">
                        <button
                            type="button"
                            onClick={() => {
                                sound.playClick();
                                setIsAdvancedOpen(!isAdvancedOpen);
                            }}
                            className={`p-2 rounded-xl border-2 transition-all flex items-center justify-center gap-1 cursor-pointer hover:scale-105 active:scale-95 ${
                                activeAdvancedCount > 0
                                    ? 'bg-[#F0F7FF] border-[#7ABCF4] text-[#2B78C4]'
                                    : 'bg-white border-slate-200 text-slate-600 hover:border-[#7ABCF4] hover:text-[#2B78C4]'
                            }`}
                            title="高级筛选"
                        >
                            <Filter className="w-4 h-4" />
                            {activeAdvancedCount > 0 && (
                                <span className="absolute -top-1.5 -right-1.5 bg-rose-500 text-white text-[9px] font-black w-4 h-4 rounded-full flex items-center justify-center border border-white">
                                    {activeAdvancedCount}
                                </span>
                            )}
                        </button>

                        <AdvancedFilterPopover
                            isOpen={isAdvancedOpen}
                            onClose={() => setIsAdvancedOpen(false)}
                            filters={advancedFilters}
                            onChange={onAdvancedFilterChange}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};

