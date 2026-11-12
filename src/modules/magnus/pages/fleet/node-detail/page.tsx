import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertCircle, ArrowLeft, ExternalLink, Loader2, Pencil, Server, ShieldCheck, TerminalSquare, Trash2 } from 'lucide-react';
import { deleteNodeResponseSchema, enableSystemUpdatesResponseSchema, hermesInstallationsResponseSchema, nodeDetailResponseSchema, nodeForecastResponseSchema, nodeGpuResponseSchema, nodeHealthResponseSchema, roleApplicationListResponseSchema } from '@contracts/magnus/browser';
import { Badge, Button, ConfirmDialog, EmptyState, PageHeader, Skeleton, StatusDot, statusTone, LoadingRows, ResourceError, buttonClass } from '@ui';
import { formatTime } from '@lib/format';
import { useToast } from '../../../../../components/toast';
import { magnus, segment } from '../../../api/client';
import { errorMessage, MagnusApiError } from '../../../api/errors';
import { useMagnusResource } from '../../../api/use-resource';
import { FxPanel, Gauge, PageItem } from '../../../effects';
import Link, { useParams, useRouter } from '../../../navigation';
import { ADMIN_ONLY, useMagnusSession, WRITE_ROLES } from '../../../session';
import { AssignRoleDrawer, EditNodeDrawer } from '../nodes/node-actions';
import { nodeError, parseDisks, parseTags } from '../nodes/nodes-api';
import type { AskRequest } from './ask';
import { AgentSelfUpgradeBadge, UpgradeReadinessBadge, UpgradeReadinessPanel } from './badges';
import { GpuTelemetryCard } from './gpu-card';
import { HermesCard, SkillsDrawer } from './hermes-card';
import { NodeMetricsChart } from './metrics-chart';
import { cockpitUrl, detectedSkills, findInstallation, formatBytes, parseServices, parseSystemUpdates, parseWazuh } from './node-data';
import { NodePersonalityCard } from './personality-card';
import { DiskCard, ForecastCard, Row, ServiceChecksCard, SystemUpdatesCard, WazuhCard } from './posture-cards';
import { QuickCommandBar } from './quick-commands';
import { RoleApplicationsCard } from './role-applications';
import { SoftwareCard } from './software-card';

/** xterm comes with this chunk, which loads when someone opens a terminal and not before. */
const TerminalPanel = lazy(() => import('./terminal/terminal-panel'));

const TRANSIENT_POLL_MS = 4000;
const LIVE_POLL_MS = 30_000;
const SLOW_POLL_MS = 5 * 60_000;

/** A node with no snapshot yet answers 404, which only means there is nothing to show. */
async function orNull<T>(read: Promise<T>): Promise<T | null> {
  try {
    return await read;
  } catch (error) {
    if (error instanceof MagnusApiError && error.notFound) return null;
    throw error;
  }
}

function Banner({ tone, children }: { tone: 'info' | 'danger'; children: ReactNode }) {
  const look = tone === 'danger' ? 'border-danger bg-danger-soft shadow-[inset_3px_0_0_var(--danger),0_0_20px_var(--glow-danger)]' : 'border-info bg-info-soft shadow-[inset_3px_0_0_var(--info)]';
  return <div className={`rounded-panel border p-4 ${look}`}>{children}</div>;
}

