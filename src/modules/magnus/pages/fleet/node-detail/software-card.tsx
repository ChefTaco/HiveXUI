import { useEffect, useRef, useState } from 'react';
import { RotateCw } from 'lucide-react';
import { commandDispatchResponseSchema, nodeSoftwareResponseSchema } from '@contracts/magnus/browser';
import { Badge, Button } from '@ui';
import { formatTime } from '@lib/format';
import { onAccessCleared } from '../../../../../lib/transport';
import { useToast } from '../../../../../components/toast';
import { idempotencyKey, magnus, segment } from '../../../api/client';
import { errorMessage, MagnusApiError } from '../../../api/errors';
import { FxPanel } from '../../../effects';
import type { Ask } from './ask';
import { SOFTWARE_NAMES } from './node-data';

type Checked = ReturnType<typeof nodeSoftwareResponseSchema.parse>['data'];
/** The last answers for each node, so coming back to a page shows them without asking the node again. */
const lastChecked = new Map<string, Checked>();
onAccessCleared(() => lastChecked.clear());

/**
 * Versions and cached update counts use the node's fixed read-only diagnostic.
 * Upgrades remain explicit operator commands. Neither runs just from viewing the page.
 */
export function SoftwareCard({ nodeId, nodeName, online, canRun, ask }: { nodeId: string; nodeName: string; online: boolean; canRun: boolean; ask: Ask }) {
  const toast = useToast();
  const [checked, setChecked] = useState<Checked | undefined>(() => lastChecked.get(nodeId));
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const [aptChecking, setAptChecking] = useState(false);
  const [aptError, setAptError] = useState<string | null>(null);
  const [upgrading, setUpgrading] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const current = new AbortController();
    controller.current = current;
    setChecked(lastChecked.get(nodeId));
    setVersionsLoading(false);
    setVersionsError(null);
    setAptChecking(false);
    setAptError(null);
    return () => current.abort();
  }, [nodeId]);
  const remember = (next: Checked) => {
    lastChecked.set(nodeId, next);
    setChecked(next);
  };

  async function readSoftware(section: 'versions' | 'updates') {
    const signal = controller.current?.signal;
    if (!signal) return;
    const setLoading = section === 'versions' ? setVersionsLoading : setAptChecking;
    const setError = section === 'versions' ? setVersionsError : setAptError;
    setLoading(true);
    setError(null);
    try {
      const { data } = await magnus.get(`/nodes/${segment(nodeId)}/software`, nodeSoftwareResponseSchema, { signal });
      if (!signal.aborted) remember(data);
    } catch (error) {
      if (!signal.aborted) setError(error instanceof MagnusApiError && (error.status === 404 || (error.status === 409 && error.code === 'SOFTWARE_STATUS_UNAVAILABLE'))
        ? 'Software status is unavailable. Update Magnus and the node agent, then try again.'
        : errorMessage(error, 'Software status could not be read'));
    } finally {
      if (!signal.aborted) setLoading(false);
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

  const versions = checked?.versions;
  const aptCount = checked?.packageUpdates.pending;
  const aptSupported = checked?.packageUpdates.supported;
  const cacheRefreshedAt = checked?.packageUpdates.cacheRefreshedAt;
  return (
    <FxPanel
      title="Software revisions"
      description="Installed versions and cached package update status"
      actions={<Button size="sm" className="whitespace-nowrap" disabled={!online} loading={versionsLoading} icon={<RotateCw className="size-4" />} onClick={() => void readSoftware('versions')}>Check versions</Button>}
    >
      <dl className="m-0 grid gap-2 text-sm">
        {SOFTWARE_NAMES.map((name) => (
          <div key={name} className="flex items-start justify-between gap-2">
            <dt className="text-xs text-text-muted">{name}</dt>
            <dd className="m-0 min-w-0 text-right font-mono text-xs break-all">{versions?.[name] === null ? 'Not reported' : versions?.[name] ?? (versionsLoading ? 'Reading…' : '—')}</dd>
          </div>
        ))}
      </dl>
      <p className="m-0 mt-2 text-xs text-text-muted">{checked ? `Last checked: ${formatTime(checked.checkedAt)}` : 'Not checked yet. Reads installed version information.'}</p>
      {versionsError ? <p role="alert" className="m-0 mt-2 text-sm break-words text-danger">{versionsError}</p> : null}
      {!online ? <p className="m-0 mt-2 text-xs text-text-muted">The node must be ONLINE to read versions.</p> : null}
      <div className="mt-4 grid gap-3 border-t border-border pt-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-text-muted">APT updates</span>
          <Badge tone={aptCount ? 'warning' : aptCount === 0 ? 'success' : 'neutral'}>{aptChecking ? 'Reading…' : aptSupported === false ? 'Unavailable' : aptCount === null ? 'Not reported' : `${aptCount ?? '—'} pending`}</Badge>
        </div>
        <p className="m-0 text-xs text-text-muted">Pending updates from the node&apos;s last repository refresh.</p>
        <p className="m-0 text-xs text-text-muted">{cacheRefreshedAt ? `Cache refreshed: ${formatTime(cacheRefreshedAt)}` : 'Repository refresh time not reported.'}{checked ? ` Read at: ${formatTime(checked.checkedAt)}.` : ''}</p>
        {aptError ? <p role="alert" className="m-0 text-sm break-words text-danger">{aptError}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={!online} loading={aptChecking} icon={<RotateCw className="size-4" />} onClick={() => void readSoftware('updates')}>Read update cache</Button>
          {canRun ? <Button size="sm" variant="primary" disabled={!online} loading={upgrading} onClick={() => ask({ title: 'Run apt upgrade', message: `Run apt upgrade on "${nodeName}"?`, label: 'Run apt upgrade', action: () => upgrade() })}>{upgrading ? 'Dispatching…' : 'APT upgrade'}</Button> : null}
        </div>
      </div>
    </FxPanel>
  );
}
