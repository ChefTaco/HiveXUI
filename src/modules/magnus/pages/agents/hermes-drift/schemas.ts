// services/control-api/src/services/ops-service.ts getHermesEffectiveState. No released contract yet.
import { z } from 'zod';

export const hermesEffectiveStateResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    generatedAt: z.string(),
    installations: z.array(z.object({
      id: z.string(),
      hostname: z.string(),
      status: z.string(),
      profiles: z.number(),
      desiredSkills: z.number(),
      effectiveEnabledSkills: z.number(),
      driftedSkills: z.array(z.object({ slug: z.string(), status: z.string(), error: z.string().nullable().optional() })),
      followOn: z.string(),
    })),
  }),
});
