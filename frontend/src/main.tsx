import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ScannerApp } from './ScannerApp.tsx';
import { AuthGate } from './components/AuthGate';
import { ErrorBoundary } from './components/ErrorBoundary';
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

createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary>
      {isStandaloneScanner ? <ScannerApp /> : (
        <AuthGate>
          <App />
        </AuthGate>
      )}
    </ErrorBoundary>
  </StrictMode>,
);
