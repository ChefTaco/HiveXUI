import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** The static container's nginx.conf must send the security headers on every route. */
const config = readFileSync(new URL('../nginx.conf', import.meta.url), 'utf8').replace(/#.*$/gm, '');
const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');

const POLICY =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': POLICY,
};

type Block = { headers: Map<string, string>; always: Set<string>; directives: string[] };

const headerPattern = /add_header\s+(\S+)\s+("[^"]*"|\S+)(\s+always)?\s*;/g;
const parse = (body: string): Block => {
  const matches = [...body.matchAll(headerPattern)];
  return {
    headers: new Map(matches.map((match) => [match[1]!, match[2]!.replace(/^"|"$/g, '')])),
    always: new Set(matches.filter((match) => match[3]).map((match) => match[1]!)),
    directives: body.replace(headerPattern, '').split(';').map((statement) => statement.trim()),
  };
};
const locations = [...config.matchAll(/location\s+([^{]+?)\s*\{([^}]*)\}/g)].map((match) => ({
  path: match[1]!,
  ...parse(match[2]!),
}));
const server = parse(config.replace(/location\s+[^{]+\{[^}]*\}/g, ''));

// nginx drops the server's add_header set in any location that has its own, unless
// add_header_inherit merge (nginx 1.29.3 and later) is set on the server.
const merges = server.directives.includes('add_header_inherit merge');
const effective = (location: Block) =>
  location.headers.size === 0 ? server.headers : new Map([...(merges ? server.headers : []), ...location.headers]);

describe('static serving', () => {
  it('finds the routes the console relies on', () => {
    expect(locations.map((location) => location.path)).toEqual(['= /health', '= /runtime.json', '/assets/', '/api/', '/']);
  });

  it('sends the CSP and security headers on every route, including ones with their own headers', () => {
    for (const location of locations)
      for (const [name, value] of Object.entries(SECURITY))
        expect(effective(location).get(name), `${name} on ${location.path}`).toBe(value);
  });

  it('sends the security headers on error responses too', () => {
    for (const name of Object.keys(SECURITY)) expect(server.always.has(name), name).toBe(true);
  });

  it('keeps the cache rules for the shell, assets and runtime config', () => {
    const at = (path: string) => locations.find((location) => location.path === path)!;
    expect(at('/').headers.get('Cache-Control')).toBe('no-cache');
    expect(at('/assets/').headers.get('Cache-Control')).toBe('public, immutable');
    expect(at('= /runtime.json').headers.get('Cache-Control')).toBe('no-store');
  });

  it('runs on an nginx that understands add_header_inherit', () => {
    const version = /^FROM nginxinc\/nginx-unprivileged:(\d+)\.(\d+)\.(\d+)-alpine@sha256:[a-f0-9]{64}$/m.exec(dockerfile);
    expect(version, 'runtime base pinned by exact version and digest').not.toBeNull();
    const [major, minor, patch] = version!.slice(1).map(Number) as [number, number, number];
    expect(major * 1e6 + minor * 1e3 + patch).toBeGreaterThanOrEqual(1_029_003);
  });

  it('serves as the unprivileged user', () => {
    expect(dockerfile.trimEnd().split('\n').filter((line) => line.startsWith('USER ')).at(-1)).toBe('USER 101');
  });
});
