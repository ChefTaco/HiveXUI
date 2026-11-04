import { z } from 'zod';
import { createBrowserAuth } from './browser-auth';
import {
  configureEndpoint,
  setAccessProvider,
  type Product,
} from './transport';

const product = z.enum([
  'emberpath',
  'oathweave',
  'hivemem',
  'hiveskills',
  'cindertrace',
  'chattermost',
]);
const prefix = z.string().regex(/^\/api\/[a-z][a-z0-9-]*$/);
export const runtimeSchema = z
  .object({
    schema: z.literal(1),
    products: z.partialRecord(product, prefix),
    links: z
      .object({
        magnus: z
          .url()
          .refine((value) => {
            const url = new URL(value);
            return (
              url.protocol === 'https:' &&
              !url.username &&
              !url.password &&
              !url.search &&
              !url.hash
            );
          })
          .optional(),
      })
      .strict()
      .optional(),
    identity: z
      .object({
        issuer: z.url().refine((value) => {
          const url = new URL(value);
          return (
            url.protocol === 'https:' &&
            !url.username &&
            !url.password &&
            !url.search &&
            !url.hash
          );
        }),
        apiPrefix: prefix,
        clients: z.partialRecord(
          product,
          z.string().regex(/^hivexui-[a-z0-9-]+$/),
        ),
      })
      .strict()
      .optional(),
  })
  .strict();
let identity: ReturnType<typeof createBrowserAuth> | undefined;
const enabled = new Set<Product>();
let magnusLink: string | undefined;
export const magnusConsoleUrl = () => magnusLink;
export const productEnabled = (product: Product) => enabled.has(product);
export const browserIdentity = () => identity;
export async function initializeRuntime(): Promise<void> {
  const response = await fetch('/runtime.json', {
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
  });
  if (response.status === 404) return; // Explicit legacy extraction mode.
  if (!response.ok)
    throw new Error('Console configuration could not be loaded');
  const config = runtimeSchema.parse(await response.json());
  magnusLink = config.links?.magnus;
  for (const [name, path] of Object.entries(config.products))
    if (path) {
      configureEndpoint(name as Product, path);
      enabled.add(name as Product);
    }
  if (config.identity) {
    identity = createBrowserAuth(config.identity);
    setAccessProvider(identity.ensure);
  }
}
