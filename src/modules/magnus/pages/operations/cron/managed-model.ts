/** Finite schedules preserve explicit expiry and monotonically increasing revisions. */
export function managedRegistration(timeout: string, expires: string, revision = 1, now = Date.now()) {
  const timeoutSeconds = Number(timeout); const expiresAt = new Date(expires).getTime();
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 3600)
    throw new Error('Timeout must be an integer from 1 to 3600 seconds.');
  if (!Number.isFinite(expiresAt) || expiresAt <= now) throw new Error('Choose a future expiry.');
  if (!Number.isInteger(revision) || revision < 1 || revision > 2147483647) throw new Error('A new schedule identity is required.');
  return { revision, timezone: 'UTC' as const, timeoutSeconds, expiresAt };
}
export function finiteJobBody(input: { name: string; nodeId: string; command: string; args: string;
  schedule: string; timeout: string; expires: string }, now = Date.now()) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(input.name)) throw new Error('Use a job name with letters, numbers, dots, underscores or hyphens.');
  if (!input.nodeId || !input.command.trim() || !input.schedule.trim()) throw new Error('All fields are required.');
  let args: unknown; try { args = JSON.parse(input.args); } catch { throw new Error('Arguments must be a JSON array of strings.'); }
  if (!Array.isArray(args) || args.some(value => typeof value !== 'string')) throw new Error('Arguments must be a JSON array of strings.');
  const managed = managedRegistration(input.timeout, input.expires, 1, now);
  return { name: input.name, nodeId: input.nodeId, command: input.command.trim(), args: args as string[],
    schedule: input.schedule.trim(), timeoutSeconds: managed.timeoutSeconds, managed };
}
export function localExpiry(now = Date.now()) {
  const date = new Date(now + 24 * 3600000); date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

export const scheduleActive = (value: { enabled: boolean; expiresAt: string }, now = Date.now()) => value.enabled && Date.parse(value.expiresAt) > now;
