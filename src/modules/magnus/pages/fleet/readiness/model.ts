import type { z } from 'zod';
import type { fleetReadinessNodeSchema } from '@contracts/magnus/browser';
import type { FleetRadarCounts } from '../../../effects';

export type ReadinessNode = z.output<typeof fleetReadinessNodeSchema>;

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
