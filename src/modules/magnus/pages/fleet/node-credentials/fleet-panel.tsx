import { KeyRound, ShieldAlert } from 'lucide-react';
import { Badge, Panel, ResourceError, buttonClass } from '@ui';
import { formatTime, relativeTime } from '@lib/format';
import { segment } from '../../../api/client';
import { FxPanel } from '../../../effects';
import Link from '../../../navigation';
import { hasRoute } from '../../../routes';
import { Figure } from '../shared/figure';
import type { CredentialSummary, PendingBinding } from './api';
import { blockerView, MODES, readinessText, summaryNeedsAttention, upgradeWindowText } from './model';
import { PendingBindingsTable } from './pending-bindings';

export const CREDENTIALS_ANCHOR = 'node-credentials';

/**
 * The fleet's move from the shared node secret to per-node keys: mode, server key, the automatic upgrade
 * window, counts, and what blocks enforce mode with what to do about each. Administrators also see the
 * bindings waiting for them. The caller renders nothing when this Magnus has no summary.
 */
export function NodeCredentialsPanel({ summary, pending, pendingError, canDecide, onChanged }: {
  summary: CredentialSummary;
  /** Undefined while loading or for a role that may not list them; null when this Magnus has no such route. */
  pending: PendingBinding[] | null | undefined;
  pendingError?: unknown;
  canDecide: boolean;
  onChanged: () => void;
}) {
  const mode = MODES[summary.mode];
  const readiness = readinessText(summary);
  const { nodes, legacyUse } = summary;
  return (
    <section id={CREDENTIALS_ANCHOR} aria-labelledby={`${CREDENTIALS_ANCHOR}-title`}>
      <FxPanel
        fxTone={readiness.tone === 'success' ? 'accent' : 'warning'}
        interactive={false}
        title={<span id={`${CREDENTIALS_ANCHOR}-title`} className="flex items-center gap-2"><KeyRound aria-hidden="true" className="size-4" />Node credentials</span>}
        description="Each node is moving from the fleet-wide shared secret to its own signing key."
        actions={<Badge tone={mode.tone}>mode: {mode.label}</Badge>}
      >
        <div className="grid gap-4 text-sm">
          <p className="m-0 text-text-muted">{mode.explanation}</p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Figure label="Own key" value={nodes.active} sublabel={`of ${nodes.total} nodes`} tone={nodes.active === nodes.total ? 'success' : 'accent'} />
            <Figure label="Shared secret only" value={nodes.none} tone={nodes.none ? 'warning' : 'success'} />
            <Figure label="Key revoked" value={nodes.revoked} tone={nodes.revoked ? 'danger' : 'success'} />
            <Figure label="Signing evidence" value={nodes.evidenceSigning} sublabel={`of ${nodes.active} with a key`} tone={nodes.evidenceSigning === nodes.active ? 'success' : 'warning'} />
          </div>
          <dl className="m-0 grid gap-2">
            <div className="grid gap-0.5 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-3">
              <dt className="text-text-muted">Server key</dt>
              <dd className="m-0">{summary.serverKey ? <span className="num break-all">{summary.serverKey.keyFingerprint}</span> : <span className="text-danger">cannot be read</span>}<span className="block text-xs text-text-muted">Agents pin this key. It must match the fingerprint in the server&apos;s start-up log.</span></dd>
            </div>
            <div className="grid gap-0.5 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-3">
              <dt className="text-text-muted">Automatic upgrade</dt>
              <dd className="m-0"><Badge tone={summary.legacyUpgrade.open ? 'info' : 'neutral'}>{summary.legacyUpgrade.open ? 'open' : 'closed'}</Badge> <span className="text-text-muted">{upgradeWindowText(summary.legacyUpgrade, formatTime)}</span></dd>
            </div>
            <div className="grid gap-0.5 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-3">
              <dt className="text-text-muted">Shared credential use</dt>
              <dd className="m-0 text-text-muted">
                {legacyUse.nodes === 0 && legacyUse.unattributedSinceStart === 0
                  ? `None in the last ${legacyUse.windowHours} hours.`
                  : `${legacyUse.nodes} node${legacyUse.nodes === 1 ? '' : 's'} in the last ${legacyUse.windowHours} hours: ${legacyUse.request} request${legacyUse.request === 1 ? '' : 's'} on the shared secret, ${legacyUse.evidence} on the shared result key, ${legacyUse.outbound} sent to nodes${legacyUse.lastUsedAt ? `, last ${relativeTime(legacyUse.lastUsedAt)}` : ''}.`}
                {legacyUse.unattributedSinceStart ? ` ${legacyUse.unattributedSinceStart} use${legacyUse.unattributedSinceStart === 1 ? '' : 's'} since the server started named no node.` : ''}
              </dd>
            </div>
          </dl>
          <EnforceReadiness summary={summary} />
          {canDecide && pending !== null ? (
            <div className="grid gap-2">
              <h4 className="m-0 text-sm font-semibold">Pending key bindings</h4>
              <p className="m-0 text-text-muted">Magnus did not bind these keys by itself: the agent called from an address other than the one recorded for its node. Compare each fingerprint with <code>magnus-agent identity show</code> on the host. Approve a genuine host (behind NAT, or whose address changed); reject anything else.</p>
              {pendingError && !pending ? <ResourceError error={pendingError} title="Pending bindings could not be loaded" onRetry={onChanged} /> : pending ? <PendingBindingsTable bindings={pending} canDecide={canDecide} onDecided={onChanged} /> : null}
            </div>
          ) : null}
        </div>
      </FxPanel>
    </section>
  );
}

