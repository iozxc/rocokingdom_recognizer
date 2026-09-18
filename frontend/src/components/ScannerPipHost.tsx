/**
 * 跟随识别小窗宿主（纯前端版）。
 *
 * 首页点「跟随识别」时，`services/followScanner.ts` 会直接向浏览器申请一个
 * **Document PiP 小窗**（无地址栏、始终置顶），并把窗口对象用自定义事件丢过来；
 * 这个组件负责把识别面板 portal 渲染进去。
 *
 * 为什么必须由首页来开：Document PiP 窗口的寿命绑定在「打开它的那个文档」上 ——
 * 如果由识别弹窗自己开，弹窗一关小窗就跟着没了，而且会留下一个空白弹窗。
 * 由常驻的首页开，就只有一个窗口，也就不用再点「置顶」转一次。
 */
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { WebFollowScanner, copyStylesTo } from './WebFollowScanner';

const OPEN_EVENT = 'roco:open-scanner-pip';

export const ScannerPipHost: React.FC = () => {
  const [pipWin, setPipWin] = useState<Window | null>(null);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const win = (e as CustomEvent).detail as Window | undefined;
      if (!win || !win.document) return;
      // 复制样式 + 主题类，否则小窗里的面板没有任何样式
      copyStylesTo(win);
      win.document.documentElement.className = document.documentElement.className;
      win.document.body.className = 'm-0 p-0 bg-[#FDF9F3] dark:bg-slate-900 overflow-hidden';
      win.addEventListener('pagehide', () => setPipWin((cur) => (cur === win ? null : cur)));
      setPipWin(win);
    };
    window.addEventListener(OPEN_EVENT, onOpen as EventListener);
    return () => window.removeEventListener(OPEN_EVENT, onOpen as EventListener);
  }, []);

  if (!pipWin) return null;
  return createPortal(<WebFollowScanner hostWindow={pipWin} />, pipWin.document.body);
};

export default ScannerPipHost;
