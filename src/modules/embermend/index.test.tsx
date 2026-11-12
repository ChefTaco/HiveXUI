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
let accessPermissions: string[] = [];
beforeEach(() => {
  stubBrowser(); findingRows = []; row = recommendation(); kind = 'operator'; mutations = []; failDecision = false;
  accessPermissions = ['read', 'evidence', 'approve', 'execute'];
  api.mockImplementation(async (path, init) => {
    if (init?.method === 'POST') {
      mutations.push({ path, body: typeof init.body === 'string' ? JSON.parse(init.body) : null });
      if (failDecision) return Response.json({ error: 'STALE_DECISION' }, { status: 409 });
      return Response.json({ decisionId: 'fixture-decision', jobId: 'fixture-job', paused: true });
    }
    if (path.endsWith('/recommendations')) return Response.json([row]);
    if (path.endsWith('/findings')) return Response.json(findingRows);
    if (path.endsWith('/access')) return Response.json({ actorId: 'fixture-operator', kind, permissions: accessPermissions, scope });
    if (path.endsWith('/jobs/fixture-job')) return Response.json({ id: 'fixture-job', kind: 'reconciliation', status: 'completed', progress: 1, deadline: row.plan.expiresAt, cancelRequested: false, result: { originalJobId: 'fixture-held-job' }, error: null });
    return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
  });
});
afterEach(async () => { await clearView(); api.mockReset(); });
async function clearView() { await view?.unmount(); view = undefined; }
async function ready() { view = await mount(<EmbermendModule />); for (let i = 0; i < 20 && !document.body.textContent?.includes(row.plan.objective); i++) await settle(10); }
describe('Embermend recommendation decisions', () => {
  it('observes an original held job only under operator recovery authority without repeating dispatch', async () => {
    accessPermissions.push('recover'); row.status = 'authorized';
    row.jobs = [{ id: 'fixture-held-job', kind: 'campaign', status: 'unknown', progress: 0, deadline: row.plan.expiresAt, cancelRequested: false, result: null, error: 'ORIGINAL_OUTCOME_UNKNOWN' }];
    await ready(); const read = button('Read retained outcome fixture-'); if (!read) throw new Error('Missing original observation control'); await click(read); await settle(20);
    expect(mutations).toEqual([{ path: '/api/embermend/api/v1/jobs/fixture-held-job/reconcile', body: {} }]);
    expect(document.body.textContent).toContain('Observation: completed'); expect(button('Start authorized work')).toBeUndefined();
  });
  it('does not offer recovery observation to an ordinary executor or coordinator', async () => {
    row.jobs = [{ id: 'fixture-held-job', kind: 'campaign', status: 'unknown', progress: 0, deadline: row.plan.expiresAt, cancelRequested: false, result: null, error: null }];
    await ready(); expect(button('Read retained outcome fixture-')).toBeUndefined(); await clearView();
    accessPermissions.push('recover'); kind = 'coordinator'; await ready(); expect(button('Read retained outcome fixture-')).toBeUndefined(); expect(mutations).toHaveLength(0);
  });
  it('distinguishes settled ownership from an unknown original outcome and separate security verification', async () => {
    row.executions = [{ id: 'fixture-original', actionId: 'fixture-action', targetId: 'fixture-node', state: 'unknown', receipt: { operationId: 'fixture-original', requestDigest: hash, targetId: 'fixture-node', state: 'unknown', ownershipReleased: true, observedAt: '2026-11-10T00:00:00Z', evidenceIds: [], result: { originalOutcome: 'unknown', ownershipSettled: true } } }];
    await ready(); expect(document.body.textContent).toContain('Ownership: settled'); expect(document.body.textContent).toContain('The original outcome remains unknown'); expect(document.body.textContent).toContain('verification outstanding'); expect(mutations).toHaveLength(0);
  });
  it('requires recovery permission before offering to start a recovery plan', async () => {
    row.status = 'authorized'; const action = row.plan.actions[0]; if (!action) throw new Error('Missing fixture action'); action.class = 'recovery'; action.version = 'execution-settle.v1';
    await ready(); expect(button('Start authorized work')).toBeUndefined(); await clearView(); accessPermissions.push('recover'); await ready(); expect(button('Start authorized work')).toBeDefined();
  });
  it('retains a held job after refresh and never offers to repeat its dispatch', async () => {
    row.status = 'authorized';
    row.jobs = [{ id: 'fixture-held-job', kind: 'campaign', status: 'unknown', progress: 0, cancelRequested: false, deadline: row.plan.expiresAt, error: 'TARGET_NOT_ELIGIBLE', result: null }];
    await ready();
    expect(document.body.textContent).toContain('Work: unknown');
    expect(document.body.textContent).toContain('Work needs review');
    expect(document.body.textContent).toContain('TARGET_NOT_ELIGIBLE');
    expect(button('Start authorized work')).toBeUndefined();
    await clearView(); await ready();
    expect(document.body.textContent).toContain('fixture-held-job');
    expect(button('Start authorized work')).toBeUndefined();
    expect(mutations).toHaveLength(0);
  });

  it('binds a decision to the displayed immutable revision and digest', async () => {
    await ready(); const approve = button('Approve revision 3'); expect(approve).toBeDefined(); if (!approve) throw new Error('Missing decision control'); await click(approve);
    expect(mutations).toEqual([{ path: '/api/embermend/api/v1/decisions', body: { planId: 'fixture-plan', revision: 3, digest: hash, decision: 'approve', expiresAt: row.plan.expiresAt } }]);
    expect(document.body.textContent).toContain('verification outstanding');
  });
  it('never displays approval authority to a coordinator or before publication', async () => {
    kind = 'coordinator'; await ready(); expect(button('Approve revision 3')).toBeUndefined();
    await clearView(); kind = 'operator'; row.publications = []; await ready(); expect(button('Approve revision 3')).toBeUndefined(); expect(mutations).toHaveLength(0);
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

  function risk(sourceState: 'open' | 'verified-fixed' | 'not-applicable', runtimeState: 'unknown' | 'verified-resolved' | 'verified-mitigated' | 'not-applicable', branch = 'main') {
    return { finding: { id: 'fixture-finding', scope, kind: 'code', identity: hash, component: 'fixture-app', weakness: 'injection', title: 'Fixture query', severity: 'high', confidence: 1, validity: 'validated', rationale: 'Controlled query proof', evidenceIds: ['fixture-evidence'], classifications: [], priority: 70 }, occurrences: [{ id: 'fixture-occurrence-' + branch, findingId: 'fixture-finding', subjectId: 'fixture-repository', branch, revision: 'a'.repeat(40), artifactDigest: null, sourceState, runtimeState, coverage: { status: 'complete', requested: ['fixture-app'], examined: ['fixture-app'], excluded: [], failures: [], mode: 'full', observedAt: '2026-11-10T00:00:00Z' }, evidenceIds: ['fixture-evidence'], recurrenceOf: null }] };
  }
  it('keeps source verification visible while runtime exposure remains unknown', async () => {
    findingRows = [risk('verified-fixed', 'unknown')]; await ready();
    expect(document.body.textContent).toContain('Source outcome: verified'); expect(document.body.textContent).toContain('Runtime outcome: unknown'); expect(document.body.textContent).toContain('verification outstanding'); expect(document.body.textContent).not.toContain('verified for recorded scope');
  });
  it('does not claim overall verification from runtime closure while source work remains open', async () => {
    findingRows = [risk('open', 'verified-resolved')]; await ready();
    expect(document.body.textContent).toContain('Source outcome: outstanding'); expect(document.body.textContent).toContain('Runtime outcome: verified'); expect(document.body.textContent).not.toContain('verified for recorded scope');
  });
  it('retains other maintained branch work and distinguishes mitigation from closure', async () => {
    const main = risk('verified-fixed', 'verified-mitigated'); const release = risk('open', 'verified-mitigated', 'release'); findingRows = [{ ...main, occurrences: [...main.occurrences, ...release.occurrences] }]; await ready();
    expect(document.body.textContent).toContain('Source outcome: outstanding'); expect(document.body.textContent).toContain('Runtime outcome: mitigated'); expect(document.body.textContent).not.toContain('verified for recorded scope');
  });
  it('requires applicable verified dimensions and current validity for an overall verified outcome', async () => {
    findingRows = [risk('verified-fixed', 'not-applicable')]; await ready(); expect(document.body.textContent).toContain('verified for recorded scope');
    await clearView(); findingRows = [risk('not-applicable', 'not-applicable')]; await ready(); expect(document.body.textContent).not.toContain('verified for recorded scope');
    await clearView(); const disputed = risk('verified-fixed', 'verified-resolved'); findingRows = [{ ...disputed, finding: { ...disputed.finding, validity: 'disputed' } }]; await ready(); expect(document.body.textContent).toContain('review required'); expect(document.body.textContent).not.toContain('verified for recorded scope');
  });

});
