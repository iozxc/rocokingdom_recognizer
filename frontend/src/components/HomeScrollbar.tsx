
import React, { useCallback, useEffect, useRef, useState } from 'react';

interface HomeScrollbarProps {
  visible: boolean;
  width?: number;
}

interface ScrollMetrics {
  scrollTop: number;
  maxScroll: number;
  viewportHeight: number;
  headerHeight: number;
}

const TOP_GAP = 8;
const BOTTOM_GAP = 12;
const MIN_THUMB_HEIGHT = 36;

/**
 * 首页右侧的自定义滚动条（不使用浏览器原生滚动条样式）。
 * - 固定放在视口右侧、Header 下方，因此不会“触及” Header。
 * - 仅作为文档级滚动进度 / 拖拽控制条，不改变原有页面滚动方式。
 */
export const HomeScrollbar: React.FC<HomeScrollbarProps> = ({ visible, width }) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{
    startClientY: number;
    startThumbTop: number;
  } | null>(null);
  const [metrics, setMetrics] = useState<ScrollMetrics>({
    scrollTop: 0,
    maxScroll: 0,
    viewportHeight: 0,
    headerHeight: 0,
  });

  const metricsRef = useRef(metrics);
  metricsRef.current = metrics;

  const { scrollTop, maxScroll, viewportHeight, headerHeight } = metrics;
  const trackTop = headerHeight + TOP_GAP;
  const trackBottom = BOTTOM_GAP;
  const trackHeight = Math.max(0, viewportHeight - trackTop - trackBottom);
  const canScroll = maxScroll > 0 && trackHeight > 0;
  const scrollbarWidth = Math.max(4, Math.min(16, Math.round(width || 10)));
  const docHeight = viewportHeight + maxScroll;
  const thumbRatio = canScroll ? Math.min(1, viewportHeight / docHeight) : 0;
  const thumbHeight = canScroll ? Math.max(MIN_THUMB_HEIGHT, Math.round(trackHeight * thumbRatio)) : 0;
  const range = canScroll ? trackHeight - thumbHeight : 0;
  const progress = canScroll && range > 0 ? Math.min(1, Math.max(0, scrollTop / maxScroll)) : 0;
  const thumbTop = canScroll ? Math.round(progress * range) : 0;

  const measure = useCallback(() => {
    const headerEl = document.querySelector<HTMLElement>('header');
    const headerHeight = headerEl ? headerEl.getBoundingClientRect().height : 0;
    const viewportHeight = window.innerHeight;
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - viewportHeight);
    const scrollTop = Math.min(window.scrollY, maxScroll);
    setMetrics({ scrollTop, maxScroll, viewportHeight, headerHeight });
  }, []);

  useEffect(() => {
    if (!visible) return;
    measure();
    const onScroll = () => {
      const { maxScroll: currentMaxScroll } = metricsRef.current;
      setMetrics((prev) => ({ ...prev, scrollTop: Math.min(window.scrollY, currentMaxScroll) }));
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', measure);

    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined' && document.body) {
      observer = new ResizeObserver(measure);
      observer.observe(document.body);
      const headerEl = document.querySelector<HTMLElement>('header');
      if (headerEl) observer.observe(headerEl);
    }
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [visible, measure]);

  useEffect(() => {
    if (!dragging) return;
    const handlePointerMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || !trackRef.current) return;
      const delta = e.clientY - drag.startClientY;
      const currentRange = trackRef.current.clientHeight - thumbHeight;
      const nextThumbTop = Math.min(currentRange, Math.max(0, drag.startThumbTop + delta));
      const currentProgress = currentRange > 0 ? nextThumbTop / currentRange : 0;
      const currentMaxScroll = metricsRef.current.maxScroll;
      window.scrollTo(0, currentProgress * currentMaxScroll);
      setMetrics((prev) => ({ ...prev, scrollTop: Math.min(currentProgress * currentMaxScroll, currentMaxScroll) }));
    };
    const handlePointerUp = () => {
      dragRef.current = null;
      setDragging(false);
      document.body.classList.remove('home-scrollbar-dragging');
    };
    document.body.classList.add('home-scrollbar-dragging');
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
      document.body.classList.remove('home-scrollbar-dragging');
    };
  }, [dragging, thumbHeight]);

  if (!visible || !canScroll) return null;

  const scrollToProgress = (nextProgress: number) => {
    const next = Math.min(1, Math.max(0, nextProgress));
    window.scrollTo(0, next * maxScroll);
    setMetrics((prev) => ({ ...prev, scrollTop: Math.min(next * maxScroll, maxScroll) }));
  };

  const handleTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !trackRef.current) return;
    e.preventDefault();
    const rect = trackRef.current.getBoundingClientRect();
    const clickY = e.clientY - rect.top;
    const rawProgress = range > 0 ? (clickY - thumbHeight / 2) / range : 0;
    scrollToProgress(rawProgress);

    dragRef.current = {
      startClientY: e.clientY,
      startThumbTop: Math.max(0, Math.min(range, clickY - thumbHeight / 2)),
    };
    setDragging(true);
  };

  const handleThumbPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !trackRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      startClientY: e.clientY,
      startThumbTop: thumbTop,
    };
    setDragging(true);
  };

  return (
      <div
          className="pointer-events-none fixed z-[60] flex justify-end"
          style={{ top: trackTop, bottom: trackBottom, right: 0, width: scrollbarWidth + 12 }}
          aria-label="首页滚动条"
      >
        <div
            ref={trackRef}
            role="scrollbar"
            aria-orientation="vertical"
            aria-valuemin={0}
            aria-valuemax={maxScroll}
            aria-valuenow={Math.round(scrollTop)}
            onPointerDown={handleTrackPointerDown}
            style={{ width: scrollbarWidth }}
            className="pointer-events-auto relative rounded-full bg-slate-200/50 dark:bg-slate-700/50 hover:bg-slate-200/90 dark:hover:bg-slate-700/80 transition-colors duration-150 select-none touch-none cursor-pointer"
        >
          <div
              onPointerDown={handleThumbPointerDown}
              className="absolute left-0 right-0 rounded-full bg-[#BCD7F2] dark:bg-slate-500 border border-[#E6EEF8]/80 dark:border-slate-600/80 hover:bg-[#7ABCF4] dark:hover:bg-slate-400 cursor-grab active:cursor-grabbing transition-colors duration-100"
              style={{ top: thumbTop, height: thumbHeight }}
          />
        </div>
      </div>
  );
};
