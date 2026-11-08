import { useMemo, useState } from 'react';
import { ArrowLeft, Download, ExternalLink, RefreshCw } from 'lucide-react';
import { Badge, Button, EmptyState, PageHeader, Select, statusTone, StatusDot } from '@ui';
import { cn } from '@lib/cn';
import { errorMessage } from '../../../../api/errors';
import { useMagnusResource } from '../../../../api/use-resource';
import { FxPanel, PageItem } from '../../../../effects';
import Link, { useParams, useSearchParams } from '../../../../navigation';
import { ADMIN_ONLY, RequireRole } from '../../../../session';
import { LoadingRows, ResourceError } from '../../../../ui/resource-state';
import { CodexNodePanel } from '../../codex/installation-card';
import { Fact } from '../../shared/fx';
import { fetchArtifact, readInstallation, readResource, saveBlob } from '../api';
import { asRecord, channelLabel, displayValue, parseProfileRef, taskArtifacts, taskIsFinal, type ArdentArtifact } from '../logic';
import { OpenInStudio, studioOffered } from '../open-in-studio';
import {
  channelsSchema,
  memoryStatusSchema,
  openApiSchema,
  peersSchema,
  providersSchema,
  revisionedTextSchema,
  skillsSchema,
  statusSchema,
  taskEventsSchema,
  taskListSchema,
  type ArdentTask,
  type ArdentTaskEvent,
} from '../schemas';
import { HiveMemEnable } from './hivemem-enable';
import { ActionButton, ConfigEditor, IdentityEditor, MemoryPanel, PeerEditor, SettingsForm, SkillList, TaskTest, type ProfileRef } from './editors';

const TABS = ['Overview', 'Configuration', 'Identity', 'Providers', 'Channels', 'Peers', 'Skills', 'Tasks & Artifacts', 'API Reference'] as const;
type Tab = (typeof TABS)[number];
const TASK_STATES = ['all', 'queued', 'running', 'completed', 'partial', 'failed', 'unknown'];

const when = (ms: number) => new Date(ms).toLocaleString();
const label = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

/** Each tab is its own component with its own read, so one tab's answer can never show under another. */
function TabBody<T>({ tab, name, render }: { tab: { data: T | undefined; loading: boolean; error: unknown; refresh: () => Promise<void> }; name: string; render: (data: T) => React.ReactNode }) {
  if (tab.data !== undefined) return <>{render(tab.data)}</>;
  return <FxPanel interactive={false}>{tab.loading ? <LoadingRows /> : <ResourceError error={tab.error} title={`${name} could not be read from the node`} onRetry={() => void tab.refresh()} />}</FxPanel>;
}

function OverviewTab({ nodeId, profileId, running, backend }: ProfileRef & { running: boolean | undefined; backend: string | null | undefined }) {
  const tab = useMagnusResource(async (signal) => {
    const [status, tasks] = await Promise.all([readResource(nodeId, profileId, 'status', statusSchema, signal), readResource(nodeId, profileId, 'tasks', taskListSchema, signal)]);
    return { status, tasks: tasks.tasks };
  });
  return (
    <TabBody tab={tab} name="This profile" render={({ status, tasks }) => (
      <div className="grid gap-3 sm:grid-cols-3">
        <FxPanel padding="sm" hero fxTone={running ? 'success' : 'warning'}><Fact label="Runtime"><span className={cn('flex items-center gap-2 font-semibold', running ? 'glow-text-success text-success' : 'text-warning')}><StatusDot status={running ? 'RUNNING' : 'STOPPED'} />{running ? 'Connected' : 'Disconnected'}</span></Fact></FxPanel>
        <FxPanel padding="sm" hero><Fact label="Backend"><span className="font-semibold">{displayValue(status.backend ?? backend)}</span></Fact></FxPanel>
        <FxPanel padding="sm" hero><Fact label="Recent tasks"><span className="num font-semibold">{tasks.length}</span></Fact></FxPanel>
        <FxPanel padding="sm" className="sm:col-span-3" title="Task activity" interactive={false}>
          {tasks.length ? (
            <div className="grid gap-2">
              {tasks.slice(0, 5).map((task) => (
                <div key={`${task.id}:${task.state}`} className="scan-sweep flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2 text-sm">
                  <span className="min-w-0 max-w-xl truncate">{task.prompt}</span>
                  <Badge tone={statusTone(task.state)} dot className={cn(task.state === 'running' && 'fx-badge-pulse')}>{task.state}</Badge>
                </div>
              ))}
            </div>
          ) : <p className="m-0 text-sm text-text-muted">No tasks have been reported by this profile.</p>}
        </FxPanel>
      </div>
    )} />
  );
}

