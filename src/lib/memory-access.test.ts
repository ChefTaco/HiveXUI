import { expect, it } from "vitest";
import { memoryCan, workspaceCan } from "./memory-access";
import {
  WorkspaceSchema,
  type MemoryProfile,
} from "../../contracts/hivemem.generated";

const profile: MemoryProfile = {
  agent_id: "synthetic-owner",
  display_name: "Synthetic operator",
  role: "agent",
  scopes: ["memories:write", "workspaces:write"],
  workspace_ids: null,
};
const workspace = WorkspaceSchema.parse({
  workspace_id: "synthetic-team",
  owner_agent_id: "synthetic-owner",
  title: null,
  description: null,
  metadata: {},
  policy: {
    retention_days: null,
    allowed_scopes: [],
    reasoning_provider: null,
    consolidation_cadence_seconds: null,
    webhooks_enabled: true,
    sanitization: {
      mode: null,
      detect_pii: null,
      detect_secrets: null,
      deny_regexes: [],
    },
    agent_overrides: {},
    session_overrides: {},
  },
  members: [],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  deleted_at: null,
});
it("uses resource scopes independently for memory mutations, queue administration and workspace ownership", () => {
  expect(memoryCan(profile, "memories:write")).toBe(true);
  expect(memoryCan(profile, "admin:queue")).toBe(false);
  expect(workspaceCan(profile, workspace, "owner")).toBe(true);
  expect(
    workspaceCan(
      { ...profile, scopes: ["memories:write"] },
      workspace,
      "owner",
    ),
  ).toBe(false);
  expect(
    workspaceCan(
      { ...profile, scopes: ["admin:all"], workspace_ids: ["another-team"] },
      workspace,
      "owner",
    ),
  ).toBe(false);
  const member = {
    agent_id: "synthetic-member",
    role: "admin" as const,
    scopes: [],
    added_by: null,
    created_at: null,
    updated_at: null,
  };
  expect(
    workspaceCan(
      { ...profile, agent_id: member.agent_id },
      { ...workspace, members: [member] },
      "admin",
    ),
  ).toBe(true);
  expect(
    workspaceCan(
      { ...profile, agent_id: member.agent_id },
      { ...workspace, members: [member] },
      "owner",
    ),
  ).toBe(false);
});

it("does not display native administrator actions for a general wildcard agent token", () => {
  expect(memoryCan({ ...profile, scopes: ["*"] }, "memories:read")).toBe(true);
  expect(memoryCan({ ...profile, scopes: ["*"] }, "admin:queue")).toBe(false);
  expect(memoryCan({ ...profile, scopes: ["admin:*"] }, "admin:queue")).toBe(
    false,
  );
  expect(
    memoryCan({ ...profile, scopes: ["admin:queue"] }, "admin:queue"),
  ).toBe(true);
});
