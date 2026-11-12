// Agent 360: everything the suite knows about one agent, one product per tab. Magnus names the agent
// (its node, profile, runtime and HiveMem actor); the other products are asked about that name.
import { createContext, useContext, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowUpRight, Bot } from 'lucide-react';
import { Badge, Button, buttonClass, DataTable, EmptyState, LoadingRows, PageHeader, Panel, ResourceError, statusTone, TabPanel, Tabs, TextInput, type DataTableColumn } from '@ui';
import { RouteLink } from '../../components/route-link';
import { HiveApiError } from '../../lib/api-error';
import { formatTime, relativeTime } from '../../lib/format';
import { linkTo } from '../../lib/routes';
import { openStudio } from '../studio/paths';
import { projectHref } from '../studio/routes';
import { liveSources, type AgentIdentity, type ArdentProfileSummary, type HermesProfile, type AgentSources, type FleetTarget, type FusionCase, type MemoryRecord, type ProjectSummary, type Trace } from './api';
import type { AgentRef } from './paths';
import { Forbidden, isForbidden, Loaded, NotInstalled, NotLinked, Unsupported, useLoad } from './states';

export const AgentSourcesContext = createContext<AgentSources>(liveSources);

export const AGENT_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'memories', label: 'Memories' },
  { id: 'projects', label: 'Projects' },
  { id: 'cases', label: 'Cases' },
  { id: 'traffic', label: 'Traffic' },
  { id: 'skills', label: 'Skills' },
] as const;
export type AgentTab = (typeof AGENT_TABS)[number]['id'];
const isTab = (value: string | null): value is AgentTab => AGENT_TABS.some((tab) => tab.id === value);

/** What Magnus says about the agent's name. Every tab that matches by HiveMem actor waits on it. */
export type IdentityState =
  | { state: 'not-installed' }
  | { state: 'loading' }
  | { state: 'resolved'; identity: AgentIdentity }
  /** 404 for a role that may not see Ardent profiles. */
  | { state: 'hidden' }
  /** 404 for ADMIN: Magnus knows no such agent. */
  | { state: 'unknown' }
  | { state: 'failed'; error: unknown; retry: () => void };

const TAB_ID = 'agent360';
const none = <span className="text-text-muted">none</span>;

function useIdentity(sources: AgentSources, ref: AgentRef): IdentityState {
  const installed = sources.installed('magnus');
  const load = useLoad(
    installed
      ? async (signal: AbortSignal): Promise<IdentityState> => {
          try {
            return { state: 'resolved', identity: await sources.identity(ref.agentRef, signal) };
          } catch (error) {
            if (!(error instanceof HiveApiError) || error.status !== 404) throw error;
            // Ardent profiles resolve for ADMIN only; anyone else gets the 404 an unknown agent gets.
            return { state: (await sources.role()) === 'ADMIN' ? 'unknown' : 'hidden' };
          }
        }
      : null,
    [ref.agentRef, sources],
  );
  if (!installed) return { state: 'not-installed' };
  if (load.loading) return { state: 'loading' };
  if (load.error !== undefined) return { state: 'failed', error: load.error, retry: load.refresh };
  return load.data ?? { state: 'loading' };
}

/** Why there is no HiveMem actor to match by, for the tabs that need one. */
function unlinkedReason(identity: IdentityState): ReactNode {
  switch (identity.state) {
    case 'not-installed':
      return 'Without Magnus, HiveXUI cannot tell which HiveMem actor this agent is.';
    case 'hidden':
      return 'Magnus shows Ardent agent identities to its ADMIN role only, so the HiveMem actor of this agent is not visible to your role.';
    case 'unknown':
      return 'Magnus does not know this agent, so it has no HiveMem actor to match.';
    case 'failed':
      return 'Magnus could not be asked which HiveMem actor this agent is. Retry from the Overview tab.';
    case 'resolved':
      return identity.identity.runtime === 'hermes'
        ? 'Magnus records no HiveMem actor for Hermes profiles, so this agent cannot be matched in products that name agents by actor.'
        : 'Magnus has not enrolled this profile in HiveMem yet. Enable HiveMem on the profile to link it.';
    default:
      return 'Waiting for Magnus.';
  }
}

