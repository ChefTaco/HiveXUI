// The dependency report: how Magnus resolved HiveMem, HiveSkills and Emberpath for its Ardent agents
// (an explicit setting first, then the Hive Registry), and whether each one is usable. A resolved
// endpoint is only available: enrolling, installing skills and channels still take their own steps.
import { useState } from 'react';
import { Network, RefreshCw } from 'lucide-react';
import { ardentDependenciesResponseSchema, type ArdentDependency } from '@contracts/magnus/browser';
import { Badge, Button, EmptyState, LoadingRows, ResourceError, type Tone } from '@ui';
import { magnus } from '../../../api/client';
import { MagnusApiError } from '../../../api/errors';
import { useMagnusResource } from '../../../api/use-resource';
import { FxPanel } from '../../../effects';

export const DEPENDENCY_NAME: Record<ArdentDependency['name'], string> = { hivemem: 'HiveMem', hiveskills: 'HiveSkills', emberpath: 'Emberpath' };
export const DEPENDENCY_STATUS: Record<ArdentDependency['status'], { label: string; tone: Tone; meaning: string }> = {
  usable: { label: 'Usable', tone: 'success', meaning: 'It answers, with what Magnus expects of it.' },
  missing: { label: 'Missing', tone: 'danger', meaning: 'Nothing is configured, or the endpoint does not answer.' },
  unsupported: { label: 'Unsupported', tone: 'warning', meaning: 'It answers, but lacks a capability Magnus expects. Upgrade it.' },
  awaiting_configuration: { label: 'Awaiting configuration', tone: 'info', meaning: 'Found, but Magnus still needs its own credential or setting for it.' },
};
export const DEPENDENCY_SOURCE: Record<ArdentDependency['source'], string> = { override: 'Explicit setting', registry: 'Hive Registry', none: 'Not resolved' };

/** The report, or null from a Magnus without it (404). `refresh` resolves again now. */
export async function readDependencies(refresh: boolean, signal?: AbortSignal): Promise<ArdentDependency[] | null> {
  try {
    return (await magnus.get('/ardent/dependencies', ardentDependenciesResponseSchema, { query: refresh ? { refresh: 'true' } : undefined, signal })).data;
  } catch (error) {
    if (error instanceof MagnusApiError && error.notFound) return null;
    throw error;
  }
}

export function DependencyReport({ read = readDependencies }: { read?: typeof readDependencies }) {
  const [refresh, setRefresh] = useState(0);
  const report = useMagnusResource((signal) => read(refresh > 0, signal), [refresh, read]);
  const data = report.data;
  const known = data !== undefined;
  return (
    <FxPanel
      title="Agent dependencies"
      description="How Magnus found the services its Ardent agents use: an explicit setting wins, then the Hive Registry. Finding one never enrolls or enables anything."
      interactive={false}
      actions={
        <Button size="sm" variant="ghost" icon={<RefreshCw className="size-4" />} loading={report.loading && known} onClick={() => setRefresh((value) => value + 1)}>
          Check again
        </Button>
      }
    >
      {data === undefined ? (
        report.loading ? <LoadingRows rows={3} /> : <ResourceError error={report.error} title="The dependency report is unavailable" onRetry={() => void report.refresh()} />
      ) : data === null ? (
        <EmptyState compact icon={<Network className="size-5" />} title="This Magnus does not report agent dependencies" message="Magnus 3.3.0 or later resolves HiveMem, HiveSkills and Emberpath from the Hive Registry and reports each one here." />
      ) : data.length === 0 ? (
        <EmptyState compact title="Magnus reports no agent dependencies" />
      ) : (
        <ul className="m-0 grid gap-2 p-0" aria-label="Agent dependencies">
          {data.map((item) => {
            const status = DEPENDENCY_STATUS[item.status];
            return (
              <li key={item.name} className="grid list-none gap-1 rounded-control border border-border bg-surface-sunken p-3" data-dependency={item.name}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{DEPENDENCY_NAME[item.name]}</span>
                  <Badge tone={status.tone} dot>
                    {status.label}
                  </Badge>
                </div>
                <p className="m-0 text-xs text-text-muted">
                  {DEPENDENCY_SOURCE[item.source]}
                  {item.endpoint ? (
                    <>
                      {' · '}
                      <span className="break-all font-mono">{item.endpoint}</span>
                    </>
                  ) : null}
                </p>
                <p className="m-0 text-xs">{item.reason ?? status.meaning}</p>
                {item.capabilities.length ? (
                  <p className="m-0 flex flex-wrap gap-1" aria-label={`${DEPENDENCY_NAME[item.name]} capabilities`}>
                    {item.capabilities.map((capability) => (
                      <Badge key={capability} className="font-mono">
                        {capability}
                      </Badge>
                    ))}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {known && report.error ? <p role="alert" className="m-0 mt-2 text-sm text-warning">The last check failed; this is the report before it.</p> : null}
    </FxPanel>
  );
}
