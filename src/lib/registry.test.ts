import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registryConnectionSchema, registryProductSchema } from '@contracts/hive-registry/browser';
import { FIRST_PAINT_BUDGET_MS, readRegistryState } from './registry';
import type { Product } from './transport';

const INSTALLATION = '/api/registry/v1/installation';
const runtimeJson = (products: Partial<Record<Product, string>>) => ({
  schema: 1,
  products,
  identity: {
    issuer: 'https://hive.example.com/api/oathweave',
    apiPrefix: '/api/oathweave',
    clients: Object.fromEntries(Object.keys(products).map((name) => [name, `hivexui-${name}`])),
  },
});
const configured = { oathweave: '/api/oathweave', emberpath: '/api/emberpath', magnus: '/api/magnus' };
const installed = (...products: string[]) => Response.json({ schema: 1, id: 'lab-one', products });

/** Fresh module state each time: runtime and the Registry are per-page singletons. */
async function boot(registry: () => Promise<Response> | Response, products: Partial<Record<Product, string>> = configured) {
  vi.resetModules();
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === '/runtime.json') return Response.json(runtimeJson(products));
    return registry();
  }));
  const runtime = await import('./runtime');
  const state = await import('./registry');
  const navigation = await import('./navigation');
  await runtime.initializeRuntime();
  return { runtime, state, navigation, calls };
}
const productIds = (groups: ReadonlyArray<{ label: string }>) => groups.map((group) => group.label);

beforeEach(() => vi.stubGlobal('location', { origin: 'https://hive.example.com', pathname: '/', search: '' }));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('what the console treats as installed', () => {
  it('shows a product that is both configured and installed', async () => {
    const { runtime } = await boot(() => installed('hive-registry', 'oathweave', 'emberpath', 'magnus'));
    for (const name of ['oathweave', 'emberpath', 'magnus'] as const) expect(runtime.productInstalled(name)).toBe(true);
  });
  it('hides a product that is configured but not registered, from every gate and the sidebar', async () => {
    const { runtime, navigation } = await boot(() => installed('oathweave', 'emberpath'));
    expect(runtime.productInstalled('magnus')).toBe(false);
    expect(runtime.productEnabled('magnus')).toBe(false);
    expect(navigation.viewAvailable('magnus', runtime.productInstalled)).toBe(false);
    expect(productIds(navigation.visibleNavGroups(runtime.productInstalled))).toContain('Emberpath');
    expect(navigation.navProducts(navigation.visibleNavGroups(runtime.productInstalled)).map((product) => product.label)).not.toContain('Magnus');
    expect(navigation.resolveDeepLink({ pathname: '/fleet/nodes', search: '' }, runtime.productInstalled)).toEqual({ view: 'hive', url: '/' });
  });
  it('hides a product that is registered but not configured', async () => {
    const { runtime, navigation } = await boot(() => installed('oathweave', 'emberpath', 'magnus', 'hivemem'));
    expect(runtime.productInstalled('hivemem')).toBe(false);
    expect(runtime.productEnabled('hivemem')).toBe(false);
    expect(productIds(navigation.visibleNavGroups(runtime.productInstalled))).not.toContain('HiveMem');
  });
  it('never touches the API prefix a hidden product was configured with', async () => {
    const { runtime } = await boot(() => installed('oathweave'));
    const { productPrefix } = await import('./transport');
    expect(runtime.productInstalled('emberpath')).toBe(false);
    expect(productPrefix('emberpath')).toBe('/api/emberpath');
  });
});

