// @vitest-environment jsdom
import { act, lazy, Suspense, type ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { button, click, mount, settle, stubBrowser, type Mounted } from '../modules/magnus/test-dom';

const reload = vi.fn();
vi.mock('../lib/chunk-reload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/chunk-reload')>();
  return {
    ...actual,
    reloadOnceForNewVersion: () => actual.reloadOnceForNewVersion(reload),
    reloadConsole: () => actual.reloadConsole(reload),
    // Each test starts before any reload; the real flag lasts for the page.
    reloadStarted: () => false,
  };
});
const { ViewBoundary } = await import('./view-boundary');

let view: Mounted | undefined;
beforeEach(() => {
  stubBrowser();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  reload.mockReset();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

function Broken(): never {
  throw new Error('The page broke');
}
const missingChunk = () =>
  lazy<ComponentType>(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module: https://console.example.com/assets/page-old.js')));

async function shown(text: string) {
  for (let i = 0; i < 50 && !document.body.textContent?.includes(text); i++) await settle(10);
  expect(document.body.textContent).toContain(text);
}

describe('the shell error boundary', () => {
  it('keeps the shell around a failing page and offers to try again or reload', async () => {
    view = await mount(<main><p>Shell frame</p><ViewBoundary label="Fixture"><Broken /></ViewBoundary></main>);
    await shown('This page could not be shown');
    expect(document.body.textContent).toContain('Shell frame');
    expect(document.body.textContent).toContain('The page broke');
    expect(button('Try again')).toBeDefined();
    await click(button('Reload console'));
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it('reloads once for a chunk a new build removed, then offers the reload instead of looping', async () => {
    const Page = missingChunk();
    view = await mount(<ViewBoundary><Suspense fallback={null}><Page /></Suspense></ViewBoundary>);
    await shown('Loading the new HiveXUI version');
    expect(reload).toHaveBeenCalledTimes(1);
    await view.unmount();
    // The reloaded page fails the same way: no second automatic reload.
    const Again = missingChunk();
    view = await mount(<ViewBoundary><Suspense fallback={null}><Again /></Suspense></ViewBoundary>);
    await shown('A new HiveXUI version is available');
    expect(reload).toHaveBeenCalledTimes(1);
    await click(button('Reload console'));
    expect(reload).toHaveBeenCalledTimes(2);
  });
  it('shows nothing in place of a quiet shell control', async () => {
    view = await mount(<div>Frame<ViewBoundary quiet><Broken /></ViewBoundary></div>);
    await settle(20);
    expect(document.body.textContent).toBe('Frame');
  });
  it('tries the page again when its address changes', async () => {
    let fail = true;
    function Flaky() {
      if (fail) throw new Error('First address failed');
      return <p>Second address</p>;
    }
    view = await mount(<ViewBoundary resetKey="/one"><Flaky /></ViewBoundary>);
    await shown('First address failed');
    fail = false;
    await act(async () => view!.root.render(<ViewBoundary resetKey="/two"><Flaky /></ViewBoundary>));
    await shown('Second address');
  });
});
