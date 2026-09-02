import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface ImageZoomProps {
  src: string;
  alt?: string;
  className?: string;
  imgClassName?: string;
  trigger?: 'hover' | 'click' | 'both';
  zoomWidth?: number;
  zoomHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  hoverDelay?: number;   // 悬停预览延迟(ms)，避免过于灵敏
}

/**
 * 精灵图片查看放大组件：
 * - trigger='hover' 鼠标悬停显示放大浮层（跟随鼠标，边缘自动翻转避让）
 * - trigger='click' 点击打开大图模态（点遮罩 / Esc 关闭）
 * - trigger='both' 两者都支持
 *
 * 关键：悬浮预览与点击模态都通过 React Portal 挂到 document.body，
 * 避免被父容器（卡片带 opacity / overflow-hidden / backdrop-blur / transform 等）
 * 形成包含块而困住 / 裁切，导致预览“沉底、发虚、跑到卡片后面”。
 */
export const ImageZoom: React.FC<ImageZoomProps> = ({
  src,
  alt = '',
  className = '',
  imgClassName = '',
  trigger = 'both',
  zoomWidth = 320,
  zoomHeight = 320,
  maxWidth = 90,
  maxHeight = 90,
  hoverDelay = 250,
}) => {
  const [hover, setHover] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClick = () => {
    if (trigger === 'click' || trigger === 'both') {
      setModalOpen(true);
    }
  };

  const handleImgClick = (e: React.MouseEvent) => {
    e.stopPropagation();  // 防止冒泡触发外层(如候选 button)的 onSelect
    handleClick();
  };

  const closeModal = () => setModalOpen(false);

  const handleMouseEnter = (e: React.MouseEvent) => {
    if (trigger === 'click') return;
    setPos({ x: e.clientX, y: e.clientY });
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHover(true), hoverDelay);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    setPos({ x: e.clientX, y: e.clientY });
  };

  const handleMouseLeave = () => {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    setHover(false);
    setPos(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeModal();
    };
    if (modalOpen) {
      window.addEventListener('keydown', onKey);
    }
    return () => window.removeEventListener('keydown', onKey);
  }, [modalOpen]);

  // 悬浮预览跟随鼠标，并靠近窗口边缘时翻转避让
  const preview = hover && trigger !== 'click' && !modalOpen && pos;
  let previewStyle: React.CSSProperties | null = null;
  if (preview) {
    const GAP = 18;
    const vw = (typeof window !== 'undefined' ? window.innerWidth : 1024) ?? 1024;
    const vh = (typeof window !== 'undefined' ? window.innerHeight : 768) ?? 768;
    const w = Math.min(zoomWidth, vw - 80);
    const h = Math.min(zoomHeight, vh - 80);
    let left = pos.x + GAP;
    let top = pos.y + GAP;
    // 右侧放不下 -> 放到鼠标左侧
    if (left + w > vw - 8) left = pos.x - GAP - w;
    // 底部放不下 -> 放到鼠标上方
    if (top + h > vh - 8) top = pos.y - GAP - h;
    left = Math.max(8, left);
    top = Math.max(8, top);
    previewStyle = {
      position: 'fixed',
      left,
      top,
      width: w,
      height: h,
      maxWidth: `calc(100vw - 80px)`,
      maxHeight: `calc(100vh - 80px)`,
    };
  }

  return (
      <>
        <div
            ref={boxRef}
            className={`relative inline-block ${className}`}
            onMouseEnter={handleMouseEnter}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            onClick={handleImgClick}
        >
          <img
              src={src}
              alt={alt}
              className={`${imgClassName} cursor-zoom-in`}
              onError={(e) => {
                (e.target as HTMLImageElement).style.opacity = '0.25';
              }}
          />
        </div>

        {/* Hover 放大浮层：Portal 到 body，彻底脱离卡片包含块 */}
        {preview && previewStyle && typeof document !== 'undefined' &&
            createPortal(
                <div
                    className="fixed z-[100] pointer-events-none"
                    style={previewStyle}
                >
                  <img
                      src={src}
                      alt={alt}
                      className="w-full h-full object-contain rounded-xl bg-white shadow-2xl border-2 border-[#BCD7F2]"
                  />
                </div>,
                document.body
            )}

        {/* 点击放大模态（大图 + 遮罩）：同样 Portal 到 body */}
        {modalOpen && typeof document !== 'undefined' &&
            createPortal(
                <div
                    className="fixed inset-0 z-[200] flex items-center justify-center"
                    style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}
                    onClick={closeModal}
                >
                  <div
                      className="relative bg-white rounded-2xl shadow-2xl border-2 border-[#7ABCF4] p-3"
                      style={{ maxWidth: maxWidth + 'vw', maxHeight: maxHeight + 'vh' }}
                      onClick={(e) => e.stopPropagation()}
                  >
                    <button
                        type="button"
                        onClick={closeModal}
                        className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-[#7ABCF4] text-white font-black text-lg shadow-md hover:bg-[#5DA8E8] cursor-pointer"
                        title="关闭"
                    >
                      ×
                    </button>
                    <img
                        src={src}
                        alt={alt}
                        className="max-w-full max-h-full object-contain rounded-xl"
                        style={{ maxWidth: `${maxWidth}vw`, maxHeight: `${maxHeight}vh` }}
                    />
                  </div>
                </div>,
                document.body
            )}
      </>
  );
};

export default ImageZoom;
