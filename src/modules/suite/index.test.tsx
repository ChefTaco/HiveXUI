import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A legacy installation reports its products through the shared store's native status read.
const T = '2026-11-10T14:30:00.000Z';
const legacyStatus = {
  generatedAt: T,
  uiUrl: 'https://hive.example.com',
  apps: [
    { key: 'router', name: 'Hive Router', role: 'Routing', status: 'online', summary: 'Routing traffic', internalUrl: '', publicUrl: '', consoleUrl: 'https://router.example.com', checks: [], latencyMs: 12,
      details: { tlsCertificate: { configured: true, status: 'pass', message: 'Certificate is valid.', domains: ['hive.example.com'], expectedHost: 'hive.example.com', validTo: '2027-01-01T00:00:00.000Z', daysRemaining: 50 } } },
    { key: 'iam', name: 'Hive IAM', role: 'Identity', status: 'degraded', summary: 'Slow database', internalUrl: '', publicUrl: '', consoleUrl: '', checks: [] },
  ],
};
vi.mock('../../lib/store', () => ({
  useStore: () => ({ data: { hiveStatus: legacyStatus }, refresh: async () => {}, refreshing: false }),
}));

const runtimeJson = {
  schema: 1,
  products: { oathweave: '/api/oathweave' },
  identity: { issuer: 'https://hive.example.com/api/oathweave', apiPrefix: '/api/oathweave', clients: { oathweave: 'hivexui-oathweave' } },
};
async function overview(registry: () => Response, runtime: object = runtimeJson) {
  vi.resetModules();
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => (String(input) === '/runtime.json' ? Response.json(runtime) : registry())));
  await (await import('../../lib/runtime')).initializeRuntime();
  const { default: SuiteOverview } = await import('./index');
  return renderToStaticMarkup(<SuiteOverview />);
}

beforeEach(() => vi.stubGlobal('location', { origin: 'https://hive.example.com', pathname: '/', search: '' }));
afterEach(() => vi.unstubAllGlobals());

describe('the Hive overview', () => {
  it('warns without blocking when the Registry is unreachable', async () => {
    const page = await overview(() => new Response('API unavailable', { status: 404 }));
    expect(page).toContain('warning-banner');
    expect(page).toContain('The Hive Registry is not answering');
    expect(page).toContain('Installation overview');
    expect(page).not.toContain('Installed products');
  });
  it('shows the installation ID and no warning when it answers', async () => {
    const page = await overview(() => Response.json({ schema: 1, id: 'lab-one', products: ['oathweave'] }));
    expect(page).toContain('lab-one');
    expect(page).not.toContain('warning-banner');
    expect(page).toContain('Installed products');
  });
  it('shows a legacy installation from its native status, in the same overview', async () => {
    const page = await overview(() => new Response('unused', { status: 404 }), { schema: 1, mode: 'legacy', products: { emberpath: '/api/emberpath' } });
    expect(page).toContain('Installation overview');
    expect(page).toContain('native status API');
    expect(page).toContain('Hive Router');
    expect(page).toContain('Routing traffic');
    expect(page).toContain('degraded');
    expect(page).toContain('1 need attention');
    expect(page).toContain('href="https://router.example.com"');
    expect(page).toContain('Certificate is valid.');
    // The Registry and suite lifecycle belong to suite installations.
    expect(page).not.toContain('Installed products');
    expect(page).not.toContain('warning-banner');
  });
});
