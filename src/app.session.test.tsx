// @vitest-environment jsdom
// The session ends in one place for every page and tab: the console returns to sign-in at the same
// address, and says why.
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { button, click, mount, settle, stubBrowser, type, type Mounted } from './modules/magnus/test-dom';
import { resetSessionEvents, sessionEnded } from './lib/session-events';

const { me, endChatSession } = vi.hoisted(() => ({ me: vi.fn(), endChatSession: vi.fn(async () => {}) }));
vi.mock('./lib/transport', async (importOriginal) => ({ ...(await importOriginal<typeof import('./lib/transport')>()), endChatSession }));
vi.mock('./lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/api')>();
  return { ...actual, adminApi: { ...actual.adminApi, me } };
});
vi.mock('./lib/store', () => {
  const state = {
    data: { providers: [], traces: [], audit: [], actors: [], incidents: [], clientKeys: [], telemetry: null },
    loading: true,
    refreshing: false,
    error: null,
    loadIssues: [],
    incidentNotes: [],
    lastSync: null,
    refresh: async () => {},
    resourceFreshness: {},
    onAuthExpired: () => {},
    demand: () => () => {},
  };
  return {
    StoreProvider: ({ children }: { children: ReactNode }) => children,
    useStoreDemand: () => {},
    useStoreStatus: () => state,
    useStore: () => state,
  };
});

let view: Mounted | undefined;
beforeEach(() => {
  stubBrowser();
  me.mockResolvedValue({ user: { id: 'user-1', username: 'operator', roles: ['admin'] } });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('Not found', { status: 404 })));
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  me.mockReset();
  resetSessionEvents();
  vi.unstubAllGlobals();
  history.replaceState(null, '', '/');
});

async function until(found: () => unknown) {
  const deadline = Date.now() + 3_000;
  while (!found() && Date.now() < deadline) await settle(10);
  expect(found()).toBeTruthy();
}

describe('the end of a session', () => {
  it('returns to sign-in at the same address, and the same page opens after signing in again', async () => {
    history.replaceState(null, '', '/?page=keys');
    const { App } = await import('./app');
    view = await mount(<App />);
    await until(() => document.querySelector('.app-shell'));
    await settle(0);
    sessionEnded('expired');
    await until(() => document.querySelector('input[type="password"]'));
    expect(document.querySelector('.app-shell')).toBeNull();
    expect(document.body.textContent).toContain('Your session ended. Sign in again to continue where you were.');
    expect(location.pathname + location.search).toBe('/?page=keys');
  });

  it('follows a sign-out in another tab', async () => {
    const { App } = await import('./app');
    view = await mount(<App />);
    await until(() => document.querySelector('.app-shell'));
    await settle(0);
    const other = new BroadcastChannel('hivexui-session');
    other.postMessage({ type: 'signed-out' });
    await until(() => document.querySelector('input[type="password"]'));
    expect(document.body.textContent).toContain('You signed out in another tab.');
    // The chat cookie is the whole origin's: this tab ends it too, whether or not it opened chat.
    expect(endChatSession).toHaveBeenCalled();
    other.close();
  });

  it('ignores a session end while already signed out', async () => {
    me.mockRejectedValue(Object.assign(new Error('Sign in to continue'), { status: 401 }));
    const { App } = await import('./app');
    view = await mount(<App />);
    await until(() => document.querySelector('input[type="password"]'));
    sessionEnded('expired');
    await settle(10);
    expect(document.body.textContent).not.toContain('Your session ended');
  });
});
