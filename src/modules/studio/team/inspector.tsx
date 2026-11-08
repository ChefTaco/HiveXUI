import { useSyncExternalStore, type ReactNode } from 'react';
import { BookmarkPlus, Copy, Link2, Plus, Trash2, Unlink, UserPlus, X } from 'lucide-react';
import { RELATIONSHIP_TYPES, STAGES } from '@contracts/ardentstudio.generated';
import { Button, Drawer, Field, IconButton, Select, TextArea, TextInput } from '@ui';
import type { Agent, StudioFile, ValidationIssue } from '../api/endpoints';
import {
  findRole,
  listFromText,
  RELATIONSHIP_LABEL,
  removeRelationship,
  setCoordinator,
  STAGE_LABEL,
  updateRelationship,
  updateRole,
  type RelationshipType,
  type Role,
  type Stage,
  type TeamDraft,
} from './model';
import { bindingOf, BindingLine } from './role-card';

const NARROW = '(max-width: 639.98px)';
const subscribe = (listener: () => void) => {
  const media = window.matchMedia?.(NARROW);
  media?.addEventListener('change', listener);
  return () => media?.removeEventListener('change', listener);
};
/** Below 640 px panels become fullscreen drawers. */
export const useNarrow = (): boolean => useSyncExternalStore(subscribe, () => Boolean(window.matchMedia?.(NARROW).matches), () => false);

const STAGE_OPTIONS = [{ value: '', label: 'No stage' }, ...STAGES.map((stage) => ({ value: stage, label: STAGE_LABEL[stage] }))];
const TYPE_OPTIONS = RELATIONSHIP_TYPES.map((type) => ({ value: type, label: RELATIONSHIP_LABEL[type] }));

export interface InspectorProps {
  draft: TeamDraft;
  roleKey: string;
  agents: ReadonlyMap<string, Agent>;
  creating: ReadonlySet<string>;
  issues: readonly ValidationIssue[];
  files: readonly StudioFile[];
  requestedDeliverables: readonly string[];
  readOnly: boolean;
  edit: (change: (draft: TeamDraft) => TeamDraft) => void;
  onClose: () => void;
  onBind: (key: string) => void;
  onNewAgent: (key: string) => void;
  onDuplicate: (key: string) => void;
  onDelete: (key: string) => void;
  onSaveAsTemplate: (role: Role) => void;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="studio-inspector__section">
      <h4 className="stat-label">{title}</h4>
      {children}
    </section>
  );
}

