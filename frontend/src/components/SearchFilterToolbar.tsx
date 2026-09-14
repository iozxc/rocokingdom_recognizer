import React, { useState } from 'react';
import { CheckCircle2, Filter, X } from 'lucide-react';
import { AdvancedFilterState, PetItem } from '../types';
import { sound } from '../services/sound';
import { PetSearchMode } from '../utils/skillSearch';
import { AdvancedFilterPopover } from './AdvancedFilterPopover';
import { PetSearchBox } from './PetSearchBox';

interface SearchFilterToolbarProps {
  pets: PetItem[];
  encounteredCount: number;
  totalCount: number;
  filterMode: 'all' | 'encountered' | 'unencountered';
  onFilterChange: (mode: 'all' | 'encountered' | 'unencountered') => void;
  searchQuery: string;
  searchMode: PetSearchMode;
  onSearchChange: (query: string) => void;
  onSearchModeChange: (mode: PetSearchMode) => void;
  advancedFilters: AdvancedFilterState;
  onAdvancedFilterChange: (filters: AdvancedFilterState) => void;
  layout?: 'banner' | 'grid';
  className?: string;
}

export const SearchFilterToolbar: React.FC<SearchFilterToolbarProps> = ({
  pets,
  encounteredCount,
  totalCount,
  filterMode,
  onFilterChange,
  searchQuery,
  searchMode,
  onSearchChange,
  onSearchModeChange,
  advancedFilters,
  onAdvancedFilterChange,
  layout = 'banner',
  className = '',
}) => {
  const [isAdvancedOpen, setIsAdvancedOpen] = useState<boolean>(false);
  const unencounteredCount = Math.max(0, totalCount - encounteredCount);
  const activeAdvancedCount = advancedFilters.elements.length + advancedFilters.specialTypes.length;
  const isGridLayout = layout === 'grid';

  const filterButtons = (
    <>
      <button
        type="button"
        id="filter-all-btn"
        onClick={() => {
          sound.playClick();
          onFilterChange('all');
        }}
        className={`min-w-0 px-2.5 py-1.5 rounded-lg text-[10.5px] sm:text-[11px] font-black transition-colors flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap border ${
          filterMode === 'all'
            ? 'bg-white dark:bg-slate-700 text-[#2B78C4] dark:text-sky-300 border-[#7ABCF4] dark:border-sky-500 shadow-2xs'
            : 'bg-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 border-transparent'
        }`}
      >
        <span>全部</span>
        <span className="font-mono text-[10px] opacity-75">({totalCount})</span>
      </button>
      <button
        type="button"
        id="filter-encountered-btn"
        onClick={() => {
          sound.playClick();
          onFilterChange('encountered');
        }}
        className={`min-w-0 px-2.5 py-1.5 rounded-lg text-[10.5px] sm:text-[11px] font-black transition-colors flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap border ${
          filterMode === 'encountered'
            ? 'bg-[#95D151] text-white border-[#76B032] shadow-2xs'
            : 'bg-transparent text-[#2D6613] dark:text-emerald-400 hover:text-slate-800 dark:hover:text-slate-200 border-transparent'
        }`}
      >
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
        <span>已遇</span>
        <span className="font-mono text-[10px] opacity-80">({encounteredCount})</span>
      </button>
      <button
        type="button"
        id="filter-unencountered-btn"
        onClick={() => {
          sound.playClick();
          onFilterChange('unencountered');
        }}
        className={`min-w-0 px-2.5 py-1.5 rounded-lg text-[10.5px] sm:text-[11px] font-black transition-colors flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap border ${
          filterMode === 'unencountered'
            ? 'bg-[#FEE061] text-[#854D0E] border-[#E5C43B] shadow-2xs'
            : 'bg-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 border-transparent'
        }`}
      >
        <X className="w-3.5 h-3.5 shrink-0" />
        <span>未遇</span>
        <span className="font-mono text-[10px] opacity-80">({unencounteredCount})</span>
      </button>
    </>
  );

  const searchControls = (
    <div className="relative flex items-center gap-2 w-full">
      <PetSearchBox
        pets={pets}
        searchQuery={searchQuery}
        searchMode={searchMode}
        onSearchChange={onSearchChange}
        onSearchModeChange={onSearchModeChange}
        containerClassName={
          isGridLayout
            ? 'relative flex-1 min-w-0'
            : 'relative flex-1 min-w-0 md:w-88 lg:w-112'
        }
      />

      <div className="relative shrink-0">
        <button
          type="button"
          onClick={() => {
            sound.playClick();
            setIsAdvancedOpen(!isAdvancedOpen);
          }}
          className={`w-9 h-9 rounded-xl border-2 transition-all flex items-center justify-center cursor-pointer hover:scale-105 active:scale-95 ${
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
  );

  if (isGridLayout) {
    return (
      <div className={`w-full flex flex-col md:flex-row md:items-center md:justify-between gap-3 ${className}`}>
        <div className="grid grid-cols-3 gap-1.5 p-1 bg-[#F5F9FF] dark:bg-slate-800 rounded-xl border border-[#E2E8F0] dark:border-slate-700 w-full md:w-[16.5rem] shrink-0">
          {filterButtons}
        </div>
        <div className="w-full md:flex-1 md:max-w-[38rem] min-w-0">
          {searchControls}
        </div>
      </div>
    );
  }

  return (
    <div className={`relative flex flex-col md:flex-row items-stretch md:items-center justify-between gap-2.5 sm:gap-3 w-full ${className}`}>
      <div className="grid grid-cols-3 gap-1 sm:gap-1.5 p-1 bg-[#F5F9FF] dark:bg-slate-800 rounded-xl border border-[#E2E8F0] dark:border-slate-700 w-full md:w-[16.5rem] shrink-0">
        {filterButtons}
      </div>
      <div className="w-full md:w-auto">
        {searchControls}
      </div>
    </div>
  );
};
