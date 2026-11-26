import { Badge, Pagination, Panel, StatCard } from '../../components/ui';
import { formatTime } from '../../lib/format';
import { safeDetail, EntityTable, shownRange } from './shared';
import { AUDIT_PAGE_SIZE, type IamOps } from './use-iam-operations';

export function AuditSection({ ops }: { ops: IamOps }) {
  const {
    auditStats,
    auditEvents,
    auditTotal,
    auditPage,
    showAuditPage,
    pageLoading,
  } = ops;
  return (
    <>
      <div className="stats-grid">
        <StatCard
          label="Total Events"
          value={auditStats?.totalEvents ?? 0}
          sub="last 30 days"
          tone="accent"
        />
        <StatCard
          label="Successful"
          value={auditStats?.successCount ?? 0}
          sub="authorized actions"
          tone="accent"
        />
        <StatCard
          label="Failures"
          value={auditStats?.failureCount ?? 0}
          sub="failed auth"
          tone="danger"
        />
        <StatCard
          label="Denied"
          value={auditStats?.deniedCount ?? 0}
          sub="policy blocks"
          tone="accent"
        />
      </div>
      <Panel title="Audit events" eyebrow={shownRange(auditPage, AUDIT_PAGE_SIZE, auditEvents.length, auditTotal, 'events')}>
        <EntityTable
          label="Identity audit events"
          empty="No audit events found."
          headers={['Time', 'Event', 'Actor', 'Outcome', 'Detail']}
        >
          {auditEvents.map((event) => (
            <tr key={event.id}>
              <td className="cell-mono">{formatTime(event.timestamp)}</td>
              <td>
                <strong>{event.eventType}</strong>
                <span className="row-sub">
                  {event.category} / {event.action}
                </span>
              </td>
              <td>{event.actorEmail ?? event.actorId ?? event.actorType}</td>
              <td>
                <Badge
                  tone={
                    event.outcome === 'SUCCESS'
                      ? 'success'
                      : event.outcome === 'DENIED'
                        ? 'warning'
                        : 'danger'
                  }
                >
                  {event.outcome}
                </Badge>
              </td>
              <td className="cell-mono cell-long">{safeDetail(event.detail)}</td>
            </tr>
          ))}
        </EntityTable>
        {auditTotal > AUDIT_PAGE_SIZE || auditPage > 1 ? (
          <Pagination
            label="Audit pages"
            summary={shownRange(auditPage, AUDIT_PAGE_SIZE, auditEvents.length, auditTotal, 'events')}
            hasPrevious={auditPage > 1}
            hasNext={auditPage * AUDIT_PAGE_SIZE < auditTotal}
            loading={pageLoading}
            onPrevious={() => showAuditPage(auditPage - 1)}
            onNext={() => showAuditPage(auditPage + 1)}
          />
        ) : null}
      </Panel>
    </>
  );
}
