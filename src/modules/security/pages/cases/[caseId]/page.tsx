import { Badge, Panel } from "@ui";
import { checkRouteSegment } from "@security/lib/route-segment";
import { LabCase } from "@security/components/security-fusion/lab-case";
import type { LabRun, LabComparison } from "@security/contracts/index";
import {CaseWorkflow} from "@security/components/security-fusion/case-workflow";
import {
  EvidenceBraid,
  FusionHeader,
} from "@security/components/security-fusion/fusion-ui";
import {
  fusionFetch,
  type FusionCase,
  type FusionEntity,
  type FusionEvent,
} from "@security/lib/security-fusion";
import { SecurityPage, SecurityRecordUnavailable, useSecurityData } from "@security/lib/page-data";
import type { SubRouteProps } from "../../../../../lib/routes";
import { ContainmentPanel } from "@security/components/security-fusion/containment-panel";

interface CaseDetail {
  labRunId: string | null;
  responseAvailable: boolean;
  canApprove: boolean;
  approvalMode: "console" | "external";
  case: FusionCase;
  events: FusionEvent[];
  entities: FusionEntity[];
  activity: Array<{ id: string; kind: string; createdAt: string }>;
  evidence: Array<{
    id: string;
    sourceLocator: string;
    sha256: string;
    preservedAt: string;
  }>;
  investigations: Array<{
    id: string;
    revision: number;
    draft: {summary: string; hypotheses?: string[]; prioritizedChecks?: string[]; evidenceSteps?: string[]; proposedActions?: Array<{description:string;risk:string}>};
    authorId: string;
    createdAt: string;
  }>;
  actions: Array<{
    id: string;
    kind: string;
    status: string;
    createdAt: string;
  }>;
}

async function loadCase(id: string): Promise<{ detail: CaseDetail; lab: LabRun | null; comparison: LabComparison | null }> {
  const caseId = checkRouteSegment(id);
  const detail = await fusionFetch<CaseDetail>(
    `cases/${encodeURIComponent(caseId)}`,
  );
  if (!detail) throw new SecurityRecordUnavailable();
  const lab = detail.labRunId ? await fusionFetch<LabRun>(`lab/runs/${encodeURIComponent(detail.labRunId)}`) : null;
  const comparison = lab?.status === "completed" ? await fusionFetch<LabComparison>(`lab/runs/${encodeURIComponent(lab.id)}/comparison`) : null;
  return { detail, lab, comparison };
}

export default function CasePage({ params }: SubRouteProps): React.ReactElement {
  // The route matcher has decoded the segment once.
  const id = params.caseId ?? "";
  const loaded = useSecurityData(() => loadCase(id), id);
  return <SecurityPage data={loaded}>{(data) => <CaseView {...data} />}</SecurityPage>;
}

function CaseView({ detail, lab, comparison }: { detail: CaseDetail; lab: LabRun | null; comparison: LabComparison | null }): React.ReactElement {
  return (
    <div className="page-stack">
      <FusionHeader
        eyebrow={`${detail.case.severity} · ${Math.round(detail.case.confidence * 100)}% ${lab ? "correlation confidence" : "confidence"}`}
        title={detail.case.title}
        copy={detail.case.summary}
      />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_21.25rem]">
        <div className="page-stack">
          <section className="grid gap-3">
          <h3 className="section-title">Evidence braid</h3>
          <EvidenceBraid events={detail.events} />
          </section>
          {lab ? <>
            <LabCase key={`${lab.id}:${lab.stage}:${lab.latestRevision}:${lab.status}`} run={lab} comparison={comparison} />
            <CaseWorkflow caseId={detail.case.id} eventId={detail.events.at(-1)?.id} preserveOnly />
          </> : <CaseWorkflow caseId={detail.case.id} eventId={detail.events.at(-1)?.id} />}
          <section className="grid gap-3">
            <h3 className="section-title">Saved investigations</h3>
            {detail.investigations.length===0?<p className="text-text-muted">No investigation drafts yet.</p>:detail.investigations.map(item=><Panel as="article" key={item.id} padding="sm" className="gap-2">
              <p className="text-xs text-text-muted">Revision {item.revision} · {item.authorId}</p>
              <p className="whitespace-pre-wrap">{item.draft.summary}</p>
              {[...(item.draft.hypotheses??[]),...(item.draft.prioritizedChecks??[]),...(item.draft.evidenceSteps??[])].map((text,i)=><p key={i} className="text-sm text-text-muted">{text}</p>)}
              {item.draft.proposedActions?.map((action,i)=><p key={i} className="text-sm text-text-muted">Proposed: {action.description} · {action.risk} risk · approval required</p>)}
            </Panel>)}
          </section>
          <section className="grid gap-3">
            <h3 className="section-title">Preserved evidence</h3>
            {detail.evidence.length===0?<p className="text-text-muted">No evidence preserved yet.</p>:detail.evidence.map(item=><p key={item.id} className="code-block break-all">{item.sha256}</p>)}
          </section>
        </div>
        <aside className="page-stack gap-4">
          <Panel title="Affected entities" padding="sm">
            <div className="grid gap-2">
            {detail.entities.map((entity) => (
              <p key={entity.id} className="flex flex-wrap items-center gap-2 text-sm text-text">
                <Badge>{entity.type}</Badge>
                {entity.label}
              </p>
            ))}
            </div>
          </Panel>
          <Panel title="Recommended investigation" padding="sm">
            <ol className="list-decimal space-y-2 pl-4 text-sm text-text-muted">
              {detail.case.recommendedInvestigation.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </Panel>
          {!lab && <ContainmentPanel available={detail.responseAvailable} canApprove={detail.canApprove} approvalMode={detail.approvalMode} caseId={detail.case.id} actions={detail.actions} />}
        </aside>
      </div>
    </div>
  );
}
