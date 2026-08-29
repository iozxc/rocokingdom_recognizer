import React, { useEffect, useState } from 'react';
import { CheckCircle2, Copy, Loader2, RefreshCw, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import { authStore, useAuthStatus } from '../services/auth';

// 整个应用生命周期内只自动弹出一次“未授权”窗口
let hasAutoOpenedOnce = false;

// 机器码去掉末尾点/空白：客户端原始 machine_code 可能带末尾点，展示与复制都清理掉
const cleanMachineCode = (mc?: string) => (mc || '').replace(/[\s.]+$/, '');

/** Header 右上角授权角标：已授权（绿）/ 未授权（红，可点击打开授权对话框）。 */
export const AuthBadge: React.FC = () => {
  const auth = useAuthStatus();
  const [open, setOpen] = useState(false);
  const [showInfo, setShowInfo] = useState(false);

  // 授权成功或被拉黑时自动关闭“未授权”对话框
  useEffect(() => {
    if (auth.status === 'authorized' || auth.status === 'banned') {
      setOpen(false);
      authStore.setEngaged(false);
    }
  }, [auth.status]);

  // 未授权时，打开 App 自动弹出授权/绑定窗口一次（关闭后不再自动弹，除非再点角标）
  useEffect(() => {
    const nonAuth = ['waiting', 'expired', 'error'].includes(auth.status);
    if (nonAuth && !hasAutoOpenedOnce) {
      hasAutoOpenedOnce = true;
      setOpen(true);
      authStore.setEngaged(true);
    }
  }, [auth.status]);

  if (auth.status === 'authorized') {
    return (
        <>
          <button
              onClick={() => setShowInfo(true)}
              title="当前设备已授权，点击查看详情"
              className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-500/90 text-white text-[11px] font-black shadow-sm border border-white/40 shrink-0 cursor-pointer hover:bg-emerald-600 transition-colors"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            已授权
          </button>
          {showInfo && (
              <AuthorizedInfoDialog
                  expireTime={auth.expire_time}
                  machineCode={auth.machine_code}
                  onClose={() => setShowInfo(false)}
              />
          )}
        </>
    );
  }

  // 拉黑由 AuthGate 全屏阻断，这里不显示角标
  if (auth.status === 'banned') {
    return null;
  }

  // 校验中（pending）暂不显示，避免已授权用户启动瞬间闪一下红色
  if (auth.status === 'pending') {
    return null;
  }

  return (
      <>
        <button
            onClick={() => {
              setOpen(true);
              authStore.setEngaged(true);
            }}
            title="当前设备未授权，点击查看授权/绑定"
            className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-red-500/90 text-white text-[11px] font-black shadow-sm border border-white/40 shrink-0 cursor-pointer hover:bg-red-600 transition-colors"
        >
          <ShieldAlert className="w-3.5 h-3.5" />
          未授权
        </button>
        {open && (
            <AuthDialog
                auth={auth}
                onClose={() => {
                  setOpen(false);
                  authStore.setEngaged(false);
                }}
            />
        )}
      </>
  );
};


interface AuthorizedInfoDialogProps {
  expireTime: string;
  machineCode: string;
  onClose: () => void;
}

const AuthorizedInfoDialog: React.FC<AuthorizedInfoDialogProps> = ({ expireTime, machineCode, onClose }) => {
  const [copied, setCopied] = useState(false);
  const clean = cleanMachineCode(machineCode);

  const copyMachineCode = async () => {
    try {
      await navigator.clipboard.writeText(clean);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // 忽略剪贴板不可用
    }
  };

  return (
      <div
          className="fixed inset-0 z-[1002] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4"
          onClick={onClose}
      >
        <div
            className="bg-white rounded-3xl shadow-2xl px-8 py-8 max-w-sm w-full text-center relative"
            onClick={(e) => e.stopPropagation()}
        >
          <button
              onClick={onClose}
              title="关闭"
              className="absolute top-3 right-3 p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
          <ShieldCheck className="w-12 h-12 mx-auto text-emerald-500" />
          <h2 className="mt-4 text-lg font-black text-slate-800">设备已授权</h2>
          <div className="mt-5 space-y-3 text-sm text-left">
            {/*<div className="flex justify-between gap-2 border-b border-slate-100 pb-2">*/}
            {/*  <span className="text-slate-400 shrink-0">授权到期</span>*/}
            {/*  <span className="font-mono text-slate-700">{expireTime || '长期有效'}</span>*/}
            {/*</div>*/}
            <div className="flex justify-between items-center gap-2">
              <span className="text-slate-400 shrink-0">机器码</span>
              <span className="inline-flex items-center gap-1.5 min-w-0">
                <span className="font-mono text-[11px] text-slate-600 break-all text-right">{clean || '—'}</span>
                <button
                    onClick={copyMachineCode}
                    title="复制机器码"
                    className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-50 transition-colors cursor-pointer"
                >
                  {copied ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                </button>
              </span>
            </div>
          </div>
        </div>
      </div>
  );
};


interface AuthDialogProps {
  auth: {
    status: string;
    auth_code: string;
    expire_time: string;
    msg: string;
    error: string;
  };
  onClose: () => void;
}

const AuthDialog: React.FC<AuthDialogProps> = ({ auth, onClose }) => {
  const [copied, setCopied] = useState(false);

  const copyAuthCode = async () => {
    try {
      await navigator.clipboard.writeText(`bind ${auth.auth_code}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // 忽略剪贴板不可用
    }
  };

  return (
      <div
          className="fixed inset-0 z-[1002] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4"
          onClick={onClose}
      >
        <div
            className="bg-white rounded-3xl shadow-2xl px-6 sm:px-8 py-8 max-w-md w-full relative"
            onClick={(e) => e.stopPropagation()}
        >
          <button
              onClick={onClose}
              title="关闭"
              className="absolute top-3 right-3 p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>

          {auth.status === 'pending' && (
              <div className="text-center">
                <Loader2 className="w-10 h-10 mx-auto text-sky-500 animate-spin" />
                <h2 className="mt-4 text-lg font-black text-slate-800">正在校验授权</h2>
                <p className="mt-2 text-sm text-slate-500">正在连接授权服务器，请稍候...</p>
              </div>
          )}

          {auth.status === 'waiting' && (
              <div className="text-center">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-sky-100 text-sky-700 text-xs font-black mb-3">
                  验证用户来源
                </div>
                <Loader2 className="w-10 h-10 mx-auto text-sky-500 animate-spin" />
                <h2 className="mt-4 text-lg font-black text-slate-800">等待设备授权</h2>
                <p className="mt-2 text-sm text-slate-500 leading-relaxed">
                  请前往官方 QQ 群，<span className="text-sky-600 font-bold">@又又</span> 发送以下指令完成绑定：
                </p>
                <div className="mt-5 rounded-2xl bg-sky-50 border border-sky-200 px-4 py-3">
                  <div className="text-[11px] uppercase tracking-wide text-slate-400 font-bold">Bind 指令</div>
                  <div className="mt-1 flex items-center justify-center gap-2">
                    <code className="font-mono text-base font-black text-sky-700 select-all">
                      bind {auth.auth_code}
                    </code>
                    <button
                        onClick={copyAuthCode}
                        title="复制 bind 指令"
                        className="p-1.5 rounded-lg bg-white border border-sky-200 text-sky-600 hover:bg-sky-100 transition-colors cursor-pointer"
                    >
                      {copied ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <button
                    onClick={() => authStore.refreshCode()}
                    title="重新生成授权码，旧授权码立即失效，防止被他人使用"
                    className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-sky-600 border border-slate-200 hover:border-sky-300 px-3 py-1.5 rounded-xl transition-colors cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  换授权码（旧码将失效）
                </button>
                <div className="mt-4 text-xs text-slate-400">
                  正在等待绑定
                </div>
              </div>
          )}

          {(auth.status === 'expired' || auth.status === 'error') && (
              <div className="text-center">
                <ShieldAlert className="w-12 h-12 mx-auto text-amber-500" />
                <h2 className="mt-4 text-lg font-black text-slate-800">
                  {auth.status === 'expired' ? '授权已过期' : '无法连接授权服务器'}
                </h2>
                <p className="mt-2 text-sm text-slate-500 break-all">
                  {(auth.status === 'expired' ? auth.msg : auth.error) || '请检查网络后重试。'}
                </p>
                <button
                    onClick={() => (auth.status === 'expired' ? authStore.reauthorize() : authStore.retry())}
                    className="mt-6 inline-flex items-center gap-2 px-5 py-2 rounded-2xl bg-sky-500 text-white font-black hover:bg-sky-600 transition-colors cursor-pointer"
                >
                  <RefreshCw className="w-4 h-4" />
                  {auth.status === 'expired' ? '重新授权' : '重试'}
                </button>
              </div>
          )}
        </div>
      </div>
  );
};
