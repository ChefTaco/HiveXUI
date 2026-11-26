// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentEntry, newerVersion, VERSION_MIN_GAP_MS, VERSION_POLL_MS, watchVersion } from './version-watch';

afterEach(() => {
  vi.useRealTimers();
  document.head.innerHTML = '';
});
const served = (body: unknown, status = 200) => vi.fn<typeof fetch>(async () => Response.json(body, { status }));

describe('new console version', () => {
  it("reads this page's built entry script, and none from a development server", () => {
    document.head.innerHTML = '<script type="module" src="/src/main.tsx"></script>';
    expect(currentEntry()).toBeUndefined();
    document.head.innerHTML = '<script type="module" crossorigin src="/assets/index-AbC123.js"></script>';
    expect(currentEntry()).toBe('/assets/index-AbC123.js');
  });

  it('reports a different served build, uncached and without credentials', async () => {
    const request = served({ version: '0.13.0', entry: '/assets/index-New456.js' });
    expect(await newerVersion('/assets/index-AbC123.js', request)).toEqual({ version: '0.13.0', entry: '/assets/index-New456.js' });
    expect(request.mock.calls[0]?.[0]).toBe('/version.json');
    expect(request.mock.calls[0]?.[1]).toMatchObject({ cache: 'no-store', credentials: 'omit', redirect: 'error' });
    expect(await newerVersion('/assets/index-New456.js', request)).toBeUndefined();
  });

  it('ignores a missing, failing or malformed answer', async () => {
    expect(await newerVersion('/assets/a.js', served({}, 404))).toBeUndefined();
    expect(await newerVersion('/assets/a.js', vi.fn<typeof fetch>(async () => { throw new TypeError('Failed to fetch'); }))).toBeUndefined();
    expect(await newerVersion('/assets/a.js', served({ entry: 'https://elsewhere.example.com/x.js' }))).toBeUndefined();
    expect(await newerVersion('/assets/a.js', served({ entry: '/assets/b.js', version: '<script>' }))).toBeUndefined();
    expect(await newerVersion('/assets/a.js', vi.fn<typeof fetch>(async () => new Response('<html>')))).toBeUndefined();
  });

  it('checks while visible, on a timer and on return to the tab, and reports once', async () => {
    vi.useFakeTimers();
    let visibility: DocumentVisibilityState = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
    let entry = '/assets/index-AbC123.js';
    const request = vi.fn<typeof fetch>(async () => Response.json({ version: '0.13.0', entry }));
    const onUpdate = vi.fn();
    const stop = watchVersion({ onUpdate, entry: '/assets/index-AbC123.js', request });
    await vi.advanceTimersByTimeAsync(VERSION_POLL_MS);
    expect(request).toHaveBeenCalledTimes(1);
    expect(onUpdate).not.toHaveBeenCalled();

    visibility = 'hidden';
    await vi.advanceTimersByTimeAsync(VERSION_POLL_MS * 2);
    expect(request).toHaveBeenCalledTimes(1);

    entry = '/assets/index-New456.js';
    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(onUpdate).toHaveBeenCalledWith({ version: '0.13.0', entry: '/assets/index-New456.js' });
    await vi.advanceTimersByTimeAsync(VERSION_POLL_MS * 3);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(request).toHaveBeenCalledTimes(2);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    stop();
  });

  it('asks at most once a minute however often the tab is shown', async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    const request = served({ entry: '/assets/index-AbC123.js' });
    const stop = watchVersion({ onUpdate: vi.fn(), entry: '/assets/index-AbC123.js', request });
    for (let i = 0; i < 5; i++) document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(request).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(VERSION_MIN_GAP_MS);
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(1);
    stop();
  });

  it('does nothing without a built entry script', () => {
    const request = served({});
    expect(watchVersion({ onUpdate: vi.fn(), request })).toBeTypeOf('function');
    expect(request).not.toHaveBeenCalled();
  });
});
