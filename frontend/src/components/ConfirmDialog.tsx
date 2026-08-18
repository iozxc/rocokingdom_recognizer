import React from 'react';
import { AlertTriangle, X, RotateCcw, Trash2 } from 'lucide-react';
import { sound } from '../services/sound';

interface ConfirmDialogProps {
    isOpen: boolean;
    title?: string;
    description: string;
    confirmText?: string;
    cancelText?: string;
    danger?: boolean;
    onConfirm: () => void;
    onClose: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
                                                                isOpen,
                                                                title = '操作确认',
                                                                description,
                                                                confirmText = '确定重置',
                                                                cancelText = '取消',
                                                                danger = true,
                                                                onConfirm,
                                                                onClose,
                                                            }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
            <div
                className="bg-white rounded-3xl border-4 border-[#5DA8E8] shadow-2xl max-w-md w-full overflow-hidden flex flex-col animate-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="bg-[#7ABCF4] px-5 py-3.5 text-white flex items-center justify-between border-b-2 border-[#5DA8E8]">
                    <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-xl bg-white/20 border border-white/40 flex items-center justify-center shadow-xs">
                            <AlertTriangle className="w-4 h-4 text-[#FEE061]" />
                        </div>
                        <div>
                            <h3 className="text-base font-black tracking-tight">{title}</h3>
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

                {/* Body Content */}
                <div className="p-5 space-y-3.5">
                    <div className="p-4 bg-rose-50/80 rounded-2xl border-2 border-rose-200 flex items-start gap-3.5">
                        <div className="w-9 h-9 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center shrink-0 border border-rose-300">
                            <RotateCcw className="w-4 h-4 text-rose-600" />
                        </div>
                        <div className="space-y-1">
                            <p className="text-xs font-black text-rose-900 leading-relaxed">
                                {description}
                            </p>
                            <p className="text-[11px] text-rose-600 font-medium">
                                清空后该地图所有精灵的遇见记录与绿勾标记将重置。
                            </p>
                        </div>
                    </div>
                </div>

                {/* Footer Actions */}
                <div className="px-5 py-3.5 bg-[#F0F6FC] border-t border-[#D5E3F0] flex items-center justify-end gap-2.5">
                    <button
                        type="button"
                        onClick={() => {
                            sound.playClick();
                            onClose();
                        }}
                        className="px-4 py-2 rounded-xl bg-white hover:bg-[#EBF4FE] text-slate-600 hover:text-[#1E5B99] font-black text-xs border-2 border-[#BCD7F2] transition-colors cursor-pointer shadow-xs"
                    >
                        {cancelText}
                    </button>

                    <button
                        type="button"
                        onClick={() => {
                            sound.playToggleOff();
                            onConfirm();
                            onClose();
                        }}
                        className={`px-4 py-2 rounded-xl text-white font-black text-xs transition-colors cursor-pointer shadow-xs flex items-center gap-1.5 ${
                            danger
                                ? 'bg-rose-600 hover:bg-rose-700 border-2 border-rose-700'
                                : 'bg-[#7ABCF4] hover:bg-[#5DA8E8] border-2 border-[#5DA8E8]'
                        }`}
                    >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>{confirmText}</span>
                    </button>
                </div>
            </div>
        </div>
    );
};
