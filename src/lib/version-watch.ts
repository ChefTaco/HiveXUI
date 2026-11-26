// Notices that the console was upgraded while this tab stayed open. Each build writes
// /version.json with its version and the hashed entry script that its index.html loads; a tab whose
// own entry script differs is running an older build. Pairs with chunk-reload.ts, which recovers a
// stale tab once a lazy page fails to load: this offers the reload before anything fails.
import { z } from 'zod';

export const VERSION_PATH = '/version.json';
/** How often a visible tab asks, and the least time between two checks. */
export const VERSION_POLL_MS = 5 * 60 * 1000;
export const VERSION_MIN_GAP_MS = 60 * 1000;

const VersionSchema = z.object({
  version: z.string().max(64).regex(/^[\w.+-]+$/).optional(),
  entry: z.string().max(256).regex(/^\/assets\/[\w.-]+\.js$/),
});
export type ConsoleVersion = z.infer<typeof VersionSchema>;

/** The hashed entry script this page runs, or undefined for a development server (no build). */
export function currentEntry(doc: Document = document): string | undefined {
  for (const script of doc.querySelectorAll<HTMLScriptElement>('script[type="module"][src]')) {
    const path = new URL(script.src, location.origin).pathname;
    if (/^\/assets\/[\w.-]+\.js$/.test(path)) return path;
  }
  return undefined;
}

/** The newer build being served, or undefined when it is this one or cannot be read. */
export async function newerVersion(entry: string, request: typeof fetch = (input, init) => fetch(input, init)): Promise<ConsoleVersion | undefined> {
  try {
    const response = await request(VERSION_PATH, { cache: 'no-store', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return undefined;
    const served = VersionSchema.safeParse(await response.json());
    if (!served.success || served.data.entry === entry) return undefined;
    return served.data;
  } catch {
    return undefined;
  }
}

/**
 * Checks while the tab is visible, every `intervalMs` and when it becomes visible again (at most
 * once a minute), and reports the first newer build once. Does nothing without a built entry.
 */
export function watchVersion(options: {
  onUpdate: (version: ConsoleVersion) => void;
  entry?: string | undefined;
  request?: typeof fetch;
  intervalMs?: number;
  now?: () => number;
  doc?: Document;
}): () => void {
  const doc = options.doc ?? document;
  const entry = options.entry ?? currentEntry(doc);
  if (!entry) return () => {};
  const now = options.now ?? Date.now;
  let last = now();
  let busy = false;
  let stopped = false;
  const check = async () => {
    if (stopped || busy || doc.visibilityState !== 'visible' || now() - last < VERSION_MIN_GAP_MS) return;
    busy = true;
    last = now();
    const found = await newerVersion(entry, options.request);
    busy = false;
    if (found && !stopped) {
      stop();
      options.onUpdate(found);
    }
  };
  const timer = setInterval(() => void check(), options.intervalMs ?? VERSION_POLL_MS);
  const visible = () => void check();
  doc.addEventListener('visibilitychange', visible);
  function stop() {
    stopped = true;
    clearInterval(timer);
    doc.removeEventListener('visibilitychange', visible);
  }
  return stop;
}
