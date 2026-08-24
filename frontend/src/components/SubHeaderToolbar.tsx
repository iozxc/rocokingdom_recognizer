import React from 'react';
import {
    Sparkles,
    Search,
    Layers,
    Filter,
    Check,
    EyeOff,
    Command,
    HelpCircle,
} from 'lucide-react';
import { sound } from '../services/sound';
import { openFollowScanner } from '../services/followScanner';

interface SubHeaderToolbarProps {
    filterMode: 'all' | 'encountered' | 'unencountered';
    onFilterChange: (mode: 'all' | 'encountered' | 'unencountered') => void;
    encounteredCount: number;
    totalCount: number;
    onOpenSingleRecognizer?: () => void;
    onOpenBatchInit?: () => void;
    onOpenGlobalSearch?: () => void;
    showFollow?: boolean;
}

export const SubHeaderToolbar: React.FC<SubHeaderToolbarProps> = ({
                                                                      filterMode,
                                                                      onFilterChange,
                                                                      encounteredCount,
                                                                      totalCount,
                                                                      onOpenSingleRecognizer,
                                                                      onOpenBatchInit,
                                                                      onOpenGlobalSearch,
                                                                      showFollow = true,
                                                                  }) => {
    const unencounteredCount = Math.max(0, totalCount - encounteredCount);

    return (
        <div
            id="sub-header-toolbar"
            className="w-full mx-auto px-8 sm:px-16 pt-3 flex justify-end animate-in fade-in slide-in-from-top-2 duration-200"
        >
            {/* Layered Glassmorphism Sub-Header Bar */}
            <div className="flex flex-wrap items-center justify-between sm:justify-end gap-2.5 p-1.5 bg-white/90 backdrop-blur-md rounded-2xl border-2 border-white/80 shadow-md shadow-slate-900/5">
                {/* Left Side in Toolbar: Quick Filter Pills */}
                <div className="flex items-center gap-1 p-0.5 bg-slate-100/80 rounded-xl border border-slate-200/60">
                    <button
                        type="button"
                        onClick={() => {
                            sound.playClick();
                            onFilterChange('all');
                        }}
                        className={`px-2.5 py-1 rounded-lg text-xs font-black transition-all cursor-pointer flex items-center gap-1 ${
                            filterMode === 'all'
                                ? 'bg-white text-[#2B78C4] shadow-xs'
                                : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
                        }`}
                    >
                        <span>全部</span>
                        <span className="font-mono text-[10px] opacity-75">{totalCount}</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => {
                            sound.playClick();
                            onFilterChange('encountered');
                        }}
                        className={`px-2.5 py-1 rounded-lg text-xs font-black transition-all cursor-pointer flex items-center gap-1 ${
                            filterMode === 'encountered'
                                ? 'bg-[#95D151] text-white shadow-xs'
                                : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
                        }`}
                    >
                        <Check className="w-3 h-3 stroke-[3]" />
                        <span>已遇</span>
                        <span className="font-mono text-[10px] opacity-80">{encounteredCount}</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => {
                            sound.playClick();
                            onFilterChange('unencountered');
                        }}
                        className={`px-2.5 py-1 rounded-lg text-xs font-black transition-all cursor-pointer flex items-center gap-1 ${
                            filterMode === 'unencountered'
                                ? 'bg-amber-500 text-white shadow-xs'
                                : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
                        }`}
                    >
                        <EyeOff className="w-3 h-3" />
                        <span>未遇</span>
                        <span className="font-mono text-[10px] opacity-80">{unencounteredCount}</span>
                    </button>
                </div>

                {/* Vertical Divider */}
                <div className="hidden sm:block w-[1px] h-5 bg-slate-200" />

                {/* Right Side in Toolbar: Action Buttons */}
                <div className="flex items-center gap-1.5 flex-wrap">
                    {/* 1. 跟随识别（火系页可关闭） */}
                    {showFollow && (
                        <button
                            type="button"
                            id="sub-header-scanner-btn"
                            onClick={() => {
                                sound.playClick();
                                openFollowScanner();
                            }}
                            className="px-2.5 py-1.5 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
                            title="窗口跟随识别"
                        >
                            <Sparkles className="w-3.5 h-3.5" />
                            <span>跟随识别</span>
                        </button>
                    )}

                    {/* 2. 单个识别 */}
                    {onOpenSingleRecognizer && (
                        <button
                            type="button"
                            id="sub-header-single-btn"
                            onClick={() => {
                                sound.playClick();
                                onOpenSingleRecognizer();
                            }}
                            className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                            title="单个识别"
                        >
                            <Sparkles className="w-3.5 h-3.5 text-[#2D6613]" />
                            <span>单个识别</span>
                        </button>
                    )}

                    {/* 3. 批量初始化 */}
                    {onOpenBatchInit && (
                        <button
                            type="button"
                            id="sub-header-batch-btn"
                            onClick={() => {
                                sound.playClick();
                                onOpenBatchInit();
                            }}
                            className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                            title="批量导入"
                        >
                            <Layers className="w-3.5 h-3.5 text-amber-700" />
                            <span>批量导入</span>
                        </button>
                    )}

                    {/* 4. 全域搜索 */}
                    {onOpenGlobalSearch && (
                        <button
                            type="button"
                            id="sub-header-search-btn"
                            onClick={() => {
                                sound.playClick();
                                onOpenGlobalSearch();
                            }}
                            className="px-2.5 py-1.5 bg-sky-500 hover:bg-sky-600 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
                            title="全域搜索 (Ctrl+K)"
                        >
                            <Search className="w-3.5 h-3.5" />
                            <span>全域搜索</span>
                            <kbd className="hidden md:inline-flex items-center text-[10px] font-mono bg-white/20 px-1 py-0.2 rounded">
                                Ctrl+K
                            </kbd>
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};
