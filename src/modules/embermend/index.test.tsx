// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { recommendationSchema } from '@contracts/embermend.generated';
import { button, click, mount, settle, stubBrowser, type Mounted } from '../magnus/test-dom';
import EmbermendModule from './index';
const { api } = vi.hoisted(() => ({ api: vi.fn<(path: string, init?: RequestInit) => Promise<Response>>() }));
vi.mock('../../lib/transport', () => ({ apiFetch: api }));
const scope = { installationId: 'fixture', applicationIds: ['fixture-app'], targetIds: ['fixture-node'] };
const hash = 'a'.repeat(64);
function recommendation() {
  return recommendationSchema.parse({ plan: { id: 'fixture-plan', revision: 3, scope, campaignId: 'fixture-campaign', objective: 'Protect application configuration', findingIds: ['fixture-finding'], evidenceIds: ['fixture-evidence'], actions: [{ id: 'fixture-action', version: 'file-mode.v1', class: 'host-change', targetId: 'fixture-node', targetKind: 'host', requiredCapabilities: ['embermend:file-mode.v1'], parameters: { resourceId: 'configuration', mode: '0600', beforeDigest: hash }, preconditions: { environment: 'lab' }, dependsOn: [], verificationIds: ['fixture-verification'], recovery: 'Separately authorized restoration of retained original mode', expectedRevision: null, patchDigest: null, disruption: 'none' }], explanation: 'Reduce file access and independently check effective permissions and application health.', impact: 'No expected restart', uncertainty: ['Consumer access must be verified'], notBefore: '2026-11-10T00:00:00Z', expiresAt: '2099-01-01T00:00:00Z', stopConditions: ['failed-verification'], maxUnavailable: 1, canaryTargetId: 'fixture-node' }, digest: hash, status: 'explained', publications: [{ id: 'fixture-publication', planId: 'fixture-plan', revision: 3, digest: hash, surface: 'hivexui', explanation: 'Published recommendation', publishedAt: '2026-11-10T00:00:00Z' }], executions: [], campaign: { id: 'fixture-campaign', installationId: 'fixture', paused: false, generation: 1, createdAt: '2026-11-10T00:00:00Z' } });
}
let view: Mounted | undefined;
let row = recommendation(); let kind: 'operator' | 'coordinator' = 'operator'; let failDecision = false;
let mutations: { path: string; body: unknown }[] = [];
let findingRows: unknown[] = [];
beforeEach(() => {
  stubBrowser(); findingRows = []; row = recommendation(); kind = 'operator'; mutations = []; failDecision = false;
  api.mockImplementation(async (path, init) => {
    if (init?.method === 'POST') {
      mutations.push({ path, body: typeof init.body === 'string' ? JSON.parse(init.body) : null });
      if (failDecision) return Response.json({ error: 'STALE_DECISION' }, { status: 409 });
      return Response.json({ decisionId: 'fixture-decision', jobId: 'fixture-job', paused: true });
    }
    if (path.endsWith('/recommendations')) return Response.json([row]);
    if (path.endsWith('/findings')) return Response.json(findingRows);
    if (path.endsWith('/access')) return Response.json({ actorId: 'fixture-operator', kind, permissions: ['read', 'approve', 'execute'], scope });
    return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
  });
});
afterEach(async () => { await view?.unmount(); view = undefined; api.mockReset(); });
async function ready() { view = await mount(<EmbermendModule />); for (let i = 0; i < 20 && !document.body.textContent?.includes(row.plan.objective); i++) await settle(10); }
describe('Embermend recommendation decisions', () => {
  it('binds a decision to the displayed immutable revision and digest', async () => {
    await ready(); const approve = button('Approve revision 3'); expect(approve).toBeDefined(); if (!approve) throw new Error('Missing decision control'); await click(approve);
    expect(mutations).toEqual([{ path: '/api/embermend/api/v1/decisions', body: { planId: 'fixture-plan', revision: 3, digest: hash, decision: 'approve', expiresAt: row.plan.expiresAt } }]);
    expect(document.body.textContent).toContain('verification outstanding');
  });
  it('never displays approval authority to a coordinator or before publication', async () => {
    kind = 'coordinator'; await ready(); expect(button('Approve revision 3')).toBeUndefined();
    await view?.unmount(); view = undefined; kind = 'operator'; row.publications = []; await ready(); expect(button('Approve revision 3')).toBeUndefined(); expect(mutations).toHaveLength(0);
  });
  it('reports a stale decision without retrying its mutation', async () => {
    failDecision = true; await ready(); const approve = button('Approve revision 3'); if (!approve) throw new Error('Missing decision control'); await click(approve); await settle(20);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('conditions changed'); expect(mutations).toHaveLength(1);
  });
  it('starts only the displayed authorized revision and describes pause accurately', async () => {
    row.status = 'authorized'; await ready(); const start = button('Start authorized work'); if (!start) throw new Error('Missing start control'); await click(start);
    expect(mutations[0]).toEqual({ path: '/api/embermend/api/v1/plans/fixture-plan/execute', body: { revision: 3, digest: hash } });
    expect(document.body.textContent).toContain('Already admitted operations retain their recorded state');
  });
  it('requires dispatch to resume before starting a paused campaign', async () => {
    row.status = 'authorized'; if (!row.campaign) throw new Error('Missing campaign'); row.campaign.paused = true;
    await ready(); expect(button('Start authorized work')?.disabled).toBe(true); expect(button('Resume dispatch')).toBeDefined(); expect(mutations).toHaveLength(0);
  });

  it('does not display verified security when a finding has no recorded occurrences', async () => {
    findingRows = [{ finding: { id: 'fixture-finding', scope, kind: 'hardening', identity: hash, component: 'fixture-node', weakness: 'configuration-permissions', title: 'Fixture permissions', severity: 'medium', confidence: 1, validity: 'validated', rationale: 'Observed fixture state', evidenceIds: ['fixture-evidence'], classifications: [], priority: 40 }, occurrences: [] }];
    await ready(); expect(document.body.textContent).toContain('verification outstanding'); expect(document.body.textContent).not.toContain('verified for recorded scope');
  });

});
