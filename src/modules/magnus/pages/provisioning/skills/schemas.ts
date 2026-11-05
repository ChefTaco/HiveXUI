// POST /scan/skills has no released contract yet: services/control-api/src/routes/scan.ts and
// services/control-api/src/types/library.ts in Magnus. A node's agent reports the skills, so everything
// but the name is optional here, and `files` arrives as names or as { name, content } objects.
import { z } from 'zod';

const skillFile = z.union([z.string(), z.object({ name: z.string(), content: z.string().optional() })]);

export const discoveredSkillSchema = z.object({
  name: z.string(),
  version: z.string().optional(),
  description: z.string().optional(),
  author: z.string().optional(),
  entryPoint: z.string().optional(),
  dependencies: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  files: z.array(skillFile).optional(),
});

export const skillScanResponseSchema = z.object({
  success: z.literal(true),
  data: z.array(z.object({
    nodeId: z.string(),
    nodeName: z.string(),
    status: z.string(),
    skills: z.array(discoveredSkillSchema),
    error: z.string().optional(),
  })),
});
export type SkillScanResult = z.output<typeof skillScanResponseSchema>['data'][number];
