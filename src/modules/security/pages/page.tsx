import { StatCard } from "@ui";
import {
  CaseTable,
  FusionHeader,
  SourceGrid,
} from "@security/components/security-fusion/fusion-ui";
import {
  fusionFetch,
  severityTone,
  type FusionCase,
  type FusionSource,
} from "@security/lib/security-fusion";

export const dynamic = "force-dynamic";

interface Overview {
  generatedAt: string;
  openCases: FusionCase[];
  sources: FusionSource[];
  bySeverity: Array<{ severity: string; _count: { id: number } }>;
}

export default async function SecurityFusionOverview(): Promise<React.ReactElement> {
  const data = await fusionFetch<Overview>("overview");
  const counts = Object.fromEntries(
    (data?.bySeverity ?? []).map((row) => [row.severity, row._count.id]),
  );
  return (
    <div className="page-stack">
      <FusionHeader
        eyebrow="Security operations"
        title="Cindertrace"
        copy="Investigate security findings, connect related activity, and preserve evidence. Response requires explicit approval."
      />
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
