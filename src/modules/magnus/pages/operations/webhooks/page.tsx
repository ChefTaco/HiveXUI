import { useState } from 'react';
import { Play, Plus, Trash2, Webhook } from 'lucide-react';
import { Badge, Button, ConfirmDialog, EmptyState, IconButton, PageHeader, Toggle, LoadingRows, ResourceError, buttonClass } from '@ui';
import { useToast } from '../../../../../components/toast';
import { magnus, segment } from '../../../api/client';
import { errorMessage } from '../../../api/errors';
import { useMagnusResource } from '../../../api/use-resource';
import { FxPanel, PageItem } from '../../../effects';
import Link from '../../../navigation';
import { postKeepingBody } from '../shared/request';
import { webhookDeleteResponseSchema, webhookListResponseSchema, webhookResponseSchema, webhookTestResponseSchema, type WebhookEndpoint } from './schemas';
import { eventsLabel } from './webhook-model';

export default function WebhooksPage() {
  const toast = useToast();
  const endpoints = useMagnusResource((signal) => magnus.get('/webhooks', webhookListResponseSchema, { signal }));
  const [deleting, setDeleting] = useState<WebhookEndpoint | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const list = endpoints.data?.data.endpoints;
  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await magnus.delete(`/webhooks/${segment(deleting.id)}`, webhookDeleteResponseSchema);
      toast.success(`${deleting.name} deleted`);
      setDeleting(null);
      await endpoints.refresh();
    } catch (error) {
      toast.error('The webhook could not be deleted', errorMessage(error));
    } finally {
      setDeleteBusy(false);
    }
  }
  async function toggle(endpoint: WebhookEndpoint) {
    setBusyId(endpoint.id);
    try {
      await magnus.patch(`/webhooks/${segment(endpoint.id)}`, webhookResponseSchema, { body: { active: !endpoint.active } });
      await endpoints.refresh();
    } catch (error) {
      toast.error('The webhook could not be changed', errorMessage(error));
    } finally {
      setBusyId(null);
    }
  }
  async function test(endpoint: WebhookEndpoint) {
    setBusyId(endpoint.id);
    try {
      const { data } = await postKeepingBody(`/webhooks/${segment(endpoint.id)}/test`, webhookTestResponseSchema);
      if (data.success) toast.success('Test webhook sent');
      else toast.error('Test failed', data.error ?? 'Unknown error');
    } catch (error) {
      toast.error('Test failed', errorMessage(error));
    } finally {
      setBusyId(null);
    }
  }
  return (
    <div className="page-stack">
      <PageItem>
        <PageHeader
          title="Webhooks"
          eyebrow="Operations"
          icon={<Webhook className="size-5" />}
          description="Manage webhook endpoints for event notifications"
          actions={<Link href="/webhooks/new" className={buttonClass({ variant: 'primary', size: 'sm' })}><Plus className="size-4" />New webhook</Link>}
        />
      </PageItem>
      {!list ? (
        <PageItem>
          <FxPanel interactive={false}>
            {endpoints.loading ? <LoadingRows /> : <ResourceError error={endpoints.error} title="Webhooks could not be loaded" onRetry={() => void endpoints.refresh()} />}
          </FxPanel>
        </PageItem>
      ) : list.length === 0 ? (
        <PageItem>
          <FxPanel interactive={false}>
            <EmptyState icon={<Webhook className="size-5" />} title="No webhook endpoints configured" message="Create an endpoint to receive event notifications." />
          </FxPanel>
        </PageItem>
      ) : (
        list.map((endpoint) => (
          <PageItem key={endpoint.id}>
            <FxPanel padding="sm" fxTone={endpoint.active ? 'accent' : 'warning'}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 flex-wrap items-center gap-3">
                  <Webhook aria-hidden="true" className="size-4 text-accent" />
                  <Link href={`/webhooks/${segment(endpoint.id)}`} className="text-sm font-semibold">{endpoint.name}</Link>
                  <Badge tone={endpoint.active ? 'success' : 'neutral'} dot>{endpoint.active ? 'Active' : 'Inactive'}</Badge>
                  <Badge>{endpoint.type}</Badge>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" icon={<Play className="size-4" />} disabled={busyId === endpoint.id} title="Send test event" onClick={() => void test(endpoint)}>Test</Button>
                  <Toggle checked={endpoint.active} disabled={busyId === endpoint.id} onChange={() => void toggle(endpoint)} label={endpoint.active ? 'Enabled' : 'Disabled'} />
                  <IconButton label={`Delete ${endpoint.name}`} variant="danger" icon={<Trash2 className="size-4" />} onClick={() => setDeleting(endpoint)} />
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-text-muted">
                <span className="min-w-0 truncate font-mono">{endpoint.url}</span>
                <span className="num">{endpoint._count?.deliveries ?? 0} deliveries</span>
                <span className="min-w-0 break-words">{eventsLabel(endpoint.events)}</span>
              </div>
            </FxPanel>
          </PageItem>
        ))
      )}
      <ConfirmDialog
        open={!!deleting}
        title="Delete webhook"
        message="Delete this webhook endpoint?"
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleting(null)}
        loading={deleteBusy}
      />
    </div>
  );
}
