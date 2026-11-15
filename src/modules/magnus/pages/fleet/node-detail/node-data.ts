import { z } from 'zod';
import { hermesInstallationSchema, nodeWithRelationsSchema, serviceInfoSchema, storedAgentSelfUpgradeSchema, systemUpdatePostureSchema } from '@contracts/magnus/browser';

export type NodeDetail = z.output<typeof nodeWithRelationsSchema>;
export type HermesInstallation = z.output<typeof hermesInstallationSchema>;
export type SystemUpdates = z.output<typeof systemUpdatesSchema>;
export type ServiceInfo = z.output<typeof serviceInfoSchema>;

/** Read a column that holds JSON. Nothing a node reported may break the page. */
function parseJson(text: string | null | undefined): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Each element on its own, so one odd entry from a newer agent costs only that entry. */
function each<S extends z.ZodType>(schema: S, value: unknown): Array<z.output<S>> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = schema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

export const parseServices = (services: string | null | undefined): ServiceInfo[] => each(serviceInfoSchema, parseJson(services));

const wazuhSchema = z.object({
  installed: z.boolean(),
  serviceStatus: z.enum(['active', 'inactive', 'failed', 'not_installed', 'unknown']),
  enabled: z.enum(['enabled', 'disabled', 'static', 'unknown']),
  version: z.string().nullable(),
  managerAddresses: z.array(z.string()),
});
export type WazuhAgent = z.output<typeof wazuhSchema>;
export function parseWazuh(wazuh: string | null | undefined): WazuhAgent | null {
  const parsed = wazuhSchema.safeParse(parseJson(wazuh));
  return parsed.success ? parsed.data : null;
}

// An older agent reports less than the current shape, and the page shows what is there.
const systemUpdatesSchema = systemUpdatePostureSchema.partial({ unattendedUpgradesInstalled: true, periodicUpdateListsEnabled: true, periodicUnattendedUpgradeEnabled: true, fullUpgradePolicyEnabled: true });
export function parseSystemUpdates(value: string | null | undefined): SystemUpdates | null {
  const parsed = systemUpdatesSchema.safeParse(parseJson(value));
  return parsed.success ? parsed.data : null;
}

const selfUpgradeSchema = z.object({ agentSelfUpgrade: storedAgentSelfUpgradeSchema.pick({ enabled: true, reason: true, upgrade: true }) });
export type SelfUpgradeReport = z.output<typeof selfUpgradeSchema>['agentSelfUpgrade'];
/** The agent's own report on whether it can upgrade itself, and the last upgrade's outcome. */
export function selfUpgradeReport(metadata: string | null | undefined): SelfUpgradeReport | null {
  const parsed = selfUpgradeSchema.safeParse(parseJson(metadata));
  return parsed.success ? parsed.data.agentSelfUpgrade : null;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let value = Math.abs(bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${bytes < 0 ? '-' : ''}${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

/** The Cockpit link for an address that really is a host. Anything else offers no link. */
export function cockpitUrl(address: string): string | null {
  const host = address.includes(':') && !address.startsWith('[') ? `[${address}]` : address;
  try {
    const url = new URL(`https://${host}:9090/`);
    return url.username || url.password || url.pathname !== '/' || url.search || url.hash ? null : url.href;
  } catch {
    return null;
  }
}

const skillSchema = z.object({ slug: z.string(), category: z.string().nullable().optional(), source: z.string(), enabled: z.boolean() });
const pluginSchema = z.object({ slug: z.string(), pluginType: z.string().optional().default(''), version: z.string().nullable().optional(), status: z.string(), metadata: z.object({ description: z.string().optional() }).optional() });
export type HermesSkill = z.output<typeof skillSchema>;
type HermesPlugin = z.output<typeof pluginSchema>;

export const detectedSkills = (installation: HermesInstallation): HermesSkill[] => each(skillSchema, installation.rawStatus['skills']);
export const detectedPlugins = (installation: HermesInstallation): HermesPlugin[] => each(pluginSchema, installation.rawStatus['plugins']);

/** The installation on this node: by id, or for an unlinked one by its host. */
export function findInstallation(installations: readonly HermesInstallation[], node: Pick<NodeDetail, 'id' | 'hostname' | 'ipAddress'>): HermesInstallation | null {
  const found = installations.find((item) => item.nodeId === node.id) ?? installations.find((item) => item.hostname === node.hostname || item.hostname === node.ipAddress);
  return found && found.status !== 'not_installed' ? found : null;
}

function pluginEnabled(plugin: HermesPlugin): boolean {
  const status = plugin.status.toLowerCase();
  return status.includes('enabled') && !status.includes('not enabled') && !status.includes('disabled');
}
export function findPluginLabel(plugins: readonly HermesPlugin[], purpose: 'search' | 'crawl'): string {
  const match = plugins.filter(pluginEnabled).find((plugin) => {
    const haystack = `${plugin.slug} ${plugin.pluginType} ${plugin.metadata?.description ?? ''}`.toLowerCase();
    return purpose === 'search' ? /\b(search|web)\b/.test(haystack) : /\b(crawl|browser|firecrawl|browserbase|browser-use)\b/.test(haystack);
  });
  return match ? `${match.slug}${match.version ? ` ${match.version}` : ''}` : 'none enabled';
}
export function skillSummary(skills: readonly HermesSkill[]): string {
  if (skills.length === 0) return '0 synced';
  return `${skills.filter((skill) => skill.enabled).length} enabled / ${skills.length} total`;
}
const LOOPBACK_HOSTS = new Set(['', '0.0.0.0', '127.0.0.1', 'localhost', '::', '::1']);
/** Where the dashboard listens, as the operator would reach it. It is shown, never embedded or opened from here. */
export function hermesDashboardAddress(installation: Pick<HermesInstallation, 'dashboardHost' | 'dashboardPort' | 'hostname'>): string {
  const host = LOOPBACK_HOSTS.has(installation.dashboardHost.trim().toLowerCase().replace(/^\[|\]$/g, '')) ? installation.hostname : installation.dashboardHost;
  return `${host}:${installation.dashboardPort}`;
}

const stepSchema = z.object({ name: z.string(), status: z.enum(['pending', 'running', 'completed', 'failed', 'skipped']), error: z.string().optional() });
export type RoleStep = z.output<typeof stepSchema>;
export const parseRoleSteps = (steps: readonly unknown[]): RoleStep[] => each(stepSchema, steps);

export const SOFTWARE_NAMES = ['node', 'npm', 'python3', 'redis', 'docker', 'tailscale', 'magnus-agent'] as const;
