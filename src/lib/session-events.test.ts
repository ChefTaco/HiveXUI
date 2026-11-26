import { afterEach, describe, expect, it, vi } from 'vitest';
import { HiveApiError } from './api-error';
import { announceSignOut, onSessionEnded, resetSessionEvents, sessionEnded, setSessionChecker, verifySession } from './session-events';
import { createApiFetch, setUnauthorizedHandler } from './transport';

afterEach(() => {
  resetSessionEvents();
  setUnauthorizedHandler(undefined);
});

describe('session end', () => {
  it('asks the identity service once for any number of 401s, and signs out only on its refusal', async () => {
    let answer: () => Promise<unknown> = () => Promise.reject(new HiveApiError(401, 'Sign in to continue'));
    const check = vi.fn(() => answer());
    setSessionChecker(check);
    const ended = vi.fn();
    onSessionEnded(ended);
    const results = await Promise.all([verifySession(), verifySession(), verifySession()]);
    expect(results).toEqual([false, false, false]);
    expect(check).toHaveBeenCalledTimes(1);
    expect(ended).toHaveBeenCalledTimes(1);
    expect(ended).toHaveBeenCalledWith('expired');

    // An outage is not a sign-out: the session may well still be valid.
    answer = () => Promise.reject(new TypeError('Failed to fetch'));
    expect(await verifySession()).toBe(true);
    answer = () => Promise.reject(new HiveApiError(503, 'Oathweave could not be reached'));
    expect(await verifySession()).toBe(true);
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it('trusts a check that just passed for a burst of 401s', async () => {
    let now = 1_000_000;
    const check = vi.fn(async () => ({}));
    setSessionChecker(check);
    expect(await verifySession(() => now)).toBe(true);
    now += 5_000;
    expect(await verifySession(() => now)).toBe(true);
    expect(check).toHaveBeenCalledTimes(1);
    now += 10_000;
    await verifySession(() => now);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('keeps the person signed in without suite sign-in to check', async () => {
    const ended = vi.fn();
    onSessionEnded(ended);
    expect(await verifySession()).toBe(true);
    expect(ended).not.toHaveBeenCalled();
  });

  it('signs out the other tabs, carrying nothing but the fact', async () => {
    const other = new BroadcastChannel('hivexui-session');
    const seen: unknown[] = [];
    other.onmessage = (event) => seen.push(event.data);
    const ended = vi.fn();
    onSessionEnded(ended);
    announceSignOut();
    await vi.waitFor(() => expect(seen).toEqual([{ type: 'signed-out' }]));
    // The tab that signed out handles its own sign-out; only the others hear the message.
    expect(ended).not.toHaveBeenCalled();

    other.postMessage({ type: 'signed-out' });
    await vi.waitFor(() => expect(ended).toHaveBeenCalledWith('signed-out'));
    other.postMessage({ type: 'something-else' });
    other.postMessage('signed-out');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(ended).toHaveBeenCalledTimes(1);
    other.close();
  });

  it('stops listening when asked', () => {
    const ended = vi.fn();
    const stop = onSessionEnded(ended);
    stop();
    sessionEnded();
    expect(ended).not.toHaveBeenCalled();
  });
});

describe('a product 401', () => {
  it('asks the shell to check the session, without holding up the answer', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    const send = createApiFetch(async (input) => (String(input).includes('denied') ? new Response('{}', { status: 401 }) : Response.json({})));
    expect((await send('/api/hivemem/v1/ok')).status).toBe(200);
    expect((await send('/api/hivemem/v1/denied')).status).toBe(401);
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
  });
});
