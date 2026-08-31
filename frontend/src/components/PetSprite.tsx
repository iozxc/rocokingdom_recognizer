import React from 'react';
import { IS_STATIC } from '../services/staticMode';
import { getSpriteMeta } from '../services/spriteMeta';
import { PetItem } from '../types';
import { SpriteIcon } from './SpriteIcon';

interface PetSpriteProps {
  pet?: PetItem | null;
  /** 无雪碧信息/桌面时使用的回退地址（通常为 pet.url）。 */
  url?: string;
  className?: string;
  alt?: string;
}

/**
 * 精灵图标：web（IS_STATIC）且带雪碧图坐标时用雪碧图切片；否则用普通 <img>。
 * 雪碧图元信息在 getIcons() 时已预载，因此这里同步读取，不会闪烁。
 */
export const PetSprite: React.FC<PetSpriteProps> = ({ pet, url, className = '', alt = '' }) => {
  if (!IS_STATIC || !pet?.sprite) {
    const src = url || pet?.url || '';
    return <img src={src} alt={alt} className={className} draggable={false} loading="lazy" />;
  }
  const meta = getSpriteMeta(pet.sprite);
  if (!meta || pet.col == null || pet.row == null) {
    const src = url || pet?.url || '';
    return <img src={src} alt={alt} className={className} draggable={false} loading="lazy" />;
  }
  return (
      <SpriteIcon
          name={pet.sprite}
          col={pet.col}
          row={pet.row}
          cols={meta.cols}
          rows={meta.rows}
          className={className}
          alt={alt}
      />
  );
};

export default PetSprite;
