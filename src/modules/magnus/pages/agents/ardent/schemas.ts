// The Ardent routes have no released browser contract yet, so their shapes live here. Each one names
// its source in the Magnus repository, or in the Ardent repository (ChefTaco/Ardent) for the runtime's
// own API. A node's Ardent reports these, so they are read leniently.
import { z } from 'zod';

const ok = <T extends z.ZodType>(data: T) => z.object({ success: z.literal(true), data });

// packages/contracts/src/ardent.ts: the profile's HiveMem agent credential, which Magnus renews on a schedule.
const ardentHiveMemCredentialObjectSchema = z.object({
  agentId: z.string(),
  workspaceId: z.string(),
  expiresAt: z.string().nullable(),
  lastRenewedAt: z.string().nullable(),
  lastAttemptAt: z.string().nullable(),
  nextRenewalAt: z.string().nullable(),
  /** Consecutive failed renewals. */
  failures: z.number().int().min(0),
  lastError: z.string().nullable(),
  /** ok, renewal-failing or expired. Any other state reads as unknown. */
  state: z.string(),
});
export type ArdentHiveMemCredential = z.output<typeof ardentHiveMemCredentialObjectSchema>;
/**
 * null: Magnus manages no HiveMem credential for the profile. A shape this console cannot read is
 * `unreadable` rather than an error, so a newer Magnus never breaks the page.
 */
export const ardentHiveMemCredentialSchema = z.unknown().transform((value): ArdentHiveMemCredential | null | 'unreadable' => {
  if (value === null) return null;
  const parsed = ardentHiveMemCredentialObjectSchema.safeParse(value);
  return parsed.success ? parsed.data : 'unreadable';
});
export type ArdentHiveMemCredentialField = z.output<typeof ardentHiveMemCredentialSchema> | undefined;

// packages/contracts/src/ardent.ts
export const ardentProfileSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  backend: z.string().nullable(),
  apiPort: z.number().int().nullable(),
  running: z.boolean(),
  a2aEnabled: z.boolean(),
  channels: z.record(z.string(), z.boolean()),
  error: z.string().nullable(),
  /** Absent from a Magnus without credential renewal, which shows nothing about it. */
  hivemem: ardentHiveMemCredentialSchema.optional(),
});
export type ArdentProfileSummary = z.output<typeof ardentProfileSummarySchema>;

// packages/contracts/src/ardent.ts: a command owner holding the node's managed execution slot. While one
// is held no other Ardent action runs there; `unknown` means nobody knows what the command did.
export const ardentCommandOwnerSchema = z.object({
  commandId: z.string(),
  state: z.enum(['reserved', 'running', 'unknown']),
  label: z.string().nullable(),
  profile: z.string().nullable(),
  action: z.string().nullable(),
  /** An Ardent action, which `command-reconcile` can settle. */
  ardent: z.boolean(),
  acquiredAt: z.string(),
  dispatchedAt: z.string().nullable(),
  deadline: z.string(),
  /** When a reconciliation is first accepted. */
  reconcilableAfter: z.string(),
});
export type ArdentCommandOwner = z.output<typeof ardentCommandOwnerSchema>;

// packages/contracts/src/ardent.ts: the answer to the `command-reconcile` action.
export const ardentCommandReconcileResultSchema = z.object({
  commandId: z.string(),
  outcome: z.enum(['settled', 'already-settled']),
  receipt: z.enum(['completed', 'reconciled', 'unknown', 'absent']).nullable(),
  settlement: z.string().nullable(),
  evidenceSha256: z.string().nullable(),
  decisionId: z.string().nullable(),
});
export type ArdentCommandReconcileResult = z.output<typeof ardentCommandReconcileResultSchema>;

// packages/contracts/src/ardent.ts
export const ardentInstallationSchema = z.object({
  nodeId: z.string(),
  nodeName: z.string(),
  hostname: z.string(),
  reachable: z.boolean(),
  error: z.string().nullable(),
  installed: z.boolean(),
  version: z.string().nullable(),
  owner: z.string(),
  profiles: z.array(ardentProfileSummarySchema),
  checkedAt: z.string(),
  stagedPackage: z.object({ version: z.string(), sha256: z.string() }).nullable().optional(),
  stagedPackageError: z.string().nullable().optional(),
  /** Bridge features of the node agent. Absent on agents older than the Studio bridge. */
  capabilities: z.object({ studio: z.number().int().min(0).optional() }).optional(),
  /** Held command owners, oldest first. Absent from a Magnus without command reconciliation, which hides the feature. */
  commandOwners: z.array(ardentCommandOwnerSchema).optional(),
  /** Whether Magnus can sign a decision about an unknown outcome (COMMAND_RECONCILIATION_SECRET). */
  commandReconciliation: z.object({ configured: z.boolean() }).optional(),
});
export type ArdentInstallation = z.output<typeof ardentInstallationSchema>;

