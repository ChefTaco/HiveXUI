// A coordinator-proposed team against the team on screen: what each role and relationship would
// become, the merged draft for the roles a person accepts, and whether the team moved since the
// proposal was asked for. Pure; nothing here sends or applies anything.
import type { TeamProposalRecord, TeamState } from '../api/endpoints';
import { addRelationship, orderedStages, RELATIONSHIP_LABEL, STAGE_LABEL, type Relationship, type Role, type Stage, type TeamDraft } from './model';

export type GhostChange = 'added' | 'changed' | 'removed' | 'same';

export interface FieldChange {
  field: string;
  label: string;
  before: string;
  after: string;
}
export interface RoleDiff {
  key: string;
  /** The proposed name, or the current one for a removed role. */
  name: string;
  change: GhostChange;
  fields: FieldChange[];
  /** Relationships this role would gain or lose. */
  edges: EdgeDiff[];
  before: Role | null;
  after: Role | null;
}
export interface EdgeDiff {
  edge: Relationship;
  change: 'added' | 'removed' | 'same';
  /** The role whose acceptance brings this change: a new or removed end, else the role that acts. */
  owner: string;
}
export interface TeamDiff {
  roles: RoleDiff[];
  edges: EdgeDiff[];
  stages: { before: Stage[]; after: Stage[] } | null;
  /** Roles with any change. */
  changed: number;
}

const FIELDS = ['name', 'coordinator', 'responsibilities_md', 'instructions_md', 'contributions', 'deliverables', 'skills', 'stage', 'agent_template_ref', 'agent_ref', 'knowledge'] as const;
type DiffField = (typeof FIELDS)[number];
const FIELD_LABEL: Record<DiffField, string> = {
  name: 'Name',
  coordinator: 'Coordinator',
  responsibilities_md: 'Responsibilities',
  instructions_md: 'Instructions',
  contributions: 'Contributions',
  deliverables: 'Deliverables',
  skills: 'Skills',
  stage: 'Stage',
  agent_template_ref: 'Agent template',
  agent_ref: 'Agent',
  knowledge: 'Knowledge',
};

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
export const edgeKey = (edge: Relationship): string => `${edge.from}|${edge.type}|${edge.to}|${edge.stage ?? ''}`;

function show(field: DiffField, value: unknown, agentName: (ref: string) => string): string {
  if (value === null || value === undefined || value === '') return '—';
  if (field === 'coordinator') return value ? 'Yes' : 'No';
  if (field === 'agent_ref') return agentName(String(value));
  if (field === 'stage') return STAGE_LABEL[value as Stage] ?? String(value);
  if (field === 'knowledge') return Array.isArray(value) ? `${value.length} ${value.length === 1 ? 'file' : 'files'}` : '—';
  if (field === 'agent_template_ref') {
    const ref = value as { template_id: string; version: number };
    return `${ref.template_id} v${ref.version}`;
  }
  if (Array.isArray(value)) return value.length ? value.map((item) => (typeof item === 'object' && item ? (item as { ref?: string }).ref ?? JSON.stringify(item) : String(item))).join(', ') : '—';
  const text = String(value);
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}

/** A proposal's draft body as an editable draft. */
export function draftFromProposal(body: NonNullable<TeamProposalRecord['draft_body']>): TeamDraft {
  return {
    roles: body.roles.map((role) => ({
      ...role,
      contributions: [...role.contributions],
      deliverables: [...role.deliverables],
      skills: role.skills.map((skill) => ({ ...skill })),
      agent_template_ref: role.agent_template_ref ? { ...role.agent_template_ref } : null,
      knowledge: [...role.knowledge],
    })),
    relationships: body.relationships.map((edge) => ({ ...edge })),
    stages: [...body.stages],
  };
}

