import { nodeListResponseSchema } from '@contracts/magnus/browser';
import type { z } from 'zod';
import { Badge, Button, statusTone, StatusDot } from '@ui';
import { magnus } from '../../../api/client';
import { errorMessage } from '../../../api/errors';
import { useMagnusResource } from '../../../api/use-resource';
import { LoadingRows } from '../../../ui/resource-state';

export type NodeOption = z.output<typeof nodeListResponseSchema>['data'][number];
const PAGE_SIZE = 100;
const MAX_PAGES = 20;

async function listNodes(status: string | undefined, signal: AbortSignal): Promise<NodeOption[]> {
  const nodes: NodeOption[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const result = await magnus.get('/nodes', nodeListResponseSchema, { query: { page, pageSize: PAGE_SIZE, status }, signal });
    nodes.push(...result.data);
    if (!result.meta.hasMore) break;
  }
  return nodes;
}

/** Choose several nodes. The shared NodeSelector takes one, and both of these forms take many. */
export function NodeChecklist({ selected, onChange, status, empty, label = 'Target nodes' }: { selected: readonly string[]; onChange: (ids: string[]) => void; status?: string; empty: string; label?: string }) {
  const nodes = useMagnusResource((signal) => listNodes(status, signal), [status]);
  const options = (nodes.data ?? []).filter((node) => node.status !== 'DECOMMISSIONED');
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);
  return (
    <fieldset className="m-0 grid gap-2 border-0 p-0">
      <legend className="flex w-full items-center justify-between gap-2 p-0 pb-2">
        <span className="field-label">{label}</span>
        {options.length > 0 ? <Button type="button" size="sm" variant="ghost" onClick={() => onChange(options.map((node) => node.id))}>Select all</Button> : null}
      </legend>
      {!nodes.data ? (
        nodes.loading ? <LoadingRows rows={2} /> : <p role="alert" className="m-0 text-sm text-danger">{errorMessage(nodes.error, 'Nodes could not be loaded')}</p>
      ) : options.length === 0 ? (
        <p className="m-0 py-3 text-center text-sm text-text-muted">{empty}</p>
      ) : (
        <div className="grid max-h-56 gap-1 overflow-y-auto">
          {options.map((node) => (
            <label key={node.id} className="glow-hover flex cursor-pointer items-center gap-3 rounded-control border border-border px-3 py-2 text-sm hover:border-accent">
              <input type="checkbox" checked={selected.includes(node.id)} onChange={() => toggle(node.id)} />
              <StatusDot status={node.status} />
              <span className="min-w-0 flex-1 truncate">{node.name} <span className="text-xs text-text-muted">{node.hostname}</span></span>
              <Badge tone={statusTone(node.status)}>{node.status}</Badge>
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}
