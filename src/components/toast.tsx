import { createContext, useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Icon } from './icons';

type ToastTone = 'success' | 'error' | 'info';

/** One button on the toast, such as Undo. Choosing it also dismisses the toast. */
export interface ToastAction {
  label: string;
  onAction: () => void;
}

interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  message?: string;
  action?: ToastAction;
}

interface ToastApi {
  push: (tone: ToastTone, title: string, message?: string, action?: ToastAction) => void;
  success: (title: string, message?: string, action?: ToastAction) => void;
  error: (title: string, message?: string) => void;
  info: (title: string, message?: string, action?: ToastAction) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

let counter = 0;
/**
 * How long a toast stays, in milliseconds, or `null` for one that stays until dismissed. Errors
 * stay: they often carry a request ID to copy (WCAG 2.2.1). Toasts with an action stay longer.
 */
const lifetime = (tone: ToastTone, action?: ToastAction): number | null => (tone === 'error' ? null : action ? 6500 : 4000);
/** Oldest toasts leave first once this many are on screen, so persistent errors cannot pile up. */
const MAX_TOASTS = 5;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback((tone: ToastTone, title: string, message?: string, action?: ToastAction) => {
    const id = (counter += 1);
    setToasts((current) => [...current, { id, tone, title, ...(message ? { message } : {}), ...(action ? { action } : {}) }].slice(-MAX_TOASTS));
  }, []);

  const api: ToastApi = {
    push,
    success: (title, message, action) => push('success', title, message, action),
    error: (title, message) => push('error', title, message),
    info: (title, message, action) => push('info', title, message, action),
  };

  // Errors are announced assertively: each one is an alert, read as it appears. Everything else
  // goes to a polite live region that is always in the document, so additions to it are read.
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack">
        <div className="toast-region">
          {toasts.filter((toast) => toast.tone === 'error').map((toast) => <ToastItem key={toast.id} toast={toast} onRemove={remove} />)}
        </div>
        <div className="toast-region" role="status" aria-live="polite">
          {toasts.filter((toast) => toast.tone !== 'error').map((toast) => <ToastItem key={toast.id} toast={toast} onRemove={remove} />)}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: (id: number) => void }) {
  const ms = lifetime(toast.tone, toast.action);
  const [paused, setPaused] = useState(false);
  // Time left, kept across pauses: hovering or focusing the toast stops the clock.
  const remaining = useRef(ms ?? 0);

  useEffect(() => {
    if (ms === null || paused) return undefined;
    const started = Date.now();
    const timer = window.setTimeout(() => onRemove(toast.id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - started));
    };
  }, [ms, paused, onRemove, toast.id]);

  const icon = toast.tone === 'success' ? <Icon.Check className="toast-ico" /> : toast.tone === 'error' ? <Icon.Alert className="toast-ico" /> : <Icon.Info className="toast-ico" />;

  return (
    <div
      className={`toast toast--${toast.tone}${paused ? ' toast--paused' : ''}`}
      role={ms === null ? 'alert' : undefined}
      // An error is not dismissed by clicking its text, so its request ID can be selected and copied.
      onClick={ms === null ? undefined : () => onRemove(toast.id)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused(false);
      }}
    >
      {icon}
      <div className="toast__body">
        <strong>{toast.title}</strong>
        {toast.message ? <span>{toast.message}</span> : null}
      </div>
      {toast.action ? (
        <button
          type="button"
          className="toast__action"
          onClick={(event) => {
            event.stopPropagation();
            onRemove(toast.id);
            toast.action!.onAction();
          }}
        >
          {toast.action.label}
        </button>
      ) : null}
      <button
        type="button"
        className="toast__close"
        aria-label="Dismiss notification"
        onClick={(event) => {
          event.stopPropagation();
          onRemove(toast.id);
        }}
      >
        <Icon.Close />
      </button>
      {ms === null ? null : <span className="toast__progress" aria-hidden="true" style={{ '--toast-ms': `${ms}ms` } as CSSProperties} />}
    </div>
  );
}
