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
  }, []);

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

  const hasUpdate = !!checkResult?.has_update;
  const finished = !downloading && status && (status.state === 'done' || status.state === 'error');

  return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
        <div
            className="relative w-full max-w-md bg-white rounded-3xl border-4 border-[#7ABCF4] shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
            onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-5 py-4 bg-[#7ABCF4] text-white flex items-center justify-between border-b-2 border-[#5DA8E8]">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-white/20 border border-white/40 flex items-center justify-center">
                <Database className="w-4 h-4 text-white" />
              </div>
              <div>
                <h3 className="text-base font-black tracking-tight">图鉴数据更新</h3>
                <p className="text-[11px] text-white/80 font-medium">检测并下载最新图鉴数据库与地图数据</p>
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
                <div className="py-10 flex flex-col items-center justify-center gap-3 text-slate-500">
                  <RefreshCw className="w-8 h-8 animate-spin text-[#2B78C4]" />
                  <p className="text-xs font-black">正在检测图鉴数据...</p>
                </div>
            ) : !hasUpdate ? (
                <div className="py-10 flex flex-col items-center justify-center text-center gap-2">
                  <div className="w-12 h-12 rounded-2xl bg-[#E1F7DB] text-[#2D6613] flex items-center justify-center border-2 border-[#95D151]">
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                  <h4 className="text-sm font-black text-slate-800">数据已是最新</h4>
                  <p className="text-xs text-slate-500">{checkResult?.message || '无需更新图鉴数据'}</p>
                </div>
            ) : (
                <>
                  {/* 待更新文件列表 */}
                  <div className="space-y-2">
                    <div className="text-xs font-black text-slate-700">
                      发现 {checkResult?.updates.length || 0} 个文件需要更新
                    </div>
                    {checkResult?.updates.map((file) => (
                        <div
                            key={file.name}
                            className="flex items-center justify-between gap-2 rounded-xl bg-[#F5F9FF] border border-[#E6EEF8] px-3 py-2"
                        >
                          <span className="text-xs font-bold text-slate-700 truncate" title={file.name}>
                            {file.name}
                          </span>
                          <span className="text-[10px] font-mono text-slate-400 shrink-0">
                            {formatSize(file.size)}
                          </span>
                        </div>
                    ))}
                  </div>

                  {/* 下载进度 */}
                  {downloading && status && (
                      <div className="space-y-2">
                        {status.files.map((file, index) => {
                          const fileState = file.status || 'pending';
                          const percent = file.progress ?? 0;
                          return (
                              <div key={`${file.name}-${index}`} className="space-y-1">
                                <div className="flex items-center justify-between text-[11px]">
                                  <span className="font-bold text-slate-700 truncate">{file.name}</span>
                                  <span className="font-mono text-slate-500 shrink-0 ml-2">
                                    {fileState === 'done' ? '完成' : fileState === 'error' ? '失败' : `${percent}%`}
                                  </span>
                                </div>
                                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                  <div
                                      className={`h-full rounded-full transition-all duration-300 ${
                                          fileState === 'error'
                                              ? 'bg-rose-500'
                                              : fileState === 'done'
                                                  ? 'bg-[#34C759]'
                                                  : 'bg-gradient-to-r from-[#7ABCF4] to-[#2B78C4]'
                                      }`}
                                      style={{ width: `${fileState === 'done' ? 100 : percent}%` }}
                                  />
                                </div>
                                {file.error && (
                                    <p className="text-[10px] text-rose-500 font-bold">{file.error}</p>
                                )}
                              </div>
                          );
                        })}
                      </div>
                  )}

                  {/* 完成/错误提示 */}
                  {finished && status && (
                      <div
                          className={`rounded-xl px-3 py-2.5 text-xs font-black flex items-center gap-2 ${
                              status.state === 'done'
                                  ? 'bg-[#E1F7DB] text-[#2D6613] border border-[#95D151]'
                                  : 'bg-rose-50 text-rose-700 border border-rose-200'
                          }`}
                      >
                        {status.state === 'done' ? (
                            <CheckCircle2 className="w-4 h-4 shrink-0" />
                        ) : (
                            <AlertCircle className="w-4 h-4 shrink-0" />
                        )}
                        {status.message || (status.state === 'done' ? '更新完成' : '更新失败')}
                      </div>
                  )}
                </>
            )}
          </div>

          {/* Footer */}
          <div className="px-5 py-3 bg-slate-50/80 border-t border-slate-100 flex items-center justify-between gap-2">
            {!hasUpdate || checking ? (
                <button
                    type="button"
                    onClick={() => {
                      sound.playClick();
                      onClose();
                    }}
                    className="px-4 py-2 rounded-xl bg-[#7ABCF4] hover:bg-[#5DA8E8] text-white font-black text-xs transition-colors cursor-pointer"
                >
                  关闭
                </button>
            ) : finished ? (
                <button
                    type="button"
                    onClick={() => {
                      sound.playClick();
                      onClose();
                    }}
                    className="px-4 py-2 rounded-xl bg-[#7ABCF4] hover:bg-[#5DA8E8] text-white font-black text-xs transition-colors cursor-pointer"
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
                      className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 font-black text-xs transition-colors cursor-pointer disabled:opacity-50"
                  >
                    取消
                  </button>
                  <button
                      type="button"
                      onClick={handleStartDownload}
                      disabled={downloading}
                      className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#7ABCF4] to-[#5DA8E8] text-white font-black text-xs flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
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

