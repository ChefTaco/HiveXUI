import { Fragment, useEffect, useState } from 'react';
import { ArrowLeft, Check, ChevronDown, Pencil, Plus, RefreshCw, Search, Trash2, Zap } from 'lucide-react';
import { Badge, Button, ConfirmDialog, EmptyState, IconButton, JsonBlock, PageHeader, TableFrame, TextInput, Toggle, LoadingRows, ResourceError } from '@ui';
import { cn } from '@lib/cn';
import { formatTime } from '@lib/format';
import { useToast } from '../../../../../../components/toast';
import { magnus, segment } from '../../../../api/client';
import { errorMessage } from '../../../../api/errors';
import { useMagnusResource } from '../../../../api/use-resource';
import { FxPanel, PageItem } from '../../../../effects';
import Link, { useRouter, useSearchParams } from '../../../../navigation';
import { ADMIN_ONLY, useMagnusSession, WRITE_ROLES } from '../../../../session';
import { ActionConfirm } from '../../../../ui/action-confirm';
import { severityTone } from '../../shared/severity';
import { useSweep } from '../../shared/sweep';
import { executionIsLive, executionTone, filterRules } from '../model';
import { remediationApproveResponseSchema, remediationDeleteResponseSchema, remediationExecutionListResponseSchema, remediationRuleListResponseSchema, remediationRuleResponseSchema, type RemediationExecution, type RemediationRule } from '../schemas';
import { RuleDrawer } from './rule-drawer';

const EXECUTION_PAGE = 50;