function ConfigurationTab({ nodeId, profileId }: ProfileRef) {
  const tab = useMagnusResource((signal) => readResource(nodeId, profileId, 'config', revisionedTextSchema, signal));
  return <TabBody tab={tab} name="The configuration" render={(entry) => <ConfigEditor nodeId={nodeId} profileId={profileId} entry={entry} />} />;
}

function IdentityTab({ nodeId, profileId }: ProfileRef) {
  const tab = useMagnusResource(async (signal) => {
    const [soul, identity] = await Promise.all([readResource(nodeId, profileId, 'identity/soul', revisionedTextSchema, signal), readResource(nodeId, profileId, 'identity/identity', revisionedTextSchema, signal)]);
    return { soul, identity };
  });
  return <TabBody tab={tab} name="The identity files" render={({ soul, identity }) => <IdentityEditor nodeId={nodeId} profileId={profileId} soul={soul} identity={identity} />} />;
}

function ProvidersTab({ nodeId, profileId, running }: ProfileRef & { running: boolean }) {
  const tab = useMagnusResource(async (signal) => {
    const [status, config] = await Promise.all([readResource(nodeId, profileId, 'providers', providersSchema, signal), readResource(nodeId, profileId, 'config', revisionedTextSchema, signal)]);
    return { status, config };
  });
  return (
    <TabBody tab={tab} name="The providers" render={({ status, config }) => (
      <>
        <div className="grid gap-3 lg:grid-cols-2">
          {(['llamacpp', 'codex'] as const).map((name) => (
            <FxPanel key={name} padding="sm" fxTone={status.selected === name ? 'success' : 'accent'} title={name === 'llamacpp' ? 'llama.cpp' : 'Codex App Server'} actions={status.selected === name ? <Badge tone="success" dot>Selected</Badge> : undefined}>
              <dl className="m-0 grid gap-2 text-sm">
                {Object.entries(status[name] ?? {}).map(([key, item]) => (
                  <div key={key} className="flex justify-between gap-3 border-t border-border pt-2">
                    <dt className="text-text-muted">{key.replaceAll('_', ' ')}</dt>
                    <dd className="m-0 max-w-[70%] break-all text-right font-mono">{displayValue(item)}</dd>
                  </div>
                ))}
              </dl>
              {status.selected === name ? <ActionButton nodeId={nodeId} profileId={profileId} action="provider-test" label="Test selected backend" /> : null}
            </FxPanel>
          ))}
        </div>
        <SettingsForm key={config.revision} nodeId={nodeId} profileId={profileId} entry={config} section="providers" running={running} className="mt-3" />
        {status.selected === 'codex' ? <CodexNodePanel nodeId={nodeId} /> : null}
      </>
    )} />
  );
}

function ChannelsTab({ nodeId, profileId, running }: ProfileRef & { running: boolean }) {
  const tab = useMagnusResource(async (signal) => {
    const [status, config] = await Promise.all([readResource(nodeId, profileId, 'channels', channelsSchema, signal), readResource(nodeId, profileId, 'config', revisionedTextSchema, signal)]);
    return { status, config };
  });
  return (
    <TabBody tab={tab} name="The channels" render={({ status, config }) => (
      <>
        <div className="grid gap-3 lg:grid-cols-2">
          {Object.entries(status).map(([name, entry]) => (
            <FxPanel key={name} padding="sm" title={channelLabel(name)} actions={<Badge tone={entry.enabled ? 'success' : 'neutral'} dot>{entry.enabled ? 'Enabled' : 'Disabled'}</Badge>}>
              <p className="m-0 text-sm text-text-muted">Credential {entry.token_configured ? 'configured' : 'unconfigured'} · {displayValue(entry.allowed_user_count)} allowed users</p>
              <ActionButton nodeId={nodeId} profileId={profileId} action="channel-test" target={name} label="Test connection" disabled={!entry.token_configured} />
            </FxPanel>
          ))}
        </div>
        <SettingsForm key={config.revision} nodeId={nodeId} profileId={profileId} entry={config} section="channels" running={running} className="mt-3" />
      </>
    )} />
  );
}

