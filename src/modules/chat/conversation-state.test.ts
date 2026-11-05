import { describe, expect, it } from "vitest";
import type { MattermostUser } from "../../../contracts/chattermost.generated";
import {
  LATEST_THRESHOLD_PX,
  botTargets,
  dismissOnboarding,
  distanceFromLatest,
  postedBy,
  postsOldestFirst,
  readSocketEvent,
  respondingLabel,
  settleIndicators,
  showsOnboarding,
  typingBot,
  webhookIdentity,
  withIndicator,
  withoutIndicator,
  type BotIndicator,
} from "./conversation-state";

const bot = (username: string) =>
  ({ id: username, username, nickname: "", is_bot: true }) as MattermostUser;
const indicator = (over: Partial<BotIndicator> = {}): BotIndicator => ({
  channelId: "c",
  userId: "b",
  name: "b",
  startedAt: 100,
  expiresAt: 1000,
  ...over,
});

describe("bot responding indicator", () => {
  it("replaces a bot's earlier indicator rather than stacking", () => {
    const list = withIndicator([indicator()], indicator({ expiresAt: 2000 }));
    expect(list).toHaveLength(1);
    expect(list[0]!.expiresAt).toBe(2000);
  });
  it("ends on expiry", () => {
    expect(settleIndicators([indicator()], [], 1000)).toEqual([]);
  });
  it("ends when that bot posts in that channel after it started", () => {
    const reply = { channel_id: "c", user_id: "b", create_at: 100 };
    expect(settleIndicators([indicator()], [reply], 500)).toEqual([]);
  });
  it("is not ended by older posts, other bots or other channels", () => {
    const list = [indicator()];
    expect(
      settleIndicators(
        list,
        [
          { channel_id: "c", user_id: "b", create_at: 99 },
          { channel_id: "c", user_id: "other", create_at: 200 },
          { channel_id: "elsewhere", user_id: "b", create_at: 200 },
        ],
        500,
      ),
    ).toBe(list);
  });
  it("removes one bot only", () => {
    const list = [indicator(), indicator({ userId: "x" })];
    expect(withoutIndicator(list, "c", "b").map((i) => i.userId)).toEqual(["x"]);
  });
  it("names one bot and counts several", () => {
    expect(respondingLabel(["Hermes"])).toBe("Hermes is responding");
    expect(respondingLabel(["a", "b"])).toBe("2 bots are responding");
  });
});

describe("botTargets", () => {
  const bots = [bot("hermes"), bot("scout")];
  it("wakes every bot in a direct or group conversation", () => {
    expect(botTargets("D", bots, "hi")).toEqual(bots);
    expect(botTargets("G", bots, "hi")).toEqual(bots);
  });
  it("wakes only exact mentions in a channel", () => {
    expect(botTargets("O", bots, "ask @Hermes")).toEqual([bots[0]]);
    expect(botTargets("O", bots, "ask @hermes2")).toEqual([]);
    expect(botTargets("O", bots, "no mention")).toEqual([]);
  });
  it("follows the server's addressing of slash commands", () => {
    expect(botTargets("O", [bots[0]!], "/status")).toEqual([bots[0]]);
    expect(botTargets("O", bots, "/status")).toEqual([]);
  });
});

describe("socket events", () => {
  it("rejects anything that is not an event object", () => {
    for (const raw of [1, "{oops", "null", '{"data":{}}', '{"event":1}'])
      expect(readSocketEvent(raw)).toBeNull();
  });
  it("reads a typing event", () => {
    const event = readSocketEvent(
      JSON.stringify({
        event: "typing",
        data: { channel_id: "c", user_id: "b", is_bot: true, sender_name: "h" },
      }),
    )!;
    expect(typingBot(event.data)).toEqual({
      channelId: "c",
      userId: "b",
      isBot: true,
      name: "h",
    });
  });
  it("reads the author of a posted event and tolerates a bad post", () => {
    expect(
      postedBy({ post: JSON.stringify({ channel_id: "c", user_id: "b" }) }),
    ).toEqual({ channelId: "c", userId: "b" });
    expect(postedBy({ post: "{oops" })).toBeNull();
    expect(postedBy({})).toBeNull();
  });
});

