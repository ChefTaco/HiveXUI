// One place decides that the signed-in session is over, for every page and every tab.
//
// A product that answers 401 does not by itself mean the person is signed out: its token may just
// have expired, or the product may refuse this one client. The shell asks the identity service
// (`verifySession`), and only its refusal ends the session. Oathweave's own refusal of the browser
// session or of a new authorization, seen by the access provider, ends it as well. Every listener
// (the shell) then returns to sign-in, keeping the address so the same page opens afterwards.
//
// Signing out in one tab signs out the others: the tab that signs out posts on a BroadcastChannel,
// and every other tab of the console forgets its tokens and shows the sign-in form. The channel
// carries no token or user detail, only that the session ended.
import { HiveApiError } from './api-error';

/** Why the session ended: it expired, or the person signed out (here or in another tab). */
export type SessionEnd = 'expired' | 'signed-out';
type Listener = (reason: SessionEnd) => void;

const CHANNEL = 'hivexui-session';
const listeners = new Set<Listener>();
let channel: BroadcastChannel | null | undefined;

function openChannel(): BroadcastChannel | null {
  if (channel !== undefined) return channel;
  channel = null;
  try {
    if (typeof BroadcastChannel === 'function') {
      channel = new BroadcastChannel(CHANNEL);
      channel.onmessage = (event: MessageEvent) => {
        const data: unknown = event.data;
        if (data && typeof data === 'object' && 'type' in data && data.type === 'signed-out') notify('signed-out');
      };
    }
  } catch {
    channel = null;
  }
  return channel;
}

function notify(reason: SessionEnd): void {
  for (const listener of [...listeners]) listener(reason);
}

/** Listen for the end of the session. The shell returns to sign-in here. */
export function onSessionEnded(listener: Listener): () => void {
  openChannel();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The session is over in this tab: an identity refusal, or a sign-out. */
export function sessionEnded(reason: SessionEnd = 'expired'): void {
  notify(reason);
}

/** Tell the console's other tabs that this one signed out. This tab handles its own sign-out. */
export function announceSignOut(): void {
  try {
    openChannel()?.postMessage({ type: 'signed-out' });
  } catch {
    // A closed channel: the other tabs find out at their next request.
  }
}

/**
 * Whether a failed session check means the sign-in service is down, not that nobody is signed in:
 * the request never got an answer, or the service or its gateway answered with a 5xx.
 */
export function signInServiceUnreachable(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  return error instanceof HiveApiError && error.status >= 500;
}

let checker: (() => Promise<unknown>) | undefined;
let pending: Promise<boolean> | undefined;
let confirmedAt = 0;
/** A check that passed this recently answers a burst of 401s without asking again. */
const CONFIRMED_MS = 10_000;

/** Runtime registers the identity service's session read (`/browser/session`) here. */
export function setSessionChecker(check: (() => Promise<unknown>) | undefined): void {
  checker = check;
  pending = undefined;
  confirmedAt = 0;
}

/**
 * A product answered 401. Ask the identity service whether the session still exists, once for any
 * number of callers; end it only when the service refuses it. An outage keeps the person signed in.
 * Answers whether the session is still valid.
 */
export function verifySession(now: () => number = Date.now): Promise<boolean> {
  const check = checker;
  if (!check) return Promise.resolve(true);
  if (now() - confirmedAt < CONFIRMED_MS) return Promise.resolve(true);
  pending ??= (async () => {
    try {
      await check();
      confirmedAt = now();
      return true;
    } catch (error) {
      if (signInServiceUnreachable(error)) return true;
      sessionEnded('expired');
      return false;
    } finally {
      pending = undefined;
    }
  })();
  return pending;
}

/** Test hook: forget the channel and listeners. */
export function resetSessionEvents(): void {
  listeners.clear();
  channel?.close();
  channel = undefined;
  setSessionChecker(undefined);
}
