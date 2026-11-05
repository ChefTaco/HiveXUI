import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type HTMLAttributes,
  type PropsWithChildren,
  type ReactNode,
} from 'react';
import { cn } from '../lib/cn';
import { Icon } from './icons';

/* ===== Button ===== */
export function Button({
  variant = 'default',
  size,
  icon,
  loading,
  children,
  ...rest
}: {
  variant?: 'default' | 'primary' | 'ghost' | 'danger' | 'warning';
  size?: 'sm';
  icon?: ReactNode;
  loading?: boolean | undefined;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { disabled, className, ...buttonProps } = rest;
  return (
    <button className={cn('btn', variant !== 'default' && `btn--${variant}`, size === 'sm' && 'btn--sm', className)} disabled={loading || disabled} {...buttonProps}>
      {loading ? <span className="spinner" /> : icon}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  icon,
  variant = 'ghost',
  ...rest
}: {
  label: string;
  icon: ReactNode;
  variant?: 'default' | 'ghost' | 'danger';
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const classes = ['btn', 'btn--icon'];
  if (variant !== 'default') classes.push(`btn--${variant}`);
  return (
    <button className={classes.join(' ')} title={label} aria-label={label} {...rest}>
      {icon}
    </button>
  );
}

/* ===== Tones ===== */
/** What a color means. Every badge, dot, meter, stat and empty state takes one of these. */
export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

/** Map a service, node or job status onto a tone. */
export function statusTone(status: string): Tone {
  switch (status.toUpperCase()) {
    case 'ONLINE':
    case 'COMPLETED':
    case 'ACTIVE':
    case 'RUNNING':
    case 'INSTALLED':
    case 'HEALTHY':
    case 'SUCCEEDED':
      return 'success';
    case 'DEGRADED':
    case 'PAUSED':
    case 'QUEUED':
    case 'PENDING':
    case 'INSTALLING':
      return 'warning';
    case 'OFFLINE':
    case 'FAILED':
    case 'ERROR':
    case 'TIMEOUT':
    case 'CANCELLED':
    case 'DECOMMISSIONED':
    case 'CRITICAL':
      return 'danger';
    case 'PROVISIONING':
    case 'UPDATING':
      return 'info';
    default:
      return 'neutral';
  }
}

/* ===== Badge ===== */
export function Badge({
  tone = 'neutral',
  dot,
  className,
  children,
}: PropsWithChildren<{ tone?: Tone; dot?: boolean; className?: string }>) {
  return (
    <span className={cn('badge', tone !== 'neutral' && `badge--${tone}`, className)}>
      {dot ? <span className="dot" /> : null}
      {children}
    </span>
  );
}

export function EnabledBadge({ enabled }: { enabled: boolean }) {
  return <Badge tone={enabled ? 'success' : 'neutral'} dot>{enabled ? 'Enabled' : 'Disabled'}</Badge>;
}

export function HealthBadge({ status }: { status?: string | null | undefined }) {
  const value = (status ?? 'unknown').toLowerCase();
  const tone: Tone = value === 'healthy' ? 'success' : value === 'unknown' ? 'neutral' : 'danger';
  return <Badge tone={tone} dot>{value}</Badge>;
}

export function OutcomeBadge({ outcome }: { outcome: string }) {
  const value = outcome.toUpperCase();
  const tone: Tone =
    value === 'SUCCEEDED' ? 'success' : value === 'DENIED' ? 'warning' : value.includes('FAIL') ? 'danger' : 'info';
  return <Badge tone={tone}>{outcome.toLowerCase()}</Badge>;
}

/* ===== Status dot ===== */
const LIVE_STATUS = new Set(['ONLINE', 'RUNNING', 'ACTIVE', 'HEALTHY', 'CRITICAL', 'UPDATING', 'PROVISIONING']);

export function StatusDot({
  status,
  pulse,
  label,
  className,
}: {
  status: string;
  /** Halo animation; defaults on for live states. */
  pulse?: boolean;
  label?: string;
  className?: string;
}) {
  const tone = statusTone(status);
  return (
    <span
      className={cn('status-dot', tone !== 'neutral' && `status-dot--${tone}`, (pulse ?? LIVE_STATUS.has(status.toUpperCase())) && 'status-dot--live', className)}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}

/* ===== Meter ===== */
export function Meter({
  value,
  max = 100,
  tone = 'accent',
  label,
  valueLabel,
  className,
}: {
  value: number | null | undefined;
  max?: number;
  tone?: Tone;
  label: string;
  /** Text shown beside the bar, in place of the computed percentage. */
  valueLabel?: string;
  className?: string;
}) {
  const known = typeof value === 'number' && Number.isFinite(value);
  const percent = known ? Math.max(0, Math.min(100, (value / (max || 1)) * 100)) : 0;
  const text = valueLabel ?? (known ? `${Math.round(percent)}%` : '—');
  return (
    <div className={cn('meter', `tone-${known ? tone : 'neutral'}`, className)}>
      <div className="meter__track" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={known ? value : undefined} aria-valuetext={text}>
        <div className="meter__fill" style={{ '--meter': `${percent}%` } as CSSProperties} />
      </div>
      <span className="meter__value">{text}</span>
    </div>
  );
}

/* ===== Skeleton ===== */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('skeleton h-3 w-full', className)} />;
}

/* ===== Stat card ===== */
export function StatCard({
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className={cn('stat-card', tone !== 'neutral' && `stat-card--${tone}`)}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub ? <span className="stat-sub">{sub}</span> : null}
    </div>
  );
}

