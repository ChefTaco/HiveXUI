import { Copy, Link2, PanelRight, Plus, Trash2 } from 'lucide-react';
import { RELATIONSHIP_TYPES, STAGES } from '@contracts/ardentstudio.generated';
import { Button, IconButton, Select, TableFrame } from '@ui';
import { cn } from '@lib/cn';
import type { Agent, ValidationIssue } from '../api/endpoints';
import {
  managerOf,
  RELATIONSHIP_LABEL,
  removeRelationship,
  setCoordinator,
  setManager,
  STAGE_LABEL,
  treeOrder,
  updateRelationship,
  updateRole,
  type Relationship,
  type RelationshipType,
  type Stage,
  type TeamDraft,
} from './model';
import { bindingOf, BindingLine, IssueMarker } from './role-card';

const STAGE_OPTIONS = [{ value: '', label: 'No stage' }, ...STAGES.map((stage) => ({ value: stage, label: STAGE_LABEL[stage] }))];
const TYPE_OPTIONS = RELATIONSHIP_TYPES.map((type) => ({ value: type, label: RELATIONSHIP_LABEL[type] }));
const commaList = (text: string) => [...new Set(text.split(',').map((item) => item.trim()).filter(Boolean))].slice(0, 30);

/**
 * Table view: every role and relationship as rows, with the same edits as the canvas and the
 * inspector (long text and skills open the inspector from Details).
 */
