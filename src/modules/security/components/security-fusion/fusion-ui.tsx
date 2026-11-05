import { ScanSearch } from "lucide-react";
import { cn } from "@lib/cn";
import { Badge, EmptyState as SharedEmptyState, Meter, PageHeader, Panel, StatusDot, TableFrame, type Tone } from "@ui";
import Link from "@security/navigation";
import { productInstalled } from "@lib/runtime";
import { mergeSourceAliases, severityTone, sourceLabel, sourceRelevant } from "@security/lib/security-fusion";
import type { FusionCase, FusionCollector, FusionEvent, FusionSource } from "@security/lib/security-fusion";

export function FusionHeader({ eyebrow, title, copy }: { eyebrow: string; title: string; copy: string }): React.ReactElement {
  return <PageHeader eyebrow={eyebrow} title={title} description={copy} />;
}

export function EmptyState({ children }: { children: React.ReactNode }): React.ReactElement {
  return <SharedEmptyState framed icon={<ScanSearch />} title="Nothing to show" message={children} />;
}

/** Severity shown as a badge; critical is the one solid fill, so it stands out in a list. */
export function SeverityBadge({ severity, className }: { severity: FusionCase["severity"]; className?: string }): React.ReactElement {
  return (
    <Badge tone={severityTone[severity]} className={cn(severity === "critical" && "badge--solid-danger glow-danger", className)}>
      {severity}
    </Badge>
  );
}

const SEVERITY_RAIL: Record<FusionCase["severity"], string> = {
  info: "border-l-border-strong",
  low: "border-l-info",
  medium: "border-l-warning",
  high: "border-l-danger",
  critical: "border-l-danger bg-danger-soft",
};

function confidenceTone(confidence: number): Tone {
  return confidence >= 0.8 ? "accent" : confidence >= 0.5 ? "warning" : "neutral";
}

export function CaseTable({ cases }: { cases: FusionCase[] }): React.ReactElement {
  if (!cases.length)
    return <EmptyState>No correlated cases yet. Source observations remain quiet until a deterministic rule has enough evidence.</EmptyState>;
  return (
    <Panel as="div" padding="none" className="gap-0 overflow-hidden">
      {cases.map((item) => (
        <Link
          key={item.id}
          href={`/security-fusion/cases/${item.id}`}
          prefetch={false}
          className={cn(
            "grid items-center gap-3 border-b border-l-[3px] border-b-border p-4 text-text transition-colors last:border-b-0 hover:bg-surface-hover md:grid-cols-[6.5rem_1fr_11rem_7rem]",
            SEVERITY_RAIL[item.severity],
          )}
        >
          <SeverityBadge severity={item.severity} className="w-fit" />
          <span className="min-w-0">
            <strong className="block truncate text-base text-text-strong">{item.title}</strong>
            <span className="mt-1 line-clamp-1 block text-sm text-text-muted">{item.summary}</span>
          </span>
          <Meter
            value={item.confidence * 100}
            tone={confidenceTone(item.confidence)}
            label={`${item.title} confidence`}
            valueLabel={`${Math.round(item.confidence * 100)}% conf.`}
          />
          <span className="text-sm text-text-muted md:text-right">{item.status}</span>
        </Link>
      ))}
    </Panel>
  );
}

export function EvidenceBraid({ events }: { events: FusionEvent[] }): React.ReactElement {
  if (!events.length) return <EmptyState>No event lanes are attached to this case.</EmptyState>;
  return (
    <Panel as="div" className="relative overflow-hidden">
      <div className="absolute inset-y-0 left-8 w-px bg-border-strong sm:left-1/2" />
      <div className="space-y-3">
        {events.map((event, index) => (
          <div key={event.id} className={`relative grid grid-cols-[1.25rem_minmax(0,1fr)] items-center sm:grid-cols-[minmax(0,1fr)_1.75rem_minmax(0,1fr)] ${index % 2 ? "" : "sm:text-right"}`}>
            <div className={cn("col-start-2 min-w-0 rounded-control border border-border bg-surface-raised px-3 py-2 break-words", index % 2 ? "sm:col-start-3" : "sm:col-start-1")}>
              <p className="text-xs text-text-muted">
                {sourceLabel(event.source)} · {new Date(event.observedAt).toLocaleString()}
              </p>
              <p className="mt-1 text-sm text-text">{event.summary}</p>
              <p className="num mt-1 text-xs text-text-muted">{Math.round((event.confidenceContribution ?? event.confidence) * 100)}% confidence contribution</p>
            </div>
            <span className="relative col-start-1 row-start-1 mx-auto flex h-3 w-3 items-center justify-center sm:col-start-2">
              <span className="glow-accent relative h-2.5 w-2.5 rounded-full bg-accent" />
            </span>
          </div>
        ))}
      </div>
      <div className="glow-accent relative mx-auto w-fit rounded-control border border-accent bg-accent-soft px-4 py-2 text-center text-sm font-semibold text-accent">Correlated case</div>
    </Panel>
  );
}

