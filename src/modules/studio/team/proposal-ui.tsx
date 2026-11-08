import { useCallback, useEffect, useMemo, useState } from 'react';
import { Ban, Check, RotateCcw, Sparkles, X } from 'lucide-react';
import { teamProposalRecordSchema } from '@contracts/ardentstudio.generated';
import { Badge, Button, Drawer, EmptyState, Field, Select, TableFrame } from '@ui';
import { cn } from '@lib/cn';
import { errorMessage } from '../../magnus/api/errors';
import type { Resource } from '../../magnus/api/use-resource';
import { LoadingRows } from '../../magnus/ui/resource-state';
import { idempotencyKey, StudioApiError } from '../api/client';
import { controlTask, listTeamProposals, proposeTeam, type Agent, type AgentList, type TeamProposalRecord } from '../api/endpoints';
import type { ProjectStore } from '../state/project-store';
import { EdgeSample } from './legend';
import { managerOf, RELATIONSHIP_LABEL, STAGE_LABEL, treeOrder, type TeamDraft } from './model';
import { edgeText, proposalStatus, type GhostChange, type RoleDiff, type TeamDiff } from './proposal';

// ── State ──

const dismissedKey = (projectId: string) => `studio-proposals-dismissed:${projectId}`;
const MAX_DISMISSED = 50;
function readDismissed(projectId: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(dismissedKey(projectId)) ?? '[]');
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}
function writeDismissed(projectId: string, ids: readonly string[]): void {
  try {
    localStorage.setItem(dismissedKey(projectId), JSON.stringify(ids.slice(-MAX_DISMISSED)));
  } catch {
    // Without storage a discarded proposal shows again on the next visit; nothing is applied either way.
  }
}

const newestFirst = (list: readonly TeamProposalRecord[]) => [...list].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
function merge(list: readonly TeamProposalRecord[], record: TeamProposalRecord): TeamProposalRecord[] {
  const known = list.find((item) => item.id === record.id);
  // Events can arrive before the list answer; keep whichever copy is newer.
  if (known && known.updated_at > record.updated_at) return [...list];
  return newestFirst([record, ...list.filter((item) => item.id !== record.id)]);
}

/** What the service answered when asked for a proposal, in words for this screen. */
export function proposeFailure(error: unknown): string {
  if (error instanceof StudioApiError) {
    if (error.code === 'NO_COORDINATOR') return 'No coordinator is bound to an agent. Choose the agent to ask.';
    if (error.code === 'PROPOSAL_IN_PROGRESS') return 'A team proposal is already being prepared for this project.';
    if (error.code === 'MAGNUS_UNAVAILABLE') return 'Magnus is unavailable, so no agent can be asked right now. Try again shortly.';
  }
  return errorMessage(error, 'The proposal could not be requested');
}

export interface TeamProposals {
  /** The newest proposal nobody discarded or accepted on this device, if any. */
  latest: TeamProposalRecord | null;
  loading: boolean;
  error: unknown;
  propose: (agentRef: string | undefined) => Promise<TeamProposalRecord | null>;
  proposing: boolean;
  proposeError: string | null;
  cancel: () => Promise<void>;
  cancelling: boolean;
  cancelError: string | null;
  /** Hides a finished proposal for good on this device (discarded, accepted or acknowledged). */
  dismiss: (id: string) => void;
  reload: () => void;
}

