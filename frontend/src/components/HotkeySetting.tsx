import React, { useEffect, useState } from 'react';
import { RotateCcw, Ban, X } from 'lucide-react';
import { storage } from '../services/storage';
import { sound } from '../services/sound';
import {
  DEFAULT_FOLLOW_HOTKEY,
  eventToChord,
  validateChord,
  formatChord,
  hotkeyErrorText,
} from '../utils/hotkey';

/**
 * 跟随识别全局热键设置项（系统设置 → 界面）。
 *
 * 点「修改」进入录制态，按下任意组合键即录制；Esc 取消录制。
 * 录制后先调后端注册（RegisterHotKey），若被 QQ/微信/游戏等占用会返回
 * conflict，此时保留旧值并提示；成功才写进设置落盘。
 *
 * 热键行为：跟随识别窗口已开启且可见时，按下立即执行一次识别；不会弹出窗口。
 */
export const HotkeySetting: React.FC = () => {
  const [chord, setChord] = useState<string>(() =>
    storage.getSetting<string>('followScannerHotkey', DEFAULT_FOLLOW_HOTKEY)
  );
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string>('');

  // 录制态：捕获全局 keydown（capture 阶段，避免被弹窗内其它控件/浏览器默认行为处理）
  useEffect(() => {
    if (!capturing) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setCapturing(false);
        setError('');
        return;
      }
      const next = eventToChord(e);
      if (!next) return; // 还只按了修饰键，继续等主键
      const invalid = validateChord(next);
      if (invalid) {
        setError(hotkeyErrorText(invalid));
        return;
      }
      void applyChord(next);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturing]);

  const applyChord = async (next: string) => {
    try {
      const pyApi = (window as any).pywebview?.api;
      if (pyApi && typeof pyApi.set_follow_hotkey === 'function') {
        const res = await pyApi.set_follow_hotkey(next);
        if (!res || res.status !== 'ok') {
          setError(hotkeyErrorText(res?.reason));
          return;
        }
      }
      // 注册成功：落盘设置（桌面端会再同步到后端）
      storage.setSetting('followScannerHotkey', next);
      setChord(next);
      setError('');
      setCapturing(false);
    } catch (e) {
      setError('注册失败，请重试或更换组合键');
    }
  };

  const handleReset = async () => {
    sound.playClick();
    setError('');
    await applyChord(DEFAULT_FOLLOW_HOTKEY);
  };

  const handleDisable = async () => {
    sound.playClick();
    try {
      const pyApi = (window as any).pywebview?.api;
      if (pyApi && typeof pyApi.set_follow_hotkey === 'function') {
        await pyApi.set_follow_hotkey('');
      }
      storage.setSetting('followScannerHotkey', '');
      setChord('');
      setCapturing(false);
      setError('');
    } catch {
      setError('操作失败，请重试');
    }
  };

  const startCapture = () => {
    sound.playClick();
    setError('');
    setCapturing(true);
  };

  const disabled = !chord;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">跟随识别快捷键</div>
          <div className="text-[10px] text-slate-400">窗口开启时按下立即识别一次（不弹窗口）</div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {capturing ? (
            <button
                type="button"
                id="settings-hotkey-capture"
                onClick={() => setCapturing(false)}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-[#7ABCF4] bg-[#F5F9FF] dark:bg-slate-800 text-[11px] font-bold text-[#2B78C4] dark:text-sky-300 animate-pulse cursor-pointer"
            >
              <span>请按下快捷键…</span>
              <X className="w-3 h-3" />
            </button>
          ) : (
            <button
                type="button"
                id="settings-hotkey-capture"
                onClick={startCapture}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-[#7ABCF4] text-[11px] font-bold text-slate-700 dark:text-slate-200 cursor-pointer transition-colors"
                title="点击后按下新的组合键"
            >
              {disabled ? (
                <span className="text-slate-400">已禁用</span>
              ) : (
                formatChord(chord).split(' + ').map((part, i) => (
                  <kbd
                      key={i}
                      className="inline-flex items-center justify-center min-w-[20px] h-5 px-1 rounded border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 font-mono text-[10px] font-black text-slate-700 dark:text-slate-200 shadow-[0_1px_0_rgba(0,0,0,0.08)]"
                  >
                    {part}
                  </kbd>
                ))
              )}
            </button>
          )}

          <button
              type="button"
              onClick={handleReset}
              className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-[#7ABCF4] text-slate-500 hover:text-[#2B78C4] cursor-pointer transition-colors"
              title="恢复默认 Ctrl+Alt+S"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          {!disabled && (
            <button
                type="button"
                onClick={handleDisable}
                className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-rose-300 text-slate-500 hover:text-rose-500 cursor-pointer transition-colors"
                title="禁用快捷键"
            >
              <Ban className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="text-[10px] font-bold text-rose-500">{error}</div>
      )}
      {capturing && !error && (
        <div className="text-[10px] text-slate-400">
          按住修饰键（Ctrl/Alt/Shift）后按字母、数字或功能键；按 Esc 取消
        </div>
      )}
    </div>
  );
};

export default HotkeySetting;