/* ===== Page header ===== */
export function PageHeader({
  title,
  eyebrow,
  description,
  icon,
  status,
  actions,
  className,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  /** A badge shown beside the title. */
  status?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('page-head', className)}>
      <div className="flex items-start gap-3">
        {icon ? <span className="page-head__icon" aria-hidden="true">{icon}</span> : null}
        <div className="min-w-0">
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <div className="flex flex-wrap items-center gap-3">
            <h2>{title}</h2>
            {status}
          </div>
          {description ? <p>{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="page-head__actions">{actions}</div> : null}
    </div>
  );
}

/* ===== Panel ===== */
type PanelProps = PropsWithChildren<
  {
    title?: ReactNode;
    eyebrow?: ReactNode;
    description?: ReactNode;
    actions?: ReactNode;
    /** `warning` and `danger` color the outline for content that needs care. */
    tone?: 'warning' | 'danger' | undefined;
    /** `sm` for cards in a grid; `none` when a table or list fills the panel edge to edge. */
    padding?: 'sm' | 'md' | 'none';
    /** Hover glow, colored by meaning. */
    glow?: 'accent' | 'success' | 'warning' | 'danger' | 'info' | undefined;
    as?: 'section' | 'div' | 'article' | 'form';
  } & Omit<HTMLAttributes<HTMLElement>, 'title'>
>;

