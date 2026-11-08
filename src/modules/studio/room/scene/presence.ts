// What each agent in the room is doing, folded from real records only: Studio task updates, Ardent
// journal events, the live reply stream and the profile probe. Pure, so the room can replay a
// snapshot and tests can walk the state table without a clock. Nothing here guesses: an agent with
// no record is `unknown`, and only a journal event can make it `working`.
import type { AgentState, SceneArc } from './model';

/** How long "Replied" stays after the reply message completes. */
export const SPEAKING_HOLD_MS = 4_000;
/** How long a delivery stays on the agent before it goes back to what it was doing. */
export const DELIVERY_HOLD_MS = 6_000;
/** How long a hand-off or delivery arc stays drawn. */
export const ARC_HOLD_MS = 8_000;
const EXCERPT_CHARS = 60;
const FINISHED_MEMORY = 64;

/** Ardent task states, as its journal and task records carry them. */
export type ArdentTaskState = 'queued' | 'running' | 'input_required' | 'completed' | 'partial' | 'failed' | 'cancelled' | 'unknown';
/** A team result outcome, which the Studio task mirror keeps after the task ends. */
export type TeamOutcome = 'completed' | 'partial' | 'failed' | 'blocked' | 'input_required' | 'cancelled' | 'unknown';
export type StudioTaskMode = 'turn' | 'assignment' | 'discussion_turn' | 'revision' | 'review' | 'team_proposal';

/** A Studio task record, as `task.*` events carry it: Ardent's state plus `pausing` while a pause waits for a step boundary. */
export interface PresenceTask {
  id: string;
  /** The agent ref the task runs on. */
  agent: string;
  title: string;
  mode: StudioTaskMode;
  state: ArdentTaskState | 'pausing';
  outcome?: TeamOutcome | null;
  /** The deliverable a review task is about. */
  deliverable?: string;
  /** The role a queued task is held for, by a hand-off or a dependency. */
  waitingFor?: string;
}

/** An Ardent journal event: `{sequence, task_id, kind, detail}`. */
export interface JournalEvent {
  sequence: number;
  task_id: string;
  kind: string;
  detail?: unknown;
}

export type PresenceEvent =
  | { type: 'task'; at: number; task: PresenceTask }
  | { type: 'journal'; at: number; agent: string; event: JournalEvent }
  /** The first live `task.delta` (or `task.text`) of a reply. */
  | { type: 'delta.started'; at: number; agent: string; taskId: string }
  /** The reply message completed: `task.done` wrote the stored message. */
  | { type: 'delta.ended'; at: number; agent: string; taskId: string }
  /** The profile-status probe. It can only make an agent available or offline. */
  | { type: 'probe'; at: number; agent: string; ready: boolean };

type Admission = 'open' | 'pausing' | 'paused';
interface TaskTrack {
  id: string;
  title?: string;
  mode?: StudioTaskMode;
  state: ArdentTaskState;
  outcome: TeamOutcome | null;
  deliverable?: string;
  waitingFor?: string;
  question?: string;
  admission: Admission;
  /** A model step or tool attempt was journaled: only then is the task shown as working. */
  worked: boolean;
  tool?: string;
  lastSequence: number;
  since: number;
  order: number;
}
interface AgentTrack {
  probe: 'ready' | 'failed' | null;
  probeSince: number;
  idleSince: number;
  tasks: Readonly<Record<string, TaskTrack>>;
  finished: readonly string[];
  reply: { taskId: string; startedAt: number; endedAt: number | null } | null;
  delivery: { name: string; revision: number | null; at: number } | null;
}
interface ArcRecord {
  id: string;
  kind: 'handoff' | 'delivery';
  from: string;
  toRole?: string;
  label: string;
  at: number;
}
export interface PresenceState {
  agents: Readonly<Record<string, AgentTrack>>;
  arcs: readonly ArcRecord[];
  order: number;
}

export interface Presence {
  state: AgentState;
  label: string;
  since: number;
}

export const emptyPresence = (): PresenceState => ({ agents: {}, arcs: [], order: 0 });

