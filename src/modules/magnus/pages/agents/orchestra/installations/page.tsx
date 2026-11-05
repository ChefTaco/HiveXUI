import { useEffect } from 'react';
import { Bot, Server } from 'lucide-react';
import { Badge, EmptyState, PageHeader } from '@ui';
import { cn } from '@lib/cn';
import { errorMessage } from '../../../../api/errors';
import { HERMES_POLL_MS } from '../../../../api/rate-gate';
import { useMagnusResource } from '../../../../api/use-resource';
import { FxPanel, PageItem } from '../../../../effects';
import { useSearchParams } from '../../../../navigation';
import { useMagnusSession } from '../../../../session';
import { LoadingRows, ResourceError } from '../../../../ui/resource-state';
import { Fact } from '../../shared/fx';
import { HermesStatus, HiveMemTokenStatus, installLabel, isDetected, readInstallations, synced } from '../shared';

export default function HermesInstallationsPage() {
  const { hermes } = useMagnusSession();
  const focus = useSearchParams().get('installationId');
  const inventory = useMagnusResource((signal) => readInstallations(signal), [], { enabled: hermes, pollMs: HERMES_POLL_MS });
  const detected = inventory.data?.filter(isDetected);
  const found = !!detected?.some((installation) => installation.id === focus);
  useEffect(() => {
    if (found && focus) document.getElementById(`installation-${focus}`)?.scrollIntoView({ block: 'center' });
  }, [found, focus]);
  return (
    <div className="page-stack">
      <PageItem>
        <PageHeader eyebrow="Hermes" title="Hermes installations" description={detected ? `${detected.length} detected installation${detected.length === 1 ? '' : 's'}. Read-only inventory: changes run on the host.` : 'Loading installation inventory…'} />
      </PageItem>
      {!detected ? (
        <PageItem><FxPanel interactive={false}>{inventory.loading ? <LoadingRows rows={6} /> : <ResourceError error={inventory.error} title="Hermes installations could not be loaded" onRetry={() => void inventory.refresh()} />}</FxPanel></PageItem>
      ) : detected.length === 0 ? (
        <PageItem><FxPanel interactive={false}><EmptyState icon={<Server className="size-5" />} title="No Hermes Agent installations detected" message="Nodes report their Hermes Agent here once one is installed." /></FxPanel></PageItem>
      ) : (
        <PageItem>
          {inventory.error ? <p role="alert" className="m-0 mb-3 text-sm text-warning">Showing the last good inventory: {errorMessage(inventory.error)}</p> : null}
          <div className="grid gap-4 xl:grid-cols-2">
            {detected.map((installation) => {
              const configuration = installation.configuration;
              return (
                <FxPanel key={installation.id} id={`installation-${installation.id}`} title={installLabel(installation)} description={installation.hostname} actions={<HermesStatus status={installation.status} />} className={cn('min-w-0', focus === installation.id && 'scan-sweep glow-accent')}>
                  <div className="grid gap-4">
                    <div className="grid grid-cols-2 gap-3">
                      <Fact label="Hermes home"><span className="break-all font-mono">{installation.hermesHome}</span></Fact>
                      <Fact label="Version"><span className="font-mono">{installation.version ?? 'unknown'}</span></Fact>
                      <Fact label="Gateway"><HermesStatus status={installation.gatewayStatus} /></Fact>
                      <Fact label="Dashboard"><HermesStatus status={installation.dashboardStatus} /></Fact>
                      <Fact label="Profiles"><span className="num">{installation.profiles?.length ?? 0}</span></Fact>
                      <Fact label="Last sync">{synced(installation.lastSyncedAt)}</Fact>
                      <Fact label="Model router"><Badge tone={configuration?.magnusRouterConfigured ? 'success' : 'warning'}>{configuration?.magnusRouterConfigured ? 'Hive primary' : 'not configured'}</Badge></Fact>
                      <Fact label="Memory"><Badge tone={configuration?.hiveMemConfigured ? 'success' : 'warning'}>{configuration?.hiveMemConfigured ? 'HiveMem active' : 'not configured'}</Badge><HiveMemTokenStatus configuration={configuration} /></Fact>
                      <Fact label="OpenAI runtime"><Badge tone={configuration?.openaiRuntime === 'codex_app_server' ? 'success' : 'warning'}>{configuration?.openaiRuntime === 'codex_app_server' ? 'Codex app-server' : 'Hermes default'}</Badge></Fact>
                    </div>
                    {installation.profiles?.length ? (
                      <div className="flex flex-wrap gap-2">
                        {installation.profiles.slice(0, 6).map((profile) => <span key={profile.id} className="inline-flex items-center gap-1 rounded-chip border border-border px-2 py-1 text-xs text-text-muted"><Bot className="size-3" />{profile.name}</span>)}
                      </div>
                    ) : null}
                    {configuration ? <p className="m-0 text-xs text-text-muted">Magnus Hermes plugins: adapter required for upstream Hermes Agent plugin compatibility.</p> : null}
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
