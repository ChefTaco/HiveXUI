import type { Tone } from '@ui';
import type { z } from 'zod';
import type { maintenanceWindowSchema } from '@contracts/magnus/browser';

export type MaintenanceWindow = z.output<typeof maintenanceWindowSchema>;
export type WindowState = 'cancelled' | 'expired' | 'scheduled' | 'active';

export function windowState(window: MaintenanceWindow, now = Date.now()): WindowState {
  if (window.cancelledAt) return 'cancelled';
  if (Date.parse(window.endsAt) <= now) return 'expired';
  return Date.parse(window.startsAt) > now ? 'scheduled' : 'active';
}

/** nodeIds and serviceIds are JSON-encoded string arrays on the wire. Bad data must not blank the page. */
export function parseIdList(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export const MAX_WINDOW_MINUTES = 10_080;

/** The request for a window starting now, or the reason it would be refused. */
export function maintenanceRequest(form: { nodeId: string; serviceId: string; reason: string; minutes: string }, now = Date.now()): { error: string } | { body: { reason: string; nodeIds: string[]; serviceIds: string[]; startsAt: string; endsAt: string } } {
  const nodeId = form.nodeId.trim();
  const reason = form.reason.trim();
  const minutes = Number(form.minutes);
  if (!nodeId) return { error: 'Choose a node.' };
  if (reason.length < 5) return { error: 'Give a reason of at least 5 characters.' };
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_WINDOW_MINUTES) return { error: `Duration must be 1 to ${MAX_WINDOW_MINUTES} whole minutes (seven days).` };
  const serviceId = form.serviceId.trim();
  return { body: { reason, nodeIds: [nodeId], serviceIds: serviceId ? [serviceId] : [], startsAt: new Date(now).toISOString(), endsAt: new Date(now + minutes * 60_000).toISOString() } };
}

export function probeTone(status: string): Tone {
  if (status === 'pass' || status === 'available' || status === 'complete') return 'success';
  if (status === 'fail') return 'danger';
  if (status === 'constrained' || status === 'partial') return 'warning';
  return 'neutral';
}

export function applicationCounts(applications: ReadonlyArray<{ status: string }>): { pass: number; fail: number; other: number } {
  const pass = applications.filter(({ status }) => status === 'pass').length;
  const fail = applications.filter(({ status }) => status === 'fail').length;
  return { pass, fail, other: applications.length - pass - fail };
}
