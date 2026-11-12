import {
  CaseTable,
  FusionHeader,
} from "@security/components/security-fusion/fusion-ui";
import { fusionFetch, type FusionCase } from "@security/lib/security-fusion";
import { SecurityPage, useSecurityData } from "@security/lib/page-data";

export default function CasesPage(): React.ReactElement {
  const loaded = useSecurityData(() => fusionFetch<FusionCase[]>("cases"), "cases");
  return <SecurityPage data={loaded}>{(cases) => (
    <div className="page-stack">
      <FusionHeader
        eyebrow="Correlated work queue"
        title="Cases"
        copy="Stable fingerprints merge related evidence, reopen resolved activity, and escalate material changes without alert-by-alert noise."
      />
      <CaseTable cases={cases ?? []} />
    </div>
  )}</SecurityPage>;
}
