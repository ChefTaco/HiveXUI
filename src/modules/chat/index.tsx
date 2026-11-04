import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import type {
  MattermostChannel,
  MattermostPost,
  MattermostPostList,
  MattermostTeam,
  MattermostUser,
  MattermostFileInfo,
} from '../../../contracts/chattermost.generated';
import { apiFetch, productPrefix } from '../../lib/transport';
import { productEnabled } from '../../lib/runtime';
import './chat.css';

async function chat<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch('/api/chat/api/v4' + path, init);
  if (!response.ok) {
    const error: unknown = await response.json().catch(() => null);
    throw new Error(
      error &&
        typeof error === 'object' &&
        'message' in error &&
        typeof error.message === 'string'
        ? error.message
        : 'Chat could not complete this request',
    );
  }
  return response.json() as Promise<T>;
}
const json = (body: object, method = 'POST'): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const safeId = (id: string) => encodeURIComponent(id);

export default function ChatModule() {
  if (!productEnabled('chattermost'))
    return (
      <section className="panel">
        <h2>ChatterMost is not configured</h2>
        <p>Connect the chat service to open channels and conversations.</p>
      </section>
    );
  return <ConnectedChat />;
}
function ConnectedChat() {
  const [me, setMe] = useState<MattermostUser | null>(null);
  const [teams, setTeams] = useState<MattermostTeam[]>([]);
  const [team, setTeam] = useState('');
  const [channels, setChannels] = useState<MattermostChannel[]>([]);
  const [channel, setChannel] = useState('');
  const [users, setUsers] = useState<MattermostUser[]>([]);
  const [posts, setPosts] = useState<MattermostPost[]>([]);
  const [thread, setThread] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [attachments, setAttachments] = useState<Record<string, File[]>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(false);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<MattermostPost[] | null>(null);
  const [person, setPerson] = useState('');
  const active = useRef('');
  active.current = channel;
  const composerKey = channel + ':' + thread;
  const [files, setFiles] = useState<Record<string, MattermostFileInfo>>({});
  const refresh = useCallback(async () => {
    if (!channel) return;
    const captured = channel;
    const data = await chat<MattermostPostList>(
      thread
        ? `/posts/${safeId(thread)}/thread`
        : `/channels/${safeId(channel)}/posts`,
    );
    if (active.current !== captured) return;
    setPosts(
      data.order
        .map((id) => data.posts[id]!)
        .filter(Boolean)
        .reverse(),
    );
  }, [channel, thread]);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    let current = true;
    void Promise.all([
      chat<MattermostUser>('/users/me'),
      chat<MattermostTeam[]>('/users/me/teams'),
      chat<MattermostUser[]>('/users/search', json({ term: '' })),
    ])
      .then(([user, available, people]) => {
        if (!current) return;
        setMe(user);
        setTeams(available);
        setUsers(people);
        setTeam(available[0]?.id ?? '');
      })
      .catch((reason) => {
        if (current)
          setError(
            reason instanceof Error ? reason.message : 'Chat is unavailable',
          );
      });
    return () => {
      current = false;
    };
  }, []);
  useEffect(() => {
    if (!me) return;
    let current = true;
    void chat<MattermostChannel[]>(
      team ? `/users/me/teams/${safeId(team)}/channels` : '/users/me/channels',
    )
      .then((available) => {
        if (!current) return;
        setChannels(available);
        setChannel((previous) =>
          available.some((item) => item.id === previous)
            ? previous
            : (available[0]?.id ?? ''),
        );
        setThread('');
      })
      .catch((reason) => {
        if (current)
          setError(
            reason instanceof Error
              ? reason.message
              : 'Channels are unavailable',
          );
      });
    return () => {
      current = false;
    };
  }, [team, me]);
  useEffect(() => {
    setError('');
    void refresh().catch((reason) =>
      setError(
        reason instanceof Error ? reason.message : 'Messages are unavailable',
      ),
    );
  }, [refresh]);
  useEffect(() => {
    if (!me) return;
    const timer = setInterval(() => {
      void chat('/users/me').catch(() =>
        setError('Sign in again to continue this conversation'),
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
        (productPrefix('chattermost') ?? '/api/chat') + '/api/v4/websocket',
        location.origin,
      );
      url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const next = new WebSocket(url);
      socket = next;
      next.onopen = () => setOnline(true);
      next.onmessage = () => {
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => {
          void refreshRef
            .current()
            .catch(() => setError('Messages could not refresh'));
        }, 120);
      };
      next.onclose = () => {
        if (socket !== next || stopped) return;
        setOnline(false);
        reconnect = setTimeout(connect, 3000);
      };
    };
    connect();
    window.addEventListener('chat-session-refreshed', connect);
    return () => {
      stopped = true;
      socket?.close();
      if (reconnect) clearTimeout(reconnect);
      if (refreshTimer) clearTimeout(refreshTimer);
      window.removeEventListener('chat-session-refreshed', connect);
    };
  }, [me]);
  async function send(event: FormEvent) {
    event.preventDefault();
    if (!channel || busy) return;
    setBusy(true);
    setError('');
    const target = channel,
      key = composerKey;
    try {
      const pending = attachments[key] ?? [];
      let ids: string[] = [];
      if (pending.length) {
        const form = new FormData();
        form.set('channel_id', target);
        for (const file of pending) form.append('files', file);
        const uploaded = await chat<{ file_infos: MattermostFileInfo[] }>(
          '/files',
          { method: 'POST', body: form },
        );
        ids = uploaded.file_infos.map((file) => file.id);
        setFiles((previous) => ({
          ...previous,
          ...Object.fromEntries(
            uploaded.file_infos.map((file) => [file.id, file]),
          ),
        }));
      }
      const message = drafts[key] ?? '';
      if (message.startsWith('/'))
        await chat(
          '/commands/execute',
          json({ channel_id: target, command: message }),
        );
      else
        await chat(
          '/posts',
          json({ channel_id: target, message, root_id: thread, file_ids: ids }),
        );
      setDrafts((previous) => ({ ...previous, [key]: '' }));
      setAttachments((previous) => ({ ...previous, [key]: [] }));
      await refresh();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Message was not sent',
      );
    } finally {
      setBusy(false);
    }
  }
  async function react(post: MattermostPost) {
    if (!me) return;
    try {
      await chat(
        '/reactions',
        json({ user_id: me.id, post_id: post.id, emoji_name: 'thumbsup' }),
      );
      await refresh();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Reaction was not saved',
      );
    }
  }
  async function edit(post: MattermostPost) {
    const message = prompt('Edit message', post.message);
    if (message === null) return;
    try {
      await chat(`/posts/${safeId(post.id)}/patch`, json({ message }, 'PUT'));
      await refresh();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Message was not updated',
      );
    }
  }
  async function remove(post: MattermostPost) {
    if (!confirm('Delete this message?')) return;
    try {
      await chat(`/posts/${safeId(post.id)}`, { method: 'DELETE' });
      await refresh();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Message was not deleted',
      );
    }
  }
  async function find(event: FormEvent) {
    event.preventDefault();
    try {
      const data = await chat<MattermostPostList>(
        '/posts/search',
        json({ terms: search, is_or_search: false }),
      );
      setResults(data.order.map((id) => data.posts[id]!).filter(Boolean));
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Search is unavailable',
      );
    }
  }
  async function direct() {
    if (!me || !person) return;
    try {
      const result = await chat<MattermostChannel>(
        '/channels/direct',
        json([me.id, person]),
      );
      setChannels((previous) =>
        previous.some((item) => item.id === result.id)
          ? previous
          : [...previous, result],
      );
      setChannel(result.id);
      setThread('');
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Conversation could not open',
      );
    }
  }
  const selected = channels.find((item) => item.id === channel);
  const byUser = Object.fromEntries(users.map((user) => [user.id, user]));
  return (
    <section className="chat-module">
      <aside className="chat-rail">
        <h2>ChatterMost</h2>
        <label>
          Team
          <select
            value={team}
            onChange={(event) => setTeam(event.target.value)}
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
              className={value.id === channel ? 'active' : ''}
              onClick={() => {
                setChannel(value.id);
                setThread('');
                setResults(null);
              }}
            >
              {value.type === 'D' ? '↗ ' : '# '}
              {value.display_name || value.name}
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
      </aside>
      <section className="chat-conversation">
        <header>
          <div>
            <h2>
              {thread
                ? 'Thread'
                : selected?.display_name ||
                  selected?.name ||
                  'Choose a channel'}
            </h2>
            <p role="status">{online ? 'Connected' : 'Reconnecting chat…'}</p>
          </div>
          {thread ? (
            <button onClick={() => setThread('')}>Back to channel</button>
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
        {error ? (
          <p role="alert" className="error-banner">
            {error}
          </p>
        ) : null}
        <ol className="chat-posts" aria-label="Messages">
          {(results ?? posts).map((post) => (
            <li key={post.id}>
              <article>
                <header>
                  <strong>
                    {byUser[post.user_id]?.nickname ||
                      byUser[post.user_id]?.username ||
                      'Member'}
                  </strong>
                  <time dateTime={new Date(post.create_at).toISOString()}>
                    {new Date(post.create_at).toLocaleString()}
                  </time>
                </header>
                <p>{post.message}</p>
                {post.file_ids.map((id) => (
                  <a
                    key={id}
                    href={
                      (productPrefix('chattermost') ?? '/api/chat') +
                      '/api/v4/files/' +
                      safeId(id)
                    }
                    target="_blank"
                    rel="noreferrer"
                  >
                    {files[id]?.name || 'Open attachment'}
                  </a>
                ))}
                <footer>
                  <button
                    onClick={() => {
                      setThread(post.root_id || post.id);
                      setResults(null);
                    }}
                  >
                    Reply in thread
                  </button>
                  <button onClick={() => void react(post)}>👍 React</button>
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
        <form className="chat-composer" onSubmit={(event) => void send(event)}>
          <label>
            {thread ? 'Reply' : 'Message'}
            <textarea
              value={drafts[composerKey] ?? ''}
              onChange={(event) => {
                const text = event.target.value;
                setDrafts((previous) => ({ ...previous, [composerKey]: text }));
              }}
              rows={3}
            />
          </label>
          <div>
            <label className="chat-attach">
              Attach files
              <input
                type="file"
                multiple
                onChange={(event) => {
                  const selected = Array.from(event.target.files ?? []);
                  setAttachments((previous) => ({
                    ...previous,
                    [composerKey]: selected,
                  }));
                }}
              />
            </label>
            <span>
              {(attachments[composerKey] ?? [])
                .map((file) => file.name)
                .join(', ')}
            </span>
            <button
              disabled={
                busy ||
                !channel ||
                (!(drafts[composerKey] ?? '').trim() &&
                  !attachments[composerKey]?.length)
              }
            >
              {busy ? 'Sending…' : 'Send'}
            </button>
          </div>
        </form>
      </section>
    </section>
  );
}
