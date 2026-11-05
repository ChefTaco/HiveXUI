import { useEffect, useState } from 'react';

export interface SessionSample {
  t: number;
  [metric: string]: number | null;
}
const LIMIT = 40;
function read(key: string): SessionSample[] {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(key) ?? 'null') as unknown;
    return Array.isArray(parsed) ? (parsed as SessionSample[]).slice(-LIMIT) : [];
  } catch {
    return [];
  }
}

/**
 * The last 40 values a page has polled, kept for this tab, for trends the API has no history for.
 * Pass the response as `stamp`, so a poll that changed nothing still extends the line.
 */
export function useSessionSamples(key: string, sample: Omit<SessionSample, 't'> | null, stamp?: unknown): SessionSample[] {
  const [samples, setSamples] = useState<SessionSample[]>(() => read(key));
  const signature = sample ? JSON.stringify(sample) : null;
  useEffect(() => {
    if (!signature) return;
    const next = JSON.parse(signature) as Omit<SessionSample, 't'>;
    setSamples((previous) => {
      const now = Date.now();
      const last = previous.at(-1);
      if (last && now - last.t < 5000 && JSON.stringify({ ...last, t: undefined }) === JSON.stringify({ ...next, t: undefined })) return previous;
      const updated = [...previous, { ...next, t: now }].slice(-LIMIT);
      try {
        sessionStorage.setItem(key, JSON.stringify(updated));
      } catch {
        // Storage full or blocked: keep the trend in memory.
      }
      return updated;
    });
  }, [key, signature, stamp]);
  return samples;
}
export const series = (samples: readonly SessionSample[], metric: string): number[] =>
  samples.map((sample) => sample[metric]).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
