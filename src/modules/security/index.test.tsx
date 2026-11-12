// @vitest-environment jsdom
// Cindertrace's pages are plain client components chosen from the route table by address.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { button, click, mount, settle, stubBrowser, type as typeInto, type Mounted } from '../magnus/test-dom';

const T = '2026-11-01T09:00:00.000Z';
const CASE = {
  id: 'case-1', title: 'Repeated sign-in failures', severity: 'high', status: 'open', confidence: 0.82,
  summary: 'Several failed sign-ins from one address.', firstSeenAt: T, lastSeenAt: T,
  recommendedInvestigation: ['Check the source address'], evidenceSteps: [],
};
const DETAIL = {
  case: CASE, events: [], entities: [], evidence: [], investigations: [], actions: [],
  labRunId: null, responseAvailable: false, canApprove: false, approvalMode: 'console',
};

let view: Mounted | undefined;
let requests: string[] = [];
let lab = false;
beforeEach(async () => {
  stubBrowser();
  requests = [];
  lab = false;
  history.replaceState(null, '', '/');
  vi.resetModules();
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'https://hive.example.com');
    if (url.pathname === '/runtime.json') return Response.json({ schema: 1, mode: 'legacy', products: { cindertrace: '/api/security' } });
    const path = url.pathname.replace('/api/security/security-fusion/', '') + url.search;
    requests.push(`${init?.method ?? 'GET'} ${path}`);
    const ok = (data: unknown) => Response.json({ success: true, data });
    if (path === 'overview') return ok({ generatedAt: T, openCases: [CASE], sources: [], bySeverity: [{ severity: 'high', _count: { id: 1 } }] });
    if (path === 'lab') return ok({ enabled: lab, canAdmin: true, runs: [] });
    if (path === 'cases') return ok([CASE]);
    if (path === 'cases/case-1') return ok(DETAIL);
    if (path === 'cases/case-2') return ok({ ...DETAIL, case: { ...CASE, id: 'case-2' }, entities: [
      { id: 'ent-1', type: 'agent', canonical: 'actor:ardent-lead', label: 'lead', lastSeenAt: T, aliasesJson: JSON.stringify(['actor:ardent-lead', 'magnus-node:node-1', 'agent-ref:node-1~lead']) },
      { id: 'ent-2', type: 'agent', canonical: 'actor:no-ref', label: 'unbound', lastSeenAt: T, aliasesJson: JSON.stringify(['actor:no-ref']) },
      { id: 'ent-3', type: 'host', canonical: 'host:node-1', label: 'node-1', lastSeenAt: T },
    ] });
    if (path === 'cases/case-1/investigations') return ok({ id: 'inv-1', revision: 1, draft: { summary: 'x', hypotheses: [], prioritizedChecks: [], proposedActions: [], evidenceSteps: [] }, authorId: 'alice', createdAt: T });
    return Response.json({ success: false }, { status: 404 });
  }));
  await (await import('../../lib/runtime')).initializeRuntime();
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  vi.unstubAllGlobals();
});

async function open(address: string) {
  history.replaceState(null, '', address);
  const { default: SecurityModule } = await import('./index');
  view = await mount(<SecurityModule />);
  await until(() => !document.querySelector('[aria-label="Loading security information"]'));
}
async function until(found: () => unknown) {
  for (let attempt = 0; attempt < 50 && !found(); attempt += 1) await settle(10);
  expect(found()).toBeTruthy();
}
const text = () => document.body.textContent ?? '';

describe('Cindertrace pages', () => {
  it('open the overview at the root address, as ?page=security always has', async () => {
    await open('/?page=security');
    expect(text()).toContain('Security operations');
    expect(requests).toContain('GET overview');
    // The shell's sidebar lists the pages now; the module draws no second navigation.
    expect(document.querySelector('nav[aria-label="Security Fusion"]')).toBeNull();
  });

  it('follow a case link to its record without reloading', async () => {
    await open('/security-fusion/cases');
    const link = document.querySelector<HTMLAnchorElement>('a[href="/security-fusion/cases/case-1"]');
    expect(link).not.toBeNull();
    await click(link);
    await until(() => text().includes('Recommended investigation'));
    expect(location.pathname).toBe('/security-fusion/cases/case-1');
    expect(requests).toContain('GET cases/case-1');
  });

  it("link an agent entity to its Agent 360 page when it carries an agent-ref alias", async () => {
    await open('/security-fusion/cases/case-2');
    const links = [...document.querySelectorAll<HTMLAnchorElement>('a[href^="/agents/"]')];
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/agents/node-1~lead']);
    expect(links[0]!.closest('p')?.textContent).toContain('lead');
  });

  it('reload a record after a change and keep the page and its message on screen', async () => {
    await open('/security-fusion/cases/case-1');
    await typeInto(document.querySelector('#investigation-summary'), 'Blocked at the edge');
    const reads = () => requests.filter((request) => request === 'GET cases/case-1').length;
    expect(reads()).toBe(1);
    await click(button('Save draft'));
    await until(() => reads() === 2);
    expect(requests).toContain('POST cases/case-1/investigations');
    expect(document.querySelector('[aria-label="Loading security information"]')).toBeNull();
    expect(text()).toContain('Investigation draft saved.');
  });

  it('say a record is unavailable rather than show an empty page', async () => {
    await open('/security-fusion/lab');
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('This security record is unavailable');
    await view?.unmount();
    lab = true;
    await open('/security-fusion/lab');
    expect(text()).toContain('Evolving evidence lab');
  });

  it('refuse an address it has no page for', async () => {
    await open('/security-fusion/nope');
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('This security page is unavailable');
    expect(requests).toEqual([]);
  });

  it('refuse a record id that could leave its path before asking the API', async () => {
    await open('/security-fusion/cases/..%2Foverview');
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('Invalid route segment');
    expect(requests).toEqual([]);
  });
});
