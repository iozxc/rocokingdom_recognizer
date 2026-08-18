import React, { useState, useEffect } from 'react';
import {
    X,
    RefreshCw,
    Sparkles,
    ExternalLink,
    CheckCircle2,
    AlertCircle,
    Download,
    Info,
    ArrowUpCircle,
} from 'lucide-react';
import { sound } from '../services/sound';
import { api } from '../services/api';
import { CheckUpdateResponse } from '../types';

interface UpdateModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export const UpdateModal: React.FC<UpdateModalProps> = ({ isOpen, onClose }) => {
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [updateData, setUpdateData] = useState<CheckUpdateResponse | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    const fetchUpdate = async () => {
        setIsLoading(true);
        setErrorMsg(null);
        try {
            const res = await api.checkUpdate();
            setUpdateData(res.data);
        } catch (err: unknown) {
            const error = err as Error;
            setErrorMsg(error.message || '检查更新失败，请稍后再试');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (isOpen) {
            fetchUpdate();
        }
    }, [isOpen]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
            <div
                className="bg-white rounded-3xl border-4 border-[#5DA8E8] shadow-2xl max-w-lg w-full overflow-hidden flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="bg-[#7ABCF4] px-5 py-4 text-white flex items-center justify-between border-b-2 border-[#5DA8E8]">
                    <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-xl bg-white/20 border border-white/40 flex items-center justify-center shadow-xs">
                            <ArrowUpCircle className="w-4 h-4 text-[#FEE061]" />
                        </div>
                        <div>
                            <h3 className="text-base font-black tracking-tight">检查版本更新</h3>
                            <p className="text-[11px] text-white/80 font-medium">获取洛克王国草系徽章助手最新版本与更新日志</p>
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
                    {isLoading ? (
                        <div className="py-12 flex flex-col items-center justify-center gap-3 text-slate-500">
                            <RefreshCw className="w-8 h-8 animate-spin text-[#2B78C4]" />
                            <p className="text-xs font-black">正在连接服务器检查更新中...</p>
                        </div>
                    ) : errorMsg ? (
                        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 flex items-start gap-3">
                            <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                            <div className="text-xs">
                                <p className="font-black text-rose-800">检查更新出错</p>
                                <p className="text-rose-600 mt-1">{errorMsg}</p>
                                <button
                                    type="button"
                                    onClick={fetchUpdate}
                                    className="mt-2 px-3 py-1 bg-rose-600 text-white font-bold rounded-lg hover:bg-rose-700 transition-colors"
                                >
                                    重新检查
                                </button>
                            </div>
                        </div>
                    ) : updateData?.has_update ? (
                        <div className="space-y-4">
                            {/* Has update banner */}
                            <div className="p-4 bg-gradient-to-r from-[#F0FDF4] to-[#ECFCCB] rounded-2xl border-2 border-[#86EFAC] flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-2xl bg-[#22C55E] text-white flex items-center justify-center shadow-xs">
                                        <Sparkles className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-black text-slate-900">发现新版本</span>
                                            <span className="text-xs font-black px-2 py-0.5 rounded-full bg-[#15803D] text-white font-mono shadow-2xs">
                        v{updateData.latest_version || '1.1.0'}
                      </span>
                                        </div>
                                        <p className="text-xs text-slate-600 mt-0.5">建议更新以获得最新图鉴识别支持与功能修复</p>
                                    </div>
                                </div>
                            </div>

                            {/* Update Changelog Box */}
                            {updateData.update_log && (
                                <div className="p-4 bg-[#F8FAFC] rounded-2xl border border-slate-200">
                                    <div className="flex items-center gap-1.5 mb-2">
                                        <Info className="w-4 h-4 text-[#2B78C4]" />
                                        <span className="text-xs font-black text-slate-800">更新日志</span>
                                    </div>
                                    <div className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed bg-white p-3 rounded-xl border border-slate-100 font-medium">
                                        {updateData.update_log}
                                    </div>
                                </div>
                            )}

                            {/* Mirrors / Download Links */}
                            {updateData.mirrors && Object.keys(updateData.mirrors).length > 0 && (
                                <div className="space-y-2">
                  <span className="text-xs font-black text-slate-700 flex items-center gap-1">
                    <Download className="w-3.5 h-3.5 text-[#2B78C4]" />
                    下载与发布渠道
                  </span>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                        {Object.entries(updateData.mirrors).map(([name, url]) => (
                                            <a
                                                key={name}
                                                href={url}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="p-3 bg-[#F0F6FC] hover:bg-[#E1F0FE] border-2 border-[#BCD7F2] hover:border-[#7ABCF4] rounded-2xl flex items-center justify-between text-xs font-black text-[#1E5B99] transition-all group shadow-2xs cursor-pointer"
                                            >
                                                <div className="flex items-center gap-2">
                                                    <Download className="w-4 h-4 text-[#2B78C4] group-hover:translate-y-0.5 transition-transform" />
                                                    <span>{name}</span>
                                                </div>
                                                <ExternalLink className="w-3.5 h-3.5 text-slate-400 group-hover:text-[#2B78C4]" />
                                            </a>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="py-8 flex flex-col items-center justify-center text-center gap-2">
                            <div className="w-12 h-12 rounded-2xl bg-[#E1F7DB] text-[#2D6613] flex items-center justify-center border-2 border-[#95D151] mb-1">
                                <CheckCircle2 className="w-6 h-6" />
                            </div>
                            <h4 className="text-sm font-black text-slate-800">当前已是最新版本</h4>
                            <p className="text-xs text-slate-500 max-w-xs">
                                您的助手已经搭载最新的识别算法与图鉴库，暂无更新。
                            </p>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-5 py-3 bg-[#F0F6FC] border-t border-[#D5E3F0] flex items-center justify-between">
                    <button
                        type="button"
                        onClick={fetchUpdate}
                        disabled={isLoading}
                        className="flex items-center gap-1.5 text-xs text-[#2B78C4] hover:text-[#1E5B99] font-black cursor-pointer disabled:opacity-50"
                    >
                        <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                        <span>重新检测</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => {
                            sound.playClick();
                            onClose();
                        }}
                        className="px-4 py-2 rounded-xl bg-[#7ABCF4] hover:bg-[#5DA8E8] text-white font-black text-xs shadow-xs transition-colors cursor-pointer"
                    >
                        关闭
                    </button>
                </div>
            </div>
        </div>
    );
};
