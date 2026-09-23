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
import { ORT_VERSION } from '../version';
import { clearAssetsUsed, isAssetUsed } from '../services/assetUsed';
import { X, Download, CheckCircle2, Trash2, Loader2, RefreshCw, Database, ScanSearch } from 'lucide-react';
import { sound } from '../services/sound';
import { ModalHeader } from './ModalHeader';
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
  /** 该文件只走 HTTP 缓存、不进 IndexedDB（如 colors.bin，由 featureStore/ORT 直接 fetch） */
  http?: boolean;
}

interface AssetItem {
  key: string;
  group: 'recognize' | 'scanner';
  name: string;
  desc: string;
  parts: AssetPart[];
  /**
   * 'idb'  = 走 assetStore（下载后存进浏览器 IndexedDB，识别时直接用）
   * 'http' = 只预热浏览器 HTTP 缓存（onnxruntime 的 wasm 由它自己 fetch，我们存不进 IndexedDB）
   */
  via?: 'idb' | 'http';
  /** 该文件只走 HTTP 缓存、不进 IndexedDB（如 colors.bin，由 featureStore/ORT 直接 fetch） */
  http?: boolean;
}

/** 站点内资源的绝对路径（wasm 与 ORT 加载路径一致，始终同源）。 */
function siteUrl(relPath: string): string {
  const base = import.meta.env.BASE_URL || '/';
  return `${base}${relPath.replace(/^\/+/, '')}`;
}

/**
 * 该 URL 是否已在浏览器 HTTP 缓存里。
 *
 * 不能用 `cache: 'only-if-cached'` 探测：未命中时 Chrome 会往控制台抛一条
 * `net::ERR_CACHE_MISS` 报错（用户会以为坏了）。改用「HEAD 请求 + 资源计时」：
 * 命中缓存时 `transferSize === 0`，未命中则会真的走一次网络（HEAD 很轻）。
 */
/**
 * 「已预热」本地记录：Chrome 无法查询某 URL 是否命中 HTTP 缓存（HEAD 走 CDN 命中时
 * transferSize 同样 >0），所以改用「我们自己预热成功过」这一确定事实来判断，
 * 并且和 IndexedDB 一样在「清除本机模型缓存」时一起清掉。
 */
const WARM_KEY = 'roco_http_warmed_v1';
// 兼容：老的 warmed 记录 + 新的「识别时用过」标记，两者任一命中都算已缓存
function warmedSet(): Set<string> {
  try {
    const raw = localStorage.getItem(WARM_KEY);
    return new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
  } catch { return new Set<string>(); }
}
function markWarmed(url: string): void {
  try {
    const set = warmedSet(); set.add(url.split('?')[0]);
    localStorage.setItem(WARM_KEY, JSON.stringify([...set]));
  } catch { /* ignore */ }
}
export function clearWarmedHttpCache(): void {
  try { localStorage.removeItem(WARM_KEY); } catch { /* ignore */ }
}
async function httpCached(url: string): Promise<boolean> {
  const bare = url.split('?')[0];
  if (warmedSet().has(bare) || isAssetUsed(bare)) return true;   // 预热过 / 识别时真的加载过
  try {
    await fetch(url, { method: 'HEAD', cache: 'default' });
    const entries = performance.getEntriesByName(url) as PerformanceResourceTiming[];
    const last = entries[entries.length - 1];
    return !!last && last.transferSize === 0;
  } catch {
    return false;
  }
}

