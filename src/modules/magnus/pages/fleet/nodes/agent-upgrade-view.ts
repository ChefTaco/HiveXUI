import { z } from 'zod';
import { upgradeEligibilityResponseSchema, upgradeReadinessSchema, upgradeRemedy, upgradeRunSchema } from '@contracts/magnus/browser';
import { MagnusApiError } from '../../../api/errors';

export type UpgradeEligibility = z.output<typeof upgradeEligibilityResponseSchema>['data'];
export type UpgradeRun = z.output<typeof upgradeRunSchema>;
type UpgradeRunNode = UpgradeRun['nodes'][number];
export type UpgradeReadiness = z.output<typeof upgradeReadinessSchema>;

/** The server's message with its code, so an operator can look it up. */
export function upgradeErrorMessage(cause: unknown): string {
  if (cause instanceof MagnusApiError && cause.code && !cause.message.includes(cause.code)) return `${cause.message} (${cause.code})`;
  return cause instanceof Error ? cause.message : String(cause);
}

export function targetDescription(eligibility: UpgradeEligibility): string {
  const bundled = eligibility.version === eligibility.serverVersion ? ' (the agent version bundled with this server)' : '';
  const unverified = eligibility.release.verified ? '' : `; not verified on the registry: ${eligibility.release.reason ?? 'unknown'}`;
  return `Target: magnus-agent ${eligibility.version}${bundled}${eligibility.prerelease ? ', a prerelease' : ''}${unverified}`;
}

const RETRIED = ['failed', 'refused', 'skipped', 'requested', 'watching', 'ambiguous'];

/** The nodes of a finished run a retry would pick up: left over, or held back by the check. */
export function retryCount(run: UpgradeRun | null): number {
  if (!run || run.status === 'running') return 0;
  return run.nodes.filter((node) => RETRIED.includes(node.state)).length + (run.excluded ?? []).filter((node) => node.code && !upgradeRemedy(node.code).informational).length;
}

/** How a finished run reads at a glance. */
export function runHeadline(run: UpgradeRun): string {
  switch (run.status) {
    case 'succeeded':
      return 'Last run: succeeded';
    case 'partial':
      return `Last run: partial, ${run.attention?.length ?? 0} node(s) need attention`;
    case 'failed':
      return run.suspectedRelease ? 'Last run: failed, a release problem is suspected but unproven' : 'Last run: failed, on evidence about the release';
    default:
      return `Last run: ${run.status}`;
  }
}

/** Cause and remedy for a code the check reports. */
export const remedyText = (code: string | null | undefined): string => upgradeRemedy(code).remedy;

/** One line per problem, for a hover title. */
export const readinessTitle = (readiness: UpgradeReadiness): string => readiness.problems.map((problem) => `${problem.code}: ${problem.detail}. ${problem.remedy}`).join('\n');

export function nodeDetail(node: UpgradeRunNode): string | null {
  if (!node.detail) return node.code ?? null;
  return node.code && !node.detail.includes(node.code) ? `${node.code}: ${node.detail}` : node.detail;
}

/** Empty or malformed means the server's own setting, as in the old console. */
export const failureBudget = (text: string): { maxFailures?: number } => (/^[1-9][0-9]{0,2}$/.test(text) ? { maxFailures: Number(text) } : {});

/** Agents on another major version that a run leaves out unless it allows major upgrades. */
export const majorUpgradeCount = (eligibility: UpgradeEligibility | null): number => eligibility?.nodes.filter((node) => node.code === 'MAJOR_VERSION').length ?? 0;

const versionParts = (version: string): number[] | null => {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  return match ? match.slice(1).map(Number) : null;
};

/**
 * Magnus 3.0.1 added allowMajor to the upgrade routes. An older server ignores it on the eligibility query and
 * refuses it in POST /agents/upgrade, so the option is offered only to a server that reports 3.0.1 or later.
 */
export function serverAllowsMajor(magnusVersion: string | null | undefined): boolean {
  const parts = magnusVersion ? versionParts(magnusVersion) : null;
  if (!parts) return false;
  const [major = 0, minor = 0, patch = 0] = parts;
  return major > 3 || (major === 3 && (minor > 0 || patch >= 1));
}

/** Whether moving from one agent version to another crosses a major version. */
export function crossesMajor(from: string, to: string): boolean {
  const left = versionParts(from);
  const right = versionParts(to);
  return left !== null && right !== null && left[0] !== right[0];
}

/** Codes an allowMajor run reports for agents it cannot yet move across the major, in the order to deal with them. */
export const MAJOR_BLOCKER_CODES = ['MAJOR_NEEDS_STEPPING_STONE', 'MAJOR_NEEDS_NODE_KEY'] as const;

export interface MajorBlocker {
  code: (typeof MAJOR_BLOCKER_CODES)[number];
  names: string[];
  cause: string;
  remedy: string;
}

/** The agents an allowMajor eligibility read holds back, grouped by code, with Magnus's cause and remedy. */
export function majorBlockers(eligibility: UpgradeEligibility | null): MajorBlocker[] {
  if (!eligibility) return [];
  return MAJOR_BLOCKER_CODES.flatMap((code) => {
    const names = eligibility.nodes.filter((node) => node.code === code).map((node) => node.name);
    if (names.length === 0) return [];
    const { cause, remedy } = upgradeRemedy(code);
    return [{ code, names, cause, remedy }];
  });
}

/** What the "Allow major upgrade" confirmation says, from Magnus's docs/NODE_CREDENTIALS.md. */
export const ALLOW_MAJOR_MESSAGE = [
  'Agents on an older major version are moved across it in this run. Read the release notes first.',
  'Stepping stone: an agent can verify the move only from 2.10.3 on, so 2.10.x agents go 2.10.x → 2.10.3 → 3.x. Upgrade them to 2.10.3 first, a patch within their major (`magnus-server agents upgrade --to 2.10.3`), then run the major upgrade.',
  'Authorization: for each node that crosses the major, the server signs a major-upgrade authorization with its server key, for that node, that version change and that tarball, valid for one hour. The agent verifies it against a server key it pins, so the node needs a bound node key; the shared node secret plays no part.',
  'The upgrade is then an ordinary one: the exact integrity, the trial and the automatic switch-back all apply.',
].join('\n\n');
