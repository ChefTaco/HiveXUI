import {
  CollectorRegistry,
  FusionHeader,
  SourceGrid,
} from "@security/components/security-fusion/fusion-ui";
import {
  fusionFetch,
  type FusionCollector,
  type FusionSource,
} from "@security/lib/security-fusion";
import { SecurityPage, useSecurityData } from "@security/lib/page-data";

export default function SourcesPage(): React.ReactElement {
  const loaded = useSecurityData(
    () => Promise.all([fusionFetch<FusionSource[]>("sources"), fusionFetch<FusionCollector[]>("source-registry")]),
    "sources",
  );
  return <SecurityPage data={loaded}>{([sources, collectors]) => (
    <div className="page-stack">
      <FusionHeader
        eyebrow="Security feeds"
        title="Sources"
        copy="Checkpointed, replay-safe ingestion posture for each feed this installation reports."
      />
      <SourceGrid sources={sources ?? []} collectors={collectors ?? []} />
      <section className="grid gap-3">
        <h3 className="section-title">Collector identity registry</h3>
        <CollectorRegistry collectors={collectors ?? []} />
      </section>
    </div>
  )}</SecurityPage>;
}
