// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, stubBrowser, type Mounted } from '../../../magnus/test-dom';
import { emptyPresence, presenceOf, reducePresence, SPEAKING_HOLD_MS, type PresenceState } from './presence';
import { usePresenceNow } from './use-presence';

let view: Mounted | undefined;
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  vi.useRealTimers();
});

function Probe({ state }: { state: PresenceState }) {
  const now = usePresenceNow(state);
  return <span>{presenceOf(state, 'node-1~lead', now).label}</span>;
}

describe('usePresenceNow', () => {
  it('lets "Replied" run out after its hold without any other update', async () => {
    stubBrowser();
    vi.useFakeTimers({ now: 10_000 });
    const state = [
      { type: 'probe', at: 1, agent: 'node-1~lead', ready: true },
      { type: 'delta.started', at: 9_000, agent: 'node-1~lead', taskId: 't' },
      { type: 'delta.ended', at: 10_000, agent: 'node-1~lead', taskId: 't' },
    ].reduce((current, event) => reducePresence(current, event as Parameters<typeof reducePresence>[1]), emptyPresence());
    view = await mount(<Probe state={state} />);
    expect(view.container.textContent).toBe('Replied');
    await act(async () => vi.advanceTimersByTime(SPEAKING_HOLD_MS - 1));
    expect(view.container.textContent).toBe('Replied');
    await act(async () => vi.advanceTimersByTime(1));
    expect(view.container.textContent).toBe('Available');
  });
});
