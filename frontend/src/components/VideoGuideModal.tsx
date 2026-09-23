import React, { useEffect, useMemo, useState } from 'react';
import { ExternalLink, ListVideo, MonitorPlay, Play, RotateCw, X } from 'lucide-react';
import { sound } from '../services/sound';
import { ModalHeader } from './ModalHeader';
import { IS_STATIC } from '../services/staticMode';
import { api } from '../services/api';
import {
  extractBvid,
  getBiliMetaBatch,
  type BiliMeta,
} from '../services/biliMeta';

export interface VideoGuideItem {
  /** 视频标题（不填则自动从 B 站取） */
  name?: string;
  /** 嵌入地址 / 播放器 URL / 整段 iframe 代码 / 纯 BV 号（任选其一） */
  embed?: string;
  /** BV 号（与 embed 二选一，填这个最省事） */
  bvid?: string;
  /** 封面（不填则自动取） */
  cover?: string;
  /** 时长，如 "06:11"（不填则自动取） */
  duration?: string;
  /** 发布日期 "2026-09-11"（不填则自动取） */
  date?: string;
  /** 播放量（不填则自动取） */
  views?: string;
  /** 原站地址（不填则自动生成） */
  url?: string;
}

interface VideoGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: VideoGuideItem[];
  title?: string;
}

/** 从配置值里取出嵌入地址；兼容整段 iframe 代码 */
function extractEmbed(value?: string): string {
  const s = (value || '').trim();
  if (!s) return '';
  const m = s.match(/<iframe[^>]*\bsrc\s*=\s*["']([^"']+)["']/i);
  return (m ? m[1] : s).trim();
}

/**
 * 协议相对地址（//player.bilibili.com/...）补全为 https。
 * 桌面端页面跑在 http://127.0.0.1 上，不补全会被解析成 http://player.bilibili.com 而失败。
 */
function normalizeUrl(src?: string): string {
  const s = (src || '').trim();
  return s.startsWith('//') ? `https:${s}` : s;
}

/** 由 bvid 生成播放器地址（只靠 bvid 即可定位视频，无需 aid/cid） */
function embedFromBvid(bvid: string): string {
  return normalizeUrl(`//player.bilibili.com/player.html?isOutside=true&bvid=${bvid}&p=1`);
}

/** 解析 videos.json：支持 {videos:[...]} / 数组；条目可以是纯 BV 号字符串 */
export function parseVideoGuide(raw: unknown): VideoGuideItem[] {
  const anyRaw = raw as any;
  const arr: any[] = Array.isArray(raw)
      ? raw
      : Array.isArray(anyRaw?.videos)
          ? anyRaw.videos
          : Array.isArray(anyRaw?.video_guide)
              ? anyRaw.video_guide
              : Array.isArray(anyRaw?.items)
                  ? anyRaw.items
                  : [];

  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

  return arr
      .map((it): VideoGuideItem | null => {
        if (typeof it === 'string') {
          const s = str(it);
          if (!s) return null;
          const bvid = extractBvid(s) || (/^BV[0-9A-Za-z]{10}$/.test(s) ? s : undefined);
          return bvid ? { bvid } : { embed: extractEmbed(s) };
        }
        if (!it) return null;
        const raw = String(it.embed ?? it.src ?? it.url ?? '');
        const bvid = str(it.bvid) || extractBvid(raw) || extractBvid(str(it.name));
        const embed = extractEmbed(raw);
        if (!embed && !bvid) return null;
        return {
          name: str(it.name) ?? str(it.title),
          embed: embed || undefined,
          bvid,
          cover: str(it.cover),
          duration: str(it.duration),
          date: str(it.date),
          views: str(it.views),
          url: str(it.url),
        };
      })
      .filter((it): it is VideoGuideItem => it !== null);
}

/**
 * 内置兜底配置：远程 videos.json 没下发（或拉取失败、无缓存）时使用，
 * 保证按钮点开一定有内容。正式换源只需改 Gitee 上的 resources/videos.json。
 */
export const DEFAULT_VIDEO_GUIDE_ITEMS: VideoGuideItem[] = [
  { bvid: 'BV1DiYg6PEnG' },
  { bvid: 'BV1Po8j6PETc' },
];

/** 合并「配置里写死的字段」与「自动取回的元信息」：手填优先，缺的自动补 */
interface ResolvedItem {
  key: string;
  embed: string;
  name?: string;
  cover?: string;
  duration?: string;
  date?: string;
  views?: string;
  url?: string;
  /** 是否还在等自动元信息 */
  pending: boolean;
}

