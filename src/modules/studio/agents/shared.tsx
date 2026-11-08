import type { ReactNode } from 'react';
import { Badge, Panel } from '@ui';
import type { Resource } from '../../magnus/api/use-resource';
import { LoadingRows, ResourceError } from '../../magnus/ui/resource-state';

/** Where a setting applies: everywhere the agent works, or only in the open project. */
export function ScopeBadge({ scope }: { scope: 'global' | 'project' | 'private' }) {
  if (scope === 'project')
    return (
      <Badge tone="accent" className="agent-scope">
        This project only
      </Badge>
    );
  if (scope === 'private')
    return (
      <Badge tone="signal" className="agent-scope">
        Private to this agent
      </Badge>
    );
  return (
    <Badge tone="info" className="agent-scope">
      Global
    </Badge>
  );
}

/** A read's loading and failure states in a panel; children render once it answers. */
export function Loaded<T>({ resource, title, rows = 3, children }: { resource: Pick<Resource<T>, 'data' | 'loading' | 'error' | 'refresh'>; title: string; rows?: number; children: (data: T) => ReactNode }) {
  if (resource.data !== undefined) return <>{children(resource.data)}</>;
  return (
    <Panel aria-busy={resource.loading || undefined}>
      {resource.loading ? <LoadingRows rows={rows} /> : <ResourceError error={resource.error} title={title} onRetry={() => void resource.refresh()} />}
    </Panel>
  );
}

export const when = (value: string | number): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
};
