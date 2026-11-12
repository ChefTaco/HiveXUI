import { z } from "zod";
import { apiFetch } from "../../lib/transport";
import { hiveApiError } from "../../lib/api-error";
import {
  chatBotOperationSchema,
  chatBotMutationSchema,
  chatAdminCapabilitiesSchema,
  chatInviteSchema,
  chatInviteCreatedSchema,
  chatBotSchema,
  chatHermesHealthSchema,
  chatSupervisionPolicySchema,
  chatSupervisionEventSchema,
  chatAgentSchema,
  chatSimulationSchema,
  chatConfigurationSchema,
  chatCleanupSchema,
  chatCustomEmojiSchema,
  chatAdminUserSchema,
} from "../../../contracts/chattermost-admin.generated";
export async function chatAdmin<T>(
  path: string,
  schema: z.ZodType<T>,
  body?: object,
  method = "GET",
  headers: Record<string, string> = {},
): Promise<T> {
  const response = await apiFetch("/api/chat" + path, {
    method,
    cache: "no-store",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok)
    throw await hiveApiError(response, { fallback: "Chat administration is unavailable" });
  const value: unknown = await response.json().catch(() => null);
  return schema.parse(value);
}
const success = z.object({ status: z.literal("OK") });
const safeId = encodeURIComponent;
export const adminAPI = {
  users: () => chatAdmin("/admin/users", z.array(chatAdminUserSchema)),
  createUser: (body: object) =>
    chatAdmin("/admin/users", chatAdminUserSchema, body, "POST"),
  updateUser: (id: string, body: object) =>
    chatAdmin(
      "/api/v4/users/" + safeId(id) + "/patch",
      chatAdminUserSchema,
      body,
      "PUT",
    ),
  userState: (id: string, active: boolean) =>
    chatAdmin(
      "/admin/users/" + safeId(id) + (active ? "/reactivate" : "/deactivate"),
      chatAdminUserSchema,
      undefined,
      "POST",
    ),
  resetPassword: (id: string, password: string) =>
    chatAdmin(
      "/admin/users/" + safeId(id) + "/reset-password",
      success,
      { new_password: password },
      "POST",
    ),
  revokeSessions: (id: string) =>
    chatAdmin(
      "/admin/users/" + safeId(id) + "/revoke-sessions",
      success,
      undefined,
      "POST",
    ),
  moderate: (id: string, decision: "approved" | "rejected") =>
    chatAdmin(
      "/admin/supervision/posts/" + safeId(id) + "/" + decision,
      z.object({ id: z.string() }),
      undefined,
      "POST",
    ),
  capabilities: () =>
    chatAdmin("/admin/browser-capabilities", chatAdminCapabilitiesSchema),
  invites: () => chatAdmin("/admin/invites", z.array(chatInviteSchema)),
  createInvite: (body: object) =>
    chatAdmin("/admin/invites", chatInviteCreatedSchema, body, "POST"),
  revokeInvite: (id: string) =>
    chatAdmin(
      "/admin/invites/" + safeId(id),
      chatInviteSchema,
      undefined,
      "DELETE",
    ),
  bots: () => chatAdmin("/admin/bots", z.array(chatBotSchema)),
  botOperation: (id: string) =>
    chatAdmin("/admin/bot-operations/" + safeId(id), chatBotOperationSchema),
  provisionBot: (body: object) =>
    chatAdmin("/admin/bots", chatBotMutationSchema, body, "POST"),
  updateBot: (id: string, body: object) =>
    chatAdmin("/admin/bots/" + safeId(id), chatBotMutationSchema, body, "PUT"),
  rotateBot: (id: string, operation: string) =>
    chatAdmin(
      "/admin/bots/" + safeId(id) + "/regenerate-token",
      chatBotMutationSchema,
      undefined,
      "POST",
      { "X-Bot-Operation-ID": operation },
    ),
  health: () => chatAdmin("/admin/hermes/health", chatHermesHealthSchema),
  configuration: () => chatAdmin("/api/v4/config", chatConfigurationSchema),
  privacy: (body: object) =>
    chatAdmin(
      "/api/v4/config/patch",
      chatConfigurationSchema,
      { PrivacySettings: body },
      "PUT",
    ),
  emoji: () => chatAdmin("/api/v4/emoji", z.array(chatCustomEmojiSchema)),
  addEmoji: (body: object) =>
    chatAdmin("/admin/custom-emoji", chatCustomEmojiSchema, body, "POST"),
  removeEmoji: (id: string) =>
    chatAdmin(
      "/admin/custom-emoji/" + safeId(id),
      chatCustomEmojiSchema,
      undefined,
      "DELETE",
    ),
  supervision: () =>
    chatAdmin("/admin/supervision/policy", chatSupervisionPolicySchema),
  supervisionEvents: () =>
    chatAdmin("/admin/supervision/events", z.array(chatSupervisionEventSchema)),
  updateSupervision: (body: object) =>
    chatAdmin(
      "/admin/supervision/policy",
      chatSupervisionPolicySchema,
      body,
      "PUT",
    ),
  agents: () => chatAdmin("/api/v4/agents", z.array(chatAgentSchema)),
  saveAgent: (body: object) =>
    chatAdmin("/api/v4/agents", chatAgentSchema, body, "POST"),
  simulate: (body: object) =>
    chatAdmin(
      "/api/v4/admin/policy-simulator",
      chatSimulationSchema,
      body,
      "POST",
    ),
  cleanup: (body: object) =>
    chatAdmin("/admin/test-artifacts/cleanup", chatCleanupSchema, body, "POST"),
};
export type PendingBotOperation = {
  id: string;
  action: "provision" | "identity" | "rotate";
  target: string;
  inputSHA256: string;
  status: "pending" | "unknown" | "committed";
};
const pendingSchema = z.object({
  id: z.string().regex(/^[a-z0-9]{26}$/),
  action: z.enum(["provision", "identity", "rotate"]),
  target: z.string(),
  inputSHA256: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(["pending", "unknown", "committed"]),
});
export function loadBotOperation(
  owner: string,
  storage: Pick<Storage, "getItem"> = sessionStorage,
): PendingBotOperation | null {
  const raw = storage.getItem("chattermost-bot-operation:" + owner);
  if (!raw) return null;
  return pendingSchema.parse(JSON.parse(raw));
}
export function saveBotOperation(
  owner: string,
  operation: PendingBotOperation | null,
  storage: Pick<Storage, "setItem" | "removeItem"> = sessionStorage,
): void {
  const key = "chattermost-bot-operation:" + owner;
  if (operation)
    storage.setItem(key, JSON.stringify(pendingSchema.parse(operation)));
  else storage.removeItem(key);
}
export async function createBotOperation(
  action: PendingBotOperation["action"],
  target: string,
  inputs: object,
): Promise<PendingBotOperation> {
  const id = Array.from(crypto.getRandomValues(new Uint8Array(13)), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(inputs)),
  );
  return {
    id,
    action,
    target,
    inputSHA256: Array.from(new Uint8Array(digest), (value) =>
      value.toString(16).padStart(2, "0"),
    ).join(""),
    status: "pending",
  };
}
