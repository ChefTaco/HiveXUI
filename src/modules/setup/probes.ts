// Readiness probes: what HiveXUI can confirm about a setup item by reading what it already reads.
// Each probe uses the product's released browser contract through `quietApiFetch`, so a check never
// opens a verification prompt, and a refusal is an "I can't tell", never an error on the page.
// Nothing here writes anywhere: the Registry records an item only through hive.sh.
import { z } from 'zod';
import { nodeListResponseSchema } from '@contracts/magnus/browser';
import { IamClientsResponseSchema, IamUsersResponseSchema } from '@contracts/oathweave-browser.generated';
import { describeApiError, hiveApiError } from '../../lib/api-error';
import { isDenied } from '../../lib/record-search';
import type { Product } from '../../lib/transport';
import type { ProbeResult } from './checklist';

type Fetch = (path: string, init?: RequestInit) => Promise<Response>;

export interface ProbeContext {
  fetch: Fetch;
  /** Whether HiveXUI presents a product here. A probe of an absent product cannot tell. */
  installed: (product: Product) => boolean;
  /** The Oathweave public clients this HiveXUI signs in with, from runtime.json. */
  clients: readonly string[];
}
type Probe = (context: ProbeContext, signal: AbortSignal) => Promise<ProbeResult>;

async function read<S extends z.ZodType>(send: Fetch, path: string, schema: S, signal: AbortSignal): Promise<z.output<S>> {
  const response = await send(path, { signal, headers: { Accept: 'application/json' } });
  if (!response.ok) throw await hiveApiError(response, { fallback: 'The check could not be completed' });
  const parsed = schema.safeParse(await response.json().catch(() => undefined));
  if (!parsed.success) throw new Error('The product answered in a shape this check does not know');
  return parsed.data;
}

const list = (names: readonly string[]): string => names.join(', ');

/**
 * `magnus.agent`: a Magnus node reports a running agent. The Registry's installation record and
 * Magnus's node list share no host name or address the browser may see, so HiveXUI cannot tell
 * which node is the Magnus host. Any online node with a running agent counts, and the detail says so.
 */
const magnusAgent: Probe = async (context, signal) => {
  if (!context.installed('magnus')) return { state: 'unknown', detail: 'Magnus is not part of this HiveXUI, so it cannot be checked here.' };
  const answer = await read(context.fetch, '/api/magnus/nodes?page=1&pageSize=100', nodeListResponseSchema, signal);
  const running = answer.data.filter((node) => node.status === 'ONLINE' && node.agent?.status === 'RUNNING');
  if (running.length === 0)
    return { state: 'not-done', detail: answer.data.length === 0 ? 'Magnus has no enrolled node yet.' : 'No online Magnus node reports a running agent yet.' };
  const names = running.map((node) => node.name);
  return {
    state: 'done',
    detail: `${names.length === 1 ? `${names[0]} reports` : `${names.length} nodes report`} a running agent. HiveXUI cannot tell which node is the Magnus host, so any online node counts.`,
  };
};

/** `oathweave.console-client`: every Oathweave client HiveXUI signs in with exists and is active. */
const consoleClients: Probe = async (context, signal) => {
  if (context.clients.length === 0) return { state: 'unknown', detail: 'This HiveXUI does not sign in through Oathweave clients, so there is nothing to check.' };
  if (!context.installed('oathweave')) return { state: 'unknown', detail: 'Oathweave is not part of this HiveXUI, so it cannot be checked here.' };
  const { clients } = await read(context.fetch, '/api/iam/clients', IamClientsResponseSchema, signal);
  const active = new Set(clients.filter((client) => client.active).map((client) => client.id));
  const missing = context.clients.filter((id) => !active.has(id));
  if (missing.length > 0) return { state: 'not-done', detail: `Oathweave has no active ${missing.length === 1 ? 'client' : 'clients'} ${list(missing)}.` };
  return { state: 'done', detail: `Oathweave has every HiveXUI browser client: ${list(context.clients)}.` };
};

/** Oathweave roles that make an account an administrator of the installation. */
const ADMINISTRATOR_ROLES = new Set(['SUPER_ADMIN', 'SUITE_ADMIN', 'ADMIN']);
const LISTED = 100;

/**
 * `iam.first-admin`: an active administrator other than the initial operator exists. Fresh setup
 * creates the initial operator as Oathweave's first account, so it is the oldest one. Oathweave
 * lists accounts newest first: when they do not all fit in one page, the page holds only accounts
 * newer than the initial operator.
 */
const firstAdmin: Probe = async (context, signal) => {
  if (!context.installed('oathweave')) return { state: 'unknown', detail: 'Oathweave is not part of this HiveXUI, so it cannot be checked here.' };
  const { users, total } = await read(context.fetch, `/api/iam/users?limit=${LISTED}`, IamUsersResponseSchema, signal);
  // On a tie the later entry wins: in a newest-first list, it is the older account.
  const initial =
    total <= users.length
      ? users.reduce<(typeof users)[number] | undefined>((oldest, user) => (!oldest || Date.parse(user.createdAt) <= Date.parse(oldest.createdAt) ? user : oldest), undefined)
      : undefined;
  const administrators = users.filter((user) => user.active && user.roles.some((assignment) => ADMINISTRATOR_ROLES.has(assignment.role.name.toUpperCase())));
  const own = administrators.filter((user) => user.id !== initial?.id);
  if (own.length > 0) {
    const names = own.map((user) => user.username);
    return { state: 'done', detail: `${list(names.slice(0, 3))}${names.length > 3 ? ` and ${names.length - 3} more` : ''} ${names.length === 1 ? 'is an administrator' : 'are administrators'} besides the initial operator.` };
  }
  return { state: 'not-done', detail: initial ? `Only the initial operator, ${initial.username}, is an administrator.` : 'No administrator account besides the initial operator was found.' };
};

/** The probes by `check` name. A check this table does not know is not run. */
export const PROBES: Readonly<Record<string, Probe>> = {
  'magnus.agent': magnusAgent,
  'oathweave.console-client': consoleClients,
  'iam.first-admin': firstAdmin,
};
export const knownCheck = (check: string | undefined): check is string => !!check && Object.hasOwn(PROBES, check);

/** Runs one probe. Never rejects: a refusal or a failure is an answer that it cannot tell. */
export async function runProbe(check: string, context: ProbeContext, signal: AbortSignal): Promise<ProbeResult> {
  try {
    return await PROBES[check]!(context, signal);
  } catch (error) {
    if (isDenied(error)) return { state: 'unknown', detail: 'Your account cannot read what this check needs.' };
    return { state: 'unknown', detail: `The check could not be completed: ${describeApiError(error)}` };
  }
}
