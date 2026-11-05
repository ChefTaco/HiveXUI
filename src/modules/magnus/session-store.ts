// The session is loaded by the shell too, for the sidebar, so it lives outside React. Importing this
// file brings in the contract, so the shell only reaches it through a dynamic import.
import { consoleSessionResponseSchema } from '@contracts/magnus/browser';
import { onAccessCleared } from '../../lib/transport';
import { magnus } from './api/client';
import { MagnusApiError } from './api/errors';
import type { ConsoleRole } from './routes';

export interface MagnusSession {
  userId: string;
  role: ConsoleRole;
  capabilities: {
    hermes: boolean;
    agentVersion: string;
    magnusVersion: string;
  };
}
export type SessionState =
  | { status: 'loading' }
  | { status: 'ready'; session: MagnusSession }
  /** Signed in, but this identity has no Magnus link or permission. */
  | { status: 'denied'; message: string }
  | { status: 'error'; message: string };

let state: SessionState = { status: 'loading' };
let pending: Promise<void> | undefined;
let generation = 0;
let attempts = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
const RETRY_MIN_MS = 5000;
const RETRY_MAX_MS = 60_000;
const listeners = new Set<() => void>();
function set(next: SessionState): void {
  state = next;
  for (const listener of [...listeners]) listener();
}

export const sessionStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  get: (): SessionState => state,
  /**
   * Load once per sign-in. `force` is the Retry button. An API that was briefly away is retried with
   * backoff until it answers, so a restart does not strand the page. A denial is an answer: it stays.
   */
  load(force = false): Promise<void> {
    if (pending) return pending;
    if (!force && state.status !== 'loading' && state.status !== 'error') return Promise.resolve();
    const started = generation;
    clearTimeout(retryTimer);
    // A background retry keeps the error on screen until there is something better to show.
    if (state.status !== 'error' || force) set({ status: 'loading' });
    const operation = (async () => {
      try {
        const { data } = await magnus.get('/console/session', consoleSessionResponseSchema);
        if (started !== generation) return;
        // securityConsoleUrl stays behind here: Cindertrace is in this console, so nothing links out.
        const { securityConsoleUrl: _ignored, ...capabilities } = data.capabilities;
        attempts = 0;
        set({ status: 'ready', session: { userId: data.userId, role: data.role, capabilities } });
      } catch (error) {
        if (started !== generation) return;
        const message = error instanceof Error ? error.message : 'Magnus could not be reached';
        if (error instanceof MagnusApiError && error.status === 403) {
          set({ status: 'denied', message });
          return;
        }
        set({ status: 'error', message });
        const delay = Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** attempts);
        attempts += 1;
        retryTimer = setTimeout(() => void sessionStore.load(), delay);
      }
    })().finally(() => {
      if (pending === operation) pending = undefined;
    });
    pending = operation;
    return operation;
  },
  reset(): void {
    generation += 1;
    attempts = 0;
    clearTimeout(retryTimer);
    pending = undefined;
    set({ status: 'loading' });
  },
};
onAccessCleared(() => sessionStore.reset());
