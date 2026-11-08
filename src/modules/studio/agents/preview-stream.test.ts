import { describe, expect, it } from 'vitest';
import { previewText, reducePreview, runPreview, startPreview, type PreviewRun } from './preview-stream';

const frame = (event: string, data: unknown) => ({ event, data: JSON.stringify(data) });
const feed = (frames: ReturnType<typeof frame>[], run: PreviewRun = startPreview()) => frames.reduce(reducePreview, run);

describe('the preview reducer', () => {
  it('starts on accepted, appends deltas and replaces a step with its full text', () => {
    const run = feed([
      frame('preview.accepted', { task_id: 'task-1', session_id: 'ses-1' }),
      frame('preview.delta', { step: 1, text: 'The bridge ' }),
      frame('preview.delta', { step: 1, text: 'creaks' }),
      // A reconnect sends each step's text so far; it replaces, never doubles.
      frame('preview.text', { step: 1, text: 'The bridge creaks.' }),
      frame('preview.delta', { step: 2, text: 'Then silence.' }),
    ]);
    expect(run).toMatchObject({ status: 'running', taskId: 'task-1', sessionId: 'ses-1' });
    expect(run.steps).toEqual([
      { step: 1, text: 'The bridge creaks.' },
      { step: 2, text: 'Then silence.' },
    ]);
    expect(previewText(run)).toBe('The bridge creaks.\n\nThen silence.');
  });

  it('counts journal events as progress without their details', () => {
    const run = feed([frame('preview.event', { sequence: 3, kind: 'tool_called' }), frame('preview.event', { sequence: 4, kind: 'step_finished' })]);
    expect(run).toMatchObject({ events: 4, lastKind: 'step_finished' });
  });

  it('finishes with the final record, and ignores frames after the end', () => {
    const done = feed([frame('preview.delta', { step: 1, text: 'Hi' }), frame('preview.done', { task_id: 'task-1', state: 'completed', result: 'Hi', error: null })]);
    expect(done).toMatchObject({ status: 'done', state: 'completed', result: 'Hi', error: null });
    expect(reducePreview(done, frame('preview.delta', { step: 1, text: ' again' }))).toBe(done);
  });

  it('treats a failed or cancelled task and a stream error as failures with a reason', () => {
    expect(feed([frame('preview.done', { task_id: 't', state: 'failed', result: null, error: 'Model offline' })])).toMatchObject({ status: 'failed', error: 'Model offline' });
    expect(feed([frame('preview.done', { task_id: 't', state: 'cancelled', result: null, error: null })])).toMatchObject({ status: 'failed', error: 'The preview ended cancelled.' });
    expect(feed([frame('preview.error', { code: 'STREAM_FAILED', message: 'Magnus went away' })])).toMatchObject({ status: 'failed', code: 'STREAM_FAILED', error: 'Magnus went away' });
  });

  it('keeps a partial result as finished', () => {
    expect(feed([frame('preview.done', { task_id: 't', state: 'partial', result: 'Half', error: null })])).toMatchObject({ status: 'done', state: 'partial' });
  });

  it('ignores frames it cannot read', () => {
    const run = startPreview();
    expect(reducePreview(run, { event: 'preview.delta', data: 'not json' })).toBe(run);
    expect(reducePreview(run, frame('preview.delta', { text: 'no step' }))).toBe(run);
    expect(reducePreview(run, frame('something.else', {}))).toBe(run);
  });
});

const sse = (frames: Array<[string, unknown]>, chunk = 7) => {
  const text = frames.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('');
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      // Odd chunk sizes split frames mid-line, as a network does.
      for (let at = 0; at < bytes.length; at += chunk) controller.enqueue(bytes.slice(at, at + chunk));
      controller.close();
    },
  });
};

describe('running a preview', () => {
  it('posts the prompt and streams the reply to the end', async () => {
    const calls: Array<{ path: string; init?: RequestInit }> = [];
    const seen: string[] = [];
    const run = await runPreview({
      agentRef: 'node-1~lead',
      prompt: 'Describe the archive',
      useDraft: true,
      newSession: true,
      signal: new AbortController().signal,
      onRun: (next) => seen.push(previewText(next)),
      request: async (path, init) => {
        calls.push({ path, ...(init ? { init } : {}) });
        return new Response(sse([['preview.accepted', { task_id: 't1', session_id: 's1' }], ['preview.delta', { step: 1, text: 'Dust and ' }], ['preview.delta', { step: 1, text: 'water.' }], ['preview.done', { task_id: 't1', state: 'completed', result: 'Dust and water.', error: null }]]), { headers: { 'content-type': 'text/event-stream' } });
      },
    });
    expect(run.status).toBe('done');
    expect(previewText(run)).toBe('Dust and water.');
    expect(seen).toContain('Dust and ');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe('/api/ardentstudio/v1/agents/node-1~lead/preview');
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ prompt: 'Describe the archive', use_draft: true, new_session: true });
  });

  it('reconnects with the same key when the stream drops before the task ends', async () => {
    const keys: string[] = [];
    let attempt = 0;
    const run = await runPreview({
      agentRef: 'node-1~lead',
      prompt: 'Hello',
      useDraft: false,
      newSession: false,
      signal: new AbortController().signal,
      onRun: () => undefined,
      request: async (_path, init) => {
        keys.push(new Headers(init?.headers).get('x-idempotency-key') ?? '');
        attempt += 1;
        if (attempt === 1) return new Response(sse([['preview.accepted', { task_id: 't1', session_id: null }], ['preview.delta', { step: 1, text: 'Hel' }]]));
        return new Response(sse([['preview.accepted', { task_id: 't1', session_id: null }], ['preview.text', { step: 1, text: 'Hello there' }], ['preview.done', { task_id: 't1', state: 'completed', result: 'Hello there', error: null }]]));
      },
    });
    expect(attempt).toBe(2);
    expect(keys[0]).toMatch(/^hivexui-preview-/);
    expect(keys[1]).toBe(keys[0]);
    expect(previewText(run)).toBe('Hello there');
  });

  it('turns a refusal into a failed run with the service code', async () => {
    const run = await runPreview({
      agentRef: 'node-1~lead',
      prompt: 'Hello',
      useDraft: true,
      newSession: false,
      signal: new AbortController().signal,
      onRun: () => undefined,
      request: async () => Response.json({ error: { code: 'PREVIEW_UNAVAILABLE', message: 'Previews need the Magnus agent on node node-1 at Studio level 2' } }, { status: 409 }),
    });
    expect(run).toMatchObject({ status: 'failed', code: 'PREVIEW_UNAVAILABLE', error: 'Previews need the Magnus agent on node node-1 at Studio level 2' });
  });

  it('gives up after its reconnects and says the connection was lost', async () => {
    let calls = 0;
    const run = await runPreview({
      agentRef: 'node-1~lead',
      prompt: 'Hello',
      useDraft: true,
      newSession: false,
      signal: new AbortController().signal,
      onRun: () => undefined,
      reconnects: 1,
      request: async () => {
        calls += 1;
        return new Response(sse([['preview.accepted', { task_id: 't1', session_id: null }]]));
      },
    });
    expect(calls).toBe(2);
    expect(run).toMatchObject({ status: 'failed', code: 'STREAM_LOST' });
  });
});
