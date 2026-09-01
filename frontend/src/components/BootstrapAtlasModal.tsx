import React, { useEffect, useMemo, useState } from 'react';
import { X, Check, Sparkles, RefreshCw, Eye, EyeOff, Percent } from 'lucide-react';
import { PetItem, EncounterRecord } from '../types';
import { PetSprite } from './PetSprite';
import { TrialAtlas, AtlasEntry, petKeyOf } from '../services/atlasCollector';
import { isPetEncounteredInRecords } from '../utils/petHelper';

interface BootstrapAtlasModalProps {
  isOpen: boolean;
  onClose: () => void;
  trialKey?: string;
  mapsPets: Record<string, { count: number; items: PetItem[] }>;
  records: Record<string, EncounterRecord>;
  /** 与首页图鉴共用同一份社区图鉴数据（避免两处取值不一致）。 */
  atlas: TrialAtlas | null;
  /** 本地优化赞同率（与首页一致）。*/
  communityAtlas?: Record<string, { confirmed_by: number; confidence: number; agree_ratio?: number; vote_ratio?: number; total_users?: number; voter_count?: number; my_vote?: 'agree' | 'disagree' | 'none' }>;
  onVote: (mapId: string, petKey: string, filename: string, type: 'agree' | 'disagree') => void;
  /** 点击卡片点亮/取消点亮（与首页 PetGrid 同一状态机）。 */
  onToggleEncounter: (mapId: string, filename: string) => void;
  manualVotes: Record<string, Record<string, 'agree' | 'disagree'>>;
  /** 刷新图鉴（从服务器拉取最新社区图鉴/赞同率）。 */
  onRefresh?: () => void;
  /** 首页图鉴赞同率筛选阈值（0~1）。 */
  minAgreeRatio?: number;
  onMinAgreeRatioChange?: (v: number) => void;
  /** 隐藏投票/赞同率开关（关闭时本弹窗也不展示投票 UI，数据照常计算）。 */
  showAtlasVote?: boolean;
  onToggleShowVote?: () => void;
}

type Tab = 'all' | 'community' | 'mine';