// services/control-api/src/routes/ardent.ts
export const ardentInstallationsResponseSchema = ok(z.array(ardentInstallationSchema));
export const ardentInstallationResponseSchema = ok(ardentInstallationSchema);
export const ardentProfilesResponseSchema = ok(z.array(ardentProfileSummarySchema.extend({
  nodeId: z.string(),
  nodeName: z.string(),
  hostname: z.string(),
  installationVersion: z.string().nullable(),
  reachable: z.boolean(),
})));

// ChefTaco/Ardent src/api.ts: every resource and action answers inside { success, data }.
export const revisionedTextSchema = z.object({ text: z.string(), revision: z.string() });
export type RevisionedText = z.output<typeof revisionedTextSchema>;
export const revisionSchema = z.object({ revision: z.string() });

export const taskSchema = z.object({
  id: z.string(),
  state: z.string(),
  prompt: z.string(),
  result: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
  backend: z.string().nullable().optional(),
  created_ms: z.number(),
});
export type ArdentTask = z.output<typeof taskSchema>;
export const taskListSchema = z.object({ tasks: z.array(taskSchema) });
export const taskEventSchema = z.object({ sequence: z.number(), kind: z.string(), detail: z.unknown(), created_ms: z.number() });
export type ArdentTaskEvent = z.output<typeof taskEventSchema>;
export const taskEventsSchema = z.object({ events: z.array(taskEventSchema) });
export const statusSchema = z.object({ backend: z.string().nullable().optional() });

/** Provider and channel status: named entries whose fields the page lists as they come. */
const entrySchema = z.record(z.string(), z.unknown());
export const providersSchema = z.object({ selected: z.string().nullable().optional(), llamacpp: entrySchema.optional(), codex: entrySchema.optional() });
export const channelsSchema = z.record(z.string(), entrySchema);
export const peersSchema = z.object({ peers: z.array(entrySchema) });
export const skillSchema = z.object({ name: z.string(), description: z.string().optional().default(''), hash: z.string().optional().default(''), enabled: z.boolean() });
export type ArdentSkill = z.output<typeof skillSchema>;
export const skillsSchema = z.object({ skills: z.array(skillSchema) });
/**
 * The skill-install answer (Magnus ardentSkillInstallResultSchema). changed is false when the same release was
 * installed already; a failed enable leaves the skill installed with enable_error saying why.
 */
export const skillInstallResultSchema = z.object({
  source: z.literal('hiveskills'), name: z.string(), version: z.string(), sha256: z.string(), files: z.number(),
  changed: z.boolean(), enabled: z.boolean(), revision: z.string().nullable(), enable_error: z.string().nullable(), activation_required: z.boolean(),
});
export type SkillInstallResult = z.output<typeof skillInstallResultSchema>;
/** The node agent level that installs catalog skills (Magnus ARDENT_STUDIO_CAPABILITY.skillInstall). */
export const SKILL_INSTALL_STUDIO_LEVEL = 3;
export const memoryStatusSchema = z.object({
  status: z.string(),
  agent_id: z.string(),
  workspace_id: z.string(),
  retrieval: z.string().nullable(),
  storage: z.string().nullable(),
  reason: z.string().nullable(),
});
export type MemoryStatus = z.output<typeof memoryStatusSchema>;
export const memoryResultsSchema = z.object({
  results: z.array(z.object({ id: z.string(), content: z.string(), created_at: z.string().optional(), source: z.string().optional() })),
});
export const identityHistorySchema = z.object({ history: z.array(z.object({ name: z.string(), revision: z.string() })) });
export const openApiSchema = z.object({
  openapi: z.string(),
  info: z.object({ title: z.string(), version: z.string() }),
  paths: z.record(z.string(), z.record(z.string(), z.unknown())),
});
export type OpenApiDocument = z.output<typeof openApiSchema>;
export const configValidationSchema = z.object({ valid: z.boolean(), runtime_problems: z.array(z.string()).optional() });
export const peerValidationSchema = z.object({ valid: z.boolean(), peers: z.number() });
export const taskAcceptedSchema = z.object({ task_id: z.string(), state: z.string() });
export const serviceStateSchema = z.object({ service: z.string(), running: z.boolean() });
export const packageInstalledSchema = z.object({ installed: z.boolean(), version: z.string(), changed: z.boolean().optional() });
/** An action whose answer the page reports but does not depend on. */
export const anyActionSchema = z.unknown();
