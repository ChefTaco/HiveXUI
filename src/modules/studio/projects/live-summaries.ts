// Keeps the projects home current. The service has a stream per project and none for the list, so
// the home follows the streams of the few projects with the newest activity and polls the list
// slowly for the rest. A counts event patches its card at once; a record that moves a project's
// last activity re-reads the list once the burst is over.
import { useEffect, useMemo, useRef } from 'react';
import { projectCountsSchema, projectEventSchema } from '@contracts/ardentstudio.generated';
import { openStream, type StreamHandle } from '../../magnus/api/stream';
import type { SseEvent } from '../../magnus/api/sse';
import { segment, studioPath } from '../api/client';
import type { ProjectSummary } from '../api/endpoints';
import { SUMMARY_EVENTS } from '../state/project-store';

/** Streams held open at once: each one is a connection, and browsers allow few per origin over HTTP/1.1. */
export const LIVE_PROJECT_LIMIT = 4;
/** The list is re-read this often for the projects whose streams are not followed. */
export const SUMMARY_POLL_MS = 60_000;
const REFRESH_DELAY_MS = 400;

export type Counts = Pick<ProjectSummary, 'open_questions' | 'review_pending' | 'active_tasks'>;
export type SummaryAction = { kind: 'counts'; counts: Counts } | { kind: 'refresh' } | null;

/** Pure: what one frame of a project's stream means for the home. */
export function summaryAction(frame: SseEvent): SummaryAction {
  let data: unknown;
  try {
    data = JSON.parse(frame.data);
  } catch {
    return null;
  }
  const event = projectEventSchema.safeParse(data);
  if (!event.success) return null;
  const { type, payload } = event.data;
  if (type === 'project.updated') {
    const fields = Array.isArray(payload.fields) ? payload.fields : [];
    const counts = projectCountsSchema.safeParse(payload.counts);
    if (fields.length === 1 && fields[0] === 'counts' && counts.success) return { kind: 'counts', counts: counts.data };
    // Name, brief or tags changed: the card shows them.
    return { kind: 'refresh' };
  }
  if (type === 'project.archived' || type === 'project.reopened' || type === 'team.draft.updated' || SUMMARY_EVENTS.has(type)) return { kind: 'refresh' };
  return null;
}

/** The projects whose streams the home follows: active ones with the newest recorded activity. */
export function watchedProjects(projects: readonly ProjectSummary[], limit = LIVE_PROJECT_LIMIT): string[] {
  return projects
    .filter((project) => project.status === 'active')
    .map((project) => ({ id: project.id, at: project.last_activity?.at ?? project.updated_at }))
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, limit)
    .map((project) => project.id);
}

export interface LiveSummaryOptions {
  open?: typeof openStream;
}

/**
 * Follows the watched projects' streams while the home is shown. `patch` applies a counts change to
 * one card; `refresh` re-reads the list. A stream that reconnects re-reads it too, since it starts
 * at the present and events in the gap are not replayed.
 */
export function useLiveSummaries(projects: readonly ProjectSummary[] | undefined, patch: (projectId: string, counts: Counts) => void, refresh: () => void, options: LiveSummaryOptions = {}): void {
  const open = options.open ?? openStream;
  const ids = useMemo(() => watchedProjects(projects ?? []), [projects]);
  const key = ids.join(',');
  const handlers = useRef({ patch, refresh });
  handlers.current = { patch, refresh };

  useEffect(() => {
    if (!key) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const later = () => {
      clearTimeout(timer);
      timer = setTimeout(() => handlers.current.refresh(), REFRESH_DELAY_MS);
    };
    const handles: StreamHandle[] = key.split(',').map((projectId) => {
      let opened = false;
      return open({
        path: '/',
        url: () => studioPath(`/projects/${segment(projectId)}/stream`),
        deniedMessage: 'This identity may not read this project',
        idleTimeoutMs: 45_000,
        onEvent: (frame) => {
          const action = summaryAction(frame);
          if (action?.kind === 'counts') handlers.current.patch(projectId, action.counts);
          else if (action?.kind === 'refresh') later();
        },
        onState: (state) => {
          if (state !== 'open') return;
          if (opened) later();
          opened = true;
        },
      });
    });
    return () => {
      clearTimeout(timer);
      for (const handle of handles) handle.close();
    };
  }, [key, open]);
}
