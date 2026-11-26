// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, settle, stubBrowser, type Mounted } from '../modules/magnus/test-dom';
import { RELATIVE_TIME_TICK_MS, RelativeTime } from './relative-time';

let view: Mounted | undefined;
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  vi.useRealTimers();
});

describe('a shown age', () => {
  it('keeps counting while on screen', async () => {
    stubBrowser();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
    view = await mount(<RelativeTime prefix="Synced " value={new Date()} />);
    expect(view.container.textContent).toBe('Synced 0s ago');
    await settle(RELATIVE_TIME_TICK_MS * 6, (ms) => vi.advanceTimersByTimeAsync(ms));
    expect(view.container.textContent).toBe('Synced 1m ago');
  });
});
