import { parseHiveError } from '@hivemagnus/hive-common/errors';
import {
  createRequestId,
  HiveApiError,
  readApiFailure,
  rememberSentRequestId,
  REQUEST_ID_HEADER,
  failureMeta,
} from './api-error';

export * from './api-error';

export type Product =
  | 'emberpath'
  | 'oathweave'
  | 'hivemem'
  | 'hiveskills'
  | 'cindertrace'
  | 'chattermost'
  | 'magnus'
  | 'ardentstudio'
  | 'embermend';
interface Access {
  value: string;
  expiresAt: number;
}
const tokens = new Map<Product, Access>();
const prefixes = new Map<Product, string>();
let chatExpiresAt = 0;
let chatPending: Promise<void> | undefined;
let generation = 0;
let accessProvider: ((product: Product) => Promise<void>) | undefined;
let stepUpProvider: (() => Promise<void>) | undefined;
export function setStepUpProvider(
  provider: (() => Promise<void>) | undefined,
): void {
  stepUpProvider = provider;
}
export function setAccessProvider(
  provider: ((product: Product) => Promise<void>) | undefined,
): void {
  accessProvider = provider;
}

/** Runtime endpoints are same-origin API prefixes, never credential-bearing URLs. */
export function configureEndpoint(product: Product, prefix: string): void {
  if (!/^\/api\/[a-z][a-z0-9-]*(?:\/[a-z0-9-]+)*$/.test(prefix))
    throw new Error('A same-origin API prefix is required');
  prefixes.set(product, prefix);
}
export function rememberAccess(
  product: Product,
  value: string,
  expiresAt: number,
): void {
  if (!value || !Number.isFinite(expiresAt) || expiresAt <= Date.now())
    throw new Error('Access token is expired');
  tokens.set(product, { value, expiresAt });
}
const accessClearedListeners = new Set<() => void>();
/** Long-lived readers (event streams) stop here: logout and session expiry both clear access. */
export function onAccessCleared(listener: () => void): () => void {
  accessClearedListeners.add(listener);
  return () => accessClearedListeners.delete(listener);
}
export function clearAccess(): void {
  generation++;
  tokens.clear();
  chatExpiresAt = 0;
  chatPending = undefined;
  for (const listener of [...accessClearedListeners]) listener();
}
/** Same-session verification refreshes bearer claims without cancelling product sessions. */
export function refreshResourceAccess(): void {
  tokens.clear();
}
export const hasChatSession = () => chatExpiresAt > Date.now();
export function productPrefix(product: Product): string | undefined {
  return prefixes.get(product);
}

async function ensureChat(
  request: typeof fetch,
  prefix: string,
  access: Access,
): Promise<void> {
  if (chatExpiresAt > Date.now() + 30000) return;
  if (!chatPending) {
    const started = generation;
    const operation = (async () => {
      const response = await request(
        prefix + '/api/v4/auth/oathweave/session',
        {
          method: 'POST',
          credentials: 'include',
          redirect: 'error',
          headers: { Authorization: `Bearer ${access.value}`, [REQUEST_ID_HEADER]: createRequestId() },
        },
      );
      if (!response.ok) {
        const failure = await readApiFailure(response, { trustMessage: false, fallback: 'Chat sign-in requires a linked account' });
        throw new HiveApiError(failure.status, failure.message, { ...failureMeta(failure), code: failure.code });
      }
      const result: unknown = await response.json();
      if (
        !result ||
        typeof result !== 'object' ||
        !('expires_at' in result) ||
        typeof result.expires_at !== 'number' ||
        result.expires_at <= Date.now() ||
        result.expires_at > Date.now() + 15 * 60 * 1000
      )
        throw new Error('Invalid chat session response');
      if (started !== generation) throw new Error('Sign-in session ended');
      chatExpiresAt = result.expires_at;
      if (typeof window !== 'undefined')
        window.dispatchEvent(new Event('chat-session-refreshed'));
    })();
    chatPending = operation;
    void operation
      .finally(() => {
        if (chatPending === operation) chatPending = undefined;
      })
      .catch(() => {});
  }
  await chatPending;
}

/**
 * Where each product's API is reached. Callers name a product by its ingress name
 * (`/api/oathweave/...`, the name runtime.json and the Registry use) or by its older logical alias
 * (`/api/iam/...`); both resolve to the same product and are sent under the prefix runtime.json
 * configures for it.
 *
 * The aliases stay for old runtime files: a legacy recovery runtime (`mode: "legacy"`) configures
 * no prefixes and talks to the retained native console API, which serves only the alias paths, so
 * without a prefix a path is sent under the alias. Remove them with that mode.
 */
