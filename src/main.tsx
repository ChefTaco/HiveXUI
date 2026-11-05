import '@fontsource/dm-sans/latin-400.css';
import '@fontsource/dm-sans/latin-500.css';
import '@fontsource/dm-sans/latin-600.css';
import '@fontsource/space-grotesk/latin-500.css';
import '@fontsource/space-grotesk/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-600.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app';
import { IdentityPrompts } from './components/identity-prompts';
import { ToastProvider } from './components/toast';
import { initializeRuntime } from './lib/runtime';
import { applyStoredFxLevel } from './lib/motion';
import './styles/index.css';

applyStoredFxLevel();

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
      <IdentityPrompts />
      <App />
    </ToastProvider>
  </React.StrictMode>,
);