/** 共创期「社区(部分)图鉴 × 我的图鉴」双视图 + 纠错/投票。 */
export const BootstrapAtlasModal: React.FC<BootstrapAtlasModalProps> = ({
  isOpen,
  onClose,
  trialKey = 'fire',
  mapsPets,
  records,
  atlas,
  communityAtlas,
  onVote,
  onToggleEncounter,
  manualVotes,
  onRefresh,
  minAgreeRatio,
  onMinAgreeRatioChange,
  showAtlasVote = true,
  onToggleShowVote,
}) => {
  const [tab, setTab] = useState<Tab>('all');
  const [selectedMap, setSelectedMap] = useState<string>('');

  const metaTotal = atlas?.meta?.confirmed_total ?? 0;

  // 默认选中第一个有数据的地图
  useEffect(() => {
    const maps = atlas?.maps || {};
    const ids = Object.keys(maps).sort();
    if (ids.length && !ids.includes(selectedMap)) setSelectedMap(ids[0]);
  }, [atlas, selectedMap]);

  const entriesByMap = useMemo(() => {
    const out: Array<{ mapId: string; entries: Array<{ entry: AtlasEntry; filename: string; pet?: PetItem; encountered: boolean }> }> = [];
    const maps = atlas?.maps || {};
    Object.keys(maps).sort().forEach((mapId) => {
      const list = Object.keys(maps[mapId]).map((key) => {
        const entry = maps[mapId][key];
        const pet = (mapsPets[mapId]?.items || []).find(
            (p) => petKeyOf(p.name, p.id, p.seq) === (entry.pet_key || (entry.id != null ? String(entry.id) : ''))
        );
        const encountered = isPetEncounteredInRecords(records, mapId, pet?.name || entry.name);
        return { entry, filename: entry.filename || entry.name || '', pet, encountered };
      });
      out.push({ mapId, entries: list });
    });
    return out;
  }, [atlas, mapsPets, records]);

  const filtered = useMemo(() => {
    return entriesByMap.map((m) => ({
      mapId: m.mapId,
      entries: m.entries.filter((it) => (tab === 'community' ? it.entry.confirmed_by >= 1 : tab === 'mine' ? it.encountered : true)),
    }));
  }, [entriesByMap, tab]);

  if (!isOpen) return null;

  return (
      <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={onClose}
          onWheel={(e) => e.stopPropagation()}
      >
        <div
            className="relative w-full max-w-3xl bg-white rounded-3xl border-2 border-amber-300 shadow-2xl overflow-hidden flex flex-col max-h-[88vh] animate-in fade-in duration-150"
            onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-5 py-4 bg-gradient-to-r from-orange-50 to-white border-b border-orange-100 flex items-center justify-between shrink-0">
            <div>
              <h3 className="text-base font-black text-orange-900 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-orange-500" />
                火系 · 共创图鉴
                {atlas?.partial && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 border border-orange-200">
                      社区版(部分)
                    </span>
                )}
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                当前已确认 {metaTotal} 只 · 与你的「已点亮」图鉴同屏，可赞同/不赞同
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={onClose} className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 flex items-center justify-center" title="关闭">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* 图鉴控制条：刷新图鉴 / 隐藏投票 / 赞同率筛选（自悬浮按钮组迁入） */}
          {(onRefresh || onToggleShowVote || onMinAgreeRatioChange) && (
              <div className="px-5 py-2.5 bg-white border-b border-orange-100 flex flex-wrap items-center gap-2 shrink-0">
                {onRefresh && (
                    <button
                        type="button"
                        onClick={onRefresh}
                        className="px-3 py-1.5 rounded-xl text-xs font-black cursor-pointer border-2 bg-white text-slate-600 border-slate-200 hover:border-sky-300 hover:text-[#2B78C4] transition-colors flex items-center gap-1.5"
                        title="刷新图鉴（拉取最新社区图鉴/赞同率）"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      刷新图鉴
                    </button>
                )}
                {onToggleShowVote && (
                    <button
                        type="button"
                        onClick={onToggleShowVote}
                        className="px-3 py-1.5 rounded-xl text-xs font-black cursor-pointer border-2 bg-white text-slate-600 border-slate-200 hover:border-slate-300 transition-colors flex items-center gap-1.5"
                        title={showAtlasVote ? '隐藏投票/赞同率（数据仍会计算）' : '显示投票/赞同率'}
                    >
                      {showAtlasVote ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      {showAtlasVote ? '隐藏投票' : '显示投票'}
                    </button>
                )}
                {onMinAgreeRatioChange && (
                    <div
                        className="flex items-center gap-2 px-3 py-1.5 rounded-xl border-2 bg-white border-slate-200"
                        title={`赞同率筛选 ≥ ${Math.round((minAgreeRatio ?? 0.75) * 100)}%（仅展示达到阈值的社区精灵）`}
                    >
                      <Percent className="w-3.5 h-3.5 text-slate-500" />
                      <span className="text-xs font-black text-slate-600">赞同率</span>
                      <input
                          type="range"
                          min="0"
                          max="100"
                          step="1"
                          value={Math.round((minAgreeRatio ?? 0.75) * 100)}
                          onChange={(e) => onMinAgreeRatioChange(parseInt(e.target.value, 10) / 100)}
                          className="w-24 accent-orange-500 cursor-pointer"
                      />
                      <span className="text-xs font-black text-orange-600 w-9 text-right tabular-nums">
                        {Math.round((minAgreeRatio ?? 0.75) * 100)}%
                      </span>
                    </div>
                )}
              </div>
          )}

          {/* Tabs */}
          <div className="px-5 pt-3 flex flex-wrap items-center gap-2 shrink-0">
            {([['all', '全部'], ['community', '社区已确认'], ['mine', '我已点亮']] as [Tab, string][]).map(([k, label]) => (
                <button
                    key={k}
                    onClick={() => setTab(k)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-black cursor-pointer border-2 transition-colors ${
                        tab === k ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-slate-600 border-slate-200 hover:border-orange-300'
                    }`}
                >
                  {label}
                </button>
            ))}
          </div>

          {/* 地图切换 + 每图数量 */}
          {atlas && filtered.length > 0 && (
              <div className="px-5 pt-2 pb-3 flex flex-wrap items-center gap-2 shrink-0">
                {filtered.map((m) => {
                  const selected = m.mapId === selectedMap;
                  return (
                      <button
                          key={m.mapId}
                          onClick={() => setSelectedMap(m.mapId)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-black cursor-pointer border-2 transition-colors ${selected ? 'bg-[#2B78C4] text-white border-[#1E5B99]' : 'bg-white text-slate-600 border-slate-200 hover:border-sky-300'}`}
                      >
                        {图N(m.mapId)} · <span className="font-mono">{m.entries.length}</span>
                      </button>
                  );
                })}
              </div>
          )}

          {/* Body */}
          <div className="flex-1 overflow-y-auto overscroll-contain p-5 space-y-5">
            {!atlas && (
                <div className="py-16 text-center text-slate-400">
                  <p className="text-sm font-black text-slate-600">暂无社区图鉴数据</p>
                  <p className="text-xs mt-1">在火系跟随识别或首页识别后会自动上报，稍后点「刷新图鉴」查看</p>
                </div>
            )}
            {atlas && filtered.filter((m) => m.mapId === selectedMap).map((m) => (
                <section key={m.mapId}>
                  <h4 className="text-sm font-black text-orange-900 mb-2">{图N(m.mapId)} · {m.entries.length} 只</h4>
                  {m.entries.length === 0 ? (
                      <div className="text-xs text-slate-400 py-3">该图暂无{tab === 'mine' ? '已点亮' : tab === 'community' ? '社区确认' : ''}精灵</div>
                  ) : (
                      <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(112px,1fr))]">
                        {m.entries.map(({ entry, filename, pet, encountered }) => (
                            (() => {
                              const pk = entry.pet_key || (entry.id != null ? String(entry.id) : '');
                              const local = communityAtlas?.[`${m.mapId}:${pk}`];
                              const effVote = manualVotes?.[m.mapId]?.[pk] ?? local?.my_vote ?? (entry.my_vote ?? 'none');
                              const ratio = local?.agree_ratio ?? entry.agree_ratio;
                              return (
                            <div
                                key={`${m.mapId}-${entry.pet_key || entry.id}`}
                                onClick={() => { if (pet) onToggleEncounter(m.mapId, pet.name); }}
                                className={`relative rounded-2xl border-2 p-2 flex flex-col items-center text-center transition-colors ${encountered ? 'bg-green-50 border-green-300' : 'bg-white border-slate-200'} ${pet ? 'cursor-pointer hover:border-orange-300' : ''}`}
                                title={pet ? (encountered ? `点击取消点亮「${pet.name}」` : `点击点亮「${pet.name}」`) : undefined}
                            >
                              <div className="relative w-14 h-14 rounded-xl bg-white p-0.5 border border-slate-200 flex items-center justify-center">
                                {showAtlasVote && (() => {
                                  const conf = (local?.confidence ?? entry.confidence) ?? 0;
                                  const ccls = conf >= 0.7 ? 'bg-green-100 text-green-700 border-green-300'
                                      : conf >= 0.3 ? 'bg-amber-100 text-amber-700 border-amber-300'
                                          : 'bg-rose-100 text-rose-700 border-rose-300';
                                  return (
                                      <div className="absolute -top-[3px] left-0 right-0 flex justify-center">
                                        <span className={`text-[7px] font-mono font-black px-1 py-0.5 rounded-full border ${ccls}`}>置信度：{Math.round(conf * 100)}%</span>
                                      </div>
                                  );
                                })()}
                                {pet ? (
                                    <PetSprite pet={pet} className="w-full h-full object-contain" />
                                ) : (
                                    <span className="w-full h-full flex items-center justify-center text-slate-300 text-xs">?</span>
                                )}
                                {encountered && <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 rounded-full flex items-center justify-center text-white border border-white"><Check className="w-2.5 h-2.5 stroke-[3]" /></div>}
                              </div>
                              <p className="mt-1.5 text-[11px] font-black text-slate-800 truncate w-full">{entry.name}</p>
                              {showAtlasVote && (() => {
                                      const vc = local?.voter_count ?? entry.voter_count ?? 0;
                                      const tc = local?.total_users ?? entry.total_users ?? 0;
                                      const vr = (local?.vote_ratio ?? entry.vote_ratio) ?? 0;
                                      const cls = vr >= 0.5 ? 'text-green-700 bg-green-50 border-green-300'
                                          : vr >= 0.25 ? 'text-amber-700 bg-amber-50 border-amber-300'
                                              : 'text-rose-700 bg-rose-50 border-rose-300';
                                      return (
                                          <>
                                            <span className={`text-[9px] font-mono font-black px-1.5 py-0.5 rounded border ${cls}`}>
                                              投票 {vc}{tc > 0 ? `/${tc}` : ''}
                                            </span>
                                            <div className="w-full h-1 bg-slate-100 rounded-full overflow-hidden mt-1">
                                              <div className={`h-full rounded-full ${vr >= 0.5 ? 'bg-green-500' : vr >= 0.25 ? 'bg-amber-400' : 'bg-rose-400'}`} style={{ width: `${Math.round(Math.min(1, Math.max(0, vr)) * 100)}%` }} />
                                            </div>
                                          </>
                                      );
                                    })()}
                                    {showAtlasVote && (
                                    <div className="mt-1.5 flex items-center gap-1 w-full justify-center">
                                      {([['agree', '✓'], ['disagree', '✕']] as Array<['agree' | 'disagree', string]>).map(([type, label]) => {
                                        const active = type === 'agree' ? effVote === 'agree' : effVote === 'disagree';
                                        return (
                                            <button
                                                key={type}
                                                onClick={(e) => { e.stopPropagation(); onVote(m.mapId, pk, filename, type); }}
                                                className={`w-7 h-7 rounded-lg border flex items-center justify-center text-sm font-black transition-colors cursor-pointer ${active ? (type === 'agree' ? 'bg-green-500 border-green-500 text-white' : 'bg-rose-500 border-rose-500 text-white') : 'bg-slate-50 border-slate-200 text-slate-500 hover:border-slate-300'}`}
                                                title={type === 'agree' ? '赞同' : '不赞同'}
                                            >
                                              {label}
                                            </button>
                                        );
                                      })}
                                    </div>
                                    )}
                            </div>
                              );
                            })()
                        ))}
                      </div>
                  )}
                </section>
            ))}
          </div>

          {/* Footer hint */}
          <div className="px-5 py-3 border-t border-slate-100 text-[10px] text-slate-400 shrink-0">
            社区数据由玩家识别上报聚合，可能存在误差；你的赞同/不赞同会回流到聚合。
          </div>
        </div>
      </div>
  );
};

function 图N(mapId: string): string {
  const num = mapId.replace(/\D/g, '');
  return `图 ${num || '?'}`;
}
