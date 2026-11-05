// /anomalies, /remediation and /assistant/conversations have no entry in the browser contract yet.
// Shapes from services/control-api/src/services/anomaly-detector.ts, ai-correlation-service.ts and
// remediation-service.ts. The remediation routes answer { data }, without success.
import { z } from 'zod';

export const anomalyEventSchema = z.object({
  id: z.string(),
  nodeId: z.string(),
  metric: z.string(),
  value: z.number(),
  zScore: z.number(),
  severity: z.string(),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  occurrenceCount: z.number(),
  node: z.object({ name: z.string(), hostname: z.string() }).optional(),
});

export const anomalyListResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({ anomalies: z.array(anomalyEventSchema), total: z.number() }),
});

export const anomalySummarySchema = z.object({
  totalActive: z.number(),
  byNode: z.array(z.object({ nodeId: z.string(), nodeName: z.string(), count: z.number(), metrics: z.array(z.string()) })),
  bySeverity: z.record(z.string(), z.number()),
});

export const anomalySummaryResponseSchema = z.object({ success: z.literal(true), data: anomalySummarySchema });

const correlatedAnomalySchema = z.object({ id: z.string(), nodeId: z.string(), metric: z.string(), value: z.number(), severity: z.string(), zScore: z.number(), createdAt: z.string() });

export const anomalyCorrelationSchema = z.object({
  anomaly: correlatedAnomalySchema.extend({ resolved: z.boolean() }),
  group: z.object({
    anomalies: z.array(correlatedAnomalySchema),
    relatedCommands: z.array(z.object({ id: z.string(), nodeId: z.string(), command: z.string(), status: z.string(), createdAt: z.string() })),
  }),
  analysis: z.object({
    blastRadius: z.string(),
    suspectedTriggers: z.array(z.string()),
    recommendedActions: z.array(z.string()),
    summary: z.string(),
  }),
});

export const anomalyCorrelationResponseSchema = z.object({ success: z.literal(true), data: anomalyCorrelationSchema });

/** Only whether one exists is used, so everything else in a conversation is stripped. */
export const heartbeatConversationsResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({ conversations: z.array(z.object({ id: z.string() })) }),
});

export const remediationRuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  metric: z.string(),
  severityThreshold: z.string(),
  agentDefinitionId: z.string(),
  input: z.string(),
  cooldownMinutes: z.number(),
  maxConcurrentRuns: z.number(),
  nodeFilter: z.string().nullable(),
  enabled: z.boolean(),
  createdAt: z.string(),
  disposition: z.string().optional(),
  _count: z.object({ executions: z.number() }).optional(),
});

export const remediationRuleListResponseSchema = z.object({ data: z.array(remediationRuleSchema) });
export const remediationRuleResponseSchema = z.object({ data: remediationRuleSchema });
export const remediationDeleteResponseSchema = z.object({ success: z.literal(true) });

export const remediationExecutionSchema = z.object({
  id: z.string(),
  ruleId: z.string(),
  anomalyEventId: z.string(),
  nodeId: z.string(),
  orchestraRunId: z.string().nullable(),
  status: z.string(),
  input: z.string(),
  output: z.string().nullable(),
  triggeredAt: z.string(),
  rule: z.object({ name: z.string() }).optional(),
});

export const remediationExecutionListResponseSchema = z.object({
  data: z.object({ executions: z.array(remediationExecutionSchema), total: z.number() }),
});

export const remediationTriggerResponseSchema = z.object({
  data: z.object({ executionId: z.string(), status: z.string() }),
});

/** The server answers an approval with a refusal or a body of no fixed shape. */
export const remediationApproveResponseSchema = z.unknown();

export type AnomalyEvent = z.output<typeof anomalyEventSchema>;
export type AnomalySummary = z.output<typeof anomalySummarySchema>;
export type AnomalyCorrelation = z.output<typeof anomalyCorrelationSchema>;
export type RemediationRule = z.output<typeof remediationRuleSchema>;
export type RemediationExecution = z.output<typeof remediationExecutionSchema>;
