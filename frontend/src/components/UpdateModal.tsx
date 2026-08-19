import React, { useState, useEffect, useRef } from 'react';
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
    Check,
    Loader2,
} from 'lucide-react';
import { sound } from '../services/sound';
import { api } from '../services/api';
import { CheckUpdateResponse, DownloadStatus } from '../types';

interface UpdateModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export const UpdateModal: React.FC<UpdateModalProps> = ({ isOpen, onClose }) => {
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
    const [hasChecked, setHasChecked] = useState<boolean>(false);
    const [updateData, setUpdateData] = useState<CheckUpdateResponse | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    // Auto Download & Update State: Fully driven by server API
    const [downloadStatus, setDownloadStatus] = useState<DownloadStatus>('idle');
    const [downloadProgress, setDownloadProgress] = useState<number>(0);
    const [downloadError, setDownloadError] = useState<string | null>(null);
    const [isStartingDownload, setIsStartingDownload] = useState<boolean>(false);
    const [showReadyDialog, setShowReadyDialog] = useState<boolean>(false);

    const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

    const stopPolling = () => {
        if (pollTimerRef.current) {
            clearInterval(pollTimerRef.current);
            pollTimerRef.current = null;
        }
    };

    const isDownloadingOrVerifying = downloadStatus === 'downloading' || downloadStatus === 'verifying';

    const fetchUpdate = async (silent = false) => {
        if (isDownloadingOrVerifying) {
            // 正在下载或校验时，禁止重新检测以免打断下载流程与界面
            return;
        }

        if (silent || hasChecked) {
            setIsRefreshing(true);
        } else {
            setIsLoading(true);
        }
        setErrorMsg(null);

        try {
            // 1. 获取最新更新状态
            const res = await api.checkUpdate();
            setUpdateData(res.data);
            setHasChecked(true);

            // 2. 向后端查询当前真实下载进度状态
            try {
                const progressRes = await api.getDownloadProgress();
                const { progress, status, error } = progressRes.data;

                setDownloadStatus(status || 'idle');
                setDownloadProgress(typeof progress === 'number' ? Math.max(0, Math.min(100, progress)) : 0);

                if (status === 'downloading' || status === 'verifying') {
                    startProgressPolling();
                } else if (status === 'error') {
                    setDownloadError(error || '下载更新过程中发生错误');
                } else if (status === 'idle') {
                    setDownloadError(null);
                    stopPolling();
                }
            } catch {
                setDownloadStatus('idle');
            }
        } catch (err: unknown) {
            const error = err as Error;
            setErrorMsg(error.message || '检查更新失败，请稍后再试');
            setHasChecked(true);
        } finally {
            setIsLoading(false);
            setIsRefreshing(false);
        }
    };

    // Poll /api/download_progress every 1 second
    const startProgressPolling = () => {
        stopPolling();
        pollTimerRef.current = setInterval(async () => {
            try {
                const res = await api.getDownloadProgress();
                const { progress, status, error } = res.data;

                setDownloadProgress(typeof progress === 'number' ? Math.max(0, Math.min(100, progress)) : 0);
                setDownloadStatus(status);

                if (status === 'error') {
                    setDownloadError(error || '下载更新过程中发生错误');
                    stopPolling();
                } else if (status === 'ready') {
                    stopPolling();
                    setShowReadyDialog(true);
                } else if (status === 'verifying') {
                    setDownloadProgress(100);
                } else if (status === 'idle') {
                    stopPolling();
                }
            } catch (err: unknown) {
                console.warn('Polling download progress failed:', err);
            }
        }, 1000);
    };

    // Trigger download action
    const handleStartDownload = async () => {
        if (!updateData?.has_update || downloadStatus === 'ready' || isDownloadingOrVerifying) {
            return;
        }

        sound.playClick();
        setIsStartingDownload(true);
        setDownloadError(null);
        setDownloadProgress(0);
        setDownloadStatus('downloading');

        try {
            const res = await api.startDownload();
            if (res.data.status === 'error') {
                setDownloadStatus('error');
                setDownloadError(res.data.message || '发起更新失败，请稍后再试');
            } else {
                // Start polling progress
                startProgressPolling();
            }
        } catch (err: unknown) {
            const error = err as Error;
            setDownloadStatus('error');
            setDownloadError(error.message || '网络异常，发起更新请求失败');
        } finally {
            setIsStartingDownload(false);
        }
    };

