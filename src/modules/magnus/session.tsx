import { useCallback, useSyncExternalStore, type ReactNode } from 'react';
import { sessionStore, type MagnusSession, type SessionState } from './session-store';
import type { ConsoleRole } from './routes';

/** Which roles the contract names for writes. Use with useCan or RequireRole. */
export const WRITE_ROLES: readonly ConsoleRole[] = ['ADMIN', 'OPERATOR'];
export const ADMIN_ONLY: readonly ConsoleRole[] = ['ADMIN'];

export interface MagnusSessionView {
  state: SessionState;
  session: MagnusSession | null;
  role: ConsoleRole | null;
  hermes: boolean;
  /** Offer the web terminal. GET /console/session decides; the gateway still enforces it. */
  terminal: boolean;
  /** Whether this session's role is one of these. False until the session has loaded. */
  can: (roles: readonly ConsoleRole[]) => boolean;
  retry: () => Promise<void>;
}

/** GET /console/session as a hook. The module's mount has loaded it before any page renders. */
export function useMagnusSession(): MagnusSessionView {
  const state = useSyncExternalStore(sessionStore.subscribe, sessionStore.get);
  const session = state.status === 'ready' ? state.session : null;
  const role = session?.role ?? null;
  const can = useCallback((roles: readonly ConsoleRole[]) => role !== null && roles.includes(role), [role]);
  const retry = useCallback(() => sessionStore.load(true), []);
  return { state, session, role, hermes: session?.capabilities.hermes === true, terminal: session?.capabilities.terminal === true, can, retry };
}

/** Hide an action from roles the server would refuse. The server still enforces the rule. */
export function RequireRole({ roles, children, fallback = null }: { roles: readonly ConsoleRole[]; children: ReactNode; fallback?: ReactNode }) {
  return <>{useMagnusSession().can(roles) ? children : fallback}</>;
}
/** Hide a Hermes section unless the server has Hermes on. */
export function RequireHermes({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  return <>{useMagnusSession().hermes ? children : fallback}</>;
}
