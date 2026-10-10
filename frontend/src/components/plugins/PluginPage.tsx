import React, { useEffect } from 'react';
import { PluginFrame } from './PluginFrame';
import { PluginInfo } from '../../services/pluginApi';

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
    </div>
  );
};