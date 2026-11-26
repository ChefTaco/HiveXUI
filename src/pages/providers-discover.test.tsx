// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { button, click, mount, settle, stubBrowser, type Mounted } from '../modules/magnus/test-dom';
import type { AdminUser, Provider } from '../lib/types';

const provider: Provider = {
  id: 'provider-fixture', slug: 'synthetic', name: 'Synthetic provider', kind: 'OPENAI_GENERIC',
  baseUrl: 'https://provider.example.com/v1', authMode: 'NONE', authHeaderName: 'Authorization',
  authSecretMasked: null, defaultHeaders: {}, capabilities: {},
  timeoutMs: 120000, maxRetries: 1, concurrency: 16, priority: 100, weight: 100, failoverGroup: null, enabled: true, lastHealthStatus: null, lastHealthError: null, lastHealthAt: null,
  models: [{ model: 'synthetic-old', displayName: null, maxContextWindow: null, enabled: true, capabilityJson: '{}', id: 'row-1', providerId: 'provider-fixture', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }],
} as unknown as Provider;
const { emberpath, refresh } = vi.hoisted(() => ({ emberpath: { discoverProviderModels: vi.fn() }, refresh: vi.fn(async () => {}) }));
vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>();
  return { ...actual, adminApi: { ...actual.adminApi, ...emberpath } };
});
vi.mock('../lib/store', () => {
  const data = { providers: [provider] };
  return { StoreProvider: ({ children }: { children: ReactNode }) => children, useStore: () => ({ data, refresh }) };
});
const { ProvidersPage } = await import('./providers');

const writer: AdminUser = { id: 'fixture', username: 'operator', permissions: ['router:providers:write'], roles: [] };
let view: Mounted | undefined;
beforeEach(() => stubBrowser());
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  vi.clearAllMocks();
});

describe('Discover models in the provider drawer', () => {
  it('reconciles the live model list and shows the stored models with what changed', async () => {
    emberpath.discoverProviderModels.mockResolvedValue({
      data: {
        provider: { ...provider, models: [{ ...provider.models[0]!, model: 'synthetic-new', id: 'row-2' }] },
        discovered: [{ model: 'synthetic-new' }], created: ['synthetic-new'], updated: [], unchanged: [], stale: ['synthetic-old'],
      },
    });
    view = await mount(<ProvidersPage currentUser={writer} />);
    await click(button('Edit'));
    const drawer = document.querySelector('[role="dialog"]')!;
    expect(drawer.querySelector('textarea:last-of-type')).not.toBeNull();
    await click(button('Discover models', drawer));
    await settle();
    expect(emberpath.discoverProviderModels).toHaveBeenCalledWith('provider-fixture');
    expect(drawer.querySelector('[role="status"]')?.textContent).toBe('Found 1 model: 1 new, 0 updated, 0 unchanged, 1 no longer listed (synthetic-old).');
    const models = [...drawer.querySelectorAll('textarea')].map((area) => area.value).find((value) => value.includes('"model"'));
    expect(models).toContain('synthetic-new');
    expect(models).not.toContain('synthetic-old');
    expect(refresh).toHaveBeenCalled();
  });

  it('shows why discovery failed', async () => {
    const { ApiError } = await import('../lib/api');
    emberpath.discoverProviderModels.mockRejectedValue(new ApiError('Model discovery is not supported for CODEX_OAUTH providers', 400));
    view = await mount(<ProvidersPage currentUser={writer} />);
    await click(button('Edit'));
    await click(button('Discover models', document.querySelector('[role="dialog"]')!));
    await settle();
    expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent).toContain('Model discovery is not supported');
  });
});
