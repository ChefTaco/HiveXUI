import { z } from 'zod';
import { createBrowserAuth } from './browser-auth';
import { REGISTRY_PREFIX, registryAllows, startRegistry } from './registry';
import {
  configureEndpoint,
  requireConfiguredProducts,
  setAccessProvider,
  setStepUpProvider,
  setUnauthorizedHandler,
  type Product,
} from './transport';
import { setSessionChecker, verifySession } from './session-events';

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
  'hive-registry',
]);
const prefix = z.string().regex(/^\/api\/[a-z][a-z0-9-]*$/);
export const runtimeSchema = z
  .object({
    schema: z.literal(1),
    mode: z.enum(['suite', 'legacy', 'local']).default('suite'),
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
    if (config.mode === 'local' && (config.identity || Object.keys(config.products).join() !== 'cindertrace'))
      context.addIssue({
        code: 'custom',
        message: 'Local runtime configures only Cindertrace, without suite identity',
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
let identityConfig: { clients: Partial<Record<Product, string>> } | undefined;
let local = false;
let recoveryOffered = false;
let signInMissing = false;
/**
 * The runtime configures neither Oathweave browser sign-in nor Cindertrace's local sign-in (a
 * `legacy` runtime). HiveXUI no longer signs in with a password through a product, so it shows how
 * to configure Oathweave instead of a sign-in form.
 */
export const browserSignInMissing = () => signInMissing;
/**
 * The tab's choice of Cindertrace's own sign-in on a suite installation. It is a choice, not a
 * credential: the session itself is Cindertrace's HttpOnly cookie.
 */
const LOCAL_SIGN_IN_KEY = 'hivexui.sign-in';
function storedLocalChoice(): boolean {
  try {
    return sessionStorage.getItem(LOCAL_SIGN_IN_KEY) === 'cindertrace';
  } catch {
    return false;
  }
}
/**
 * Cindertrace's own sign-in instead of Oathweave: a local installation (the investigation lab or a
 * standalone Cindertrace), or recovery on a suite installation while Oathweave is unavailable.
 * Only Cindertrace's pages are offered, and Cindertrace checks every request itself.
 */
export const localSignIn = () => local;
/** Whether a suite sign-in screen may offer Cindertrace's recovery sign-in. */
export const localSignInOffered = () => recoveryOffered;
/** Switches this tab between Oathweave and Cindertrace's recovery sign-in, starting afresh. */
export function chooseLocalSignIn(on: boolean): void {
  try {
    if (on) sessionStorage.setItem(LOCAL_SIGN_IN_KEY, 'cindertrace');
    else sessionStorage.removeItem(LOCAL_SIGN_IN_KEY);
  } catch {
    // Without session storage the choice cannot outlive this page; the suite sign-in stays.
  }
  location.assign('/');
}
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
  local ? enabled.has(product) : !identity || productEnabled(product);
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
  const cindertrace = config.products.cindertrace;
  recoveryOffered = config.mode === 'suite' && !!cindertrace;
  if (config.mode === 'local' || (recoveryOffered && storedLocalChoice())) {
    local = true;
    configureEndpoint('cindertrace', cindertrace!);
    enabled.add('cindertrace');
    requireConfiguredProducts();
    return;
  }
  enrollmentInstallation = config.enrollmentInstallationId;
  for (const [name, path] of Object.entries(config.products))
    if (path) {
      configureEndpoint(name as Product, path);
      enabled.add(name as Product);
    }
  if (config.identity) {
    identityConfig = config.identity;
    identityClients = [...new Set(Object.values(config.identity.clients).filter((id): id is string => !!id))].sort();
    identity = createBrowserAuth(config.identity);
    setAccessProvider(identity.ensure);
    setStepUpProvider(identity.stepUp);
    // Any product's 401 asks Oathweave whether the session still exists; only its refusal signs out.
    setSessionChecker(identity.me);
    setUnauthorizedHandler(() => verifySession());
    // The authorization portal shows no sections and serves other applications' sign-ins.
    if (location.pathname !== '/auth/authorize') await startRegistry([...enabled]);
  } else signInMissing = true;
}

/** The Oathweave browser client of the Registry's inventory read; fresh setup and console-clients create it. */
export const REGISTRY_INVENTORY_CLIENT = 'hivexui-registry';
/**
 * Signs in to the Hive Registry, for its inventory read only, once the Registry announces it. The
 * client and prefix are fixed, so runtime.json need not name them. A no-op without suite sign-in.
 */
export function enableRegistryInventory(): boolean {
  if (local || !identityConfig) return false;
  identityConfig.clients['hive-registry'] ??= REGISTRY_INVENTORY_CLIENT;
  configureEndpoint('hive-registry', REGISTRY_PREFIX);
  enabled.add('hive-registry');
  identityClients = [...new Set([...identityClients, identityConfig.clients['hive-registry']])].sort();
  return true;
}
