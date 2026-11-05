import { nodeListResponseSchema } from '@contracts/magnus/browser';
import { magnus } from '../api/client';
import { useMagnusResource } from '../api/use-resource';

/** A select of the fleet's nodes, for forms. Nodes that are not ONLINE can be seen, not chosen. */
export function NodeSelector({ value, onChange, label = 'Node', placeholder = 'Select a node…', disabled = false }: { value: string; onChange: (value: string) => void; label?: string; placeholder?: string; disabled?: boolean }) {
  const { data, loading } = useMagnusResource((signal) => magnus.get('/nodes', nodeListResponseSchema, { query: { pageSize: 100 }, signal }));
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled || loading}>
        <option value="">{loading ? 'Loading nodes…' : placeholder}</option>
        {(data?.data ?? []).map((node) => (
          <option key={node.id} value={node.id} disabled={node.status !== 'ONLINE'}>
            {node.name} — {node.hostname} ({node.status})
          </option>
        ))}
      </select>
    </label>
  );
}