function resolveItem(it: VideoGuideItem, i: number, meta: BiliMeta | null | undefined, tried: boolean): ResolvedItem {
  const bvid = it.bvid || extractBvid(it.embed);
  const embed = normalizeUrl(it.embed && extractEmbed(it.embed)) || (bvid ? embedFromBvid(bvid) : '');
  return {
    key: `${bvid || embed}#${i}`,
    embed,
    name: it.name || meta?.title,
    // 封面：手填优先；自动取回的已是 https
    cover: normalizeUrl(it.cover) || normalizeUrl(meta?.cover),
    duration: it.duration || meta?.duration,
    date: it.date || meta?.date,
    views: it.views || meta?.views,
    url: normalizeUrl(it.url) || meta?.url || (bvid ? `https://www.bilibili.com/video/${bvid}` : undefined),
    // 骨架态仅限「确实还在等」：已请求过（tried）但返回 null 说明失败了，
    // 此时必须退化成占位图标，否则会一直闪骨架。
    pending: !it.name && !it.cover && !tried,
  };
}

export const VideoGuideModal: React.FC<VideoGuideModalProps> = ({ isOpen, onClose, items, title }) => {
  // 自动取回的元信息：bvid -> meta
  const [metaMap, setMetaMap] = useState<Record<string, BiliMeta | null>>({});
  // 已尝试过自动获取的 bvid（避免反复触发）
  const [metaTried, setMetaTried] = useState<Record<string, boolean>>({});
  // 当前播放的条目；null = 卡片列表
  const [playing, setPlaying] = useState<number | null>(null);
  // 封面加载阶段：direct → proxy（桌面端兜底）→ failed
  const [coverStage, setCoverStage] = useState<Record<string, 'direct' | 'proxy' | 'failed'>>({});

  // 打开时重置状态
  useEffect(() => {
    if (!isOpen) return;
    setPlaying(null);
    setCoverStage({});
  }, [isOpen]);

  // 补齐缺失的元信息：只对「配置里没写全、且有 bvid」的条目发请求
  useEffect(() => {
    if (!isOpen) return;
    const need: string[] = [];
    (items || []).forEach((src) => {
      const bvid = extractBvid(src?.bvid || src?.embed);
      if (!bvid) return;
      if (metaTried[bvid]) return;
      // 手填了标题和封面就不用联网了
      if (src?.name && src?.cover) return;
      need.push(bvid);
    });
    const uniq = Array.from(new Set(need));
    if (!uniq.length) return;

    let canceled = false;
    setMetaTried((m) => {
      const next = { ...m };
      uniq.forEach((b) => { next[b] = true; });
      return next;
    });
    getBiliMetaBatch(uniq)
        .then((res) => {
          if (canceled) return;
          setMetaMap((m) => ({ ...m, ...res }));
        })
        .catch(() => { /* 静默降级：保留文字卡片 */ });
    return () => { canceled = true; };
    // metaTried 变化会重新跑，但上面已用 metaTried 过滤，不会重复请求
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, items]);

  const resolved = useMemo(
      () =>
          (items || [])
              .map((it, i) => {
                const bvid = extractBvid(it.bvid || it.embed);
                return resolveItem(it, i, bvid ? metaMap[bvid] : undefined, !!bvid && !!metaTried[bvid]);
              })
              .filter((it) => !!it.embed),
      [items, metaMap, metaTried],
  );

  // Esc：播放中先回列表，列表态再关弹窗
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (playing !== null) setPlaying(null);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose, playing]);

  if (!isOpen) return null;

  const current = playing !== null ? resolved[playing] : undefined;
  const showCards = resolved.length > 1 && playing === null;

  /** 桌面端封面兜底代理（hdslb 对非 bilibili Referer 返回 403；正常情况下
   *  <img referrerPolicy="no-referrer"> 已够用，代理只在直连失败时触发）。 */
  const proxyCover = (url?: string) => {
    if (!url || IS_STATIC) return '';
    // 走 apiBase，和其余接口保持一致（桌面端 apiBase 就是本体 origin）
    return `${api.getApiBase()}/api/media/bili_cover?url=${encodeURIComponent(url)}`;
  };

  const refreshMeta = () => {
    sound.playClick();
    const bvids = resolved.map((r) => extractBvid(r.embed)).filter(Boolean) as string[];
    setMetaTried({});
    getBiliMetaBatch(bvids)
        .then((res) => setMetaMap((m) => ({ ...m, ...res })))
        .catch(() => {});
  };

  return (
      <div
          className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-6 bg-slate-900/80 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={onClose}
      >
        <div
            className="relative w-full max-w-5xl bg-white dark:bg-slate-900 rounded-[26px] shadow-2xl ring-1 ring-slate-900/5 dark:ring-white/10 overflow-hidden flex flex-col max-h-[92vh]"
            onClick={(e) => e.stopPropagation()}
        >
          <ModalHeader
              icon={playing !== null ? MonitorPlay : ListVideo}
              tone="rose"
              title={title || '视频攻略'}
              subtitle={playing !== null ? current?.name : '点击封面即可就地播放'}
              onClose={onClose}
              closeTitle="关闭 (Esc)"
              actions={
                <>
                  {playing !== null && (
                      <button
                          type="button"
                          onClick={() => { sound.playClick(); setPlaying(null); }}
                          className="h-8 px-2.5 rounded-xl bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 ring-1 ring-inset ring-slate-200 dark:ring-slate-700 hover:ring-slate-300 text-xs font-black transition-colors cursor-pointer shrink-0"
                          title="返回视频列表 (Esc)"
                      >
                        ← 列表
                      </button>
                  )}
                  <button
                      type="button"
                      onClick={refreshMeta}
                      className="w-8 h-8 rounded-xl text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-slate-700 flex items-center justify-center transition-colors cursor-pointer"
                      title="刷新视频信息（标题/封面/播放量）"
                  >
                    <RotateCw className="w-4 h-4" />
                  </button>
                </>
              }
          />

          {/* 卡片列表 */}
          {showCards && (
              <div className="overflow-y-auto p-3 sm:p-4 custom-scrollbar">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {resolved.map((it, i) => {
                    const stage = coverStage[it.key] || 'direct';
                    const cover = stage === 'direct' ? it.cover : proxyCover(it.cover);
                    const coverOk = !!cover && stage !== 'failed';
                    const onCoverError = () => {
                      setCoverStage((m) => {
                        const cur = m[it.key] || 'direct';
                        if (cur === 'direct' && proxyCover(it.cover)) return { ...m, [it.key]: 'proxy' };
                        return { ...m, [it.key]: 'failed' };
                      });
                    };
                    return (
                        <button
                            key={it.key}
                            type="button"
                            onClick={() => { sound.playClick(); setPlaying(i); }}
                            className="group flex flex-col items-stretch text-left rounded-2xl overflow-hidden bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-[#7ABCF4] dark:hover:border-sky-500 shadow-xs hover:shadow-md transition-all cursor-pointer"
                        >
                          <div className="relative w-full aspect-video bg-slate-100 dark:bg-slate-900 overflow-hidden">
                            {coverOk ? (
                                <img
                                    src={cover}
                                    alt={it.name || `视频 ${i + 1}`}
                                    className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-200"
                                    loading="lazy"
                                    referrerPolicy="no-referrer"
                                    onError={onCoverError}
                                />
                            ) : it.pending ? (
                                <div className="w-full h-full animate-pulse bg-slate-200/70 dark:bg-slate-700/50" />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                  <MonitorPlay className="w-10 h-10 text-slate-300 dark:text-slate-600" />
                                </div>
                            )}
                            <div className="absolute inset-0 bg-slate-900/25 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                              <span className="w-12 h-12 rounded-full bg-white/90 text-[#2B78C4] flex items-center justify-center shadow-lg">
                                <Play className="w-6 h-6 ml-0.5 fill-current" />
                              </span>
                            </div>
                            {it.duration && (
                                <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded-md bg-slate-900/80 text-white text-[10px] font-mono font-black">
                                  {it.duration}
                                </span>
                            )}
                          </div>
                          <div className="p-2.5 flex-1">
                            <p className="text-xs font-black text-slate-800 dark:text-slate-100 leading-snug line-clamp-2 min-h-[2.5em]">
                              {it.name || `视频 ${i + 1}`}
                            </p>
                            <div className="mt-1.5 flex items-center gap-2 text-[10px] text-slate-400 dark:text-slate-500">
                              {it.views && <span>▶ {it.views}</span>}
                              {it.date && <span>{it.date}</span>}
                            </div>
                          </div>
                        </button>
                    );
                  })}
                </div>
              </div>
          )}

          {/* 播放器 */}
          {!showCards && (
              <>
                <div className="m-3 sm:m-4 w-[calc(100%-1.5rem)] sm:w-[calc(100%-2rem)] aspect-video rounded-2xl overflow-hidden bg-slate-950/5 dark:bg-slate-950/40 shrink-0">
                  {(current || resolved[0]) ? (
                      <iframe
                          key={(current || resolved[0]).embed}
                          src={(current || resolved[0]).embed}
                          title={(current || resolved[0]).name || '视频攻略'}
                          className="w-full h-full block border-0"
                          scrolling="no"
                          allowFullScreen
                          allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
                          referrerPolicy="no-referrer-when-downgrade"
                      />
                  ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <MonitorPlay className="w-8 h-8 text-slate-300 dark:text-slate-600" />
                        <span>暂未配置视频源</span>
                      </div>
                  )}
                </div>
                <div className="px-3 sm:px-4 pb-3 sm:pb-4 flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-[11px] text-slate-400 dark:text-slate-500">
                    {resolved.length > 1 ? '视频加载失败时可返回列表换一个，或前往原站观看' : '视频加载失败时，可尝试前往原站观看'}
                  </span>
                  {(current || resolved[0])?.url && (
                      <a
                          href={(current || resolved[0]).url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => sound.playClick()}
                          className="px-3 py-1.5 rounded-xl bg-[#EBF4FE] dark:bg-slate-800 hover:bg-[#7ABCF4] hover:text-white dark:hover:bg-sky-600 text-[#2B78C4] dark:text-sky-300 border border-[#BCD7F2] dark:border-slate-700 text-xs font-black flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>前往原站观看</span>
                      </a>
                  )}
                </div>
              </>
          )}
        </div>
      </div>
  );
};
