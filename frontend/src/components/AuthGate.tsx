import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, ShieldAlert, ShieldCheck, ShieldX, Sparkles, X } from 'lucide-react';
import { authStore, useAuthStatus } from '../services/auth';
import { requestAuthDialog } from '../services/authDialog';
import { useFeatureLockNotice } from '../services/featureLock';
import {
  hideAuthReminder,
  startAuthReminderLoop,
  stopAuthReminderLoop,
  useAuthReminder,
} from '../services/authReminder';


interface AuthGateProps {
  children: React.ReactNode;
}

/** 未授权声明卡：0 = 常驻不自动消失，只能手动「我知道了 / × / 查看绑定指令」收起。 */
const AUTH_NOTICE_MS = 0;

/**
 * 授权门控（纯提示，不拦功能）：
 * - 只有「拉黑/封禁」才全屏阻断（显示“设备已被禁止”，不给重试）；
 * - 未授权/等待绑定/过期/异常 完全不遮罩：**所有功能都能用**（首页识别 + 跟随识别），
 *   右上角显示红色「未授权」角标，点击可打开授权/绑定对话框；
 * - 开屏检测到未授权：弹出「开源免费声明」卡片（替代旧的上浮 toast），附「查看绑定指令」
 *   入口，点一下直接唤起绑定授权弹窗；之后每 10~30 分钟随机再提醒一次；
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
  // pending = 还在校验中，此时不该提示「未授权」（否则启动瞬间会闪一下）。
  // 只有确实拿到「等待绑定 / 过期 / 异常 / 离线」才提醒。
  const needsAuth = ['waiting', 'expired', 'error', 'offline'].includes(auth.status);

  // 未授权：开屏先弹一次声明卡，之后每 10~30 分钟随机再提醒一次。
  // 弹窗停留时长交给 store 控制（见 authReminder 的 duration），这里只负责起停表。
  useEffect(() => {
    if (needsAuth) {
      startAuthReminderLoop(() => true, AUTH_NOTICE_MS);
    } else {
      stopAuthReminderLoop();
    }
  }, [needsAuth]);

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

        {/* 未授权声明卡（开屏自动弹出 + 每 10~30 分钟随机；不遮罩、不拦操作） */}
        <AuthNoticeCard />

        {/* “请授权后使用跟随识别” 提示 */}
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


/** 全局“请授权后使用跟随识别”提示条（触发后显示约 2.6 秒）。 */
const FeatureLockToast: React.FC = () => {
  const visible = useFeatureLockNotice();
  if (!visible) {
    return null;
  }
  return (
      <div className="fixed top-[72px] left-1/2 -translate-x-1/2 z-[990] bg-slate-900/90 text-white text-sm font-bold px-5 py-3 rounded-2xl shadow-2xl">
        请授权后使用「跟随识别」
      </div>
  );
};


/**
 * 未授权声明卡：开屏检测到未授权时自动弹出（之后每 10~30 分钟随机再弹）。
 * - 不遮罩、不拦操作，所有功能照常可用；点「查看绑定指令」直接唤起绑定授权弹窗。
 * - **常驻不自动消失**：只能手动「我知道了 / ×」收起；右上角「未授权」角标也常驻。
 */
const AuthNoticeCard: React.FC = () => {
  const visible = useAuthReminder();
  if (!visible) {
    return null;
  }
  return (
      <div className="fixed inset-0 z-[995] flex items-center justify-center p-4 pointer-events-none">
        {/* 卡片必须**不透明**：body 上那层米白点阵背景图会透过任何半透明元素，
            带一丝透明度整张卡就会被洗成米色（实测踩坑）。所以入场动画用 index.css
            的 roco-auth-notice（关键帧显式收尾 opacity:1 / transform:none），不用
            tw-animate 的 fade-in——它只设 --tw-enter-opacity、enter 关键帧又没有 to 帧。 */}
        <div className="roco-auth-notice pointer-events-auto w-[420px] max-w-[calc(100vw-2rem)] rounded-3xl bg-white dark:bg-slate-800 shadow-2xl ring-1 ring-inset ring-slate-200/80 dark:ring-slate-700 px-6 py-6 text-center relative">
          <button
              onClick={hideAuthReminder}
              title="关闭"
              className="absolute top-3 right-3 p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-600 dark:hover:text-slate-300 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>

          {/* 开源免费徽标：绿色盾牌 + 对勾，与「已授权」角标同一视觉语言 */}
          <span className="inline-flex w-12 h-12 rounded-2xl bg-[#E1F7DB] dark:bg-emerald-950/60 text-[#2D6613] dark:text-emerald-300 border-2 border-[#95D151] dark:border-emerald-700 items-center justify-center">
            <ShieldCheck className="w-6 h-6" />
          </span>
          <h3 className="mt-3 text-base font-black text-slate-800 dark:text-slate-100 tracking-tight">
            开源 · 免费 · 无广告
          </h3>
          <p className="mt-2 text-[13px] text-slate-500 dark:text-slate-400 leading-relaxed">
            如果你花钱购买了本应用，请立即申请退款。
            <br />
            未授权状态下，全部功能依然可以正常使用；如需授权，点下方「查看绑定指令」。
          </p>

          {/* 要点 chip：只留「开源免费 / 无广告」两枚，功能不受限一句正文里已经说了 */}
          <div className="mt-4 flex items-center justify-center gap-1.5 flex-wrap">
            {[
              { icon: Sparkles, label: '开源免费' },
              { icon: ShieldCheck, label: '无广告' },
            ].map(({ icon: Icon, label }) => (
                <span
                    key={label}
                    className="inline-flex items-center gap-1 text-[11px] font-black px-2 py-1 rounded-full bg-[#EBF4FE] dark:bg-sky-950/70 text-[#2B78C4] dark:text-sky-300 border border-[#BCD7F2] dark:border-sky-800"
                >
                  <Icon className="w-3 h-3" />
                  {label}
                </span>
            ))}
          </div>

          <div className="mt-5 flex items-center gap-2">
            <button
                onClick={hideAuthReminder}
                className="flex-1 px-4 py-2 rounded-xl bg-white dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-300 text-sm font-black hover:border-slate-300 dark:hover:border-slate-600 transition-colors cursor-pointer"
            >
              我知道了
            </button>
            <button
                onClick={() => {
                  hideAuthReminder();
                  requestAuthDialog();
                }}
                title="打开授权/绑定对话框，获取 bind 指令"
                className="flex-1 px-4 py-2 rounded-xl roco-btn-primary text-sm cursor-pointer active:scale-[0.98] transition-all flex items-center justify-center gap-1.5"
                style={{ borderRadius: 12 }}
            >
              <ShieldAlert className="w-4 h-4" />
              查看绑定指令
            </button>
          </div>

          <p className="mt-3 text-[10px] text-slate-400 dark:text-slate-500">
            未授权，此提示会偶尔出现，不影响任何操作；关闭后也可随时点右上角「未授权」角标获取绑定指令
          </p>
        </div>
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
