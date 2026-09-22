import React, { useMemo } from 'react';
import { Info, Sparkles } from 'lucide-react';
import type { UpdateLogEntry } from '../types';

interface UpdateTimelineProps {
    changelog?: UpdateLogEntry[];
    /** 用户当前版本（用于标记“你在用”并默认展开其之后的所有版本） */
    currentVersion?: string;
    /** 最新版本（一般取 changelog[0].version） */
    latestVersion?: string;
    /** 无更新时可传 false，标题改为“近期更新” */
    hasUpdate?: boolean;
    /** 是否显示“你在用”当前版本标记（桌面检查更新弹窗显示，网页下载弹窗传 false） */
    showCurrentBadge?: boolean;
}

// 分类小标签配色（k 字段）
const KIND_STYLES: Record<string, string> = {
    新功能: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
    重要: 'bg-rose-100 text-rose-600 dark:bg-rose-950/70 dark:text-rose-300 border-rose-200 dark:border-rose-800',
    优化: 'bg-blue-100 text-blue-700 dark:bg-blue-950/70 dark:text-blue-300 border-blue-200 dark:border-blue-800',
    修复: 'bg-amber-100 text-amber-700 dark:bg-amber-950/70 dark:text-amber-300 border-amber-200 dark:border-amber-800',
    网页: 'bg-sky-100 text-sky-700 dark:bg-sky-950/70 dark:text-sky-300 border-sky-200 dark:border-sky-800',
    注意: 'bg-orange-100 text-orange-700 dark:bg-orange-950/70 dark:text-orange-300 border-orange-200 dark:border-orange-800',
};
const DEFAULT_KIND = 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-600';

const tagStyle = (tag?: string): string => {
    if (tag === '重大' || tag === '推荐') {
        return 'bg-rose-500 text-white border-rose-500';
    }
    return 'bg-[#E1F0FE] dark:bg-sky-950/70 text-[#1E5B99] dark:text-sky-300 border-[#BCD7F2] dark:border-sky-800';
};

// 简易语义化版本比较：a>b 返回 1，a<b 返回 -1，相等 0
const cmpVersion = (a: string, b: string): number => {
    const pa = String(a).split('.').map((x) => parseInt(x, 10) || 0);
    const pb = String(b).split('.').map((x) => parseInt(x, 10) || 0);
    const n = Math.max(pa.length, pb.length);
    for (let i = 0; i < n; i++) {
        const va = pa[i] || 0;
        const vb = pb[i] || 0;
        if (va !== vb) return va > vb ? 1 : -1;
    }
    return 0;
};

