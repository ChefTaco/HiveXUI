import { AlertTriangle, Clock, History, RefreshCw, Server } from 'lucide-react';
import { timelineResponseSchema } from '@contracts/magnus/browser';
import { Button, PageHeader } from '@ui';
import { relativeTime } from '@lib/format';
import { magnus } from '../../../api/client';
import { useMagnusResource } from '../../../api/use-resource';
import { PageItem } from '../../../effects';
import { Figure } from '../shared/figure';
import { summarizeTimeline } from './timeline-model';
import { TimelinePanel } from './timeline-panel';

const POLL_MS = 30_000;
/** What the old page asked for. The server clamps to 200. */
export const TIMELINE_LIMIT = 120;

export default function FleetTimelinePage() {
  const timeline = useMagnusResource((signal) => magnus.get('/ops/timeline', timelineResponseSchema, { query: { limit: TIMELINE_LIMIT }, signal }), [], { pollMs: POLL_MS });
  const summary = timeline.data ? summarizeTimeline(timeline.data.data) : undefined;
  return (
    <div className="page-stack" data-testid="fleet-timeline-page">
      <PageItem>
        <PageHeader
          title="Fleet timeline"
          eyebrow="Fleet"
          icon={<History className="size-5" />}
          description="What happened across the fleet, newest first. Open an event to see it where it lives."
          actions={<Button size="sm" icon={<RefreshCw className="size-4" />} loading={timeline.refreshing} onClick={() => void timeline.refresh()}>Refresh</Button>}
        />
      </PageItem>
      {summary ? (
        <PageItem>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Timeline summary" role="group">
            <Figure label="Events" value={summary.events} icon={History} sublabel={`Latest ${TIMELINE_LIMIT} across the fleet`} />
            <Figure label="Needs attention" value={summary.attention} icon={AlertTriangle} tone={summary.attention ? 'warning' : 'success'} sublabel="Warnings and failures" />
            <Figure label="Nodes involved" value={summary.nodes} icon={Server} tone="info" />
            <Figure label="Latest event" value={summary.latest ? relativeTime(summary.latest) : 'None'} icon={Clock} tone="neutral" />
          </div>
        </PageItem>
      ) : null}
      <PageItem><TimelinePanel resource={timeline} limit={TIMELINE_LIMIT} full /></PageItem>
    </div>
  );
}
