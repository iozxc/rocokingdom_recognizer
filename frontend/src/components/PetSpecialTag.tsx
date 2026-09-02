import React from 'react';
import { Crown, Layers } from 'lucide-react';
import { getPetSpecialType } from '../utils/petHelper';

interface PetSpecialTagProps {
  /** 可传入 PetItem（含 id/seq）或纯文件名，用于判定是否为多形态/首领化。 */
  pet?: { name?: string; id?: number | null; seq?: number | null } | null;
  filename?: string;
  className?: string;
  /** 仅显示图标（不显示文字/胶囊背景），用于紧凑位置的角标。 */
  iconOnly?: boolean;
}

/**
 * 「首领化 / 多形态」警告标签：在识别结果中提醒用户这些精灵容易分辨错。
 * 图标使用内置矢量图标（Crown / Layers），避免额外图片请求；
 * tools/wiki/fetch_special_icons.py 可用来发现官方标志图标，找到后再接入。
 */
export const PetSpecialTag: React.FC<PetSpecialTagProps> = ({ pet, filename, className = '', iconOnly = false }) => {
  const type = getPetSpecialType(pet, filename);
  if (!type) return null;

  const isBoss = type === 'boss';
  const label = isBoss ? '首领化' : '多形态';
  const colorCls = isBoss
      ? 'text-rose-600 dark:text-rose-300'
      : 'text-amber-700 dark:text-amber-300';

  if (iconOnly) {
    return (
        <span
            className={`inline-flex items-center align-middle shrink-0 ${colorCls} ${className}`}
            title={isBoss ? '首领化精灵，形态/特征易混淆' : '多形态精灵，存在多种形态易分辨错'}
        >
          {isBoss ? <Crown className="w-3 h-3 stroke-[3]" /> : <Layers className="w-3 h-3 stroke-[3]" />}
        </span>
    );
  }

  // 品牌色：首领化用金红，多形态用琥珀
  const cls = isBoss
      ? 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-800'
      : 'bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-700';

  return (
      <span
          className={`inline-flex items-center gap-1 text-[10px] font-black px-1.5 py-0.5 rounded-md border leading-none select-none shrink-0 align-middle ${cls} ${className}`}
          title={isBoss ? '首领化精灵，形态/特征易与其他形态混淆' : '多形态精灵，存在多种形态易分辨错'}
      >
        {isBoss ? (
            <Crown className="w-3 h-3 stroke-[3]" />
        ) : (
            <Layers className="w-3 h-3 stroke-[3]" />
        )}
        <span>{label}</span>
      </span>
  );
};
