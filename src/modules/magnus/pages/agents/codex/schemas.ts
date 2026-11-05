// The Codex routes have no released browser contract yet. Shapes from
// services/control-api/src/services/codex-service.ts and apps/dashboard/src/types/codex.ts in Magnus.
import { z } from 'zod';

const ok = <T extends z.ZodType>(data: T) => z.object({ success: z.literal(true), data });

export const codexInstallationSchema = z.object({
  nodeId: z.string(),
  nodeName: z.string(),
  hostname: z.string(),
  nodeStatus: z.string(),
  lastHeartbeatAt: z.string().nullable(),
  reachable: z.boolean(),
  installed: z.boolean(),
  user: z.string(),
  version: z.string().nullable(),
  latestVersion: z.string().nullable(),
  updateAvailable: z.boolean(),
  provenance: z.string(),
  updateSupported: z.boolean(),
  auth: z.object({
    status: z.string(),
    mode: z.string().nullable(),
    oauth: z.boolean(),
    tokenExpiresAt: z.string().nullable(),
    tokenExpired: z.boolean().nullable(),
    refreshTokenPresent: z.boolean(),
    lastRefreshAt: z.string().nullable(),
    planType: z.string().nullable(),
    autoLoggedOut: z.boolean(),
    message: z.string(),
  }),
  checkedAt: z.string(),
  error: z.string().nullable(),
});
export type CodexInstallation = z.output<typeof codexInstallationSchema>;

export const codexDeviceSessionSchema = z.object({
  id: z.string(),
  status: z.string(),
  verificationUrl: z.string(),
  userCode: z.string(),
  createdAt: z.string(),
  expiresAt: z.string(),
  completedAt: z.string().nullable(),
  error: z.string().nullable(),
});
export type CodexDeviceSession = z.output<typeof codexDeviceSessionSchema>;

// services/control-api/src/routes/codex.ts
export const codexInstallationsResponseSchema = ok(z.array(codexInstallationSchema));
export const codexInstallationResponseSchema = ok(codexInstallationSchema);
export const codexDeviceSessionResponseSchema = ok(codexDeviceSessionSchema);
