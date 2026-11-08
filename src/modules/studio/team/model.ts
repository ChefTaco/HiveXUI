// The team being designed, as plain data, and every edit as a pure function. The canvas, the
// Workflow view, the Table view and the inspector all edit through these, so they cannot disagree.
import { RELATIONSHIP_TYPES, STAGES } from '@contracts/ardentstudio.generated';
import type { TeamRevision } from '../api/endpoints';

export type Stage = (typeof STAGES)[number];
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];
export interface SkillRef {
  kind: 'local' | 'hiveskills';
  ref: string;
  channel?: string | undefined;
}
export interface Relationship {
  from: string;
  to: string;
  type: RelationshipType;
  stage?: Stage | null | undefined;
  label?: string | undefined;
}
export interface Role {
  key: string;
  name: string;
  coordinator: boolean;
  responsibilities_md: string;
  instructions_md: string;
  contributions: string[];
  deliverables: string[];
  agent_template_ref: { template_id: string; version: number } | null;
  skills: SkillRef[];
  stage: Stage | null;
  agent_ref: string | null;
  knowledge: string[];
}
export interface TeamDraft {
  roles: Role[];
  relationships: Relationship[];
  stages: Stage[];
}

export const RELATIONSHIP_LABEL: Record<RelationshipType, string> = {
  reports_to: 'reports to',
  delegates_to: 'delegates to',
  hands_off_to: 'hands off to',
  reviews: 'reviews',
};
export const RELATIONSHIP_MEANING: Record<RelationshipType, string> = {
  reports_to: 'Structure: one coordinator at the root',
  delegates_to: 'Who may assign work',
  hands_off_to: 'Workflow order; only a revise loop may cycle',
  reviews: 'Review stage',
};
export const STAGE_LABEL: Record<Stage, string> = { create: 'Create', research: 'Research', discuss: 'Discuss', review: 'Review', revise: 'Revise', deliver: 'Deliver' };

/** A published or draft revision's body as an editable draft: bindings are the agent refs alone. */
export function draftFromRevision(body: TeamRevision['body']): TeamDraft {
  return {
    roles: body.roles.map(({ binding_id: _binding, ...role }) => ({
      ...role,
      contributions: [...role.contributions],
      deliverables: [...role.deliverables],
      skills: role.skills.map((skill) => ({ ...skill })),
      knowledge: [...role.knowledge],
    })),
    relationships: body.relationships.map((edge) => ({ ...edge })),
    stages: [...body.stages],
  };
}
export const emptyDraft = (): TeamDraft => ({ roles: [], relationships: [], stages: [] });

/** A stable text for comparing drafts, such as the saved one and the one on screen. */
export const draftSignature = (draft: TeamDraft): string => JSON.stringify(draft);

