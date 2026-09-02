import React from 'react';
import { X, ShieldCheck } from 'lucide-react';
import { AgreementBody } from './AgreementBody';
import { sound } from '../services/sound';


interface UserAgreementModalProps {
  isOpen: boolean;
  onClose: () => void;
}


/** 设置里的“用户协议”查看弹窗（复用协议正文，仅供阅读）。 */
export const UserAgreementModal: React.FC<UserAgreementModalProps> = ({ isOpen, onClose }) => {
  React.useEffect(() => {
    if (isOpen) {
      const originalBodyOverflow = document.body.style.overflow;
      const originalHtmlOverflow = document.documentElement.style.overflow;
      document.body.style.overflow = 'hidden';
      document.documentElement.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalBodyOverflow;
        document.documentElement.style.overflow = originalHtmlOverflow;
      };
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
      <div
          className="fixed inset-0 z-[4000] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
          onWheel={(e) => e.stopPropagation()}
          onClick={onClose}
      >
        <div
            className="relative w-full max-w-lg max-h-[85vh] bg-white dark:bg-slate-900 rounded-3xl border-4 border-[#7ABCF4] dark:border-slate-700 shadow-2xl overflow-hidden flex flex-col transition-colors"
            onClick={(e) => e.stopPropagation()}
        >

          {/* 顶部标题栏 */}
          <div className="px-5 py-3.5 bg-[#7ABCF4] dark:bg-slate-800 text-white flex items-center justify-between border-b-2 border-[#5DA8E8] dark:border-slate-700 shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-white/20 border border-white/40 flex items-center justify-center">
                <ShieldCheck className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="text-base font-black tracking-tight">用户协议</h3>
                <p className="text-[11px] text-white/80 dark:text-slate-300 font-medium">
                  本程序使用前需同意以下条款
                </p>
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

          {/* 正文 */}
          <div className="flex-1 min-h-0 max-h-[64vh] overflow-y-auto px-5 py-4">
            <AgreementBody />
          </div>

          {/* 底部 */}
          <div className="px-5 py-3 bg-slate-50/80 dark:bg-slate-800/80 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-2 shrink-0">
            <div className="mr-auto text-[10px] text-slate-400 leading-snug">
              开源不收费 · 源码可见
              <br />
              Open Source · Free for Personal Use
            </div>
            <button
                type="button"
                onClick={() => {
                  sound.playClick();
                  onClose();
                }}
                className="px-5 h-9 rounded-xl bg-[#7ABCF4] hover:bg-[#5DA8E8] text-white text-xs font-black transition-colors cursor-pointer"
            >
              关闭
            </button>
          </div>
        </div>
      </div>
  );
};
