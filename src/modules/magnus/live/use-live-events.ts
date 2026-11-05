import { useEffect, useSyncExternalStore } from 'react';
import { useToast } from '../../../components/toast';
import { statsOverviewResponseSchema } from '@contracts/magnus/browser';
import { onAccessCleared } from '../../../lib/transport';
import { magnus } from '../api/client';
import { openStream, type StreamHandle } from '../api/stream';
import { eventToEntry, recentActivityEntries } from './event-entry';
import { eventFeed } from './feed';

/**
 * An HTTP/1.1 browser allows six connections per origin and a stream holds one for as long as the
 * console is open, so it waits until a page has finished loading and has been left alone this long.
 * Moving between pages restarts the wait, and once open the stream stays open across pages.
 */
export const STREAM_DWELL_MS = 5000;

/** The module-wide live connection: one stream, which feeds the marquee, the lists and the toasts. */
export function useLiveEvents(): void {
  const toast = useToast();
  useEffect(() => onAccessCleared(() => eventFeed.reset()), []);

  // Seed once, so the marquee shows real recent activity before anything happens live.
  useEffect(() => {
    const controller = new AbortController();
    void magnus
      .get('/stats/overview', statsOverviewResponseSchema, { signal: controller.signal })
      .then(({ data }) => eventFeed.seed(recentActivityEntries(data)))
      .catch(() => {});
    return () => controller.abort();
  }, []);

  useEffect(() => {
    let stream: StreamHandle | undefined;
    const timer = { current: undefined as ReturnType<typeof setTimeout> | undefined };
    const connect = () => {
      stream = openStream({
        path: '/events/stream',
        onState: (state) => eventFeed.setConnected(state === 'open'),
        onEvent: ({ event, data }) => {
          if (event === 'connected' || event === 'heartbeat') return;
          let body: unknown;
          try {
            body = JSON.parse(data);
          } catch {
            return;
          }
          const { toast: announce, ...entry } = eventToEntry(event, body);
          eventFeed.push({ ...entry, channel: event });
          if (announce) toast.push(entry.severity === 'error' ? 'error' : entry.severity === 'success' ? 'success' : 'info', entry.title, entry.message);
        },
      });
    };
    const arm = () => {
      clearTimeout(timer.current);
      if (!stream) timer.current = setTimeout(connect, STREAM_DWELL_MS);
    };
    arm();
    window.addEventListener('popstate', arm);
    return () => {
      window.removeEventListener('popstate', arm);
      clearTimeout(timer.current);
      stream?.close();
      eventFeed.setConnected(false);
    };
    // The toast API is rebuilt by its provider on each render; the first one stays valid.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export const useEventFeed = () => useSyncExternalStore(eventFeed.subscribe, eventFeed.get);
