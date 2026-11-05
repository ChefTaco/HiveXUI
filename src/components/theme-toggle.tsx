import { useSyncExternalStore } from 'react';
import { currentTheme, setTheme, subscribeTheme } from '../lib/theme';

export function ThemeToggle({ floating = false }: { floating?: boolean }) {
  const theme = useSyncExternalStore(subscribeTheme, currentTheme);
  const dark = theme === 'dark';
  return (
    <button
      className={floating ? 'theme-toggle theme-toggle--floating' : 'theme-toggle'}
      type="button"
      aria-label={dark ? 'Use light theme' : 'Use dark theme'}
      onClick={() => setTheme(dark ? 'light' : 'dark')}
    >
      {dark ? 'Light theme' : 'Dark theme'}
    </button>
  );
}
