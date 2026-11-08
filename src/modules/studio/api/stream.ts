// A project's live event feed. Persisted events carry a per-project seq with no gaps, so the client
// keeps the last one and resumes with ?after=. Anything it cannot account for (a reset from the
// service, a skipped seq, a heartbeat ahead of it) means its copy may be stale: refetch the snapshot.
import type { z } from 'zod';
import { messageDeltaEventSchema, projectEventSchema, resetEventSchema, heartbeatEventSchema } from '@contracts/ardentstudio.generated';
import { openStream, type StreamHandle, type StreamState } from '../../magnus/api/stream';
import type { SseEvent } from '../../magnus/api/sse';
import { segment, studioPath } from './client';

export type ProjectEvent = z.infer<typeof projectEventSchema>;
export type MessageDelta = z.infer<typeof messageDeltaEventSchema>;

export type StreamAction =
  /** The next persisted event, in order. */
  | { kind: 'event'; event: ProjectEvent }
  /** Live text for a streaming message. Never persisted, never replayed. */
  | { kind: 'delta'; delta: MessageDelta }
  /** The local copy may have missed events: refetch the snapshot and resume from its seq. */
  | { kind: 'reset'; reason: 'reset' | 'gap' }
  /** A duplicate, a heartbeat in step, or a frame this client does not read. */
  | { kind: 'ignore' };

const parse = <S extends z.ZodType>(schema: S, data: string): z.output<S> | null => {
  try {
    const parsed = schema.safeParse(JSON.parse(data));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

/** Pure: what one frame means for a client whose last applied event is `seq`. */
export function reduceStreamFrame(seq: number, frame: SseEvent): { seq: number; action: StreamAction } {
  if (frame.event === 'reset') return parse(resetEventSchema, frame.data) ? { seq, action: { kind: 'reset', reason: 'reset' } } : { seq, action: { kind: 'ignore' } };
  if (frame.event === 'heartbeat') {
    const beat = parse(heartbeatEventSchema, frame.data);
    return beat && beat.seq > seq ? { seq, action: { kind: 'reset', reason: 'gap' } } : { seq, action: { kind: 'ignore' } };
  }
  if (frame.event === 'message.delta') {
    const delta = parse(messageDeltaEventSchema, frame.data);
    return { seq, action: delta ? { kind: 'delta', delta } : { kind: 'ignore' } };
  }
  const event = parse(projectEventSchema, frame.data);
  if (!event) return { seq, action: { kind: 'ignore' } };
  if (event.seq <= seq) return { seq, action: { kind: 'ignore' } };
  if (event.seq !== seq + 1) return { seq, action: { kind: 'reset', reason: 'gap' } };
  return { seq: event.seq, action: { kind: 'event', event } };
}

export interface ProjectStreamOptions {
  projectId: string;
  /** The last applied seq, read again for every connection. */
  cursor: () => number;
  onFrame: (frame: SseEvent) => void;
  onState?: (state: StreamState, detail?: string) => void;
  request?: typeof fetch;
}

/** Opens the project's SSE feed through the shared fetch-stream reader, resuming from the cursor. */
export function openProjectStream({ projectId, cursor, onFrame, onState, request }: ProjectStreamOptions): StreamHandle {
  return openStream({
    path: '/',
    url: () => studioPath(`/projects/${segment(projectId)}/stream`, { after: cursor() }),
    deniedMessage: 'This identity may not read this project',
    // The service sends a heartbeat every 15 seconds.
    idleTimeoutMs: 45_000,
    onEvent: onFrame,
    ...(onState ? { onState } : {}),
    ...(request ? { request } : {}),
  });
}
