import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, ScrollText, Search, Square } from 'lucide-react';
import { logQueryResponseSchema } from '@contracts/magnus/browser';
import { Badge, Button, EmptyState, Field, PageHeader, Select, TextInput } from '@ui';
import { formatTime } from '@lib/format';
import { cn } from '@lib/cn';
import { magnus } from '../../../api/client';
import { errorMessage } from '../../../api/errors';
import { openStream, type StreamHandle, type StreamState } from '../../../api/stream';
import { FxPanel, HaloDot, PageItem } from '../../../effects';
import { NodeSelector } from '../../../ui/node-selector';
import { FormError } from '../shared/parts';
import { LEVEL_EDGE, LOG_LEVELS, levelTone, parseStreamLog, prependLog, type LogRow } from './log-model';

const LEVEL_OPTIONS = [{ value: '', label: 'All' }, ...LOG_LEVELS.map((level) => ({ value: level, label: level[0]!.toUpperCase() + level.slice(1) }))];
const STREAM_TEXT: Record<StreamState, string> = {
  connecting: 'Connecting to the log stream…',
  open: 'Streaming logs in real time…',
  retrying: 'Reconnecting to the log stream…',
  stopped: 'Stream stopped',
};

export default function LogsPage() {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [search, setSearch] = useState('');
  const [nodeFilter, setNodeFilter] = useState('');
  const [levelFilter, setLevelFilter] = useState('');
  const [isLive, setIsLive] = useState(false);
  const [streamState, setStreamState] = useState<StreamState>('connecting');
  const [liveCount, setLiveCount] = useState(0);
  const [error, setError] = useState('');
  const stream = useRef<StreamHandle | null>(null);
  const sequence = useRef(0);

  const stopLive = useCallback(() => {
    stream.current?.close();
    stream.current = null;
    setIsLive(false);
  }, []);
  useEffect(() => () => stream.current?.close(), []);

  async function queryLogs() {
    setSearching(true);
    setError('');
    try {
      const { data } = await magnus.post('/logs/query', logQueryResponseSchema, {
        body: { limit: 200, ...(search ? { search } : {}), ...(nodeFilter ? { nodeId: nodeFilter } : {}), ...(levelFilter ? { level: levelFilter } : {}) },
      });
      setLogs(data.logs.map(({ id, source, level, message, timestamp }) => ({ key: id, source, level, message, timestamp })));
      setSearched(true);
    } catch (caught) {
      setError(errorMessage(caught, 'Logs could not be searched'));
    } finally {
      setSearching(false);
    }
  }

  // Opened only by the operator's click: a stream holds a connection for as long as it runs.
  function startLive() {
    stream.current?.close();
    setError('');
    setIsLive(true);
    setLiveCount(0);
    setLogs([]);
    stream.current = openStream({
      path: '/logs/stream',
      query: { nodeIds: nodeFilter || undefined, levels: levelFilter || undefined },
      onEvent: ({ event, data }) => {
        if (event !== 'log') return;
        sequence.current += 1;
        const row = parseStreamLog(data, `live-${sequence.current}`);
        if (!row) return;
        setLogs((current) => prependLog(current, row));
        setLiveCount((count) => count + 1);
      },
      onState: (state, detail) => {
        setStreamState(state);
        if (state !== 'stopped') return;
        stream.current = null;
        setIsLive(false);
        if (detail) setError(detail);
      },
    });
  }

  return (
    <div className="page-stack">
      <PageItem>
        <PageHeader title="Log Explorer" eyebrow="Operations" icon={<ScrollText className="size-5" />} description="Search and browse logs from all Magnus nodes" />
      </PageItem>
      <PageItem>
        <FxPanel interactive={false}>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!isLive) void queryLogs();
            }}
          >
            <div className="min-w-[min(100%,14rem)] flex-1"><Field label="Search"><TextInput value={search} onChange={setSearch} placeholder="Search log messages…" disabled={isLive} /></Field></div>
            <div className="w-full sm:w-56"><NodeSelector label="Node" placeholder="All nodes" value={nodeFilter} onChange={setNodeFilter} /></div>
            <div className="w-full sm:w-32"><Field label="Level"><Select value={levelFilter} onChange={setLevelFilter} options={LEVEL_OPTIONS} /></Field></div>
            <Button type="submit" icon={<Search className="size-4" />} loading={searching} disabled={isLive}>Search</Button>
            {isLive ? (
              <Button type="button" variant="danger" icon={<Square className="size-4" />} onClick={stopLive}>Stop</Button>
            ) : (
              <Button type="button" variant="primary" icon={<Play className="size-4" />} onClick={startLive}>Live tail</Button>
            )}
          </form>
        </FxPanel>
      </PageItem>
      {error ? <PageItem><FormError message={error} /></PageItem> : null}
      <PageItem>
        <FxPanel title={isLive ? `Live tail (${liveCount} received)` : `Logs (${logs.length})`} interactive={false} fxTone={isLive ? 'success' : 'accent'}>
          {isLive ? (
            <p role="status" className={cn('m-0 mb-2 flex items-center gap-2 text-sm', streamState === 'open' ? 'text-success' : 'text-warning')}>
              <HaloDot tone={streamState === 'open' ? 'success' : 'warning'} />
              {STREAM_TEXT[streamState]}
            </p>
          ) : null}
          {logs.length === 0 ? (
            <EmptyState compact icon={<ScrollText className="size-4" />} title={searching ? 'Searching' : isLive ? 'Waiting for incoming logs' : searched ? 'No logs match this search' : 'Run a search to view logs'} />
          ) : (
            <ul className="m-0 grid max-h-[37.5rem] list-none gap-1 overflow-y-auto p-0 text-sm" aria-label="Log entries">
              {logs.map((log) => (
                <li key={log.key} className={cn('fx-rail flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-chip border-l-2 px-2 py-1 hover:bg-surface-hover', LEVEL_EDGE[levelTone(log.level)], isLive && 'scan-sweep')}>
                  <span className="num shrink-0 text-xs text-text-muted">{formatTime(log.timestamp)}</span>
                  <Badge tone={levelTone(log.level)} className="shrink-0">{log.level.toUpperCase()}</Badge>
                  <span className="shrink-0 font-mono text-xs text-text-muted">[{log.source}]</span>
                  <span className="min-w-0 basis-full break-all sm:basis-0 sm:flex-1">{log.message}</span>
                </li>
              ))}
            </ul>
          )}
        </FxPanel>
      </PageItem>
    </div>
  );
}
