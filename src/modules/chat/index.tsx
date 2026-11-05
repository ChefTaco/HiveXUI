import {
  useCallback,
  useEffect,
  useRef,
  useReducer,
  useState,
  type FormEvent,
} from "react";
import type {
  MattermostChannel,
  MattermostPost,
  MattermostPostList,
  MattermostTeam,
  MattermostUser,
  MattermostFileInfo,
  MattermostReaction,
  MattermostCommand,
} from "../../../contracts/chattermost.generated";
import { productPrefix } from "../../lib/transport";
import { productEnabled } from "../../lib/runtime";
import { chat, chatResource, json, safeId } from "./api";
import ChatAdministration from "./admin";
import {
  attachmentDrafts,
  clipboardAttachments,
  ChatAttachmentUploads,
} from "./attachments";
import {
  ChatViewRequests,
  readChatLocation,
  writeChatLocation,
} from "./location";
import {
  BrowseChannels,
  ChannelTools,
  ChatProfile,
  NewConversation,
  ConversationFiles,
} from "./conversation-controls";
import "./chat.css";

const standardEmoji: Record<string, string> = {
  thumbsup: "👍",
  heart: "♥",
  tada: "🎉",
  eyes: "👀",
};

export default function ChatModule() {
  if (!productEnabled("chattermost"))
    return (
      <section className="panel">
        <h2>ChatterMost is not configured</h2>
        <p>Connect the chat service to open channels and conversations.</p>
      </section>
    );
  return <ConnectedChat />;
}
function ConnectedChat() {
  const initial = useRef(readChatLocation(location.search));
  const [me, setMe] = useState<MattermostUser | null>(null);
  const [teams, setTeams] = useState<MattermostTeam[]>([]);
  const [team, setTeam] = useState(initial.current.team);
  const [channels, setChannels] = useState<MattermostChannel[]>([]);
  const [channel, setChannel] = useState(initial.current.channel);
  const [users, setUsers] = useState<MattermostUser[]>([]);
  const [posts, setPosts] = useState<MattermostPost[]>([]);
  const [thread, setThread] = useState(initial.current.thread);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [attachments, updateAttachments] = useReducer(attachmentDrafts, {});
  const uploadedAttachments = useRef(new ChatAttachmentUploads());
  const sending = useRef(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(false);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<MattermostPost[] | null>(null);
  const [person, setPerson] = useState("");
  const active = useRef("");
  active.current = channel + ":" + thread;
  const requests = useRef(new ChatViewRequests());
  const [more, setMore] = useState(false);
  function navigate(nextChannel: string, nextThread = "", nextTeam = team) {
    requests.current.invalidate();
    setPosts([]);
    setResults(null);
    setChannel(nextChannel);
    setThread(nextThread);
    setTeam(nextTeam);
    history.pushState(
      null,
      "",
      writeChatLocation(new URL(location.href), {
        team: nextTeam,
        channel: nextChannel,
        thread: nextThread,
      }),
    );
  }
  useEffect(() => {
    const restore = () => {
      const next = readChatLocation(location.search);
      requests.current.invalidate();
      setTeam(next.team);
      setChannel(next.channel);
      setThread(next.thread);
      setPosts([]);
      setResults(null);
    };
    window.addEventListener("popstate", restore);
    return () => {
      requests.current.invalidate();
      window.removeEventListener("popstate", restore);
    };
  }, []);
  const composerKey = channel + ":" + thread;
  const [files, setFiles] = useState<Record<string, MattermostFileInfo>>({});
  const [reactions, setReactions] = useState<
    Record<string, MattermostReaction[]>
  >({});
  const [emoji, setEmoji] = useState<{ name: string; emoji: string }[]>([]);
  const [commands, setCommands] = useState<MattermostCommand[]>([]);
  const refresh = useCallback(async () => {
    if (!channel) return;
    const captured = channel + ":" + thread,
      sequence = requests.current.begin();
    const data = await chat<MattermostPostList>(
      thread
        ? `/posts/${safeId(thread)}/thread`
        : `/channels/${safeId(channel)}/posts`,
    );
    if (active.current !== captured || !requests.current.current(sequence))
      return;
    const incoming = data.order
      .map((id) => data.posts[id]!)
      .filter(Boolean)
      .reverse();
    if (incoming.some((post) => post.channel_id !== channel))
      throw new Error("This thread belongs to another channel");
    setMore(!thread && incoming.length === 60);
    setPosts((previous) => {
      const oldest = incoming[0]?.create_at ?? Infinity;
      return thread || !incoming.length
        ? incoming
        : [
            ...previous.filter(
              (post) =>
                post.channel_id === channel &&
                post.create_at < oldest &&
                !data.posts[post.id],
            ),
            ...incoming,
          ];
    });
  }, [channel, thread]);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    let current = true;
    void Promise.all([
      chat<MattermostUser>("/users/me"),
      chat<MattermostTeam[]>("/users/me/teams"),
      chat<MattermostUser[]>("/users/search", json({ term: "" })),
    ])
      .then(([user, available, people]) => {
        if (!current) return;
        setMe(user);
        setTeams(available);
        setUsers(people);
        setTeam((previous) =>
          available.some((value) => value.id === previous)
            ? previous
            : (available[0]?.id ?? ""),
        );
      })
      .catch((reason) => {
        if (current)
          setError(
            reason instanceof Error ? reason.message : "Chat is unavailable",
          );
      });
    return () => {
      current = false;
    };
  }, []);
  useEffect(() => {
    let current = true;
    void chat<MattermostCommand[]>("/commands?team_id=" + safeId(team))
      .then((values) => {
        if (current) setCommands(values);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [team]);
  useEffect(() => {
    let current = true;
    void chat<{ name: string; emoji: string }[]>("/emoji")
      .then((values) => {
        if (current) setEmoji(values);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, []);
  useEffect(() => {
    if (!me) return;
    let current = true;
    void chat<MattermostChannel[]>(
      team ? `/users/me/teams/${safeId(team)}/channels` : "/users/me/channels",
    )
      .then((available) => {
        if (!current) return;
        setChannels(available);
        if (!available.some((item) => item.id === channel)) {
          const next = available[0]?.id ?? "";
          setChannel(next);
          setThread("");
          setPosts([]);
          history.replaceState(
            null,
            "",
            writeChatLocation(new URL(location.href), {
              team,
              channel: next,
              thread: "",
            }),
          );
        }
      })
      .catch((reason) => {
        if (current)
          setError(
            reason instanceof Error
              ? reason.message
              : "Channels are unavailable",
          );
      });
    return () => {
      current = false;
    };
  }, [team, me, channel]);
  useEffect(() => {
    let current = true;
    setError("");
    void refresh().catch((reason) => {
      if (current)
        setError(
          reason instanceof Error ? reason.message : "Messages are unavailable",
        );
    });
    return () => {
      current = false;
    };
  }, [refresh]);
  useEffect(() => {
    let current = true;
    const missing = [
      ...new Set((results ?? posts).flatMap((post) => post.file_ids)),
    ].filter((id) => !files[id]);
    void Promise.allSettled(
      missing.map(
        async (id) =>
          [
            id,
            await chat<MattermostFileInfo>("/files/" + safeId(id) + "/info"),
          ] as const,
      ),
    ).then((values) => {
      if (current)
        setFiles((old) => ({
          ...old,
          ...Object.fromEntries(
            values.flatMap((value) =>
              value.status === "fulfilled" ? [value.value] : [],
            ),
          ),
        }));
    });
    const ids = (results ?? posts).map((post) => post.id);
    if (ids.length)
      void chat<Record<string, MattermostReaction[]>>(
        "/posts/ids/reactions",
        json(ids),
      )
        .then((values) => {
          if (current) setReactions(values);
        })
        .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [posts, results]);
  async function earlier() {
    if (!channel || thread || !posts.length || busy) return;
    const captured = active.current;
    setBusy(true);
    try {
      const data = await chat<MattermostPostList>(
        "/channels/" +
          safeId(channel) +
          "/posts?per_page=60&before=" +
          safeId(posts[0]!.id),
      );
      if (active.current !== captured) return;
      const older = data.order
        .map((id) => data.posts[id]!)
        .filter(Boolean)
        .reverse();
      setMore(older.length === 60);
      setPosts((old) => [
        ...older.filter((post) => !old.some((value) => value.id === post.id)),
        ...old,
      ]);
    } catch (reason) {
      if (active.current === captured)
        setError(
          reason instanceof Error
            ? reason.message
            : "Earlier messages are unavailable",
        );
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!me) return;
    const timer = setInterval(() => {
      void chat("/users/me").catch(() =>
        setError("Sign in again to continue this conversation"),
      );
    }, 60000);
    return () => clearInterval(timer);
  }, [me]);
  useEffect(() => {
    if (!me) return;
    let stopped = false;
    let socket: WebSocket | null = null;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      if (stopped) return;
      const old = socket;
      socket = null;
      old?.close();
      const url = new URL(
        (productPrefix("chattermost") ?? "/api/chat") + "/api/v4/websocket",
        location.origin,
      );
      url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const next = new WebSocket(url);
      socket = next;
      next.onopen = () => setOnline(true);
      next.onmessage = () => {
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => {
          void refreshRef
            .current()
            .catch(() => setError("Messages could not refresh"));
        }, 120);
      };
      next.onclose = () => {
        if (socket !== next || stopped) return;
        setOnline(false);
        reconnect = setTimeout(connect, 3000);
      };
    };
    connect();
    window.addEventListener("chat-session-refreshed", connect);
    return () => {
      stopped = true;
      socket?.close();
      if (reconnect) clearTimeout(reconnect);
      if (refreshTimer) clearTimeout(refreshTimer);
      window.removeEventListener("chat-session-refreshed", connect);
    };
  }, [me]);
  function appendFiles(selected: File[]) {
    updateAttachments({
      type: "append",
      key: composerKey,
      files: selected,
      blocked: !channel || busy || sending.current,
    });
  }
  async function send(event: FormEvent) {
    event.preventDefault();
    if (!channel || busy || sending.current) return;
    const target = channel,
      key = composerKey,
      root = thread,
      pending = attachments[key]?.files ?? [],
      message = drafts[key] ?? "";
    if (!message.trim() && !pending.length) return;
    if (message.startsWith("/") && pending.length) {
      setError(
        "Slash commands cannot include attachments. Remove the files or send them with a message.",
      );
      return;
    }
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      const ids = await uploadedAttachments.current.resolve(
        key,
        pending,
        async (file) => {
          const form = new FormData();
          form.set("channel_id", target);
          form.append("files", file);
          const uploaded = await chat<{ file_infos: MattermostFileInfo[] }>(
            "/files",
            { method: "POST", body: form },
          );
          if (
            !Array.isArray(uploaded.file_infos) ||
            uploaded.file_infos.length !== 1 ||
            typeof uploaded.file_infos[0]?.id !== "string"
          )
            throw new Error(
              "Attachment upload could not be matched to the selected file",
            );
          const info = uploaded.file_infos[0]!;
          setFiles((previous) => ({ ...previous, [info.id]: info }));
          return info.id;
        },
      );
      if (message.startsWith("/"))
        await chat(
          "/commands/execute",
          json({ channel_id: target, command: message }),
        );
      else
        await chat(
          "/posts",
          json({ channel_id: target, message, root_id: root, file_ids: ids }),
        );
      setDrafts((previous) => ({ ...previous, [key]: "" }));
      updateAttachments({ type: "clear", key });
      uploadedAttachments.current.clear(key);
      await refresh();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Message status could not be confirmed. Check the conversation before sending again.",
      );
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  async function react(post: MattermostPost, name = "thumbsup") {
    if (!me) return;
    try {
      const own = reactions[post.id]?.some(
        (value) => value.user_id === me.id && value.emoji_name === name,
      );
      if (own)
        await chat(
          "/users/" +
            safeId(me.id) +
            "/posts/" +
            safeId(post.id) +
            "/reactions/" +
            safeId(name),
          { method: "DELETE" },
        );
      else
        await chat(
          "/reactions",
          json({ user_id: me.id, post_id: post.id, emoji_name: name }),
        );
      await refresh();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Reaction was not saved",
      );
    }
  }
  async function edit(post: MattermostPost) {
    const message = prompt("Edit message", post.message);
    if (message === null) return;
    try {
      await chat(`/posts/${safeId(post.id)}/patch`, json({ message }, "PUT"));
      await refresh();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Message was not updated",
      );
    }
  }
  async function remove(post: MattermostPost) {
    if (!confirm("Delete this message?")) return;
    try {
      await chat(`/posts/${safeId(post.id)}`, { method: "DELETE" });
      await refresh();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Message was not deleted",
      );
    }
  }
  async function find(event: FormEvent) {
    event.preventDefault();
    try {
      const data = await chat<MattermostPostList>(
        "/posts/search",
        json({ terms: search, is_or_search: false }),
      );
      setResults(data.order.map((id) => data.posts[id]!).filter(Boolean));
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Search is unavailable",
      );
    }
  }
  async function direct() {
    if (!me || !person) return;
    try {
      const result = await chat<MattermostChannel>(
        "/channels/direct",
        json([me.id, person]),
      );
      setChannels((previous) =>
        previous.some((item) => item.id === result.id)
          ? previous
          : [...previous, result],
      );
      navigate(result.id);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Conversation could not open",
      );
    }
  }
  const selected = channels.find((item) => item.id === channel);
  const byUser = Object.fromEntries(users.map((user) => [user.id, user]));
  const channelLabel = (value: MattermostChannel) => {
    if (value.display_name) return value.display_name;
    if (value.type === "D" || value.type === "G")
      return (
        value.name
          .split("__")
          .filter((id) => id !== me?.id)
          .map(
            (id) =>
              byUser[id]?.nickname || byUser[id]?.username || "Chat member",
          )
          .join(", ") || "Saved conversation"
      );
    return value.name;
  };
  return (
    <section className="chat-module">
      <aside className="chat-rail">
        <h2>ChatterMost</h2>
        <label>
          Team
          <select
            value={team}
            onChange={(event) => navigate("", "", event.target.value)}
          >
            {teams.map((value) => (
              <option key={value.id} value={value.id}>
                {value.display_name}
              </option>
            ))}
          </select>
        </label>
        <nav aria-label="Chat channels">
          {channels.map((value) => (
            <button
              key={value.id}
              className={value.id === channel ? "active" : ""}
              onClick={() => {
                navigate(value.id);
              }}
            >
              {value.type === "D" ? "↗ " : "# "}
              {channelLabel(value)}
            </button>
          ))}
        </nav>
        <label>
          Direct message
          <select
            value={person}
            onChange={(event) => setPerson(event.target.value)}
          >
            <option value="">Choose a person</option>
            {users
              .filter((user) => user.id !== me?.id)
              .map((user) => (
                <option key={user.id} value={user.id}>
                  {user.nickname || user.username}
                </option>
              ))}
          </select>
        </label>
        <button onClick={() => void direct()} disabled={!person}>
          Open conversation
        </button>
        {me && (
          <>
            <BrowseChannels
              team={team}
              me={me}
              joined={channels}
              opened={(value) => {
                setChannels((old) => [
                  ...old.filter((item) => item.id !== value.id),
                  value,
                ]);
                navigate(value.id);
              }}
            />
            <NewConversation
              team={team}
              me={me}
              users={users}
              opened={(value) => {
                setChannels((old) => [
                  ...old.filter((item) => item.id !== value.id),
                  value,
                ]);
                navigate(value.id);
              }}
            />
            <ChatProfile
              me={me}
              changed={(value) => {
                setMe(value);
                setUsers((old) =>
                  old.map((item) => (item.id === value.id ? value : item)),
                );
              }}
            />
          </>
        )}
      </aside>
      <section className="chat-conversation">
        <header>
          <div>
            <h2>
              {thread
                ? "Thread"
                : selected
                  ? channelLabel(selected)
                  : "Choose a channel"}
            </h2>
            <p role="status">{online ? "Connected" : "Reconnecting chat…"}</p>
          </div>
          {thread ? (
            <button onClick={() => navigate(channel)}>Back to channel</button>
          ) : null}
          <form onSubmit={(event) => void find(event)}>
            <input
              aria-label="Search messages"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <button>Search</button>
            {results ? (
              <button type="button" onClick={() => setResults(null)}>
                Clear search
              </button>
            ) : null}
          </form>
        </header>
        {selected && me && (
          <ChannelTools
            key={selected.id}
            channel={selected}
            me={me}
            users={users}
            changed={(value) =>
              setChannels((old) =>
                old.map((item) => (item.id === value.id ? value : item)),
              )
            }
            deleted={() => {
              setChannels((old) => old.filter((item) => item.id !== channel));
              navigate("");
            }}
            openPost={(post) =>
              navigate(post.channel_id, post.root_id || post.id)
            }
          />
        )}
        {channel && (
          <ConversationFiles posts={posts} files={files} users={users} />
        )}
        {error ? (
          <p role="alert" className="error-banner">
            {error}
          </p>
        ) : null}
        {more && !results && !thread && (
          <button disabled={busy} onClick={() => void earlier()}>
            Load earlier messages
          </button>
        )}
        <ol className="chat-posts" aria-label="Messages">
          {(results ?? posts).map((post) => (
            <li key={post.id}>
              <article>
                <header>
                  <strong>
                    {byUser[post.user_id]?.nickname ||
                      byUser[post.user_id]?.username ||
                      "Member"}
                  </strong>
                  <time dateTime={new Date(post.create_at).toISOString()}>
                    {new Date(post.create_at).toLocaleString()}
                  </time>
                </header>
                <p>{post.message}</p>
                {post.file_ids.map((id) => (
                  <a
                    key={id}
                    href={chatResource("/files/" + safeId(id))}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {files[id] &&
                      /^image\/(png|jpeg|gif|webp)$/.test(
                        files[id].mime_type,
                      ) && (
                        <img
                          className="chat-preview"
                          src={chatResource(
                            "/files/" + safeId(id) + "/preview",
                          )}
                          alt={files[id].name}
                          loading="lazy"
                        />
                      )}
                    {files[id]?.name || "Open attachment"}
                  </a>
                ))}
                <footer>
                  <button
                    onClick={() => {
                      navigate(post.channel_id, post.root_id || post.id);
                    }}
                  >
                    Reply in thread
                  </button>
                  {[
                    ...new Set([
                      "thumbsup",
                      ...(reactions[post.id] ?? []).map(
                        (value) => value.emoji_name,
                      ),
                    ]),
                  ].map((name) => {
                    const values = (reactions[post.id] ?? []).filter(
                      (value) => value.emoji_name === name,
                    );
                    return (
                      <button
                        key={name}
                        aria-pressed={values.some(
                          (value) => value.user_id === me?.id,
                        )}
                        onClick={() => void react(post, name)}
                      >
                        {standardEmoji[name] ||
                          emoji.find((value) => value.name === name)?.emoji ||
                          ":" + name + ":"}{" "}
                        {values.length || "React"}
                      </button>
                    );
                  })}
                  <label className="chat-reaction-picker">
                    Add reaction
                    <select
                      value=""
                      onChange={(event) => {
                        if (event.target.value)
                          void react(post, event.target.value);
                      }}
                    >
                      <option value="">Choose emoji</option>
                      {[
                        { name: "heart", emoji: "♥" },
                        { name: "tada", emoji: "🎉" },
                        { name: "eyes", emoji: "👀" },
                        ...emoji,
                      ].map((value) => (
                        <option key={value.name} value={value.name}>
                          {value.emoji} {value.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    aria-pressed={post.is_pinned}
                    onClick={() => {
                      void chat(
                        "/posts/" +
                          safeId(post.id) +
                          (post.is_pinned ? "/unpin" : "/pin"),
                        { method: "POST" },
                      )
                        .then(() => refresh())
                        .catch((reason) =>
                          setError(
                            reason instanceof Error
                              ? reason.message
                              : "Pin was not saved",
                          ),
                        );
                    }}
                  >
                    {post.is_pinned ? "Unpin" : "Pin"}
                  </button>
                  {post.user_id === me?.id ? (
                    <>
                      <button onClick={() => void edit(post)}>Edit</button>
                      <button onClick={() => void remove(post)}>Delete</button>
                    </>
                  ) : null}
                </footer>
              </article>
            </li>
          ))}
        </ol>
        <form
          className="chat-composer"
          onSubmit={(event) => void send(event)}
          aria-busy={busy}
          onDragOver={(event) => {
            if (!Array.from(event.dataTransfer.types).includes("Files")) return;
            event.preventDefault();
            event.dataTransfer.dropEffect =
              busy || sending.current ? "none" : "copy";
          }}
          onDrop={(event) => {
            if (!Array.from(event.dataTransfer.types).includes("Files")) return;
            event.preventDefault();
            if (!busy && !sending.current)
              appendFiles(Array.from(event.dataTransfer.files));
          }}
          onPaste={(event) => {
            const selected = clipboardAttachments(event.clipboardData);
            if (!selected.length) return;
            event.preventDefault();
            if (!busy && !sending.current) appendFiles(selected);
          }}
        >
          {commands.length > 0 && (
            <details className="chat-command-deck">
              <summary>Slash commands</summary>
              <ul>
                {commands.map((command) => (
                  <li key={command.id || command.trigger}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (busy || sending.current) return;
                        setDrafts((old) => ({
                          ...old,
                          [composerKey]: "/" + command.trigger + " ",
                        }));
                      }}
                    >
                      /{command.trigger}
                    </button>{" "}
                    {command.auto_complete_desc || command.description}{" "}
                    {command.auto_complete_hint}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <label>
            {thread ? "Reply" : "Message"}
            <textarea
              disabled={busy || !channel}
              aria-describedby="chat-attachment-help"
              value={drafts[composerKey] ?? ""}
              onChange={(event) => {
                if (busy || sending.current) return;
                const text = event.target.value;
                setDrafts((previous) => ({ ...previous, [composerKey]: text }));
              }}
              rows={3}
            />
          </label>
          <p id="chat-attachment-help" className="chat-attachment-help">
            Drop files here, paste an image, or choose files. Up to 10
            attachments.
          </p>
          {attachments[composerKey]?.error && (
            <p role="alert" className="error-banner">
              {attachments[composerKey].error}
            </p>
          )}
          {!!attachments[composerKey]?.files.length && (
            <ul className="chat-pending-files" aria-label="Pending attachments">
              {attachments[composerKey].files.map((file, index) => (
                <li key={index}>
                  <span>{file.name}</span>
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={"Remove attachment " + file.name}
                    onClick={() =>
                      updateAttachments({
                        type: "remove",
                        key: composerKey,
                        file,
                        blocked: busy || sending.current,
                      })
                    }
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div>
            <label className="chat-attach">
              Attach files
              <input
                type="file"
                multiple
                disabled={busy || !channel}
                onChange={(event) => {
                  const selected = Array.from(event.target.files ?? []);
                  event.target.value = "";
                  if (!busy && !sending.current && selected.length)
                    appendFiles(selected);
                }}
              />
            </label>

            <button
              disabled={
                busy ||
                !channel ||
                (!(drafts[composerKey] ?? "").trim() &&
                  !attachments[composerKey]?.files.length)
              }
            >
              {busy ? "Sending…" : "Send"}
            </button>
          </div>
        </form>
      </section>
      {me ? <ChatAdministration user={me} /> : null}
    </section>
  );
}
