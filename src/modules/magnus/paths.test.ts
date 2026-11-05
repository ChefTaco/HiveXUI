import { describe, expect, it } from 'vitest';
import { isFleetPath, toConsolePath, toFleetHref } from './paths';

describe('console-relative hrefs', () => {
  it('maps the API and old console paths under /fleet, keeping the query and fragment', () => {
    expect(toFleetHref('/')).toBe('/fleet');
    expect(toFleetHref('/?x=1')).toBe('/fleet?x=1');
    expect(toFleetHref('/nodes')).toBe('/fleet/nodes');
    expect(toFleetHref('/nodes/a%20b?tab=x#logs')).toBe('/fleet/nodes/a%20b?tab=x#logs');
    expect(toFleetHref('/nodes#tailscale-renewal')).toBe('/fleet/nodes#tailscale-renewal');
  });
  it('leaves paths the API already prefixed, in-page links and other console modules alone', () => {
    expect(toFleetHref('/fleet/nodes')).toBe('/fleet/nodes');
    expect(toFleetHref('/fleet')).toBe('/fleet');
    expect(toFleetHref('?page=2')).toBe('?page=2');
    expect(toFleetHref('#top')).toBe('#top');
    expect(toFleetHref('/security-fusion/cases/1')).toBe('/security-fusion/cases/1');
    expect(toFleetHref('/fleetwood')).toBe('/fleet/fleetwood');
  });
  it('refuses anything that could leave the console or run script', () => {
    for (const href of ['https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)', 'nodes', '/nodes/../../x', '/%2e%2e/x', '/a%2fb', '/a%5cb', '/%zz', ' /nodes', '/no\ndes', '', null, undefined])
      expect(toFleetHref(href), String(href)).toBeNull();
  });
});

describe('the fleet prefix', () => {
  it('matches whole segments only', () => {
    expect(isFleetPath('/fleet')).toBe(true);
    expect(isFleetPath('/fleet/nodes')).toBe(true);
    expect(isFleetPath('/fleetwood')).toBe(false);
    expect(isFleetPath('/')).toBe(false);
  });
  it('recovers the console path', () => {
    expect(toConsolePath('/fleet')).toBe('/');
    expect(toConsolePath('/fleet/')).toBe('/');
    expect(toConsolePath('/fleet/nodes/a')).toBe('/nodes/a');
    expect(toConsolePath('/elsewhere')).toBe('/');
  });
});
