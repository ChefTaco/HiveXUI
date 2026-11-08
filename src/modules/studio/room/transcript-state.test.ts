import { describe, expect, it, vi } from 'vitest';
import { ProjectStore } from '../state/project-store';
import { deltaFrame, frame, message, messageId, PROJECT_ID, snapshot, task, TEAM_CONVERSATION_ID } from '../test-fixtures';
import { emptyTranscript, reduceTranscript, visibleLiveText, type TranscriptAction, type TranscriptState } from './transcript-state';

const OTHER = 'cnv_01HZX3K6Q1V8R2M4N6P8T0W009';
const reply = (overrides: Parameters<typeof message>[0] = {}) => message({ id: messageId(2), seq: 7, author: { kind: 'agent', binding_id: 'bnd_01HZX3K6Q1V8R2M4N6P8T0W001', role_key: 'lead' }, kind: 'reply', body_md: '', state: 'streaming', ...overrides });
const fold = (actions: TranscriptAction[], start: TranscriptState = emptyTranscript(TEAM_CONVERSATION_ID)) => actions.reduce(reduceTranscript, start);
const delta = (text: string, mode: 'append' | 'replace' = 'append', step = 0, id = messageId(2)): TranscriptAction => ({ type: 'delta', delta: { message_id: id, text, mode, step } });

describe('the transcript reducer', () => {
  it('fills a streaming bubble from appended deltas', () => {
    const state = fold([{ type: 'loaded', conversationId: TEAM_CONVERSATION_ID, messages: [message()] }, { type: 'message', message: reply() }, delta('The Fen'), delta('march lies east')]);
    expect(state.live[messageId(2)]).toEqual({ step: 0, text: 'The Fenmarch lies east' });
  });

  it('replaces the text on a replace delta, on a new step, and ignores a stale step', () => {
    let state = fold([{ type: 'message', message: reply() }, delta('draft'), delta('Snapshot so far', 'replace')]);
    expect(state.live[messageId(2)]!.text).toBe('Snapshot so far');
    state = fold([delta('Second step', 'append', 1)], state);
    expect(state.live[messageId(2)]).toEqual({ step: 1, text: 'Second step' });
    expect(fold([delta(' late', 'append', 0)], state)).toBe(state);
  });

  it('resumes from the text snapshot a reconnecting stream sends, without doubling it', () => {
    const state = fold([{ type: 'message', message: reply() }, delta('Hello'), delta('Hello wor', 'replace'), delta('ld')]);
    expect(state.live[messageId(2)]!.text).toBe('Hello world');
  });

  it('lets the final message replace the bubble, and records it once as finished', () => {
    let state = fold([{ type: 'message', message: reply() }, delta('Partial')]);
    state = fold([{ type: 'message', message: reply({ state: 'complete', body_md: 'The final answer.', updated_at: '2026-11-08T10:01:00.000Z' }) }], state);
    expect(state.live).toEqual({});
    expect(state.messages.at(-1)!.body_md).toBe('The final answer.');
    expect(state.finished).toEqual([messageId(2)]);
    // A late delta after the final text changes nothing.
    expect(fold([delta(' more')], state)).toBe(state);
    // Nor does an older copy of the message.
    expect(fold([{ type: 'message', message: reply() }], state)).toBe(state);
  });

  it('keeps other conversations out, but forgets their live text once they finish', () => {
    const elsewhere = reply({ id: messageId(9), conversation_id: OTHER });
    let state = fold([{ type: 'message', message: elsewhere }, delta('x', 'append', 0, messageId(9))]);
    expect(state.messages).toEqual([]);
    expect(state.live[messageId(9)]).toBeDefined();
    state = fold([{ type: 'message', message: { ...elsewhere, state: 'complete', body_md: 'done' } }], state);
    expect(state.live).toEqual({});
  });

  it('marks itself for a re-read on reset, keeping live text only for replies still streaming', () => {
    let state = fold([{ type: 'message', message: reply() }, delta('Live text'), { type: 'reset' }]);
    expect(state.status).toBe('loading');
    state = fold([{ type: 'loaded', conversationId: TEAM_CONVERSATION_ID, messages: [message(), reply()] }], state);
    expect(state.live[messageId(2)]!.text).toBe('Live text');
    state = fold([{ type: 'loaded', conversationId: TEAM_CONVERSATION_ID, messages: [message(), reply({ state: 'complete', body_md: 'Done' })] }], state);
    expect(state.live).toEqual({});
  });

  it('shows Working… instead of a structured step', () => {
    expect(visibleLiveText(undefined)).toBeNull();
    expect(visibleLiveText({ step: 0, text: '  {"tool": "search"' })).toBeNull();
    expect(visibleLiveText({ step: 0, text: 'Plain words' })).toBe('Plain words');
  });
});

describe('the project stream behind the transcript', () => {
  it('passes deltas through, and on a skipped seq refetches the snapshot and tells the transcript to re-read', async () => {
    const load = vi.fn(async () => snapshot());
    const store = new ProjectStore(PROJECT_ID, { load, stream: () => ({ close() {} }) });
    store.start();
    await vi.waitFor(() => expect(store.getState().status).toBe('ready'));
    const deltas: string[] = [];
    const resets = vi.fn();
    store.onDelta((item) => deltas.push(item.text));
    store.onReset(resets);
    store.receive(deltaFrame(messageId(2), 'Hel'));
    store.receive(frame(6, 'message.created', { message: reply() }));
    expect(deltas).toEqual(['Hel']);
    expect(store.getState().seq).toBe(6);
    store.receive(frame(9, 'message.updated', { message: reply() }));
    expect(resets).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    store.stop();
  });

  it('patches room records from their events', async () => {
    const store = new ProjectStore(PROJECT_ID, { load: async () => snapshot(), stream: () => ({ close() {} }) });
    store.start();
    await vi.waitFor(() => expect(store.getState().status).toBe('ready'));
    store.receive(frame(6, 'presence.updated', { binding_id: 'bnd_01HZX3K6Q1V8R2M4N6P8T0W001', agent_ref: 'node-1~lead', state: 'working', label: 'Working: plan', source: {}, since: '2026-11-08T10:00:00.000Z' }));
    expect(store.getState().snapshot!.activity).toEqual([expect.objectContaining({ state: 'working', label: 'Working: plan' })]);
    // The snapshot keeps active tasks only: a finished task leaves it.
    store.receive(frame(7, 'task.created', { task: task() }));
    expect(store.getState().snapshot!.tasks.map((item) => item.state)).toEqual(['running']);
    store.receive(frame(8, 'task.updated', { task: task({ state: 'completed' }) }));
    expect(store.getState().snapshot!.tasks).toEqual([]);
    store.stop();
  });
});