const TERMINAL: ReadonlySet<string> = new Set(['completed', 'partial', 'failed', 'cancelled']);
const ARDENT_STATES: ReadonlySet<string> = new Set(['queued', 'running', 'input_required', 'completed', 'partial', 'failed', 'cancelled', 'unknown']);

/** One line of at most 60 characters, for a question or objective shown in the room. */
export function excerpt(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length <= EXCERPT_CHARS ? line : `${line.slice(0, EXCERPT_CHARS - 1).trimEnd()}…`;
}

const record = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value : undefined);

function blankAgent(at: number): AgentTrack {
  return { probe: null, probeSince: at, idleSince: at, tasks: {}, finished: [], reply: null, delivery: null };
}

/** The status one task gives its agent, or null when it says nothing visible. */
function taskStatus(task: TaskTrack): Presence | null {
  const name = task.title ? `: ${task.title}` : '';
  if (task.state === 'input_required' || task.question !== undefined) return { state: 'asking', label: task.question ? `Asking: ${task.question}` : 'Asking a question', since: task.since };
  if (task.outcome === 'blocked') return { state: 'blocked', label: `Blocked${name}`, since: task.since };
  if (task.admission === 'paused') return { state: 'paused', label: `Paused${name}`, since: task.since };
  if (task.admission === 'pausing') return { state: 'paused', label: `Pause requested${name}`, since: task.since };
  if (task.state === 'running' && task.mode === 'review') return { state: 'reviewing', label: task.deliverable ? `Reviewing ${task.deliverable}` : `Reviewing${name}`, since: task.since };
  if (task.state === 'running' && task.worked) return { state: 'working', label: `Working${name}${task.tool ? ` · ${task.tool}` : ''}`, since: task.since };
  if (task.state === 'queued' && task.waitingFor) return { state: 'waiting', label: `Waiting for ${task.waitingFor}`, since: task.since };
  if (task.state === 'queued' || task.state === 'running') return { state: 'queued', label: `Queued${name}`, since: task.since };
  if (task.state === 'unknown' || task.outcome === 'unknown') return { state: 'unknown', label: `Unknown${name}`, since: task.since };
  return null;
}

const RANK: Partial<Record<AgentState, number>> = { asking: 0, blocked: 1, paused: 2, reviewing: 3, working: 4, waiting: 5, queued: 6, unknown: 7 };

/** Keeps `since` when a task's visible status did not change, so the room does not re-announce it. */
function settle(before: TaskTrack | undefined, after: TaskTrack, at: number): TaskTrack {
  if (!before) return { ...after, since: at };
  const was = taskStatus(before);
  const now = taskStatus(after);
  return was?.state === now?.state && was?.label === now?.label ? { ...after, since: before.since } : { ...after, since: at };
}

function withTask(state: PresenceState, agentRef: string, at: number, change: (task: TaskTrack | undefined, order: number) => TaskTrack | null, taskId: string): PresenceState {
  const agent = state.agents[agentRef] ?? blankAgent(at);
  if (agent.finished.includes(taskId)) return state;
  const before = agent.tasks[taskId];
  const order = before?.order ?? state.order + 1;
  const after = change(before, order);
  if (!after) return state;
  const tasks = { ...agent.tasks };
  const finished = TERMINAL.has(after.state) && after.outcome !== 'blocked' && after.outcome !== 'unknown';
  let next: AgentTrack;
  if (finished) {
    delete tasks[taskId];
    next = { ...agent, tasks, finished: [...agent.finished, taskId].slice(-FINISHED_MEMORY), idleSince: at };
  } else {
    tasks[taskId] = settle(before, after, at);
    next = { ...agent, tasks };
  }
  return { ...state, order: Math.max(state.order, order), agents: { ...state.agents, [agentRef]: next } };
}

function blank(taskId: string, order: number, at: number): TaskTrack {
  return { id: taskId, state: 'running', outcome: null, admission: 'open', worked: false, lastSequence: -1, since: at, order };
}

