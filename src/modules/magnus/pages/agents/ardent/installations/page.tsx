import { useState } from 'react';
import { ArrowUpRight, RefreshCw, Server } from 'lucide-react';
import { Badge, Button, EmptyState, PageHeader, StatusDot, LoadingRows, ResourceError } from '@ui';
import { errorMessage } from '../../../../api/errors';
import { useMagnusResource } from '../../../../api/use-resource';
import { FxPanel, HaloDot, PageItem } from '../../../../effects';
import Link from '../../../../navigation';
import { ActionConfirm } from '../../../../ui/action-confirm';
import { Fact } from '../../shared/fx';
import { ardentAction, listInstallations } from '../api';
import { CommandOwners } from '../command-owners';
import { profileHref } from '../logic';
import { packageInstalledSchema, serviceStateSchema, type ArdentInstallation } from '../schemas';

function PackageControls({ item, refresh }: { item: ArdentInstallation; refresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const staged = item.stagedPackage;
  const [confirming, setConfirming] = useState(false);
  async function install() {
    setConfirming(false);
    setBusy(true);
    setError('');
    setFeedback('');
    try {
      // Package installation is node-wide; the profile segment only satisfies the action route.
      const result = await ardentAction(item.nodeId, item.profiles[0]?.id ?? 'default', 'package-install', packageInstalledSchema);
      if (!result.installed || result.version !== staged?.version) throw new Error('The node did not verify the installed Ardent package');
      setFeedback(`Ardent ${result.version} installed. Create or start a profile when configured.`);
      await refresh();
    } catch (caught) {
      setError(errorMessage(caught, 'The package could not be installed'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="border-t border-border pt-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-text-muted">Release package</span>
        <span className="font-mono">{staged?.version ?? 'not staged'}</span>
        {staged && item.version !== staged.version ? <Button size="sm" loading={busy} disabled={!item.reachable} onClick={() => setConfirming(true)}>{busy ? 'Installing…' : item.installed ? 'Update package' : 'Install package'}</Button> : null}
      </div>
      {item.stagedPackageError ? <p role="alert" className="m-0 mt-2 text-danger">{item.stagedPackageError}</p> : null}
      {feedback ? <p role="status" className="m-0 mt-2 text-success">{feedback}</p> : null}
      {error ? <p role="alert" className="m-0 mt-2 text-danger">{error}</p> : null}
      {staged && item.version !== staged.version ? <p className="m-0 mt-2 text-text-muted">Stop this node’s profiles before updating. Review unfinished work first; start the profiles again after the package is verified.</p> : null}
      <ActionConfirm open={confirming} title={item.installed ? 'Update the Ardent package?' : 'Install the Ardent package?'} message={`${item.installed ? 'Update' : 'Install'} Ardent ${staged?.version ?? ''} on this node? All profiles must be stopped first. Start them again after the package is verified.`} confirmLabel={item.installed ? 'Update package' : 'Install package'} onConfirm={() => void install()} onCancel={() => setConfirming(false)} />
    </div>
  );
}

function ServiceControls({ nodeId, profileId, running, refresh }: { nodeId: string; profileId: string; running: boolean; refresh: () => Promise<void> }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [confirming, setConfirming] = useState<'service-stop' | 'service-restart' | null>(null);
  async function act(action: 'service-start' | 'service-stop' | 'service-restart') {
    setConfirming(null);
    setBusy(action);
    setError('');
    setFeedback('');
    try {
      const result = await ardentAction(nodeId, profileId, action, serviceStateSchema);
      if (!result.service) throw new Error('The node did not acknowledge the Ardent service state');
      setFeedback(`${profileId} ${result.running ? 'running' : 'stopped'} on this node.`);
      await refresh();
    } catch (caught) {
      setError(errorMessage(caught, 'The service action failed'));
    } finally {
      setBusy('');
    }
  }
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
      <Button size="sm" disabled={!!busy || running} loading={busy === 'service-start'} onClick={() => void act('service-start')}>Start</Button>
      <Button size="sm" disabled={!!busy || !running} loading={busy === 'service-restart'} onClick={() => setConfirming('service-restart')}>Restart</Button>
      <Button size="sm" variant="danger" disabled={!!busy || !running} loading={busy === 'service-stop'} onClick={() => setConfirming('service-stop')}>Stop</Button>
      {busy ? <span className="flex items-center gap-2 text-xs text-text-muted"><HaloDot tone="accent" />Waiting for node receipt…</span> : null}
      {feedback ? <span role="status" className="text-xs text-success">{feedback}</span> : null}
      {error ? <span role="alert" className="text-xs text-danger">{error}</span> : null}
      <ActionConfirm open={!!confirming} title={confirming === 'service-stop' ? 'Stop this profile?' : 'Restart this profile?'} message={`${confirming === 'service-stop' ? 'Stop' : 'Restart'} ${profileId} on this node? Work it is doing now is interrupted.`} confirmLabel={confirming === 'service-stop' ? 'Stop' : 'Restart'} onConfirm={() => { if (confirming) void act(confirming); }} onCancel={() => setConfirming(null)} />
    </div>
  );
}

export default function ArdentInstallationsPage() {
  const inventory = useMagnusResource((signal) => listInstallations(signal));
  const items = inventory.data;
  const detected = items?.filter((item) => item.installed && item.reachable).length ?? 0;
  return (
    <div className="page-stack">
      <PageItem>
        <PageHeader
          eyebrow="Magnus Ardent"
          title="Installations"
          description={items ? `${detected} installed · ${items.length} managed nodes` : 'Checking managed nodes…'}
          actions={<Button size="sm" icon={<RefreshCw className="size-4" />} loading={inventory.refreshing} onClick={() => void inventory.refresh()}>Refresh</Button>}
        />
      </PageItem>
      {!items ? (
        <PageItem>
          <FxPanel interactive={false}>{inventory.loading ? <LoadingRows rows={6} /> : <ResourceError error={inventory.error} title="Ardent inventory is unavailable" onRetry={() => void inventory.refresh()} />}</FxPanel>
        </PageItem>
      ) : items.length === 0 ? (
        <PageItem><FxPanel interactive={false}><EmptyState icon={<Server className="size-5" />} title="No managed nodes" message="There are no managed nodes to inspect yet." /></FxPanel></PageItem>
      ) : (
        <PageItem>
          <div className="grid gap-3">
            {inventory.error ? <p role="alert" className="m-0 text-sm text-warning">Showing the last good inventory: {errorMessage(inventory.error)}</p> : null}
            {items.map((item) => (
              <FxPanel key={item.nodeId} padding="sm" fxTone={item.reachable ? 'accent' : 'danger'}>
                <div className="grid gap-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <Server className="mt-0.5 size-4 shrink-0 text-accent" />
                      <div className="min-w-0"><p className="m-0 text-base font-semibold">{item.nodeName}</p><p className="m-0 mt-1 break-all font-mono text-xs text-text-muted">{item.hostname}</p></div>
                    </div>
                    <Badge tone={!item.reachable ? 'danger' : item.installed ? 'success' : 'neutral'} dot>{!item.reachable ? 'Check failed' : item.installed ? 'Installed' : 'Not installed'}</Badge>
                  </div>
                  {item.error ? <p className="m-0 rounded-control border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">{item.error}</p> : null}
                  <CommandOwners installation={item} onSettled={inventory.refresh} />
                  <div className="grid gap-3 border-t border-border pt-3 sm:grid-cols-3">
                    <Fact label="Version"><span className="font-mono">{item.version ?? '—'}</span></Fact>
                    <Fact label="Owner"><span className="font-mono">{item.owner || 'Unavailable'}</span></Fact>
                    <Fact label="Profiles"><span className="num">{item.profiles.length}</span></Fact>
                  </div>
                  <PackageControls item={item} refresh={inventory.refresh} />
                  {item.profiles.map((profile) => (
                    <div key={profile.id} className="rounded-control border border-border bg-surface-sunken p-3">
                      <Link href={profileHref(item.nodeId, profile.id)} className="inline-flex items-center gap-2 text-sm font-semibold"><StatusDot status={profile.running ? 'RUNNING' : 'STOPPED'} />{profile.name}<ArrowUpRight className="size-4" /></Link>
                      <ServiceControls nodeId={item.nodeId} profileId={profile.id} running={profile.running} refresh={inventory.refresh} />
                    </div>
                  ))}
                </div>
              </FxPanel>
            ))}
          </div>
        </PageItem>
      )}
    </div>
  );
}