/** A project's team proposals: the list once, then team.proposal.updated from the project stream. */
export function useTeamProposals(store: ProjectStore): TeamProposals {
  const projectId = store.projectId;
  const [records, setRecords] = useState<TeamProposalRecord[]>(() => newestFirst(store.getState().snapshot?.team_proposals ?? []));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const [tick, setTick] = useState(0);
  const [dismissed, setDismissed] = useState<readonly string[]>(() => readDismissed(projectId));
  const [proposing, setProposing] = useState(false);
  const [proposeError, setProposeError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    listTeamProposals(projectId, controller.signal).then(
      (list) => {
        setRecords((current) => list.reduce((all, record) => merge(all, record), current.filter((item) => list.some((entry) => entry.id === item.id) || item.state === 'queued' || item.state === 'running')));
        setError(undefined);
        setLoading(false);
      },
      (caught: unknown) => {
        if (controller.signal.aborted) return;
        setError(caught);
        setLoading(false);
      },
    );
    return () => controller.abort();
  }, [projectId, tick]);

  useEffect(
    () =>
      store.onEvent((event) => {
        if (event.type !== 'team.proposal.updated') return;
        const record = teamProposalRecordSchema.safeParse(event.payload.proposal);
        if (record.success) setRecords((current) => merge(current, record.data));
      }),
    [store],
  );

  const latest = records[0] && !dismissed.includes(records[0].id) ? records[0] : null;

  const propose = useCallback(
    async (agentRef: string | undefined) => {
      setProposing(true);
      setProposeError(null);
      try {
        const record = await proposeTeam(projectId, agentRef, idempotencyKey());
        setRecords((current) => merge(current, record));
        return record;
      } catch (caught) {
        setProposeError(proposeFailure(caught));
        if (caught instanceof StudioApiError && caught.code === 'PROPOSAL_IN_PROGRESS') setTick((value) => value + 1);
        return null;
      } finally {
        setProposing(false);
      }
    },
    [projectId],
  );

  const cancel = useCallback(async () => {
    const taskId = latest?.task_id;
    if (!taskId) return;
    setCancelling(true);
    setCancelError(null);
    try {
      await controlTask(taskId, 'cancel', idempotencyKey());
      // The proposal record follows as team.proposal.updated; read it too in case the stream is down.
      setTick((value) => value + 1);
    } catch (caught) {
      setCancelError(errorMessage(caught, 'The proposal could not be cancelled'));
    } finally {
      setCancelling(false);
    }
  }, [latest?.task_id]);

  const dismiss = useCallback(
    (id: string) => {
      setDismissed((current) => {
        const next = [...current.filter((item) => item !== id), id];
        writeDismissed(projectId, next);
        return next;
      });
    },
    [projectId],
  );

  return { latest, loading, error, propose, proposing, proposeError, cancel, cancelling, cancelError, dismiss, reload: () => setTick((value) => value + 1) };
}

// ── Choosing the agent ──

/** The agent asked by default: the coordinator's when it is bound and available, else the first available agent. */
export function defaultProposer(coordinatorRef: string | null, agents: readonly Agent[]): string {
  const available = agents.filter((agent) => agent.available);
  if (coordinatorRef && available.some((agent) => agent.agent_ref === coordinatorRef)) return coordinatorRef;
  return available[0]?.agent_ref ?? '';
}

export function ProposerSelect({ agents, coordinator, value, onChange }: { agents: Resource<AgentList>; coordinator: { name: string; agent_ref: string | null } | null; value: string; onChange: (value: string) => void }) {
  const list = agents.data?.agents ?? [];
  const available = list.filter((agent) => agent.available);
  if (!agents.data) return agents.loading ? <LoadingRows rows={1} /> : <p className="m-0 text-sm text-danger">{errorMessage(agents.error, 'Agents could not be listed')}</p>;
  if (!available.length)
    return <EmptyState compact tone="warning" title="No agent available" message={agents.data.magnus.state === 'ok' ? 'Every Ardent agent is stopped or unreachable. Start one in Magnus, then ask again.' : 'Magnus is unavailable, so no agent can be asked.'} />;
  const options = available.map((agent) => ({ value: agent.agent_ref, label: `${agent.display_name}${coordinator?.agent_ref === agent.agent_ref ? ` (coordinator: ${coordinator.name})` : ''} · ${agent.node_name}` }));
  const unavailable = list.length - available.length;
  return (
    <Field label="Agent to ask" hint={`The coordinator by default. It reads the brief, the requested deliverables, the templates and the available agents.${unavailable ? ` ${unavailable} unavailable ${unavailable === 1 ? 'agent is' : 'agents are'} not listed.` : ''}`}>
      <Select value={value} onChange={onChange} options={options} />
    </Field>
  );
}

