import { z } from 'zod';
import { createBrowserAuth } from './browser-auth';
import { registryAllows, startRegistry } from './registry';
import {
  configureEndpoint,
  setAccessProvider,
  setStepUpProvider,
  type Product,
} from './transport';

const product = z.enum([
  'emberpath',
  'oathweave',
  'hivemem',
  'hiveskills',
  'cindertrace',
  'chattermost',
  'magnus',
  'ardentstudio',
  'embermend',
]);
const prefix = z.string().regex(/^\/api\/[a-z][a-z0-9-]*$/);
export const runtimeSchema = z
  .object({
    schema: z.literal(1),
    mode: z.enum(['suite', 'legacy']).default('suite'),
    products: z.partialRecord(product, prefix),
    enrollmentInstallationId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/).optional(),
    // Accepted and ignored for one release: Magnus now lives at /fleet, and older controllers
    // still write this key into a strict schema. Remove with the next runtime schema.
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
  .strict()
  .superRefine((config, context) => {
    if (config.mode === 'suite' && !config.identity)
      context.addIssue({
        code: 'custom',
        message: 'Suite runtime requires Oathweave sign-in',
      });
    if (config.mode === 'legacy' && config.identity)
      context.addIssue({
        code: 'custom',
        message: 'Legacy runtime cannot configure suite identity',
      });
    if (config.identity)
      for (const name of Object.keys(config.products) as Product[])
        if (!config.identity.clients[name])
          context.addIssue({
            code: 'custom',
            message: 'A public client is required for each configured product',
          });
  });
let identity: ReturnType<typeof createBrowserAuth> | undefined;
const enabled = new Set<Product>();
let enrollmentInstallation: string | undefined;
let identityClients: readonly string[] = [];
/** The Oathweave public clients HiveXUI signs in with, one per configured product. Empty without suite sign-in. */
export const browserClientIds = (): readonly string[] => identityClients;
export const enrollmentInstallationId = () => enrollmentInstallation;
export function selectEnrollmentInstallation(value: string): void {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(value)) throw new Error('Select an explicit installation identifier');
  enrollmentInstallation = value;
}
/** A console product must be both configured in runtime.json and, when known, installed. */
export const productEnabled = (product: Product) => enabled.has(product) && registryAllows(product);
export const browserIdentity = () => identity;
/**
 * Whether the console should present a product. Legacy standalone recovery has no suite
 * identity and talks to the retained native console API, so its surface stays unfiltered.
 */
export const productInstalled = (product: Product) =>
  !identity || productEnabled(product);
/**
 * Whether the console can show a Registry entry. One of its own products must be installed by the
 * rule above; the rest (the ingress, the Registry itself, external products) have no section.
 */
export const registryEntryPresented = (id: string) => {
  const known = product.safeParse(id);
  return !known.success || productInstalled(known.data);
};
export async function initializeRuntime(): Promise<void> {
  const response = await fetch('/runtime.json', {
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
  });
  if (response.status === 404)
    throw new Error('A public runtime configuration is required');
  if (!response.ok)
    throw new Error('Console configuration could not be loaded');
  const config = runtimeSchema.parse(await response.json());
  enrollmentInstallation = config.enrollmentInstallationId;
  for (const [name, path] of Object.entries(config.products))
    if (path) {
      configureEndpoint(name as Product, path);
      enabled.add(name as Product);
    }
  if (config.identity) {
    identityClients = [...new Set(Object.values(config.identity.clients).filter((id): id is string => !!id))].sort();
    identity = createBrowserAuth(config.identity);
    setAccessProvider(identity.ensure);
    setStepUpProvider(identity.stepUp);
    // The authorization portal shows no sections and serves other applications' sign-ins.
    if (location.pathname !== '/auth/authorize') await startRegistry([...enabled]);
  }
}
