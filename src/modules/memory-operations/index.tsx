import "./memory-operations.css";
import { useEffect, useRef, useState } from "react";
import type {
  MemoryProfile,
  Session,
  Webhook,
  Graph,
  WebhookDelivery,
  WebhookDeliveries,
} from "../../../contracts/hivemem.generated";
import { memoryOperations as api } from "../../lib/memory-operations-api";
import { memoryCan } from "../../lib/memory-access";
import { MemoryOperationDraft } from "../../lib/memory-operation-draft";
import {
  Button,
  ConfirmDialog,
  Field,
  JsonBlock,
  Panel,
  TextArea,
  TextInput,
  Toggle,
} from "../../components/ui";

type Tab =
  "sessions" | "webhooks" | "graph" | "conflicts" | "consolidation" | "queue";
const scopes: Record<Tab, string> = {
  sessions: "sessions:read",
  webhooks: "webhooks:read",
  graph: "memories:read",
  conflicts: "memories:read",
  consolidation: "memories:read",
  queue: "queue:read",
};
const labels: Record<Tab, string> = {
  sessions: "Sessions",
  webhooks: "Webhooks",
  graph: "Graph",
  conflicts: "Conflicts",
  consolidation: "Consolidation",
  queue: "Queue",
};
const object = (value: string): Record<string, unknown> => {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw Error("Enter a JSON object.");
  return parsed as Record<string, unknown>;
};
const rows = (value: Record<string, unknown> | null, key: string) =>
  Array.isArray(value?.[key])
    ? (value[key] as unknown[]).filter(
        (row): row is Record<string, unknown> =>
          Boolean(row) && typeof row === "object" && !Array.isArray(row),
      )
    : [];
