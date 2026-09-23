import React, { useState } from 'react';
import {
    X,
    Users,
    Bug,
    BookOpenCheck,
    Lightbulb,
    Copy,
    Check,
    Send,
    RefreshCw,
    QrCode,
    Sparkles,
} from 'lucide-react';
import { sound } from '../services/sound';
import { ModalHeader, ModalHeaderBadge } from './ModalHeader';
import { api } from '../services/api';
import { IS_STATIC } from '../services/staticMode';


interface FeedbackContactModalProps {
    isOpen: boolean;
    onClose: () => void;
    initialType?: string;
}

/** 反馈类型：用图标 + 语义色描述，避免三个彩色按钮拼成「彩虹」。 */
const FEEDBACK_TYPES = [
    { id: '识别异常Bug', label: '识别异常', icon: Bug, tint: 'rose' },
    { id: '精灵图鉴纠错', label: '图鉴纠错', icon: BookOpenCheck, tint: 'amber' },
    { id: '功能体验建议', label: '功能建议', icon: Lightbulb, tint: 'sky' },
] as const;


export const FeedbackContactModal: React.FC<FeedbackContactModalProps> = ({
                                                                              isOpen,
                                                                              onClose,
                                                                              initialType,
                                                                          }) => {
    const [copiedGroupId, setCopiedGroupId] = useState<string | null>(null);
    const [qrOpenIndex, setQrOpenIndex] = useState<number | null>(null);
    const [feedbackType, setFeedbackType] = useState<string>('识别异常Bug');
    const [feedbackContent, setFeedbackContent] = useState<string>('');
    const [contactInfo, setContactInfo] = useState<string>('');
    const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
    const [isSubmitted, setIsSubmitted] = useState<boolean>(false);
    const [submitMessage, setSubmitMessage] = useState<string>('');
    const [chatConfig, setChatConfig] = useState<any>(null);

    // 外部传入 initialType 时（如右键反馈），打开弹窗后预选该类型
    React.useEffect(() => {
        if (isOpen && initialType) {
            setFeedbackType(initialType);
        }
    }, [isOpen, initialType]);

    // 打开时从 resources/chat.json（Gitee raw）读取 QQ 群列表
    React.useEffect(() => {
        if (isOpen) {
            api.getChatConfig().then((cfg) => setChatConfig(cfg));
        }
    }, [isOpen]);

    // Esc 关闭（与其它弹窗保持一致）
    React.useEffect(() => {
        if (!isOpen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const groups = Array.isArray(chatConfig?.qq_group) ? chatConfig.qq_group : [];

    const handleCopyQQGroup = (id: string) => {
        sound.playClick();
        navigator.clipboard.writeText(id).then(() => {
            setCopiedGroupId(id);
            setTimeout(() => setCopiedGroupId((cur) => (cur === id ? null : cur)), 2000);
        });
    };

    const handleToggleQRCode = (index: number) => {
        sound.playClick();
        setQrOpenIndex((prev) => (prev === index ? null : index));
    };

    const handleSubmitFeedback = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!feedbackContent.trim() || isSubmitting) return;

        setIsSubmitting(true);
        sound.playClick();

        try {
            const res = await api.submitFeedback({
                type: feedbackType,
                content: feedbackContent.trim(),
                contact: contactInfo.trim() || undefined,
            });

            sound.playEncounter();
            setIsSubmitted(true);
            setSubmitMessage(res.message || '反馈提交成功，感谢您的支持！');

            setTimeout(() => {
                setIsSubmitted(false);
                setFeedbackContent('');
                setContactInfo('');
                onClose();
            }, 1600);
        } catch (err: unknown) {
            const error = err as Error;
            sound.playEncounter();
            setIsSubmitted(true);
            setSubmitMessage(error.message || '反馈已记录！');
            setTimeout(() => {
                setIsSubmitted(false);
                onClose();
            }, 1600);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/55 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={onClose}
            onWheel={(e) => e.stopPropagation()}
        >
            <div
                className="bg-white dark:bg-slate-900 rounded-[26px] shadow-2xl ring-1 ring-slate-900/5 dark:ring-white/10 max-w-[540px] w-full overflow-hidden flex flex-col transition-colors"
                onClick={(e) => e.stopPropagation()}
            >
                {/* ── Header ───────────────────────────────────────── */}
                <ModalHeader
                    icon={Users}
                    tone="violet"
                    title="联系与反馈"
                    subtitle="加入玩家群交流，或直接提交问题与建议"
                    onClose={onClose}
                    closeTitle="关闭 (Esc)"
                />

                {/* ── Content ───────────────────────────────────────── */}
                <div className="px-5 py-4 space-y-5 max-h-[76vh] overflow-y-auto custom-roco-scrollbar">
                    {/* QQ 群 */}
                    <section className="space-y-2.5">
                        <SectionLabel icon={Users} text="玩家交流群" hint="官方群 · 随时答疑" />

                        {groups.length === 0 ? (
                            <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/60 px-4 py-5 text-center text-xs text-slate-400 dark:text-slate-500">
                                暂无群信息，请稍后重试或从官网获取。
                            </div>
                        ) : groups.map((g: any, idx: number) => {
                            const gid: string = String(g?.group_id ?? '');
                            const gname: string = g?.name ?? '加入交流群';
                            const qrSrc: string = g?.qrcode ? api.resourceUrl(g.qrcode) : './qrcode.png';
                            const copied = copiedGroupId === gid;
                            const qrOpen = qrOpenIndex === idx;
                            return (
                                <div
                                    key={gid || idx}
                                    className="rounded-2xl bg-gradient-to-br from-sky-50 to-white dark:from-slate-800 dark:to-slate-800/60 ring-1 ring-sky-100 dark:ring-slate-700 overflow-hidden"
                                >
                                    <div className="p-3.5 flex items-center gap-3">
                                        <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#7ABCF4] to-[#5DA8E8] text-white flex items-center justify-center shrink-0 shadow-sm">
                                            <Users className="w-[22px] h-[22px]" />
                                        </div>

                                        <div className="min-w-0 flex-1">
                                            {/* 群名不再截断成「…」：允许换行，最多两行 */}
                                            <div className="flex items-start gap-1.5">
                                                <span className="text-[13px] font-black text-slate-800 dark:text-slate-100 leading-snug line-clamp-2">
                                                    {gname}
                                                </span>
                                                <span className="shrink-0 mt-px text-[9px] font-black px-1.5 py-0.5 rounded-md bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 ring-1 ring-inset ring-amber-200/70 dark:ring-amber-800/60">
                                                    官方群
                                                </span>
                                            </div>
                                            {gid && (
                                                <button
                                                    type="button"
                                                    onClick={() => handleCopyQQGroup(gid)}
                                                    title="点击复制群号"
                                                    className="mt-1 inline-flex items-center gap-1.5 text-[11px] font-mono font-bold text-slate-500 dark:text-slate-400 hover:text-[#2B78C4] dark:hover:text-sky-300 transition-colors cursor-pointer group/gid"
                                                >
                                                    <span>群号 {gid}</span>
                                                    {copied
                                                        ? <Check className="w-3 h-3 text-emerald-500 stroke-[3]" />
                                                        : <Copy className="w-3 h-3 opacity-60 group-hover/gid:opacity-100" />}
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    {/* 两个等宽按钮：不再是一「图标方块」+一「宽按钮」的失衡布局 */}
                                    <div className="px-3.5 pb-3.5 grid grid-cols-2 gap-2">
                                        <button
                                            type="button"
                                            onClick={() => handleCopyQQGroup(gid)}
                                            className={`h-9 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition-all cursor-pointer ring-1 ring-inset ${
                                                copied
                                                    ? 'bg-emerald-500 text-white ring-emerald-500 shadow-sm'
                                                    : 'bg-white dark:bg-slate-900 text-[#2B78C4] dark:text-sky-300 ring-sky-200 dark:ring-slate-700 hover:bg-sky-50 dark:hover:bg-slate-800 hover:ring-sky-300 shadow-xs'
                                            }`}
                                        >
                                            {copied
                                                ? <><Check className="w-3.5 h-3.5 stroke-[3]" /><span>已复制</span></>
                                                : <><Copy className="w-3.5 h-3.5" /><span>复制群号</span></>}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleToggleQRCode(idx)}
                                            className={`h-9 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition-all cursor-pointer ring-1 ring-inset ${
                                                qrOpen
                                                    ? 'bg-[#5DA8E8] text-white ring-[#5DA8E8] shadow-sm'
                                                    : 'bg-white dark:bg-slate-900 text-[#2B78C4] dark:text-sky-300 ring-sky-200 dark:ring-slate-700 hover:bg-sky-50 dark:hover:bg-slate-800 hover:ring-sky-300 shadow-xs'
                                            }`}
                                        >
                                            <QrCode className="w-3.5 h-3.5" />
                                            <span>{qrOpen ? '收起二维码' : '扫码进群'}</span>
                                        </button>
                                    </div>

                                    {/* 二维码面板：浅色留白，不再套「框里的框」 */}
                                    {qrOpen && (
                                        <div className="px-3.5 pb-3.5 animate-in fade-in slide-in-from-top-1 duration-200">
                                            <div className="rounded-xl bg-white dark:bg-slate-900 p-3 flex items-center gap-4 ring-1 ring-sky-100 dark:ring-slate-700">
                                                <img
                                                    src={qrSrc}
                                                    alt="QQ群二维码"
                                                    className="w-28 h-28 object-contain rounded-lg shrink-0"
                                                    onError={(e) => {
                                                        (e.target as HTMLImageElement).src = `https://dummyimage.com/200x200/7abcf4/ffffff.png&text=QQ+Group:+${gid}`;
                                                    }}
                                                />
                                                <div className="min-w-0 space-y-1">
                                                    <p className="text-xs font-black text-slate-700 dark:text-slate-200">手机 QQ 扫码加入</p>
                                                    <p className="text-[11px] text-slate-400 dark:text-slate-500 leading-relaxed">
                                                        打开手机 QQ → 右上角「+」→ 扫一扫
                                                    </p>
                                                    {gid && (
                                                        <p className="text-[10px] font-mono font-bold text-[#2B78C4] dark:text-sky-300">
                                                            {gid}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </section>

                    {/* 在线反馈（web 版无后端接收，隐藏） */}
                    {!IS_STATIC && (
                        <form onSubmit={handleSubmitFeedback} className="space-y-3">
                            <SectionLabel icon={Sparkles} text="在线反馈" hint="匿名快速提交" />

                            {/* 类型选择：单色 segmented control，选中态用白底浮起 */}
                            <div className="grid grid-cols-3 gap-1 p-1 rounded-2xl bg-slate-100 dark:bg-slate-800">
                                {FEEDBACK_TYPES.map((t) => {
                                    const Icon = t.icon;
                                    const active = feedbackType === t.id;
                                    const activeTone =
                                        t.tint === 'rose'
                                            ? 'text-rose-600 dark:text-rose-400'
                                            : t.tint === 'amber'
                                                ? 'text-amber-600 dark:text-amber-400'
                                                : 'text-[#2B78C4] dark:text-sky-400';
                                    return (
                                        <button
                                            key={t.id}
                                            type="button"
                                            onClick={() => setFeedbackType(t.id as string)}
                                            className={`h-9 rounded-xl text-[11px] font-black flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                                                active
                                                    ? `bg-white dark:bg-slate-900 shadow-sm ${activeTone}`
                                                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                                            }`}
                                        >
                                            <Icon className="w-3.5 h-3.5" />
                                            <span>{t.label}</span>
                                        </button>
                                    );
                                })}
                            </div>

                            <textarea
                                value={feedbackContent}
                                onChange={(e) => setFeedbackContent(e.target.value)}
                                placeholder="请详细描述您遇到的问题（如：识别哪只精灵不准、按钮点击异常、期望新增的功能等）..."
                                rows={4}
                                className="w-full text-xs p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/70 ring-1 ring-inset ring-slate-200 dark:ring-slate-700 focus:ring-2 focus:ring-[#7ABCF4] dark:focus:ring-sky-600 focus:bg-white dark:focus:bg-slate-800 outline-hidden resize-none text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 font-medium leading-relaxed transition-all"
                            />

                            <input
                                type="text"
                                value={contactInfo}
                                onChange={(e) => setContactInfo(e.target.value)}
                                placeholder="您的 QQ号 / 邮箱（选填，方便核实与答复）"
                                className="w-full text-xs px-3.5 h-10 rounded-2xl bg-slate-50 dark:bg-slate-800/70 ring-1 ring-inset ring-slate-200 dark:ring-slate-700 focus:ring-2 focus:ring-[#7ABCF4] dark:focus:ring-sky-600 focus:bg-white dark:focus:bg-slate-800 outline-hidden text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 font-medium transition-all"
                            />

                            <button
                                type="submit"
                                disabled={!feedbackContent.trim() || isSubmitting || isSubmitted}
                                className={`w-full h-11 rounded-2xl text-[13px] font-black flex items-center justify-center gap-2 transition-all cursor-pointer ${
                                    isSubmitted
                                        ? 'bg-emerald-500 text-white shadow-sm'
                                        : isSubmitting
                                            ? 'bg-[#7ABCF4]/75 text-white cursor-wait'
                                            : 'bg-gradient-to-r from-[#7ABCF4] to-[#5DA8E8] dark:from-sky-600 dark:to-sky-700 text-white shadow-md hover:shadow-lg hover:brightness-[1.04] active:scale-[0.99] disabled:from-slate-200 disabled:to-slate-200 dark:disabled:from-slate-800 dark:disabled:to-slate-800 disabled:text-slate-400 dark:disabled:text-slate-500 disabled:shadow-none disabled:cursor-not-allowed'
                                }`}
                            >
                                {isSubmitted ? (
                                    <><Check className="w-4 h-4 stroke-[3]" /><span>{submitMessage || '反馈已提交，感谢您的支持！'}</span></>
                                ) : isSubmitting ? (
                                    <><RefreshCw className="w-3.5 h-3.5 animate-spin" /><span>正在提交…</span></>
                                ) : (
                                    <><Send className="w-4 h-4" /><span>提交反馈</span></>
                                )}
                            </button>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
};


/** 区块小标题：统一「图标 + 标题 + 右侧提示」的层级，替代原来零散的小红字。 */
const SectionLabel: React.FC<{
    icon: React.ComponentType<{ className?: string }>;
    text: string;
    hint?: string;
}> = ({ icon: Icon, text, hint }) => (
    <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-black text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
            <Icon className="w-3.5 h-3.5 text-[#2B78C4] dark:text-sky-400" />
            {text}
        </span>
        {hint && <span className="text-[10px] text-slate-400 dark:text-slate-500">{hint}</span>}
    </div>
);
