import { afterEach, expect, it, vi } from "vitest";
import { memoryOperations as api } from "./memory-operations-api";
import { clearAccess, configureEndpoint, rememberAccess } from "./transport";
afterEach(() => {
  clearAccess();
  vi.unstubAllGlobals();
});
function setup(result: unknown) {
  configureEndpoint("hivemem", "/api/hivemem");
  rememberAccess("hivemem", "obviously-fake-memory-token", Date.now() + 60000);
  const send = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => Response.json(result));
  vi.stubGlobal("fetch", send);
  return send;
}
it("rejects malformed product data and strips unknown signing-secret fields from validated endpoints", async () => {
  const send = setup([{ session_id: "incomplete-fixture" }]);
  await expect(api.sessions("default")).rejects.toThrow();
  send.mockImplementation(async () =>
    Response.json({
      id: "synthetic-hook",
      owner_agent_id: "synthetic-owner",
      workspace_id: "default",
      url: "https://hooks.example.com/memory",
      event_types: ["memory.created"],
      enabled: true,
      headers: {},
      metadata: {},
      has_secret: true,
      last_status: null,
      last_error: null,
      last_delivered_at: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      deleted_at: null,
      signing_secret: "obviously-fake-server-secret",
    }),
  );
  expect(await api.webhook("synthetic-hook")).not.toHaveProperty(
    "signing_secret",
  );
});
it("keeps consolidation request identity and resource authorization across explicit retries", async () => {
  const send = setup({ job_id: "synthetic-job", status: "pending" });
  const body = {
    workspace_id: "team",
    memory_ids: ["synthetic-memory"],
    strategy: "compatibility",
    operation_id: "synthetic-operation",
  };
  await api.consolidate(body);
  await api.consolidate(body);
  expect(send).toHaveBeenCalledTimes(2);
  for (const [path, init] of send.mock.calls) {
    expect(path).toBe("/api/hivemem/memories/consolidate");
    expect(JSON.parse(String(init?.body))).toEqual(body);
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      "Bearer obviously-fake-memory-token",
    );
  }
  await expect(
    api.resolveConflict("invalid/id", "acknowledge"),
  ).rejects.toThrow("Invalid API path");
  expect(send).toHaveBeenCalledTimes(2);
});
it("archives a session using its empty native response and validates webhook test input before dispatch", async () => {
  const send = setup({});
  send.mockImplementation(async () => new Response(null, { status: 204 }));
  await expect(api.deleteSession("synthetic-session")).resolves.toBeUndefined();
  expect(send.mock.lastCall?.[1]?.method).toBe("DELETE");
  await expect(
    api.testWebhook({
      workspace_id: "default",
      event_type: "webhook.test",
      data: [],
    } as unknown as Parameters<typeof api.testWebhook>[0]),
  ).rejects.toThrow();
  expect(send).toHaveBeenCalledTimes(1);
});
it("preserves owned URL and array limits in generated browser request validators", async () => {
  const send = setup({});
  await expect(api.createWebhook({
    workspace_id: "default", url: "invalid-url", event_types: ["memory.created"],
    enabled: true, headers: {}, metadata: {},
  })).rejects.toThrow();
  expect(() => api.consolidate({
    workspace_id: "default", memory_ids: Array.from({ length: 257 }, (_, index) => `synthetic-${index}`),
    strategy: "compatibility", operation_id: "synthetic-operation",
  })).toThrow();
  expect(send).not.toHaveBeenCalled();
});
