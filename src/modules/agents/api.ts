// Every read Agent 360 makes, one product at a time. Each answer is parsed with the product's own
// contract. A filter a product release does not know is never trusted: an older release that ignores
// it answers with everything, so each filtered read checks support first and reports `unsupported`
// rather than showing another agent's records as this one's.
import { z } from 'zod';
import { agentIdentityResponseSchema, hermesInstallationsResponseSchema, hermesProfilesResponseSchema, nodeDetailResponseSchema } from '@contracts/magnus/browser';
import { listProjectsResponseSchema } from '@contracts/ardentstudio.generated';
import { MemoryBrowseResponseSchema, MemorySearchRequestSchema, MemorySearchResponseSchema, MemoryStatsSchema } from '@contracts/hivemem.generated';
import { traceReadSchema } from '@contracts/emberpath-model-admin.generated';
import { TargetSchema } from '@contracts/hiveskills.generated';
import { fusionCaseSchema } from '@contracts/cindertrace/browser';
import { HiveApiError, HiveContractError, hiveApiError } from '../../lib/api-error';
import { memoryRequest } from '../../lib/memory-api';
import { productInstalled } from '../../lib/runtime';
import { apiFetch, type Product } from '../../lib/transport';
import { magnus, segment } from '../magnus/api/client';
import { readInstallation, readResource } from '../magnus/pages/agents/ardent/api';
import { skillsSchema, type ArdentProfileSummary, type ArdentSkill } from '../magnus/pages/agents/ardent/schemas';
import type { ConsoleRole } from '../magnus/routes';
import { sessionStore } from '../magnus/session-store';
import { studio } from '../studio/api/client';
import { securityCall } from '../security/lib/security-api';

export type AgentIdentity = z.infer<typeof agentIdentityResponseSchema>['data'];
export type NodeDetail = z.infer<typeof nodeDetailResponseSchema>['data'];
export type HermesProfile = z.infer<typeof hermesProfilesResponseSchema>['data'][number];
export type ProjectSummary = z.infer<typeof listProjectsResponseSchema>['projects'][number];
export type MemoryRecord = z.infer<typeof MemoryBrowseResponseSchema>['memories'][number];
export type MemoryStats = z.infer<typeof MemoryStatsSchema>;
export type FusionCase = z.infer<typeof fusionCaseSchema>;
export type Trace = z.infer<typeof traceReadSchema>;
export type { ArdentProfileSummary, ArdentSkill };

/**
 * A HiveSkills target. HiveSkills after 1.4.0 adds the fleet link; the vendored 1.4.0 contract does
 * not describe it yet, so it is read here as an optional extension of the released shape.
 */
export const fleetTargetSchema = TargetSchema.extend({ magnusNodeId: z.string().optional(), agentRefs: z.array(z.string()).optional() });
export type FleetTarget = z.infer<typeof fleetTargetSchema>;

/**
 * Emberpath's filtered trace page. Emberpath after 2.1.0 answers it for `actorId`; 2.1.0 ignores the
 * filter and answers the legacy `{data}` list. Mirrors its `tracePageSchema` until a release ships it.
 */
export const tracePageSchema = z.object({ data: z.array(traceReadSchema), nextCursor: z.string().nullable() });

/** A filtered read, or the news that this product release cannot filter. */
export type Filtered<T> = { supported: true; data: T } | { supported: false };

export interface MemoryPage {
  memories: MemoryRecord[];
  total: number | null;
}
export interface TracePage {
  traces: Trace[];
  nextCursor: string | null;
}

