import { useEffect, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, ArrowUpCircle, Loader2, Pencil, Plus, Power, RefreshCcwDot, RefreshCw, Server, ShieldCheck, Trash2 } from 'lucide-react';
import { deleteNodeResponseSchema, systemUpdatesSummaryResponseSchema, tailscaleSummaryResponseSchema } from '@contracts/magnus/browser';
import { Badge, Button, ConfirmDialog, EmptyState, IconButton, PageHeader, StatusDot, statusTone, TableFrame } from '@ui';
import { relativeTime } from '@lib/format';
import { cn } from '@lib/cn';
import { useToast } from '../../../../../components/toast';
import { magnus, segment } from '../../../api/client';
import { errorMessage } from '../../../api/errors';
import { useMagnusResource } from '../../../api/use-resource';
import { FxMeter, FxPanel, PageItem } from '../../../effects';
import Link, { useRouter, useSearchParams } from '../../../navigation';
import { hasRoute } from '../../../routes';
import { ADMIN_ONLY, useMagnusSession, WRITE_ROLES } from '../../../session';
import { LoadingRows, ResourceError } from '../../../ui/resource-state';
import { TailscaleExpiryAlert } from '../shared/tailscale-alert';
import { AgentUpgradeDrawer } from './agent-upgrade';
import { AssignRoleDrawer, EditNodeDrawer, RegisterNodeDrawer } from './node-actions';
import { diskSeverity, listAllNodes, nodeError, worstPersistentDisk, type NodeRow } from './nodes-api';

const TRANSIENT_POLL_MS = 5000;

