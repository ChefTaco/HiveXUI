import { useEffect, useState, type FormEvent } from "react";
import type {
  JsonRecord,
  MattermostChannel,
  MattermostChannelMember,
  MattermostPost,
  MattermostPostList,
  MattermostUser,
  MattermostFileInfo,
} from "../../../contracts/chattermost.generated";
import { chat, chatResource, json, safeId } from "./api";

const message = (reason: unknown) =>
  reason instanceof Error ? reason.message : "Chat request failed";

export function ConversationFiles({
  posts,
  files,
  users,
}: {
  posts: MattermostPost[];
  files: Record<string, MattermostFileInfo>;
  users: MattermostUser[];
}) {
  const [imagesOnly, setImagesOnly] = useState(false);
  const attachments = posts
    .flatMap((post) =>
      post.file_ids.map((id) => ({ post, id, file: files[id] })),
    )
    .reverse();
  const visible = attachments.filter(
    ({ file }) =>
      !imagesOnly ||
      (file && /^image\/(png|jpeg|gif|webp)$/.test(file.mime_type)),
  );
  return (
    <details className="chat-tools">
      <summary>Files and image gallery</summary>
      <label className="check-field">
        <input
          type="checkbox"
          checked={imagesOnly}
          onChange={(e) => setImagesOnly(e.target.checked)}
        />
        Images only
      </label>
      <p>
        Files from the loaded conversation history. Load earlier messages to
        include older files.
      </p>
      {visible.length ? (
        <ul className="chat-file-gallery">
          {visible.map(({ id, post, file }) => (
            <li key={post.id + ":" + id}>
              <a
                href={chatResource("/files/" + safeId(id))}
                target="_blank"
                rel="noreferrer"
              >
                {file &&
                  /^image\/(png|jpeg|gif|webp)$/.test(file.mime_type) && (
                    <img
                      className="chat-preview"
                      src={chatResource("/files/" + safeId(id) + "/preview")}
                      alt={file.name}
                      loading="lazy"
                    />
                  )}
                {file?.name || "Attachment"}
              </a>
              <small>
                {users.find((user) => user.id === post.user_id)?.username ||
                  "Member"}{" "}
                · {new Date(post.create_at).toLocaleString()}
              </small>
            </li>
          ))}
        </ul>
      ) : (
        <p>No {imagesOnly ? "images" : "files"} in the loaded history.</p>
      )}
    </details>
  );
}
export function BrowseChannels({
  team,
  me,
  joined,
  opened,
}: {
  team: string;
  me: MattermostUser;
  joined: MattermostChannel[];
  opened: (channel: MattermostChannel) => void;
}) {
  const [channels, setChannels] = useState<MattermostChannel[]>([]),
    [page, setPage] = useState(0);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [filter, setFilter] = useState("");
  useEffect(() => {
    if (!team) return;
    let current = true;
    void chat<MattermostChannel[]>(
      "/teams/" + safeId(team) + "/channels?per_page=50&page=" + page,
    )
      .then((values) => {
        if (current) setChannels(values);
      })
      .catch((reason) => {
        if (current) setError(message(reason));
      });
    return () => {
      current = false;
    };
  }, [team, page]);
  return (
    <details className="chat-tools">
      <summary>Browse channels</summary>
      {error && <p role="alert">{error}</p>}
      <label className="field">
        Filter this page
        <input value={filter} onChange={(e) => setFilter(e.target.value)} />
      </label>
      <ul>
        {channels
          .filter((value) =>
            (value.display_name + " " + value.name)
              .toLowerCase()
              .includes(filter.toLowerCase()),
          )
          .map((value) => (
            <li key={value.id}>
              {value.display_name || value.name}{" "}
              {value.type === "P" ? "(private)" : ""}
              <button
                className="btn"
                disabled={busy}
                onClick={() => {
                  if (joined.some((item) => item.id === value.id)) {
                    opened(value);
                    return;
                  }
                  setBusy(true);
                  setError("");
                  void chat(
                    "/channels/" + safeId(value.id) + "/members",
                    json({ user_id: me.id }),
                  )
                    .then(() => opened(value))
                    .catch((reason) => setError(message(reason)))
                    .finally(() => setBusy(false));
                }}
              >
                {joined.some((item) => item.id === value.id)
                  ? "Open channel"
                  : "Join channel"}
              </button>
            </li>
          ))}
      </ul>
      <button
        className="btn"
        disabled={!page || busy}
        onClick={() => setPage((old) => old - 1)}
      >
        Previous channels
      </button>
      <button
        className="btn"
        disabled={channels.length < 50 || busy}
        onClick={() => setPage((old) => old + 1)}
      >
        More channels
      </button>
    </details>
  );
}
export function NewConversation({
  team,
  me,
  users,
  opened,
}: {
  team: string;
  me: MattermostUser;
  users: MattermostUser[];
  opened: (channel: MattermostChannel) => void;
}) {
  const [kind, setKind] = useState("O"),
    [name, setName] = useState(""),
    [title, setTitle] = useState("");
  const [people, setPeople] = useState<string[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function create(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await chat<MattermostChannel>(
        kind === "G" ? "/channels/group" : "/channels",
        json(
          kind === "G"
            ? [me.id, ...people]
            : { team_id: team, type: kind, name, display_name: title },
        ),
      );
      opened(result);
      setName("");
      setTitle("");
      setPeople([]);
    } catch (reason) {
      setError(
        message(reason) + ". Check existing channels before trying again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="chat-tools">
      <summary>New channel or group</summary>
      <form onSubmit={(event) => void create(event)}>
        <label className="field">
          Conversation type
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="O">Public channel</option>
            <option value="P">Private channel</option>
            <option value="G">Group message</option>
          </select>
        </label>
        {kind === "G" ? (
          <fieldset>
            <legend>Group members</legend>
            {users
              .filter((user) => user.id !== me.id && !user.delete_at)
              .map((user) => (
                <label className="field" key={user.id}>
                  <input
                    type="checkbox"
                    checked={people.includes(user.id)}
                    onChange={(e) =>
                      setPeople((old) =>
                        e.target.checked
                          ? [...old, user.id]
                          : old.filter((id) => id !== user.id),
                      )
                    }
                  />
                  {user.nickname || user.username}
                </label>
              ))}
          </fieldset>
        ) : (
          <>
            <label className="field">
              Channel address
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="field">
              Channel title
              <input
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
          </>
        )}
        <button className="btn" disabled={busy || (kind === "G" && people.length < 2)}>
          {busy ? "Creating…" : "Create conversation"}
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}

export function ChannelTools({
  channel,
  me,
  users,
  changed,
  deleted,
  openPost,
}: {
  channel: MattermostChannel;
  me: MattermostUser;
  users: MattermostUser[];
  changed: (channel: MattermostChannel) => void;
  deleted: () => void;
  openPost: (post: MattermostPost) => void;
}) {
  const [members, setMembers] = useState<MattermostChannelMember[]>([]),
    [pins, setPins] = useState<MattermostPost[]>([]);
  const [policy, setPolicy] = useState<JsonRecord | null>(null),
    [member, setMember] = useState("");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState("");
  const [revision, setRevision] = useState(0);
  const [title, setTitle] = useState(channel.display_name),
    [header, setHeader] = useState(channel.header),
    [purpose, setPurpose] = useState(channel.purpose);
  const base = "/channels/" + safeId(channel.id);
  const isAdmin = me.roles.split(" ").includes("system_admin");
  const canManage =
    isAdmin ||
    members.some(
      (value) =>
        value.user_id === me.id &&
        (value.scheme_admin ||
          value.roles.split(" ").includes("channel_admin")),
    );
  useEffect(() => {
    let current = true;
    void Promise.all([
      chat<MattermostChannelMember[]>(base + "/members"),
      chat<MattermostPostList>(base + "/pinned"),
      chat<JsonRecord>(base + "/agent-policy"),
    ])
      .then(([people, posts, rules]) => {
        if (!current) return;
        setMembers(people);
        setPins(posts.order.map((id) => posts.posts[id]!).filter(Boolean));
        setPolicy(rules);
      })
      .catch((reason) => {
        if (current) setError(message(reason));
      });
    return () => {
      current = false;
    };
  }, [base, revision]);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await action();
      setStatus("Saved");
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="chat-tools">
      <summary>Channel details, members and pinned messages</summary>
      <p>
        {channel.header || "No header"} · {channel.purpose || "No purpose"}
      </p>
      <button className="btn" disabled={busy} onClick={() => setRevision((value) => value + 1)}>
        Refresh channel details
      </button>
      {error && <p role="alert">{error}</p>}
      <p role="status">{status}</p>
      <h3>Members</h3>
      <ul>
        {members.map((value) => (
          <li key={value.user_id}>
            {users.find((user) => user.id === value.user_id)?.username ||
              "Member"}
            {(canManage || value.user_id === me.id) && (
              <button
                className="btn"
                disabled={busy}
                onClick={() => {
                  if (
                    !confirm(
                      value.user_id === me.id
                        ? "Leave this channel?"
                        : "Remove this member from the channel?",
                    )
                  )
                    return;
                  void run(async () => {
                    await chat(base + "/members/" + safeId(value.user_id), {
                      method: "DELETE",
                    });
                    if (value.user_id === me.id) deleted();
                    else
                      setMembers(
                        await chat<MattermostChannelMember[]>(
                          base + "/members",
                        ),
                      );
                  });
                }}
              >
                {value.user_id === me.id ? "Leave channel" : "Remove member"}
              </button>
            )}
          </li>
        ))}
      </ul>
      {canManage && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await chat(base + "/members", json({ user_id: member }));
              setMember("");
              setMembers(
                await chat<MattermostChannelMember[]>(base + "/members"),
              );
            });
          }}
        >
          <label className="field">
            Add member
            <select value={member} onChange={(e) => setMember(e.target.value)}>
              <option value="">Choose a member</option>
              {users
                .filter(
                  (user) =>
                    !user.delete_at &&
                    !members.some((value) => value.user_id === user.id),
                )
                .map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.username}
                  </option>
                ))}
            </select>
          </label>
          <button className="btn" disabled={!member || busy}>Add to channel</button>
        </form>
      )}
      <h3>Pinned messages</h3>
      {pins.length ? (
        <ul>
          {pins.map((post) => (
            <li key={post.id}>
              <button className="btn" onClick={() => openPost(post)}>
                {post.message || "Attachment message"}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p>No pinned messages.</p>
      )}
      <h3>Channel settings</h3>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            changed(
              await chat<MattermostChannel>(
                base + "/patch",
                json(
                  {
                    ...(canManage ? { display_name: title } : {}),
                    header,
                    purpose,
                  },
                  "PUT",
                ),
              ),
            );
          });
        }}
      >
        <label className="field">
          Display name
          <input
            required
            disabled={!canManage}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="field">
          Header
          <input value={header} onChange={(e) => setHeader(e.target.value)} />
        </label>
        <label className="field">
          Purpose
          <textarea
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
          />
        </label>
        <button className="btn" disabled={busy}>Save channel</button>
      </form>
      {isAdmin && policy && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await chat(base + "/agent-policy", json(policy, "PUT"));
              setPolicy(await chat<JsonRecord>(base + "/agent-policy"));
            });
          }}
        >
          <h3>Agent policy</h3>
          {(
            [
              "agents_allowed",
              "mention_required",
              "direct_messages_enabled",
            ] as const
          ).map((key) => (
            <label className="field" key={key}>
              <input
                type="checkbox"
                checked={
                  typeof policy[key] === "boolean"
                    ? policy[key]
                    : key !== "mention_required"
                }
                onChange={(e) =>
                  setPolicy({ ...policy, [key]: e.target.checked })
                }
              />
              {key === "agents_allowed"
                ? "Allow agents"
                : key === "mention_required"
                  ? "Require a mention"
                  : "Allow direct messages"}
            </label>
          ))}
          <label className="field">
            Allowed agent usernames (comma separated)
            <input
              value={
                Array.isArray(policy.allowed_agents)
                  ? policy.allowed_agents.join(", ")
                  : ""
              }
              onChange={(e) =>
                setPolicy({
                  ...policy,
                  allowed_agents: e.target.value
                    .split(",")
                    .map((value) => value.trim())
                    .filter(Boolean),
                })
              }
            />
          </label>
          <label className="field">
            Retention days (blank uses default)
            <input
              type="number"
              min="1"
              value={
                typeof policy.retention_days === "number"
                  ? policy.retention_days
                  : ""
              }
              onChange={(e) => {
                const next = { ...policy };
                if (e.target.value)
                  next.retention_days = Number(e.target.value);
                else delete next.retention_days;
                setPolicy(next);
              }}
            />
          </label>
          <button className="btn" disabled={busy}>Save agent policy</button>
        </form>
      )}
      {canManage && (
        <button
          className="btn"
          disabled={busy}
          onClick={() => {
            if (confirm("Delete this channel?"))
              void run(async () => {
                await chat(base, { method: "DELETE" });
                deleted();
              });
          }}
        >
          Delete channel
        </button>
      )}
    </details>
  );
}

