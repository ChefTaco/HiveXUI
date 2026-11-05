import { ArrowUpRight, Route } from 'lucide-react';
import { Badge, EmptyState, PageHeader, TableFrame } from '@ui';
import { relativeTime } from '@lib/format';
import { cn } from '@lib/cn';
import { magnus, segment } from '../../../api/client';
import { errorMessage } from '../../../api/errors';
import { HERMES_POLL_MS } from '../../../api/rate-gate';
import { useMagnusResource } from '../../../api/use-resource';
import { FxPanel, GLOW_TEXT, PageItem } from '../../../effects';
import Link from '../../../navigation';
import { LoadingRows, ResourceError } from '../../../ui/resource-state';
import { hermesTone } from '../orchestra/shared';
import { hermesEffectiveStateResponseSchema } from './schemas';

export default function HermesDriftPage() {
  const evidence = useMagnusResource((signal) => magnus.get('/ops/hermes-effective-state', hermesEffectiveStateResponseSchema, { signal }).then((response) => response.data), [], { pollMs: HERMES_POLL_MS });
  const state = evidence.data;
  return (
    <div className="page-stack" data-testid="hermes-drift-page">
      <PageItem>
        <PageHeader
          eyebrow="Desired and observed"
          title="Hermes drift cockpit"
          description="Compare assigned skills with what nodes report. Reconcile on the host, from this evidence."
          status={state ? <Badge tone="info">Evidence {relativeTime(state.generatedAt)}</Badge> : undefined}
        />
      </PageItem>
      <PageItem>
        <FxPanel padding={state?.installations.length ? 'none' : 'md'} interactive={false}>
          {!state ? (
            evidence.loading ? <LoadingRows /> : <ResourceError error={evidence.error} title="Effective-state evidence is unavailable" onRetry={() => void evidence.refresh()} />
          ) : state.installations.length === 0 ? (
            <EmptyState icon={<Route className="size-5" />} title="No Hermes installations to compare" message="Drift appears here once a node reports a Hermes Agent." />
          ) : (
            <>
              {evidence.error ? <p role="alert" className="m-3 text-sm text-warning">Showing the last good evidence: {errorMessage(evidence.error)}</p> : null}
              <TableFrame label="Hermes effective state">
                <table>
                  <thead><tr>{['Node and runtime', 'Profiles', 'Desired', 'Effective', 'Drift', 'Reconcile preview'].map((heading) => <th key={heading}>{heading}</th>)}</tr></thead>
                  <tbody>
                    {state.installations.map((item) => {
                      const drift = item.driftedSkills.length;
                      return (
                        <tr key={`${item.id}:${drift}`} className={cn('fx-rail', drift > 0 && 'scan-sweep')}>
                          <td>
                            <div className="font-semibold text-accent">{item.hostname}</div>
                            <Badge tone={hermesTone(item.status)} className="mt-1">{item.status}</Badge>
                          </td>
                          <td className="num">{item.profiles}</td>
                          <td className="num">{item.desiredSkills}</td>
                          <td className="num">{item.effectiveEnabledSkills}</td>
                          <td className={cn('num font-bold', drift ? ['text-warning', GLOW_TEXT.warning] : 'text-success')}>{drift}</td>
                          <td className="min-w-64">
                            {drift ? (
                              <>
                                <ul className="m-0 grid list-none gap-1 p-0 text-sm text-text-muted">
                                  {item.driftedSkills.map((skill) => <li key={skill.slug} title={skill.error ?? undefined}><span className="font-mono">{skill.slug}</span>: {skill.status}{skill.error ? <span className="block text-xs text-danger">{skill.error}</span> : null}</li>)}
                                </ul>
                                <p className="m-0 mt-1 text-xs text-text-muted">{item.followOn}</p>
                              </>
                            ) : <p className="m-0 text-sm text-text-muted">Observed state matches assigned skill state.</p>}
                            <Link href={`/orchestra/installations?installationId=${segment(item.id)}`} className="mt-2 inline-flex items-center gap-1 text-sm font-semibold">Inspect installation <ArrowUpRight className="size-4" /></Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableFrame>
            </>
          )}
        </FxPanel>
      </PageItem>
    </div>
  );
}
