import React, { useState } from 'react';
import { getElementColor, getElementIconUrl } from '../utils/elements';

interface ElementBadgesProps {
  /** 属性列表（中文），如 ['光'] 或 ['光','火']；第一个为主属性。 */
  elements?: string[];
  /** 叠加在上层容器时的定位 className（如 'absolute top-1 left-1 z-10'）。 */
  className?: string;
  /** 尺寸：xs 用于小候选图，sm 用于卡片左上角，md 用于详情页。 */
  size?: 'xs' | 'sm' | 'md';
  /** 布局：false 纵向堆叠（卡片左上角），true 横向排布（详情页居中）。 */
  horizontal?: boolean;
}

/** 单个属性图标：优先显示官方图标，失败时回退彩色徽章。 */
const ElementBadge: React.FC<{ element: string; size: 'xs' | 'sm' | 'md' }> = ({ element, size }) => {
  const [failed, setFailed] = useState(false);
  const style = getElementColor(element);
  const px = size === 'md' ? 24 : size === 'sm' ? 16 : 12;
  const fallbackCls =
      size === 'md' ? 'text-[11px] px-2 py-0.5'
          : size === 'sm' ? 'text-[9px] px-1.5 py-0.5'
              : 'text-[8px] px-1 py-0.5';

  if (failed) {
    return (
        <span
            title={element}
            className={`inline-flex items-center justify-center rounded-full font-black text-white shadow-sm ring-1 ring-white/70 select-none ${fallbackCls}`}
            style={{ backgroundColor: style.bg, color: style.fg || '#ffffff' }}
        >
          {element}
        </span>
    );
  }

  return (
      <img
          src={getElementIconUrl(element)}
          alt={element}
          title={element}
          className="inline-block rounded-full object-contain shadow-sm ring-1 ring-white/60"
          style={{ width: px, height: px }}
          onError={() => setFailed(true)}
      />
  );
};

/**
 * 展示精灵的属性（单属性一个、双属性两个，均使用官方属性图标）。
 * 图标缺失时自动回退为彩色文字徽章，避免空白。
 */
export const ElementBadges: React.FC<ElementBadgesProps> = ({
  elements,
  className,
  size = 'sm',
  horizontal = false,
}) => {
  const list = (elements || []).filter((el) => el && el.trim());
  if (!list.length) return null;

  const layoutCls = horizontal ? 'flex-row items-center' : 'flex-col items-start';

  return (
      <div className={`flex ${layoutCls} gap-1 ${className || ''}`}>
        {list.map((el, i) => (
            <ElementBadge key={`${el}-${i}`} element={el} size={size} />
        ))}
      </div>
  );
};
