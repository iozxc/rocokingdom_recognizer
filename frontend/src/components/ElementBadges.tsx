import React, { useState } from 'react';
import { getElementColor, getElementIconUrl } from '../utils/elements';
import { IS_STATIC } from '../services/staticMode';
import { getElementSprite, getSpriteMeta } from '../services/spriteMeta';
import { SpriteIcon } from './SpriteIcon';

interface ElementBadgesProps {
  /** 属性列表（中文），如 ['光'] 或 ['光','火']；第一个为主属性。 */
  elements?: string[];
  /** 叠加在上层容器时的定位 className（如 'absolute top-1 left-1 z-10'）。 */
  className?: string;
  /** 尺寸：xs 用于超小预览，sm 用于卡片左上角（大而清晰），md 用于详情/大卡，lg 用于特写。 */
  size?: 'xs' | 'sm' | 'md' | 'lg';
  /** 布局：false 纵向堆叠（卡片左上角），true 横向排布（详情页居中）。 */
  horizontal?: boolean;
}

/** 单个属性图标：优先显示官方图标，失败时回退彩色徽章。 */
const ElementBadge: React.FC<{ element: string; size: 'xs' | 'sm' | 'md' | 'lg' }> = ({ element, size }) => {
  const [failed, setFailed] = useState(false);
  const style = getElementColor(element);
  const px = size === 'lg' ? 30 : size === 'md' ? 24 : size === 'sm' ? 20 : 14;
  const sizeCls = size === 'lg' ? 'w-7.5 h-7.5' : size === 'md' ? 'w-6 h-6' : size === 'sm' ? 'w-5 h-5' : 'w-3.5 h-3.5';
  const fallbackCls =
      size === 'lg' ? 'text-xs px-2.5 py-0.5'
          : size === 'md' ? 'text-[11px] px-2 py-0.5'
              : size === 'sm' ? 'text-[10px] px-1.5 py-0.5'
                  : 'text-[8px] px-1 py-0.5';

  if (failed) {
    return (
        <span
            title={element}
            className={`inline-flex items-center justify-center rounded-full font-black text-white shadow-sm select-none ${fallbackCls}`}
            style={{ backgroundColor: style.bg, color: style.fg || '#ffffff' }}
        >
          {element}
        </span>
    );
  }

  // web 版：用属性雪碧图切片（18 系别基本不变）
  if (IS_STATIC) {
    const es = getElementSprite(element);
    const meta = es ? getSpriteMeta(es.sprite) : null;
    if (es && meta) {
      return (
          <SpriteIcon
              name={es.sprite}
              col={es.col}
              row={es.row}
              cols={meta.cols}
              rows={meta.rows}
              className={`inline-block rounded-full shadow-sm shrink-0 ${sizeCls}`}
              alt={element}
          />
      );
    }
    return (
        <span
            title={element}
            className={`inline-flex items-center justify-center rounded-full font-black text-white shadow-sm select-none ${fallbackCls}`}
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
          className="inline-block rounded-full object-contain shadow-sm shrink-0"
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
