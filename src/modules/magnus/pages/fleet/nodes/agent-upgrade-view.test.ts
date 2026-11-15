import { describe, expect, it } from 'vitest';
import { MagnusApiError } from '../../../api/errors';
import { ALLOW_MAJOR_MESSAGE, crossesMajor, failureBudget, majorBlockers, majorUpgradeCount, nodeDetail, readinessTitle, remedyText, retryCount, runHeadline, serverAllowsMajor, targetDescription, upgradeErrorMessage, type UpgradeEligibility, type UpgradeRun } from './agent-upgrade-view';

const runNode = (state: UpgradeRun['nodes'][number]['state'], extra: Partial<UpgradeRun['nodes'][number]> = {}): UpgradeRun['nodes'][number] => ({ nodeId: state, name: state, from: '1.0.0', state, requestId: 'r', detail: null, ...extra });
const run = (extra: Partial<UpgradeRun>): UpgradeRun => ({ id: 'r', version: '1.1.0', integrity: 'sha512-x', actorId: 'a', status: 'partial', startedAt: '2026-11-05T10:00:00Z', finishedAt: null, concurrency: 1, message: null, nodes: [], ...extra });

describe('the upgrade drawer text', () => {
  it('adds the code to a server message once', () => {
    expect(upgradeErrorMessage(new MagnusApiError(409, 'A run is active', 'RUN_ACTIVE'))).toBe('A run is active (RUN_ACTIVE)');
    expect(upgradeErrorMessage(new MagnusApiError(409, 'RUN_ACTIVE: a run is active', 'RUN_ACTIVE'))).toBe('RUN_ACTIVE: a run is active');
    expect(upgradeErrorMessage(new Error('plain'))).toBe('plain');
  });
  it('says what the target is and whether it is verified', () => {
    const base: UpgradeEligibility = { version: '1.2.0', serverVersion: '1.2.0', upgradesEnabled: true, disabledReason: null, prerelease: false, release: { verified: true, integrity: 'x', reason: null }, nodes: [], latestRun: null };
    expect(targetDescription(base)).toBe('Target: magnus-agent 1.2.0 (the agent version bundled with this server)');
    expect(targetDescription({ ...base, serverVersion: '1.1.0', prerelease: true, release: { verified: false, integrity: null, reason: 'offline' } })).toBe('Target: magnus-agent 1.2.0, a prerelease; not verified on the registry: offline');
  });
  it('counts only what a retry would pick up', () => {
    expect(retryCount(null)).toBe(0);
    expect(retryCount(run({ status: 'running', nodes: [runNode('failed')] }))).toBe(0);
    expect(retryCount(run({ nodes: [runNode('failed'), runNode('confirmed'), runNode('reverted'), runNode('ambiguous')] }))).toBe(2);
    // Excluded for an expected reason stays out; a held node comes back.
    expect(retryCount(run({ excluded: [{ nodeId: 'a', name: 'a', reason: 'current', code: 'ALREADY_CURRENT' }, { nodeId: 'b', name: 'b', reason: 'held', code: 'RETRY_HELD_SUSPECTED' }, { nodeId: 'c', name: 'c', reason: 'no code' }] }))).toBe(1);
  });
  it('reads a finished run at a glance', () => {
    expect(runHeadline(run({ status: 'succeeded' }))).toBe('Last run: succeeded');
    expect(runHeadline(run({ attention: [] }))).toBe('Last run: partial, 0 node(s) need attention');
    expect(runHeadline(run({ status: 'failed', suspectedRelease: 'x' }))).toContain('suspected');
    expect(runHeadline(run({ status: 'failed' }))).toContain('evidence');
    expect(runHeadline(run({ status: 'stopped' }))).toBe('Last run: stopped');
  });
  it('gives a remedy for a known code and for one it does not know', () => {
    expect(remedyText('PREFLIGHT_DISK_LOW')).toBe('Free disk space on the node.');
    expect(remedyText('FROM_A_NEWER_AGENT')).toContain('newer than the server');
  });
  it('joins a code and its detail without repeating the code', () => {
    expect(nodeDetail(runNode('failed'))).toBeNull();
    expect(nodeDetail(runNode('failed', { code: 'X' }))).toBe('X');
    expect(nodeDetail(runNode('failed', { code: 'X', detail: 'broke' }))).toBe('X: broke');
    expect(nodeDetail(runNode('failed', { code: 'X', detail: 'X broke' }))).toBe('X broke');
  });
  it('lists readiness problems one per line', () => {
    expect(readinessTitle({ status: 'not-ready', observedAt: null, problems: [{ code: 'A', detail: 'b', cause: 'c', remedy: 'd' }, { code: 'E', detail: 'f', cause: 'g', remedy: 'h' }] })).toBe('A: b. d\nE: f. h');
  });
  it('sends a failure budget only when it is a small positive number', () => {
    expect(failureBudget('3')).toEqual({ maxFailures: 3 });
    for (const text of ['', '0', '-1', '1000', 'x']) expect(failureBudget(text)).toEqual({});
  });
});

