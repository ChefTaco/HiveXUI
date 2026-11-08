import { describe, expect, it } from 'vitest';
import {
  ARC_HOLD_MS,
  DELIVERY_HOLD_MS,
  emptyPresence,
  excerpt,
  nextPresenceChange,
  presenceArcs,
  presenceOf,
  prunePresence,
  reducePresence,
  SPEAKING_HOLD_MS,
  type PresenceEvent,
  type PresenceState,
  type PresenceTask,
} from './presence';

const AGENT = 'node-1~cartographer';
const OTHER = 'node-1~worldbuilder';
const TASK = '7c1d2e3f-0000-4000-8000-000000000001';

function task(patch: Partial<PresenceTask> = {}): PresenceTask {
  return { id: TASK, agent: AGENT, title: 'drafting map', mode: 'assignment', state: 'queued', ...patch };
}
let sequence = 0;
const journal = (kind: string, detail?: unknown, at = 100, taskId = TASK, agent = AGENT): PresenceEvent => ({ type: 'journal', at, agent, event: { sequence: (sequence += 1), task_id: taskId, kind, ...(detail === undefined ? {} : { detail }) } });
const fold = (events: PresenceEvent[], start: PresenceState = emptyPresence()) => events.reduce(reducePresence, start);
const view = (state: PresenceState, now = 1_000, agent = AGENT) => presenceOf(state, agent, now);

