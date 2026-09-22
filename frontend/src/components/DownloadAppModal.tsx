import React, { useEffect, useState } from 'react';
import {
  X,
  Download,
  MessageCircle,
  QrCode,
  Copy,
  Check,
  Github,
  Link2,
  Cpu,
  Database,
  Sparkles,
  Monitor,
  Keyboard,
  ScrollText,
  RefreshCw,
} from 'lucide-react';
import { sound } from '../services/sound';
import { api } from '../services/api';
import { UpdateTimeline } from './UpdateTimeline';
import { APP_VERSION } from '../version';
import type { UpdateLogEntry } from '../types';

/** Gitee（码云）标志图标：红色旗形，避免复用通用下载图标。 */
const GiteeIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path fill="#C71D23" d="M4 3h3v18H4z" />
      <path fill="#C71D23" d="M7 6h13l-3.2 3.3L20 12.6H7z" />
    </svg>
);

interface DownloadAppModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const APP_FEATURES = [
  { icon: Cpu, title: '更精准的识别', desc: '本机原生推理，支持 GPU 加速' },
  { icon: Monitor, title: '更好的体验', desc: '免加载，不受服务器波动影响' },
  { icon: Database, title: '数据同步', desc: '多账号、多设备共用一份数据' },
  { icon: Keyboard, title: '快捷键支持', desc: '跟随识别一键触发，按键可自定义' },
];

