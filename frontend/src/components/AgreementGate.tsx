import React, { useEffect, useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { AgreementBody } from './AgreementBody';
import { api } from '../services/api';

const REQUIRED_READ_SECONDS = 3;
// 距底部小于该值即可认为已滚动到底
const SCROLL_BOTTOM_TOLERANCE = 12;


/**
 * 首次使用协议（仅在 roco_user_data.json 不存在、即第一次打开时显示）。
 * 本应用风格：蓝白配色、白卡、蓝色标题栏；以半透明弹窗形态浮在应用之上。
 * 正文可滚动，滚动到底部或等待 REQUIRED_READ_SECONDS 秒后，“同意协议并开始”才可点击。
 * 同意后落盘用户数据文件，后续启动不再弹出。
 */
export const AgreementGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [required, setRequired] = useState<boolean | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [countdown, setCountdown] = useState(REQUIRED_READ_SECONDS);
  const [scrolledBottom, setScrolledBottom] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    api.isAgreementRequired().then((v) => {
      if (alive) setRequired(v);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (accepted || required !== true) return;
    const timer = setInterval(
        () => setCountdown((v) => Math.max(0, v - 1)),
        1000,
    );
    return () => clearInterval(timer);
  }, [accepted, required]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (remaining <= SCROLL_BOTTOM_TOLERANCE) {
      setScrolledBottom(true);
    }
  };

  const unlocked = countdown <= 0 || scrolledBottom;

  const handleAccept = () => {
    setAccepted(true);
    // 落盘用户数据，标记为非首次；失败不阻塞使用
    api.acceptAgreement();
  };

  const handleExit = () => {
    try {
      const pyApi = (window as any).pywebview?.api;
      if (pyApi?.quit_app) {
        pyApi.quit_app();
        return;
      }
    } catch {
      /* 桥接调用失败时继续走兜底 */
    }
    try {
      window.close();
    } catch {
      /* ignore */
    }
  };

  const showOverlay = required === true && !accepted;

  return (
      <>
        {/* 应用本体始终渲染，协议以弹窗形式浮在其上（仅首次启动） */}
        {children}

        {showOverlay && (
            <div className="fixed inset-0 z-[3000] flex items-center justify-center p-4 bg-slate-900/25 backdrop-blur-[2px]">
              <div className="relative w-full max-w-md max-h-[85vh] bg-white rounded-3xl border-4 border-[#7ABCF4] shadow-2xl overflow-hidden flex flex-col">

                {/* 顶部标题栏 */}
                <div className="px-4 py-3 bg-[#7ABCF4] text-white flex items-center gap-2.5 border-b-2 border-[#5DA8E8] shrink-0">
                  <div className="w-8 h-8 rounded-lg bg-white/20 border border-white/40 flex items-center justify-center shrink-0">
                    <ShieldCheck className="w-4 h-4 text-white" />
                  </div>
                  <div className="min-w-0">
                    <h1 className="text-sm font-black tracking-tight">严正提醒</h1>
                    <p className="text-[10.5px] text-white/85 font-medium">
                      请先阅读以下说明，再决定是否继续使用本程序。
                    </p>
                  </div>
                </div>

                {/* 协议正文：可滚动 */}
                <div
                    ref={bodyRef}
                    onScroll={handleScroll}
                    className="flex-1 min-h-0 max-h-[46vh] overflow-y-auto px-4 py-3"
                >
                  <AgreementBody />
                </div>

                {/* 底部：说明 + 按钮 */}
                <div className="px-4 py-3 bg-slate-50/80 border-t border-slate-100 flex items-center justify-between gap-3 shrink-0">
                  <p className="text-[10px] text-slate-500 leading-snug">
                    开源不收费 · 源码可见
                  </p>
                  <div className="flex flex-col items-end gap-1">
                    {!unlocked && (
                        <span className="text-[10px] text-slate-400">
                          滑动到底部或等待 {countdown}s 后即可同意
                        </span>
                    )}
                    <div className="flex items-center gap-2">
                      <button
                          type="button"
                          onClick={handleExit}
                          className="px-3.5 h-8 rounded-lg bg-white border-2 border-[#7ABCF4] text-[#2B78C4] text-[11px] font-black hover:bg-[#EAF4FF] transition-colors cursor-pointer"
                      >
                        退出程序
                      </button>
                      <button
                          type="button"
                          onClick={handleAccept}
                          disabled={!unlocked}
                          className={`px-4 h-8 rounded-lg text-[11px] font-black transition-colors cursor-pointer ${
                              unlocked
                                  ? 'bg-[#7ABCF4] hover:bg-[#5DA8E8] text-white shadow-md shadow-sky-200'
                                  : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                          }`}
                      >
                        同意协议并开始
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
        )}
      </>
  );
};
