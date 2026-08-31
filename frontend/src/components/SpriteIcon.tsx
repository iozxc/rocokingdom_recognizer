import React from 'react';
import { getSpriteUrl } from '../services/spriteMeta';

interface SpriteIconProps {
  /** 雪碧图文件名，如 'sprite-1.png'。 */
  name: string;
  col: number;
  row: number;
  cols: number;
  rows: number;
  className?: string;
  alt?: string;
}

/**
 * 从雪碧图渲染单个格子（CSS background 切片）。
 * background-size 用 `cols*100% × rows*100%` + background-position 百分比，
 * 使每格恰好填满容器、随容器响应式缩放，无需像素计算。
 */
export const SpriteIcon: React.FC<SpriteIconProps> = ({
  name,
  col,
  row,
  cols,
  rows,
  className = '',
  alt = '',
}) => {
  const x = cols > 1 ? (col / (cols - 1)) * 100 : 0;
  const y = rows > 1 ? (row / (rows - 1)) * 100 : 0;
  return (
      <div
          className={className}
          role="img"
          aria-label={alt}
          style={{
            backgroundImage: `url(${getSpriteUrl(name)})`,
            backgroundRepeat: 'no-repeat',
            backgroundSize: `${cols * 100}% ${rows * 100}%`,
            backgroundPosition: `${x}% ${y}%`,
          }}
      />
  );
};

export default SpriteIcon;