export function TableView({
  draft,
  agents,
  creating,
  issues,
  selected,
  readOnly,
  edit,
  onSelect,
  onInspect,
  onBind,
  onDuplicate,
  onDelete,
}: {
  draft: TeamDraft;
  agents: ReadonlyMap<string, Agent>;
  creating: ReadonlySet<string>;
  issues: ReadonlyMap<string, ValidationIssue[]>;
  selected: string | null;
  readOnly: boolean;
  edit: (change: (draft: TeamDraft) => TeamDraft) => void;
  onSelect: (key: string) => void;
  onInspect: (key: string) => void;
  onBind: (key: string) => void;
  onDuplicate: (key: string) => void;
  onDelete: (key: string) => void;
}) {
  const order = treeOrder(draft);
  const byKey = new Map(draft.roles.map((role) => [role.key, role]));
  const roleOptions = draft.roles.map((role) => ({ value: role.key, label: role.name }));
  // A new row starts as the coordinator delegating to another role; every cell can then change.
  const root = draft.roles.find((role) => role.coordinator) ?? draft.roles[0];
  const other = draft.roles.find((role) => role.key !== root?.key);
  return (
    <div className="page-stack">
      <TableFrame label="Roles">
        <table className="studio-table">
          <caption className="sr-only">Roles, in reporting order</caption>
          <thead>
            <tr>
              <th scope="col">Role</th>
              <th scope="col">Coordinator</th>
              <th scope="col">Reports to</th>
              <th scope="col">Stage</th>
              <th scope="col">Agent</th>
              <th scope="col">Deliverables</th>
              <th scope="col">Issues</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {order.map((key) => {
              const role = byKey.get(key)!;
              const manager = managerOf(draft, key);
              return (
                <tr key={key} className={cn(selected === key && 'bg-accent-soft')} onFocusCapture={() => onSelect(key)}>
                  <td>
                    <input aria-label={`Name of ${role.name}`} value={role.name} maxLength={200} disabled={readOnly} onChange={(event) => edit((current) => updateRole(current, key, { name: event.target.value }))} />
                  </td>
                  <td>
                    <input type="radio" name="studio-coordinator" aria-label={`${role.name} is the coordinator`} checked={role.coordinator} disabled={readOnly} onChange={() => edit((current) => setCoordinator(current, key))} />
                  </td>
                  <td>
                    <Select
                      aria-label={`${role.name} reports to`}
                      value={manager ?? ''}
                      disabled={readOnly || role.coordinator}
                      options={[{ value: '', label: role.coordinator ? 'Root' : 'No one' }, ...roleOptions.filter((option) => option.value !== key)]}
                      onChange={(value) => edit((current) => setManager(current, key, value || null))}
                    />
                  </td>
                  <td>
                    <Select aria-label={`Stage for ${role.name}`} value={role.stage ?? ''} disabled={readOnly} options={STAGE_OPTIONS} onChange={(value) => edit((current) => updateRole(current, key, { stage: (value || null) as Stage | null }))} />
                  </td>
                  <td>
                    <span className="studio-table__agent">
                      <BindingLine binding={bindingOf(role, agents, creating)} />
                      <Button size="sm" variant="ghost" icon={<Link2 className="size-4" />} disabled={readOnly} onClick={() => onBind(key)} aria-label={`Choose the agent for ${role.name}`}>
                        {role.agent_ref ? 'Change' : 'Bind'}
                      </Button>
                    </span>
                  </td>
                  <td>
                    <input
                      aria-label={`Deliverables of ${role.name}, comma separated`}
                      defaultValue={role.deliverables.join(', ')}
                      key={role.deliverables.join('\n')}
                      disabled={readOnly}
                      onBlur={(event) => {
                        const next = commaList(event.target.value);
                        if (next.join('\n') !== role.deliverables.join('\n')) edit((current) => updateRole(current, key, { deliverables: next }));
                      }}
                    />
                  </td>
                  <td>
                    <IssueMarker issues={issues.get(key) ?? []} />
                  </td>
                  <td>
                    <span className="cell-actions">
                      <IconButton label={`Details of ${role.name}`} icon={<PanelRight className="size-4" />} onClick={() => onInspect(key)} />
                      <IconButton label={`Duplicate ${role.name}`} icon={<Copy className="size-4" />} disabled={readOnly} onClick={() => onDuplicate(key)} />
                      <IconButton label={`Delete ${role.name}`} variant="danger" icon={<Trash2 className="size-4" />} disabled={readOnly} onClick={() => onDelete(key)} />
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableFrame>
      <TableFrame label="Relationships">
        <table className="studio-table">
          <caption className="sr-only">Relationships between roles</caption>
          <thead>
            <tr>
              <th scope="col">From</th>
              <th scope="col">Relationship</th>
              <th scope="col">To</th>
              <th scope="col">Revise loop</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {draft.relationships.map((edge, index) => {
              const change = (patch: Partial<Relationship>) => edit((current) => updateRelationship(current, index, { ...edge, ...patch }));
              return (
                <tr key={index}>
                  <td>
                    <Select aria-label={`Relationship ${index + 1} from`} value={edge.from} disabled={readOnly} options={roleOptions} onChange={(from) => change({ from })} />
                  </td>
                  <td>
                    <Select aria-label={`Relationship ${index + 1} type`} value={edge.type} disabled={readOnly} options={TYPE_OPTIONS} onChange={(type) => change({ type: type as RelationshipType, ...(type === 'hands_off_to' ? {} : { stage: null }) })} />
                  </td>
                  <td>
                    <Select aria-label={`Relationship ${index + 1} to`} value={edge.to} disabled={readOnly} options={roleOptions} onChange={(to) => change({ to })} />
                  </td>
                  <td>
                    {edge.type === 'hands_off_to' ? (
                      <input type="checkbox" aria-label={`Relationship ${index + 1} is the revise loop`} checked={edge.stage === 'revise'} disabled={readOnly} onChange={(event) => change({ stage: event.target.checked ? 'revise' : null })} />
                    ) : (
                      <span className="text-text-muted">—</span>
                    )}
                  </td>
                  <td>
                    <IconButton label={`Delete relationship ${index + 1}`} variant="danger" icon={<Trash2 className="size-4" />} disabled={readOnly} onClick={() => edit((current) => removeRelationship(current, index))} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableFrame>
      <div>
        <Button
          size="sm"
          icon={<Plus className="size-4" />}
          disabled={readOnly || !root || !other}
          onClick={() => edit((current) => ({ ...current, relationships: [...current.relationships, { from: root!.key, to: other!.key, type: 'delegates_to' }] }))}
        >
          Add relationship
        </Button>
      </div>
    </div>
  );
}
