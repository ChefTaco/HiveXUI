import { securityPost,securityFetch } from '@security/lib/security-api';
"use client";

import { useState, useEffect } from "react";
import { Panel } from "@ui";
import { useRouter } from "@security/navigation";

interface ExistingAction {
  id: string;
  kind: string;
  status: string;
  previewSha256?: string;
}

async function post(
  path: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  return securityPost('security-fusion/'+path,body);
}

export function ContainmentPanel({
  caseId,
  actions, available = false, canApprove = false, approvalMode = "console",
}: {
  caseId: string;
  actions: ExistingAction[];
  available?: boolean; canApprove?: boolean; approvalMode?: "console" | "external";
}): React.ReactElement | null {
  const router = useRouter();
  useEffect(() => {
    if (!actions.some(action => ['dispatch_pending','executing','verifying','release_pending','releasing'].includes(action.status))) return;
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [actions, router]);
  const [nodeId, setNodeId] = useState("");
  const [serviceName, setServiceName] = useState("");
  const [kind, setKind] = useState<"service_restart" | "host_isolation">(
    "service_restart",
  );
  const [rationale, setRationale] = useState("");
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);
  const [message, setMessage] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run(label: string, fn: () => Promise<void>): Promise<void> {
    setBusy(true);
    setConfirmed(false);
    setMessage("");
    try {
      await fn();
      setMessage(label);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  if (!available) return null;
  return (
    <Panel title="Containment" padding="sm">
      <p className="text-sm text-text-muted">
        Preview creates no effect. An administrator must explicitly approve the exact response plan before it can execute. Approval expires after ten minutes.
      </p>
      <div className="grid gap-2">
        <select
          aria-label="Response type"
          value={kind}
          onChange={(event) => setKind(event.target.value as typeof kind)}
        >
          <option value="service_restart">Service restart</option>
          <option value="host_isolation">Temporary host isolation</option>
        </select>
        <input
          value={nodeId}
          onChange={(event) => setNodeId(event.target.value)}
          placeholder="Magnus node ID"
        />
        {kind === "service_restart" && (
          <input
            value={serviceName}
            onChange={(event) => setServiceName(event.target.value)}
            placeholder="Allowlisted active unit.service"
          />
        )}
        <textarea
          value={rationale}
          onChange={(event) => setRationale(event.target.value)}
          placeholder="Rationale (minimum 10 characters)"
          className="min-h-20"
        />
        <button
          disabled={busy}
          onClick={() =>
            void run("Preview created", async () =>
              setDraft(
                await post(`cases/${caseId}/actions/preview`, {
                  nodeId,
                  kind,
                  serviceName:
                    kind === "service_restart" ? serviceName : undefined,
                  isolationMinutes: kind === "host_isolation" ? 15 : undefined,
                  rationale,
                }),
              ),
            )
          }
          className="btn btn--primary"
        >
          Preview
        </button>
      </div>
      {draft && (
        <div className="grid gap-2">
          <p className="break-all font-mono text-xs text-text-muted">
            SHA-256 {String(draft["previewSha256"])}
          </p>
          <pre className="code-block">{JSON.stringify(draft["preview"], null, 2)}</pre>
          <button
            disabled={busy}
            onClick={() =>
              void run("Approval requested", async () => {
                const result = await post(
                  `actions/${String(draft["id"])}/request`,
                );
                setDraft(result);
              })
            }
            className="btn justify-self-start"
          >
            Request approval
          </button>
        </div>
      )}
      {draft?.["plan"] != null && <div className="warning-banner grid">
        <h3 className="text-base text-warning">Approve exact response</h3>
        <pre className="code-block">{JSON.stringify(draft["plan"], null, 2)}</pre>
        {approvalMode === "external" ? <p>This installation requires its signed external approval channel.</p> : canApprove && <>
          <label className="check-field"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />I reviewed the target, effect, risks, and rollback for this exact plan.</label>
          <div className="inline-actions"><button disabled={busy || !confirmed} className="btn btn--warning" onClick={() => void run("Decision recorded", async () => {
            const plan = draft["plan"] as Record<string, unknown>;
            await post(`actions/${String(draft["id"])}/approve`, { confirmed: true, planSha256: plan["plan_sha256"], previewSha256: draft["previewSha256"] }); setDraft(null);
          })}>Approve and execute</button>
          <button disabled={busy} className="btn" onClick={() => void run("Response rejected", async () => {
            const plan = draft["plan"] as Record<string, unknown>;
            await post(`actions/${String(draft["id"])}/reject`, { confirmed: true, planSha256: plan["plan_sha256"], previewSha256: draft["previewSha256"] }); setDraft(null);
          })}>Reject</button></div>
        </>}
      </div>}
      {actions
        .filter(
          (action) =>
            action.kind === "host_isolation" &&
            ["executing", "succeeded", "unknown"].includes(action.status),
        )
        .map((action) => (
          <button
            key={action.id}
            disabled={busy}
            onClick={() =>
              void run("Emergency release queued", async () => {
                await post(`actions/${action.id}/release`);
              })
            }
            className="btn btn--danger justify-self-start"
          >
            Release isolation {action.id.slice(-6)}
          </button>
        ))}
      {actions
        .filter((action) =>
          ["previewed", "pending_approval"].includes(action.status),
        )
        .map((action) => (
          <div key={action.id} className="inline-actions">
            <button disabled={busy} onClick={() => void run("Response ready for review; no action executed", async () => {
              if (action.status === "previewed") setDraft(await post(`actions/${action.id}/request`));
              else {
                const result = await securityFetch<{data:unknown}>(`security-fusion/approval-plans/${encodeURIComponent(`containment:${action.id}`)}`);
                setDraft({ id: action.id, previewSha256: action.previewSha256, plan: result.data });
              }
            })} className="btn">
              Review response {action.id.slice(-6)}
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void run("Pending action cancelled", async () => {
                  await post(`actions/${action.id}/cancel`);
                })
              }
              className="btn btn--ghost"
            >
              Cancel {action.id.slice(-6)}
            </button>
          </div>
        ))}
      {actions.length > 0 && <div className="stack-list" aria-label="Action history">
        {actions.map(action => <div key={action.id} className="stack-item flex-col items-start gap-1 text-sm text-text-muted">
          <p>{action.kind.replaceAll('_', ' ')} · {action.status.replaceAll('_', ' ')} · {action.id.slice(-6)}</p>
          {action.status === 'unknown' && <p className="text-warning">Execution outcome unknown. Verify the target before creating another action.</p>}
        </div>)}
      </div>}
      {message && <p className="text-sm text-text-muted">{message}</p>}
    </Panel>
  );
}