/** How the proposed team differs from the current one, role by role. */
export function diffTeam(current: TeamDraft, proposed: TeamDraft, agentName: (ref: string) => string = (ref) => ref): TeamDiff {
  const before = new Map(current.roles.map((role) => [role.key, role]));
  const after = new Map(proposed.roles.map((role) => [role.key, role]));
  const owner = (edge: Relationship, removed: boolean): string => {
    const known = removed ? (key: string) => !after.has(key) : (key: string) => !before.has(key);
    return known(edge.from) ? edge.from : known(edge.to) ? edge.to : edge.from;
  };
  const currentEdges = new Set(current.relationships.map(edgeKey));
  const proposedEdges = new Set(proposed.relationships.map(edgeKey));
  const edges: EdgeDiff[] = [
    ...current.relationships.map((edge): EdgeDiff => ({ edge, change: proposedEdges.has(edgeKey(edge)) ? 'same' : 'removed', owner: owner(edge, true) })),
    ...proposed.relationships.filter((edge) => !currentEdges.has(edgeKey(edge))).map((edge): EdgeDiff => ({ edge, change: 'added', owner: owner(edge, false) })),
  ];
  const edgesOf = (key: string) => edges.filter((item) => item.change !== 'same' && item.owner === key);

  const roles: RoleDiff[] = [];
  for (const role of proposed.roles) {
    const previous = before.get(role.key);
    if (!previous) {
      roles.push({ key: role.key, name: role.name, change: 'added', fields: [], edges: edgesOf(role.key), before: null, after: role });
      continue;
    }
    const fields = FIELDS.filter((field) => !same(previous[field], role[field])).map((field) => ({ field, label: FIELD_LABEL[field], before: show(field, previous[field], agentName), after: show(field, role[field], agentName) }));
    const own = edgesOf(role.key);
    roles.push({ key: role.key, name: role.name, change: fields.length || own.length ? 'changed' : 'same', fields, edges: own, before: previous, after: role });
  }
  for (const role of current.roles) {
    if (!after.has(role.key)) roles.push({ key: role.key, name: role.name, change: 'removed', fields: [], edges: edgesOf(role.key), before: role, after: null });
  }
  return {
    roles,
    edges,
    stages: same(orderedStages(current.stages), orderedStages(proposed.stages)) ? null : { before: orderedStages(current.stages), after: orderedStages(proposed.stages) },
    changed: roles.filter((item) => item.change !== 'same').length,
  };
}

/**
 * The current draft with the accepted roles' changes: added roles join, changed roles take the
 * proposed fields, removed roles leave, and each relationship change comes with the role that owns
 * it (a line to a role that is not there is left out). Stages the accepted roles use are added.
 */
export function composeAccepted(current: TeamDraft, proposed: TeamDraft, diff: TeamDiff, accepted: ReadonlySet<string>): TeamDraft {
  let roles = current.roles.map((role) => role);
  for (const item of diff.roles) {
    if (!accepted.has(item.key) || item.change === 'same') continue;
    if (item.change === 'added') roles = [...roles, structuredClone(item.after!)];
    else if (item.change === 'changed') roles = roles.map((role) => (role.key === item.key ? structuredClone(item.after!) : role));
    else roles = roles.filter((role) => role.key !== item.key);
  }
  const coordinator = proposed.roles.find((role) => role.coordinator);
  const crowned = coordinator && accepted.has(coordinator.key) && roles.some((role) => role.key === coordinator.key);
  if (crowned) roles = roles.map((role) => (role.coordinator === (role.key === coordinator.key) ? role : { ...role, coordinator: role.key === coordinator.key }));
  const keys = new Set(roles.map((role) => role.key));
  const dropped = new Set(diff.edges.filter((item) => item.change === 'removed' && accepted.has(item.owner)).map((item) => edgeKey(item.edge)));
  let draft: TeamDraft = {
    roles,
    relationships: current.relationships.filter((edge) => !dropped.has(edgeKey(edge)) && keys.has(edge.from) && keys.has(edge.to)),
    stages: current.stages,
  };
  for (const item of diff.edges) {
    if (item.change === 'added' && accepted.has(item.owner) && keys.has(item.edge.from) && keys.has(item.edge.to)) draft = addRelationship(draft, { ...item.edge });
  }
  // The coordinator is the root of the reporting tree.
  if (crowned) draft = { ...draft, relationships: draft.relationships.filter((edge) => !(edge.type === 'reports_to' && edge.from === coordinator.key)) };
  const used = new Set(roles.filter((role) => accepted.has(role.key)).map((role) => role.stage).filter((stage): stage is Stage => stage !== null));
  for (const item of diff.edges) if (item.change === 'added' && accepted.has(item.owner) && item.edge.stage) used.add(item.edge.stage);
  const stages = orderedStages([...new Set([...current.stages, ...proposed.stages.filter((stage) => used.has(stage))])]);
  return { ...draft, stages };
}

