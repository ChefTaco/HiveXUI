/** A non-success answer from the Magnus API. `message` is written for the operator. */
export class MagnusApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'MagnusApiError';
  }
  /** Identity was verified, but a mutation is never replayed. The operator submits it again. */
  get retryAfterStepUp(): boolean {
    return this.code === 'RETRY_AFTER_STEP_UP';
  }
  get notFound(): boolean {
    return this.status === 404;
  }
  get forbidden(): boolean {
    return this.status === 403;
  }
}

/** A 2xx answer that does not match the released contract. Nothing from it is shown. */
export class MagnusContractError extends Error {
  constructor(
    readonly path: string,
    /** The method changes state, so the change was applied even though the answer was unreadable. */
    readonly applied: boolean,
  ) {
    super(applied ? 'The change was applied, but its result could not be read. Refresh to confirm.' : 'The Magnus API answered in an unexpected format.');
    this.name = 'MagnusContractError';
  }
}

const FEATURE_LABELS: Record<string, string> = {
  cron: 'Cron management',
  users: 'User management',
  'system-updates': 'Automatic system updates',
  'ardent-management': 'Ardent management',
  'docker-group-remediation': 'Docker group remediation',
  'credential-renewal': 'Credential renewal',
  'execution-supervisor': 'The execution supervisor',
};

/** Unprivileged agents answer root-only features with this. It is a state, not a failure. */
export function agentDisabledMessage(body: unknown): string | null {
  const text = typeof body === 'string' ? body : body == null ? '' : JSON.stringify(body);
  if (!text.includes('AGENT_NOT_PRIVILEGED') && !/is disabled: agent is not privileged/.test(text)) return null;
  const feature = /"feature"\s*:\s*\\?"([a-z-]+)/.exec(text)?.[1] ?? /([a-z-]+) is disabled: agent is not privileged/.exec(text)?.[1];
  return `${(feature && FEATURE_LABELS[feature]) ?? feature ?? 'This feature'} is disabled on this node (its agent runs unprivileged).`;
}

export const errorMessage = (error: unknown, fallback = 'The request failed'): string => (error instanceof Error && error.message ? error.message : fallback);
