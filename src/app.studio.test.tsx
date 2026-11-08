// @vitest-environment jsdom
// Studio is a fullscreen page: the console swaps its shell for it under /studio and back on close.
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { button, click, mount, settle, stubBrowser, type Mounted } from './modules/magnus/test-dom';

vi.mock('./lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/api')>();
  return { ...actual, adminApi: { ...actual.adminApi, me: async () => ({ user: { id: 'user-1', username: 'operator', displayName: 'Operator', roles: ['admin'] } }) } };
});
// The shell's shared store loads Emberpath data; here it stays loading so only the frame renders.
vi.mock('./lib/store', () => ({
  StoreProvider: ({ children }: { children: ReactNode }) => children,
  useStore: () => ({
    data: { providers: [], traces: [], audit: [], actors: [], incidents: [], clientKeys: [], telemetry: null },
    loading: true,
    refreshing: false,
    error: null,
    loadIssues: [],
    lastSync: null,
    refresh: async () => {},
    resourceFreshness: {},
    onAuthExpired: () => {},
  }),
}));

let view: Mounted | undefined;
beforeEach(() => {
  stubBrowser();
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input), 'https://console.example.com').pathname;
    if (path === '/api/magnus/ardent/profiles') return Response.json({ success: true, data: [] });
    return new Response('Not found', { status: 404 });
  }));
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  vi.unstubAllGlobals();
  history.replaceState(null, '', '/');
});

async function until(found: () => unknown) {
  for (let attempt = 0; attempt < 50 && !found(); attempt += 1) await settle(10);
  expect(found()).toBeTruthy();
}

describe('the console and Studio', () => {
  it('renders Studio without the shell, and the shell again once it closes', async () => {
    history.replaceState({ studioOrigin: '/?page=routers' }, '', '/studio');
    const { App } = await import('./app');
    view = await mount(<App />);
    await until(() => document.querySelector('.studio-shell'));
    expect(document.querySelector('.app-shell, #product-navigation')).toBeNull();
    expect(document.body.textContent).toContain('Ardent Project Studio needs at least one Ardent agent.');

    await click(button('Close Studio'));
    await until(() => document.querySelector('.app-shell'));
    expect(location.pathname + location.search).toBe('/?page=routers');
    expect(document.querySelector('.studio-shell')).toBeNull();
  });

  it('opens Studio from the sidebar and remembers the page it was opened from', async () => {
    history.replaceState(null, '', '/?page=keys');
    const { App } = await import('./app');
    view = await mount(<App />);
    await until(() => document.querySelector('.app-shell'));
    await click(button('Gallery'));
    await until(() => document.querySelector('.studio-shell'));
    expect(location.pathname).toBe('/studio/gallery');
    expect(history.state).toEqual({ studioOrigin: '/?page=keys' });
    expect(document.querySelector('.app-shell')).toBeNull();

    history.back();
    await until(() => document.querySelector('.app-shell'));
    expect(location.pathname + location.search).toBe('/?page=keys');
  });
});
