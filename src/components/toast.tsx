import { createContext, useCallback, useContext, useState, type CSSProperties, type ReactNode } from 'react';
import { Icon } from './icons';

type ToastTone = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  message?: string;
}

interface ToastApi {
  push: (tone: ToastTone, title: string, message?: string) => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

let counter = 0;
const lifetime = (tone: ToastTone): number => (tone === 'error' ? 6500 : 4000);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (tone: ToastTone, title: string, message?: string) => {
      const id = (counter += 1);
      setToasts((current) => [...current, { id, tone, title, ...(message ? { message } : {}) }]);
      window.setTimeout(() => remove(id), lifetime(tone));
    },
    [remove],
  );

  const api: ToastApi = {
    push,
    success: (title, message) => push('success', title, message),
    error: (title, message) => push('error', title, message),
    info: (title, message) => push('info', title, message),
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
            <button type="button" className="toast__close" aria-label="Dismiss notification" onClick={() => remove(toast.id)}>
              <Icon.Close />
            </button>
            <span className="toast__progress" aria-hidden="true" style={{ '--toast-ms': `${lifetime(toast.tone)}ms` } as CSSProperties} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
