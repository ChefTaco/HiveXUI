import { useId, type ReactNode } from 'react';
import { ArrowLeft, ArrowUpRight, Bot } from 'lucide-react';
import { Badge, EmptyState, StatusDot } from '@ui';
import { cn } from '@lib/cn';
import { useMagnusResource, type Resource } from '../../magnus/api/use-resource';
import { readResource } from '../../magnus/pages/agents/ardent/api';
import { parseProfileRef, profileHref } from '../../magnus/pages/agents/ardent/logic';
import { memoryStatusSchema, type MemoryStatus } from '../../magnus/pages/agents/ardent/schemas';
import type { ProfileRef } from '../../magnus/pages/agents/ardent/profile/editors';
import { listAgents, type Agent, type Snapshot } from '../api/endpoints';
import { setStudioQuery, StudioLink, useStudioSearch } from '../link';
import { ProjectFrame } from '../projects/project-page';
import { PortraitBadge } from '../room/scene';
import { agentHref, projectHref } from '../routes';
import './agents.css';
import { CapabilitiesTab } from './capabilities';
import { DevelopmentTab } from './development';
import { IdentityTab } from './identity';
import { KnowledgeTab } from './knowledge';
import { AGENT_TABS, agentTab, portraitFor, runtimeStatus, TAB_LABEL, type AgentTab } from './logic';
import { PreviewTab } from './preview';
import { ReviewTab } from './review';

/** What every tab is given: the agent as Magnus and Studio report it, and the project it was opened in. */
export interface AgentContext extends ProfileRef {
  agentRef: string;
  agent: Agent | undefined;
  /** The project's live snapshot when Agent Studio is opened from a project. */
  snapshot?: Snapshot | undefined;
  projectId?: string | undefined;
  memory: Resource<MemoryStatus>;
  refreshAgent: () => void;
}

/** /studio/agents/:ref and /studio/p/:id/agents/:ref. A project page waits for its snapshot. */
export function AgentStudio({ agentRef, projectId }: { agentRef: string; projectId?: string | undefined }) {
  if (!projectId) return <AgentStudioBody agentRef={agentRef} />;
  return <ProjectFrame projectId={projectId}>{(state) => <AgentStudioBody agentRef={agentRef} projectId={projectId} snapshot={state.snapshot} />}</ProjectFrame>;
}