/** Ask an agent for a team. Opens from the designer toolbar. */
export function ProposeDrawer({
  open,
  agents,
  coordinator,
  proposals,
  readOnly,
  onClose,
}: {
  open: boolean;
  agents: Resource<AgentList>;
  coordinator: { name: string; agent_ref: string | null } | null;
  proposals: TeamProposals;
  readOnly: boolean;
  onClose: () => void;
}) {
  const [agent, setAgent] = useState('');
  const list = agents.data?.agents;
  useEffect(() => {
    if (open) setAgent(defaultProposer(coordinator?.agent_ref ?? null, list ?? []));
  }, [open, coordinator?.agent_ref, list]);
  const busy = proposals.latest !== null && proposalStatus(proposals.latest).open;
  return (
    <Drawer
      open={open}
      title="Propose a team from the brief"
      eyebrow="Team Assignment"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={<Sparkles className="size-4" />}
            loading={proposals.proposing}
            disabled={readOnly || busy || !agent}
            onClick={() => {
              void proposals.propose(agent).then((record) => {
                if (record) onClose();
              });
            }}
          >
            Ask for a proposal
          </Button>
        </>
      }
    >
      <p className="m-0 text-sm text-text-muted">
        The agent answers with roles, relationships, stages and suggested agents. You see the difference on the canvas and choose what to accept; nothing changes until you do. An invalid answer is retried once with the error.
      </p>
      <ProposerSelect agents={agents} coordinator={coordinator} value={agent} onChange={setAgent} />
      {busy ? <p className="m-0 text-sm text-warning">A proposal is already being prepared. Cancel it to ask again.</p> : null}
      {proposals.proposeError ? <p role="alert" className="m-0 text-sm text-danger">{proposals.proposeError}</p> : null}
    </Drawer>
  );
}

// ── Progress ──

/** Queued, working, a retry, a failure or a cancel, with what can be done about it. */
export function ProposalProgress({
  record,
  agentName,
  proposals,
  readOnly,
  onReview,
  onRetry,
}: {
  record: TeamProposalRecord;
  agentName: string;
  proposals: TeamProposals;
  readOnly: boolean;
  /** Shown for a ready proposal that is not on screen. */
  onReview?: () => void;
  onRetry?: () => void;
}) {
  const status = proposalStatus(record);
  const banner = status.tone === 'danger' ? 'error-banner' : status.tone === 'warning' ? 'warning-banner' : status.tone === 'success' ? 'success-banner' : 'info-banner';
  return (
    <section className={cn(banner, 'studio-proposal-progress text-sm')} aria-label="Team proposal" aria-live="polite">
      <div className="studio-proposal-progress__main">
        <span className="studio-proposal-progress__title">
          {status.open ? <span className="spinner" aria-hidden="true" /> : <Sparkles className="size-4" aria-hidden="true" />}
          <span className="cell-strong">Team proposal from {agentName}</span>
          <Badge tone={status.tone}>{status.title}</Badge>
        </span>
        {status.detail ? <span className={cn(record.state === 'failed' ? 'text-danger' : 'text-text-muted')}>{status.detail}</span> : null}
        {proposals.cancelError ? <span role="alert" className="text-danger">{proposals.cancelError}</span> : null}
      </div>
      <span className="studio-proposal-progress__actions">
        {status.open && record.task_id ? (
          <Button size="sm" icon={<Ban className="size-4" />} loading={proposals.cancelling} disabled={readOnly} onClick={() => void proposals.cancel()}>
            Cancel
          </Button>
        ) : null}
        {record.state === 'ready' && onReview ? (
          <Button size="sm" variant="primary" onClick={onReview}>
            Review
          </Button>
        ) : null}
        {record.state === 'failed' && onRetry ? (
          <Button size="sm" icon={<RotateCcw className="size-4" />} disabled={readOnly} onClick={onRetry}>
            Ask again
          </Button>
        ) : null}
        {!status.open ? (
          <Button size="sm" variant="ghost" icon={<X className="size-4" />} onClick={() => proposals.dismiss(record.id)}>
            {record.state === 'ready' ? 'Discard' : 'Dismiss'}
          </Button>
        ) : null}
      </span>
    </section>
  );
}