export default function NodesPage() {
  const toast = useToast();
  const { can } = useMagnusSession();
  const canWrite = can(WRITE_ROLES);
  const canDelete = can(ADMIN_ONLY);
  const [transient, setTransient] = useState(false);
  const nodes = useMagnusResource((signal) => listAllNodes(signal), [], { pollMs: transient ? TRANSIENT_POLL_MS : undefined });
  const rows = nodes.data?.nodes;
  useEffect(() => setTransient(!!rows?.some((node) => node.status === 'PROVISIONING' || node.agent?.status === 'UPDATING')), [rows]);
  const updates = useMagnusResource((signal) => magnus.get('/nodes/system-updates/summary', systemUpdatesSummaryResponseSchema, { signal }));
  const tailscale = useMagnusResource((signal) => magnus.get('/nodes/tailscale/summary', tailscaleSummaryResponseSchema, { signal }));
  const router = useRouter();
  // The update banner links here with ?upgrade=agents. Closing clears it, so the same link opens it again.
  const upgradeLinked = useSearchParams().get('upgrade') === 'agents';
  const [upgradeOpen, setUpgradeOpen] = useState(upgradeLinked);
  useEffect(() => {
    if (upgradeLinked) setUpgradeOpen(true);
  }, [upgradeLinked]);
  const closeUpgrade = () => {
    setUpgradeOpen(false);
    if (upgradeLinked) router.replace('/nodes');
  };
  const [registerOpen, setRegisterOpen] = useState(false);
  const [editing, setEditing] = useState<NodeRow | null>(null);
  const [assigning, setAssigning] = useState<NodeRow | null>(null);
  const [deleting, setDeleting] = useState<NodeRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const refreshAll = () => {
    void nodes.refresh();
    void updates.refresh();
    void tailscale.refresh();
  };
  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await magnus.delete(`/nodes/${segment(deleting.id)}`, deleteNodeResponseSchema);
      toast.success(`${deleting.name} deleted`);
      setDeleting(null);
      refreshAll();
    } catch (error) {
      toast.error('The node could not be deleted', errorMessage(error));
    } finally {
      setDeleteBusy(false);
    }
  }
  const summary = updates.data?.data;
  const updatesById = new Map(summary?.nodes.map((node) => [node.id, node.systemUpdates]));
  const tailscaleById = new Map(tailscale.data?.data.nodes.map((node) => [node.id, node.tailscale]));
  const list = rows ?? [];
  return (
    <div className="page-stack">
      <PageItem>
        <PageHeader
          title="Nodes"
          eyebrow="Fleet"
          description="Manage your Magnus fleet nodes"
          status={list.length > 0 ? (
            <span className="flex items-center gap-3 text-xs text-text-muted">
              <span className="flex items-center gap-1.5"><StatusDot status="ONLINE" /><span className="num">{list.filter((node) => node.status === 'ONLINE').length}</span> online</span>
              <span className="flex items-center gap-1.5"><StatusDot status="OFFLINE" pulse={false} /><span className="num">{list.filter((node) => node.status === 'OFFLINE').length}</span> offline</span>
            </span>
          ) : undefined}
          actions={
            <>
              <Button size="sm" icon={<RefreshCw className="size-4" />} loading={nodes.refreshing} onClick={refreshAll}>Refresh</Button>
              <Button size="sm" icon={<ArrowUpCircle className="size-4" />} onClick={() => setUpgradeOpen(true)}>Upgrade agents</Button>
              {canWrite ? <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setRegisterOpen(true)}>Register node</Button> : null}
            </>
          }
        />
      </PageItem>
      {tailscale.data ? <PageItem><TailscaleExpiryAlert summary={tailscale.data.data} showAction={false} /></PageItem> : null}
      {summary ? (
        <PageItem>
          <FxPanel padding="sm" aria-label="System update readiness">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="col-span-2 flex items-center gap-3 sm:col-span-1">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-panel border border-accent bg-accent-soft text-accent"><RefreshCcwDot className="size-4" /></span>
                <div className="min-w-0 flex-1">
                  <p className="m-0 text-xs font-medium text-text-muted">Auto-update coverage</p>
                  <p className="num m-0 mt-0.5 text-sm font-semibold">{summary.enabled} / {summary.reporting} enabled</p>
                  <FxMeter className="mt-1.5" value={summary.reporting > 0 ? (summary.enabled / summary.reporting) * 100 : null} tone={summary.reporting === 0 ? 'neutral' : summary.enabled === summary.reporting ? 'success' : 'warning'} label="Auto-update coverage" />
                </div>
              </div>
              <Figure label="Action needed" value={summary.actionNeeded} tone={summary.actionNeeded ? 'warning' : 'success'} />
              <Figure label="Reboot debt" value={summary.rebootRequired} tone={summary.rebootRequired ? 'danger' : 'success'} icon={summary.rebootRequired ? <Power className="size-4" /> : undefined} />
              <Figure label="Reporting" value={`${summary.reporting} / ${summary.total}`} />
            </div>
          </FxPanel>
        </PageItem>
      ) : null}
      <PageItem>
        <FxPanel padding={rows && rows.length > 0 ? 'none' : 'md'} interactive={false}>
          {!rows ? (
            nodes.loading ? <LoadingRows rows={6} /> : <ResourceError error={nodes.error} title="Nodes could not be loaded" onRetry={() => void nodes.refresh()} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<Server className="size-5" />}
              title="No nodes registered"
              message="Register your first Magnus node to get started."
              {...(canWrite ? { action: <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setRegisterOpen(true)}>Register node</Button> } : {})}
            />
          ) : (
            <>
              {nodes.error ? <p role="alert" className="m-3 text-sm text-warning">Showing the last good list: {errorMessage(nodes.error)}</p> : null}
              <TableFrame label="Fleet nodes" className="max-h-[70vh]">
                <table>
                  <thead>
                    <tr>
                      {['Name', 'Host', 'Address', 'Status', 'Agent', 'Role', 'CPU', 'Memory', 'Persistent disk', 'Updates', 'Tailscale key', 'Last heartbeat'].map((heading) => <th key={heading}>{heading}</th>)}
                      {canWrite || canDelete ? <th><span className="sr-only">Actions</span></th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((node) => (
                      <NodeTableRow
                        key={node.id}
                        node={node}
                        health={node.health}
                        updates={updatesById.get(node.id) ?? null}
                        tailscale={tailscaleById.get(node.id) ?? null}
                        canWrite={canWrite}
                        canDelete={canDelete}
                        onEdit={setEditing}
                        onAssign={setAssigning}
                        onDelete={setDeleting}
                      />
                    ))}
                  </tbody>
                </table>
              </TableFrame>
            </>
          )}
        </FxPanel>
      </PageItem>
      <AgentUpgradeDrawer open={upgradeOpen} onClose={closeUpgrade} onFinished={refreshAll} />
      <RegisterNodeDrawer open={registerOpen} onClose={() => setRegisterOpen(false)} onRegistered={refreshAll} />
      <EditNodeDrawer node={editing} onClose={() => setEditing(null)} onSaved={refreshAll} />
      <AssignRoleDrawer node={assigning} onClose={() => setAssigning(null)} onSaved={refreshAll} />
      <ConfirmDialog
        open={!!deleting}
        title="Delete node"
        message={deleting ? `Delete "${deleting.name}"? This permanently removes it and all associated data.` : ''}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleting(null)}
        loading={deleteBusy}
      />
    </div>
  );
}

