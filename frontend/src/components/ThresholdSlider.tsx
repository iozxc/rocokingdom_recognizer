import React, { CSSProperties } from 'react';

interface ThresholdSliderProps {
  /** 当前值（0~1 的比率，实际数值由 min/max 决定）。 */
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** 主强调色（用于已填充轨道、滑块描边与数值气泡）。 */
  accent?: string;
  /** 外层宽度类（如 w-28、flex-1）。 */
  className?: string;
  /** 是否在滑块上方显示跟随的百分比气泡。 */
  showValue?: boolean;
  /** 轨道左端小标签（如 0.1）。 */
  minLabel?: string;
  /** 轨道右端小标签（如 0.99）。 */
  maxLabel?: string;
}

/**
 * 饱满的「识别门槛」滑动输入：加粗圆润轨道 + 已填充渐变 + 大号可拖拽滑块 + 跟随百分比气泡。
 * 样式通过 .threshold-slider 类在 index.css 中定义，兼容 WebKit / Firefox。
 */
export const ThresholdSlider: React.FC<ThresholdSliderProps> = ({
  value,
  onChange,
  min = 0.1,
  max = 0.99,
  step = 0.05,
  accent = '#7ABCF4',
  className = 'w-32',
  showValue = true,
  minLabel,
  maxLabel,
}) => {
  const percent = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
  const cssVars = {
    '--slider-accent': accent,
  } as CSSProperties;

  return (
      <div className={`relative ${showValue ? 'pt-7' : ''} ${className}`}>
        <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => onChange(parseFloat(e.target.value))}
            className="threshold-slider w-full"
            style={{
              ...cssVars,
              background: `linear-gradient(to right, var(--slider-accent) 0%, var(--slider-accent) ${percent}%, var(--slider-track, #e2e8f0) ${percent}%, var(--slider-track, #e2e8f0) 100%)`,
            }}
        />

        {showValue && (
            <span
                className="pointer-events-none absolute top-0 -translate-x-1/2 select-none rounded-full border px-1.5 py-0.5 text-[10px] font-black shadow-sm transition-all"
                style={{
                  left: `${percent}%`,
                  color: '#ffffff',
                  borderColor: accent,
                  backgroundColor: accent,
                }}
            >
              {Math.round(value * 100)}%
            </span>
        )}

        {(minLabel || maxLabel) && (
            <div className="mt-1 flex items-center justify-between text-[10px] font-bold text-slate-400 dark:text-slate-500">
              <span>{minLabel}</span>
              <span>{maxLabel}</span>
            </div>
        )}
      </div>
  );
};