// ── Review ──

const CHANGE_LABEL: Record<GhostChange, string> = { added: 'Added', changed: 'Changed', removed: 'Removed', same: 'Unchanged' };
const CHANGE_TONE: Record<GhostChange, 'success' | 'warning' | 'danger' | 'neutral'> = { added: 'success', changed: 'warning', removed: 'danger', same: 'neutral' };
/** Row and card classes for each kind of difference; the canvas, table and legend share them. */
export const GHOST_CLASS: Record<GhostChange, string> = {
  added: 'studio-ghost--added border-success bg-success-soft',
  changed: 'studio-ghost--changed border-warning bg-warning-soft',
  removed: 'studio-ghost--removed border-danger bg-danger-soft',
  same: '',
};
export const GHOST_STROKE: Record<'added' | 'removed', string> = { added: 'stroke-success', removed: 'stroke-danger' };

export function ChangeBadge({ change }: { change: GhostChange }) {
  return <Badge tone={CHANGE_TONE[change]}>{CHANGE_LABEL[change]}</Badge>;
}

/** What each ghost style means: roles by fill and border, lines by color. */
export function GhostLegend({ className }: { className?: string }) {
  return (
    <ul className={cn('studio-legend text-xs text-text-muted', className)} aria-label="Proposal changes">
      {(['added', 'changed', 'removed'] as const).map((change) => (
        <li key={change}>
          <span className={cn('studio-ghost-swatch rounded-control border border-dashed', GHOST_CLASS[change])} aria-hidden="true" />
          <span>Role {CHANGE_LABEL[change].toLowerCase()}</span>
        </li>
      ))}
      <li>
        <svg className="studio-legend__sample" width="44" height="12" viewBox="0 0 44 12" aria-hidden="true" focusable="false">
          <line x1="2" y1="6" x2="42" y2="6" className={GHOST_STROKE.added} strokeWidth={3} strokeLinecap="round" />
        </svg>
        <span>Line added</span>
      </li>
      <li>
        <svg className="studio-legend__sample" width="44" height="12" viewBox="0 0 44 12" aria-hidden="true" focusable="false">
          <line x1="2" y1="6" x2="42" y2="6" className={GHOST_STROKE.removed} strokeWidth={2} strokeDasharray="2 4" strokeLinecap="round" />
        </svg>
        <span>Line removed</span>
      </li>
    </ul>
  );
}

