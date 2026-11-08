import { createContext, useCallback, useContext, useState, type CSSProperties, type ReactNode } from 'react';
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
/** Errors and toasts with an action stay longer, so there is time to read or act. */
const lifetime = (tone: ToastTone, action?: ToastAction): number => (tone === 'error' || action ? 6500 : 4000);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (tone: ToastTone, title: string, message?: string, action?: ToastAction) => {
      const id = (counter += 1);
      setToasts((current) => [...current, { id, tone, title, ...(message ? { message } : {}), ...(action ? { action } : {}) }]);
      window.setTimeout(() => remove(id), lifetime(tone, action));
    },
    [remove],
  );

  const api: ToastApi = {
    push,
    success: (title, message, action) => push('success', title, message, action),
    error: (title, message) => push('error', title, message),
    info: (title, message, action) => push('info', title, message, action),
  };

  const iconFor = (tone: ToastTone) =>
    tone === 'success' ? <Icon.Check className="toast-ico" /> : tone === 'error' ? <Icon.Alert className="toast-ico" /> : <Icon.Info className="toast-ico" />;

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast--${toast.tone}`} onClick={() => remove(toast.id)}>
            {iconFor(toast.tone)}
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
                  remove(toast.id);
                  toast.action!.onAction();
                }}
              >
                {toast.action.label}
              </button>
            ) : null}
            <button type="button" className="toast__close" aria-label="Dismiss notification" onClick={() => remove(toast.id)}>
              <Icon.Close />
            </button>
            <span className="toast__progress" aria-hidden="true" style={{ '--toast-ms': `${lifetime(toast.tone, toast.action)}ms` } as CSSProperties} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
