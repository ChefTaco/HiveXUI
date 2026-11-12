import type { FormEvent } from "react";
import { securityFetch } from "@security/lib/security-api";
import { FusionHeader } from "@security/components/security-fusion/fusion-ui";
import { SecurityPage, useSecurityData } from "@security/lib/page-data";
import { RouteLink } from "../../../../components/route-link";
import { linkTo, navigateTo, type SubRouteProps } from "../../../../lib/routes";
import { buttonClass, Badge, Button, statusTone, TableFrame } from "@ui";

interface AuditDay {
  verification: {
    state: string;
    legacyEntries: number;
    totalEntries: number;
  };
  events: Array<{
    id: string;
    timestamp: string;
    action: string;
    actorId: string;
    targetId: string;
    verificationState: string;
  }>;
  total: number;
}
/** A day of the audit chain, or null when it is unavailable or access is denied. */
async function loadDay(date: string, page: number): Promise<AuditDay | null> {
  try {
    return (await securityFetch<{ data: AuditDay }>(`security-fusion/audit?date=${date}&page=${page}`)).data;
  } catch {
    return null;
  }
}
const dayLink = (date: string, page: number) => linkTo("cindertrace", "audit", { date, page });

export default function AuditPage({ search }: SubRouteProps) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(search.get("date") ?? "")
    ? search.get("date")!
    : new Date().toISOString().slice(0, 10);
  const page = Math.max(1, Math.min(100, Number(search.get("page")) || 1));
  const loaded = useSecurityData(() => loadDay(date, page), `${date}/${page}`);
  function load(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const chosen = new FormData(event.currentTarget).get("date");
    navigateTo(linkTo("cindertrace", "audit", typeof chosen === "string" && chosen ? { date: chosen } : {}));
  }
  return <SecurityPage data={loaded}>{(data) => {
  if (!data)
    return (
      <div className="page-stack">
        <FusionHeader
          eyebrow="Decision and integrity trail"
          title="Security audit"
          copy="Review security changes and verify the retained audit chain."
        />
        <p role="alert" className="error-banner">
          Audit history is unavailable or access is denied. Integrity is
          unverified.
        </p>
      </div>
    );
    return (
      <div className="page-stack">
        <FusionHeader
          eyebrow="Decision and integrity trail"
          title="Security audit"
          copy="Review security changes and verify the retained audit chain."
        />
        <form className="flex flex-wrap items-end gap-3" onSubmit={load}>
          <label className="field">
            Audit date
            <input
              type="date"
              name="date"
              defaultValue={date}
            />
          </label>
          <Button>Load day</Button>
        </form>
        <p role="status" className="text-text-muted">
          Chain: {data.verification.state} · {data.verification.totalEntries}{" "}
          records · {data.verification.legacyEntries} legacy entries with
          partial integrity
        </p>
        {data.verification.legacyEntries > 0 && (
          <p className="warning-banner">
            Legacy signatures do not protect targets, details, actor type or IP
            address.
          </p>
        )}
        <TableFrame label="Audit records">
          <table className="min-w-[42.5rem]">
            <caption className="sr-only">
              Security audit records for {date}
            </caption>
            <thead>
              <tr>
                {["Time", "Action", "Actor", "Target", "Integrity"].map(
                  (label) => (
                    <th scope="col" key={label}>
                      {label}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {data.events.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap">
                    {new Date(e.timestamp).toLocaleString()}
                  </td>
                  <td>{e.action}</td>
                  <td className="cell-mono cell-long">{e.actorId}</td>
                  <td className="cell-mono cell-long">{e.targetId}</td>
                  <td>
                    <Badge tone={statusTone(e.verificationState)}>{e.verificationState}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableFrame>
        {page > 1 && (
          <RouteLink className={buttonClass()} href={dayLink(date, page - 1)}>Newer records</RouteLink>
        )}{" "}
        {page * 100 < data.total && page < 100 && (
          <RouteLink className={buttonClass()} href={dayLink(date, page + 1)}>Older records</RouteLink>
        )}
      </div>
    );
  }}</SecurityPage>;
}
