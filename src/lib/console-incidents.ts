import { z } from 'zod';
import { adminMeSchema, modelConsoleSchemas } from '../../contracts/emberpath-model-admin.generated';
import { BrowserResourceUserResponseSchema, IamAuditResponseSchema } from '../../contracts/oathweave-browser.generated';
import { MemoryProfileSchema, MemoryQueueStatusSchema } from '../../contracts/hivemem.generated';
import { apiFetch, type Product } from './transport';
import { hiveApiError } from './api-error';
import { productEnabled } from './runtime';
import { can } from './permissions';
import { memoryCan } from './memory-access';
import type { HiveIncident, HiveIncidentEvent } from './types';

/** Correlation hints computed from authorized reads; owning products retain durable investigations. */
export function groupIncidentEvents(events: HiveIncidentEvent[]): HiveIncident[] {
  const groups = new Map<string, HiveIncidentEvent[]>();
  for (const event of events) {
    const time = Date.parse(event.timestamp);
    if (!Number.isFinite(time)) continue;
    const window = Math.floor(time / 300000);
    const key = event.requestId ? `request:${event.requestId}:${window}` : `${event.service}:${event.kind}:${window}`;
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }
  return [...groups.entries()].map(([key, values]) => {
    const sorted = values.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    const services = [...new Set(sorted.map(event => event.service))];
    const first = sorted[0]!, last = sorted.at(-1)!;
    return {
      id: key, severity: sorted.some(event => event.severity === 'critical') ? 'critical' as const : 'warning' as const,
      status: 'open' as const, title: services.length > 1 ? 'Correlated product failures' : first.title,
      summary: `${sorted.length} failure event${sorted.length === 1 ? '' : 's'} from ${services.join(', ')}`,
      startedAt: first.timestamp, endedAt: last.timestamp, requestIds: [...new Set(sorted.flatMap(event => event.requestId ? [event.requestId] : []))],
      services, actors: [...new Set(sorted.flatMap(event => event.actor ? [event.actor] : []))], events: sorted,
    };
  }).sort((a, b) => Date.parse(b.endedAt) - Date.parse(a.endedAt));
}

export async function readConsoleIncidents(
  send: typeof apiFetch = apiFetch,
  enabled: (product: Product) => boolean = productEnabled,
): Promise<{ data: HiveIncident[]; issues: string[] }> {
  async function get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    const response = await send(path);
    if (!response.ok) throw await hiveApiError(response, { trustMessage: false, fallback: (status) => `Read unavailable (${status})` });
    return schema.parse(await response.json());
  }
  const sources: Array<{ product: Product; read: () => Promise<HiveIncidentEvent[]> }> = [
    { product: 'emberpath', read: async () => {
      const principal = await get('/api/auth/me', adminMeSchema);
      if (!can(principal.user, 'router:admin:read')) return [];
      const traces = await get('/api/traces', modelConsoleSchemas.traces);
      return traces.data.filter(trace => (trace.statusCode ?? 0) >= 400 || /fail|error|denied/i.test(trace.outcome)).map(trace => ({
        id: 'router:' + trace.id, service: 'router', kind: 'inference', severity: (trace.statusCode ?? 0) >= 500 ? 'critical' : 'warning',
        timestamp: trace.createdAt, title: 'Model request failed', requestId: trace.requestId || null,
        actor: trace.clientApiKeyId, outcome: trace.outcome,
        details: { method: trace.method, path: trace.path, statusCode: trace.statusCode, providerKind: trace.providerKind, providerModel: trace.providerModel },
      }));
    } },
    { product: 'oathweave', read: async () => {
      const principal = await get('/api/iam/auth/me', BrowserResourceUserResponseSchema);
      if (!can(principal.user, 'iam:audit:read')) return [];
      const audit = await get('/api/iam/audit?limit=50', IamAuditResponseSchema);
      return audit.events.filter(event => /fail|error|denied|blocked/i.test(event.outcome)).map(event => ({
        id: 'iam:' + event.id, service: 'iam', kind: event.category, severity: 'warning', timestamp: event.timestamp,
        title: 'Identity operation denied or failed',
        requestId: typeof event.detail?.requestId === 'string' ? event.detail.requestId : null,
        actor: event.actorId ?? null, outcome: event.outcome,
        details: { action: event.action, eventType: event.eventType, resourceType: event.resourceType ?? null },
      }));
    } },
    { product: 'hivemem', read: async () => {
      const principal = await get('/api/memory/profile', MemoryProfileSchema);
      if (!memoryCan(principal, 'queue:read')) return [];
      const queue = await get('/api/memory/queue/status?limit=50', MemoryQueueStatusSchema);
      return queue.jobs.filter(job => ['failed', 'dead_letter'].includes(job.status)).map(job => ({
        id: 'memory:' + job.id, service: 'memory', kind: job.task_type, severity: job.status === 'dead_letter' ? 'critical' : 'warning',
        timestamp: job.finished_at ?? job.created_at, title: 'Memory job needs review', requestId: null,
        actor: job.owner_agent_id, outcome: job.status,
        details: { taskType: job.task_type, workspaceId: job.workspace_id, retryCount: job.retry_count },
      }));
    } },
  ];
  const selected = sources.filter(source => enabled(source.product));
  const results = await Promise.allSettled(selected.map(source => source.read()));
  return {
    data: groupIncidentEvents(results.flatMap(result => result.status === 'fulfilled' ? result.value : [])),
    issues: results.flatMap((result, index) => result.status === 'rejected' ? [`${selected[index]!.product}: failure summary unavailable`] : []),
  };
}
