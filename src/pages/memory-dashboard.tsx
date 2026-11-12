import type { MemoryProfile } from '../../contracts/hivemem.generated';
import { memoryCan } from '../lib/memory-access';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { MemoryAccess } from '../components/memory-access';
const MemoryOperationsModule = lazy(() => import('../modules/memory-operations'));
import { Badge, Button, EmptyState, Field, JsonBlock, Panel, StatCard, TextArea, TextInput, PageHeader } from '../components/ui';
import { Icon } from '../components/icons';
import { useStore } from '../lib/store';
import { adminApi, ApiError } from '../lib/api';
import { can } from '../lib/permissions';
import type { AdminUser, MemoryConsoleData } from '../lib/types';
import { formatTime, relativeTime } from '../lib/format';

function text(value: unknown, fallback = 'unknown'): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function compactCount(value: unknown): string {
  const n = numberValue(value);
  return typeof n === 'number' ? n.toLocaleString() : '0';
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

// HiveMem finds conflicts by content: other agents' memories similar to this one.
function conflictQuery(memory: Record<string, unknown>): Record<string, unknown> {
  const query: Record<string, unknown> = { content: text(memory.content, ''), workspace_id: text(memory.workspace_id, 'default') };
  for (const key of ['scope', 'type']) if (typeof memory[key] === 'string') query[key] = memory[key];
  return query;
}

function recordsFrom(value: unknown, keys: string[]): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry));
  const source = record(value);
  for (const key of keys) {
    const maybe = source[key];
    if (Array.isArray(maybe)) {
      return maybe.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry));
    }
  }
  return [];
}

function memoryId(memory: Record<string, unknown>): string {
  return text(memory.id, text(memory.memory_id, ''));
}

