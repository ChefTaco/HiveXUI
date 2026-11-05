import type { Tone } from '@ui';

export const EVENT_OPTIONS = ['node.offline', 'node.degraded', 'node.recovered', 'node.upgrade_not_ready', 'command.failed', 'deploy.failed', 'upgrade.failed', 'ai.heartbeat', 'ai.anomaly'];
const TYPES = [{ value: 'generic', label: 'Generic' }, { value: 'slack', label: 'Slack' }, { value: 'discord', label: 'Discord' }, { value: 'mattermost', label: 'Mattermost' }];
export const DELIVERIES_PER_PAGE = 20;

/** The server's formats, plus a stored type name it still honours through an alias, so editing never changes it. */
export const typeOptions = (current: string) => (TYPES.some((type) => type.value === current) ? TYPES : [...TYPES, { value: current, label: current }]);

export function parseEvents(events: string): string[] {
  try {
    const parsed: unknown = JSON.parse(events);
    return Array.isArray(parsed) ? parsed.filter((event): event is string => typeof event === 'string') : [];
  } catch {
    return [];
  }
}
export const eventsLabel = (events: string): string => {
  const list = parseEvents(events);
  return list.length === 0 ? 'All events' : list.join(', ');
};
export const toggled = (events: readonly string[], event: string): string[] => (events.includes(event) ? events.filter((item) => item !== event) : [...events, event]);

export const prettyPayload = (payload: string): string => {
  try {
    return JSON.stringify(JSON.parse(payload), null, 2);
  } catch {
    return payload;
  }
};
export const deliveryTone = (status: string): Tone => (status === 'success' ? 'success' : status === 'failed' ? 'danger' : 'warning');
export const pageCount = (total: number): number => Math.ceil(total / DELIVERIES_PER_PAGE);

export interface WebhookFormState {
  name: string;
  url: string;
  type: string;
  secret: string;
  clearSecret: boolean;
  events: string[];
  headers: Array<{ key: string; value: string }>;
  headersTouched: boolean;
  retries: number;
  timeoutMs: number;
}

const headersObject = (headers: WebhookFormState['headers']): Record<string, string> => Object.fromEntries(headers.filter((header) => header.key.trim()).map((header) => [header.key.trim(), header.value]));

export function createBody(form: WebhookFormState) {
  return {
    name: form.name.trim(),
    url: form.url.trim(),
    type: form.type,
    events: form.events,
    headers: headersObject(form.headers),
    retries: form.retries,
    timeoutMs: form.timeoutMs,
    ...(form.secret ? { secret: form.secret } : {}),
  };
}

/** A secret, a URL and headers are write-only: an edit sends them only when the operator changed them. */
export function updateBody(form: WebhookFormState) {
  return {
    name: form.name.trim(),
    ...(form.url.trim() ? { url: form.url.trim() } : {}),
    type: form.type,
    events: form.events,
    retries: form.retries,
    timeoutMs: form.timeoutMs,
    ...(form.clearSecret ? { secret: null } : form.secret ? { secret: form.secret } : {}),
    ...(form.headersTouched ? { headers: headersObject(form.headers) } : {}),
  };
}
