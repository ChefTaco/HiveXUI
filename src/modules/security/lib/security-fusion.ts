import type { Tone } from "@ui";
import { securityFetch } from "@security/lib/security-api";

import type { SecurityFusionSeverity as FusionSeverity } from "../../../../contracts/cindertrace/index";
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

/** Product labels do not alter historical source IDs or signed event contents. */
export function sourceLabel(source: string): string {
  if (["aegis_ui", "security_console", "cindertrace_ui"].includes(source)) return "Cindertrace console";
  if (["chattermost", "mattermost"].includes(source)) return "Mattermost-compatible audit";
  if (source === "magnus_ui") return "Magnus console";
  return source.replaceAll("_", " ");
}

/** Historical IDs that share one product label appear as one feed, showing its best state. */
export function mergeSourceAliases<T extends { source: string; status: string; lastSuccessAt?: string | null | undefined }>(sources: T[]): T[] {
  const merged = new Map<string, T>();
  const rank = (source: T) => [source.status === "healthy" ? 1 : 0, source.lastSuccessAt ? Date.parse(source.lastSuccessAt) : 0] as const;
  for (const source of sources) {
    const label = sourceLabel(source.source), current = merged.get(label);
    if (!current) { merged.set(label, source); continue; }
    const [health, recency] = rank(source), [currentHealth, currentRecency] = rank(current);
    if (health > currentHealth || (health === currentHealth && recency > currentRecency)) merged.set(label, source);
  }
  return [...merged.values()];
}
