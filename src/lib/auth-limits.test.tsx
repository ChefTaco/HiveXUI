import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_LIMITS_MESSAGE, AuthLimitsNotice } from '../components/auth-limits-strip';
import { readAuthLimitsRelaxed, watchAuthLimits } from './auth-limits';

const live = (authLimitsRelaxed: boolean) => Response.json({ status: 'ok', version: '1', authLimitsRelaxed });

describe('the relaxed sign-in limits check', () => {
  it('reads the public route with no credentials and no redirects', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(live(true));
    await expect(readAuthLimitsRelaxed('/api/oathweave', request)).resolves.toBe(true);
    const [url, init] = request.mock.calls[0]!;
    expect(url).toBe('/api/oathweave/health/live');
    expect(init).toMatchObject({ credentials: 'omit', redirect: 'error', cache: 'no-store' });
    expect(new Headers(init?.headers).has('authorization')).toBe(false);
  });
  it('fails on a body without the field, rather than reading it as off', async () => {
    await expect(readAuthLimitsRelaxed('/api/oathweave', vi.fn<typeof fetch>().mockResolvedValue(Response.json({ status: 'ok' })))).rejects.toThrow();
    await expect(readAuthLimitsRelaxed('/api/oathweave', vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 500 })))).rejects.toThrow();
  });
});

describe('watching the mode', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it('reports it on, then off when the server turns it off', async () => {
    const onChange = vi.fn();
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(live(true)).mockResolvedValue(live(false));
    const stop = watchAuthLimits('/api/oathweave', onChange, request);
    await vi.advanceTimersByTimeAsync(0);
    expect(onChange.mock.calls).toEqual([[true]]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onChange.mock.calls).toEqual([[true], [false]]);
    stop();
  });
  it('never goes silent because a check failed: the warning stays until the server says otherwise', async () => {
    const onChange = vi.fn();
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(live(true)).mockRejectedValue(new Error('offline'));
    const stop = watchAuthLimits('/api/oathweave', onChange, request);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(onChange.mock.calls).toEqual([[true]]);
    expect(request.mock.calls.length).toBeGreaterThan(3);
    stop();
  });
  it('picks the mode up when it turns on later, and stops when unmounted', async () => {
    const onChange = vi.fn();
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(live(false)).mockResolvedValue(live(true));
    const stop = watchAuthLimits('/api/oathweave', onChange, request);
    await vi.advanceTimersByTimeAsync(0);
    expect(onChange).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onChange.mock.calls).toEqual([[true]]);
    stop();
    const calls = request.mock.calls.length;
    await vi.advanceTimersByTimeAsync(600_000);
    expect(request.mock.calls.length).toBe(calls);
  });
});

describe('the warning strip', () => {
  const html = renderToStaticMarkup(<AuthLimitsNotice />);
  it('says what is going on, in plain words', () => {
    expect(html).toContain('sign-in limits are relaxed');
    expect(AUTH_LIMITS_MESSAGE).toMatch(/testing/i);
  });
  it('cannot be dismissed: it holds no control at all', () => {
    expect(html).not.toMatch(/<button|<a |<input|onclick|close|dismiss/i);
  });
  it('announces itself without being reported as a page failure', () => {
    expect(html).toContain('role="status"');
    expect(html).not.toContain('role="alert"');
  });
});