describe("webhookIdentity", () => {
  const users = [
    { id: "owner", username: "ops", nickname: "" },
    { id: "poster", username: "admin", nickname: "Admin" },
  ];
  it("ignores ordinary posts, even with a display override", () => {
    expect(
      webhookIdentity(
        { user_id: "poster", props: { override_username: "ceo" } },
        users,
      ),
    ).toBeNull();
    expect(
      webhookIdentity({ user_id: "poster", props: { from_webhook: true } }, users),
    ).toBeNull();
  });
  it("reports the override, label and owner", () => {
    expect(
      webhookIdentity(
        {
          user_id: "poster",
          props: {
            from_webhook: "true",
            override_username: " Deploy ",
            webhook_label: "CI",
          },
        },
        users,
      ),
    ).toEqual({ displayName: "Deploy", label: "CI", owner: "admin" });
  });
  it("names the authenticated author as owner, whatever the props claim", () => {
    expect(
      webhookIdentity(
        {
          user_id: "poster",
          props: {
            from_webhook: "true",
            webhook_owner_id: "owner",
            webhook_owner_username: "ops",
          },
        },
        users,
      )?.owner,
    ).toBe("admin");
  });
  it("falls back to the poster when details are absent", () => {
    expect(
      webhookIdentity({ user_id: "poster", props: { from_webhook: "true" } }, users),
    ).toEqual({ displayName: "Admin", label: "Incoming webhook", owner: "admin" });
  });
});

describe("onboarding", () => {
  const memory = () => {
    const values = new Map<string, string>();
    return () =>
      ({
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => void values.set(key, value),
      }) as unknown as Storage;
  };
  const now = 100 * 24 * 60 * 60 * 1000;
  it("greets a new account until it is dismissed", () => {
    const storage = memory();
    const user = { id: "u", create_at: now - 1000 };
    expect(showsOnboarding(user, now, storage)).toBe(true);
    dismissOnboarding(user, storage);
    expect(showsOnboarding(user, now, storage)).toBe(false);
    expect(showsOnboarding({ ...user, id: "other" }, now, storage)).toBe(true);
  });
  it("leaves established accounts alone", () => {
    expect(showsOnboarding({ id: "u", create_at: 0 }, now, memory())).toBe(false);
  });
  it("still works without storage", () => {
    const blocked = (): Storage => {
      throw new Error("denied");
    };
    const user = { id: "u", create_at: now };
    expect(showsOnboarding(user, now, blocked)).toBe(true);
    expect(() => dismissOnboarding(user, blocked)).not.toThrow();
  });
});

it("measures distance from the newest message", () => {
  const list = { scrollHeight: 1000, clientHeight: 400, scrollTop: 600 };
  expect(distanceFromLatest(list)).toBe(0);
  expect(
    distanceFromLatest({ ...list, scrollTop: 500 }) > LATEST_THRESHOLD_PX,
  ).toBe(true);
});

it("orders a conversation oldest first whichever way the API lists it", () => {
  const posts = {
    a: { id: "a", create_at: 1 },
    b: { id: "b", create_at: 2 },
    c: { id: "c", create_at: 3 },
  } as unknown as Parameters<typeof postsOldestFirst>[0]["posts"];
  const ids = (order: string[]) =>
    postsOldestFirst({ order, posts }).map((post) => post.id);
  expect(ids(["a", "b", "c"])).toEqual(["a", "b", "c"]);
  expect(ids(["c", "b", "a"])).toEqual(["a", "b", "c"]);
  expect(ids(["a", "missing"])).toEqual(["a"]);
});
