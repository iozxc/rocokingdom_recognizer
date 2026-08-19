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
    Pause,
    Play,
    Trash2,
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
    const [hasChecked, setHasChecked] = useState<boolean>(false);
    const [updateData, setUpdateData] = useState<CheckUpdateResponse | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    // Auto Download & Update State: Fully driven by server API
    const [downloadStatus, setDownloadStatus] = useState<DownloadStatus>('idle');
    const [downloadProgress, setDownloadProgress] = useState<number>(0);
    const [downloadError, setDownloadError] = useState<string | null>(null);
    const [isActionLoading, setIsActionLoading] = useState<boolean>(false);
    const [isInstalling, setIsInstalling] = useState<boolean>(false);
    const [installSuccessMessage, setInstallSuccessMessage] = useState<string | null>(null);

    const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

    const stopPolling = () => {
        if (pollTimerRef.current) {
            clearInterval(pollTimerRef.current);
            pollTimerRef.current = null;
        }
    };

    // Helper to format status display label
    const getStatusText = (status: string, progress: number) => {
        if (status === 'downloading') {
            return `正在下载分包文件 (${progress}%)`;
        }
        if (status === 'stopped') {
            return `下载已暂停 (已完成 ${progress}%)`;
        }
        if (status === 'merging') {
            return '所有分包已下载完成，正在合并分包文件...';
        }
        if (status.startsWith('verifying')) {
            const partIndex = status.replace('verifying_', '').replace('verifying', '');
            return partIndex
                ? `正在校验第 ${partIndex} 个分包 MD5...`
                : '正在校验分包文件 MD5 一致性...';
        }
        if (status === 'ready') {
            return '所有分包下载、校验并合并完成！可提交安装';
        }
        if (status === 'install') {
            return '正在启动安装程序...';
        }
        if (status === 'error') {
            return '下载或校验出错';
        }
        return '准备就绪';
    };

    const fetchUpdate = async () => {
        setIsLoading(true);
        setErrorMsg(null);
        try {
            // 1. 优先调用 /api/check_update 获取最新版本和分包配置信息
            const res = await api.checkUpdate();
            setUpdateData(res.data);
            setHasChecked(true);

            // 2. 查询当前真实下载进度状态
            try {
                const progressRes = await api.getDownloadProgress();
                const { progress, status, error } = progressRes.data;

                setDownloadStatus(status || 'idle');
                setDownloadProgress(typeof progress === 'number' ? Math.max(0, Math.min(100, progress)) : 0);

                if (status === 'downloading' || status.startsWith('verifying') || status === 'merging') {
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
                } else if (status === 'stopped' || status === 'idle') {
                    stopPolling();
                }
            } catch (err: unknown) {
                console.warn('Polling download progress failed:', err);
            }
        }, 1000);
    };

    // 1. 开始更新 / 继续下载
    const handleStartDownload = async () => {
        if (!updateData?.has_update) return;

        sound.playClick();
        setIsActionLoading(true);
        setDownloadError(null);
        setDownloadStatus('downloading');

        try {
            const res = await api.startDownload();
            if (res.data.status === 'error') {
                setDownloadStatus('error');
                setDownloadError(res.data.message || '发起更新失败，请稍后再试');
            } else {
                startProgressPolling();
            }
        } catch (err: unknown) {
            const error = err as Error;
            setDownloadStatus('error');
            setDownloadError(error.message || '网络异常，发起更新请求失败');
        } finally {
            setIsActionLoading(false);
        }
    };

    // 2. 暂停下载
    const handleStopDownload = async () => {
        sound.playClick();
        setIsActionLoading(true);
        stopPolling();
        try {
            await api.stopDownload();
            setDownloadStatus('stopped');
        } catch (err: unknown) {
            console.warn('Stop download error:', err);
            setDownloadStatus('stopped');
        } finally {
            setIsActionLoading(false);
        }
    };

    // 3. 删除下载
    const handleDeleteDownload = async () => {
        sound.playClick();
        setIsActionLoading(true);
        stopPolling();
        try {
            await api.deleteDownload();
            setDownloadStatus('idle');
            setDownloadProgress(0);
            setDownloadError(null);
        } catch (err: unknown) {
            console.warn('Delete download error:', err);
            setDownloadStatus('idle');
            setDownloadProgress(0);
        } finally {
            setIsActionLoading(false);
        }
    };

    // 4. 确认安装
    const handleInstallUpdate = async () => {
        sound.playClick();
        setIsInstalling(true);
        setIsActionLoading(true);
        try {
            await api.installUpdate();
            setInstallSuccessMessage('安装程序已启动！应用正在准备执行更新...');
        } catch (err: unknown) {
            const error = err as Error;
            setInstallSuccessMessage('安装程序已唤起，请根据屏幕提示完成安装。');
        } finally {
            setIsActionLoading(false);
        }
    };

    useEffect(() => {
        if (isOpen) {
            fetchUpdate();
        } else {
            stopPolling();
            setHasChecked(false);
            setUpdateData(null);
            setErrorMsg(null);
            setDownloadStatus('idle');
            setDownloadProgress(0);
            setDownloadError(null);
            setIsInstalling(false);
            setInstallSuccessMessage(null);
        }
        return () => {
            stopPolling();
        };
    }, [isOpen]);

    if (!isOpen) return null;

    const isBusyProcessing =
        downloadStatus === 'downloading' ||
        downloadStatus === 'merging' ||
        downloadStatus.startsWith('verifying');

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
                        v{updateData.latest_version || '1.0.0'}
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

                            {/* Mirrors / Manual Download Links */}
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

                            {/* Automatic Download & Update Section */}
                            <div className="p-4 bg-white rounded-2xl border-2 border-[#BCD7F2] space-y-3.5 shadow-xs">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <div className="w-6 h-6 rounded-lg bg-[#7ABCF4] text-white flex items-center justify-center">
                                            <Download className="w-3.5 h-3.5" />
                                        </div>
                                        <span className="text-xs font-black text-slate-800">一键自动下载更新</span>
                                    </div>

                                    <span className="text-xs font-black">
                    {downloadStatus === 'downloading' && (
                        <span className="font-mono text-[#2B78C4]">{downloadProgress}%</span>
                    )}
                                        {downloadStatus === 'stopped' && (
                                            <span className="text-amber-600 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200">已暂停</span>
                                        )}
                                        {downloadStatus.startsWith('verifying') && (
                                            <span className="text-amber-600 animate-pulse">MD5 校验中</span>
                                        )}
                                        {downloadStatus === 'merging' && (
                                            <span className="text-indigo-600 animate-pulse">合并解压中</span>
                                        )}
                                        {downloadStatus === 'ready' && (
                                            <span className="text-[#22C55E] bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">准备安装</span>
                                        )}
                  </span>
                                </div>

                                {/* Progress bar */}
                                {(downloadStatus === 'downloading' ||
                                    downloadStatus === 'stopped' ||
                                    downloadStatus === 'merging' ||
                                    downloadStatus.startsWith('verifying') ||
                                    downloadStatus === 'ready') && (
                                    <div className="space-y-1.5 animate-in fade-in duration-150">
                                        <div className="w-full h-3 bg-[#E9F2FA] rounded-full overflow-hidden border border-[#BCD7F2] p-0.5">
                                            <div
                                                className={`h-full rounded-full transition-all duration-300 ${
                                                    downloadStatus === 'ready'
                                                        ? 'bg-[#22C55E] w-full'
                                                        : downloadStatus === 'stopped'
                                                            ? 'bg-amber-500'
                                                            : downloadStatus.startsWith('verifying') || downloadStatus === 'merging'
                                                                ? 'bg-gradient-to-r from-amber-500 to-indigo-600 w-full animate-pulse'
                                                                : 'bg-gradient-to-r from-[#7ABCF4] to-[#2B78C4]'
                                                }`}
                                                style={{
                                                    width:
                                                        downloadStatus === 'ready' ||
                                                        downloadStatus.startsWith('verifying') ||
                                                        downloadStatus === 'merging'
                                                            ? '100%'
                                                            : `${downloadProgress}%`,
                                                }}
                                            />
                                        </div>
                                        <div className="flex items-center justify-between text-[11px] text-slate-600 font-medium">
                      <span className="flex items-center gap-1.5">
                        {isBusyProcessing && <Loader2 className="w-3 h-3 animate-spin text-[#2B78C4]" />}
                          {getStatusText(downloadStatus, downloadProgress)}
                      </span>
                                            <span className="font-mono font-black text-slate-700">
                        {downloadStatus === 'ready' ? '100%' : `${downloadProgress}%`}
                      </span>
                                        </div>
                                    </div>
                                )}

                                {/* Status: Ready - Download completed and prepared for installation */}
                                {downloadStatus === 'ready' && (
                                    <div className="p-3 bg-[#F0FDF4] border border-[#86EFAC] rounded-xl flex items-center justify-between gap-2 text-xs font-black text-[#15803D] animate-in fade-in duration-150">
                                        <div className="flex items-center gap-2">
                                            <CheckCircle2 className="w-4 h-4 text-[#22C55E] shrink-0" />
                                            <span>所有分包已下载校验完毕！点击下方按钮确认安装</span>
                                        </div>
                                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#DCFCE7] text-[#166534] border border-[#86EFAC]">
                      已就绪
                    </span>
                                    </div>
                                )}

                                {/* Local Error status */}
                                {downloadStatus === 'error' && (
                                    <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl space-y-1 text-xs">
                                        <div className="flex items-center gap-1.5 text-rose-700 font-black">
                                            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                                            <span>更新出错</span>
                                        </div>
                                        <p className="text-[11px] text-rose-600 font-medium leading-relaxed">
                                            {downloadError || '未能完成下载，请重试或通过上方发布渠道手动下载'}
                                        </p>
                                    </div>
                                )}

                                {/* ACTION BUTTON GROUP: Start / Pause / Delete / Confirm Install */}
                                <div className="pt-1">
                                    {/* 1. IDLE STATE: Start Download */}
                                    {downloadStatus === 'idle' && (
                                        <button
                                            type="button"
                                            onClick={handleStartDownload}
                                            disabled={isActionLoading}
                                            className="w-full py-2.5 px-4 bg-gradient-to-r from-[#7ABCF4] to-[#5DA8E8] hover:from-[#68AEEB] hover:to-[#4A9CE3] text-white rounded-xl text-xs font-black flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer disabled:opacity-50"
                                        >
                                            {isActionLoading ? (
                                                <>
                                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                    <span>正在发起下载...</span>
                                                </>
                                            ) : (
                                                <>
                                                    <Download className="w-3.5 h-3.5 stroke-[2.5]" />
                                                    <span>开始更新下载</span>
                                                </>
                                            )}
                                        </button>
                                    )}

                                    {/* 2. DOWNLOADING STATE: Pause & Delete */}
                                    {downloadStatus === 'downloading' && (
                                        <div className="grid grid-cols-2 gap-2.5">
                                            <button
                                                type="button"
                                                onClick={handleStopDownload}
                                                disabled={isActionLoading}
                                                className="py-2.5 px-4 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-black flex items-center justify-center gap-1.5 shadow-sm transition-colors cursor-pointer disabled:opacity-50"
                                            >
                                                <Pause className="w-3.5 h-3.5 fill-current" />
                                                <span>暂停下载</span>
                                            </button>

                                            <button
                                                type="button"
                                                onClick={handleDeleteDownload}
                                                disabled={isActionLoading}
                                                className="py-2.5 px-4 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                                <span>删除下载</span>
                                            </button>
                                        </div>
                                    )}

                                    {/* 3. STOPPED STATE: Resume & Delete */}
                                    {downloadStatus === 'stopped' && (
                                        <div className="grid grid-cols-2 gap-2.5">
                                            <button
                                                type="button"
                                                onClick={handleStartDownload}
                                                disabled={isActionLoading}
                                                className="py-2.5 px-4 bg-[#2B78C4] hover:bg-[#1E5B99] text-white rounded-xl text-xs font-black flex items-center justify-center gap-1.5 shadow-sm transition-colors cursor-pointer disabled:opacity-50"
                                            >
                                                <Play className="w-3.5 h-3.5 fill-current" />
                                                <span>继续下载</span>
                                            </button>

                                            <button
                                                type="button"
                                                onClick={handleDeleteDownload}
                                                disabled={isActionLoading}
                                                className="py-2.5 px-4 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                                <span>删除下载</span>
                                            </button>
                                        </div>
                                    )}

                                    {/* 4. VERIFYING / MERGING STATE: Processing */}
                                    {(downloadStatus.startsWith('verifying') || downloadStatus === 'merging') && (
                                        <div className="py-2.5 px-4 bg-slate-100 text-slate-600 rounded-xl text-xs font-black flex items-center justify-center gap-2">
                                            <Loader2 className="w-4 h-4 animate-spin text-[#2B78C4]" />
                                            <span>正在处理安装包，请稍候...</span>
                                        </div>
                                    )}

                                    {/* 5. READY STATE: Confirm Install & Delete Package */}
                                    {downloadStatus === 'ready' && (
                                        <div className="space-y-2">
                                            <button
                                                type="button"
                                                onClick={handleInstallUpdate}
                                                disabled={isActionLoading || isInstalling}
                                                className="w-full py-3 px-4 bg-gradient-to-r from-[#22C55E] to-[#16A34A] hover:from-[#16A34A] hover:to-[#15803D] text-white rounded-xl text-xs font-black flex items-center justify-center gap-2 shadow-md transition-all cursor-pointer disabled:opacity-50"
                                            >
                                                {isInstalling ? (
                                                    <>
                                                        <Loader2 className="w-4 h-4 animate-spin" />
                                                        <span>正在提交安装指令...</span>
                                                    </>
                                                ) : (
                                                    <>
                                                        <Sparkles className="w-4 h-4" />
                                                        <span>确认安装更新 · 立即重启应用</span>
                                                    </>
                                                )}
                                            </button>

                                            <button
                                                type="button"
                                                onClick={handleDeleteDownload}
                                                disabled={isActionLoading || isInstalling}
                                                className="w-full py-2 px-3 text-slate-500 hover:text-rose-600 text-[11px] font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                                            >
                                                <Trash2 className="w-3 h-3" />
                                                <span>清除已下载文件重新下载</span>
                                            </button>
                                        </div>
                                    )}

                                    {/* 6. ERROR STATE: Retry & Delete */}
                                    {downloadStatus === 'error' && (
                                        <div className="grid grid-cols-2 gap-2.5">
                                            <button
                                                type="button"
                                                onClick={handleStartDownload}
                                                disabled={isActionLoading}
                                                className="py-2.5 px-4 bg-[#7ABCF4] hover:bg-[#5DA8E8] text-white rounded-xl text-xs font-black flex items-center justify-center gap-1.5 shadow-sm transition-colors cursor-pointer disabled:opacity-50"
                                            >
                                                <RefreshCw className="w-3.5 h-3.5" />
                                                <span>重新下载</span>
                                            </button>

                                            <button
                                                type="button"
                                                onClick={handleDeleteDownload}
                                                disabled={isActionLoading}
                                                className="py-2.5 px-4 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                                <span>删除并重置</span>
                                            </button>
                                        </div>
                                    )}
                                </div>
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
                        onClick={fetchUpdate}
                        disabled={isLoading || isBusyProcessing}
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

                {/* Install Triggered Success Alert Modal */}
                {installSuccessMessage && (
                    <div className="absolute inset-0 z-20 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200">
                        <div className="bg-white rounded-2xl border-2 border-[#22C55E] p-5 max-w-xs w-full shadow-2xl text-center space-y-3">
                            <div className="w-12 h-12 rounded-full bg-[#E1F7DB] text-[#2D6613] flex items-center justify-center mx-auto border border-[#95D151]">
                                <Check className="w-6 h-6 stroke-[3]" />
                            </div>
                            <div>
                                <h4 className="text-sm font-black text-slate-800">安装更新已就绪</h4>
                                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                                    {installSuccessMessage}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    sound.playClick();
                                    setInstallSuccessMessage(null);
                                    onClose();
                                }}
                                className="w-full py-2 bg-[#22C55E] hover:bg-[#16A34A] text-white text-xs font-black rounded-xl transition-colors cursor-pointer"
                            >
                                好的
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
