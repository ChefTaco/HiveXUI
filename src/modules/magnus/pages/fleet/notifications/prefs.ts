import type { NotificationPreference } from './schemas';

export const CATEGORIES = [
  { id: 'node.offline', label: 'Node offline', group: 'Fleet' },
  { id: 'node.degraded', label: 'Node degraded', group: 'Fleet' },
  { id: 'node.recovered', label: 'Node recovered', group: 'Fleet' },
  { id: 'node.upgrade_not_ready', label: 'Agent upgrade blocked', group: 'Fleet' },
  { id: 'command.failed', label: 'Command failed', group: 'Operations' },
  { id: 'deploy.failed', label: 'Deploy failed', group: 'Operations' },
  { id: 'deploy.success', label: 'Deploy success', group: 'Operations' },
  { id: 'upgrade.failed', label: 'Upgrade failed', group: 'Operations' },
  { id: 'ai.anomaly', label: 'AI anomaly', group: 'AI' },
  { id: 'ai.heartbeat', label: 'AI heartbeat', group: 'AI' },
] as const;
export const CHANNELS = [
  { id: 'in_app', label: 'In app' },
  { id: 'email', label: 'Email' },
  { id: 'webhook', label: 'Webhook' },
] as const;
export const SEVERITIES = ['info', 'warning', 'critical'] as const;
export const GROUPS = [...new Set(CATEGORIES.map(({ group }) => group))];

const find = (prefs: readonly NotificationPreference[], channel: string, category: string) => prefs.find((pref) => pref.channel === channel && pref.category === category);

/** With no saved row, only in-app delivery is on. */
export const isEnabled = (prefs: readonly NotificationPreference[], channel: string, category: string): boolean => find(prefs, channel, category)?.enabled ?? channel === 'in_app';
export const minSeverity = (prefs: readonly NotificationPreference[], category: string): string => find(prefs, 'in_app', category)?.minSeverity ?? 'info';

function upsert(prefs: readonly NotificationPreference[], channel: string, category: string, change: Partial<NotificationPreference>): NotificationPreference[] {
  const next: NotificationPreference = { channel, category, enabled: isEnabled(prefs, channel, category), minSeverity: find(prefs, channel, category)?.minSeverity ?? 'info', ...change };
  return find(prefs, channel, category) ? prefs.map((pref) => (pref.channel === channel && pref.category === category ? next : pref)) : [...prefs, next];
}

/** Flips what the operator sees, including a channel that is only on by default. */
export const togglePref = (prefs: readonly NotificationPreference[], channel: string, category: string): NotificationPreference[] => upsert(prefs, channel, category, { enabled: !isEnabled(prefs, channel, category) });

/** Sets the floor on every channel of a category without turning any channel on or off. */
export const setCategorySeverity = (prefs: readonly NotificationPreference[], category: string, severity: string): NotificationPreference[] =>
  CHANNELS.reduce<NotificationPreference[]>((current, { id }) => upsert(current, id, category, { minSeverity: severity }), [...prefs]);

/** Every category on every channel, as PUT /notifications/preferences takes them. */
export const preferencePayload = (prefs: readonly NotificationPreference[]): NotificationPreference[] =>
  CATEGORIES.flatMap(({ id: category }) => CHANNELS.map(({ id: channel }) => ({ channel, category, enabled: isEnabled(prefs, channel, category), minSeverity: find(prefs, channel, category)?.minSeverity ?? 'info' })));

export const samePreferences = (left: readonly NotificationPreference[], right: readonly NotificationPreference[]): boolean => JSON.stringify(preferencePayload(left)) === JSON.stringify(preferencePayload(right));
