import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowUpCircle, BookmarkPlus, CheckCircle2, LayoutGrid, Library, ListChecks, Play, Plus, Rows3, Sparkles, Upload, Workflow, X } from 'lucide-react';
import { Badge, Button, ConfirmDialog, PageHeader, Panel, LoadingRows } from '@ui';
import { cn } from '@lib/cn';
import { useToast } from '../../../components/toast';
import { useMagnusResource } from '../../magnus/api/use-resource';
import { getTemplate, listAgents, type Agent } from '../api/endpoints';
import { BindPicker } from '../agents/bind-picker';
import { NewAgentDrawer } from '../agents/new-agent-drawer';
import { galleryHref } from '../gallery/links';
import { useDeliverables } from '../room/use-room';
import { setStudioQuery, StudioLink, useStudioSearch } from '../link';
import { ProjectFrame } from '../projects/project-page';
import { projectHref } from '../routes';
import type { ProjectState, ProjectStore } from '../state/project-store';
import { useProject } from '../state/project-store';
import type { Positions } from './canvas/layout';
import { RoleInspector, useNarrow } from './inspector';
import { EdgeLegend } from './legend';
import { addRelationship, addRole, bindRole, draftFromRevision, duplicateRole, findRole, RELATIONSHIP_LABEL, removedRole, removeRole, restoreRole, treeOrder, type KeyCommand, type RelationshipType, type Role } from './model';
import { ActiveWork, SaveRoleTemplate, SaveTeamTemplate, TemplateUpdate, ValidationPanel } from './panels';
import { basisWarning, composeAccepted, diffTeam, draftFromProposal, ghostView } from './proposal';
import { ProposalProgress, ProposalReview, ProposalTable, ProposeDrawer, useTeamProposals } from './proposal-ui';
import { TableView } from './table-view';
import { useDesigner } from './use-designer';
import { issuesByRole, validateDraft } from './validation';
import { WorkflowView } from './workflow-view';
import './team.css';

const TeamCanvas = lazy(() => import('./canvas/team-canvas'));
export type DesignerView = 'team' | 'workflow' | 'table';
const VIEWS: ReadonlyArray<{ view: DesignerView; label: string; icon: typeof LayoutGrid }> = [
  { view: 'team', label: 'Team', icon: LayoutGrid },
  { view: 'workflow', label: 'Workflow', icon: Workflow },
  { view: 'table', label: 'Table', icon: Rows3 },
];
const AGENT_POLL_MS = 30_000;
const NO_ISSUES: ReadonlyMap<string, never[]> = new Map();
/** A proposal preview is laid out afresh: its new roles have no saved place. */
const FRESH_LAYOUT: Positions = {};

const layoutKey = (projectId: string) => `studio-team-layout:${projectId}`;
function readPositions(projectId: string): Positions {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(layoutKey(projectId)) ?? '{}');
    return value && typeof value === 'object' ? (value as Positions) : {};
  } catch {
    return {};
  }
}
function writePositions(projectId: string, positions: Positions): void {
  try {
    localStorage.setItem(layoutKey(projectId), JSON.stringify(positions));
  } catch {
    // Positions are a convenience; without storage the next visit lays the team out again.
  }
}

/** Why Start in Room is not offered yet, or null when it is. */
export function startBlocker(state: NonNullable<ProjectState['snapshot']>, agents: ReadonlyMap<string, Agent>): string | null {
  const current = state.team.current;
  if (!current) return 'Publish the team first.';
  const draft = draftFromRevision(current.body);
  const coordinator = draft.roles.find((role) => role.coordinator);
  if (!coordinator) return 'The published team has no coordinator.';
  if (!coordinator.agent_ref) return `Bind an agent to ${coordinator.name}, then publish.`;
  const agent = agents.get(coordinator.agent_ref);
  if (!agent?.available) return `The agent bound to ${coordinator.name} is not available.`;
  const availability = new Map([...agents].map(([ref, item]) => [ref, item.available]));
  const verdict = state.team.draft || !state.team.validation ? validateDraft(draft, state.project.deliverables, availability) : state.team.validation;
  if (!verdict.can_publish) return 'The published team has errors.';
  return null;
}

