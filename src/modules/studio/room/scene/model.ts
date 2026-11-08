// The Conversation Room's scene model. A local shape until the Studio service publishes its browser
// contract; the scene reads only these types, so swapping the source later touches nothing here.

/** What an agent is doing, as far as real records show. `unknown` until something says otherwise. */
export const AGENT_STATES = ['offline', 'available', 'queued', 'working', 'speaking', 'asking', 'waiting', 'reviewing', 'delivering', 'paused', 'blocked', 'unknown'] as const;
export type AgentState = (typeof AGENT_STATES)[number];

export const PORTRAIT_PRESETS = ['crest', 'hood', 'visor', 'bun', 'cap', 'antenna'] as const;
export type PortraitPreset = (typeof PORTRAIT_PRESETS)[number];
/** Identity colors, `--persona-1` to `--persona-6` in tokens.css. They mean "this agent", never a status. */
export const PORTRAIT_ACCENTS = ['persona-1', 'persona-2', 'persona-3', 'persona-4', 'persona-5', 'persona-6'] as const;
export type PortraitAccent = (typeof PORTRAIT_ACCENTS)[number];
export const PORTRAIT_EMBLEMS = ['star', 'quill', 'compass', 'gear', 'leaf', 'bolt', 'eye', 'book'] as const;
export type PortraitEmblem = (typeof PORTRAIT_EMBLEMS)[number];

export interface Portrait {
  preset: PortraitPreset;
  accent: PortraitAccent;
  emblem: PortraitEmblem;
}

export interface SceneAgent {
  /** `<nodeId>~<profile>`, the Magnus profile reference. */
  ref: string;
  displayName: string;
  roleName: string;
  portrait: Portrait;
  /** The agent's home seat in the layout. */
  seat: string;
  state: AgentState;
  /** The visible text for the state, such as "Working: drafting regions". */
  label: string;
  /** When the state began, in epoch milliseconds. */
  since: number;
}

export type SeatKind = 'desk' | 'table' | 'review';
export interface Seat {
  id: string;
  kind: SeatKind;
  /** Floor position in tiles: x runs down to the right, y down to the left. */
  x: number;
  y: number;
  /** The zone the seat belongs to, for its label. */
  zone: string;
}
export interface Placement {
  agent: string;
  seat: string;
}
export interface RoomLayout {
  seats: Seat[];
  placements: Placement[];
  /** Zone id to the name shown on the floor. */
  zoneLabels: Record<string, string>;
}

/** What the display wall shows. Absent values show as empty slots, never as made-up text. */
export interface DisplayWall {
  brief?: string;
  focus?: string;
  decisions?: number;
  questions?: number;
}

/** A labelled arc between two agents (a hand-off or directed exchange) or from an agent to the shelf. */
export interface SceneArc {
  id: string;
  kind: 'handoff' | 'delivery';
  from: string;
  /** The receiving agent for a hand-off; deliveries always land on the shelf. */
  to?: string;
  label: string;
}

/** An item on the delivery shelf. */
export interface ShelfItem {
  id: string;
  label: string;
}

/** Visible text for each state when no task gives it more detail. */
export const STATE_TEXT: Record<AgentState, string> = {
  offline: 'Offline',
  available: 'Available',
  queued: 'Queued',
  working: 'Working',
  speaking: 'Replying…',
  asking: 'Asking a question',
  waiting: 'Waiting',
  reviewing: 'Reviewing',
  delivering: 'Delivered',
  paused: 'Paused',
  blocked: 'Blocked',
  unknown: 'Unknown',
};

function hash(value: string): number {
  let h = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    h ^= value.charCodeAt(index);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The portrait an agent gets until someone picks one: the same for the same ref, every time. */
export function defaultPortrait(ref: string): Portrait {
  const h = hash(ref);
  return {
    preset: PORTRAIT_PRESETS[h % PORTRAIT_PRESETS.length]!,
    accent: PORTRAIT_ACCENTS[Math.floor(h / PORTRAIT_PRESETS.length) % PORTRAIT_ACCENTS.length]!,
    emblem: PORTRAIT_EMBLEMS[Math.floor(h / (PORTRAIT_PRESETS.length * PORTRAIT_ACCENTS.length)) % PORTRAIT_EMBLEMS.length]!,
  };
}

/** The accessible name of an avatar: "Cartographer, Working: drafting map". */
export const agentAccessibleName = (agent: Pick<SceneAgent, 'displayName' | 'label'>): string => `${agent.displayName}, ${agent.label}`;
