// What the scene shows for an agent, and how long the browser's own overlays last. The agent's
// activity (offline, available, queued, working, asking, waiting, reviewing, delivering, paused,
// blocked, unknown) comes from the Studio service, which derives it from real records with one
// precedence (ArdentStudio docs/CONDUCTOR.md#activity); the scene renders whatever it sends. The
// browser adds only "speaking", from the live reply stream, and the hand-off and delivery arcs.
import type { AgentState } from './model';

/** How long "Replied" stays after the reply message completes. */
export const SPEAKING_HOLD_MS = 4_000;
/** How long a hand-off or delivery arc stays drawn. */
export const ARC_HOLD_MS = 8_000;
const EXCERPT_CHARS = 60;

export interface Presence {
  state: AgentState;
  label: string;
  since: number;
}

/** One line of at most 60 characters, for an objective shown on an arc. */
export function excerpt(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length <= EXCERPT_CHARS ? line : `${line.slice(0, EXCERPT_CHARS - 1).trimEnd()}…`;
}