export default function RemediationPage() {
  const toast = useToast();
  const router = useRouter();
  const tab = useSearchParams().get('tab') === 'executions' ? 'executions' : 'rules';
  const { can } = useMagnusSession();
  const canWrite = can(WRITE_ROLES);
  const canDelete = can(ADMIN_ONLY);
  const sweep = useSweep();
  const rules = useMagnusResource((signal) => magnus.get('/remediation/rules', remediationRuleListResponseSchema, { signal }));
  const executions = useMagnusResource((signal) => magnus.get('/remediation/executions', remediationExecutionListResponseSchema, { query: { pageSize: EXECUTION_PAGE }, signal }));
  const [drawer, setDrawer] = useState<{ rule: RemediationRule | null } | null>(null);
  const [deleting, setDeleting] = useState<RemediationRule | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [approving, setApproving] = useState<RemediationExecution | null>(null);
  const [approveBusy, setApproveBusy] = useState(false);
  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await magnus.delete(`/remediation/rules/${segment(deleting.id)}`, remediationDeleteResponseSchema);
      toast.success(`${deleting.name} deleted`);
      setDeleting(null);
      await rules.refresh();
    } catch (error) {
      toast.error('The rule could not be deleted', errorMessage(error));
    } finally {
      setDeleteBusy(false);
    }
  }
  async function confirmApprove() {
    if (!approving) return;
    setApproveBusy(true);
    try {
      await magnus.post(`/remediation/executions/${segment(approving.id)}/approve`, remediationApproveResponseSchema);
      toast.success('Plan approved');
      await executions.refresh();
    } catch (error) {
      toast.error('The plan was not approved', errorMessage(error));
    } finally {
      setApproving(null);
      setApproveBusy(false);
    }
  }
  const ruleList = rules.data?.data;
  const executionList = executions.data?.data.executions;
  const setTab = (next: 'rules' | 'executions') => router.replace(next === 'rules' ? '/anomalies/remediation' : '/anomalies/remediation?tab=executions');
  return (
    <div className="page-stack">
      <PageItem>
        <Link href="/anomalies" className="mb-2 inline-flex items-center gap-1 text-sm"><ArrowLeft className="size-4" />Back to anomalies</Link>
        <PageHeader
          title="Auto-remediation"
          eyebrow="Anomalies"
          icon={<Zap className="size-5" />}
          description="Rules that record remediation decisions when anomalies are detected."
          actions={
            <>
              <Button size="sm" icon={<RefreshCw className="size-4" />} loading={rules.refreshing || executions.refreshing} onClick={() => { void rules.refresh(); void executions.refresh(); }}>Refresh</Button>
              {tab === 'rules' && canWrite ? <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setDrawer({ rule: null })}>New rule</Button> : null}
            </>
          }
        />
      </PageItem>
      <PageItem>
        <div className="tabs" role="tablist" aria-label="Remediation views">
          <button type="button" role="tab" aria-selected={tab === 'rules'} className={cn('tab', tab === 'rules' && 'tab--active')} onClick={() => setTab('rules')}>Rules<span className="tab-count">{ruleList?.length ?? 0}</span></button>
          <button type="button" role="tab" aria-selected={tab === 'executions'} className={cn('tab', tab === 'executions' && 'tab--active')} onClick={() => setTab('executions')}>Executions<span className="tab-count">{executionList?.length ?? 0}</span></button>
        </div>
      </PageItem>
      {tab === 'rules' ? (
        <PageItem>
          <RulesTab resource={rules} canWrite={canWrite} canDelete={canDelete} onEdit={(rule) => setDrawer({ rule })} onDelete={setDeleting} onCreate={() => setDrawer({ rule: null })} />
        </PageItem>
      ) : (
        <PageItem>
          <FxPanel padding={executionList?.length ? 'none' : 'md'} interactive={false}>
            {!executionList ? (
              executions.loading ? <LoadingRows rows={4} /> : <ResourceError error={executions.error} title="Executions could not be loaded" onRetry={() => void executions.refresh()} />
            ) : executionList.length === 0 ? (
              <EmptyState icon={<Zap className="size-5" />} title="No remediation executions yet" message="A plan appears here when a rule matches an anomaly or is triggered from one." />
            ) : (
              <TableFrame label="Remediation executions">
                <table>
                  <thead><tr>{['Rule', 'Node', 'Status', 'Legacy run', 'Triggered', 'Plan and outcome'].map((heading) => <th key={heading}>{heading}</th>)}</tr></thead>
                  <tbody>
                    {executionList.map((execution) => (
                      <tr key={`${execution.id}:${execution.status}`} className={cn(sweep, 'fx-rail align-top')}>
                        <td>{execution.rule?.name ?? execution.ruleId}<div><Link href={`/anomalies/${encodeURIComponent(execution.anomalyEventId)}`} className="text-xs">Anomaly</Link></div></td>
                        <td className="font-mono text-sm text-text-muted">{execution.nodeId}</td>
                        <td><Badge tone={executionTone(execution.status)} dot={executionIsLive(execution.status)} className={executionIsLive(execution.status) ? 'fx-badge-pulse' : ''}>{execution.status.replace('_', ' ')}</Badge></td>
                        <td className="font-mono text-sm text-text-muted">{execution.orchestraRunId ? `${execution.orchestraRunId.slice(0, 12)}…` : '—'}</td>
                        <td className="num text-sm text-text-muted">{formatTime(execution.triggeredAt)}</td>
                        <td className="min-w-64 text-sm">
                          <details>
                            <summary className="cursor-pointer text-text-muted">Review plan and outcome</summary>
                            <div className="mt-2 grid gap-2">
                              {execution.input ? <JsonBlock value={execution.input} /> : <p className="m-0 text-text-muted">No plan was made.</p>}
                              {execution.output ? <JsonBlock value={execution.output} /> : null}
                            </div>
                          </details>
                          {execution.status === 'pending_approval' && canWrite ? <Button size="sm" className="mt-2" icon={<Check className="size-4" />} onClick={() => setApproving(execution)}>Approve displayed plan</Button> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableFrame>
            )}
          </FxPanel>
        </PageItem>
      )}
      {drawer ? <RuleDrawer key={drawer.rule?.id ?? 'new'} rule={drawer.rule} takenNames={ruleList?.map(({ name }) => name) ?? []} onClose={() => setDrawer(null)} onSaved={() => void rules.refresh()} /> : null}
      <ConfirmDialog open={!!deleting} title="Delete this rule?" message={deleting ? `${deleting.name} and its execution history are removed. This cannot be undone.` : ''} loading={deleteBusy} onConfirm={() => void confirmDelete()} onCancel={() => setDeleting(null)} />
      <ActionConfirm open={!!approving} title="Approve this plan?" message="Approve the runbook plan displayed in this row." confirmLabel="Approve plan" loading={approveBusy} onConfirm={() => void confirmApprove()} onCancel={() => setApproving(null)} />
    </div>
  );
}

function RulesTab({ resource, canWrite, canDelete, onEdit, onDelete, onCreate }: {
  resource: { data: { data: RemediationRule[] } | undefined; error: unknown; loading: boolean; refresh: () => Promise<void> };
  canWrite: boolean;
  canDelete: boolean;
  onEdit: (rule: RemediationRule) => void;
  onDelete: (rule: RemediationRule) => void;
  onCreate: () => void;
}) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [switching, setSwitching] = useState('');
  const rules = resource.data?.data;
  useEffect(() => {
    if (expanded && rules && !rules.some((rule) => rule.id === expanded)) setExpanded(null);
  }, [expanded, rules]);
  async function toggle(rule: RemediationRule) {
    setSwitching(rule.id);
    try {
      await magnus.patch(`/remediation/rules/${segment(rule.id)}`, remediationRuleResponseSchema, { body: { enabled: !rule.enabled } });
      await resource.refresh();
    } catch (error) {
      toast.error(`${rule.name} could not be changed`, errorMessage(error));
    } finally {
      setSwitching('');
    }
  }
  if (!rules) return <FxPanel interactive={false}>{resource.loading ? <LoadingRows rows={4} /> : <ResourceError error={resource.error} title="Rules could not be loaded" onRetry={() => void resource.refresh()} />}</FxPanel>;
  const filtered = filterRules(rules, search);
  return (
    <FxPanel interactive={false}>
      <div className="grid gap-3">
        <label className="relative block">
          <span className="sr-only">Search rules</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" aria-hidden="true" />
          <TextInput value={search} onChange={setSearch} placeholder="Search rules" className="w-full pl-9" />
        </label>
        {filtered.length === 0 ? (
          <EmptyState compact icon={<Zap className="size-4" />} title={rules.length === 0 ? 'No remediation rules defined' : 'No rules match your search'} {...(rules.length === 0 ? { message: canWrite ? 'Create one to get started.' : 'An operator can create one.' } : {})} {...(rules.length === 0 && canWrite ? { action: <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={onCreate}>New rule</Button> } : {})} />
        ) : (
          <TableFrame label="Remediation rules">
            <table>
              <thead>
                <tr>
                  {['Rule', 'Metric', 'Threshold', 'Cooldown', 'Runs', 'Status'].map((heading) => <th key={heading}>{heading}</th>)}
                  {canWrite || canDelete ? <th><span className="sr-only">Actions</span></th> : null}
                </tr>
              </thead>
              <tbody>
                {filtered.map((rule) => {
                  const open = expanded === rule.id;
                  return (
                    <Fragment key={rule.id}>
                      <tr className="fx-rail">
                        <td>
                          <button type="button" className="flex items-start gap-2 text-left" aria-expanded={open} onClick={() => setExpanded(open ? null : rule.id)}>
                            <ChevronDown className={cn('mt-0.5 size-4 shrink-0 text-text-muted transition-transform duration-[var(--duration-base)]', open && 'rotate-180')} aria-hidden="true" />
                            <span className="min-w-0">
                              <span className="block font-semibold">{rule.name}</span>
                              {rule.description ? <span className="block text-sm text-text-muted">{rule.description}</span> : null}
                            </span>
                          </button>
                        </td>
                        <td><Badge>{rule.metric === '*' ? 'all' : rule.metric}</Badge></td>
                        <td><Badge tone={severityTone(rule.severityThreshold)}>{rule.severityThreshold}</Badge></td>
                        <td className="num text-sm text-text-muted">{rule.cooldownMinutes}m</td>
                        <td className="num text-sm text-text-muted">{rule._count?.executions ?? 0}</td>
                        <td>
                          <span className="flex flex-wrap items-center gap-2">
                            {canWrite ? <Toggle checked={rule.enabled} disabled={switching === rule.id} label={rule.enabled ? 'Active' : 'Disabled'} onChange={() => void toggle(rule)} /> : <Badge tone={rule.enabled ? 'success' : 'neutral'} dot>{rule.enabled ? 'Active' : 'Disabled'}</Badge>}
                            {rule.disposition === 'legacy_record_only' ? <Badge tone="warning">Record only</Badge> : null}
                          </span>
                        </td>
                        {canWrite || canDelete ? (
                          <td>
                            <span className="flex items-center gap-1">
                              {canWrite ? <IconButton label={`Edit ${rule.name}`} icon={<Pencil className="size-4" />} onClick={() => onEdit(rule)} /> : null}
                              {canDelete ? <IconButton label={`Delete ${rule.name}`} variant="danger" icon={<Trash2 className="size-4" />} onClick={() => onDelete(rule)} /> : null}
                            </span>
                          </td>
                        ) : null}
                      </tr>
                      {open ? (
                        <tr>
                          <td colSpan={canWrite || canDelete ? 7 : 6} className="bg-surface-sunken">
                            <div className="animate-page-in grid grid-cols-2 gap-4 text-sm lg:grid-cols-4">
                              <Detail label="Versioned runbook"><span className="font-mono">{rule.agentDefinitionId}</span></Detail>
                              <Detail label="Max concurrent"><span className="num">{rule.maxConcurrentRuns}</span></Detail>
                              <Detail label="Node filter"><span className="font-mono">{rule.nodeFilter ?? 'None'}</span></Detail>
                              <Detail label="Created"><span className="num">{formatTime(rule.createdAt)}</span></Detail>
                              {rule.input ? <div className="col-span-2 lg:col-span-4"><Detail label="Runbook configuration (JSON)"><JsonBlock value={rule.input} /></Detail></div> : null}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </TableFrame>
        )}
      </div>
    </FxPanel>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="m-0 text-xs font-medium text-text-muted">{label}</p>
      <div className="mt-1 break-words">{children}</div>
    </div>
  );
}
