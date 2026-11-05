import { AlertTriangle, RotateCcw, ShieldOff } from 'lucide-react';
import { Badge } from '@ui';
import { readinessTitle, type UpgradeReadiness } from '../nodes/agent-upgrade-view';
import { selfUpgradeReport } from './node-data';

/** The agent's own report: a last upgrade that failed, or that it cannot upgrade itself. */
export function AgentSelfUpgradeBadge({ metadata }: { metadata: string }) {
  const report = selfUpgradeReport(metadata);
  if (!report) return null;
  const state = report.upgrade?.state;
  if (state === 'reverted' || state === 'failed') {
    return (
      <span title={report.upgrade?.reason ?? undefined}>
        <Badge tone="danger"><RotateCcw aria-hidden="true" className="mr-1 inline size-3" />Upgrade to {report.upgrade?.to} {state}</Badge>
      </span>
    );
  }
  if (report.enabled) return null;
  return (
    <span title={report.reason ?? undefined}>
      <Badge><ShieldOff aria-hidden="true" className="mr-1 inline size-3" />Self-upgrade off</Badge>
    </span>
  );
}

/** A node that could not take an agent upgrade now, with the reasons on hover. */
export function UpgradeReadinessBadge({ readiness }: { readiness: UpgradeReadiness | null }) {
  if (readiness?.status !== 'not-ready') return null;
  return (
    <span title={readinessTitle(readiness)}>
      <Badge tone="warning"><AlertTriangle aria-hidden="true" className="mr-1 inline size-3" />Upgrade blocked ({readiness.problems.length})</Badge>
    </span>
  );
}

/** Each problem with its cause and what to do about it. */
export function UpgradeReadinessPanel({ readiness }: { readiness: UpgradeReadiness | null }) {
  if (readiness?.status !== 'not-ready') return null;
  return (
    <div className="rounded-control border border-warning bg-warning-soft px-3 py-2 text-sm">
      <p className="m-0 flex items-center gap-2 font-semibold text-warning"><AlertTriangle aria-hidden="true" className="size-4" />This node could not take an agent upgrade now</p>
      <ul className="m-0 mt-2 grid list-none gap-2 p-0">
        {readiness.problems.map((problem) => (
          <li key={`${problem.code}-${problem.detail}`}>
            <p className="m-0 font-medium"><span className="num">{problem.code}</span>: {problem.detail}</p>
            <p className="m-0 text-text-muted">{problem.remedy}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
