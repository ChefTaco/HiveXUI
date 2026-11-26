// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { button, click, dialog, mount, settle, stubBrowser, type, type Mounted } from '../magnus/test-dom';
import type { Finding } from '@contracts/embermend.generated';
import { AssignmentsPanel, downloadCampaignReport, ExceptionsPanel, ReadinessPanel } from './operations';

const { api } = vi.hoisted(() => ({ api: vi.fn<(path: string, init?: RequestInit) => Promise<Response>>() }));
vi.mock('../../lib/transport', () => ({ apiFetch: api }));

const scope = { installationId: 'fixture', applicationIds: ['fixture-app'], targetIds: ['fixture-node'] };
const finding: Finding = { id: 'fixture-finding', scope, kind: 'hardening', identity: 'a'.repeat(64), component: 'sshd', weakness: 'weak-config', title: 'SSH allows password sign-in', severity: 'high', confidence: 0.9, validity: 'validated', rationale: 'Observed', evidenceIds: [], classifications: [], priority: 70 };
const exception = { id: 'exception-1', scope, findingIds: ['fixture-finding'], owner: 'platform-team', rationale: 'Legacy jump host until decommission', compensatingControls: ['vpn-only'], expiresAt: '2099-01-31T23:59:59.000Z', status: 'active' };
let posted: { path: string; body: unknown }[] = [];
let exceptions: unknown[] = [];

beforeEach(() => {
  stubBrowser();
  posted = [];
  exceptions = [];
  api.mockImplementation(async (path, init) => {
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      posted.push({ path, body });
      exceptions = [body];
      return Response.json({ id: body.id }, { status: 201 });
    }
    if (path.endsWith('/readiness')) return Response.json({ status: 'degraded', serviceAvailable: true, assessmentReady: false, managedDispatch: false, eligibleTargets: 0, blockers: ['NO_FRESH_ENROLLED_ASSESSMENT_TARGET'], capabilities: null });
    if (path.endsWith('/exceptions')) return Response.json(exceptions);
    if (path.endsWith('/profile-assignments')) return Response.json([{ id: 'assignment-1', scope, profileId: 'ubuntu-baseline', profileVersion: '1.2.0', targetIds: ['fixture-node'], impact: 'Read-only checks', supersedes: null }]);
    return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
  });
});
let view: Mounted | undefined;
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  api.mockReset();
});

describe('Embermend readiness, accepted risk and profiles', () => {
  it('says why assessment cannot run', async () => {
    view = await mount(<ReadinessPanel reload={0} />);
    await settle(10);
    const group = document.querySelector('[aria-label="Embermend readiness"]')!;
    expect(group.textContent).toContain('Assessment: not ready');
    expect(document.body.textContent).toContain('No enrolled Magnus target in your scope reported within the last two minutes');
  });

  it('records accepted risk only after a confirmation that names it, and lists it', async () => {
    view = await mount(<ExceptionsPanel findings={[finding]} scope={scope} canRecord reload={0} />);
    await settle(10);
    expect(document.body.textContent).toContain('No risk has been accepted.');
    await click(document.querySelector('input[type="checkbox"]'));
    const field = (label: string) => [...document.querySelectorAll('label')].find((item) => item.textContent?.startsWith(label))?.querySelector('input, textarea');
    await type(field('Owner'), 'platform-team');
    await type(field('Expires on'), '2099-01-31');
    await type(field('Compensating controls'), 'vpn-only, mfa-required');
    await type(field('Rationale'), 'Legacy jump host until decommission');
    await click(button('Record exception'));
    expect(dialog()?.textContent).toContain('1 finding is recorded as accepted risk until 2099-01-31, owned by platform-team: SSH allows password sign-in.');
    expect(posted).toHaveLength(0);
    await click(button('Record exception', dialog()!));
    await settle(20);
    expect(posted[0]?.path).toBe('/api/embermend/api/v1/exceptions');
    expect(posted[0]?.body).toMatchObject({ scope, findingIds: ['fixture-finding'], owner: 'platform-team', compensatingControls: ['vpn-only', 'mfa-required'], expiresAt: '2099-01-31T23:59:59.000Z', status: 'active' });
    expect(document.querySelector('[aria-label="Accepted risk"]')?.textContent).toContain('SSH allows password sign-in');
  });

  it('offers no recording without the exception permission', async () => {
    exceptions = [exception];
    view = await mount(<ExceptionsPanel findings={[finding]} scope={scope} canRecord={false} reload={0} />);
    await settle(10);
    expect(document.body.textContent).toContain('Owner platform-team');
    expect(button('Record exception')).toBeUndefined();
  });

  it('lists the assessment profiles assigned to targets', async () => {
    view = await mount(<AssignmentsPanel reload={0} />);
    await settle(10);
    expect(document.querySelector('[aria-label="Assessment profiles"]')?.textContent).toContain('ubuntu-baseline 1.2.0');
  });

  it('checks a campaign report against the contract before saving it', async () => {
    api.mockResolvedValueOnce(Response.json({ reportId: 'report-1', generatedAt: '2026-11-26T10:00:00.000Z', campaign: { id: 'campaign/1', installationId: 'fixture', paused: false, generation: 1, createdAt: '2026-11-20T00:00:00.000Z' }, plans: [], exceptions: [] }));
    const save = vi.fn();
    await downloadCampaignReport('campaign/1', save);
    expect(api.mock.calls[0]?.[0]).toBe('/api/embermend/api/v1/campaigns/campaign%2F1/report');
    expect(save.mock.calls[0]?.[1]).toBe('embermend-campaign-campaign-1-2026-11-26.json');
    api.mockResolvedValueOnce(Response.json({ reportId: 'report-2' }));
    await expect(downloadCampaignReport('campaign-2', save)).rejects.toThrow();
    expect(save).toHaveBeenCalledTimes(1);
  });
});
