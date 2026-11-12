// UNTIL THE REGISTRY RELEASE SHIPS IT: the Hive Registry catalog entry's optional `capabilities`
// object, from the suite's unified-notifications spec. It extends the pinned contract here rather
// than in contracts/hive-registry, whose file is held to its recorded checksum; the Registry's own
// browser contract (version 2) carries the same shape and replaces this when it is vendored.
//
//   "capabilities": { "events.v1": { "path": "/api/v1/hive/events" } }
//
// Both the product and its connection carry it. `path` is relative to the connection's
// `browserPrefix`. The object is not strict, so keys this console does not know are dropped.
import { z } from 'zod';
import { registryConnectionSchema, registryProductListSchema, registryProductSchema } from '@contracts/hive-registry/browser';

// The contract's own same-origin path rule, which it does not export.
const localPath = registryConnectionSchema.shape.browserPrefix.unwrap();

export const registryCapabilitiesSchema = z.object({ 'events.v1': z.object({ path: localPath }).optional() }).optional();
export type RegistryCapabilities = NonNullable<z.infer<typeof registryCapabilitiesSchema>>;

export const registryProductWithCapabilitiesSchema = registryProductSchema.extend({ capabilities: registryCapabilitiesSchema });
export const registryProductListWithCapabilitiesSchema = registryProductListSchema.extend({ products: z.array(registryProductWithCapabilitiesSchema).max(512) });
export const registryConnectionWithCapabilitiesSchema = registryConnectionSchema.extend({ capabilities: registryCapabilitiesSchema });
