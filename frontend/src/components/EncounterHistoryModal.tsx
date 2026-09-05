import React, { useState, useMemo } from 'react';
import {
  History,
  X,
  Search,
  Check,
  RotateCcw,
  Sparkles,
  Calendar,
  Clock,
  MapPin,
  EyeOff,
  Filter,
  ArrowRight,
} from 'lucide-react';
import { EncounterRecord, MapConfig, PetItem } from '../types';
import { MAP_CONFIGS } from '../data/mockPets';
import { sound } from '../services/sound';
import { formatPetName } from '../utils/petHelper';
import { api } from '../services/api';
import { IS_STATIC } from '../services/staticMode';
import { ElementBadges } from './ElementBadges';
import { ImageZoom } from './ImageZoom';
import { PetSprite } from './PetSprite';

interface EncounterHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  records: Record<string, EncounterRecord>;
  allMapsPets?: Record<string, { count: number; items: PetItem[] }>;
  mapsConfig?: MapConfig[];
  onToggleEncounter: (mapId: string, filename: string) => void;
  onNavigateToPet?: (mapNum: number, petName: string) => void;
}

export const EncounterHistoryModal: React.FC<EncounterHistoryModalProps> = ({
  isOpen,
  onClose,
  records,
  allMapsPets,
  mapsConfig,
  onToggleEncounter,
  onNavigateToPet,
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'encountered' | 'unencountered'>('all');
  const [selectedMapFilter, setSelectedMapFilter] = useState<string>('all');

  const maps = mapsConfig && mapsConfig.length > 0 ? mapsConfig : MAP_CONFIGS;

  // Format relative & absolute time string
  const formatTime = (timeStr?: string): { relative: string; fullTime: string } => {
    if (!timeStr) return { relative: '未知时间', fullTime: '未知时间' };
    try {
      const date = new Date(timeStr);
      if (isNaN(date.getTime())) return { relative: timeStr, fullTime: timeStr };

      const now = Date.now();
      const diffMs = now - date.getTime();
      const diffSec = Math.floor(diffMs / 1000);
      const diffMin = Math.floor(diffSec / 60);
      const diffHour = Math.floor(diffMin / 60);
      const diffDay = Math.floor(diffHour / 24);

      let relative = '';
      if (diffSec < 30) relative = '刚刚';
      else if (diffSec < 60) relative = `${diffSec}秒前`;
      else if (diffMin < 60) relative = `${diffMin}分钟前`;
      else if (diffHour < 24) relative = `${diffHour}小时前`;
      else if (diffDay < 7) relative = `${diffDay}天前`;
      else {
        relative = `${date.getMonth() + 1}月${date.getDate()}日`;
      }

      const fullTime = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
        date.getDate()
      ).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(
        date.getMinutes()
      ).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;

      return { relative, fullTime };
    } catch {
      return { relative: timeStr, fullTime: timeStr };
    }
  };

  // Convert and sort records into list
  const historyList = useMemo(() => {
    const recordsArray = Object.values(records || {}) as EncounterRecord[];
    const list = recordsArray.filter((r) => r && r.filename).map((r) => {
      // Find pet metadata if available
      let petMeta: PetItem | undefined = undefined;
      const cleanName = formatPetName(r.filename);
      const mapKey = r.mapId.startsWith('map') ? r.mapId : `map${r.mapId}`;

      if (allMapsPets && allMapsPets[mapKey]?.items) {
        petMeta = allMapsPets[mapKey].items.find(
          (p) => formatPetName(p.name) === cleanName || p.name === r.filename
        );
      }

      const mapObj =
        maps.find((m) => m.id === r.mapId || `map${m.num}` === r.mapId) || {
          id: r.mapId,
          num: Number(r.mapId.replace(/\D/g, '')) || 1,
          name: r.mapId,
          themeColor: '#7ABCF4',
        };

      const sortTime = r.lastSeenAt || r.firstSeenAt || '';

      return {
        record: r,
        petMeta,
        cleanName,
        mapObj,
        sortTime,
      };
    });

    // Sort by last update time descending (newest first)
    list.sort((a, b) => {
      const timeA = new Date(a.sortTime).getTime() || 0;
      const timeB = new Date(b.sortTime).getTime() || 0;
      return timeB - timeA;
    });

    return list;
  }, [records, allMapsPets, maps]);

  // Filtered list
  const filteredList = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();

    return historyList.filter((item) => {
      // Status filter
      if (statusFilter === 'encountered' && !item.record.encountered) return false;
      if (statusFilter === 'unencountered' && item.record.encountered) return false;

      // Map filter
      if (selectedMapFilter !== 'all' && item.record.mapId !== selectedMapFilter) return false;

      // Search query
      if (q) {
        const nameMatch = item.cleanName.toLowerCase().includes(q);
        const mapMatch = item.mapObj.name.toLowerCase().includes(q);
        const noteMatch = (item.record.note || '').toLowerCase().includes(q);
        return nameMatch || mapMatch || noteMatch;
      }

      return true;
    });
  }, [historyList, statusFilter, selectedMapFilter, searchQuery]);

  if (!isOpen) return null;

  const totalHistoryCount = historyList.length;
  const encounteredCount = historyList.filter((i) => i.record.encountered).length;
  const unencounteredCount = totalHistoryCount - encounteredCount;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150 select-none"
      onWheel={(e) => e.stopPropagation()}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl bg-white dark:bg-slate-900 rounded-3xl border-4 border-[#7ABCF4] dark:border-slate-700 shadow-2xl overflow-hidden flex flex-col max-h-[88vh] animate-in zoom-in-95 duration-200 transition-colors"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 bg-gradient-to-r from-[#F5F9FF] to-white dark:from-slate-800 dark:to-slate-900 border-b-2 border-[#E6EEF8] dark:border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-[#7ABCF4] to-[#2B78C4] text-white flex items-center justify-center shadow-sm">
              <History className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-800 dark:text-slate-100 flex items-center gap-2">
                图鉴遇见与操作历史
                <span className="text-[11px] font-black px-2 py-0.5 rounded-full bg-[#EBF4FE] dark:bg-sky-950/70 text-[#2B78C4] dark:text-sky-300 border border-[#BCD7F2] dark:border-sky-800">
                  共 {totalHistoryCount} 条操作记录
                </span>
              </h3>
              <p className="text-xs text-slate-400 font-medium mt-0.5">
                可快速核对近期点亮与取消的精灵，防止误操作
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              sound.playClick();
              onClose();
            }}
            className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-300 flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search & Filter Toolbar */}
        <div className="p-3.5 bg-slate-50 dark:bg-slate-800/80 border-b border-[#E6EEF8] dark:border-slate-700 space-y-2.5 shrink-0">
          {/* Search bar */}
          <div className="relative">
            <Search className="w-4 h-4 text-[#7ABCF4] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="快速检索历史精灵名称、地图或备注..."
              className="w-full pl-10 pr-9 py-2 text-xs sm:text-sm bg-white dark:bg-slate-900 border-2 border-[#BCD7F2] dark:border-slate-700 focus:border-[#7ABCF4] dark:focus:border-sky-400 rounded-xl outline-hidden text-slate-800 dark:text-slate-100 font-bold shadow-inner placeholder:text-slate-400 placeholder:font-normal"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-full cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Filter Pills */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            {/* Status Filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-black text-slate-400">状态:</span>
              <button
                type="button"
                onClick={() => {
                  sound.playClick();
                  setStatusFilter('all');
                }}
                className={`px-2.5 py-1 rounded-lg text-xs font-black transition-all cursor-pointer ${
                  statusFilter === 'all'
                    ? 'bg-[#7ABCF4] dark:bg-sky-500 text-white shadow-xs'
                    : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                全部 ({totalHistoryCount})
              </button>
              <button
                type="button"
                onClick={() => {
                  sound.playClick();
                  setStatusFilter('encountered');
                }}
                className={`px-2.5 py-1 rounded-lg text-xs font-black transition-all cursor-pointer flex items-center gap-1 ${
                  statusFilter === 'encountered'
                    ? 'bg-[#95D151] text-white shadow-xs'
                    : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[#2D6613] dark:text-emerald-400 hover:bg-[#E1F7DB]/50 dark:hover:bg-emerald-950/40'
                }`}
              >
                <Check className="w-3 h-3 stroke-[3]" />
                已遇见 ({encounteredCount})
              </button>
              <button
                type="button"
                onClick={() => {
                  sound.playClick();
                  setStatusFilter('unencountered');
                }}
                className={`px-2.5 py-1 rounded-lg text-xs font-black transition-all cursor-pointer flex items-center gap-1 ${
                  statusFilter === 'unencountered'
                    ? 'bg-amber-500 text-white shadow-xs'
                    : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40'
                }`}
              >
                <EyeOff className="w-3 h-3" />
                已取消 ({unencounteredCount})
              </button>
            </div>

            {/* Map Filter */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] font-black text-slate-400">地图:</span>
              <button
                type="button"
                onClick={() => {
                  sound.playClick();
                  setSelectedMapFilter('all');
                }}
                className={`px-2 py-0.8 rounded-lg text-[11px] font-black transition-all cursor-pointer ${
                  selectedMapFilter === 'all'
                    ? 'bg-slate-700 dark:bg-sky-600 text-white shadow-xs'
                    : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                全部地图
              </button>
              {maps.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    sound.playClick();
                    setSelectedMapFilter(m.id);
                  }}
                  className={`px-2 py-0.8 rounded-lg text-[11px] font-black transition-all cursor-pointer flex items-center gap-1 ${
                    selectedMapFilter === m.id
                      ? 'bg-slate-700 dark:bg-sky-600 text-white shadow-xs'
                      : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <span>{m.num}、{m.name.replace('记忆中的', '')}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* History List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5 max-h-[55vh]">
          {filteredList.length === 0 ? (
            <div className="py-16 text-center text-slate-400 flex flex-col items-center justify-center">
              <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 dark:text-slate-500 mb-2">
                <History className="w-6 h-6" />
              </div>
              <p className="text-sm font-black text-slate-700 dark:text-slate-200">暂无相关历史记录</p>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                进行精灵识别或在图鉴中点击点亮/取消后，此处将按时间倒序展示操作流
              </p>
            </div>
          ) : (
            filteredList.map((item) => {
              const { record, petMeta, cleanName, mapObj } = item;
              const isEnc = record.encountered;
              const timeObj = formatTime(record.lastSeenAt || record.firstSeenAt);
              const avatarUrl =
                petMeta?.url || `${api.getApiBase()}/icons/${encodeURIComponent(cleanName)}.png`;

              return (
                <div
                  key={`${record.mapId}_${record.filename}_${record.lastSeenAt || ''}`}
                  className={`group p-2.5 sm:p-3 rounded-2xl border-2 transition-all flex items-center justify-between gap-2.5 sm:gap-3 ${
                    isEnc
                      ? 'bg-[#F9FEF8] dark:bg-emerald-950/30 border-[#95D151]/60 dark:border-emerald-600/50 hover:border-[#95D151]'
                      : 'bg-slate-50/80 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                  }`}
                >
                  {/* Left: Avatar + Details */}
                  <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                    <div className="relative w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-white dark:bg-slate-900 border border-[#E6EEF8] dark:border-slate-700 p-0.5 flex items-center justify-center shrink-0 shadow-2xs">
                      {IS_STATIC && petMeta?.sprite ? (
                          <PetSprite
                              pet={petMeta}
                              alt={cleanName}
                              className="w-full h-full object-contain pointer-events-none"
                          />
                      ) : (
                          <ImageZoom
                              src={avatarUrl}
                              alt={cleanName}
                              className="w-full h-full"
                              imgClassName="w-full h-full object-contain pointer-events-none"
                              zoomWidth={240}
                              zoomHeight={240}
                          />
                      )}
                      <ElementBadges
                        elements={petMeta?.elements}
                        className="absolute top-0 left-0 z-10 scale-90 origin-top-left"
                        size="xs"
                      />
                      {isEnc ? (
                        <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-[#95D151] rounded-full flex items-center justify-center text-white shadow-xs border border-white dark:border-slate-800">
                          <Check className="w-2.5 h-2.5 stroke-[3]" />
                        </div>
                      ) : (
                        <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-slate-400 rounded-full flex items-center justify-center text-white shadow-xs border border-white dark:border-slate-800">
                          <EyeOff className="w-2.5 h-2.5" />
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                        <h4 className="text-xs sm:text-sm font-black text-slate-800 dark:text-slate-100 min-w-0 truncate" title={cleanName}>
                          {cleanName}
                        </h4>

                        {/* Map Badge */}
                        <span
                          className="text-[10px] font-black px-1.5 py-0.2 rounded-md border flex items-center gap-0.5 whitespace-nowrap shrink-0"
                          style={{
                            backgroundColor:
                              mapObj.num === 1 ? '#E1F7DB' : mapObj.num === 2 ? '#FEF9E6' : '#EBF4FE',
                            color: mapObj.num === 1 ? '#2D6613' : mapObj.num === 2 ? '#854D0E' : '#1D5E9E',
                            borderColor:
                              mapObj.num === 1 ? '#95D151' : mapObj.num === 2 ? '#FEE061' : '#7ABCF4',
                          }}
                        >
                          <MapPin className="w-2.5 h-2.5" />
                          {mapObj.num}、{mapObj.name.replace('记忆中的', '')}
                        </span>

                        {/* Status Badge */}
                        {isEnc ? (
                          <span className="text-[10px] font-black px-1.5 py-0.2 rounded-full bg-[#E1F7DB] dark:bg-emerald-950/60 text-[#2D6613] dark:text-emerald-300 border border-[#95D151]/50 whitespace-nowrap shrink-0">
                            已点亮
                          </span>
                        ) : (
                          <span className="text-[10px] font-black px-1.5 py-0.2 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 whitespace-nowrap shrink-0">
                            未遇见
                          </span>
                        )}
                      </div>

                      {/* Time info and note */}
                      <div className="flex items-center gap-2 text-[10px] sm:text-[11px] text-slate-400 mt-1 flex-wrap font-medium">
                        <span className="flex items-center gap-1 font-mono text-slate-500 dark:text-slate-400 shrink-0" title={timeObj.fullTime}>
                          <Clock className="w-3 h-3 text-slate-400" />
                          {timeObj.relative}
                        </span>
                        {record.note && (
                          <span className="bg-white dark:bg-slate-800 px-1.5 py-0.2 rounded border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 text-[10px] truncate max-w-[180px]">
                            {record.note}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right Actions: Quick Undo Toggle & Optional Navigate */}
                  <div className="flex items-center gap-2 shrink-0">
                    {/* Toggle Button for undoing accidental clicks */}
                    <button
                      type="button"
                      onClick={() => {
                        sound.playClick();
                        onToggleEncounter(record.mapId, record.filename);
                      }}
                      className={`px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-xl text-xs font-black border-2 transition-all flex items-center gap-1 cursor-pointer active:scale-95 ${
                        isEnc
                          ? 'bg-white dark:bg-slate-800 hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:border-rose-300 text-rose-600 dark:text-rose-400 border-slate-200 dark:border-slate-700'
                          : 'bg-[#E1F7DB] dark:bg-emerald-950/60 hover:bg-[#D3F3CA] text-[#2D6613] dark:text-emerald-300 border-[#95D151]'
                      }`}
                      title={isEnc ? '误操作点亮？点击撤销恢复为未遇见' : '重新点亮为已遇见'}
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>{isEnc ? '撤销遇见' : '重新点亮'}</span>
                    </button>

                    {/* Navigate / Locate Button */}
                    {onNavigateToPet && (
                      <button
                        type="button"
                        onClick={() => {
                          sound.playClick();
                          onNavigateToPet(mapObj.num, record.filename);
                          onClose();
                        }}
                        className="p-1 sm:p-1.5 rounded-xl bg-white dark:bg-slate-800 hover:bg-[#7ABCF4] dark:hover:bg-sky-600 text-slate-400 hover:text-white border border-slate-200 dark:border-slate-700 hover:border-[#7ABCF4] transition-colors cursor-pointer"
                        title="在主界面图鉴中定位此精灵"
                      >
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer info */}
        <div className="px-5 py-3 bg-slate-50 dark:bg-slate-800/80 border-t-2 border-[#E6EEF8] dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 font-bold shrink-0">
          <span>
            当前展示 <strong className="text-[#2B78C4] dark:text-sky-400">{filteredList.length}</strong> 条操作记录
          </span>
          <span className="text-[11px] text-slate-400">
            按时间倒序排列 · 支持一键撤销以防止误点
          </span>
        </div>
      </div>
    </div>
  );
};
