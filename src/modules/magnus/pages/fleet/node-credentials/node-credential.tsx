import { useState, type FormEvent } from 'react';
import { KeyRound, SearchCheck } from 'lucide-react';
import { Badge, Button, Field, ResourceError, TextInput } from '@ui';
import { formatTime, relativeTime } from '@lib/format';
import { useMagnusResource } from '../../../api/use-resource';
import { FxPanel } from '../../../effects';
import { ADMIN_ONLY, useMagnusSession, WRITE_ROLES } from '../../../session';
import { Row } from '../node-detail/posture-cards';
import { checkDowngrade, downgradeErrorMessage, listNodeKeys, listPendingBindings, readCredentialSummary, type DowngradeCheck, type NodeCredential, type PendingBinding } from './api';
import { NodeKeyAdministration } from './key-administration';
import { credentialStateView, credentialTasks, downgradeView, evidenceSigningText, legacyUseRows, looksLikeVersion, NODE_KEYS_SINCE, originLabel } from './model';
import { PendingBindingsTable } from './pending-bindings';

/** The node's credential state as a badge, with its meaning on hover. */
export function NodeCredentialBadge({ credential, pending }: { credential: NodeCredential; pending?: PendingBinding | null | undefined }) {
  const view = credentialStateView(credential, pending);
  return (
    <span title={view.explanation}>
      <Badge tone={view.tone}><KeyRound aria-hidden="true" className="mr-1 inline size-3" />{view.label}</Badge>
    </span>
  );
}

/**
 * Node detail: how this node authenticates to Magnus, the use of the shared credentials still recorded for
 * it, a binding waiting for an administrator, a check before installing an older agent, and key
 * administration. An administrator on a Magnus that offers it lists, revokes and resets the node's keys
 * here; everyone else, and every Magnus that answers the key list with 404, gets the CLI and API steps.
 */