function RoleChange({ item, reason, checked, disabled, name, onToggle }: { item: RoleDiff; reason: string; checked: boolean; disabled: boolean; name: (key: string) => string; onToggle: (on: boolean) => void }) {
  return (
    <li className={cn('studio-proposal-role rounded-control border border-dashed', GHOST_CLASS[item.change])}>
      <label className="check-field">
        <input type="checkbox" id={`proposal-role-${item.key}`} checked={checked} disabled={disabled} onChange={(event) => onToggle(event.target.checked)} />
        <span className="cell-strong">{item.change === 'removed' ? <s>{item.name}</s> : item.name}</span>
        <ChangeBadge change={item.change} />
      </label>
      {reason ? <p className="m-0 text-xs text-text-muted">{reason}</p> : null}
      {item.fields.length ? (
        <dl className="studio-diff__values text-xs">
          {item.fields.map((field) => (
            <div key={field.field} className="studio-proposal-role__field">
              <dt className="text-text-muted">{field.label}</dt>
              <dd>
                <span className="text-danger">
                  <span className="sr-only">from </span>
                  {field.before}
                </span>
                <span aria-hidden="true"> → </span>
                <span className="text-success">
                  <span className="sr-only"> to </span>
                  {field.after}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {item.edges.length ? (
        <ul className="studio-proposal-role__edges text-xs">
          {item.edges.map((edge) => (
            <li key={`${edge.change}-${edge.edge.from}-${edge.edge.type}-${edge.edge.to}-${edge.edge.stage ?? ''}`} className={edge.change === 'added' ? 'text-success' : 'text-danger'}>
              {edge.change === 'added' ? '+ ' : '− '}
              {edgeText(edge.edge, name)}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * The review of a ready proposal: its rationale, what changes per role, and Accept all, Accept the
 * selected roles, or Discard. Nothing is applied until one of the accepts.
 */
export function ProposalReview({
  record,
  diff,
  agentName,
  selected,
  readOnly,
  applying,
  applyError,
  onSelect,
  onAcceptAll,
  onAcceptSelected,
  onDiscard,
  onHide,
}: {
  record: TeamProposalRecord;
  diff: TeamDiff;
  agentName: string;
  selected: ReadonlySet<string>;
  readOnly: boolean;
  applying: boolean;
  applyError: string | null;
  onSelect: (key: string, on: boolean) => void;
  onAcceptAll: () => void;
  onAcceptSelected: () => void;
  onDiscard: () => void;
  onHide: () => void;
}) {
  const changes = diff.roles.filter((item) => item.change !== 'same');
  const names = useMemo(() => new Map(diff.roles.map((item) => [item.key, item.name])), [diff.roles]);
  const name = (key: string) => names.get(key) ?? key;
  const rationale = record.proposal?.rationale ?? '';
  const reasons = useMemo(() => {
    const map = new Map<string, string>();
    for (const role of record.proposal?.roles ?? []) if (role.rationale) map.set(role.key, role.rationale);
    for (const binding of record.proposal?.bindings ?? []) if (binding.reason) map.set(binding.role_key, [map.get(binding.role_key), `Agent: ${binding.reason}`].filter(Boolean).join(' '));
    return map;
  }, [record.proposal]);
  const counts = (['added', 'changed', 'removed'] as const).map((change) => [change, changes.filter((item) => item.change === change).length] as const).filter(([, count]) => count);
  return (
    <section className="studio-proposal panel panel--sm" aria-labelledby="studio-proposal-title">
      <div className="studio-proposal__head">
        <div className="studio-proposal__heading">
          <h3 id="studio-proposal-title" className="m-0 text-base">
            <Sparkles className="mr-1 inline size-4 text-accent" aria-hidden="true" />
            Proposed team from {agentName}
          </h3>
          <p className="m-0 text-xs text-text-muted" role="status">
            {changes.length ? counts.map(([change, count]) => `${count} ${CHANGE_LABEL[change].toLowerCase()}`).join(' · ') : 'The proposal matches the team on screen.'}
            {record.attempts.length > 1 ? ' · valid on the second attempt' : ''}
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onHide}>
          Hide preview
        </Button>
      </div>
      {rationale ? <p className="studio-proposal__rationale m-0 text-sm">{rationale}</p> : null}
      <GhostLegend />
      {changes.length ? (
        <fieldset className="studio-proposal__roles">
          <legend className="field-label">Accept per role</legend>
          <ul className="studio-proposal__list">
            {changes.map((item) => (
              <RoleChange key={item.key} item={item} reason={reasons.get(item.key) ?? ''} name={name} checked={selected.has(item.key)} disabled={readOnly || applying} onToggle={(on) => onSelect(item.key, on)} />
            ))}
          </ul>
        </fieldset>
      ) : null}
      {diff.stages ? (
        <p className="m-0 text-xs text-text-muted">
          Workflow stages: {diff.stages.before.map((stage) => STAGE_LABEL[stage]).join(', ') || '—'} → {diff.stages.after.map((stage) => STAGE_LABEL[stage]).join(', ') || '—'}. Accept all applies them; accepting roles adds the stages they use.
        </p>
      ) : null}
      {applyError ? <p role="alert" className="m-0 text-sm text-danger">{applyError}</p> : null}
      <div className="studio-proposal__actions border-t border-border bg-surface">
        <Button size="sm" variant="ghost" icon={<X className="size-4" />} disabled={applying} onClick={onDiscard}>
          Discard
        </Button>
        <Button size="sm" disabled={readOnly || applying || !selected.size} loading={applying} onClick={onAcceptSelected}>
          Accept {selected.size} {selected.size === 1 ? 'role' : 'roles'}
        </Button>
        <Button size="sm" variant="primary" icon={<Check className="size-4" />} disabled={readOnly || applying || !record.draft_body} loading={applying} onClick={onAcceptAll}>
          Accept all
        </Button>
      </div>
    </section>
  );
}

/** The Table view during a review: every role and line with how the proposal changes it. */
export function ProposalTable({ draft, ghost, agents }: { draft: TeamDraft; ghost: { roles: ReadonlyMap<string, GhostChange>; edges: readonly GhostChange[] }; agents: ReadonlyMap<string, Agent> }) {
  const byKey = new Map(draft.roles.map((role) => [role.key, role]));
  const name = (key: string) => byKey.get(key)?.name ?? key;
  return (
    <div className="page-stack">
      <TableFrame label="Proposed roles">
        <table className="studio-table">
          <caption className="sr-only">Roles with the proposed changes, in reporting order</caption>
          <thead>
            <tr>
              <th scope="col">Change</th>
              <th scope="col">Role</th>
              <th scope="col">Reports to</th>
              <th scope="col">Stage</th>
              <th scope="col">Agent</th>
              <th scope="col">Deliverables</th>
            </tr>
          </thead>
          <tbody>
            {treeOrder(draft).map((key) => {
              const role = byKey.get(key)!;
              const change = ghost.roles.get(key) ?? 'same';
              const manager = managerOf(draft, key);
              return (
                <tr key={key} className={cn('studio-ghost-row', GHOST_CLASS[change])}>
                  <td>
                    <ChangeBadge change={change} />
                  </td>
                  <td className="cell-strong">{change === 'removed' ? <s>{role.name}</s> : role.name}{role.coordinator ? <span className="text-xs text-text-muted"> · coordinator</span> : null}</td>
                  <td>{manager ? name(manager) : role.coordinator ? 'Root' : '—'}</td>
                  <td>{role.stage ? STAGE_LABEL[role.stage] : '—'}</td>
                  <td>{role.agent_ref ? agents.get(role.agent_ref)?.display_name ?? role.agent_ref : <span className="text-text-muted">Unbound</span>}</td>
                  <td>{role.deliverables.join(', ') || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableFrame>
      <TableFrame label="Proposed relationships">
        <table className="studio-table">
          <caption className="sr-only">Relationships with the proposed changes</caption>
          <thead>
            <tr>
              <th scope="col">Change</th>
              <th scope="col">From</th>
              <th scope="col">Relationship</th>
              <th scope="col">To</th>
            </tr>
          </thead>
          <tbody>
            {draft.relationships.map((edge, index) => {
              const change = ghost.edges[index] ?? 'same';
              return (
                <tr key={index} className={cn('studio-ghost-row', GHOST_CLASS[change])}>
                  <td>
                    <ChangeBadge change={change} />
                  </td>
                  <td>{name(edge.from)}</td>
                  <td>
                    <span className="studio-table__relation">
                      <EdgeSample type={edge.type} prefix={`proposal-${index}`} />
                      {RELATIONSHIP_LABEL[edge.type]}
                      {edge.stage === 'revise' ? ' (revise loop)' : ''}
                    </span>
                  </td>
                  <td>{name(edge.to)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableFrame>
    </div>
  );
}