/** Everything the page reads. Tests pass their own; the page uses `liveSources`. */
export interface AgentSources {
  installed: (product: Product) => boolean;
  /** The Magnus role of this person, or null without a Magnus session. */
  role: () => Promise<ConsoleRole | null>;
  identity: (agentRef: string, signal: AbortSignal) => Promise<AgentIdentity>;
  node: (nodeId: string, signal: AbortSignal) => Promise<NodeDetail>;
  ardentProfile: (nodeId: string, profile: string, signal: AbortSignal) => Promise<ArdentProfileSummary | null>;
  hermesProfile: (nodeId: string, profile: string, signal: AbortSignal) => Promise<HermesProfile | null>;
  memories: (actorId: string, query: string, signal: AbortSignal) => Promise<Filtered<MemoryPage>>;
  /** Null when HiveMem refuses: per-agent stats are for that agent or an admin. */
  memoryStats: (actorId: string, signal: AbortSignal) => Promise<MemoryStats | null>;
  projects: (agentRef: string, signal: AbortSignal) => Promise<Filtered<ProjectSummary[]>>;
  cases: (actorId: string, signal: AbortSignal) => Promise<Filtered<FusionCase[]>>;
  traces: (actorId: string, signal: AbortSignal) => Promise<Filtered<TracePage>>;
  skillTargets: (nodeId: string, signal: AbortSignal) => Promise<Filtered<FleetTarget[]>>;
  profileSkills: (nodeId: string, profile: string, signal: AbortSignal) => Promise<ArdentSkill[]>;
}

const MEMORY_LIMIT = 25;
const TRACE_LIMIT = 50;

/**
 * Whether a release honours a list filter it may silently ignore. The product's answer to a filter
 * value it must refuse says: a release that knows the filter answers 400, one that does not answers
 * the unfiltered list. Remembered per product for the page's lifetime.
 */
const support = new Map<string, Promise<boolean>>();
export const resetSupportCache = (): void => support.clear();
function supports(key: string, probe: () => Promise<unknown>): Promise<boolean> {
  let known = support.get(key);
  if (!known) {
    known = probe().then(
      () => false,
      (error: unknown) => {
        if (error instanceof HiveApiError && error.status === 400) return true;
        throw error;
      },
    );
    // A failed probe (offline, signed out) is asked again next time.
    known.catch(() => support.delete(key));
    support.set(key, known);
  }
  return known;
}
/** A 400 to the real filter: a release that validates its query strictly but has never heard of it. */
async function unlessRefused<T>(read: () => Promise<T>): Promise<Filtered<T>> {
  try {
    return { supported: true, data: await read() };
  } catch (error) {
    if (error instanceof HiveApiError && error.status === 400) return { supported: false };
    throw error;
  }
}

async function readJson(path: string, signal: AbortSignal, fallback: string): Promise<unknown> {
  const response = await apiFetch(path, { headers: { Accept: 'application/json' }, signal });
  if (!response.ok) throw await hiveApiError(response, { fallback });
  return response.json().catch(() => {
    throw new HiveContractError(`${fallback}: the answer was not JSON`, false);
  });
}
function parsed<S extends z.ZodType>(schema: S, value: unknown, product: string): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new HiveContractError(`${product} answered in a shape this page does not know`, false);
  return result.data;
}

async function role(): Promise<ConsoleRole | null> {
  await sessionStore.load();
  const state = sessionStore.get();
  return state.status === 'ready' ? state.session.role : null;
}

async function hermesProfile(nodeId: string, profile: string, signal: AbortSignal): Promise<HermesProfile | null> {
  const [installations, profiles] = await Promise.all([
    magnus.get('/orchestra/installations', hermesInstallationsResponseSchema, { signal }),
    magnus.get('/orchestra/profiles', hermesProfilesResponseSchema, { signal }),
  ]);
  const onNode = new Set(installations.data.filter((installation) => installation.nodeId === nodeId).map((installation) => installation.id));
  return profiles.data.find((entry) => entry.name === profile && onNode.has(entry.installationId)) ?? null;
}

async function memories(actorId: string, query: string, signal: AbortSignal): Promise<Filtered<MemoryPage>> {
  signal.throwIfAborted();
  let page: MemoryPage;
  if (query.trim()) {
    const body = MemorySearchRequestSchema.parse({ query: query.trim(), agent_id: actorId, workspace_id: '*', limit: MEMORY_LIMIT });
    const answer = MemorySearchResponseSchema.parse(await memoryRequest('/memories/search?workspace_id=*', 'POST', body));
    page = { memories: answer.results.map((result) => result.memory), total: null };
  } else {
    const search = new URLSearchParams({ agent_id: actorId, workspace_id: '*', limit: String(MEMORY_LIMIT) });
    const answer = MemoryBrowseResponseSchema.parse(await memoryRequest('/memories/browse?' + search));
    page = { memories: answer.memories, total: answer.total };
  }
  // HiveMem before 1.5.0 ignores agent_id. Another actor's record in the answer gives that away.
  return page.memories.every((memory) => memory.agent_id === actorId) ? { supported: true, data: page } : { supported: false };
}

