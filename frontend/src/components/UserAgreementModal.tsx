import React from 'react';
import { X, ShieldCheck } from 'lucide-react';
import { AgreementBody } from './AgreementBody';
import { sound } from '../services/sound';
import { ModalHeader } from './ModalHeader';


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
            className="relative w-full max-w-lg max-h-[85vh] bg-white dark:bg-slate-900 rounded-[26px] shadow-2xl ring-1 ring-slate-900/5 dark:ring-white/10 overflow-hidden flex flex-col transition-colors"
            onClick={(e) => e.stopPropagation()}
        >

          {/* 顶部标题栏 */}
          <ModalHeader
              icon={ShieldCheck}
              tone="sky"
              title="用户协议"
              subtitle="本程序使用前需同意以下条款"
              onClose={onClose}
              closeTitle="关闭"
          />

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
