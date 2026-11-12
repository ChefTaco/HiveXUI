import { Badge, TableFrame } from "@ui";
import {
  EmptyState,
  FusionHeader,
} from "@security/components/security-fusion/fusion-ui";
import {
  fusionFetch,
  severityTone,
  sourceLabel,
  type FusionEvent,
} from "@security/lib/security-fusion";
import { SecurityPage, useSecurityData } from "@security/lib/page-data";

export default function EventsPage(): React.ReactElement {
  const loaded = useSecurityData(() => fusionFetch<FusionEvent[]>("events?limit=100"), "events");
  return <SecurityPage data={loaded}>{(events) => (
    <div className="page-stack">
      <FusionHeader
        eyebrow="Normalized observations"
        title="Events"
        copy="Sanitized metadata only. DNS and flow records are summaries; Security Fusion captures no packets."
      />
      {!events?.length ? (
        <EmptyState>No normalized events received.</EmptyState>
      ) : (
        <TableFrame label="Security event records">
          <table className="min-w-[47.5rem]">
            <thead>
              <tr>
                <th>Time</th>
                <th>Source</th>
                <th>Kind</th>
                <th>Summary</th>
                <th>Confidence</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td className="num whitespace-nowrap text-xs text-text-muted">
                    {new Date(event.observedAt).toLocaleString()}
                  </td>
                  <td>{sourceLabel(event.source)}</td>
                  <td>{event.kind}</td>
                  <td className="max-w-md text-text-muted">
                    {event.summary}
                  </td>
                  <td>
                    <Badge tone={severityTone[event.severity]}>{Math.round(event.confidence * 100)}%</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableFrame>
      )}
    </div>
  )}</SecurityPage>;
}
