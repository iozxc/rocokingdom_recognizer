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
  ScanLine,
  Image as ImageIcon,
  Database,
  Sparkles,
} from 'lucide-react';
import { sound } from '../services/sound';
import { api } from '../services/api';

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
  { icon: Cpu, title: '本地 AI 识别', desc: '截图本地推理识别精灵，不出本机、无需上传' },
  { icon: ScanLine, title: '跟随识别悬浮窗', desc: '游戏画面实时跟随识别当前试炼关卡与精灵' },
  { icon: ImageIcon, title: '批量 / 单张识别', desc: '支持整页截图批量点亮与单张图片识别' },
  { icon: Database, title: '本地图鉴与离线记录', desc: '图鉴/记录存本机，离线可用，数据不对外上传' },
];

export const DownloadAppModal: React.FC<DownloadAppModalProps> = ({ isOpen, onClose }) => {
  const [appInfo, setAppInfo] = useState<{ version: string; mirrors: Record<string, string> } | null>(null);
  const [groups, setGroups] = useState<any[]>([]);
  const [copiedGroupId, setCopiedGroupId] = useState<string | null>(null);
  const [qrOpen, setQrOpen] = useState<boolean>(false);

  useEffect(() => {
    if (!isOpen) return;
    api.getAppInfo().then((info) => setAppInfo(info));
    api.getChatConfig().then((cfg) => {
      setGroups(Array.isArray(cfg?.qq_group) ? cfg.qq_group : []);
    });
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

  return (
      <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
          onClick={onClose}
      >
        <div
            className="bg-white rounded-3xl border-4 border-[#5DA8E8] shadow-2xl max-w-lg w-full overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="bg-[#7ABCF4] px-5 py-4 text-white flex items-center justify-between border-b-2 border-[#5DA8E8]">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-white/20 border border-white/40 flex items-center justify-center shadow-xs">
                <Download className="w-4 h-4 text-white" />
              </div>
              <div>
                <h3 className="text-base font-black tracking-tight">
                  下载桌面版 · 使用完整识别 AI
                </h3>
                <p className="text-[11px] text-white/80 font-medium">
                  网页版仅提供图鉴浏览；识别功能需下载本地桌面端
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

          {/* Content */}
          <div className="p-5 space-y-5 max-h-[80vh] overflow-y-auto">
            {/* 版本 */}
            <div className="flex items-center gap-2 text-xs text-slate-500 font-mono">
              <span className="text-slate-400">当前版本</span>
              <span className="px-2 py-0.5 bg-[#EBF4FE] text-[#2B78C4] rounded-lg border border-[#BCD7F2] font-black">
                v{appInfo?.version ?? '1.4.4'}
              </span>
              <span className="text-slate-400">· 网页版为图鉴浏览版</span>
            </div>

            {/* 功能补充介绍 */}
            <div className="space-y-2.5">
              <div className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-[#F59E0B]" />
                <span>桌面 APP 功能补充</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {APP_FEATURES.map((f) => (
                    <div key={f.title} className="flex gap-2.5 p-2.5 bg-[#F0F6FC] rounded-2xl border-2 border-[#D5E3F0]">
                      <div className="w-7 h-7 shrink-0 rounded-lg bg-[#7ABCF4]/20 text-[#2B78C4] flex items-center justify-center">
                        <f.icon className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-black text-slate-800">{f.title}</div>
                        <div className="text-[10px] text-slate-500 leading-snug">{f.desc}</div>
                      </div>
                    </div>
                ))}
              </div>
            </div>

            {/* 下载渠道 */}
            <div className="space-y-2.5">
              <div className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                <Link2 className="w-3.5 h-3.5 text-sky-600" />
                <span>下载渠道</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {mirrors.GitHub && (
                    <a
                        href={mirrors.GitHub}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-2.5 p-2.5 rounded-2xl border-2 border-[#D5E3F0] bg-white hover:bg-[#EBF4FE] hover:border-[#7ABCF4] transition-colors"
                    >
                        <Github className="w-5 h-5 text-slate-800 shrink-0" />
                        <div className="min-w-0">
                          <div className="text-xs font-black text-slate-800">GitHub 下载</div>
                          <div className="text-[10px] text-slate-400 truncate">发布页 / Releases</div>
                        </div>
                      </a>
                )}
                {mirrors.Gitee && (
                    <a
                        href={mirrors.Gitee}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-2.5 p-2.5 rounded-2xl border-2 border-[#D5E3F0] bg-white hover:bg-[#EBF4FE] hover:border-[#7ABCF4] transition-colors"
                    >
                        <GiteeIcon className="w-5 h-5 shrink-0" />
                        <div className="min-w-0">
                          <div className="text-xs font-black text-slate-800">Gitee 下载</div>
                          <div className="text-[10px] text-slate-400 truncate">发布页 / Releases</div>
                        </div>
                      </a>
                )}
              </div>
            </div>

            {/* 免费开源声明 */}
            <div className="flex items-start gap-2 p-3 rounded-2xl bg-emerald-50 border-2 border-emerald-200">
              <Sparkles className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <p className="text-xs text-emerald-800 leading-snug">
                本应用<strong>完全免费且开源</strong>，无广告、无内购、不上传你的隐私数据，数据完全本地存储。
              </p>
            </div>

            {/* QQ群 下载 */}
            <div className="space-y-2.5">
              <div className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                <MessageCircle className="w-3.5 h-3.5 text-emerald-600" />
                <span>进 QQ 群获取</span>
              </div>
              <div className="p-3 sm:p-4 bg-[#F0F6FC] rounded-2xl border-2 border-[#D5E3F0] flex flex-col gap-3">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 w-full sm:w-auto">
                    <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-[#7ABCF4] text-white flex items-center justify-center shrink-0 shadow-xs border-2 border-[#5DA8E8]">
                      <MessageCircle className="w-5 h-5 sm:w-6 sm:h-6" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-black text-slate-800 truncate" title={gname}>{gname}</div>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="text-xs font-mono font-black text-[#1E5B99] bg-white px-2 py-0.5 rounded-lg border border-[#BCD7F2]">{gid}</span>
                        <span className="text-[11px] text-slate-500 font-medium">群内提供安装包</span>
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
                            qrOpen ? 'bg-[#7ABCF4] text-white border-[#5DA8E8] shadow-xs' : 'bg-white hover:bg-[#EBF4FE] text-[#1E5B99] border-[#BCD7F2] hover:border-[#7ABCF4] shadow-xs'
                        }`}
                    >
                      <QrCode className="w-4 h-4" />
                    </button>
                    <button
                        type="button"
                        onClick={handleCopyQQGroup}
                        className={`px-3 py-2 rounded-xl text-xs font-black flex items-center gap-1 transition-all cursor-pointer border-2 ${
                            copiedGroupId === gid ? 'bg-[#95D151] text-white border-[#76B032]' : 'bg-white hover:bg-[#EBF4FE] text-[#1E5B99] border-[#BCD7F2] hover:border-[#7ABCF4] shadow-xs'
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
                    <div className="pt-3 border-t border-[#D5E3F0] flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 bg-white/80 p-3 sm:p-3.5 rounded-xl border border-white shadow-inner animate-in fade-in zoom-in-95 duration-200">
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
                        <div className="flex items-center justify-center sm:justify-start gap-1.5 text-xs font-black text-slate-800">
                          <QrCode className="w-4 h-4 text-[#2B78C4]" />
                          <span>扫一扫加入交流群</span>
                        </div>
                        <p className="text-[11px] text-slate-500">使用手机 QQ 扫描上方二维码即可一键加入</p>
                        <p className="text-[10px] text-[#2B78C4] font-mono font-bold bg-[#EBF4FE] px-2 py-0.5 rounded-md inline-block">群号: {gid}</p>
                      </div>
                    </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
  );
};
