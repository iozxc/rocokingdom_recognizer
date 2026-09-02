import React, { useRef, useState } from 'react';
import { X, Upload, Download, Database, CheckCircle2, AlertTriangle, FileJson, FolderCheck } from 'lucide-react';
import { sound } from '../services/sound';
import { storage } from '../services/storage';
import { IS_STATIC } from '../services/staticMode';

interface DataManageModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DataManageModal: React.FC<DataManageModalProps> = ({ isOpen, onClose }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string>('');
  const [msgType, setMsgType] = useState<'ok' | 'err'>('ok');
  const [isExporting, setIsExporting] = useState<boolean>(false);

  if (!isOpen) return null;

  const handleExport = async () => {
    sound.playClick();
    const data = storage.exportData();
    const defaultFilename = `roco_user_data_${new Date().toISOString().slice(0, 10)}.json`;

    // 桌面端 App 环境：调用 pywebview 原生文件保存对话框让用户自选保存路径
    if (!IS_STATIC && typeof window !== 'undefined' && (window as any).pywebview?.api?.save_export_file) {
      try {
        setIsExporting(true);
        const res = await (window as any).pywebview.api.save_export_file(data, defaultFilename);
        if (res?.status === 'ok') {
          setMessage(`导出成功！文件已保存至：${res.path || defaultFilename}`);
          setMsgType('ok');
          return;
        } else if (res?.status === 'cancelled') {
          setMessage('已取消导出');
          setMsgType('ok');
          return;
        }
      } catch (e: any) {
        console.warn('调用原生保存文件失败，回退到浏览器下载:', e);
      } finally {
        setIsExporting(false);
      }
    }

    // Web 浏览器端或回退方案：直接触发 Blob 文件下载
    const blob = new Blob([data], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = defaultFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setMessage(`已成功导出 ${defaultFilename}（图鉴点亮记录与设置）`);
    setMsgType('ok');
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    sound.playClick();
    try {
      const text = await file.text();
      const ok = storage.importData(text);
      if (ok) {
        setMessage('导入成功！图鉴点亮记录与设置已更新。');
        setMsgType('ok');
      } else {
        setMessage('导入失败：文件不是有效的 roco_user_data.json。');
        setMsgType('err');
      }
    } catch {
      setMessage('导入失败：无法读取该文件。');
      setMsgType('err');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
      <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
          onClick={onClose}
      >
        <div
            className="bg-white dark:bg-slate-900 rounded-3xl border-4 border-[#5DA8E8] dark:border-slate-700 shadow-2xl max-w-md w-full overflow-hidden flex flex-col transition-colors"
            onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="bg-[#7ABCF4] dark:bg-slate-800 px-5 py-4 text-white flex items-center justify-between border-b-2 border-[#5DA8E8] dark:border-slate-700">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-white/20 border border-white/40 flex items-center justify-center shadow-xs">
                <Database className="w-4 h-4 text-white" />
              </div>
              <div>
                <h3 className="text-base font-black tracking-tight">数据管理</h3>
                <p className="text-[11px] text-white/80 dark:text-slate-300 font-medium">导入 / 导出本地图鉴点亮记录与设置</p>
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
          <div className="p-5 space-y-4">
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
              数据包含图鉴点亮记录、识别门槛与偏好设置。{IS_STATIC ? '导出将直接下载 JSON 文件。' : '导出时支持自选保存目录与路径。'}
            </p>

            <div className="grid grid-cols-2 gap-3">
              <button
                  type="button"
                  onClick={handleExport}
                  disabled={isExporting}
                  className="flex flex-col items-center gap-2 p-4 rounded-2xl border-2 border-[#D5E3F0] dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-[#EBF4FE] dark:hover:bg-slate-750 hover:border-[#7ABCF4] dark:hover:border-sky-500 transition-colors cursor-pointer disabled:opacity-50"
              >
                <div className="w-11 h-11 rounded-xl bg-[#95D151]/20 dark:bg-emerald-950/60 text-[#689F38] dark:text-emerald-400 flex items-center justify-center">
                  <Download className="w-5 h-5" />
                </div>
                <span className="text-xs font-black text-slate-800 dark:text-slate-100">
                  {IS_STATIC ? '导出数据' : '自选路径导出'}
                </span>
                <span className="text-[10px] text-slate-400">
                  {IS_STATIC ? '下载 json 文件' : '选择保存目录'}
                </span>
              </button>

              <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex flex-col items-center gap-2 p-4 rounded-2xl border-2 border-[#D5E3F0] dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-[#EBF4FE] dark:hover:bg-slate-750 hover:border-[#7ABCF4] dark:hover:border-sky-500 transition-colors cursor-pointer"
              >
                <div className="w-11 h-11 rounded-xl bg-[#7ABCF4]/20 dark:bg-sky-950/60 text-[#2B78C4] dark:text-sky-400 flex items-center justify-center">
                  <Upload className="w-5 h-5" />
                </div>
                <span className="text-xs font-black text-slate-800 dark:text-slate-100">导入数据</span>
                <span className="text-[10px] text-slate-400">选择 roco_user_data.json</span>
              </button>
            </div>

            <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
              <FileJson className="w-3.5 h-3.5 shrink-0" />
              <span>导入文件支持任意合法的 roco_user_data.json 备份</span>
            </div>

            {message && (
                <div
                    className={`flex items-start gap-2 p-3 rounded-xl border-2 text-[11px] font-medium break-all ${
                        msgType === 'ok'
                            ? 'bg-[#F0FDF4] dark:bg-emerald-950/60 border-[#BBF7D0] dark:border-emerald-700 text-emerald-700 dark:text-emerald-300'
                            : 'bg-amber-50 dark:bg-amber-950/60 border-amber-200 dark:border-amber-700 text-amber-700 dark:text-amber-300'
                    }`}
                >
                  {msgType === 'ok' ? (
                      <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  ) : (
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  )}
                  <span>{message}</span>
                </div>
            )}
          </div>

          <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={handleImport}
          />
        </div>
      </div>
  );
};
