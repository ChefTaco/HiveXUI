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

export const dynamic = "force-dynamic";

export default async function SourcesPage(): Promise<React.ReactElement> {
  const [sources, collectors] = await Promise.all([
    fusionFetch<FusionSource[]>("sources"),
    fusionFetch<FusionCollector[]>("source-registry"),
  ]);
  return (
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
  );
}
