import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeJson = {
  schema: 1,
  products: { oathweave: '/api/oathweave' },
  identity: { issuer: 'https://hive.example.com/api/oathweave', apiPrefix: '/api/oathweave', clients: { oathweave: 'hivexui-oathweave' } },
};
async function overview(registry: () => Response) {
  vi.resetModules();
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => (String(input) === '/runtime.json' ? Response.json(runtimeJson) : registry())));
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
});
