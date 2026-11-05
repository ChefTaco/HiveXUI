// The web terminal. This file and what it imports are one lazy chunk, loaded when someone opens a
// terminal, so xterm never reaches the main bundle. A console XSS would be a shell, so what a node
// sends goes only into xterm as bytes, and its name and every message are React text. Escape belongs
// to the shell here (vim needs it), so this is not a Drawer, and nothing closes it by accident.
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { TerminalSquare, X } from 'lucide-react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal, type ITheme } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { Badge, Button } from '@ui';
import { cn } from '@lib/cn';
import { formatTime } from '@lib/format';
import { subscribeTheme } from '@lib/theme';
import { readThemeColors } from '@lib/theme-colors';
import { createTerminalGateway, type TerminalGateway } from './gateway';
import { endedNotice } from './messages';
import { createTerminalSession, type TerminalPhase, type TerminalView } from './session';

const INITIAL_VIEW: TerminalView = { phase: 'idle', notice: null, canOpenAgain: false, opened: null };
const RESIZE_DEBOUNCE_MS = 120;
const FONT_WAIT_MS = 800;
const PHASE: Record<TerminalPhase, { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' }> = {
  idle: { label: 'Starting', tone: 'neutral' },
  opening: { label: 'Connecting', tone: 'warning' },
  live: { label: 'Connected', tone: 'success' },
  reconnecting: { label: 'Reconnecting', tone: 'warning' },
  ended: { label: 'Ended', tone: 'neutral' },
  refused: { label: 'Not connected', tone: 'danger' },
};
const NOTICE_CLASS = {
  info: 'border-info bg-info-soft',
  warning: 'border-warning bg-warning-soft',
  danger: 'border-danger bg-danger-soft',
};

function idleLimit(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  return minutes < 2 ? `${seconds} seconds` : `${minutes} minutes`;
}

function terminalTheme(): ITheme {
  const colors = readThemeColors();
  return {
    background: colors['surface-page'],
    foreground: colors.text,
    cursor: colors.accent,
    cursorAccent: colors['surface-page'],
    selectionBackground: colors.accent,
    selectionForeground: colors['surface-page'],
    red: colors.danger,
    green: colors.success,
    yellow: colors.warning,
    blue: colors.info,
    cyan: colors.accent,
  };
}

