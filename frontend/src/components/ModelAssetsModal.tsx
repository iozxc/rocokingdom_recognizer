/**
 * Web 端「模型列表」弹窗（仅纯前端版使用）。
 *
 * 网页版的识别全部在浏览器里跑，模型/特征库需要按需下载到本地（IndexedDB 缓存）。
 * 这里把用到的资产列出来，让用户可以**提前手动下载**，而不是等第一次识别时才慢慢等。
 *
 * 注意：
 *  - 桌面端的模型是随安装包分发的，没有这个概念，所以入口只在 IS_STATIC 下渲染；
 *  - 弹窗**内联渲染**，不用 createPortal —— 跟随识别面板整体是被 portal 进
 *    Document PiP 小窗的，只有内联渲染才能同时出现在主页面和 PiP 小窗里。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { X, Download, CheckCircle2, Trash2, Loader2, RefreshCw, Database, ScanSearch } from 'lucide-react';
import { sound } from '../services/sound';
import { storage } from '../services/storage';
import {
  assetVersion,
  clearAssetCache,
  isAssetCached,
  loadAsset,
  loadManifest,
  preferredModels,
  type ModelTier,
  type RecognizerManifest,
} from '../services/recognition/assetStore';

interface ModelAssetsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** 一个可下载项里的单个文件（OCR 这类会一次下多个文件）。 */
interface AssetPart {
  path: string;
  bytes: number;
}

interface AssetItem {
  key: string;
  group: 'recognize' | 'scanner';
  name: string;
  desc: string;
  parts: AssetPart[];
}

interface ItemState {
  cached: boolean | null;
  busy: boolean;
  loaded: number;
  total: number;
  error?: string;
}

