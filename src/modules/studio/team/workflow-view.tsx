import { ArrowRight, RotateCcw } from 'lucide-react';
import { STAGES } from '@contracts/ardentstudio.generated';
import { Select } from '@ui';
import { cn } from '@lib/cn';
import type { Agent, ValidationIssue } from '../api/endpoints';
import { findRole, STAGE_LABEL, updateRole, type Stage, type TeamDraft } from './model';
import { bindingOf, RoleCard } from './role-card';

const STAGE_OPTIONS = [{ value: '', label: 'No stage' }, ...STAGES.map((stage) => ({ value: stage, label: STAGE_LABEL[stage] }))];

/** Workflow view: the stages left to right, each role in its stage, with its hand-offs under it. */
export function WorkflowView({
  draft,
  agents,
  creating,
  issues,
  selected,
  readOnly,
  onSelect,
  onInspect,
  edit,
}: {
  draft: TeamDraft;
  agents: ReadonlyMap<string, Agent>;
  creating: ReadonlySet<string>;
  issues: ReadonlyMap<string, ValidationIssue[]>;
  selected: string | null;
  readOnly: boolean;
  onSelect: (key: string) => void;
  onInspect: (key: string) => void;
  edit: (change: (draft: TeamDraft) => TeamDraft) => void;
}) {
  const columns: Array<{ stage: Stage | null; label: string }> = [...STAGES.map((stage) => ({ stage, label: STAGE_LABEL[stage] })), { stage: null, label: 'No stage' }];
  const toggleStage = (stage: Stage, on: boolean) =>
    edit((current) => ({ ...current, stages: STAGES.filter((item) => (item === stage ? on : current.stages.includes(item))) }));
  return (
    <div className="studio-workflow" role="list" aria-label="Workflow stages">
      {columns.map(({ stage, label }) => {
        const roles = draft.roles.filter((role) => role.stage === stage);
        if (stage === null && roles.length === 0) return null;
        const used = stage ? draft.stages.includes(stage) : true;
        return (
          <section key={label} role="listitem" className={cn('studio-stage rounded-panel border', used ? 'border-border bg-surface-sunken' : 'border-dashed border-border bg-transparent')} aria-label={`${label}, ${roles.length} ${roles.length === 1 ? 'role' : 'roles'}`}>
            <header className="studio-stage__head">
              <h3 className="studio-stage__title text-sm">
                {stage === 'revise' ? <RotateCcw className="size-4 text-warning" aria-hidden="true" /> : null}
                {label}
                <span className="tab-count">{roles.length}</span>
              </h3>
              {stage ? (
                <label className="studio-stage__toggle text-xs text-text-muted">
                  <input type="checkbox" checked={used} disabled={readOnly} onChange={(event) => toggleStage(stage, event.target.checked)} />
                  In workflow
                </label>
              ) : null}
            </header>
            {roles.length ? (
              <ul className="studio-stage__roles">
                {roles.map((role) => {
                  const handoffs = draft.relationships.filter((edge) => edge.type === 'hands_off_to' && edge.from === role.key);
                  return (
                    <li key={role.key} className="studio-stage__role">
                      <button
                        type="button"
                        className="studio-stage__card"
                        aria-pressed={selected === role.key}
                        onClick={() => onSelect(role.key)}
                        onDoubleClick={() => onInspect(role.key)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            onInspect(role.key);
                          }
                        }}
                      >
                        <RoleCard role={role} binding={bindingOf(role, agents, creating)} issues={issues.get(role.key) ?? []} selected={selected === role.key} />
                      </button>
                      {handoffs.length ? (
                        <ul className="studio-stage__handoffs text-xs text-text-muted" aria-label={`${role.name} hands off to`}>
                          {handoffs.map((edge, index) => (
                            <li key={index}>
                              {edge.stage === 'revise' ? <RotateCcw className="size-3 text-warning" aria-label="Revise loop" /> : <ArrowRight className="size-3 text-accent" aria-hidden="true" />}
                              {findRole(draft, edge.to)?.name ?? edge.to}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      <Select
                        aria-label={`Stage for ${role.name}`}
                        className="studio-stage__select"
                        value={role.stage ?? ''}
                        disabled={readOnly}
                        options={STAGE_OPTIONS}
                        onChange={(value) => edit((current) => updateRole(current, role.key, { stage: (value || null) as Stage | null }))}
                      />
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="m-0 text-xs text-text-muted">No role works in this stage.</p>
            )}
          </section>
        );
      })}
    </div>
  );
}
