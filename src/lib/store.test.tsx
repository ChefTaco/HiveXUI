// @vitest-environment jsdom
// The shared Emberpath store loads only for the pages that show it, refreshes while one is on
// screen and the tab is visible, and keeps the incident aggregator's notes apart from failures.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, settle, stubBrowser, type Mounted } from '../modules/magnus/test-dom';

const { calls, loaders } = vi.hoisted(() => {
  const calls: string[] = [];
  const list = (key: string) => async () => {
    calls.push(key);
    return { data: [] };
  };
  const loaders = {
    providers: list('providers'),
    aliases: list('aliases'),
    routeRules: list('routeRules'),
    heuristics: list('heuristics'),
    clientKeys: list('clientKeys'),
    telemetry: async () => (calls.push('telemetry'), null),
    traces: list('traces'),
    audit: list('audit'),
    hiveActors: list('actors'),
    hiveIncidents: async () => (calls.push('incidents'), { data: [], issues: ['hivemem: failure summary unavailable'] }),
    runtimeSettings: list('runtimeSettings'),
    docsIndex: async () => (calls.push('docs'), { docs: [] }),
    hiveStatus: async () => (calls.push('hiveStatus'), null),
  };
  return { calls, loaders };
});
vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>();
  return { ...actual, adminApi: { ...actual.adminApi, ...loaders } };
});
const { StoreProvider, useStore, useStoreStatus, AUTO_REFRESH_MS } = await import('./store');

let view: Mounted | undefined;
let visibility: DocumentVisibilityState = 'visible';
beforeEach(() => {
  stubBrowser();
  calls.length = 0;
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  vi.useRealTimers();
});

function Status() {
  const { loading, error, incidentNotes, loadIssues } = useStoreStatus();
  return <p data-testid="status">{JSON.stringify({ loading, error, incidentNotes, loadIssues })}</p>;
}
function Reader() {
  useStore();
  return null;
}
const status = () => JSON.parse(document.querySelector('[data-testid="status"]')!.textContent!) as { loading: boolean; error: string | null; incidentNotes: string[]; loadIssues: string[] };

describe('the shared store', () => {
  it('loads nothing until a page that shows its data is on screen', async () => {
    view = await mount(<StoreProvider onAuthExpired={() => {}}><Status /></StoreProvider>);
    await settle(10);
    expect(calls).toEqual([]);
    expect(status().loading).toBe(true);
    await view.unmount();
    view = await mount(<StoreProvider onAuthExpired={() => {}}><Status /><Reader /></StoreProvider>);
    await settle(10);
    expect(calls).toContain('providers');
    expect(status().loading).toBe(false);
  });

  it('reports incident notes apart from failed sections', async () => {
    view = await mount(<StoreProvider onAuthExpired={() => {}}><Status /><Reader /></StoreProvider>);
    await settle(10);
    expect(status()).toEqual({ loading: false, error: null, loadIssues: [], incidentNotes: ['hivemem: failure summary unavailable'] });
  });

  it('refreshes on a timer while shown and visible, and on return to a tab hidden for longer', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
    view = await mount(<StoreProvider onAuthExpired={() => {}}><Reader /></StoreProvider>);
    await settle(0, (ms) => vi.advanceTimersByTimeAsync(ms));
    const loads = () => calls.filter((key) => key === 'providers').length;
    expect(loads()).toBe(1);
    await settle(AUTO_REFRESH_MS + 1000, (ms) => vi.advanceTimersByTimeAsync(ms));
    expect(loads()).toBe(2);
    visibility = 'hidden';
    await settle(AUTO_REFRESH_MS * 3, (ms) => vi.advanceTimersByTimeAsync(ms));
    expect(loads()).toBe(2);
    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    await settle(0, (ms) => vi.advanceTimersByTimeAsync(ms));
    expect(loads()).toBe(3);
  });

  it('stops refreshing when no page shows the data', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
    const { act } = await import('react');
    view = await mount(<StoreProvider onAuthExpired={() => {}}><Reader /></StoreProvider>);
    await settle(0, (ms) => vi.advanceTimersByTimeAsync(ms));
    await act(async () => view!.root.render(<StoreProvider onAuthExpired={() => {}}><Status /></StoreProvider>));
    const before = calls.length;
    await settle(AUTO_REFRESH_MS * 3, (ms) => vi.advanceTimersByTimeAsync(ms));
    expect(calls.length).toBe(before);
  });
});
