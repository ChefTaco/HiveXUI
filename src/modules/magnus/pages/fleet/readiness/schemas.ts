// GET /ops/retention has no entry in the browser contract yet. Shape from
// services/control-api/src/services/ops-service.ts, getRetentionSummary.
import { z } from 'zod';

export const retentionTableSchema = z.object({
  name: z.string(),
  count: z.number(),
  oldestAt: z.string().nullable(),
  policy: z.string(),
  cutoffs: z.record(z.string(), z.string()).optional(),
});

export const retentionResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    generatedAt: z.string(),
    policyStatus: z.object({ status: z.string(), message: z.string() }).optional(),
    tables: z.array(retentionTableSchema),
  }),
});

export type RetentionTable = z.output<typeof retentionTableSchema>;
