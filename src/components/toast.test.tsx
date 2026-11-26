// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { button, click, mount, settle, stubBrowser, type Mounted } from '../modules/magnus/test-dom';
import { useToast } from './toast';

let view: Mounted | undefined;
beforeEach(() => stubBrowser());
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  vi.useRealTimers();
});

function Probe({ onUndo }: { onUndo: () => void }) {
  const toast = useToast();
  return (
    <>
      <button type="button" onClick={() => toast.info('Deleted Worldbuilder', 'The role left the draft.', { label: 'Undo', onAction: onUndo })}>With action</button>
      <button type="button" onClick={() => toast.success('Saved')}>Plain</button>
      <button type="button" onClick={() => toast.error('Save failed', 'Request ID req-123')}>Failure</button>
    </>
  );
}

describe('toasts', () => {
  it('offer an action that runs once and dismisses the toast', async () => {
    const onUndo = vi.fn();
    view = await mount(<Probe onUndo={onUndo} />);
    await click(button('With action'));
    const toast = document.querySelector('.toast')!;
    expect(toast.textContent).toContain('Deleted Worldbuilder');
    await click(button('Undo', toast));
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.toast')).toBeNull();
  });

  it('keep a toast with an action longer than a plain one', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    view = await mount(<Probe onUndo={() => undefined} />);
    await click(button('With action'));
    await click(button('Plain'));
    expect(document.querySelectorAll('.toast')).toHaveLength(2);
    await settle(4_500, (ms) => vi.advanceTimersByTimeAsync(ms));
    expect([...document.querySelectorAll('.toast')].map((item) => item.querySelector('strong')?.textContent)).toEqual(['Deleted Worldbuilder']);
    expect(button('Undo', document.querySelector('.toast')!)).toBeDefined();
    await settle(2_500, (ms) => vi.advanceTimersByTimeAsync(ms));
    expect(document.querySelector('.toast')).toBeNull();
  });

  it('keep an error on screen until dismissed and announce it assertively', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    view = await mount(<Probe onUndo={() => undefined} />);
    await click(button('Failure'));
    await click(button('Plain'));
    const alert = document.querySelector('.toast-stack [role="alert"]')!;
    expect(alert.classList.contains('toast--error')).toBe(true);
    expect(alert.textContent).toContain('Request ID req-123');
    expect(document.querySelector('[role="status"]')!.textContent).toContain('Saved');
    expect(alert.querySelector('.toast__progress')).toBeNull();
    await settle(60_000, (ms) => vi.advanceTimersByTimeAsync(ms));
    expect(document.querySelector('[role="status"] .toast')).toBeNull();
    // Clicking the text (to select the request ID) does not dismiss it; the close button does.
    await click(alert.querySelector('.toast__body'));
    expect(alert.isConnected).toBe(true);
    await click(button('Dismiss notification', alert));
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it('pause the clock while a toast is hovered', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    view = await mount(<Probe onUndo={() => undefined} />);
    await click(button('Plain'));
    await settle(2_000, (ms) => vi.advanceTimersByTimeAsync(ms));
    const toast = document.querySelector('.toast')!;
    await act(async () => {
      toast.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }));
    });
    await settle(10_000, (ms) => vi.advanceTimersByTimeAsync(ms));
    expect(document.querySelector('.toast')).not.toBeNull();
    await act(async () => {
      toast.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
    });
    await settle(1_500, (ms) => vi.advanceTimersByTimeAsync(ms));
    expect(document.querySelector('.toast')).not.toBeNull();
    await settle(1_000, (ms) => vi.advanceTimersByTimeAsync(ms));
    expect(document.querySelector('.toast')).toBeNull();
  });
});
