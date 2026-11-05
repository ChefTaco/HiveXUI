import type { Tone } from '@ui';
import type { AnomalyCorrelation, AnomalySummary, RemediationRule } from './schemas';

/** The node with the most active anomalies. The API lists nodes in arrival order, not by count. */
export function hotspot(summary: AnomalySummary | undefined): AnomalySummary['byNode'][number] | null {
  return (summary?.byNode ?? []).reduce<AnomalySummary['byNode'][number] | null>((best, node) => (!best || node.count > best.count ? node : best), null);
}

/** Bands with at least one anomaly. The API always lists info, warning and critical, even at zero. */
export function activeBands(summary: AnomalySummary | undefined): Array<{ severity: string; count: number }> {
  const order = ['critical', 'warning', 'info'];
  const rank = (severity: string) => (order.indexOf(severity) + 1 || order.length + 1);
  return Object.entries(summary?.bySeverity ?? {})
    .filter(([, count]) => count > 0)
    .map(([severity, count]) => ({ severity, count }))
    .sort((left, right) => rank(left.severity) - rank(right.severity));
}

export type TimelineKind = 'target-anomaly' | 'correlated-anomaly' | 'command';
export interface CorrelationItem {
  id: string;
  kind: TimelineKind;
  title: string;
  timestamp: string;
  detail: string;
  nodeId: string;
}

const describe = (anomaly: AnomalyCorrelation['anomaly'] | AnomalyCorrelation['group']['anomalies'][number]) => `Value ${anomaly.value.toFixed(2)} · z-score ${anomaly.zScore.toFixed(2)} · severity ${anomaly.severity}`;

/** The primary anomaly, its correlated anomalies and nearby commands, oldest first. */
export function correlationTimeline(details: AnomalyCorrelation): CorrelationItem[] {
  const items: CorrelationItem[] = [
    { id: details.anomaly.id, kind: 'target-anomaly', title: `Primary anomaly: ${details.anomaly.metric}`, timestamp: details.anomaly.createdAt, detail: describe(details.anomaly), nodeId: details.anomaly.nodeId },
    ...details.group.anomalies
      .filter((anomaly) => anomaly.id !== details.anomaly.id)
      .map((anomaly) => ({ id: anomaly.id, kind: 'correlated-anomaly' as const, title: `Correlated anomaly: ${anomaly.metric}`, timestamp: anomaly.createdAt, detail: describe(anomaly), nodeId: anomaly.nodeId })),
    ...details.group.relatedCommands.map((command) => ({ id: command.id, kind: 'command' as const, title: `Related command: ${command.command}`, timestamp: command.createdAt, detail: `Status ${command.status}`, nodeId: command.nodeId })),
  ];
  return items.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

export function executionTone(status: string): Tone {
  switch (status) {
    case 'completed':
      return 'success';
    case 'failed':
      return 'danger';
    case 'pending_approval':
    case 'approving':
    case 'running':
      return 'warning';
    case 'triggered':
      return 'info';
    default:
      return 'neutral';
  }
}
/** A state still moving, which earns a pulse. */
export const executionIsLive = (status: string): boolean => status === 'pending_approval' || status === 'approving' || status === 'running';

export const RUNBOOKS = [
  { value: 'diagnostics.v1', label: 'diagnostics.v1: uptime' },
  { value: 'restart-service.v1', label: 'restart-service.v1: approved application restart' },
];
export const METRICS = ['*', 'cpu', 'memory', 'disk', 'swap'];
export const SEVERITY_THRESHOLDS = ['warning', 'critical'];

export interface RuleForm {
  name: string;
  description: string;
  metric: string;
  severityThreshold: string;
  agentDefinitionId: string;
  input: string;
  cooldownMinutes: string;
  maxConcurrentRuns: string;
  nodeFilter: string;
  enabled: boolean;
}

export const EMPTY_RULE_FORM: RuleForm = { name: '', description: '', metric: '*', severityThreshold: 'critical', agentDefinitionId: 'diagnostics.v1', input: '', cooldownMinutes: '60', maxConcurrentRuns: '1', nodeFilter: '', enabled: true };

export const ruleToForm = (rule: RemediationRule): RuleForm => ({
  name: rule.name,
  description: rule.description,
  metric: rule.metric,
  severityThreshold: rule.severityThreshold,
  agentDefinitionId: rule.agentDefinitionId,
  input: rule.input,
  cooldownMinutes: String(rule.cooldownMinutes),
  maxConcurrentRuns: String(rule.maxConcurrentRuns),
  nodeFilter: rule.nodeFilter ?? '',
  enabled: rule.enabled,
});

const within = (text: string, low: number, high: number): boolean => {
  const value = Number(text);
  return Number.isInteger(value) && value >= low && value <= high;
};

/**
 * The request body, or why the server would refuse it. On create an empty node filter is left out;
 * on update it is null, which clears a filter the rule had.
 */
export function ruleBody(form: RuleForm, editing: boolean): { error: string } | { body: Record<string, unknown> } {
  const name = form.name.trim();
  if (!name) return { error: 'A rule needs a name.' };
  if (!within(form.cooldownMinutes, 1, 10_080)) return { error: 'Cooldown must be 1 to 10080 whole minutes.' };
  if (!within(form.maxConcurrentRuns, 1, 10)) return { error: 'Max concurrent runs must be 1 to 10.' };
  if (form.input.trim()) {
    try {
      JSON.parse(form.input);
    } catch {
      return { error: 'Runbook configuration must be valid JSON.' };
    }
  }
  const nodeFilter = form.nodeFilter.trim();
  return {
    body: {
      name,
      description: form.description,
      metric: form.metric,
      severityThreshold: form.severityThreshold,
      agentDefinitionId: form.agentDefinitionId,
      input: form.input,
      cooldownMinutes: Number(form.cooldownMinutes),
      maxConcurrentRuns: Number(form.maxConcurrentRuns),
      enabled: form.enabled,
      ...(nodeFilter ? { nodeFilter } : editing ? { nodeFilter: null } : {}),
    },
  };
}

export function filterRules(rules: readonly RemediationRule[], search: string): RemediationRule[] {
  const query = search.trim().toLowerCase();
  return rules.filter((rule) => !query || rule.name.toLowerCase().includes(query) || rule.description.toLowerCase().includes(query));
}
