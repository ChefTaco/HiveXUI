import { useCallback, useEffect, useState, type FormEvent } from "react";
import type {
  ChatAdminUser,
  ChatInvite,
  ChatCleanup,
} from "../../../contracts/chattermost-admin.generated";
import { adminAPI } from "./admin-api";
import { inviteLink } from "./invite";
import type { AdminControls } from "./admin";
import { Button } from "@ui";
const text = (data: FormData, name: string) =>
  String(data.get(name) ?? "").trim();
export function UsersAdministration({
  controls: { busy, perform, confirm, reveal },
  owner,
}: {
  controls: AdminControls;
  owner: string;
}) {
  const [users, setUsers] = useState<ChatAdminUser[]>([]),
    [invites, setInvites] = useState<ChatInvite[]>([]),
    [selected, setSelected] = useState<ChatAdminUser | null>(null);
  const [filter, setFilter] = useState(""),
    [cleanup, setCleanup] = useState<ChatCleanup | null>(null);
  const load = useCallback(async () => {
    const [people, pending] = await Promise.all([
      adminAPI.users(),
      adminAPI.invites(),
    ]);
    setUsers(people);
    setInvites(pending);
  }, []);
  useEffect(() => {
    void perform(load, "");
  }, [load, perform]);
  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget,
      data = new FormData(form);
    const body = {
      username: text(data, "username"),
      email: text(data, "email"),
      password: String(data.get("password") ?? ""),
      role: text(data, "role"),
      first_name: text(data, "first_name"),
      last_name: text(data, "last_name"),
      nickname: text(data, "nickname"),
    };
    form.reset();
    confirm(
      "Create chat user",
      `Create @${body.username} with ${body.role.includes("system_admin") ? "administrator" : "member"} access?`,
      async () => {
        await adminAPI.createUser(body);
        await load();
      },
    );
  }
  function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget),
      role = text(data, "role");
    const body = {
      max_uses: 1,
      expires_in_hours: Number(data.get("expires")),
      role,
    };
    confirm(
      "Create one-use invite",
      `Create an invite valid for ${body.expires_in_hours} hours with ${role.includes("system_admin") ? "administrator" : "member"} access?`,
      async () => {
        const result = await adminAPI.createInvite(body);
        reveal("One-use invitation link", inviteLink(location.origin, result.code));
        await load();
      },
    );
  }
  function reset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = event.currentTarget,
      password = String(new FormData(form).get("password") ?? ""),
      user = selected;
    form.reset();
    confirm(
      "Reset chat password",
      `Replace the native Chat password for @${user.username}? Their active Chat sessions will be reviewed by the service.`,
      async () => {
        await adminAPI.resetPassword(user.id, password);
      },
    );
  }
  const cleanupBody = {
    username_prefix: "testotron-",
    channel_name_prefix: "Test",
    older_than_hours: 0,
  };
  return (
    <>
      <form onSubmit={create}>
        <h4>Create a native chat account</h4>
        <div className="chat-admin-grid">
          <label className="field">
            Username
            <input
              name="username"
              pattern="[a-z0-9][a-z0-9._-]+"
              required
              autoComplete="off"
            />
          </label>
          <label className="field">
            Email
            <input name="email" type="email" required />
          </label>
          <label className="field">
            Initial password
            <input
              name="password"
              type="password"
              minLength={10}
              required
              autoComplete="new-password"
            />
          </label>
          <label className="field">
            Role
            <select name="role">
              <option value="system_user">Member</option>
              <option value="system_admin system_user">Administrator</option>
            </select>
          </label>
          <label className="field">
            First name
            <input name="first_name" />
          </label>
          <label className="field">
            Last name
            <input name="last_name" />
          </label>
          <label className="field">
            Display name
            <input name="nickname" />
          </label>
        </div>
        <div>
          <Button disabled={busy} variant="primary">
            Create user
          </Button>
        </div>
      </form>
      <section className="chat-admin-block">
        <div className="chat-admin-actions">
          <h4>Accounts</h4>
          <Button
            disabled={busy}
            onClick={() => void perform(load, "Accounts refreshed")}
          >
            Refresh accounts
          </Button>
        </div>
        <label className="field">
          Find a chat account
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            type="search"
          />
        </label>
        <ul className="chat-admin-list">
          {users
            .filter((user) =>
              [user.username, user.email, user.nickname]
                .join(" ")
                .toLowerCase()
                .includes(filter.toLowerCase()),
            )
            .map((user) => (
              <li key={user.id} className="chat-admin-row">
                <div>
                  <strong>@{user.username}</strong>
                  <small>
                    {user.email} ·{" "}
                    {user.roles.includes("system_admin")
                      ? "Administrator"
                      : user.is_bot
                        ? "Bot"
                        : "Member"}{" "}
                    · {user.delete_at ? "Inactive" : "Active"}
                    {user.id === owner ? " · Your account" : ""}
                  </small>
                </div>
                <div className="chat-admin-actions">
                  <Button disabled={busy} onClick={() => setSelected(user)}>
                    Manage account
                  </Button>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      confirm(
                        "Revoke chat sessions",
                        `End all Chat sessions for @${user.username}?`,
                        async () => {
                          await adminAPI.revokeSessions(user.id);
                        },
                      )
                    }
                  >
                    Revoke sessions
                  </Button>
                  <Button
                    variant="danger"
                    disabled={busy}
                    onClick={() =>
                      confirm(
                        user.delete_at ? "Reactivate user" : "Deactivate user",
                        `${user.delete_at ? "Restore" : "Remove"} chat access for @${user.username}?`,
                        async () => {
                          await adminAPI.userState(
                            user.id,
                            Boolean(user.delete_at),
                          );
                          await load();
                        },
                      )
                    }
                  >
                    {user.delete_at ? "Reactivate" : "Deactivate"}
                  </Button>
                </div>
              </li>
            ))}
        </ul>
        {!users.length ? <p>No chat accounts are available.</p> : null}
      </section>
      {selected ? (
        <section className="chat-admin-block">
          <div className="chat-admin-actions">
            <h4>Manage @{selected.username}</h4>
            <Button type="button" onClick={() => setSelected(null)}>
              Close account
            </Button>
          </div>
          <form
            key={selected.id}
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget),
                user = selected;
              void perform(async () => {
                await adminAPI.updateUser(user.id, {
                  nickname: text(data, "nickname"),
                  first_name: text(data, "first_name"),
                  last_name: text(data, "last_name"),
                  position: text(data, "position"),
                });
                await load();
              }, "Account details saved");
            }}
          >
            <div className="chat-admin-grid">
              <label className="field">
                Display name
                <input name="nickname" defaultValue={selected.nickname} />
              </label>
              <label className="field">
                First name
                <input name="first_name" defaultValue={selected.first_name} />
              </label>
              <label className="field">
                Last name
                <input name="last_name" defaultValue={selected.last_name} />
              </label>
              <label className="field">
                Position
                <input name="position" defaultValue={selected.position} />
              </label>
            </div>
            <div>
              <Button disabled={busy}>Save account details</Button>
            </div>
          </form>
          <form onSubmit={reset} className="chat-admin-block">
            <label className="field">
              New native Chat password
              <input
                name="password"
                type="password"
                required
                minLength={10}
                autoComplete="new-password"
              />
            </label>
            <div>
              <Button disabled={busy} variant="danger">
                Reset password
              </Button>
            </div>
          </form>
        </section>
      ) : null}
      <section className="chat-admin-block">
        <h4>One-use invitations</h4>
        <p>
          An invite creates a chat account for Mattermost-compatible apps. Using
          chat in this console also needs an Oathweave account and a reviewed
          account link in the chat service configuration.
        </p>
        <form onSubmit={invite}>
          <div className="chat-admin-grid">
            <label className="field">
              Expires in hours
              <input
                name="expires"
                type="number"
                min={1}
                max={720}
                defaultValue={72}
                required
              />
            </label>
            <label className="field">
              Invited role
              <select name="role">
                <option value="system_user">Member</option>
                <option value="system_admin system_user">Administrator</option>
              </select>
            </label>
          </div>
          <div>
            <Button disabled={busy}>Create invite</Button>
          </div>
        </form>
        <ul className="chat-admin-list">
          {invites.map((item) => (
            <li key={item.id} className="chat-admin-row">
              <div>
                <strong>{item.code_preview}</strong>
                <small>
                  {item.uses}/{item.max_uses} uses · expires{" "}
                  {new Date(item.expires_at).toLocaleString()} · {item.role}
                </small>
              </div>
              <Button
                disabled={busy}
                onClick={() =>
                  confirm(
                    "Revoke invitation",
                    "Prevent further use of this invitation?",
                    async () => {
                      await adminAPI.revokeInvite(item.id);
                      await load();
                    },
                  )
                }
              >
                Revoke invite
              </Button>
            </li>
          ))}
        </ul>
        {!invites.length ? <p>No active invitations.</p> : null}
      </section>
      <section className="chat-admin-block">
        <h4>Generated test artifacts</h4>
        <p>
          Review accounts beginning with <code>testotron-</code> and
          public/private channels beginning with <code>Test</code> before
          removing their access.
        </p>
        <Button
          disabled={busy}
          onClick={() =>
            void perform(async () => {
              setCleanup(
                await adminAPI.cleanup({ ...cleanupBody, dry_run: true }),
              );
            }, "Cleanup preview ready")
          }
        >
          Preview cleanup
        </Button>
        {cleanup ? (
          <div className="chat-admin-receipt">
            <p>
              {cleanup.dry_run ? "Preview" : "Cleanup complete"}:{" "}
              {(cleanup.users ?? []).length} accounts and{" "}
              {(cleanup.channels ?? []).length} channels.
            </p>
            <ul>
              {cleanup.users?.map((item) => (
                <li key={item.id}>@{item.username}</li>
              ))}
              {cleanup.channels?.map((item) => (
                <li key={item.id}>#{item.display_name}</li>
              ))}
            </ul>
            {cleanup.dry_run ? (
              <Button
                variant="danger"
                disabled={busy}
                onClick={() =>
                  confirm(
                    "Apply test cleanup",
                    "Deactivate the reviewed generated test users and archive the reviewed test channels?",
                    async () => {
                      const current = await adminAPI.cleanup({
                        ...cleanupBody,
                        dry_run: true,
                      });
                      const ids = (value: ChatCleanup) =>
                        JSON.stringify({
                          users: value.users?.map((item) => item.id).sort(),
                          channels: value.channels
                            ?.map((item) => item.id)
                            .sort(),
                        });
                      if (ids(current) !== ids(cleanup)) {
                        setCleanup(current);
                        throw Error(
                          "Cleanup selection changed. Review the new preview before applying.",
                        );
                      }
                      setCleanup(
                        await adminAPI.cleanup({
                          ...cleanupBody,
                          dry_run: false,
                          confirm: "cleanup test artifacts",
                        }),
                      );
                      await load();
                    },
                  )
                }
              >
                Apply reviewed cleanup
              </Button>
            ) : null}
          </div>
        ) : null}
      </section>
    </>
  );
}
