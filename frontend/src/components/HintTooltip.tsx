import React from 'react';

interface HintTooltipProps {
  /** 气泡内的说明文字 / 节点，可多行。 */
  content: React.ReactNode;
  /** 触发元素（一般是标签文字 + 小问号/信息图标）。 */
  children: React.ReactNode;
  /** 气泡出现方向，默认在上方。 */
  side?: 'top' | 'bottom';
  /** 触发包裹层的额外类名。 */
  className?: string;
}

/**
 * 轻量悬停说明气泡：纯 CSS group-hover 实现，替代样式不可控的原生 title。
 * 深色圆角气泡 + 小三角，支持深色模式与换行，出现带 150ms 延迟避免误触。
 * 注意：触发包裹层用 inline-flex，内部文字/图标请自行排版。
 */
export const HintTooltip: React.FC<HintTooltipProps> = ({
  content,
  children,
  side = 'top',
  className = '',
}) => {
  const bubblePos =
    side === 'top'
      ? 'bottom-full left-1/2 -translate-x-1/2 mb-2'
      : 'top-full left-1/2 -translate-x-1/2 mt-2';
  const arrowCls =
    side === 'top'
      ? 'top-full left-1/2 -translate-x-1/2 border-t-slate-800 dark:border-t-slate-700 border-x-transparent border-b-transparent'
      : 'bottom-full left-1/2 -translate-x-1/2 border-b-slate-800 dark:border-b-slate-700 border-x-transparent border-t-transparent';

  return (
    <span className={`group/hint relative inline-flex items-center ${className}`}>
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute z-[200] w-max max-w-[240px] rounded-lg bg-slate-800 px-3 py-2 text-[11px] font-normal leading-relaxed text-white shadow-xl ring-1 ring-white/10 transition-all duration-150 delay-150 invisible opacity-0 group-hover/hint:visible group-hover/hint:opacity-100 dark:bg-slate-700 ${bubblePos}`}
      >
        {content}
        <span className={`absolute h-0 w-0 border-4 ${arrowCls}`} />
      </span>
    </span>
  );
};
