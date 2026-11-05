import type {
  MattermostPost,
  MattermostPostList,
  MattermostUser,
} from "../../../contracts/chattermost.generated";

export const TYPING_WINDOW_MS = 6500;
export const REPLY_WINDOW_MS = 45000;
export type BotIndicator = {
  channelId: string;
  userId: string;
  name: string;
  startedAt: number;
  expiresAt: number;
};
const sameBot = (a: BotIndicator, channelId: string, userId: string) =>
  a.channelId === channelId && a.userId === userId;
export const botName = (user: MattermostUser) =>
  user.nickname || user.username;

export function withIndicator(list: BotIndicator[], next: BotIndicator) {
  return [
    ...list.filter((item) => !sameBot(item, next.channelId, next.userId)),
    next,
  ];
}
export const withoutIndicator = (
  list: BotIndicator[],
  channelId: string,
  userId: string,
) => list.filter((item) => !sameBot(item, channelId, userId));
/** An indicator ends when it expires or once that bot has posted since it started. */
export function settleIndicators(
  list: BotIndicator[],
  posts: Pick<MattermostPost, "channel_id" | "user_id" | "create_at">[],
  now: number,
) {
  const remaining = list.filter(
    (item) =>
      item.expiresAt > now &&
      !posts.some(
        (post) =>
          post.channel_id === item.channelId &&
          post.user_id === item.userId &&
          post.create_at >= item.startedAt,
      ),
  );
  return remaining.length === list.length ? list : remaining;
}
export const respondingLabel = (names: string[]) =>
  names.length === 1
    ? names[0] + " is responding"
    : names.length + " bots are responding";

/** Which bots a sent message will wake: everyone in a DM or group, otherwise those mentioned. */
export function botTargets(
  channelType: string,
  bots: MattermostUser[],
  message: string,
) {
  if (channelType === "D" || channelType === "G") return bots;
  // The server addresses a slash command to the only bot present without a mention.
  if (message.startsWith("/") && bots.length === 1) return bots;
  const mentions = new Set(
    (message.toLowerCase().match(/@[a-z0-9._-]+/g) ?? []).map((mention) =>
      mention.slice(1),
    ),
  );
  return bots.filter((bot) => mentions.has(bot.username.toLowerCase()));
}

type SocketEvent = { event: string; data: Record<string, unknown> };
export function readSocketEvent(raw: unknown): SocketEvent | null {
  if (typeof raw !== "string") return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || !("event" in value)) return null;
    const { event, data } = value as { event: unknown; data?: unknown };
    if (typeof event !== "string") return null;
    return {
      event,
      data: data && typeof data === "object" ? (data as SocketEvent["data"]) : {},
    };
  } catch {
    return null;
  }
}
const text = (value: unknown) => (typeof value === "string" ? value : "");
export function typingBot(data: SocketEvent["data"]) {
  return {
    channelId: text(data.channel_id),
    userId: text(data.user_id),
    isBot: data.is_bot === true,
    name: text(data.sender_name),
  };
}
/** A `posted` event carries its post as a JSON string. */
export function postedBy(data: SocketEvent["data"]) {
  try {
    const post: unknown = JSON.parse(text(data.post));
    if (!post || typeof post !== "object") return null;
    const { channel_id, user_id } = post as Record<string, unknown>;
    return {
      channelId: text(channel_id) || text(data.channel_id),
      userId: text(user_id),
    };
  } catch {
    return null;
  }
}

const nonEmpty = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : "";
/**
 * How a webhook post presents itself. The server does not yet stop an ordinary post from
 * setting these props, so the marker always accompanies an override name, and the owner
 * shown is the post's authenticated author rather than a value in its props.
 */
export function webhookIdentity(
  post: Pick<MattermostPost, "props" | "user_id">,
  users: Pick<MattermostUser, "id" | "username" | "nickname">[],
) {
  if (post.props.from_webhook !== "true") return null;
  const poster = users.find((user) => user.id === post.user_id);
  return {
    displayName:
      nonEmpty(post.props.override_username) ||
      poster?.nickname ||
      poster?.username ||
      "Webhook",
    label: nonEmpty(post.props.webhook_label) || "Incoming webhook",
    owner: poster?.username || "unknown",
  };
}

/** Conversations read oldest to newest. Clients must not assume an order from the API. */
export function postsOldestFirst(list: Pick<MattermostPostList, "order" | "posts">) {
  return list.order
    .map((id) => list.posts[id]!)
    .filter(Boolean)
    .sort((a, b) => a.create_at - b.create_at);
}

const NEW_ACCOUNT_MS = 14 * 24 * 60 * 60 * 1000;
const DISMISSED_KEY = "chattermost-onboarding-dismissed";
/** Account age, not a flag set at redemption: the first console sign-in may be on another device. */
export function showsOnboarding(
  user: Pick<MattermostUser, "id" | "create_at">,
  now: number,
  storage: () => Storage,
) {
  if (now - user.create_at > NEW_ACCOUNT_MS) return false;
  try {
    return storage().getItem(DISMISSED_KEY) !== user.id;
  } catch {
    return true;
  }
}
export function dismissOnboarding(
  user: Pick<MattermostUser, "id">,
  storage: () => Storage,
) {
  try {
    storage().setItem(DISMISSED_KEY, user.id);
  } catch {
    // Dismissal then lasts only for this page.
  }
}

export const LATEST_THRESHOLD_PX = 90;
export const distanceFromLatest = (list: {
  scrollHeight: number;
  clientHeight: number;
  scrollTop: number;
}) => list.scrollHeight - list.clientHeight - list.scrollTop;
