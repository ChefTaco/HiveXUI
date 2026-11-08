// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, settle, stubBrowser, type Mounted } from '../test-dom';
import { MagnusApiError } from './errors';
import { useMagnusResource } from './use-resource';

let view: Mounted | undefined;
beforeEach(() => {
  stubBrowser();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  vi.useRealTimers();
});

function Poller({ load }: { load: () => Promise<string> }) {
  const resource = useMagnusResource(load, [], { pollMs: 5_000 });
  return <p>{resource.data ?? (resource.error ? 'limited' : 'loading')}</p>;
}
const advance = (ms: number) => settle(ms, (step) => vi.advanceTimersByTimeAsync(step));

describe('a polled Magnus read', () => {
  it('waits at least the Retry-After of a 429 before polling again', async () => {
    const load = vi.fn(async () => {
      throw new MagnusApiError(429, 'Too many requests. Try again in 40 seconds.', 'RATE_LIMITED', 40_000);
    });
    view = await mount(<Poller load={load} />);
    await advance(0);
    expect(load).toHaveBeenCalledTimes(1);
    expect(view.container.textContent).toBe('limited');
    // Polls due before Retry-After has passed are skipped, so nothing is sent before 40 s.
    await advance(39_000);
    expect(load).toHaveBeenCalledTimes(1);
    await advance(1_500);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
