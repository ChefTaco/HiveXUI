// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { button, click, mount, settle, stubBrowser, type Mounted } from '../magnus/test-dom';
import StudioModule from './index';

const runtime = vi.hoisted(() => ({ magnus: true }));
vi.mock('../../lib/runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/runtime')>()),
  productInstalled: (product: string) => (product === 'magnus' ? runtime.magnus : true),
}));

const PROFILE = { id: 'writer', name: 'Writer', backend: 'llamacpp', apiPort: 9910, running: true, a2aEnabled: false, channels: {}, error: null, nodeId: 'node-1', nodeName: 'node one', hostname: 'node-1.example.com', installationVersion: '2.1.2', reachable: true };

const check = { status: 'ok', error: null };
const READY = { status: 'ready', checks: { database: check, magnus: check, hivemem: check, agents: { status: 'ok', available: 1 } } };

interface Answers {
  profiles: () => Response;
  health: () => Response;
}
let answers: Answers;
let requests: string[];
let view: Mounted | undefined;

beforeEach(() => {
  stubBrowser();
  runtime.magnus = true;
  requests = [];
  answers = {
    profiles: () => Response.json({ success: true, data: [PROFILE] }),
    health: () => new Response('Not found', { status: 404 }),
  };
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input), 'https://console.example.com').pathname;
    requests.push(path);
    if (path === '/api/magnus/ardent/profiles') return answers.profiles();
    if (path === '/api/ardentstudio/v1/health/ready') return answers.health();
    return new Response('Not found', { status: 404 });
  }));
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  vi.unstubAllGlobals();
  history.replaceState(null, '', '/');
});

async function open(path: string, state: unknown = { studioOrigin: '/?page=routers' }) {
  history.replaceState(state, '', path);
  view = await mount(<StudioModule />);
  await settle();
  return view.container;
}
const text = (root: ParentNode = document.body) => root.textContent ?? '';

describe('the Studio page', () => {
  it('renders fullscreen with its own top bar and no console shell', async () => {
    const root = await open('/studio');
    expect(root.querySelector('.studio-shell')).not.toBeNull();
    expect(root.querySelector('header.topbar')).not.toBeNull();
    expect(button('Close Studio', root)).toBeDefined();
    expect(document.querySelector('.app-shell, .sidebar, #product-navigation')).toBeNull();
    expect(text(root)).toContain('Ardent Project Studio');
  });

  it('closes back to the console page it was opened from', async () => {
    await open('/studio/gallery', { studioOrigin: '/fleet/nodes?page=2' });
    await click(button('Close Studio'));
    expect(location.pathname + location.search).toBe('/fleet/nodes?page=2');
  });

  it('closes to the suite home without a stored origin, or with one that is not a console page', async () => {
    await open('/studio', null);
    await click(button('Close Studio'));
    expect(location.pathname + location.search).toBe('/');
    await view!.unmount();
    view = undefined;
    for (const studioOrigin of ['https://elsewhere.example.com/', '//elsewhere.example.com', '/studio/new', 'javascript:alert(1)']) {
      await open('/studio', { studioOrigin });
      await click(button('Close Studio'));
      expect(location.pathname).toBe('/');
      await view!.unmount();
      view = undefined;
    }
  });

  it('keeps the origin while moving inside Studio', async () => {
    await open('/studio', { studioOrigin: '/?page=keys' });
    await click(document.querySelector('a[href="/studio/gallery"]'));
    expect(location.pathname).toBe('/studio/gallery');
    expect(text()).toContain('Gallery');
    await click(button('Close Studio'));
    expect(location.pathname + location.search).toBe('/?page=keys');
  });

  it('does not close on Escape', async () => {
    const root = await open('/studio/p/adventure/room');
    await act(async () => {
      for (const target of [window, document, document.body, root.querySelector('main')!])
        target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(location.pathname).toBe('/studio/p/adventure/room');
    expect(root.querySelector('.studio-shell')).not.toBeNull();
  });

  it('shows project area tabs only on project pages, with the current one marked', async () => {
    let root = await open('/studio');
    expect(root.querySelector('nav[aria-label="Project areas"]')).toBeNull();
    await view!.unmount();
    root = await open('/studio/p/adventure/room');
    const tabs = [...root.querySelectorAll('nav[aria-label="Project areas"] a')];
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Team', 'Room', 'Agents']);
    expect(tabs.map((tab) => tab.getAttribute('href'))).toEqual(['/studio/p/adventure/team', '/studio/p/adventure/room', '/studio/p/adventure/review']);
    expect(root.querySelector('[aria-current="page"]')?.textContent).toBe('Room');
    // The service knows no such project, and the switcher says so rather than showing a name.
    expect(root.querySelector('.studio-switcher')?.textContent).toContain('Project not found');
  });

  it('returns the Agents tab to the agent last opened in the project', async () => {
    const root = await open('/studio/p/adventure/agents/node-1~writer');
    expect(root.querySelector('[aria-current="page"]')?.textContent).toBe('Agents');
    expect(root.querySelector('a[href="/fleet/ardent/profiles/node-1~writer"]')?.textContent).toContain('Fleet details');
    await click([...root.querySelectorAll('nav[aria-label="Project areas"] a')].find((tab) => tab.textContent === 'Team'));
    expect(location.pathname).toBe('/studio/p/adventure/team');
    expect(root.querySelector('a[href="/studio/p/adventure/agents/node-1~writer"]')?.textContent).toBe('Agents');
  });

  it('explains that the Studio service is not reachable rather than inventing records', async () => {
    const root = await open('/studio/p/adventure/review');
    expect(text(root)).toContain("The Studio service isn't reachable");
    expect(text(root)).toContain('Offline');
    answers.health = () => Response.json(READY);
    await click(button('Retry'));
    await settle();
    expect(text(root)).toContain('Connected');
    expect(text(root)).toContain('This console cannot open this page yet');
  });

  it('does not take a page served in place of the service for the service', async () => {
    answers.health = () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } });
    const root = await open('/studio');
    expect(text(root)).toContain("The Studio service isn't reachable");
  });

  it('says when this identity may not use the service', async () => {
    answers.health = () => Response.json({ error: 'FORBIDDEN' }, { status: 403 });
    const root = await open('/studio');
    expect(text(root)).toContain('Ardent Project Studio refused this identity');
    expect(text(root)).toContain('No access');
  });

  it('shows a not-found page for an address no Studio page has', async () => {
    for (const path of ['/studio/elsewhere', '/studio/p/bad%20id/team', '/studio/agents/no-marker']) {
      const root = await open(path);
      expect(text(root), path).toContain('This Studio page does not exist.');
      await view!.unmount();
      view = undefined;
    }
  });
});

