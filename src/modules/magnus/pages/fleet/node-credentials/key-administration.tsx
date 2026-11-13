import { useRef, useState } from 'react';
import { Ban, RotateCcw } from 'lucide-react';
import { Badge, Button, DataTable, type DataTableColumn } from '@ui';
import { formatTime, relativeTime } from '@lib/format';
import { useToast } from '../../../../../components/toast';
import { idempotencyKey } from '../../../api/client';
import { ActionConfirm } from '../../../ui/action-confirm';
import { keyActionErrorMessage, resetNodeKeys, revokeNodeKeys, type CredentialSummary, type NodeCredential, type NodeKey } from './api';
import { keyActionOutcome, keyStatusView, originLabel, resetMessage, resetUnavailable, revocableKeys, revokeMessage } from './model';
import { ReasonField } from './reason-field';

type Kind = 'revoke' | 'reset';
interface Outcome {
  tone: ReturnType<typeof keyActionOutcome>['tone'];
  title: string;
  detail: string;
}

const KEY_COLUMNS: ReadonlyArray<DataTableColumn<NodeKey>> = [
  { key: 'fingerprint', header: 'Key fingerprint', className: 'cell-mono', cell: (key) => <span className="num break-all">{key.keyFingerprint}</span> },
  {
    key: 'status',
    header: 'Status',
    cell: (key) => {
      const view = keyStatusView(key);
      const note = key.status === 'RETIRING' && key.retireAt ? `Valid until ${formatTime(key.retireAt)}` : key.status === 'REVOKED' && key.revokedAt ? `Revoked ${formatTime(key.revokedAt)}${key.revokedBy ? ` by ${key.revokedBy}` : ''}` : undefined;
      return <span title={note}><Badge tone={view.tone}>{view.label}</Badge></span>;
    },
  },
  { key: 'origin', header: 'Origin', cell: (key) => originLabel(key.origin) },
  { key: 'created', header: 'Created', cell: (key) => <span className="num whitespace-nowrap" title={formatTime(key.createdAt)}>{relativeTime(key.createdAt)}</span> },
  { key: 'used', header: 'Last used', cell: (key) => <span className="num whitespace-nowrap" title={formatTime(key.lastUsedAt)}>{key.lastUsedAt ? relativeTime(key.lastUsedAt) : 'never'}</span> },
];

/**
 * Node detail, for an administrator on a Magnus that offers key administration to the browser: every key
 * of the node, and Revoke and Reset behind the shared confirmation that says what follows before anything
 * is sent. Each confirmation sends one request with its own idempotency key; Magnus's answer stays on
 * the card, and the caller reads the node, the list and the summary again in `onChanged`.
 */
export function NodeKeyAdministration({ nodeId, nodeName, credential, keys, summary, onChanged }: {
  nodeId: string;
  nodeName: string;
  credential: NodeCredential;
  keys: readonly NodeKey[];
  /** The fleet summary, for enforce mode and the upgrade window; null on a Magnus without one. */
  summary: CredentialSummary | null | undefined;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [asking, setAsking] = useState<Kind | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<Kind | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // Set before the first await, so a second click on Confirm cannot send a second request.
  const sending = useRef(false);
  const valid = revocableKeys(keys);
  const resetBlocked = resetUnavailable(keys, credential, summary);

  function ask(kind: Kind) {
    setReason('');
    setAsking(kind);
  }
  async function act(kind: Kind, why: string) {
    if (sending.current) return;
    sending.current = true;
    // One key per confirmation: a repeat of this request is answered 409 DUPLICATE_REQUEST, never acted twice.
    const action = { reason: why, idempotencyKey: idempotencyKey() };
    setBusy(kind);
    try {
      const result = kind === 'revoke' ? keyActionOutcome('revoke', await revokeNodeKeys(nodeId, action)) : keyActionOutcome('reset', await resetNodeKeys(nodeId, action));
      setOutcome(result);
      toast.success(result.title, result.detail);
    } catch (error) {
      toast.error(kind === 'revoke' ? 'The keys could not be revoked' : 'The credentials could not be reset', keyActionErrorMessage(error, kind));
    } finally {
      sending.current = false;
      setBusy(null);
      onChanged();
    }
  }

  return (
    <div className="grid gap-2">
      <p className="m-0 font-medium">Keys</p>
      <DataTable label="Keys of this node" columns={KEY_COLUMNS} rows={keys} rowKey={(key) => key.keyId} empty="This node has no key: it uses the shared secret." />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="danger" icon={<Ban className="size-4" />} disabled={valid.length === 0 || busy !== null} loading={busy === 'revoke'} title={valid.length === 0 ? 'No valid key is left to revoke.' : undefined} onClick={() => ask('revoke')}>Revoke</Button>
        <Button size="sm" variant="warning" icon={<RotateCcw className="size-4" />} disabled={resetBlocked !== null || busy !== null} loading={busy === 'reset'} title={resetBlocked ?? undefined} onClick={() => ask('reset')}>Reset</Button>
        {resetBlocked && summary?.mode === 'enforce' ? <span className="text-xs text-text-muted">{resetBlocked}</span> : null}
      </div>
      {outcome ? (
        <div role="status" className="grid gap-1 rounded-control border border-border px-3 py-2">
          <p className="m-0 flex flex-wrap items-center gap-2 font-semibold"><Badge tone={outcome.tone}>done</Badge>{outcome.title}</p>
          <p className="m-0 text-text-muted">{outcome.detail}</p>
        </div>
      ) : null}
      <ActionConfirm
        open={asking !== null}
        title={asking === 'revoke' ? 'Revoke this node’s keys?' : 'Reset this node’s credentials?'}
        message={asking === 'revoke' ? revokeMessage(nodeName, keys) : asking === 'reset' ? resetMessage(nodeName, keys.length, summary?.legacyUpgrade ?? null, formatTime) : ''}
        confirmLabel={asking === 'revoke' ? 'Revoke' : 'Reset'}
        tone={asking === 'revoke' ? 'danger' : 'warning'}
        onConfirm={() => {
          const kind = asking;
          setAsking(null);
          if (kind) void act(kind, reason);
        }}
        onCancel={() => setAsking(null)}
      >
        <ReasonField value={reason} onChange={setReason} />
      </ActionConfirm>
    </div>
  );
}
