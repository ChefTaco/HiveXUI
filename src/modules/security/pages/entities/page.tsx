import { Badge, Panel } from "@ui";
import {
  EmptyState,
  FusionHeader,
} from "@security/components/security-fusion/fusion-ui";
import { fusionFetch, type FusionEntity } from "@security/lib/security-fusion";

export const dynamic = "force-dynamic";

export default async function EntitiesPage(): Promise<React.ReactElement> {
  const entities = await fusionFetch<FusionEntity[]>("entities");
  return (
    <div className="page-stack">
      <FusionHeader
        eyebrow="Identity graph"
        title="Entities"
        copy="Canonical users, hosts, services, addresses, and domains connect observations across source-specific aliases."
      />
      {!entities?.length ? (
        <EmptyState>No entities have been resolved.</EmptyState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {entities.map((entity) => (
            <Panel key={entity.id} as="div" padding="sm" className="gap-2">
              <Badge className="w-fit">{entity.type}</Badge>
              <p className="text-base text-text-strong">{entity.label}</p>
              <p className="truncate font-mono text-xs text-text-muted">{entity.canonical}</p>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}
