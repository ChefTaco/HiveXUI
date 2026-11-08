import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SseEvent } from '../../magnus/api/sse';
import { StudioApiError } from '../api/client';
import type { Snapshot } from '../api/endpoints';
import { file, link, PROJECT_ID, project, proposal, snapshot } from '../test-fixtures';
import { acquireProjectStore, ProjectStore, resetProjectStores } from './project-store';

const frame = (seq: number, type: string, payload: Record<string, unknown> = {}): SseEvent => ({
  event: type,
  id: String(seq),
  data: JSON.stringify({ seq, project_id: PROJECT_ID, type, at: '2026-11-08T10:00:00.000Z', payload }),
});

function harness(loads: Array<Snapshot | Error>) {
  const load = vi.fn(async () => {
    const next = loads.length > 1 ? loads.shift()! : loads[0]!;
    if (next instanceof Error) throw next;
    return next;
  });
  const cursors: number[] = [];
  const close = vi.fn();
  let deliver: (frame: SseEvent) => void = () => {};
  const stream = vi.fn((options: { cursor: () => number; onFrame: (frame: SseEvent) => void }) => {
    cursors.push(options.cursor());
    deliver = options.onFrame;
    return { close };
  });
  const store = new ProjectStore(PROJECT_ID, { load, stream: stream as never });
  return { store, load, stream, close, cursors, send: (item: SseEvent) => deliver(item) };
}
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  resetProjectStores();
  vi.useRealTimers();
});

describe('the project store', () => {
  it('loads the snapshot, then follows the stream from its seq', async () => {
    const { store, cursors } = harness([snapshot({ seq: 12 })]);
    expect(store.getState().status).toBe('loading');
    store.start();
    await flush();
    expect(store.getState()).toMatchObject({ status: 'ready', seq: 12 });
    expect(cursors).toEqual([12]);
  });

  it('patches a file’s indexing state from its event without a refetch', async () => {
    const { store, load, send } = harness([snapshot({ seq: 5, files: [file({ knowledge: { ...file().knowledge, state: 'indexing', chunks: null } })] })]);
    store.start();
    await flush();
    send(frame(6, 'file.updated', { file_id: file().id, knowledge: { ...file().knowledge, state: 'failed', error: 'HiveMem refused the source' } }));
    await vi.advanceTimersByTimeAsync(500);
    expect(store.getState().snapshot!.files[0]!.knowledge).toMatchObject({ state: 'failed', error: 'HiveMem refused the source' });
    expect(store.getState().seq).toBe(6);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('patches the summary counts from a counts event and links from link events, without a refetch', async () => {
    const { store, load, send } = harness([snapshot({ seq: 5, links: [link()] })]);
    store.start();
    await flush();
    send(frame(6, 'project.updated', { fields: ['counts'], counts: { open_questions: 3, review_pending: 1, active_tasks: 2 } }));
    send(frame(7, 'link.updated', { link: link({ title: 'Tide charts' }) }));
    send(frame(8, 'link.deleted', { link: link({ deleted_at: '2026-11-08T11:00:00.000Z' }) }));
    send(frame(9, 'team.proposal.updated', { proposal: proposal({ state: 'running' }) }));
    await vi.advanceTimersByTimeAsync(2000);
    const state = store.getState().snapshot!;
    expect(state.summary).toMatchObject({ open_questions: 3, review_pending: 1, active_tasks: 2 });
    expect(state.links).toEqual([]);
    expect(state.team_proposals.map((item) => item.state)).toEqual(['running']);
    expect(store.getState().seq).toBe(9);
    expect(load).toHaveBeenCalledTimes(1);
    send(frame(10, 'team.proposal.updated', { proposal: proposal({ state: 'ready' }) }));
    expect(store.getState().snapshot!.team_proposals).toEqual([]);
  });

  it('re-reads the summary once after a burst of records that move the last activity', async () => {
    const { store, load, send } = harness([snapshot({ seq: 5 })]);
    store.start();
    await flush();
    for (let seq = 6; seq < 16; seq += 1) {
      send(frame(seq, 'message.created', { message_id: `m${seq}` }));
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1500);
    // Throttled, not pushed back by every message: a steady room still refreshes.
    expect(load.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(load.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('re-reads the snapshot once for a burst of project and team events', async () => {
    const { store, load, send } = harness([snapshot({ seq: 5 }), snapshot({ seq: 8, project: project({ name: 'Renamed' }) })]);
    store.start();
    await flush();
    send(frame(6, 'project.updated', { fields: ['name'] }));
    send(frame(7, 'team.draft.updated', { revision: 2 }));
    send(frame(8, 'team.revision.published', { revision: 2 }));
    expect(store.getState().seq).toBe(8);
    await vi.advanceTimersByTimeAsync(500);
    expect(load).toHaveBeenCalledTimes(2);
    expect(store.getState().snapshot!.project.name).toBe('Renamed');
  });

  it('refetches on a gap and resumes from the new snapshot’s seq', async () => {
    const { store, load, send, cursors } = harness([snapshot({ seq: 5 }), snapshot({ seq: 20 })]);
    store.start();
    await flush();
    send(frame(9, 'project.updated'));
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
    expect(store.getState().seq).toBe(20);
    // The open stream keeps going; its next connection reads the new cursor.
    expect(cursors).toEqual([5]);
    send(frame(21, 'message.created'));
    expect(store.getState().seq).toBe(21);
  });

  it('hands other events and live text to listeners', async () => {
    const { store, send } = harness([snapshot({ seq: 5 })]);
    const events: string[] = [];
    const deltas: string[] = [];
    store.onEvent((event) => events.push(event.type));
    store.onDelta((delta) => deltas.push(delta.text));
    store.start();
    await flush();
    send(frame(6, 'message.created', { message_id: 'msg_1' }));
    send({ event: 'message.delta', data: JSON.stringify({ message_id: 'msg_1', text: 'Hi' }) });
    expect(events).toEqual(['message.created']);
    expect(deltas).toEqual(['Hi']);
  });

  it('says missing for an unknown project and keeps the last copy when a refresh fails', async () => {
    const missing = harness([new StudioApiError(404, 'Project not found')]);
    missing.store.start();
    await flush();
    expect(missing.store.getState().status).toBe('missing');
    expect(missing.stream).not.toHaveBeenCalled();

    const flaky = harness([snapshot({ seq: 5 }), new StudioApiError(503, 'Down')]);
    flaky.store.start();
    await flush();
    await flaky.store.refetch();
    expect(flaky.store.getState()).toMatchObject({ status: 'ready', seq: 5 });
    expect(flaky.store.getState().error).toBeInstanceOf(StudioApiError);
  });

  it('is shared per project and stops after its last user leaves', async () => {
    const { store, close } = harness([snapshot()]);
    const first = acquireProjectStore(PROJECT_ID, () => store);
    const second = acquireProjectStore(PROJECT_ID, () => { throw new Error('created twice'); });
    expect(second.store).toBe(first.store);
    await flush();
    first.release();
    second.release();
    await vi.advanceTimersByTimeAsync(1000);
    const again = acquireProjectStore(PROJECT_ID, () => { throw new Error('created twice'); });
    expect(again.store).toBe(store);
    again.release();
    await vi.advanceTimersByTimeAsync(2500);
    expect(close).toHaveBeenCalled();
  });
});
