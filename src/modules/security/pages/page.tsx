import { Gauge } from "../../../components/gauge";
import { Radar, radarRandom, type RadarBlip } from "../../../components/radar";
import { RouteLink } from "../../../components/route-link";
import { linkTo } from "../../../lib/routes";
import { SecurityPage, useSecurityData } from "@security/lib/page-data";
import {
  CaseTable,
  FusionHeader,
  SourceGrid,
} from "@security/components/security-fusion/fusion-ui";
import {
  fusionFetch,
  labEnabled,
  severityTone,
  type FusionCase,
  type FusionSource,
} from "@security/lib/security-fusion";
import { buttonClass, Panel, StatCard, StatusDot } from "@ui";

interface Overview {
  generatedAt: string;
  openCases: FusionCase[];
  sources: FusionSource[];
  bySeverity: Array<{ severity: string; _count: { id: number } }>;
}

export default function SecurityFusionOverview(): React.ReactElement {
  const loaded = useSecurityData(() => Promise.all([fusionFetch<Overview>("overview"), labEnabled()]), "overview");
  return <SecurityPage data={loaded}>{([data, lab]) => <OverviewView data={data} lab={lab} />}</SecurityPage>;
}

function OverviewView({ data, lab }: { data: Overview; lab: boolean }): React.ReactElement {
  const counts = Object.fromEntries(
    (data?.bySeverity ?? []).map((row) => [row.severity, row._count.id]),
  );
  const sources = data?.sources ?? [];
  const healthySources = sources.filter((source) => source.status === "healthy").length;
  const open = (["critical", "high", "medium", "low"] as const).reduce((total, severity) => total + (counts[severity] ?? 0), 0);
  const worst = counts.critical ? "danger" : counts.high ? "danger" : counts.medium ? "warning" : open ? "info" : "success";
  const cases = data?.openCases ?? [];
  const blips: RadarBlip[] = cases.slice(0, 48).map((item, index) => ({
    key: item.id,
    tone: item.severity === "critical" || item.severity === "high" ? "danger" : item.severity === "medium" ? "warning" : "info",
    distance: item.severity === "critical" ? 0.15 + radarRandom(index + 1) * 0.2 : 0.35 + radarRandom(index + 1) * 0.55,
    angle: radarRandom(index + 200) * 360,
  }));
  const confidence = cases.length ? (cases.reduce((total, item) => total + item.confidence, 0) / cases.length) * 100 : null;
  return (
    <div className="page-stack">
      <FusionHeader
        eyebrow="Security operations"
        title="Cindertrace"
        copy="Investigate security findings, connect related activity, and preserve evidence. Response requires explicit approval."
      />
      {lab ? (
        <Panel as="div" eyebrow="Disposable investigation lab" title="Practice on evolving evidence">
          <p className="text-sm">Follow evolving evidence, revisit your hypotheses and review how your confidence changed.</p>
          <RouteLink className={buttonClass({ className: 'w-fit' })} href={linkTo("cindertrace", "lab")}>Start or resume investigation</RouteLink>
        </Panel>
      ) : null}
      <Panel as="div" className="grid-bg" aria-label="Security posture">
        <div className="hero-row">
          <Radar blips={blips} value={open} unit="open cases" label={`Case radar: ${open} open cases, ${counts.critical ?? 0} critical`} />
          <Gauge value={sources.length ? (healthySources / sources.length) * 100 : null} label="Sources healthy" higherIsBetter display={sources.length ? `${healthySources}/${sources.length}` : undefined} size={150} />
          <Gauge value={confidence} label="Mean confidence" tone={confidence === null ? "neutral" : "accent"} size={150} />
          <div className="hero-trend">
            <span className="stat-label">Posture</span>
            <p className={`data-figure text-2xl font-bold ${worst === "success" ? "glow-text-success text-success" : worst === "danger" ? "glow-text-danger text-danger" : worst === "warning" ? "glow-text-warning text-warning" : "glow-text-info text-info"}`}>
              {open === 0 ? "No open cases" : `${open} open case${open === 1 ? "" : "s"}`}
            </p>
            <span className="flex flex-wrap items-center gap-3 text-xs text-text-muted">
              {(["critical", "high", "medium", "low"] as const).map((severity) => (
                <span key={severity} className="flex items-center gap-1.5">
                  <StatusDot status={counts[severity] ? (severity === "critical" || severity === "high" ? "FAILED" : severity === "medium" ? "DEGRADED" : "PROVISIONING") : "UNKNOWN"} pulse={severity === "critical" && !!counts.critical} />
                  {counts[severity] ?? 0} {severity}
                </span>
              ))}
            </span>
          </div>
        </div>
      </Panel>
      <section className="stats-grid" aria-label="Open cases by severity">
        {(["critical", "high", "medium", "low"] as const).map((severity) => (
          <StatCard
            key={severity}
            label={severity[0]!.toUpperCase() + severity.slice(1)}
            value={counts[severity] ?? 0}
            tone={counts[severity] ? severityTone[severity] : "neutral"}
          />
        ))}
      </section>
      <section className="grid gap-3">
        <h3 className="section-title">Source posture</h3>
        <SourceGrid sources={data?.sources ?? []} />
      </section>
      <section className="grid gap-3">
        <h3 className="section-title">Active cases</h3>
        <CaseTable cases={data?.openCases ?? []} />
      </section>
    </div>
  );
}
