import { afterEach, expect, it, vi } from "vitest";
import {
  adminAPI,
  createBotOperation,
  loadBotOperation,
  saveBotOperation,
} from "./admin-api";
import {
  clearAccess,
  configureEndpoint,
  rememberAccess,
} from "../../lib/transport";
afterEach(() => {
  clearAccess();
  vi.unstubAllGlobals();
});
function setup(result: unknown) {
  configureEndpoint("chattermost", "/api/chat");
  rememberAccess(
    "chattermost",
    "obviously-fake-chat-access",
    Date.now() + 60000,
  );
  const send = vi
    .fn<typeof fetch>()
    .mockImplementation(async (path) =>
      String(path).endsWith("/auth/oathweave/session")
        ? Response.json({ expires_at: Date.now() + 60000 })
        : Response.json(result),
    );
  vi.stubGlobal("fetch", send);
  return send;
}
it("scopes credential mutations to cookie-authenticated product APIs with a stable caller ID and explicit create-only policy", async () => {
  const id = "a".repeat(26),
    send = setup({
      operation_id: id,
      token: "obviously-fake-new-token",
      bot: {
        id: "synthetic-bot",
        user_id: "synthetic-bot-user",
        display_name: "Synthetic Bot",
        update_at: 1,
      },
    });
  await adminAPI.provisionBot({
    username: "syntheticbot",
    display_name: "Synthetic Bot",
    operation_id: id,
    create_only: true,
  });
  await adminAPI.rotateBot("synthetic-bot-user", id);
  const provision = send.mock.calls.find(
    ([path]) => path === "/api/chat/admin/bots",
  )!;
  expect(JSON.parse(String(provision[1]?.body))).toMatchObject({
    operation_id: id,
    create_only: true,
  });
  const [path, request] = send.mock.lastCall!;
  expect(path).toBe("/api/chat/admin/bots/synthetic-bot-user/regenerate-token");
  expect(new Headers(request?.headers).get("X-Bot-Operation-ID")).toBe(id);
  expect(new Headers(request?.headers).has("Authorization")).toBe(false);
  expect(request?.credentials).toBe("include");
  expect(String(path)).not.toContain("?");
  expect(String(path)).not.toContain("obviously-fake");
});
it("keeps unknown outcomes across reloads using only non-secret operation metadata and never dispatches reconciliation writes", async () => {
  const values = new Map<string, string>(),
    storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    };
  const operation = await createBotOperation("rotate", "synthetic-bot-user", {
    username: "synthetic",
  });
  saveBotOperation(
    "synthetic-admin",
    { ...operation, status: "unknown" },
    storage,
  );
  expect(loadBotOperation("synthetic-admin", storage)).toEqual({
    ...operation,
    status: "unknown",
  });
  expect(loadBotOperation("another-admin", storage)).toBeNull();
  const stored = JSON.parse(values.values().next().value!) as Record<
    string,
    unknown
  >;
  expect(Object.keys(stored).sort()).toEqual([
    "action",
    "id",
    "inputSHA256",
    "status",
    "target",
  ]);
  const send = setup({
    operation_id: operation.id,
    status: "accepted",
    action: "bot.token_regenerated",
    target_id: operation.target,
    create_at: 1,
    published_at: 0,
    token: "obviously-fake-server-secret",
  });
  expect(await adminAPI.botOperation(operation.id)).not.toHaveProperty("token");
  expect(send.mock.lastCall?.[1]?.method).toBe("GET");
  saveBotOperation("synthetic-admin", null, storage);
  expect(values.size).toBe(0);
});
it("fails closed on invalid response contracts and unavailable receipt storage", async () => {
  const send = setup({ id: "incomplete-user" });
  await expect(adminAPI.users()).rejects.toThrow();
  send.mockImplementation(async () =>
    Response.json(
      { message: "Administrator permission required" },
      { status: 403 },
    ),
  );
  await expect(adminAPI.capabilities()).rejects.toThrow(
    "Administrator permission required",
  );
  const operation = await createBotOperation("rotate", "synthetic-bot", {});
  expect(() =>
    saveBotOperation("synthetic-admin", operation, {
      setItem: () => {
        throw Error("storage unavailable");
      },
      removeItem: () => {},
    }),
  ).toThrow("storage unavailable");
});
