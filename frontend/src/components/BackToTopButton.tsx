import React from 'react';
import { ChevronUp } from 'lucide-react';
import { sound } from '../services/sound';

/**
 * 「回到顶部」按钮（常驻，与右下角其它悬浮按钮一起显示）。
 *
 * 右下角快捷功能悬浮栏（GlobalFloatingSearch）有 4 种形态，分别嵌入：
 *   1. 展开形态（跟随识别 / 数据管理 / 全域搜索 文字胶囊）：放进顶部小工具行 —— <BackToTopHeaderButton/>
 *   2. 收起形态（单个搜索圆球）：在圆球上方叠一个小圆 —— <BackToTopCircle size="sm"/>
 *   3. 精简形态（一排纯图标圆钮）：在整列最上方叠一个圆 —— <BackToTopCircle size="md"/>
 *   4. 悬浮栏隐藏（按钮收纳到顶部 SubHeaderToolbar）：独立固定在右下角 —— <BackToTopStandalone/>
 */

function scrollToTop() {
  sound.playClick();
  const prefersReduced =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: 0, behavior: prefersReduced ? 'auto' : 'smooth' });
}

/** 展开形态：顶部小工具行里的小方块，样式与「收起 ›」按钮完全同款 */
export const BackToTopHeaderButton: React.FC = () => {
  return (
    <>
      <button
        type="button"
        onClick={scrollToTop}
        title="回到顶部"
        aria-label="回到顶部"
        className="w-7 h-7 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 flex items-center justify-center transition-colors cursor-pointer"
      >
        <ChevronUp className="w-4 h-4" strokeWidth={2.5} />
      </button>
      <div className="w-px h-4 bg-slate-200 dark:bg-slate-600 mx-0.5" />
    </>
  );
};

/** 圆形图标按钮（用于收起 / 精简形态的图标列）。size=md 44px、sm 40px。 */
export const BackToTopCircle: React.FC<{ size?: 'sm' | 'md' }> = ({ size = 'md' }) => {
  const dim = size === 'sm' ? 'w-10 h-10' : 'w-11 h-11';
  return (
    <button
      type="button"
      onClick={scrollToTop}
      title="回到顶部"
      aria-label="回到顶部"
      className={`${dim} rounded-full bg-gradient-to-br from-slate-400 to-slate-500 hover:from-slate-500 hover:to-slate-600 text-white flex items-center justify-center shadow-xl shadow-slate-500/20 border-2 border-white dark:border-slate-700 transition-transform hover:scale-110 hover:-translate-y-0.5 active:scale-95 cursor-pointer`}
    >
      <ChevronUp className="w-5 h-5" strokeWidth={2.6} />
    </button>
  );
};

/** 悬浮栏隐藏（按钮收纳到顶部工具栏）时：独立固定在右下角 */
export const BackToTopStandalone: React.FC = () => {
  return (
    <div className="fixed bottom-6 right-6 z-40 flex flex-col items-center gap-2 select-none">
      <button
        type="button"
        onClick={scrollToTop}
        title="回到顶部"
        aria-label="回到顶部"
        className="w-11 h-11 rounded-full bg-gradient-to-br from-slate-400 to-slate-500 hover:from-slate-500 hover:to-slate-600 text-white flex items-center justify-center shadow-xl shadow-slate-500/20 border-2 border-white dark:border-slate-700 transition-transform hover:scale-110 hover:-translate-y-0.5 active:scale-95 cursor-pointer"
      >
        <ChevronUp className="w-5 h-5" strokeWidth={2.6} />
      </button>
    </div>
  );
};