export default function TerminalPanel({ nodeId, nodeName, onClose, createGateway = createTerminalGateway }: { nodeId: string; nodeName: string; onClose: () => void; createGateway?: () => TerminalGateway }) {
  const host = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const [view, setView] = useState<TerminalView>(INITIAL_VIEW);
  // Each attempt is a new terminal and a new session.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let stopped = false;
    let stop = () => {};
    setView(INITIAL_VIEW);
    void (async () => {
      const { fontFamily, fontSize } = getComputedStyle(element);
      const size = Number.parseFloat(fontSize) || undefined;
      // xterm measures its cell once, so the font has to be here first. A slow font only costs a sharp edge.
      await Promise.race([document.fonts?.load(`${fontSize} ${fontFamily}`).catch(() => undefined), new Promise((resolve) => setTimeout(resolve, FONT_WAIT_MS))]);
      if (stopped) return;
      const term = new Terminal({
        allowProposedApi: false,
        cursorBlink: true,
        scrollback: 5000,
        fontFamily,
        ...(size ? { fontSize: size } : {}),
        theme: terminalTheme(),
        // A hyperlink from a node (OSC 8) opens nothing. The default asks with confirm() and then navigates.
        linkHandler: { activate: () => undefined, allowNonHttpProtocols: false },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(element);
      fit.fit();
      terminal.current = term;
      let release: (() => void) | undefined;
      const session = createTerminalSession({
        gateway: createGateway(),
        nodeId,
        onView: (next) => {
          setView(next);
          term.options.disableStdin = next.phase !== 'live' && next.phase !== 'reconnecting';
          term.options.cursorBlink = !term.options.disableStdin;
        },
        sink: {
          write: (bytes) => new Promise((resolve) => {
            release = resolve;
            term.write(bytes, resolve);
          }),
        },
      });
      const subscriptions = [
        term.onData((data) => session.send(data)),
        // X10 mouse reports. A body is text, so only those that are ASCII survive the trip intact.
        // eslint-disable-next-line no-control-regex
        term.onBinary((data) => { if (/^[\x00-\x7f]*$/.test(data)) session.send(data); }),
        term.onResize((size) => session.resize(size)),
      ];
      // Tab belongs to the shell too, so this is how a keyboard leaves.
      term.attachCustomKeyEventHandler((event) => {
        if (event.type !== 'keydown' || !event.altKey || !event.shiftKey || event.code !== 'KeyQ') return true;
        closeButton.current?.focus();
        return false;
      });
      let resizeTimer: ReturnType<typeof setTimeout> | undefined;
      const observer = new ResizeObserver(() => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => fit.fit(), RESIZE_DEBOUNCE_MS);
      });
      observer.observe(element);
      const unsubscribeTheme = subscribeTheme(() => { term.options.theme = terminalTheme(); });
      // Closing the tab: there is no time to mint a token, and the gateway would otherwise wait for its limits.
      const leaving = () => {
        session.leave();
        setView({ phase: 'ended', notice: endedNotice('client-closed'), canOpenAgain: true, opened: null });
      };
      window.addEventListener('pagehide', leaving);
      stop = () => {
        window.removeEventListener('pagehide', leaving);
        unsubscribeTheme();
        observer.disconnect();
        clearTimeout(resizeTimer);
        for (const subscription of subscriptions) subscription.dispose();
        session.dispose();
        release?.();
        terminal.current = null;
        term.dispose();
      };
      term.focus();
      void session.open({ cols: term.cols, rows: term.rows });
    })();
    return () => {
      stopped = true;
      stop();
    };
  }, [nodeId, attempt, createGateway]);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  // Only the close button and the terminal hold focus, so Tab moves between them.
  function holdFocus(event: ReactKeyboardEvent) {
    if (event.key !== 'Tab' || document.activeElement !== closeButton.current) return;
    if (!terminal.current) return;
    event.preventDefault();
    terminal.current.focus();
  }

  const { phase, notice, canOpenAgain, opened } = view;
  const state = PHASE[phase];
  return createPortal(
    <div className="modal-center">
      <section role="dialog" aria-modal="true" aria-label={`Terminal on ${nodeName}`} onKeyDown={holdFocus} className="flex h-[85vh] w-full min-w-0 max-w-6xl flex-col gap-3 rounded-dialog border border-border-strong bg-surface p-3 shadow-[var(--shadow-overlay)]">
        <header className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <TerminalSquare aria-hidden="true" className="size-5 shrink-0 text-accent" />
          <h3 className="m-0 min-w-0 flex-1 truncate text-base font-semibold">{nodeName}</h3>
          <span role="status"><Badge tone={state.tone} dot={phase === 'live'}>{state.label}</Badge></span>
          <button ref={closeButton} type="button" className="btn btn--icon btn--ghost" title="Close terminal" aria-label="Close terminal" onClick={onClose}><X aria-hidden="true" className="size-4" /></button>
        </header>
        <p className="m-0 text-xs text-text-muted">
          Alt+Shift+Q moves focus to Close. Closing ends the shell.
          {opened ? ` Ends after ${idleLimit(opened.idleTimeoutSeconds)} without input, and by ${formatTime(opened.expiresAt)} at the latest.` : ''}
        </p>
        {notice ? (
          <div role="alert" className={cn('flex flex-wrap items-center gap-x-4 gap-y-2 rounded-control border px-3 py-2 text-sm', NOTICE_CLASS[notice.tone])}>
            <div className="min-w-0 flex-1 basis-64">
              <p className="m-0 font-semibold">{notice.title}</p>
              <p className="m-0 break-words">{notice.message}</p>
            </div>
            {canOpenAgain ? <Button size="sm" variant="primary" onClick={() => setAttempt((value) => value + 1)}>Open terminal again</Button> : null}
          </div>
        ) : null}
        <div ref={host} data-testid="terminal-host" className={cn('min-h-0 flex-1 overflow-hidden rounded-control border border-border bg-bg p-2 font-mono text-sm', phase === 'refused' && 'opacity-60')} />
      </section>
    </div>,
    document.body,
  );
}
