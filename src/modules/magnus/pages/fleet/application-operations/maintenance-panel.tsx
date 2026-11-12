import { useId, useState, type FormEvent } from 'react';
import type { z } from 'zod';
import { Wrench, X } from 'lucide-react';
import { maintenanceListResponseSchema, maintenanceWindowResponseSchema } from '@contracts/magnus/browser';
import { Badge, Button, EmptyState, Field, TextInput, LoadingRows, ResourceError } from '@ui';
import { cn } from '@lib/cn';
import { formatTime, relativeTime } from '@lib/format';
import { useToast } from '../../../../../components/toast';
import { magnus, segment } from '../../../api/client';
import { errorMessage } from '../../../api/errors';
import type { Resource } from '../../../api/use-resource';
import { FxPanel } from '../../../effects';
import { ActionConfirm } from '../../../ui/action-confirm';
import type { NodeRow } from '../nodes/nodes-api';
import { useSweep } from '../shared/sweep';
import { MAX_WINDOW_MINUTES, maintenanceRequest, parseIdList, windowState, type MaintenanceWindow, type WindowState } from './model';

/**
 * A node's ID, with the fleet offered as suggestions. A free field, not a select of online nodes:
 * maintenance is often for a node that is already down, and one that has left the list still matches.
 */
export function NodeIdInput({ value, onChange, nodes, label = 'Node ID' }: { value: string; onChange: (value: string) => void; nodes: readonly NodeRow[]; label?: string }) {
  const listId = useId();
  return (
    <Field label={label}>
      <TextInput value={value} onChange={onChange} list={listId} autoComplete="off" placeholder="Node ID" required />
      <datalist id={listId}>{nodes.map((node) => <option key={node.id} value={node.id} label={`${node.name} (${node.status})`} />)}</datalist>
    </Field>
  );
}

const STATE_LABEL: Record<WindowState, { label: string; tone: 'warning' | 'neutral' | 'info' }> = {
  active: { label: 'Active', tone: 'warning' },
  scheduled: { label: 'Scheduled', tone: 'info' },
  expired: { label: 'Expired', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

export function MaintenancePanel({ resource, nodes, canWrite }: { resource: Resource<z.output<typeof maintenanceListResponseSchema>>; nodes: readonly NodeRow[]; canWrite: boolean }) {
  const toast = useToast();
  const sweep = useSweep();
  const [nodeId, setNodeId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [reason, setReason] = useState('');
  const [minutes, setMinutes] = useState('60');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState('');
  const [cancelling, setCancelling] = useState('');
  const [confirmingCancel, setConfirmingCancel] = useState<MaintenanceWindow | null>(null);
  async function create(event: FormEvent) {
    event.preventDefault();
    const request = maintenanceRequest({ nodeId, serviceId, reason, minutes });
    if ('error' in request) {
      setFormError(request.error);
      return;
    }
    setCreating(true);
    setFormError('');
    try {
      await magnus.post('/ops/maintenance', maintenanceWindowResponseSchema, { body: request.body });
      toast.success('Maintenance window created', `Matching pages are suppressed for ${minutes} minutes.`);
      setReason('');
      await resource.refresh();
    } catch (error) {
      setFormError(errorMessage(error, 'The window could not be created'));
    } finally {
      setCreating(false);
    }
  }
  async function cancel(window: MaintenanceWindow) {
    setConfirmingCancel(null);
    setCancelling(window.id);
    try {
      await magnus.post(`/ops/maintenance/${segment(window.id)}/cancel`, maintenanceWindowResponseSchema);
      toast.success('Maintenance window cancelled');
      await resource.refresh();
    } catch (error) {
      toast.error('The window could not be cancelled', errorMessage(error));
    } finally {
      setCancelling('');
    }
  }
  const windows = resource.data?.data;
  return (
    <FxPanel title={<span className="flex items-center gap-2"><Wrench className="size-4 text-accent" />Maintenance</span>} description="Suppress matching pages until expiry. Observations remain available." interactive={false}>
      <div className="grid gap-4">
        {canWrite ? (
          <form className="grid gap-3" onSubmit={(event) => void create(event)} aria-label="Create a maintenance window">
            <div className="form-grid">
              <NodeIdInput value={nodeId} onChange={setNodeId} nodes={nodes} />
              <Field label="Service ID" hint="Every service on the node when empty"><TextInput value={serviceId} onChange={setServiceId} maxLength={160} /></Field>
              <Field label="Reason"><TextInput value={reason} onChange={setReason} required minLength={5} maxLength={500} /></Field>
              <Field label="Minutes" hint="At most seven days"><TextInput type="number" min={1} max={MAX_WINDOW_MINUTES} value={minutes} onChange={setMinutes} required /></Field>
            </div>
            {formError ? <p role="alert" className="m-0 rounded-control border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">{formError}</p> : null}
            <div><Button type="submit" variant="primary" loading={creating}>Create maintenance window</Button></div>
          </form>
        ) : null}
        {!windows ? (
          resource.loading ? <LoadingRows rows={2} /> : <ResourceError error={resource.error} title="Maintenance windows could not be loaded" onRetry={() => void resource.refresh()} />
        ) : windows.length === 0 ? (
          <EmptyState compact icon={<Wrench className="size-4" />} title="No maintenance windows" />
        ) : (
          <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0" aria-label="Maintenance windows">
            {windows.map((window) => {
              const state = windowState(window);
              const services = parseIdList(window.serviceIds);
              return (
                <li key={`${window.id}:${state}`} className={cn(sweep, 'rounded-panel border border-border bg-surface-raised p-3')}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <strong className="min-w-0 break-words">{window.reason}</strong>
                    <Badge tone={STATE_LABEL[state].tone} dot={state === 'active'} className={state === 'active' ? 'fx-badge-pulse' : ''}>{STATE_LABEL[state].label}</Badge>
                    <span className="flex-1" />
                    {canWrite && (state === 'active' || state === 'scheduled') ? <Button size="sm" icon={<X className="size-4" />} loading={cancelling === window.id} onClick={() => setConfirmingCancel(window)}>Cancel window</Button> : null}
                  </div>
                  <p className="m-0 mt-1 break-words text-sm text-text-muted">
                    {parseIdList(window.nodeIds).join(', ')} / {services.length ? services.join(', ') : 'all services'} · {window.actorId}
                    {' · '}
                    <span title={formatTime(window.endsAt)}>{state === 'cancelled' ? `Cancelled ${relativeTime(window.cancelledAt)}` : state === 'expired' ? `Ended ${relativeTime(window.endsAt)}` : `Ends ${relativeTime(window.endsAt)}`}</span>
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <ActionConfirm open={!!confirmingCancel} title="Cancel this window?" message={confirmingCancel ? `Cancel "${confirmingCancel.reason}"? It ends now and cannot be reopened.` : ''} confirmLabel="Cancel window" onConfirm={() => { if (confirmingCancel) void cancel(confirmingCancel); }} onCancel={() => setConfirmingCancel(null)} />
    </FxPanel>
  );
}
