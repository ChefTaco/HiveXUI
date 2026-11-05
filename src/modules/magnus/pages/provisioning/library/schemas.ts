// Library routes with no released contract yet: services/control-api/src/routes/library.ts in Magnus.
// The file list and file responses come from @contracts/magnus/browser.
import { z } from 'zod';

const ok = <T extends z.ZodType>(data: T) => z.object({ success: z.literal(true), data });

export const libraryCategorySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  color: z.string(),
  sortOrder: z.number(),
  /** On the list only. */
  fileCount: z.number().optional(),
});
export type LibraryCategory = z.output<typeof libraryCategorySchema>;

export const categoryListResponseSchema = ok(z.array(libraryCategorySchema));
export const categoryResponseSchema = ok(libraryCategorySchema);
export const libraryDeletedResponseSchema = ok(z.object({ deleted: z.literal(true) }));
export const libraryMovedResponseSchema = ok(z.object({ moved: z.number() }));

export const deployResultSchema = z.object({ nodeId: z.string(), nodeName: z.string(), status: z.string(), error: z.string().optional() });
export type DeployResult = z.output<typeof deployResultSchema>;
export const libraryDeployResponseSchema = ok(z.array(deployResultSchema));
