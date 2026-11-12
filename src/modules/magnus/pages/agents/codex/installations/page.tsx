import { RefreshCw, Server, ShieldCheck } from 'lucide-react';
import { Button, EmptyState, PageHeader, LoadingRows, ResourceError } from '@ui';
import { errorMessage } from '../../../../api/errors';
import { FxPanel, PageItem } from '../../../../effects';
import { CodexInstallationCard } from '../installation-card';
import type { CodexInstallation } from '../schemas';
import { useCodexFleet } from '../use-codex';

export default function CodexInstallationsPage() {
  const fleet = useCodexFleet();
  const items = fleet.data;
  const detected = items?.filter((item) => item.installed && item.reachable) ?? [];
  const authenticated = detected.filter((item) => item.auth.oauth).length;
  const replace = (updated: CodexInstallation) => fleet.setData((items ?? []).map((item) => (item.nodeId === updated.nodeId ? updated : item)));
  return (
    <div className="page-stack">
      <PageItem>
        <PageHeader
          eyebrow="Codex"
          title="Codex installations"
          description={items ? `${items.length} managed nodes · ${detected.length} Codex installations · ${authenticated} authenticated with ChatGPT OAuth` : 'Checking installations…'}
          actions={<Button size="sm" icon={<RefreshCw className="size-4" />} loading={fleet.refreshing} onClick={() => void fleet.refreshLatest()}>Refresh all</Button>}
        />
      </PageItem>
      <PageItem>
        <FxPanel padding="sm" hero interactive={false}>
          <p className="m-0 flex items-start gap-3 text-sm text-text-muted"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" />Magnus validates managed ChatGPT OAuth through Codex App Server without silently refreshing an expired access token. Expired credentials are logged out automatically; generating a device code starts only the ChatGPT subscription flow.</p>
        </FxPanel>
      </PageItem>
      {!items ? (
        <PageItem><FxPanel interactive={false}>{fleet.loading ? <LoadingRows rows={6} /> : <ResourceError error={fleet.error} title="Codex installations could not be loaded" onRetry={() => void fleet.refresh()} />}</FxPanel></PageItem>
      ) : detected.length === 0 ? (
        <PageItem><FxPanel interactive={false}><EmptyState icon={<Server className="size-5" />} title="No Codex installations" message={`None were detected across ${items.length} managed nodes.`} /></FxPanel></PageItem>
      ) : (
        <PageItem>
          {fleet.error ? <p role="alert" className="m-0 mb-3 text-sm text-warning">Showing the last good state: {errorMessage(fleet.error)}</p> : null}
          <div className="grid gap-4 xl:grid-cols-2">
            {detected.map((installation) => <CodexInstallationCard key={installation.nodeId} installation={installation} onChange={replace} />)}
          </div>
        </PageItem>
      )}
    </div>
  );
}
