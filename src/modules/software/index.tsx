// Installed software: the signed release's pins beside what the hosts report. Docker hosts report
// through the Hive Registry (the controller records each host's containers after doctor, status
// and upgrades); Magnus reports its own version and how npm resolved its dependencies, which is
// where a native npm install can differ from the signed build even at the same version.
import { useEffect, useMemo, useState } from 'react';
import { PackageCheck, RefreshCw } from 'lucide-react';
import { Badge, Button, DataTable, EmptyState, LoadingRows, PageHeader, Panel, ResourceError, type DataTableColumn, type Tone } from '@ui';
import type { RegistryInventory } from '@contracts/hive-registry/inventory';
import { HiveApiError } from '../../lib/api-error';
import { formatTime, relativeTime } from '../../lib/format';
import { isAdministrator } from '../../lib/permissions';
import type { ScreenProps } from '../../lib/routes';
import { productInstalled } from '../../lib/runtime';
import { readAgentNodes, readInventory, readMagnusInstallation } from './api';
import { useInventoryAvailable } from './availability';
import {
  attentionCount,
  compareComponents,
  compareMagnus,
  compareRelease,
  shortDigest,
  summarizeAgents,
  type AgentNode,
  type ComponentRow,
  type MagnusRow,
  type ReleaseRow,
  type Verdict,
} from './compare';
import type { SystemInstallation as MagnusInstallation } from '@contracts/magnus/browser';

type Read<T> = { state: 'loading' } | { state: 'ready'; value: T } | { state: 'failed'; error: unknown } | { state: 'absent' };

export interface SoftwareSources {
  inventory: (signal: AbortSignal) => Promise<RegistryInventory>;
  magnus: ((signal: AbortSignal) => Promise<MagnusInstallation>) | null;
  agents: ((signal: AbortSignal) => Promise<AgentNode[]>) | null;
}
const liveSources = (): SoftwareSources => {
  const withMagnus = productInstalled('magnus');
  return { inventory: readInventory, magnus: withMagnus ? readMagnusInstallation : null, agents: withMagnus ? readAgentNodes : null };
};

export default function SoftwareScreen({ currentUser }: Pick<ScreenProps, 'currentUser'>) {
  const admin = isAdministrator(currentUser);
  const available = useInventoryAvailable(admin);
  const sources = useMemo(() => (available ? liveSources() : null), [available]);
  const header = <PageHeader eyebrow="Hive · installation" title="Installed software" icon={<PackageCheck />} />;
  if (!admin)
    return (
      <>
        {header}
        <Panel title="Access unavailable">
          <p>Only administrators see what the hosts run.</p>
        </Panel>
      </>
    );
  if (available === null) return <>{header}<Panel title="Checking the Hive Registry"><LoadingRows rows={2} /></Panel></>;
  if (!sources)
    return (
      <>
        {header}
        <Panel title="Installed software is not available here">
          <p>This installation's Hive Registry does not serve the installed software inventory, or this console has no suite sign-in. Upgrade the installation to a release with Hive Registry 1.4.0 or later, then run <code>./hive.sh console-clients add</code>.</p>
        </Panel>
      </>
    );
  return <SoftwarePage sources={sources} />;
}

function useRead<T>(load: ((signal: AbortSignal) => Promise<T>) | null, round: number): Read<T> {
  const [read, setRead] = useState<Read<T>>(load ? { state: 'loading' } : { state: 'absent' });
  useEffect(() => {
    if (!load) return setRead({ state: 'absent' });
    const controller = new AbortController();
    setRead((current) => (current.state === 'ready' ? current : { state: 'loading' }));
    load(controller.signal).then(
      (value) => { if (!controller.signal.aborted) setRead({ state: 'ready', value }); },
      (error: unknown) => { if (!controller.signal.aborted) setRead({ state: 'failed', error }); },
    );
    return () => controller.abort();
  }, [load, round]);
  return read;
}

