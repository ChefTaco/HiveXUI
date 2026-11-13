import { describe, expect, it } from 'vitest';
import { nodeCredentialFleetSummarySchema, nodeCredentialSchema, pendingBindingSchema, nodeCredentialDowngradeCheckSchema } from '@contracts/magnus/browser';
import { binding, credential, summary } from './fixtures';
import {
  approvalMessage,
  bindingIsStale,
  blockerView,
  credentialStateView,
  credentialTasks,
  downgradeView,
  evidenceSigningText,
  legacyUseRows,
  looksLikeVersion,
  originLabel,
  readinessText,
  summaryNeedsAttention,
  upgradeWindowText,
} from './model';

const cred = (overrides: Record<string, unknown> = {}) => nodeCredentialSchema.parse(credential(overrides));
const fleet = (overrides: Record<string, unknown> = {}) => nodeCredentialFleetSummarySchema.parse(summary(overrides));
const pending = (overrides: Record<string, unknown> = {}) => pendingBindingSchema.parse(binding(overrides));
const check = (action: string, overrides: Record<string, unknown> = {}) => nodeCredentialDowngradeCheckSchema.parse({
  nodeId: 'node-1', to: '2.9.1', targetKnowsNodeKeys: action === 'none', nodeHasCredentials: action !== 'none', action, resetPath: action === 'reset-credentials' ? '/api/v1/nodes/node-1/credentials/reset' : null, detail: 'Magnus says so', ...overrides,
});

describe('a node credential state', () => {
  it('reads each server state in plain words', () => {
    expect(credentialStateView(cred())).toMatchObject({ state: 'active', label: 'own key', tone: 'success' });
    expect(credentialStateView(cred({ state: 'none', origin: null, boundAt: null })).explanation).toContain('fleet-wide shared secret');
    expect(credentialStateView(cred({ state: 'revoked' }))).toMatchObject({ state: 'revoked', tone: 'danger' });
  });
  it('is pending only for a node without a key that has a binding waiting', () => {
    expect(credentialStateView(cred({ state: 'none' }), pending())).toMatchObject({ state: 'pending', label: 'awaiting approval' });
    expect(credentialStateView(cred(), pending()).state).toBe('active');
    expect(credentialStateView(cred({ state: 'none' }), null).state).toBe('none');
  });
  it('names each origin', () => {
    expect(originLabel('ENROLLMENT_TOKEN')).toContain('token');
    expect(originLabel('LEGACY_UPGRADE')).toContain('shared secret');
    expect(originLabel('ROTATION')).toContain('identity rotate');
    expect(originLabel(null)).toBe('—');
  });
  it('lists shared-credential use per channel, and nothing for a server that does not report it', () => {
    const rows = legacyUseRows(cred({ legacyUse: { request: { count: 4, lastUsedAt: '2026-11-05T11:00:00.000Z' }, evidence: null, outbound: { count: 1, lastUsedAt: '2026-11-05T10:00:00.000Z' }, lastUsedAt: '2026-11-05T11:00:00.000Z' } }));
    expect(rows?.map((row) => [row.channel, row.count])).toEqual([['request', 4], ['evidence', 0], ['outbound', 1]]);
    expect(legacyUseRows(cred({ legacyUse: undefined }))).toBeNull();
    expect(legacyUseRows(cred({ legacyUse: null }))).toBeNull();
  });
  it('says whether evidence is signed, and nothing on a phase-1 server', () => {
    expect(evidenceSigningText(cred())).toMatch(/^Yes/);
    expect(evidenceSigningText(cred({ evidenceSigning: false }))).toMatch(/^Not yet/);
    expect(evidenceSigningText(cred({ state: 'none', evidenceSigning: false }))).toMatch(/no active key/);
    expect(evidenceSigningText(cred({ evidenceSigning: undefined }))).toBeNull();
  });
});

