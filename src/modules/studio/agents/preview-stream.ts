// A preview run: POST /agents/{ref}/preview answers with server-sent events for one Ardent task.
// The reducer is pure so tests can feed it frames; the runner reads the response body and, when the
// connection drops before the task finishes, asks again with the same idempotency key, which the
// service answers with the same task from its start.
import type { z } from 'zod';
import {
  IDEMPOTENCY_HEADER,
  previewAcceptedEventSchema,
  previewDoneEventSchema,
  previewErrorEventSchema,
  previewJournalEventSchema,
  previewTextEventSchema,
} from '@contracts/ardentstudio.generated';
import { apiFetch } from '../../../lib/transport';
import { randomId } from '../../magnus/api/client';
import { createSseParser, type SseEvent } from '../../magnus/api/sse';
import { studioFailure, studioPath } from '../api/client';
import { agentPath } from './api';

export type PreviewStatus = 'connecting' | 'running' | 'reconnecting' | 'done' | 'failed';
export interface PreviewRun {
  status: PreviewStatus;
  taskId: string | null;
  sessionId: string | null;
  /** Reply text per Ardent step, in step order. */
  steps: ReadonlyArray<{ step: number; text: string }>;
  /** Journal events seen, and the kind of the latest, as progress without details. */
  events: number;
  lastKind: string | null;
  /** The task's final state from Ardent (completed, partial, failed, cancelled). */
  state: string | null;
  result: string | null;
  error: string | null;
  code: string | null;
}

export const startPreview = (): PreviewRun => ({ status: 'connecting', taskId: null, sessionId: null, steps: [], events: 0, lastKind: null, state: null, result: null, error: null, code: null });

const parse = <S extends z.ZodType>(schema: S, data: string): z.output<S> | null => {
  try {
    const parsed = schema.safeParse(JSON.parse(data));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

function setStep(steps: PreviewRun['steps'], step: number, text: (current: string) => string): PreviewRun['steps'] {
  const index = steps.findIndex((item) => item.step === step);
  if (index < 0) return [...steps, { step, text: text('') }].sort((a, b) => a.step - b.step);
  return steps.map((item, at) => (at === index ? { step, text: text(item.text) } : item));
}

/** Pure: the run after one frame. A finished run ignores anything after its end. */
export function reducePreview(run: PreviewRun, frame: SseEvent): PreviewRun {
  if (run.status === 'done' || run.status === 'failed') return run;
  switch (frame.event) {
    case 'preview.accepted': {
      const accepted = parse(previewAcceptedEventSchema, frame.data);
      return accepted ? { ...run, status: 'running', taskId: accepted.task_id, sessionId: accepted.session_id } : run;
    }
    // text carries a step's whole text so far (sent on every connection); delta appends to it.
    case 'preview.text':
    case 'preview.delta': {
      const text = parse(previewTextEventSchema, frame.data);
      if (!text) return run;
      const replace = frame.event === 'preview.text';
      return { ...run, status: 'running', steps: setStep(run.steps, text.step, (current) => (replace ? text.text : current + text.text)) };
    }
    case 'preview.event': {
      const event = parse(previewJournalEventSchema, frame.data);
      return event ? { ...run, events: Math.max(run.events, event.sequence), lastKind: event.kind } : run;
    }
    case 'preview.done': {
      const done = parse(previewDoneEventSchema, frame.data);
      if (!done) return run;
      const failed = done.state === 'failed' || done.state === 'cancelled' || done.state === 'unknown';
      return { ...run, status: failed ? 'failed' : 'done', taskId: done.task_id, state: done.state, result: done.result, error: done.error ?? (failed ? `The preview ended ${done.state}.` : null) };
    }
    case 'preview.error': {
      const error = parse(previewErrorEventSchema, frame.data);
      return { ...run, status: 'failed', error: error?.message ?? 'The preview stream failed.', code: error?.code ?? null };
    }
    default:
      return run;
  }
}

/** The reply as one text: the steps' text, separated where the agent took another step. */
export const previewText = (run: PreviewRun): string => run.steps.map((item) => item.text).filter(Boolean).join('\n\n');
export const previewFinished = (run: PreviewRun): boolean => run.status === 'done' || run.status === 'failed';

export interface PreviewRequest {
  agentRef: string;
  prompt: string;
  useDraft: boolean;
  newSession: boolean;
  signal: AbortSignal;
  onRun: (run: PreviewRun) => void;
  request?: (path: string, init?: RequestInit) => Promise<Response>;
  /** Connections tried after the first drops before the task ends. */
  reconnects?: number;
}

/**
 * Runs one preview to its end and reports every change. Never rejects: a refusal such as
 * 409 PREVIEW_UNAVAILABLE becomes a failed run carrying the service's code and message.
 */
export async function runPreview({ agentRef, prompt, useDraft, newSession, signal, onRun, request = apiFetch, reconnects = 3 }: PreviewRequest): Promise<PreviewRun> {
  let run = startPreview();
  const update = (next: PreviewRun) => {
    run = next;
    onRun(run);
  };
  const key = `hivexui-preview-${randomId()}`;
  const body = JSON.stringify({ prompt, use_draft: useDraft, new_session: newSession });
  for (let attempt = 0; attempt <= reconnects && !signal.aborted; attempt += 1) {
    if (attempt > 0) update({ ...run, status: 'reconnecting' });
    try {
      const response = await request(studioPath(agentPath(agentRef, '/preview')), {
        method: 'POST',
        headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json', [IDEMPOTENCY_HEADER]: key, 'x-trace-id': randomId() },
        body,
        signal,
      });
      if (!response.ok) {
        const failure = await studioFailure(response);
        update({ ...run, status: 'failed', error: failure.message, code: failure.code ?? null });
        return run;
      }
      if (!response.body) throw new Error('No stream');
      const parser = createSseParser((frame) => update(reducePreview(run, frame)));
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parser(decoder.decode(value, { stream: true }));
        if (previewFinished(run)) {
          void reader.cancel().catch(() => undefined);
          return run;
        }
      }
    } catch {
      if (signal.aborted) break;
    }
    if (previewFinished(run)) return run;
  }
  if (!previewFinished(run)) update({ ...run, status: 'failed', error: signal.aborted ? 'Stopped.' : 'The connection to the preview was lost before it finished.', code: signal.aborted ? 'STOPPED' : 'STREAM_LOST' });
  return run;
}
