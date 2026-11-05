import { useEffect, useRef, useState } from 'react';
import { assignRoleResponseSchema, roleApplicationListResponseSchema, roleListResponseSchema, unassignRoleResponseSchema } from '@contracts/magnus/browser';
import { AlertCircle, CheckCircle2, ChevronRight, Clock, Container, FileText, KeyRound, Loader2, Package, Pencil, Play, Plus, RefreshCw, Server, Shield, ShieldCheck, SkipForward, Trash2, UserMinus, XCircle } from 'lucide-react';
import { Badge, Button, ConfirmDialog, EmptyState, PageHeader, statusTone, StatusDot, Toggle } from '@ui';
import { formatTime } from '@lib/format';
import { cn } from '@lib/cn';
import { useToast } from '../../../../../components/toast';
import { idempotencyKey, magnus, segment } from '../../../api/client';
import { errorMessage } from '../../../api/errors';
import { useMagnusResource } from '../../../api/use-resource';
import { FxPanel, PageItem } from '../../../effects';
import { ADMIN_ONLY, useMagnusSession, WRITE_ROLES } from '../../../session';
import { ActionConfirm } from '../../../ui/action-confirm';
import { LoadingRows, ResourceError } from '../../../ui/resource-state';
import { NodeChecklist } from '../shared/nodes';
import { applicationIsActive, parseSteps } from './logic';
import { RoleDrawer } from './role-drawer';
import { roleApplyResponseSchema, roleDeletedResponseSchema, roleDetailResponseSchema, type RoleDetail } from './schemas';

// The server allows each subject 30 /roles/* requests a minute, and each refresh here costs two.
const ACTIVE_POLL_MS = 10_000;
const IDLE_POLL_MS = 60_000;

function StepIcon({ status }: { status: string }) {
  switch (status) {
    case 'completed': return <CheckCircle2 className="size-4 text-success" />;
    case 'failed': return <XCircle className="size-4 text-danger" />;
    case 'running': return <Loader2 className="size-4 animate-spin text-accent" />;
    case 'skipped': return <SkipForward className="size-4 text-text-muted" />;
    default: return <Clock className="size-4 text-text-muted" />;
  }
}

function Features({ role }: { role: { aptPackages: readonly string[]; npmPackages: readonly string[]; libraryFileIds: readonly string[]; dockerEnabled: boolean; firewallEnabled: boolean } }) {
  return (
    <span className="flex flex-wrap gap-1">
      {role.aptPackages.length > 0 ? <Badge>{role.aptPackages.length} apt</Badge> : null}
      {role.npmPackages.length > 0 ? <Badge>{role.npmPackages.length} npm</Badge> : null}
      {role.libraryFileIds.length > 0 ? <Badge>{role.libraryFileIds.length} library</Badge> : null}
      {role.dockerEnabled ? <Badge>Docker</Badge> : null}
      {role.firewallEnabled ? <Badge>UFW</Badge> : null}
    </span>
  );
}

function SummaryTile({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="glow-hover rounded-control border border-border bg-surface-raised p-3">
      <div className="mb-2 flex items-center gap-2 text-accent">{icon}<span className="text-sm font-semibold text-text">{title}</span></div>
      <div className="grid gap-0.5 text-sm text-text-muted">{children}</div>
    </div>
  );
}

