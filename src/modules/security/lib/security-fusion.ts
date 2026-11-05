import type { Tone } from "@ui";
import { securityFetch } from "@security/lib/security-api";
import type { Product } from "@lib/transport";
import type { LabStatus } from "@security/contracts/index";

import type { SecurityFusionSeverity as FusionSeverity } from "../../../../contracts/cindertrace/index";
import type { FusionCollector } from "../../../../contracts/cindertrace/browser";
export type { SecurityFusionSeverity as FusionSeverity } from "../../../../contracts/cindertrace/index";
export type { FusionCase,FusionEvent,FusionEntity,FusionSource,FusionCollector } from "../../../../contracts/cindertrace/browser";

export async function fusionFetch<T>(path: string): Promise<T> {
  const result = await securityFetch<{ success: boolean; data: T }>(
    `security-fusion/${path}`,
  );
  return result.data;
}

export const severityTone: Record<FusionSeverity, Tone> = {
  info: "neutral",
  low: "info",
  medium: "warning",
  high: "danger",
  critical: "danger",
};

const SOURCE_LABELS: Record<string, string> = {
  unifi_dns: "UniFi DNS",
  unifi_ids: "UniFi IDS",
  netflow: "NetFlow",
  wazuh: "Wazuh",
  tailscale: "Tailscale",
  magnus: "Magnus fleet",
  hive: "Hive security export",
  chattermost: "Mattermost-compatible audit",
  mattermost: "Mattermost-compatible audit",
  magnus_ui: "Magnus console",
  aegis_ui: "Cindertrace console",
  security_console: "Cindertrace console",
  cindertrace_ui: "Cindertrace console",
};
/** Product labels do not alter historical source IDs or signed event contents. */
export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source.replaceAll("_", " ");
}

/** Suite products behind a feed. Others (UniFi, Wazuh...) are outside what this console installs. */
const SOURCE_PRODUCTS: Record<string, Product> = {
  magnus: "magnus",
  magnus_ui: "magnus",
  // Hive's security export is read from the model router, now Emberpath.
  hive: "emberpath",
  chattermost: "chattermost",
  mattermost: "chattermost",
  aegis_ui: "cindertrace",
  security_console: "cindertrace",
  cindertrace_ui: "cindertrace",
};
type SourceState = { source: string; status: string; lastEventAt?: string | null | undefined; lastSuccessAt?: string | null | undefined; lastError?: string | null | undefined };
const reported = (source: SourceState) =>
  source.status !== "unconfigured" || !!source.lastEventAt || !!source.lastSuccessAt || !!source.lastError;
/**
 * The server lists every feed it knows. Show one that has reported anything, that a live
 * collector is allowed to send, or whose product is installed; only silent ones can be hidden.
 */
export function sourceRelevant(
  source: SourceState,
  installed: (product: Product) => boolean,
  collectors: Pick<FusionCollector, "allowedSources" | "revokedAt">[] = [],
): boolean {
  if (reported(source)) return true;
  if (collectors.some((collector) => !collector.revokedAt && collector.allowedSources.includes(source.source))) return true;
  const product = SOURCE_PRODUCTS[source.source];
  return product !== undefined && installed(product);
}

/** Historical IDs that share one product label appear as one feed, showing its best state. */
export function mergeSourceAliases<T extends SourceState>(sources: T[]): T[] {
  const merged = new Map<string, T>();
  const rank = (source: T) => [source.status === "healthy" ? 1 : 0, reported(source) ? 1 : 0, source.lastSuccessAt ? Date.parse(source.lastSuccessAt) : 0] as const;
  const better = (a: readonly number[], b: readonly number[]) => {
    for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return a[index]! > b[index]!;
    return false;
  };
  for (const source of sources) {
    const label = sourceLabel(source.source), current = merged.get(label);
    if (!current || better(rank(source), rank(current))) merged.set(label, source);
  }
  return [...merged.values()];
}

/** Lab availability decides whether its entry points exist; any failure leaves them hidden. */
export async function labEnabled(): Promise<boolean> {
  try {
    return (await fusionFetch<LabStatus>("lab")).enabled;
  } catch {
    return false;
  }
}
