// The palette's live record sources: one per searchable list, each read with the product's own
// released contract. Loaded on the first record search, so the contracts stay out of the main chunk.
//
// Every read goes through `quietApiFetch`: a search never opens a verification prompt, and a
// refusal (401/403) hides the source. Lists without a server-side search are read and filtered
// here, so the query never leaves the browser for them. Nothing here logs a query.
import { z } from 'zod';
import { listProjectsResponseSchema } from '@contracts/ardentstudio.generated';
import { securityBrowserResponseSchema, type FusionCase } from '@contracts/cindertrace/browser';
import { adminMeSchema, modelConsoleSchemas } from '@contracts/emberpath-model-admin.generated';
import { MemoryProfileSchema, MemorySearchRequestSchema, MemorySearchResponseSchema } from '@contracts/hivemem.generated';
import { SkillListSchema } from '@contracts/hiveskills.generated';
import { hermesInstallationsResponseSchema, hermesProfilesResponseSchema, nodeListResponseSchema } from '@contracts/magnus/browser';
import { BrowserResourceUserResponseSchema, IamClientsResponseSchema, IamUsersResponseSchema } from '@contracts/oathweave-browser.generated';
import { parseAgentRef } from '../modules/agents/paths';
import { hiveApiError } from './api-error';
import { memoryCan } from './memory-access';
import { can } from './permissions';
import { isDenied, looksLikeId, matchesQuery, type RecordHit, type RecordSource } from './record-search';
import { linkTo } from './routes';
import { browserIdentity } from './runtime';
import { quietApiFetch, type Product } from './transport';
import type { AdminUser } from './types';

type Fetch = (path: string, init?: RequestInit) => Promise<Response>;

export interface SourceContext {
  /** The shell's user: the permissions a legacy runtime (no Oathweave sign-in) goes by. */
  user: AdminUser | null;
  /** Whether a suite sign-in is in use, so product permissions come from each product. */
  suite: boolean;
  /** The Magnus session: its role, and whether Hermes is on. Null without a Magnus session. */
  magnus: () => Promise<{ hermes: boolean } | null>;
  fetch: Fetch;
}

async function read<S extends z.ZodType>(send: Fetch, path: string, schema: S, signal: AbortSignal, init: RequestInit = {}): Promise<z.output<S>> {
  const response = await send(path, { ...init, signal, headers: { Accept: 'application/json', ...(init.headers as Record<string, string> | undefined) } });
  if (!response.ok) throw await hiveApiError(response, { fallback: 'The search could not be completed' });
  const parsed = schema.safeParse(await response.json().catch(() => undefined));
  if (!parsed.success) throw new Error('The product answered in a shape this search does not know');
  return parsed.data;
}

/**
 * A permission check, asked once per palette and shared by its searches. A refusal is a "no"; any
 * other failure is asked again next time.
 */
function once<T>(check: () => Promise<T>, denied: T): () => Promise<T> {
  let known: Promise<T> | undefined;
  return () => {
    if (!known) {
      const attempt = check().catch((error: unknown) => {
        if (isDenied(error)) return denied;
        if (known === attempt) known = undefined;
        throw error;
      });
      known = attempt;
    }
    return known;
  };
}

const shorten = (text: string, length = 90): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat;
};

