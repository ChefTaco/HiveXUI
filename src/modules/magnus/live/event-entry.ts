import type { FeedSeverity } from './feed';

export interface EventEntry {
  title: string;
  message?: string;
  severity: FeedSeverity;
  /** Worth interrupting the operator with a toast. */
  toast: boolean;
}
const text = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined);
const SEVERITIES = new Set<string>(['info', 'success', 'warning', 'error']);

/** What a bus event means to an operator. Payloads have no shared shape, so every field is checked. */
export function eventToEntry(channel: string, data: unknown): EventEntry {
  const body = (data && typeof data === 'object' && !Array.isArray(data) ? data : {}) as Record<string, unknown>;
  const type = text(body.type) ?? '';
  const node = text(body.nodeName) ?? 'Unknown node';
  const message = text(body.message);
  const entry = (title: string, severity: FeedSeverity, detail?: string): EventEntry => ({ title, severity, toast: true, ...(detail ? { message: detail } : {}) });
  switch (type) {
    case 'deploy.started':
      return entry(`Deploying to ${node}`, 'info');
    case 'deploy.completed':
      return entry(`Deploy complete: ${node}`, 'success');
    case 'deploy.failed':
      return entry(`Deploy failed: ${node}`, 'error', message);
    case 'upgrade.started':
      return entry(`Upgrading ${node}`, 'info');
    case 'upgrade.completed':
      return entry(`Upgrade complete: ${node}`, 'success', text(body.version) ? `v${text(body.version)}` : undefined);
    case 'upgrade.failed':
      return entry(`Upgrade failed: ${node}`, 'error', message);
    case 'node.recovered':
      return entry(`${node} back online`, 'success', text(body.previousStatus) ? `Recovered from ${text(body.previousStatus)}` : undefined);
    case 'command.completed':
      return entry('Command completed', 'success', text(body.command));
    case 'command.failed':
      return entry('Command failed', 'error', [text(body.command), typeof body.exitCode === 'number' ? `exit ${body.exitCode}` : undefined].filter(Boolean).join(' '));
    case 'health.alert': {
      const metric = (text(body.metric) ?? 'metric').replaceAll('_', ' ');
      const value = typeof body.value === 'number' ? `${body.value.toFixed(1)}%` : undefined;
      const threshold = typeof body.threshold === 'number' ? `threshold ${body.threshold}%` : undefined;
      const severity = text(body.severity);
      return entry(`Alert: ${metric} on ${node}`, severity && SEVERITIES.has(severity) ? (severity as FeedSeverity) : 'warning', [value, threshold].filter(Boolean).join(', '));
    }
    default:
      return { title: (type || channel).replaceAll('.', ' ').replaceAll(':', ' '), severity: 'info', toast: false, ...(text(body.nodeName) ? { message: node } : {}) };
  }
}

const COMMAND_SEVERITY: Record<string, FeedSeverity> = { COMPLETED: 'success', FAILED: 'error', TIMEOUT: 'error', CANCELLED: 'warning', RUNNING: 'info', PENDING: 'info', QUEUED: 'info' };
/** Recent commands and audit events from /stats/overview as feed entries. */
export function recentActivityEntries(stats: {
  recentCommands: ReadonlyArray<{ id: string; command: string; status: string; createdAt: string; node: { name: string } }>;
  recentAudit: ReadonlyArray<{ id: string; action: string; timestamp: string; targetType: string; targetId: string }>;
}) {
  const at = (value: string) => {
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? time : 0;
  };
  return [
    ...stats.recentCommands.map((item) => ({ id: `command-${item.id}`, at: at(item.createdAt), channel: 'command:status', title: `${item.status.toLowerCase()}: ${item.command}`, message: item.node.name, severity: COMMAND_SEVERITY[item.status] ?? ('info' as FeedSeverity) })),
    ...stats.recentAudit.map((item) => ({ id: `audit-${item.id}`, at: at(item.timestamp), channel: 'audit', title: item.action, ...(item.targetType ? { message: item.targetType } : {}), severity: 'info' as FeedSeverity })),
  ];
}
