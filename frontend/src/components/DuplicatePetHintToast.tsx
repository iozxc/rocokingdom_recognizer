import { useEffect, useRef, useState, type FC } from 'react';
import { createPortal } from 'react-dom';
import { Copy, X } from 'lucide-react';

export interface DupGroup {
  name: string;
  indexes: number[];
}

interface DuplicatePetHintToastProps {
  /** 同一精灵命中多格（按分组展示） */
  hasDuplicateTop1: boolean;
  duplicateGroups: DupGroup[];
  reviewCount: number;
  unencounteredNewCount: number;
  alreadyEncounteredCount: number;
  hasAlreadyWhenAllMatched: boolean;
  /** 点击重复分组标签：切到「全部」核对 */
  onViewGroup: () => void;
  /** 点击「查看已在图鉴的 N 个图位」 */
  onViewAlready: () => void;
  /** 不再提示（写入设置） */
  onDontShow: () => void;
  /** 仅关闭本次（自动消失 / 手动 X） */
  onClose: () => void;
  /** 总停留时长 ms，默认 3000 */
  duration?: number;
}

// 前 HOLD_MS 保持完全可见，之后在剩余时间里渐隐到 0
const HOLD_MS = 1300;

/**
 * 全局顶部「疑似重复精灵」提醒：从顶部滑入、停留一段时间后自动缓缓变淡并消失。
 * 鼠标移上去立即恢复完全可见并暂停计时，移开继续倒计时。
 */
export const DuplicatePetHintToast: FC<DuplicatePetHintToastProps> = ({
  hasDuplicateTop1,
  duplicateGroups,
  reviewCount,
  unencounteredNewCount,
  alreadyEncounteredCount,
  hasAlreadyWhenAllMatched,
  onViewGroup,
  onViewAlready,
  onDontShow,
  onClose,
  duration = 3000,
}) => {
  const remainingRef = useRef<number>(duration);
  const timerRef = useRef<number | null>(null);
  const closedRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [opacity, setOpacity] = useState(1);
  const [hovered, setHovered] = useState(false);

  const fadeMs = Math.max(1, duration - HOLD_MS);
  const opacityFor = (remaining: number) => {
    if (remaining >= HOLD_MS) return 1;
    return Math.max(0, Math.min(1, remaining / fadeMs));
  };

  const stop = () => {
    if (timerRef.current != null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  // 用墙钟时间倒计时（setInterval 驱动），即使页面绘制被节流也不会漂移或卡住
  const start = () => {
    stop();
    const deadline = performance.now() + remainingRef.current;
    timerRef.current = window.setInterval(() => {
      if (closedRef.current) {
        stop();
        return;
      }
      const remaining = deadline - performance.now();
      if (remaining <= 0) {
        remainingRef.current = 0;
        setOpacity(0);
        stop();
        closedRef.current = true;
        onCloseRef.current();
        return;
      }
      remainingRef.current = remaining;
      setOpacity(opacityFor(remaining));
    }, 80);
  };

  // 挂载即开始倒计时
  useEffect(() => {
    start();
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleEnter = () => {
    if (closedRef.current) return;
    setHovered(true);
    stop();
    // 鼠标移入：暂停计时并恢复完全可见（remainingRef 停在暂停瞬间）
    setOpacity(1);
  };

  const handleLeave = () => {
    if (closedRef.current) return;
    setHovered(false);
    start(); // 从暂停时剩余的时间继续
  };

  // 动作按钮：执行后一并关闭本次提示
  const actThenClose = (fn?: () => void) => () => {
    closedRef.current = true;
    stop();
    fn?.();
    onCloseRef.current();
  };

  return createPortal(
    <div
      className="fixed top-[72px] left-1/2 -translate-x-1/2 z-[90] w-[min(94vw,760px)] pointer-events-none"
      data-dup-toast={hovered ? 'hover' : 'auto'}
    >
      <div className="pointer-events-none animate-in slide-in-from-top-2 duration-300">
        <div
          className="pointer-events-auto flex items-start gap-3 rounded-2xl border border-amber-300/80 bg-amber-50/95 dark:bg-amber-950/80 backdrop-blur-sm px-3.5 py-3 shadow-lg shadow-amber-900/10"
          style={{ opacity }}
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
        >
        <div className="mt-0.5 w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center shrink-0">
          <Copy className="w-4 h-4 text-amber-600 dark:text-amber-300" />
        </div>

        <div className="flex-1 min-w-0 text-left">
          <div className="text-xs font-black text-amber-800 dark:text-amber-200">
            可能存在重复精灵，请核对
          </div>
          {hasDuplicateTop1 ? (
            <>
              <p className="mt-0.5 text-[11px] leading-relaxed text-amber-700/90 dark:text-amber-300/90">
                以下图位被识别成了同一只精灵；批量初始化时同一只通常只应有一个，可能是重复或切分/识别有误：
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {duplicateGroups.map((g) => (
                  <button
                    key={g.name}
                    type="button"
                    onClick={actThenClose(onViewGroup)}
                    className="inline-flex items-center gap-1 rounded-full bg-amber-100/80 dark:bg-amber-900/50 border border-amber-300/70 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:text-amber-200 hover:bg-amber-200/80 dark:hover:bg-amber-800/60 cursor-pointer"
                    title="切到「全部」核对这些图位"
                  >
                    {g.name}
                    <span className="font-mono font-black">（图位 {g.indexes.map((i) => i + 1).join('、')}）</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="mt-0.5 text-[11px] leading-relaxed text-amber-700/90 dark:text-amber-300/90">
              本次 {reviewCount} 个图位已全部识别，但「未遇见」只有
              <span className="font-black mx-0.5">{unencounteredNewCount}</span>
              个、还有
              <span className="font-black mx-0.5">{alreadyEncounteredCount}</span>
              个显示「已在图鉴」。批量初始化通常应全是新精灵，这可能是有图位重复或误识别，建议重点核对。
            </p>
          )}
          {!hasDuplicateTop1 && hasAlreadyWhenAllMatched && (
            <button
              type="button"
              onClick={actThenClose(onViewAlready)}
              className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-amber-100/80 dark:bg-amber-900/50 border border-amber-300/70 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:text-amber-200 hover:bg-amber-200/80 dark:hover:bg-amber-800/60 cursor-pointer"
            >
              查看「已在图鉴」的 {alreadyEncounteredCount} 个图位
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={actThenClose(onDontShow)}
            className="text-[10px] font-bold text-amber-700/80 dark:text-amber-300/80 hover:text-amber-900 dark:hover:text-amber-200 underline decoration-dotted underline-offset-2 cursor-pointer"
            title="关闭后不再自动弹出，可在「设置 → 提示与示例」里重新开启"
          >
            不再提示
          </button>
          <button
            type="button"
            onClick={actThenClose()}
            className="w-6 h-6 rounded-full text-amber-700/80 dark:text-amber-300/80 hover:bg-amber-200/70 dark:hover:bg-amber-800/60 flex items-center justify-center cursor-pointer"
            title="仅关闭本次提醒"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
