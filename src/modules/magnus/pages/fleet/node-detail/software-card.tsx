import { useEffect, useRef, useState } from 'react';
import { RotateCw } from 'lucide-react';
import { commandDispatchResponseSchema, quickCommandResponseSchema } from '@contracts/magnus/browser';
import { Badge, Button } from '@ui';
import { formatTime } from '@lib/format';
import { onAccessCleared } from '../../../../../lib/transport';
import { useToast } from '../../../../../components/toast';
import { idempotencyKey, magnus, segment } from '../../../api/client';
import { errorMessage } from '../../../api/errors';
import { FxPanel } from '../../../effects';
import type { Ask } from './ask';
import { APT_COMMAND, parseAptCount, parseVersions, SOFTWARE_NAMES, VERSION_COMMAND } from './node-data';

const VERSION_TIMEOUT_SECONDS = 60;
const APT_TIMEOUT_SECONDS = 180;

function probe(nodeId: string, command: string, timeoutSeconds: number, signal: AbortSignal): Promise<string> {
  return magnus
    .post(`/quick-command/${segment(nodeId)}/exec`, quickCommandResponseSchema, { body: { command, args: [], timeoutSeconds }, signal, timeoutMs: (timeoutSeconds + 10) * 1000 })
    .then(({ data }) => {
      if (data.exitCode !== 0) throw new Error(`The probe exited with code ${data.exitCode}${data.stderr ? `: ${data.stderr.trim().slice(0, 200)}` : ''}`);
      return data.stdout;
    });
}

interface Checked {
  versions?: Record<string, string>;
  versionsAt?: string;
  aptCount?: number | null;
  aptAt?: string;
}
/** The last answers for each node, so coming back to a page shows them without asking the node again. */
const lastChecked = new Map<string, Checked>();
onAccessCleared(() => lastChecked.clear());

/**
 * Versions and pending apt updates come from running a command on the node, so they run only when
 * someone presses a button here. Viewing this page must never execute anything on a host.
 */
export function SoftwareCard({ nodeId, nodeName, online, canRun, ask }: { nodeId: string; nodeName: string; online: boolean; canRun: boolean; ask: Ask }) {
  const toast = useToast();
  const [checked, setChecked] = useState<Checked>(() => lastChecked.get(nodeId) ?? {});
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const [aptChecking, setAptChecking] = useState(false);
  const [aptError, setAptError] = useState<string | null>(null);
  const [upgrading, setUpgrading] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const current = new AbortController();
    controller.current = current;
    setChecked(lastChecked.get(nodeId) ?? {});
    setVersionsLoading(false);
    setAptChecking(false);
    return () => current.abort();
  }, [nodeId]);
  const remember = (next: Checked) => {
    const merged = { ...lastChecked.get(nodeId), ...next };
    lastChecked.set(nodeId, merged);
    setChecked(merged);
  };

  async function checkVersions() {
    const signal = controller.current?.signal;
    if (!signal) return;
    setVersionsLoading(true);
    setVersionsError(null);
    try {
      const stdout = await probe(nodeId, VERSION_COMMAND, VERSION_TIMEOUT_SECONDS, signal);
      if (!signal.aborted) remember({ versions: parseVersions(stdout), versionsAt: new Date().toISOString() });
    } catch (error) {
      if (!signal.aborted) setVersionsError(errorMessage(error, 'Software revisions could not be loaded'));
    } finally {
      if (!signal.aborted) setVersionsLoading(false);
    }
  }
  async function checkApt() {
    const signal = controller.current?.signal;
    if (!signal) return;
    setAptChecking(true);
    setAptError(null);
    try {
      const stdout = await probe(nodeId, APT_COMMAND, APT_TIMEOUT_SECONDS, signal);
      if (!signal.aborted) remember({ aptCount: parseAptCount(stdout), aptAt: new Date().toISOString() });
    } catch (error) {
      if (!signal.aborted) setAptError(errorMessage(error, 'Apt updates could not be refreshed'));
    } finally {
      if (!signal.aborted) setAptChecking(false);
    }
  }
  async function upgrade() {
    setUpgrading(true);
    const key = idempotencyKey();
    try {
      const { data } = await magnus.post('/commands', commandDispatchResponseSchema, { idempotencyKey: key, body: { nodeIds: [nodeId], command: 'sudo', args: ['apt', 'upgrade', '-y'], timeoutSeconds: 1800, idempotencyKey: key } });
      const command = 'commands' in data ? data.commands[0] : undefined;
      toast.success('APT upgrade dispatched', command ? `Command ${command.id.slice(0, 12)}… Check Commands for progress.` : 'Check Commands for progress.');
    } catch (error) {
      toast.error('APT upgrade was not dispatched', errorMessage(error));
    } finally {
      setUpgrading(false);
    }
  }

  const { versions = {}, versionsAt, aptCount, aptAt } = checked;
  return (
    <FxPanel
      title="Software revisions"
      description="Major runtime versions and package update status"
      actions={canRun ? <Button size="sm" className="whitespace-nowrap" disabled={!online} loading={versionsLoading} icon={<RotateCw className="size-4" />} onClick={() => void checkVersions()}>Check versions</Button> : undefined}
    >
      <dl className="m-0 grid gap-2 text-sm">
        {SOFTWARE_NAMES.map((name) => (
          <div key={name} className="flex items-start justify-between gap-2">
            <dt className="text-xs text-text-muted">{name}</dt>
            <dd className="m-0 min-w-0 text-right font-mono text-xs break-all">{versions[name] ?? (versionsLoading ? 'Reading…' : '—')}</dd>
          </div>
        ))}
      </dl>
      <p className="m-0 mt-2 text-xs text-text-muted">{versionsAt ? `Last checked: ${formatTime(versionsAt)}` : 'Not checked yet. Checking runs a command on the node.'}</p>
      {versionsError ? <p className="m-0 mt-2 text-sm break-words text-danger">{versionsError}</p> : null}
      {!canRun ? <p className="m-0 mt-2 text-xs text-text-muted">Reading versions runs a command on the node, which needs the operator role.</p> : null}
      {canRun && !online ? <p className="m-0 mt-2 text-xs text-text-muted">The node must be ONLINE to read versions.</p> : null}
      <div className="mt-4 grid gap-3 border-t border-border pt-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-text-muted">APT updates</span>
          <Badge tone={aptCount ? 'warning' : aptCount === 0 ? 'success' : 'neutral'}>{aptChecking ? 'Checking…' : `${aptCount ?? '—'} pending`}</Badge>
        </div>
        <p className="m-0 text-xs text-text-muted">{aptAt ? `Last checked: ${formatTime(aptAt)}` : 'Not checked yet. Checking runs apt update on the node.'}</p>
        {aptError ? <p className="m-0 text-sm break-words text-danger">{aptError}</p> : null}
        {canRun ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={!online} loading={aptChecking} icon={<RotateCw className="size-4" />} onClick={() => void checkApt()}>Check for updates</Button>
            <Button size="sm" variant="primary" disabled={!online} loading={upgrading} onClick={() => ask({ title: 'Run apt upgrade', message: `Run apt upgrade on "${nodeName}"?`, label: 'Run apt upgrade', action: () => upgrade() })}>{upgrading ? 'Dispatching…' : 'APT upgrade'}</Button>
          </div>
        ) : null}
      </div>
    </FxPanel>
  );
}
