// GET /api/docs/openapi.json in Magnus (services/control-api/src/routes/docs.ts). Not part of the
// released browser contract, so only what this page reads is here. The path is outside /api/v1.
import { z } from 'zod';

export const openApiSpecSchema = z.object({
  info: z.object({ title: z.string().optional(), version: z.string().optional() }).optional(),
  paths: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
});
export type OpenApiSpec = z.output<typeof openApiSpecSchema>;

const operationSchema = z.object({
  summary: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

const METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);
export interface ApiOperation {
  key: string;
  method: string;
  path: string;
  summary?: string | undefined;
  description?: string | undefined;
  tags: string[];
}

/** Flat list of operations. A path item can hold other keys, such as parameters, which are not methods. */
export function operationsOf(spec: OpenApiSpec): ApiOperation[] {
  return Object.entries(spec.paths ?? {}).flatMap(([path, item]) =>
    Object.entries(item)
      .filter(([method]) => METHODS.has(method))
      .map(([method, value]) => {
        const parsed = operationSchema.safeParse(value);
        const operation = parsed.success ? parsed.data : {};
        return { key: `${method} ${path}`, method, path, summary: operation.summary, description: operation.description, tags: operation.tags ?? [] };
      }),
  );
}

/** Reads are quiet, writes stand out, and a delete is a warning. Color carries meaning, not category. */
export const methodTone = (method: string): 'danger' | 'neutral' | 'info' => (method === 'delete' ? 'danger' : method === 'get' ? 'neutral' : 'info');
