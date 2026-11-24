import type { ArdentInstallation, ArdentTaskEvent } from './schemas';

export interface ArdentArtifact {
  /** The SHA-256 of the bytes, which the download routes take. */
  id: string;
  name: string;
  bytes: number;
  media_type: string;
  /** research: the research brief and its Markdown; registered: an artifact the agent registered (artifact_registered). */
  source: 'research' | 'registered';
}

const NODE_ID = /^[A-Za-z0-9._-]{1,128}$/;
const PROFILE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export const isProfileId = (value: string): boolean => PROFILE_ID.test(value);

/** A profile's page is /ardent/profiles/<nodeId>~<profileId>. */
export const profileHref = (nodeId: string, profileId: string): string => `/ardent/profiles/${encodeURIComponent(`${nodeId}~${profileId}`)}`;

/** The route parameter, or null for a link no profile could have. */
export function parseProfileRef(value: string | undefined): { nodeId: string; profileId: string } | null {
  const marker = value?.indexOf('~') ?? -1;
  if (!value || marker < 0) return null;
  const nodeId = value.slice(0, marker);
  const profileId = value.slice(marker + 1);
  return NODE_ID.test(nodeId) && PROFILE_ID.test(profileId) ? { nodeId, profileId } : null;
}

export function channelSummary(channels: Record<string, boolean>): string {
  const enabled = Object.entries(channels).filter(([, on]) => on).map(([name]) => name);
  return enabled.length ? enabled.join(', ') : 'None';
}

/** What the overview counts. A node that could not be reached counts as needing attention. */
export function summarize(installations: readonly ArdentInstallation[]) {
  const detected = installations.filter((item) => item.installed && item.reachable);
  const profiles = detected.flatMap((item) => item.profiles.map((profile) => ({ ...profile, node: item })));
  const running = profiles.filter((item) => item.running).length;
  const unavailable = installations.filter((item) => !item.reachable).length;
  return { detected, profiles, running, needsAttention: unavailable + profiles.filter((item) => !item.running || item.error).length };
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export const asRecord = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});

/**
 * The artifacts a task's journal names: the research brief (research_artifacts) and every artifact the
 * agent registered (artifact_registered, which carries the manifest's digest, name, type and size).
 * Only a well-formed digest can become a download path.
 */
export function taskArtifacts(events: readonly ArdentTaskEvent[]): ArdentArtifact[] {
  const found = new Map<string, ArdentArtifact>();
  const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  for (const event of events) {
    if (event.kind === 'research_artifacts') {
      for (const raw of Object.values(asRecord(event.detail))) {
        const item = asRecord(raw);
        if (digest(item.id) && typeof item.name === 'string' && typeof item.bytes === 'number' && typeof item.media_type === 'string')
          found.set(item.id, { id: item.id, name: item.name, bytes: item.bytes, media_type: item.media_type, source: 'research' });
      }
    } else if (event.kind === 'artifact_registered') {
      const item = asRecord(event.detail);
      if (digest(item.sha256) && typeof item.name === 'string' && typeof item.size === 'number' && typeof item.mime === 'string')
        found.set(item.sha256, { id: item.sha256, name: item.name, bytes: item.size, media_type: item.mime, source: 'registered' });
    }
  }
  return [...found.values()];
}

/**
 * The file name in a Content-Disposition header (`filename*` first, then `filename`), reduced to a
 * safe base name, or null when it names none.
 */
export function dispositionName(header: string | null): string | null {
  if (!header) return null;
  const extended = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header)?.[1];
  let name: string | undefined;
  if (extended) {
    try {
      name = decodeURIComponent(extended.trim());
    } catch {
      name = undefined;
    }
  }
  name ??= /filename\s*=\s*"((?:[^"\\]|\\.)*)"/.exec(header)?.[1]?.replace(/\\(.)/g, '$1') ?? /filename\s*=\s*([^;\s]+)/.exec(header)?.[1];
  const base = name?.split(/[\\/]/).pop()?.trim();
  return base && base !== '.' && base !== '..' ? base.slice(0, 200) : null;
}

const FINAL_TASK_STATES = new Set(['completed', 'partial', 'failed', 'cancelled', 'unknown']);
export const taskIsFinal = (state: string): boolean => FINAL_TASK_STATES.has(state);

export const channelLabel = (name: string): string => (name === 'telegram' ? 'Telegram' : name.charAt(0).toUpperCase() + name.slice(1));
export const displayValue = (value: unknown): string => (value === null || value === undefined ? '—' : typeof value === 'string' ? value : typeof value === 'object' ? JSON.stringify(value) : String(value));

/** The allowlists on the channels form. Throws what the operator should read. */
export function parseIdList(value: string, signed = false): number[] {
  const entries = value.split(',').map((item) => item.trim()).filter(Boolean);
  if (entries.some((item) => !(signed ? /^-?\d+$/ : /^\d+$/).test(item))) throw new Error('Allowlist IDs must be comma-separated integers');
  const parsed = entries.map(Number);
  if (parsed.some((item) => !Number.isSafeInteger(item) || (!signed && item <= 0))) throw new Error('Allowlist IDs are outside the supported integer range');
  return parsed;
}
