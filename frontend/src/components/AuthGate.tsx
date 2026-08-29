import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, ShieldCheck, ShieldX, X } from 'lucide-react';
import { authStore, useAuthStatus } from '../services/auth';
import { showFeatureLockNotice, useFeatureLockNotice } from '../services/featureLock';


interface AuthGateProps {
  children: React.ReactNode;
}

/**
 * 授权门控（软限制）：
 * - 只有「拉黑/封禁」才全屏阻断（显示“设备已被禁止”，不给重试）；
 * - 未授权/等待绑定/过期/异常 不遮罩：App 可用（首页图鉴可浏览），
 *   右上角显示红色「未授权」角标，点击可打开授权/绑定对话框；识别功能被锁定；
 * - 授权成功后展示一次性“绑定成功”弹窗，由用户手动关闭。
 */
export const AuthGate: React.FC<AuthGateProps> = ({ children }) => {
  const auth = useAuthStatus();
  const wasWaiting = useRef(false);
  const [showSuccess, setShowSuccess] = useState(false);

  useEffect(() => {
    authStore.init();
    return () => authStore.stop();
  }, []);

  useEffect(() => {
    if (auth.status === 'waiting' || auth.status === 'expired') {
      wasWaiting.current = true;
    } else if (auth.status === 'authorized') {
      if (wasWaiting.current) {
        wasWaiting.current = false;
        setShowSuccess(true);
      }
    }
  }, [auth.status]);

  const banned = auth.status === 'banned';

  return (
      <>
        {children}

        {/* 仅拉黑才全屏阻断 */}
        {banned && (
            <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4">
              <BannedCard />
            </div>
        )}

        {/* 绑定成功弹窗（用户手动关闭） */}
        {!banned && showSuccess && (
            <div className="fixed inset-0 z-[1001] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
              <SuccessCard
                  expireTime={auth.expire_time}
                  onClose={() => setShowSuccess(false)}
              />
            </div>
        )}

        {/* “请授权，解锁更多功能” 提示 */}
        <FeatureLockToast />
      </>
  );
};


const BannedCard: React.FC = () => (
    <div className="bg-white rounded-3xl shadow-2xl px-8 py-10 max-w-sm w-full text-center">
      <ShieldX className="w-12 h-12 mx-auto text-red-500" />
      <h2 className="mt-4 text-lg font-black text-slate-800">设备已被禁止</h2>
      <p className="mt-2 text-sm text-slate-500">
        该设备已被列入黑名单，请联系管理员处理后再试。
      </p>
      <p className="mt-4 text-xs text-slate-400">如需退出，请点击窗口右上角关闭。</p>
    </div>
);


/** 全局“请授权，解锁更多功能”提示条（触发后显示约 2.6 秒）。 */
const FeatureLockToast: React.FC = () => {
  const visible = useFeatureLockNotice();
  if (!visible) {
    return null;
  }
  return (
      <div className="fixed top-[72px] left-1/2 -translate-x-1/2 z-[990] bg-slate-900/90 text-white text-sm font-bold px-5 py-3 rounded-2xl shadow-2xl">
        请授权，解锁更多功能
      </div>
  );
};


interface SuccessCardProps {
  expireTime?: string;
  onClose: () => void;
}

const SuccessCard: React.FC<SuccessCardProps> = ({ expireTime, onClose }) => (
    <div className="bg-white rounded-3xl shadow-2xl px-8 py-10 max-w-sm w-full text-center relative">
      <button
          onClick={onClose}
          title="关闭"
          className="absolute top-3 right-3 p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors cursor-pointer"
      >
        <X className="w-5 h-5" />
      </button>
      <CheckCircle2 className="w-12 h-12 mx-auto text-emerald-500" />
      <h2 className="mt-4 text-xl font-black text-slate-800">绑定成功</h2>
      <p className="mt-2 text-sm text-slate-500">设备已授权，感谢使用！</p>
      {/*{expireTime && (*/}
      {/*    <p className="mt-2 text-xs text-slate-400">*/}
      {/*      授权到期：<span className="font-mono text-slate-600">{expireTime}</span>*/}
      {/*    </p>*/}
      {/*)}*/}
      <button
          onClick={onClose}
          className="mt-6 inline-flex items-center gap-2 px-6 py-2.5 rounded-2xl bg-sky-500 text-white font-black hover:bg-sky-600 transition-colors cursor-pointer"
      >
        <ShieldCheck className="w-5 h-5" />
        开始使用
      </button>
    </div>
);