const ROUTES: Record<Product, { ingress: string; alias: string }> = {
  emberpath: { ingress: '/api/emberpath', alias: '/api' },
  oathweave: { ingress: '/api/oathweave', alias: '/api/iam' },
  hivemem: { ingress: '/api/hivemem', alias: '/api/memory' },
  hiveskills: { ingress: '/api/hiveskills', alias: '/api/skills' },
  cindertrace: { ingress: '/api/cindertrace', alias: '/api/security' },
  chattermost: { ingress: '/api/chattermost', alias: '/api/chat' },
  magnus: { ingress: '/api/magnus', alias: '/api/magnus' },
  ardentstudio: { ingress: '/api/ardentstudio', alias: '/api/ardentstudio' },
  embermend: { ingress: '/api/embermend', alias: '/api/embermend' },
};
const PRODUCTS = Object.keys(ROUTES) as Product[];
const under = (path: string, base: string) => path.startsWith(base + '/');

/** The product a path belongs to, and the path's base (ingress name or alias) to replace. */
function route(path: string): { product: Product; base: string } {
  for (const product of PRODUCTS) {
    if (product === 'emberpath') continue;
    const { ingress, alias } = ROUTES[product];
    if (under(path, ingress)) return { product, base: ingress };
    if (under(path, alias)) return { product, base: alias };
  }
  if (under(path, ROUTES.emberpath.ingress)) return { product: 'emberpath', base: ROUTES.emberpath.ingress };
  return { product: 'emberpath', base: ROUTES.emberpath.alias };
}

export function productFor(path: string): Product {
  return route(path).product;
}

/** The URL a same-origin API path is sent to: the configured prefix, or the legacy alias. */
export function resolveApiPath(path: string): string {
  const { product, base } = route(path);
  const rest = path.slice(base.length);
  return (prefixes.get(product) ?? ROUTES[product].alias) + rest;
}

/**
 * `stepUp: false` never asks the person to verify again: a refusal that needs verification comes
 * back as the 403 it is. For background reads, such as palette search, that must not open a prompt.
 */
export function createApiFetch(request: typeof fetch, options: { stepUp?: boolean } = {}) {
  async function send(path: string, init: RequestInit, allowStepUp: boolean): Promise<Response> {
    init.signal?.throwIfAborted();
    if (!path.startsWith('/api/') || /[\\#\r\n]/.test(path))
      throw new Error('Invalid API path');
    for (const segment of path.split('?')[0]!.split('/')) {
      let decoded: string;
      try {
        decoded = decodeURIComponent(segment);
      } catch {
        throw new Error('Invalid API path');
      }
      if (decoded === '.' || decoded === '..' || /[\\/%?#\r\n]/.test(decoded))
        throw new Error('Invalid API path');
    }
    const product = productFor(path);
    const prefix = prefixes.get(product);
    if (accessProvider && !prefix)
      throw new Error('This product is not configured for this console');
    if (accessProvider) await accessProvider(product);
    const target = resolveApiPath(path);
    const headers = new Headers(init.headers);
    // Every request carries an ID, so a failure can be quoted and found in the products' logs.
    const requestId = headers.get(REQUEST_ID_HEADER) ?? createRequestId();
    headers.set(REQUEST_ID_HEADER, requestId);
    const access = tokens.get(product);
    if (access) {
      if (access.expiresAt <= Date.now()) {
        tokens.delete(product);
        throw new HiveApiError(401, 'Sign in again to continue', { code: 'session_expired', requestId });
      }
      if (
        product === 'chattermost' &&
        prefix &&
        !path.endsWith('/auth/oathweave/session')
      ) {
        await ensureChat(request, prefix, access);
      } else headers.set('Authorization', `Bearer ${access.value}`);
    }
    const response = await request(target, {
      ...init,
      headers,
      credentials:
        accessProvider && product !== 'chattermost' ? 'omit' : 'include',
      redirect: 'error',
    });
    rememberSentRequestId(response, requestId);
    if (response.status === 403 && stepUpProvider && allowStepUp) {
      const body: unknown = await response
        .clone()
        .json()
        .catch(() => null);
      // Oathweave's {error:"STEP_UP_REQUIRED"} and the suite envelope's {error:{code}} alike.
      if (body && typeof body === 'object' && parseHiveError(403, body).code.toUpperCase() === 'STEP_UP_REQUIRED') {
        await stepUpProvider();
        // Only safe read methods may repeat, once, with newly acquired access.
        // Rebuild the headers/session instead of forwarding the pre-verification token.
        const method = (init.method ?? 'GET').toUpperCase();
        if ((method === 'GET' || method === 'HEAD') && init.body == null)
          return send(path, init, false);
        // Never replay a durable mutation or an approval automatically.
        const answer = Response.json(
          {
            error: 'RETRY_AFTER_STEP_UP',
            message:
              'Identity verified. Review and submit the operation again.',
          },
          { status: 403 },
        );
        rememberSentRequestId(answer, requestId);
        return answer;
      }
    }
    return response;
  }
  const stepUp = options.stepUp ?? true;
  return (path: string, init: RequestInit = {}): Promise<Response> => send(path, init, stepUp);
}
export const apiFetch = createApiFetch((input, init) => fetch(input, init));
/** `apiFetch` for reads nobody asked for in so many words: it never opens a verification prompt. */
export const quietApiFetch = createApiFetch((input, init) => fetch(input, init), { stepUp: false });