describe('a Registry that cannot be used falls back to runtime.json with a warning', () => {
  const unusable: Array<[string, () => Promise<Response> | Response, string]> = [
    ['404, as on a stack from before the Registry', () => new Response('API unavailable', { status: 404 }), 'unreachable'],
    ['500', () => Response.json({ error: { code: 'internal' } }, { status: 500 }), 'unreachable'],
    ['a network failure', () => Promise.reject(new TypeError('Failed to fetch')), 'unreachable'],
    ['the console page served in its place', () => new Response('<!doctype html><html></html>', { status: 200 }), 'malformed'],
    ['an empty body', () => new Response('', { status: 200 }), 'malformed'],
    ['JSON null', () => Response.json(null), 'malformed'],
    ['an array', () => Response.json([]), 'malformed'],
    ['another schema version', () => Response.json({ schema: 2, id: 'lab-one', products: ['magnus'] }), 'malformed'],
    ['products of the wrong type', () => Response.json({ schema: 1, id: 'lab-one', products: 'magnus' }), 'malformed'],
    ['a product ID that cannot be one', () => Response.json({ schema: 1, id: 'lab-one', products: ['../magnus'] }), 'malformed'],
    ['no installation ID', () => Response.json({ schema: 1, products: ['magnus'] }), 'malformed'],
    ['none of the configured products', () => installed('hive-registry'), 'empty'],
    ['nothing at all, before its first sync', () => installed(), 'empty'],
  ];
  it.each(unusable)('on %s', async (_name, registry, reason) => {
    const { runtime, state } = await boot(registry);
    expect(state.registryState()).toEqual({ status: 'unavailable', reason });
    for (const name of ['oathweave', 'emberpath', 'magnus'] as const) expect(runtime.productInstalled(name)).toBe(true);
    expect(runtime.productInstalled('hivemem')).toBe(false);
    expect(state.registryWarning(state.registryState())).toMatch(/runtime\.json/);
  });
  it('warns about nothing while it works', async () => {
    const { state } = await boot(() => installed('oathweave'));
    expect(state.registryWarning(state.registryState())).toBeNull();
  });
  it('clears the warning and narrows the sections once it answers again', async () => {
    let up = false;
    const { runtime, state } = await boot(() => (up ? installed('oathweave') : new Response('', { status: 503 })));
    const changed = vi.fn();
    state.subscribeRegistry(changed);
    expect(runtime.productInstalled('magnus')).toBe(true);
    up = true;
    await state.refreshRegistry();
    expect(changed).toHaveBeenCalledOnce();
    expect(state.registryWarning(state.registryState())).toBeNull();
    expect(runtime.productInstalled('magnus')).toBe(false);
    await state.refreshRegistry();
    expect(changed).toHaveBeenCalledOnce();
  });
});

describe('how it is read', () => {
  it('asks anonymously, with no bearer, cookie or redirect, under its own prefix', async () => {
    const { calls } = await boot(() => installed('oathweave'));
    const call = calls.find(({ url }) => url === INSTALLATION)!;
    expect(call.init).toMatchObject({ credentials: 'omit', redirect: 'error', cache: 'no-store' });
    expect(new Headers(call.init?.headers).has('authorization')).toBe(false);
  });
  it('does not hold the first paint for a slow Registry, and applies its late answer', async () => {
    vi.useFakeTimers();
    let answer!: (response: Response) => void;
    const slow = new Promise<Response>((resolve) => { answer = resolve; });
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => (String(input) === '/runtime.json' ? Response.json(runtimeJson(configured)) : slow)));
    const runtime = await import('./runtime');
    const state = await import('./registry');
    let painted = false;
    const started = runtime.initializeRuntime().then(() => { painted = true; });
    await vi.advanceTimersByTimeAsync(FIRST_PAINT_BUDGET_MS - 1);
    expect(painted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await started;
    expect(state.registryState().status).toBe('pending');
    expect(runtime.productInstalled('magnus')).toBe(true);
    answer(installed('oathweave'));
    await vi.advanceTimersByTimeAsync(0);
    expect(runtime.productInstalled('magnus')).toBe(false);
  });
  it('leaves the authorization portal alone: no request and no filtering', async () => {
    vi.stubGlobal('location', { origin: 'https://hive.example.com', pathname: '/auth/authorize', search: '' });
    const { runtime, state, calls } = await boot(() => installed('oathweave'));
    expect(calls.map(({ url }) => url)).toEqual(['/runtime.json']);
    expect(state.registryState().status).toBe('pending');
    expect(runtime.productInstalled('magnus')).toBe(true);
    expect(runtime.browserIdentity()).toBeDefined();
  });
  it('never asks in legacy recovery, which has no suite identity', async () => {
    vi.resetModules();
    const fetcher = vi.fn(async () => Response.json({ schema: 1, mode: 'legacy', products: {} }));
    vi.stubGlobal('fetch', fetcher);
    const runtime = await import('./runtime');
    await runtime.initializeRuntime();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(runtime.productInstalled('magnus')).toBe(true);
  });
  it('a failed read never rejects', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    await expect(readRegistryState(['oathweave'])).resolves.toEqual({ status: 'unavailable', reason: 'unreachable' });
  });
});