export default function NodeDetailPage() {
  const { nodeId = '' } = useParams<{ nodeId: string }>();
  const router = useRouter();
  const toast = useToast();
  const { can, hermes, terminal } = useMagnusSession();
  const canWrite = can(WRITE_ROLES);
  const canDelete = can(ADMIN_ONLY);
  const path = `/nodes/${segment(nodeId)}`;

  const [transient, setTransient] = useState(false);
  const pollMs = transient ? TRANSIENT_POLL_MS : LIVE_POLL_MS;
  const nodeResource = useMagnusResource((signal) => magnus.get(path, nodeDetailResponseSchema, { signal }), [path], { pollMs });
  const node = nodeResource.data?.data;
  useEffect(() => setTransient(node?.status === 'PROVISIONING' || node?.agent?.status === 'UPDATING'), [node?.status, node?.agent?.status]);
  // Only a node that has reported has a snapshot, and the API answers the others with 404.
  const healthResource = useMagnusResource((signal) => orNull(magnus.get(`${path}/health`, nodeHealthResponseSchema, { signal })), [path], { pollMs, enabled: Boolean(node?.lastHeartbeatAt) });
  const forecastResource = useMagnusResource((signal) => orNull(magnus.get(`/health/${segment(nodeId)}/forecast`, nodeForecastResponseSchema, { signal })), [nodeId], { pollMs: SLOW_POLL_MS });
  const gpuResource = useMagnusResource((signal) => orNull(magnus.get(`${path}/gpu`, nodeGpuResponseSchema, { signal })), [path], { pollMs: LIVE_POLL_MS });
  const applicationsResource = useMagnusResource((signal) => magnus.get('/roles/applications/list', roleApplicationListResponseSchema, { query: { nodeId }, signal }), [nodeId], { pollMs: LIVE_POLL_MS });
  const hermesResource = useMagnusResource((signal) => magnus.get('/hermes/installations', hermesInstallationsResponseSchema, { signal }), [], { enabled: hermes, pollMs: SLOW_POLL_MS });

  const [terminalOpen, setTerminalOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [pending, setPending] = useState<AskRequest | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [enabling, setEnabling] = useState(false);
  const [updatesError, setUpdatesError] = useState<string | null>(null);

  const health = healthResource.data?.data ?? null;
  const installation = useMemo(() => (node ? findInstallation(hermesResource.data?.data ?? [], node) : null), [hermesResource.data, node]);
  const skills = useMemo(() => (installation ? detectedSkills(installation) : []), [installation]);

  if (!node) {
    if (nodeResource.loading) {
      return (
        <div className="page-stack" aria-busy="true">
          <Skeleton className="h-56 w-full" />
          <LoadingRows rows={4} />
          <span className="sr-only">Loading node details…</span>
        </div>
      );
    }
    if (nodeResource.error instanceof MagnusApiError && nodeResource.error.notFound) {
      return (
        <EmptyState
          framed
          icon={<Server className="size-5" />}
          title={<span className="fx-glitch inline-block">Node not found</span>}
          message="It may have been decommissioned."
          action={<Link href="/nodes" className={buttonClass({ size: 'sm' })}>Back to nodes</Link>}
        />
      );
    }
    return <ResourceError error={nodeResource.error} title="This node could not be loaded" onRetry={() => void nodeResource.refresh()} />;
  }

  const refreshNode = () => {
    void nodeResource.refresh();
    void healthResource.refresh();
  };
  const online = node.status === 'ONLINE';
  const disks = parseDisks(health?.disks);
  const worstDisk = disks.reduce<(typeof disks)[number] | null>((worst, disk) => (!worst || disk.usagePercent > worst.usagePercent ? disk : worst), null);
  const failure = node.status === 'DEGRADED' || node.agent?.status === 'ERROR' ? nodeError(node.metadata) : null;
  const tags = parseTags(node.tags);
  const cockpit = health?.cockpitAvailable ? cockpitUrl(node.ipAddress) : null;
  const unread = [
    { name: 'Health', resource: healthResource },
    { name: 'Capacity forecast', resource: forecastResource },
    { name: 'GPU telemetry', resource: gpuResource },
    { name: 'Role applications', resource: applicationsResource },
    ...(hermes ? [{ name: 'Hermes Agent', resource: hermesResource }] : []),
  ].filter(({ resource }) => resource.error);
  const fxTone = online ? 'accent' : node.status === 'OFFLINE' ? 'danger' : 'warning';

  async function confirmDelete() {
    try {
      await magnus.delete(path, deleteNodeResponseSchema);
      toast.success(`${node?.name} deleted`);
      router.push('/nodes');
    } catch (error) {
      toast.error('The node could not be deleted', errorMessage(error));
    }
  }
  async function enableUpdates() {
    setEnabling(true);
    setUpdatesError(null);
    try {
      await magnus.post(`${path}/system-updates/enable`, enableSystemUpdatesResponseSchema);
      refreshNode();
    } catch (error) {
      setUpdatesError(errorMessage(error, 'Automatic updates could not be enabled'));
    } finally {
      setEnabling(false);
    }
  }
  async function runPending() {
    if (!pending) return;
    setConfirming(true);
    try {
      await pending.action();
    } finally {
      setConfirming(false);
      setPending(null);
    }
  }

  return (
    <div className="page-stack">
      <PageItem>
        <FxPanel hero fxTone={fxTone} interactive={false}>
          <div className="flex items-start gap-2">
            <Link href="/nodes" className={buttonClass({ variant: 'ghost', className: 'btn--icon' })} aria-label="Back to nodes" title="Back to nodes"><ArrowLeft aria-hidden="true" className="size-4" /></Link>
            <PageHeader
              className="min-w-0 flex-1"
              eyebrow="Node"
              title={<span className="glow-text-primary flex items-center gap-3 break-all text-accent"><StatusDot status={node.status} />{node.name}</span>}
              description={
                <span className="num flex flex-wrap gap-x-3 text-xs">
                  <span className="break-all">{node.hostname}:{node.port}</span>
                  {node.agent ? <span className="text-accent">agent v{node.agent.version}</span> : null}
                  {health?.source ? <span>source: {health.source}</span> : null}
                </span>
              }
              actions={
                <>
                  <Badge tone={statusTone(node.status)}>{node.status}</Badge>
                  {node.agent?.status === 'UPDATING' ? <Badge tone="info"><Loader2 aria-hidden="true" className="mr-1 inline size-3 animate-spin" />Upgrading…</Badge> : null}
                  <AgentSelfUpgradeBadge metadata={node.metadata} />
                  <UpgradeReadinessBadge readiness={node.upgradeReadiness} />
                  {terminal ? <Button size="sm" icon={<TerminalSquare className="size-4" />} onClick={() => setTerminalOpen(true)}>Terminal</Button> : null}
                  {canWrite ? <Button size="sm" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>Edit</Button> : null}
                  {canDelete ? (
                    <Button size="sm" variant="danger" icon={<Trash2 className="size-4" />} onClick={() => setPending({ title: 'Delete node', message: `Delete "${node.name}"? This permanently removes it and all associated data.`, label: 'Delete', action: confirmDelete })}>Delete</Button>
                  ) : null}
                </>
              }
            />
          </div>
          {node.upgradeReadiness?.status === 'not-ready' ? <div className="mt-4"><UpgradeReadinessPanel readiness={node.upgradeReadiness} /></div> : null}
          <div className="mt-6 grid gap-6 xl:grid-cols-[auto_minmax(0,1fr)]">
            <div className="flex flex-wrap justify-center gap-4 sm:justify-start">
              <Gauge value={health?.cpuUsagePercent ?? null} label="CPU usage" size={140} />
              <Gauge value={health?.memoryPercent ?? null} label="Memory" size={140} {...(health ? { sublabel: formatBytes(health.memoryUsedBytes) } : {})} />
              <Gauge value={worstDisk?.usagePercent ?? null} label="Disk" size={140} thresholds={{ warn: 80, crit: 90 }} {...(worstDisk ? { sublabel: worstDisk.mountPoint } : {})} />
            </div>
            <NodeMetricsChart nodeId={node.id} height={170} />
          </div>
        </FxPanel>
      </PageItem>

      {unread.length ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-warning">
          <span className="min-w-0">{unread.map(({ name }) => name).join(', ')} could not be read: {errorMessage(unread[0]!.resource.error)}</span>
          <Button size="sm" onClick={() => unread.forEach(({ resource }) => void resource.refresh())}>Retry</Button>
        </div>
      ) : null}
      {failure ? (
        <PageItem>
          <Banner tone="danger">
            <div className="flex items-start gap-3">
              <AlertCircle aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-danger" />
              <div className="min-w-0">
                <p className="m-0 text-sm font-medium text-danger">{failure.label}</p>
                <pre className="m-0 mt-1 font-mono text-xs break-words whitespace-pre-wrap text-text-muted">{failure.message}</pre>
              </div>
            </div>
          </Banner>
        </PageItem>
      ) : null}
      {node.status === 'PROVISIONING' ? <PageItem><Banner tone="info"><p className="m-0 flex items-center gap-3 text-sm text-info"><Loader2 aria-hidden="true" className="size-5 shrink-0 animate-spin" />Deploying agent… Status will update automatically.</p></Banner></PageItem> : null}
      {node.agent?.status === 'UPDATING' ? <PageItem><Banner tone="info"><p className="m-0 flex items-center gap-3 text-sm text-info"><Loader2 aria-hidden="true" className="size-5 shrink-0 animate-spin" />Agent upgrade in progress… Status will update automatically.</p></Banner></PageItem> : null}

      {canWrite ? <QuickCommandBar nodeId={node.id} nodeStatus={node.status} ask={setPending} /> : null}
      <PageItem><GpuTelemetryCard telemetry={gpuResource.data?.data ?? null} /></PageItem>
      <PageItem><NodePersonalityCard node={node} /></PageItem>

      <PageItem>
        <div className="grid grid-cols-1 gap-[var(--space-5)] lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="page-stack min-w-0">
            <FxPanel title="Node information">
              <dl className="m-0 grid gap-2 text-sm">
                <Row label="OS">{node.os}</Row>
                <Row label="Architecture">{node.arch}</Row>
                <Row label="Address"><span className="num">{node.ipAddress}:{node.port}</span></Row>
                <Row label="Tags">{tags.length ? tags.join(', ') : '—'}</Row>
                <Row label="Agent version">{node.agent?.version ?? '—'}</Row>
                <Row label="Role">
                  {canWrite ? (
                    <button type="button" className="role-chip role-chip--button" title={node.role ? 'Change role' : 'Assign a role'} onClick={() => setAssigning(true)}>
                      {node.role ? <><ShieldCheck aria-hidden="true" className="mr-1 inline size-3" />{node.role.name}</> : '+ Assign role'}
                    </button>
                  ) : node.role ? <span className="role-chip">{node.role.name}</span> : '—'}
                </Row>
                <Row label="Agent status">{node.agent?.status ?? '—'}</Row>
                <Row label="Last heartbeat"><span className="num">{formatTime(node.lastHeartbeatAt)}</span></Row>
                <Row label="Cockpit">
                  {cockpit ? <a href={cockpit} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1">Available<ExternalLink aria-hidden="true" className="size-3" /></a> : <span className="text-text-muted">Not available</span>}
                </Row>
                <Row label="CPU cores"><span className="num">{health?.cpuCores ?? '—'}</span></Row>
                <Row label="Memory used"><span className="num">{health ? `${formatBytes(health.memoryUsedBytes)} / ${formatBytes(health.memoryTotalBytes)}` : '—'}</span></Row>
                <Row label="Swap used"><span className="num">{health?.swapTotalBytes ? `${formatBytes(health.swapUsedBytes)} / ${formatBytes(health.swapTotalBytes)}` : '—'}</span></Row>
                <Row label="Last health sample"><span className="num">{formatTime(health?.timestamp)}</span></Row>
              </dl>
            </FxPanel>
            {hermes ? <HermesCard installation={installation} skills={skills} onShowSkills={() => setSkillsOpen(true)} /> : null}
            <ServiceChecksCard services={parseServices(health?.services)} />
          </div>
          <div className="page-stack min-w-0">
            <SystemUpdatesCard updates={parseSystemUpdates(health?.systemUpdates)} canEnable={canWrite} online={online} enabling={enabling} error={updatesError} onEnable={() => setPending({ title: 'Enable automatic updates', message: `Enable unattended apt update and apt upgrade on "${node.name}"? Magnus will install unattended-upgrades and enable the apt timers.`, label: 'Enable updates', action: enableUpdates })} />
            <WazuhCard wazuh={parseWazuh(health?.wazuh)} />
            <DiskCard disks={health?.disks} />
            <ForecastCard forecasts={forecastResource.data?.data.forecasts ?? []} />
            <SoftwareCard nodeId={node.id} nodeName={node.name} online={online} canRun={canWrite} ask={setPending} />
          </div>
        </div>
      </PageItem>
      {applicationsResource.data?.data.length ? <PageItem><RoleApplicationsCard applications={applicationsResource.data.data} /></PageItem> : null}

      {terminal && terminalOpen ? <Suspense fallback={null}><TerminalPanel key={node.id} nodeId={node.id} nodeName={node.name} onClose={() => setTerminalOpen(false)} /></Suspense> : null}
      <SkillsDrawer open={skillsOpen} nodeName={node.name} skills={skills} onClose={() => setSkillsOpen(false)} />
      <EditNodeDrawer node={editing ? node : null} onClose={() => setEditing(false)} onSaved={refreshNode} />
      <AssignRoleDrawer
        node={assigning ? node : null}
        onClose={() => setAssigning(false)}
        onSaved={() => {
          refreshNode();
          void applicationsResource.refresh();
        }}
      />
      <ConfirmDialog open={!!pending} title={pending?.title ?? ''} message={pending?.message ?? ''} confirmLabel={pending?.label ?? 'Confirm'} loading={confirming} onConfirm={() => void runPending()} onCancel={() => setPending(null)} />
    </div>
  );
}
