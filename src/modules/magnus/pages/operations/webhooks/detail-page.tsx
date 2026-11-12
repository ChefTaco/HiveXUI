import { useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, Compass, Play, RotateCcw } from 'lucide-react';
import { Badge, Button, EmptyState, PageHeader, LoadingRows, ResourceError } from '@ui';
import { formatTime } from '@lib/format';
import { cn } from '@lib/cn';
import { useToast } from '../../../../../components/toast';
import { magnus, segment } from '../../../api/client';
import { errorMessage, MagnusApiError } from '../../../api/errors';
import { useMagnusResource } from '../../../api/use-resource';
import { FxPanel, PageItem } from '../../../effects';
import Link, { useParams } from '../../../navigation';
import { postKeepingBody } from '../shared/request';
import { webhookDeliveriesResponseSchema, webhookRedeliverResponseSchema, webhookResponseSchema, webhookTestResponseSchema } from './schemas';
import { WebhookForm } from './webhook-form';
import { DELIVERIES_PER_PAGE, deliveryTone, pageCount, prettyPayload } from './webhook-model';

const Back = () => <Link href="/webhooks" className="inline-flex items-center gap-1 text-sm"><ArrowLeft className="size-4" />Back to webhooks</Link>;

function NewWebhook() {
  return (
    <div className="page-stack">
      <PageItem><Back /></PageItem>
      <PageItem><PageHeader title="New webhook" eyebrow="Operations" description="Configure a new endpoint to receive event notifications" /></PageItem>
      <PageItem><FxPanel interactive={false}><WebhookForm /></FxPanel></PageItem>
    </div>
  );
}