function AgentStudioBody({ agentRef, projectId, snapshot }: { agentRef: string; projectId?: string; snapshot?: Snapshot }) {
  const ref = parseProfileRef(agentRef)!;
  const search = useStudioSearch();
  const tab = agentTab(search.get('tab'));
  const agents = useMagnusResource((signal) => listAgents(signal), []);
  const memory = useMagnusResource((signal) => readResource(ref.nodeId, ref.profileId, 'memory/status', memoryStatusSchema, signal), [agentRef]);
  const agent = agents.data?.agents.find((item) => item.agent_ref === agentRef);
  const context: AgentContext = { ...ref, agentRef, agent, snapshot, projectId, memory, refreshAgent: () => void agents.refresh() };
  const tabsId = useId();
  const missing = agents.data && !agent && agents.data.magnus.state === 'ok';

  return (
    <div className="agent-studio page-stack">
      <AgentHeader context={context} loading={agents.loading} magnusDown={agents.data?.magnus.state === 'unavailable' ? agents.data.magnus.error ?? 'Magnus is unavailable.' : null} />
      {missing ? (
        <EmptyState
          framed
          tone="warning"
          icon={<Bot className="size-6" />}
          title="Magnus does not report this agent"
          message={`No Ardent profile ${ref.profileId} on node ${ref.nodeId} is in Magnus's inventory. It may have been removed, or the node has not reported it yet.`}
        />
      ) : null}
      <div className="tabs agent-tabs" role="tablist" aria-label="Agent Studio sections">
        {AGENT_TABS.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            id={`${tabsId}-${item}`}
            aria-selected={tab === item}
            aria-controls={`${tabsId}-panel`}
            className={cn('tab', tab === item && 'tab--active')}
            onClick={() => setStudioQuery({ tab: item === 'identity' ? null : item })}
          >
            {TAB_LABEL[item]}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-${tab}`} className="agent-tabpanel">
        <TabBody key={`${agentRef}:${tab}`} tab={tab} context={context} />
      </div>
    </div>
  );
}

function TabBody({ tab, context }: { tab: AgentTab; context: AgentContext }): ReactNode {
  switch (tab) {
    case 'identity':
      return <IdentityTab context={context} />;
    case 'capabilities':
      return <CapabilitiesTab context={context} />;
    case 'knowledge':
      return <KnowledgeTab context={context} />;
    case 'preview':
      return <PreviewTab context={context} />;
    case 'development':
      return <DevelopmentTab context={context} />;
    case 'review':
      return <ReviewTab context={context} />;
  }
}

function MemoryBadge({ memory }: { memory: Resource<MemoryStatus> }) {
  if (!memory.data) return <Badge tone={memory.loading ? 'neutral' : 'warning'}>{memory.loading ? 'HiveMem: checking' : 'HiveMem: unknown'}</Badge>;
  const ready = memory.data.status === 'ready';
  return (
    <Badge tone={ready ? 'success' : 'warning'} dot>
      HiveMem {ready ? 'ready' : memory.data.status}
    </Badge>
  );
}

function AgentHeader({ context, loading, magnusDown }: { context: AgentContext; loading: boolean; magnusDown: string | null }) {
  const { agent, agentRef, nodeId, profileId, projectId, memory } = context;
  const search = useStudioSearch();
  const runtime = runtimeStatus(agent);
  const name = agent?.display_name ?? profileId;
  const fromRoom = projectId && search.get('from') === 'room';
  const roomQuery = new URLSearchParams();
  for (const key of ['c', 'm'] as const) {
    const value = search.get(key);
    if (value) roomQuery.set(key, value);
  }
  const projects = agent?.roles ?? [];
  return (
    <header className="agent-head panel">
      {fromRoom ? (
        <StudioLink href={projectHref(projectId, '/room' + (roomQuery.size ? `?${roomQuery}` : ''))} className="agent-head__back text-sm no-underline">
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to the room
        </StudioLink>
      ) : null}
      <div className="agent-head__main">
        <span className="agent-head__portrait rounded-control border border-border bg-surface-sunken">
          <PortraitBadge portrait={portraitFor(agent?.portrait, agentRef)} size={56} />
        </span>
        <div className="agent-head__identity">
          <p className="eyebrow">Agent Studio</p>
          <h2 className="agent-head__name m-0 font-display text-text-strong">{name}</h2>
          <p className="m-0 break-all font-mono text-xs text-text-muted">
            {profileId} on {agent?.node_name ?? nodeId}
            {agent?.installation_version ? ` · Ardent ${agent.installation_version}` : ''}
            {agent?.backend ? ` · ${agent.backend === 'llamacpp' ? 'llama.cpp' : 'Codex'}` : ''}
          </p>
          <div className="agent-head__facts" aria-label="Status">
            <Badge tone={runtime.tone}>
              <StatusDot status={runtime.status} pulse={false} />
              {loading && !agent ? 'Checking runtime' : runtime.label}
            </Badge>
            <MemoryBadge memory={memory} />
          </div>
          {agent?.error ? <p className="m-0 text-sm text-warning">{agent.error}</p> : null}
          {magnusDown ? <p className="m-0 text-sm text-warning" role="status">{magnusDown}</p> : null}
        </div>
        <div className="agent-head__actions">
          <StudioLink href={'/fleet' + profileHref(nodeId, profileId)} className="btn btn--sm no-underline">
            Fleet details
            <ArrowUpRight className="btn-ico" aria-hidden="true" />
          </StudioLink>
        </div>
      </div>
      <div className="agent-head__projects text-sm">
        <span className="stat-label">Projects using it</span>
        {projects.length ? (
          <ul className="agent-head__project-list" aria-label="Projects using this agent">
            {projects.map((role) => (
              <li key={`${role.project_id}:${role.role_key}`}>
                <StudioLink href={agentHref(agentRef, role.project_id)} className={cn('badge no-underline', role.project_id === projectId && 'badge--accent')} aria-current={role.project_id === projectId ? 'page' : undefined}>
                  {role.project_name} · {role.role_name}
                </StudioLink>
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-text-muted">{agent ? 'No project team includes it yet.' : '—'}</span>
        )}
      </div>
    </header>
  );
}