function Body(props: InspectorProps) {
  const { draft, roleKey, readOnly, edit } = props;
  const role = findRole(draft, roleKey)!;
  const set = (patch: Partial<Omit<Role, 'key' | 'coordinator'>>) => edit((current) => updateRole(current, roleKey, patch));
  const binding = bindingOf(role, props.agents, props.creating);
  const others = draft.roles.filter((item) => item.key !== roleKey).map((item) => ({ value: item.key, label: item.name }));
  const edges = draft.relationships.map((edge, index) => ({ edge, index })).filter(({ edge }) => edge.from === roleKey || edge.to === roleKey);
  const uncovered = props.requestedDeliverables.filter((name) => !draft.roles.some((item) => item.deliverables.includes(name)));
  const references = props.files.filter((file) => file.purpose === 'reference');

  return (
    <div className="studio-inspector__body">
      {props.issues.length ? (
        <ul className="studio-inspector__issues m-0 text-sm" aria-label="Issues with this role">
          {props.issues.map((issue, index) => (
            <li key={index} className={issue.severity === 'error' ? 'text-danger' : 'text-warning'}>
              {issue.message}
            </li>
          ))}
        </ul>
      ) : null}
      <Field label="Name">
        <TextInput value={role.name} maxLength={200} disabled={readOnly} onChange={(name) => set({ name })} />
      </Field>
      <div className="studio-inspector__row">
        <label className="check-field">
          <input type="checkbox" checked={role.coordinator} disabled={readOnly || role.coordinator} onChange={() => edit((current) => setCoordinator(current, roleKey))} />
          Coordinator
        </label>
        <Field label="Stage">
          <Select value={role.stage ?? ''} disabled={readOnly} options={STAGE_OPTIONS} onChange={(value) => set({ stage: (value || null) as Stage | null })} />
        </Field>
      </div>
      <Field label="Responsibilities" hint="Markdown. What this role owns in the project.">
        <TextArea value={role.responsibilities_md} rows={4} maxLength={20_000} disabled={readOnly} onChange={(responsibilities_md) => set({ responsibilities_md })} />
      </Field>
      <Field label="Instructions" hint="Markdown. How to work: the agent reads these on every turn in this project.">
        <TextArea value={role.instructions_md} rows={4} maxLength={20_000} disabled={readOnly} onChange={(instructions_md) => set({ instructions_md })} />
      </Field>
      <Field label="Contributions" hint="One per line">
        <TextArea value={role.contributions.join('\n')} rows={2} disabled={readOnly} onChange={(text) => set({ contributions: listFromText(text) })} />
      </Field>
      <Field label="Deliverables" hint="One per line; use the requested deliverable's exact name">
        <TextArea value={role.deliverables.join('\n')} rows={2} disabled={readOnly} onChange={(text) => set({ deliverables: listFromText(text) })} />
      </Field>
      {uncovered.length && !readOnly ? (
        <div className="role-chip-list" aria-label="Requested deliverables no role produces">
          {uncovered.map((name) => (
            <button key={name} type="button" className="role-chip role-chip--button" onClick={() => set({ deliverables: [...role.deliverables, name] })}>
              + {name}
            </button>
          ))}
        </div>
      ) : null}

      <Section title="Agent">
        <BindingLine binding={binding} />
        <div className="studio-inspector__actions">
          <Button size="sm" icon={<Link2 className="size-4" />} disabled={readOnly || binding.state === 'creating'} onClick={() => props.onBind(roleKey)}>
            {role.agent_ref ? 'Change agent' : 'Bind existing'}
          </Button>
          <Button size="sm" icon={<UserPlus className="size-4" />} disabled={readOnly || binding.state === 'creating'} onClick={() => props.onNewAgent(roleKey)}>
            New agent
          </Button>
          {role.agent_ref ? (
            <Button size="sm" variant="ghost" icon={<Unlink className="size-4" />} disabled={readOnly} onClick={() => set({ agent_ref: null })}>
              Unbind
            </Button>
          ) : null}
        </div>
      </Section>

      <Section title="Skills">
        {role.skills.length ? (
          <ul className="studio-inspector__list">
            {role.skills.map((skill, index) => (
              <li key={index} className="studio-inspector__skill">
                <Select
                  aria-label={`Skill ${index + 1} source`}
                  value={skill.kind}
                  disabled={readOnly}
                  options={[{ value: 'local', label: 'Local' }, { value: 'hiveskills', label: 'HiveSkills' }]}
                  onChange={(kind) => set({ skills: role.skills.map((item, at) => (at === index ? { ...item, kind: kind as 'local' | 'hiveskills' } : item)) })}
                />
                <TextInput aria-label={`Skill ${index + 1} name`} value={skill.ref} maxLength={128} disabled={readOnly} onChange={(ref) => set({ skills: role.skills.map((item, at) => (at === index ? { ...item, ref } : item)) })} />
                <IconButton label={`Remove skill ${skill.ref || index + 1}`} icon={<X className="size-4" />} disabled={readOnly} onClick={() => set({ skills: role.skills.filter((_, at) => at !== index) })} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 text-sm text-text-muted">No skills. Skills are hints; the bound agent must have them enabled.</p>
        )}
        <div>
          <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} disabled={readOnly || role.skills.length >= 50} onClick={() => set({ skills: [...role.skills, { kind: 'local', ref: '' }] })}>
            Add skill
          </Button>
        </div>
      </Section>

      <Section title="Knowledge">
        {references.length ? (
          <ul className="studio-inspector__list">
            {references.map((file) => (
              <li key={file.id}>
                <label className="check-field">
                  <input
                    type="checkbox"
                    checked={role.knowledge.includes(file.id)}
                    disabled={readOnly}
                    onChange={(event) => set({ knowledge: event.target.checked ? [...role.knowledge, file.id] : role.knowledge.filter((id) => id !== file.id) })}
                  />
                  {file.name}
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 text-sm text-text-muted">No project references yet. Add them from Files in the top bar.</p>
        )}
      </Section>

      <Section title="Relationships">
        {edges.length ? (
          <ul className="studio-inspector__list">
            {edges.map(({ edge, index }) => {
              const outgoing = edge.from === roleKey;
              const otherKey = outgoing ? edge.to : edge.from;
              return (
                <li key={index} className="studio-inspector__edge">
                  <span className="text-xs text-text-muted">{outgoing ? 'This role' : findRole(draft, otherKey)?.name ?? otherKey}</span>
                  <Select
                    aria-label={`Relationship ${index + 1} type`}
                    value={edge.type}
                    disabled={readOnly}
                    options={TYPE_OPTIONS}
                    onChange={(type) => edit((current) => updateRelationship(current, index, { ...edge, type: type as RelationshipType, ...(type === 'hands_off_to' ? {} : { stage: null }) }))}
                  />
                  {outgoing ? (
                    <Select aria-label={`Relationship ${index + 1} target`} value={edge.to} disabled={readOnly} options={others} onChange={(to) => edit((current) => updateRelationship(current, index, { ...edge, to }))} />
                  ) : (
                    <span className="text-xs text-text-muted">this role</span>
                  )}
                  <IconButton label={`Delete relationship ${index + 1}`} icon={<Trash2 className="size-4" />} disabled={readOnly} onClick={() => edit((current) => removeRelationship(current, index))} />
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="m-0 text-sm text-text-muted">No relationships. Draw one on the canvas or add it here.</p>
        )}
        <div>
          <Button
            size="sm"
            variant="ghost"
            icon={<Plus className="size-4" />}
            disabled={readOnly || !others.length}
            onClick={() => edit((current) => ({ ...current, relationships: [...current.relationships, { from: roleKey, to: others[0]!.value, type: 'hands_off_to' }] }))}
          >
            Add relationship
          </Button>
        </div>
      </Section>

      <div className="studio-inspector__actions">
        <Button size="sm" icon={<Copy className="size-4" />} disabled={readOnly} onClick={() => props.onDuplicate(roleKey)}>
          Duplicate
        </Button>
        <Button size="sm" icon={<BookmarkPlus className="size-4" />} onClick={() => props.onSaveAsTemplate(role)}>
          Save as agent template
        </Button>
        <Button size="sm" variant="danger" icon={<Trash2 className="size-4" />} disabled={readOnly} onClick={() => props.onDelete(roleKey)}>
          Delete role
        </Button>
      </div>
    </div>
  );
}

/** The selected role's every field: a 380 px panel beside the canvas, a fullscreen drawer on a phone. */
export function RoleInspector(props: InspectorProps & { narrow: boolean }) {
  const role = findRole(props.draft, props.roleKey);
  if (!role) return null;
  if (props.narrow)
    return (
      <Drawer open title={role.name} eyebrow="Role" onClose={props.onClose}>
        <Body {...props} />
      </Drawer>
    );
  return (
    <aside className="studio-inspector panel panel--sm" aria-label={`Role ${role.name}`}>
      <div className="studio-inspector__head">
        <div>
          <p className="panel-eyebrow">Role</p>
          <h3 className="m-0">{role.name}</h3>
        </div>
        <IconButton label="Close the role inspector" icon={<X className="size-4" />} onClick={props.onClose} />
      </div>
      <Body {...props} />
    </aside>
  );
}
