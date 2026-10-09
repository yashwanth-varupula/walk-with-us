import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import ErrorBoundary from './components/ErrorBoundary.tsx';
import { AuthProvider } from './hooks/useAuth';
import './index.css';

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        {/* Mounted once, above the router, so session and role are resolved a
            single time and shared by every page, header and footer. */}
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);
