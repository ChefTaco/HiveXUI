import { z } from 'zod';
export { MemorySourceSchema, MemoryWriteSchema, type MemoryWrite } from './hivemem.generated';
export const OperationEvidenceSchema = z.object({
  service: z.string(), action: z.string(), status: z.number().int(), ok: z.boolean(),
  resourceId: z.string().optional(), errorCode: z.string().optional(),
}).strict();
