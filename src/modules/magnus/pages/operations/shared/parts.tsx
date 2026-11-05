import type { ReactNode } from 'react';
import { cn } from '@lib/cn';

export function FormError({ message, className }: { message: string | null | undefined; className?: string }) {
  return message ? <p role="alert" className={cn('m-0 rounded-control border border-danger bg-danger-soft px-3 py-2 text-sm text-danger glow-danger', className)}>{message}</p> : null;
}

/** A labelled value in a grid of facts, for a drawer or a panel. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-control border border-border bg-surface-sunken p-3">
      <p className="m-0 mb-1 text-xs font-medium text-text-muted">{label}</p>
      <div className="min-w-0 break-words text-sm">{children}</div>
    </div>
  );
}

/** Save text the browser already holds. It makes no request. */
export function downloadText(text: string, fileName: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
