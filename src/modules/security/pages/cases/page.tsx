import {
  CaseTable,
  FusionHeader,
} from "@security/components/security-fusion/fusion-ui";
import { fusionFetch, type FusionCase } from "@security/lib/security-fusion";

export const dynamic = "force-dynamic";

export default async function CasesPage(): Promise<React.ReactElement> {
  const cases = await fusionFetch<FusionCase[]>("cases");
  return (
    <div className="page-stack">
      <FusionHeader
        eyebrow="Correlated work queue"
        title="Cases"
        copy="Stable fingerprints merge related evidence, reopen resolved activity, and escalate material changes without alert-by-alert noise."
      />
      <CaseTable cases={cases ?? []} />
    </div>
  );
}