function fmtBytes(n: number): string {
  if (!n) return '—';
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

function itemBytes(item: AssetItem): number {
  return item.parts.reduce((sum, p) => sum + (p.bytes || 0), 0);
}

/** 从构建期清单里整理出「可以手动下载」的资产列表。 */
function buildItems(m: RecognizerManifest | null, tier: ModelTier): AssetItem[] {
  if (!m) return [];
  const sizeOf = (path?: string) => (path ? (m.assets || []).find((a) => a && a.path === path)?.bytes || 0 : 0);
  const items: AssetItem[] = [];
  const active = preferredModels(m, tier)[0];

  for (const [key, path] of Object.entries(m.models || {})) {
    if (!path) continue;
    items.push({
      key: `model:${key}`,
      group: 'recognize',
      name: `精灵识别模型 ${key.toUpperCase()}`,
      desc: path === active ? '当前使用' : '备用档位',
      parts: [{ path, bytes: sizeOf(path) }],
    });
  }

  if (m.features?.file) {
    items.push({
      key: 'features',
      group: 'recognize',
      name: '精灵特征库',
      desc: `${m.features.count || 0} 条`,
      parts: [{ path: m.features.file, bytes: m.features.bytes || sizeOf(m.features.file) }],
    });
  }

  // OCR 是「检测 + 识别」两个模型配合使用，对外当成一个整体，一起下载
  const ocr = m.ocr || {};
  const ocrParts: AssetPart[] = [];
  if (ocr.det?.file) ocrParts.push({ path: ocr.det.file, bytes: ocr.det.bytes || sizeOf(ocr.det.file) });
  if (ocr.rec?.file) ocrParts.push({ path: ocr.rec.file, bytes: ocr.rec.bytes || sizeOf(ocr.rec.file) });
  if (ocrParts.length) {
    items.push({
      key: 'ocr',
      group: 'recognize',
      name: 'OCR 文字识别模型',
      desc: '识别精灵名字',
      parts: ocrParts,
    });
  }

  if (m.scanner?.file) {
    items.push({
      key: 'scanner',
      group: 'scanner',
      name: '版面检测模型',
      desc: '跟随识别使用',
      parts: [{ path: m.scanner.file, bytes: m.scanner.bytes || sizeOf(m.scanner.file) }],
    });
  }

  return items;
}

export const ModelAssetsModal: React.FC<ModelAssetsModalProps> = ({ isOpen, onClose }) => {
  const [items, setItems] = useState<AssetItem[]>([]);
  const [version, setVersion] = useState<number>(0);
  const [states, setStates] = useState<Record<string, ItemState>>({});
  const [loading, setLoading] = useState<boolean>(false);
  const [manifestMissing, setManifestMissing] = useState<boolean>(false);
  const [clearing, setClearing] = useState<boolean>(false);

  // 打开时重新读一次用户选的模型档位（设置里可能改过）
  const tier = useMemo<ModelTier>(() => {
    try {
      const saved = storage.getSetting<ModelTier | undefined>('webModelTier', undefined);
      if (saved === 'tiny' || saved === 'small' || saved === 'compat' || saved === 'auto') return saved;
    } catch {
      /* 读不到就用 auto */
    }
    return 'auto';
  }, [isOpen]);

  /** 读清单 + 逐项检查缓存状态。 */
  const refresh = useCallback(async () => {
    setLoading(true);
    setManifestMissing(false);
    try {
      const m = await loadManifest();
      if (!m) {
        setManifestMissing(true);
        setItems([]);
        return;
      }
      const v = assetVersion(m);
      const list = buildItems(m, tier);
      setVersion(v);
      setItems(list);
      const next: Record<string, ItemState> = {};
      for (const it of list) {
        next[it.key] = { cached: null, busy: false, loaded: 0, total: itemBytes(it) };
      }
      setStates(next);
      for (const it of list) {
        const flags = await Promise.all(it.parts.map((p) => isAssetCached(p.path, v)));
        const cached = flags.length > 0 && flags.every(Boolean);
        setStates((cur) => ({
          ...cur,
          [it.key]: { ...(cur[it.key] || { busy: false, loaded: 0, total: itemBytes(it) }), cached },
        }));
      }
    } finally {
      setLoading(false);
    }
  }, [tier]);

  useEffect(() => {
    if (isOpen) void refresh();
  }, [isOpen, refresh]);

  const downloadOne = useCallback(async (item: AssetItem) => {
    const total = itemBytes(item);
    setStates((cur) => ({
      ...cur,
      [item.key]: { cached: false, busy: true, loaded: 0, total },
    }));
    try {
      let base = 0;
      for (const part of item.parts) {
        await loadAsset(part.path, version, (p) => {
          setStates((cur) => ({
            ...cur,
            [item.key]: {
              cached: false,
              busy: true,
              loaded: base + p.loaded,
              total: total || p.total,
            },
          }));
        });
        base += part.bytes || 0;
      }
      setStates((cur) => ({ ...cur, [item.key]: { cached: true, busy: false, loaded: total, total } }));
    } catch (e) {
      setStates((cur) => ({
        ...cur,
        [item.key]: {
          cached: false,
          busy: false,
          loaded: 0,
          total,
          error: (e as Error)?.message || '下载失败',
        },
      }));
    }
  }, [version]);

  const downloadAll = useCallback(async () => {
    for (const item of items) {
      const st = states[item.key];
      if (st?.cached || st?.busy) continue;
      await downloadOne(item);
    }
  }, [items, states, downloadOne]);

  const handleClear = useCallback(async () => {
    if (!window.confirm('清除本机已缓存的识别模型？下次识别会重新下载（不影响你的图鉴数据）。')) return;
    setClearing(true);
    try {
      await clearAssetCache();
      await refresh();
    } finally {
      setClearing(false);
    }
  }, [refresh]);

  if (!isOpen) return null;

  const totalBytes = items.reduce((sum, it) => sum + itemBytes(it), 0);
  const cachedCount = items.filter((it) => states[it.key]?.cached).length;

  const renderRows = (group: AssetItem['group']) => items
      .filter((it) => it.group === group)
      .map((it) => {
        const bytes = itemBytes(it);
        const st = states[it.key] || { cached: null, busy: false, loaded: 0, total: bytes };
        const pct = st.total ? Math.min(100, Math.round((st.loaded / st.total) * 100)) : 0;
        return (
            <div key={it.key} className="rounded-2xl border-2 border-[#D5E3F0] dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 space-y-1.5">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-black text-slate-800 dark:text-slate-100 truncate">{it.name}</div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">{it.desc}</div>
                </div>
                <div className="text-[10px] font-mono text-slate-400 shrink-0">{fmtBytes(bytes)}</div>
                {st.cached ? (
                    <span className="shrink-0 text-[10px] font-black text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> 已下载
                    </span>
                ) : (
                    <button
                        type="button"
                        disabled={st.busy || st.cached === null || !version}
                        onClick={() => { sound.playClick(); void downloadOne(it); }}
                        className="shrink-0 px-2.5 py-1 rounded-lg roco-btn-primary text-[10px] flex items-center gap-1 disabled:opacity-50 cursor-pointer"
                    >
                      {st.busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                      {st.busy ? `${pct}%` : '下载'}
                    </button>
                )}
              </div>
              {st.busy && (
                  <div className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div className="h-full bg-[#7ABCF4] transition-[width] duration-150" style={{ width: `${Math.max(2, pct)}%` }} />
                  </div>
              )}
              {st.error && (
                  <div className="text-[10px] font-bold text-rose-600 dark:text-rose-400 leading-snug">{st.error}</div>
              )}
            </div>
        );
      });

  return (
      <div
          className="fixed inset-0 z-[80] flex items-center justify-center p-3 sm:p-5 bg-slate-950/60 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={onClose}
      >
        <div
            className="w-full max-w-lg max-h-[88vh] flex flex-col overflow-hidden rounded-3xl border-4 border-[#5DA8E8] dark:border-slate-700 bg-[#F8FBFE] dark:bg-slate-900 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
        >
          <div className="bg-[#7ABCF4] dark:bg-slate-800 px-4 py-3 text-white flex items-center justify-between border-b-2 border-[#5DA8E8] dark:border-slate-700 shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-white/20 border border-white/40 flex items-center justify-center">
                <Database className="w-4 h-4" />
              </div>
              <h3 className="text-sm font-black tracking-tight">识别模型列表</h3>
            </div>
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={() => { sound.playClick(); void refresh(); }} disabled={loading}
                      title="重新检查缓存状态"
                      className="w-7 h-7 rounded-xl bg-white/20 hover:bg-white/30 flex items-center justify-center disabled:opacity-50 cursor-pointer">
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              </button>
              <button type="button" onClick={() => { sound.playClick(); onClose(); }}
                      className="w-7 h-7 rounded-xl bg-white/20 hover:bg-white/30 flex items-center justify-center cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="p-3.5 space-y-2.5 overflow-y-auto">
            {manifestMissing ? (
                <div className="text-[11px] text-rose-600 dark:text-rose-400 font-bold leading-relaxed">
                  没有读到模型清单，可能是站点资源没部署完整，请稍后重试。
                </div>
            ) : (
                <>
                  <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                    <span>已下载 {cachedCount}/{items.length} 项{totalBytes ? ` · 合计 ${fmtBytes(totalBytes)}` : ''}</span>
                    <button type="button" onClick={() => { sound.playClick(); void downloadAll(); }}
                            disabled={loading || cachedCount >= items.length}
                            className="px-2.5 py-1 rounded-lg roco-btn-primary text-[10px] flex items-center gap-1 disabled:opacity-50 cursor-pointer">
                      <Download className="w-3 h-3" /> 全部下载
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    <div className="text-[11px] font-black text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                      <Database className="w-3.5 h-3.5 text-[#2B78C4] dark:text-sky-400" /> 首页识别
                    </div>
                    {renderRows('recognize')}
                  </div>

                  <div className="space-y-1.5">
                    <div className="text-[11px] font-black text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                      <ScanSearch className="w-3.5 h-3.5 text-[#2B78C4] dark:text-sky-400" /> 跟随识别
                    </div>
                    {renderRows('scanner')}
                  </div>

                  <button type="button" onClick={() => void handleClear()} disabled={clearing || loading}
                          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border-2 border-[#D5E3F0] dark:border-slate-700 bg-white dark:bg-slate-800 text-[10px] font-black text-slate-500 dark:text-slate-400 hover:text-rose-600 hover:border-rose-200 disabled:opacity-50 cursor-pointer">
                    {clearing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                    清除本机模型缓存
                  </button>
                </>
            )}
          </div>
        </div>
      </div>
  );
};

export default ModelAssetsModal;
