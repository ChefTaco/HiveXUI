import type { Tone } from '@ui';
import type { CodexInstallation } from './schemas';

export const canRequestUpdate = (installation: Pick<CodexInstallation, 'installed' | 'latestVersion' | 'updateAvailable' | 'updateSupported'>): boolean =>
  installation.installed && installation.updateSupported && (installation.updateAvailable || !installation.latestVersion);

export function authTone(status: string): Tone {
  if (status === 'authenticated') return 'success';
  if (status === 'error') return 'danger';
  if (status === 'expired_logged_out' || status === 'wrong_auth_mode') return 'warning';
  return 'neutral';
}

/** A device code's page comes from the node. Only http(s) may become a link the operator clicks. */
export { safeExternalUrl } from '../../../../../lib/external-url';

export function summarize(installations: readonly CodexInstallation[]) {
  const installed = installations.filter((item) => item.installed && item.reachable);
  return {
    installed,
    healthy: installed.filter((item) => item.auth.oauth).length,
    updates: installed.filter((item) => item.updateAvailable).length,
    needsLogin: installed.filter((item) => !item.auth.oauth).length,
    latestVersion: installed.find((item) => item.latestVersion)?.latestVersion ?? 'unavailable',
  };
}