/** A role key from a name, unique among `taken`. Keys match ^[a-z][a-z0-9_-]{0,47}$. */
export function roleKey(name: string, taken: ReadonlySet<string>): string {
  let base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'role';
  if (!/^[a-z]/.test(base)) base = `role_${base}`;
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base}_${n}`;
  return key;
}

const blankRole = (key: string, name: string): Role => ({
  key,
  name,
  coordinator: false,
  responsibilities_md: '',
  instructions_md: '',
  contributions: [],
  deliverables: [],
  agent_template_ref: null,
  skills: [],
  stage: null,
  agent_ref: null,
  knowledge: [],
});

const keys = (draft: TeamDraft) => new Set(draft.roles.map((role) => role.key));
export const findRole = (draft: TeamDraft, key: string): Role | undefined => draft.roles.find((role) => role.key === key);
export const coordinatorOf = (draft: TeamDraft): Role | undefined => draft.roles.find((role) => role.coordinator);

/** Adds a role. The first role becomes the coordinator; later ones report to it. */
export function addRole(draft: TeamDraft, name = 'New role'): { draft: TeamDraft; key: string } {
  const key = roleKey(name, keys(draft));
  const coordinator = coordinatorOf(draft);
  const role = { ...blankRole(key, name), coordinator: draft.roles.length === 0 };
  return {
    key,
    draft: {
      ...draft,
      roles: [...draft.roles, role],
      relationships: coordinator ? [...draft.relationships, { from: key, to: coordinator.key, type: 'reports_to' }] : draft.relationships,
    },
  };
}

/** Removes a role and every relationship that names it. */
export function removeRole(draft: TeamDraft, key: string): TeamDraft {
  return { ...draft, roles: draft.roles.filter((role) => role.key !== key), relationships: draft.relationships.filter((edge) => edge.from !== key && edge.to !== key) };
}

export function updateRole(draft: TeamDraft, key: string, patch: Partial<Omit<Role, 'key' | 'coordinator'>>): TeamDraft {
  return { ...draft, roles: draft.roles.map((role) => (role.key === key ? { ...role, ...patch } : role)) };
}

/** Makes one role the coordinator, the root of the reporting tree, and the only one. */
export function setCoordinator(draft: TeamDraft, key: string): TeamDraft {
  return {
    ...draft,
    roles: draft.roles.map((role) => ({ ...role, coordinator: role.key === key })),
    // The root reports to no one.
    relationships: draft.relationships.filter((edge) => !(edge.type === 'reports_to' && edge.from === key)),
  };
}

/** A copy beside the original, without its binding: an agent is bound to one role on purpose. */
export function duplicateRole(draft: TeamDraft, key: string): { draft: TeamDraft; key: string } {
  const source = findRole(draft, key);
  if (!source) return { draft, key };
  const name = `${source.name} copy`.slice(0, 200);
  const copyKey = roleKey(name, keys(draft));
  const copy: Role = { ...structuredClone(source), key: copyKey, name, coordinator: false, agent_ref: null };
  const manager = draft.relationships.find((edge) => edge.type === 'reports_to' && edge.from === key);
  const at = draft.roles.findIndex((role) => role.key === key);
  return {
    key: copyKey,
    draft: {
      ...draft,
      roles: [...draft.roles.slice(0, at + 1), copy, ...draft.roles.slice(at + 1)],
      relationships: manager ? [...draft.relationships, { from: copyKey, to: manager.to, type: 'reports_to' }] : draft.relationships,
    },
  };
}

export const bindRole = (draft: TeamDraft, key: string, agentRef: string | null): TeamDraft => updateRole(draft, key, { agent_ref: agentRef });

/** Adds a relationship unless the same one exists. Reporting to a second manager replaces the first. */
export function addRelationship(draft: TeamDraft, edge: Relationship): TeamDraft {
  if (edge.from === edge.to) return draft;
  if (draft.relationships.some((item) => item.from === edge.from && item.to === edge.to && item.type === edge.type && (item.stage ?? null) === (edge.stage ?? null))) return draft;
  const kept = edge.type === 'reports_to' ? draft.relationships.filter((item) => !(item.type === 'reports_to' && item.from === edge.from)) : draft.relationships;
  return { ...draft, relationships: [...kept, edge] };
}
export const removeRelationship = (draft: TeamDraft, index: number): TeamDraft => ({ ...draft, relationships: draft.relationships.filter((_, at) => at !== index) });
export const updateRelationship = (draft: TeamDraft, index: number, edge: Relationship): TeamDraft => ({ ...draft, relationships: draft.relationships.map((item, at) => (at === index ? edge : item)) });

/** Sets who a role reports to; null removes its reporting line. */
export function setManager(draft: TeamDraft, key: string, manager: string | null): TeamDraft {
  const kept = draft.relationships.filter((edge) => !(edge.type === 'reports_to' && edge.from === key));
  return { ...draft, relationships: manager && manager !== key ? [...kept, { from: key, to: manager, type: 'reports_to' }] : kept };
}
export const managerOf = (draft: TeamDraft, key: string): string | null => draft.relationships.find((edge) => edge.type === 'reports_to' && edge.from === key)?.to ?? null;

/** Stages in workflow order, with the role's own stage included even when the team does not list it. */
export const orderedStages = (stages: readonly Stage[]): Stage[] => STAGES.filter((stage) => stages.includes(stage));

// ── Tree order and keyboard movement ──

/** Roles in reporting-tree order: the coordinator, then each subtree depth first, then anyone outside the tree. */
export function treeOrder(draft: TeamDraft): string[] {
  const children = new Map<string, string[]>();
  for (const role of draft.roles) children.set(role.key, []);
  for (const edge of draft.relationships) if (edge.type === 'reports_to' && children.has(edge.to) && children.has(edge.from)) children.get(edge.to)!.push(edge.from);
  // Children keep the order the roles are listed in.
  const position = new Map(draft.roles.map((role, index) => [role.key, index]));
  for (const list of children.values()) list.sort((a, b) => position.get(a)! - position.get(b)!);
  const order: string[] = [];
  const seen = new Set<string>();
  const visit = (key: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    order.push(key);
    for (const child of children.get(key) ?? []) visit(child);
  };
  const root = coordinatorOf(draft);
  if (root) visit(root.key);
  for (const role of draft.roles) if (!managerOf(draft, role.key) || !seen.has(role.key)) visit(role.key);
  return order;
}

export type Direction = 'up' | 'down' | 'left' | 'right';
/** Arrow keys move through the tree: up to the manager, down to the first report, left and right between siblings. */
export function neighbour(draft: TeamDraft, key: string, direction: Direction): string | null {
  const order = treeOrder(draft);
  const parent = managerOf(draft, key);
  if (direction === 'up') return parent && findRole(draft, parent) ? parent : null;
  if (direction === 'down') return order.find((item) => managerOf(draft, item) === key) ?? null;
  const siblings = order.filter((item) => (managerOf(draft, item) ?? null) === (parent && findRole(draft, parent) ? parent : null) && (parent !== null || !managerOf(draft, item)));
  const at = siblings.indexOf(key);
  const next = siblings[at + (direction === 'right' ? 1 : -1)];
  return next ?? null;
}

export type KeyCommand =
  | { kind: 'focus'; key: string }
  | { kind: 'inspect' }
  | { kind: 'delete' }
  | { kind: 'nudge'; dx: number; dy: number }
  | { kind: 'layout' }
  | { kind: 'duplicate' };
const ARROWS: Record<string, Direction> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
export const NUDGE = 16;

/** The designer's keyboard model for a focused role card, or null when the key means nothing here. */
export function keyCommand(draft: TeamDraft, key: string, event: { key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }): KeyCommand | null {
  const direction = ARROWS[event.key];
  if (direction && event.shiftKey) return { kind: 'nudge', dx: direction === 'left' ? -NUDGE : direction === 'right' ? NUDGE : 0, dy: direction === 'up' ? -NUDGE : direction === 'down' ? NUDGE : 0 };
  if (direction && !event.ctrlKey && !event.metaKey && !event.altKey) {
    const next = neighbour(draft, key, direction);
    return next ? { kind: 'focus', key: next } : null;
  }
  if (event.key === 'Enter') return { kind: 'inspect' };
  if (event.key === 'Delete' || event.key === 'Backspace') return { kind: 'delete' };
  if ((event.key === 'd' || event.key === 'D') && (event.ctrlKey || event.metaKey) && !event.altKey) return { kind: 'duplicate' };
  if ((event.key === 'a' || event.key === 'A') && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) return { kind: 'layout' };
  return null;
}

/** Lines of a textarea as a list, trimmed and without blanks. */
export const listFromText = (text: string, max = 30): string[] => text.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, max);
