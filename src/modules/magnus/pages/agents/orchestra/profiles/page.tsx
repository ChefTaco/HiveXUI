import { Bot, Server } from 'lucide-react';
import { Badge, EmptyState, PageHeader, LoadingRows, ResourceError } from '@ui';
import { errorMessage } from '../../../../api/errors';
import { HERMES_POLL_MS } from '../../../../api/rate-gate';
import { useMagnusResource } from '../../../../api/use-resource';
import { FxPanel, PageItem } from '../../../../effects';
import { useMagnusSession } from '../../../../session';
import { Fact } from '../../shared/fx';
import { AgentPageLink } from '../../../../../agents/link';
import { groupProfiles, HermesStatus, installLabel, isDetected, readInstallations, readProfiles } from '../shared';

export default function HermesProfilesPage() {
  const { hermes } = useMagnusSession();
  const inventory = useMagnusResource(async (signal) => {
    const [installations, profiles] = await Promise.all([readInstallations(signal), readProfiles(signal)]);
    return { installations: installations.filter(isDetected), profiles };
  }, [], { enabled: hermes, pollMs: HERMES_POLL_MS });
  const data = inventory.data;
  const byInstallation = groupProfiles(data?.profiles ?? []);
  const count = data?.installations.reduce((total, installation) => total + (byInstallation.get(installation.id)?.length ?? installation.profiles?.length ?? 0), 0) ?? 0;
  return (
    <div className="page-stack">
      <PageItem>
        <PageHeader eyebrow="Hermes" title="Hermes profiles" description={data ? `${count} profile${count === 1 ? '' : 's'} from ${data.installations.length} detected installation${data.installations.length === 1 ? '' : 's'}` : 'Loading profiles…'} />
      </PageItem>
      {!data ? (
        <PageItem><FxPanel interactive={false}>{inventory.loading ? <LoadingRows rows={6} /> : <ResourceError error={inventory.error} title="Hermes profiles could not be loaded" onRetry={() => void inventory.refresh()} />}</FxPanel></PageItem>
      ) : data.installations.length === 0 ? (
        <PageItem><FxPanel interactive={false}><EmptyState icon={<Server className="size-5" />} title="No detected Hermes Agent installations" message="Profiles appear here once a node reports a Hermes Agent." /></FxPanel></PageItem>
      ) : (
        <PageItem>
          {inventory.error ? <p role="alert" className="m-0 mb-3 text-sm text-warning">Showing the last good inventory: {errorMessage(inventory.error)}</p> : null}
          <div className="grid gap-4 xl:grid-cols-2">
            {data.installations.map((installation) => {
              const linked = byInstallation.get(installation.id) ?? installation.profiles ?? [];
              return (
                <FxPanel key={installation.id} title={installLabel(installation)} description={<span className="break-all">{installation.hostname} · {installation.hermesHome}</span>} className="min-w-0">
                  <div className="grid gap-4">
                    <div className="grid grid-cols-2 gap-3">
                      <Fact label="Status"><HermesStatus status={installation.status} /></Fact>
                      <Fact label="Version"><span className="font-mono">{installation.version ?? 'unknown'}</span></Fact>
                      <Fact label="Config"><span className="break-all font-mono">{installation.configuration?.configPath ?? `${installation.hermesHome}/config.yaml`}</span></Fact>
                      <Fact label="Model router"><Badge tone={installation.configuration?.magnusRouterConfigured ? 'success' : 'warning'}>{installation.configuration?.magnusRouterConfigured ? 'Hive primary' : 'not configured'}</Badge></Fact>
                    </div>
                    <div className="grid gap-2">
                      {linked.map((profile) => (
                        <div key={profile.id} className="glow-hover rounded-control border border-border bg-surface-sunken p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="m-0 flex items-center gap-2 text-sm font-medium"><Bot className="size-4 text-accent" />{profile.name}</p>
                              <p className="m-0 mt-1 break-all font-mono text-xs text-text-muted">{profile.profileHome || 'profile home unknown'}</p>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              {profile.isDefault ? <Badge tone="info">default</Badge> : null}
                              {installation.nodeId ? <AgentPageLink agentRef={`${installation.nodeId}~${profile.name}`} /> : null}
                            </div>
                          </div>
                          <div className="mt-3 grid grid-cols-2 gap-3">
                            <Fact label="Gateway"><HermesStatus status={profile.gatewayStatus} /></Fact>
                            <Fact label="Provider">{profile.providerSummary ?? 'unknown'}</Fact>
                            <Fact label="Model">{profile.modelSummary ?? 'unknown'}</Fact>
                            <Fact label="API server"><Badge tone={profile.apiServerEnabled ? 'success' : 'neutral'}>{profile.apiServerEnabled ? `enabled:${profile.apiServerPort ?? '?'}` : 'disabled'}</Badge></Fact>
                          </div>
                        </div>
                      ))}
                      {linked.length === 0 ? <p className="m-0 rounded-control border border-border bg-surface-sunken p-4 text-sm text-text-muted">No profiles were reported by this running Hermes Agent.</p> : null}
                    </div>
                  </div>
                </FxPanel>
              );
            })}
          </div>
        </PageItem>
      )}
    </div>
  );
}