/** The tabs' shared gate: product installed, then a HiveMem actor when the product names agents by one. */
function Gate({ sources, product, identity, needsActor, children }: { sources: AgentSources; product: AgentProduct; identity: IdentityState; needsActor: boolean; children: (actorId: string | null) => ReactNode }) {
  if (!sources.installed(product)) return <NotInstalled product={product} framed />;
  if (!needsActor) return <>{children(null)}</>;
  if (identity.state === 'loading') return <LoadingRows />;
  const actorId = identity.state === 'resolved' ? identity.identity.actorId : null;
  if (!actorId) return <NotLinked framed>{unlinkedReason(identity)}</NotLinked>;
  return <>{children(actorId)}</>;
}
type AgentProduct = 'magnus' | 'hivemem' | 'ardentstudio' | 'cindertrace' | 'emberpath' | 'hiveskills';

export function AgentPage({ agent }: { agent: AgentRef }) {
  const sources = useContext(AgentSourcesContext);
  const identity = useIdentity(sources, agent);
  const [tab, setTab] = useState<AgentTab>(() => {
    const requested = new URLSearchParams(location.search).get('tab');
    return isTab(requested) ? requested : 'overview';
  });
  function choose(next: AgentTab) {
    setTab(next);
    const url = new URL(location.href);
    if (next === 'overview') url.searchParams.delete('tab');
    else url.searchParams.set('tab', next);
    history.replaceState(history.state, '', url);
  }
  const runtime = identity.state === 'resolved' ? identity.identity.runtime : null;
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Agent 360"
        icon={<Bot className="size-5" />}
        title={agent.profile}
        description={<span className="break-all font-mono text-xs">{agent.agentRef}</span>}
        status={runtime ? <Badge tone="accent">{runtime === 'ardent' ? 'Ardent' : 'Hermes'}</Badge> : undefined}
      />
      <Tabs label="Agent sections" idPrefix={TAB_ID} tabs={AGENT_TABS} value={tab} onChange={choose} />
      <TabPanel idPrefix={TAB_ID} id={tab}>
        {tab === 'overview' ? <OverviewTab sources={sources} agent={agent} identity={identity} /> : null}
        {tab === 'memories' ? <MemoriesTab sources={sources} identity={identity} /> : null}
        {tab === 'projects' ? <ProjectsTab sources={sources} agent={agent} identity={identity} /> : null}
        {tab === 'cases' ? <CasesTab sources={sources} identity={identity} /> : null}
        {tab === 'traffic' ? <TrafficTab sources={sources} identity={identity} /> : null}
        {tab === 'skills' ? <SkillsTab sources={sources} agent={agent} identity={identity} /> : null}
      </TabPanel>
    </div>
  );
}

/* ===== Overview: Magnus ===== */