function Designer({ state, store }: { state: NonNullable<ProjectState['snapshot']>; store: ProjectStore }) {
  const projectId = store.projectId;
  const search = useStudioSearch();
  const narrow = useNarrow();
  const requested = search.get('view');
  const view: DesignerView = requested === 'team' || requested === 'workflow' || requested === 'table' ? requested : narrow ? 'table' : 'team';
  const selected = search.get('role');
  const archived = state.project.status === 'archived';
  const agentsResource = useMagnusResource((signal) => listAgents(signal), [], { pollMs: AGENT_POLL_MS });
  const agents = useMemo(() => new Map((agentsResource.data?.agents ?? []).map((agent) => [agent.agent_ref, agent])), [agentsResource.data]);
  const deliverables = useMemo(() => state.project.deliverables.map((item) => ({ name: item.name, producer_role_key: item.producer_role_key })), [state.project.deliverables]);
  const designer = useDesigner(store, state.team, { archived, deliverables, agents: agentsResource.data });
  const { draft, edit, readOnly, validation } = designer;
  const issues = useMemo(() => issuesByRole(validation.issues), [validation.issues]);

  const [positions, setPositionsState] = useState<Positions>(() => readPositions(projectId));
  const setPositions = useCallback((next: Positions) => {
    setPositionsState(next);
    writePositions(projectId, next);
  }, [projectId]);
  const [layoutTick, setLayoutTick] = useState(0);
  const [focus, setFocus] = useState<{ key: string; tick: number } | null>(null);
  const [creating, setCreating] = useState<ReadonlySet<string>>(new Set());
  const [binding, setBinding] = useState<string | null>(null);
  const [newAgentFor, setNewAgentFor] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [inspecting, setInspecting] = useState(Boolean(selected));
  const [showIssues, setShowIssues] = useState(false);
  const [savingTeam, setSavingTeam] = useState(false);
  const [roleTemplate, setRoleTemplate] = useState<Role | null>(null);
  const [updating, setUpdating] = useState(false);
  const [connectType, setConnectType] = useState<RelationshipType>('reports_to');
  const [welcome, setWelcome] = useState(search.get('start') === '1');
  const toast = useToast();
  const produced = useDeliverables(store);

  // A coordinator-proposed team: progress, then a ghost diff over the team until it is accepted or discarded.
  const proposals = useTeamProposals(store);
  const record = proposals.latest;
  const [proposeOpen, setProposeOpen] = useState(false);
  const [hiddenProposal, setHiddenProposal] = useState<string | null>(null);
  const ready = record?.state === 'ready' && record.draft_body ? record : null;
  const reviewing = ready !== null && hiddenProposal !== ready.id;
  const proposed = useMemo(() => (ready ? draftFromProposal(ready.draft_body!) : null), [ready]);
  const agentName = useCallback((ref: string) => agents.get(ref)?.display_name ?? ref, [agents]);
  const diff = useMemo(() => (proposed ? diffTeam(draft, proposed, agentName) : null), [draft, proposed, agentName]);
  const ghost = useMemo(() => (proposed && diff ? ghostView(draft, proposed, diff) : null), [draft, proposed, diff]);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [confirmBasis, setConfirmBasis] = useState<{ mode: 'all' | 'selected'; warning: string } | null>(null);
  const [ghostFocus, setGhostFocus] = useState<{ key: string; tick: number } | null>(null);
  // Every changed role starts selected for a newly ready proposal.
  useEffect(() => {
    setChosen(new Set((diff?.roles ?? []).filter((item) => item.change !== 'same').map((item) => item.key)));
    setApplyError(null);
    // Only a different proposal resets the choice; edits to the draft keep it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready?.id]);

  async function accept(mode: 'all' | 'selected', confirmed = false) {
    if (!ready || !proposed || !diff) return;
    const warning = basisWarning(ready, state.team, designer.save.state !== 'saved');
    if (warning && !confirmed) {
      setConfirmBasis({ mode, warning });
      return;
    }
    const keys = new Set([...chosen].filter((key) => diff.roles.some((item) => item.key === key && item.change !== 'same')));
    // Accept all is the proposal's own draft body; accepting roles merges them into the draft on screen.
    const next = mode === 'all' ? proposed : composeAccepted(draft, proposed, diff, keys);
    setApplying(true);
    setApplyError(null);
    const saved = await designer.replace(next);
    setApplying(false);
    if (!saved) {
      setApplyError('The accepted changes could not be saved to the draft. See the message above, then try again.');
      return;
    }
    proposals.dismiss(ready.id);
    toast.success(mode === 'all' ? 'Applied the proposed team to the draft' : `Applied ${keys.size} proposed ${keys.size === 1 ? 'role' : 'roles'} to the draft`, 'Review it, bind each role, then publish.');
  }

  const select = useCallback((key: string | null) => setStudioQuery({ role: key }), []);
  const inspect = useCallback((key: string) => {
    setStudioQuery({ role: key });
    setInspecting(true);
  }, []);
  const focusRole = (key: string) => {
    select(key);
    setFocus((current) => ({ key, tick: (current?.tick ?? 0) + 1 }));
  };
  // A role that no longer exists is no longer selected.
  useEffect(() => {
    if (selected && !findRole(draft, selected)) setStudioQuery({ role: null });
  }, [selected, draft]);

  const source = state.team.draft?.source_template ?? state.team.current?.source_template ?? null;
  const pinned = useMagnusResource((signal) => getTemplate(source!.template_id, signal), [source?.template_id], { enabled: Boolean(source) });
  const update = source && pinned.data && pinned.data.latest_version > source.version && !pinned.data.archived ? pinned.data : null;

  // Both read the draft on screen, so the new role's key is known before the edit lands.
  const duplicate = (key: string) => {
    if (readOnly) return;
    const result = duplicateRole(draft, key);
    edit(() => result.draft);
    setTimeout(() => focusRole(result.key), 0);
  };
  const add = () => {
    if (readOnly) return;
    const result = addRole(draft);
    edit(() => result.draft);
    setTimeout(() => inspect(result.key), 0);
  };
  const command = (key: string, next: KeyCommand) => {
    if (next.kind === 'focus') focusRole(next.key);
    else if (next.kind === 'delete') requestDelete(key);
    else if (next.kind === 'duplicate') duplicate(key);
    else if (next.kind === 'layout') setLayoutTick((tick) => tick + 1);
    else if (next.kind === 'nudge') {
      const at = positions[key];
      if (at && !readOnly) setPositions({ ...positions, [key]: { x: at.x + next.dx, y: at.y + next.dy } });
    }
  };
  const connect = (from: string, to: string) => {
    // On the canvas a line is drawn from the upper role to the lower one; for structure that means the lower one reports.
    edit((current) => addRelationship(current, connectType === 'reports_to' ? { from: to, to: from, type: 'reports_to' } : { from, to, type: connectType }));
  };

  const errorCount = validation.issues.filter((issue) => issue.severity === 'error').length;
  const blocker = startBlocker(state, agents);
  const names = useMemo(() => new Map(draft.roles.map((role) => [role.key, role.name])), [draft.roles]);
  const draftRevision = state.team.draft?.revision ?? null;
  const currentRevision = state.team.current?.revision ?? null;
  const hasChanges = Boolean(state.team.draft) || designer.save.state !== 'saved';
  const saveText = { saved: 'Saved', pending: 'Unsaved changes', saving: 'Saving…', failed: 'Not saved', conflict: 'Conflict' }[designer.save.state];
  const role = selected ? findRole(draft, selected) : undefined;
  const activeFor = (key: string | null) => (key ? state.tasks.filter((task) => task.role_key === key).length : 0);
  // Work a role has: active tasks, and deliverables it produced. Unknown until the deliverables are read.
  const deliveredBy = (key: string | null) => (key && produced ? produced.filter((item) => item.producer_role === key).length : 0);
  const hasWork = (key: string) => activeFor(key) > 0 || produced === null || deliveredBy(key) > 0;
  const deleteRole = (key: string) => {
    const removed = removedRole(draft, key);
    if (!removed) return;
    const order = treeOrder(draft);
    const next = order[order.indexOf(key) - 1] ?? order[order.indexOf(key) + 1] ?? null;
    edit((current) => removeRole(current, key));
    if (next && next !== key) setTimeout(() => focusRole(next), 0);
    else select(null);
    return removed;
  };
  // A role with work asks first; one without is deleted at once, with Undo.
  const requestDelete = (key: string) => {
    if (readOnly) return;
    if (hasWork(key)) {
      setDeleting(key);
      return;
    }
    const removed = deleteRole(key);
    if (!removed) return;
    toast.info(`Deleted ${removed.role.name}`, 'The role and its relationships left the draft.', {
      label: 'Undo',
      onAction: () => {
        edit((current) => restoreRole(current, removed));
        setTimeout(() => focusRole(removed.role.key), 0);
      },
    });
  };
  const deletingWork = (() => {
    const tasks = activeFor(deleting);
    const delivered = deliveredBy(deleting);
    const parts = [
      tasks ? `${tasks} active ${tasks === 1 ? 'task' : 'tasks'}` : '',
      delivered ? `${delivered} ${delivered === 1 ? 'deliverable' : 'deliverables'}` : '',
    ].filter(Boolean);
    return parts.length ? `${(deleting && findRole(draft, deleting)?.name) ?? 'This role'} has ${parts.join(' and ')}. ` : '';
  })();
  const viewProps = { draft, agents, creating, issues, selected, readOnly };

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow={state.project.name}
        title="Team Assignment"
        description="Design the team, bind each role to an Ardent agent, publish, then start in the Room."
        status={
          <span className="studio-revision text-sm" role="status">
            {draftRevision ? <Badge tone="info">Draft r{draftRevision}</Badge> : null}
            {currentRevision ? <Badge tone="success">Current r{currentRevision}</Badge> : <Badge tone="neutral">Not published</Badge>}
            <span className={cn('text-xs', designer.save.state === 'failed' || designer.save.state === 'conflict' ? 'text-danger' : 'text-text-muted')}>{hasChanges ? saveText : null}</span>
          </span>
        }
        actions={
          <>
            <StudioLink href={galleryHref({ projectId })} className="btn no-underline">
              <Library className="btn-ico" aria-hidden="true" />
              Gallery
            </StudioLink>
            <Button icon={<BookmarkPlus className="size-4" />} onClick={() => setSavingTeam(true)} disabled={!draft.roles.length}>
              Save as template
            </Button>
            <Button
              variant="primary"
              icon={<Upload className="size-4" />}
              loading={designer.publishing}
              disabled={readOnly || !hasChanges || !validation.can_publish}
              title={!validation.can_publish ? 'Fix the errors before publishing' : undefined}
              onClick={() => void designer.publish()}
            >
              Publish
            </Button>
            {blocker ? (
              <Button icon={<Play className="size-4" />} disabled title={blocker} aria-describedby="studio-start-blocker">
                Start in Room
              </Button>
            ) : (
              <StudioLink href={projectHref(projectId, '/room')} className="btn btn--primary no-underline">
                <Play className="btn-ico" aria-hidden="true" />
                Start in Room
              </StudioLink>
            )}
          </>
        }
      />
      {blocker ? (
        <p id="studio-start-blocker" className="m-0 text-xs text-text-muted">
          Start in Room: {blocker}
        </p>
      ) : null}
      {welcome ? (
        <div className="info-banner studio-banner text-sm" role="status">
          <span>Bind each role, then Start in Room.</span>
          <button type="button" className="btn btn--ghost btn--icon btn--sm" aria-label="Dismiss" onClick={() => { setWelcome(false); setStudioQuery({ start: null }); }}>
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}
      {designer.save.state === 'failed' || designer.save.state === 'conflict' ? (
        <div className="warning-banner studio-banner text-sm" role="alert">
          <span>{designer.save.message}</span>
          {designer.save.state === 'conflict' ? (
            <Button size="sm" onClick={designer.reload}>
              Reload
            </Button>
          ) : (
            <Button size="sm" onClick={() => void designer.flush()}>
              Retry
            </Button>
          )}
        </div>
      ) : null}
      {designer.publishError ? <p role="alert" className="m-0 text-sm text-danger">{designer.publishError}</p> : null}
      {update && source && !readOnly ? (
        <div className="info-banner studio-banner text-sm" role="status">
          <span>
            <ArrowUpCircle className="mr-1 inline size-4" aria-hidden="true" />
            {update.name} has version {update.latest_version}; this team uses version {source.version}.
          </span>
          <Button size="sm" onClick={() => setUpdating(true)}>
            Review changes
          </Button>
        </div>
      ) : null}

      <div className="studio-toolbar" role="toolbar" aria-label="Team design">
        <div role="group" aria-label="View" className="segmented-tabs">
          {VIEWS.map(({ view: option, label, icon: Icon }) => (
            <button key={option} type="button" aria-pressed={view === option} className={cn('tab-button', view === option && 'tab-button--active')} onClick={() => setStudioQuery({ view: option })}>
              <Icon className="mr-1 inline size-4" aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
        <Button size="sm" icon={<Plus className="size-4" />} disabled={readOnly || draft.roles.length >= 30} onClick={add}>
          Role
        </Button>
        {view === 'team' ? (
          <>
            <Button size="sm" variant="ghost" disabled={!draft.roles.length} onClick={() => setLayoutTick((tick) => tick + 1)} title="Shortcut: A">
              Auto-layout
            </Button>
            <label className="studio-connect text-xs text-text-muted">
              New lines
              <select value={connectType} disabled={readOnly} onChange={(event) => setConnectType(event.target.value as RelationshipType)}>
                {(Object.keys(RELATIONSHIP_LABEL) as RelationshipType[]).map((type) => (
                  <option key={type} value={type}>
                    {RELATIONSHIP_LABEL[type]}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}
        <Button size="sm" variant="ghost" icon={<Sparkles className="size-4" />} disabled={readOnly} onClick={() => setProposeOpen(true)}>
          Propose team
        </Button>
        <Button size="sm" variant={showIssues ? 'default' : 'ghost'} aria-expanded={showIssues} icon={errorCount ? <ListChecks className="size-4 text-danger" /> : <CheckCircle2 className="size-4" />} onClick={() => setShowIssues((value) => !value)}>
          Validate ({validation.issues.length})
        </Button>
      </div>
      {showIssues ? <ValidationPanel validation={validation} confirmed={designer.confirmed} names={names} onPick={(key) => inspect(key)} /> : null}
      {record && !reviewing ? (
        <ProposalProgress record={record} agentName={agentName(record.agent_ref)} proposals={proposals} readOnly={readOnly} onReview={() => setHiddenProposal(null)} onRetry={() => setProposeOpen(true)} />
      ) : null}

      <ActiveWork tasks={state.tasks} current={currentRevision} names={names} readOnly={readOnly} onReassigned={() => void store.refetch()} />

      <div className={cn('studio-designer', reviewing ? 'studio-designer--reviewing' : role && inspecting && !narrow && 'studio-designer--inspecting')}>
        <div className="studio-designer__view">
          {reviewing && ghost ? (
            view === 'team' ? (
              <>
                <Suspense fallback={<Panel aria-busy="true"><LoadingRows rows={5} /></Panel>}>
                  <TeamCanvas
                    draft={ghost.draft}
                    ghost={ghost}
                    agents={agents}
                    creating={creating}
                    issues={NO_ISSUES}
                    selected={null}
                    readOnly
                    label={`Proposed team preview: ${ghost.draft.roles.length} roles. Tab moves through roles; arrows move between manager, reports and siblings; Enter goes to the role's accept box.`}
                    positions={FRESH_LAYOUT}
                    focus={ghostFocus}
                    layoutTick={layoutTick}
                    onInspect={(key) => document.getElementById(`proposal-role-${key}`)?.focus()}
                    onCommand={(_key, next) => {
                      if (next.kind === 'focus') setGhostFocus((current) => ({ key: next.key, tick: (current?.tick ?? 0) + 1 }));
                      else if (next.kind === 'layout') setLayoutTick((tick) => tick + 1);
                    }}
                  />
                </Suspense>
                <EdgeLegend />
              </>
            ) : (
              <>
                {view === 'workflow' ? <p className="m-0 text-sm text-text-muted">The proposal preview shows in the Team and Table views.</p> : null}
                <ProposalTable draft={ghost.draft} ghost={ghost} agents={agents} />
              </>
            )
          ) : draft.roles.length === 0 ? (
            <Panel>
              <div className="empty-state">
                <p className="empty-state__title">No roles yet</p>
                <p className="empty-state__message">Add the coordinator first: every other role reports to it. Or start from a template in the Gallery.</p>
                <div className="empty-state__action flex flex-wrap justify-center gap-2">
                  <Button variant="primary" icon={<Plus className="size-4" />} disabled={readOnly} onClick={add}>
                    Add a role
                  </Button>
                  <StudioLink href={galleryHref({ projectId })} className="btn no-underline">
                    Browse templates
                  </StudioLink>
                </div>
              </div>
            </Panel>
          ) : view === 'team' ? (
            <>
              <Suspense fallback={<Panel aria-busy="true"><LoadingRows rows={5} /></Panel>}>
                <TeamCanvas
                  {...viewProps}
                  label={`Team canvas: ${draft.roles.length} roles. Tab moves through roles in reporting order; Enter opens a role; arrows move between manager, reports and siblings; Delete removes; Shift and an arrow nudges; A lays out; Control or Command D duplicates.`}
                  positions={positions}
                  focus={focus}
                  layoutTick={layoutTick}
                  onSelect={select}
                  onInspect={inspect}
                  onCommand={command}
                  onPositions={readOnly ? undefined : setPositions}
                  onConnect={connect}
                />
              </Suspense>
              <EdgeLegend />
            </>
          ) : view === 'workflow' ? (
            <WorkflowView {...viewProps} edit={edit} onSelect={select} onInspect={inspect} />
          ) : (
            <TableView {...viewProps} edit={edit} onSelect={select} onInspect={inspect} onBind={setBinding} onDuplicate={duplicate} onDelete={requestDelete} />
          )}
        </div>
        {role && inspecting && !reviewing ? (
          <RoleInspector
            narrow={narrow}
            draft={draft}
            roleKey={role.key}
            agents={agents}
            creating={creating}
            issues={issues.get(role.key) ?? []}
            files={state.files}
            requestedDeliverables={state.project.deliverables.map((item) => item.name)}
            readOnly={readOnly}
            edit={edit}
            onClose={() => setInspecting(false)}
            onBind={setBinding}
            onNewAgent={setNewAgentFor}
            onDuplicate={duplicate}
            onDelete={requestDelete}
            onSaveAsTemplate={setRoleTemplate}
          />
        ) : null}
        {reviewing && ready && diff ? (
          <ProposalReview
            record={ready}
            diff={diff}
            agentName={agentName(ready.agent_ref)}
            selected={chosen}
            readOnly={readOnly}
            applying={applying}
            applyError={applyError}
            onSelect={(key, on) => setChosen((current) => (on ? new Set(current).add(key) : new Set([...current].filter((item) => item !== key))))}
            onAcceptAll={() => void accept('all')}
            onAcceptSelected={() => void accept('selected')}
            onDiscard={() => proposals.dismiss(ready.id)}
            onHide={() => setHiddenProposal(ready.id)}
          />
        ) : null}
      </div>

      <BindPicker
        open={binding !== null}
        roleName={(binding && findRole(draft, binding)?.name) ?? ''}
        current={(binding && findRole(draft, binding)?.agent_ref) ?? null}
        agents={agentsResource}
        onPick={(ref) => {
          if (binding) edit((current) => bindRole(current, binding, ref));
          setBinding(null);
        }}
        onNewAgent={() => {
          setNewAgentFor(binding);
          setBinding(null);
        }}
        onClose={() => setBinding(null)}
      />
      <NewAgentDrawer
        open={newAgentFor !== null}
        roleName={(newAgentFor && findRole(draft, newAgentFor)?.name) ?? ''}
        onDeployStarted={() => newAgentFor && setCreating((current) => new Set(current).add(newAgentFor))}
        onCreated={(ref) => {
          const key = newAgentFor;
          if (key) edit((current) => bindRole(current, key, ref));
          setCreating((current) => new Set([...current].filter((item) => item !== key)));
          setNewAgentFor(null);
          void agentsResource.refresh();
        }}
        onClose={() => {
          const key = newAgentFor;
          setCreating((current) => new Set([...current].filter((item) => item !== key)));
          setNewAgentFor(null);
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        title={`Delete ${(deleting && findRole(draft, deleting)?.name) ?? 'role'}?`}
        message={`${deletingWork}The role and its relationships leave the draft. The published team keeps it until you publish.${activeFor(deleting) ? ` ${activeFor(deleting) === 1 ? 'Its task keeps' : 'Its tasks keep'} running under the revision it started with; reassign or cancel from Active work.` : ''}${deliveredBy(deleting) ? ' Delivered files stay in Review.' : ''}`}
        confirmLabel="Delete role"
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          deleteRole(deleting!);
          setDeleting(null);
        }}
      />
      <ProposeDrawer
        open={proposeOpen}
        agents={agentsResource}
        coordinator={(() => {
          const coordinator = draft.roles.find((item) => item.coordinator);
          return coordinator ? { name: coordinator.name, agent_ref: coordinator.agent_ref } : null;
        })()}
        proposals={proposals}
        readOnly={readOnly}
        onClose={() => setProposeOpen(false)}
      />
      <ConfirmDialog
        open={confirmBasis !== null}
        title="The team changed since this proposal"
        message={`${confirmBasis?.warning ?? ''} ${confirmBasis?.mode === 'all' ? 'Accept all replaces the draft with the proposed team, so those changes would be undone.' : 'The accepted roles are merged into the draft as it is now; check the result before publishing.'}`}
        confirmLabel={confirmBasis?.mode === 'all' ? 'Replace the draft' : 'Apply the selected roles'}
        tone="warning"
        loading={applying}
        onCancel={() => setConfirmBasis(null)}
        onConfirm={() => {
          const mode = confirmBasis!.mode;
          setConfirmBasis(null);
          void accept(mode, true);
        }}
      />
      <SaveTeamTemplate open={savingTeam} projectId={projectId} hasDraft={Boolean(state.team.draft)} source={source} onClose={() => setSavingTeam(false)} />
      <SaveRoleTemplate role={roleTemplate} onClose={() => setRoleTemplate(null)} />
      {update && source ? (
        <TemplateUpdate
          open={updating}
          source={source}
          latest={update.latest_version}
          draft={draft}
          onClose={() => setUpdating(false)}
          onApply={(next, version) => {
            designer.pinTemplate({ template_id: source.template_id, version });
            edit(() => next);
            setUpdating(false);
          }}
        />
      ) : null}
    </div>
  );
}

/** /studio/p/:id/team: Team Assignment ▸ Designer. */
export function TeamDesigner({ projectId }: { projectId: string }) {
  const { store } = useProject(projectId);
  return <ProjectFrame projectId={projectId}>{(state) => <Designer state={state.snapshot} store={store} />}</ProjectFrame>;
}