describe('the fleet summary', () => {
  it('gives each blocker a title and what to do, and keeps an unknown one readable', () => {
    for (const code of ['SERVER_KEY_UNAVAILABLE', 'NODES_WITHOUT_KEY', 'NODES_REVOKED', 'NODES_NOT_SIGNING_EVIDENCE', 'RECENT_SHARED_SECRET_USE', 'PENDING_BINDINGS'] as const) {
      const view = blockerView({ code, count: 1, nodes: [] });
      expect(view.title).not.toBe(code);
      expect(view.whatToDo.length).toBeGreaterThan(20);
    }
    expect(blockerView({ code: 'SOMETHING_NEW' as never, count: 1, nodes: [] }).title).toBe('SOMETHING_NEW');
  });
  it('says whether enforce mode is safe to switch on', () => {
    expect(readinessText(fleet())).toMatchObject({ tone: 'warning', text: expect.stringContaining('2 things block it') });
    expect(readinessText(fleet({ enforceReady: true, blockers: [] }))).toMatchObject({ tone: 'success', text: expect.stringContaining('would refuse no node') });
    expect(readinessText(fleet({ mode: 'enforce', enforceReady: true, blockers: [] })).text).toBe('The server runs in enforce mode.');
  });
  it('describes the automatic upgrade window open and closed', () => {
    expect(upgradeWindowText({ open: true, until: 'X' }, (value) => value)).toMatch(/^Open until X/);
    expect(upgradeWindowText({ open: false, until: 'X' }, (value) => value)).toContain('NODE_AUTH_LEGACY_UPGRADE_UNTIL');
  });
  it('raises the overview only for what needs a person now', () => {
    expect(summaryNeedsAttention(fleet())).toEqual(['1 key binding waits for an administrator']);
    expect(summaryNeedsAttention(fleet({ pendingBindings: 0, nodes: { total: 3, active: 1, none: 0, revoked: 2, evidenceSigning: 1 } }))).toEqual(['2 nodes have their keys revoked and are refused until enrolled again']);
    expect(summaryNeedsAttention(fleet({ pendingBindings: 0, blockers: [{ code: 'NODES_WITHOUT_KEY', count: 2, nodes: [] }] }))).toEqual([]);
    expect(summaryNeedsAttention(fleet({ pendingBindings: 0, blockers: [{ code: 'SERVER_KEY_UNAVAILABLE', count: 1, nodes: [] }] }))).toEqual(['the server signing key cannot be read']);
  });
});

describe('a pending binding', () => {
  it('puts everything needed to judge the host in the approval', () => {
    const message = approvalMessage(pending());
    for (const part of ['node two', 'cccccccccccccccc', 'node-2.example.com', '198.51.100.7', '192.0.2.12', 'magnus-agent identity show']) expect(message).toContain(part);
  });
  it('goes stale after seven days without a request, as Magnus refuses approval then', () => {
    const now = Date.parse('2026-11-13T12:00:00.000Z');
    expect(bindingIsStale(pending({ lastSeenAt: '2026-11-07T12:00:00.000Z' }), now)).toBe(false);
    expect(bindingIsStale(pending({ lastSeenAt: '2026-11-06T11:59:00.000Z' }), now)).toBe(true);
  });
});

describe('the downgrade check', () => {
  it('lets a version that keeps the key through', () => {
    expect(downgradeView(check('none'))).toMatchObject({ tone: 'success', steps: [], command: null, detail: 'Magnus says so' });
  });
  it('names the reset to post first, with the path Magnus returned', () => {
    const view = downgradeView(check('reset-credentials'));
    expect(view.tone).toBe('warning');
    expect(view.steps[0]).toContain('resets the node');
    expect(view.steps.join(' ')).toContain('NODE_AUTH_MODE=enforce');
    expect(view.command).toBe(`curl -X POST -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{}' "$MAGNUS_URL"/api/v1/nodes/node-1/credentials/reset`);
  });
  it('refuses a downgrade in enforce mode, which has no reset', () => {
    const view = downgradeView(check('enroll-instead'));
    expect(view).toMatchObject({ tone: 'danger', command: null });
    expect(view.title).toBe('Do not install 2.9.1 on this node');
    expect(view.steps[0]).toContain('2.10.0 or later');
  });
  it('accepts only a version the server would', () => {
    expect(['2.9.1', ' 2.10.0 ', '3.0.0-rc.1'].map(looksLikeVersion)).toEqual([true, true, true]);
    expect(['', '2.9', 'latest', '2.9.1; rm'].map(looksLikeVersion)).toEqual([false, false, false, false]);
  });
});

describe('key administration', () => {
  it('is instructions only, until Magnus offers its routes to the browser', () => {
    const tasks = credentialTasks('node 1');
    expect(tasks.map((task) => task.id)).toEqual(['list', 'rotate', 'revoke', 'reenroll', 'reset']);
    expect(tasks.every((task) => task.browserRoute === null)).toBe(true);
    expect(tasks.find((task) => task.id === 'revoke')?.commands[0]).toContain('"$MAGNUS_URL"/api/v1/nodes/node%201/credentials/revoke');
    expect(tasks.find((task) => task.id === 'rotate')).toMatchObject({ where: 'node', commands: ['magnus-agent identity rotate'] });
  });
});
