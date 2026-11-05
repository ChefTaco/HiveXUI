import type { ComponentProps, ReactNode } from 'react';
import { Meter, Panel, type Tone } from '@ui';
import { cn } from '@lib/cn';
import { DEFAULT_THRESHOLDS, thresholdTone, type Thresholds } from './tones';
import { useReducedMotion } from './motion';

type FxTone = 'accent' | 'success' | 'warning' | 'danger' | 'info';
const PANEL_TONE: Record<FxTone, string> = {
  accent: '[--panel-corner-color:var(--accent)] [--fx-glow:var(--glow-accent)]',
  success: '[--panel-corner-color:var(--success)] [--fx-glow:var(--glow-success)]',
  warning: '[--panel-corner-color:var(--warning)] [--fx-glow:var(--glow-warning)]',
  danger: '[--panel-corner-color:var(--danger)] [--fx-glow:var(--glow-danger)]',
  info: '[--panel-corner-color:var(--info)] [--fx-glow:var(--glow-info)]',
};

/**
 * Replaces GlowPanel: the shared Panel with corner brackets, a hover glow and, for `hero`, the grid.
 * The brackets take both of the panel's pseudo-elements, which is why the glow is a child here rather
 * than the shared glow-hover, whose ::after they would displace.
 */
export function FxPanel({ fxTone = 'accent', hero = false, interactive = true, className, children, ...props }: Omit<ComponentProps<typeof Panel>, 'glow'> & { fxTone?: FxTone; hero?: boolean; interactive?: boolean }) {
  return (
    <Panel {...props} className={cn('panel-corners', PANEL_TONE[fxTone], hero && 'grid-bg', className)}>
      {interactive ? <span className="fx-panel-glow" aria-hidden="true" /> : null}
      {children}
    </Panel>
  );
}

/**
 * The arrival of page content: fade and lift. Wrap each block of a page, as PageItem did. The fill stops
 * at the end, because a transform left in place would trap any Drawer or dialog inside this box.
 */
export const PageItem = ({ children, className }: { children: ReactNode; className?: string }) => <div className={cn('animate-page-in min-w-0 [animation-fill-mode:backwards]', className)}>{children}</div>;

/** Replaces MeterBar: follows thresholds unless given a tone, and lights up past the warning level. */
export function FxMeter({ value, max = 100, tone, thresholds = DEFAULT_THRESHOLDS, label, valueLabel, glow, className }: {
  value: number | null | undefined;
  max?: number;
  tone?: Tone | undefined;
  thresholds?: Thresholds;
  label: string;
  valueLabel?: string;
  glow?: boolean;
  className?: string;
}) {
  const known = typeof value === 'number' && Number.isFinite(value);
  const percent = known ? (value / (max || 1)) * 100 : 0;
  const resolved = tone ?? (known ? thresholdTone(percent, thresholds) : 'neutral');
  return <Meter value={value} max={max} tone={resolved} label={label} {...(valueLabel !== undefined ? { valueLabel } : {})} className={cn((glow || (!tone && known && percent >= thresholds.warn)) && 'fx-meter-hot', className)} />;
}

/** A status light with a real halo, for use outside the shared StatusDot's fixed size. */
export function HaloDot({ tone, active = true, className }: { tone: 'success' | 'warning' | 'danger' | 'info' | 'accent'; active?: boolean; className?: string }) {
  const color = { success: 'text-success', warning: 'text-warning', danger: 'text-danger', info: 'text-info', accent: 'text-accent' }[tone];
  return (
    <span aria-hidden="true" className={cn('relative inline-flex size-2 shrink-0 rounded-full', color, className)}>
      {active ? <span className="absolute inset-0 animate-halo rounded-full bg-current" /> : null}
      <span className="relative inline-flex size-2 rounded-full bg-current" />
    </span>
  );
}

/** Replaces ScanAnimation: a progress panel for a fleet scan, with a moving scan line while it runs. */
export function ScanPanel({ title, description, scanning, nodes }: {
  title: string;
  description?: string;
  scanning: boolean;
  nodes: ReadonlyArray<{ nodeId: string; nodeName: string; status: 'scanning' | 'done' | 'error'; error?: string }>;
}) {
  const reduced = useReducedMotion();
  return (
    <FxPanel title={scanning ? title : 'Scan complete'} description={description} className="relative overflow-hidden">
      {scanning && !reduced ? <span className="fx-scanline" aria-hidden="true" /> : null}
      <ul className="m-0 grid list-none gap-2 p-0" role="status">
        {nodes.length === 0 && scanning ? <li className="text-sm text-text-muted">Looking for nodes…</li> : null}
        {nodes.map((node) => (
          <li key={node.nodeId} className="animate-page-in flex items-center gap-3 text-sm">
            <HaloDot tone={node.status === 'error' ? 'danger' : node.status === 'done' ? 'success' : 'accent'} active={node.status === 'scanning'} />
            <span>{node.nodeName}</span>
            {node.status === 'error' && node.error ? <span className="truncate text-xs text-danger">{node.error}</span> : null}
          </li>
        ))}
      </ul>
    </FxPanel>
  );
}

/** The Magnus mark. It draws itself on arrival and flickers now and then. */
export function MagnusMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn('animate-flicker size-6 shrink-0 overflow-visible', className)}>
      <rect x="1" y="1" width="30" height="30" rx="4" fill="none" stroke="var(--accent)" strokeOpacity="0.35" />
      <path d="M8 23 V9 L16 18 L24 9 V23" fill="none" stroke="var(--accent)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" pathLength={100} className="fx-draw" />
    </svg>
  );
}
