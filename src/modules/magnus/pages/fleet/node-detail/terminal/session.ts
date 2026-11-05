// One terminal session, separate from React and from xterm so that it can be tested against a mock
// gateway. It renews every minute, reads the stream with fetch, sends input one chunk at a time and
// says why a session ended. Only INPUT_BUSY repeats a request: the gateway says that chunk was not
// taken. Anything else that fails is reported and never sent again.
import { onAccessCleared } from '../../../../../../lib/transport';
import { errorMessage, MagnusApiError } from '../../../../api/errors';
import { clampSize, type OpenedTerminal, type TerminalGateway, type TerminalSize } from './gateway';
import { endedNotice, INPUT_LOST, INPUT_STALLED, NO_AUTHORITY, refusedNotice, SESSION_GONE, SIGN_IN_AGAIN, SIGNED_OUT, UNREACHABLE, VERIFIED, VERIFY_FIRST, type TerminalNotice } from './messages';

export const MAX_INPUT_BYTES = 16 * 1024;
export const RENEW_INTERVAL_MS = 60_000;
const FLUSH_MS = 16;
const BUSY_RETRY_MS = 100;
const BUSY_RETRY_MAX_MS = 1000;
const BUSY_GIVE_UP_MS = 15_000;
/** The gateway keeps a session for 60 seconds with no reader, so stop just short of that. */
const RECONNECT_WINDOW_MS = 55_000;
const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 8000;
/** A stream that lasted this long was healthy, whatever ended it: an ingress may close quiet ones. */
const HEALTHY_STREAM_MS = 5000;

export type TerminalPhase = 'idle' | 'opening' | 'live' | 'reconnecting' | 'ended' | 'refused';
export interface TerminalView {
  phase: TerminalPhase;
  notice: TerminalNotice | null;
  /** False when trying again cannot help, such as a changed host key: it is an operator's action. */
  canOpenAgain: boolean;
  opened: OpenedTerminal | null;
}
export interface TerminalSink {
  /** Resolves once the bytes are parsed, so a slow browser slows the reader, and the gateway the shell. */
  write: (bytes: Uint8Array) => Promise<void>;
}
export interface TerminalSessionOptions {
  gateway: TerminalGateway;
  nodeId: string;
  sink: TerminalSink;
  onView: (view: TerminalView) => void;
}
export interface TerminalSession {
  open: (size: TerminalSize) => Promise<void>;
  send: (data: string) => void;
  resize: (size: TerminalSize) => void;
  /** The panel closed or unmounted. Ends the shell. */
  dispose: () => void;
  /** The page is going away: end the shell with what this session already holds. */
  leave: () => void;
}

const encoder = new TextEncoder();

