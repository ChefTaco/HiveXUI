// PROVISIONAL: replaced by the vendored Magnus browser contract's installation report schema.
import { z } from 'zod';

export const magnusInstallationSchema = z.object({
  schema: z.literal(1),
  magnus: z.object({
    version: z.string().max(64),
    node: z.string().max(32),
    layout: z.enum(['package', 'workspace']),
  }),
  resolution: z.object({
    reference: z.enum(['npm-shrinkwrap', 'none']),
    referenceSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
    checkedAt: z.iso.datetime(),
    checked: z.number().int().min(0),
    differences: z
      .array(z.object({ name: z.string().max(214), path: z.string().max(1024), expected: z.string().max(64), actual: z.string().max(64).nullable() }))
      .max(200),
    truncated: z.boolean(),
  }),
});
export type MagnusInstallation = z.infer<typeof magnusInstallationSchema>;