    useEffect(() => {
        if (isOpen) {
            fetchUpdate(false);
        } else {
            stopPolling();
            setHasChecked(false);
            setUpdateData(null);
            setErrorMsg(null);
            setDownloadStatus('idle');
            setDownloadProgress(0);
            setDownloadError(null);
            setShowReadyDialog(false);
        }
        return () => {
            stopPolling();
        };
    }, [isOpen]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
            <div
                className="bg-white rounded-3xl border-4 border-[#5DA8E8] shadow-2xl max-w-lg w-full overflow-hidden flex flex-col relative"
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
                            <p className="text-[11px] text-white/80 font-medium">获取洛克王国识别助手最新版本与更新日志</p>
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
                    {isLoading && !updateData ? (
                        <div className="py-12 flex flex-col items-center justify-center gap-3 text-slate-500">
                            <RefreshCw className="w-8 h-8 animate-spin text-[#2B78C4]" />
                            <p className="text-xs font-black">正在连接服务器检查更新中...</p>
                        </div>
                    ) : errorMsg && !updateData ? (
                        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 flex items-start gap-3">
                            <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                            <div className="text-xs">
                                <p className="font-black text-rose-800">检查更新出错</p>
                                <p className="text-rose-600 mt-1">{errorMsg}</p>
                                <button
                                    type="button"
                                    onClick={() => fetchUpdate(false)}
                                    className="mt-2 px-3 py-1 bg-rose-600 text-white font-bold rounded-lg hover:bg-rose-700 transition-colors"
                                >
                                    重新检查
                                </button>
                            </div>
                        </div>
                    ) : hasChecked && updateData?.has_update ? (
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

                            {/* 1. Mirrors / Manual Download Links */}
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

                            {/* 2. One-click Automatic Update Section */}
                            <div className="p-4 bg-white rounded-2xl border-2 border-[#BCD7F2] space-y-3 shadow-xs">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <div className="w-6 h-6 rounded-lg bg-[#7ABCF4] text-white flex items-center justify-center">
                                            <Download className="w-3.5 h-3.5" />
                                        </div>
                                        <span className="text-xs font-black text-slate-800">一键自动下载更新</span>
                                    </div>

                                    {downloadStatus === 'downloading' && (
                                        <span className="text-xs font-mono font-black text-[#2B78C4]">
                      {downloadProgress}%
                    </span>
                                    )}
                                    {downloadStatus === 'verifying' && (
                                        <span className="text-xs font-black text-amber-600 animate-pulse">
                      校验中...
                    </span>
                                    )}
                                    {downloadStatus === 'ready' && (
                                        <span className="text-xs font-black text-[#22C55E]">
                      下载完成
                    </span>
                                    )}
                                </div>

                                {/* Progress bar and status descriptions */}
                                {downloadStatus === 'downloading' && (
                                    <div className="space-y-1.5 animate-in fade-in duration-150">
                                        <div className="w-full h-3 bg-[#E9F2FA] rounded-full overflow-hidden border border-[#BCD7F2] p-0.5">
                                            <div
                                                className="h-full bg-gradient-to-r from-[#7ABCF4] to-[#2B78C4] rounded-full transition-all duration-300"
                                                style={{ width: `${downloadProgress}%` }}
                                            />
                                        </div>
                                        <div className="flex items-center justify-between text-[11px] text-slate-500 font-medium">
                                            <span>正在下载最新安装包文件...</span>
                                            <span className="font-mono font-black text-slate-700">{downloadProgress}%</span>
                                        </div>
                                    </div>
                                )}

                                {downloadStatus === 'verifying' && (
                                    <div className="space-y-1.5 animate-in fade-in duration-150">
                                        <div className="w-full h-3 bg-[#E9F2FA] rounded-full overflow-hidden border border-[#BCD7F2] p-0.5">
                                            <div
                                                className="h-full bg-gradient-to-r from-[#95D151] to-[#689F38] rounded-full w-full animate-pulse"
                                            />
                                        </div>
                                        <div className="flex items-center gap-1.5 text-[11px] text-amber-700 font-black">
                                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                            <span>正在校验文件... (MD5一致性校验)</span>
                                        </div>
                                    </div>
                                )}

                                {/* Status: Ready - Download completed and prepared for restart */}
                                {downloadStatus === 'ready' && (
                                    <div className="p-3 bg-[#F0FDF4] border border-[#86EFAC] rounded-xl flex items-center justify-between gap-2 text-xs font-black text-[#15803D] animate-in fade-in duration-150">
                                        <div className="flex items-center gap-2">
                                            <CheckCircle2 className="w-4 h-4 text-[#22C55E] shrink-0" />
                                            <span>下载完成！即将自动重启安装更新</span>
                                        </div>
                                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#DCFCE7] text-[#166534] border border-[#86EFAC]">
                      无需重复下载
                    </span>
                                    </div>
                                )}

                                {/* Local Error status: Displays neatly inline */}
                                {downloadStatus === 'error' && (
                                    <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl space-y-1 text-xs">
                                        <div className="flex items-center gap-1.5 text-rose-700 font-black">
                                            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                                            <span>更新失败</span>
                                        </div>
                                        <p className="text-[11px] text-rose-600 font-medium leading-relaxed">
                                            {downloadError || '未能完成下载，请重试或通过上方发布渠道手动下载'}
                                        </p>
                                    </div>
                                )}

                                {/* Action Trigger Button: Visible when idle or error */}
                                {(downloadStatus === 'idle' || downloadStatus === 'error') && (
                                    <button
                                        type="button"
                                        onClick={handleStartDownload}
                                        disabled={isStartingDownload}
                                        className="w-full py-2.5 px-4 bg-gradient-to-r from-[#7ABCF4] to-[#5DA8E8] hover:from-[#68AEEB] hover:to-[#4A9CE3] text-white rounded-xl text-xs font-black flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer disabled:opacity-50"
                                    >
                                        {isStartingDownload ? (
                                            <>
                                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                <span>正在发起更新...</span>
                                            </>
                                        ) : (
                                            <>
                                                <Download className="w-3.5 h-3.5 stroke-[2.5]" />
                                                <span>{downloadStatus === 'error' ? '重新下载更新' : '一键自动下载并更新'}</span>
                                            </>
                                        )}
                                    </button>
                                )}
                            </div>
                        </div>
                    ) : hasChecked ? (
                        <div className="py-8 flex flex-col items-center justify-center text-center gap-2">
                            <div className="w-12 h-12 rounded-2xl bg-[#E1F7DB] text-[#2D6613] flex items-center justify-center border-2 border-[#95D151] mb-1">
                                <CheckCircle2 className="w-6 h-6" />
                            </div>
                            <h4 className="text-sm font-black text-slate-800">当前已是最新版本</h4>
                            <p className="text-xs text-slate-500 max-w-xs">
                                您的助手已经搭载最新的识别算法与图鉴库，暂无更新。
                            </p>
                        </div>
                    ) : null}
                </div>

                {/* Footer */}
                <div className="px-5 py-3 bg-[#F0F6FC] border-t border-[#D5E3F0] flex items-center justify-between">
                    <button
                        type="button"
                        onClick={() => fetchUpdate(true)}
                        disabled={isLoading || isRefreshing || isDownloadingOrVerifying}
                        className="flex items-center gap-1.5 text-xs text-[#2B78C4] hover:text-[#1E5B99] font-black cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                        title={isDownloadingOrVerifying ? '正在下载更新中，不可重新检测' : '重新检测是否有新版本'}
                    >
                        <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing || isLoading ? 'animate-spin' : ''}`} />
                        <span>{isDownloadingOrVerifying ? '正在更新中...' : '重新检测'}</span>
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

                {/* Ready Modal Dialog Alert */}
                {showReadyDialog && (
                    <div className="absolute inset-0 z-20 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200">
                        <div className="bg-white rounded-2xl border-2 border-[#22C55E] p-5 max-w-xs w-full shadow-2xl text-center space-y-3">
                            <div className="w-12 h-12 rounded-full bg-[#E1F7DB] text-[#2D6613] flex items-center justify-center mx-auto border border-[#95D151]">
                                <Check className="w-6 h-6 stroke-[3]" />
                            </div>
                            <div>
                                <h4 className="text-sm font-black text-slate-800">下载完成！</h4>
                                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                                    即将自动重启安装更新，请稍候...
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    sound.playClick();
                                    setShowReadyDialog(false);
                                }}
                                className="w-full py-2 bg-[#22C55E] hover:bg-[#16A34A] text-white text-xs font-black rounded-xl transition-colors cursor-pointer"
                            >
                                我知道了
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