function WebhookDetail({ id }: { id: string }) {
  const toast = useToast();
  const [tab, setTab] = useState<'edit' | 'deliveries'>('edit');
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [redelivering, setRedelivering] = useState<string | null>(null);
  const endpoint = useMagnusResource((signal) => magnus.get(`/webhooks/${segment(id)}`, webhookResponseSchema, { signal }), [id]);
  const deliveries = useMagnusResource((signal) => magnus.get(`/webhooks/${segment(id)}/deliveries`, webhookDeliveriesResponseSchema, { query: { page, pageSize: DELIVERIES_PER_PAGE }, signal }), [id, page]);
  const row = endpoint.data?.data.endpoint;
  const list = deliveries.data?.data.deliveries;
  const total = deliveries.data?.data.total ?? 0;
  const pages = pageCount(total);
  async function test() {
    setTesting(true);
    try {
      const { data } = await postKeepingBody(`/webhooks/${segment(id)}/test`, webhookTestResponseSchema);
      if (data.success) toast.success('Test webhook sent');
      else toast.error('Test failed', data.error ?? 'Unknown error');
      await deliveries.refresh();
    } catch (error) {
      toast.error('Test failed', errorMessage(error));
    } finally {
      setTesting(false);
    }
  }
  async function redeliver(deliveryId: string) {
    setRedelivering(deliveryId);
    try {
      await magnus.post(`/webhooks/${segment(id)}/deliveries/${segment(deliveryId)}/redeliver`, webhookRedeliverResponseSchema);
      await deliveries.refresh();
    } catch (error) {
      toast.error('Redelivery failed', errorMessage(error));
    } finally {
      setRedelivering(null);
    }
  }
  if (!row) {
    return (
      <div className="page-stack">
        <PageItem><Back /></PageItem>
        <PageItem>
          <FxPanel interactive={false}>
            {endpoint.loading ? (
              <LoadingRows rows={6} />
            ) : endpoint.error instanceof MagnusApiError && endpoint.error.notFound ? (
              <EmptyState icon={<Compass className="size-5" />} title={<span className="fx-glitch inline-block">Webhook not found</span>} message="This endpoint does not exist. It may have been deleted." />
            ) : (
              <ResourceError error={endpoint.error} title="This webhook could not be loaded" onRetry={() => void endpoint.refresh()} />
            )}
          </FxPanel>
        </PageItem>
      </div>
    );
  }
  return (
    <div className="page-stack">
      <PageItem><Back /></PageItem>
      <PageItem>
        <PageHeader
          title={row.name}
          eyebrow="Webhook"
          status={<Badge tone={row.active ? 'success' : 'neutral'} dot>{row.active ? 'Active' : 'Inactive'}</Badge>}
          description={<span className="font-mono">{row.url}</span>}
          actions={<Button size="sm" variant="primary" icon={<Play className="size-4" />} loading={testing} onClick={() => void test()}>{testing ? 'Sending…' : 'Send test'}</Button>}
        />
      </PageItem>
      <PageItem>
        <div className="tabs" role="tablist" aria-label="Webhook">
          <button type="button" role="tab" aria-selected={tab === 'edit'} className={cn('tab', tab === 'edit' && 'tab--active')} onClick={() => setTab('edit')}>Configuration</button>
          <button type="button" role="tab" aria-selected={tab === 'deliveries'} className={cn('tab', tab === 'deliveries' && 'tab--active')} onClick={() => { setTab('deliveries'); void deliveries.refresh(); }}>Deliveries<span className="tab-count">{total}</span></button>
        </div>
      </PageItem>
      {tab === 'edit' ? (
        <PageItem><FxPanel interactive={false}><WebhookForm key={row.updatedAt} endpoint={row} /></FxPanel></PageItem>
      ) : !list ? (
        <PageItem><FxPanel interactive={false}>{deliveries.loading ? <LoadingRows /> : <ResourceError error={deliveries.error} title="Deliveries could not be loaded" onRetry={() => void deliveries.refresh()} />}</FxPanel></PageItem>
      ) : list.length === 0 ? (
        <PageItem><FxPanel interactive={false}><EmptyState title="No deliveries yet" message="Send a test event to see delivery results." /></FxPanel></PageItem>
      ) : (
        <PageItem>
          <div className="grid gap-2">
            {list.map((delivery) => {
              const open = expanded === delivery.id;
              return (
                <FxPanel key={`${delivery.id}-${delivery.status}`} padding="none" fxTone={delivery.status === 'failed' ? 'danger' : 'accent'} className="scan-sweep">
                  <button type="button" aria-expanded={open} onClick={() => setExpanded(open ? null : delivery.id)} className="flex w-full cursor-pointer flex-wrap items-center gap-3 p-3 text-left">
                    {open ? <ChevronDown aria-hidden="true" className="size-4 text-text-muted" /> : <ChevronRight aria-hidden="true" className="size-4 text-text-muted" />}
                    <Badge tone={deliveryTone(delivery.status)}>{delivery.status}</Badge>
                    <code className="text-sm text-accent">{delivery.event}</code>
                    {delivery.httpStatus ? <span className="num text-sm text-text-muted">HTTP {delivery.httpStatus}</span> : null}
                    <span className="num ml-auto text-sm text-text-muted">{delivery.attempts} attempt{delivery.attempts === 1 ? '' : 's'}</span>
                    <span className="num text-sm text-text-muted">{formatTime(delivery.createdAt)}</span>
                  </button>
                  {open ? (
                    <div className="grid gap-3 border-t border-border p-3">
                      <div>
                        <p className="m-0 mb-1 text-xs font-medium text-text-muted">Payload</p>
                        <pre className="code-block m-0 max-h-48">{prettyPayload(delivery.payload)}</pre>
                      </div>
                      {delivery.response ? (
                        <div>
                          <p className="m-0 mb-1 text-xs font-medium text-text-muted">Response</p>
                          <pre className="code-block m-0 max-h-32">{delivery.response}</pre>
                        </div>
                      ) : null}
                      {delivery.error ? (
                        <div>
                          <p className="m-0 mb-1 text-xs font-medium text-danger">Error</p>
                          <pre className="code-block m-0 text-danger">{delivery.error}</pre>
                        </div>
                      ) : null}
                      {delivery.status === 'failed' ? (
                        <div><Button size="sm" icon={<RotateCcw className="size-4" />} loading={redelivering === delivery.id} onClick={() => void redeliver(delivery.id)}>{redelivering === delivery.id ? 'Redelivering…' : 'Redeliver'}</Button></div>
                      ) : null}
                    </div>
                  ) : null}
                </FxPanel>
              );
            })}
            {pages > 1 ? (
              <div className="flex items-center justify-center gap-2 pt-2">
                <Button size="sm" icon={<ChevronLeft className="size-4" />} disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
                <span className="num text-sm text-text-muted">Page {page} of {pages}</span>
                <Button size="sm" icon={<ChevronRight className="size-4" />} disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
              </div>
            ) : null}
          </div>
        </PageItem>
      )}
    </div>
  );
}

/** One route serves /webhooks/new and /webhooks/:id: a literal route would need its own sidebar entry. */
export default function WebhookRoutePage() {
  const { id } = useParams<{ id: string }>();
  return id === 'new' ? <NewWebhook /> : <WebhookDetail id={id} />;
}