const VERDICT: Record<Verdict, { label: string; tone: Tone }> = {
  matches: { label: 'Matches', tone: 'success' },
  differs: { label: 'Differs', tone: 'danger' },
  'not-running': { label: 'Not running', tone: 'warning' },
  'not-reported': { label: 'Not reported', tone: 'neutral' },
  external: { label: 'External', tone: 'info' },
  unpinned: { label: 'Not pinned', tone: 'neutral' },
};
const verdictBadge = (verdict: Verdict) => <Badge tone={VERDICT[verdict].tone} dot>{VERDICT[verdict].label}</Badge>;

function Digest({ value }: { value: string | null | undefined }) {
  return value ? <code className="font-mono text-xs" title={value}>{shortDigest(value)}</code> : <span className="text-text-muted">—</span>;
}

export function SoftwarePage({ sources }: { sources: SoftwareSources }) {
  const [round, setRound] = useState(0);
  const inventory = useRead(sources.inventory, round);
  const report = useRead(sources.magnus, round);
  const agents = useRead(sources.agents, round);
  const rows = inventory.state === 'ready' ? compareComponents(inventory.value) : [];
  const releases = inventory.state === 'ready' ? compareRelease(inventory.value) : [];
  const magnusPin = inventory.state === 'ready' ? inventory.value.components.find((component) => component.id === 'magnus')?.pinned?.version ?? null : null;
  const magnusRow = report.state === 'ready' ? compareMagnus(report.value, magnusPin) : null;
  const attention = attentionCount(rows) + attentionCount(releases)
    + (magnusRow ? Number(magnusRow.versionVerdict === 'differs') + Number(magnusRow.resolutionVerdict === 'differs') : 0);
  const status = inventory.state !== 'ready'
    ? <Badge tone="neutral" dot>{inventory.state === 'failed' ? 'Unavailable' : 'Checking'}</Badge>
    : attention
      ? <Badge tone="danger" dot>{attention === 1 ? '1 difference' : `${attention} differences`}</Badge>
      : <Badge tone="success" dot>Matches the signed release</Badge>;
  return (
    <>
      <PageHeader
        eyebrow="Hive · installation"
        title="Installed software"
        icon={<PackageCheck />}
        status={status}
        description="The signed release's pins beside what each host last reported, and how Magnus's npm install resolved its dependencies."
        actions={<Button onClick={() => setRound((value) => value + 1)}><RefreshCw className="size-4" aria-hidden="true" />Read again</Button>}
      />
      {inventory.state === 'loading' ? <Panel title="Signed release"><LoadingRows /></Panel> : null}
      {inventory.state === 'failed' ? (
        <Panel title="Signed release">
          <ResourceError error={inventory.error} title="The installed software inventory could not be read" onRetry={() => setRound((value) => value + 1)} />
        </Panel>
      ) : null}
      {inventory.state === 'ready' ? (
        <>
          <ReleasePanel inventory={inventory.value} rows={releases} />
          <ComponentsPanel rows={rows} />
        </>
      ) : null}
      {sources.magnus ? <MagnusPanel report={report} row={magnusRow} agents={agents} pinnedVersion={magnusPin ?? (report.state === 'ready' ? report.value.magnus.version : null)} /> : null}
    </>
  );
}