function EnforceReadiness({ summary }: { summary: CredentialSummary }) {
  const readiness = readinessText(summary);
  const blockers = summary.blockers.map(blockerView);
  return (
    <div className={readiness.tone === 'success' ? 'rounded-control border border-success bg-success-soft px-3 py-2' : 'rounded-control border border-warning bg-warning-soft px-3 py-2'}>
      <p className={readiness.tone === 'success' ? 'm-0 font-semibold text-success' : 'm-0 font-semibold text-warning'}>{readiness.text}</p>
      {blockers.length ? (
        <ul className="m-0 mt-2 grid list-none gap-3 p-0" aria-label="What blocks enforce mode">
          {blockers.map((blocker) => (
            <li key={blocker.code} className="grid gap-1">
              <p className="m-0 font-medium">{blocker.title} <span className="num text-xs text-text-muted">({blocker.code}{blocker.nodes.length ? `, ${blocker.count}` : ''})</span></p>
              <p className="m-0 text-text-muted">{blocker.whatToDo}</p>
              {blocker.nodes.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {blocker.nodes.map((node) => (
                    <Badge key={node.id}>{hasRoute(`/nodes/${node.id}`) ? <Link href={`/nodes/${segment(node.id)}`}>{node.name}</Link> : node.name}</Badge>
                  ))}
                  {blocker.count > blocker.nodes.length ? <Badge>and {blocker.count - blocker.nodes.length} more</Badge> : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** For the overview: only what needs a person now (waiting bindings, revoked keys, an unreadable server key). */
export function NodeCredentialsAlert({ summary }: { summary: CredentialSummary }) {
  const lines = summaryNeedsAttention(summary);
  if (lines.length === 0) return null;
  return (
    <div role="alert">
      <Panel
        tone="warning"
        glow="warning"
        className="panel-corners [--panel-corner-color:var(--warning)]"
        title={<span className="flex items-center gap-2"><ShieldAlert aria-hidden="true" className="size-4 text-warning" />Node credentials need attention</span>}
        description={`${lines.join('; ')}.`.replace(/^./u, (first) => first.toUpperCase())}
        actions={<Link href={`/nodes#${CREDENTIALS_ANCHOR}`} className={buttonClass({ size: 'sm' })}>Review node credentials</Link>}
      />
    </div>
  );
}
