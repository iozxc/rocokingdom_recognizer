import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  History,
  X,
  Search,
  Check,
  RotateCcw,
  CalendarClock,
  MapPin,
  EyeOff,
  ArrowRight,
  Undo2,
  ListFilter,
} from 'lucide-react';
import { EncounterRecord, MapConfig, PetItem } from '../types';
import { MAP_CONFIGS } from '../data/mockPets';
import { sound } from '../services/sound';
import { ModalHeader, ModalHeaderBadge } from './ModalHeader';
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

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * 时间格式化：返回「完整时间」+「相对时间」两段。
 *
 * 之前只显示「4小时前」，同一天的几十条记录看起来一模一样、无法定位到具体时刻。
 * 现在主显完整日期时刻（今天/昨天/M月D日/YYYY年M月D日 + HH:mm），
 * 相对时间作为次要信息补充，鼠标悬停还能看到带秒的完整时间戳。
 */
function formatTimeParts(timeStr?: string): { absolute: string; relative: string; tooltip: string } {
  if (!timeStr) return { absolute: '未知时间', relative: '', tooltip: '未知时间' };
  const date = new Date(timeStr);
  if (isNaN(date.getTime())) return { absolute: timeStr, relative: '', tooltip: timeStr };

  const now = new Date();
  const diffSec = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);

  // 相对时间（超过 30 天不再展示，绝对时间已足够）
  let relative = '';
  if (diffSec < 30) relative = '刚刚';
  else if (diffSec < 60) relative = `${diffSec} 秒前`;
  else if (diffMin < 60) relative = `${diffMin} 分钟前`;
  else if (diffHour < 24) relative = `${diffHour} 小时前`;
  else if (diffHour < 24 * 30) relative = `${Math.floor(diffHour / 24)} 天前`;

  // 绝对时间：完整到分钟，跨年才带年份
  const hhmm = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  const t = date.getTime();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const DAY = 86400000;
  let absolute: string;
  if (t >= dayStart) absolute = `今天 ${hhmm}`;
  else if (t >= dayStart - DAY) absolute = `昨天 ${hhmm}`;
  else if (date.getFullYear() === now.getFullYear()) absolute = `${date.getMonth() + 1}月${date.getDate()}日 ${hhmm}`;
  else absolute = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${hhmm}`;

  const tooltip =
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ` +
    `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;

  return { absolute, relative, tooltip };
}

/**
 * 地图主题色，按图号区分。
 *
 * 注意：这里必须返回 **Tailwind 类**而不是内联色值。
 * 原来用 style={{ backgroundColor: '#E1F7DB' }} 写死浅色，内联样式优先级最高、
 * 又不认 `dark:` 前缀，于是暗黑模式下这几个 tag 就变成刺眼的亮色块（用户反馈的问题）。
 */
function mapTone(num: number) {
  if (num === 1) {
    return {
      tag: 'bg-emerald-100 text-emerald-800 ring-emerald-300 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30',
      chip: 'bg-emerald-100 text-emerald-800 ring-emerald-300 dark:bg-emerald-500/20 dark:text-emerald-200 dark:ring-emerald-500/40',
    };
  }
  if (num === 2) {
    return {
      tag: 'bg-amber-100 text-amber-800 ring-amber-300 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30',
      chip: 'bg-amber-100 text-amber-800 ring-amber-300 dark:bg-amber-500/20 dark:text-amber-200 dark:ring-amber-500/40',
    };
  }
  return {
    tag: 'bg-sky-100 text-sky-800 ring-sky-300 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-500/30',
    chip: 'bg-sky-100 text-sky-800 ring-sky-300 dark:bg-sky-500/20 dark:text-sky-200 dark:ring-sky-500/40',
  };
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
  // 刚被切换的那一条：短暂高亮，避免「点完就跳走」找不到人
  const [flashKey, setFlashKey] = useState<string | null>(null);
  const flashTimer = useRef<number | null>(null);

  const maps = mapsConfig && mapsConfig.length > 0 ? mapsConfig : MAP_CONFIGS;

  // 切一条记录后，列表会按时间重排把这条顶到最前 —— 高亮一下让用户跟得住
  const flashRow = (key: string) => {
    setFlashKey(key);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlashKey(null), 1800);
  };

  useEffect(() => () => {
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
  }, []);

  // Esc 关闭
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  // Convert and sort records into list
  const historyList = useMemo(() => {
    const recordsArray = Object.values(records || {}) as EncounterRecord[];
    const list = recordsArray.filter((r) => r && r.filename).map((r) => {
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

      return { record: r, petMeta, cleanName, mapObj, sortTime };
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
      if (statusFilter === 'encountered' && !item.record.encountered) return false;
      if (statusFilter === 'unencountered' && item.record.encountered) return false;
      if (selectedMapFilter !== 'all' && item.record.mapId !== selectedMapFilter) return false;

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
  const hasActiveFilter =
    !!searchQuery.trim() || statusFilter !== 'all' || selectedMapFilter !== 'all';

  const resetFilters = () => {
    sound.playClick();
    setSearchQuery('');
    setStatusFilter('all');
    setSelectedMapFilter('all');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/55 backdrop-blur-sm animate-in fade-in duration-150"
      onWheel={(e) => e.stopPropagation()}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl bg-white dark:bg-slate-900 rounded-[26px] shadow-2xl ring-1 ring-slate-900/5 dark:ring-white/10 overflow-hidden flex flex-col max-h-[88vh] animate-in zoom-in-95 duration-200 transition-colors"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ─────────────────────────────────────────── */}
        <ModalHeader
            icon={History}
            tone="amber"
            title="图鉴遇见与操作历史"
            badge={<ModalHeaderBadge>{totalHistoryCount} 条</ModalHeaderBadge>}
            subtitle="按时间倒序排列，可一键撤销误点亮的精灵"
            onClose={onClose}
            closeTitle="关闭 (Esc)"
        />

        {/* ── 搜索 + 筛选 ─────────────────────────────────────── */}
        <div className="px-4 py-3 bg-slate-50/80 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800 space-y-2.5 shrink-0">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索精灵名称、地图或备注…"
              className="w-full h-10 pl-10 pr-9 text-xs sm:text-[13px] bg-white dark:bg-slate-900 ring-1 ring-inset ring-slate-200 dark:ring-slate-700 focus:ring-2 focus:ring-[#7ABCF4] dark:focus:ring-sky-600 rounded-xl outline-hidden text-slate-800 dark:text-slate-100 font-medium placeholder:text-slate-400 dark:placeholder:text-slate-500 transition-all"
            />
            {searchQuery && (
              <button
                type="button"
                aria-label="清除搜索"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* 状态：单色 segmented control，选中项白底浮起 */}
          <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800">
            {([
              { id: 'all', label: '全部', count: totalHistoryCount },
              { id: 'encountered', label: '已遇见', count: encounteredCount },
              { id: 'unencountered', label: '已取消', count: unencounteredCount },
            ] as const).map((s) => {
              const active = statusFilter === s.id;
              const tone =
                s.id === 'encountered'
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : s.id === 'unencountered'
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-[#2B78C4] dark:text-sky-400';
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    sound.playClick();
                    setStatusFilter(s.id);
                  }}
                  className={`h-8 rounded-lg text-[11px] font-black flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    active
                      ? `bg-white dark:bg-slate-900 shadow-sm ${tone}`
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                  }`}
                >
                  {s.label}
                  <span className={`text-[10px] font-mono ${active ? 'opacity-70' : 'opacity-60'}`}>
                    {s.count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* 地图筛选 */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 shrink-0">地图</span>
            {([{ id: 'all', num: 0, name: '全部' }, ...maps] as any[]).map((m) => {
              const active = selectedMapFilter === m.id;
              const tone = m.num ? mapTone(m.num) : null;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    sound.playClick();
                    setSelectedMapFilter(m.id);
                  }}
                  className={`h-7 px-2.5 rounded-lg text-[11px] font-black transition-all cursor-pointer ring-1 ring-inset ${
                    active
                      ? (tone ? `${tone.chip} shadow-sm` : 'bg-slate-700 dark:bg-sky-600 text-white ring-transparent shadow-sm')
                      : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 ring-slate-200 dark:ring-slate-700 hover:ring-slate-300 dark:hover:ring-slate-600'
                  }`}
                >
                  {m.num ? `${m.num}、${String(m.name).replace('记忆中的', '')}` : '全部'}
                </button>
              );
            })}

            {hasActiveFilter && (
              <button
                type="button"
                onClick={resetFilters}
                className="ml-auto h-7 px-2.5 rounded-lg text-[11px] font-black text-[#2B78C4] dark:text-sky-300 bg-sky-50 dark:bg-sky-950/50 ring-1 ring-inset ring-sky-200 dark:ring-sky-900 hover:bg-sky-100 dark:hover:bg-sky-900/60 transition-colors cursor-pointer flex items-center gap-1"
              >
                <X className="w-3 h-3" />
                清除筛选
              </button>
            )}
          </div>
        </div>

        {/* ── 列表 ───────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto custom-roco-scrollbar px-4 py-3 space-y-2">
          {totalHistoryCount === 0 ? (
            <EmptyState
              title="暂无历史记录"
              desc="进行精灵识别，或在图鉴中点亮/取消后，这里会按时间倒序展示操作记录"
            />
          ) : filteredList.length === 0 ? (
            <EmptyState
              title="没有匹配的记录"
              desc="试试换个关键词，或清除当前筛选条件"
              action={
                <button
                  type="button"
                  onClick={resetFilters}
                  className="mt-3 h-8 px-3 rounded-lg text-[11px] font-black text-[#2B78C4] dark:text-sky-300 bg-sky-50 dark:bg-sky-950/50 ring-1 ring-inset ring-sky-200 dark:ring-sky-900 hover:bg-sky-100 transition-colors cursor-pointer inline-flex items-center gap-1.5"
                >
                  <ListFilter className="w-3.5 h-3.5" />
                  清除筛选
                </button>
              }
            />
          ) : (
            filteredList.map((item) => {
              const { record, petMeta, cleanName, mapObj } = item;
              const isEnc = record.encountered;
              const time = formatTimeParts(record.lastSeenAt || record.firstSeenAt);
              const avatarUrl =
                petMeta?.url || `${api.getApiBase()}/icons/${encodeURIComponent(cleanName)}.png`;
              const rowKey = `${record.mapId}_${record.filename}`;
              const flashing = flashKey === rowKey;
              const tone = mapTone(mapObj.num);

              return (
                <div
                  key={rowKey}
                  className={`group relative flex items-center gap-3 rounded-2xl px-3 py-2.5 ring-inset transition-all duration-300 ${
                    flashing
                      ? 'bg-sky-50 dark:bg-sky-950/40 ring-2 ring-[#7ABCF4]'
                      : isEnc
                        ? 'bg-emerald-50/50 dark:bg-emerald-950/20 ring-1 ring-emerald-100 dark:ring-emerald-900/40 hover:ring-emerald-300 dark:hover:ring-emerald-700'
                        : 'bg-slate-50 dark:bg-slate-800/60 ring-1 ring-slate-200 dark:ring-slate-700 hover:ring-slate-300 dark:hover:ring-slate-600'
                  }`}
                >
                  {/* 精灵头像 + 状态角标 */}
                  <div className="relative w-11 h-11 rounded-xl bg-white dark:bg-slate-900 ring-1 ring-inset ring-slate-200/70 dark:ring-slate-700 p-0.5 flex items-center justify-center shrink-0">
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
                    <div
                      className={`absolute -bottom-1 -right-1 w-[18px] h-[18px] rounded-full flex items-center justify-center text-white shadow-sm ring-2 ring-white dark:ring-slate-900 ${
                        isEnc ? 'bg-emerald-500' : 'bg-slate-400'
                      }`}
                    >
                      {isEnc ? <Check className="w-2.5 h-2.5 stroke-[3]" /> : <EyeOff className="w-2.5 h-2.5" />}
                    </div>
                  </div>

                  {/* 名称 / 标签 / 时间 */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <h4
                        className="text-[13px] font-black text-slate-800 dark:text-slate-100 truncate max-w-full"
                        title={cleanName}
                      >
                        {cleanName}
                      </h4>
                      <span
                        className={`text-[10px] font-black px-1.5 py-0.5 rounded-md inline-flex items-center gap-0.5 whitespace-nowrap shrink-0 ring-1 ring-inset ${tone.tag}`}
                      >
                        <MapPin className="w-2.5 h-2.5" />
                        {mapObj.num}、{mapObj.name.replace('记忆中的', '')}
                      </span>
                      <span
                        className={`text-[10px] font-black px-1.5 py-0.5 rounded-full whitespace-nowrap shrink-0 ${
                          isEnc
                            ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                            : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {isEnc ? '已点亮' : '已取消'}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {/* 完整时间为主，相对时间为辅 */}
                      <span
                        className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-600 dark:text-slate-300 tabular-nums shrink-0"
                        title={time.tooltip}
                      >
                        <CalendarClock className="w-3 h-3 text-slate-400" />
                        {time.absolute}
                      </span>
                      {time.relative && (
                        <span className="text-[10px] text-slate-400 dark:text-slate-500 shrink-0">
                          {time.relative}
                        </span>
                      )}
                      {record.note && (
                        <span
                          className="text-[10px] text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-800 px-1.5 py-0.5 rounded-md ring-1 ring-inset ring-slate-200 dark:ring-slate-700 truncate max-w-[190px]"
                          title={record.note}
                        >
                          {record.note}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 操作 */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        sound.playClick();
                        flashRow(rowKey);
                        onToggleEncounter(record.mapId, record.filename);
                      }}
                      className={`h-8 px-2.5 rounded-xl text-[11px] font-black inline-flex items-center gap-1 transition-all cursor-pointer ring-1 ring-inset active:scale-95 ${
                        isEnc
                          ? 'bg-white dark:bg-slate-800 text-rose-600 dark:text-rose-400 ring-rose-200 dark:ring-rose-900/60 hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:ring-rose-300'
                          : 'bg-emerald-500 text-white ring-emerald-500 hover:bg-emerald-600 shadow-sm'
                      }`}
                      title={isEnc ? '误操作点亮？点击撤销，恢复为未遇见' : '重新点亮为已遇见'}
                    >
                      {isEnc ? <Undo2 className="w-3.5 h-3.5" /> : <RotateCcw className="w-3.5 h-3.5" />}
                      <span className="hidden sm:inline">{isEnc ? '撤销' : '点亮'}</span>
                    </button>

                    {onNavigateToPet && (
                      <button
                        type="button"
                        onClick={() => {
                          sound.playClick();
                          onNavigateToPet(mapObj.num, record.filename);
                          onClose();
                        }}
                        className="w-8 h-8 rounded-xl bg-white dark:bg-slate-800 text-slate-400 dark:text-slate-500 ring-1 ring-inset ring-slate-200 dark:ring-slate-700 hover:bg-[#7ABCF4] hover:text-white hover:ring-[#7ABCF4] dark:hover:bg-sky-600 dark:hover:ring-sky-600 transition-colors cursor-pointer flex items-center justify-center"
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

        {/* ── Footer ─────────────────────────────────────────── */}
        <div className="px-5 py-3 bg-slate-50 dark:bg-slate-800/60 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
          <span>
            当前展示 <strong className="text-[#2B78C4] dark:text-sky-400 font-black">{filteredList.length}</strong>
            {hasActiveFilter && <span className="text-slate-400"> / {totalHistoryCount}</span>} 条记录
          </span>
          <span className="text-slate-400 dark:text-slate-500 hidden sm:inline">
            撤销后该条会移到最上方并高亮
          </span>
        </div>
      </div>
    </div>
  );
};

/** 空态：区分「一条记录都没有」和「筛选后无结果」两种场景。 */
const EmptyState: React.FC<{ title: string; desc: string; action?: React.ReactNode }> = ({
  title,
  desc,
  action,
}) => (
  <div className="py-16 text-center flex flex-col items-center justify-center">
    <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 dark:text-slate-500 mb-2">
      <History className="w-6 h-6" />
    </div>
    <p className="text-sm font-black text-slate-700 dark:text-slate-200">{title}</p>
    <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 max-w-xs leading-relaxed">{desc}</p>
    {action}
  </div>
);