const text = (value: unknown) => (typeof value === "string" ? value : "");
function initialTab(): Tab {
  const requested = new URLSearchParams(location.search).get("memoryTab");
  return requested && requested in scopes ? (requested as Tab) : "sessions";
}
export default function MemoryOperationsModule({
  profile,
}: {
  profile: MemoryProfile;
}) {
  const [tab, setTab] = useState<Tab>(initialTab),
    [workspace, setWorkspace] = useState(() => {
      const value = new URLSearchParams(location.search).get("workspace");
      return value && value !== "*" ? value : "default";
    });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const lock = useRef(false),
    generation = useRef(0);
  const [sessions, setSessions] = useState<Session[]>([]),
    [session, setSession] = useState<Session | null>(null),
    [sessionTitle, setSessionTitle] = useState(""),
    [sessionMetadata, setSessionMetadata] = useState("{}"),
    [sessionScope, setSessionScope] = useState<"private" | "shared">("private"),
    [sessionHistory, setSessionHistory] = useState<Record<string, unknown>[]>(
      [],
    ),
    [sessionQuery, setSessionQuery] = useState(""),
    [sessionResult, setSessionResult] = useState<unknown>(null),
    [sessionPage, setSessionPage] = useState(0);
  const [webhooks, setWebhooks] = useState<Webhook[]>([]),
    [webhook, setWebhook] = useState<Webhook | null>(null),
    [hookUrl, setHookUrl] = useState(""),
    [hookEvents, setHookEvents] = useState("memory.created"),
    [hookEnabled, setHookEnabled] = useState(true),
    [hookHeaders, setHookHeaders] = useState("{}"),
    [hookMetadata, setHookMetadata] = useState("{}"),
    [hookSecret, setHookSecret] = useState(""),
    [deliveries, setDeliveries] = useState<WebhookDeliveries | null>(null),
    [delivery, setDelivery] = useState<WebhookDelivery | null>(null),
    [deliveryOffset, setDeliveryOffset] = useState(0),
    [testData, setTestData] = useState("{}");
  const [graph, setGraph] = useState<Graph | null>(null),
    [anchor, setAnchor] = useState(""),
    [anchorKind, setAnchorKind] = useState<"memory_id" | "entity_id">(
      "entity_id",
    ),
    [graphDetail, setGraphDetail] = useState<unknown>(null);
  const [conflicts, setConflicts] = useState<Record<string, unknown> | null>(
      null,
    ),
    [consolidation, setConsolidation] = useState<Record<
      string,
      unknown
    > | null>(null),
    [logs, setLogs] = useState<Record<string, unknown> | null>(null),
    [runDetail, setRunDetail] = useState<unknown>(null),
    [memoryIds, setMemoryIds] = useState(""),
    [strategy, setStrategy] = useState("compatibility");
  const pendingOperation = useRef(new MemoryOperationDraft()),
    [receipt, setReceipt] = useState<Record<string, unknown> | null>(null);

  const [queue, setQueue] = useState<Record<string, unknown> | null>(null),
    [queueOffset, setQueueOffset] = useState(0),
    [queueStatus, setQueueStatus] = useState(""),
    [job, setJob] = useState<Record<string, unknown> | null>(null);
  const [confirm, setConfirm] = useState<{
    title: string;
    description: string;
    run: () => Promise<unknown>;
  } | null>(null);
  const can = (permission: string) => memoryCan(profile, permission);
  const current = () => generation.current;
  function remember(key: string, value: string) {
    const url = new URL(location.href);
    url.searchParams.set("memoryTab", tab);
    url.searchParams.set("workspace", workspace);
    value ? url.searchParams.set(key, value) : url.searchParams.delete(key);
    history.replaceState(null, "", url);
  }
  async function action(operation: () => Promise<unknown>, message = "") {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const version = current();
    try {
      await operation();
      if (version === current()) setNotice(message);
    } catch (error) {
      if (version === current())
        setError(
          error instanceof Error ? error.message : "Memory operation failed",
        );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function showSession(value: Session) {
    setSession(value);
    setSessionTitle(value.title ?? "");
    setSessionMetadata(JSON.stringify(value.metadata, null, 2));
    setSessionHistory([]);
    setSessionResult(null);
    remember("session", value.session_id);
  }
  function showWebhook(value: Webhook | null) {
    setWebhook(value);
    setHookUrl(value?.url ?? "");
    setHookEvents(value?.event_types.join(", ") ?? "memory.created");
    setHookEnabled(value?.enabled ?? true);
    setHookHeaders(JSON.stringify(value?.headers ?? {}, null, 2));
    setHookMetadata(JSON.stringify(value?.metadata ?? {}, null, 2));
    setHookSecret("");
    remember("webhook", value?.id ?? "");
  }
  async function refresh() {
    if (!can(scopes[tab])) return;
    const version = current();
    switch (tab) {
      case "sessions": {
        const result = await api.sessions(workspace);
        if (version === current()) setSessions(result);
        break;
      }
      case "webhooks": {
        const [endpoints, history] = await Promise.all([
          api.webhooks(workspace),
          api.deliveries(workspace, deliveryOffset),
        ]);
        if (version === current()) {
          setWebhooks(endpoints);
          setDeliveries(history);
        }
        break;
      }
      case "graph": {
        const result = await api.graph(workspace, anchor, anchorKind);
        if (version === current()) setGraph(result);
        break;
      }
      case "conflicts": {
        const result = await api.conflicts(workspace);
        if (version === current()) setConflicts(result);
        break;
      }
      case "consolidation": {
        const [status, history] = await Promise.all([
          api.consolidationStatus(workspace),
          api.consolidationLogs(workspace),
        ]);
        if (version === current()) {
          setConsolidation(status);
          setLogs(history);
        }
        break;
      }
      case "queue": {
        const result = await api.queue(workspace, queueOffset, queueStatus);
        if (version === current()) setQueue(result);
        break;
      }
    }
  }
  useEffect(() => {
    generation.current++;
    setError("");
    setNotice("");
    setSession(null);
    setWebhook(null);
    setHookSecret("");
    setDelivery(null);
    setGraph(null);
    setGraphDetail(null);
    setConflicts(null);
    setConsolidation(null);
    setLogs(null);
    setQueue(null);
    setJob(null);
    setReceipt(null);
    setSessionPage(0);
    setSessionHistory([]);
    setSessionResult(null);
    const version = current();
    void refresh()
      .then(async () => {
        if (version !== current()) return;
        const params = new URLSearchParams(location.search);
        if (
          tab === "sessions" &&
          can("sessions:read") &&
          params.get("session")
        ) {
          const value = await api.session(params.get("session")!);
          if (version === current() && value.workspace_id === workspace)
            showSession(value);
        }
        if (
          tab === "webhooks" &&
          can("webhooks:read") &&
          params.get("webhook")
        ) {
          const value = await api.webhook(params.get("webhook")!);
          if (version === current() && value.workspace_id === workspace)
            showWebhook(value);
        }
      })
      .catch((error) => {
        if (version === current())
          setError(
            error instanceof Error ? error.message : "Memory data unavailable",
          );
      });
    const url = new URL(location.href);
    url.searchParams.set("memoryTab", tab);
    url.searchParams.set("workspace", workspace);
    history.replaceState(null, "", url);
    return () => {
      generation.current++;
    };
  }, [tab, workspace]);
  useEffect(() => {
    void action(refresh);
  }, [deliveryOffset, queueOffset, queueStatus]);
  function confirmAction(
    title: string,
    description: string,
    run: () => Promise<unknown>,
  ) {
    setConfirm({ title, description, run });
  }
  async function openSession(id: string) {
    const version = current();
    const result = await api.session(id);
    if (version === current()) showSession(result);
  }
  const sessionOwner = Boolean(
    session && session.owner_agent_id === profile.agent_id,
  );
  async function saveWebhook() {
    const headers = object(hookHeaders);
    if (Object.values(headers).some((value) => typeof value !== "string"))
      throw Error("Webhook header values must be strings.");
    const body = {
      url: hookUrl,
      workspace_id: workspace,
      event_types: hookEvents
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      enabled: hookEnabled,
      headers: headers as Record<string, string>,
      metadata: object(hookMetadata),
      ...(hookSecret ? { secret: hookSecret } : {}),
    };
    const result = webhook
      ? await api.updateWebhook(
          webhook.id,
          body as Parameters<typeof api.createWebhook>[0],
        )
      : await api.createWebhook(
          body as Parameters<typeof api.createWebhook>[0],
        );
    setHookSecret("");
    showWebhook(result);
    await refresh();
  }
  async function enqueue() {
    const body = {
      workspace_id: workspace,
      memory_ids: memoryIds.split(/[\s,]+/).filter(Boolean),
      strategy,
    };
    const operationId = pendingOperation.current.prepare(body, () =>
      crypto.randomUUID(),
    );
    const result = await api.consolidate({
      ...body,
      operation_id: operationId,
    });
    setReceipt(result);
    pendingOperation.current.acknowledge();
    await refresh();
  }
  return (
    <section className="memory-operations" aria-label="Memory operations">
      <Panel
        title="Memory operations"
        eyebrow="Sessions, delivery and reasoning"
      >
        <div
          className="inline-actions"
          role="navigation"
          aria-label="Memory operation areas"
        >
          {(Object.keys(scopes) as Tab[]).map((value) => (
            <Button
              key={value}
              variant={tab === value ? "primary" : "ghost"}
              disabled={busy}
              onClick={() => setTab(value)}
              aria-pressed={tab === value}
            >
              {labels[value]}
            </Button>
          ))}
        </div>
        <div className="form-grid form-grid--compact">
          <Field label="Operation workspace">
            <TextInput
              value={workspace}
              onChange={(value) => {
                setWorkspace(value);
                setDeliveryOffset(0);
                setQueueOffset(0);
              }}
              disabled={busy}
            />
          </Field>
        </div>
        <Button
          disabled={busy || !can(scopes[tab])}
          onClick={() => void action(refresh, "Current view refreshed.")}
        >
          Refresh {labels[tab].toLowerCase()}
        </Button>
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        {!can(scopes[tab]) && (
          <p>
            Your product token does not permit {scopes[tab]}. Other memory
            operations remain available.
          </p>
        )}
      </Panel>
      {can(scopes[tab]) && tab === "sessions" && (
        <div className="grid grid--2">
          <Panel title="Session history">
            <p>
              Choose a session to inspect its current memories and build
              source-cited context. Archived sessions remain retained in
              HiveMem.
            </p>
            <div className="stack-list">
              {sessions
                .slice(sessionPage * 25, (sessionPage + 1) * 25)
                .map((value) => (
                  <button
                    key={value.session_id}
                    className="stack-item stack-item--button"
                    disabled={busy}
                    onClick={() =>
                      void action(() => openSession(value.session_id))
                    }
                  >
                    <strong>{value.title || value.session_id}</strong>
                    <span>
                      {value.scope} · {value.updated_at}
                    </span>
                  </button>
                ))}
            </div>
            {!sessions.length && <p>No sessions in this workspace.</p>}
            <div className="inline-actions">
              <Button
                disabled={!sessionPage}
                onClick={() => setSessionPage((value) => value - 1)}
              >
                Previous sessions
              </Button>
              <span>Page {sessionPage + 1}</span>
              <Button
                disabled={(sessionPage + 1) * 25 >= sessions.length}
                onClick={() => setSessionPage((value) => value + 1)}
              >
                Next sessions
              </Button>
            </div>
            <Button
              disabled={busy}
              onClick={() => {
                setSession(null);
                setSessionTitle("");
                setSessionMetadata("{}");
                setSessionHistory([]);
                setSessionResult(null);
                remember("session", "");
              }}
            >
              New session
            </Button>
          </Panel>
          <Panel title={session ? "Session detail" : "Create session"}>
            <Field label="Session title">
              <TextInput
                value={sessionTitle}
                onChange={setSessionTitle}
                disabled={busy}
              />
            </Field>
            {!session && (
              <Field label="Session visibility">
                <select
                  value={sessionScope}
                  onChange={(event) =>
                    setSessionScope(event.target.value as "private" | "shared")
                  }
                >
                  <option value="private">Private</option>
                  <option value="shared">Shared</option>
                </select>
              </Field>
            )}
            <Field label="Session metadata (JSON)">
              <TextArea
                rows={4}
                value={sessionMetadata}
                onChange={setSessionMetadata}
                disabled={busy}
              />
            </Field>
            <div className="inline-actions">
              <Button
                disabled={
                  busy ||
                  !can("sessions:write") ||
                  Boolean(session && !sessionOwner)
                }
                onClick={() =>
                  void action(async () => {
                    const body = {
                      workspace_id: workspace,
                      title: sessionTitle || null,
                      metadata: object(sessionMetadata),
                    };
                    const value = session
                      ? await api.updateSession(session.session_id, body)
                      : await api.createSession({
                          ...body,
                          scope: sessionScope,
                        });
                    showSession(value);
                    await refresh();
                  }, "Session saved.")
                }
              >
                {session ? "Save session" : "Create session"}
              </Button>
              {session && (
                <Button
                  variant="danger"
                  disabled={busy || !sessionOwner || !can("sessions:write")}
                  onClick={() =>
                    confirmAction(
                      "Archive session",
                      "Archive this session? Its underlying memories remain stored.",
                      async () => {
                        await api.deleteSession(session.session_id);
                        setSession(null);
                        setSessionHistory([]);
                        setSessionResult(null);
                        remember("session", "");
                        await refresh();
                      },
                    )
                  }
                >
                  Archive session
                </Button>
              )}
            </div>
            {session && (
              <>
                <JsonBlock value={session} />
                <Button
                  disabled={busy}
                  onClick={() =>
                    void action(async () =>
                      setSessionHistory(
                        await api.sessionMemories(session.session_id),
                      ),
                    )
                  }
                >
                  Load session memories
                </Button>
                <JsonBlock value={sessionHistory} />
                <Field label="Session context query">
                  <TextInput value={sessionQuery} onChange={setSessionQuery} />
                </Field>
                <div className="inline-actions">
                  <Button
                    disabled={busy || !can("sessions:write")}
                    onClick={() =>
                      void action(async () =>
                        setSessionResult(
                          await api.sessionContext(
                            session.session_id,
                            session.workspace_id,
                            sessionQuery,
                          ),
                        ),
                      )
                    }
                  >
                    Build context
                  </Button>
                  <Button
                    disabled={
                      busy || !can("sessions:write") || !sessionQuery.trim()
                    }
                    onClick={() =>
                      void action(async () =>
                        setSessionResult(
                          await api.sessionChat(
                            session.session_id,
                            session.workspace_id,
                            sessionQuery,
                          ),
                        ),
                      )
                    }
                  >
                    Ask session
                  </Button>
                </div>
                <JsonBlock value={sessionResult} />
              </>
            )}
          </Panel>
        </div>
      )}
      {can(scopes[tab]) && tab === "webhooks" && (
        <>
          <div className="grid grid--2">
            <Panel title="Webhook endpoints">
              <Button disabled={busy} onClick={() => showWebhook(null)}>
                New webhook
              </Button>
              <div className="stack-list">
                {webhooks.map((value) => (
                  <button
                    key={value.id}
                    className="stack-item stack-item--button"
                    disabled={busy}
                    onClick={() =>
                      void action(async () =>
                        showWebhook(await api.webhook(value.id)),
                      )
                    }
                  >
                    <strong>{value.url}</strong>
                    <span>
                      {value.enabled ? "Enabled" : "Disabled"} ·{" "}
                      {value.last_status ?? "No delivery"}
                    </span>
                  </button>
                ))}
              </div>
              {!webhooks.length && <p>No endpoints configured.</p>}
            </Panel>
            <Panel title={webhook ? "Edit webhook" : "Create webhook"}>
              <Field label="Webhook URL">
                <TextInput value={hookUrl} onChange={setHookUrl} />
              </Field>
              <Field label="Event types (comma separated)">
                <TextInput value={hookEvents} onChange={setHookEvents} />
              </Field>
              <p className="muted">
                memory.created, session.created, queue.empty, summary.updated,
                peer_card.updated, conflict.detected, webhook.test
              </p>
              <Toggle
                label="Webhook enabled"
                checked={hookEnabled}
                onChange={setHookEnabled}
              />
              <Field label="Webhook headers (JSON)">
                <TextArea
                  value={hookHeaders}
                  onChange={setHookHeaders}
                  rows={3}
                />
              </Field>
              <Field label="Webhook metadata (JSON)">
                <TextArea
                  value={hookMetadata}
                  onChange={setHookMetadata}
                  rows={3}
                />
              </Field>
              <Field
                label="New signing secret"
                hint={
                  webhook?.has_secret
                    ? "A signing secret is configured. Blank preserves it."
                    : "Optional; kept by HiveMem and never returned."
                }
              >
                <input
                  type="password"
                  autoComplete="new-password"
                  value={hookSecret}
                  onChange={(event) => setHookSecret(event.target.value)}
                />
              </Field>
              <div className="inline-actions">
                <Button
                  disabled={busy || !can("webhooks:write") || !hookUrl.trim()}
                  onClick={() => void action(saveWebhook, "Webhook saved.")}
                >
                  Save webhook
                </Button>
                {webhook && (
                  <Button
                    variant="danger"
                    disabled={busy || !can("webhooks:write")}
                    onClick={() =>
                      confirmAction(
                        "Archive webhook",
                        "Disable and archive this endpoint? Delivery history remains available.",
                        async () => {
                          await api.deleteWebhook(webhook.id);
                          showWebhook(null);
                          await refresh();
                        },
                      )
                    }
                  >
                    Archive webhook
                  </Button>
                )}
              </div>
            </Panel>
          </div>
          <Panel title="Webhook tests and delivery history">
            <p>
              A test queues delivery to every enabled endpoint you own in this
              workspace. It does not bypass HiveMem URL policy.
            </p>
            <Field label="Test payload (JSON)">
              <TextArea value={testData} onChange={setTestData} rows={3} />
            </Field>
            <Button
              disabled={busy || !can("webhooks:write")}
              onClick={() =>
                confirmAction(
                  "Send webhook test",
                  "Queue a test event for all your enabled endpoints in this workspace?",
                  async () => {
                    setGraphDetail(
                      await api.testWebhook({
                        workspace_id: workspace,
                        event_type: "webhook.test",
                        data: object(testData),
                      }),
                    );
                    await refresh();
                  },
                )
              }
            >
              Queue test deliveries
            </Button>
            <JsonBlock value={graphDetail} />
            <div className="stack-list">
              {deliveries?.deliveries.map((value) => (
                <button
                  key={value.id}
                  className="stack-item stack-item--button"
                  disabled={busy}
                  onClick={() =>
                    void action(async () =>
                      setDelivery(await api.delivery(value.id)),
                    )
                  }
                >
                  <strong>{value.event_type}</strong>
                  <span>
                    {value.status} · {value.attempts} attempts ·{" "}
                    {value.created_at}
                  </span>
                </button>
              ))}
            </div>
            <div className="inline-actions">
              <Button
                disabled={busy || !deliveryOffset}
                onClick={() =>
                  setDeliveryOffset((value) => Math.max(0, value - 25))
                }
              >
                Previous deliveries
              </Button>
              <span>{deliveries?.total ?? 0} deliveries</span>
              <Button
                disabled={
                  busy || !deliveries || deliveryOffset + 25 >= deliveries.total
                }
                onClick={() => setDeliveryOffset((value) => value + 25)}
              >
                Next deliveries
              </Button>
            </div>
            <JsonBlock value={delivery} />
          </Panel>
        </>
      )}
      {can(scopes[tab]) && tab === "graph" && (
        <Panel title="Knowledge graph">
          <div className="form-grid">
            <Field label="Graph anchor kind">
              <select
                value={anchorKind}
                onChange={(event) =>
                  setAnchorKind(event.target.value as "memory_id" | "entity_id")
                }
              >
                <option value="entity_id">Entity</option>
                <option value="memory_id">Memory</option>
              </select>
            </Field>
            <Field label="Anchor ID (blank for workspace)">
              <TextInput value={anchor} onChange={setAnchor} />
            </Field>
          </div>
          <div className="inline-actions">
            <Button disabled={busy} onClick={() => void action(refresh)}>
              Explore graph
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                void action(async () =>
                  setGraphDetail(await api.graphEntities(workspace)),
                )
              }
            >
              List entities
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                void action(async () =>
                  setGraphDetail(await api.graphRelations(workspace)),
                )
              }
            >
              List relations
            </Button>
          </div>
          <p>
            {graph?.nodes.length ?? 0} nodes · {graph?.edges.length ?? 0}{" "}
            relations. Select an entity for its evidence.
          </p>
          <div className="stack-list">
            {graph?.nodes.map((node) => (
              <button
                key={node.id}
                className="stack-item stack-item--button"
                disabled={busy || node.record_type !== "entity"}
                onClick={() =>
                  void action(async () =>
                    setGraphDetail(await api.graphEntity(node.id, workspace)),
                  )
                }
              >
                <strong>{node.label}</strong>
                <span>
                  {node.record_type} · {node.id}
                </span>
              </button>
            ))}
          </div>
          <JsonBlock value={graph} />
          <JsonBlock value={graphDetail} />
        </Panel>
      )}
      {can(scopes[tab]) && tab === "conflicts" && (
        <Panel title="Unresolved conflicts">
          <p>
            Acknowledge or dismiss a conflict only for a memory you can modify.
            HiveMem validates access to every source.
          </p>
          {rows(conflicts, "results").map((value, index) => (
            <div key={text(value.id) || String(index)}>
              <JsonBlock value={value} />
              <div className="inline-actions">
                {["acknowledge", "dismiss"].map((choice) => (
                  <Button
                    key={choice}
                    disabled={
                      busy ||
                      !can("memories:write") ||
                      !Array.isArray(value.memory_ids) ||
                      !value.memory_ids.length
                    }
                    onClick={() => {
                      const ids = value.memory_ids as string[];
                      confirmAction(
                        "Resolve conflict",
                        `${choice === "dismiss" ? "Dismiss" : "Acknowledge"} this conflict?`,
                        async () => {
                          await api.resolveConflict(
                            ids[0]!,
                            choice as "acknowledge" | "dismiss",
                          );
                          await refresh();
                        },
                      );
                    }}
                  >
                    {choice === "dismiss"
                      ? "Dismiss conflict"
                      : "Acknowledge conflict"}
                  </Button>
                ))}
              </div>
            </div>
          ))}
          {!rows(conflicts, "results").length && (
            <p>No readable unresolved conflicts in this workspace.</p>
          )}
        </Panel>
      )}
      {can(scopes[tab]) && tab === "consolidation" && (
        <div className="grid grid--2">
          <Panel title="Consolidation status">
            <JsonBlock value={consolidation} />
            <Field
              label="Consolidation memory IDs"
              hint="Comma or whitespace separated. Blank selects eligible workspace memories."
            >
              <TextArea value={memoryIds} onChange={setMemoryIds} rows={3} />
            </Field>
            <Field label="Consolidation strategy">
              <TextInput value={strategy} onChange={setStrategy} />
            </Field>
            <Button
              disabled={busy || !can("memories:write")}
              onClick={() =>
                confirmAction(
                  "Enqueue consolidation",
                  "Create a durable consolidation job? Review its output before applying subsequent changes.",
                  enqueue,
                )
              }
            >
              Enqueue consolidation
            </Button>
            <Button
              disabled={
                busy || !pendingOperation.current.id || !can("queue:read")
              }
              onClick={() =>
                void action(async () => {
                  if (pendingOperation.current.id)
                    setReceipt(
                      await api.operation(
                        pendingOperation.current.id,
                        pendingOperation.current.workspace!,
                      ),
                    );
                })
              }
            >
              Inspect pending operation
            </Button>
            {pendingOperation.current.id && (
              <p role="status">
                A request may have reached HiveMem. Retry identical inputs or
                inspect its receipt; a new operation is not created
                automatically.
              </p>
            )}
            <JsonBlock value={receipt} />
          </Panel>
          <Panel title="Consolidation history">
            {rows(logs, "results").map((value, index) => (
              <button
                className="stack-item stack-item--button"
                key={text(value.run_id) || String(index)}
                disabled={busy || !text(value.run_id)}
                onClick={() =>
                  void action(async () =>
                    setRunDetail(
                      await api.consolidationLog(text(value.run_id)),
                    ),
                  )
                }
              >
                <strong>{text(value.run_id)}</strong>
                <span>{text(value.status)}</span>
              </button>
            ))}
            {!rows(logs, "results").length && <p>No runs in this workspace.</p>}
            <JsonBlock value={runDetail} />
          </Panel>
        </div>
      )}
      {can(scopes[tab]) && tab === "queue" && (
        <Panel title="Reasoning queue">
          <Field label="Queue status filter">
            <select
              value={queueStatus}
              onChange={(event) => {
                setQueueStatus(event.target.value);
                setQueueOffset(0);
              }}
            >
              <option value="">All</option>
              {[
                "pending",
                "in_progress",
                "completed",
                "failed",
                "dead_letter",
                "cancelled",
              ].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </Field>
          <Button
            disabled={busy || !can("admin:queue")}
            onClick={() =>
              confirmAction(
                "Run next job",
                "Execute the next eligible job in this workspace?",
                async () => {
                  setJob(await api.runNext(workspace));
                  await refresh();
                },
              )
            }
          >
            Run next job
          </Button>
          <JsonBlock value={queue ? { ...queue, jobs: undefined } : null} />
          {rows(queue, "jobs").map((value) => {
            const id = text(value.id),
              status = text(value.status);
            return (
              <div key={id} className="stack-item">
                <button
                  disabled={busy}
                  onClick={() =>
                    void action(async () => setJob(await api.job(id)))
                  }
                >
                  <strong>{text(value.task_type)}</strong>
                  <span>
                    {status} · {id}
                  </span>
                </button>
                <div className="inline-actions">
                  <Button
                    disabled={
                      busy ||
                      !can("admin:queue") ||
                      !["pending", "failed", "dead_letter"].includes(status)
                    }
                    onClick={() =>
                      confirmAction(
                        "Run job",
                        "Execute this job? Existing unknown outcomes must be reconciled in the owning service.",
                        async () => {
                          setJob(await api.runJob(id));
                          await refresh();
                        },
                      )
                    }
                  >
                    Run job
                  </Button>
                  <Button
                    disabled={
                      busy ||
                      !can("admin:queue") ||
                      !["failed", "dead_letter", "cancelled"].includes(status)
                    }
                    onClick={() =>
                      confirmAction(
                        "Retry job",
                        "Retry this inspected job using its existing durable record?",
                        async () => {
                          setJob(await api.retryJob(id));
                          await refresh();
                        },
                      )
                    }
                  >
                    Retry job
                  </Button>
                  <Button
                    variant="danger"
                    disabled={
                      busy ||
                      !can("admin:queue") ||
                      !["pending", "failed", "dead_letter"].includes(status)
                    }
                    onClick={() =>
                      confirmAction(
                        "Cancel job",
                        "Cancel this job before execution? Started side effects cannot be undone.",
                        async () => {
                          setJob(await api.cancelJob(id));
                          await refresh();
                        },
                      )
                    }
                  >
                    Cancel job
                  </Button>
                </div>
              </div>
            );
          })}
          <div className="inline-actions">
            <Button
              disabled={busy || !queueOffset}
              onClick={() => setQueueOffset((value) => Math.max(0, value - 25))}
            >
              Previous jobs
            </Button>
            <span>Page {queueOffset / 25 + 1}</span>
            <Button
              disabled={busy || rows(queue, "jobs").length < 25}
              onClick={() => setQueueOffset((value) => value + 25)}
            >
              Next jobs
            </Button>
          </div>
          <JsonBlock value={job} />
        </Panel>
      )}
      {confirm && (
        <ConfirmDialog
          open
          title={confirm.title}
          message={confirm.description}
          confirmLabel="Confirm"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const operation = confirm.run;
            setConfirm(null);
            void action(operation, "Operation completed.");
          }}
        />
      )}
    </section>
  );
}
