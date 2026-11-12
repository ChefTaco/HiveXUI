// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { button, click, mount, stubBrowser, type Mounted } from '../magnus/test-dom';
import { InboxBellView } from './bell';
import { InboxPage } from './index';
import type { InboxSnapshot, InboxStore } from './store';
import { hiveEvent } from './test-fixtures';

const READY: InboxSnapshot = { phase: 'ready', registryError: null, sources: [], events: [], read: { seen: {}, magnusRead: new Map() }, unread: 0 };
function fakeStore(partial: Partial<InboxSnapshot>) {
  let snapshot: InboxSnapshot = { ...READY, ...partial };
  const listeners = new Set<() => void>();
  const store = {
    subscribe: (listener: () => void) => (listeners.add(listener), () => void listeners.delete(listener)),
    snapshot: () => snapshot,
    retain: vi.fn(() => () => {}),
    refresh: vi.fn(async () => {}),
    markAllRead: vi.fn(async () => {}),
    set(next: Partial<InboxSnapshot>) {
      snapshot = { ...snapshot, ...next };
      for (const listener of listeners) listener();
    },
  } satisfies InboxStore & Record<string, unknown>;
  return store;
}
const SOURCES: InboxSnapshot['sources'] = [
  { product: 'magnus', name: 'Magnus', state: 'ready' },
  { product: 'cindertrace', name: 'Cindertrace', state: 'ready' },
];
const text = () => document.body.textContent ?? '';
const select = (label: string) => document.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
async function choose(label: string, value: string) {
  await act(async () => {
    const element = select(label);
    element.value = value;
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

let view: Mounted | undefined;
beforeEach(() => stubBrowser());
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  document.body.innerHTML = '';
});

describe('the Inbox page', () => {
  it('shows a loading state before the first round', async () => {
    view = await mount(<InboxPage store={fakeStore({ phase: 'loading' })} />);
    expect(document.querySelector('[role="status"]')?.textContent).toContain('Loading the inbox');
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('shows the Registry error with Retry', async () => {
    const store = fakeStore({ phase: 'error', registryError: 'It answered 503' });
    view = await mount(<InboxPage store={store} />);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('The inbox could not read the Hive Registry');
    expect(text()).toContain('It answered 503');
    await click(button('Retry'));
    expect(store.refresh).toHaveBeenCalled();
  });

  it('explains an installation where no product serves a feed', async () => {
    view = await mount(<InboxPage store={fakeStore({ sources: [] })} />);
    expect(text()).toContain('No product announces an event feed yet');
  });

  it('shows an empty list when the feeds have nothing', async () => {
    view = await mount(<InboxPage store={fakeStore({ sources: SOURCES })} />);
    expect(text()).toContain('Nothing new');
    expect(button('Mark all read')?.disabled).toBe(true);
  });

  it('lists events beside a row for a product that did not answer', async () => {
    const events = [hiveEvent('cindertrace', 1, 2), hiveEvent('magnus', 1, 1)];
    view = await mount(
      <InboxPage store={fakeStore({ sources: [SOURCES[0]!, { product: 'cindertrace', name: 'Cindertrace', state: 'failed', error: 'It did not answer in time' }], events, unread: 2 })} />,
    );
    expect(text()).toContain("Couldn't reach Cindertrace. It did not answer in time");
    expect([...document.querySelectorAll('.inbox-list > li')].map((item) => item.querySelector('.inbox-item__title')?.textContent)).toEqual(['cindertrace event 1 (unread)', 'magnus event 1 (unread)']);
  });

  it('links an event only to a page the route table knows', async () => {
    const known = hiveEvent('cindertrace', 1, 2);
    const unknown = hiveEvent('magnus', 1, 1, { link: { product: 'magnus', path: '/not-a-page/1' } });
    view = await mount(<InboxPage store={fakeStore({ sources: SOURCES, events: [known, unknown] })} />);
    const links = [...document.querySelectorAll<HTMLAnchorElement>('.inbox-list a')];
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/security-fusion/cases/case-1']);
    expect(text()).toContain('/not-a-page/1');
  });

  it('filters by product, severity and unread', async () => {
    const events = [hiveEvent('magnus', 1, 3, { severity: 'critical' }), hiveEvent('cindertrace', 1, 2, { severity: 'info' })];
    const seen = { magnus: { occurredAt: events[0]!.occurredAt, id: events[0]!.id } };
    view = await mount(<InboxPage store={fakeStore({ sources: SOURCES, events, read: { seen, magnusRead: new Map() }, unread: 1 })} />);
    const titles = () => [...document.querySelectorAll('.inbox-list .inbox-item__title')].map((item) => item.textContent);
    expect(titles()).toEqual(['magnus event 1', 'cindertrace event 1 (unread)']);
    await choose('Product', 'magnus');
    expect(titles()).toEqual(['magnus event 1']);
    await choose('Severity', 'info');
    expect(text()).toContain('No events match these filters');
    await click(button('Clear filters'));
    expect(titles()).toHaveLength(2);
    await act(async () => document.querySelector<HTMLInputElement>('.toggle input')!.click());
    expect(titles()).toEqual(['cindertrace event 1 (unread)']);
  });

  it('marks all read through the store', async () => {
    const store = fakeStore({ sources: SOURCES, events: [hiveEvent('magnus', 1, 1)], unread: 1 });
    view = await mount(<InboxPage store={store} />);
    await click(button('Mark all read'));
    expect(store.markAllRead).toHaveBeenCalledOnce();
  });
});

describe('the header bell', () => {
  it('names the unread count and opens the newest events in a drawer', async () => {
    const store = fakeStore({ sources: SOURCES, events: [hiveEvent('magnus', 1, 1)], unread: 1 });
    const open = vi.fn();
    view = await mount(<InboxBellView store={store} onOpenInbox={open} />);
    const bell = button('Inbox, 1 unread')!;
    expect(bell.getAttribute('aria-expanded')).toBe('false');
    await click(bell);
    const drawer = document.querySelector('[role="dialog"]');
    expect(drawer?.getAttribute('aria-label')).toBe('Inbox');
    expect(drawer?.textContent).toContain('magnus event 1');
    await click(button('Open inbox'));
    expect(open).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('shows no count when everything is read', async () => {
    view = await mount(<InboxBellView store={fakeStore({ sources: SOURCES })} onOpenInbox={() => {}} />);
    expect(button('Inbox')).toBeDefined();
    expect(document.querySelector('.topbar-icon__count')).toBeNull();
  });

  it('shows the loading and error states in the drawer too', async () => {
    const store = fakeStore({ phase: 'loading' });
    view = await mount(<InboxBellView store={store} onOpenInbox={() => {}} />);
    await click(button('Inbox'));
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Loading the inbox');
    await act(async () => store.set({ phase: 'error', registryError: 'down' }));
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('The inbox could not read the Hive Registry');
  });
});
