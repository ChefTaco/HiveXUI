import { afterEach, expect, it, vi } from 'vitest';
import { applyTheme, currentTheme, setTheme } from './theme';

function environment(prefersDark: boolean, stored: Record<string, string> = {}) {
  vi.stubGlobal('matchMedia', () => ({ matches: prefersDark, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored[key] ?? null,
    setItem: (key: string, value: string) => { stored[key] = value; },
  });
  vi.stubGlobal('document', { documentElement: { dataset: {} as Record<string, string> } });
}
afterEach(() => vi.unstubAllGlobals());

it('follows the operating system until the operator chooses', () => {
  environment(true);
  expect(currentTheme()).toBe('dark');
  applyTheme();
  expect(document.documentElement.dataset.theme).toBe('dark');
  setTheme('light');
  expect(currentTheme()).toBe('light');
  expect(document.documentElement.dataset.theme).toBe('light');
});
it('keeps a saved choice over a changed preference and ignores invalid values', () => {
  environment(true, { 'hivexui-theme': 'light' });
  expect(currentTheme()).toBe('light');
  environment(false, { 'hivexui-theme': 'magenta' });
  expect(currentTheme()).toBe('light');
  environment(true, { 'hivexui-theme': 'magenta' });
  expect(currentTheme()).toBe('dark');
});
it('still works when storage is blocked', () => {
  environment(true);
  vi.stubGlobal('localStorage', { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } });
  expect(currentTheme()).toBe('dark');
  setTheme('light');
  expect(document.documentElement.dataset.theme).toBe('light');
});
