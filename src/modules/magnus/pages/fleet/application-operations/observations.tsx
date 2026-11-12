import { useState, type FormEvent } from 'react';
import type { z } from 'zod';
import { HardDrive, Network } from 'lucide-react';
import { dependencyGraphResponseSchema, storageEvidenceResponseSchema } from '@contracts/magnus/browser';
import { Badge, Button, EmptyState, Field, TableFrame, TextInput, LoadingRows, ResourceError } from '@ui';
import { cn } from '@lib/cn';
import { formatTime, relativeTime } from '@lib/format';
import { magnus, segment } from '../../../api/client';
import { errorMessage } from '../../../api/errors';
import { useMagnusResource } from '../../../api/use-resource';
import { FxMeter, FxPanel, ScanPanel } from '../../../effects';
import type { NodeRow } from '../nodes/nodes-api';
import { formatBytes } from '../shared/severity';
import { useSweep } from '../shared/sweep';
import { NodeIdInput } from './maintenance-panel';
import { probeTone } from './model';

type StorageEvidence = z.output<typeof storageEvidenceResponseSchema>['data'];

/** Loaded on request, as the old console did. */
export function DependencyPanel() {
  const [asked, setAsked] = useState(false);
  const graph = useMagnusResource((signal) => magnus.get('/dependencies', dependencyGraphResponseSchema, { signal }), [], { enabled: asked });
  const data = graph.data?.data;
  return (
    <FxPanel
      title={<span className="flex items-center gap-2"><Network className="size-4 text-accent" />Dependency observations</span>}
      interactive={false}
      actions={<Button size="sm" loading={asked && graph.refreshing} onClick={() => (asked ? void graph.refresh() : setAsked(true))}>{data ? 'Reload' : 'Load observed connections and collection status'}</Button>}
    >
      {!asked ? (
        <p className="m-0 text-sm text-text-muted">Observed connections between nodes, and whether each node could be asked.</p>
      ) : !data ? (
        graph.error ? <ResourceError error={graph.error} title="Dependencies could not be loaded" onRetry={() => void graph.refresh()} /> : <LoadingRows rows={3} />
      ) : (
        <div className="grid gap-3">
          <p className="m-0 flex flex-wrap items-center gap-2 text-sm text-text-muted">
            <Badge tone={probeTone(data.status)} dot>{data.status}</Badge>
            <span title={formatTime(data.discoveredAt)}>Discovered {relativeTime(data.discoveredAt)}</span>
            <span>{data.nodes.length} node{data.nodes.length === 1 ? '' : 's'}, {data.edges.length} connection{data.edges.length === 1 ? '' : 's'}</span>
          </p>
          {data.nodes.length === 0 ? <EmptyState compact icon={<Network className="size-4" />} title="No nodes observed" /> : (
            <TableFrame label="Collection status by node">
              <table>
                <thead><tr>{['Node', 'Address', 'Services', 'Collection', 'Observed'].map((heading) => <th key={heading}>{heading}</th>)}</tr></thead>
                <tbody>
                  {data.nodes.map((node) => (
                    <tr key={node.id} className="fx-rail">
                      <td className="font-semibold">{node.name}</td>
                      <td className="num text-text-muted">{'ip' in node ? node.ip : '—'}</td>
                      <td className="text-text-muted">{'services' in node ? node.services.map((service) => `${service.process}:${service.port}`).join(', ') || 'None' : '—'}</td>
                      <td><Badge tone={probeTone(node.collection.status)} dot>{node.collection.status}</Badge>{node.collection.reason ? <span className="ml-2 text-xs text-text-muted">{node.collection.reason}</span> : null}</td>
                      <td className="text-text-muted" title={formatTime(node.collection.observedAt)}>{relativeTime(node.collection.observedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableFrame>
          )}
          {data.edges.length > 0 ? (
            <TableFrame label="Observed connections">
              <table>
                <thead><tr>{['From', 'To', 'Service', 'Ports', 'Connections'].map((heading) => <th key={heading}>{heading}</th>)}</tr></thead>
                <tbody>
                  {data.edges.map((edge, index) => (
                    <tr key={index} className="fx-rail">
                      <td>{edge.from}</td>
                      <td>{edge.to}</td>
                      <td>{edge.service}</td>
                      <td className="num text-text-muted">{'fromPort' in edge ? `${edge.fromPort} → ${edge.toPort}` : '—'}</td>
                      <td className="num">{edge.connectionCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableFrame>
          ) : null}
        </div>
      )}
    </FxPanel>
  );
}

export function StoragePanel({ nodes }: { nodes: readonly NodeRow[] }) {
  const [nodeId, setNodeId] = useState('');
  const [mount, setMount] = useState('/');
  const [scanning, setScanning] = useState<string | null>(null);
  const [report, setReport] = useState<StorageEvidence | null>(null);
  const [error, setError] = useState('');
  async function investigate(event: FormEvent) {
    event.preventDefault();
    const target = nodeId.trim();
    setScanning(target);
    setReport(null);
    setError('');
    try {
      const { data } = await magnus.get(`/ops/storage-evidence/${segment(target)}`, storageEvidenceResponseSchema, { query: { mount } });
      setReport(data);
    } catch (caught) {
      setError(errorMessage(caught, 'The investigation failed'));
    } finally {
      setScanning(null);
    }
  }
  return (
    <FxPanel title={<span className="flex items-center gap-2"><HardDrive className="size-4 text-accent" />Storage evidence</span>} description="Local scans stop after 10 seconds. Shared volumes return their identity and storage-side accounting guidance." interactive={false}>
      <div className="grid gap-3">
        <form className="grid gap-3" onSubmit={(event) => void investigate(event)} aria-label="Investigate a mount">
          <div className="form-grid">
            <NodeIdInput value={nodeId} onChange={setNodeId} nodes={nodes} />
            <Field label="Mount"><TextInput value={mount} onChange={setMount} required maxLength={4096} /></Field>
          </div>
          <div><Button type="submit" loading={scanning !== null} disabled={!nodeId.trim() || !mount}>Investigate mount</Button></div>
        </form>
        {scanning !== null ? <ScanPanel title="Scanning the mount" scanning nodes={[{ nodeId: scanning, nodeName: `${scanning}: ${mount}`, status: 'scanning' }]} /> : null}
        {error ? <p role="alert" className="m-0 rounded-control border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p> : null}
        {report ? <StorageReport report={report} /> : null}
      </div>
    </FxPanel>
  );
}

function StorageReport({ report }: { report: StorageEvidence }) {
  const largest = Math.max(1, ...report.directories.map(({ bytes }) => bytes));
  const sweep = useSweep();
  return (
    <div className={cn(sweep, 'grid gap-3 rounded-panel border border-border bg-surface-raised p-3')}>
      <p className="m-0 flex flex-wrap items-center gap-2 text-sm">
        <Badge tone={probeTone(report.status)} dot>{report.status}</Badge>
        {report.shared ? <Badge tone="info">Shared volume</Badge> : <span className="num text-xs text-text-muted">{Math.round(report.elapsedMs)} ms</span>}
        <span className="font-mono">{report.target}</span>
        <span className="text-text-muted">{report.source} · {report.fstype} · {report.volumeId}</span>
      </p>
      <p className="m-0 text-sm text-text-muted">{report.explanation}</p>
      {report.directories.length ? (
        <ul className="m-0 grid list-none grid-cols-1 gap-1.5 p-0" aria-label="Largest directories">
          {report.directories.map((directory) => (
            <li key={directory.path} className="grid gap-x-3 sm:grid-cols-[minmax(0,1fr)_14rem] sm:items-center">
              <span className="min-w-0 break-all font-mono text-sm">{directory.path}</span>
              <FxMeter value={directory.bytes} max={largest} tone="accent" label={directory.path} valueLabel={formatBytes(directory.bytes)} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
