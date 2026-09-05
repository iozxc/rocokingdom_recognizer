import React, { useState, useMemo, useRef } from 'react';
import { Search, Sparkles, RotateCcw, MapPin, CheckCircle2, X, ArrowUpCircle, Filter, Wand2 } from 'lucide-react';
import { MapConfig, PetItem, AdvancedFilterState } from '../types';
import { sound } from '../services/sound';
import { ConfirmDialog } from './ConfirmDialog';
import { AdvancedFilterPopover } from './AdvancedFilterPopover';
import { TermHighlightText } from './TermHighlightText';
import { PetSearchMode, buildSkillCatalog, filterSkillCatalog } from '../utils/skillSearch';

interface StatsBannerProps {
    currentMap: MapConfig;
    encounteredCount: number;
    totalMapPets: number;
    /** 当前关卡精灵列表，用于技能/特性搜索时生成全部可能的候选提示。 */
    pets: PetItem[];
    /** 搜索模式：'name'=精灵名/图鉴id（默认），'skill'=技能/特性搜索。 */
    searchMode: PetSearchMode;
    onSearchModeChange: (mode: PetSearchMode) => void;
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
                                                            pets,
                                                            searchMode,
                                                            onSearchModeChange,
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

    // 技能/特性搜索：候选目录（当前关卡全部可能的技能与特性）与输入实时过滤结果
    const [isSkillOpen, setIsSkillOpen] = useState<boolean>(false);
    const skillInputRef = useRef<HTMLInputElement>(null);
    const skillCatalog = useMemo(() => buildSkillCatalog(pets), [pets]);
    const skillSuggestions = useMemo(
        () => filterSkillCatalog(skillCatalog, searchQuery),
        [skillCatalog, searchQuery]
    );

    const handleToggleSearchMode = () => {
        sound.playClick();
        const next: PetSearchMode = searchMode === 'skill' ? 'name' : 'skill';
        onSearchModeChange(next);
        setIsSkillOpen(next === 'skill');
        // 激活后聚焦输入框：失焦时下拉可自然收起
        if (next === 'skill') {
            skillInputRef.current?.focus();
        }
    };

    const handlePickSkill = (name: string) => {
        sound.playClick();
        onSearchChange(name);
        setIsSkillOpen(false);
    };


