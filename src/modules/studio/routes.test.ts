// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { goStudio, isStudioPath, openStudio, safeOrigin, studioOrigin } from './paths';
import { areaHref, matchStudioRoute, STUDIO_ROUTES } from './routes';

afterEach(() => history.replaceState(null, '', '/'));

describe('Studio routes', () => {
  it('has a page for every address in the plan', () => {
    const cases: Array<[string, string, Record<string, string>]> = [
      ['/studio', 'home', {}],
      ['/studio/', 'home', {}],
      ['/studio/new', 'new', {}],
      ['/studio/gallery', 'gallery', {}],
      ['/studio/agents/node-1~writer', 'agent', { agentRef: 'node-1~writer' }],
      ['/studio/p/adventure', 'project', { projectId: 'adventure' }],
      ['/studio/p/adventure/team', 'team', { projectId: 'adventure' }],
      ['/studio/p/adventure/team/gallery', 'team-gallery', { projectId: 'adventure' }],
      ['/studio/p/adventure/room', 'room', { projectId: 'adventure' }],
      ['/studio/p/adventure/agents/node-1~writer', 'project-agent', { projectId: 'adventure', agentRef: 'node-1~writer' }],
      ['/studio/p/adventure/review', 'review', { projectId: 'adventure' }],
    ];
    for (const [path, id, params] of cases) {
      const found = matchStudioRoute(path);
      expect(found?.route.id, path).toBe(id);
      expect({ projectId: found?.projectId, agentRef: found?.agentRef }).toEqual({ projectId: undefined, agentRef: undefined, ...params });
    }
    expect(new Set(cases.map(([, id]) => id)).size).toBe(STUDIO_ROUTES.length);
  });

  it('rejects ids no project or agent could have', () => {
    for (const path of ['/studio/p/bad%20id', '/studio/p/%E0%A4%A', '/studio/agents/writer', '/studio/agents/node~bad%2Fprofile', '/studio/p/a/agents/x', '/studio/p', '/studio/other'])
      expect(matchStudioRoute(path), path).toBeNull();
  });

  it('sends each area tab to its page', () => {
    expect(areaHref('team', 'adventure')).toBe('/studio/p/adventure/team');
    expect(areaHref('room', 'adventure')).toBe('/studio/p/adventure/room');
    expect(areaHref('agents', 'adventure')).toBe('/studio/p/adventure/review');
    expect(areaHref('agents', 'adventure', 'node-1~writer')).toBe('/studio/p/adventure/agents/node-1~writer');
  });
});

describe('Studio addresses', () => {
  it('knows its own prefix', () => {
    expect(isStudioPath('/studio')).toBe(true);
    expect(isStudioPath('/studio/p/a')).toBe(true);
    expect(isStudioPath('/studios')).toBe(false);
    expect(isStudioPath('/fleet/studio')).toBe(false);
  });

  it('only returns to console pages', () => {
    expect(safeOrigin('/?page=routers')).toBe('/?page=routers');
    expect(safeOrigin('/fleet/ardent/profiles#tasks')).toBe('/fleet/ardent/profiles#tasks');
    for (const value of ['//elsewhere.example.com', 'https://elsewhere.example.com/', '/studio/p/a', '/a\\b', '/a b', 'javascript:alert(1)', 7, null, undefined])
      expect(safeOrigin(value), String(value)).toBeNull();
    expect(studioOrigin(null)).toBe('/');
    expect(studioOrigin({ studioOrigin: '/studio' })).toBe('/');
  });

  it('stores the console page on the way in and keeps it through Studio moves', () => {
    const listener = vi.fn();
    window.addEventListener('popstate', listener);
    history.replaceState(null, '', '/fleet/nodes?page=2');
    openStudio('/studio/gallery');
    expect(location.pathname).toBe('/studio/gallery');
    expect(studioOrigin()).toBe('/fleet/nodes?page=2');
    goStudio('/studio/p/a/room');
    goStudio('/studio/p/a/team', 'replace');
    expect(studioOrigin()).toBe('/fleet/nodes?page=2');
    expect(listener).toHaveBeenCalledTimes(3);
    window.removeEventListener('popstate', listener);
    expect(() => goStudio('/fleet')).toThrow();
    expect(() => openStudio('/elsewhere')).toThrow();
  });
});
