import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ScannerApp } from './ScannerApp.tsx';
import { WebFollowScanner } from './components/WebFollowScanner';
import { AuthGate } from './components/AuthGate';
import { AgreementGate } from './components/AgreementGate';
import { ErrorBoundary } from './components/ErrorBoundary';
import { IS_STATIC } from './services/staticMode';
import { startWebTelemetry } from './services/webTelemetry';
import { runtimeGuard } from './services/runtimeGuard';
import { webAccounts } from './services/webAccounts';
import './index.css';

// Check if running as standalone scanner window (via pathname /scanner or query ?view=scanner or #scanner)
function isScannerMode(): boolean {
  if (typeof window === 'undefined') return false;
  const path = window.location.pathname.toLowerCase();
  const search = window.location.search.toLowerCase();
  const hash = window.location.hash.toLowerCase();

  return (
    path.includes('/scanner') ||
    path.includes('/follow') ||
    search.includes('view=scanner') ||
    search.includes('mode=scanner') ||
    hash.includes('scanner') ||
    (window as any).__ROCO_VIEW_MODE__ === 'scanner'
  );
}

const rootElement = document.getElementById('root')!;
const isStandaloneScanner = isScannerMode();

/**
 * 跟随识别面板单独开窗时的窗口标题。
 *
 * 浏览器原生的「选择要共享的内容」对话框在窄窗口下会把标题截断成
 * 「洛克王国徽章试炼助手…」，和游戏窗口的「洛克王国：世…」几乎分不清，用户很容易选错。
 * 这里换成一个短且一眼能排除的标题（只在纯前端版的跟随识别面板生效）。
 */
if (isStandaloneScanner && IS_STATIC) {
  document.title = '识别面板 · 勿选此窗口';
}

createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary>
      {isStandaloneScanner ? (
        // 纯前端版走浏览器内识别（Screen Capture + onnxruntime-web），桌面版仍走 pywebview 桥
        IS_STATIC ? <WebFollowScanner /> : <ScannerApp />
      ) : IS_STATIC ? (
        <AgreementGate>
          <App />
        </AgreementGate>
      ) : (
        <AgreementGate>
          <AuthGate>
            <App />
          </AuthGate>
        </AgreementGate>
      )}
    </ErrorBoundary>
  </StrictMode>,
);

// 纯前端版：上报“打开 / 心跳”到远端统计服务器（不含授权/存储/反馈）。
if (IS_STATIC) {
  webAccounts.init();
  startWebTelemetry();
  runtimeGuard.init();
}
if (typeof window !== 'undefined') {
  // 禁止拖动图片或链接
  window.addEventListener('dragstart', (e) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'IMG' || target.tagName === 'A' || target.closest('img'))) {
      e.preventDefault();
    }
  });

  // 在 Web 端或静态部署下禁止复制事件（排除输入框）
  window.addEventListener('copy', (e) => {
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || (active as HTMLElement).isContentEditable)) {
      return;
    }
    // 允许通过代码触发的 copy（如点击复制群号按钮），阻止用户直接快捷键框选复制
    if (window.getSelection()?.toString()) {
      e.preventDefault();
    }
  });
}

