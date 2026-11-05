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

export const severityClass: Record<FusionSeverity, string> = {
  info: "text-text-muted border-border",
  low: "text-primary border-primary/30",
  medium: "text-warning border-warning/40",
  high: "text-accent border-accent/40 shadow-[0_0_10px_var(--color-glow-accent)]",
  critical: "text-danger border-danger/50 bg-danger/5 shadow-[0_0_14px_var(--color-glow-danger)]",
};

/** Product labels do not alter historical source IDs or signed event contents. */
export function sourceLabel(source: string): string {
  if (["aegis_ui", "security_console", "cindertrace_ui"].includes(source)) return "Cindertrace console";
  if (["chattermost", "mattermost"].includes(source)) return "Mattermost-compatible audit";
  if (source === "magnus_ui") return "Magnus console";
  return source.replaceAll("_", " ");
}
