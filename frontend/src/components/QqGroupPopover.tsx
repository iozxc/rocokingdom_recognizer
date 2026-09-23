/**
 * 「官方 QQ 群」触发词 + 群信息气泡。
 *
 * 用在授权弹窗的说明句里：鼠标悬停展示群二维码/群号，点击后**固定**气泡
 * （再点一次或点外部关闭），方便用户腾出手去扫码。
 *
 * 动效方向按需求做成「从下往上」：气泡锚定在触发词上方，
 * 出现时 translateY 从 +8px 回到 0，视觉上是从下往上浮起。
 */
import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy, MessageCircle, QrCode, X } from 'lucide-react';
import { api } from '../services/api';
import { sound } from '../services/sound';

interface QqGroup {
  name?: string;
  group_id?: string | number;
  qrcode?: string;
}

export const QqGroupPopover: React.FC<{ className?: string }> = ({ className = '' }) => {
  const [groups, setGroups] = useState<QqGroup[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const rootRef = useRef<HTMLSpanElement | null>(null);

  const open = hovered || pinned;

  // 首次打开时拉取群配置（走 Gitee 远程 raw，失败回退打包资源）
  useEffect(() => {
    let alive = true;
    api.getChatConfig()
        .then((cfg) => {
          if (!alive) return;
          setGroups(Array.isArray(cfg?.qq_group) ? cfg.qq_group : []);
        })
        .catch(() => {})
        .finally(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, []);

  // 固定状态下，点击外部关闭
  useEffect(() => {
    if (!pinned) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setPinned(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPinned(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [pinned]);

  const copyGroupId = (id: string) => {
    sound.playClick();
    navigator.clipboard.writeText(id).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1600);
    }).catch(() => {});
  };

  return (
      <span
          ref={rootRef}
          className={`relative inline-block ${className}`}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
      >
        <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              sound.playClick();
              setPinned((v) => !v);
            }}
            title={pinned ? '点击取消固定' : '悬停查看 / 点击固定群信息'}
            className={`inline-flex items-center gap-0.5 font-bold underline decoration-dotted underline-offset-2 transition-colors cursor-pointer ${
                open
                    ? 'text-sky-700 dark:text-sky-300'
                    : 'text-sky-600 dark:text-sky-400 hover:text-sky-700 dark:hover:text-sky-300'
            }`}
        >
          官方 QQ 群
        </button>

        {open && (
            <span
                className="absolute left-1/2 bottom-full z-30 mb-2 w-60 -translate-x-1/2 block text-left animate-in fade-in slide-in-from-bottom-2 duration-200"
                onClick={(e) => e.stopPropagation()}
            >
              <span className="block rounded-2xl bg-white dark:bg-slate-800 shadow-2xl ring-1 ring-slate-900/10 dark:ring-white/10 p-3">
                {/* 小箭头（指向下方触发词） */}
                <span className="absolute left-1/2 -bottom-1 w-2 h-2 -translate-x-1/2 rotate-45 bg-white dark:bg-slate-800 ring-1 ring-slate-900/10 dark:ring-white/10" />

                {!loaded ? (
                    <span className="block py-3 text-center text-[11px] text-slate-400">正在获取群信息…</span>
                ) : groups.length === 0 ? (
                    <span className="block py-3 text-center text-[11px] text-slate-400">暂无群信息，请稍后重试</span>
                ) : (
                    groups.map((g, i) => {
                      const gid = String(g?.group_id ?? '');
                      const qr = g?.qrcode ? api.resourceUrl(g.qrcode) : '';
                      return (
                          <span key={gid || i} className="block">
                            {i > 0 && <span className="block my-2.5 border-t border-slate-100 dark:border-slate-700" />}
                            <span className="flex items-start gap-2.5">
                              {qr && (
                                  <img
                                      src={qr}
                                      alt="QQ群二维码"
                                      className="w-20 h-20 rounded-lg object-contain bg-slate-50 dark:bg-slate-900 shrink-0"
                                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                  />
                              )}
                              <span className="min-w-0 flex-1">
                                <span className="flex items-start gap-1">
                                  <MessageCircle className="w-3.5 h-3.5 mt-px text-violet-500 shrink-0" />
                                  <span className="text-[11px] font-black text-slate-800 dark:text-slate-100 leading-snug line-clamp-2">
                                    {g?.name || '官方交流群'}
                                  </span>
                                </span>
                                {gid && (
                                    <>
                                      <span className="mt-1.5 block text-[10px] text-slate-400 dark:text-slate-500 flex items-center gap-1">
                                        <QrCode className="w-3 h-3 shrink-0" />
                                        手机 QQ 扫码加入
                                      </span>
                                      <button
                                          type="button"
                                          onClick={() => copyGroupId(gid)}
                                          title="点击复制群号"
                                          className="mt-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-700 text-[10px] font-mono font-bold text-slate-600 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors cursor-pointer"
                                      >
                                          {gid}
                                          {copiedId === gid
                                              ? <Check className="w-2.5 h-2.5 text-emerald-500 stroke-[3]" />
                                              : <Copy className="w-2.5 h-2.5 opacity-70" />}
                                      </button>
                                    </>
                                )}
                              </span>
                            </span>
                          </span>
                      );
                    })
                )}

                {pinned && (
                    <button
                        type="button"
                        onClick={() => { sound.playClick(); setPinned(false); }}
                        title="关闭"
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-slate-700 text-white flex items-center justify-center shadow-md hover:bg-slate-900 transition-colors cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                )}
              </span>
            </span>
        )}
      </span>
  );
};
