import React, { useEffect, useState } from 'react';
import { X, ScrollText, RefreshCw, ExternalLink } from 'lucide-react';
import { sound } from '../services/sound';
import { api } from '../services/api';
import { APP_VERSION } from '../version';
import { UpdateTimeline } from './UpdateTimeline';
import type { UpdateLogEntry } from '../types';

interface WebUpdateModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * 纯 Web 版「更新历史」弹窗：只展示版本时间线（复用桌面版 UpdateTimeline），
 * 不带任何桌面下载流（那是桌面版 UpdateModal 的事）。
 *
 * 数据源：优先 Gitee 远程 changelog.json，网络/跨域失败时回退打包进
 * public-web/resources/changelog.json 的静态副本（api.getChangelog 已封装）。
 */
export const WebUpdateModal: React.FC<WebUpdateModalProps> = ({ isOpen, onClose }) => {
  const [entries, setEntries] = useState<UpdateLogEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const data = await api.getChangelog();
      if (data && Array.isArray(data.changelog) && data.changelog.length > 0) {
        setEntries(data.changelog);
      } else {
        setEntries([]);
        setErrorMsg('暂时拉取不到更新日志，请稍后重试');
      }
    } catch {
      setEntries([]);
      setErrorMsg('更新日志加载失败，请检查网络后重试');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    setEntries(null);
    void load();
  }, [isOpen]);

  if (!isOpen) return null;

  // changelog.json 按新到旧排列；防御写反顺序，取最大版本号为「最新」
  const latestVersion = entries && entries.length
    ? entries.reduce((a, b) => {
        const pa = String(a).split('.').map((x) => parseInt(x, 10) || 0);
        const pb = String(b.version).split('.').map((x) => parseInt(x, 10) || 0);
        for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
          if ((pb[i] || 0) !== (pa[i] || 0)) return (pb[i] || 0) > (pa[i] || 0) ? b.version : a;
        }
        return a;
      }, entries[0].version)
    : APP_VERSION;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
      onWheel={(e) => e.stopPropagation()}
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-3xl border-4 border-[#5DA8E8] dark:border-slate-700 shadow-2xl max-w-lg w-full overflow-hidden flex flex-col transition-colors"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="bg-[#7ABCF4] dark:bg-slate-800 px-5 py-3.5 text-white flex items-center justify-between border-b-2 border-[#5DA8E8] dark:border-slate-700">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-white/20 border border-white/40 flex items-center justify-center shadow-xs shrink-0">
              <ScrollText className="w-4 h-4 text-white" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-black tracking-tight flex items-center gap-2">
                更新历史
                <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-full bg-white/20 border border-white/30">
                  v{APP_VERSION}
                </span>
              </h3>
              <p className="text-[11px] text-white/80 dark:text-slate-300 font-medium truncate">
                网页版与桌面版共用同一份版本记录
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              sound.playClick();
              onClose();
            }}
            className="w-8 h-8 rounded-xl bg-white/20 hover:bg-white/30 text-white flex items-center justify-center transition-colors cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 时间线 */}
        <div className="p-4 h-[60vh] min-h-[320px]">
          {loading ? (
            <div className="h-full flex flex-col items-center justify-center gap-2 text-slate-400 dark:text-slate-500">
              <RefreshCw className="w-6 h-6 animate-spin" />
              <span className="text-xs font-bold">正在加载更新日志…</span>
            </div>
          ) : errorMsg && (!entries || entries.length === 0) ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-slate-400 dark:text-slate-500">
              <span className="text-xs font-bold text-center">{errorMsg}</span>
              <button
                type="button"
                onClick={() => {
                  sound.playClick();
                  void load();
                }}
                className="px-3 py-1.5 rounded-xl text-xs font-black border-2 border-[#BCD7F2] dark:border-slate-700 bg-white dark:bg-slate-800 text-[#1E5B99] dark:text-sky-300 hover:bg-[#EBF5FE] transition-all cursor-pointer flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                重新加载
              </button>
            </div>
          ) : (
            <UpdateTimeline
              changelog={entries || []}
              currentVersion={APP_VERSION}
              latestVersion={latestVersion}
              hasUpdate={false}
            />
          )}
        </div>

        {/* 底部 */}
        <div className="px-5 py-2.5 border-t border-slate-100 dark:border-slate-700 flex items-center justify-between gap-2">
          <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">
            当前网页版 v{APP_VERSION}
          </span>
          <a
            href="https://gitee.com/iozxc/rocokingdom_recognizer/releases"
            target="_blank"
            rel="noreferrer"
            onClick={() => sound.playClick()}
            className="text-[11px] font-black text-[#1E5B99] dark:text-sky-300 hover:underline flex items-center gap-1"
          >
            查看全部发布
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>
    </div>
  );
};

export default WebUpdateModal;
