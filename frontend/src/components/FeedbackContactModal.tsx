import React, { useState } from 'react';
import {
    X,
    MessageCircle,
    Bug,
    Copy,
    Check,
    Send,
    RefreshCw,
    QrCode,
} from 'lucide-react';
import { sound } from '../services/sound';
import { api } from '../services/api';
import { IS_STATIC } from '../services/staticMode';


interface FeedbackContactModalProps {
    isOpen: boolean;
    onClose: () => void;
    initialType?: string;
}


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
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
            onClick={onClose}
            onWheel={(e) => e.stopPropagation()}
        >
            <div
                className="bg-white dark:bg-slate-900 rounded-3xl border-4 border-[#5DA8E8] dark:border-slate-700 shadow-2xl max-w-lg w-full overflow-hidden flex flex-col transition-colors"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="bg-[#7ABCF4] dark:bg-slate-800 px-5 py-4 text-white flex items-center justify-between border-b-2 border-[#5DA8E8] dark:border-slate-700">
                    <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-xl bg-white/20 border border-white/40 flex items-center justify-center shadow-xs">
                            <MessageCircle className="w-4 h-4 text-white" />
                        </div>
                        <div>
                            <h3 className="text-base font-black tracking-tight">联系与反馈 · 洛克交流</h3>
                            <p className="text-[11px] text-white/80 dark:text-slate-300 font-medium">加入玩家QQ群 · 提出意见或报告异常</p>
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
                <div className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">
                    {/* QQ 群列表（支持多个群） */}
                    <div className="space-y-3">
                        {groups.length === 0 ? (
                            <div className="p-4 bg-[#F0F6FC] rounded-2xl border-2 border-[#D5E3F0] text-center text-xs text-slate-400">
                                暂无群信息，请稍后重试或从官网获取。
                            </div>
                        ) : groups.map((g: any, idx: number) => {
                            const gid: string = String(g?.group_id ?? '');
                            const gname: string = g?.name ?? '加入交流群';
                            const qrSrc: string = g?.qrcode ? api.resourceUrl(g.qrcode) : './qrcode.png';
                            return (
                                <div
                                    key={gid || idx}
                                    className="p-4 bg-[#F0F6FC] rounded-2xl border-2 border-[#D5E3F0] flex flex-col gap-3"
                                >
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className="w-11 h-11 rounded-2xl bg-[#7ABCF4] text-white flex items-center justify-center shrink-0 shadow-xs border-2 border-[#5DA8E8]">
                                                <MessageCircle className="w-6 h-6" />
                                            </div>
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-xs font-black text-slate-800 truncate">{gname}</span>
                                                    <span className="text-[10px] font-black px-1.5 py-0.2 bg-[#FEE061] text-[#854D0E] rounded-md shrink-0">官方群</span>
                                                </div>
                                                <div className="flex items-center gap-2 mt-1">
                                                    {gid && (
                                                        <span className="text-xs font-mono font-black text-[#1E5B99] bg-white px-2 py-0.5 rounded-lg border border-[#BCD7F2]">{gid}</span>
                                                    )}
                                                    <span className="text-[11px] text-slate-500 font-medium">随时交流/汇报Bug</span>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-1.5 shrink-0">
                                            <button
                                                type="button"
                                                onClick={() => handleToggleQRCode(idx)}
                                                title={qrOpenIndex === idx ? '收起二维码' : '扫码进群'}
                                                className={`p-2 rounded-xl text-xs font-black flex items-center justify-center transition-all cursor-pointer border-2 ${
                                                    qrOpenIndex === idx
                                                        ? 'bg-[#7ABCF4] text-white border-[#5DA8E8] shadow-xs'
                                                        : 'bg-white hover:bg-[#EBF4FE] text-[#1E5B99] border-[#BCD7F2] hover:border-[#7ABCF4] shadow-xs'
                                                }`}
                                            >
                                                <QrCode className="w-4 h-4" />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleCopyQQGroup(gid)}
                                                className={`px-3 py-2 rounded-xl text-xs font-black flex items-center gap-1 transition-all cursor-pointer border-2 ${
                                                    copiedGroupId === gid
                                                        ? 'bg-[#95D151] text-white border-[#76B032]'
                                                        : 'bg-white hover:bg-[#EBF4FE] text-[#1E5B99] border-[#BCD7F2] hover:border-[#7ABCF4] shadow-xs'
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

                                    {qrOpenIndex === idx && (
                                        <div className="pt-3 border-t border-[#D5E3F0] flex flex-col sm:flex-row items-center justify-center gap-4 bg-white/80 p-3.5 rounded-xl border border-white shadow-inner animate-in fade-in zoom-in-95 duration-200">
                                            <div className="p-2 bg-white rounded-2xl border-2 border-[#BCD7F2] shadow-sm flex items-center justify-center">
                                                <img
                                                    src={qrSrc}
                                                    alt="QQ群二维码"
                                                    className="w-36 h-36 object-contain rounded-lg"
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
                                                {gid && (
                                                    <p className="text-[10px] text-[#2B78C4] font-mono font-bold bg-[#EBF4FE] px-2 py-0.5 rounded-md inline-block">
                                                        群号: {gid}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {/* Online Feedback Form（web 版隐藏：无后端接收，改为引导到 QQ 群） */}
                    {!IS_STATIC && (
                    <form onSubmit={handleSubmitFeedback} className="space-y-3 pt-1">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-black text-slate-700 flex items-center gap-1.5">
                                <Bug className="w-3.5 h-3.5 text-rose-500" />
                                在线 Bug 反馈 / 优化建议
                            </span>
                            <span className="text-[10px] text-slate-400">匿名快速提交</span>
                        </div>

                        {/* Type selector */}
                        <div className="grid grid-cols-3 gap-2">
                            <button
                                type="button"
                                onClick={() => setFeedbackType('识别异常Bug')}
                                className={`py-1.5 px-2 rounded-xl text-xs font-black border-2 transition-all cursor-pointer ${
                                    feedbackType === '识别异常Bug'
                                        ? 'bg-rose-50 border-rose-400 text-rose-700 shadow-xs'
                                        : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100'
                                }`}
                            >
                                🐞 识别异常Bug
                            </button>
                            <button
                                type="button"
                                onClick={() => setFeedbackType('精灵图鉴纠错')}
                                className={`py-1.5 px-2 rounded-xl text-xs font-black border-2 transition-all cursor-pointer ${
                                    feedbackType === '精灵图鉴纠错'
                                        ? 'bg-amber-50 border-amber-400 text-amber-800 shadow-xs'
                                        : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100'
                                }`}
                            >
                                📝 精灵图鉴纠错
                            </button>
                            <button
                                type="button"
                                onClick={() => setFeedbackType('功能体验建议')}
                                className={`py-1.5 px-2 rounded-xl text-xs font-black border-2 transition-all cursor-pointer ${
                                    feedbackType === '功能体验建议'
                                        ? 'bg-[#EBF4FE] border-[#7ABCF4] text-[#1E5B99] shadow-xs'
                                        : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100'
                                }`}
                            >
                                💡 功能体验建议
                            </button>
                        </div>

                        {/* Textarea */}
                        <div>
                            <textarea
                                value={feedbackContent}
                                onChange={(e) => setFeedbackContent(e.target.value)}
                                placeholder="请详细描述您遇到的问题（如：识别哪只精灵不准、按钮点击异常、期望新增的功能等）..."
                                rows={3}
                                className="w-full text-xs p-3 rounded-2xl border-2 border-slate-200 focus:border-[#7ABCF4] focus:outline-hidden bg-slate-50/70 focus:bg-white resize-none text-slate-800 placeholder:text-slate-400 font-medium"
                            />
                        </div>

                        {/* Contact Info (Optional) */}
                        <div>
                            <input
                                type="text"
                                value={contactInfo}
                                onChange={(e) => setContactInfo(e.target.value)}
                                placeholder="您的 QQ号 / 邮箱（选填，方便核实与答复）"
                                className="w-full text-xs px-3 py-2 rounded-xl border-2 border-slate-200 focus:border-[#7ABCF4] focus:outline-hidden bg-slate-50/70 focus:bg-white text-slate-800 placeholder:text-slate-400 font-medium"
                            />
                        </div>

                        {/* Submit Button */}
                        <button
                            type="submit"
                            disabled={!feedbackContent.trim() || isSubmitting || isSubmitted}
                            className={`w-full py-2.5 px-4 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition-all border-2 cursor-pointer ${
                                isSubmitted
                                    ? 'bg-[#95D151] text-white border-[#76B032]'
                                    : isSubmitting
                                        ? 'bg-[#7ABCF4]/70 text-white border-[#5DA8E8]'
                                        : 'bg-[#7ABCF4] hover:bg-[#68AEEB] text-white border-[#5DA8E8] shadow-xs disabled:opacity-50 disabled:cursor-not-allowed'
                            }`}
                        >
                            {isSubmitted ? (
                                <>
                                    <Check className="w-4 h-4 stroke-[3]" />
                                    <span>{submitMessage || '反馈已提交，感谢您的支持！'}</span>
                                </>
                            ) : isSubmitting ? (
                                <>
                                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                    <span>正在提交中...</span>
                                </>
                            ) : (
                                <>
                                    <Send className="w-3.5 h-3.5" />
                                    <span>提交反馈</span>
                                </>
                            )}
                        </button>
                    </form>
                    )}
                </div>
            </div>
        </div>
    );
};
