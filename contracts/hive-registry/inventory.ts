// PROVISIONAL: replaced by the Hive Registry's exported inventory contract before merge.
import { z } from 'zod';

const productId = z.string().regex(/^[a-z][a-z0-9-]{0,47}$/);
const version = z.string().regex(/^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const image = z.string().regex(/^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$/).max(512);
const hex64 = z.string().regex(/^[a-f0-9]{64}$/);
const host = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);

export const registryInventoryComponentSchema = z.object({
  id: productId,
  displayName: z.string().min(1).max(80),
  kind: z.string().max(32),
  status: z.string().max(32),
  pinned: z.object({ version, image, imageDigest: digest }).nullable(),
  inventoryHost: host.nullable(),
});

export const registryInventoryServiceSchema = z.object({
  service: productId,
  image: z.string().max(512),
  runningImage: z.string().max(512).nullable(),
  imageId: digest.nullable(),
  imageMatches: z.boolean(),
  state: z.string().max(32),
  health: z.string().max(32),
});

export const registryInventoryHostSchema = z.object({
  host,
  observedAt: z.iso.datetime(),
  receipt: z.object({ version, digest: hex64 }).nullable(),
  services: z.array(registryInventoryServiceSchema).max(128),
});

export const registryInventorySchema = z.object({
  schema: z.literal(1),
  installationId: z.string().max(64),
  release: z.object({ version, manifestDigest: hex64 }).nullable(),
  components: z.array(registryInventoryComponentSchema).max(128),
  hosts: z.array(registryInventoryHostSchema).max(64),
});

export type RegistryInventory = z.infer<typeof registryInventorySchema>;
export type RegistryInventoryComponent = z.infer<typeof registryInventoryComponentSchema>;
export type RegistryInventoryHost = z.infer<typeof registryInventoryHostSchema>;
export type RegistryInventoryService = z.infer<typeof registryInventoryServiceSchema>;