async function memoryStats(actorId: string, signal: AbortSignal): Promise<MemoryStats | null> {
  signal.throwIfAborted();
  try {
    return MemoryStatsSchema.parse(await memoryRequest('/stats?' + new URLSearchParams({ agent_id: actorId })));
  } catch {
    return null;
  }
}

async function projects(agentRef: string, signal: AbortSignal): Promise<Filtered<ProjectSummary[]>> {
  const list = (value: string) => studio.get('/projects', listProjectsResponseSchema, { query: { status: 'all', agentRef: value }, signal });
  const answer = await unlessRefused(() => list(agentRef));
  if (!answer.supported) return answer;
  // Studio 0.3.0 refuses a malformed agentRef; an older Studio ignores it and lists every project.
  if (!(await supports('ardentstudio', () => list('not-an-agent-ref')))) return { supported: false };
  return { supported: true, data: answer.data.projects };
}

const caseList = z.object({ success: z.literal(true), data: z.array(fusionCaseSchema) });
async function cases(actorId: string, signal: AbortSignal): Promise<Filtered<FusionCase[]>> {
  signal.throwIfAborted();
  const list = (entity: string) =>
    securityCall<unknown>(`security-fusion/cases?${new URLSearchParams({ entityType: 'agent', entity })}`, { signal }).then((value) => parsed(caseList, value, 'Cindertrace').data);
  const answer = await unlessRefused(() => list(`actor:${actorId}`));
  if (!answer.supported) return answer;
  if (!(await supports('cindertrace', () => list('not-an-agent')))) return { supported: false };
  return answer;
}

const legacyTraceList = z.object({ data: z.array(z.unknown()) });
async function traces(actorId: string, signal: AbortSignal): Promise<Filtered<TracePage>> {
  const search = new URLSearchParams({ actorId, limit: String(TRACE_LIMIT) });
  const value = await readJson(`/api/traces?${search}`, signal, 'Emberpath could not list traces');
  // Only the paged answer is filtered. The legacy list is every agent's traffic, so it is never shown.
  if (value && typeof value === 'object' && 'nextCursor' in value) {
    const page = parsed(tracePageSchema, value, 'Emberpath');
    return { supported: true, data: { traces: page.data, nextCursor: page.nextCursor } };
  }
  parsed(legacyTraceList, value, 'Emberpath');
  return { supported: false };
}

async function skillTargets(nodeId: string, signal: AbortSignal): Promise<Filtered<FleetTarget[]>> {
  const list = async (value: string) => parsed(z.array(fleetTargetSchema), await readJson(`/api/skills/admin/targets?${new URLSearchParams({ nodeId: value })}`, signal, 'HiveSkills could not list targets'), 'HiveSkills');
  const answer = await unlessRefused(() => list(nodeId));
  if (!answer.supported) return answer;
  if (!(await supports('hiveskills', () => list('!')))) return { supported: false };
  // A release that filters lists only targets bound to the node.
  return answer.data.every((target) => target.magnusNodeId === nodeId) ? answer : { supported: false };
}

export const liveSources: AgentSources = {
  installed: productInstalled,
  role,
  identity: (agentRef, signal) => magnus.get(`/agents/${segment(agentRef)}/identity`, agentIdentityResponseSchema, { signal }).then((answer) => answer.data),
  node: (nodeId, signal) => magnus.get(`/nodes/${segment(nodeId)}`, nodeDetailResponseSchema, { signal }).then((answer) => answer.data),
  ardentProfile: (nodeId, profile, signal) =>
    readInstallation(nodeId, signal).then((installation) => installation.profiles.find((entry) => entry.id === profile || entry.name === profile) ?? null),
  hermesProfile,
  memories,
  memoryStats,
  projects,
  cases,
  traces,
  skillTargets,
  profileSkills: (nodeId, profile, signal) => readResource(nodeId, profile, 'skills', skillsSchema, signal).then((answer) => answer.skills),
};
