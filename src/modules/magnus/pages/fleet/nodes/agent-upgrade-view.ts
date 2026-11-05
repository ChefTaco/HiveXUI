import { z } from 'zod';
import { upgradeEligibilityResponseSchema, upgradeReadinessSchema, upgradeRunSchema } from '@contracts/magnus/browser';
import { MagnusApiError } from '../../../api/errors';
import { upgradeRemedy } from './upgrade-remedies';

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
