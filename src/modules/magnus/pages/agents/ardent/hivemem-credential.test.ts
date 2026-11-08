import { describe, expect, it } from 'vitest';
import { duration, hiveMemCredentialView } from './hivemem-credential';
import { ardentProfileSummarySchema, type ArdentHiveMemCredential } from './schemas';

const NOW = Date.parse('2026-11-08T12:00:00.000Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const iso = (offset: number) => new Date(NOW + offset).toISOString();
const credential = (extra: Partial<ArdentHiveMemCredential> = {}): ArdentHiveMemCredential => ({
  agentId: 'ardent-node-1-lead', workspaceId: 'ws-1', expiresAt: iso(12 * DAY + 5 * HOUR), lastRenewedAt: iso(-2 * DAY), lastAttemptAt: iso(-2 * DAY),
  nextRenewalAt: iso(5 * DAY), failures: 0, lastError: null, state: 'ok', ...extra,
});
const PROFILE = { id: 'lead', name: 'lead', backend: 'llamacpp', apiPort: 9910, running: true, a2aEnabled: false, channels: {}, error: null };
const parse = (hivemem: unknown) => ardentProfileSummarySchema.parse({ ...PROFILE, hivemem }).hivemem;

describe('HiveMem credential durations', () => {
  it('counts whole days, then hours, then minutes', () => {
    expect(duration(12 * DAY + 5 * HOUR)).toBe('12 days');
    expect(duration(DAY)).toBe('1 day');
    expect(duration(23 * HOUR + 59 * 60_000)).toBe('23 hours');
    expect(duration(HOUR)).toBe('1 hour');
    expect(duration(30 * 60_000)).toBe('30 minutes');
    expect(duration(5_000)).toBe('less than a minute');
    expect(duration(-2 * DAY)).toBe('2 days');
  });
});

describe('HiveMem credential status', () => {
  it('shows days left with the renewal times, relative and absolute', () => {
    const view = hiveMemCredentialView(credential(), NOW)!;
    expect(view).toMatchObject({ kind: 'ok', tone: 'success', headline: 'Credential expires in 12 days', short: '12 days', agentId: 'ardent-node-1-lead', workspaceId: 'ws-1' });
    expect(view.lastRenewed?.relative).toBe('2 days ago');
    expect(view.nextRenewal?.relative).toBe('in 5 days');
    expect(view.expires?.absolute).toBe(new Date(NOW + 12 * DAY + 5 * HOUR).toLocaleString());
  });

  it('counts hours under a day and warns under three days even while renewal is ok', () => {
    expect(hiveMemCredentialView(credential({ expiresAt: iso(5 * HOUR + 10 * 60_000) }), NOW)).toMatchObject({ kind: 'expiring', tone: 'warning', headline: 'Credential expires in 5 hours', short: '5 hours' });
    expect(hiveMemCredentialView(credential({ expiresAt: iso(2 * DAY + 23 * HOUR) }), NOW)).toMatchObject({ kind: 'expiring', tone: 'warning', short: '2 days' });
    expect(hiveMemCredentialView(credential({ expiresAt: iso(3 * DAY) }), NOW)).toMatchObject({ kind: 'ok', tone: 'success', short: '3 days' });
  });

  it('reports failing renewals with the attempt count and the last error', () => {
    const view = hiveMemCredentialView(credential({ state: 'renewal-failing', failures: 3, lastError: 'HiveMem answered 503' }), NOW);
    expect(view).toMatchObject({ kind: 'failing', tone: 'warning', headline: 'Renewal failing (3 attempts)', short: 'renewal failing', lastError: 'HiveMem answered 503' });
    expect(hiveMemCredentialView(credential({ state: 'renewal-failing', failures: 1 }), NOW)?.headline).toBe('Renewal failing (1 attempt)');
  });

  it('is expired when Magnus says so, or once the deadline has passed', () => {
    expect(hiveMemCredentialView(credential({ state: 'expired', expiresAt: iso(-HOUR) }), NOW)).toMatchObject({ kind: 'expired', tone: 'danger', headline: 'Credential expired', short: 'expired' });
    expect(hiveMemCredentialView(credential({ state: 'ok', expiresAt: iso(-DAY) }), NOW)?.kind).toBe('expired');
    expect(hiveMemCredentialView(credential({ state: 'renewal-failing', failures: 9, expiresAt: iso(-1) }), NOW)?.kind).toBe('expired');
  });

  it('shows nothing for an older Magnus and says when Magnus manages no credential', () => {
    expect(hiveMemCredentialView(undefined, NOW)).toBeNull();
    expect(hiveMemCredentialView(null, NOW)).toMatchObject({ kind: 'unmanaged', tone: 'neutral', headline: 'Not managed by Magnus', expires: null });
  });

  it('reads an unknown state or an unreadable deadline as unknown, never as an error', () => {
    expect(hiveMemCredentialView(credential({ state: 'paused' }), NOW)).toMatchObject({ kind: 'unknown', tone: 'neutral', headline: 'Credential status unknown', short: 'unknown' });
    expect(hiveMemCredentialView(credential({ expiresAt: 'soon' }), NOW)).toMatchObject({ kind: 'ok', headline: 'Credential renewed by Magnus', expires: null });
    expect(hiveMemCredentialView('unreadable', NOW)).toMatchObject({ kind: 'unknown', headline: 'Credential status unknown' });
  });
});

describe('the hivemem field of an Ardent profile', () => {
  it('is absent from an older Magnus and null when Magnus manages no credential', () => {
    expect(ardentProfileSummarySchema.parse(PROFILE).hivemem).toBeUndefined();
    expect(parse(null)).toBeNull();
  });
  it('keeps an unknown state for the view to judge', () => {
    expect(parse(credential({ state: 'paused' }))).toMatchObject({ state: 'paused' });
  });
  it('degrades a malformed object to unreadable instead of failing the whole profile', () => {
    for (const value of ['ok', 7, [], {}, { ...credential(), failures: 'two' }, { ...credential(), agentId: undefined }]) expect(parse(value)).toBe('unreadable');
  });
});
