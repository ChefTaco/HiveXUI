import { AlertTriangle, Crown, OctagonAlert } from 'lucide-react';
import { StatusDot } from '@ui';
import { cn } from '@lib/cn';
import type { Agent, ValidationIssue } from '../api/endpoints';
import { defaultPortrait } from '../room/scene/model';
import { PortraitBadge } from '../room/scene/portrait';
import { STAGE_LABEL, type Role } from './model';

export type Binding = { state: 'bound'; agent: Agent | undefined; ref: string } | { state: 'creating' } | { state: 'unbound' };

export function bindingOf(role: Role, agents: ReadonlyMap<string, Agent>, creating: ReadonlySet<string>): Binding {
  if (creating.has(role.key)) return { state: 'creating' };
  if (!role.agent_ref) return { state: 'unbound' };
  return { state: 'bound', agent: agents.get(role.agent_ref), ref: role.agent_ref };
}

/** The binding in words, for cards, rows and screen readers. */
export function bindingText(binding: Binding): string {
  if (binding.state === 'creating') return 'Creating agent…';
  if (binding.state === 'unbound') return 'Unbound';
  if (!binding.agent) return `Bound to ${binding.ref}, not reported by Magnus`;
  return `Bound to ${binding.agent.display_name}, ${binding.agent.available ? 'available' : binding.agent.error ?? 'unavailable'}`;
}

export function BindingLine({ binding }: { binding: Binding }) {
  if (binding.state === 'creating')
    return (
      <span className="studio-binding text-xs text-info">
        <span className="spinner" aria-hidden="true" />
        Creating…
      </span>
    );
  if (binding.state === 'unbound')
    return (
      <span className="studio-binding text-xs text-warning">
        <AlertTriangle className="size-3" aria-hidden="true" />
        Unbound
      </span>
    );
  const available = binding.agent?.available ?? false;
  return (
    <span className="studio-binding text-xs text-text-muted" title={binding.ref}>
      <StatusDot status={available ? 'ONLINE' : 'OFFLINE'} />
      <span className="studio-binding__name text-text">{binding.agent?.display_name ?? binding.ref}</span>
      <span>{binding.agent ? (available ? 'Available' : 'Unavailable') : 'Unknown'}</span>
    </span>
  );
}

export function IssueMarker({ issues }: { issues: readonly ValidationIssue[] }) {
  if (!issues.length) return null;
  const errors = issues.filter((issue) => issue.severity === 'error').length;
  const Icon = errors ? OctagonAlert : AlertTriangle;
  const label = `${issues.length} ${issues.length === 1 ? 'issue' : 'issues'}: ${issues.map((issue) => issue.message).join('; ')}`;
  return (
    <span className={cn('studio-issue-marker text-xs', errors ? 'text-danger' : 'text-warning')} title={label}>
      <Icon className="size-4" aria-hidden="true" />
      <span className="num">{issues.length}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** A role on the canvas or in the Workflow view: who it is, who does it, what it delivers, and what is wrong. */
export function RoleCard({ role, binding, issues, selected = false, compact = false }: { role: Role; binding: Binding; issues: readonly ValidationIssue[]; selected?: boolean; compact?: boolean }) {
  const portrait = defaultPortrait(binding.state === 'bound' ? binding.ref : role.key);
  const errors = issues.some((issue) => issue.severity === 'error');
  return (
    <span
      className={cn(
        'studio-role-card rounded-panel border bg-surface',
        selected ? 'border-accent glow-accent' : errors ? 'border-danger' : 'border-border-strong',
        compact && 'studio-role-card--compact',
      )}
    >
      <span className={cn('studio-role-card__avatar', binding.state !== 'bound' && 'opacity-60')}>
        <PortraitBadge portrait={portrait} size={compact ? 28 : 36} />
      </span>
      <span className="studio-role-card__body">
        <span className="studio-role-card__title">
          {role.coordinator ? (
            <span className="text-signal" title="Coordinator">
              <Crown className="size-4" aria-hidden="true" />
              <span className="sr-only">Coordinator: </span>
            </span>
          ) : null}
          <span className="studio-role-card__name cell-strong">{role.name}</span>
          <IssueMarker issues={issues} />
        </span>
        <BindingLine binding={binding} />
        {compact ? null : (
          <span className="studio-role-card__chips">
            {role.stage ? <span className="tag">{STAGE_LABEL[role.stage]}</span> : null}
            {role.deliverables.slice(0, 2).map((name) => (
              <span key={name} className="tag border-accent text-accent" title={`Delivers ${name}`}>
                {name}
              </span>
            ))}
            {role.deliverables.length > 2 ? <span className="tag">+{role.deliverables.length - 2}</span> : null}
          </span>
        )}
      </span>
    </span>
  );
}
