export interface EnvEntry {
  key: string;
  value: string;
  /** Read from the role below ADMIN. Its value is hidden, and it cannot be removed or renamed. */
  locked: boolean;
}
export interface RoleFields {
  envConfig?: Record<string, string> | undefined;
  envConfigKeys: readonly string[];
}

/**
 * ADMIN gets values and may edit or remove anything. Everyone else gets names only: the server keeps a
 * key that is left out or left blank, so the form must not suggest they can remove one.
 */
export function envEntriesFor(role: RoleFields | null, isAdmin: boolean): EnvEntry[] {
  if (!role) return [];
  if (isAdmin && role.envConfig) return Object.entries(role.envConfig).map(([key, value]) => ({ key, value, locked: false }));
  return role.envConfigKeys.map((key) => ({ key, value: '', locked: !isAdmin }));
}

/**
 * What to send. A PATCH from ADMIN replaces the whole record, so an ADMIN form that never received the
 * values sends nothing rather than blanking every one of them.
 */
export function envPayload(entries: readonly EnvEntry[], role: RoleFields | null, isAdmin: boolean): Record<string, string> | undefined {
  if (role && isAdmin && !role.envConfig && role.envConfigKeys.length > 0) return undefined;
  const envConfig: Record<string, string> = {};
  for (const entry of entries) {
    const key = entry.key.trim();
    if (key) envConfig[key] = entry.value;
  }
  return envConfig;
}

export const parseList = (value: string): string[] => value.split(/[,\s]+/).map((item) => item.trim()).filter(Boolean);
export const parseLines = (value: string): string[] => value.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean);

export interface RoleStep {
  name: string;
  status: string;
  error?: string | undefined;
}
/** A role application's steps are JSON from a text column. Anything malformed is left out. */
export function parseSteps(steps: readonly unknown[]): RoleStep[] {
  return steps.flatMap((step) => {
    if (!step || typeof step !== 'object' || Array.isArray(step)) return [];
    const { name, status, error } = step as Record<string, unknown>;
    if (typeof name !== 'string' || typeof status !== 'string') return [];
    return [{ name, status, ...(typeof error === 'string' ? { error } : {}) }];
  });
}

const ACTIVE = new Set(['pending', 'running']);
export const applicationIsActive = (status: string): boolean => ACTIVE.has(status);

/** The API accepts these two. An older role may hold another, which a save leaves alone. */
export const FIREWALL_MODES = ['restrictive', 'permissive'] as const;
export const isWritableFirewallMode = (mode: string): boolean => (FIREWALL_MODES as readonly string[]).includes(mode);
