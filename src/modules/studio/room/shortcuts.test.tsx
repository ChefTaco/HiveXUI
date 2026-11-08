// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, stubBrowser, type Mounted } from '../../magnus/test-dom';
import { KeySequence, SEQUENCE_MS, useRoomShortcuts, type RoomTarget } from './shortcuts';

describe('room shortcuts', () => {
  it('reads g r, g t and g c, and nothing after the pause runs out', () => {
    const keys = new KeySequence();
    expect(keys.press('g', 0)).toBeNull();
    expect(keys.press('r', 100)).toBe('room');
    expect(keys.press('g', 200)).toBeNull();
    expect(keys.press('t', 300)).toBe('transcript');
    expect(keys.press('g', 400)).toBeNull();
    expect(keys.press('c', 400 + SEQUENCE_MS + 1)).toBeNull();
    expect(keys.press('x', 0)).toBeNull();
    expect(keys.press('c', 1)).toBeNull();
  });

  describe('on the page', () => {
    let view: Mounted | undefined;
    afterEach(async () => {
      await view?.unmount();
      view = undefined;
    });
    function Probe({ onTarget }: { onTarget: (target: RoomTarget) => void }) {
      useRoomShortcuts(onTarget);
      return <input aria-label="field" />;
    }
    const press = (key: string, target: EventTarget = document.body) => act(() => void target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })));

    it('fires from the page but never while typing in a field', async () => {
      stubBrowser();
      const onTarget = vi.fn();
      view = await mount(<Probe onTarget={onTarget} />);
      await press('g');
      await press('c');
      expect(onTarget).toHaveBeenCalledWith('composer');
      const input = view.container.querySelector('input')!;
      await press('g', input);
      await press('t', input);
      expect(onTarget).toHaveBeenCalledTimes(1);
    });
  });
});
