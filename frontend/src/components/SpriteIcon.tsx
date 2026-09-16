import React, { useEffect, useState } from 'react';
import { IS_STATIC } from '../services/staticMode';
import { getSpriteUrl } from '../services/spriteMeta';
import { getSpriteImageUrl } from '../services/spriteLoader';

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
 *
 * web 版（IS_STATIC）雪碧图在构建时被加密，这里通过 spriteLoader 异步获取
 * 解密后的 Blob URL；非 web 版直接用原始 URL。
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
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (IS_STATIC) {
      // web 版：异步加载解密后的雪碧图
      getSpriteImageUrl(name).then((url) => {
        if (!cancelled) setImageUrl(url);
      });
    } else {
      // 桌面版：直接用原始 URL
      setImageUrl(getSpriteUrl(name));
    }
    return () => {
      cancelled = true;
    };
  }, [name]);

  const x = cols > 1 ? (col / (cols - 1)) * 100 : 0;
  const y = rows > 1 ? (row / (rows - 1)) * 100 : 0;

  // 雪碧图尚未加载完成时渲染同尺寸占位（透明），避免布局跳动
  return (
      <div
          className={className}
          role="img"
          aria-label={alt}
          style={{
            backgroundImage: imageUrl ? `url(${imageUrl})` : undefined,
            backgroundColor: imageUrl ? undefined : 'transparent',
            backgroundRepeat: 'no-repeat',
            backgroundSize: `${cols * 100}% ${rows * 100}%`,
            backgroundPosition: `${x}% ${y}%`,
          }}
      />
  );
};

export default SpriteIcon;
