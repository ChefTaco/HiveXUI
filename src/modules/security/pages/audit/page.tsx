import { securityFetch } from "@security/lib/security-api";
import { FusionHeader } from "@security/components/security-fusion/fusion-ui";
import { buttonClass, Badge, Button, statusTone, TableFrame } from "@ui";
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; page?: string }>;
}) {
  const params = await searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? "")
    ? params.date!
    : new Date().toISOString().slice(0, 10);
  const page = Math.max(1, Math.min(100, Number(params.page) || 1));
  try {
    const { data } = await securityFetch<{
      data: {
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
      };
    }>(`security-fusion/audit?date=${date}&page=${page}`);
    return (
      <div className="page-stack">
        <FusionHeader
          eyebrow="Decision and integrity trail"
          title="Audit"
          copy="Review security changes and verify the retained audit chain."
        />
        <form className="flex flex-wrap items-end gap-3">
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
          <a className={buttonClass()} href={`?date=${date}&page=${page - 1}`}>Newer records</a>
        )}{" "}
        {page * 100 < data.total && page < 100 && (
          <a className={buttonClass()} href={`?date=${date}&page=${page + 1}`}>Older records</a>
        )}
      </div>
    );
  } catch {
    return (
      <div className="page-stack">
        <FusionHeader
          eyebrow="Decision and integrity trail"
          title="Audit"
          copy="Review security changes and verify the retained audit chain."
        />
        <p role="alert" className="error-banner">
          Audit history is unavailable or access is denied. Integrity is
          unverified.
        </p>
      </div>
    );
  }
}
