import React from 'react';
import { CheckCircle2, Sparkles, RotateCcw } from 'lucide-react';
import { EffectLevel } from '../types';

export type SyncPopType = 'encounter' | 'unencounter' | 'info';

interface SyncPopNotificationProps {
    isVisible: boolean;
    message?: string;
    subMessage?: string;
    level?: EffectLevel;
    type?: SyncPopType;
}

export const SyncPopNotification: React.FC<SyncPopNotificationProps> = ({
                                                                            isVisible,
                                                                            message = '图鉴状态已更新',
                                                                            subMessage,
                                                                            level = 1,
                                                                            type = 'encounter',
                                                                        }) => {
    if (!isVisible) return null;

    const isEncounter = type === 'encounter';

    return (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[99999] pointer-events-none flex flex-col items-center animate-in fade-in slide-in-from-top-3 duration-200">
            <div
                className={`flex items-center gap-2.5 px-4 py-2 backdrop-blur-md rounded-full shadow-xl border ${
                    isEncounter
                        ? 'bg-slate-900/90 text-white border-white/15'
                        : 'bg-slate-800/90 text-slate-100 border-slate-600/40'
                }`}
            >
                <div
                    className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                        isEncounter
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : 'bg-slate-700/70 text-slate-300'
                    }`}
                >
                    {isEncounter ? (
                        level === 3 ? (
                            <Sparkles className="w-3.5 h-3.5" />
                        ) : (
                            <CheckCircle2 className="w-3.5 h-3.5" />
                        )
                    ) : (
                        <RotateCcw className="w-3 h-3" />
                    )}
                </div>

                <div className="flex items-center gap-1.5 text-xs font-medium tracking-tight whitespace-nowrap">
                    <span>{message}</span>
                    {subMessage && (
                        <span
                            className={`text-[10px] font-normal ${
                                isEncounter ? 'text-slate-300' : 'text-slate-400'
                            }`}
                        >
              ({subMessage})
            </span>
                    )}
                </div>
            </div>
        </div>
    );
};


