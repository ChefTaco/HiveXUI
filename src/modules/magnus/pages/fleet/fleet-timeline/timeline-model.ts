import type { z } from 'zod';
import type { timelineItemSchema } from '@contracts/magnus/browser';
import type { ConsoleRole } from '../../../routes';
import { matchRoute } from '../../../routes';
import { severityTone } from '../shared/severity';

export type TimelineItem = z.output<typeof timelineItemSchema>;

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

/** How many items of each type, for the filter buttons. */
export function countByType(items: readonly TimelineItem[]): Record<TimelineFilter, number> {
  const counts = { all: items.length, notification: 0, command: 0, deploy: 0, hermes: 0, log: 0, audit: 0 } satisfies Record<TimelineFilter, number>;
  for (const item of items) counts[item.type] += 1;
  return counts;
}

export interface TimelineSummary {
  events: number;
  /** Items whose severity reads as a warning or a failure. */
  attention: number;
  nodes: number;
  latest: string | null;
}

export function summarizeTimeline(items: readonly TimelineItem[]): TimelineSummary {
  let latest: number | null = null;
  let latestText: string | null = null;
  let attention = 0;
  const nodes = new Set<string>();
  for (const item of items) {
    const tone = severityTone(item.severity);
    if (tone === 'danger' || tone === 'warning') attention += 1;
    if (item.node) nodes.add(item.node);
    const at = Date.parse(item.timestamp);
    if (Number.isFinite(at) && (latest === null || at > latest)) {
      latest = at;
      latestText = item.timestamp;
    }
  }
  return { events: items.length, attention, nodes: nodes.size, latest: latestText };
}

/**
 * Whether this session can follow an item's link here. The API sends the old console's paths: one may
 * not be ported, be limited to some roles (/commands), or need Hermes (/orchestra/installations).
 */
export function canFollow(href: string, session: { role: ConsoleRole | null; hermes: boolean }): boolean {
  const found = matchRoute(href.split(/[?#]/, 1)[0]!);
  if (!found) return false;
  const { route } = found;
  if (route.capability === 'hermes' && !session.hermes) return false;
  return !route.roles || (session.role !== null && route.roles.includes(session.role));
}