describe('major versions', () => {
  it('counts the agents only a manual upgrade can move', () => {
    const candidate = (nodeId: string, code: string | null) => ({ nodeId, name: nodeId, version: '1.0.0', eligible: code === null, reason: code, code, upgrade: null, layout: null });
    const base: UpgradeEligibility = { version: '2.0.0', serverVersion: '2.0.0', upgradesEnabled: true, disabledReason: null, prerelease: false, release: { verified: true, integrity: 'x', reason: null }, nodes: [candidate('a', 'MAJOR_VERSION'), candidate('b', 'OFFLINE'), candidate('c', null)], latestRun: null };
    expect(majorUpgradeCount(base)).toBe(1);
    expect(majorUpgradeCount(null)).toBe(0);
  });
});

describe('the Magnus 3.0.1 major-upgrade codes', () => {
  it('gives each new code its cause and remedy from the contract', () => {
    expect(remedyText('MAJOR_NEEDS_STEPPING_STONE')).toContain('magnus-server agents upgrade --to 2.10.3');
    expect(remedyText('MAJOR_NEEDS_NODE_KEY')).toContain('magnus-agent enroll --token-file -');
    expect(remedyText('SELF_UPGRADE_MAJOR_UNAUTHORIZED')).toContain('magnus-server agents upgrade --allow-major');
    expect(remedyText('SERVER_KEY_UNAVAILABLE')).toContain('magnus-server node-auth server-key status');
    expect(remedyText('MAJOR_VERSION')).toContain('--allow-major');
    expect(remedyText('SELF_UPGRADE_REFUSED')).toContain('2.10.3');
  });
  it('counts a node the server could not sign for in a retry, and leaves the expected major states out', () => {
    const excluded = ['MAJOR_NEEDS_STEPPING_STONE', 'MAJOR_NEEDS_NODE_KEY', 'MAJOR_VERSION', 'SERVER_KEY_UNAVAILABLE', 'SELF_UPGRADE_MAJOR_UNAUTHORIZED'].map((code) => ({ nodeId: code, name: code, reason: code, code }));
    expect(retryCount(run({ excluded }))).toBe(2);
  });
  it('offers allowMajor only to a server that reports 3.0.1 or later', () => {
    for (const version of ['3.0.1', '3.0.2', '3.1.0', '4.0.0', '3.0.1-rc.1']) expect(serverAllowsMajor(version)).toBe(true);
    for (const version of ['3.0.0', '2.10.3', '', 'unknown', null, undefined]) expect(serverAllowsMajor(version)).toBe(false);
  });
  it('tells a major crossing from a change within the major', () => {
    expect(crossesMajor('2.10.3', '3.0.2')).toBe(true);
    expect(crossesMajor('3.0.0', '3.0.2')).toBe(false);
    expect(crossesMajor('unknown', '3.0.2')).toBe(false);
  });
  it('groups the agents an allowMajor read holds back, stepping stone first', () => {
    const candidate = (nodeId: string, code: string | null) => ({ nodeId, name: nodeId, version: '2.10.2', eligible: code === null, reason: code, code, upgrade: null, layout: null });
    const base: UpgradeEligibility = { version: '3.0.2', serverVersion: '3.0.2', upgradesEnabled: true, disabledReason: null, prerelease: false, release: { verified: true, integrity: 'x', reason: null }, nodes: [candidate('k', 'MAJOR_NEEDS_NODE_KEY'), candidate('a', 'MAJOR_NEEDS_STEPPING_STONE'), candidate('b', 'MAJOR_NEEDS_STEPPING_STONE'), candidate('c', null)], latestRun: null };
    const blockers = majorBlockers(base);
    expect(blockers.map((blocker) => [blocker.code, blocker.names])).toEqual([['MAJOR_NEEDS_STEPPING_STONE', ['a', 'b']], ['MAJOR_NEEDS_NODE_KEY', ['k']]]);
    expect(blockers[0]?.cause).toContain('older than 2.10.3');
    expect(majorBlockers(null)).toEqual([]);
  });
  it('explains the stepping stone and the one-hour signed authorization before allowing a major', () => {
    expect(ALLOW_MAJOR_MESSAGE).toContain('2.10.x → 2.10.3 → 3.x');
    expect(ALLOW_MAJOR_MESSAGE).toContain('valid for one hour');
    expect(ALLOW_MAJOR_MESSAGE).toContain('server key');
  });
});