export const DownloadAppModal: React.FC<DownloadAppModalProps> = ({ isOpen, onClose }) => {
  const [appInfo, setAppInfo] = useState<{ version: string; mirrors: Record<string, string> } | null>(null);
  const [groups, setGroups] = useState<any[]>([]);
  const [copiedGroupId, setCopiedGroupId] = useState<string | null>(null);
  const [qrOpen, setQrOpen] = useState<boolean>(false);
  const [changelog, setChangelog] = useState<UpdateLogEntry[] | null>(null);
  const [clLoading, setClLoading] = useState<boolean>(false);
  const [clError, setClError] = useState<boolean>(false);

  useEffect(() => {
    if (!isOpen) return;
    api.getAppInfo().then((info) => setAppInfo(info));
    api.getChatConfig().then((cfg) => {
      setGroups(Array.isArray(cfg?.qq_group) ? cfg.qq_group : []);
    });
    // 与桌面版「检查更新」弹窗一致：在下载弹窗里直接内嵌版本时间线
    setChangelog(null);
    setClError(false);
    setClLoading(true);
    api.getChangelog()
      .then((data) => {
        if (data && Array.isArray(data.changelog) && data.changelog.length > 0) {
          setChangelog(data.changelog);
        } else {
          setClError(true);
        }
      })
      .catch(() => setClError(true))
      .finally(() => setClLoading(false));
  }, [isOpen]);

  if (!isOpen) return null;

  const group = groups[0];
  const gid: string = String(group?.group_id ?? '723155657');
  const gname: string = group?.name ?? '洛克王国徽章试炼助手官方交流群';
  const qrSrc: string = group?.qrcode ? api.resourceUrl(group.qrcode) : `${api.resourceUrl('qrcode_1.png')}`;

  const handleCopyQQGroup = async () => {
    sound.playClick();
    try {
      await navigator.clipboard.writeText(gid);
      setCopiedGroupId(gid);
      setTimeout(() => setCopiedGroupId((cur) => (cur === gid ? null : cur)), 2000);
    } catch {
      // 忽略
    }
  };

  const mirrors = appInfo?.mirrors ?? {};

  // changelog.json 按新到旧排列；防御写反顺序，取最大版本号为「最新」
  const latestVersion = changelog && changelog.length
    ? changelog.reduce((a, b) => {
        const pa = String(a).split('.').map((x) => parseInt(x, 10) || 0);
        const pb = String(b.version).split('.').map((x) => parseInt(x, 10) || 0);
        for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
          if ((pb[i] || 0) !== (pa[i] || 0)) return (pb[i] || 0) > (pa[i] || 0) ? b.version : a;
        }
        return a;
      }, changelog[0].version)
    : APP_VERSION;

  return (
      <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
          onWheel={(e) => e.stopPropagation()}
          onClick={onClose}
      >
        <div
            className="bg-white dark:bg-slate-900 rounded-3xl border-4 border-[#5DA8E8] dark:border-slate-700 shadow-2xl max-w-5xl w-full overflow-hidden flex flex-col transition-colors"
            onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="bg-[#7ABCF4] dark:bg-slate-800 px-5 py-4 text-white flex items-center justify-between border-b-2 border-[#5DA8E8] dark:border-slate-700">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-white/20 border border-white/40 flex items-center justify-center shadow-xs">
                <Download className="w-4 h-4 text-white" />
              </div>
              <div>
                <h3 className="text-base font-black tracking-tight">
                  下载桌面版 · 使用完整识别 AI
                </h3>
                <p className="text-[11px] text-white/80 dark:text-slate-300 font-medium">
                  网页版已支持识别与云端同步；桌面端在精度、体验与数据上更进一步
                </p>
              </div>
            </div>
            <button
                type="button"
                onClick={() => {
                  sound.playClick();
                  onClose();
                }}
                className="w-8 h-8 rounded-xl bg-white/20 hover:bg-white/30 text-white flex items-center justify-center transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Content —— 左侧下载内容（独立滚动）+ 右侧更新日志（与桌面版检查更新弹窗一致） */}
          <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_340px] gap-4 p-4 sm:p-5 md:max-h-[78vh] overflow-hidden">
            {/* 左：下载内容（独立滚动） */}
            <div className="space-y-5 min-h-0 overflow-y-auto md:pr-1.5 [scrollbar-width:thin]">
            {/*
              * 这里刻意不显示版本号：这是「下载桌面版」的引导弹窗，
              * 网页版与桌面版各有各的版本号，摆一个「当前版本」容易被误解成本页版本。
              */}
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span className="text-slate-400">网页版已支持识别与云端同步</span>
            </div>

            {/* 功能补充介绍 */}
            <div className="space-y-2.5">
              <div className="text-xs font-black text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-[#F59E0B]" />
                <span>桌面 APP 功能补充</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {APP_FEATURES.map((f) => (
                    <div key={f.title} className="flex gap-2.5 p-2.5 bg-[#F0F6FC] dark:bg-slate-800 rounded-2xl border-2 border-[#D5E3F0] dark:border-slate-700">
                      <div className="w-7 h-7 shrink-0 rounded-lg bg-[#7ABCF4]/20 dark:bg-sky-950/60 text-[#2B78C4] dark:text-sky-400 flex items-center justify-center">
                        <f.icon className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-black text-slate-800 dark:text-slate-100">{f.title}</div>
                        <div className="text-[10px] text-slate-500 dark:text-slate-400 leading-snug truncate" title={f.desc}>{f.desc}</div>
                      </div>
                    </div>
                ))}
              </div>
            </div>

            {/* 下载渠道 */}
            <div className="space-y-2.5">
              <div className="text-xs font-black text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                <Link2 className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                <span>下载渠道</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {mirrors.GitHub && (
                    <a
                        href={mirrors.GitHub}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-2.5 p-2.5 rounded-2xl border-2 border-[#D5E3F0] dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-[#EBF4FE] dark:hover:bg-slate-700 hover:border-[#7ABCF4] dark:hover:border-sky-500 transition-colors"
                    >
                        <Github className="w-5 h-5 text-slate-800 dark:text-slate-100 shrink-0" />
                        <div className="min-w-0">
                          <div className="text-xs font-black text-slate-800 dark:text-slate-100">GitHub 下载</div>
                          <div className="text-[10px] text-slate-400 truncate">发布页 / Releases</div>
                        </div>
                      </a>
                )}
                {mirrors.Gitee && (
                    <a
                        href={mirrors.Gitee}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-2.5 p-2.5 rounded-2xl border-2 border-[#D5E3F0] dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-[#EBF4FE] dark:hover:bg-slate-700 hover:border-[#7ABCF4] dark:hover:border-sky-500 transition-colors"
                    >
                        <GiteeIcon className="w-5 h-5 shrink-0" />
                        <div className="min-w-0">
                          <div className="text-xs font-black text-slate-800 dark:text-slate-100">Gitee 下载</div>
                          <div className="text-[10px] text-slate-400 truncate">发布页 / Releases</div>
                        </div>
                      </a>
                )}
              </div>
            </div>

            {/* 免费开源声明 */}
            <div className="flex items-start gap-2 p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border-2 border-emerald-200 dark:border-emerald-800">
              <Sparkles className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              <p className="text-xs text-emerald-800 dark:text-emerald-300 leading-snug">
                本应用<strong>完全免费且开源</strong>，无广告、无内购；图鉴数据<strong>默认只存在本机</strong>，
                只有你主动启用「云端同步」时才会把数据上传到作者服务器（可随时解除）。
              </p>
            </div>

            {/* QQ群 下载 */}
            <div className="space-y-2.5">
              <div className="text-xs font-black text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                <MessageCircle className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>进 QQ 群获取</span>
              </div>
              <div className="p-3 sm:p-4 bg-[#F0F6FC] dark:bg-slate-800 rounded-2xl border-2 border-[#D5E3F0] dark:border-slate-700 flex flex-col gap-3">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 w-full sm:w-auto">
                    <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-[#7ABCF4] text-white flex items-center justify-center shrink-0 shadow-xs border-2 border-[#5DA8E8]">
                      <MessageCircle className="w-5 h-5 sm:w-6 sm:h-6" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-black text-slate-800 dark:text-slate-100 truncate" title={gname}>{gname}</div>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="text-xs font-mono font-black text-[#1E5B99] dark:text-sky-300 bg-white dark:bg-slate-700 px-2 py-0.5 rounded-lg border border-[#BCD7F2] dark:border-slate-600">{gid}</span>
                        <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">群内提供安装包</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center w-full sm:w-auto justify-end">
                    <button
                        type="button"
                        onClick={() => {
                          sound.playClick();
                          setQrOpen((v) => !v);
                        }}
                        title="扫码进群"
                        className={`p-2 rounded-xl text-xs font-black flex items-center justify-center transition-all cursor-pointer border-2 ${
                            qrOpen ? 'bg-[#7ABCF4] text-white border-[#5DA8E8] shadow-xs' : 'bg-white dark:bg-slate-700 hover:bg-[#EBF4FE] dark:hover:bg-slate-600 text-[#1E5B99] dark:text-sky-300 border-[#BCD7F2] dark:border-slate-600 hover:border-[#7ABCF4] shadow-xs'
                        }`}
                    >
                      <QrCode className="w-4 h-4" />
                    </button>
                    <button
                        type="button"
                        onClick={handleCopyQQGroup}
                        className={`px-3 py-2 rounded-xl text-xs font-black flex items-center gap-1 transition-all cursor-pointer border-2 ${
                            copiedGroupId === gid ? 'bg-[#95D151] text-white border-[#76B032]' : 'bg-white dark:bg-slate-700 hover:bg-[#EBF4FE] dark:hover:bg-slate-600 text-[#1E5B99] dark:text-sky-300 border-[#BCD7F2] dark:border-slate-600 hover:border-[#7ABCF4] shadow-xs'
                        }`}
                    >
                      {copiedGroupId === gid ? (
                          <>
                            <Check className="w-3.5 h-3.5 stroke-[3]" />
                            <span>已复制</span>
                          </>
                      ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>复制群号</span>
                          </>
                      )}
                    </button>
                  </div>
                </div>
                {qrOpen && (
                    <div className="pt-3 border-t border-[#D5E3F0] dark:border-slate-700 flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 bg-white/80 dark:bg-slate-900/80 p-3 sm:p-3.5 rounded-xl border border-white dark:border-slate-700 shadow-inner animate-in fade-in zoom-in-95 duration-200">
                      <div className="p-2 bg-white rounded-2xl border-2 border-[#BCD7F2] shadow-sm flex items-center justify-center shrink-0">
                        <img
                            src={qrSrc}
                            alt="QQ群二维码"
                            draggable={false}
                            className="w-32 h-32 sm:w-36 sm:h-36 object-contain rounded-lg"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = `https://dummyimage.com/200x200/7abcf4/ffffff.png&text=QQ+Group:+${gid}`;
                            }}
                        />
                      </div>
                      <div className="text-center sm:text-left space-y-1">
                        <div className="flex items-center justify-center sm:justify-start gap-1.5 text-xs font-black text-slate-800 dark:text-slate-100">
                          <QrCode className="w-4 h-4 text-[#2B78C4] dark:text-sky-400" />
                          <span>扫一扫加入交流群</span>
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">使用手机 QQ 扫描上方二维码即可一键加入</p>
                        <p className="text-[10px] text-[#2B78C4] dark:text-sky-300 font-mono font-bold bg-[#EBF4FE] dark:bg-sky-950/70 px-2 py-0.5 rounded-md inline-block">群号: {gid}</p>
                      </div>
                    </div>
                )}
              </div>
            </div>
            </div>{/* /左列：下载内容 */}

            {/* 右：更新日志（与桌面版一致：右栏全高、内部滚动；窄屏降级为下方定高块） */}
            <aside className="relative min-h-0 h-[46vh] md:h-auto">
              <div className="relative h-full md:absolute md:inset-0 min-h-0">
                {clLoading && !changelog ? (
                  <div className="h-full flex flex-col items-center justify-center gap-2 text-slate-400 dark:text-slate-500 bg-[#F8FAFC] dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700">
                    <RefreshCw className="w-5 h-5 animate-spin" />
                    <span className="text-xs font-bold">正在加载更新日志…</span>
                  </div>
                ) : clError && (!changelog || changelog.length === 0) ? (
                  <div className="h-full flex flex-col items-center justify-center gap-2 text-slate-400 dark:text-slate-500 bg-[#F8FAFC] dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 px-4 text-center">
                    <ScrollText className="w-5 h-5" />
                    <span className="text-xs font-bold">暂时拉取不到更新日志，可进 QQ 群查看</span>
                  </div>
                ) : (
                  <UpdateTimeline
                    changelog={changelog || []}
                    currentVersion={APP_VERSION}
                    latestVersion={latestVersion}
                    hasUpdate={false}
                  />
                )}
              </div>
            </aside>
          </div>
        </div>
      </div>
  );
};
