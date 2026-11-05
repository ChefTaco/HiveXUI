import { useEffect, useMemo, useRef, useState } from 'react';
import { Network, Radar, X } from 'lucide-react';
import { commandsListResponseSchema } from '@contracts/magnus/browser';
import { Badge, Button, EmptyState, IconButton, PageHeader, Skeleton, StatusDot, statusTone, TableFrame, Toggle } from '@ui';
import { cn } from '@lib/cn';
import { useToast } from '../../../../../components/toast';
import { magnus, segment } from '../../../api/client';
import { errorMessage } from '../../../api/errors';
import { useMagnusResource } from '../../../api/use-resource';
import { FxPanel, latencyTone, PageItem, TONE_TEXT, useReducedMotion } from '../../../effects';
import Link from '../../../navigation';
import { useMagnusSession, WRITE_ROLES } from '../../../session';
import { FleetMapCanvas } from './canvas';
import { fleetOnly, topologyResponseSchema, type TopologyMap, type TopologyNode } from './schemas';

const TOPOLOGY_POLL_MS = 30_000;
const COMMANDS_POLL_MS = 5000;
const IN_FLIGHT_PAGE = 50;

export default function FleetMapPage() {
  const toast = useToast();
  const { can } = useMagnusSession();
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [view, setView] = useState<'canvas' | 'grid'>('canvas');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const topology = useMagnusResource(async (signal) => fleetOnly((await magnus.get('/topology', topologyResponseSchema, { signal })).data), [], { pollMs: autoRefresh ? TOPOLOGY_POLL_MS : undefined });
  // Commands running now, for the packets along the map's edges.
  const running = useMagnusResource((signal) => magnus.get('/commands', commandsListResponseSchema, { query: { status: 'RUNNING', pageSize: IN_FLIGHT_PAGE }, signal }), [], { pollMs: COMMANDS_POLL_MS });
  const inFlightKey = [...new Set((running.data?.data ?? []).filter((command) => command.status === 'RUNNING').map((command) => command.nodeId))].sort().join('\n');
  // A poll with the same answer must not restart the frame loop.
  const inFlight = useMemo(() => (inFlightKey ? inFlightKey.split('\n') : []), [inFlightKey]);

  const map = topology.data;
  const selected = map?.nodes.find((node) => node.id === selectedId) ?? null;
  const reduced = useReducedMotion();
  const detail = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (selectedId) detail.current?.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
  }, [selectedId, reduced]);
  const select = (node: TopologyNode | null) => setSelectedId((current) => (node === null || current === node.id ? null : node.id));

  async function scan() {
    setScanning(true);
    try {
      topology.setData(fleetOnly((await magnus.post('/topology/scan', topologyResponseSchema, { body: {} })).data));
    } catch (error) {
      toast.error('The scan failed', errorMessage(error));
    } finally {
      setScanning(false);
    }
  }

  if (!map) {
    if (topology.loading) {
      return (
        <div className="page-stack" aria-busy="true">
          <Skeleton className="h-10 w-72" />
          <Skeleton className="h-[440px] w-full sm:h-[600px]" />
          <span className="sr-only">Loading topology…</span>
        </div>
      );
    }
    return <EmptyState framed tone="danger" icon={<Network className="size-5" />} title={<span className="fx-glitch inline-block">Topology unavailable</span>} message={errorMessage(topology.error)} action={<Button size="sm" onClick={() => void topology.refresh()}>Retry</Button>} />;
  }

  const reachable = map.nodes.filter((node) => node.reachable).length;
  return (
    <div className="page-stack">
      <PageItem>
        <PageHeader
          title="Fleet map"
          eyebrow="Topology"
          description={
            <>
              Real-time network topology: <span className="num text-accent">{reachable}/{map.nodes.length}</span> nodes reachable · Last scan: <span className="num">{new Date(map.scannedAt).toLocaleTimeString()}</span>
            </>
          }
          actions={
            <>
              <div role="group" aria-label="View" className="segmented-tabs">
                {(['canvas', 'grid'] as const).map((option) => (
                  <button key={option} type="button" aria-pressed={view === option} onClick={() => setView(option)} className={cn('tab-button', view === option && 'tab-button--active glow-accent')}>{option === 'canvas' ? 'Canvas' : 'Grid'}</button>
                ))}
              </div>
              <Toggle checked={autoRefresh} onChange={setAutoRefresh} label="Auto-refresh" />
              {can(WRITE_ROLES) ? <Button size="sm" loading={scanning} icon={<Radar className="size-4" />} onClick={() => void scan()}>{scanning ? 'Scanning…' : 'Scan now'}</Button> : null}
            </>
          }
        />
      </PageItem>
      {topology.error ? <p role="alert" className="m-0 text-sm text-warning">Showing the last good map: {errorMessage(topology.error)}</p> : null}
      {view === 'canvas' ? (
        <PageItem>
          <FleetMapCanvas topology={map} inFlight={inFlight} selectedNodeId={selectedId} onSelectNode={select} scanning={scanning} />
        </PageItem>
      ) : (
        <GridView map={map} selectedId={selectedId} onSelect={select} />
      )}
      {selected ? <div ref={detail}><NodeDetailPanel node={selected} onClose={() => setSelectedId(null)} /></div> : null}
    </div>
  );
}

