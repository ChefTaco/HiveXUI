// What each agent in the room shows. The Studio service is the single source of an agent's activity:
// it derives one state and label per agent from real records (ArdentStudio docs/CONDUCTOR.md#activity),
// and the room shows it as sent. The browser overlays only "speaking" from the live reply stream
// ("Replying…", then "Replied" for a moment), plus hand-off and delivery arcs from the messages and
// revisions the service records. Pure, so the room page folds the snapshot and the stream through
// it and tests walk it without a clock.
import type { Activity, Message } from '../api/endpoints';
import type { SceneArc } from './scene/model';
import { ARC_HOLD_MS, SPEAKING_HOLD_MS, excerpt, type Presence } from './scene/presence';

const AUTHOR_MEMORY = 200;

interface Reply {
  messageId: string;
  startedAt: number;
  endedAt: number | null;
}
interface ArcRecord {
  id: string;
  kind: 'handoff' | 'delivery';
  from: string;
  toRole?: string;
  label: string;
  at: number;
}
export interface RoomPresenceState {
  /** The stored activity per agent ref. */
  activity: Readonly<Record<string, Presence>>;
  replies: Readonly<Record<string, Reply>>;
  /** Which agent wrote each reply seen so far, so a bare delta can be put on its agent. */
  authors: Readonly<Record<string, string>>;
  arcs: readonly ArcRecord[];
}

export type RoomPresenceEvent =
  /** The snapshot's activity: replaces what was stored. */
  | { type: 'activity'; items: readonly Activity[] }
  | { type: 'presence'; activity: Activity }
  /** A stored message; `agent` is the ref of its author when an agent wrote it. */
  | { type: 'message'; message: Message; agent: string | null; at: number }
  | { type: 'delta'; messageId: string; at: number }
  /** A verified deliverable revision from an agent. */
  | { type: 'delivery'; id: string; agent: string; label: string; at: number };

export const emptyRoomPresence = (): RoomPresenceState => ({ activity: {}, replies: {}, authors: {}, arcs: [] });

/** The service's state as sent. The scene has a look for every state the contract names, or this stops compiling. */
const toPresence = (activity: Activity): Presence => ({
  state: activity.state,
  label: activity.label || 'Unknown',
  since: Date.parse(activity.since) || 0,
});

const record = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

function startReply(state: RoomPresenceState, agent: string, messageId: string, at: number): RoomPresenceState {
  const current = state.replies[agent];
  if (current?.messageId === messageId) return state;
  return { ...state, replies: { ...state.replies, [agent]: { messageId, startedAt: at, endedAt: null } } };
}

function remember(state: RoomPresenceState, messageId: string, agent: string): RoomPresenceState {
  if (state.authors[messageId] === agent) return state;
  const entries = Object.entries(state.authors);
  const kept = entries.length >= AUTHOR_MEMORY ? Object.fromEntries(entries.slice(-AUTHOR_MEMORY + 1)) : state.authors;
  return { ...state, authors: { ...kept, [messageId]: agent } };
}

export function reduceRoomPresence(state: RoomPresenceState, event: RoomPresenceEvent): RoomPresenceState {
  switch (event.type) {
    case 'activity':
      return { ...state, activity: Object.fromEntries(event.items.map((item) => [item.agent_ref, toPresence(item)])) };
    case 'presence':
      return { ...state, activity: { ...state.activity, [event.activity.agent_ref]: toPresence(event.activity) } };
    case 'delta': {
      const agent = state.authors[event.messageId];
      return agent ? startReply(state, agent, event.messageId, event.at) : state;
    }
    case 'delivery':
      if (state.arcs.some((arc) => arc.id === event.id)) return state;
      return { ...state, arcs: [...state.arcs, { id: event.id, kind: 'delivery', from: event.agent, label: event.label, at: event.at }] };
    case 'message': {
      const { message, agent, at } = event;
      if (!agent) return state;
      let next = remember(state, message.id, agent);
      if (message.state === 'streaming') return startReply(next, agent, message.id, at);
      const reply = next.replies[agent];
      if (reply?.messageId === message.id && reply.endedAt === null) next = { ...next, replies: { ...next.replies, [agent]: { ...reply, endedAt: at } } };
      if (message.kind === 'handoff') {
        const handoff = record(message.links.handoff);
        const toRole = typeof handoff.to_role === 'string' ? handoff.to_role : null;
        if (handoff.allowed === true && toRole && !next.arcs.some((arc) => arc.id === message.id)) {
          const objective = typeof handoff.objective === 'string' && handoff.objective.trim() ? excerpt(handoff.objective) : excerpt(message.body_md) || `Hand-off to ${toRole}`;
          next = { ...next, arcs: [...next.arcs, { id: message.id, kind: 'handoff', from: agent, toRole, label: objective, at }] };
        }
      }
      return next;
    }
  }
}

/** One agent's state and words at `now`. A live reply wins; "Replied" stays for a moment after it. */
export function roomPresenceOf(state: RoomPresenceState, agent: string, now: number): Presence {
  const reply = state.replies[agent];
  if (reply && reply.endedAt === null) return { state: 'speaking', label: 'Replying…', since: reply.startedAt };
  if (reply?.endedAt != null && now < reply.endedAt + SPEAKING_HOLD_MS) return { state: 'speaking', label: 'Replied', since: reply.endedAt };
  return state.activity[agent] ?? { state: 'unknown', label: 'Status not checked yet', since: 0 };
}

/** Arcs still drawn at `now`. A hand-off to a role nobody holds is left out. */
export function roomArcs(state: RoomPresenceState, now: number, agentForRole: (role: string) => string | undefined): SceneArc[] {
  return state.arcs
    .filter((arc) => now < arc.at + ARC_HOLD_MS)
    .flatMap((arc): SceneArc[] => {
      if (arc.kind === 'delivery') return [{ id: arc.id, kind: 'delivery', from: arc.from, label: arc.label }];
      const to = arc.toRole ? agentForRole(arc.toRole) : undefined;
      return to && to !== arc.from ? [{ id: arc.id, kind: 'handoff', from: arc.from, to, label: arc.label }] : [];
    });
}

/** When the next held state or arc runs out; null when nothing is held. */
export function nextRoomChange(state: RoomPresenceState, now: number): number | null {
  const ends = [
    ...Object.values(state.replies).flatMap((reply) => (reply.endedAt !== null ? [reply.endedAt + SPEAKING_HOLD_MS] : [])),
    ...state.arcs.map((arc) => arc.at + ARC_HOLD_MS),
  ].filter((end) => end > now);
  return ends.length ? Math.min(...ends) : null;
}

/** Drops arcs that ran out, so a long session does not keep them. */
export function pruneRoomPresence(state: RoomPresenceState, now: number): RoomPresenceState {
  const arcs = state.arcs.filter((arc) => now < arc.at + ARC_HOLD_MS);
  return arcs.length === state.arcs.length ? state : { ...state, arcs };
}