export function MemoryDashboardPage({ currentUser, profile = null }: { currentUser: AdminUser | null; profile?: MemoryProfile | null }) {
  const app = useStore().data.hiveStatus?.apps.find((entry) => entry.key === 'memory');
  const [data, setData] = useState<MemoryConsoleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState(() => new URLSearchParams(location.search).get('q') ?? '');
  const searchGeneration = useRef(0);
  const detailGeneration = useRef(0);
  const [offset, setOffset] = useState(0);
  const [visibility, setVisibility] = useState<'private' | 'shared'>('private');
  const [createWorkspace, setCreateWorkspace] = useState(() => { const id = new URLSearchParams(location.search).get('workspace'); return id && id !== '*' ? id : 'default'; });
  const [panelIssues, setPanelIssues] = useState<string[]>([]);
  const [workspaceId, setWorkspaceId] = useState(() => new URLSearchParams(location.search).get('workspace') ?? '*');
  const [searched, setSearched] = useState(false);
  const [results, setResults] = useState<Array<Record<string, unknown>>>([]);
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);
  const [selectedContent, setSelectedContent] = useState('');
  const [graph, setGraph] = useState<Record<string, unknown> | null>(null);
  const [queue, setQueue] = useState<Record<string, unknown> | null>(null);
  const [conflicts, setConflicts] = useState<Record<string, unknown> | null>(null);
  const [webhooks, setWebhooks] = useState<Array<Record<string, unknown>> | null>(null);
  const [newContent, setNewContent] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [operationsOpen, setOperationsOpen] = useState(() => new URLSearchParams(location.search).has('memoryTab'));
  const allowed = (permission: string) => profile ? memoryCan(profile, permission) : can(currentUser, permission.endsWith(':read') ? 'memory:read' : 'memory:write');
  const canWriteMemory = allowed('memories:write');
  const canManageQueue = allowed('admin:queue');

  async function refresh() {
    setLoading(true);
    setError(null);
    setPanelIssues([]);
    try {
      const [consoleData, queueData, webhookData] = await Promise.all([
        adminApi.memoryConsole(allowed),
        !allowed('queue:read') ? null : adminApi.memoryQueue().catch(() => { setPanelIssues((prior) => [...prior, 'Queue unavailable']); return null; }),
        !allowed('webhooks:read') ? null : adminApi.memoryWebhooks().catch(() => { setPanelIssues((prior) => [...prior, 'Webhooks unavailable']); return null; }),
      ]);
      setData(consoleData);
      setPanelIssues(prior=>[...prior,...(consoleData.issues ?? [])]);
      if (queueData) setQueue(queueData);
      if (webhookData) setWebhooks(webhookData);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : caught instanceof Error ? caught.message : 'Failed to load Memory data');
    } finally {
      setLoading(false);
    }
  }

  async function run<T>(label: string, action: () => Promise<T>, isCurrent = () => true): Promise<T | null> {
    setBusy(label);
    setError(null);
    try {
      return await action();
    } catch (caught) {
      if (isCurrent()) setError(caught instanceof ApiError ? caught.message : caught instanceof Error ? caught.message : `${label} failed`);
      return null;
    } finally {
      if (isCurrent()) setBusy(null);
    }
  }

  async function runSearch(nextOffset = 0) {
    const generation = ++searchGeneration.current;
    const url = new URL(location.href); url.searchParams.set('q', query); url.searchParams.set('workspace', workspaceId); history.replaceState(null, '', url);
    setOffset(nextOffset);
    const response = await run('search', () => adminApi.searchMemory({ query: query.trim(), workspaceId, limit: 25, offset: nextOffset }), () => generation === searchGeneration.current);
    if (response && generation === searchGeneration.current) {
      setSearched(true);
      setResults(recordsFrom(response, ['results', 'memories', 'items']).map((entry) => entry.memory ? record(entry.memory) : entry));
    }
  }

  async function openMemory(memory: Record<string, unknown>) {
    const id = memoryId(memory);
    if (!id) return;
    const generation = ++detailGeneration.current;
    const isCurrent = () => generation === detailGeneration.current;
    setSelected(null); setSelectedContent(''); setGraph(null); setConflicts(null);
    const detail = await run('memory-detail', () => adminApi.getMemory(id), isCurrent);
    if (generation !== detailGeneration.current) return;
    if (detail) {
      setSelected(detail);
      setSelectedContent(text(detail.content, ''));
    }
    if (!detail) return;
    const graphData = await run('memory-graph', () => adminApi.memoryGraph(id), isCurrent);
    if (generation !== detailGeneration.current) return;
    if (graphData) setGraph(graphData);
    const conflictData = await run('memory-conflicts', () => adminApi.memoryConflicts(conflictQuery(detail)), isCurrent);
    if (generation === detailGeneration.current && conflictData) setConflicts(conflictData);
  }

  async function createMemory() {
    if (!newContent.trim()) return;
    const generation = detailGeneration.current;
    const created = await run('create-memory', () => adminApi.createMemory({
      content: newContent.trim(),
      type: 'semantic',
      scope: visibility,
      source: 'user_feedback',
      workspace_id: createWorkspace,
      tags: ['operator-created'],
      metadata: { created_from: 'hive-console' },
    }));
    if (created) {
      setNewContent('');
      await refresh();
      if (searched) await runSearch();
      if (generation === detailGeneration.current) await openMemory(created);
    }
  }

  async function saveSelected() {
    if (!selected) return;
    const id = memoryId(selected);
    if (!id) return;
    const generation = detailGeneration.current;
    const updated = await run('update-memory', () => adminApi.updateMemory(id, { content: selectedContent }), () => generation === detailGeneration.current);
    if (updated && generation === detailGeneration.current) {
      setSelected(updated);
      await refresh();
      if (searched) await runSearch(offset);
    }
  }

  async function deleteSelected() {
    if (!selected) return;
    const id = memoryId(selected);
    if (!id || !window.confirm('Delete this memory?')) return;
    const generation = ++detailGeneration.current;
    const deleted = await run('delete-memory', async () => { await adminApi.deleteMemory(id); return true; }, () => generation === detailGeneration.current);
    if (deleted && generation === detailGeneration.current) {
      setSelected(null);
      setSelectedContent('');
      setGraph(null);
      setConflicts(null);
      await refresh();
      if (searched) await runSearch(Math.max(0, results.length === 1 ? offset - 25 : offset));
    }
  }

  async function queueAction(label: string, action: () => Promise<Record<string, unknown>>) {
    const result = await run(label, action);
    if (result) {
      const queueData = await adminApi.memoryQueue().catch(() => { setPanelIssues((prior) => [...prior, 'Queue unavailable']); return null; });
      if (queueData) setQueue(queueData);
    }
  }

  useEffect(() => {
    void refresh();
    const params = new URLSearchParams(location.search);
    if (params.has('q') || params.has('workspace')) void runSearch();
  }, []);

  const stats = record(data?.stats);
  const dashboardQueue = record(queue ?? data?.queue);
  const queueCounts = record(dashboardQueue.counts);
  const worker = record(dashboardQueue.worker);
  const memoryTotal = data?.memoryTotal ?? stats.memories ?? stats.memory_count;
  const visibleMemories = searched ? results : data?.memories ?? [];
  const latestMemory = selected;
  const queueJobs = recordsFrom(dashboardQueue, ['jobs', 'results', 'items']);
  const webhookRows = recordsFrom(webhooks, ['webhooks', 'results', 'items']);

  return (
    <>
      <PageHeader
        title="Memories"
        description="Native HiveMem operations inside the unified console."
        actions={<div className="panel-actions">
          {app ? (
            <Badge tone={app.status === 'online' ? 'success' : app.status === 'degraded' ? 'warning' : 'danger'} dot>
              {app.status}
            </Badge>
          ) : null}
          <Button variant="ghost" icon={<Icon.Refresh className="btn-ico" />} loading={loading} onClick={() => void refresh()}>
            Refresh
          </Button>
        </div>}
      />

      {error ? (
        <div className="error-banner">
          <Icon.Alert />
          {error}
        </div>
      ) : null}

      <Panel title="Sessions, integrations and reasoning">
        <p>Manage session history, webhook delivery, graph evidence, conflicts, consolidation and the reasoning queue.</p>
        <Button onClick={() => setOperationsOpen(value => !value)}>{operationsOpen ? 'Hide memory operations' : 'Open memory operations'}</Button>
      </Panel>
      {operationsOpen && <Suspense fallback={<p role="status">Loading memory operations…</p>}>
        {profile ? <MemoryOperationsModule profile={profile} /> : <MemoryAccess>{identity => <MemoryOperationsModule profile={identity} />}</MemoryAccess>}
      </Suspense>}

      <div className="page-grid--4">
        <StatCard label="Memories" value={compactCount(memoryTotal)} sub="visible to your product account" tone="accent" />
        <StatCard label="Sessions" value={compactCount(stats.sessions ?? data?.sessions.length)} sub="active history containers" tone="accent" />
        <StatCard label="Agents" value={compactCount(stats.agents ?? data?.agents.length)} sub="registered memory actors" tone="accent" />
        <StatCard label="Queue" value={compactCount(dashboardQueue.pending_count ?? queueCounts.pending ?? dashboardQueue.pending ?? 0)} sub="pending jobs" tone={numberValue(queueCounts.failed) ? 'danger' : 'neutral'} />
      </div>

      <div className="page-grid page-grid--2">
        <Panel title="Search And Create" eyebrow="native operations">
          <div className="form-grid form-grid--compact">
            <Field label="Search">
              <TextInput value={query} onChange={setQuery} placeholder="memory text, tag, or entity" />
            </Field>
            <Field label="Workspace">
              <TextInput value={workspaceId} onChange={setWorkspaceId} placeholder="default or *" />
            </Field>
          </div>
          <div className="inline-actions">
            <Button variant="primary" icon={<Icon.Activity className="btn-ico" />} disabled={!allowed('memories:read')} loading={busy === 'search'} onClick={() => void runSearch()}>
              Search
            </Button>
            <Button variant="ghost" icon={<Icon.Refresh className="btn-ico" />} loading={loading} onClick={() => void refresh()}>
              Refresh
            </Button>
          </div>
          {panelIssues.length > 0 && <p role="alert">{panelIssues.join('. ')}. Previous data may be stale.</p>}
          <div className="inline-actions">
            <Button variant="ghost" disabled={offset === 0} onClick={() => void runSearch(Math.max(0, offset - 25))}>Previous</Button>
            <span>Page {Math.floor(offset / 25) + 1}</span>
            <Button variant="ghost" disabled={results.length < 25} onClick={() => void runSearch(offset + 25)}>Next</Button>
          </div>
          <Field label="Create in workspace"><TextInput value={createWorkspace} onChange={setCreateWorkspace} /></Field>
          <Field label="Visibility" hint="Private records belong to your linked memory account.">
            <select value={visibility} onChange={(event) => setVisibility(event.target.value as 'private' | 'shared')}><option value="private">Private</option><option value="shared">Shared in workspace</option></select>
          </Field>
          <Field label="Create memory">
            <TextArea value={newContent} onChange={setNewContent} rows={4} placeholder="What should Hive remember?" />
          </Field>
          <div className="inline-actions justify-end">
            <Button variant="primary" loading={busy === 'create-memory'} disabled={!canWriteMemory || !newContent.trim()} onClick={() => void createMemory()}>
              Create
            </Button>
          </div>
        </Panel>

        <Panel title="Recent And Search Results" eyebrow={`${visibleMemories.length} records`}>
          {loading ? (
            <div className="center-load"><span className="spinner" /></div>
          ) : visibleMemories.length ? (
            <div className="stack-list">
              {visibleMemories.map((memory, index) => (
                <button className="stack-item stack-item--button" key={memoryId(memory) || `memory-${index}`} onClick={() => void openMemory(memory)}>
                  <div>
                    <strong>{text(memory.content, 'Untitled memory').slice(0, 180)}</strong>
                    <span className="muted-line">
                      {text(memory.type)} · {text(memory.scope)} · {text(memory.workspace_id, 'default')}
                    </span>
                  </div>
                  <Badge tone={text(memory.confidence).startsWith('0.') ? 'warning' : 'success'}>
                    {typeof memory.confidence === 'number' ? `${Math.round(memory.confidence * 100)}%` : text(memory.confidence, 'stored')}
                  </Badge>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState icon={<Icon.Activity width={34} height={34} />} message="No memories returned by HiveMem." />
          )}
        </Panel>

        <Panel title="Queue" eyebrow="run, retry, cancel">
          <div className="kv-list" aria-label="Worker status">
            <div className="kv-row"><span>Worker</span><span>{text(worker.state, 'unavailable')}</span></div>
            <div className="kv-row"><span>Heartbeat</span><span>{typeof worker.heartbeat === 'string' ? relativeTime(worker.heartbeat) : 'not reported'}</span></div>
            <div className="kv-row"><span>Oldest pending</span><span>{typeof worker.oldest_pending_seconds === 'number' ? `${Math.round(worker.oldest_pending_seconds)} seconds` : 'none'}</span></div>
            <div className="kv-row"><span>Recovered at startup</span><span>{compactCount(worker.recovered_on_startup)}</span></div>
            <div className="kv-row"><span>Dead letters</span><span>{compactCount(dashboardQueue.dead_letter_count)}</span></div>
          </div>
          <p className="muted">{typeof worker.error === 'string' ? worker.error + '. Restore the dependency, then refresh; failed jobs can be retried below.' : worker.state === 'disabled' || worker.state === 'manual' ? 'Automatic processing is off. Use Run for individual jobs or enable the service worker.' : worker.state === 'stale' ? 'Heartbeat is stale. Check the Memory service and its dependency status before retrying work.' : 'Failed jobs retry with backoff. Inspect dead letters before choosing Retry.'}</p>
          <div className="kv-list">
            <div className="kv-row"><span>Pending</span><span className="cell-mono">{compactCount(dashboardQueue.pending_count ?? queueCounts.pending ?? dashboardQueue.pending)}</span></div>
            <div className="kv-row"><span>Running</span><span className="cell-mono">{compactCount(dashboardQueue.in_progress_count ?? queueCounts.running ?? dashboardQueue.running)}</span></div>
            <div className="kv-row"><span>Failed</span><span className="cell-mono">{compactCount(dashboardQueue.failed_count ?? queueCounts.failed ?? dashboardQueue.failed)}</span></div>
            <div className="kv-row"><span>Agents</span><span className="cell-mono">{compactCount(data?.agents.length)}</span></div>
          </div>
          {queueJobs.length ? (
            <div className="stack-list stack-list--compact">
              {queueJobs.slice(0, 6).map((job, index) => {
                const id = text(job.id, '');
                const runnable = ['pending', 'failed', 'dead_letter'].includes(text(job.status));
                const retryable = ['failed', 'dead_letter', 'cancelled'].includes(text(job.status));
                return (
                <div className="stack-item" key={id || `job-${index}`}>
                  <div>
                    <strong>{text(job.task_type, 'queue job')}</strong>
                    <span className="muted-line">{text(job.status)} · {text(job.workspace_id, 'default')}</span>
                  </div>
                  <div className="inline-actions">
                    <Button size="sm" variant="ghost" disabled={!canManageQueue || !id || !runnable} loading={busy === `run-${id}`} onClick={() => void queueAction(`run-${id}`, () => adminApi.runMemoryQueueJob(id))}>Run</Button>
                    <Button size="sm" variant="ghost" disabled={!canManageQueue || !id || !retryable} loading={busy === `retry-${id}`} onClick={() => void queueAction(`retry-${id}`, () => adminApi.retryMemoryQueueJob(id))}>Retry</Button>
                    <Button size="sm" variant="danger" disabled={!canManageQueue || !id || !runnable} loading={busy === `cancel-${id}`} onClick={() => void queueAction(`cancel-${id}`, () => adminApi.cancelMemoryQueueJob(id))}>Cancel</Button>
                  </div>
                </div>
              );
              })}
            </div>
          ) : (
            <EmptyState message="No queue jobs returned." />
          )}
        </Panel>

        <Panel title="Webhooks" eyebrow="delivery wiring">
          {webhookRows.length ? (
            <div className="stack-list stack-list--compact">
              {webhookRows.slice(0, 6).map((webhook, index) => (
                <div className="stack-item" key={text(webhook.id, `webhook-${index}`)}>
                  <div>
                    <strong>{text(webhook.name, text(webhook.url, 'Webhook'))}</strong>
                    <span className="muted-line">{text(webhook.status, text(webhook.last_status, 'configured'))}</span>
                  </div>
                  <Badge tone={webhook.enabled === false ? 'neutral' : 'success'}>{webhook.enabled === false ? 'off' : 'on'}</Badge>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState message="No webhooks returned." />
          )}
        </Panel>
      </div>

      <div className="page-grid page-grid--2">
        <Panel title="Memory Detail" eyebrow={latestMemory ? memoryId(latestMemory) || 'selected record' : 'raw service payload'}>
          {latestMemory ? (
            <>
              <Field label="Content">
                <TextArea value={selectedContent} onChange={setSelectedContent} rows={6} />
              </Field>
              <div className="inline-actions">
                <Button variant="primary" loading={busy === 'update-memory'} disabled={!canWriteMemory || !selected} onClick={() => void saveSelected()}>Save</Button>
                <Button variant="danger" loading={busy === 'delete-memory'} disabled={!canWriteMemory || !selected} onClick={() => void deleteSelected()}>Delete</Button>
              </div>
              <JsonBlock value={latestMemory} />
            </>
          ) : <JsonBlock value={data ?? { loading }} />}
        </Panel>

        <Panel title="Graph And Conflicts" eyebrow="selected memory">
          <p className="panel-eyebrow">Graph</p>
          <JsonBlock value={graph ?? { message: 'Select a memory to load graph neighborhood.' }} />
          <p className="panel-eyebrow mt-4">Conflicts</p>
          <JsonBlock value={conflicts ?? { message: 'Select a memory to detect conflicts.' }} />
        </Panel>
      </div>

      <Panel title="Recent Sessions" eyebrow="Memory history">
        {data?.sessions.length ? (
          <div className="stack-list stack-list--compact">
            {data.sessions.slice(0, 5).map((session, index) => (
              <div className="stack-item" key={text(session.session_id, `session-${index}`)}>
                <div>
                  <strong>{text(session.title, text(session.session_id, 'Session'))}</strong>
                  <span className="muted-line">{text(session.workspace_id, 'default')}</span>
                </div>
                {typeof session.created_at === 'string' ? <span className="cell-mono" title={formatTime(session.created_at)}>{relativeTime(session.created_at)}</span> : null}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState message="No sessions returned." />
        )}
      </Panel>
    </>
  );
}