/** 预热浏览器 HTTP 缓存（带进度；之后 onnxruntime 自己 fetch 就能直接命中）。 */
async function prefetchHttp(
    url: string,
    onProgress: (p: { loaded: number; total: number }) => void,
): Promise<void> {
  const resp = await fetch(url, { cache: 'reload' }); // reload：绕过缓存取新的，并写入缓存
  if (!resp.ok) throw new Error(`下载失败：HTTP ${resp.status}（${url}）`);
  const total = Number(resp.headers.get('content-length') || 0);
  if (!resp.body) {
    await resp.arrayBuffer();
    onProgress({ loaded: total, total });
    markWarmed(url);
    return;
  }
  const reader = resp.body.getReader();
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      received += value.length;
      onProgress({ loaded: received, total: total || received });
    }
  }
  markWarmed(url);
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
  // 清单里登记的路径不带 ?v=，这里统一忽略查询串再查（模型/特征库/颜色签名/wasm 都靠它取大小）
  const sizeOf = (path?: string) => {
    if (!path) return 0;
    const bare = path.split('?')[0];
    return (m.assets || []).find((a) => a && a.path === bare)?.bytes || 0;
  };
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

  // 浏览器识别运行时（onnxruntime 的 wasm + glue）：由 ORT 自己加载，不进 IndexedDB，
  // 这里列出来只是让「全部下载」能提前把它放进 HTTP 缓存，省掉首次识别那 21.7MB 的等待。
  // 必须与识别 worker 里 ort.env.wasm.wasmPaths 的 URL 完全一致（都带 ?v=<ORT 版本>），
  // 否则 httpCached 探测的是无参 URL → 命中不到缓存，界面永远显示「未下载」。
  const _wasmVer = `?v=${encodeURIComponent(ORT_VERSION)}`;
  const wasmWanted = [
    `wasm/ort-wasm-simd-threaded.jsep.wasm${_wasmVer}`,
    `wasm/ort-wasm-simd-threaded.jsep.mjs${_wasmVer}`,
  ];
  const wasmParts: AssetPart[] = wasmWanted
      .map((path) => {
        // 清单登记的是不带 ?v= 的路径；path 本身保留版本参数，供「探测/预热/缓存判定」使用
        const bare = path.split('?')[0];
        const hit = (m.assets || []).find((a) => a && a.path === bare);
        return hit ? { path, bytes: hit.bytes || 0 } : null;
      })
      .filter((x): x is AssetPart => !!x);
  if (wasmParts.length) {
    items.push({
      key: 'ort-wasm',
      group: 'recognize',
      name: '推理运行时 WASM',
      desc: '浏览器识别引擎',
      via: 'http',
      parts: wasmParts,
    });
  }

  if (m.features?.file) {
    items.push({
      key: 'features',
      group: 'recognize',
      name: '精灵特征库',
      desc: `${m.features.count || 0} 条`,
      parts: [
        { path: m.features.file, bytes: m.features.bytes || sizeOf(m.features.file) },
        // 配色签名并进同一项：显示大小、预下载、缓存判定都算在一起（列表仍是 5 项）
        ...(m.features.colorBytes
            ? [{
                path: `${m.features.colorFile || 'data/colors.bin'}?v=${encodeURIComponent(String(assetVersion(m)))}`,
                bytes: m.features.colorBytes,
                http: true,
              }]
            : []),
      ],
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
        // 逐部件判断缓存位置：颜色签名/ORT wasm 只进 HTTP 缓存，模型/特征库在 IndexedDB
        const flags = await Promise.all(it.parts.map((p) =>
            (it.via === 'http' || p.http)
                ? httpCached(siteUrl(p.path))
                : isAssetCached(p.path, v)));
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
        if (item.via === 'http' || part.http) {
          await prefetchHttp(siteUrl(part.path), (p) => {
            setStates((cur) => ({
              ...cur,
              [item.key]: { cached: false, busy: true, loaded: base + p.loaded, total: total || p.total },
            }));
          });
          base += part.bytes || 0;
          continue;
        }
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
      clearWarmedHttpCache();   // 一并清掉 wasm/colors 的"已预热"记录
    clearAssetsUsed();
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
                    // 不再提供手动下载：模型统一在识别时按需下载（这里只显示状态）
                    <span className="shrink-0 text-[10px] font-black text-slate-400 dark:text-slate-500">
                      {st.busy ? `下载中 ${pct}%` : '识别时自动下载'}
                    </span>
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
            className="w-full max-w-lg max-h-[88vh] flex flex-col overflow-hidden rounded-[26px] ring-1 ring-slate-900/5 dark:ring-white/10 bg-[#F8FBFE] dark:bg-slate-900 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
        >
          <ModalHeader
              icon={Database}
              tone="slate"
              title="识别模型列表"
              onClose={onClose}
              closeTitle="关闭"
              actions={
                <button type="button" onClick={() => { sound.playClick(); void refresh(); }} disabled={loading}
                        title="重新检查缓存状态"
                        className="w-8 h-8 rounded-xl text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-slate-700 flex items-center justify-center disabled:opacity-50 cursor-pointer transition-colors">
                  <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                </button>
              }
          />

          <div className="p-3.5 space-y-2.5 overflow-y-auto">
            {manifestMissing ? (
                <div className="text-[11px] text-rose-600 dark:text-rose-400 font-bold leading-relaxed">
                  没有读到模型清单，可能是站点资源没部署完整，请稍后重试。
                </div>
            ) : (
                <>
                  <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                    <span>已缓存 {cachedCount}/{items.length} 项{totalBytes ? ` · 合计 ${fmtBytes(totalBytes)}` : ''}</span>
                    <span className="text-[10px] font-black text-slate-400 dark:text-slate-500">识别时自动下载</span>
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
