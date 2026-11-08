// What changed between two versions of a team template, as changes the operator can apply one by
// one to a project's draft. Nothing here updates a project by itself.
import type { TemplateVersion } from '../api/endpoints';
import { addRelationship, findRole, removeRole, setCoordinator, updateRole, type Relationship, type Role, type TeamDraft } from '../team/model';

type TeamBody = Extract<TemplateVersion, { kind: 'team' }>['body'];
type TemplateRole = TeamBody['roles'][number];

export interface TemplateChange {
  id: string;
  /** What changed, in words. */
  label: string;
  before?: string;
  after?: string;
  apply: (draft: TeamDraft) => TeamDraft;
}

const FIELDS = ['name', 'coordinator', 'responsibilities_md', 'instructions_md', 'contributions', 'deliverables', 'skills', 'stage', 'agent_template_ref'] as const;
const FIELD_LABEL: Record<(typeof FIELDS)[number], string> = {
  name: 'name',
  coordinator: 'coordinator',
  responsibilities_md: 'responsibilities',
  instructions_md: 'instructions',
  contributions: 'contributions',
  deliverables: 'deliverables',
  skills: 'skills',
  stage: 'stage',
  agent_template_ref: 'agent template',
};
const show = (value: unknown): string => {
  if (value === null || value === undefined) return '—';
  if (Array.isArray(value)) return value.length ? value.map((item) => (typeof item === 'object' ? (item as { ref?: string }).ref ?? JSON.stringify(item) : String(item))).join(', ') : '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const edgeId = (edge: Relationship) => `${edge.from}|${edge.type}|${edge.to}|${edge.stage ?? ''}`;

/** A template role as a draft role: no binding, no project knowledge. */
export const roleFromTemplate = (role: TemplateRole): Role => ({
  ...role,
  contributions: [...role.contributions],
  deliverables: [...role.deliverables],
  skills: role.skills.map((skill) => ({ ...skill })),
  agent_ref: null,
  knowledge: [],
});

export function templateDiff(before: TeamBody, after: TeamBody): TemplateChange[] {
  const changes: TemplateChange[] = [];
  const old = new Map(before.roles.map((role) => [role.key, role]));
  const next = new Map(after.roles.map((role) => [role.key, role]));
  for (const role of after.roles) {
    const previous = old.get(role.key);
    if (!previous) {
      changes.push({
        id: `role+${role.key}`,
        label: `Role added: ${role.name}`,
        apply: (draft) => (findRole(draft, role.key) ? draft : { ...draft, roles: [...draft.roles, roleFromTemplate(role)] }),
      });
      continue;
    }
    for (const field of FIELDS) {
      if (same(previous[field], role[field])) continue;
      changes.push({
        id: `role~${role.key}~${field}`,
        label: `${role.name}: ${FIELD_LABEL[field]}`,
        before: show(previous[field]),
        after: show(role[field]),
        apply: (draft) => {
          if (!findRole(draft, role.key)) return draft;
          if (field === 'coordinator') return role.coordinator ? setCoordinator(draft, role.key) : { ...draft, roles: draft.roles.map((item) => (item.key === role.key ? { ...item, coordinator: false } : item)) };
          return updateRole(draft, role.key, { [field]: structuredClone(role[field]) } as Partial<Role>);
        },
      });
    }
  }
  for (const role of before.roles) {
    if (next.has(role.key)) continue;
    changes.push({ id: `role-${role.key}`, label: `Role removed: ${role.name}`, apply: (draft) => removeRole(draft, role.key) });
  }
  const oldEdges = new Set(before.relationships.map(edgeId));
  const newEdges = new Set(after.relationships.map(edgeId));
  const name = (key: string) => next.get(key)?.name ?? old.get(key)?.name ?? key;
  for (const edge of after.relationships) {
    if (oldEdges.has(edgeId(edge))) continue;
    changes.push({ id: `edge+${edgeId(edge)}`, label: `Relationship added: ${name(edge.from)} ${edge.type.replace(/_/g, ' ')} ${name(edge.to)}`, apply: (draft) => addRelationship(draft, edge) });
  }
  for (const edge of before.relationships) {
    if (newEdges.has(edgeId(edge))) continue;
    changes.push({
      id: `edge-${edgeId(edge)}`,
      label: `Relationship removed: ${name(edge.from)} ${edge.type.replace(/_/g, ' ')} ${name(edge.to)}`,
      apply: (draft) => ({ ...draft, relationships: draft.relationships.filter((item) => edgeId(item) !== edgeId(edge)) }),
    });
  }
  if (!same(before.stages, after.stages)) {
    changes.push({ id: 'stages', label: 'Workflow stages', before: show(before.stages), after: show(after.stages), apply: (draft) => ({ ...draft, stages: [...after.stages] }) });
  }
  return changes;
}

/** Applies the chosen changes in order. */
export const applyChanges = (draft: TeamDraft, changes: readonly TemplateChange[], chosen: ReadonlySet<string>): TeamDraft =>
  changes.filter((change) => chosen.has(change.id)).reduce((current, change) => change.apply(current), draft);