export function NodeCredentialCard({ nodeId, nodeName, credential, agentVersion, onChanged }: { nodeId: string; nodeName?: string | undefined; credential: NodeCredential; agentVersion: string | null; onChanged: () => void }) {
  const { can } = useMagnusSession();
  const isAdmin = can(ADMIN_ONLY);
  const pending = useMagnusResource((signal) => listPendingBindings({ nodeId, signal }), [nodeId], { enabled: isAdmin && credential.state === 'none' });
  const keys = useMagnusResource((signal) => listNodeKeys(nodeId, signal), [nodeId], { enabled: isAdmin });
  const summary = useMagnusResource((signal) => readCredentialSummary(signal), [], { enabled: isAdmin });
  const waiting = credential.state === 'none' ? pending.data?.[0] ?? null : null;
  const view = credentialStateView(credential, waiting);
  const legacy = legacyUseRows(credential);
  const evidence = evidenceSigningText(credential);
  // Null: this Magnus answers the key list with 404, so its key administration is not a browser route.
  const inBrowser = isAdmin && Boolean(keys.data);
  // After a decision: the node (its credential state), its keys, the summary and its waiting binding.
  const changed = () => {
    if (isAdmin) {
      void keys.refresh();
      void summary.refresh();
      if (credential.state === 'none') void pending.refresh();
    }
    onChanged();
  };
  return (
    <FxPanel
      fxTone={view.tone === 'danger' ? 'danger' : view.tone === 'warning' ? 'warning' : 'accent'}
      title={<span className="flex items-center gap-2"><KeyRound aria-hidden="true" className="size-4" />Node credential</span>}
      description="How this node proves who it is to Magnus"
      actions={<NodeCredentialBadge credential={credential} pending={waiting} />}
    >
      <div className="grid gap-4 text-sm">
        <p className="m-0 text-text-muted">{view.explanation}</p>
        <dl className="m-0 grid gap-2">
          <Row label="Key fingerprint">
            {credential.keyFingerprint ? <span className="num break-all">{credential.keyFingerprint}</span> : credential.keyFingerprint === undefined && credential.state !== 'none' ? <span className="text-text-muted">shown to administrators</span> : '—'}
          </Row>
          <Row label="Origin">{originLabel(credential.origin)}</Row>
          <Row label="Bound"><span className="num" title={formatTime(credential.boundAt)}>{credential.boundAt ? relativeTime(credential.boundAt) : '—'}</span></Row>
          <Row label="Last used"><span className="num" title={formatTime(credential.lastUsedAt)}>{credential.lastUsedAt ? relativeTime(credential.lastUsedAt) : '—'}</span></Row>
          {evidence ? <Row label="Signs its evidence">{evidence}</Row> : null}
        </dl>
        {legacy ? (
          <div className="grid gap-1">
            <p className="m-0 font-medium">Shared credentials still used for this node</p>
            <ul className="m-0 grid list-none gap-1 p-0" aria-label="Shared credential use">
              {legacy.map((row) => (
                <li key={row.channel} className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="text-text-muted">{row.label}</span>
                  <span className="num" title={formatTime(row.lastUsedAt)}>{row.count ? `${row.count}×, last ${relativeTime(row.lastUsedAt)}` : 'none'}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {waiting ? (
          <div className="grid gap-2">
            <p className="m-0 font-medium">Waiting for an administrator</p>
            <PendingBindingsTable bindings={[waiting]} canDecide={isAdmin} showNode={false} onDecided={changed} />
          </div>
        ) : null}
        {inBrowser && keys.data ? <NodeKeyAdministration nodeId={nodeId} nodeName={nodeName ?? nodeId} credential={credential} keys={keys.data} summary={summary.data} onChanged={changed} /> : null}
        {isAdmin && !keys.data && keys.error ? <ResourceError error={keys.error} title="The node's keys could not be read" onRetry={() => void keys.refresh()} /> : null}
        {can(WRITE_ROLES) ? <DowngradeCheckTool nodeId={nodeId} agentVersion={agentVersion} /> : null}
        <CredentialInstructions nodeId={nodeId} inBrowser={inBrowser} />
      </div>
    </FxPanel>
  );
}

/**
 * Before installing an older agent: Magnus answers whether that version keeps the node key, and what has
 * to happen first if not. The UI offers no downgrade itself, so this is a check, not a step of one.
 */
export function DowngradeCheckTool({ nodeId, agentVersion }: { nodeId: string; agentVersion: string | null }) {
  const [to, setTo] = useState('');
  const [result, setResult] = useState<DowngradeCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const valid = looksLikeVersion(to);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await checkDowngrade(nodeId, to));
    } catch (cause) {
      setError(downgradeErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  const view = result ? downgradeView(result) : null;
  return (
    <details className="grid gap-2">
      <summary className="cursor-pointer font-medium">Check a downgrade</summary>
      <form className="mt-2 grid gap-2" onSubmit={(event) => void submit(event)}>
        <p className="m-0 text-text-muted">An agent older than {NODE_KEYS_SINCE} only knows the shared secret, which Magnus refuses for a node with a key. Ask before installing an older agent{agentVersion ? ` (this node runs ${agentVersion})` : ''}.</p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-[0_1_12rem]">
            <Field label="Agent version to install">
              <TextInput value={to} placeholder="2.9.1" inputMode="decimal" aria-invalid={to !== '' && !valid ? true : undefined} onChange={setTo} />
            </Field>
          </div>
          <Button type="submit" size="sm" icon={<SearchCheck className="size-4" />} loading={busy} disabled={!valid}>Check</Button>
        </div>
        {error ? <p role="alert" className="m-0 text-danger">{error}</p> : null}
        {view ? (
          <div role="status" className="grid gap-2 rounded-control border border-border px-3 py-2">
            <p className="m-0 flex flex-wrap items-center gap-2 font-semibold"><Badge tone={view.tone}>{result?.action}</Badge>{view.title}</p>
            <p className="m-0 text-text-muted">{view.detail}</p>
            {view.steps.length ? <ol className="m-0 list-decimal space-y-1 pl-5">{view.steps.map((step) => <li key={step}>{step}</li>)}</ol> : null}
            {view.command ? <pre className="m-0 overflow-x-auto rounded-control bg-surface-raised p-2 font-mono text-xs whitespace-pre-wrap break-all">{view.command}</pre> : null}
          </div>
        ) : null}
      </form>
    </details>
  );
}

/**
 * The key administration steps as text. With `inBrowser`, the card already offers the list, revoke and
 * reset, so only rotating (on the node) and enrolling again with a token remain.
 */
export function CredentialInstructions({ nodeId, inBrowser = false }: { nodeId: string; inBrowser?: boolean }) {
  const tasks = credentialTasks(nodeId, { inBrowser });
  return (
    <details className="grid gap-2">
      <summary className="cursor-pointer font-medium">{inBrowser ? 'Rotate or enroll this node’s key' : 'Manage this node’s key'}</summary>
      <p className="m-0 mt-2 text-text-muted">
        {inBrowser
          ? 'The UI does not offer these: rotating runs on the node, and an enrollment token is a secret the UI never shows. Run them on the node, or against the Magnus API with an administrator’s token ($MAGNUS_URL is the server’s address).'
          : 'The UI does not offer these here. Run them on the node, or against the Magnus API with an administrator’s token ($MAGNUS_URL is the server’s address).'}
      </p>
      <ul className="m-0 mt-2 grid list-none gap-3 p-0">
        {tasks.map((task) => (
          <li key={task.id} className="grid gap-1">
            <p className="m-0 font-medium">{task.title} <span className="text-xs font-normal text-text-muted">({task.where === 'node' ? 'on the node' : `Magnus API${task.roles ? `, ${task.roles.join(' or ')}` : ''}`})</span></p>
            <pre className="m-0 overflow-x-auto rounded-control bg-surface-raised p-2 font-mono text-xs whitespace-pre-wrap break-all">{task.commands.join('\n')}</pre>
            <p className="m-0 text-text-muted">{task.effect}</p>
          </li>
        ))}
      </ul>
    </details>
  );
}