function Facts({ label, rows }: { label: string; rows: ReadonlyArray<[string, ReactNode]> }) {
  return (
    <dl className="kv-list" aria-label={label}>
      {rows.map(([name, value]) => (
        <div key={name} className="kv-row">
          <dt>{name}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
const mono = (value: string | null | undefined) => (value ? <span className="font-mono">{value}</span> : none);

function OverviewTab({ sources, agent, identity }: { sources: AgentSources; agent: AgentRef; identity: IdentityState }) {
  if (identity.state === 'not-installed') return <NotInstalled product="magnus" framed />;
  return (
    <div className="grid gap-4">
      <Panel title="Identity" eyebrow="Magnus" padding="sm">
        <IdentityFacts identity={identity} />
      </Panel>
      <div className="page-grid page-grid--2">
        <NodePanel sources={sources} nodeId={agent.nodeId} />
        <ProfilePanel sources={sources} agent={agent} identity={identity} />
      </div>
    </div>
  );
}

function IdentityFacts({ identity }: { identity: IdentityState }) {
  if (identity.state === 'loading') return <LoadingRows />;
  if (identity.state === 'hidden')
    return <Forbidden>Magnus resolves Ardent agents for its ADMIN role only. Ask an administrator, or open the node below.</Forbidden>;
  if (identity.state === 'unknown')
    return <EmptyState title="Magnus does not know this agent" message="No Ardent or Hermes profile with this name is on that node. A Magnus release without agent identity lookup answers the same way." />;
  if (identity.state === 'failed')
    return isForbidden(identity.error) ? <Forbidden>{identity.error.message}</Forbidden> : <ResourceError error={identity.error} title="Magnus could not name this agent" onRetry={identity.retry} />;
  if (identity.state !== 'resolved') return null;
  const value = identity.identity;
  return (
    <Facts
      label="Agent identity"
      rows={[
        ['Agent reference', mono(value.agentRef)],
        ['Node', mono(value.nodeId)],
        ['Profile', mono(value.profile)],
        ['Runtime', value.runtime === 'ardent' ? 'Ardent' : 'Hermes'],
        ['HiveMem actor', mono(value.actorId)],
        ['HiveMem workspace', mono(value.workspaceId)],
        ['Oathweave subject', mono(value.oathweaveSubject)],
        ['Emberpath client key', mono(value.emberpathClientKeyId)],
      ]}
    />
  );
}

function NodePanel({ sources, nodeId }: { sources: AgentSources; nodeId: string }) {
  const node = useLoad((signal) => sources.node(nodeId, signal), [nodeId, sources]);
  const href = linkTo('magnus', '/nodes/:nodeId', { nodeId });
  return (
    <Panel title="Node" eyebrow="Magnus" padding="sm" actions={<RouteLink href={href} className={buttonClass({ size: 'sm', className: 'no-underline' })}>Open node<ArrowUpRight className="btn-ico" aria-hidden="true" /></RouteLink>}>
      {node.error instanceof HiveApiError && node.error.status === 404 ? (
        <EmptyState compact title="Magnus has no node with this ID" />
      ) : (
        <Loaded load={node} product="magnus" what="this node">
          {(data) => (
            <Facts
              label="Node summary"
              rows={[
                ['Name', data.name],
                ['Hostname', mono(data.hostname)],
                ['Status', <Badge tone={statusTone(data.status)} dot>{data.status}</Badge>],
                ['System', `${data.os} · ${data.arch}`],
                ['Node agent', data.agent ? `${data.agent.version} · ${data.agent.status}` : none],
                ['Last heartbeat', data.lastHeartbeatAt ? relativeTime(data.lastHeartbeatAt) : none],
              ]}
            />
          )}
        </Loaded>
      )}
    </Panel>
  );
}

type ProfileFound = { runtime: 'ardent'; found: ArdentProfileSummary | null } | { runtime: 'hermes'; found: HermesProfile | null };

function ProfilePanel({ sources, agent, identity }: { sources: AgentSources; agent: AgentRef; identity: IdentityState }) {
  const runtime = identity.state === 'resolved' ? identity.identity.runtime : null;
  const profile = useLoad<ProfileFound>(
    runtime === 'ardent'
      ? (signal) => sources.ardentProfile(agent.nodeId, agent.profile, signal).then((found) => ({ runtime, found }) as const)
      : runtime === 'hermes'
        ? (signal) => sources.hermesProfile(agent.nodeId, agent.profile, signal).then((found) => ({ runtime, found }) as const)
        : null,
    [runtime, agent.agentRef, sources],
  );
  const href = runtime === 'ardent' ? linkTo('magnus', '/ardent/profiles/:id', { id: agent.agentRef }) : runtime === 'hermes' ? linkTo('magnus', '/orchestra/profiles') : null;
  return (
    <Panel
      title="Agent profile"
      eyebrow="Magnus"
      padding="sm"
      actions={href ? <RouteLink href={href} className={buttonClass({ size: 'sm', className: 'no-underline' })}>Open profile<ArrowUpRight className="btn-ico" aria-hidden="true" /></RouteLink> : undefined}
    >
      {!runtime ? (
        <EmptyState compact title="No profile to show" message="The profile summary follows once Magnus names the agent." />
      ) : (
        <Loaded load={profile} product="magnus" what="this profile">
          {(data) =>
            !data.found ? (
              <EmptyState compact title="Magnus lists no profile with this name on the node" />
            ) : data.runtime === 'ardent' ? (
              <Facts
                label="Profile summary"
                rows={[
                  ['State', <Badge tone={data.found.running ? 'success' : 'neutral'} dot>{data.found.running ? 'Running' : 'Stopped'}</Badge>],
                  ['Backend', data.found.backend ?? none],
                  ['Channels', Object.entries(data.found.channels).filter(([, on]) => on).map(([name]) => name).join(', ') || none],
                  ['Peers', data.found.a2aEnabled ? 'Enabled' : 'Disabled'],
                  ['Last error', data.found.error ?? none],
                ]}
              />
            ) : (
              <Facts
                label="Profile summary"
                rows={[
                  ['Gateway', <Badge tone={statusTone(data.found.gatewayStatus)} dot>{data.found.gatewayStatus}</Badge>],
                  ['Provider', data.found.providerSummary ?? none],
                  ['Model', data.found.modelSummary ?? none],
                  ['Last synced', data.found.lastSyncedAt ? relativeTime(data.found.lastSyncedAt) : none],
                ]}
              />
            )
          }
        </Loaded>
      )}
    </Panel>
  );
}

/* ===== Memories: HiveMem ===== */

const memoryColumns: ReadonlyArray<DataTableColumn<MemoryRecord>> = [
  { key: 'content', header: 'Memory', cell: (row) => <span className="line-clamp-2">{row.content}</span> },
  { key: 'type', header: 'Type', cell: (row) => row.type },
  { key: 'scope', header: 'Scope', cell: (row) => row.scope },
  { key: 'workspace', header: 'Workspace', className: 'cell-mono', cell: (row) => row.workspace_id },
  { key: 'created', header: 'Created', cell: (row) => formatTime(row.created_at) },
];

function MemoriesTab({ sources, identity }: { sources: AgentSources; identity: IdentityState }) {
  return (
    <Gate sources={sources} product="hivemem" identity={identity} needsActor>
      {(actorId) => <Memories sources={sources} actorId={actorId!} />}
    </Gate>
  );
}

function Memories({ sources, actorId }: { sources: AgentSources; actorId: string }) {
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const page = useLoad((signal) => sources.memories(actorId, query, signal), [actorId, query, sources]);
  // Per-agent stats are for that agent or an admin; anyone else simply sees no figures.
  const stats = useLoad((signal) => sources.memoryStats(actorId, signal), [actorId, sources]);
  function search(event: FormEvent) {
    event.preventDefault();
    setQuery(draft);
  }
  return (
    <Panel
      title="Memories"
      eyebrow="HiveMem"
      description={stats.data ? `${stats.data.memories} memories in ${stats.data.sessions} sessions` : undefined}
      actions={<RouteLink href={linkTo('hivemem', 'memories', { agent: actorId })} className={buttonClass({ size: 'sm', className: 'no-underline' })}>Open in Memories<ArrowUpRight className="btn-ico" aria-hidden="true" /></RouteLink>}
    >
      <form className="inline-actions mb-3" onSubmit={search} role="search" aria-label="Search this agent's memories">
        <label className="sr-only" htmlFor="agent360-memory-query">Search this agent&apos;s memories</label>
        <TextInput id="agent360-memory-query" value={draft} onChange={setDraft} placeholder="memory text, tag, or entity" />
        <Button type="submit">Search</Button>
      </form>
      <Loaded load={page} product="hivemem" what="this agent's memories">
        {(answer) =>
          !answer.supported ? (
            <Unsupported product="hivemem">HiveMem 1.5.0 or later lists one agent&apos;s memories. This release ignores the agent filter, so its answer is not shown.</Unsupported>
          ) : (
            <DataTable
              label="This agent's memories"
              columns={memoryColumns}
              rows={answer.data.memories}
              rowKey={(row) => row.id}
              empty={<EmptyState compact title={query ? 'No memory of this agent matches' : 'This agent has no memories yet'} />}
            />
          )
        }
      </Loaded>
    </Panel>
  );
}

/* ===== Projects: Ardent Project Studio ===== */

function StudioProjectLink({ project }: { project: ProjectSummary }) {
  const href = projectHref(project.id);
  return (
    <a
      href={href}
      onClick={(event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        openStudio(href);
      }}
    >
      {project.name}
    </a>
  );
}

const projectColumns: ReadonlyArray<DataTableColumn<ProjectSummary>> = [
  { key: 'name', header: 'Project', cell: (row) => <StudioProjectLink project={row} /> },
  { key: 'status', header: 'Status', cell: (row) => <Badge tone={row.status === 'active' ? 'success' : 'neutral'}>{row.status}</Badge> },
  { key: 'team', header: 'Team', cell: (row) => `${row.team.bound_count} of ${row.team.role_count} roles bound` },
  { key: 'review', header: 'Awaiting review', className: 'cell-mono', cell: (row) => row.review_pending },
  { key: 'activity', header: 'Last activity', cell: (row) => (row.last_activity ? relativeTime(row.last_activity.at) : 'none') },
];

function ProjectsTab({ sources, agent, identity }: { sources: AgentSources; agent: AgentRef; identity: IdentityState }) {
  return (
    <Gate sources={sources} product="ardentstudio" identity={identity} needsActor={false}>
      {() => <Projects sources={sources} agentRef={agent.agentRef} />}
    </Gate>
  );
}

function Projects({ sources, agentRef }: { sources: AgentSources; agentRef: string }) {
  const projects = useLoad((signal) => sources.projects(agentRef, signal), [agentRef, sources]);
  return (
    <Panel title="Projects" eyebrow="Ardent Project Studio" description="Projects whose published or draft team binds this agent to a role.">
      <Loaded load={projects} product="ardentstudio" what="projects">
        {(answer) =>
          !answer.supported ? (
            <Unsupported product="ardentstudio">Ardent Project Studio 0.3.0 or later lists the projects of one agent. This release would list every project, so nothing is shown.</Unsupported>
          ) : (
            <DataTable label="Projects using this agent" columns={projectColumns} rows={answer.data} rowKey={(row) => row.id} empty={<EmptyState compact title="No project team includes this agent" />} />
          )
        }
      </Loaded>
    </Panel>
  );
}

/* ===== Cases: Cindertrace ===== */

const SEVERITY_TONE: Readonly<Record<string, 'neutral' | 'info' | 'warning' | 'danger'>> = { info: 'neutral', low: 'info', medium: 'warning', high: 'danger', critical: 'danger' };
const caseColumns: ReadonlyArray<DataTableColumn<FusionCase>> = [
  { key: 'title', header: 'Case', cell: (row) => <RouteLink href={linkTo('cindertrace', 'case', { caseId: row.id })}>{row.title}</RouteLink> },
  { key: 'severity', header: 'Severity', cell: (row) => <Badge tone={SEVERITY_TONE[row.severity] ?? 'neutral'}>{row.severity}</Badge> },
  { key: 'status', header: 'Status', cell: (row) => row.status },
  { key: 'confidence', header: 'Confidence', className: 'cell-mono', cell: (row) => `${Math.round(row.confidence * 100)}%` },
  { key: 'seen', header: 'Last seen', cell: (row) => relativeTime(row.lastSeenAt) },
];

function CasesTab({ sources, identity }: { sources: AgentSources; identity: IdentityState }) {
  return (
    <Gate sources={sources} product="cindertrace" identity={identity} needsActor>
      {(actorId) => <Cases sources={sources} actorId={actorId!} />}
    </Gate>
  );
}

function Cases({ sources, actorId }: { sources: AgentSources; actorId: string }) {
  const cases = useLoad((signal) => sources.cases(actorId, signal), [actorId, sources]);
  return (
    <Panel title="Security cases" eyebrow="Cindertrace" description="Cases linked to this agent's HiveMem actor.">
      <Loaded load={cases} product="cindertrace" what="cases">
        {(answer) =>
          !answer.supported ? (
            <Unsupported product="cindertrace">This Cindertrace release cannot list the cases of one agent. A release after 0.3.0 adds agent entities and the case entity filter.</Unsupported>
          ) : (
            <DataTable label="Cases linked to this agent" columns={caseColumns} rows={answer.data} rowKey={(row) => row.id} empty={<EmptyState compact title="No case involves this agent" />} />
          )
        }
      </Loaded>
    </Panel>
  );
}

/* ===== Traffic: Emberpath ===== */

const traceColumns: ReadonlyArray<DataTableColumn<Trace>> = [
  { key: 'time', header: 'Started', cell: (row) => <RouteLink href={linkTo('emberpath', 'traces', { trace: row.id })}>{formatTime(row.startedAt)}</RouteLink> },
  { key: 'request', header: 'Request', className: 'cell-mono', cell: (row) => `${row.method} ${row.path}` },
  { key: 'model', header: 'Model', cell: (row) => row.providerModel ?? '—' },
  { key: 'outcome', header: 'Outcome', cell: (row) => <Badge tone={row.outcome === 'success' ? 'success' : 'danger'} dot>{row.statusCode ?? row.outcome}</Badge> },
  { key: 'duration', header: 'Duration', className: 'cell-mono', cell: (row) => (row.durationMs === null ? '—' : `${row.durationMs} ms`) },
];

function TrafficTab({ sources, identity }: { sources: AgentSources; identity: IdentityState }) {
  return (
    <Gate sources={sources} product="emberpath" identity={identity} needsActor>
      {(actorId) => <Traffic sources={sources} actorId={actorId!} />}
    </Gate>
  );
}

function Traffic({ sources, actorId }: { sources: AgentSources; actorId: string }) {
  const traces = useLoad((signal) => sources.traces(actorId, signal), [actorId, sources]);
  return (
    <Panel title="Model traffic" eyebrow="Emberpath" description="The newest requests this agent sent through Emberpath.">
      <Loaded load={traces} product="emberpath" what="traces">
        {(answer) =>
          !answer.supported ? (
            <Unsupported product="emberpath">This Emberpath release cannot list the traffic of one agent; it answers with everyone&apos;s, which is not shown here. A release after 2.1.0 attributes traces to agents.</Unsupported>
          ) : (
            <>
              <DataTable label="This agent's traces" columns={traceColumns} rows={answer.data.traces} rowKey={(row) => row.id} empty={<EmptyState compact title="No traffic from this agent" />} />
              {answer.data.nextCursor ? <p className="muted mt-2 text-sm">Showing the newest {answer.data.traces.length}. Older traces are in Emberpath.</p> : null}
            </>
          )
        }
      </Loaded>
    </Panel>
  );
}

/* ===== Skills: HiveSkills and Magnus ===== */

function SkillsTab({ sources, agent, identity }: { sources: AgentSources; agent: AgentRef; identity: IdentityState }) {
  const skills = sources.installed('hiveskills');
  const magnus = sources.installed('magnus');
  if (!skills && !magnus) return <NotInstalled product="hiveskills" framed />;
  return (
    <div className="grid gap-4">
      {skills ? <SkillTargets sources={sources} agent={agent} /> : <NotInstalled product="hiveskills" framed />}
      {magnus ? <ProfileSkills sources={sources} agent={agent} identity={identity} /> : null}
    </div>
  );
}

function SkillTargets({ sources, agent }: { sources: AgentSources; agent: AgentRef }) {
  const targets = useLoad((signal) => sources.skillTargets(agent.nodeId, signal), [agent.nodeId, sources]);
  const columns: ReadonlyArray<DataTableColumn<FleetTarget>> = [
    { key: 'name', header: 'Target', className: 'cell-mono', cell: (row) => row.name },
    { key: 'host', header: 'Host', className: 'cell-mono', cell: (row) => row.host },
    { key: 'enabled', header: 'Deployments', cell: (row) => <Badge tone={row.enabled ? 'success' : 'neutral'}>{row.enabled ? 'Enabled' : 'Disabled'}</Badge> },
    { key: 'agent', header: 'This agent', cell: (row) => (row.agentRefs?.includes(agent.agentRef) ? <Badge tone="accent">Linked</Badge> : <span className="text-text-muted">Node only</span>) },
  ];
  return (
    <Panel
      title="Deployment targets"
      eyebrow="HiveSkills"
      description="HiveSkills targets bound to this agent's node."
      actions={<RouteLink href={linkTo('hiveskills', 'skills')} className={buttonClass({ size: 'sm', className: 'no-underline' })}>Open HiveSkills<ArrowUpRight className="btn-ico" aria-hidden="true" /></RouteLink>}
    >
      <Loaded load={targets} product="hiveskills" what="deployment targets">
        {(answer) =>
          !answer.supported ? (
            <Unsupported product="hiveskills">This HiveSkills release cannot list the targets of one node. A release after 1.4.0 links targets to the fleet.</Unsupported>
          ) : (
            <DataTable label="Targets on this node" columns={columns} rows={answer.data} rowKey={(row) => row.name} empty={<EmptyState compact title="No HiveSkills target is bound to this node" />} />
          )
        }
      </Loaded>
    </Panel>
  );
}

function ProfileSkills({ sources, agent, identity }: { sources: AgentSources; agent: AgentRef; identity: IdentityState }) {
  const ardent = identity.state === 'resolved' && identity.identity.runtime === 'ardent';
  const skills = useLoad(ardent ? (signal) => sources.profileSkills(agent.nodeId, agent.profile, signal) : null, [ardent, agent.agentRef, sources]);
  return (
    <Panel title="Installed on this profile" eyebrow="Magnus" description="Skills the Ardent profile reports through Magnus.">
      {identity.state === 'loading' ? (
        <LoadingRows />
      ) : identity.state === 'hidden' ? (
        <Forbidden>Magnus shows Ardent profiles to its ADMIN role only.</Forbidden>
      ) : !ardent ? (
        <EmptyState compact title="No per-profile skills" message={identity.state === 'resolved' ? 'Magnus reports skills for Ardent profiles only.' : 'Magnus has not named this agent.'} />
      ) : (
        <Loaded load={skills} product="magnus" what="this profile's skills">
          {(list) => (
            <DataTable
              label="Skills on this profile"
              columns={[
                { key: 'name', header: 'Skill', className: 'cell-mono', cell: (row) => row.name },
                { key: 'description', header: 'Description', cell: (row) => row.description || '—' },
                { key: 'enabled', header: 'State', cell: (row) => <Badge tone={row.enabled ? 'success' : 'neutral'}>{row.enabled ? 'Enabled' : 'Disabled'}</Badge> },
              ]}
              rows={list}
              rowKey={(row) => row.name}
              empty={<EmptyState compact title="No skill is installed on this profile" />}
            />
          )}
        </Loaded>
      )}
    </Panel>
  );
}