function PeersTab({ nodeId, profileId, running }: ProfileRef & { running: boolean }) {
  const tab = useMagnusResource(async (signal) => {
    const [status, config] = await Promise.all([readResource(nodeId, profileId, 'peers', peersSchema, signal), readResource(nodeId, profileId, 'peers/config', revisionedTextSchema, signal)]);
    return { peers: status.peers, config };
  });
  return (
    <TabBody tab={tab} name="The peers" render={({ peers, config }) => (
      <>
        <div className="grid gap-2">
          {peers.length ? peers.map((entry, index) => (
            <FxPanel key={`${displayValue(entry.id)}${index}`} padding="sm" title={displayValue(entry.id)} actions={<Badge tone={entry.enabled ? 'success' : 'neutral'} dot>{entry.enabled ? 'Enabled' : 'Disabled'}</Badge>}>
              <p className="m-0 break-all font-mono text-xs text-text-muted">{displayValue(entry.url)}</p>
              <p className="m-0 mt-2 text-sm text-text-muted">Credential {entry.credential_configured ? 'configured' : 'unconfigured'}</p>
              {typeof entry.id === 'string' ? <ActionButton nodeId={nodeId} profileId={profileId} action="peer-test" target={entry.id} label="Discover peer" disabled={!entry.enabled || !entry.credential_configured} /> : null}
            </FxPanel>
          )) : <FxPanel padding="sm"><p className="m-0 text-sm text-text-muted">No authorized peers are configured for this profile.</p></FxPanel>}
        </div>
        <PeerEditor nodeId={nodeId} profileId={profileId} entry={config} running={running} className="mt-3" />
      </>
    )} />
  );
}

function SkillsTab({ nodeId, profileId }: ProfileRef) {
  const tab = useMagnusResource(async (signal) => {
    const [skills, config, memory] = await Promise.all([
      readResource(nodeId, profileId, 'skills', skillsSchema, signal),
      readResource(nodeId, profileId, 'config', revisionedTextSchema, signal),
      readResource(nodeId, profileId, 'memory/status', memoryStatusSchema, signal),
    ]);
    return { skills: skills.skills, revision: config.revision, memory };
  });
  return (
    <TabBody tab={tab} name="The skills" render={({ skills, revision, memory }) => (
      <>
        <SkillList nodeId={nodeId} profileId={profileId} initial={skills} initialRevision={revision} />
        <MemoryPanel nodeId={nodeId} profileId={profileId} status={memory} className="mt-3" />
      </>
    )} />
  );
}

