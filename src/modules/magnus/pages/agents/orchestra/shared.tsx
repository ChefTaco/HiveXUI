import { hermesInstallationsResponseSchema, hermesProfilesResponseSchema } from '@contracts/magnus/browser';
import type { z } from 'zod';
import { Badge, statusTone, type Tone } from '@ui';
import { magnus } from '../../../api/client';

export type HermesInstallation = z.output<typeof hermesInstallationsResponseSchema>['data'][number];
export type HermesProfile = z.output<typeof hermesProfilesResponseSchema>['data'][number];

// The /orchestra prefix has the larger budget of the two, and these reads are all it still offers.
export const readInstallations = (signal?: AbortSignal) => magnus.get('/orchestra/installations', hermesInstallationsResponseSchema, { signal }).then((response) => response.data);
export const readProfiles = (signal?: AbortSignal) => magnus.get('/orchestra/profiles', hermesProfilesResponseSchema, { signal }).then((response) => response.data);

export const isDetected = (installation: { status: string }): boolean => installation.status !== 'not_installed';
export const installLabel = (installation: HermesInstallation): string => installation.displayName ?? installation.hostname;
export const synced = (value: string | null | undefined): string => (value ? new Date(value).toLocaleString() : 'never');

export function groupProfiles(profiles: readonly HermesProfile[]): Map<string, HermesProfile[]> {
  const map = new Map<string, HermesProfile[]>();
  for (const profile of profiles) map.set(profile.installationId, [...(map.get(profile.installationId) ?? []), profile]);
  return map;
}

/** The figures of the overview. Only detected installations count. */
export function summarize(installations: readonly HermesInstallation[], profiles: readonly HermesProfile[]) {
  const detected = installations.filter(isDetected);
  const ids = new Set(detected.map((installation) => installation.id));
  return {
    detected,
    healthy: detected.filter((item) => item.status === 'running' || item.status === 'detected').length,
    dashboards: detected.filter((item) => item.dashboardStatus === 'running').length,
    gateways: profiles.filter((profile) => ids.has(profile.installationId) && profile.gatewayStatus === 'running').length,
  };
}

/** Hermes statuses are free strings. A detected install is fine; anything unknown stays neutral. */
export const hermesTone = (status: string): Tone => (status === 'detected' ? 'success' : statusTone(status));
export const HermesStatus = ({ status }: { status: string }) => <Badge tone={hermesTone(status)} dot>{status}</Badge>;

export function tokenTone(status: string): Tone {
  if (status === 'valid') return 'success';
  return status === 'expiring' || status === 'unreachable' || status === 'unknown' ? 'warning' : 'danger';
}

export function HiveMemTokenStatus({ configuration }: { configuration: HermesInstallation['configuration'] }) {
  if (configuration?.memoryProvider !== 'hivemem') return null;
  const token = configuration.hiveMemToken;
  const status = token?.status ?? 'unknown';
  return (
    <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
      <Badge tone={tokenTone(status)}>Token {status}</Badge>
      {token?.expiresAt ? <time dateTime={token.expiresAt} title="HiveMem token expiration">expires {new Date(token.expiresAt).toLocaleString()}</time> : null}
      {token?.checkedAt ? <time dateTime={token.checkedAt} title="Last HiveMem authentication check">checked {new Date(token.checkedAt).toLocaleString()}</time> : null}
    </span>
  );
}
