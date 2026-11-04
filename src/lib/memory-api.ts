import { z } from 'zod';
import { apiFetch } from './transport';
import {
  MemoryProfileSchema,
  WorkspaceSchema,
  WorkspaceCreateSchema,
  WorkspaceUpdateSchema,
  WorkspaceMemberUpdateSchema,
  type WorkspaceCreate,
  type WorkspaceUpdate,
  type WorkspaceMemberUpdate,
} from '../../contracts/hivemem.generated';

async function memoryRequest(
  path: string,
  method = 'GET',
  body?: object,
): Promise<unknown> {
  const response = await apiFetch('/api/memory' + path, {
    method,
    ...(body
      ? {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {}),
  });
  if (response.status === 204) return null;
  const result: unknown = await response.json();
  if (!response.ok)
    throw new Error(
      result &&
        typeof result === 'object' &&
        'detail' in result &&
        typeof result.detail === 'string'
        ? result.detail
        : `HiveMem request failed (${response.status})`,
    );
  return result;
}
export const memoryApi = {
  profile: async () =>
    MemoryProfileSchema.parse(await memoryRequest('/profile')),
  workspaces: async (offset: number, includeArchived: boolean) =>
    z
      .array(WorkspaceSchema)
      .parse(
        await memoryRequest(
          `/workspaces?limit=25&offset=${offset}&include_deleted=${includeArchived}`,
        ),
      ),
  workspace: async (id: string) =>
    WorkspaceSchema.parse(
      await memoryRequest(
        '/workspaces/' + encodeURIComponent(id) + '?include_deleted=true',
      ),
    ),
  create: async (body: WorkspaceCreate) =>
    WorkspaceSchema.parse(
      await memoryRequest(
        '/workspaces',
        'POST',
        WorkspaceCreateSchema.parse(body),
      ),
    ),
  update: async (id: string, body: WorkspaceUpdate) =>
    WorkspaceSchema.parse(
      await memoryRequest(
        '/workspaces/' + encodeURIComponent(id),
        'PUT',
        WorkspaceUpdateSchema.parse(body),
      ),
    ),
  archive: async (id: string) => {
    await memoryRequest('/workspaces/' + encodeURIComponent(id), 'DELETE');
  },
  restore: async (id: string) =>
    WorkspaceSchema.parse(
      await memoryRequest(
        '/workspaces/' + encodeURIComponent(id) + '/restore',
        'POST',
      ),
    ),
  member: async (id: string, agentId: string, body: WorkspaceMemberUpdate) =>
    WorkspaceSchema.parse(
      await memoryRequest(
        '/workspaces/' +
          encodeURIComponent(id) +
          '/members/' +
          encodeURIComponent(agentId),
        'PUT',
        WorkspaceMemberUpdateSchema.parse(body),
      ),
    ),
  removeMember: async (id: string, agentId: string) =>
    WorkspaceSchema.parse(
      await memoryRequest(
        '/workspaces/' +
          encodeURIComponent(id) +
          '/members/' +
          encodeURIComponent(agentId),
        'DELETE',
      ),
    ),
  settings: (id: string, agentId: string, sessionId: string) =>
    memoryRequest(
      '/workspaces/' +
        encodeURIComponent(id) +
        '/settings?' +
        new URLSearchParams({
          ...(agentId ? { agent_id: agentId } : {}),
          ...(sessionId ? { session_id: sessionId } : {}),
        }),
    ),
  scheduleDream: (id: string) =>
    memoryRequest(
      '/workspaces/' + encodeURIComponent(id) + '/schedule-dream',
      'POST',
      {},
    ),
};
