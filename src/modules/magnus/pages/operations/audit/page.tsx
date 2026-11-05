import { useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight, FileText, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react';
import { auditDaysResponseSchema, auditListResponseSchema } from '@contracts/magnus/browser';
import type { z } from 'zod';
import { Badge, Button, Drawer, EmptyState, PageHeader, Select, TableFrame } from '@ui';
import { formatTime } from '@lib/format';
import { cn } from '@lib/cn';
import { magnus } from '../../../api/client';
import { useMagnusResource } from '../../../api/use-resource';
import { FxPanel, GLOW_TEXT, HaloDot, PageItem, TONE_TEXT } from '../../../effects';
import { LoadingRows, ResourceError } from '../../../ui/resource-state';
import { Fact } from '../shared/parts';
import { actionTone, dayOptions, detailText, integrityTone, parseDetails, todayKey } from './audit-model';

type AuditRow = z.output<typeof auditListResponseSchema>['data'][number];
const PAGE_SIZE = 200;

export default function AuditPage() {
  const today = todayKey();
  const [day, setDay] = useState(today);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AuditRow | null>(null);
  const days = useMagnusResource((signal) => magnus.get('/audit/days', auditDaysResponseSchema, { signal }));
  const events = useMagnusResource((signal) => magnus.get('/audit', auditListResponseSchema, { query: { pageSize: PAGE_SIZE, page, date: day }, signal }), [day, page]);
  const rows = events.data?.data;
  const meta = events.data?.meta;
  const verification = meta?.verification;
  const state = verification?.state ?? 'unverified';
  const tone = integrityTone(state);
  const details = selected ? parseDetails(selected.details) : {};
  const options = dayOptions(days.data?.data ?? [], today).map((value) => ({ value, label: value === today ? `Today (${value})` : value }));
  const refresh = () => {
    void days.refresh();
    void events.refresh();
  };
  return (
    <div className="page-stack">
      <PageItem>
        <PageHeader
          title="Audit Log"
          eyebrow="Operations"
          icon={<ShieldCheck className="size-5" />}
          description="Fleet actions with verified or explicitly partial legacy integrity"
          actions={
            <>
              <label className="flex items-center gap-2">
                <Calendar aria-hidden="true" className="size-4 text-accent" />
                <span className="sr-only">Day</span>
                <Select value={day} onChange={(value) => { setDay(value); setPage(1); }} options={options} />
              </label>
              <Button size="sm" icon={<RefreshCw className="size-4" />} loading={events.refreshing} onClick={refresh}>Refresh</Button>
            </>
          }
        />
      </PageItem>
      <PageItem>
        <FxPanel padding="sm" fxTone={tone === 'danger' ? 'danger' : tone === 'warning' ? 'warning' : tone === 'success' ? 'success' : 'accent'} interactive={false} aria-label="Chain integrity">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <p role="status" className={cn('m-0 flex items-center gap-2 text-lg font-bold', TONE_TEXT[tone], GLOW_TEXT[tone], state === 'invalid' && 'fx-glitch')}>
              {tone === 'neutral' ? <ShieldAlert className="size-4" /> : <HaloDot tone={tone === 'danger' ? 'danger' : tone === 'warning' ? 'warning' : 'success'} active={tone === 'danger'} />}
              Chain: {state}
            </p>
            {verification ? (
              <p className="num m-0 text-sm text-text-muted">
                {verification.totalEntries} entries · {verification.legacyEntries} legacy
                {verification.brokenAtIndex >= 0 ? <span className="text-danger"> · broken at entry {verification.brokenAtIndex}</span> : null}
              </p>
            ) : null}
            <p className="m-0 basis-full text-sm text-text-muted">Legacy partial signatures do not protect targets, details, actor type or IP address.</p>
          </div>
        </FxPanel>
      </PageItem>
      <PageItem>
        <FxPanel padding={rows && rows.length > 0 ? 'none' : 'md'} interactive={false}>
          {!rows ? (
            events.loading ? <LoadingRows rows={8} /> : <ResourceError error={events.error} title="The audit trail could not be loaded" onRetry={() => void events.refresh()} />
          ) : rows.length === 0 ? (
            <EmptyState icon={<FileText className="size-5" />} title={`No audit events for ${day}`} />
          ) : (
            <TableFrame label="Audit events" className="max-h-[70vh]">
              <table>
                <thead>
                  <tr>{['Timestamp', 'Action', 'Actor', 'Target', 'Integrity', 'Details'].map((heading) => <th key={heading}>{heading}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.map((event) => (
                    <tr key={event.id} className="fx-rail cursor-pointer" onClick={() => setSelected(event)}>
                      <td className="num whitespace-nowrap text-text-muted">
                        {/* The row is the mouse target. This is the same action for the keyboard. */}
                        <button type="button" className="cursor-pointer whitespace-nowrap text-accent underline-offset-2 hover:underline" onClick={(click) => { click.stopPropagation(); setSelected(event); }}>{formatTime(event.timestamp)}</button>
                      </td>
                      <td><Badge tone={actionTone(event.action)}>{event.action}</Badge></td>
                      <td className="whitespace-nowrap text-text-muted" title={event.actorId}><span className="font-mono">{event.actorId.slice(0, 10)}…</span> <span className="text-xs">({event.actorType})</span></td>
                      <td className="whitespace-nowrap text-text-muted" title={`${event.targetType}:${event.targetId}`}>{event.targetType}:{event.targetId.slice(0, 10)}</td>
                      <td><Badge tone={integrityTone(event.verificationState)}>{event.verificationState}</Badge></td>
                      <td className="max-w-[12.5rem] truncate text-text-muted">{JSON.stringify(parseDetails(event.details))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableFrame>
          )}
          {meta && (page > 1 || meta.hasMore) ? (
            <div className="flex items-center justify-center gap-2 p-3">
              <Button size="sm" icon={<ChevronLeft className="size-4" />} disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
              <span className="num text-sm text-text-muted">Page {page} · {meta.total} events</span>
              <Button size="sm" icon={<ChevronRight className="size-4" />} disabled={!meta.hasMore} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          ) : null}
        </FxPanel>
      </PageItem>
      <Drawer open={!!selected} title="Audit event" {...(selected ? { eyebrow: selected.action } : {})} onClose={() => setSelected(null)} footer={<Button size="sm" onClick={() => setSelected(null)}>Close</Button>}>
        {selected ? (
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Fact label="Action"><Badge tone={actionTone(selected.action)}>{selected.action}</Badge></Fact>
              <Fact label="Timestamp"><span className="num">{formatTime(selected.timestamp)}</span></Fact>
              <Fact label="Actor"><span className="break-all font-mono">{selected.actorId}</span><span className="block text-xs text-text-muted">{selected.actorType}</span></Fact>
              <Fact label="Target"><span className="break-all font-mono">{selected.targetId}</span><span className="block text-xs text-text-muted">{selected.targetType}</span></Fact>
              <Fact label="Integrity"><Badge tone={integrityTone(selected.verificationState)}>{selected.verificationState}</Badge></Fact>
              {selected.ipAddress ? <Fact label="IP address"><span className="font-mono">{selected.ipAddress}</span></Fact> : null}
            </div>
            <Fact label="Event ID"><span className="break-all font-mono text-text-muted">{selected.id}</span></Fact>
            <div>
              <p className="m-0 mb-2 text-xs font-medium text-text-muted">Details</p>
              {Object.keys(details).length === 0 ? (
                <p className="m-0 text-sm text-text-muted">No additional details</p>
              ) : (
                <dl className="m-0 grid gap-2 rounded-control border border-border bg-surface-sunken p-3">
                  {Object.entries(details).map(([key, value]) => (
                    <div key={key} className="flex flex-wrap items-start gap-x-2">
                      <dt className="min-w-[6.25rem] shrink-0 text-sm font-semibold text-accent">{key}</dt>
                      <dd className="m-0 min-w-0 whitespace-pre-wrap break-all text-sm text-text-muted">{detailText(value)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