function TasksTab({ nodeId, profileId, onChanged }: ProfileRef & { onChanged: () => void }) {
  const tab = useMagnusResource((signal) => readResource(nodeId, profileId, 'tasks', taskListSchema, signal));
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<ArdentTask | null>(null);
  const [events, setEvents] = useState<readonly ArdentTaskEvent[]>([]);
  const [problem, setProblem] = useState('');
  const artifacts = useMemo(() => taskArtifacts(events), [events]);
  async function inspect(task: ArdentTask) {
    setSelected(task);
    setEvents([]);
    setProblem('');
    try {
      setEvents((await readResource(nodeId, profileId, `tasks/${task.id}/events`, taskEventsSchema)).events);
    } catch (caught) {
      setProblem(errorMessage(caught, 'Task events are unavailable'));
    }
  }
  async function download(artifact: ArdentArtifact) {
    setProblem('');
    try {
      saveBlob(await fetchArtifact(nodeId, profileId, artifact.id, artifact.bytes), artifact.name);
    } catch (caught) {
      setProblem(errorMessage(caught, 'The artifact could not be downloaded'));
    }
  }
  return (
    <TabBody tab={tab} name="The tasks" render={({ tasks }) => {
      const shown = filter === 'all' ? tasks : tasks.filter((task) => task.state === filter);
      return (
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <FxPanel padding="sm" interactive={false} className="min-w-0">
            <TaskTest nodeId={nodeId} profileId={profileId} onSubmitted={() => void tab.refresh()} />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="m-0 text-sm font-semibold">Recent tasks</p>
              <Select aria-label="Filter tasks by state" value={filter} onChange={setFilter} options={TASK_STATES.map((value) => ({ value, label: label(value) }))} />
            </div>
            <div className="mt-3 grid max-h-[65vh] gap-2 overflow-auto">
              {shown.length ? shown.map((task) => (
                <button key={task.id} type="button" onClick={() => void inspect(task)} className={cn('w-full cursor-pointer rounded-control border bg-surface-sunken p-3 text-left text-sm', selected?.id === task.id ? 'border-accent bg-accent-soft' : 'border-border hover:border-accent')}>
                  <span className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate font-medium">{task.prompt}</span>
                    <Badge tone={statusTone(task.state)}>{task.state}</Badge>
                  </span>
                  <span className="mt-1 block font-mono text-xs text-text-muted">{when(task.created_ms)} · {task.id.slice(0, 8)}</span>
                </button>
              )) : <p className="m-0 text-sm text-text-muted">{filter === 'all' ? 'No tasks recorded.' : 'No tasks match this state.'}</p>}
            </div>
          </FxPanel>
          <FxPanel padding="sm" title="Task detail" interactive={false} className="min-w-0">
            {problem ? <p role="alert" className="m-0 mb-3 break-all text-sm text-danger">{problem}</p> : null}
            {selected ? (
              <div className="grid gap-3">
                <p className="m-0 text-sm text-text-muted">{selected.prompt}</p>
                {!taskIsFinal(selected.state) ? <ActionButton nodeId={nodeId} profileId={profileId} action="task-cancel" target={selected.id} label="Cancel task" confirm={{ title: 'Cancel this task?', message: 'The task stops, and what it has not finished is lost.', label: 'Cancel task' }} onSuccess={onChanged} /> : null}
                {selected.result ? <pre className="code-block m-0 max-h-64 whitespace-pre-wrap">{selected.result}</pre> : null}
                {selected.error ? <p className="m-0 text-sm text-danger">{selected.error}</p> : null}
                {artifacts.length > 0 ? (
                  <div className="border-t border-border pt-3">
                    <p className="m-0 mb-2 text-xs text-text-muted">Artifacts</p>
                    {artifacts.map((artifact) => <Button key={artifact.id} variant="ghost" size="sm" className="w-full justify-start" icon={<Download className="size-4" />} onClick={() => void download(artifact)}><span className="truncate">{artifact.name}</span><span className="num ml-auto text-xs text-text-muted">{artifact.bytes} B</span></Button>)}
                  </div>
                ) : null}
                <div className="grid gap-2 border-t border-border pt-3">
                  {events.map((event) => (
                    <div key={event.sequence} className="animate-page-in flex gap-3 text-xs">
                      <span className="num w-14 shrink-0 text-text-muted">{event.sequence}</span>
                      <span className="font-medium">{event.kind.replaceAll('_', ' ')}</span>
                      <span className="ml-auto text-text-muted">{when(event.created_ms)}</span>
                    </div>
                  ))}
                  {events.length === 0 ? <p className="m-0 text-sm text-text-muted">No events returned.</p> : null}
                </div>
              </div>
            ) : <p className="m-0 text-sm text-text-muted">Select a task to inspect its result and journal.</p>}
          </FxPanel>
        </div>
      );
    }} />
  );
}

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'patch'];
function ApiTab({ nodeId, profileId }: ProfileRef) {
  const tab = useMagnusResource((signal) => readResource(nodeId, profileId, 'openapi', openApiSchema, signal));
  return (
    <TabBody tab={tab} name="The API reference" render={(openapi) => (
      <FxPanel
        title={openapi.info.title}
        description={`OpenAPI ${openapi.openapi} · service ${openapi.info.version}`}
        actions={<Button size="sm" icon={<Download className="size-4" />} onClick={() => saveBlob(new Blob([JSON.stringify(openapi, null, 2)], { type: 'application/json' }), `ardent-${profileId}-openapi.json`)}>Download JSON</Button>}
        interactive={false}
      >
        <div className="max-h-[65vh] overflow-auto">
          {Object.entries(openapi.paths).flatMap(([path, methods]) => Object.entries(methods).filter(([method]) => HTTP_METHODS.includes(method)).map(([method, operation]) => (
            <div key={`${method}:${path}`} className="fx-rail flex flex-wrap items-center gap-3 border-t border-border py-2 text-sm">
              <span className="w-14 shrink-0 font-mono font-bold text-accent">{method.toUpperCase()}</span>
              <span className="min-w-0 flex-1 break-all font-mono">{path}</span>
              <span className="text-text-muted">{displayValue(asRecord(operation).operationId)}</span>
            </div>
          )))}
        </div>
        <p className="m-0 mt-3 inline-flex items-center gap-1 text-xs text-text-muted"><ExternalLink className="size-3" /> JSON-RPC and gRPC contracts are documented separately in the A2A compatibility guide.</p>
      </FxPanel>
    )} />
  );
}