function ReleasePanel({ inventory, rows }: { inventory: RegistryInventory; rows: ReleaseRow[] }) {
  const columns: DataTableColumn<ReleaseRow>[] = [
    { key: 'host', header: 'Host', cell: (row) => <code className="font-mono">{row.host}</code> },
    { key: 'version', header: 'Activated release', cell: (row) => row.version ?? '—' },
    { key: 'status', header: 'Status', cell: (row) => verdictBadge(row.verdict) },
  ];
  return (
    <Panel title="Signed release" eyebrow="Hive Registry">
      {inventory.phase === 'activating' ? <p role="status" className="warning-banner">A lifecycle command is activating a release now, so hosts may report a mix of old and new images until it finishes.</p> : null}
      {inventory.release ? (
        <dl className="grid gap-1 sm:grid-cols-[max-content_1fr] sm:gap-x-6">
          <dt className="stat-label">Release</dt>
          <dd className="font-medium">{inventory.release.version}</dd>
          <dt className="stat-label">Manifest SHA-256</dt>
          <dd><code className="font-mono text-xs [overflow-wrap:anywhere]">{inventory.release.manifestDigest}</code></dd>
          <dt className="stat-label">Hosts last reported</dt>
          <dd>{inventory.observedAt ? <time dateTime={inventory.observedAt} title={formatTime(inventory.observedAt)}>{relativeTime(inventory.observedAt)}</time> : 'Not yet'}</dd>
        </dl>
      ) : (
        <p>The Hive Registry records no signed release for this installation.</p>
      )}
      <DataTable
        label="Release each host activated"
        columns={columns}
        rows={rows}
        rowKey={(row) => row.host}
        empty="No host has reported yet. Run ./hive.sh doctor to record what each host runs."
      />
    </Panel>
  );
}

function ComponentsPanel({ rows }: { rows: ComponentRow[] }) {
  const columns: DataTableColumn<ComponentRow>[] = [
    { key: 'component', header: 'Component', cell: (row) => <span className="grid whitespace-nowrap"><span className="font-medium">{row.name}</span><span className="text-xs text-text-muted">{row.kind}</span></span> },
    { key: 'pin', header: 'Signed pin', cell: (row) => row.pinned ? <span className="grid whitespace-nowrap"><span>{row.pinned.version ?? '—'}</span><Digest value={row.pinned.imageDigest} /></span> : <span className="text-text-muted">—</span> },
    {
      key: 'reported', header: 'Host reports', cell: (row) => row.reported ? (
        <span className="grid whitespace-nowrap">
          <span><code className="font-mono">{row.reported.host}</code> · {row.reported.service.state}{row.reported.service.health ? `, ${row.reported.service.health}` : ''}</span>
          <Digest value={row.reported.runningDigest} />
        </span>
      ) : <span className="text-text-muted">—</span>,
    },
    { key: 'status', header: 'Status', cell: (row) => <span className="grid min-w-56 justify-items-start gap-1">{verdictBadge(row.verdict)}{row.reason ? <span className="text-xs text-text-muted">{row.reason}</span> : null}</span> },
  ];
  return (
    <Panel title="Components" eyebrow="Pinned and running images" description="A digest that differs means the host runs a different image than the signed release names, whatever its version label says.">
      <DataTable label="Components: signed pin and what the host reports" columns={columns} rows={rows} rowKey={(row) => row.id} empty="The inventory lists no components." />
    </Panel>
  );
}

function MagnusPanel({ report, row, agents, pinnedVersion }: { report: Read<MagnusInstallation>; row: MagnusRow | null; agents: Read<AgentNode[]>; pinnedVersion: string | null }) {
  return (
    <Panel title="Magnus" eyebrow="Server and host agents" description="Magnus reports its own install. A native npm install resolves dependency ranges itself, so it can differ from the lock the signed image was built from.">
      {report.state === 'loading' ? <LoadingRows rows={3} /> : null}
      {report.state === 'failed' ? <MagnusFailure error={report.error} /> : null}
      {row ? <MagnusServer row={row} /> : null}
      <AgentsSummary agents={agents} pinnedVersion={pinnedVersion} />
    </Panel>
  );
}

function MagnusFailure({ error }: { error: unknown }) {
  if (error instanceof HiveApiError && error.status === 404)
    return <p role="status" className="warning-banner">This Magnus does not report its installation. Magnus releases after 3.1.5 do.</p>;
  if (error instanceof HiveApiError && error.status === 403)
    return <p role="status" className="warning-banner">Reading the Magnus installation report needs the Magnus administrator role.</p>;
  return <ResourceError error={error} title="The Magnus installation report could not be read" />;
}

