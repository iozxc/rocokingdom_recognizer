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
    ArrowDownCircle,
    Check,
    Loader2,
    Pause,
    Play,
    Trash2,
    Activity,
    HardDrive,
    Globe,
} from 'lucide-react';
import { sound } from '../services/sound';
import { useUpdateStore } from '../services/useUpdateStore';
import { updateStore } from '../services/updateStore';
import { api } from '../services/api';
import { IS_STATIC } from '../services/staticMode';

interface UpdateModalProps {
    isOpen: boolean;
    onClose: () => void;
}

// 开源项目源码/仓库地址：始终可查看，不依赖是否检测到更新
const SOURCE_LINKS: Array<{ name: string; url: string }> = [
    { name: 'Gitee 源码仓库', url: 'https://gitee.com/iozxc/rocokingdom_recognizer' },
    { name: 'GitHub 镜像仓库', url: 'https://github.com/iozxc/rocokingdom_recognizer' },
];

// 格式化字节大小 (B, KB, MB, GB)，保留 1 位小数
export const formatBytes = (bytes?: number): string => {
    if (typeof bytes !== 'number' || isNaN(bytes) || bytes <= 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    if (i === 0) return `${Math.round(bytes)} B`;
    const val = (bytes / Math.pow(k, i)).toFixed(1);
    return `${val} ${sizes[i]}`;
};

// 格式化下载速度 (B/s, KB/s, MB/s)，保留 1 位小数
export const formatSpeed = (speedBps?: number): string => {
    if (typeof speedBps !== 'number' || isNaN(speedBps) || speedBps <= 0) return '0.0 KB/s';
    if (speedBps < 1024) {
        return `${Number(speedBps).toFixed(1)} B/s`;
    }
    if (speedBps < 1024 * 1024) {
        return `${(speedBps / 1024).toFixed(1)} KB/s`;
    }
    return `${(speedBps / (1024 * 1024)).toFixed(1)} MB/s`;
};

// 格式化预估/剩余时长
export const formatDuration = (seconds?: number): string => {
    if (typeof seconds !== 'number' || !isFinite(seconds) || seconds < 0) return '—';
    if (seconds < 1) return '1 秒';
    if (seconds < 60) return `${Math.ceil(seconds)} 秒`;
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return s > 0 ? `${m} 分 ${s} 秒` : `${m} 分钟`;
};

// 计算百分比 0 - 100
export const calcPercentage = (downloaded: number, total?: number): number => {
    if (total && total > 0) {
        return Math.max(0, Math.min(100, Math.round((downloaded / total) * 100)));
    }
    // 容错处理：若后端只传了 0-100 的数值而未传 total_bytes
    if (downloaded <= 100 && downloaded >= 0) {
        return Math.round(downloaded);
    }
    return 0;
};

export const UpdateModal: React.FC<UpdateModalProps> = ({ isOpen, onClose }) => {
    const updateState = useUpdateStore();
    const [hasChecked, setHasChecked] = useState<boolean>(false);
    const [isActionLoading, setIsActionLoading] = useState<boolean>(false);
    const [isInstalling, setIsInstalling] = useState<boolean>(false);
    const [installSuccessMessage, setInstallSuccessMessage] = useState<string | null>(null);
    const [webPath, setWebPath] = useState<string>('https://roco.omisheep.cn/');

    const updateData = updateState.updateData;
    const downloadStatus = updateState.downloadStatus;
    const downloadProgress = updateState.progress;
    const totalBytes = updateState.totalBytes;
    const speedBps = updateState.speedBps;
    const downloadError = updateState.error ?? null;
    const errorMsg = updateState.checkError ?? null;
    const isLoading = updateState.checking;
    const measuredSpeedBps = updateState.measuredSpeedBps;
    const speedTesting = updateState.speedTesting;
    const speedTestSeconds = updateState.speedTestSeconds;

    // 包大小与预估/剩余时间
    const packageSize = updateStore.getPackageSize();
    const pkgSizeText = packageSize
        ? `${packageSize.isDelta ? '增量更新包' : '完整安装包'} 约 ${formatBytes(packageSize.bytes)}`
        : null;
    const etaText = (() => {
        if (downloadStatus === 'downloading' && speedBps && speedBps > 0 && totalBytes) {
            const remaining = totalBytes - downloadProgress;
            return `剩余约 ${formatDuration(remaining / speedBps)}`;
        }
        if (packageSize) {
            if (measuredSpeedBps && measuredSpeedBps > 0) {
                return `实测预计约 ${formatDuration(packageSize.bytes / measuredSpeedBps)}`;
            }
            return `预计约 ${formatDuration(packageSize.bytes / updateStore.getEstimateBps())}`;
        }
        return null;
    })();

    // Helper to format status display label
    const getStatusText = (status: string, percentage: number, speed?: number) => {
        if (status === 'downloading') {
            const speedText = speed && speed > 0 ? ` · ${formatSpeed(speed)}` : '';
            return `正在下载分包文件 (${percentage}%)${speedText}`;
        }
        if (status === 'stopped') {
            return `下载已暂停 (已完成 ${percentage}%)`;
        }
        if (status === 'merging') {
            return '所有分包已下载完成，正在合并解压分包...';
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
        setHasChecked(true);
        await updateStore.checkUpdate();
        await updateStore.refreshProgressNow();
    };

    // 1. 开始更新 / 继续下载
    const handleStartDownload = async () => {
        if (!updateData?.has_update) return;

        sound.playClick();
        setIsActionLoading(true);
        await updateStore.startDownload();
        setIsActionLoading(false);
    };

    // 2. 暂停下载
    const handleStopDownload = async () => {
        sound.playClick();
        setIsActionLoading(true);
        await updateStore.stopDownload();
        setIsActionLoading(false);
    };

    // 3. 删除下载
    const handleDeleteDownload = async () => {
        sound.playClick();
        setIsActionLoading(true);
        await updateStore.deleteDownload();
        setIsActionLoading(false);
    };

    // 4. 确认安装
    const handleInstallUpdate = async () => {
        sound.playClick();
        setIsInstalling(true);
        setIsActionLoading(true);
        try {
            const res = await updateStore.installUpdate();
            if (res.data.status === 'error') {
                updateStore.markDownloadError(res.data.message || '安装更新失败，请稍后重试');
            } else {
                setInstallSuccessMessage('安装程序已启动！应用正在准备执行更新...');
            }
        } catch (err: unknown) {
            setInstallSuccessMessage('安装程序已唤起，请根据屏幕提示完成安装。');
        } finally {
            setIsActionLoading(false);
            setIsInstalling(false);
        }
    };

    useEffect(() => {
        if (isOpen) {
            fetchUpdate();
            // 在桌面端 App 下加载 resources/chat.json 中的 web_path 网页版链接
            if (!IS_STATIC) {
                api.getChatConfig().then((cfg) => {
                    if (cfg?.web_path && typeof cfg.web_path === 'string') {
                        setWebPath(cfg.web_path);
                    }
                }).catch(() => {});
            }
        } else {
            setHasChecked(false);
            setIsInstalling(false);
            setInstallSuccessMessage(null);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const percentage = calcPercentage(downloadProgress, totalBytes);
    const isBusyProcessing =
        downloadStatus === 'downloading' ||
        downloadStatus === 'merging' ||
        downloadStatus.startsWith('verifying');

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
            onClick={onClose}
            onWheel={(e) => e.stopPropagation()}
        >
            <div
                className="bg-white rounded-3xl border-4 border-[#5DA8E8] shadow-2xl max-w-lg w-full overflow-hidden flex flex-col relative"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="bg-[#7ABCF4] px-5 py-4 text-white flex items-center justify-between border-b-2 border-[#5DA8E8]">
                    <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-xl bg-white/20 border border-white/40 flex items-center justify-center shadow-xs">
                            <ArrowDownCircle className="w-4 h-4 text-[#FEE061]" />
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
                                    className="mt-2 px-3 py-1 bg-rose-600 text-white font-bold rounded-lg hover:bg-rose-700 transition-colors cursor-pointer"
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
                                            <span className="text-[11px] font-medium text-slate-500">
                                                当前 v{updateData.current_version || '未知'}
                                            </span>
                                            {(updateData.delta?.url || (updateData.deltas?.length ?? 0) > 0) && (
                                                <span className="text-[11px] font-black px-1.5 py-0.5 rounded-md bg-[#E1F0FE] text-[#1E5B99] border border-[#BCD7F2]">
                                                    增量更新
                                                </span>
                                            )}
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

                                    <div className="flex items-center gap-2 text-xs font-black">
                                        {downloadStatus === 'downloading' && (
                                            <div className="flex items-center gap-2">
                                                {typeof speedBps === 'number' && (
                                                    <span className="flex items-center gap-1 text-[11px] font-mono text-[#1E5B99] bg-[#E1F0FE] px-2 py-0.5 rounded-md border border-[#BCD7F2]">
                            <Activity className="w-3 h-3 text-[#2B78C4]" />
                                                        {formatSpeed(speedBps)}
                          </span>
                                                )}
                                                <span className="font-mono text-[#2B78C4]">{percentage}%</span>
                                            </div>
                                        )}
                                        {downloadStatus === 'stopped' && (
                                            <span className="text-amber-600 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200">
                        已暂停 ({percentage}%)
                      </span>
                                        )}
                                        {downloadStatus.startsWith('verifying') && (
                                            <span className="text-amber-600 animate-pulse">MD5 校验中</span>
                                        )}
                                        {downloadStatus === 'merging' && (
                                            <span className="text-indigo-600 animate-pulse">合并解压中</span>
                                        )}
                                        {downloadStatus === 'ready' && (
                                            <span className="text-[#22C55E] bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                        准备安装
                      </span>
                                        )}
                                    </div>
                                </div>

                                {/* 包大小与预估时间 */}
                                {(pkgSizeText || etaText) && (
                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500 font-medium bg-[#F8FAFC] border border-slate-200 rounded-lg px-2.5 py-1.5">
                                        {pkgSizeText && <span className="text-slate-700 font-semibold">{pkgSizeText}</span>}
                                        {etaText && <span>· {etaText}</span>}
                                        {measuredSpeedBps && (
                                            <span className="text-emerald-600 font-semibold">· 实测 {formatSpeed(measuredSpeedBps)}</span>
                                        )}
                                        {speedTestSeconds && (
                                            <span className="text-slate-400">· 测速用时 {speedTestSeconds.toFixed(1)} 秒</span>
                                        )}
                                        <button
                                            type="button"
                                            id="update-speed-test-btn"
                                            onClick={() => updateStore.runSpeedTest()}
                                            disabled={
                                                speedTesting ||
                                                downloadStatus === 'downloading' ||
                                                downloadStatus === 'merging' ||
                                                downloadStatus.startsWith('verifying')
                                            }
                                            className="ml-auto text-[11px] font-bold text-[#2B78C4] hover:text-[#1E5B99] bg-[#E1F0FE] border border-[#BCD7F2] rounded-md px-2 py-0.5 cursor-pointer disabled:opacity-50 transition-colors"
                                        >
                                            {speedTesting ? '测速中…' : measuredSpeedBps ? '重新测速' : '测速'}
                                        </button>
                                    </div>
                                )}

                                {/* Progress bar */}
                                {(downloadStatus === 'downloading' ||
                                    downloadStatus === 'stopped' ||
                                    downloadStatus === 'merging' ||
                                    downloadStatus.startsWith('verifying') ||
                                    downloadStatus === 'ready') && (
                                    <div className="space-y-2 animate-in fade-in duration-150">
                                        <div className="w-full h-3.5 bg-[#E9F2FA] rounded-full overflow-hidden border border-[#BCD7F2] p-0.5">
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
                                                            : `${percentage}%`,
                                                }}
                                            />
                                        </div>

                                        {/* Progress details: Status on left, Byte counts and percentage on right */}
                                        <div className="flex items-center justify-between text-[11px] text-slate-600 font-medium">
                      <span className="flex items-center gap-1.5 truncate max-w-[55%]">
                        {isBusyProcessing && <Loader2 className="w-3 h-3 animate-spin text-[#2B78C4] shrink-0" />}
                          <span className="truncate">{getStatusText(downloadStatus, percentage, speedBps)}</span>
                      </span>

                                            <div className="flex items-center gap-1.5 font-mono shrink-0">
                                                <HardDrive className="w-3 h-3 text-slate-400" />
                                                {totalBytes ? (
                                                    <span className="font-bold text-slate-700">
                            {formatBytes(downloadProgress)} / {formatBytes(totalBytes)} ({percentage}%)
                          </span>
                                                ) : (
                                                    <span className="font-bold text-slate-700">
                            {downloadProgress > 100 ? formatBytes(downloadProgress) : `${percentage}%`}
                          </span>
                                                )}
                                            </div>
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
                            <h4 className="text-sm font-black text-slate-800">
                                当前已是最新版本 {updateData.current_version ? `v${updateData.current_version}` : ''}
                            </h4>
                            <p className="text-xs text-slate-500 max-w-xs">
                                您的助手已经搭载最新的识别算法与图鉴库，暂无更新。
                            </p>
                        </div>
                    ) : null}

                    {/* 网页版与源码链接：始终可见，不依赖是否检测到更新 */}
                    <div className="pt-3 border-t border-slate-100 space-y-2.5">
                        {/* 网页版入口（仅 App 桌面端展示） */}
                        {!IS_STATIC && webPath && (
                            <div>
                                <span className="text-xs font-black text-slate-700 flex items-center gap-1 mb-1.5">
                                    <Globe className="w-3.5 h-3.5 text-[#2B78C4]" />
                                    网页在线版
                                </span>
                                <a
                                    href={webPath}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="p-3 bg-gradient-to-r from-[#EBF4FE] to-[#F5F9FF] hover:from-[#DFEEFD] hover:to-[#EBF4FE] border-2 border-[#BCD7F2] hover:border-[#7ABCF4] rounded-2xl flex items-center justify-between text-xs font-black text-[#1E5B99] transition-all group shadow-2xs cursor-pointer"
                                >
                                    <div className="flex items-center gap-2.5 min-w-0">
                                        <div className="w-7 h-7 rounded-xl bg-[#7ABCF4] text-white flex items-center justify-center shrink-0 shadow-xs">
                                            <Globe className="w-4 h-4" />
                                        </div>
                                        <div className="min-w-0">
                                            <div className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                                                <span>洛克王国徽章试炼图鉴·网页版</span>
                                                <span className="text-[10px] text-emerald-600 bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-200 font-bold">免安装·多端通用</span>
                                            </div>
                                            <p className="text-[11px] text-slate-500 font-normal truncate mt-0.5">{webPath}</p>
                                        </div>
                                    </div>
                                    <ExternalLink className="w-3.5 h-3.5 text-slate-400 group-hover:text-[#2B78C4] shrink-0 ml-2" />
                                </a>
                            </div>
                        )}

                        <span className="text-xs font-black text-slate-700 flex items-center gap-1">
                            <ExternalLink className="w-3.5 h-3.5 text-[#2B78C4]" />
                            开源项目地址
                        </span>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            {SOURCE_LINKS.map((item) => (
                                <a
                                    key={item.name}
                                    href={item.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="p-3 bg-[#F0F6FC] hover:bg-[#E1F0FE] border-2 border-[#BCD7F2] hover:border-[#7ABCF4] rounded-2xl flex items-center justify-between text-xs font-black text-[#1E5B99] transition-all group shadow-2xs cursor-pointer"
                                >
                                    <div className="flex items-center gap-2">
                                        <ExternalLink className="w-4 h-4 text-[#2B78C4]" />
                                        <span>{item.name}</span>
                                    </div>
                                    <ExternalLink className="w-3.5 h-3.5 text-slate-400 group-hover:text-[#2B78C4]" />
                                </a>
                            ))}
                        </div>
                    </div>
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
