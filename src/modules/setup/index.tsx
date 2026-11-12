// The Setup page: the first-run checklist the Hive Registry records after an install or upgrade,
// for administrators. Each item shows its command to copy and its docs; where HiveXUI can read
// what the item asks for, it checks it, and says when a pending item looks done. The page only
// reads: `./hive.sh post-upgrade` and `./hive.sh setup` record the checklist.
import { useEffect, useMemo, useState } from 'react';
import { ClipboardCheck, Copy, RefreshCw } from 'lucide-react';
import { Badge, Button, EmptyState, PageHeader, Panel } from '@ui';
import { isAdministrator } from '../../lib/permissions';
import { refreshRegistry, useRegistry, type RegistrySetupItem, type RegistryState } from '../../lib/registry';
import type { ScreenProps } from '../../lib/routes';
import { browserClientIds, productInstalled } from '../../lib/runtime';
import { quietApiFetch } from '../../lib/transport';
import { orderItems, pendingLabel, productName, recordCommand, verdict, type ProbeState } from './checklist';
import { knownCheck, runProbe, type ProbeContext } from './probes';

const liveContext = (): ProbeContext => ({ fetch: quietApiFetch, installed: productInstalled, clients: browserClientIds() });

export default function SetupScreen({ currentUser }: Pick<ScreenProps, 'currentUser'>) {
  const registry = useRegistry();
  const context = useMemo(liveContext, []);
  if (!isAdministrator(currentUser))
    return (
      <Panel title="Access unavailable">
        <p>Only administrators see the setup checklist.</p>
      </Panel>
    );
  return <SetupPage registry={registry} context={context} refresh={refreshRegistry} />;
}

/** Runs the probe of every pending item HiveXUI knows how to check, again on each round. */
function useProbes(items: readonly RegistrySetupItem[], context: ProbeContext, round: number): Readonly<Record<string, ProbeState>> {
  const [probes, setProbes] = useState<Record<string, ProbeState>>({});
  const wanted = items.filter((item) => item.status === 'pending' && knownCheck(item.check)).map((item) => [item.id, item.check!] as const);
  const key = JSON.stringify(wanted);
  useEffect(() => {
    const controller = new AbortController();
    const checks: ReadonlyArray<readonly [string, string]> = JSON.parse(key);
    setProbes(Object.fromEntries(checks.map(([id]) => [id, { state: 'checking' }])));
    for (const [id, check] of checks)
      void runProbe(check, context, controller.signal).then((result) => {
        if (!controller.signal.aborted) setProbes((current) => ({ ...current, [id]: result }));
      });
    return () => controller.abort();
  }, [key, context, round]);
  return probes;
}

export function SetupPage({ registry, context, refresh }: { registry: RegistryState; context: ProbeContext; refresh: () => Promise<void> }) {
  const [round, setRound] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  // The shell reads the Registry once at sign-in; this page asks again so it shows the latest list.
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const setup = registry.status === 'ready' ? registry.setup : null;
  const items = useMemo(() => orderItems(setup?.items ?? []), [setup]);
  const probes = useProbes(items, context, round);
  const pending = items.filter((item) => item.status === 'pending').length;

  async function again() {
    setRefreshing(true);
    try {
      await refresh();
      setRound((value) => value + 1);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="grid gap-5">
      <PageHeader
        eyebrow="Hive"
        title="Setup"
        status={setup ? <Badge tone={pending > 0 ? 'warning' : 'success'} dot>{pending > 0 ? pendingLabel(pending) : 'All settled'}</Badge> : null}
        description="Steps after an install or upgrade that still need a person. HiveXUI only reads this list: ./hive.sh post-upgrade records the steps it completes, and ./hive.sh setup done or skip settles one by hand."
        actions={
          <Button variant="ghost" icon={<RefreshCw className="size-4" />} loading={refreshing} onClick={() => void again()}>
            Refresh
          </Button>
        }
      />
      {registry.status === 'pending' ? (
        <p role="status">Reading the Hive Registry…</p>
      ) : registry.status === 'unavailable' ? (
        <EmptyState
          framed
          tone="warning"
          title="The setup checklist can't be shown"
          message={registry.reason === 'malformed' ? 'The Hive Registry sent an answer HiveXUI cannot read.' : 'The Hive Registry is not answering. Try again in a moment.'}
        />
      ) : !setup ? (
        <EmptyState
          framed
          icon={<ClipboardCheck className="size-5" />}
          title="No setup checklist"
          message="The Hive Registry has not recorded one. It does after an install or upgrade with a release that keeps the checklist."
        />
      ) : items.length === 0 ? (
        <EmptyState framed icon={<ClipboardCheck className="size-5" />} title="Nothing to set up" message="The checklist holds no steps for this installation." />
      ) : (
        <ol className="setup-list" aria-label="Setup steps">
          {items.map((item) => (
            <li key={item.id}>
              <SetupItem item={item} probe={probes[item.id]} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function SetupItem({ item, probe }: { item: RegistrySetupItem; probe: ProbeState | undefined }) {
  const shown = verdict(item, probe);
  return (
    <Panel as="article" padding="sm" title={item.title} eyebrow={item.product ? productName(item.product) : 'Hive'} actions={<Badge tone={shown.tone} dot>{shown.label}</Badge>}>
      <div className="grid gap-3">
        {item.command ? <CommandBlock command={item.command} /> : null}
        <p className="setup-docs">
          Docs: <code>{item.docs}</code>
        </p>
        {item.status === 'pending' && probe ? <ProbeLine item={item} probe={probe} /> : null}
      </div>
    </Panel>
  );
}

function ProbeLine({ item, probe }: { item: RegistrySetupItem; probe: ProbeState }) {
  if (probe.state === 'checking') return <p className="setup-probe" role="status">Checking…</p>;
  if (probe.state === 'done')
    return (
      <div className="setup-probe setup-probe--done">
        <p>
          <strong>Looks done</strong> — run <code>{recordCommand(item)}</code> to record it.
        </p>
        <p>{probe.detail}</p>
      </div>
    );
  return (
    <p className="setup-probe">
      {probe.state === 'not-done' ? 'Not done yet: ' : "Couldn't check: "}
      {probe.detail}
    </p>
  );
}

/** A command to copy. The clipboard may be missing or refused, so a failure says to copy by hand. */
export function CommandBlock({ command }: { command: string }) {
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (copied !== 'copied') return;
    const timer = window.setTimeout(() => setCopied('idle'), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied('copied');
    } catch {
      setCopied('failed');
    }
  }
  return (
    <div className="setup-command">
      <pre className="code-block">
        <code>{command}</code>
      </pre>
      <Button size="sm" variant="ghost" icon={<Copy className="size-4" />} onClick={() => void copy()}>
        {copied === 'copied' ? 'Copied' : 'Copy'}
        <span className="sr-only"> command: {command}</span>
      </Button>
      <span className="sr-only" role="status">
        {copied === 'copied' ? 'Command copied' : ''}
      </span>
      {copied === 'failed' ? <p className="setup-copy-failed" role="alert">Copying was not allowed here. Select the command and copy it by hand.</p> : null}
    </div>
  );
}