/** The sources for one palette. */
export function createRecordSources(context: SourceContext): RecordSource[] {
  const { fetch: send } = context;
  const productUser = (product: 'emberpath' | 'oathweave') =>
    once(async (): Promise<AdminUser | null> => {
      if (!context.suite) return context.user;
      const path = product === 'oathweave' ? '/api/iam/auth/me' : '/api/auth/me';
      const schema = product === 'oathweave' ? BrowserResourceUserResponseSchema : adminMeSchema;
      return (await read(send, path, schema, new AbortController().signal)).user as AdminUser;
    }, null);
  const oathweaveUser = productUser('oathweave');
  const emberpathUser = productUser('emberpath');
  const memoryReader = once(async () => {
    const profile = await read(send, '/api/memory/profile', MemoryProfileSchema, new AbortController().signal);
    return memoryCan(profile, 'memories:read');
  }, false);
  const magnusSession = once(context.magnus, null);
  const anyone = async () => true;

  const nodes: RecordSource = {
    id: 'magnus-nodes',
    product: 'magnus',
    name: 'Magnus',
    kind: 'Node',
    allowed: async () => (await magnusSession()) !== null,
    async search(query, limit, signal) {
      const search = new URLSearchParams({ page: '1', pageSize: String(limit), query });
      const answer = await read(send, `/api/magnus/nodes?${search}`, nodeListResponseSchema, signal);
      // A Magnus that ignores `query` lists every node; only the names asked for are shown.
      return answer.data
        .filter((node) => matchesQuery(query, node.name, node.hostname))
        .map((node): RecordHit => ({ id: node.id, label: node.name, detail: node.hostname, href: linkTo('magnus', '/nodes/:nodeId', { nodeId: node.id }), icon: 'Server' }));
    },
  };
  const agents: RecordSource = {
    id: 'magnus-agents',
    product: 'magnus',
    name: 'Magnus',
    kind: 'Agent',
    allowed: async () => (await magnusSession())?.hermes === true,
    async search(query, _limit, signal) {
      const [installations, profiles] = await Promise.all([
        read(send, '/api/magnus/orchestra/installations', hermesInstallationsResponseSchema, signal),
        read(send, '/api/magnus/orchestra/profiles', hermesProfilesResponseSchema, signal),
      ]);
      const byId = new Map(installations.data.map((installation) => [installation.id, installation]));
      const hits: RecordHit[] = [];
      for (const profile of profiles.data) {
        const installation = byId.get(profile.installationId);
        const ref = installation?.nodeId ? parseAgentRef(`${installation.nodeId}~${profile.name}`) : null;
        if (!installation || !ref) continue;
        const host = installation.displayName ?? installation.hostname;
        if (!matchesQuery(query, profile.name, installation.displayName, installation.hostname)) continue;
        hits.push({ id: ref.agentRef, label: profile.name, detail: host, href: linkTo('agents', 'agent', { agentRef: ref.agentRef }), icon: 'Radar' });
      }
      return hits;
    },
  };
  const projects: RecordSource = {
    id: 'studio-projects',
    product: 'ardentstudio',
    name: 'Studio',
    kind: 'Project',
    allowed: anyone,
    async search(query, limit, signal) {
      const search = new URLSearchParams({ status: 'all', q: query });
      const answer = await read(send, `/api/ardentstudio/v1/projects?${search}`, listProjectsResponseSchema, signal);
      return answer.projects.slice(0, limit).map((project): RecordHit => ({
        id: project.id,
        label: project.name,
        detail: project.status === 'archived' ? 'Archived' : undefined,
        href: linkTo('ardentstudio', 'project', { projectId: project.id }),
        icon: 'Workflow',
      }));
    },
    seeAll: (query) => linkTo('ardentstudio', 'projects', { q: query }),
  };
  const memoriesHref = (query: string) => linkTo('hivemem', 'memories', { q: query, workspace: '*' });
  const memories: RecordSource = {
    id: 'hivemem-memories',
    product: 'hivemem',
    name: 'HiveMem',
    kind: 'Memory',
    allowed: memoryReader,
    async search(query, limit, signal) {
      const body = MemorySearchRequestSchema.parse({ query, workspace_id: '*', limit });
      const answer = await read(send, '/api/memory/memories/search?workspace_id=*', MemorySearchResponseSchema, signal, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      // The Memories page has no address for one memory; each opens the same search there.
      return answer.results.map(({ memory }): RecordHit => ({ id: memory.id, label: shorten(memory.content), detail: `${memory.type} · ${memory.agent_id}`, href: memoriesHref(query), icon: 'Brain' }));
    },
    seeAll: memoriesHref,
  };
  const cases: RecordSource = {
    id: 'cindertrace-cases',
    product: 'cindertrace',
    name: 'Cindertrace',
    kind: 'Case',
    allowed: anyone,
    async search(query, _limit, signal) {
      // Cindertrace has no case search: its case list is read and filtered here.
      const path = 'security-fusion/cases';
      const answer = await read(send, `/api/security/${path}`, securityBrowserResponseSchema(path), signal);
      return (answer.data as FusionCase[])
        .filter((item) => item.id === query || matchesQuery(query, item.title))
        .map((item): RecordHit => ({ id: item.id, label: item.title, detail: `${item.severity} · ${item.status}`, href: linkTo('cindertrace', 'case', { caseId: item.id }), icon: 'ScanSearch' }));
    },
  };
  const traces: RecordSource = {
    id: 'emberpath-traces',
    product: 'emberpath',
    name: 'Emberpath',
    kind: 'Trace',
    applies: looksLikeId,
    allowed: async () => can(await emberpathUser(), 'router:admin:read'),
    async search(query, _limit, signal) {
      // Emberpath has no lookup by ID: the recent traces the Traces page shows are read and matched
      // here, exactly, by trace or request ID.
      const answer = await read(send, '/api/traces', modelConsoleSchemas.traces, signal);
      return answer.data
        .filter((trace) => trace.id === query || trace.requestId === query)
        .map((trace): RecordHit => ({ id: trace.id, label: `${trace.method} ${trace.path}`, detail: `Request ${trace.requestId}`, href: linkTo('emberpath', 'traces', { trace: trace.id }), icon: 'Activity' }));
    },
  };
  const skills: RecordSource = {
    id: 'hiveskills-skills',
    product: 'hiveskills',
    name: 'HiveSkills',
    kind: 'Skill',
    allowed: anyone,
    async search(query, _limit, signal) {
      // The catalog has no search: it is read and filtered here.
      const answer = await read(send, '/api/skills/v1/skills', SkillListSchema, signal);
      return answer
        .filter((skill) => matchesQuery(query, skill.slug, skill.name, skill.description))
        .map((skill): RecordHit => ({ id: skill.slug, label: skill.name, detail: skill.slug, href: linkTo('hiveskills', 'skills'), icon: 'Puzzle' }));
    },
  };
  const users: RecordSource = {
    id: 'oathweave-users',
    product: 'oathweave',
    name: 'Oathweave',
    kind: 'User',
    allowed: async () => can(await oathweaveUser(), 'iam:users:read'),
    async search(query, limit, signal) {
      const search = new URLSearchParams({ search: query, limit: String(limit) });
      const answer = await read(send, `/api/iam/users?${search}`, IamUsersResponseSchema, signal);
      return answer.users
        .filter((user) => matchesQuery(query, user.username, user.email, user.displayName))
        .map((user): RecordHit => ({ id: user.id, label: user.displayName ?? user.username, detail: user.email, href: linkTo('oathweave', 'iam-users'), icon: 'Key' }));
    },
  };
  const clients: RecordSource = {
    id: 'oathweave-clients',
    product: 'oathweave',
    name: 'Oathweave',
    kind: 'Client',
    allowed: async () => can(await oathweaveUser(), 'iam:clients:read'),
    async search(query, _limit, signal) {
      // Oathweave has no client search: the client list is read and filtered here.
      const answer = await read(send, '/api/iam/clients', IamClientsResponseSchema, signal);
      return answer.clients
        .filter((client) => client.id === query || matchesQuery(query, client.name, client.description))
        .map((client): RecordHit => ({ id: client.id, label: client.name, detail: client.clientType, href: linkTo('oathweave', 'iam-clients'), icon: 'Route' }));
    },
  };
  return [nodes, agents, projects, memories, cases, traces, skills, users, clients];
}

/** The sources for the running app: the shell's user, and the Magnus session store. */
export function liveRecordSources(user: AdminUser | null): RecordSource[] {
  return createRecordSources({
    user,
    suite: !!browserIdentity(),
    fetch: quietApiFetch,
    async magnus() {
      const { sessionStore } = await import('../modules/magnus/session-store');
      await sessionStore.load();
      const state = sessionStore.get();
      return state.status === 'ready' ? { hermes: state.session.capabilities.hermes } : null;
    },
  });
}