const entry = (id: string, extra: object = {}) => ({
  id,
  displayName: id,
  description: 'Synthetic product',
  links: { repository: 'https://example.com/repo', documentation: 'https://example.com/docs', license: 'https://example.com/license', licenseSpdx: 'Apache-2.0' },
  consoleSection: null,
  required: false,
  installed: true,
  dependencies: [],
  ...extra,
});

describe('the product catalog', () => {
  const route = (url: string) => {
    if (url === INSTALLATION) return installed('oathweave', 'emberpath', 'hivemem', 'ingress');
    if (url === '/api/registry/v1/products?installed=true')
      return Response.json({ schema: 1, products: ['oathweave', 'emberpath', 'hivemem', 'ingress'].map((id) => entry(id)) });
    if (url.endsWith('/emberpath/connection'))
      return Response.json({ id: 'emberpath', consolePath: null, browserPrefix: '/api/emberpath', nativeApis: { model: 'https://hive.example.com/v1' }, documentation: null });
    if (url.endsWith('/connection')) return new Response('', { status: 500 });
    return new Response('', { status: 404 });
  };
  async function catalog() {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => (String(input) === '/runtime.json' ? Response.json(runtimeJson({ oathweave: '/api/oathweave', emberpath: '/api/emberpath' })) : route(String(input)))));
    const runtime = await import('./runtime');
    const state = await import('./registry');
    await runtime.initializeRuntime();
    return state.readRegistryCatalog(runtime.registryEntryPresented);
  }
  it('omits a registered console product that is not configured and keeps products with no section', async () => {
    expect((await catalog()).map((item) => item.product.id)).toEqual(['oathweave', 'emberpath', 'ingress']);
  });
  it('keeps the rest of the list when one connection fails', async () => {
    const items = await catalog();
    expect(items.find((item) => item.product.id === 'emberpath')?.connection?.nativeApis).toEqual({ model: 'https://hive.example.com/v1' });
    expect(items.find((item) => item.product.id === 'oathweave')?.connection).toBeNull();
  });
});

describe('the pinned browser contract', () => {
  it('drops private fields, so a version or host can never reach the console', () => {
    const product = registryProductSchema.parse(entry('emberpath', { kind: 'application', versions: [{ version: '1.0.0' }], installation: { inventoryHost: 'host-one', version: '1.0.0' } }));
    expect(Object.keys(product).sort()).toEqual(['consoleSection', 'dependencies', 'description', 'displayName', 'id', 'installed', 'links', 'required']);
    const connection = registryConnectionSchema.parse({ id: 'emberpath', consolePath: null, browserPrefix: null, nativeApis: {}, documentation: null, inventoryHost: 'host-one', internalEndpoints: { admin: 'https://emberpath:9443' } });
    expect(Object.keys(connection).sort()).toEqual(['browserPrefix', 'consolePath', 'documentation', 'id', 'nativeApis']);
  });
  it('accepts only plain HTTPS links, because the console renders them', () => {
    for (const url of ['javascript:alert(1)', 'http://hive.example.com', 'https://user:password@hive.example.com', 'https://hive.example.com/?token=fake', 'https://hive.example.com/#fragment', '/v1']) {
      expect(registryProductSchema.safeParse(entry('emberpath', { links: { repository: url, documentation: null, license: null, licenseSpdx: null } })).success).toBe(false);
      expect(registryConnectionSchema.safeParse({ id: 'emberpath', consolePath: null, browserPrefix: null, nativeApis: { model: url }, documentation: null }).success).toBe(false);
    }
  });
});
