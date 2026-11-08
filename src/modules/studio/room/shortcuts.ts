// Two-key shortcuts for the room: g r focuses the room, g t the transcript, g c the composer. Keys
// typed into a field are text, never shortcuts.
import { useEffect, useRef } from 'react';

export type RoomTarget = 'room' | 'transcript' | 'composer';
const TARGETS: Record<string, RoomTarget> = { r: 'room', t: 'transcript', c: 'composer' };
/** How long the second key may follow g. */
export const SEQUENCE_MS = 1_500;

/** Reads key presses one at a time; returns the target when a sequence completes. Time is passed in. */
export class KeySequence {
  #pendingSince: number | null = null;

  press(key: string, now: number): RoomTarget | null {
    const lower = key.toLowerCase();
    if (this.#pendingSince !== null && now - this.#pendingSince <= SEQUENCE_MS) {
      this.#pendingSince = null;
      const target = TARGETS[lower];
      if (target) return target;
    }
    this.#pendingSince = lower === 'g' ? now : null;
    return null;
  }
}

const typing = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
};

/** Listens on the document while the room is open. */
export function useRoomShortcuts(onTarget: (target: RoomTarget) => void, enabled = true): void {
  const latest = useRef(onTarget);
  latest.current = onTarget;
  useEffect(() => {
    if (!enabled) return;
    const sequence = new KeySequence();
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || typing(event.target)) return;
      if (event.key.length !== 1) return;
      const target = sequence.press(event.key, Date.now());
      if (!target) return;
      event.preventDefault();
      latest.current(target);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [enabled]);
}
