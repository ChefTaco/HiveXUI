import { useCallback, useEffect, useRef, useState } from 'react';
import { RotateCw } from 'lucide-react';
import { commandDispatchResponseSchema, quickCommandResponseSchema } from '@contracts/magnus/browser';
import { Badge, Button, IconButton } from '@ui';
import { formatTime } from '@lib/format';
import { useToast } from '../../../../../components/toast';
import { idempotencyKey, magnus, segment } from '../../../api/client';
import { errorMessage } from '../../../api/errors';
import { FxPanel } from '../../../effects';
import { STREAM_DWELL_MS } from '../../../live/use-live-events';
import type { Ask } from './ask';
import { APT_COMMAND, parseAptCount, parseVersions, SOFTWARE_NAMES, VERSION_COMMAND } from './node-data';

const VERSION_TIMEOUT_SECONDS = 60;
const APT_TIMEOUT_SECONDS = 180;
const APT_REFRESH_MS = 60 * 60 * 1000;

function probe(nodeId: string, command: string, timeoutSeconds: number, signal: AbortSignal): Promise<string> {
  return magnus
    .post(`/quick-command/${segment(nodeId)}/exec`, quickCommandResponseSchema, { body: { command, args: [], timeoutSeconds }, signal, timeoutMs: (timeoutSeconds + 10) * 1000 })
    .then(({ data }) => {
      if (data.exitCode !== 0) throw new Error(`The probe exited with code ${data.exitCode}${data.stderr ? `: ${data.stderr.trim().slice(0, 200)}` : ''}`);
      return data.stdout;
    });
}

/**
 * Versions and pending apt updates come from running a probe on the node, so a read here is a command there.
 * The first probes wait until someone has stayed on the page, and a role that may not run commands sends none.
 */
export function SoftwareCard({ nodeId, nodeName, online, canRun, ask }: { nodeId: string; nodeName: string; online: boolean; canRun: boolean; ask: Ask }) {
  const toast = useToast();
  const [versions, setVersions] = useState<Record<string, string>>({});
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const [aptCount, setAptCount] = useState<number | null>(null);
  const [aptChecked, setAptChecked] = useState<string | null>(null);
  const [aptChecking, setAptChecking] = useState(false);
  const [aptError, setAptError] = useState<string | null>(null);
  const [upgrading, setUpgrading] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const current = new AbortController();
    controller.current = current;
    return () => current.abort();
  }, [nodeId]);

  const loadVersions = useCallback(async () => {
    const signal = controller.current?.signal;
    if (!signal) return;
    setVersionsLoading(true);
    setVersionsError(null);
    try {
      const stdout = await probe(nodeId, VERSION_COMMAND, VERSION_TIMEOUT_SECONDS, signal);
      if (!signal.aborted) setVersions(parseVersions(stdout));
    } catch (error) {
      if (!signal.aborted) setVersionsError(errorMessage(error, 'Software revisions could not be loaded'));
    } finally {
      if (!signal.aborted) setVersionsLoading(false);
    }
  }, [nodeId]);
  const refreshApt = useCallback(async () => {
    const signal = controller.current?.signal;
    if (!signal) return;
    setAptChecking(true);
    setAptError(null);
    try {
      const stdout = await probe(nodeId, APT_COMMAND, APT_TIMEOUT_SECONDS, signal);
      if (signal.aborted) return;
      setAptCount(parseAptCount(stdout));
      setAptChecked(new Date().toISOString());
    } catch (error) {
      if (!signal.aborted) setAptError(errorMessage(error, 'Apt updates could not be refreshed'));
    } finally {
      if (!signal.aborted) setAptChecking(false);
    }
  }, [nodeId]);

  const active = online && canRun;
  useEffect(() => {
    if (!active) return;
    const first = setTimeout(() => {
      void loadVersions();
      void refreshApt();
    }, STREAM_DWELL_MS);
    const hourly = setInterval(() => void refreshApt(), APT_REFRESH_MS);
    return () => {
      clearTimeout(first);
      clearInterval(hourly);
    };
  }, [active, loadVersions, refreshApt]);

  async function upgrade() {
    setUpgrading(true);
    const key = idempotencyKey();
    try {
      const { data } = await magnus.post('/commands', commandDispatchResponseSchema, { idempotencyKey: key, body: { nodeIds: [nodeId], command: 'sudo', args: ['apt', 'upgrade', '-y'], timeoutSeconds: 1800, idempotencyKey: key } });
      const command = 'commands' in data ? data.commands[0] : undefined;
      toast.success('APT upgrade dispatched', command ? `Command ${command.id.slice(0, 12)}… Check Commands for progress.` : 'Check Commands for progress.');
      void refreshApt();
    } catch (error) {
      toast.error('APT upgrade was not dispatched', errorMessage(error));
    } finally {
      setUpgrading(false);
    }
  }

  return (
    <FxPanel
      title="Software revisions"
      description="Major runtime versions and package update status"
      actions={canRun ? <IconButton label="Refresh software revisions" disabled={!online || versionsLoading} icon={<RotateCw className={versionsLoading ? 'size-4 animate-spin' : 'size-4'} />} onClick={() => void loadVersions()} /> : undefined}
    >
      <dl className="m-0 grid gap-2 text-sm">
        {SOFTWARE_NAMES.map((name) => (
          <div key={name} className="flex items-start justify-between gap-2">
            <dt className="text-xs text-text-muted">{name}</dt>
            <dd className="m-0 min-w-0 text-right font-mono text-xs break-all">{versions[name] ?? (versionsLoading ? 'Reading…' : '—')}</dd>
          </div>
        ))}
      </dl>
      {versionsError ? <p className="m-0 mt-2 text-sm break-words text-danger">{versionsError}</p> : null}
      {!canRun ? <p className="m-0 mt-2 text-xs text-text-muted">Reading versions runs a command on the node, which needs the operator role.</p> : null}
      {canRun && !online ? <p className="m-0 mt-2 text-xs text-text-muted">The node must be ONLINE to read versions.</p> : null}
      <div className="mt-4 grid gap-3 border-t border-border pt-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-text-muted">APT updates</span>
          <Badge tone={aptCount ? 'warning' : aptCount === 0 ? 'success' : 'neutral'}>{aptChecking ? 'Checking…' : `${aptCount ?? '—'} pending`}</Badge>
        </div>
        <p className="m-0 text-xs text-text-muted">Refreshed hourly via apt update{aptChecked ? ` · Last check: ${formatTime(aptChecked)}` : ''}</p>
        {aptError ? <p className="m-0 text-sm break-words text-danger">{aptError}</p> : null}
        {canRun ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={!online || aptChecking} icon={<RotateCw className={aptChecking ? 'size-4 animate-spin' : 'size-4'} />} onClick={() => void refreshApt()}>Refresh</Button>
            <Button size="sm" variant="primary" disabled={!online} loading={upgrading} onClick={() => ask({ title: 'Run apt upgrade', message: `Run apt upgrade on "${nodeName}"?`, label: 'Run apt upgrade', action: () => upgrade() })}>{upgrading ? 'Dispatching…' : 'APT upgrade'}</Button>
          </div>
        ) : null}
      </div>
    </FxPanel>
  );
}
