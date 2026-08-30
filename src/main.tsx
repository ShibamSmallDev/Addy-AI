import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import AvatarLab from './pages/AvatarLab.tsx';
import {ApiKeyGate} from './components/ApiKeyGate.tsx';
import {IdentitySetupGate} from './components/IdentitySetupGate.tsx';
import {ErrorBoundary} from './components/ErrorBoundary.tsx';
import './index.css';

const isLab = window.location.pathname === '/avatar-lab';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      {isLab ? (
        <AvatarLab />
      ) : (
        <ApiKeyGate>
          <IdentitySetupGate>
            <App />
          </IdentitySetupGate>
        </ApiKeyGate>
      )}
    </ErrorBoundary>
  </StrictMode>,
);

// Disable Vite HMR full-reload on error — show ErrorBoundary instead
try {
  const hm = (import.meta as any).hot;
  if (hm) {
    hm.on('vite:beforeFullReload', (payload: any) => {
      console.warn('[HMR] Blocked full reload. Error:', payload);
      hm.decline();
    });
  }
} catch {} // noop if not in Vite dev mode
