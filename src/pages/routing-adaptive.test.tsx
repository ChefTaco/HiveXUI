// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { button, click, mount, settle, stubBrowser, type, type Mounted } from '../modules/magnus/test-dom';
import type { AdminUser } from '../lib/types';

const { emberpath } = vi.hoisted(() => ({ emberpath: { adaptiveRouting: vi.fn(), updateAdaptiveRouting: vi.fn() } }));
vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>();
  return { ...actual, adminApi: { ...actual.adminApi, ...emberpath } };
});
vi.mock('../lib/store', () => {
  const data = { aliases: [], routeRules: [], heuristics: [], providers: [] };
  return { StoreProvider: ({ children }: { children: ReactNode }) => children, useStore: () => ({ data, refresh: async () => {} }) };
});
const { RoutingPage } = await import('./routing');

const writer: AdminUser = { id: 'fixture', username: 'operator', permissions: ['router:routing:write'], roles: [] };
const state = (enabled: boolean) => ({
  data: {
    config: { enabled, weight: 1, windowMinutes: 60, minSamples: 5, latencyTargetMs: 4000 },
    providers: enabled ? [{ providerId: 'p1', slug: 'fixture', name: 'Fixture provider', samples: 12, successRate: 0.917, avgLatencyMs: 820, avgTotalTokens: 300, scoreAdjustment: 0.42 }] : [],
  },
});

let view: Mounted | undefined;
beforeEach(() => stubBrowser());
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  vi.clearAllMocks();
});

describe('the Adaptive routing tab', () => {
  it('turns adaptive routing on with its settings and shows what it measured', async () => {
    emberpath.adaptiveRouting.mockResolvedValueOnce(state(false)).mockResolvedValue(state(true));
    emberpath.updateAdaptiveRouting.mockResolvedValue({ data: { config: state(true).data.config } });
    view = await mount(<RoutingPage currentUser={writer} />);
    await click(button(/^Adaptive/));
    await settle();
    expect(document.body.textContent).toContain('Emberpath measures providers while adaptive routing is on.');
    await click(document.querySelector('.toggle input'));
    const weight = [...document.querySelectorAll('label')].find((label) => label.textContent?.startsWith('Weight'))!.querySelector('input');
    await type(weight, '12');
    expect(button('Save adaptive routing')?.disabled).toBe(true);
    await type(weight, '2.5');
    await click(button('Save adaptive routing'));
    await settle();
    expect(emberpath.updateAdaptiveRouting).toHaveBeenCalledWith({ enabled: true, weight: 2.5, windowMinutes: 60, minSamples: 5, latencyTargetMs: 4000 });
    expect(document.body.textContent).toContain('Fixture provider');
    expect(document.body.textContent).toContain('91.7%');
    expect(document.body.textContent).toContain('+0.42');
  });

  it('says so on an Emberpath without adaptive routing', async () => {
    const { ApiError } = await import('../lib/api');
    emberpath.adaptiveRouting.mockRejectedValue(new ApiError('Not found', 404));
    view = await mount(<RoutingPage currentUser={writer} />);
    await click(button(/^Adaptive/));
    await settle();
    expect(document.body.textContent).toContain('This Emberpath has no adaptive routing.');
  });
});