export function Panel({ title, eyebrow, description, actions, tone, padding = 'md', glow, as: Tag = 'section', className, children, ...rest }: PanelProps) {
  return (
    <Tag {...rest} className={cn('panel', padding !== 'md' && `panel--${padding}`, tone && `panel--${tone}`, glow && 'glow-hover', glow && glow !== 'accent' && `glow-hover--${glow}`, className)}>
      {title || eyebrow || actions ? (
        <div className="panel-header">
          <div>
            {eyebrow ? <p className="panel-eyebrow">{eyebrow}</p> : null}
            {title ? <h3>{title}</h3> : null}
            {description ? <p>{description}</p> : null}
          </div>
          {actions ? <div className="panel-actions">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </Tag>
  );
}

/* ===== Table ===== */
/** A labelled, keyboard-scrollable frame; put a plain <table> inside. */
export function TableFrame({ label, className, children }: PropsWithChildren<{ label: string; className?: string }>) {
  return (
    <div className={cn('table-wrap', className)} role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}

/* ===== Fields ===== */
export function Field({ label, hint, children }: PropsWithChildren<{ label: string; hint?: string }>) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function TextInput({
  value,
  onChange,
  ...rest
}: { value: string; onChange: (value: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return <input value={value} onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)} {...rest} />;
}

export function TextArea({
  value,
  onChange,
  ...rest
}: { value: string; onChange: (value: string) => void } & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'>) {
  return <textarea value={value} onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value)} {...rest} />;
}

export function Select({
  value,
  onChange,
  options,
  ...rest
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
} & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'>) {
  return (
    <select value={value} onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)} {...rest}>
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

export function Toggle({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" />
      {label}
    </label>
  );
}

/* ===== Empty state ===== */
export function EmptyState({
  icon,
  title,
  message,
  action,
  tone = 'neutral',
  compact = false,
  framed = false,
  className,
}: {
  icon?: ReactNode;
  title?: ReactNode;
  message?: ReactNode;
  action?: ReactNode;
  tone?: 'neutral' | 'warning' | 'danger';
  compact?: boolean;
  /** A dashed outline, for an empty state that stands alone on the page rather than inside a panel. */
  framed?: boolean;
  className?: string;
}) {
  return (
    <div
      role={tone === 'neutral' ? undefined : 'alert'}
      className={cn('empty-state', tone !== 'neutral' && `empty-state--${tone}`, compact && 'empty-state--compact', framed && 'empty-state--framed', className)}
    >
      {icon ? <div className="empty-ico">{icon}</div> : null}
      {title ? <p className="empty-state__title">{title}</p> : null}
      {message ? <p className="empty-state__message">{message}</p> : null}
      {action ? <div className="empty-state__action">{action}</div> : null}
    </div>
  );
}

/* ===== JSON block ===== */
const JSON_INLINE_LIMIT = 4000;
export function JsonBlock({ value }: { value: unknown }) {
  let text: string;
  try {
    text = typeof value === 'string' ? JSON.stringify(JSON.parse(value), null, 2) : JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  // Stored values can be whole API documents; keep them from swallowing the page.
  if (text.length > JSON_INLINE_LIMIT)
    return (
      <details className="json-collapsed">
        <summary>Show value ({Math.round(text.length / 1024)} KB)</summary>
        <pre className="code-block">{text}</pre>
      </details>
    );
  return <pre className="code-block">{text}</pre>;
}

/* ===== Drawer ===== */
export function Drawer({
  open,
  title,
  eyebrow,
  onClose,
  footer,
  children,
}: PropsWithChildren<{ open: boolean; title: string; eyebrow?: string; onClose: () => void; footer?: ReactNode }>) {
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => [...(drawerRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') ?? [])].filter((element) => element.getClientRects().length > 0);
    (focusable()[0] ?? drawerRef.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); }
      if (e.key === 'Tab') {
        const elements = focusable(); const first = elements[0]; const last = elements.at(-1);
        if (!first) { e.preventDefault(); drawerRef.current?.focus(); }
        else if (e.shiftKey && (document.activeElement === first || !drawerRef.current?.contains(document.activeElement))) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || !drawerRef.current?.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); if (previousFocus?.isConnected) previousFocus.focus(); };
  }, [open]);

  if (!open) return null;
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside ref={drawerRef} className="drawer" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        <div className="drawer-header">
          <div>
            {eyebrow ? <p className="panel-eyebrow">{eyebrow}</p> : null}
            <h3>{title}</h3>
          </div>
          <IconButton label="Close" icon={<Icon.Close />} onClick={onClose} />
        </div>
        <div className="drawer-body">{children}</div>
        {footer ? <div className="drawer-footer">{footer}</div> : null}
      </aside>
    </>
  );
}

/* ===== Confirm dialog ===== */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Delete',
  onConfirm,
  onCancel,
  loading,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  const titleId = useId(), messageId = useId();
  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const buttons = () => [...(dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
    (buttons()[0] ?? dialogRef.current)?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); cancelRef.current(); }
      if (event.key === 'Tab') {
        const elements = buttons(), first = elements[0], last = elements.at(-1);
        if (!first) { event.preventDefault(); dialogRef.current?.focus(); }
        else if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); if (previousFocus?.isConnected) previousFocus.focus(); };
  }, [open]);
  if (!open) return null;
  return (
    <div className="modal-center" onClick={onCancel}>
      <div ref={dialogRef} className="confirm-box" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={messageId} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <h3 id={titleId}>{title}</h3>
        <p id={messageId}>{message}</p>
        <div className="confirm-actions">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} loading={loading} icon={<Icon.Trash className="btn-ico" />}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ===== Copy field ===== */
export function CopyField({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="secret-reveal">
      <span className="flex-1">{value}</span>
      <IconButton
        label={label ?? 'Copy'}
        icon={copied ? <Icon.Check /> : <Icon.Copy />}
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
          });
        }}
      />
    </div>
  );
}