const shortDate = (d?: string): string => {
    if (!d) return '';
    // 兼容 2026-09-18 / 2026-09-18 00:00:00
    const m = d.match(/(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[1]}.${m[2]}.${m[3]}` : d;
};

export const UpdateTimeline: React.FC<UpdateTimelineProps> = ({
    changelog,
    currentVersion,
    latestVersion,
    hasUpdate = true,
    showCurrentBadge = true,
}) => {
    // 按版本从新到旧排序（防御作者写反顺序）
    const entries = useMemo(() => {
        const list = Array.isArray(changelog) ? [...changelog] : [];
        return list.sort((a, b) => cmpVersion(b.version, a.version));
    }, [changelog]);

    if (!entries.length) return null;

    return (
        <div className="relative p-4 bg-slate-50/80 dark:bg-slate-800/60 rounded-2xl ring-1 ring-inset ring-slate-200 dark:ring-slate-700 flex flex-col h-full min-h-0 overflow-hidden">
            {/* 标题行 */}
            <div className="flex items-center justify-between mb-3 shrink-0">
                <span className="text-xs font-black text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                    <Info className="w-4 h-4 text-[#2B78C4] dark:text-sky-400" />
                    更新日志
                    <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500">版本时间线</span>
                </span>
                <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500">
                    {hasUpdate ? '从你的版本起更新内容' : '近期版本亮点'}
                </span>
            </div>

            <ol className="relative ml-1 flex-1 min-h-0 overflow-y-auto pr-1.5 [scrollbar-width:thin]">
                {/* 竖线 */}
                <span
                    className="absolute left-[5px] top-1.5 bottom-1.5 w-0.5 bg-gradient-to-b from-[#86EFAC] via-[#BCD7F2] to-transparent dark:from-emerald-700 dark:via-slate-600"
                    aria-hidden
                />
                {entries.map((entry, idx) => {
                    const isLatest = latestVersion
                        ? entry.version === latestVersion
                        : idx === 0;
                    const isCurrent = !!currentVersion && entry.version === currentVersion;
                    return (
                        <li key={entry.version} className="relative pl-6 pb-3.5 last:pb-0">
                            {/* 节点 */}
                            <span
                                className={`absolute left-0 top-0.5 w-[12px] h-[12px] rounded-full border-2 ${
                                    isLatest
                                        ? 'bg-[#22C55E] border-[#22C55E] shadow-[0_0_0_3px_rgba(34,197,94,.18)]'
                                        : isCurrent
                                            ? 'bg-white dark:bg-slate-900 border-[#2B78C4] dark:border-sky-400'
                                            : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600'
                                }`}
                                aria-hidden
                            />
                            {/* 版本号行 */}
                            <div className="flex items-center gap-2 flex-wrap">
                                <span
                                    className={`text-[11px] font-black px-2 py-0.5 rounded-full font-mono ${
                                        isLatest
                                            ? 'bg-[#15803D] text-white'
                                            : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'
                                    }`}
                                >
                                    v{entry.version}
                                </span>
                                {entry.tag && (
                                    <span
                                        className={`text-[10px] font-black px-1.5 py-0.5 rounded-md border ${tagStyle(entry.tag)}`}
                                    >
                                        {entry.tag}
                                    </span>
                                )}
                                {isCurrent && showCurrentBadge && (
                                    <span className="text-[10px] font-black px-1.5 py-0.5 rounded-md bg-[#E1F0FE] dark:bg-sky-950/70 text-[#1E5B99] dark:text-sky-300 border border-[#BCD7F2] dark:border-sky-800">
                                        你在用
                                    </span>
                                )}
                                {entry.date && (
                                    <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500">
                                        {shortDate(entry.date)}
                                    </span>
                                )}
                                {isLatest && (
                                    <span className="text-[10px] font-black text-[#22C55E] dark:text-emerald-400 flex items-center gap-0.5">
                                        <Sparkles className="w-2.5 h-2.5" />
                                        最新
                                    </span>
                                )}
                            </div>
                            {/* 更新条目 */}
                            <ul className="mt-1.5 space-y-1">
                                {entry.items.map((item, i) => {
                                    const kind = item.k ? KIND_STYLES[item.k] : null;
                                    return (
                                        <li key={i} className="flex items-start gap-1.5">
                                            {kind ? (
                                                <span
                                                    className={`shrink-0 mt-[1px] text-[10px] font-black px-1.5 py-[1px] rounded border ${kind}`}
                                                >
                                                    {item.k}
                                                </span>
                                            ) : (
                                                <span
                                                    className="shrink-0 mt-[7px] w-1 h-1 rounded-full bg-slate-400 dark:bg-slate-500"
                                                    aria-hidden
                                                />
                                            )}
                                            <span className="text-[11.5px] leading-relaxed text-slate-700 dark:text-slate-300 font-medium">
                                                {item.t}
                                            </span>
                                        </li>
                                    );
                                })}
                            </ul>
                        </li>
                    );
                })}
            </ol>

            {/* 底部渐隐：列表可滚动时给出「下面还有」的视觉暗示，
                避免内容刚好被裁在半个字上、看起来像渲染坏了 */}
            <div
                className="pointer-events-none absolute bottom-0 left-0 right-0 h-8 rounded-b-2xl bg-gradient-to-t from-slate-50 dark:from-slate-800 to-transparent"
                aria-hidden
            />
        </div>
    );
};
