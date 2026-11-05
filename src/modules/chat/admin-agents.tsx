import { useCallback, useEffect, useState, type FormEvent } from "react";
import type {
  ChatAgent,
  ChatSimulation,
} from "../../../contracts/chattermost-admin.generated";
import { adminAPI } from "./admin-api";
import type { AdminControls } from "./admin";
const strings = (value: unknown): string =>
  Array.isArray(value)
    ? value.filter((item) => typeof item === "string").join("\n")
    : "";
const lines = (data: FormData, key: string) =>
  String(data.get(key) ?? "")
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter(Boolean);
export function AgentsAdministration({
  controls: { busy, perform, confirm },
}: {
  controls: AdminControls;
}) {
  const [agents, setAgents] = useState<ChatAgent[]>([]),
    [selected, setSelected] = useState<ChatAgent | null>(null),
    [result, setResult] = useState<ChatSimulation | null>(null);
  const load = useCallback(async () => {
    setAgents(await adminAPI.agents());
  }, []);
  useEffect(() => {
    void perform(load, "");
  }, [load, perform]);
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget),
      current = selected;
    const body = {
      ...(current ? { id: current.id } : {}),
      name: String(data.get("name") ?? "").trim(),
      username: String(data.get("username") ?? "").trim(),
      verified: data.has("verified"),
      permissions: {
        ...current?.permissions,
        post: data.has("post"),
        files: data.has("files"),
        webhooks: data.has("webhooks"),
      },
      channelRouting: {
        ...current?.channelRouting,
        default_channel_id: String(data.get("default_channel") ?? "").trim(),
      },
      userAllowlists: {
        ...current?.userAllowlists,
        users: lines(data, "users"),
      },
      memoryPolicy: {
        ...current?.memoryPolicy,
        no_memory_channels: lines(data, "no_memory"),
        ephemeral_channels: lines(data, "ephemeral"),
      },
    };
    confirm(
      "Save agent registration",
      `Apply the reviewed permissions, routing and memory policy for ${body.name}? This registration does not provision or rotate bot credentials.`,
      async () => {
        setSelected(await adminAPI.saveAgent(body));
        await load();
      },
    );
  }
  return (
    <>
      <section>
        <div className="chat-admin-actions">
          <h4>Registered agents</h4>
          <button disabled={busy} onClick={() => setSelected(null)}>
            New registration
          </button>
          <button
            disabled={busy}
            onClick={() => void perform(load, "Agent registry refreshed")}
          >
            Refresh agents
          </button>
        </div>
        <ul className="chat-admin-list">
          {agents.map((agent) => (
            <li key={agent.id} className="chat-admin-row">
              <div>
                <strong>{agent.name}</strong>
                <small>
                  @{agent.username} ·{" "}
                  {agent.verified ? "Verified" : "Unverified"}
                </small>
              </div>
              <button disabled={busy} onClick={() => setSelected(agent)}>
                Edit registration
              </button>
            </li>
          ))}
        </ul>
        {!agents.length ? <p>No agent registrations exist.</p> : null}
      </section>
      <form
        key={selected?.id ?? "new"}
        onSubmit={save}
        className="chat-admin-block"
      >
        <h4>
          {selected ? "Edit agent registration" : "New agent registration"}
        </h4>
        <div className="chat-admin-grid">
          <label>
            Name
            <input name="name" defaultValue={selected?.name} required />
          </label>
          <label>
            Chat username
            <input name="username" defaultValue={selected?.username} required />
          </label>
          <label>
            Default channel ID
            <input
              name="default_channel"
              defaultValue={
                typeof selected?.channelRouting.default_channel_id === "string"
                  ? selected.channelRouting.default_channel_id
                  : ""
              }
            />
          </label>
          <label className="chat-admin-check">
            <input
              name="verified"
              type="checkbox"
              defaultChecked={selected?.verified ?? false}
            />
            Verified identity
          </label>
          {(["post", "files", "webhooks"] as const).map((key) => (
            <label key={key} className="chat-admin-check">
              <input
                name={key}
                type="checkbox"
                defaultChecked={selected?.permissions[key] !== false}
              />
              Allow {key}
            </label>
          ))}
        </div>
        <div className="chat-admin-grid">
          <label>
            Allowed users, one ID or username per line
            <textarea
              name="users"
              rows={4}
              defaultValue={strings(selected?.userAllowlists.users)}
            />
          </label>
          <label>
            No-memory channels, one ID per line
            <textarea
              name="no_memory"
              rows={4}
              defaultValue={strings(selected?.memoryPolicy.no_memory_channels)}
            />
          </label>
          <label>
            Ephemeral channels, one ID per line
            <textarea
              name="ephemeral"
              rows={4}
              defaultValue={strings(selected?.memoryPolicy.ephemeral_channels)}
            />
          </label>
        </div>
        <div>
          <button disabled={busy}>Save agent registration</button>
        </div>
      </form>
      <section className="chat-admin-block">
        <h4>Policy simulator</h4>
        <p>
          This is the product's current policy preview. Confirm enforcement
          through an authorized agent request before relying on a policy.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget),
              body = {
                agent_id: String(data.get("agent") ?? ""),
                channel_id: String(data.get("channel") ?? ""),
                user_id: String(data.get("user") ?? ""),
                message: String(data.get("message") ?? ""),
              };
            void perform(async () => {
              setResult(await adminAPI.simulate(body));
            }, "Policy preview ready");
          }}
        >
          <div className="chat-admin-grid">
            <label>
              Agent
              <select name="agent" required>
                <option value="">Choose an agent</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Channel ID
              <input name="channel" required />
            </label>
            <label>
              User ID
              <input name="user" required />
            </label>
          </div>
          <label>
            Example message
            <textarea name="message" rows={3} />
          </label>
          <div>
            <button disabled={busy}>Simulate policy</button>
          </div>
        </form>
        {result ? (
          <div className="chat-admin-receipt">
            <strong>
              {result.allowed
                ? "Product preview: allowed"
                : "Product preview: denied"}
            </strong>
            <p>{result.explanation}</p>
            <p>
              Affected users:{" "}
              {result.affected_user_ids.join(", ") || "None reported"}. Visible
              channels:{" "}
              {result.visible_channel_ids.join(", ") || "None reported"}.
            </p>
          </div>
        ) : null}
      </section>
    </>
  );
}
