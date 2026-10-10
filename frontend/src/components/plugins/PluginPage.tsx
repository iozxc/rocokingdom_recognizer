import React, { useEffect } from 'react';
import { ChevronLeft } from 'lucide-react';
import { PluginFrame } from './PluginFrame';
import { PluginInfo } from '../../services/pluginApi';
import { sound } from '../../services/sound';

/**
 * 整页插件（plugin.json 里声明 ui.fullscreen = true 的插件）。
 *
 * 直接替换整个界面，而不是塞进弹窗里 —— 生育规划这类
 * 工具需要大画布，弹窗塞不下。
 *
 * 返回有两个入口：
 *   1. 插件自己的顶栏按钮 → iframe 里 postMessage({type:'roco-plugin-close'})（App 里监听）；
 *   2. 左下角这个半透明浮标 / 按 Esc（兜底，防止插件没实现关闭）。
 */
export const PluginPage: React.FC<{ plugin: PluginInfo; onClose: () => void }> = ({ plugin, onClose }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-white dark:bg-slate-900">
      <PluginFrame plugin={plugin} fill />
      <button
        type="button"
        onClick={() => { sound.playClick(); onClose(); }}
        title="返回主界面（Esc）"
        className="fixed bottom-3 left-3 z-[210] h-7 pl-1.5 pr-2.5 rounded-full text-[11px] font-black text-white/95 bg-slate-900/55 hover:bg-slate-900/85 backdrop-blur-sm flex items-center gap-0.5 shadow-lg transition-colors cursor-pointer"
      >
        <ChevronLeft className="w-3.5 h-3.5" /> 返回主界面
      </button>
    </div>
  );
};