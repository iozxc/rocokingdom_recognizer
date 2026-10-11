import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Image as ImageIcon, X } from 'lucide-react';
import { storage } from '../services/storage';
import { sound } from '../services/sound';

interface RecognitionSamplesHintProps {
  onLoadSample: (file: File) => void;
  count?: number;
}

export const RecognitionSamplesHint: React.FC<RecognitionSamplesHintProps> = ({
                                                                                onLoadSample,
                                                                                count = 5,
                                                                            }) => {
  const sampleCount = Math.max(1, Math.min(9, count));
  // 示例截图，按用户要求直接写 ./assets/test1.png ~ test{n}.png
  const SAMPLE_IMAGES = Array.from({ length: sampleCount }, (_, i) => ({
    url: `./assets/test${i + 1}.png`,
    name: `test${i + 1}.png`,
  }));
  const [isVisible, setIsVisible] = useState<boolean>(() => storage.getSetting<boolean>('showRecognitionSamples', true));
  /** 弹层是否展开：桌面端靠鼠标移入/移出，触摸端靠点击按钮。 */
  const [isOpen, setIsOpen] = useState<boolean>(false);
  /** 弹层相对包裹层的左偏移（px）；null = 还没量过，先按「与按钮右对齐」渲染。 */
  const [panelLeft, setPanelLeft] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  /** 每次 +1 触发重新量一次（横竖屏切换、窗口缩放）。 */
  const [measureTick, setMeasureTick] = useState(0);

  // 偏好设置里重新开启后，这里同步恢复显示
  useEffect(() => {
    const unsub = storage.subscribeSettings((settings) => {
      if (typeof settings.showRecognitionSamples === 'boolean') {
        setIsVisible(settings.showRecognitionSamples);
      }
    });
    return () => unsub();
  }, []);

  const open = isVisible && isOpen;

  /**
   * 把弹层夹在视口里。
   *
   * 背景：弹层原来是 `absolute right-0` + 固定 340px 宽 —— 桌面端按钮靠右没问题，
   * 但在手机上这排按钮贴着屏幕左边（标题换行后按钮单独占一行），右对齐的 340px
   * 弹层会整块溢出到屏幕左侧外，用户只能看到右半截（"不再显示"、缩略图都被切掉）。
   * 这里在展开时实测一次按钮位置，把弹层夹到 [8px, 视口宽-8px] 内；桌面端算出来的
   * 位置就是原来的「与按钮右对齐」，行为不变。
   */
  const measurePanel = useCallback(() => {
    const wrap = wrapRef.current;
    const panel = panelRef.current;
    if (!wrap || !panel) return;
    const pad = 8;
    const vw = window.innerWidth;
    const w = Math.min(panel.offsetWidth, Math.max(0, vw - pad * 2));
    const wr = wrap.getBoundingClientRect();
    let left = wr.right - pad - w;      // 先按「右边缘与按钮右边缘对齐」算
    if (left < pad) left = pad;         // 左边贴住视口
    if (left + w > vw - pad) left = Math.max(pad, vw - pad - w); // 右边贴住视口
    setPanelLeft(left - wr.left);
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPanelLeft(null);
      return;
    }
    measurePanel();
  }, [open, measureTick, measurePanel]);

  useEffect(() => {
    if (!open) return;
    const onResize = () => setMeasureTick((v) => v + 1);
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, [open]);

  /**
   * 点弹层以外的地方就收起来。
   * 触摸端没有真正的 hover，展开后浏览器会把 hover 状态一直"粘"在按钮上，
   * 不点一下别处弹层是不会消失的。
   */
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (t && wrapRef.current && wrapRef.current.contains(t)) return;
      setIsOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open]);

  if (!isVisible) return null;

  const handleHide = () => {
    sound.playClick();
    setIsVisible(false);
    setIsOpen(false);
    storage.setSetting('showRecognitionSamples', false);
  };

  const handleClose = () => {
    sound.playClick();
    setIsOpen(false);
  };

  const handleLoadSample = async (url: string, name: string) => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const file = new File([blob], name, { type: blob.type || 'image/png' });
      onLoadSample(file);
    } catch (e) {
      console.warn('示例截图加载失败:', url, e);
    }
  };

  return (
      <div
          ref={wrapRef}
          className="relative"
          onMouseEnter={() => setIsOpen(true)}
          onMouseLeave={() => setIsOpen(false)}
      >
        {/* 按钮：鼠标放上去展示正确截图格式示例 */}
        <button
            type="button"
            id="recognition-samples-hint-btn"
            className="text-xs font-black text-[#2B78C4] dark:text-sky-300 hover:text-white dark:hover:text-white bg-[#EBF4FE] dark:bg-sky-950/60 hover:bg-[#7ABCF4] dark:hover:bg-sky-600 border border-[#BCD7F2] dark:border-sky-800 px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 shadow-2xs cursor-pointer active:scale-95"
            title={`查看正确截图格式示例（${sampleCount} 张）`}
        >
          <ImageIcon className="w-3.5 h-3.5" />
          <span>实例演示</span>
        </button>

        {open && (
            /* 外层 pt-2 把图标与弹层之间的空隙也纳入 hover 区域，避免移过去时弹层消失 */
            <div
                className="absolute top-full pt-2 z-50"
                style={{ left: panelLeft ?? undefined, right: panelLeft == null ? 0 : 'auto' }}
            >
              <div
                  ref={panelRef}
                  className="w-[340px] max-w-[calc(100vw-16px)] max-h-[70vh] overflow-y-auto bg-white dark:bg-slate-900 rounded-2xl border-2 border-[#D5E3F0] dark:border-slate-700 shadow-xl p-3 space-y-2.5"
                  onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-black text-slate-800 dark:text-slate-100">正确截图格式示例</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                      按下面这样截图成功率比较大（包含精灵卡片、图标与名字），点击小图可直接加载识别
                    </p>
                  </div>
                  <div className="shrink-0 flex items-center gap-0.5">
                    <button
                        type="button"
                        onClick={handleHide}
                        className="text-[10px] font-black text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 px-2 py-1 rounded-lg transition-colors cursor-pointer"
                        title="不再显示（可在偏好设置中重新开启）"
                    >
                      不再显示
                    </button>
                    {/* 触摸端没有「移开鼠标」，给一个明确的关闭入口 */}
                    <button
                        type="button"
                        onClick={handleClose}
                        className="w-6 h-6 rounded-lg flex items-center justify-center text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                        title="关闭"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {SAMPLE_IMAGES.map((sample) => (
                      <button
                          key={sample.name}
                          type="button"
                          onClick={() => handleLoadSample(sample.url, sample.name)}
                          className="group flex flex-col items-center gap-1 p-1.5 rounded-xl border-2 border-[#E6EEF8] dark:border-slate-800 hover:border-[#7ABCF4] dark:hover:border-sky-500 hover:bg-[#F5F9FF] dark:hover:bg-slate-800/80 transition-all cursor-pointer"
                          title={`加载 ${sample.name} 测试识别`}
                      >
                        <div className="w-full h-16 rounded-lg bg-[#F8FAFC] dark:bg-slate-950/80 border border-[#E2E8F0] dark:border-slate-800 overflow-hidden flex items-center justify-center">
                          <img
                              src={sample.url}
                              alt={sample.name}
                              className="w-full h-full object-contain"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = 'none';
                              }}
                          />
                        </div>
                        <span className="text-[9px] font-mono font-bold text-slate-400 dark:text-slate-400 group-hover:text-[#2B78C4] dark:group-hover:text-sky-300">
                          {sample.name}
                        </span>
                      </button>
                  ))}
                </div>
              </div>
            </div>
        )}
      </div>
  );
};
