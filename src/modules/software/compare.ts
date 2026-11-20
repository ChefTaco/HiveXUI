// What actually installed, compared with what the signed release pins. Pure functions over the
// Hive Registry's inventory (pins and the hosts' last observations), Magnus's installation report
// (its own version and how npm resolved its dependencies) and the Magnus node list (agent
// versions). The page only renders what these return.
import type { RegistryInventory, RegistryInventoryComponent, RegistryInventoryService } from '@contracts/hive-registry/inventory';
import type { SystemInstallation as MagnusInstallation } from '@contracts/magnus/browser';

export type Verdict = 'matches' | 'differs' | 'not-running' | 'not-reported' | 'external' | 'unpinned';

export interface ComponentRow {
  id: string;
  name: string;
  kind: string;
  pinned: RegistryInventoryComponent['pinned'];
  /** Where the host says it runs, and what it runs. Null: no host reported this component. */
  reported: { host: string; observedAt: string; service: RegistryInventoryService; runningDigest: string | null } | null;
  verdict: Verdict;
  /** One line on why, for anything other than a match. */
  reason: string | null;
}

/** The digest part of `repository@sha256:...`, or null. */
export function imageDigest(reference: string | null | undefined): string | null {
  const match = /@(sha256:[a-f0-9]{64})$/.exec(reference ?? '');
  return match ? match[1]! : null;
}

/** `sha256:9b1606d5e10b…` for tables; the full value stays in the title and copy button. */
export const shortDigest = (value: string | null | undefined): string => {
  if (!value) return '—';
  const [algorithm, hex] = value.includes(':') ? value.split(':', 2) : ['', value];
  return `${algorithm ? `${algorithm}:` : ''}${hex!.slice(0, 12)}`;
};

function findReported(inventory: RegistryInventory, component: RegistryInventoryComponent): ComponentRow['reported'] {
  const hosts = component.inventoryHost ? inventory.hosts.filter((host) => host.host === component.inventoryHost) : inventory.hosts;
  for (const host of hosts) {
    const service = host.services.find((candidate) => candidate.service === component.id);
    if (service) return { host: host.host, observedAt: host.observedAt, service, runningDigest: imageDigest(service.runningImage) };
  }
  return null;
}

export function compareComponent(inventory: RegistryInventory, component: RegistryInventoryComponent): ComponentRow {
  const base = { id: component.id, name: component.displayName, kind: component.kind, pinned: component.pinned };
  const reported = findReported(inventory, component);
  if (component.status === 'external')
    return { ...base, reported, verdict: 'external', reason: 'Runs outside this installation; its own report is below when the UI can read it.' };
  if (!component.pinned) return { ...base, reported, verdict: 'unpinned', reason: 'The signed release pins no image for it.' };
  if (!reported) return { ...base, reported, verdict: 'not-reported', reason: 'No host has reported it. Run ./hive.sh doctor to record what the hosts run.' };
  const { service, runningDigest } = reported;
  if (service.state === 'missing' || !service.runningImage)
    return { ...base, reported, verdict: 'not-running', reason: `${reported.host} has no container for it.` };
  if (runningDigest !== component.pinned.imageDigest)
    return { ...base, reported, verdict: 'differs', reason: `${reported.host} runs ${shortDigest(runningDigest)}, not the pinned ${shortDigest(component.pinned.imageDigest)}.` };
  if (!service.imageMatches)
    return { ...base, reported, verdict: 'differs', reason: `The local image on ${reported.host} is not the one its pinned reference names.` };
  if (service.state !== 'running')
    return { ...base, reported, verdict: 'not-running', reason: `${reported.host} reports it ${service.state}.` };
  if (service.health && service.health !== 'healthy')
    return { ...base, reported, verdict: 'not-running', reason: `${reported.host} reports it ${service.health}.` };
  return { ...base, reported, verdict: 'matches', reason: null };
}

const KIND_ORDER: Record<string, number> = { application: 0, 'static-ui': 1, ingress: 2, datastore: 3 };
export function compareComponents(inventory: RegistryInventory): ComponentRow[] {
  return inventory.components
    .map((component) => compareComponent(inventory, component))
    .sort((a, b) => (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9) || a.name.localeCompare(b.name));
}

export interface ReleaseRow {
  host: string;
  observedAt: string;
  version: string | null;
  verdict: 'matches' | 'differs' | 'not-reported';
}
/** Each host's activation receipt against the release the Registry records. */
export function compareRelease(inventory: RegistryInventory): ReleaseRow[] {
  return inventory.hosts.map((host) => ({
    host: host.host,
    observedAt: host.observedAt,
    version: host.receipt?.version ?? null,
    verdict: !host.receipt || !inventory.release
      ? 'not-reported'
      : host.receipt.version === inventory.release.version && host.receipt.digest === inventory.release.manifestDigest
        ? 'matches'
        : 'differs',
  }));
}

export interface MagnusRow {
  pinnedVersion: string | null;
  version: string;
  node: string;
  layout: MagnusInstallation['magnus']['layout'];
  versionVerdict: 'matches' | 'differs' | 'unpinned';
  resolution: MagnusInstallation['resolution'];
  resolutionVerdict: 'matches' | 'differs' | 'unchecked';
}
/** The Magnus server's own report against the suite's pin, where the installation pins one. */
export function compareMagnus(report: MagnusInstallation, pinnedVersion: string | null): MagnusRow {
  return {
    pinnedVersion,
    version: report.magnus.version,
    node: report.magnus.node,
    layout: report.magnus.layout,
    versionVerdict: pinnedVersion === null ? 'unpinned' : pinnedVersion === report.magnus.version ? 'matches' : 'differs',
    resolution: report.resolution,
    resolutionVerdict: report.resolution.reference === 'none' ? 'unchecked' : report.resolution.differences.length ? 'differs' : 'matches',
  };
}

export interface AgentNode {
  name: string;
  version: string | null;
}
export interface AgentSummary {
  pinnedVersion: string | null;
  onPin: number;
  /** Nodes on another version, or with no agent reporting. */
  offPin: AgentNode[];
}
export function summarizeAgents(nodes: readonly AgentNode[], pinnedVersion: string | null): AgentSummary {
  const offPin = nodes.filter((node) => pinnedVersion === null || node.version !== pinnedVersion);
  return {
    pinnedVersion,
    onPin: nodes.length - offPin.length,
    offPin: [...offPin].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** How many rows need a look, for the header badge. */
export const attentionCount = (rows: readonly { verdict: string }[]): number =>
  rows.filter((row) => row.verdict === 'differs' || row.verdict === 'not-running').length;