function Figure({ label, value, tone, icon }: { label: string; value: number | string; tone?: 'success' | 'warning' | 'danger'; icon?: React.ReactNode }) {
  const color = tone === 'danger' ? 'glow-text-danger text-danger' : tone === 'warning' ? 'glow-text-warning text-warning' : tone === 'success' ? 'text-success' : '';
  return (
    <div>
      <p className="m-0 text-xs font-medium text-text-muted">{label}</p>
      <p className={cn('num m-0 mt-1 flex items-center gap-1.5 text-lg font-bold', color)}>{icon}{value}</p>
    </div>
  );
}

type Updates = { automaticUpdates: string; rebootRequired: boolean } | null;
type Tailscale = { keyExpiry: string | null; expiryEnabled: boolean; expired: boolean; daysRemaining: number | null; requiresRenewal: boolean } | null;

function UpdatesBadge({ updates }: { updates: Updates }) {
  if (!updates) return <Badge>awaiting agent</Badge>;
  if (updates.rebootRequired) return <Badge tone="danger">reboot required</Badge>;
  if (updates.automaticUpdates === 'enabled') return <Badge tone="success">automatic</Badge>;
  if (updates.automaticUpdates === 'unsupported') return <Badge>unsupported</Badge>;
  return <Badge tone="warning">enable updates</Badge>;
}
function TailscaleBadge({ tailscale }: { tailscale: Tailscale }) {
  if (!tailscale) return <Badge>awaiting agent</Badge>;
  if (!tailscale.expiryEnabled) return <Badge tone="success">no expiry</Badge>;
  if (tailscale.expired) return <Badge tone="danger">expired</Badge>;
  if (tailscale.daysRemaining === null) return <Badge>unknown</Badge>;
  return <Badge tone={tailscale.requiresRenewal ? 'warning' : 'success'}>{tailscale.daysRemaining}d</Badge>;
}

