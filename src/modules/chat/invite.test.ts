import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearAccess,
  configureEndpoint,
  setAccessProvider,
} from "../../lib/transport";
import { inviteLink, readInviteCode, redeemInvite } from "./invite";

const valid = {
  invite_code: "code",
  username: "new.person",
  email: "person@example.com",
  password: "long-enough-password",
};
const user = {
  id: "u",
  create_at: 1,
  update_at: 1,
  delete_at: 0,
  username: "new.person",
  auth_data: "",
  auth_service: "",
  email: "person@example.com",
  nickname: "",
  first_name: "",
  last_name: "",
  position: "",
  roles: "system_user",
  locale: "en",
  timezone: {},
  notify_props: {},
  last_picture_update: 0,
  is_bot: false,
  bot_description: "",
};
const replying = (status: number, body: unknown) =>
  vi.fn(async () => Response.json(body, { status }));

describe("redeemInvite", () => {
  beforeEach(() => {
    clearAccess();
    configureEndpoint("chattermost", "/api/chattermost");
  });
  it("posts anonymously to the public signup route", async () => {
    const request = replying(201, user);
    const provider = vi.fn(async () => undefined);
    setAccessProvider(provider);
    await expect(redeemInvite(valid, request)).resolves.toMatchObject({
      username: "new.person",
    });
    expect(provider).not.toHaveBeenCalled();
    const [url, init] = request.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/chattermost/api/v4/users");
    expect(init.credentials).toBe("omit");
    expect(new Headers(init.headers).has("Authorization")).toBe(false);
    expect(JSON.parse(init.body as string)).toEqual(valid);
  });
  it("shows the service's reason for a refused invite", async () => {
    const request = replying(400, {
      message: "Invite code is invalid or expired",
    });
    await expect(redeemInvite(valid, request)).rejects.toThrow(
      "Invite code is invalid or expired",
    );
  });
  it.each([
    ["username", "Upper"],
    ["username", "a"],
    ["email", "nope"],
    ["password", "short"],
    ["invite_code", " "],
  ])("refuses an invalid %s without calling the service", async (field, value) => {
    const request = replying(201, user);
    await expect(
      redeemInvite({ ...valid, [field]: value }, request),
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
  it("does not report success for an unexpected response", async () => {
    await expect(
      redeemInvite(valid, replying(201, { id: "u" })),
    ).rejects.toThrow(/unexpected response/);
  });
});

describe("invite links", () => {
  it("carries the code in the fragment, so requests never include it", () => {
    const link = new URL(inviteLink("https://console.example.com", "a+b/c"));
    expect(link.pathname).toBe("/signup");
    expect(link.search).toBe("");
    expect(readInviteCode(link)).toBe("a+b/c");
  });
  it("also reads the native query form", () => {
    expect(readInviteCode({ search: "?invite=abc", hash: "" })).toBe("abc");
    expect(readInviteCode({ search: "", hash: "" })).toBe("");
  });
});
