import React from 'react';
import { Search, Sparkles, Filter, RotateCcw, MapPin, CheckCircle2, X } from 'lucide-react';
import { MapConfig } from '../types';
import { sound } from '../services/sound';

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
}) => {
  const unencounteredCount = Math.max(0, totalMapPets - encounteredCount);

  return (
    <div className="bg-white roco-card p-4 sm:p-5 relative overflow-hidden mb-5 space-y-4">
      {/* Decorative gradient aura */}
      <div
        className={`absolute top-0 right-0 w-96 h-96 bg-gradient-to-br ${currentMap.bgGradient} rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none opacity-40`}
      />

      {/* Top Row: Map Header Info + Progress Tracker + Actions */}
      <div className="relative z-10 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        {/* Left: Map Information & Level Badge */}
        <div className="flex items-center gap-3.5">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl shadow-sm border-3 shrink-0 bg-[#F5F9FF]"
            style={{ borderColor: currentMap.themeColor }}
          >
            {currentMap.num === 1 ? '🌿' : currentMap.num === 2 ? '🗿' : '🌊'}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-xs font-black px-2.5 py-0.5 rounded-lg border-2 ${currentMap.badgeBg}`}>
                地图 #{currentMap.num}
              </span>
              <h2 className="text-xl sm:text-2xl font-black text-slate-800 tracking-tight flex items-center gap-1.5">
                <MapPin className="w-5 h-5 text-[#7ABCF4]" />
                {currentMap.name}
              </h2>
            </div>
            <p className="text-xs sm:text-sm text-slate-500 mt-1 max-w-xl line-clamp-1">
              {currentMap.description}
            </p>
          </div>
        </div>

        {/* Right: Map Dex Completion Progress & Reset Action */}
        <div className="w-full lg:w-auto flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
          <div className="p-3.5 bg-[#F5F9FF] rounded-2xl border-2 border-[#E6EEF8] shadow-2xs min-w-[240px] lg:w-72">
            <div className="flex items-center justify-between text-xs font-black text-slate-700 mb-1.5">
              <span className="flex items-center gap-1.5 text-[#2B78C4]">
                <Sparkles className="w-3.5 h-3.5 text-[#FEE061]" />
                本图遇见进度
              </span>
              <span className="font-mono text-[#2B78C4] font-black">
                {encounteredCount} / {totalMapPets} ({percentage}%)
              </span>
            </div>
            {/* Progress bar */}
            <div className="w-full h-3.5 bg-slate-200/90 rounded-full overflow-hidden p-0.5">
              <div
                className="h-full rounded-full transition-all duration-500 ease-out bg-gradient-to-r from-[#95D151] to-[#7ABCF4] shadow-xs"
                style={{ width: `${percentage}%` }}
              />
            </div>
          </div>

          {/* Reset Map Encounters Button - Relocated to Header Top Right */}
          {encounteredCount > 0 && (
            <button
              id="reset-map-encounters-btn"
              onClick={() => {
                sound.playToggleOff();
                if (window.confirm(`确定要清空【${currentMap.name}】的全部已遇见图鉴记录吗？此操作无法撤销。`)) {
                  onResetEncounters();
                }
              }}
              title="清空当前地图遇见记录"
              className="px-3 py-2 rounded-2xl border-2 border-slate-200 hover:border-rose-300 bg-white hover:bg-rose-50/50 text-slate-500 hover:text-rose-600 text-xs font-black transition-all flex items-center justify-center gap-1.5 shadow-2xs cursor-pointer self-stretch sm:self-auto"
            >
              <RotateCcw className="w-3.5 h-3.5 text-rose-500" />
              <span>重置本图进度</span>
            </button>
          )}
        </div>
      </div>

      {/* Integrated Divider Line */}
      <div className="border-t-2 border-[#E6EEF8] relative z-10" />

      {/* Bottom Row: Filter Tabs & Search Controls */}
      <div className="relative z-10 flex flex-col sm:flex-row items-center justify-between gap-3 pt-0.5">
        {/* Filter Tabs */}
        <div className="flex items-center gap-1.5 p-1 bg-[#F5F9FF] rounded-xl border border-[#E2E8F0] w-full sm:w-auto">
          <button
            id="filter-all-btn"
            onClick={() => {
              sound.playClick();
              onFilterChange('all');
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all flex items-center gap-1 cursor-pointer ${
              filterMode === 'all'
                ? 'bg-white text-[#2B78C4] shadow-xs border border-[#7ABCF4]'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Filter className="w-3.5 h-3.5" />
            全部 ({totalMapPets})
          </button>
          <button
            id="filter-encountered-btn"
            onClick={() => {
              sound.playClick();
              onFilterChange('encountered');
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 cursor-pointer ${
              filterMode === 'encountered'
                ? 'bg-[#95D151] text-white shadow-xs'
                : 'text-[#2D6613] hover:text-slate-800'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            已遇见 ({encounteredCount})
          </button>
          <button
            id="filter-unencountered-btn"
            onClick={() => {
              sound.playClick();
              onFilterChange('unencountered');
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 cursor-pointer ${
              filterMode === 'unencountered'
                ? 'bg-[#FEE061] text-[#854D0E] shadow-xs'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-[#854D0E] inline-block" />
            未遇见 ({unencounteredCount})
          </button>
        </div>

        {/* Search Input with Clear (X) button */}
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-72">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              id="search-pet-input"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="搜索精灵名称..."
              className="w-full pl-9 pr-8 py-1.5 text-xs bg-[#F5F9FF] focus:bg-white border-2 border-[#E2E8F0] focus:border-[#7ABCF4] rounded-xl outline-hidden transition-all text-slate-800 placeholder:text-slate-400 font-medium"
            />
            {searchQuery && (
              <button
                type="button"
                id="clear-search-input-btn"
                onClick={() => {
                  sound.playClick();
                  onSearchChange('');
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-slate-200/80 hover:bg-slate-300 text-slate-600 flex items-center justify-center transition-colors cursor-pointer"
                title="清空输入内容"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
