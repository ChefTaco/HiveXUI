// @vitest-environment jsdom
import { act, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { button, click, mount, settle, stubBrowser, type Mounted } from '../modules/magnus/test-dom';
import { announceStepUpOutcome, resetStepUpNotices, STEP_UP_CANCELLED_TITLE, STEP_UP_VERIFIED_MESSAGE } from '../lib/step-up-notice';
import { useToast } from './toast';
import { Button, ConfirmDialog, Drawer } from './ui';

let view: Mounted | undefined;
beforeEach(() => stubBrowser());
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  resetStepUpNotices();
});

/** The Issue key drawer in miniature: Generate is disabled while its request runs. */
function KeyDrawer({ open = true }: { open?: boolean }) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  return (
    <>
      <button type="button" onClick={() => toast.info(STEP_UP_CANCELLED_TITLE, 'Nothing was changed. Start the action again when you are ready.')}>Toast cancelled</button>
      <button type="button" onClick={() => toast.error('Save failed', `${STEP_UP_VERIFIED_MESSAGE} (request req-1)`)}>Toast verified</button>
      <button type="button" onClick={() => toast.success('API key updated')}>Toast other</button>
      <button type="button" onClick={() => setSaving((value) => !value)}>Toggle saving</button>
      <Drawer
        open={open}
        title="API key details"
        onClose={() => undefined}
        footer={<><Button variant="ghost">Cancel</Button><Button variant="primary" loading={saving}>Generate key</Button></>}
      >
        <button type="button">Use metadata-only traces</button>
      </Drawer>
    </>
  );
}

const drawer = () => document.querySelector<HTMLElement>('.drawer')!;
const status = () => drawer().querySelector('[role="status"]')!;
const toasts = () => [...document.querySelectorAll('.toast')].map((item) => item.textContent);
const focusAndPress = async (element: HTMLElement) => {
  await act(async () => element.focus());
  await click(element);
};

describe('a step-up outcome in an open drawer', () => {
  it('is announced beside the actions, can be dismissed, and focus goes back to the action that asked', async () => {
    view = await mount(<KeyDrawer />);
    // The live region is there before anything is said in it.
    expect(status().getAttribute('aria-live')).toBe('polite');
    expect(status().textContent).toBe('');
    expect(drawer().querySelector('.step-up-notice')!.nextElementSibling!.classList.contains('drawer-footer')).toBe(true);

    const generate = button('Generate key', drawer())!;
    await focusAndPress(generate);
    await click(button('Toggle saving'));
    expect(generate.disabled).toBe(true);
    // The identity prompt took focus; when it closes, focus is nowhere in particular.
    await act(async () => generate.blur());
    await act(async () => {
      expect(announceStepUpOutcome('verified')).toBe(true);
    });
    expect(status().textContent).toBe('Identity verified. Review and submit the operation again.');
    // Generate is still busy: focus waits for it.
    await settle(60);
    expect(document.activeElement).toBe(document.body);
    await click(button('Toggle saving'));
    await settle(60);
    expect(document.activeElement).toBe(generate);

    // Focus elsewhere in the drawer, then dismiss: focus returns to the action, not the last button.
    await focusAndPress(button('Use metadata-only traces', drawer())!);
    await click(button('Dismiss notice', drawer()));
    expect(status().textContent).toBe('');
    expect(button('Dismiss notice', drawer())).toBeUndefined();
    await settle(0);
    expect(document.activeElement).toBe(generate);
  });

  it('says a cancelled check changed nothing, and falls back to the primary action for focus', async () => {
    view = await mount(<KeyDrawer />);
    await act(async () => {
      announceStepUpOutcome('cancelled');
    });
    expect(status().textContent).toBe('Identity verification cancelled. Nothing was changed. Start the action again when you are ready.');
    await settle(0);
    expect(document.activeElement).toBe(button('Generate key', drawer()));
  });

  it('replaces the toasts that would repeat it, and leaves other toasts alone', async () => {
    view = await mount(<KeyDrawer />);
    await click(button('Toast cancelled'));
    await click(button('Toast other'));
    expect(toasts()).toHaveLength(2);
    await act(async () => {
      announceStepUpOutcome('cancelled');
    });
    expect(toasts()).toEqual([expect.stringContaining('API key updated')]);
    await act(async () => {
      announceStepUpOutcome('verified');
    });
    await click(button('Toast verified'));
    expect(toasts()).toEqual([expect.stringContaining('API key updated')]);
  });

  it('is not claimed with no drawer or dialog open, so the page toasts it as before', async () => {
    view = await mount(<KeyDrawer open={false} />);
    await act(async () => {
      expect(announceStepUpOutcome('verified')).toBe(false);
    });
    await click(button('Toast verified'));
    expect(toasts()).toEqual([expect.stringContaining(STEP_UP_VERIFIED_MESSAGE)]);
  });
});

describe('a step-up outcome in a confirmation', () => {
  it('goes to the topmost overlay: the confirmation over a drawer', async () => {
    view = await mount(
      <>
        <KeyDrawer />
        <ConfirmDialog open title="Delete key?" message="It will be removed." onConfirm={() => undefined} onCancel={() => undefined} />
      </>,
    );
    await act(async () => {
      announceStepUpOutcome('verified');
    });
    const confirm = document.querySelector('.confirm-box')!;
    expect(confirm.querySelector('[role="status"]')!.textContent).toContain('Identity verified.');
    expect(confirm.querySelector('.step-up-notice')!.nextElementSibling!.classList.contains('confirm-actions')).toBe(true);
    expect(status().textContent).toBe('');
    await settle(0);
    expect(document.activeElement).toBe(button('Delete', confirm));
  });
});
