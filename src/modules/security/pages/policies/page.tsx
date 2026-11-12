import { Badge, Panel } from "@ui";
import { FusionHeader } from "@security/components/security-fusion/fusion-ui";
import { fusionFetch } from "@security/lib/security-fusion";
import { SecurityPage, useSecurityData } from "@security/lib/page-data";

interface Policies {
  eventRetentionDays: number;
  preservedEvidenceDays: number;
  caseArchiveDays: number;
  archiveGraceDays: number;
  deletionReceiptDays: number;
  perCaseCeilings: {
    events: number;
    entities: number;
    relationships: number;
    preservedEvidence: number;
    preservedEvidenceBytes: number;
  };
  approvalTtlMinutes: number;
  allowedActions: string[];
  deniedActions: string[];
  isolation: {
    defaultMinutes: number;
    maximumMinutes: number;
    defaultPolicy: string;
  };
}
export default function PoliciesPage(): React.ReactElement {
  const loaded = useSecurityData(() => fusionFetch<Policies>("policies"), "policies");
  return <SecurityPage data={loaded}>{(policy) => <PolicyView policy={policy} />}</SecurityPage>;
}

function PolicyView({ policy }: { policy: Policies | null }): React.ReactElement {
  const evidenceMiB = Math.round(
    (policy?.perCaseCeilings.preservedEvidenceBytes ?? 8388608) / 1048576,
  );
  return (
    <div className="page-stack">
      <FusionHeader
        eyebrow="Hard safety boundaries"
        title="Policies"
        copy="Policy is descriptive here; expanding executable authority requires a code and deployment review."
      />
      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Panel title="Retention lifecycle">
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm [&_dd]:text-text-strong [&_dt]:text-text-muted">
            <dt>Normalized events</dt>
            <dd>{policy?.eventRetentionDays ?? 90} days</dd>
            <dt>Preserved evidence</dt>
            <dd>{policy?.preservedEvidenceDays ?? 365} days</dd>
            <dt>Case archive</dt>
            <dd>{policy?.caseArchiveDays ?? 365} days</dd>
            <dt>Archive grace</dt>
            <dd>{policy?.archiveGraceDays ?? 30} days</dd>
            <dt>Deletion receipts</dt>
            <dd>{policy?.deletionReceiptDays ?? 2555} days</dd>
          </dl>
        </Panel>
        <Panel title="Per-case ceilings">
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm [&_dd]:text-text-strong [&_dt]:text-text-muted">
            <dt>Correlated events</dt>
            <dd>{policy?.perCaseCeilings.events ?? 1000}</dd>
            <dt>Entities</dt>
            <dd>{policy?.perCaseCeilings.entities ?? 250}</dd>
            <dt>Relationships</dt>
            <dd>{policy?.perCaseCeilings.relationships ?? 50}</dd>
            <dt>Preserved artifacts</dt>
            <dd>{policy?.perCaseCeilings.preservedEvidence ?? 100}</dd>
            <dt>Artifact storage</dt>
            <dd>{evidenceMiB} MiB</dd>
            <dt>Approval token</dt>
            <dd>{policy?.approvalTtlMinutes ?? 10} minutes</dd>
          </dl>
        </Panel>
        <Panel title="Containment boundary">
          <div>
          <Badge tone="success">Available</Badge>
          <p className="mt-2 text-sm text-text-muted">
            {policy?.allowedActions.join(" · ") ??
              "service restart · host isolation"}
          </p>
          </div>
          <div>
          <Badge tone="danger">Unavailable</Badge>
          <p className="mt-2 text-sm text-text-muted">
            {policy?.deniedActions.join(" · ") ??
              "credential rotation · permanent block · arbitrary command"}
          </p>
          </div>
          <p className="text-sm text-text-muted">
            Isolation ceiling: {policy?.isolation.maximumMinutes ?? 30} minutes.
          </p>
        </Panel>
      </div>
    </div>
  );
}
