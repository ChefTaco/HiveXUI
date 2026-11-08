import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROJECT_ID } from '../test-fixtures';
import { openProjectStream, reduceStreamFrame } from './stream';

const event = (seq: number, type = 'project.updated', payload: Record<string, unknown> = {}) => ({
  event: type,
  id: String(seq),
  data: JSON.stringify({ seq, project_id: PROJECT_ID, type, at: '2026-11-08T10:00:00.000Z', payload }),
});

describe('the project stream reducer', () => {
  it('applies the next event in order and advances the cursor', () => {
    expect(reduceStreamFrame(4, event(5))).toEqual({ seq: 5, action: { kind: 'event', event: expect.objectContaining({ seq: 5, type: 'project.updated' }) } });
  });

  it('ignores a replayed event it already has', () => {
    expect(reduceStreamFrame(5, event(5))).toEqual({ seq: 5, action: { kind: 'ignore' } });
    expect(reduceStreamFrame(5, event(3))).toEqual({ seq: 5, action: { kind: 'ignore' } });
  });

  it('asks for the snapshot again when a seq is skipped, without moving the cursor', () => {
    expect(reduceStreamFrame(5, event(7))).toEqual({ seq: 5, action: { kind: 'reset', reason: 'gap' } });
  });

  it('treats a heartbeat ahead of the cursor as a gap, and one in step as nothing', () => {
    const beat = (seq: number) => ({ event: 'heartbeat', data: JSON.stringify({ seq, at: '2026-11-08T10:00:00.000Z' }) });
    expect(reduceStreamFrame(5, beat(5)).action).toEqual({ kind: 'ignore' });
    expect(reduceStreamFrame(5, beat(6)).action).toEqual({ kind: 'reset', reason: 'gap' });
  });

  it('turns a reset from the service into a snapshot refetch', () => {
    expect(reduceStreamFrame(5, { event: 'reset', data: JSON.stringify({ seq: 90, reason: 'cursor_expired' }) }).action).toEqual({ kind: 'reset', reason: 'reset' });
  });

  it('passes live message text through without a seq', () => {
    expect(reduceStreamFrame(5, { event: 'message.delta', data: JSON.stringify({ message_id: 'msg_1', text: 'Hel' }) })).toEqual({ seq: 5, action: { kind: 'delta', delta: { message_id: 'msg_1', text: 'Hel' } } });
  });

  it('ignores frames that do not match the contract', () => {
    for (const frame of [{ event: 'project.updated', data: '{not json' }, { event: 'project.updated', data: JSON.stringify({ seq: 6 }) }, { event: 'message.delta', data: '{}' }])
      expect(reduceStreamFrame(5, frame)).toEqual({ seq: 5, action: { kind: 'ignore' } });
  });
});

describe('the project stream connection', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('resumes each connection from the cursor at that moment', async () => {
    let cursor = 3;
    const request = vi.fn<typeof fetch>().mockImplementation(async () => new Response(new ReadableStream({ start: (controller) => controller.close() })));
    const handle = openProjectStream({ projectId: PROJECT_ID, cursor: () => cursor, onFrame: () => {}, request });
    await vi.advanceTimersByTimeAsync(0);
    cursor = 9;
    await vi.advanceTimersByTimeAsync(2100);
    handle.close();
    expect(request.mock.calls.map(([path]) => String(path))).toEqual([
      `/api/ardentstudio/v1/projects/${PROJECT_ID}/stream?after=3`,
      `/api/ardentstudio/v1/projects/${PROJECT_ID}/stream?after=9`,
    ]);
  });
});
