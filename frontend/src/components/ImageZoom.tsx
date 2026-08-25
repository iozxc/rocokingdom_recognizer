import React, { useState, useRef, useEffect } from 'react';

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
 * - trigger='hover' 鼠标悬停显示放大浮层
 * - trigger='click' 点击打开大图模态（点遮罩 / Esc 关闭）
 * - trigger='both' 两者都支持
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

  const handleMouseEnter = () => {
    if (trigger === 'click') return;
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHover(true), hoverDelay);
  };

  const handleMouseLeave = () => {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    setHover(false);
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

  return (
      <>
        <div
            ref={boxRef}
            className={`relative inline-block ${className}`}
            onMouseEnter={handleMouseEnter}
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

          {/* Hover 放大浮层 */}
          {hover && trigger !== 'click' && !modalOpen && (
              <div
                  className="fixed z-[100] pointer-events-none"
                  style={{
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    width: zoomWidth,
                    height: zoomHeight,
                    maxWidth: `calc(100vw - 80px)`,
                    maxHeight: `calc(100vh - 80px)`,
                  }}
              >
                <img
                    src={src}
                    alt={alt}
                    className="w-full h-full object-contain rounded-xl bg-white shadow-2xl border-2 border-[#BCD7F2]"
                />
              </div>
          )}
        </div>

        {/* 点击放大模态（大图 + 遮罩） */}
        {modalOpen && (
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
            </div>
        )}
      </>
  );
};

export default ImageZoom;
