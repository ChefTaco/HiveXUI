import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  chatPrivacyKeys,
  chatSupervisionModes,
  type ChatPrivacy,
  type ChatCustomEmoji,
  type ChatSupervisionPolicy,
  type ChatSupervisionEvent,
} from "../../../contracts/chattermost-admin.generated";
import { adminAPI } from "./admin-api";
import type { AdminControls } from "./admin";
const labels: Record<(typeof chatPrivacyKeys)[number], string> = {
  EnableTelemetry: "Telemetry",
  EnableDiagnostics: "Diagnostics",
  EnableSecurityAlerts: "Security alerts",
  ShowEmailAddress: "Show email addresses",
  ShowFullName: "Show full names",
  EnableFileAttachments: "File attachments",
  EnablePublicFileLinks: "Public file links",
  EnableCustomEmoji: "Custom emoji",
  EnableBotAccountCreation: "Bot account creation",
};
export function SettingsAdministration({
  controls: { busy, perform, confirm },
}: {
  controls: AdminControls;
}) {
  const [privacy, setPrivacy] = useState<ChatPrivacy | null>(null),
    [emoji, setEmoji] = useState<ChatCustomEmoji[]>([]);
  const load = useCallback(async () => {
    const [configuration, values] = await Promise.all([
      adminAPI.configuration(),
      adminAPI.emoji(),
    ]);
    setPrivacy(configuration.PrivacySettings);
    setEmoji(values);
  }, []);
  useEffect(() => {
    void perform(load, "");
  }, [load, perform]);
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!privacy) return;
    const values = { ...privacy };
    confirm(
      "Save privacy settings",
      "Apply these installation-wide Chat settings? Public links and profile visibility affect everyone.",
      async () => {
        setPrivacy((await adminAPI.privacy(values)).PrivacySettings);
      },
    );
  }
  return (
    <>
      <form onSubmit={save}>
        <h4>Privacy and capabilities</h4>
        {privacy ? (
          <>
            <div className="chat-admin-grid">
              {chatPrivacyKeys.map((key) => (
                <label key={key} className="check-field">
                  <input
                    type="checkbox"
                    checked={privacy[key]}
                    onChange={(event) =>
                      setPrivacy({ ...privacy, [key]: event.target.checked })
                    }
                  />
                  {labels[key]}
                </label>
              ))}
            </div>
            <div>
              <button className="btn" disabled={busy}>Save privacy settings</button>
            </div>
          </>
        ) : (
          <p>Loading product settings…</p>
        )}
      </form>
      <section className="chat-admin-block">
        <h4>Custom emoji</h4>
        {privacy && !privacy.EnableCustomEmoji ? (
          <p>Custom emoji are disabled in this installation.</p>
        ) : null}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget,
              data = new FormData(form),
              body = {
                name: String(data.get("name") ?? "").trim(),
                emoji: String(data.get("emoji") ?? "").trim(),
              };
            void perform(async () => {
              await adminAPI.addEmoji(body);
              form.reset();
              await load();
            }, "Custom emoji added");
          }}
        >
          <div className="chat-admin-grid">
            <label className="field">
              Short name
              <input name="name" pattern="[a-zA-Z0-9_+-]+" required />
            </label>
            <label className="field">
              Emoji character
              <input name="emoji" required maxLength={32} />
            </label>
          </div>
          <div>
            <button className="btn" disabled={busy || !privacy?.EnableCustomEmoji}>
              Add custom emoji
            </button>
          </div>
        </form>
        <ul className="chat-admin-list">
          {emoji
            .filter((value) => !value.delete_at)
            .map((value) => (
              <li className="chat-admin-row" key={value.id}>
                <span>
                  <span aria-hidden="true">{value.emoji}</span> :{value.name}:
                </span>
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() =>
                    confirm(
                      "Remove custom emoji",
                      `Remove :${value.name}: from this installation?`,
                      async () => {
                        await adminAPI.removeEmoji(value.id);
                        await load();
                      },
                    )
                  }
                >
                  Remove emoji
                </button>
              </li>
            ))}
        </ul>
        {!emoji.length ? <p>No custom emoji are configured.</p> : null}
      </section>
    </>
  );
}
export function SupervisionAdministration({
  controls: { busy, perform, confirm },
}: {
  controls: AdminControls;
}) {
  const [policy, setPolicy] = useState<ChatSupervisionPolicy | null>(null),
    [events, setEvents] = useState<ChatSupervisionEvent[]>([]);
  const [terms, setTerms] = useState("");
  const load = useCallback(async () => {
    const [current, history] = await Promise.all([
      adminAPI.supervision(),
      adminAPI.supervisionEvents(),
    ]);
    setPolicy(current);
    setTerms(current.blockedTerms.join("\n"));
    setEvents(history);
  }, []);
  useEffect(() => {
    void perform(load, "");
  }, [load, perform]);
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!policy) return;
    const body = {
      ...policy,
      blockedTerms: terms
        .split("\n")
        .map((term) => term.trim())
        .filter(Boolean),
    };
    confirm(
      "Save supervision policy",
      `Apply ${policy.mode.replaceAll("_", " ")} and the reviewed blocked terms? Existing restriction rules are preserved.`,
      async () => {
        await adminAPI.updateSupervision(body);
        await load();
      },
    );
  }
  return (
    <>
      <form onSubmit={save}>
        <h4>Message supervision</h4>
        {policy ? (
          <>
            <label className="field">
              Mode
              <select
                value={policy.mode}
                onChange={(event) =>
                  setPolicy({
                    ...policy,
                    mode: event.target.value as ChatSupervisionPolicy["mode"],
                  })
                }
              >
                {chatSupervisionModes.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Blocked terms, one per line
              <textarea
                value={terms}
                rows={5}
                onChange={(event) => setTerms(event.target.value)}
              />
            </label>
            <p>
              Channel, user, agent and file restrictions remain owned by the
              existing product policy.
            </p>
            <div>
              <button className="btn" disabled={busy}>Save supervision policy</button>
            </div>
          </>
        ) : (
          <p>Loading supervision policy…</p>
        )}
      </form>
      <section className="chat-admin-block">
        <div className="chat-admin-actions">
          <h4>Review and history</h4>
          <button
            className="btn"
            disabled={busy}
            onClick={() => void perform(load, "Supervision history refreshed")}
          >
            Refresh history
          </button>
        </div>
        <ul className="chat-admin-list">
          {events.map((value) => (
            <li key={value.id} className="chat-admin-row">
              <div>
                <strong>
                  {value.action} · {value.state}
                </strong>
                <small>
                  {new Date(value.createAt).toLocaleString()} ·{" "}
                  {value.channelId
                    ? `Channel ${value.channelId}`
                    : "Installation event"}
                  {value.postId ? ` · Post ${value.postId}` : ""}
                </small>
              </div>
              {value.postId &&
              ["submitted", "quarantined"].includes(value.state) ? (
                <div className="chat-admin-actions">
                  {(["approved", "rejected"] as const).map((decision) => (
                    <button
                      className="btn"
                      key={decision}
                      disabled={busy}
                      onClick={() =>
                        confirm(
                          decision === "approved"
                            ? "Approve message"
                            : "Reject message",
                          `${decision === "approved" ? "Release" : "Reject"} post ${value.postId}? Review the original conversation before deciding.`,
                          async () => {
                            await adminAPI.moderate(value.postId!, decision);
                            await load();
                          },
                        )
                      }
                    >
                      {decision === "approved"
                        ? "Approve message"
                        : "Reject message"}
                    </button>
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        {!events.length ? <p>No supervision events are available.</p> : null}
      </section>
    </>
  );
}
