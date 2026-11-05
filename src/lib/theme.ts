export type Theme = 'light' | 'dark';
const KEY = 'hivexui-theme';
const listeners = new Set<() => void>();
function stored(): Theme | null {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}
function preferred(): Theme {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
/** An explicit choice wins; otherwise the console follows the operating system. */
export const currentTheme = (): Theme => stored() ?? preferred();
export function applyTheme(): void {
  document.documentElement.dataset.theme = currentTheme();
}
export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Storage may be unavailable; the choice then lasts until the next preference change.
  }
  document.documentElement.dataset.theme = theme;
  for (const listener of listeners) listener();
}
export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  const changed = () => {
    applyTheme();
    listener();
  };
  const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  media?.addEventListener('change', changed);
  window.addEventListener('storage', changed);
  return () => {
    listeners.delete(listener);
    media?.removeEventListener('change', changed);
    window.removeEventListener('storage', changed);
  };
}
