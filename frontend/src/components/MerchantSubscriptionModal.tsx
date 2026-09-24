import React, { useCallback, useEffect, useState } from 'react';
import {
  BellRing,
  ExternalLink,
  Info,
  Loader2,
  QrCode,
  RefreshCw,
  Smartphone,
} from 'lucide-react';
import { ModalHeader } from './ModalHeader';
import { wechatPush } from '../services/wechatPush';

interface MerchantSubscriptionModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * 桌面端的「远行商人提醒」引流入口。
 *
 * 远行商人是小程序里**独立的模块**，不需要与桌面端绑定：
 * 这里只展示小程序码，用户扫码进小程序后自己点「增加 1 次提醒」。
 */
export const MerchantSubscriptionModal: React.FC<MerchantSubscriptionModalProps> = ({ isOpen, onClose }) => {
  const [qrUrl, setQrUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadQr = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await wechatPush.getPromoQr('merchant');
      setQrUrl((data as { qr_url?: string }).qr_url || '');
      if (!(data as { qr_url?: string }).qr_url) {
        setError('服务端没有返回小程序码');
      }
    } catch (err) {
      setQrUrl('');
      setError((err as Error)?.message || '生成小程序码失败');
    } finally {
      setLoading(false);
    }
  }, []);

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
          subtitle="微信小程序"
          onClose={onClose}
          closeTitle="关闭"
        />

        <div className="p-4 sm:p-5 overflow-y-auto">
          <div className="rounded-2xl border border-sky-200 bg-sky-50/70 p-4 dark:border-sky-900/50 dark:bg-sky-950/30">
            <div className="flex items-center gap-2 mb-2.5">
              <span className="w-6 h-6 rounded-lg bg-sky-100 dark:bg-sky-900/60 text-[#2B78C4] dark:text-sky-300 flex items-center justify-center">
                <Info className="h-3.5 w-3.5" />
              </span>
              <span className="text-sm font-black text-slate-800 dark:text-slate-100">使用说明</span>
            </div>
            <ol className="space-y-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
              <li className="flex gap-2">
                <span className="shrink-0 w-4 h-4 rounded-full bg-white dark:bg-slate-800 ring-1 ring-sky-200 dark:ring-sky-800 text-[10px] font-black text-[#2B78C4] dark:text-sky-300 flex items-center justify-center">1</span>
                <span>本小程序可独立使用，不需要绑定桌面端。</span>
              </li>
              <li className="flex gap-2">
                <span className="shrink-0 w-4 h-4 rounded-full bg-white dark:bg-slate-800 ring-1 ring-sky-200 dark:ring-sky-800 text-[10px] font-black text-[#2B78C4] dark:text-sky-300 flex items-center justify-center">2</span>
                <span>扫码进入后点击「增加 1 次提醒」，允许微信订阅。</span>
              </li>
              <li className="flex gap-2">
                <span className="shrink-0 w-4 h-4 rounded-full bg-white dark:bg-slate-800 ring-1 ring-sky-200 dark:ring-sky-800 text-[10px] font-black text-[#2B78C4] dark:text-sky-300 flex items-center justify-center">3</span>
                <span>每发送一条提醒会自动消耗一次额度。</span>
              </li>
              <li className="flex gap-2">
                <span className="shrink-0 w-4 h-4 rounded-full bg-white dark:bg-slate-800 ring-1 ring-sky-200 dark:ring-sky-800 text-[10px] font-black text-[#2B78C4] dark:text-sky-300 flex items-center justify-center">4</span>
                <span>额度用完后，再点击一次即可继续增加。</span>
              </li>
            </ol>
          </div>

          <div className="mt-4 flex min-h-[280px] items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-800/40">
            {loading ? (
              <div className="flex flex-col items-center gap-2 text-slate-500">
                <Loader2 className="h-6 w-6 animate-spin" />
                <span className="text-xs">正在生成小程序码…</span>
              </div>
            ) : qrUrl ? (
              <img
                src={qrUrl}
                alt="远行商人小程序码"
                className="h-56 w-56 rounded-xl bg-white p-2 shadow-sm"
              />
            ) : (
              <div className="flex flex-col items-center gap-2 text-slate-400">
                <QrCode className="h-10 w-10" />
                <span className="text-xs">{error || '暂时没有可用的小程序码'}</span>
              </div>
            )}
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <Smartphone className="h-3.5 w-3.5" />
              使用微信扫码进入小程序
            </div>
            <button
              type="button"
              onClick={loadQr}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-full bg-sky-500 px-4 py-1.5 text-xs font-bold text-white disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              刷新二维码
            </button>
          </div>

          {error && (
            <div className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600 dark:bg-rose-950/40 dark:text-rose-300">
              {error}
            </div>
          )}

          <div className="mt-3 flex items-center justify-center gap-1 text-[11px] text-slate-400">
            <ExternalLink className="h-3 w-3" />
            小程序名称：徽章试炼助手
          </div>
        </div>
      </div>
    </div>
  );
};
