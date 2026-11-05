import { Panel } from "@ui";
import {
  EmptyState,
  FusionHeader,
} from "@security/components/security-fusion/fusion-ui";
import { fusionFetch } from "@security/lib/security-fusion";

export const dynamic = "force-dynamic";

interface Evidence {
  id: string;
  sourceLocator: string;
  sha256: string;
  preservedAt: string;
  mediaType: string;
}
export default async function EvidencePage(): Promise<React.ReactElement> {
  const evidence = await fusionFetch<Evidence[]>("evidence");
  return (
    <div className="page-stack">
      <FusionHeader
        eyebrow="Chain of custody"
        title="Evidence"
        copy="Preserved sanitized artifacts are content-addressed, SHA-256 verified, and retained for one year."
      />
      {!evidence?.length ? (
        <EmptyState>No evidence has been preserved.</EmptyState>
      ) : (
        <div className="grid gap-2">
          {evidence.map((item) => (
            <Panel
              key={item.id}
              as="div"
              padding="sm"
              className="gap-2 md:grid-cols-[1fr_10rem_2fr]"
            >
              <span className="text-sm text-text-strong">{item.sourceLocator}</span>
              <span className="text-xs text-text-muted">{item.mediaType}</span>
              <span className="truncate font-mono text-xs text-text-muted">{item.sha256}</span>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}