const LAYOUT = { package: 'npm package (native install)', workspace: 'Image or source checkout' } as const;

function MagnusServer({ row }: { row: MagnusRow }) {
  const differences = row.resolution.differences;
  return (
    <div className="grid gap-4">
      <dl className="grid gap-1 sm:grid-cols-[max-content_1fr] sm:gap-x-6">
        <dt className="stat-label">Signed pin</dt>
        <dd>{row.pinnedVersion ?? 'Not pinned by this installation'}</dd>
        <dt className="stat-label">Running</dt>
        <dd className="flex flex-wrap items-center gap-2">{row.version}{row.versionVerdict === 'unpinned' ? null : verdictBadge(row.versionVerdict)}</dd>
        <dt className="stat-label">Install</dt>
        <dd>{LAYOUT[row.layout]}</dd>
        <dt className="stat-label">Node.js</dt>
        <dd>{row.node}</dd>
        <dt className="stat-label">Dependency resolution</dt>
        <dd className="flex flex-wrap items-center gap-2">
          {row.resolutionVerdict === 'unchecked'
            ? <span className="text-text-muted">This Magnus package ships no lock to compare against.</span>
            : <>{verdictBadge(row.resolutionVerdict)}<span className="text-sm text-text-muted">{row.resolution.checked} packages checked against the signed lock, {relativeTime(row.resolution.checkedAt)}</span></>}
        </dd>
      </dl>
      {differences.length ? (
        <>
          <p role="status" className="warning-banner">
            npm resolved {differences.length === 1 ? 'one package' : `${differences.length} packages`} differently from the lock the signed build used{row.resolution.truncated ? ' (only the first 200 are listed)' : ''}. Reinstall from the release's lock, or apply the release's overrides, before relying on the build's security fixes.
          </p>
          <DataTable
            label="Magnus dependencies that differ from the signed lock"
            columns={[
              { key: 'name', header: 'Package', cell: (difference) => <code className="font-mono">{difference.name}</code> },
              { key: 'path', header: 'Where', cell: (difference) => <code className="font-mono text-xs [overflow-wrap:anywhere]">{difference.path}</code> },
              { key: 'expected', header: 'Signed lock', cell: (difference) => difference.expected },
              { key: 'actual', header: 'Installed', cell: (difference) => difference.actual ?? <span className="text-text-muted">Missing</span> },
            ]}
            rows={differences}
            rowKey={(difference) => difference.path}
          />
        </>
      ) : null}
    </div>
  );
}

function AgentsSummary({ agents, pinnedVersion }: { agents: Read<AgentNode[]>; pinnedVersion: string | null }) {
  if (agents.state === 'absent') return null;
  if (agents.state === 'loading') return <LoadingRows rows={2} />;
  if (agents.state === 'failed') return <ResourceError error={agents.error} title="The Magnus nodes could not be read" />;
  const summary = summarizeAgents(agents.value, pinnedVersion);
  if (!agents.value.length) return <EmptyState compact title="No Magnus nodes are enrolled" />;
  return (
    <div className="grid gap-2">
      <h4 className="font-medium">Host agents</h4>
      <p className="flex flex-wrap items-center gap-2">
        {summary.offPin.length ? verdictBadge('differs') : verdictBadge('matches')}
        <span>{summary.onPin} of {agents.value.length} nodes run the pinned agent{pinnedVersion ? ` ${pinnedVersion}` : ''}.</span>
      </p>
      {summary.offPin.length ? (
        <DataTable
          label="Nodes whose agent is not on the pinned version"
          columns={[
            { key: 'name', header: 'Node', cell: (node) => node.name },
            { key: 'version', header: 'Agent', cell: (node) => node.version ?? <span className="text-text-muted">Not reporting</span> },
          ]}
          rows={summary.offPin}
          rowKey={(node) => node.name}
        />
      ) : null}
      <p className="text-xs text-text-muted">Agents report their version only; the package integrity they verified at install is not reported yet.</p>
    </div>
  );
}
