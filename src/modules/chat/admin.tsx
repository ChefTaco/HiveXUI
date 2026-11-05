import { useCallback, useEffect, useRef, useState } from "react";
import type { MattermostUser } from "../../../contracts/chattermost.generated";
import { ConfirmDialog } from "../../components/ui";
import { UsersAdministration } from "./admin-users";
import {
  SettingsAdministration,
  SupervisionAdministration,
} from "./admin-settings";
import { AgentsAdministration } from "./admin-agents";
import { BotsAdministration } from "./admin-bots";
import "./admin.css";
export type AdminControls = {
  busy: boolean;
  perform: (work: () => Promise<void>, message: string) => Promise<boolean>;
  confirm: (label: string, message: string, work: () => Promise<void>) => void;
  reveal: (label: string, value: string) => void;
};
const sections = [
  "users",
  "system",
  "supervision",
  "agents",
  "hermes",
] as const;
type Section = (typeof sections)[number];
const names: Record<Section, string> = {
  users: "People and invites",
  system: "System and emoji",
  supervision: "Supervision",
  agents: "Agent registry",
  hermes: "Hermes and bots",
};
const selectedSection = (): Section => {
  const value = new URLSearchParams(location.search).get("chatAdmin");
  return sections.includes(value as Section) ? (value as Section) : "users";
};
export default function ChatAdministration({
  user,
}: {
  user: Pick<MattermostUser, "id" | "roles">;
}) {
  if (!user.roles.split(" ").includes("system_admin")) return null;
  return <ConnectedAdministration key={user.id} owner={user.id} />;
}
function ConnectedAdministration({ owner }: { owner: string }) {
  const [section, setSection] = useState<Section>(selectedSection);
  const [open, setOpen] = useState(() =>
    new URLSearchParams(location.search).has("chatAdmin"),
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [secret, setSecret] = useState<{ label: string; value: string } | null>(
    null,
  );
  const [review, setReview] = useState<{
    label: string;
    message: string;
    work: () => Promise<void>;
  } | null>(null);
  const mounted = useRef(true),
    currentSection = useRef(section),
    gate = useRef(false);
  currentSection.current = section;
  useEffect(() => {
    mounted.current = true;
    const sync = () => {
      setSection(selectedSection());
      setOpen(new URLSearchParams(location.search).has("chatAdmin"));
    };
    window.addEventListener("popstate", sync);
    return () => {
      mounted.current = false;
      window.removeEventListener("popstate", sync);
    };
  }, []);
  useEffect(() => {
    setSecret(null);
    setReview(null);
    setError("");
    setMessage("");
  }, [section, open]);
  useEffect(() => {
    if (!secret) return;
    const timer = setTimeout(() => setSecret(null), 90000);
    const hide = () => {
      if (document.hidden) setSecret(null);
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [secret]);
  const perform = useCallback(
    async (work: () => Promise<void>, success: string) => {
      if (gate.current) return false;
      gate.current = true;
      setBusy(true);
      setError("");
      setMessage("");
      const captured = currentSection.current;
      try {
        await work();
        if (mounted.current && currentSection.current === captured)
          setMessage(success);
        return true;
      } catch (reason) {
        if (mounted.current)
          setError(
            reason instanceof Error
              ? reason.message
              : "Chat could not complete this request",
          );
        return false;
      } finally {
        gate.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    [],
  );
  const controls: AdminControls = {
    busy,
    perform,
    confirm: (label, text, work) => {
      setSecret(null);
      setReview({ label, message: text, work });
    },
    reveal: (label, value) => {
      if (mounted.current && currentSection.current === section)
        setSecret({ label, value });
    },
  };
  const choose = (next: Section) => {
    if (busy) return;
    const url = new URL(location.href);
    url.searchParams.set("chatAdmin", next);
    history.replaceState(null, "", url);
    setSection(next);
    setOpen(true);
  };
  return (
    <section className="chat-admin" aria-label="Chat administration">
      <header>
        <div>
          <p className="panel-eyebrow">ChatterMost · administration</p>
          <h2>Manage your chat installation</h2>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          {open ? "Close administration" : "Open administration"}
        </button>
      </header>
      {open ? (
        <div className="chat-admin-layout">
          <nav aria-label="Chat administration sections">
            {sections.map((value) => (
              <button
                key={value}
                type="button"
                disabled={busy}
                aria-pressed={value === section}
                onClick={() => choose(value)}
              >
                {names[value]}
              </button>
            ))}
          </nav>
          <div className="chat-admin-content">
            <h3>{names[section]}</h3>
            {error ? (
              <p role="alert" className="error-banner">
                {error}
              </p>
            ) : null}
            {message ? (
              <p role="status" className="chat-admin-status">
                {message}
              </p>
            ) : null}
            {secret ? (
              <section className="chat-admin-secret" aria-label={secret.label}>
                <h4>{secret.label}</h4>
                <p>
                  Save this value in protected storage. It clears when you leave
                  this section or hide the page.
                </p>
                <textarea
                  readOnly
                  aria-label={secret.label + " value"}
                  value={secret.value}
                  rows={3}
                  autoComplete="off"
                  spellCheck={false}
                />
                <div className="chat-admin-actions">
                  <button
                    type="button"
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(secret.value)
                        .catch(() =>
                          setError(
                            "Copy was unavailable; select the value to copy it securely",
                          ),
                        )
                    }
                  >
                    Copy value
                  </button>
                  <button type="button" onClick={() => setSecret(null)}>
                    Clear value
                  </button>
                </div>
              </section>
            ) : null}
            {section === "users" ? (
              <UsersAdministration controls={controls} owner={owner} />
            ) : section === "system" ? (
              <SettingsAdministration controls={controls} />
            ) : section === "supervision" ? (
              <SupervisionAdministration controls={controls} />
            ) : section === "agents" ? (
              <AgentsAdministration controls={controls} />
            ) : (
              <BotsAdministration controls={controls} owner={owner} />
            )}
          </div>
        </div>
      ) : null}
      <ConfirmDialog
        open={review !== null}
        title={review?.label ?? ""}
        message={review?.message ?? ""}
        confirmLabel={review?.label ?? "Confirm"}
        loading={busy}
        onCancel={() => {
          if (!busy) setReview(null);
        }}
        onConfirm={() => {
          const action = review;
          if (!action) return;
          setReview(null);
          void perform(action.work, action.label + " completed");
        }}
      />
    </section>
  );
}