describe('the Ardent agent requirement', () => {
  it('asks for an agent when Magnus lists none, with Refresh and a link to the Ardent profiles', async () => {
    answers.profiles = () => Response.json({ success: true, data: [] });
    const root = await open('/studio');
    expect(text(root)).toContain('Ardent Project Studio needs at least one Ardent agent.');
    expect(text(root)).not.toContain("The Studio service isn't reachable");
    const link = root.querySelector<HTMLAnchorElement>('a[href="/fleet/ardent/profiles"]');
    expect(link?.textContent).toBe('Ardent profiles');

    answers.profiles = () => Response.json({ success: true, data: [PROFILE] });
    await click(button(/Refresh/));
    await settle();
    expect(requests.filter((path) => path === '/api/magnus/ardent/profiles')).toHaveLength(2);
    expect(text(root)).not.toContain('needs at least one Ardent agent');
  });

  it('counts only agents on nodes Magnus can reach', async () => {
    answers.profiles = () => Response.json({ success: true, data: [{ ...PROFILE, reachable: false }] });
    const root = await open('/studio/p/adventure/room');
    expect(text(root)).toContain('Ardent Project Studio needs at least one Ardent agent.');
    expect(text(root)).toContain('Magnus reports 1 Ardent profile, but on nodes it cannot reach right now.');
  });

  it('leaves Studio for the Ardent profiles page', async () => {
    answers.profiles = () => Response.json({ success: true, data: [] });
    const root = await open('/studio');
    await click(root.querySelector('a[href="/fleet/ardent/profiles"]'));
    expect(location.pathname).toBe('/fleet/ardent/profiles');
    expect(history.state).toBeNull();
  });

  it('reports a failed check with Retry', async () => {
    answers.profiles = () => Response.json({ error: { message: 'Your Magnus role does not allow this' } }, { status: 403 });
    const root = await open('/studio');
    expect(text(root)).toContain('Ardent agents could not be checked');
    expect(button('Retry', root)).toBeDefined();
  });

  it('explains the requirement when this console has no Magnus', async () => {
    runtime.magnus = false;
    const root = await open('/studio');
    expect(text(root)).toContain('Ardent Project Studio needs at least one Ardent agent.');
    expect(text(root)).toContain('not configured for Magnus');
    expect(requests).not.toContain('/api/magnus/ardent/profiles');
  });
});
