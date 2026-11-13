import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PropsWithChildren,
  type ReactNode,
} from 'react';
import { AlertCircle, ChevronDown, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { cn } from '../lib/cn';
import { Icon } from './icons';

/* ===== Button ===== */
/**
 * The classes of a `Button`, for an element that must stay a link, such as a router link that
 * looks like a button. Use `Button` for anything that is a button.
 */
export function buttonClass({
  variant = 'default',
  size,
  className,
}: { variant?: 'default' | 'primary' | 'ghost' | 'danger' | 'warning' | undefined; size?: 'sm' | undefined; className?: string | undefined } = {}): string {
  return cn('btn', variant !== 'default' && `btn--${variant}`, size === 'sm' && 'btn--sm', className);
}

export function Button({
  variant = 'default',
  size,
  icon,
  loading,
  children,
  ...rest
}: {
  variant?: 'default' | 'primary' | 'ghost' | 'danger' | 'warning' | undefined;
  size?: 'sm' | undefined;
  icon?: ReactNode;
  loading?: boolean | undefined;
  ref?: React.Ref<HTMLButtonElement>;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { disabled, className, ...buttonProps } = rest;
  return (
    <button className={buttonClass({ variant, size, className })} disabled={loading || disabled} {...buttonProps}>
      {loading ? <span className="spinner" /> : icon}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  icon,
  variant = 'ghost',
  size,
  className,
  ...rest
}: {
  label: string;
  icon: ReactNode;
  variant?: 'default' | 'ghost' | 'danger' | undefined;
  size?: 'sm' | undefined;
  ref?: React.Ref<HTMLButtonElement>;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={cn('btn', 'btn--icon', variant !== 'default' && `btn--${variant}`, size === 'sm' && 'btn--sm', className)} title={label} aria-label={label} {...rest}>
      {icon}
    </button>
  );
}

/* ===== Tones ===== */
/** What a color means. Every badge, dot, meter, stat and empty state takes one of these. */
export type Tone = 'neutral' | 'accent' | 'signal' | 'success' | 'warning' | 'danger' | 'info';

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
/**
 * A figure in its tone over a footer that fades from the same tone. Pass a Sparkline as `footer` when
 * there is a trend to show, or `false` for a tile that carries a meter instead. See docs/THEME.md.
 */
export function StatCard({
  label,
  value,
  sub,
  tone = 'neutral',
  icon,
  delta,
  footer,
  className,
  children,
}: PropsWithChildren<{
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
  icon?: ReactNode;
  /** Change since the last sample, shown beside the figure. */
  delta?: ReactNode;
  footer?: ReactNode;
  className?: string;
}>) {
  return (
    <div className={cn('stat-card', tone !== 'neutral' && `stat-card--${tone}`, className)}>
      <div className="stat-head">
        <span className="stat-label">{label}</span>
        {icon ? <span className="stat-icon" aria-hidden="true">{icon}</span> : null}
      </div>
      <div className="stat-figure">
        <span className="stat-value">{value}</span>
        {delta ? <span className="stat-delta">{delta}</span> : null}
      </div>
      {sub ? <span className="stat-sub">{sub}</span> : null}
      {children ? <div className="stat-body">{children}</div> : null}
      {footer === false ? null : <div className="stat-footer" aria-hidden="true">{footer}</div>}
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
    <Tag {...rest} className={cn('panel', padding !== 'md' && `panel--${padding}`, tone && `panel--${tone}`, glow && `glow-hover--${glow}`, className)}>
      {glow ? <span className="panel-glow" aria-hidden="true" /> : null}
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
        <pre className="code-block" tabIndex={0}>{text}</pre>
      </details>
    );
  // Focusable so a long value can be scrolled from the keyboard.
  return <pre className="code-block" tabIndex={0}>{text}</pre>;
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
  tone = 'danger',
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
  /** `primary` for a confirmation that destroys nothing, such as reopening. */
  tone?: 'danger' | 'warning' | 'primary';
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
          <Button variant={tone} onClick={onConfirm} loading={loading} icon={tone === 'danger' ? <Icon.Trash className="btn-ico" /> : undefined}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** What `useConfirm` asks. `tone` defaults to `danger`; use `primary` for a step that destroys nothing. */
export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel?: string;
  tone?: 'danger' | 'warning' | 'primary';
}

/**
 * Ask for confirmation in a `ConfirmDialog` instead of the browser's `confirm()`. Render the returned
 * dialog once in the component; `await ask({...})` resolves true on confirm and false on cancel.
 */
export function useConfirm(): [(request: ConfirmRequest) => Promise<boolean>, ReactNode] {
  const [pending, setPending] = useState<(ConfirmRequest & { resolve: (confirmed: boolean) => void }) | null>(null);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const ask = useCallback((request: ConfirmRequest) => new Promise<boolean>((resolve) => {
    pendingRef.current?.resolve(false);
    setPending({ ...request, resolve });
  }), []);
  useEffect(() => () => pendingRef.current?.resolve(false), []);
  const settle = (confirmed: boolean) => {
    pendingRef.current?.resolve(confirmed);
    setPending(null);
  };
  const dialog = (
    <ConfirmDialog
      open={pending !== null}
      title={pending?.title ?? ''}
      message={pending?.message ?? ''}
      confirmLabel={pending?.confirmLabel ?? 'Confirm'}
      tone={pending?.tone ?? 'danger'}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  );
  return [ask, dialog];
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
          // Without a secure context there is no clipboard, and a browser may refuse the write:
          // the value stays on screen to select, and neither case is an unhandled error.
          void Promise.resolve()
            .then(() => navigator.clipboard.writeText(value))
            .then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1600);
            })
            .catch(() => undefined);
        }}
      />
    </div>
  );
}

