import type { z } from 'zod';
import type { fleetReadinessNodeSchema, timelineItemSchema } from '@contracts/magnus/browser';
import type { FleetRadarCounts } from '../../../effects';
import type { RetentionTable } from './schemas';

export type ReadinessNode = z.output<typeof fleetReadinessNodeSchema>;
export type TimelineItem = z.output<typeof timelineItemSchema>;

/** Records for the control plane itself, not nodes an operator can deploy to or remediate. */
const INTERNAL_NODE_IDS = new Set(['__control-api__', '__dashboard__']);
export const fleetNodes = (nodes: readonly ReadinessNode[]): ReadinessNode[] => nodes.filter((node) => !INTERNAL_NODE_IDS.has(node.id));

/** Radar blips by operational status. A stale node counts as degraded: it may be fine, but nobody knows. */
export function radarCounts(nodes: readonly ReadinessNode[]): FleetRadarCounts {
  const counts: FleetRadarCounts = { online: 0, degraded: 0, offline: 0, provisioning: 0 };
  for (const { operationalStatus: status } of nodes) {
    if (status === 'ONLINE') counts.online += 1;
    else if (status === 'DEGRADED' || status === 'STALE') counts.degraded += 1;
    else if (status === 'PROVISIONING') counts.provisioning += 1;
    else counts.offline += 1;
  }
  return counts;
}

export const totalRecords = (tables: readonly RetentionTable[]): number => tables.reduce((sum, table) => sum + table.count, 0);

export const TIMELINE_TYPES = ['notification', 'command', 'deploy', 'hermes', 'log', 'audit'] as const;
export type TimelineFilter = 'all' | (typeof TIMELINE_TYPES)[number];

/** The API gives timeline items no id, and identical ones can repeat in a burst. Keys stay stable across polls. */
export function keyedTimeline(items: readonly TimelineItem[], filter: TimelineFilter = 'all'): Array<TimelineItem & { key: string }> {
  const seen = new Map<string, number>();
  return items.filter((item) => filter === 'all' || item.type === filter).map((item) => {
    const base = `${item.type}|${item.timestamp}|${item.title}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return { ...item, key: count ? `${base}|${count}` : base };
  });
}