export default function RolesPage() {
  const toast = useToast();
  const { can } = useMagnusSession();
  const canWrite = can(WRITE_ROLES);
  const canDelete = can(ADMIN_ONLY);
  const isAdmin = canDelete;

  const roles = useMagnusResource((signal) => magnus.get('/roles', roleListResponseSchema, { signal }));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [active, setActive] = useState(false);
  const detail = useMagnusResource(
    async (signal) => {
      const [role, applications] = await Promise.all([
        magnus.get(`/roles/${segment(selectedId!)}`, roleDetailResponseSchema, { signal }),
        magnus.get('/roles/applications/list', roleApplicationListResponseSchema, { query: { roleId: selectedId }, signal }),
      ]);
      return { role: role.data, applications: applications.data };
    },
    [selectedId],
    { enabled: !!selectedId, pollMs: active ? ACTIVE_POLL_MS : IDLE_POLL_MS },
  );
  // The hook keeps the last answer while the next role loads. It must not show under the new one.
  const current = detail.data?.role.id === selectedId ? detail.data : undefined;
  const role = current?.role ?? null;
  const applications = current?.applications ?? [];
  const anyActive = applications.some((application) => applicationIsActive(application.status));
  useEffect(() => setActive(anyActive), [anyActive]);

  const [drawer, setDrawer] = useState<{ role: RoleDetail | null } | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignIds, setAssignIds] = useState<string[]>([]);
  const [defer, setDefer] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [deleting, setDeleting] = useState<RoleDetail | null>(null);
  const [unassigning, setUnassigning] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [confirmingApply, setConfirmingApply] = useState(false);
  const detailRef = useRef<HTMLDivElement>(null);

  const refresh = () => void Promise.all([roles.refresh(), selectedId ? detail.refresh() : Promise.resolve()]);
  function select(id: string) {
    setSelectedId(id);
    setAssignOpen(false);
    setAssignIds([]);
    if (window.matchMedia?.('(max-width: 1023px)').matches) requestAnimationFrame(() => detailRef.current?.scrollIntoView({ block: 'start' }));
  }
  async function assign() {
    if (!role) return;
    setAssigning(true);
    try {
      const { data } = await magnus.post(`/roles/${segment(role.id)}/assign`, assignRoleResponseSchema, { body: { nodeIds: assignIds, defer } });
      toast.success(`${data.assigned} node${data.assigned === 1 ? '' : 's'} assigned`, data.deferred ? 'The role has not been applied yet.' : undefined);
      setAssignOpen(false);
      setAssignIds([]);
      refresh();
    } catch (caught) {
      toast.error('The nodes could not be assigned', errorMessage(caught));
    } finally {
      setAssigning(false);
    }
  }
  async function confirmUnassign() {
    if (!role || !unassigning) return;
    setBusy(true);
    try {
      await magnus.post(`/roles/${segment(role.id)}/unassign`, unassignRoleResponseSchema, { body: { nodeIds: [unassigning.id] } });
      toast.success(`Removing the role from ${unassigning.name}`);
      setUnassigning(null);
      refresh();
    } catch (caught) {
      toast.error('The node could not be unassigned', errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }
  async function reapply() {
    setConfirmingApply(false);
    if (!role) return;
    setApplying(true);
    try {
      const { data } = await magnus.post(`/roles/${segment(role.id)}/apply`, roleApplyResponseSchema, { body: {}, idempotencyKey: idempotencyKey() });
      toast.success(`Applying to ${data.applied} node${data.applied === 1 ? '' : 's'}`);
      void detail.refresh();
    } catch (caught) {
      toast.error('The role could not be applied', errorMessage(caught));
    } finally {
      setApplying(false);
    }
  }
  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await magnus.delete(`/roles/${segment(deleting.id)}`, roleDeletedResponseSchema);
      toast.success(`${deleting.name} deleted`);
      if (selectedId === deleting.id) setSelectedId(null);
      setDeleting(null);
      void roles.refresh();
    } catch (caught) {
      toast.error('The role could not be deleted', errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  const list = roles.data?.data;
  const newRole = canWrite ? <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setDrawer({ role: null })}>New role</Button> : null;
  return (
    <div className="page-stack">
      <PageItem>
        <PageHeader
          eyebrow="Provisioning"
          title="Node roles"
          description="Reusable host provisioning bundles: packages, files, environment, Docker sandboxing and firewall rules. These are not identity roles."
          actions={<><Button size="sm" icon={<RefreshCw className="size-4" />} loading={roles.refreshing} onClick={refresh}>Refresh</Button>{newRole}</>}
        />
      </PageItem>
      <PageItem>
        <div className={cn('grid items-start gap-6', list?.length !== 0 && 'lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]')}>
          <FxPanel padding="sm" interactive={false} aria-label="Roles">
            {!list ? (
              roles.loading ? <LoadingRows /> : <ResourceError error={roles.error} title="Roles could not be loaded" onRetry={() => void roles.refresh()} />
            ) : list.length === 0 ? (
              <EmptyState icon={<ShieldCheck className="size-6" />} title="No roles yet" message="A role bundles what a host needs: packages, files, environment, sandboxing and firewall rules." {...(newRole ? { action: newRole } : {})} />
            ) : (
              <div className="grid gap-1">
                {list.map((item) => (
                  <button key={item.id} type="button" aria-pressed={selectedId === item.id} onClick={() => select(item.id)} className={cn('glow-hover w-full cursor-pointer rounded-control border px-3 py-3 text-left', selectedId === item.id ? 'border-accent bg-accent-soft' : 'border-transparent hover:border-accent hover:bg-surface-hover')}>
                    <span className="mb-1 flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-sm font-semibold">{item.name}</span>
                      <span className="flex items-center gap-1.5"><Badge tone={item.status === 'active' ? 'success' : 'warning'}>{item.status}</Badge><ChevronRight className="size-4 text-text-muted" /></span>
                    </span>
                    {item.description ? <span className="mb-1.5 block truncate text-sm text-text-muted">{item.description}</span> : null}
                    <span className="flex items-center justify-between gap-2">
                      <Features role={item} />
                      <span className="num flex items-center gap-1 text-xs text-text-muted"><Server className="size-3" />{item._count.nodes}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </FxPanel>
          <div ref={detailRef} className={cn('grid min-w-0 scroll-mt-4 gap-4', list?.length === 0 && 'hidden')}>
            {!selectedId ? (
              <FxPanel interactive={false}><EmptyState icon={<ShieldCheck className="size-6" />} title="Select a role to view details" /></FxPanel>
            ) : !role ? (
              <FxPanel interactive={false}>{detail.error ? <ResourceError error={detail.error} title="This role could not be loaded" onRetry={() => void detail.refresh()} /> : <LoadingRows rows={6} />}</FxPanel>
            ) : (
              <>
                <FxPanel
                  key={role.id}
                  hero
                  interactive={false}
                  title={<span className="flex flex-wrap items-center gap-2">{role.name}<Badge tone={role.status === 'active' ? 'success' : 'warning'}>{role.status}</Badge></span>}
                  description={role.description || undefined}
                  actions={<>{canWrite ? <Button size="sm" icon={<Pencil className="size-4" />} onClick={() => setDrawer({ role })}>Edit</Button> : null}{canDelete ? <Button size="sm" variant="danger" icon={<Trash2 className="size-4" />} onClick={() => setDeleting(role)}>Delete</Button> : null}</>}
                >
                  <div className="grid gap-3 sm:grid-cols-2">
                    <SummaryTile icon={<Package className="size-4" />} title="Packages">
                      <p className="m-0 break-words">{role.aptPackages.length ? `apt: ${role.aptPackages.join(', ')}` : 'No apt packages'}</p>
                      <p className="m-0 break-words">{role.npmPackages.length ? `npm: ${role.npmPackages.join(', ')}` : 'No npm packages'}</p>
                    </SummaryTile>
                    <SummaryTile icon={<KeyRound className="size-4" />} title="Environment">
                      {role.envConfigKeys.length ? <p className="m-0 break-words font-mono text-xs">{role.envConfigKeys.join(', ')}</p> : <p className="m-0">No environment variables</p>}
                      {role.envConfigKeys.length ? <p data-testid="env-visibility" className="m-0 mt-1 text-xs">{isAdmin ? 'Values are in Edit, visible to ADMIN only.' : 'Values are visible to ADMIN only.'}</p> : null}
                    </SummaryTile>
                    <SummaryTile icon={<FileText className="size-4" />} title="Skills and jobs">
                      <p className="m-0">{role.libraryFileIds.length} library item{role.libraryFileIds.length === 1 ? '' : 's'} assigned</p>
                    </SummaryTile>
                    <SummaryTile icon={<><Container className="size-4" /><Shield className="size-4" /></>} title="Sandbox and firewall">
                      <p className="m-0">Docker: {role.dockerEnabled ? `Enabled${role.dockerNonRoot ? ' (non-root)' : ''}` : 'Disabled'}</p>
                      <p className="m-0">Firewall: {role.firewallEnabled ? `${role.firewallMode} mode` : 'Disabled'}</p>
                    </SummaryTile>
                  </div>
                </FxPanel>
                <FxPanel
                  title="Assigned nodes"
                  interactive={false}
                  actions={canWrite ? (
                    <>
                      {(role.nodes?.length ?? 0) > 0 ? <Button size="sm" icon={<RefreshCw className="size-4" />} loading={applying} onClick={() => setConfirmingApply(true)}>Re-apply all</Button> : null}
                      <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setAssignOpen(true)}>Assign nodes</Button>
                    </>
                  ) : undefined}
                >
                  {!role.nodes?.length ? (
                    <EmptyState compact icon={<Server className="size-5" />} title="No nodes assigned to this role" />
                  ) : (
                    <div className="grid gap-1">
                      {role.nodes.map((node) => (
                        <div key={`${node.id}:${node.status}`} className="scan-sweep glow-hover flex flex-wrap items-center justify-between gap-3 rounded-control border border-border bg-surface-raised px-3 py-2">
                          <div className="flex min-w-0 flex-wrap items-center gap-3">
                            <StatusDot status={node.status} />
                            <div className="min-w-0"><p className="m-0 text-sm font-semibold">{node.name}</p><p className="m-0 break-all text-xs text-text-muted">{node.hostname}</p></div>
                            <Badge tone={statusTone(node.status)}>{node.status}</Badge>
                          </div>
                          {canWrite ? <Button variant="ghost" size="sm" icon={<UserMinus className="size-4" />} onClick={() => setUnassigning({ id: node.id, name: node.name })}>Unassign</Button> : null}
                        </div>
                      ))}
                    </div>
                  )}
                  {assignOpen && canWrite ? (
                    <div className="mt-4 grid gap-3 rounded-control border border-accent bg-accent-soft p-4">
                      <h4 className="m-0 text-sm font-semibold">Assign nodes to {role.name}</h4>
                      <NodeChecklist selected={assignIds} onChange={setAssignIds} label="Select nodes" empty="No nodes are registered." />
                      <Toggle checked={defer} onChange={setDefer} label="Defer application: assign only, do not apply yet" />
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={() => { setAssignOpen(false); setAssignIds([]); }}>Cancel</Button>
                        <Button variant="primary" size="sm" loading={assigning} disabled={assignIds.length === 0} icon={<Play className="size-4" />} onClick={() => void assign()}>{assigning ? 'Assigning…' : `Assign ${assignIds.length} node${assignIds.length === 1 ? '' : 's'}`}</Button>
                      </div>
                    </div>
                  ) : null}
                </FxPanel>
                <FxPanel title="Application history" description="Recent role apply and remove operations" interactive={false}>
                  {applications.length === 0 ? <p className="m-0 py-4 text-center text-sm text-text-muted">No applications yet</p> : (
                    <div className="grid gap-3">
                      {applications.slice(0, 10).map((application) => {
                        const steps = parseSteps(application.steps);
                        return (
                          <div key={`${application.id}:${application.status}`} className="scan-sweep rounded-control border border-border bg-surface-raised p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2"><Badge tone={application.action === 'apply' ? 'info' : 'warning'}>{application.action}</Badge><span className="text-sm text-text-muted">{application.node.name}</span></div>
                              <div className="flex items-center gap-2"><Badge tone={statusTone(application.status)} dot className={cn(applicationIsActive(application.status) && 'fx-badge-pulse')}>{application.status}</Badge><span className="text-xs text-text-muted">{formatTime(application.createdAt)}</span></div>
                            </div>
                            {steps.length > 0 ? (
                              <div className="mt-2 flex flex-wrap gap-2">
                                {steps.map((step, index) => <span key={index} className="flex items-center gap-1.5 rounded-chip bg-surface-sunken px-2 py-1 text-xs text-text-muted" title={step.error ?? step.name}><StepIcon status={step.status} />{step.name}</span>)}
                              </div>
                            ) : null}
                            {application.error ? <p className="m-0 mt-2 flex items-start gap-1.5 break-words text-sm text-danger"><AlertCircle className="mt-0.5 size-4 shrink-0" /><span className="min-w-0">{application.error}</span></p> : null}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </FxPanel>
              </>
            )}
          </div>
        </div>
      </PageItem>
      <RoleDrawer open={!!drawer} role={drawer?.role ?? null} onClose={() => setDrawer(null)} onSaved={refresh} />
      <ActionConfirm open={confirmingApply && !!role} title="Re-apply this role?" message={role ? `Apply "${role.name}" again on ${role.nodes?.length ?? 0} node${role.nodes?.length === 1 ? '' : 's'}? Its steps run on each of them now.` : ''} confirmLabel="Re-apply" onConfirm={() => void reapply()} onCancel={() => setConfirmingApply(false)} />
      <ConfirmDialog open={!!deleting} title="Delete node role" message={deleting ? `Delete role "${deleting.name}"? This unassigns all its nodes.` : ''} loading={busy} onConfirm={() => void confirmDelete()} onCancel={() => setDeleting(null)} />
      <ConfirmDialog open={!!unassigning} title="Unassign node" confirmLabel="Unassign" message={unassigning ? `Unassign ${unassigning.name}? This removes the role's configuration from it.` : ''} loading={busy} onConfirm={() => void confirmUnassign()} onCancel={() => setUnassigning(null)} />
    </div>
  );
}