function GridView({ map, selectedId, onSelect }: { map: TopologyMap; selectedId: string | null; onSelect: (node: TopologyNode) => void }) {
  const names = useMemo(() => new Map(map.nodes.map((node) => [node.id, node.name])), [map.nodes]);
  if (map.nodes.length === 0) {
    return <PageItem><FxPanel interactive={false}><EmptyState icon={<Network className="size-5" />} title="No nodes to map yet" message={<>Registered nodes appear here. <Link href="/nodes">Go to nodes</Link></>} /></FxPanel></PageItem>;
  }
  return (
    <>
      <PageItem>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {map.subnets.map((subnet) => (
            <FxPanel key={subnet.cidr} fxTone={subnet.isGateway ? 'info' : 'accent'} padding="sm">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="num m-0 text-sm font-bold">{subnet.cidr}</h3>
                {subnet.isGateway ? <Badge tone="info">Gateway</Badge> : null}
                <span className="num text-xs text-text-muted">{subnet.nodeCount} {subnet.nodeCount === 1 ? 'node' : 'nodes'}</span>
              </div>
              <div className="grid gap-1.5">
                {map.nodes.filter((node) => subnet.nodes.includes(node.id)).map((node) => (
                  <button
                    key={node.id}
                    type="button"
                    aria-pressed={selectedId === node.id}
                    onClick={() => onSelect(node)}
                    className={cn('flex w-full cursor-pointer items-center gap-3 rounded-chip border p-2 text-left transition-colors duration-[var(--duration-base)]', selectedId === node.id ? 'border-accent bg-accent-soft glow-accent' : 'border-transparent hover:border-border hover:bg-surface-hover')}
                  >
                    <StatusDot status={node.status} pulse={node.reachable && node.status === 'ONLINE'} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{node.name}</span>
                      <span className="num block truncate text-xs text-text-muted">{node.ip}:{node.port}</span>
                    </span>
                    {node.latencyMs !== null ? <span className={cn('num text-xs', TONE_TEXT[latencyTone(node.latencyMs)])}>{node.latencyMs}ms</span> : null}
                  </button>
                ))}
              </div>
            </FxPanel>
          ))}
        </div>
      </PageItem>
      {map.edges.length > 0 ? (
        <PageItem>
          <FxPanel title={<span className="flex items-center gap-2"><Network aria-hidden="true" className="size-4" />Network edges</span>} interactive={false}>
            <TableFrame label="Network edges" className="max-h-[50vh]">
              <table>
                <thead><tr><th>From</th><th>To</th><th>Type</th><th className="text-right">Latency</th></tr></thead>
                <tbody>
                  {map.edges.map((edge) => (
                    <tr key={`${edge.from}-${edge.to}`} className="fx-rail">
                      <td>{names.get(edge.from) ?? edge.from}</td>
                      <td>{names.get(edge.to) ?? edge.to}</td>
                      <td><Badge tone={edge.type === 'same-subnet' ? 'accent' : 'info'}>{edge.type}</Badge></td>
                      <td className={cn('num text-right', edge.latencyMs !== null ? TONE_TEXT[latencyTone(edge.latencyMs)] : 'text-text-muted')}>{edge.latencyMs !== null ? `${edge.latencyMs}ms` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableFrame>
          </FxPanel>
        </PageItem>
      ) : null}
    </>
  );
}

function NodeDetailPanel({ node, onClose }: { node: TopologyNode; onClose: () => void }) {
  const fields: ReadonlyArray<[string, string, string]> = [['Hostname', node.hostname, ''], ['IP', node.ip, 'num'], ['Port', String(node.port), 'num'], ['Subnet', node.subnet, 'num']];
  return (
    <PageItem>
      <FxPanel
        fxTone={node.status === 'ONLINE' ? 'accent' : node.status === 'OFFLINE' ? 'danger' : 'warning'}
        title={<span className="flex items-center gap-2"><StatusDot status={node.status} />{node.name}</span>}
        actions={<IconButton label="Close node details" icon={<X className="size-4" />} onClick={onClose} />}
      >
        <dl className="m-0 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          {fields.map(([label, value, className]) => (
            <div key={label} className="min-w-0">
              <dt className="text-xs text-text-muted">{label}</dt>
              <dd className={cn('m-0 mt-0.5 truncate', className)} title={value}>{value}</dd>
            </div>
          ))}
          <div><dt className="text-xs text-text-muted">Status</dt><dd className="m-0 mt-0.5"><Badge tone={statusTone(node.status)}>{node.status}</Badge></dd></div>
          <div><dt className="text-xs text-text-muted">Reachable</dt><dd className={cn('m-0 mt-0.5 font-bold', node.reachable ? 'text-success' : 'text-danger')}>{node.reachable ? 'Yes' : 'No'}</dd></div>
          {node.latencyMs !== null ? <div><dt className="text-xs text-text-muted">Latency</dt><dd className={cn('num m-0 mt-0.5', TONE_TEXT[latencyTone(node.latencyMs)])}>{node.latencyMs}ms</dd></div> : null}
          <div className="flex items-end"><Link href={`/nodes/${segment(node.id)}`} className="text-sm">Open node →</Link></div>
        </dl>
      </FxPanel>
    </PageItem>
  );
}