function NodeTableRow({ node, health, updates, tailscale, canWrite, canDelete, onEdit, onAssign, onDelete }: {
  node: NodeRow;
  health: NodeRow['health'];
  updates: Updates;
  tailscale: Tailscale;
  canWrite: boolean;
  canDelete: boolean;
  onEdit: (node: NodeRow) => void;
  onAssign: (node: NodeRow) => void;
  onDelete: (node: NodeRow) => void;
}) {
  const failure = node.status === 'DEGRADED' || node.agent?.status === 'ERROR' ? nodeError(node.metadata) : null;
  const disk = worstPersistentDisk(health?.disks);
  const severity = disk ? diskSeverity(disk.usagePercent) : null;
  const blocked = node.upgradeReadiness?.status === 'not-ready' ? node.upgradeReadiness.problems : null;
  // The web terminal comes later, through its own gateway, so this row offers no terminal control.
  return (
    <tr className="fx-rail">
      <td>
        <div className="flex items-center gap-2 whitespace-nowrap">
          <StatusDot status={node.status} />
          {hasRoute(`/nodes/${node.id}`) ? <Link href={`/nodes/${segment(node.id)}`} className="font-medium">{node.name}</Link> : <span className="font-medium">{node.name}</span>}
        </div>
      </td>
      <td className="whitespace-nowrap text-text-muted">{node.hostname}</td>
      <td className="num whitespace-nowrap text-text-muted">{node.ipAddress}:{node.port}</td>
      <td>
        <div className="flex items-center gap-1.5">
          <Badge tone={statusTone(node.status)}>{node.status}</Badge>
          {failure ? <span title={`${failure.label}: ${failure.message}`} className="inline-flex"><AlertCircle aria-label={failure.label} className="size-4 cursor-help text-danger" /></span> : null}
          {node.status === 'PROVISIONING' ? <Loader2 aria-hidden="true" className="size-4 animate-spin text-info" /> : null}
          {blocked ? <span title={blocked.map((problem) => `${problem.code}: ${problem.detail}. ${problem.remedy}`).join('\n')}><Badge tone="warning"><AlertTriangle aria-hidden="true" className="mr-1 inline size-3" />Upgrade blocked ({blocked.length})</Badge></span> : null}
        </div>
      </td>
      <td className="whitespace-nowrap text-text-muted">
        {node.agent ? `v${node.agent.version}` : '—'}
        {node.agent?.status === 'UPDATING' ? <Loader2 aria-hidden="true" className="ml-1.5 inline size-3 animate-spin text-info" /> : null}
      </td>
      <td>
        {canWrite ? (
          <button type="button" className="role-chip role-chip--button whitespace-nowrap" title={node.role ? 'Change role' : 'Assign a role'} onClick={() => onAssign(node)}>
            {node.role ? <><ShieldCheck aria-hidden="true" className="mr-1 inline size-3" />{node.role.name}</> : 'Assign'}
          </button>
        ) : node.role ? <span className="role-chip whitespace-nowrap">{node.role.name}</span> : <span className="text-text-muted">—</span>}
      </td>
      <td className="text-text-muted">{health ? <FxMeter value={health.cpuUsagePercent} label={`${node.name} CPU`} valueLabel={`${health.cpuUsagePercent.toFixed(1)}%`} className="w-28" /> : '—'}</td>
      <td className="text-text-muted">
        {health ? (
          <div className="w-36">
            <FxMeter value={health.memoryPercent} label={`${node.name} memory`} />
            <span className="num mt-0.5 block text-xs text-text-muted">{(health.memoryUsedBytes / 1024 ** 3).toFixed(1)} / {(health.memoryTotalBytes / 1024 ** 3).toFixed(1)} GB</span>
          </div>
        ) : '—'}
      </td>
      <td>
        {disk ? (
          <span className="flex w-36 flex-col gap-0.5" title={`${disk.mountPoint} filesystem is ${disk.usagePercent}% used${severity === 'normal' ? '' : ', a disk usage anomaly'}`}>
            <FxMeter value={disk.usagePercent} tone={severity === 'critical' ? 'danger' : severity === 'warning' ? 'warning' : 'success'} label={`${node.name} ${disk.mountPoint} disk`} valueLabel={`${disk.usagePercent.toFixed(0)}%`} glow={severity !== 'normal'} />
            <span className="flex items-center gap-1 text-xs text-text-muted">
              {severity !== 'normal' ? <AlertTriangle aria-label={`${severity} disk usage anomaly`} className={severity === 'critical' ? 'size-3 text-danger' : 'size-3 text-warning'} /> : null}
              {disk.mountPoint}
            </span>
          </span>
        ) : <span className="text-text-muted">—</span>}
      </td>
      <td><UpdatesBadge updates={updates} /></td>
      <td title={tailscale?.keyExpiry ? `Expires ${tailscale.keyExpiry}` : undefined}><TailscaleBadge tailscale={tailscale} /></td>
      <td className="num whitespace-nowrap text-text-muted">{relativeTime(node.lastHeartbeatAt)}</td>
      {canWrite || canDelete ? (
        <td>
          <div className="flex gap-1">
            {canWrite ? <IconButton label={`Edit ${node.name}`} icon={<Pencil className="size-4" />} onClick={() => onEdit(node)} /> : null}
            {canDelete ? <IconButton label={`Delete ${node.name}`} variant="danger" icon={<Trash2 className="size-4" />} onClick={() => onDelete(node)} /> : null}
          </div>
        </td>
      ) : null}
    </tr>
  );
}