export interface GhostView {
  /** Every current role and relationship plus the proposed ones, to draw the difference. */
  draft: TeamDraft;
  roles: ReadonlyMap<string, GhostChange>;
  /** By index into draft.relationships. */
  edges: readonly GhostChange[];
}

/** The team as the canvas draws it during a review: changed roles as proposed, removed ones kept and marked. */
export function ghostView(current: TeamDraft, proposed: TeamDraft, diff: TeamDiff): GhostView {
  const after = new Map(proposed.roles.map((role) => [role.key, role]));
  const roles = [
    ...current.roles.map((role) => after.get(role.key) ?? role),
    ...proposed.roles.filter((role) => !current.roles.some((item) => item.key === role.key)),
  ].map((role) => ({ ...role, coordinator: after.has(role.key) ? after.get(role.key)!.coordinator : false }));
  return {
    draft: { roles, relationships: diff.edges.map((item) => item.edge), stages: orderedStages([...new Set([...current.stages, ...proposed.stages])]) },
    roles: new Map(diff.roles.map((item) => [item.key, item.change])),
    edges: diff.edges.map((item) => item.change),
  };
}

/** Why applying the proposal may undo something: the team moved after it was asked for. Null when it did not. */
export function basisWarning(record: Pick<TeamProposalRecord, 'basis' | 'created_at'>, team: TeamState, unsaved: boolean): string | null {
  const current = team.current?.revision ?? null;
  const draft = team.draft?.revision ?? null;
  if (current !== record.basis.current_revision)
    return current === null ? 'The published team changed after the proposal was asked for.' : `The team was published as r${current} after the proposal was asked for${record.basis.current_revision ? ` against r${record.basis.current_revision}` : ''}.`;
  if (draft !== record.basis.draft_revision) return draft === null ? 'The team draft was published or discarded after the proposal was asked for.' : 'A new team draft was started after the proposal was asked for.';
  if (team.draft && Date.parse(team.draft.updated_at) > Date.parse(record.created_at)) return 'The team draft was edited after the proposal was asked for.';
  if (unsaved) return 'This page has team edits that are not saved yet.';
  return null;
}

export interface ProposalStatus {
  title: string;
  /** One line from the record: the agent's progress, a retry and why, or the outcome. */
  detail: string | null;
  tone: 'info' | 'warning' | 'success' | 'danger' | 'neutral';
  /** Queued or running: the proposal can still be cancelled. */
  open: boolean;
}

/** The proposal's state in words, with the validation error of an invalid first reply. */
export function proposalStatus(record: TeamProposalRecord): ProposalStatus {
  const attempt = record.attempts.length;
  const retry = attempt > 1;
  const invalid = record.attempts.find((item) => item.outcome === 'invalid' && item.error)?.error ?? null;
  switch (record.state) {
    case 'queued':
    case 'running': {
      const title = retry ? `Attempt ${attempt} of 2: ${record.state === 'queued' ? 'queued again' : 'retrying'}` : record.state === 'queued' ? 'Queued' : 'Working';
      const detail = retry && invalid ? `The first reply did not validate: ${invalid}` : record.progress;
      return { title, detail, tone: retry ? 'warning' : 'info', open: true };
    }
    case 'ready':
      return { title: 'Ready to review', detail: record.progress, tone: 'success', open: false };
    case 'failed': {
      const last = [...record.attempts].reverse().find((item) => item.error)?.error ?? null;
      const detail = record.error && last && !record.error.includes(last) ? `${record.error} ${last}` : record.error ?? last ?? record.progress;
      return { title: retry ? 'Failed after a retry' : 'Failed', detail, tone: 'danger', open: false };
    }
    case 'cancelled':
      return { title: 'Cancelled', detail: record.progress, tone: 'neutral', open: false };
  }
}

/** A relationship in words, for lists and screen readers. */
export const edgeText = (edge: Relationship, name: (key: string) => string): string =>
  `${name(edge.from)} ${RELATIONSHIP_LABEL[edge.type]} ${name(edge.to)}${edge.stage === 'revise' ? ' (revise loop)' : ''}`;
