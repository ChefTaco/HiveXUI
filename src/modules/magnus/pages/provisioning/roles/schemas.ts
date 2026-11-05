// Role routes with no released contract yet: services/control-api/src/routes/roles.ts in Magnus.
import { roleApplicationSchema, roleSchema } from '@contracts/magnus/browser';
import { z } from 'zod';

const ok = <T extends z.ZodType>(data: T) => z.object({ success: z.literal(true), data });

// GET /roles/:roleId
export const roleDetailResponseSchema = ok(roleSchema.extend({
  nodes: z.array(z.object({ id: z.string(), name: z.string(), hostname: z.string(), status: z.string() })).optional(),
}));
export type RoleDetail = z.output<typeof roleDetailResponseSchema>['data'];

// POST and PATCH /roles answer without _count.
export const roleMutationResponseSchema = ok(roleSchema.omit({ _count: true }));
export const roleDeletedResponseSchema = ok(z.object({ deleted: z.literal(true) }));
export const roleApplyResponseSchema = ok(z.object({ applied: z.number(), applications: z.array(roleApplicationSchema) }));