function applyTask(state: PresenceState, at: number, task: PresenceTask): PresenceState {
  return withTask(state, task.agent, at, (before, order) => {
    const base = before ?? blank(task.id, order, at);
    const pausing = task.state === 'pausing';
    const next: TaskTrack = {
      ...base,
      title: task.title,
      mode: task.mode,
      state: task.state === 'pausing' ? base.state : task.state,
      outcome: task.outcome ?? null,
      admission: pausing ? (base.admission === 'paused' ? 'paused' : 'pausing') : base.admission,
    };
    if (task.deliverable !== undefined) next.deliverable = task.deliverable;
    else delete next.deliverable;
    if (task.waitingFor !== undefined) next.waitingFor = task.waitingFor;
    else delete next.waitingFor;
    // A task that left input_required was answered; the question no longer stands.
    if (before?.state === 'input_required' && next.state !== 'input_required') delete next.question;
    return next;
  }, task.id);
}

function applyJournal(state: PresenceState, at: number, agentRef: string, event: JournalEvent): PresenceState {
  const detail = record(event.detail);
  let next = withTask(state, agentRef, at, (before, order) => {
    const base = before ?? blank(event.task_id, order, at);
    if (event.sequence <= base.lastSequence) return null;
    const task: TaskTrack = { ...base, lastSequence: event.sequence };
    switch (event.kind) {
      case 'state': {
        const to = detail.to;
        if (typeof to !== 'string' || !ARDENT_STATES.has(to)) return task;
        task.state = to as ArdentTaskState;
        if (base.state === 'input_required' && to !== 'input_required') delete task.question;
        return task;
      }
      case 'model_started':
        task.state = TERMINAL.has(task.state) ? task.state : 'running';
        task.worked = true;
        delete task.tool;
        return task;
      case 'tool_attempt': {
        task.worked = true;
        const name = text(detail.name);
        if (name) task.tool = name;
        return task;
      }
      case 'team_ask_user':
        // An empty question still asks; the label then says so without an excerpt.
        task.question = excerpt(text(detail.question) ?? '');
        return task;
      case 'pause_requested':
        task.admission = task.admission === 'paused' ? 'paused' : 'pausing';
        return task;
      case 'paused':
        task.admission = 'paused';
        return task;
      case 'resumed':
        task.admission = 'open';
        return task;
      default:
        return task;
    }
  }, event.task_id);
  if (next === state) return state;
  if (event.kind === 'artifact_registered') {
    const name = text(detail.name) ?? 'a file';
    const revision = typeof detail.revision === 'number' ? detail.revision : null;
    const agent = next.agents[agentRef]!;
    const label = deliveryLabel(name, revision);
    next = {
      ...next,
      agents: { ...next.agents, [agentRef]: { ...agent, delivery: { name, revision, at } } },
      arcs: [...next.arcs, { id: `${event.task_id}:${event.sequence}`, kind: 'delivery', from: agentRef, label, at }],
    };
  }
  if (event.kind === 'team_handoff') {
    const toRole = text(detail.to_role);
    const objective = text(detail.objective);
    if (toRole) next = { ...next, arcs: [...next.arcs, { id: `${event.task_id}:${event.sequence}`, kind: 'handoff', from: agentRef, toRole, label: objective ? excerpt(objective) : `Hand-off to ${toRole}`, at }] };
  }
  return next;
}

const deliveryLabel = (name: string, revision: number | null): string => `Delivered ${name}${revision !== null ? ` rev ${revision}` : ''}`;

function applyReply(state: PresenceState, at: number, agentRef: string, taskId: string, phase: 'started' | 'ended'): PresenceState {
  const agent = state.agents[agentRef] ?? blankAgent(at);
  if (phase === 'started') {
    if (agent.reply && agent.reply.taskId === taskId && agent.reply.endedAt === null) return state;
    return { ...state, agents: { ...state.agents, [agentRef]: { ...agent, reply: { taskId, startedAt: at, endedAt: null } } } };
  }
  if (!agent.reply || agent.reply.taskId !== taskId || agent.reply.endedAt !== null) return state;
  return { ...state, agents: { ...state.agents, [agentRef]: { ...agent, reply: { ...agent.reply, endedAt: at } } } };
}

