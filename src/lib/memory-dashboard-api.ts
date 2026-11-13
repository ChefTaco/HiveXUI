import { z } from 'zod';
import {
  MemoryWriteSchema, MemoryUpdateSchema, MemoryRecordSchema, MemorySearchRequestSchema,
  MemorySearchResponseSchema, MemoryBrowseResponseSchema, MemoryConflictQuerySchema,
  MemoryStatsSchema, MemoryQueueStatusSchema, MemoryQueueJobSchema, MemoryAgentSchema,
  SessionSchema, GraphNodeSchema, GraphSchema, WebhookSchema, WebhookDeliveriesSchema,
  type MemoryWrite, type MemoryUpdate,
} from '../../contracts/hivemem.generated';
import { parseAnswer } from './api-error';
import { memoryRequest } from './memory-api';

const id = (value: string) => encodeURIComponent(value);
async function read<T>(schema: z.ZodType<T>, path: string, method = 'GET', body?: object): Promise<T> {
  return parseAnswer(schema, await memoryRequest(path, method, body), 'HiveMem', method !== 'GET');
}
const value = <T>(result: PromiseSettledResult<T>) => result.status === 'fulfilled' ? result.value : null;

/** This aggregate is computed in the browser; every product response has an owned validator. */
async function memoryConsole(allowed: (permission: string) => boolean = () => true) {
  const enabled = <T>(permission: string, request: () => Promise<T>): Promise<T | null> =>
    allowed(permission) ? request() : Promise.resolve(null);
  const results = await Promise.allSettled([
    enabled('memories:read', () => read(MemoryStatsSchema, '/stats')),
    enabled('queue:read', () => read(MemoryQueueStatusSchema, '/queue/status?limit=8')),
    enabled('memories:read', () => read(MemoryBrowseResponseSchema, '/memories/browse?limit=12&workspace_id=*')),
    enabled('sessions:read', () => read(z.array(SessionSchema), '/sessions?limit=8&workspace_id=*')),
    enabled('agents:read', () => read(z.array(MemoryAgentSchema), '/agents')),
    enabled('memories:read', () => read(z.array(GraphNodeSchema), '/graph/entities?limit=12&workspace_id=*')),
  ] as const);
  if (results.every(result => result.status === 'rejected'))
    throw Error('Memory is unavailable or this identity has no permitted memory resources');
  const paths = ['stats', 'queue/status', 'memories/browse', 'sessions', 'agents', 'graph/entities'];
  const memories = value(results[2]);
  return {
    configured: true, stats: value(results[0]), queue: value(results[1]),
    memories: memories?.memories ?? [], memoryTotal: memories?.total ?? null,
    sessions: value(results[3]) ?? [], agents: value(results[4]) ?? [], graphEntities: value(results[5]) ?? [],
    issues: results.flatMap((result, index) => result.status === 'rejected'
      ? [`${paths[index]}: ${result.reason instanceof Error ? result.reason.message : 'Unavailable'}`] : []),
  };
}
export type MemoryConsoleData = Awaited<ReturnType<typeof memoryConsole>>;
export type MemorySearchResponse = z.infer<typeof MemorySearchResponseSchema> | z.infer<typeof MemoryBrowseResponseSchema>;

export const memoryDashboardApi = {
  memoryConsole,
  /** `agentId` keeps one actor's memories (HiveMem 1.5.0 and later). */
  async searchMemory(params: { query?: string; workspaceId?: string; scope?: string; agentId?: string; limit?: number; offset?: number }): Promise<MemorySearchResponse> {
    const search = new URLSearchParams({ workspace_id: params.workspaceId ?? '*', limit: String(params.limit ?? 25) });
    if (params.scope) search.set('scope', params.scope);
    if (params.query) {
      search.set('explain', 'true');
      return read(MemorySearchResponseSchema, '/memories/search?' + search, 'POST', MemorySearchRequestSchema.parse({
        query: params.query, workspace_id: params.workspaceId ?? '*', limit: params.limit ?? 25,
        offset: params.offset ?? 0, ...(params.scope ? { scope: params.scope } : {}), ...(params.agentId ? { agent_id: params.agentId } : {}),
      }));
    }
    if (params.agentId) search.set('agent_id', params.agentId);
    // HiveMem consumes offset; next_cursor is a response hint, not an input parameter.
    search.set('offset', String(params.offset ?? 0));
    return read(MemoryBrowseResponseSchema, '/memories/browse?' + search);
  },
  async createMemory(body: MemoryWrite) {
    if (!body.workspace_id?.trim() || body.workspace_id === '*') throw Error('Choose a specific workspace');
    return read(MemoryRecordSchema, '/memories', 'POST', MemoryWriteSchema.parse(body));
  },
  getMemory: (value: string) => read(MemoryRecordSchema, '/memories/' + id(value)),
  async updateMemory(value: string, body: MemoryUpdate) {
    return read(MemoryRecordSchema, '/memories/' + id(value), 'PUT', MemoryUpdateSchema.parse(body));
  },
  async deleteMemory(value: string) { await memoryRequest('/memories/' + id(value), 'DELETE'); },
  memoryGraph: (value: string) => read(GraphSchema, '/memories/' + id(value) + '/graph'),
  memoryQueue: (limit = 12) => read(MemoryQueueStatusSchema, '/queue/status?limit=' + limit),
  runMemoryQueueJob: (value: string) => read(MemoryQueueJobSchema, '/queue/jobs/' + id(value) + '/run', 'POST', {}),
  retryMemoryQueueJob: (value: string) => read(MemoryQueueJobSchema, '/queue/jobs/' + id(value) + '/retry', 'POST', {}),
  cancelMemoryQueueJob: (value: string) => read(MemoryQueueJobSchema, '/queue/jobs/' + id(value), 'DELETE'),
  async memoryConflicts(body: Record<string, unknown>) {
    return read(MemorySearchResponseSchema, '/memories/conflicts', 'POST', MemoryConflictQuerySchema.parse(body));
  },
  memoryWebhooks: () => read(z.array(WebhookSchema), '/webhooks'),
  memoryWebhookDeliveries: (limit = 10) => read(WebhookDeliveriesSchema, '/webhooks/deliveries?limit=' + limit),
};
