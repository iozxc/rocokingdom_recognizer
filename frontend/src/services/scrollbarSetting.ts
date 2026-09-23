/**
 * 把「自定义滚动条」设置应用到 <html>。
 *
 * 为什么需要这个函数而不是在 App.tsx 内联：
 *   跟随识别是**独立文档**（/scanner 或 ?view=scanner），它跑的是
 *   ScannerApp / WebFollowScanner，而不是首页 App —— 首页里写的副作用
 *   在那边根本不会执行，那边就永远停留在浏览器原生滚动条。
 *
 * 开关本身存在 storage 里（showHomeScrollbar / homeScrollbarWidth），
 * 本函数把它翻译成 <html> 上的 class + CSS 变量，供 index.css 里的
 * .roco-scrollbar-on 规则消费。返回一个清理函数。
 */
import { storage } from './storage';

const CLASS_NAME = 'roco-scrollbar-on';
const WIDTH_VAR = '--roco-scrollbar-w';

/** 读取设置并写入 <html>；返回清理函数。 */
export function applyScrollbarSetting(): () => void {
  if (typeof document === 'undefined') return () => {};

  const root = document.documentElement;
  const on = storage.getSetting<boolean>('showHomeScrollbar', true);
  const width = Math.max(4, Math.min(16, Math.round(
      storage.getSetting<number>('homeScrollbarWidth', 10) || 10)));

  root.classList.toggle(CLASS_NAME, on);
  root.style.setProperty(WIDTH_VAR, `${width}px`);

  return () => {
    root.classList.remove(CLASS_NAME);
    root.style.removeProperty(WIDTH_VAR);
  };
}
