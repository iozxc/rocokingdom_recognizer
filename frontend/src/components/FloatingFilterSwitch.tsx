import React, { useState, useEffect, useMemo } from 'react';
import { Filter, Check, EyeOff, MapPin, RefreshCw, ChevronLeft, ChevronRight, ChevronsDown, ChevronsUp, Layers } from 'lucide-react';
import { PetItem, EncounterRecord, MapConfig } from '../types';
import { sound } from '../services/sound';
import { storage } from '../services/storage';
import { MAP_CONFIGS } from '../data/mockPets';

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

  // Sync settings when storage updates from remote roco_user_data.json
  useEffect(() => {
    const unsubscribe = storage.subscribeSettings((settings) => {
      if (typeof settings.isFilterSwitchCollapsed === 'boolean') {
        setIsCollapsed(settings.isFilterSwitchCollapsed);
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
    return pets.filter((p) => !!records[`${currentMap.id}_${p.name}`]?.encountered).length;
  }, [pets, records, currentMap.id]);

  const unencounteredCount = Math.max(0, totalCount - encounteredCount);

  // Next map name for tooltip
  const nextMap = useMemo(() => {
    const nextNum = (currentMap.num % MAP_CONFIGS.length) + 1;
    return MAP_CONFIGS.find((m) => m.num === nextNum) || MAP_CONFIGS[0];
  }, [currentMap.num]);

  return (
    <div
      id="floating-filter-switch-container"
      className="fixed bottom-6 left-6 z-40 flex flex-col items-start select-none"
    >
      {isCollapsed ? (
        /* Collapsed Floating Pill */
        <button
          type="button"
          id="floating-filter-expand-btn"
          onClick={() => handleToggleCollapse(false)}
          className="flex items-center gap-2 px-3.5 py-2.5 bg-white/95 backdrop-blur-md hover:bg-white text-slate-700 rounded-full border-2 border-white shadow-xl shadow-slate-900/10 hover:shadow-2xl transition-all duration-200 group cursor-pointer hover:scale-105"
          title="展开左侧地图与图鉴筛选悬浮栏"
        >
          <div
            className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-black shadow-2xs"
            style={{ backgroundColor: currentMap.themeColor }}
          >
            {currentMap.num}
          </div>

          <span className="text-xs font-black text-slate-800">
            {filterMode === 'all' ? '全部' : filterMode === 'encountered' ? '已遇' : '未遇'}
          </span>

          <span className="font-mono text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.2 rounded-full font-bold">
            {filterMode === 'all' ? totalCount : filterMode === 'encountered' ? encounteredCount : unencounteredCount}
          </span>

          <div className="w-5 h-5 rounded-full bg-slate-100 group-hover:bg-[#7ABCF4] group-hover:text-white text-slate-400 flex items-center justify-center transition-colors">
            <ChevronRight className="w-3.5 h-3.5" />
          </div>
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
