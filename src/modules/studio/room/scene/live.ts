// The room's polite live region: state changes in words, at most one per agent every 3 s, the latest
// one winning. Streamed replies are announced by their state text ("Replying…", then "Replied"),
// never per delta.
import { useEffect, useRef, useState } from 'react';
import type { SceneAgent } from './model';

export const ANNOUNCE_INTERVAL_MS = 3_000;

/** Throttles announcements per agent. Time is passed in, so tests need no clock. */
export class AnnouncementThrottle {
  readonly #last = new Map<string, number>();
  readonly #pending = new Map<string, string>();

  /** Returns the text to announce now, or null when it waits for the agent's interval to pass. */
  offer(ref: string, text: string, now: number): string | null {
    const last = this.#last.get(ref);
    if (last === undefined || now - last >= ANNOUNCE_INTERVAL_MS) {
      this.#last.set(ref, now);
      this.#pending.delete(ref);
      return text;
    }
    this.#pending.set(ref, text);
    return null;
  }

  /** Waiting announcements whose interval has passed, and when the next one falls due. */
  due(now: number): { ready: string[]; next: number | null } {
    const ready: string[] = [];
    let next: number | null = null;
    for (const [ref, text] of this.#pending) {
      const at = (this.#last.get(ref) ?? 0) + ANNOUNCE_INTERVAL_MS;
      if (at <= now) {
        ready.push(text);
        this.#last.set(ref, now);
        this.#pending.delete(ref);
      } else next = next === null ? at : Math.min(next, at);
    }
    return { ready, next };
  }

  /** When the earliest waiting announcement falls due; null when none waits. */
  nextDue(): number | null {
    let next: number | null = null;
    for (const ref of this.#pending.keys()) {
      const at = (this.#last.get(ref) ?? 0) + ANNOUNCE_INTERVAL_MS;
      next = next === null ? at : Math.min(next, at);
    }
    return next;
  }

  forget(ref: string): void {
    this.#pending.delete(ref);
  }
}

const announcement = (agent: SceneAgent) => `${agent.displayName}: ${agent.label}`;

/** What the live region says. The first render announces nothing: only changes are news. */
export function useRoomAnnouncements(agents: readonly SceneAgent[], now: () => number = Date.now): string {
  const [message, setMessage] = useState('');
  const throttle = useRef(new AnnouncementThrottle());
  const previous = useRef<Map<string, string> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clock = useRef(now);
  clock.current = now;

  useEffect(() => {
    const labels = new Map(agents.map((agent) => [agent.ref, agent.label] as const));
    const before = previous.current;
    previous.current = labels;
    if (!before) return;
    const spoken: string[] = [];
    for (const agent of agents) {
      if (before.get(agent.ref) === agent.label) continue;
      const text = throttle.current.offer(agent.ref, announcement(agent), clock.current());
      if (text) spoken.push(text);
    }
    for (const ref of before.keys()) if (!labels.has(ref)) throttle.current.forget(ref);
    if (spoken.length) setMessage(spoken.join('. '));
    schedule();
  }, [agents]);

  function schedule(): void {
    if (timer.current) clearTimeout(timer.current);
    const next = throttle.current.nextDue();
    if (next === null) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      const { ready } = throttle.current.due(clock.current());
      if (ready.length) setMessage(ready.join('. '));
      schedule();
    }, Math.max(0, next - clock.current()));
  }

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return message;
}
