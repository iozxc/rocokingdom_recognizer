import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, Download, RefreshCw, CheckCircle2, AlertCircle, Database } from 'lucide-react';
import { api } from '../services/api';
import { sound } from '../services/sound';
import { DataUpdateCheckData, DataUpdateStatusData } from '../types';

interface DataUpdateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpdated?: () => void;
}

const formatSize = (bytes?: number): string => {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

export const DataUpdateModal: React.FC<DataUpdateModalProps> = ({
                                                                   isOpen,
                                                                   onClose,
                                                                   onUpdated,
                                                               }) => {
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<DataUpdateCheckData | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [status, setStatus] = useState<DataUpdateStatusData | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const runCheck = useCallback(async () => {
    setChecking(true);
    setCheckResult(null);
    setStatus(null);
    setDownloading(false);
    const result = await api.checkDataUpdates();
    setCheckResult(result);
    setChecking(false);
  }, [onClose]);

  useEffect(() => {
    if (isOpen) {
      runCheck();
    } else {
      stopPolling();
    }
    return stopPolling;
  }, [isOpen, runCheck, stopPolling]);

  const handleStartDownload = async () => {
    sound.playClick();
    setDownloading(true);
    const initial = await api.startDataUpdate();
    setStatus(initial);

    stopPolling();
    pollTimer.current = setInterval(async () => {
      const next = await api.getDataUpdateStatus();
      setStatus(next);
      if (next.state === 'done' || next.state === 'error') {
        stopPolling();
        setDownloading(false);
        if (next.state === 'done') {
          onUpdated?.();
        }
      }
    }, 800);
  };

  const updateCount = checkResult?.updates?.length || 0;
  const totalSize = (checkResult?.updates || []).reduce((sum, file) => sum + (file.size || 0), 0);
  const overallProgress = (() => {
    if (!status?.files?.length) return 0;
    const sum = status.files.reduce((acc, file) => {
      return acc + (file.status === 'done' ? 100 : file.progress || 0);
    }, 0);
    return Math.round(sum / status.files.length);
  })();
  const finished = !downloading && status && (status.state === 'done' || status.state === 'error');
  const failedFiles = (status?.files || []).filter((f) => f.status === 'error');
  // 检测阶段连不上更新服务器（后端返回“未获取到远程数据清单”/API 返回“检查失败”），不能当成“已是最新”。
  const checkFailed = !!checkResult && !checkResult.has_update &&
      ((checkResult.message || '') === '检查失败' || (checkResult.message || '').includes('未获取'));

  if (!isOpen) return null;

  return (
      <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
          onWheel={(e) => e.stopPropagation()}
          onClick={onClose}
      >
        <div
            className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl border-4 border-[#7ABCF4] dark:border-slate-700 shadow-2xl overflow-hidden flex flex-col transition-colors"
            onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-5 py-4 bg-[#7ABCF4] dark:bg-slate-800 text-white flex items-center justify-between border-b-2 border-[#5DA8E8] dark:border-slate-700">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-white/20 border border-white/40 flex items-center justify-center">
                <Database className="w-4 h-4 text-white" />
              </div>
              <div>
                <h3 className="text-base font-black tracking-tight">图鉴数据更新</h3>
                <p className="text-[11px] text-white/80 dark:text-slate-300 font-medium">下载最新图鉴数据库与地图数据</p>
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

          {/* Body */}
          <div className="p-5 space-y-4 overflow-y-auto">
            {checking ? (
                <div className="py-10 flex flex-col items-center justify-center gap-3 text-slate-500 dark:text-slate-400">
                  <RefreshCw className="w-8 h-8 animate-spin text-[#2B78C4] dark:text-sky-400" />
                  <p className="text-xs font-black">正在检测图鉴数据...</p>
                </div>
            ) : (
                checkResult && checkFailed ? (
                    <div className="py-8 flex flex-col items-center justify-center text-center gap-2">
                      <div className="w-12 h-12 rounded-2xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 flex items-center justify-center border-2 border-rose-200 dark:border-rose-800">
                        <AlertCircle className="w-6 h-6" />
                      </div>
                      <h4 className="text-sm font-black text-slate-800 dark:text-slate-100">暂时读不到更新清单</h4>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {checkResult.message || '无法连接更新服务器，请检查网络'}，稍后重试
                      </p>
                      <button
                          type="button"
                          onClick={() => {
                            sound.playClick();
                            runCheck();
                          }}
                          className="mt-1 px-4 py-2 rounded-xl bg-[#7ABCF4] dark:bg-sky-600 hover:bg-[#5DA8E8] dark:hover:bg-sky-500 text-white font-black text-xs flex items-center gap-1.5 cursor-pointer transition-colors"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        重新检测
                      </button>
                    </div>
                ) : checkResult && !checkResult.has_update ? (
                    <div className="py-10 flex flex-col items-center justify-center text-center gap-2">
                      <div className="w-12 h-12 rounded-2xl bg-[#E1F7DB] dark:bg-emerald-950/60 text-[#2D6613] dark:text-emerald-300 flex items-center justify-center border-2 border-[#95D151] dark:border-emerald-600">
                        <CheckCircle2 className="w-6 h-6" />
                      </div>
                      <h4 className="text-sm font-black text-slate-800 dark:text-slate-100">图鉴已是最新</h4>
                      <p className="text-xs text-slate-500 dark:text-slate-400">无需更新图鉴数据</p>
                    </div>
                ) : (
                    <>
                      {/* 更新摘要：只展示数量与总大小 */}
                      <div className="rounded-xl bg-[#F5F9FF] dark:bg-slate-800/80 border border-[#E6EEF8] dark:border-slate-700 p-4 text-center">
                        <div className="text-sm font-black text-slate-800 dark:text-slate-100">
                          发现 {updateCount} 个文件需要更新
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                          下载大小约 {formatSize(totalSize)}
                        </div>
                      </div>

                      {/* 下载整体进度 */}
                      {downloading && status && (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-black text-slate-700 dark:text-slate-200">下载进度</span>
                              <span className="font-mono text-slate-500 dark:text-slate-400">{overallProgress}%</span>
                            </div>
                            <div className="h-3 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                              <div
                                  className="h-full rounded-full bg-gradient-to-r from-[#7ABCF4] to-[#2B78C4] dark:from-sky-400 dark:to-blue-600 transition-all duration-300"
                                  style={{ width: `${overallProgress}%` }}
                              />
                            </div>
                            <p className="text-[11px] text-slate-400 dark:text-slate-500">{status.message || '正在下载...'}</p>
                          </div>
                      )}

                      {/* 完成/错误提示 */}
                      {finished && status && (
                          <div className="space-y-2">
                            <div
                                className={`rounded-xl px-3 py-2.5 text-xs font-black flex items-center gap-2 ${
                                    status.state === 'done'
                                        ? 'bg-[#E1F7DB] dark:bg-emerald-950/60 text-[#2D6613] dark:text-emerald-300 border border-[#95D151] dark:border-emerald-700'
                                        : 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
                                }`}
                            >
                              {status.state === 'done' ? (
                                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                              ) : (
                                  <AlertCircle className="w-4 h-4 shrink-0" />
                              )}
                              {status.message || (status.state === 'done' ? '更新完成' : '更新失败')}
                            </div>

                            {status.state === 'error' && failedFiles.length > 0 && (
                                <div className="rounded-xl bg-rose-50/60 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 p-3 space-y-1.5">
                                  <p className="text-[11px] font-black text-rose-800 dark:text-rose-200">
                                    更新失败的 {failedFiles.length} 个文件：
                                  </p>
                                  {failedFiles.map((f, idx) => (
                                      <div key={idx} className="text-[11px] text-rose-700 dark:text-rose-300 leading-snug">
                                        <span className="block font-bold truncate">• {f.name}</span>
                                        <span className="block text-rose-500/90 dark:text-rose-400 truncate">{f.error || '下载失败，请重试'}</span>
                                      </div>
                                  ))}
                                  <p className="text-[11px] text-rose-600 dark:text-rose-400 pt-0.5">
                                    可点击下方“重试”再次下载失败的文件，或稍后网络恢复后再试。
                                  </p>
                                </div>
                            )}
                          </div>
                      )}
                    </>
                )
            )}
          </div>

          {/* Footer */}
          <div className="px-5 py-3 bg-slate-50/80 dark:bg-slate-800/80 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
            {checking || checkFailed || (checkResult && !checkResult.has_update) ? (
                <button
                    type="button"
                    onClick={() => {
                      sound.playClick();
                      onClose();
                    }}
                    className="px-4 py-2 rounded-xl bg-[#7ABCF4] dark:bg-sky-600 hover:bg-[#5DA8E8] dark:hover:bg-sky-500 text-white font-black text-xs transition-colors cursor-pointer"
                >
                  关闭
                </button>
            ) : finished && status && status.state === 'error' ? (
                <>
                  <button
                      type="button"
                      onClick={() => {
                        sound.playClick();
                        onClose();
                      }}
                      className="px-4 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 font-black text-xs transition-colors cursor-pointer"
                  >
                    关闭
                  </button>
                  <button
                      type="button"
                      onClick={handleStartDownload}
                      disabled={downloading}
                      className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#7ABCF4] to-[#5DA8E8] dark:from-sky-500 dark:to-blue-600 text-white font-black text-xs flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    重试
                  </button>
                </>
            ) : finished ? (
                <button
                    type="button"
                    onClick={() => {
                      sound.playClick();
                      onClose();
                    }}
                    className="px-4 py-2 rounded-xl bg-[#7ABCF4] dark:bg-sky-600 hover:bg-[#5DA8E8] dark:hover:bg-sky-500 text-white font-black text-xs transition-colors cursor-pointer"
                >
                  完成
                </button>
            ) : (
                <>
                  <button
                      type="button"
                      onClick={() => {
                        sound.playClick();
                        onClose();
                      }}
                      disabled={downloading}
                      className="px-4 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 font-black text-xs transition-colors cursor-pointer disabled:opacity-50"
                  >
                    取消
                  </button>
                  <button
                      type="button"
                      onClick={handleStartDownload}
                      disabled={downloading}
                      className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#7ABCF4] to-[#5DA8E8] dark:from-sky-500 dark:to-blue-600 text-white font-black text-xs flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
                  >
                    {downloading ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          正在下载...
                        </>
                    ) : (
                        <>
                          <Download className="w-3.5 h-3.5" />
                          开始下载
                        </>
                    )}
                  </button>
                </>
            )}
          </div>
        </div>
      </div>
  );
};
