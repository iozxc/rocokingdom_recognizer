import React, { useState, useEffect } from 'react';
import { X, Play, Volume2, VolumeX, Database, ArrowRight, Sparkles, Monitor, RotateCcw } from 'lucide-react';
import { EffectLevel, FloatingButtonsMode } from '../types';
import { sound } from '../services/sound';
import { storage } from '../services/storage';
import { fireEncounterConfetti, fireUnencounterEffect } from '../services/effect';
import { SyncPopType } from './SyncPopNotification';

interface AppSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTestEffect: (level: EffectLevel, type?: SyncPopType) => void;
  onOpenDataBackup?: () => void;
}

export const AppSettingsModal: React.FC<AppSettingsModalProps> = ({
                                                                    isOpen,
                                                                    onClose,
                                                                    onTestEffect,
                                                                    onOpenDataBackup,
                                                                  }) => {
  const [effectLevel, setEffectLevel] = useState<EffectLevel>(() => {
    return storage.getSetting<EffectLevel>('effectLevel', 0);
  });
  const [floatingMode, setFloatingMode] = useState<FloatingButtonsMode>(() => {
    return storage.getSetting<FloatingButtonsMode>('floatingButtonsMode', 'normal');
  });
  const [isSoundMuted, setIsSoundMuted] = useState<boolean>(() => {
    return storage.getSetting<boolean>('isSoundMuted', false);
  });

  // Sync settings updates
  useEffect(() => {
    const unsubscribe = storage.subscribeSettings((settings) => {
      if (typeof settings.effectLevel === 'number') setEffectLevel(settings.effectLevel as EffectLevel);
      if (settings.floatingButtonsMode) setFloatingMode(settings.floatingButtonsMode);
      if (typeof settings.isSoundMuted === 'boolean') setIsSoundMuted(settings.isSoundMuted);
    });
    return () => unsubscribe();
  }, []);

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

  const triggerEffectPreview = (level: EffectLevel, type: SyncPopType = 'encounter') => {
    if (type === 'encounter') {
      sound.playEncounter();
      fireEncounterConfetti(level);
    } else {
      sound.playToggleOff();
      fireUnencounterEffect(level);
    }
    onTestEffect(level, type);
  };

  const handleSelectEffect = (level: EffectLevel) => {
    setEffectLevel(level);
    storage.setSetting('effectLevel', level);
    triggerEffectPreview(level, 'encounter');
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

  return (
      <div
          id="app-settings-modal-backdrop"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={onClose}
      >
        <div
            id="app-settings-modal-dialog"
            className="w-full max-w-md bg-white rounded-2xl border border-slate-200/80 shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
            <div>
              <h3 className="text-sm font-bold text-slate-800 tracking-tight">偏好设置</h3>
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

          {/* Content */}
          <div className="p-5 space-y-5 text-xs text-slate-600">
            {/* Section 1: 视觉与特效 */}
            <div className="space-y-2.5">
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

              {/* In-Dialog Live Preview & Explanation Box (iOS Clean Style) */}
              <div
                  className={`rounded-xl border p-3 flex flex-col gap-2.5 transition-colors ${
                      effectLevel === 0
                          ? 'border-slate-200/80 bg-slate-50/50'
                          : effectLevel === 3
                              ? 'border-purple-200/60 bg-purple-50/20'
                              : effectLevel === 2
                                  ? 'border-sky-200/60 bg-sky-50/20'
                                  : 'border-slate-200 bg-slate-50/60'
                  }`}
              >
                <div className="flex flex-col">
                <span className="text-[11px] font-medium text-slate-700">
                  {effectLevel === 0 && '已停用粒子动效，仅保留顶部轻量状态胶囊（默认）'}
                  {effectLevel === 1 && '轻微微粒微漾，简约低调'}
                  {effectLevel === 2 && '双侧对称纸花与微粒消散，适度动效反馈'}
                  {effectLevel === 3 && '多层次纸花绽放与微粒消散，完整动效反馈'}
                </span>
                  <span className="text-[10px] text-slate-400 mt-0.5">
                  未遇见 → 遇见：彩屑轻扬 · 遇见 → 未遇见：静谧微粒消散
                </span>
                </div>

                <div className="flex items-center gap-2 pt-1 border-t border-slate-200/40">
                  <button
                      type="button"
                      id="test-encounter-effect-btn"
                      onClick={() => triggerEffectPreview(effectLevel, 'encounter')}
                      className="flex-1 py-1.5 px-2 bg-white hover:bg-emerald-50 active:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
                  >
                    <Sparkles className="w-3 h-3 text-emerald-600" />
                    <span>测试遇见动效</span>
                  </button>

                  <button
                      type="button"
                      id="test-unencounter-effect-btn"
                      onClick={() => triggerEffectPreview(effectLevel, 'unencounter')}
                      className="flex-1 py-1.5 px-2 bg-white hover:bg-slate-100 active:bg-slate-200 text-slate-700 border border-slate-200 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3 text-slate-500" />
                    <span>测试未遇见动效</span>
                  </button>
                </div>
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
          </div>

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
  );
};