const STALE_MS = 15 * 60 * 1000;

export function SourceGrid({ sources, collectors }: { sources: FusionSource[]; collectors?: FusionCollector[] }): React.ReactElement {
  const shown = sources.filter((source) => sourceRelevant(source, productInstalled, collectors));
  const hidden = [...new Set(sources.filter((source) => !shown.includes(source)).map((source) => sourceLabel(source.source)))];
  return (
    <div className="grid gap-3">
    {shown.length ? (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {mergeSourceAliases(shown).map((source) => {
        const healthy = source.status === "healthy";
        const lastSuccess = source.lastSuccessAt ? Date.parse(source.lastSuccessAt) : null;
        const stale = lastSuccess === null || Date.now() - lastSuccess > STALE_MS;
        return (
          <Panel key={source.source} as="div" padding="sm" tone={healthy ? undefined : "warning"} glow={healthy ? "success" : "warning"} className="gap-2">
            <div className="flex items-center justify-between gap-2">
              <strong className="text-sm text-text-strong">{sourceLabel(source.source)}</strong>
              <StatusDot status={healthy ? "HEALTHY" : source.status === "error" ? "ERROR" : "DEGRADED"} label={source.status} />
            </div>
            <p className={cn("text-sm font-medium", healthy ? "text-success" : "text-warning")}>{source.status}</p>
            <p className={cn("text-xs", stale ? "text-warning" : "text-text-muted")}>Last successful poll: {source.lastSuccessAt ? new Date(source.lastSuccessAt).toLocaleString() : "Never"}</p>
            <p className="text-xs text-text-muted">Last event: {source.lastEventAt ? new Date(source.lastEventAt).toLocaleString() : "No evidence received"}</p>
            {source.lastError && <p className="line-clamp-2 text-xs text-danger">{source.lastError}</p>}
          </Panel>
        );
      })}
    </div>
    ) : (
      <EmptyState>No source has reported its posture yet.</EmptyState>
    )}
    {hidden.length ? (
      <p className="text-sm text-text-muted">Not configured here, so not shown: {hidden.join(", ")}. A feed appears once a collector is allowed to send it or it reports data.</p>
    ) : null}
    </div>
  );
}

export function CollectorRegistry({ collectors }: { collectors: FusionCollector[] }): React.ReactElement {
  if (!collectors.length) return <EmptyState>No collector identity has completed an authenticated receipt.</EmptyState>;
  return (
    <TableFrame label="Collector identity records" className="max-h-[70vh]">
      <table className="min-w-[47.5rem]">
        <thead>
          <tr>
            <th>Identity</th>
            <th>Allowed sources</th>
            <th>Schema</th>
            <th>Classification</th>
            <th>Cursor health</th>
            <th>Last receipt</th>
          </tr>
        </thead>
        <tbody>
          {collectors.map((collector) => (
            <tr key={collector.id}>
              <td>
                <strong className="flex items-center gap-2 text-text-strong">
                  <StatusDot status={collector.revokedAt ? "FAILED" : collector.status === "active" ? "ACTIVE" : collector.status} />
                  {collector.displayName}
                </strong>
                <span className="row-sub mono">
                  {collector.id} · {collector.status}
                </span>
              </td>
              <td className="text-text-muted">{[...new Set(collector.allowedSources.map(sourceLabel))].join(", ")}</td>
              <td className="num text-text-muted">{collector.schemaVersion}</td>
              <td className="text-text-muted">{collector.dataClassification}</td>
              <td>
                <Badge tone={collector.cursorHealth === "healthy" || collector.cursorHealth === "ok" ? "success" : collector.cursorHealth === "unknown" ? "neutral" : "warning"} dot>
                  {collector.cursorHealth}
                </Badge>
              </td>
              <td className="num text-xs text-text-muted">{collector.lastReceiptAt ? new Date(collector.lastReceiptAt).toLocaleString() : "Never"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableFrame>
  );
}
