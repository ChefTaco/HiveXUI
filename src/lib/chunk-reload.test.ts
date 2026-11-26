// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installChunkReload, isChunkLoadError, reloadConsole, reloadOnceForNewVersion } from './chunk-reload';

afterEach(() => sessionStorage.clear());

describe('reloading for a new console build', () => {
  it('recognises failed dynamic imports and CSS preloads, and nothing else', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://console.example.com/assets/page-abc.js'))).toBe(true);
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module'))).toBe(true);
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError(new Error('Unable to preload CSS for /assets/page-abc.css'))).toBe(true);
    expect(isChunkLoadError(new Error('Request failed with status 500'))).toBe(false);
    expect(isChunkLoadError('Failed to fetch dynamically imported module')).toBe(false);
  });
  it('reloads once, then refuses while the fresh page fails the same way', () => {
    const reload = vi.fn();
    expect(reloadOnceForNewVersion(reload, 1_000_000)).toBe(true);
    expect(reloadOnceForNewVersion(reload, 1_000_000 + 30_000)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    // Long after, a later upgrade may reload once again.
    expect(reloadOnceForNewVersion(reload, 1_000_000 + 10 * 60_000)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });
  it('never reloads automatically when the guard cannot be recorded', () => {
    const reload = vi.fn();
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      expect(reloadOnceForNewVersion(reload)).toBe(false);
      expect(reload).not.toHaveBeenCalled();
    } finally {
      setItem.mockRestore();
    }
  });
  it('lets an operator reload at any time, and re-arms the automatic reload', () => {
    const reload = vi.fn();
    reloadOnceForNewVersion(reload);
    reloadConsole(reload);
    expect(reload).toHaveBeenCalledTimes(2);
    expect(reloadOnceForNewVersion(reload)).toBe(true);
  });
  it('handles vite:preloadError with one reload and lets the next one through to the page', () => {
    const reload = vi.fn();
    const remove = installChunkReload(window, reload);
    try {
      const first = new Event('vite:preloadError', { cancelable: true });
      window.dispatchEvent(first);
      expect(first.defaultPrevented).toBe(true);
      const second = new Event('vite:preloadError', { cancelable: true });
      window.dispatchEvent(second);
      expect(second.defaultPrevented).toBe(false);
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      remove();
    }
  });
});