/** Up to 16 KiB of UTF-8 from the front of `text`, never splitting a character. */
export function takeInputChunk(text: string, limit = MAX_INPUT_BYTES): string {
  if (text.length * 3 <= limit) return text;
  let bytes = 0;
  let index = 0;
  while (index < text.length) {
    const code = text.codePointAt(index)!;
    const width = code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    if (bytes + width > limit) break;
    bytes += width;
    index += code >= 0x10000 ? 2 : 1;
  }
  return text.slice(0, index);
}
export const inputBytes = (text: string): number => encoder.encode(text).byteLength;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createTerminalSession({ gateway, nodeId, sink, onView }: TerminalSessionOptions): TerminalSession {
  let view: TerminalView = { phase: 'idle', notice: null, canOpenAgain: false, opened: null };
  let disposed = false;
  let sessionId: string | null = null;
  let connection: AbortController | null = null;
  let renewTimer: ReturnType<typeof setInterval> | undefined;
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let pending = '';
  let sending = false;
  let lastSize: TerminalSize = { cols: 0, rows: 0 };
  let signedOutWhileOpening = false;

  const show = (next: Partial<TerminalView>) => {
    view = { ...view, ...next };
    if (!disposed) onView(view);
  };
  const live = () => view.phase === 'live' || view.phase === 'reconnecting';

  function stopWork() {
    clearInterval(renewTimer);
    clearTimeout(flushTimer);
    pending = '';
    connection?.abort();
    connection = null;
  }
  /** The session is over and the gateway said so, or nothing can be done about it here. */
  function finish(notice: TerminalNotice) {
    sessionId = null;
    stopWork();
    // An open still in flight may yet have to close its shell.
    if (!signedOutWhileOpening) gateway.forget();
    unsubscribe();
    show({ phase: 'ended', notice, canOpenAgain: notice !== SIGNED_OUT });
  }
  /** Ends on this side only when the gateway may still hold the shell: ask it to close. */
  function abandon(notice: TerminalNotice) {
    if (sessionId) void gateway.close(sessionId).catch(() => undefined);
    finish(notice);
  }
  function refusedBy(error: unknown): TerminalNotice | null {
    if (!(error instanceof MagnusApiError)) return null;
    if (error.status === 404) return SESSION_GONE;
    if (error.status === 401) return SIGN_IN_AGAIN;
    if (error.status === 403) return NO_AUTHORITY;
    return null;
  }

  const unsubscribe = onAccessCleared(() => {
    if (disposed) return;
    // The transport has dropped its token already, and the sign-in ends next.
    if (sessionId) gateway.closeNow(sessionId);
    if (view.phase === 'opening') signedOutWhileOpening = true;
    finish(SIGNED_OUT);
  });

  /** Read the stream until the session ends, reconnecting after a drop as the gateway allows. */
  async function pump(id: string) {
    let deadline: number | null = null;
    let attempt = 0;
    while (sessionId === id) {
      const startedAt = Date.now();
      const current = new AbortController();
      connection = current;
      let received = false;
      try {
        const reader = (await gateway.stream(id, current.signal)).getReader();
        if (sessionId === id) show({ phase: 'live' });
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (sessionId !== id) return;
          if (value?.byteLength) {
            received = true;
            await sink.write(value);
          }
        }
      } catch (error) {
        if (sessionId !== id) return;
        const refused = refusedBy(error);
        // A 404 can be a session that ended: only its status can say why.
        if (refused && !(error instanceof MagnusApiError && error.status === 404)) {
          finish(refused);
          return;
        }
      }
      if (sessionId !== id) return;
      if (received || Date.now() - startedAt >= HEALTHY_STREAM_MS) {
        deadline = null;
        attempt = 0;
      }
      deadline ??= Date.now() + RECONNECT_WINDOW_MS;
      // A clean end or an error means the shell may be gone. Only status can tell.
      try {
        const status = await gateway.status(id);
        if (sessionId !== id) return;
        if (status.state === 'ended') {
          finish(endedNotice(status.reason));
          return;
        }
      } catch (error) {
        if (sessionId !== id) return;
        const refused = refusedBy(error);
        if (refused) {
          finish(refused);
          return;
        }
      }
      if (Date.now() >= deadline) {
        abandon(UNREACHABLE);
        return;
      }
      show({ phase: 'reconnecting' });
      await wait(Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** attempt));
      attempt += 1;
    }
  }

  async function deliver(id: string, chunk: string): Promise<boolean> {
    const giveUpAt = Date.now() + BUSY_GIVE_UP_MS;
    for (let attempt = 0; sessionId === id; attempt += 1) {
      try {
        await gateway.input(id, chunk);
        if (view.notice === INPUT_LOST || view.notice === INPUT_STALLED) show({ notice: null });
        return true;
      } catch (error) {
        if (sessionId !== id) return false;
        if (error instanceof MagnusApiError && error.code === 'INPUT_BUSY') {
          if (Date.now() >= giveUpAt) {
            pending = '';
            show({ notice: INPUT_STALLED });
            return false;
          }
          await wait(Math.min(BUSY_RETRY_MAX_MS, BUSY_RETRY_MS * 2 ** attempt));
          continue;
        }
        pending = '';
        // A refusal means the session changed state: drop the reader, and its status says why.
        if (refusedBy(error)) connection?.abort();
        else show({ notice: INPUT_LOST });
        return false;
      }
    }
    return false;
  }
  /** One request at a time, in order, each a whole number of characters. */
  async function flush() {
    flushTimer = undefined;
    if (sending) return;
    sending = true;
    try {
      while (pending && sessionId) {
        const chunk = takeInputChunk(pending);
        pending = pending.slice(chunk.length);
        if (!(await deliver(sessionId, chunk))) break;
      }
    } finally {
      sending = false;
    }
  }

  return {
    async open(size) {
      if (disposed || view.phase === 'opening' || live()) return;
      const requested = clampSize(size);
      lastSize = requested;
      show({ phase: 'opening', notice: null, canOpenAgain: false, opened: null });
      let opened: OpenedTerminal;
      try {
        opened = await gateway.open(nodeId, requested);
      } catch (error) {
        if (disposed || signedOutWhileOpening) return;
        if (error instanceof MagnusApiError && error.retryAfterStepUp) show({ phase: 'refused', notice: VERIFIED, canOpenAgain: true });
        else if (error instanceof MagnusApiError && error.code === 'STEP_UP_REQUIRED') show({ phase: 'refused', notice: VERIFY_FIRST, canOpenAgain: true });
        else if (error instanceof MagnusApiError) {
          const { notice, final } = refusedNotice(error.code, error.message);
          show({ phase: 'refused', notice, canOpenAgain: !final });
        } else show({ phase: 'refused', notice: { tone: 'danger', title: 'The terminal could not open', message: errorMessage(error, 'The fleet gateway could not be reached.') }, canOpenAgain: true });
        return;
      }
      // Closed while opening: the shell exists now, and only its id can end it.
      if (disposed) {
        void gateway.close(opened.sessionId).catch(() => undefined).finally(() => gateway.forget());
        return;
      }
      if (signedOutWhileOpening) {
        gateway.closeNow(opened.sessionId);
        gateway.forget();
        return;
      }
      sessionId = opened.sessionId;
      show({ phase: 'live', opened, canOpenAgain: false });
      renewTimer = setInterval(() => {
        const id = sessionId;
        if (!id) return;
        gateway.renew(id).catch((error: unknown) => {
          // A network failure is left to the next tick. A refusal means the session is over.
          if (sessionId === id && refusedBy(error)) connection?.abort();
        });
      }, RENEW_INTERVAL_MS);
      // The panel may have been resized while the open was in flight.
      if (lastSize !== requested) void gateway.resize(opened.sessionId, lastSize).catch(() => undefined);
      void pump(opened.sessionId);
    },
    send(data) {
      if (!sessionId || !data) return;
      pending += data;
      flushTimer ??= setTimeout(() => void flush(), FLUSH_MS);
    },
    resize(size) {
      const next = clampSize(size);
      if (lastSize.cols === next.cols && lastSize.rows === next.rows) return;
      lastSize = next;
      if (sessionId) void gateway.resize(sessionId, next).catch(() => undefined);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      const id = sessionId;
      sessionId = null;
      stopWork();
      if (id) void gateway.close(id).catch(() => undefined).finally(() => gateway.forget());
    },
    leave() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      if (sessionId) gateway.closeNow(sessionId);
      sessionId = null;
      stopWork();
      gateway.forget();
    },
  };
}