export default function ArdentProfilePage() {
  const { id } = useParams<{ id: string }>();
  const ref = parseProfileRef(id);
  const search = useSearchParams();
  const [tab, setTab] = useState<Tab>(search.get('tab') === 'tasks' ? 'Tasks & Artifacts' : 'Overview');
  const [refreshKey, setRefreshKey] = useState(0);
  const installation = useMagnusResource((signal) => readInstallation(ref!.nodeId, signal), [ref?.nodeId, refreshKey], { enabled: !!ref });
  const profile = installation.data?.profiles.find((item) => item.id === ref?.profileId);
  const running = profile?.running ?? false;
  const back = <Link href="/ardent/profiles" className="inline-flex items-center gap-1 text-sm"><ArrowLeft className="size-4" /> Profiles</Link>;
  if (!ref) {
    return (
      <div className="page-stack">
        <PageItem>{back}</PageItem>
        <EmptyState framed tone="warning" title={<span className="fx-glitch inline-block">Profile link is invalid</span>} message="A profile's link names its node and profile." />
      </div>
    );
  }
  const { nodeId, profileId } = ref;
  return (
    <div className="page-stack">
      <PageItem>
        {back}
        <PageHeader
          className="mt-3"
          eyebrow={`Magnus Ardent / ${profileId}`}
          title={profile?.name ?? profileId}
          description={<span className="break-all font-mono text-xs">{installation.data?.hostname ?? nodeId} · {installation.data?.version ?? 'version unavailable'}</span>}
          status={profile ? <Badge tone={running ? 'success' : 'neutral'} dot>{running ? 'Running' : 'Stopped'}</Badge> : undefined}
          actions={studioOffered() ? <OpenInStudio nodeId={nodeId} profileId={profileId} /> : undefined}
        />
      </PageItem>
      {installation.error && !installation.data ? <p role="alert" className="m-0 text-sm text-warning">Node inventory is unavailable: {errorMessage(installation.error)}</p> : null}
      <RequireRole roles={ADMIN_ONLY}>
        <PageItem className="empty:hidden">
          <HiveMemEnable nodeId={nodeId} profileId={profileId} nodeName={installation.data?.nodeName} running={running} onEnabled={() => setRefreshKey((value) => value + 1)} />
        </PageItem>
      </RequireRole>
      <PageItem>
        <div className="tabs" role="tablist" aria-label="Ardent profile sections">
          {TABS.map((item) => <button key={item} type="button" role="tab" aria-selected={tab === item} onClick={() => setTab(item)} className={cn('tab', tab === item && 'tab--active')}>{item}</button>)}
        </div>
      </PageItem>
      <PageItem key={`${tab}:${refreshKey}`}>
        {tab === 'Overview' ? <OverviewTab nodeId={nodeId} profileId={profileId} running={profile?.running} backend={profile?.backend} /> : null}
        {tab === 'Configuration' ? <ConfigurationTab nodeId={nodeId} profileId={profileId} /> : null}
        {tab === 'Identity' ? <IdentityTab nodeId={nodeId} profileId={profileId} /> : null}
        {tab === 'Providers' ? <ProvidersTab nodeId={nodeId} profileId={profileId} running={running} /> : null}
        {tab === 'Channels' ? <ChannelsTab nodeId={nodeId} profileId={profileId} running={running} /> : null}
        {tab === 'Peers' ? <PeersTab nodeId={nodeId} profileId={profileId} running={running} /> : null}
        {tab === 'Skills' ? <SkillsTab nodeId={nodeId} profileId={profileId} /> : null}
        {tab === 'Tasks & Artifacts' ? <TasksTab nodeId={nodeId} profileId={profileId} onChanged={() => setRefreshKey((value) => value + 1)} /> : null}
        {tab === 'API Reference' ? <ApiTab nodeId={nodeId} profileId={profileId} /> : null}
      </PageItem>
      <PageItem>
        <Button variant="ghost" size="sm" icon={<RefreshCw className="size-4" />} onClick={() => setRefreshKey((value) => value + 1)}>Refresh profile</Button>
      </PageItem>
    </div>
  );
}
