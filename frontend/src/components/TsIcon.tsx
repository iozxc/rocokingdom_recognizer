import React from 'react';
import { IS_STATIC } from '../services/staticMode';
import { getSpriteMeta, getTsSpriteFromUrl } from '../services/spriteMeta';
import { SpriteIcon } from './SpriteIcon';

interface TsIconProps {
  /** 技能/特性图标 URL，如 /ts_icons/S103.png。 */
  url?: string | null;
  alt?: string;
  className?: string;
}

/**
 * 纯前端版从 ts 雪碧图切片渲染技能/特性图标；
 * 桌面版或雪碧图尚未就绪时回退为普通 img。
 */
export const TsIcon: React.FC<TsIconProps> = ({ url, alt = '', className = '' }) => {
  const cell = IS_STATIC ? getTsSpriteFromUrl(url) : null;
  const meta = cell ? getSpriteMeta(cell.sprite) : null;
  if (cell && meta) {
    return (
        <SpriteIcon
            name={cell.sprite}
            col={cell.col}
            row={cell.row}
            cols={meta.cols}
            rows={meta.rows}
            className={className}
            alt={alt}
        />
    );
  }
  if (!url) return null;
  return <img src={url} alt={alt} loading="lazy" className={className} />;
};

export default TsIcon;
