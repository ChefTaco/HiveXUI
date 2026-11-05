import { useEffect, useSyncExternalStore } from 'react';
import { useToast } from '../../../components/toast';
import { statsOverviewResponseSchema } from '@contracts/magnus/browser';
import { onAccessCleared } from '../../../lib/transport';
import { magnus } from '../api/client';
import { openStream, type StreamHandle, type StreamState } from '../api/stream';
import { eventToEntry, recentActivityEntries } from './event-entry';
import { eventFeed, type LiveStatus } from './feed';

/**
 * An HTTP/1.1 browser allows six connections per origin and a stream holds one for as long as the
 * console is open, so it lets the first page load before taking it. The wait is not restarted by
 * moving between pages: someone who keeps moving would otherwise never go live.
 */
export const STREAM_DWELL_MS = 5000;

const LIVE_STATUS: Record<StreamState, LiveStatus> = { connecting: 'connecting', open: 'live', retrying: 'retrying', stopped: 'stopped' };
/** A stream that gave up must not read as still connecting. */
export const liveStatus = (state: StreamState): LiveStatus => LIVE_STATUS[state];

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
    eventFeed.setStatus('waiting');
    const timer = setTimeout(() => {
      stream = openStream({
        path: '/events/stream',
        onState: (state, detail) => eventFeed.setStatus(liveStatus(state), state === 'stopped' ? detail : undefined),
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
    }, STREAM_DWELL_MS);
    return () => {
      clearTimeout(timer);
      stream?.close();
      eventFeed.setStatus('waiting');
    };
    // The toast API is rebuilt by its provider on each render; the first one stays valid.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export const useEventFeed = () => useSyncExternalStore(eventFeed.subscribe, eventFeed.get);
