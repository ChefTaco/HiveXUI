import { useState, type ReactNode } from 'react';
import { Check, X } from 'lucide-react';
import { Badge, Button, DataTable, type DataTableColumn } from '@ui';
import { formatTime, relativeTime } from '@lib/format';
import { useToast } from '../../../../../components/toast';
import { segment } from '../../../api/client';
import Link from '../../../navigation';
import { hasRoute } from '../../../routes';
import { ActionConfirm } from '../../../ui/action-confirm';
import { approvePendingBinding, decisionErrorMessage, rejectPendingBinding, type PendingBinding } from './api';
import { approvalMessage, bindingIsStale, rejectionMessage } from './model';

interface Decision {
  binding: PendingBinding;
  kind: 'approve' | 'reject';
}

/**
 * Approve or reject a pending binding behind the shared confirmation, never the browser's confirm(). The
 * caller renders `dialog` once and refreshes what it shows in `onDecided`.
 */
export function usePendingBindingDecisions(onDecided: () => void): { ask: (binding: PendingBinding, kind: Decision['kind']) => void; busyId: string | null; dialog: ReactNode } {
  const toast = useToast();
  const [asking, setAsking] = useState<Decision | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  async function decide({ binding, kind }: Decision) {
    setBusyId(binding.id);
    const node = binding.nodeName ?? binding.nodeId;
    try {
      if (kind === 'approve') {
        await approvePendingBinding(binding.id);
        toast.success(`Key bound to ${node}`, `Fingerprint ${binding.keyFingerprint}. The agent learns it on its next attempt.`);
      } else {
        await rejectPendingBinding(binding.id);
        toast.success(`Key refused for ${node}`, 'The node stays on the shared secret.');
      }
    } catch (error) {
      toast.error(kind === 'approve' ? 'The binding could not be approved' : 'The binding could not be rejected', decisionErrorMessage(error));
    } finally {
      setBusyId(null);
      onDecided();
    }
  }
  const dialog = (
    <ActionConfirm
      open={asking !== null}
      title={asking?.kind === 'approve' ? 'Approve this key binding?' : 'Reject this key binding?'}
      message={asking ? (asking.kind === 'approve' ? approvalMessage(asking.binding) : rejectionMessage(asking.binding)) : ''}
      confirmLabel={asking?.kind === 'approve' ? 'Approve' : 'Reject'}
      tone={asking?.kind === 'approve' ? 'primary' : 'danger'}
      onConfirm={() => {
        const decision = asking;
        setAsking(null);
        if (decision) void decide(decision);
      }}
      onCancel={() => setAsking(null)}
    />
  );
  return { ask: (binding, kind) => setAsking({ binding, kind }), busyId, dialog };
}

function NodeName({ binding }: { binding: PendingBinding }) {
  const name = binding.nodeName ?? binding.nodeId;
  return hasRoute(`/nodes/${binding.nodeId}`) ? <Link href={`/nodes/${segment(binding.nodeId)}`} className="font-medium">{name}</Link> : <span className="font-medium">{name}</span>;
}

/** The waiting bindings with what an administrator needs to judge each host. Decisions only for `canDecide`. */
export function PendingBindingsTable({ bindings, canDecide, onDecided, showNode = true }: { bindings: readonly PendingBinding[]; canDecide: boolean; onDecided: () => void; showNode?: boolean }) {
  const { ask, busyId, dialog } = usePendingBindingDecisions(onDecided);
  const columns: Array<DataTableColumn<PendingBinding>> = [
    ...(showNode ? [{ key: 'node', header: 'Node', cell: (binding: PendingBinding) => <NodeName binding={binding} /> }] : []),
    { key: 'fingerprint', header: 'Key fingerprint', className: 'cell-mono', cell: (binding) => <span className="num break-all">{binding.keyFingerprint}</span> },
    { key: 'fqdn', header: 'Host name it claims', cell: (binding) => <span className="break-all">{binding.fqdn}</span> },
    { key: 'peer', header: 'Called from', className: 'cell-mono', cell: (binding) => <span className="num break-all">{binding.peerAddress}</span> },
    { key: 'recorded', header: 'Recorded address', className: 'cell-mono', cell: (binding) => <span className="num break-all">{binding.recordedAddress}</span> },
    {
      key: 'seen',
      header: 'Last asked',
      cell: (binding) => (
        <span className="grid gap-1">
          <span className="num whitespace-nowrap text-text-muted" title={`First asked ${formatTime(binding.createdAt)}; ${binding.attempts} attempt${binding.attempts === 1 ? '' : 's'}`}>{relativeTime(binding.lastSeenAt)}</span>
          {bindingIsStale(binding) ? <Badge tone="warning">quiet for 7 days</Badge> : null}
        </span>
      ),
    },
    ...(canDecide
      ? [{
          key: 'actions',
          header: <span className="sr-only">Decision</span>,
          cell: (binding: PendingBinding) => (
            <div className="flex gap-1">
              <Button size="sm" variant="primary" icon={<Check className="size-4" />} disabled={bindingIsStale(binding) || busyId !== null} loading={busyId === binding.id} title={bindingIsStale(binding) ? 'Magnus refuses approval after seven days without a request: enroll the node with a token.' : undefined} onClick={() => ask(binding, 'approve')} aria-label={`Approve the key for ${binding.nodeName ?? binding.nodeId}`}>Approve</Button>
              <Button size="sm" variant="danger" icon={<X className="size-4" />} disabled={busyId !== null} onClick={() => ask(binding, 'reject')} aria-label={`Reject the key for ${binding.nodeName ?? binding.nodeId}`}>Reject</Button>
            </div>
          ),
        }]
      : []),
  ];
  return (
    <>
      <DataTable label="Pending key bindings" columns={columns} rows={bindings} rowKey={(binding) => binding.id} empty="No bindings are waiting." />
      {dialog}
    </>
  );
}