    return (
        <div className="bg-white dark:bg-slate-900 roco-card p-3 sm:p-5 relative mb-4 sm:mb-5 space-y-3 sm:space-y-3.5 shadow-xs border border-slate-100 dark:border-slate-800 transition-colors">
            {/* Decorative gradient aura container to handle overflow boundaries safely */}
            <div className="absolute inset-0 overflow-hidden rounded-3xl pointer-events-none">
                <div
                    className={`absolute top-0 right-0 w-96 h-96 bg-gradient-to-br ${currentMap.bgGradient} rounded-full blur-3xl -mr-20 -mt-20 opacity-40 dark:opacity-20`}
                />
            </div>

            {/* Top Row: Map Header Info + Progress Tracker */}
            <div className="relative z-10 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 sm:gap-4">
                {/* Left: Map Information & Level Badge */}
                <div className="flex items-start sm:items-center gap-2.5 sm:gap-3.5 flex-1 min-w-0">
                    <div
                        className="w-10 h-10 sm:w-13 sm:h-13 rounded-2xl flex items-center justify-center text-xl sm:text-2xl border-2 shrink-0 bg-[#F5F9FF] dark:bg-slate-800 shadow-xs"
                        style={{ borderColor: currentMap.themeColor }}
                    >
                        {currentMap.num === 1 ? '🌿' : currentMap.num === 2 ? '🗿' : currentMap.num === 3 ? '🌱' : '🔥'}
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                            <span className={`text-[10px] sm:text-[11px] font-black px-1.5 sm:px-2 py-0.5 rounded-lg border ${currentMap.badgeBg} dark:bg-slate-800 dark:border-slate-700`}>
                                地图 #{currentMap.num}
                            </span>
                            <h2 className="text-base sm:text-lg lg:text-xl font-black text-slate-800 dark:text-slate-100 tracking-tight flex items-center gap-1.5 truncate">
                                <MapPin className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#7ABCF4] shrink-0" />
                                <span>{currentMap.name}</span>
                            </h2>
                        </div>

                        {/* Description */}
                        <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 mt-0.5 sm:mt-1 max-w-xl line-clamp-2 leading-relaxed">
                            {currentMap.description}
                        </p>
                    </div>
                </div>

                {/* Right: Map Dex Completion Progress Card */}
                <div className="shrink-0 w-full md:w-72 lg:w-80">
                    <div className="p-2.5 sm:p-3 bg-gradient-to-b from-[#F5F9FF] to-[#EFF6FF] dark:from-slate-800/90 dark:to-slate-800/50 rounded-2xl border border-[#D5E2F0] dark:border-slate-700 shadow-xs space-y-1.5">
                        <div className="flex items-center justify-between text-xs font-black text-slate-700 dark:text-slate-200">
                            <span className="flex items-center gap-1.5 text-[#2B78C4] dark:text-sky-400">
                                <Sparkles className="w-3.5 h-3.5 text-[#FEE061]" />
                                <span>本图遇见进度</span>
                            </span>
                            <span className="font-mono text-[#2B78C4] dark:text-sky-300 font-black text-xs">
                                {encounteredCount} / {totalMapPets} ({percentage}%)
                            </span>
                        </div>

                        {/* Progress bar */}
                        <div className="w-full h-2.5 bg-slate-200/90 dark:bg-slate-700 rounded-full overflow-hidden p-0.5">
                            <div
                                className="h-full rounded-full transition-all duration-500 ease-out bg-gradient-to-r from-[#95D151] to-[#7ABCF4]"
                                style={{ width: `${percentage}%` }}
                            />
                        </div>

                        {/* Progress Footer: Remaining count & Subtle Reset link */}
                        <div className="flex items-center justify-between text-[10px] text-slate-400 dark:text-slate-400 font-medium pt-0.5">
                            <span>{unencounteredCount === 0 ? '🎉 已全部遇见' : `还差 ${unencounteredCount} 只完成`}</span>
                            {encounteredCount > 0 ? (
                                <button
                                    type="button"
                                    id="reset-map-encounters-btn"
                                    onClick={() => {
                                        sound.playClick();
                                        setIsConfirmOpen(true);
                                    }}
                                    title="清空当前关卡遇见记录"
                                    className="text-[10px] text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors flex items-center gap-1 cursor-pointer hover:underline"
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
                            <div className="pt-1.5 mt-1 border-t border-[#D5E2F0]/70 dark:border-slate-700 flex items-center justify-between">
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
                                    className="text-[10px] font-bold text-sky-600 dark:text-sky-400 hover:text-sky-700 flex items-center gap-1 cursor-pointer hover:underline"
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
                title="重置当前关卡遇见记录"
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
            <div className="border-t border-[#E6EEF8] dark:border-slate-800 relative z-10" />

            {/* Bottom Row: Filter Tabs & Search Controls */}
            <div className="relative z-10 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-2.5 sm:gap-3 pt-0.5">
                {/* Filter Mode Buttons */}
                <div className="flex items-center gap-1 sm:gap-1.5 p-1 bg-[#F5F9FF] dark:bg-slate-800 rounded-xl border border-[#E2E8F0] dark:border-slate-700 w-full md:w-auto overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden shrink-0">
                    <button
                        type="button"
                        id="filter-all-btn"
                        onClick={() => {
                            sound.playClick();
                            onFilterChange('all');
                        }}
                        className={`flex-1 md:flex-initial px-3 py-1.5 rounded-xl text-xs font-black transition-colors flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap border ${
                            filterMode === 'all'
                                ? 'bg-white dark:bg-slate-700 text-[#2B78C4] dark:text-sky-300 border-[#7ABCF4] dark:border-sky-500 shadow-2xs'
                                : 'bg-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 border-transparent'
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
                        className={`flex-1 md:flex-initial px-3 py-1.5 rounded-xl text-xs font-black transition-colors flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap border ${
                            filterMode === 'encountered'
                                ? 'bg-[#95D151] text-white border-[#76B032] shadow-2xs'
                                : 'bg-transparent text-[#2D6613] dark:text-emerald-400 hover:text-slate-800 dark:hover:text-slate-200 border-transparent'
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
                        className={`flex-1 md:flex-initial px-3 py-1.5 rounded-xl text-xs font-black transition-colors flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap border ${
                            filterMode === 'unencountered'
                                ? 'bg-[#FEE061] text-[#854D0E] border-[#E5C43B] shadow-2xs'
                                : 'bg-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 border-transparent'
                        }`}
                    >
                        <X className="w-3.5 h-3.5 shrink-0" />
                        未遇 ({unencounteredCount})
                    </button>
                </div>

                {/* Search Input and Advanced Filter with Popover */}
                <div className="flex items-center gap-2 w-full md:w-auto relative">
                    <div className="relative flex-1 md:w-72 lg:w-80">
                        {searchMode === 'skill' ? (
                            <Sparkles className="w-4 h-4 text-violet-500 dark:text-violet-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                        ) : (
                            <Search className="w-4 h-4 text-[#7ABCF4] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                        )}
                        <input
                            ref={skillInputRef}
                            type="text"
                            id="search-pet-input"
                            value={searchQuery}
                            onChange={(e) => {
                                onSearchChange(e.target.value);
                                if (searchMode === 'skill') setIsSkillOpen(true);
                            }}
                            onFocus={() => {
                                if (searchMode === 'skill') setIsSkillOpen(true);
                            }}
                            onBlur={() => {
                                setTimeout(() => setIsSkillOpen(false), 150);
                            }}
                            placeholder={searchMode === 'skill' ? '搜索技能/特性（名称或描述）...' : '搜索精灵名、图鉴id...'}
                            className={`w-full pl-10 ${searchQuery ? 'pr-14' : 'pr-10'} py-2 text-xs sm:text-sm rounded-xl shadow-2xs focus:shadow-xs outline-hidden transition-all font-medium ${
                                searchMode === 'skill'
                                    ? 'bg-violet-50/70 dark:bg-slate-800 border border-violet-400/70 dark:border-violet-500/60 focus:border-violet-500 dark:focus:border-violet-400 text-slate-800 dark:text-slate-100 placeholder:text-violet-500/70 dark:placeholder:text-violet-300/70'
                                    : 'bg-white dark:bg-slate-800 border border-[#7ABCF4]/60 dark:border-slate-700 focus:border-[#7ABCF4] dark:focus:border-sky-400 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500'
                            }`}
                        />
                        {/* 技能/特性搜索激活按钮（默认关闭，点击后在输入框内切换搜索技能/特性） */}
                        <button
                            type="button"
                            id="skill-search-toggle-btn"
                            aria-pressed={searchMode === 'skill'}
                            onClick={handleToggleSearchMode}
                            title={
                                searchMode === 'skill'
                                    ? '当前为技能/特性搜索，点击切回精灵名/图鉴id搜索'
                                    : '开启技能/特性搜索（可搜技能名、技能描述、特性名、特性描述）'
                            }
                            className={`absolute right-1 top-1/2 -translate-y-1/2 w-7 h-7 rounded-lg flex items-center justify-center transition-all cursor-pointer border ${
                                searchMode === 'skill'
                                    ? 'bg-violet-500/15 dark:bg-violet-500/25 border-violet-400/60 dark:border-violet-500/50 text-violet-600 dark:text-violet-300'
                                    : 'bg-transparent border-transparent text-slate-400 hover:text-violet-500 dark:hover:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-500/10 hover:border-violet-200 dark:hover:border-violet-500/30'
                            }`}
                        >
                            <Wand2 className="w-3.5 h-3.5" />
                        </button>
                        {searchQuery && (
                            <button
                                type="button"
                                id="clear-search-btn"
                                onClick={() => {
                                    sound.playClick();
                                    onSearchChange('');
                                }}
                                className="absolute right-9 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-slate-200/80 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 flex items-center justify-center transition-colors cursor-pointer"
                                title="清空输入内容"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        )}

                        {/* 技能/特性候选：列出当前关卡全部可能的技能与特性，输入时实时过滤 */}
                        {searchMode === 'skill' && isSkillOpen && (
                            <div className="absolute left-0 right-0 top-full mt-1.5 z-40 bg-white dark:bg-slate-800/95 backdrop-blur-md border border-violet-200 dark:border-violet-500/30 rounded-xl shadow-lg overflow-hidden">
                                <div className="max-h-72 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-600">
                                    {skillSuggestions.length === 0 ? (
                                        <div className="px-3 py-5 text-center text-xs text-slate-400">
                                            未找到匹配的技能/特性，试试搜技能名、特性名或其描述关键词
                                        </div>
                                    ) : (
                                        skillSuggestions.map((item) => (
                                            <button
                                                key={`${item.kind}:${item.name}`}
                                                type="button"
                                                onMouseDown={(e) => {
                                                    e.preventDefault();
                                                    handlePickSkill(item.name);
                                                }}
                                                className="w-full text-left px-3 py-2 flex items-center gap-2.5 hover:bg-violet-50 dark:hover:bg-violet-500/10 transition-colors cursor-pointer border-b border-slate-100 dark:border-slate-700/60 last:border-b-0"
                                            >
                                                <span
                                                    className={`shrink-0 text-[9px] font-black px-1.5 py-0.5 rounded-md border ${
                                                        item.kind === 'skill'
                                                            ? 'bg-sky-500/10 text-sky-600 dark:text-sky-300 border-sky-300/60 dark:border-sky-500/40'
                                                            : 'bg-amber-500/10 text-amber-600 dark:text-amber-300 border-amber-300/60 dark:border-amber-500/40'
                                                    }`}
                                                >
                                                    {item.kind === 'skill' ? '技能' : '特性'}
                                                </span>
                                                <span className="min-w-0 flex-1">
                                                    <TermHighlightText
                                                        text={item.name}
                                                        ids={item.termIds}
                                                        className="block text-xs font-black text-slate-700 dark:text-slate-200 truncate"
                                                    />
                                                    {item.desc && (
                                                        <TermHighlightText
                                                            text={item.desc}
                                                            ids={item.termIds}
                                                            className="block text-[10px] text-slate-400 dark:text-slate-500 truncate mt-0.5"
                                                        />
                                                    )}
                                                </span>
                                                <span className="shrink-0 text-[10px] font-bold text-slate-400 dark:text-slate-500 whitespace-nowrap">
                                                    {item.petCount}只
                                                </span>
                                            </button>
                                        ))
                                    )}
                                </div>
                                <div className="px-3 py-1.5 bg-slate-50 dark:bg-slate-900/60 border-t border-slate-100 dark:border-slate-700/60 text-[10px] text-slate-400 dark:text-slate-500 flex items-center justify-between gap-2">
                                    <span>共 {skillSuggestions.length} 项技能/特性</span>
                                    <span>点击填入精确技能名</span>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="relative shrink-0">
                        <button
                            type="button"
                            onClick={() => {
                                sound.playClick();
                                setIsAdvancedOpen(!isAdvancedOpen);
                            }}
                            className={`p-2 rounded-xl border-2 transition-all flex items-center justify-center gap-1 cursor-pointer hover:scale-105 active:scale-95 ${
                                activeAdvancedCount > 0
                                    ? 'bg-[#F0F7FF] dark:bg-slate-800 border-[#7ABCF4] dark:border-sky-500 text-[#2B78C4] dark:text-sky-300'
                                    : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-[#7ABCF4] hover:text-[#2B78C4]'
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

