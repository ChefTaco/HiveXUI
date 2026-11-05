import { Server } from 'lucide-react';
import { nodeListResponseSchema } from '@contracts/magnus/browser';
import { StatusDot } from '@ui';
import { cn } from '@lib/cn';
import { magnus } from '../../../api/client';
import { useMagnusResource } from '../../../api/use-resource';
import { ResourceError } from '../../../ui/resource-state';
import { toggleAllOnline } from './quick-actions';

/** The old console's checklist of target nodes. Nodes that are not ONLINE can be seen, not chosen. */
export function NodeMultiSelect({ value, onChange, label, disabled = false }: { value: readonly string[]; onChange: (value: string[]) => void; label: string; disabled?: boolean }) {
  const nodes = useMagnusResource((signal) => magnus.get('/nodes', nodeListResponseSchema, { query: { pageSize: 100 }, signal }));
  const list = nodes.data?.data ?? [];
  const online = list.filter((node) => node.status === 'ONLINE').map((node) => node.id);
  const allSelected = online.length > 0 && online.every((id) => value.includes(id));
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((item) => item !== id) : [...value, id]);
  const rowClass = 'glow-hover flex cursor-pointer items-center gap-2 rounded-chip px-2 py-1.5 text-sm hover:bg-surface-hover';
  return (
    <fieldset className="m-0 grid min-w-0 gap-1 border-0 p-0">
      <legend className="field-label p-0">{label}</legend>
      <div className="grid max-h-48 gap-1 overflow-y-auto rounded-control border border-border bg-surface-sunken p-2">
        {nodes.loading ? (
          <p className="m-0 px-2 py-1 text-sm text-text-muted">Fetching nodes…</p>
        ) : nodes.error && !nodes.data ? (
          <ResourceError error={nodes.error} title="Nodes could not be loaded" onRetry={() => void nodes.refresh()} />
        ) : list.length === 0 ? (
          <p className="m-0 px-2 py-1 text-sm text-text-muted">No nodes found</p>
        ) : (
          <>
            {online.length > 0 ? (
              <label className={cn(rowClass, 'border-b border-border pb-2 font-semibold')}>
                <input type="checkbox" checked={allSelected} disabled={disabled} onChange={() => onChange(toggleAllOnline(value, online))} />
                <Server aria-hidden="true" className="size-4 text-accent" />
                All nodes
                <span className="num ml-auto text-xs font-normal text-text-muted">{online.length} online</span>
              </label>
            ) : null}
            {list.map((node) => (
              <label key={node.id} className={rowClass}>
                <input type="checkbox" checked={value.includes(node.id)} disabled={disabled || node.status !== 'ONLINE'} onChange={() => toggle(node.id)} />
                <StatusDot status={node.status} />
                <span className={node.status === 'ONLINE' ? '' : 'text-text-muted'}>{node.name}</span>
                <span className="ml-auto truncate text-xs text-text-muted">{node.hostname}</span>
              </label>
            ))}
          </>
        )}
      </div>
    </fieldset>
  );
}
