import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ScannerApp } from './ScannerApp.tsx';
import { WebFollowScanner } from './components/WebFollowScanner';
import { ScannerPipHost } from './components/ScannerPipHost';
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

// 跟随识别面板单独开窗（非 PiP 的兜底路径）时的窗口标题
if (isStandaloneScanner && IS_STATIC) {
  document.title = '识别窗口';
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
          {/* 纯前端版：跟随识别小窗（由首页直接开的 Document PiP）挂在这里 */}
          <ScannerPipHost />
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

