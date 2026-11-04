export type Product =
  | 'emberpath'
  | 'oathweave'
  | 'hivemem'
  | 'hiveskills'
  | 'cindertrace'
  | 'chattermost';
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
export function setAccessProvider(
  provider: (product: Product) => Promise<void>,
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
export function clearAccess(): void {
  generation++;
  tokens.clear();
  chatExpiresAt = 0;
  chatPending = undefined;
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
          headers: { Authorization: `Bearer ${access.value}` },
        },
      );
      if (!response.ok)
        throw new Error('Chat sign-in requires a linked account');
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

export function productFor(path: string): Product {
  if (path.startsWith('/api/iam/')) return 'oathweave';
  if (path.startsWith('/api/memory/')) return 'hivemem';
  if (path.startsWith('/api/skills/')) return 'hiveskills';
  if (path.startsWith('/api/security/')) return 'cindertrace';
  if (path.startsWith('/api/chat/')) return 'chattermost';
  return 'emberpath';
}

export function createApiFetch(request: typeof fetch) {
  return async (path: string, init: RequestInit = {}): Promise<Response> => {
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
    if (accessProvider) await accessProvider(product);
    const prefix = prefixes.get(product);
    let target = path;
    const logical: Record<Product, string> = {
      emberpath: '/api',
      oathweave: '/api/iam',
      hivemem: '/api/memory',
      hiveskills: '/api/skills',
      cindertrace: '/api/security',
      chattermost: '/api/chat',
    };
    if (prefix) target = prefix + path.slice(logical[product].length);
    const headers = new Headers(init.headers);
    const access = tokens.get(product);
    if (access) {
      if (access.expiresAt <= Date.now()) {
        tokens.delete(product);
        throw new Error('Sign in again to continue');
      }
      if (
        product === 'chattermost' &&
        prefix &&
        !path.endsWith('/auth/oathweave/session')
      ) {
        await ensureChat(request, prefix, access);
      } else headers.set('Authorization', `Bearer ${access.value}`);
    }
    return request(target, {
      ...init,
      headers,
      credentials: 'include',
      redirect: 'error',
    });
  };
}
export const apiFetch = createApiFetch((input, init) => fetch(input, init));