/* ===== Loading and error states ===== */
/** Loading lines for a panel or table. The walkthrough waits for these to go. */
export function LoadingRows({ rows = 4 }: { rows?: number }) {
  return <div className="grid gap-2" aria-busy="true">{Array.from({ length: rows }, (_, index) => <Skeleton key={index} className="h-6" />)}</div>;
}

const failureMessage = (error: unknown, fallback = 'The request failed'): string => (error instanceof Error && error.message ? error.message : fallback);

/** The failure of a read, with Retry. In a panel that has no data to show instead. */
export function ResourceError({ error, title, onRetry, action }: { error: unknown; title: string; onRetry?: () => void; action?: ReactNode }) {
  return (
    <EmptyState
      compact
      tone="warning"
      icon={<AlertCircle className="size-4" />}
      title={title}
      message={failureMessage(error)}
      action={action ?? (onRetry ? <Button size="sm" onClick={onRetry}>Retry</Button> : undefined)}
    />
  );
}

/* ===== Data table ===== */
export interface DataTableColumn<Row> {
  /** Stable key for the column. */
  key: string;
  header: ReactNode;
  cell: (row: Row, index: number) => ReactNode;
  /** Classes for the body cell, such as `cell-mono` or `cell-actions`. */
  className?: string;
  headerClassName?: string;
}

const INTERACTIVE = 'a, button, input, select, textarea, label, summary, [role="button"], [role="menuitem"]';

/**
 * A labelled table in a TableFrame: typed columns, loading lines while the first page loads,
 * an empty state when there is nothing to show, and an optional row action that works from the
 * keyboard too. Interactive content inside a row keeps its own behaviour.
 */
export function DataTable<Row>({
  label,
  columns,
  rows,
  rowKey,
  loading = false,
  loadingRows = 4,
  error,
  errorTitle = 'Could not load this list',
  onRetry,
  empty,
  onRowClick,
  rowLabel,
  rowClassName,
  className,
}: {
  label: string;
  columns: ReadonlyArray<DataTableColumn<Row>>;
  rows: ReadonlyArray<Row> | null | undefined;
  rowKey: (row: Row, index: number) => string;
  loading?: boolean;
  loadingRows?: number;
  /** A failed read. Shown in place of the rows, with Retry when `onRetry` is given. */
  error?: unknown;
  errorTitle?: string;
  onRetry?: () => void;
  /** What to show when there are no rows: an EmptyState, or text for one. */
  empty?: ReactNode;
  onRowClick?: (row: Row) => void;
  /** The accessible name of a clickable row. */
  rowLabel?: (row: Row) => string;
  rowClassName?: (row: Row) => string | undefined;
  className?: string;
}) {
  const list = rows ?? [];
  const span = Math.max(columns.length, 1);
  let body: ReactNode;
  if (error != null && list.length === 0) {
    body = <tr><td colSpan={span}><ResourceError error={error} title={errorTitle} {...(onRetry ? { onRetry } : {})} /></td></tr>;
  } else if (loading && list.length === 0) {
    body = <tr><td colSpan={span}><LoadingRows rows={loadingRows} /></td></tr>;
  } else if (list.length === 0) {
    body = <tr><td colSpan={span}>{typeof empty === 'string' || empty == null ? <EmptyState compact title={empty ?? 'Nothing to show yet'} /> : empty}</td></tr>;
  } else {
    body = list.map((row, index) => {
      const activate = onRowClick ? () => onRowClick(row) : undefined;
      return (
        <tr
          key={rowKey(row, index)}
          className={cn(activate && 'row-clickable', rowClassName?.(row))}
          tabIndex={activate ? 0 : undefined}
          aria-label={activate ? rowLabel?.(row) : undefined}
          onClick={activate ? (event: ReactMouseEvent<HTMLTableRowElement>) => {
            const target = event.target instanceof Element ? event.target.closest(INTERACTIVE) : null;
            if (target && target !== event.currentTarget && event.currentTarget.contains(target)) return;
            activate();
          } : undefined}
          onKeyDown={activate ? (event: ReactKeyboardEvent<HTMLTableRowElement>) => {
            if (event.target !== event.currentTarget) return;
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); }
          } : undefined}
        >
          {columns.map((column) => <td key={column.key} className={column.className}>{column.cell(row, index)}</td>)}
        </tr>
      );
    });
  }
  return (
    <TableFrame label={label} {...(className ? { className } : {})}>
      <table aria-busy={loading || undefined}>
        <thead>
          <tr>{columns.map((column) => <th key={column.key} scope="col" className={column.headerClassName}>{column.header}</th>)}</tr>
        </thead>
        <tbody>{body}</tbody>
      </table>
    </TableFrame>
  );
}

