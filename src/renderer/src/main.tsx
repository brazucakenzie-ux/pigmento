import '@fontsource-variable/inter';
import './ui/theme/tokens.css';
import './ui/theme/base.css';
import './ui/theme/app.css';
import { createRoot } from 'react-dom/client';
import { App } from './ui/app/App';
import { ErrorBoundary } from './ui/app/ErrorBoundary';

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
