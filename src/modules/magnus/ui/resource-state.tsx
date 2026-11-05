import type { ReactNode } from 'react';
import { Button, EmptyState, Skeleton } from '@ui';
import { AlertCircle } from 'lucide-react';
import { errorMessage } from '../api/errors';

/** Loading lines for a panel. The walkthrough waits for these to go. */
export function LoadingRows({ rows = 4 }: { rows?: number }) {
  return <div className="grid gap-2" aria-busy="true">{Array.from({ length: rows }, (_, index) => <Skeleton key={index} className="h-6" />)}</div>;
}

/** The failure of a read, with Retry. In a panel that has no data to show instead. */
export function ResourceError({ error, title, onRetry, action }: { error: unknown; title: string; onRetry?: () => void; action?: ReactNode }) {
  return (
    <EmptyState
      compact
      tone="warning"
      icon={<AlertCircle className="size-4" />}
      title={title}
      message={errorMessage(error)}
      action={action ?? (onRetry ? <Button size="sm" onClick={onRetry}>Retry</Button> : undefined)}
    />
  );
}
