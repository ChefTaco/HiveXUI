import { useCallback, useEffect, useState, type FormEvent } from "react";
import type {
  ChatAgent,
  ChatSimulation,
} from "../../../contracts/chattermost-admin.generated";
import { adminAPI } from "./admin-api";
import type { AdminControls } from "./admin";
import { Button } from "@ui";
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
          <Button disabled={busy} onClick={() => setSelected(null)}>
            New registration
          </Button>
          <Button
            disabled={busy}
            onClick={() => void perform(load, "Agent registry refreshed")}
          >
            Refresh agents
          </Button>
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
              <Button disabled={busy} onClick={() => setSelected(agent)}>
                Edit registration
              </Button>
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
          <label className="field">
            Name
            <input name="name" defaultValue={selected?.name} required />
          </label>
          <label className="field">
            Chat username
            <input name="username" defaultValue={selected?.username} required />
          </label>
          <label className="field">
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
          <label className="check-field">
            <input
              name="verified"
              type="checkbox"
              defaultChecked={selected?.verified ?? false}
            />
            Verified identity
          </label>
          {(["post", "files", "webhooks"] as const).map((key) => (
            <label key={key} className="check-field">
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
          <label className="field">
            Allowed users, one ID or username per line
            <textarea
              name="users"
              rows={4}
              defaultValue={strings(selected?.userAllowlists.users)}
            />
          </label>
          <label className="field">
            No-memory channels, one ID per line
            <textarea
              name="no_memory"
              rows={4}
              defaultValue={strings(selected?.memoryPolicy.no_memory_channels)}
            />
          </label>
          <label className="field">
            Ephemeral channels, one ID per line
            <textarea
              name="ephemeral"
              rows={4}
              defaultValue={strings(selected?.memoryPolicy.ephemeral_channels)}
            />
          </label>
        </div>
        <div>
          <Button disabled={busy}>Save agent registration</Button>
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
            <label className="field">
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
            <label className="field">
              Channel ID
              <input name="channel" required />
            </label>
            <label className="field">
              User ID
              <input name="user" required />
            </label>
          </div>
          <label className="field">
            Example message
            <textarea name="message" rows={3} />
          </label>
          <div>
            <Button disabled={busy}>Simulate policy</Button>
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
