import { describe, expect, it } from 'vitest';
import { magnusBrowserRoutes, nodeCredentialDetailSchema, nodeCredentialFleetSummarySchema, nodeCredentialResetResultSchema, nodeCredentialRevokeResultSchema, nodeCredentialSchema, pendingBindingSchema, nodeCredentialDowngradeCheckSchema } from '@contracts/magnus/browser';
import { binding, credential, nodeKey, resetResult, revokeResult, summary, summaryV3 } from './fixtures';
import {
  approvalMessage,
  bindingIsStale,
  blockerView,
  credentialStateView,
  credentialTasks,
  deprecationView,
  downgradeView,
  evidenceSigningText,
  keyActionOutcome,
  keyStatusView,
  legacyUseRows,
  looksLikeVersion,
  modeSourceText,
  originLabel,
  readinessText,
  resetMessage,
  resetUnavailable,
  revocableKeys,
  revokeMessage,
  rotationPinsText,
  rotationStatus,
  serverKeyRunbook,
  summaryNeedsAttention,
  upgradeWindowText,
} from './model';

const cred = (overrides: Record<string, unknown> = {}) => nodeCredentialSchema.parse(credential(overrides));
const fleet = (overrides: Record<string, unknown> = {}) => nodeCredentialFleetSummarySchema.parse(summary(overrides));
const fleetV3 = (overrides: Record<string, unknown> = {}) => nodeCredentialFleetSummarySchema.parse(summaryV3(overrides));
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
    for (const code of ['SERVER_KEY_UNAVAILABLE', 'NODES_WITHOUT_KEY', 'NODES_REVOKED', 'NODES_NOT_SIGNING_EVIDENCE', 'AGENTS_NEED_UPGRADE', 'RECENT_SHARED_SECRET_USE', 'PENDING_BINDINGS'] as const) {
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

describe('the fleet summary from Magnus 3.0.0', () => {
  const format = (value: string) => value.slice(0, 10);
  it('tells agents 2.10.0 and 2.10.1 to upgrade to 2.10.2 or later', () => {
    const view = blockerView({ code: 'AGENTS_NEED_UPGRADE', count: 1, nodes: [{ id: 'node-1', name: 'node one' }] });
    expect(view.title).toContain('2.10.0 or 2.10.1');
    expect(view.whatToDo).toMatch(/^Upgrade these agents to 2\.10\.2 or later\./u);
  });
  it('says whether the mode is set or the default, and nothing for an older Magnus', () => {
    expect(modeSourceText(fleetV3())).toBe("Set explicitly: NODE_AUTH_MODE=warn in the server's environment.");
    expect(modeSourceText(fleetV3({ mode: 'enforce', modeExplicit: false, modeDeprecated: false, deprecationNotice: null }))).toBe('The default: NODE_AUTH_MODE is not set, so the server runs in enforce mode.');
    expect(modeSourceText(fleet())).toBeNull();
  });
  it('warns about a deprecated mode with Magnus’s notice, and has its own words when Magnus sends none', () => {
    expect(deprecationView(fleetV3())).toEqual({ title: 'NODE_AUTH_MODE=warn is deprecated', notice: 'NODE_AUTH_MODE=warn is deprecated and is removed in the next major release.' });
    expect(deprecationView(fleetV3({ deprecationNotice: null }))?.notice).toContain('the next major removes it');
    expect(deprecationView(fleetV3({ modeDeprecated: false }))).toBeNull();
    expect(deprecationView(fleet())).toBeNull();
  });
  it('says enforce is reached by removing the mode, and keeps the older wording for an older Magnus', () => {
    expect(readinessText(fleetV3()).text).toContain('Keep NODE_AUTH_MODE set on the server while any remains');
    expect(readinessText(fleetV3({ enforceReady: true, blockers: [] })).text).toContain('removing NODE_AUTH_MODE from the server');
    expect(readinessText(fleet()).text).toContain('Do not set NODE_AUTH_MODE=enforce');
  });
  it('reads a rotation: staged key not pinned by every agent, replaced key in its grace', () => {
    const rotation = fleetV3().serverKeyRotation!;
    expect(rotationStatus(rotation, format)).toEqual([
      { tone: 'info', text: expect.stringContaining('2 of 3 keyed nodes\' agents pin it') },
      { tone: 'info', text: 'The replaced key is still accepted until 2026-11-12; retire it after that.' },
    ]);
    expect(rotationPinsText(rotation)).toBe('3 of 3 keyed nodes reported in the last ten minutes; 3 pin the active key; 2 pin the staged key.');
  });
  it('says when the staged key can be promoted, the replaced key retired, or nothing is in progress', () => {
    const base = fleetV3().serverKeyRotation!;
    expect(rotationStatus({ ...base, previous: null, agents: { ...base.agents, pinningNext: 3 } }, format)).toEqual([{ tone: 'success', text: expect.stringContaining('it can be promoted') }]);
    expect(rotationStatus({ ...base, next: null, previous: { ...base.previous!, inGrace: false } }, format)).toEqual([{ tone: 'warning', text: expect.stringContaining(': retire it.') }]);
    expect(rotationStatus({ ...base, next: null, previous: null }, format)).toEqual([{ tone: 'neutral', text: expect.stringContaining('No rotation in progress') }]);
    expect(rotationPinsText({ ...base, next: null })).not.toContain('staged');
  });
  it('gives the rotation as API and command-line steps, since its routes are not browser routes', () => {
    const steps = serverKeyRunbook();
    expect(steps.map((step) => step.title)).toEqual(['Stage a next key', 'Promote it once every keyed agent pins it', 'Retire the replaced key after its grace period', 'Back up the key file and check']);
    const commands = steps.flatMap((step) => step.commands).join('\n');
    for (const route of ['stage', 'promote', 'retire']) {
      expect(commands).toContain(`/api/v1/node-credentials/server-key/${route}`);
      expect(magnusBrowserRoutes.some((browser) => browser.path === `/node-credentials/server-key/${route}`)).toBe(false);
    }
    expect(commands).toContain('magnus-server node-auth server-key promote --force --grace-hours 168');
  });
  it('explains a reset refused in enforce mode, with Revoke still available', () => {
    const keys = [nodeCredentialDetailSchema.parse(nodeKey())];
    expect(resetUnavailable(keys, cred(), fleetV3({ mode: 'enforce', modeExplicit: false, modeDeprecated: false, deprecationNotice: null }))).toContain('enforce mode (the default), which has no credential reset: Magnus refuses it. Revoke still works.');
    expect(resetUnavailable(keys, cred(), fleet({ mode: 'enforce' }))).toBe('The server runs NODE_AUTH_MODE=enforce, which has no credential reset.');
  });
  it('reads a 3.0.0 summary in the vendored contract, and an older one without the new fields', () => {
    expect(fleetV3().serverKeyRotation?.agents.keyedNodes).toBe(3);
    const older = fleet();
    expect(older.modeExplicit).toBeUndefined();
    expect(older.serverKeyRotation).toBeUndefined();
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
  it('names the browser route for the list, revoke and reset, and keeps rotate and enrollment as text', () => {
    const tasks = credentialTasks('node 1');
    expect(tasks.map((task) => task.id)).toEqual(['list', 'rotate', 'revoke', 'reenroll', 'reset']);
    expect(tasks.filter((task) => task.browserRoute === null).map((task) => task.id)).toEqual(['rotate', 'reenroll']);
    expect(tasks.find((task) => task.id === 'revoke')?.commands[0]).toContain('"$MAGNUS_URL"/api/v1/nodes/node%201/credentials/revoke');
    expect(tasks.find((task) => task.id === 'rotate')).toMatchObject({ where: 'node', commands: ['magnus-agent identity rotate'] });
    expect(credentialTasks('node 1', { inBrowser: true }).map((task) => task.id)).toEqual(['rotate', 'reenroll']);
  });
  it('names only routes the vendored contract publishes to the browser, for ADMIN only', () => {
    for (const task of credentialTasks('node-1')) {
      if (!task.browserRoute) continue;
      const [method, path] = task.browserRoute.split(' ');
      const route = magnusBrowserRoutes.find((item) => item.method === method && item.path === path);
      expect(route, task.browserRoute).toBeDefined();
      expect(route?.roles).toEqual(['ADMIN']);
    }
    // Issuing an enrollment token answers a secret, and stays out of the browser.
    expect(magnusBrowserRoutes.some((route) => route.path.endsWith('/enrollment-token'))).toBe(false);
  });
});

describe('keys', () => {
  const key = (overrides: Record<string, unknown> = {}) => nodeCredentialDetailSchema.parse(nodeKey(overrides));
  const keys = [key(), key({ keyId: 'b'.repeat(64), keyFingerprint: 'bbbbbbbbbbbbbbbb', status: 'RETIRING' }), key({ keyId: 'c'.repeat(64), keyFingerprint: 'cccccccccccccccc', status: 'REVOKED' })];
  it('reads each status, and revokes only the valid keys', () => {
    expect(keys.map((item) => keyStatusView(item).label)).toEqual(['active', 'retiring', 'revoked']);
    expect(revocableKeys(keys).map((item) => item.keyFingerprint)).toEqual(['abababababababab', 'bbbbbbbbbbbbbbbb']);
  });
  it('says before a revoke that the agent is refused until it is enrolled again or reset', () => {
    const message = revokeMessage('node one', keys);
    expect(message).toContain('Revoke all 2 valid keys of node one?');
    expect(message).not.toContain('cccccccccccccccc');
    expect(message).toContain('refuses this node\'s agent from its next request');
    expect(message).toContain('does not fall back to the shared secret');
    expect(message).toContain('until the node is enrolled again with a token, or its credentials are reset');
    expect(revokeMessage('node one', [keys[0]!])).toContain('Revoke the key of node one?');
  });
  it('says before a reset whether the node binds a key again by itself', () => {
    const format = (value: string) => value.slice(0, 10);
    expect(resetMessage('node one', 1, { open: true, until: '2026-12-05T12:00:00.000Z' }, format)).toContain('Magnus forgets its key and accepts the fleet-wide shared secret from this node again. The automatic upgrade window is open until 2026-12-05');
    expect(resetMessage('node one', 2, { open: false, until: '2026-11-01T00:00:00.000Z' }, format)).toContain('The automatic upgrade window is closed, so the node stays on the shared secret until it is enrolled with a token.');
    expect(resetMessage('node one', 2, null, format)).toContain('While the automatic upgrade window is open');
  });
  it('offers no reset in enforce mode, or for a node that has no key', () => {
    expect(resetUnavailable(keys, cred(), fleet({ mode: 'enforce' }))).toContain('enforce');
    expect(resetUnavailable([], cred({ state: 'none' }), fleet())).toContain('no key');
    expect(resetUnavailable(keys, cred(), fleet())).toBeNull();
    expect(resetUnavailable(keys, cred(), null)).toBeNull();
  });
  it('reads Magnus’s answer after a revoke or reset', () => {
    expect(keyActionOutcome('revoke', nodeCredentialRevokeResultSchema.parse(revokeResult()))).toMatchObject({ tone: 'danger', title: '1 key revoked: the agent is refused until it is enrolled again or reset' });
    expect(keyActionOutcome('revoke', nodeCredentialRevokeResultSchema.parse(revokeResult({ revoked: 1, state: 'active', agentRefused: false })))).toMatchObject({ tone: 'warning', title: '1 key revoked' });
    expect(keyActionOutcome('revoke', nodeCredentialRevokeResultSchema.parse(revokeResult({ resetAvailable: false }))).title).toBe('1 key revoked: the agent is refused until it is enrolled again');
    const reset = keyActionOutcome('reset', nodeCredentialResetResultSchema.parse(resetResult({ legacyUpgradeOpen: false })));
    expect(reset.title).toBe('2 keys removed: the node uses the shared secret again');
    expect(reset.detail).toBe('Removed 2 keys. The node is accepted with the shared node secret again.');
  });
});
