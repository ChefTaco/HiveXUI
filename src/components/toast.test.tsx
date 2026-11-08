// @vitest-environment jsdom
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
});