function applyProbe(state: PresenceState, at: number, agentRef: string, ready: boolean): PresenceState {
  const agent = state.agents[agentRef] ?? blankAgent(at);
  const probe = ready ? 'ready' : 'failed';
  if (agent.probe === probe) return state.agents[agentRef] ? state : { ...state, agents: { ...state.agents, [agentRef]: { ...agent, probe } } };
  return { ...state, agents: { ...state.agents, [agentRef]: { ...agent, probe, probeSince: at } } };
}

export function reducePresence(state: PresenceState, event: PresenceEvent): PresenceState {
  switch (event.type) {
    case 'task':
      return applyTask(state, event.at, event.task);
    case 'journal':
      return applyJournal(state, event.at, event.agent, event.event);
    case 'delta.started':
      return applyReply(state, event.at, event.agent, event.taskId, 'started');
    case 'delta.ended':
      return applyReply(state, event.at, event.agent, event.taskId, 'ended');
    case 'probe':
      return applyProbe(state, event.at, event.agent, event.ready);
  }
}

/** The state and visible text of one agent at `now`. */
export function presenceOf(state: PresenceState, agentRef: string, now: number): Presence {
  const agent = state.agents[agentRef];
  if (!agent) return { state: 'unknown', label: 'Unknown', since: 0 };
  if (agent.reply && agent.reply.endedAt === null) return { state: 'speaking', label: 'Replying…', since: agent.reply.startedAt };
  if (agent.reply?.endedAt != null && now < agent.reply.endedAt + SPEAKING_HOLD_MS) return { state: 'speaking', label: 'Replied', since: agent.reply.endedAt };
  if (agent.probe === 'failed') return { state: 'offline', label: 'Offline', since: agent.probeSince };
  const statuses = Object.values(agent.tasks)
    .map((task) => ({ task, status: taskStatus(task) }))
    .filter((item): item is { task: TaskTrack; status: Presence } => item.status !== null)
    .sort((a, b) => RANK[a.status.state]! - RANK[b.status.state]! || a.task.order - b.task.order);
  const top = statuses[0]?.status;
  if (top && (top.state === 'asking' || top.state === 'blocked')) return top;
  if (agent.delivery && now < agent.delivery.at + DELIVERY_HOLD_MS) return { state: 'delivering', label: deliveryLabel(agent.delivery.name, agent.delivery.revision), since: agent.delivery.at };
  if (top) return top;
  if (agent.probe === 'ready') return { state: 'available', label: 'Available', since: Math.max(agent.probeSince, agent.idleSince) };
  return { state: 'unknown', label: 'Unknown', since: agent.probeSince };
}

/** Hand-off and delivery arcs still drawn at `now`. A hand-off to a role nobody holds is left out. */
export function presenceArcs(state: PresenceState, now: number, agentForRole: (role: string) => string | undefined): SceneArc[] {
  return state.arcs
    .filter((arc) => now < arc.at + ARC_HOLD_MS)
    .flatMap((arc): SceneArc[] => {
      if (arc.kind === 'delivery') return [{ id: arc.id, kind: 'delivery', from: arc.from, label: arc.label }];
      const to = arc.toRole ? agentForRole(arc.toRole) : undefined;
      return to && to !== arc.from ? [{ id: arc.id, kind: 'handoff', from: arc.from, to, label: arc.label }] : [];
    });
}

/** When the next held state or arc runs out, so the room knows when to look again; null when nothing is held. */
export function nextPresenceChange(state: PresenceState, now: number): number | null {
  const ends: number[] = [];
  for (const agent of Object.values(state.agents)) {
    if (agent.reply?.endedAt != null) ends.push(agent.reply.endedAt + SPEAKING_HOLD_MS);
    if (agent.delivery) ends.push(agent.delivery.at + DELIVERY_HOLD_MS);
  }
  for (const arc of state.arcs) ends.push(arc.at + ARC_HOLD_MS);
  const future = ends.filter((end) => end > now);
  return future.length ? Math.min(...future) : null;
}

/** Drops arcs and holds that ran out, so a long session does not keep them forever. */
export function prunePresence(state: PresenceState, now: number): PresenceState {
  const arcs = state.arcs.filter((arc) => now < arc.at + ARC_HOLD_MS);
  return arcs.length === state.arcs.length ? state : { ...state, arcs };
}
