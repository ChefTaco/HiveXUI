import '@fontsource/dm-sans/latin-400.css';
import '@fontsource/dm-sans/latin-500.css';
import '@fontsource/dm-sans/latin-600.css';
import '@fontsource/space-grotesk/latin-500.css';
import '@fontsource/space-grotesk/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app';
import { IdentityPrompts } from './components/identity-prompts';
import { ToastProvider } from './components/toast';
import { ThemeToggle } from './components/theme-toggle';
import { initializeRuntime } from './lib/runtime';
import './styles/app.css';
import './styles/ecosystem.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Root element not found');
}

try {
  await initializeRuntime();
} catch {
  root.setAttribute('role', 'alert');
  root.textContent =
    'HiveXUI could not load its configuration. Check runtime.json and reload the console.';
  throw new Error('Invalid console runtime configuration');
}
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ToastProvider>
      <ThemeToggle />
      <IdentityPrompts />
      <App />
    </ToastProvider>
  </React.StrictMode>,
);
