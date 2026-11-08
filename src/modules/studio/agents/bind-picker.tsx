import { useState } from 'react';
import { Check, RefreshCw, Search, UserPlus } from 'lucide-react';
import { Badge, Button, Drawer, EmptyState } from '@ui';
import { cn } from '@lib/cn';
import type { Resource } from '../../magnus/api/use-resource';
import { LoadingRows, ResourceError } from '../../magnus/ui/resource-state';
import type { Agent, AgentList } from '../api/endpoints';
import { defaultPortrait } from '../room/scene/model';
import { PortraitBadge } from '../room/scene/portrait';

function AgentRow({ agent, current, onPick }: { agent: Agent; current: boolean; onPick: () => void }) {
  return (
    <li className={cn('studio-agent rounded-panel border', current ? 'border-accent bg-accent-soft' : 'border-border bg-surface')}>
      <PortraitBadge portrait={defaultPortrait(agent.agent_ref)} size={36} />
      <div className="studio-agent__main">
        <span className="studio-agent__name">
          <span className="cell-strong">{agent.display_name}</span>
          <Badge tone={agent.available ? 'success' : 'warning'} dot>
            {agent.available ? 'Available' : agent.reachable ? (agent.running ? 'Unavailable' : 'Stopped') : 'Node unreachable'}
          </Badge>
        </span>
        <span className="font-mono text-xs text-text-muted">{agent.agent_ref}</span>
        <span className="text-xs text-text-muted">
          {agent.node_name}
          {agent.backend ? ` · ${agent.backend}` : ''}
          {agent.installation_version ? ` · Ardent ${agent.installation_version}` : ''}
        </span>
        {agent.error ? <span className="text-xs text-danger">{agent.error}</span> : null}
        {agent.roles.length ? (
          <span className="text-xs text-text-muted">
            Also {agent.roles.map((role) => `${role.role_name} in ${role.project_name}`).join('; ')}
          </span>
        ) : null}
      </div>
      <Button size="sm" variant={current ? 'ghost' : 'default'} icon={current ? <Check className="size-4" /> : undefined} disabled={current} onClick={onPick} aria-label={current ? `${agent.display_name} is bound` : `Bind ${agent.display_name}`}>
        {current ? 'Bound' : 'Bind'}
      </Button>
    </li>
  );
}

/** Bind existing: the Magnus-managed Ardent profiles the Studio service reports, with their state and current roles. */
export function BindPicker({
  open,
  roleName,
  current,
  agents,
  onPick,
  onNewAgent,
  onClose,
}: {
  open: boolean;
  roleName: string;
  current: string | null;
  agents: Resource<AgentList>;
  onPick: (agentRef: string) => void;
  onNewAgent: () => void;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState('');
  const needle = filter.trim().toLowerCase();
  const list = (agents.data?.agents ?? []).filter((agent) => !needle || `${agent.display_name} ${agent.agent_ref} ${agent.node_name}`.toLowerCase().includes(needle));
  return (
    <Drawer
      open={open}
      title={`Agent for ${roleName}`}
      eyebrow="Bind existing"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" icon={<RefreshCw className="size-4" />} loading={agents.refreshing} onClick={() => void agents.refresh()}>
            Refresh
          </Button>
          <Button icon={<UserPlus className="size-4" />} onClick={onNewAgent}>
            New agent
          </Button>
        </>
      }
    >
      <label className="studio-search">
        <Search className="studio-search__icon size-4 text-text-muted" aria-hidden="true" />
        <span className="sr-only">Find an agent</span>
        <input type="search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Find by name, profile or node" />
      </label>
      {agents.data?.magnus.state === 'unavailable' ? (
        <p role="alert" className="m-0 text-sm text-warning">
          Magnus is unavailable, so agents cannot be listed. {agents.data.magnus.error ?? ''}
        </p>
      ) : null}
      {agents.data ? (
        list.length ? (
          <ul className="studio-agents" aria-label="Ardent agents">
            {list.map((agent) => (
              <AgentRow key={agent.agent_ref} agent={agent} current={agent.agent_ref === current} onPick={() => onPick(agent.agent_ref)} />
            ))}
          </ul>
        ) : (
          <EmptyState compact title={needle ? 'No agent matches' : 'No Ardent agents'} message={needle ? 'Try another name.' : 'Create one with New agent.'} />
        )
      ) : agents.loading ? (
        <LoadingRows rows={4} />
      ) : (
        <ResourceError error={agents.error} title="Agents could not be loaded" onRetry={() => void agents.refresh()} />
      )}
    </Drawer>
  );
}