export function ChatProfile({
  me,
  changed,
}: {
  me: MattermostUser;
  changed: (user: MattermostUser) => void;
}) {
  const [nickname, setNickname] = useState(me.nickname),
    [first, setFirst] = useState(me.first_name),
    [last, setLast] = useState(me.last_name);
  const [position, setPosition] = useState(me.position),
    [locale, setLocale] = useState(me.locale);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [image, setImage] = useState<File | null>(null),
    [revision, setRevision] = useState(0);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="chat-tools">
      <summary>My chat profile</summary>
      <img
        className="chat-avatar"
        src={
          chatResource("/users/" + safeId(me.id) + "/image") + "?v=" + revision
        }
        alt="Your chat avatar"
      />
      {error && <p role="alert">{error}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () =>
            changed(
              await chat<MattermostUser>(
                "/users/me/patch",
                json(
                  {
                    nickname,
                    first_name: first,
                    last_name: last,
                    position,
                    locale,
                  },
                  "PUT",
                ),
              ),
            ),
          );
        }}
      >
        <label className="field">
          Nickname
          <input
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
          />
        </label>
        <label className="field">
          First name
          <input value={first} onChange={(e) => setFirst(e.target.value)} />
        </label>
        <label className="field">
          Last name
          <input value={last} onChange={(e) => setLast(e.target.value)} />
        </label>
        <label className="field">
          Position
          <input
            value={position}
            onChange={(e) => setPosition(e.target.value)}
          />
        </label>
        <label className="field">
          Language
          <select value={locale} onChange={(e) => setLocale(e.target.value)}>
            <option value="en">English</option>
            <option value="es">Español</option>
            <option value="fr">Français</option>
            {!["en", "es", "fr"].includes(locale) && (
              <option value={locale}>{locale || "Default"}</option>
            )}
          </select>
        </label>
        <button className="btn" disabled={busy}>Save profile</button>
      </form>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!image) return;
          void run(async () => {
            const form = new FormData();
            form.set("image", image);
            await chat("/users/" + safeId(me.id) + "/image", {
              method: "POST",
              body: form,
            });
            setImage(null);
            setRevision((old) => old + 1);
          });
        }}
      >
        <label className="field">
          Profile image
          <input
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            onChange={(e) => setImage(e.target.files?.[0] ?? null)}
          />
        </label>
        <button className="btn" disabled={busy || !image}>Upload avatar</button>
        <button
          className="btn"
          type="button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await chat("/users/" + safeId(me.id) + "/image", {
                method: "DELETE",
              });
              setRevision((old) => old + 1);
            })
          }
        >
          Reset avatar
        </button>
      </form>
    </details>
  );
}
