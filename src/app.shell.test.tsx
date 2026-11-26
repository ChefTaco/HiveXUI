// @vitest-environment jsdom
// Only the pages that show the shared Emberpath store wait for it; every other page renders at once.
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, settle, stubBrowser, type Mounted } from './modules/magnus/test-dom';

const { demands } = vi.hoisted(() => ({ demands: [] as boolean[] }));
vi.mock('./lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/api')>();
  return { ...actual, adminApi: { ...actual.adminApi, me: async () => ({ user: { id: 'user-1', username: 'operator', roles: ['admin'] } }) } };
});
// A store whose first load never finishes, as with a hung Emberpath.
vi.mock('./lib/store', () => {
  const state = {
    data: { providers: [], traces: [], audit: [], actors: [], incidents: [], clientKeys: [], telemetry: null, aliases: [], routeRules: [], heuristics: [], runtimeSettings: [], docs: [], hiveStatus: null },
    loading: true, refreshing: false, error: 'Emberpath is unavailable', loadIssues: [], incidentNotes: [], lastSync: null,
    refresh: async () => {}, resourceFreshness: {}, onAuthExpired: () => {}, demand: () => () => {},
  };
  return {
    StoreProvider: ({ children }: { children: ReactNode }) => children,
    useStoreDemand: (active: boolean) => void demands.push(active),
    useStoreStatus: () => state,
    useStore: () => state,
  };
});

let view: Mounted | undefined;
beforeEach(() => {
  stubBrowser();
  demands.length = 0;
  vi.stubGlobal('fetch', vi.fn(async () => new Response('Not found', { status: 404 })));
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  vi.unstubAllGlobals();
  history.replaceState(null, '', '/');
});

async function until(found: () => unknown) {
  const deadline = Date.now() + 3_000;
  while (!found() && Date.now() < deadline) await settle(10);
  expect(found()).toBeTruthy();
}

describe('the shell and the shared store', () => {
  it('renders a page that does not read the store while the store is still loading', async () => {
    history.replaceState(null, '', '/?page=inbox');
    const { App } = await import('./app');
    view = await mount(<App />);
    await until(() => document.querySelector('.app-shell'));
    await until(() => document.querySelector('.content')?.textContent?.trim());
    expect(document.querySelector('.content .center-load')).toBeNull();
    // Its sync error belongs to the store's pages.
    expect(document.querySelector('.sync-warning')).toBeNull();
    expect(demands.at(-1)).toBe(false);
  });

  it('waits for the store, and asks it to load, on a page that shows its data', async () => {
    history.replaceState(null, '', '/?page=keys');
    const { App } = await import('./app');
    view = await mount(<App />);
    await until(() => document.querySelector('.app-shell'));
    expect(document.querySelector('.content .center-load')).not.toBeNull();
    expect(demands.at(-1)).toBe(true);
  });
});
