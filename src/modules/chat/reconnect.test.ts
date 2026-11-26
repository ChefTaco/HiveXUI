import { afterEach, describe, expect, it, vi } from 'vitest';
import { HiveApiError } from '../../lib/api-error';
import { createReconnector, HEALTHY_MS, reconnectDelay } from './reconnect';

afterEach(() => vi.useRealTimers());

describe('chat reconnect', () => {
  it('backs off exponentially with jitter up to a minute', () => {
    expect([1, 2, 3, 4, 10].map((attempt) => reconnectDelay(attempt, () => 1))).toEqual([1000, 2000, 4000, 8000, 60_000]);
    expect(reconnectDelay(3, () => 0)).toBe(2000);
  });

  it('renews the chat session before every attempt, and waits longer after each failure', async () => {
    vi.useFakeTimers();
    const prepare = vi.fn(async () => {});
    const connect = vi.fn();
    const reconnect = createReconnector({ prepare, connect, onRefused: vi.fn(), random: () => 1 });
    reconnect.closed();
    await vi.advanceTimersByTimeAsync(999);
    expect(prepare).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledTimes(1);
    // The socket failed again without opening: twice the wait.
    reconnect.closed();
    await vi.advanceTimersByTimeAsync(1999);
    expect(connect).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(connect).toHaveBeenCalledTimes(2);
    reconnect.stop();
  });

  it('starts the backoff again after a healthy connection', async () => {
    vi.useFakeTimers();
    const connect = vi.fn();
    const reconnect = createReconnector({ prepare: async () => {}, connect, onRefused: vi.fn(), random: () => 1 });
    reconnect.closed();
    await vi.advanceTimersByTimeAsync(1000);
    reconnect.closed();
    await vi.advanceTimersByTimeAsync(2000);
    reconnect.opened();
    await vi.advanceTimersByTimeAsync(HEALTHY_MS);
    reconnect.closed();
    await vi.advanceTimersByTimeAsync(1000);
    expect(connect).toHaveBeenCalledTimes(3);
    reconnect.stop();
  });

  it('stops when the chat session cannot be renewed, and retries a network failure', async () => {
    vi.useFakeTimers();
    const onRefused = vi.fn();
    const connect = vi.fn();
    const prepare = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockRejectedValueOnce(new HiveApiError(401, 'Sign in again'));
    const reconnect = createReconnector({ prepare, connect, onRefused, random: () => 1 });
    reconnect.closed();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onRefused).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    expect(onRefused).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(connect).not.toHaveBeenCalled();
  });

  it('does nothing once stopped', async () => {
    vi.useFakeTimers();
    const prepare = vi.fn(async () => {});
    const reconnect = createReconnector({ prepare, connect: vi.fn(), onRefused: vi.fn() });
    reconnect.closed();
    reconnect.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(prepare).not.toHaveBeenCalled();
  });
});
