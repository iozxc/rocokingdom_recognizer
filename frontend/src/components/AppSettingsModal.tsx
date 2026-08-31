import React, { useState, useEffect, useRef } from 'react';
import { X, ChevronLeft, Volume2, VolumeX, Database, ArrowRight, ArrowUpCircle, Sparkles, Monitor, Camera, Image as ImageIcon, Settings2, ShieldCheck, ChevronDown } from 'lucide-react';
import { EffectLevel, FloatingButtonsMode, CaptureMode } from '../types';
import { sound } from '../services/sound';
import { storage } from '../services/storage';
import { useUpdateStore } from '../services/useUpdateStore';
import { IS_STATIC } from '../services/staticMode';
import { SyncPopType } from './SyncPopNotification';
import { UserAgreementModal } from './UserAgreementModal';

interface AppSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTestEffect?: (level: EffectLevel, type?: SyncPopType) => void;
  onOpenDataBackup?: () => void;
  onOpenDataUpdate?: () => void;
}

export const AppSettingsModal: React.FC<AppSettingsModalProps> = ({
                                                                    isOpen,
                                                                    onClose,
                                                                    onOpenDataBackup,
                                                                    onOpenDataUpdate,
                                                                  }) => {
  const updateState = useUpdateStore();
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [canScrollDown, setCanScrollDown] = useState<boolean>(false);
  const [effectLevel, setEffectLevel] = useState<EffectLevel>(() => {
    return storage.getSetting<EffectLevel>('effectLevel', 0);
  });
  const [floatingMode, setFloatingMode] = useState<FloatingButtonsMode>(() => {
    return storage.getSetting<FloatingButtonsMode>('floatingButtonsMode', 'normal');
  });
  const [isSoundMuted, setIsSoundMuted] = useState<boolean>(() => {
    return storage.getSetting<boolean>('isSoundMuted', false);
  });
  const [captureMode, setCaptureMode] = useState<CaptureMode>(() => {
    return storage.getSetting<CaptureMode>('captureMode', 'grab');
  });
  const [showSamples, setShowSamples] = useState<boolean>(() => {
    return storage.getSetting<boolean>('showRecognitionSamples', true);
  });
  const [updateMode, setUpdateMode] = useState<'auto' | 'full'>(() => {
    return storage.getSetting<'auto' | 'full'>('updateMode', 'auto');
  });
  const [view, setView] = useState<'main' | 'update' | 'system'>('main');
  const [exiting, setExiting] = useState<boolean>(false);
  const [autoCheckUpdate, setAutoCheckUpdate] = useState<boolean>(() => {
    return storage.getSetting<boolean>('autoCheckUpdate', true);
  });
  const [hideUpdateDot, setHideUpdateDot] = useState<boolean>(() => {
    return storage.getSetting<boolean>('hideUpdateDot', false);
  });
  const [showHints, setShowHints] = useState<boolean>(() => {
    return storage.getSetting<boolean>('showHints', false);
  });
  const [followTopMost, setFollowTopMost] = useState<boolean>(() => {
    return storage.getSetting<boolean>('followTopMost', true);
  });
  const [isSimplifiedFABs, setIsSimplifiedFABs] = useState<boolean>(() => {
    return storage.getSetting<boolean>('isSimplifiedFABs', true);
  });
  const [isAgreementOpen, setIsAgreementOpen] = useState<boolean>(false);

  // Sync settings updates
  useEffect(() => {
    const unsubscribe = storage.subscribeSettings((settings) => {
      if (typeof settings.effectLevel === 'number') setEffectLevel(settings.effectLevel as EffectLevel);
      if (settings.floatingButtonsMode) setFloatingMode(settings.floatingButtonsMode);
      if (typeof settings.isSoundMuted === 'boolean') setIsSoundMuted(settings.isSoundMuted);
      if (settings.captureMode === 'hwnd' || settings.captureMode === 'grab') setCaptureMode(settings.captureMode);
      if (typeof settings.showRecognitionSamples === 'boolean') setShowSamples(settings.showRecognitionSamples);
      if (settings.updateMode === 'auto' || settings.updateMode === 'full') setUpdateMode(settings.updateMode);
      if (typeof settings.autoCheckUpdate === 'boolean') setAutoCheckUpdate(settings.autoCheckUpdate);
      if (typeof settings.hideUpdateDot === 'boolean') setHideUpdateDot(settings.hideUpdateDot);
      if (typeof settings.showHints === 'boolean') setShowHints(settings.showHints);
      if (typeof settings.followTopMost === 'boolean') setFollowTopMost(settings.followTopMost);
      if (typeof settings.isSimplifiedFABs === 'boolean') setIsSimplifiedFABs(settings.isSimplifiedFABs);
    });
    return () => unsubscribe();
  }, []);

  // 每次打开弹窗时从 storage 同步最新值（确保远程数据加载后能及时更新）
  useEffect(() => {
    if (!isOpen) return;
    setEffectLevel(storage.getSetting<EffectLevel>('effectLevel', 0));
    setFloatingMode(storage.getSetting<FloatingButtonsMode>('floatingButtonsMode', 'normal'));
    setIsSoundMuted(storage.getSetting<boolean>('isSoundMuted', false));
    const savedCaptureMode = storage.getSetting<CaptureMode>('captureMode', 'grab');
    if (savedCaptureMode === 'hwnd' || savedCaptureMode === 'grab') {
      setCaptureMode(savedCaptureMode);
    }
    setShowSamples(storage.getSetting<boolean>('showRecognitionSamples', true));
    const savedUpdateMode = storage.getSetting<'auto' | 'full'>('updateMode', 'auto');
    if (savedUpdateMode === 'auto' || savedUpdateMode === 'full') {
      setUpdateMode(savedUpdateMode);
    }
    setAutoCheckUpdate(storage.getSetting<boolean>('autoCheckUpdate', true));
    setHideUpdateDot(storage.getSetting<boolean>('hideUpdateDot', false));
    setShowHints(storage.getSetting<boolean>('showHints', false));
    setFollowTopMost(storage.getSetting<boolean>('followTopMost', true));
    setIsSimplifiedFABs(storage.getSetting<boolean>('isSimplifiedFABs', true));
    setView('main');
  }, [isOpen]);

  // 监听容器滚动，动态更新是否可以继续往下滑动
  const checkScrollable = () => {
    const el = contentRef.current;
    if (!el) return;
    const canScroll = el.scrollHeight - el.scrollTop - el.clientHeight > 30;
    setCanScrollDown(canScroll);
  };

  useEffect(() => {
    if (!isOpen) return;
    // 视图切换或打开时初始化检查一次
    const timer = setTimeout(checkScrollable, 100);
    return () => clearTimeout(timer);
  }, [isOpen, view]);

  // Keyboard shortcut ESC to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSelectEffect = (level: EffectLevel) => {
    sound.playClick();
    setEffectLevel(level);
    storage.setSetting('effectLevel', level);
  };

  const handleBack = () => {
    if (view === 'main') return;
    sound.playClick();
    setExiting(true);
    window.setTimeout(() => {
      setView('main');
      setExiting(false);
    }, 200);
  };


  const handleSelectFloatingMode = (mode: FloatingButtonsMode) => {
    sound.playClick();
    setFloatingMode(mode);
    storage.setSetting('floatingButtonsMode', mode);
  };

  const handleToggleSound = () => {
    const newMuted = !isSoundMuted;
    setIsSoundMuted(newMuted);
    storage.setSetting('isSoundMuted', newMuted);
    if (!newMuted) {
      sound.playClick();
    }
  };

  const handleSelectCaptureMode = (mode: CaptureMode) => {
    sound.playClick();
    setCaptureMode(mode);
    storage.setSetting('captureMode', mode);
  };

  const handleToggleSamples = () => {
    sound.playClick();
    const next = !showSamples;
    setShowSamples(next);
    storage.setSetting('showRecognitionSamples', next);
  };

  const handleSelectUpdateMode = (mode: 'auto' | 'full') => {
    sound.playClick();
    setUpdateMode(mode);
    storage.setSetting('updateMode', mode);
  };

  const handleToggleAutoCheck = () => {
    sound.playClick();
    const next = !autoCheckUpdate;
    setAutoCheckUpdate(next);
    storage.setSetting('autoCheckUpdate', next);
  };

  const handleToggleHideDot = () => {
    sound.playClick();
    const next = !hideUpdateDot;
    setHideUpdateDot(next);
    storage.setSetting('hideUpdateDot', next);
  };

  const handleToggleHints = () => {
    sound.playClick();
    const next = !showHints;
    setShowHints(next);
    storage.setSetting('showHints', next);
  };

  const handleToggleSimplifiedFABs = () => {
    sound.playClick();
    const next = !isSimplifiedFABs;
    setIsSimplifiedFABs(next);
    storage.setSetting('isSimplifiedFABs', next);
  };

  const handleToggleFollowTopMost = () => {
    sound.playClick();
    const next = !followTopMost;
    setFollowTopMost(next);
    storage.setSetting('followTopMost', next);
    // 同步应用到当前已打开的跟随识别窗口（若未打开则忽略）
    try {
      const pyApi = (window as any).pywebview?.api;
      if (pyApi?.set_scanner_topmost) {
        pyApi.set_scanner_topmost(next).catch(() => {});
      }
    } catch {
      /* ignore */
    }
  };

  return (
      <>
      <div
          id="app-settings-modal-backdrop"
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={onClose}
      >
        <div
            id="app-settings-modal-dialog"
            className="w-full max-w-md max-h-[88vh] sm:max-h-[85vh] bg-white rounded-2xl border border-slate-200/80 shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between bg-slate-50/70 shrink-0">
            <div className="flex items-center gap-2">
              {view !== 'main' && (
                  <button
                      type="button"
                      id="app-settings-back-btn"
                      onClick={handleBack}
                      className="w-7 h-7 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 flex items-center justify-center transition-colors cursor-pointer"
                      title="返回"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
              )}
              <h3 className="text-sm font-bold text-slate-800 tracking-tight">
                {view === 'update' ? '更新设置' : view === 'system' ? '系统设置' : '偏好设置'}
              </h3>
            </div>
            <button
                type="button"
                id="app-settings-close-btn"
                onClick={() => {
                  sound.playClick();
                  onClose();
                }}
                className="w-7 h-7 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 flex items-center justify-center transition-colors cursor-pointer"
                title="关闭 (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Content：主菜单与二级菜单横向滑动切换，支持纵向自适应滚动（隐藏滚动条） */}
          <div
              ref={contentRef}
              onScroll={checkScrollable}
              className="relative grid flex-1 min-h-0 overflow-y-auto overflow-x-hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
          >
            <div key={`sub-${view}`} className={`col-start-1 row-start-1 p-4 sm:p-5 space-y-4 sm:space-y-5 text-xs text-slate-600 ${view === 'main' ? 'hidden' : (exiting ? 'animate-out fade-out slide-out-to-right duration-200' : 'animate-in fade-in slide-in-from-right duration-300')}`}>
            {view === 'update' ? (
                <div className="space-y-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-semibold text-slate-800">启动时自动检测更新</div>
                      <div className="text-[10px] text-slate-400">每次打开应用时后台静默检查一次新版本</div>
                    </div>
                    <button
                        type="button"
                        id="auto-check-switch-btn"
                        onClick={handleToggleAutoCheck}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${autoCheckUpdate ? 'bg-[#95D151]' : 'bg-slate-200'}`}
                    >
                      <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${autoCheckUpdate ? 'translate-x-4' : 'translate-x-0'}`} />
                    </button>
                  </div>

                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                    <div>
                      <div className="text-xs font-semibold text-slate-800">隐藏更新提示红点</div>
                      <div className="text-[10px] text-slate-400">检测到新版本时不显示右上角提示红点</div>
                    </div>
                    <button
                        type="button"
                        id="hide-dot-switch-btn"
                        onClick={handleToggleHideDot}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${hideUpdateDot ? 'bg-[#95D151]' : 'bg-slate-200'}`}
                    >
                      <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${hideUpdateDot ? 'translate-x-4' : 'translate-x-0'}`} />
                    </button>
                  </div>

                  <div className="space-y-2 pt-1 border-t border-slate-100">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 uppercase tracking-wider text-[11px]">
                      <ArrowUpCircle className="w-3.5 h-3.5 text-emerald-500" />
                      <span>更新方式</span>
                    </div>
                    <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-xl border border-slate-200/60">
                      <button
                          type="button"
                          id="update-mode-auto-btn"
                          onClick={() => handleSelectUpdateMode('auto')}
                          className={`py-1.5 px-2 rounded-lg font-medium transition-all cursor-pointer text-center ${updateMode === 'auto' ? 'bg-white text-slate-900 shadow-xs font-semibold' : 'text-slate-500 hover:text-slate-800'}`}
                      >
                        自动增量
                      </button>
                      <button
                          type="button"
                          id="update-mode-full-btn"
                          onClick={() => handleSelectUpdateMode('full')}
                          className={`py-1.5 px-2 rounded-lg font-medium transition-all cursor-pointer text-center ${updateMode === 'full' ? 'bg-white text-slate-900 shadow-xs font-semibold' : 'text-slate-500 hover:text-slate-800'}`}
                      >
                        全量更新
                      </button>
                    </div>
                    <div className="text-[10px] text-slate-400 px-0.5">
                      {updateMode === 'auto'
                          ? '优先下载增量包（只下载变更文件，更快），无法增量时自动回退整包'
                          : '始终下载完整安装包，覆盖旧版本所有文件'}
                    </div>
                  </div>

                  {/* 图鉴数据更新 */}
                  {onOpenDataUpdate && (
                      <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                        <div>
                          <div className="text-xs font-semibold text-slate-800">图鉴数据热更新</div>
                          <div className="text-[10px] text-slate-400">检测并更新图鉴数据库与地图数据</div>
                        </div>
                        <button
                            type="button"
                            id="open-data-update-in-settings-btn"
                            onClick={() => {
                              sound.playClick();
                              onClose();
                              onOpenDataUpdate();
                            }}
                            className="px-3 py-1 bg-[#7ABCF4] hover:bg-[#5DA8E8] text-white font-black text-xs rounded-lg transition-colors cursor-pointer shadow-xs flex items-center gap-1"
                        >
                          <ArrowUpCircle className="w-3.5 h-3.5" />
                          <span>立即检查</span>
                        </button>
                      </div>
                  )}

                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                    <div>
                      <div className="text-xs font-semibold text-slate-800">当前程序版本</div>
                      <div className="text-[10px] text-slate-400">本地已安装的演示作品版本号</div>
                    </div>
                    <span className="text-xs font-mono font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200/80">
                      v{updateState.updateData?.current_version || '1.0.0'}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="space-y-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-semibold text-slate-800">启动/退出提示</div>
                      <div className="text-[10px] text-slate-400">启动与退出时显示蓝白提示窗口，关闭后不再弹出</div>
                    </div>
                    <button
                        type="button"
                        id="settings-hints-switch-btn"
                        onClick={handleToggleHints}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${showHints ? 'bg-[#95D151]' : 'bg-slate-200'}`}
                        title={showHints ? '点击关闭提示' : '点击开启提示'}
                    >
                      <span
                          className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${showHints ? 'translate-x-4' : 'translate-x-0'}`}
                      />
                    </button>
                  </div>

                  {/* 界面设置 */}
                  <div className="pt-2 border-t border-slate-100 space-y-3">
                    <div className="text-[11px] font-bold text-slate-800 uppercase tracking-wider">界面设置</div>
                    
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs font-semibold text-slate-800">快捷面板精简模式</div>
                        <div className="text-[10px] text-slate-400">默认隐藏单个识别、批量导入与数据管理</div>
                      </div>
                      <button
                          type="button"
                          id="settings-simplified-fabs-switch-btn"
                          onClick={handleToggleSimplifiedFABs}
                          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${isSimplifiedFABs ? 'bg-[#95D151]' : 'bg-slate-200'}`}
                          title={isSimplifiedFABs ? '点击关闭精简模式' : '点击开启精简模式'}
                      >
                        <span
                            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${isSimplifiedFABs ? 'translate-x-4' : 'translate-x-0'}`}
                        />
                      </button>
                    </div>

                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs font-semibold text-slate-800">跟随识别窗口置顶</div>
                        <div className="text-[10px] text-slate-400">打开跟随识别时自动置顶到所有窗口前面</div>
                      </div>
                      <button
                          type="button"
                          id="settings-topmost-switch-btn"
                          onClick={handleToggleFollowTopMost}
                          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${followTopMost ? 'bg-[#95D151]' : 'bg-slate-200'}`}
                          title={followTopMost ? '点击关闭自动置顶' : '点击开启自动置顶'}
                      >
                        <span
                            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${followTopMost ? 'translate-x-4' : 'translate-x-0'}`}
                        />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 主菜单 */}
            <div key={`main-${view}`} className={`col-start-1 row-start-1 p-5 space-y-5 text-xs text-slate-600 ${view === 'main' ? 'animate-in fade-in duration-200' : 'hidden'}`}>

            {/* Section 1: 视觉与特效 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 uppercase tracking-wider text-[11px]">
                  <Sparkles className="w-3.5 h-3.5 text-sky-500" />
                  <span>同步反馈动画</span>
                </div>
              </div>

              {/* iOS Segmented Control: 关闭 (0), 轻微 (1), 标准 (2), 丰富 (3) */}
              <div className="grid grid-cols-4 gap-1 p-1 bg-slate-100/90 rounded-xl border border-slate-200/60">
                <button
                    type="button"
                    id="effect-level-0-btn"
                    onClick={() => handleSelectEffect(0)}
                    className={`py-1.5 px-1.5 rounded-lg font-medium transition-all cursor-pointer text-center text-xs ${
                        effectLevel === 0
                            ? 'bg-white text-slate-900 shadow-xs font-semibold'
                            : 'text-slate-500 hover:text-slate-800'
                    }`}
                >
                  关闭
                </button>
                <button
                    type="button"
                    id="effect-level-1-btn"
                    onClick={() => handleSelectEffect(1)}
                    className={`py-1.5 px-1.5 rounded-lg font-medium transition-all cursor-pointer text-center text-xs ${
                        effectLevel === 1
                            ? 'bg-white text-slate-900 shadow-xs font-semibold'
                            : 'text-slate-500 hover:text-slate-800'
                    }`}
                >
                  轻微
                </button>
                <button
                    type="button"
                    id="effect-level-2-btn"
                    onClick={() => handleSelectEffect(2)}
                    className={`py-1.5 px-1.5 rounded-lg font-medium transition-all cursor-pointer text-center text-xs ${
                        effectLevel === 2
                            ? 'bg-white text-slate-900 shadow-xs font-semibold'
                            : 'text-slate-500 hover:text-slate-800'
                    }`}
                >
                  标准
                </button>
                <button
                    type="button"
                    id="effect-level-3-btn"
                    onClick={() => handleSelectEffect(3)}
                    className={`py-1.5 px-1.5 rounded-lg font-medium transition-all cursor-pointer text-center text-xs ${
                        effectLevel === 3
                            ? 'bg-white text-slate-900 shadow-xs font-semibold'
                            : 'text-slate-500 hover:text-slate-800'
                    }`}
                >
                  丰富
                </button>
              </div>
            </div>

            {/* Section 2: 界面布局 */}
            <div className="space-y-2 pt-1 border-t border-slate-100">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 uppercase tracking-wider text-[11px]">
                <Monitor className="w-3.5 h-3.5 text-slate-500" />
                <span>悬浮快捷栏展示</span>
              </div>

              <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-xl border border-slate-200/60">
                <button
                    type="button"
                    id="floating-mode-normal-btn"
                    onClick={() => handleSelectFloatingMode('normal')}
                    className={`py-1.5 px-2 rounded-lg font-medium transition-all cursor-pointer text-center ${
                        floatingMode === 'normal'
                            ? 'bg-white text-slate-900 shadow-xs font-semibold'
                            : 'text-slate-500 hover:text-slate-800'
                    }`}
                >
                  标准悬浮
                </button>
                <button
                    type="button"
                    id="floating-mode-compact-btn"
                    onClick={() => handleSelectFloatingMode('compact')}
                    className={`py-1.5 px-2 rounded-lg font-medium transition-all cursor-pointer text-center ${
                        floatingMode === 'compact'
                            ? 'bg-white text-slate-900 shadow-xs font-semibold'
                            : 'text-slate-500 hover:text-slate-800'
                    }`}
                >
                  纯图标
                </button>
                <button
                    type="button"
                    id="floating-mode-hidden-btn"
                    onClick={() => handleSelectFloatingMode('hidden')}
                    className={`py-1.5 px-2 rounded-lg font-medium transition-all cursor-pointer text-center ${
                        floatingMode === 'hidden'
                            ? 'bg-white text-slate-900 shadow-xs font-semibold'
                            : 'text-slate-500 hover:text-slate-800'
                    }`}
                >
                  移至顶栏
                </button>
              </div>
            </div>


            {/* Section 3: 截图方式（web 版隐藏） */}
            <div className={`space-y-2 pt-1 border-t border-slate-100${IS_STATIC ? ' hidden' : ''}`}>
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 uppercase tracking-wider text-[11px]">
                <Camera className="w-3.5 h-3.5 text-violet-500" />
                <span>截图方式</span>
              </div>

              <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-xl border border-slate-200/60">
                <button
                    type="button"
                    id="capture-mode-grab-btn"
                    onClick={() => handleSelectCaptureMode('grab')}
                    className={`py-1.5 px-2 rounded-lg font-medium transition-all cursor-pointer text-center ${
                        captureMode === 'grab'
                            ? 'bg-white text-slate-900 shadow-xs font-semibold'
                            : 'text-slate-500 hover:text-slate-800'
                    }`}
                >
                  屏幕截图
                </button>
                <button
                    type="button"
                    id="capture-mode-hwnd-btn"
                    onClick={() => handleSelectCaptureMode('hwnd')}
                    className={`py-1.5 px-2 rounded-lg font-medium transition-all cursor-pointer text-center ${
                        captureMode === 'hwnd'
                            ? 'bg-white text-slate-900 shadow-xs font-semibold'
                            : 'text-slate-500 hover:text-slate-800'
                    }`}
                >
                  内存提取
                </button>
              </div>

              <div className="text-[10px] text-slate-400 px-0.5">
                {captureMode === 'hwnd'
                    ? '通过窗口句柄直接读取内存画面，速度更快、不遮挡游戏窗口'
                    : '通过屏幕抓取当前画面，兼容性更好但需要游戏窗口可见'}
              </div>
            </div>

            {/* Section 3: 声音 */}
            <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600">
                  {isSoundMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-800">操作音效</div>
                  <div className="text-[10px] text-slate-400">点亮图鉴与识别时的提示音</div>
                </div>
              </div>

              <button
                  type="button"
                  id="settings-sound-switch-btn"
                  onClick={handleToggleSound}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      !isSoundMuted ? 'bg-[#95D151]' : 'bg-slate-200'
                  }`}
              >
              <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                      !isSoundMuted ? 'translate-x-4' : 'translate-x-0'
                  }`}
              />
              </button>
            </div>

            {/* Section 4: 数据与同步 */}
            {onOpenDataBackup && (
                <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600">
                      <Database className="w-3.5 h-3.5" />
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-slate-800">数据备份与导出</div>
                      <div className="text-[10px] text-slate-400">本地存储就绪，可导出备份 JSON</div>
                    </div>
                  </div>

                  <button
                      type="button"
                      id="open-data-backup-btn"
                      onClick={() => {
                        sound.playClick();
                        onClose();
                        onOpenDataBackup();
                      }}
                      className="text-xs text-sky-600 hover:text-sky-700 font-medium flex items-center gap-1 cursor-pointer hover:underline"
                  >
                    <span>管理</span>
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
            )}

            {/* Section 5: 识别截图示例（web 版隐藏） */}
            <div className={`pt-2 border-t border-slate-100 flex items-center justify-between${IS_STATIC ? ' hidden' : ''}`}>
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600">
                  <ImageIcon className="w-3.5 h-3.5" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-800">识别截图示例</div>
                  <div className="text-[10px] text-slate-400">识别卡片里的示例截图图标与正确截图格式提示</div>
                </div>
              </div>

              <button
                  type="button"
                  id="settings-samples-switch-btn"
                  onClick={handleToggleSamples}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      showSamples ? 'bg-[#95D151]' : 'bg-slate-200'
                  }`}
                  title={showSamples ? '点击隐藏示例' : '点击显示示例'}
              >
                <span
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                        showSamples ? 'translate-x-4' : 'translate-x-0'
                    }`}
                />
              </button>
            </div>

            {/* Section 6: 系统设置入口（web 版隐藏） */}
            <div className={`pt-2 border-t border-slate-100 flex items-center justify-between${IS_STATIC ? ' hidden' : ''}`}>
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600">
                  <Settings2 className="w-3.5 h-3.5" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-800">系统设置</div>
                  <div className="text-[10px] text-slate-400">启动/退出提示、界面设置等</div>
                </div>
              </div>
              <button
                  type="button"
                  id="open-system-settings-btn"
                  onClick={() => {
                    sound.playClick();
                    setView('system');
                  }}
                  className="text-xs text-sky-600 hover:text-sky-700 font-medium flex items-center gap-1 cursor-pointer hover:underline"
              >
                <span>设置</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>

            {/* Section 7: 更新设置入口（web 版隐藏） */}
            <div className={`pt-2 border-t border-slate-100 flex items-center justify-between${IS_STATIC ? ' hidden' : ''}`}>
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600">
                  <ArrowUpCircle className="w-3.5 h-3.5" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                    <span>更新设置</span>
                    <span className="text-[10px] text-slate-400 font-mono font-normal">
                      (当前 v{updateState.updateData?.current_version || '1.0.0'})
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400">程序版本、图鉴热更新与增量配置</div>
                </div>
              </div>
              <button
                  type="button"
                  id="open-update-settings-btn"
                  onClick={() => {
                    sound.playClick();
                    setView('update');
                  }}
                  className="text-xs text-sky-600 hover:text-sky-700 font-medium flex items-center gap-1 cursor-pointer hover:underline"
              >
                <span>设置</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>

            {/* Section 8: 用户协议查看 */}
            <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600">
                  <ShieldCheck className="w-3.5 h-3.5" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-800">用户协议</div>
                  <div className="text-[10px] text-slate-400">查看本软件的使用条款与免责声明</div>
                </div>
              </div>
              <button
                  type="button"
                  id="view-agreement-btn"
                  onClick={() => {
                    sound.playClick();
                    setIsAgreementOpen(true);
                  }}
                  className="text-xs text-sky-600 hover:text-sky-700 font-medium flex items-center gap-1 cursor-pointer hover:underline"
              >
                <span>查看</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>

            {/* 免责声明 / 开发者说明 */}
            <div className="pt-3 border-t border-slate-100">
              <div className="p-3 bg-slate-50/80 rounded-xl border border-slate-200/60 text-[11px] text-slate-500 space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-slate-700">
                  <ShieldCheck className="w-3.5 h-3.5 text-slate-500" />
                  <span>免责与开发者声明</span>
                </div>
                <p className="leading-relaxed text-slate-500 text-[10px]">
                  <strong>声明：</strong>本项目为<strong>个人玩家独立开发的图像识别技术演示作品</strong>，仅用于编程学习与技术交流，<strong>不存在任何商业盈利行为，未获得腾讯官方授权</strong>。
                  游戏官方用户协议禁止各类第三方工具，使用者确认已充分知晓该规则，如仍自愿使用本项目，由此产生的账号限制、封禁等全部风险与后果均由使用者本人独立承担，本项目开发者不承担任何责任。
                </p>
                <p className="leading-relaxed text-slate-500 text-[10px]">
                  参考说明：页面部分内容参考来自第三方社区
                  <a
                    href="https://wiki.biligame.com/rocom"
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="text-sky-600 font-medium hover:underline mx-1"
                  >
                    Bilibili游戏‑RocoWiki
                  </a>，本站仅作引用参考，不对第三方内容的真实性、完整性承担责任。游戏相关全部素材、商标、知识产权均归腾讯公司《洛克王国：世界》所有。
                </p>
              </div>
            </div>
            </div>
          </div>

          {/* 滚动提示胶囊条：当内容可向下滑动且尚未见底时展示 */}
          {canScrollDown && (
              <div className="pointer-events-none -mt-7 mb-1 z-10 flex justify-center animate-in fade-in zoom-in-95 duration-200">
                <div className="flex items-center gap-1 px-3 py-0.5 rounded-full bg-slate-800/80 backdrop-blur-xs text-white text-[10.5px] font-medium shadow-md shadow-slate-900/15 animate-bounce">
                  <span>向下滑动查看更多</span>
                  <ChevronDown className="w-3.5 h-3.5 stroke-[2.5]" />
                </div>
              </div>
          )}

          {/* Footer */}
          <div className="px-5 py-3 bg-slate-50/80 border-t border-slate-100 flex items-center justify-between">
            <span className="text-[10px] text-slate-400">配置已自动保存</span>
            <button
                type="button"
                onClick={() => {
                  sound.playClick();
                  onClose();
                }}
                className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 active:bg-slate-950 text-white font-medium text-xs rounded-lg transition-colors cursor-pointer shadow-xs"
            >
              完成
            </button>
          </div>
        </div>
      </div>
      <UserAgreementModal
          isOpen={isAgreementOpen}
          onClose={() => setIsAgreementOpen(false)}
      />
      </>
  );
};