/* ===== Tabs ===== */
export interface TabItem<Id extends string = string> {
  id: Id;
  label: ReactNode;
  count?: number;
  disabled?: boolean;
}

/** The id of the tab and its panel, so a `TabPanel` can name the tab that labels it. */
export const tabIds = (idPrefix: string, id: string) => ({ tab: `${idPrefix}-tab-${id}`, panel: `${idPrefix}-panel-${id}` });

/**
 * A tablist with a roving tabindex: Tab enters at the selected tab, the arrow keys, Home and End
 * move between tabs and select them. Pair with `TabPanel` using the same `idPrefix`.
 */
export function Tabs<Id extends string>({
  label,
  tabs,
  value,
  onChange,
  idPrefix,
  className,
}: {
  label: string;
  tabs: ReadonlyArray<TabItem<Id>>;
  value: Id;
  onChange: (id: Id) => void;
  idPrefix?: string;
  className?: string;
}) {
  const fallbackPrefix = useId().replace(/:/g, '');
  const prefix = idPrefix ?? fallbackPrefix;
  const listRef = useRef<HTMLDivElement>(null);
  const enabled = tabs.filter((tab) => !tab.disabled);
  function move(event: ReactKeyboardEvent<HTMLDivElement>) {
    const index = enabled.findIndex((tab) => tab.id === value);
    let next: TabItem<Id> | undefined;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = enabled[(index + 1) % enabled.length];
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = enabled[(index - 1 + enabled.length) % enabled.length];
    else if (event.key === 'Home') next = enabled[0];
    else if (event.key === 'End') next = enabled.at(-1);
    if (!next) return;
    event.preventDefault();
    onChange(next.id);
    listRef.current?.querySelector<HTMLElement>(`#${CSS.escape(tabIds(prefix, next.id).tab)}`)?.focus();
  }
  return (
    <div ref={listRef} className={cn('tabs', className)} role="tablist" aria-label={label} onKeyDown={move}>
      {tabs.map((tab) => {
        const selected = tab.id === value;
        const ids = tabIds(prefix, tab.id);
        return (
          <button
            key={tab.id}
            id={ids.tab}
            type="button"
            role="tab"
            className={cn('tab', selected && 'tab--active')}
            aria-selected={selected}
            aria-controls={ids.panel}
            tabIndex={selected ? 0 : -1}
            disabled={tab.disabled}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
            {tab.count === undefined ? null : <span className="tab-count">{tab.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ idPrefix, id, className, children }: PropsWithChildren<{ idPrefix: string; id: string; className?: string }>) {
  const ids = tabIds(idPrefix, id);
  return (
    <div id={ids.panel} role="tabpanel" aria-labelledby={ids.tab} tabIndex={0} className={className}>
      {children}
    </div>
  );
}

/* ===== Pagination ===== */
/** Keeps the cursors of the pages already seen, so Previous can go back through a cursor-only API. */
export function useCursorPagination<Cursor = string>() {
  const [stack, setStack] = useState<Array<Cursor | undefined>>([undefined]);
  const cursor = stack.at(-1);
  const next = useCallback((nextCursor: Cursor) => setStack((current) => [...current, nextCursor]), []);
  const previous = useCallback(() => setStack((current) => (current.length > 1 ? current.slice(0, -1) : current)), []);
  const reset = useCallback(() => setStack([undefined]), []);
  return { cursor, page: stack.length, hasPrevious: stack.length > 1, next, previous, reset };
}

/** Previous and Next for a cursor-paged list, with an optional summary such as "Page 2". */
export function Pagination({
  label = 'Pagination',
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
  loading = false,
  summary,
  className,
}: {
  label?: string;
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  loading?: boolean;
  summary?: ReactNode;
  className?: string;
}) {
  return (
    <nav className={cn('pagination', className)} aria-label={label}>
      {summary ? <span className="pagination__summary" aria-live="polite">{summary}</span> : null}
      <div className="pagination__controls">
        <Button size="sm" variant="ghost" icon={<ChevronLeft className="btn-ico" aria-hidden="true" />} disabled={!hasPrevious || loading} onClick={onPrevious}>
          Previous
        </Button>
        <Button size="sm" variant="ghost" disabled={!hasNext || loading} onClick={onNext}>
          Next
          <ChevronRight className="btn-ico" aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}

/* ===== Filter bar ===== */
/** A search box and slots for filters, above a list. Put `Select`s or `Toggle`s in `children`. */
export function FilterBar({
  label = 'Filters',
  search,
  actions,
  className,
  children,
}: PropsWithChildren<{
  label?: string;
  search?: { value: string; onChange: (value: string) => void; label?: string; placeholder?: string };
  /** Shown at the end of the bar, such as Refresh or a count. */
  actions?: ReactNode;
  className?: string;
}>) {
  return (
    <div className={cn('filter-bar', className)} role="search" aria-label={label}>
      {search ? (
        <div className="filter-bar__search">
          <Search className="filter-bar__icon size-4 text-text-muted" aria-hidden="true" />
          <TextInput type="search" value={search.value} onChange={search.onChange} aria-label={search.label ?? 'Search'} placeholder={search.placeholder ?? 'Search'} />
          {search.value ? <IconButton label="Clear search" size="sm" icon={<Icon.Close />} className="filter-bar__clear" onClick={() => search.onChange('')} /> : null}
        </div>
      ) : null}
      {children ? <div className="filter-bar__filters">{children}</div> : null}
      {actions ? <div className="filter-bar__actions">{actions}</div> : null}
    </div>
  );
}

/* ===== Menu ===== */
export interface MenuItem {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  tone?: 'danger';
}

/**
 * A button that opens a list of actions. Enter, Space or the arrow keys open it; the arrow keys,
 * Home and End move; Escape closes it and returns focus to the button; Tab closes it.
 */
export function Menu({
  label,
  items,
  children,
  icon,
  variant = 'ghost',
  size,
  align = 'end',
  className,
}: PropsWithChildren<{
  /** The accessible name of the button; also its text when there are no children. */
  label: string;
  items: ReadonlyArray<MenuItem>;
  icon?: ReactNode;
  variant?: 'default' | 'primary' | 'ghost';
  size?: 'sm';
  align?: 'start' | 'end';
  className?: string;
}>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const focusOnOpen = useRef<'first' | 'last'>('first');
  const menuId = useId();
  const menuItems = () => [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];

  useEffect(() => {
    if (!open) return;
    const elements = menuItems();
    (focusOnOpen.current === 'last' ? elements.at(-1) : elements[0])?.focus();
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }
  function onTriggerKey(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      focusOnOpen.current = event.key === 'ArrowUp' ? 'last' : 'first';
      setOpen(true);
    }
  }
  function onMenuKey(event: ReactKeyboardEvent<HTMLDivElement>) {
    const elements = menuItems();
    const index = elements.indexOf(document.activeElement as HTMLButtonElement);
    let target: HTMLButtonElement | undefined;
    if (event.key === 'ArrowDown') target = elements[(index + 1) % elements.length];
    else if (event.key === 'ArrowUp') target = elements[(index - 1 + elements.length) % elements.length];
    else if (event.key === 'Home') target = elements[0];
    else if (event.key === 'End') target = elements.at(-1);
    else if (event.key === 'Escape') { event.preventDefault(); close(true); return; }
    else if (event.key === 'Tab') { close(false); return; }
    if (!target) return;
    event.preventDefault();
    target.focus();
  }
  return (
    <div ref={rootRef} className={cn('ui-menu', className)}>
      <Button
        ref={triggerRef}
        variant={variant}
        size={size}
        icon={icon}
        aria-label={children ? label : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => { focusOnOpen.current = 'first'; setOpen((current) => !current); }}
        onKeyDown={onTriggerKey}
      >
        {children ?? label}
        <ChevronDown className="btn-ico" aria-hidden="true" />
      </Button>
      {open ? (
        <div ref={menuRef} id={menuId} className={cn('ui-menu__list', align === 'start' && 'ui-menu__list--start')} role="menu" aria-label={label} onKeyDown={onMenuKey}>
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={cn('ui-menu__item', item.tone === 'danger' && 'ui-menu__item--danger')}
              disabled={item.disabled}
              onClick={() => { close(true); item.onSelect(); }}
            >
              {item.icon ? <span className="ui-menu__icon" aria-hidden="true">{item.icon}</span> : null}
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
