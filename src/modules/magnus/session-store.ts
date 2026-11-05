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
  /** Load once per sign-in. `force` is the Retry button. */
  load(force = false): Promise<void> {
    if (pending) return pending;
    if (!force && state.status !== 'loading') return Promise.resolve();
    const started = generation;
    set({ status: 'loading' });
    const operation = (async () => {
      try {
        const { data } = await magnus.get('/console/session', consoleSessionResponseSchema);
        if (started !== generation) return;
        // securityConsoleUrl stays behind here: Cindertrace is in this console, so nothing links out.
        const { securityConsoleUrl: _ignored, ...capabilities } = data.capabilities;
        set({ status: 'ready', session: { userId: data.userId, role: data.role, capabilities } });
      } catch (error) {
        if (started !== generation) return;
        const message = error instanceof Error ? error.message : 'Magnus could not be reached';
        set(error instanceof MagnusApiError && error.status === 403 ? { status: 'denied', message } : { status: 'error', message });
      }
    })().finally(() => {
      if (pending === operation) pending = undefined;
    });
    pending = operation;
    return operation;
  },
  reset(): void {
    generation += 1;
    pending = undefined;
    set({ status: 'loading' });
  },
};
onAccessCleared(() => sessionStore.reset());
