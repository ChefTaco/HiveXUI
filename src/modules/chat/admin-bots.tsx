import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type {
  ChatBot,
  ChatHermesHealth,
} from "../../../contracts/chattermost-admin.generated";
import {
  adminAPI,
  createBotOperation,
  loadBotOperation,
  saveBotOperation,
  type PendingBotOperation,
} from "./admin-api";
import type { AdminControls } from "./admin";
const actions = {
  provision: "bot.provisioned",
  identity: "bot.identity_updated",
  rotate: "bot.token_regenerated",
} as const;
export function BotsAdministration({
  controls: { busy, perform, confirm, reveal },
  owner,
}: {
  controls: AdminControls;
  owner: string;
}) {
  const [bots, setBots] = useState<ChatBot[]>([]),
    [health, setHealth] = useState<ChatHermesHealth | null>(null),
    [selected, setSelected] = useState<ChatBot | null>(null);
  const [capable, setCapable] = useState(false),
    [capabilityMessage, setCapabilityMessage] = useState(
      "Checking safe credential operations…",
    );
  const [pending, setPending] = useState<PendingBotOperation | null>(null),
    [storageError, setStorageError] = useState("");
  const pendingRef = useRef<PendingBotOperation | null>(null),
    lock = useRef(false);
  const load = useCallback(async () => {
    const [items, current] = await Promise.all([
      adminAPI.bots(),
      adminAPI.health(),
    ]);
    setBots(items);
    setHealth(current);
  }, []);
  useEffect(() => {
    try {
      const value = loadBotOperation(owner);
      pendingRef.current = value;
      setPending(value);
    } catch {
      setStorageError(
        "The protected operation receipt cannot be read. Credential changes are disabled until the receipt is recovered.",
      );
    }
    void perform(async () => {
      await load();
      try {
        await adminAPI.capabilities();
        setCapable(true);
        setCapabilityMessage("Caller-bound operation receipts are available.");
      } catch {
        setCapable(false);
        setCapabilityMessage(
          "Upgrade ChatterMost to a release with caller-bound bot receipts before changing credentials here.",
        );
      }
    }, "");
  }, [owner, load, perform]);
  function remember(value: PendingBotOperation | null) {
    saveBotOperation(owner, value);
    pendingRef.current = value;
    setPending(value);
  }
  async function mutate(
    action: PendingBotOperation["action"],
    target: string,
    inputs: { username?: string; display_name?: string },
  ) {
    if (lock.current || pendingRef.current)
      throw Error(
        "Reconcile the existing bot operation before another change.",
      );
    if (!capable || storageError)
      throw Error("Safe credential operations are unavailable.");
    lock.current = true;
    let operation: PendingBotOperation | null = null,
      committed = false;
    try {
      operation = await createBotOperation(action, target, inputs);
      remember(operation);
      const result =
        action === "rotate"
          ? await adminAPI.rotateBot(target, operation.id)
          : action === "identity"
            ? await adminAPI.updateBot(target, {
                ...inputs,
                operation_id: operation.id,
              })
            : await adminAPI.provisionBot({
                ...inputs,
                operation_id: operation.id,
                create_only: true,
              });
      if (result.operation_id !== operation.id)
        throw Error(
          "The returned operation ID does not match. Reconcile before continuing.",
        );
      remember({ ...operation, status: "committed" });
      committed = true;
      if (result.token) reveal("New native Chat bot token", result.token);
      await load();
    } catch (reason) {
      if (operation && !committed) {
        try {
          remember({ ...operation, status: "unknown" });
        } catch {
          setStorageError(
            "Receipt storage failed. Preserve the operation ID shown here and reconcile it before any further credential change.",
          );
        }
      }
      throw reason;
    } finally {
      lock.current = false;
    }
  }
  async function reconcile() {
    const operation = pendingRef.current;
    if (!operation) return;
    const receipt = await adminAPI.botOperation(operation.id);
    if (
      receipt.action !== actions[operation.action] ||
      (operation.action !== "provision" &&
        receipt.target_id !== operation.target)
    )
      throw Error(
        "Receipt action or target differs from the saved request. Keep this operation pending for review.",
      );
    remember({ ...operation, status: "committed" });
    await load();
  }
  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget),
      inputs = {
        username: String(data.get("username") ?? "").trim(),
        display_name: String(data.get("display_name") ?? "").trim(),
      };
    confirm(
      "Create chat bot",
      `Create a new @${inputs.username} bot and reveal its native token once? An existing username is refused.`,
      () => mutate("provision", inputs.username, inputs),
    );
  }
  const disabled =
    busy || !capable || Boolean(pending) || Boolean(storageError);
  return (
    <>
      <section>
        <div className="chat-admin-actions">
          <h4>Hermes connection health</h4>
          <button
            className="btn"
            disabled={busy}
            onClick={() => void perform(load, "Bot health refreshed")}
          >
            Refresh bot health
          </button>
        </div>
        {health ? (
          <>
            <dl className="chat-admin-grid">
              <div>
                <dt>Configured bot token</dt>
                <dd>{health.token_configured ? "Yes" : "No"}</dd>
              </div>
              <div>
                <dt>Bot accounts</dt>
                <dd>{health.bot_count}</dd>
              </div>
              <div>
                <dt>WebSocket connections</dt>
                <dd>{health.websocket_connections}</dd>
              </div>
              <div>
                <dt>Last bot post</dt>
                <dd>
                  {health.last_bot_post_at
                    ? new Date(health.last_bot_post_at).toLocaleString()
                    : "None recorded"}
                </dd>
              </div>
            </dl>
            <ul className="chat-admin-list">
              {health.recent_agent_events.map((event) => (
                <li key={event.id}>
                  <strong>
                    {event.action} · {event.state}
                  </strong>
                  <small>
                    {new Date(event.create_at).toLocaleString()}
                    {event.post_id ? ` · Post ${event.post_id}` : ""}
                  </small>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p>Loading native bot health…</p>
        )}
        <p>{capabilityMessage}</p>
        {storageError ? <p role="alert">{storageError}</p> : null}
      </section>
      {pending ? (
        <section
          className="chat-admin-receipt"
          aria-label="Bot operation receipt"
        >
          <h4>
            {pending.status === "committed"
              ? "Committed operation"
              : "Operation outcome requires reconciliation"}
          </h4>
          <p>
            <code>{pending.id}</code>
          </p>
          <p>
            {pending.action} · {pending.target}
          </p>
          <p>
            {pending.status === "committed"
              ? "The service committed this change. A lost token cannot be recovered from this receipt. After acknowledging the result, use an explicit new rotation if a replacement is needed."
              : "The request will not be repeated. Read the service receipt to establish whether it committed. A missing receipt keeps this operation pending for operator review."}
          </p>
          <div className="chat-admin-actions">
            <button
              className="btn"
              disabled={busy}
              onClick={() =>
                void perform(reconcile, "Committed bot operation verified")
              }
            >
              Reconcile bot operation
            </button>
            {pending.status === "committed" ? (
              <button
                className="btn"
                disabled={busy}
                onClick={() =>
                  confirm(
                    "Acknowledge bot operation",
                    "Confirm you reviewed the committed result and saved any revealed token in protected storage. This clears only the local operation receipt.",
                    async () => {
                      remember(null);
                    },
                  )
                }
              >
                Acknowledge outcome
              </button>
            ) : null}
          </div>
        </section>
      ) : null}
      <form onSubmit={create} className="chat-admin-block">
        <h4>Create a new bot</h4>
        <div className="chat-admin-grid">
          <label className="field">
            Bot username
            <input name="username" pattern="[a-z0-9][a-z0-9._-]+" required />
          </label>
          <label className="field">
            Display name
            <input name="display_name" required />
          </label>
        </div>
        <div>
          <button className="btn" disabled={disabled}>Create chat bot</button>
        </div>
      </form>
      <section className="chat-admin-block">
        <h4>Bot identities and credentials</h4>
        <p>
          Identity edits preserve the token. Rotation revokes the old token
          immediately. Update the owning agent's protected configuration
          separately after a rotation; this console never receives host
          credentials.
        </p>
        <ul className="chat-admin-list">
          {bots.map((bot) => (
            <li key={bot.id} className="chat-admin-row">
              <div>
                <strong>@{bot.username}</strong>
                <small>
                  {bot.display_name} ·{" "}
                  {bot.token_configured
                    ? "Token configured"
                    : "No token configured"}
                </small>
              </div>
              <div className="chat-admin-actions">
                <button className="btn" disabled={busy} onClick={() => setSelected(bot)}>
                  Edit bot identity
                </button>
                <button
                  className="btn btn--danger"
                  disabled={disabled}
                  onClick={() =>
                    confirm(
                      "Rotate bot token",
                      `Revoke the current token for @${bot.username} immediately and reveal one replacement? Existing agent connections will need its new protected credential.`,
                      () => mutate("rotate", bot.user_id, {}),
                    )
                  }
                >
                  Rotate bot token
                </button>
              </div>
            </li>
          ))}
        </ul>
        {!bots.length ? <p>No bots are registered.</p> : null}
      </section>
      {selected ? (
        <form
          key={selected.id}
          className="chat-admin-block"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget),
              bot = selected,
              inputs = {
                username: String(data.get("username") ?? "").trim(),
                display_name: String(data.get("display_name") ?? "").trim(),
              };
            confirm(
              "Update bot identity",
              `Update @${bot.username} without rotating its token?`,
              () => mutate("identity", bot.user_id, inputs),
            );
          }}
        >
          <div className="chat-admin-actions">
            <h4>Edit @{selected.username}</h4>
            <button className="btn" type="button" onClick={() => setSelected(null)}>
              Close bot identity
            </button>
          </div>
          <div className="chat-admin-grid">
            <label className="field">
              Bot username
              <input
                name="username"
                defaultValue={selected.username}
                required
              />
            </label>
            <label className="field">
              Display name
              <input
                name="display_name"
                defaultValue={selected.display_name}
                required
              />
            </label>
          </div>
          <div>
            <button className="btn" disabled={disabled}>Save bot identity</button>
          </div>
        </form>
      ) : null}
    </>
  );
}
