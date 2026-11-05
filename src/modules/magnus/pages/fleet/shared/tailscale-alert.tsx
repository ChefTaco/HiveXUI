import { z } from 'zod';
import { AlertTriangle, ShieldAlert } from 'lucide-react';
import { tailscaleSummaryResponseSchema } from '@contracts/magnus/browser';
import { Badge, Panel } from '@ui';
import Link from '../../../navigation';

type Summary = z.output<typeof tailscaleSummaryResponseSchema>['data'];

/** Nodes whose Tailscale key needs renewal, the most urgent first. Nothing when none do. */
export function TailscaleExpiryAlert({ summary, showAction = true }: { summary: Summary; showAction?: boolean }) {
  const nodes = summary.nodes
    .filter((node) => node.tailscale?.requiresRenewal)
    .sort((left, right) => {
      if (left.tailscale?.expired !== right.tailscale?.expired) return left.tailscale?.expired ? -1 : 1;
      return (left.tailscale?.daysRemaining ?? Number.MAX_SAFE_INTEGER) - (right.tailscale?.daysRemaining ?? Number.MAX_SAFE_INTEGER);
    });
  if (nodes.length === 0) return null;
  const expired = nodes.some((node) => node.tailscale?.expired);
  const Icon = expired ? ShieldAlert : AlertTriangle;
  return (
    <div role="alert" id="tailscale-renewal">
      <Panel
        tone={expired ? 'danger' : 'warning'}
        className={expired ? 'fx-panel fx-tone-danger' : 'fx-panel fx-tone-warning'}
        title={<span className="flex items-center gap-2"><Icon className={expired ? 'fx-pulse size-4 text-danger' : 'size-4 text-warning'} />{expired ? 'Tailscale access expired' : 'Tailscale renewal due'}</span>}
        description={`${nodes.length} node ${nodes.length === 1 ? 'key needs' : 'keys need'} renewal within ${summary.warningDays} days. Renew before tailnet access is interrupted.`}
        actions={showAction ? <Link href="/nodes#tailscale-renewal" className="btn btn--sm">Review nodes</Link> : undefined}
      >
        <div className="flex flex-wrap gap-1.5">
          {nodes.map((node) => (
            <Badge key={node.id} tone={node.tailscale?.expired ? 'danger' : 'warning'}>
              <span title={node.tailscale?.keyExpiry ? `Expires ${node.tailscale.keyExpiry}` : undefined}>
                {node.name} · {node.tailscale?.expired ? 'expired' : `${node.tailscale?.daysRemaining ?? '?'}d`}
              </span>
            </Badge>
          ))}
        </div>
      </Panel>
    </div>
  );
}
