import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  ExternalLink,
  Loader2,
  QrCode,
  RefreshCw,
} from 'lucide-react';
import { ModalHeader, ModalHeaderBadge } from './ModalHeader';
import { sound } from '../services/sound';
import { wechatPush } from '../services/wechatPush';

interface MerchantSubscriptionModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const MerchantSubscriptionModal: React.FC<MerchantSubscriptionModalProps> = ({ isOpen, onClose }) => {
  const [qrUrl, setQrUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadQr = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await wechatPush.getPromoQr();
      setQrUrl(data.qr_url || '');
    } catch (err) {
      setQrUrl('');
      setError((err as Error)?.message || '生成小程序码失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      void loadQr();
    } else {
      setQrUrl('');
      setError('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
      onClick={onClose}
      onWheel={(e) => e.stopPropagation()}
    >
      <div
        className="w-full max-w-xl max-h-[90vh] overflow-hidden rounded-[26px] bg-white shadow-2xl ring-1 ring-slate-900/5 dark:bg-slate-900 dark:ring-white/10 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <ModalHeader
          icon={BellRing}
          tone="sky"
          title="远行商人提醒"
          badge={<ModalHeaderBadge>微信小程序</ModalHeaderBadge>}
          subtitle="扫码进入小程序，点一次增加一次微信服务通知"
          onClose={onClose}
          closeTitle="关闭远行商人提醒"
        />

        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {error && (
            <div className="rounded-2xl border-2 border-rose-200 bg-rose-50 px-3.5 py-3 text-xs font-bold text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            </div>
          )}

          {loading ? (
            <div className="flex min-h-72 flex-col items-center justify-center gap-3 text-slate-400">
              <Loader2 className="h-7 w-7 animate-spin" />
              <span className="text-xs font-bold">正在生成小程序码…</span>
            </div>
          ) : qrUrl ? (
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="rounded-2xl border-2 border-[#BCD7F2] bg-white p-3 shadow-sm dark:border-slate-600 dark:bg-slate-800">
                <img
                  src={qrUrl}
                  alt="远行商人微信小程序码"
                  className="h-56 w-56 object-contain"
                  draggable={false}
                />
              </div>
              <div>
                <div className="text-base font-black text-slate-800 dark:text-slate-100">请用微信扫一扫</div>
                <div className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                  扫码进入“远行商人助手”小程序，在页面里点击“增加 1 次提醒”。
                </div>
              </div>
            </div>
          ) : (
            <div className="flex min-h-52 flex-col items-center justify-center gap-2 text-slate-400">
              <QrCode className="h-10 w-10" />
              <span className="text-xs font-bold">暂无可用小程序码</span>
            </div>
          )}


          <div className="grid grid-cols-1 gap-2 text-[11px] text-slate-500 dark:text-slate-400 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
              <div className="font-black text-slate-700 dark:text-slate-200">1. 扫码</div>
              <div className="mt-1">打开远行商人小程序</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
              <div className="font-black text-slate-700 dark:text-slate-200">2. 加次数</div>
              <div className="mt-1">点击“增加 1 次提醒”并授权</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
              <div className="font-black text-slate-700 dark:text-slate-200">3. 收提醒</div>
              <div className="mt-1">到点或命中后收到服务通知</div>
            </div>
          </div>

          <button
            type="button"
            disabled={loading}
            onClick={() => {
              sound.playClick();
              void loadQr();
            }}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-[#2B78C4] px-4 text-sm font-black text-white transition-colors hover:bg-[#2063A5] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            刷新小程序码
          </button>

          <p className="text-center text-[10px] leading-relaxed text-slate-400">
            桌面端只负责展示小程序入口，不再保存绑定关系；提醒次数由微信小程序侧独立管理。
          </p>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/80 px-5 py-3 dark:border-slate-800 dark:bg-slate-800/60">
          <span className="flex items-center gap-1.5 text-[10px] text-slate-400">
            <CheckCircle2 className="h-3 w-3" />
            微信小程序独立提醒
          </span>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-black text-slate-600 transition-colors hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            关闭
            <ExternalLink className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
};
