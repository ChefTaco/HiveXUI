import { z } from 'zod';

const liveSchema = z.object({ authLimitsRelaxed: z.boolean() });
const POLL_MS = 60_000;

/**
 * Whether Oathweave says sign-in limits are relaxed for testing. The health route is public, so this
 * sends no credentials and must not go through apiFetch, which would wait for sign-in.
 */
export async function readAuthLimitsRelaxed(prefix: string, request: typeof fetch = fetch): Promise<boolean> {
  const response = await request(prefix + '/health/live', { credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('Oathweave health is unavailable');
  return liveSchema.parse(await response.json()).authLimitsRelaxed;
}

/**
 * Watches the mode for as long as the console is open. A failed check keeps the last answer: this
 * mode must never go silent just because a health request did not get through.
 */
export function watchAuthLimits(prefix: string, onChange: (relaxed: boolean) => void, request: typeof fetch = fetch): () => void {
  let relaxed = false;
  let active = true;
  const check = async () => {
    try {
      const value = await readAuthLimitsRelaxed(prefix, request);
      if (active && value !== relaxed) {
        relaxed = value;
        onChange(value);
      }
    } catch {
      // Keep the last known state.
    }
  };
  void check();
  const timer = setInterval(() => void check(), POLL_MS);
  const onFocus = () => void check();
  if (typeof window !== 'undefined') window.addEventListener('focus', onFocus);
  return () => {
    active = false;
    clearInterval(timer);
    if (typeof window !== 'undefined') window.removeEventListener('focus', onFocus);
  };
}