describe('the presence table', () => {
  it('knows nothing about an agent with no records', () => {
    expect(view(emptyPresence())).toEqual({ state: 'unknown', label: 'Unknown', since: 0 });
    expect(view(fold([journal('model_started', {}, 10, TASK, OTHER)]))).toMatchObject({ state: 'unknown' });
  });

  it('shows Offline when the ready probe fails and Available when it answers with no task', () => {
    expect(view(fold([{ type: 'probe', at: 5, agent: AGENT, ready: false }]))).toEqual({ state: 'offline', label: 'Offline', since: 5 });
    expect(view(fold([{ type: 'probe', at: 5, agent: AGENT, ready: true }]))).toEqual({ state: 'available', label: 'Available', since: 5 });
  });

  it('never lets the probe make an agent working, or end its work', () => {
    const probed = fold([{ type: 'probe', at: 1, agent: AGENT, ready: true }, { type: 'probe', at: 2, agent: AGENT, ready: true }]);
    expect(view(probed).state).toBe('available');
    const working = fold([{ type: 'task', at: 3, task: task({ state: 'running' }) }, journal('model_started', { step: 0 }, 4)], probed);
    expect(view(working).state).toBe('working');
    expect(view(fold([{ type: 'probe', at: 9, agent: AGENT, ready: true }], working))).toMatchObject({ state: 'working', label: 'Working: drafting map' });
  });

  it('keeps the probe time when a repeated probe says the same thing', () => {
    const state = fold([{ type: 'probe', at: 1, agent: AGENT, ready: true }, { type: 'probe', at: 50, agent: AGENT, ready: true }]);
    expect(view(state).since).toBe(1);
  });

  it('shows Queued with the task title', () => {
    expect(view(fold([{ type: 'task', at: 7, task: task() }]))).toEqual({ state: 'queued', label: 'Queued: drafting map', since: 7 });
  });

  it('does not call a running task working until a model step or tool attempt is journaled', () => {
    const running = fold([{ type: 'task', at: 1, task: task({ state: 'running' }) }]);
    expect(view(running).state).toBe('queued');
    expect(view(fold([journal('model_started', { step: 0 }, 2)], running))).toEqual({ state: 'working', label: 'Working: drafting map', since: 2 });
  });

  it('names the tool being attempted and drops it at the next model step', () => {
    const tooling = fold([{ type: 'task', at: 1, task: task({ state: 'running' }) }, journal('model_started', {}, 2), journal('tool_attempt', { id: 'c1', name: 'web_search', args: {} }, 3)]);
    expect(view(tooling)).toEqual({ state: 'working', label: 'Working: drafting map · web_search', since: 3 });
    expect(view(fold([journal('model_started', { step: 1 }, 4)], tooling)).label).toBe('Working: drafting map');
  });

  it('treats a tool attempt alone as work', () => {
    expect(view(fold([{ type: 'task', at: 1, task: task({ state: 'running' }) }, journal('tool_attempt', { name: 'artifact_write' }, 2)])).state).toBe('working');
  });

  it('shows Replying while deltas stream and Replied for 4 s after the reply message completes', () => {
    const streaming = fold([{ type: 'task', at: 1, task: task({ state: 'running' }) }, journal('model_started', {}, 2), { type: 'delta.started', at: 3, agent: AGENT, taskId: TASK }]);
    expect(view(streaming, 10_000)).toEqual({ state: 'speaking', label: 'Replying…', since: 3 });
    const done = fold([{ type: 'delta.ended', at: 20, agent: AGENT, taskId: TASK }, { type: 'task', at: 20, task: task({ state: 'completed' }) }, { type: 'probe', at: 21, agent: AGENT, ready: true }], streaming);
    expect(view(done, 20 + SPEAKING_HOLD_MS - 1)).toEqual({ state: 'speaking', label: 'Replied', since: 20 });
    expect(view(done, 20 + SPEAKING_HOLD_MS)).toEqual({ state: 'available', label: 'Available', since: 21 });
    expect(nextPresenceChange(done, 25)).toBe(20 + SPEAKING_HOLD_MS);
  });

  it('ignores a duplicate delta start and an end for another task', () => {
    const streaming = fold([{ type: 'delta.started', at: 3, agent: AGENT, taskId: TASK }]);
    expect(fold([{ type: 'delta.started', at: 9, agent: AGENT, taskId: TASK }], streaming)).toBe(streaming);
    expect(fold([{ type: 'delta.ended', at: 9, agent: AGENT, taskId: 'other' }], streaming)).toBe(streaming);
  });

  it('speaks over an offline probe: a live reply is proof the agent answers', () => {
    const state = fold([{ type: 'probe', at: 1, agent: AGENT, ready: false }, { type: 'delta.started', at: 2, agent: AGENT, taskId: TASK }]);
    expect(view(state).state).toBe('speaking');
  });

  it('shows Asking with an excerpt of the recorded question', () => {
    const question = 'Which tone should the map legend use: playful or archival, given the audience is mostly younger readers?';
    const asking = fold([{ type: 'task', at: 1, task: task({ state: 'running' }) }, journal('team_ask_user', { question }, 2)]);
    const shown = view(asking);
    expect(shown.state).toBe('asking');
    expect(shown.label).toBe(`Asking: ${excerpt(question)}`);
    expect(shown.label.length).toBeLessThanOrEqual('Asking: '.length + 60);
    expect(shown.label.endsWith('…')).toBe(true);
  });

  it('shows Asking for input_required with no recorded question, and stops once answered', () => {
    const asking = fold([{ type: 'task', at: 1, task: task({ state: 'input_required' }) }]);
    expect(view(asking)).toMatchObject({ state: 'asking', label: 'Asking a question' });
    const asked = fold([journal('team_ask_user', { question: 'Tone?' }, 2)], asking);
    expect(view(asked).label).toBe('Asking: Tone?');
    expect(view(fold([{ type: 'task', at: 5, task: task({ state: 'running' }) }], asked)).state).toBe('queued');
  });

  it('shows Waiting for the role a queued task is held for', () => {
    expect(view(fold([{ type: 'task', at: 1, task: task({ waitingFor: 'Story Lead' }) }]))).toEqual({ state: 'waiting', label: 'Waiting for Story Lead', since: 1 });
  });

  it('shows Reviewing for a running review task, with its deliverable', () => {
    const review = task({ mode: 'review', state: 'running', title: 'review map', deliverable: 'map v2' });
    expect(view(fold([{ type: 'task', at: 1, task: review }]))).toEqual({ state: 'reviewing', label: 'Reviewing map v2', since: 1 });
    expect(view(fold([{ type: 'task', at: 1, task: { ...review, state: 'queued' } }])).label).toBe('Queued: review map');
  });

  it('shows Delivered with name and revision, held for a while, then the task again', () => {
    const delivered = fold([
      { type: 'task', at: 1, task: task({ state: 'running' }) },
      journal('model_started', {}, 2),
      journal('artifact_registered', { artifact_id: 'a1', name: 'map.svg', mime: 'image/svg+xml', sha256: 'f'.repeat(64), size: 12, revision: 2 }, 3),
    ]);
    expect(view(delivered, 4)).toEqual({ state: 'delivering', label: 'Delivered map.svg rev 2', since: 3 });
    expect(view(delivered, 3 + DELIVERY_HOLD_MS).state).toBe('working');
    expect(presenceArcs(delivered, 4, () => undefined)).toEqual([{ id: `${TASK}:${sequence}`, kind: 'delivery', from: AGENT, label: 'Delivered map.svg rev 2' }]);
  });

  it('shows Paused and Pause requested from admission, and resumes', () => {
    const running = fold([{ type: 'task', at: 1, task: task({ state: 'running' }) }, journal('model_started', {}, 2)]);
    const pausing = fold([{ type: 'task', at: 3, task: task({ state: 'pausing' }) }], running);
    expect(view(pausing)).toMatchObject({ state: 'paused', label: 'Pause requested: drafting map' });
    const paused = fold([journal('paused', { boundary: 'step' }, 4)], pausing);
    expect(view(paused)).toEqual({ state: 'paused', label: 'Paused: drafting map', since: 4 });
    // The Studio mirror still says pausing until it catches up; the journal already said paused.
    expect(view(fold([{ type: 'task', at: 5, task: task({ state: 'pausing' }) }], paused)).label).toBe('Paused: drafting map');
    expect(view(fold([journal('resumed', { state: 'running' }, 6)], paused))).toMatchObject({ state: 'working' });
    expect(view(fold([journal('pause_requested', { state: 'running' }, 6)], running)).label).toBe('Pause requested: drafting map');
  });

  it('shows Blocked and Unknown outcomes with the exact task, and keeps them after the task ends', () => {
    expect(view(fold([{ type: 'task', at: 1, task: task({ state: 'partial', outcome: 'blocked' }) }]))).toEqual({ state: 'blocked', label: 'Blocked: drafting map', since: 1 });
    expect(view(fold([{ type: 'task', at: 1, task: task({ state: 'unknown' }) }]))).toEqual({ state: 'unknown', label: 'Unknown: drafting map', since: 1 });
  });

  it('forgets a finished task, and ignores its late journal events', () => {
    const done = fold([{ type: 'probe', at: 1, agent: AGENT, ready: true }, { type: 'task', at: 2, task: task({ state: 'running' }) }, { type: 'task', at: 9, task: task({ state: 'completed' }) }]);
    expect(view(done)).toEqual({ state: 'available', label: 'Available', since: 9 });
    expect(fold([journal('model_started', {}, 10)], done)).toBe(done);
  });

  it('follows Ardent state transitions from the journal', () => {
    const state = fold([{ type: 'task', at: 1, task: task() }, journal('state', { from: 'queued', to: 'running', error: null }, 2), journal('model_started', {}, 3)]);
    expect(view(state).state).toBe('working');
    expect(view(fold([journal('state', { from: 'running', to: 'completed', error: null }, 4)], state)).state).toBe('unknown');
    expect(view(fold([journal('state', { to: 'nonsense' }, 4)], state)).state).toBe('working');
  });

  it('applies each journal sequence once, so a replay after reconnect changes nothing', () => {
    const first = journal('tool_attempt', { name: 'web_search' }, 2);
    const state = fold([{ type: 'task', at: 1, task: task({ state: 'running' }) }, first]);
    expect(fold([first], state)).toBe(state);
  });

  it('never shows backend events or reasoning, and unrecorded kinds change nothing visible', () => {
    const state = fold([{ type: 'task', at: 1, task: task({ state: 'running' }) }, journal('model_started', {}, 2)]);
    const after = fold([journal('backend_event', { type: 'reasoning', text: 'secret plan' }, 3), journal('memory_context', {}, 4)], state);
    expect(view(after)).toEqual(view(state));
    expect(JSON.stringify(after)).not.toContain('secret plan');
  });

  it('keeps since when a task update does not change what is shown', () => {
    const state = fold([{ type: 'task', at: 1, task: task({ state: 'running' }) }, journal('model_started', {}, 2), { type: 'task', at: 50, task: task({ state: 'running' }) }]);
    expect(view(state).since).toBe(2);
  });

  it('puts a question ahead of other work and the oldest task first among equals', () => {
    const second = '7c1d2e3f-0000-4000-8000-000000000002';
    const state = fold([
      { type: 'task', at: 1, task: task({ state: 'running' }) },
      journal('model_started', {}, 2),
      { type: 'task', at: 3, task: task({ id: second, title: 'legend', state: 'input_required' }) },
    ]);
    expect(view(state)).toMatchObject({ state: 'asking' });
    const both = fold([{ type: 'task', at: 1, task: task({ id: second, title: 'second', state: 'queued' }) }, { type: 'task', at: 2, task: task({ title: 'first', state: 'queued' }) }]);
    expect(view(both).label).toBe('Queued: second');
  });

  it('shows Offline over queued work when the probe fails', () => {
    expect(view(fold([{ type: 'task', at: 1, task: task() }, { type: 'probe', at: 2, agent: AGENT, ready: false }])).state).toBe('offline');
  });

  it('draws a hand-off arc to the agent holding the role, for a while', () => {
    const state = fold([{ type: 'task', at: 1, task: task({ state: 'running' }) }, journal('team_handoff', { to_role: 'Worldbuilder', objective: 'Name the three river regions' }, 2)]);
    const roles = (role: string) => (role === 'Worldbuilder' ? OTHER : undefined);
    expect(presenceArcs(state, 3, roles)).toEqual([{ id: `${TASK}:${sequence}`, kind: 'handoff', from: AGENT, to: OTHER, label: 'Name the three river regions' }]);
    expect(presenceArcs(state, 2 + ARC_HOLD_MS, roles)).toEqual([]);
    expect(presenceArcs(state, 3, () => undefined)).toEqual([]);
    expect(prunePresence(state, 2 + ARC_HOLD_MS).arcs).toEqual([]);
    expect(prunePresence(state, 3)).toBe(state);
    expect(nextPresenceChange(state, 3)).toBe(2 + ARC_HOLD_MS);
    expect(nextPresenceChange(state, 2 + ARC_HOLD_MS)).toBeNull();
  });
});

describe('excerpt', () => {
  it('folds whitespace and keeps short text whole', () => {
    expect(excerpt('  Which\n tone?  ')).toBe('Which tone?');
    expect(excerpt('x'.repeat(80))).toHaveLength(60);
  });
});
