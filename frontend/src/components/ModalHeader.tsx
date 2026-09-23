import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { X } from 'lucide-react';
import { sound } from '../services/sound';

/**
 * 弹窗统一头部：中性玻璃表面 + 极淡 inset ring + 彩色图标片。
 *
 * 之前每个弹窗头部各写一遍「整块蓝紫渐变 + 白字」（bg-gradient-to-br from-[#8FC7F7]
 * via-[#7ABCF4] to-[#5DA8E8]），问题有二：
 *   1. 视觉太重：大色块紧贴白色 body，顶部像被糊了一块，和卡片/悬浮按钮的
 *      「浅灰玻璃 + 发丝线」风格脱节；
 *   2. 各写各的：字号、内边距、关闭按钮圆角都会漂移（16 个弹窗里已经有三套写法）。
 *
 * 现在收敛成单一组件：浅灰玻璃条 + 底部发丝线，语义靠彩色图标片承载，
 * 标题/副标题走深色文字。换色只改 tone，不再复制粘贴 className。
 */
export type ModalTone = 'sky' | 'emerald' | 'violet' | 'amber' | 'rose' | 'slate';

const TONE_CLASS: Record<ModalTone, string> = {
  sky: 'bg-sky-100 text-sky-600 ring-sky-200/70 dark:bg-sky-500/20 dark:text-sky-300 dark:ring-sky-500/25',
  emerald: 'bg-emerald-100 text-emerald-600 ring-emerald-200/70 dark:bg-emerald-500/20 dark:text-emerald-300 dark:ring-emerald-500/25',
  violet: 'bg-violet-100 text-violet-600 ring-violet-200/70 dark:bg-violet-500/20 dark:text-violet-300 dark:ring-violet-500/25',
  amber: 'bg-amber-100 text-amber-600 ring-amber-200/70 dark:bg-amber-500/20 dark:text-amber-300 dark:ring-amber-500/25',
  rose: 'bg-rose-100 text-rose-600 ring-rose-200/70 dark:bg-rose-500/20 dark:text-rose-300 dark:ring-rose-500/25',
  slate: 'bg-slate-100 text-slate-600 ring-slate-200/70 dark:bg-slate-700/60 dark:text-slate-300 dark:ring-slate-600/40',
};

export interface ModalHeaderProps {
  /** 左侧语义图标 */
  icon: LucideIcon;
  /** 图标片色调（只影响图标，不影响整条背景） */
  tone?: ModalTone;
  title: React.ReactNode;
  /** 标题右侧的小徽标（如计数、版本号） */
  badge?: React.ReactNode;
  subtitle?: React.ReactNode;
  /** 是否显示关闭按钮；不传 onClose 时不渲染 */
  onClose?: () => void;
  /** 关闭按钮 title / aria-label */
  closeTitle?: string;
  /** 右侧额外操作（刷新等），排在关闭按钮左侧 */
  actions?: React.ReactNode;
  className?: string;
}

export const ModalHeader: React.FC<ModalHeaderProps> = ({
  icon: Icon,
  tone = 'sky',
  title,
  badge,
  subtitle,
  onClose,
  closeTitle = '关闭',
  actions,
  className = '',
}) => (
  <div
    className={`relative flex items-center gap-3 px-4 sm:px-5 py-3 bg-slate-50/80 dark:bg-slate-800/50 border-b border-slate-200/70 dark:border-slate-800 shrink-0 ${className}`}
  >
    <span
      className={`w-9 h-9 rounded-xl ring-1 ring-inset flex items-center justify-center shrink-0 ${TONE_CLASS[tone]}`}
    >
      <Icon className="w-[18px] h-[18px]" />
    </span>

    <div className="min-w-0 flex-1">
      <h3 className="text-[15px] font-black tracking-tight leading-tight text-slate-800 dark:text-slate-100 flex items-center gap-2 flex-wrap">
        <span className="truncate">{title}</span>
        {badge}
      </h3>
      {subtitle && (
        <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium mt-0.5 truncate">{subtitle}</p>
      )}
    </div>

    {(actions || onClose) && (
      <div className="flex items-center gap-1.5 shrink-0">
        {actions}
        {onClose && (
          <button
            type="button"
            aria-label={closeTitle}
            title={closeTitle}
            onClick={() => {
              sound.playClick();
              onClose();
            }}
            className="w-8 h-8 rounded-xl text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-slate-700 flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    )}
  </div>
);

/** 头部小徽标：中性底，交给语义色图标片承载颜色，避免白色/彩色标签过亮。 */
export const ModalHeaderBadge: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = '',
}) => (
  <span
    className={`text-[10px] font-black px-2 py-0.5 rounded-full bg-slate-200/70 dark:bg-slate-700/70 text-slate-600 dark:text-slate-300 ring-1 ring-inset ring-slate-300/60 dark:ring-slate-600/50 ${className}`}
  >
    {children}
  </span>
);
