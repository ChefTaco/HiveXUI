// How an Ardent profile's HiveMem credential reads, shared by the profile page and Agent Studio.
// Magnus renews the credential on a schedule; this only describes what it reports.
import type { ArdentHiveMemCredentialField } from './schemas';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** Under this much time left, an expiry is a warning even while renewal reports ok. */
export const EXPIRY_WARNING_MS = 3 * DAY;

export type HiveMemCredentialKind = 'ok' | 'expiring' | 'failing' | 'expired' | 'unmanaged' | 'unknown';

export interface CredentialTime {
  /** "in 12 days", "3 hours ago". */
  relative: string;
  /** The local date and time, for a title. */
  absolute: string;
}

export interface HiveMemCredentialView {
  kind: HiveMemCredentialKind;
  tone: 'success' | 'warning' | 'danger' | 'neutral';
  /** A sentence: "Credential expires in 12 days". */
  headline: string;
  /** For a compact badge: "12 days", "renewal failing", "expired". */
  short: string;
  expires: CredentialTime | null;
  lastRenewed: CredentialTime | null;
  nextRenewal: CredentialTime | null;
  failures: number;
  lastError: string | null;
  agentId: string | null;
  workspaceId: string | null;
}

const plural = (count: number, unit: string) => `${count} ${unit}${count === 1 ? '' : 's'}`;

/** A span in its largest whole unit: days, then hours, then minutes. */
export function duration(ms: number): string {
  const span = Math.abs(ms);
  if (span >= DAY) return plural(Math.floor(span / DAY), 'day');
  if (span >= HOUR) return plural(Math.floor(span / HOUR), 'hour');
  if (span >= MINUTE) return plural(Math.floor(span / MINUTE), 'minute');
  return 'less than a minute';
}

function moment(value: string | null, now: number): (CredentialTime & { at: number }) | null {
  const at = value ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(at)) return null;
  const relative = at >= now ? `in ${duration(at - now)}` : `${duration(now - at)} ago`;
  return { at, relative, absolute: new Date(at).toLocaleString() };
}

const time = (value: (CredentialTime & { at: number }) | null): CredentialTime | null => (value ? { relative: value.relative, absolute: value.absolute } : null);

const EMPTY = { expires: null, lastRenewed: null, nextRenewal: null, failures: 0, lastError: null, agentId: null, workspaceId: null };

/**
 * What to show for a profile's `hivemem` field. undefined (a Magnus without credential renewal)
 * answers null: show nothing. An expiry already past reads as expired whatever the state says.
 */
export function hiveMemCredentialView(field: ArdentHiveMemCredentialField, now = Date.now()): HiveMemCredentialView | null {
  if (field === undefined) return null;
  if (field === null) return { ...EMPTY, kind: 'unmanaged', tone: 'neutral', headline: 'Not managed by Magnus', short: 'not managed' };
  if (field === 'unreadable') return { ...EMPTY, kind: 'unknown', tone: 'neutral', headline: 'Credential status unknown', short: 'unknown' };
  const expires = moment(field.expiresAt, now);
  const facts = {
    expires: time(expires),
    lastRenewed: time(moment(field.lastRenewedAt, now)),
    nextRenewal: time(moment(field.nextRenewalAt, now)),
    failures: field.failures,
    lastError: field.lastError,
    agentId: field.agentId,
    workspaceId: field.workspaceId,
  };
  const left = expires ? expires.at - now : null;
  if (field.state === 'expired' || (left !== null && left <= 0)) return { ...facts, kind: 'expired', tone: 'danger', headline: 'Credential expired', short: 'expired' };
  if (field.state === 'renewal-failing')
    return { ...facts, kind: 'failing', tone: 'warning', headline: `Renewal failing (${plural(field.failures, 'attempt')})`, short: 'renewal failing' };
  if (field.state !== 'ok') return { ...facts, kind: 'unknown', tone: 'neutral', headline: 'Credential status unknown', short: 'unknown' };
  if (left === null) return { ...facts, kind: 'ok', tone: 'success', headline: 'Credential renewed by Magnus', short: 'active' };
  return { ...facts, kind: left < EXPIRY_WARNING_MS ? 'expiring' : 'ok', tone: left < EXPIRY_WARNING_MS ? 'warning' : 'success', headline: `Credential expires in ${duration(left)}`, short: duration(left) };
}
