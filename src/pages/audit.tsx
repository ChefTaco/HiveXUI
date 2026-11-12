import { useState } from 'react';
import { useStore } from '../lib/store';
import type { AuditEvent } from '../lib/types';
import { formatTime, relativeTime } from '../lib/format';
import { Badge, Button, Drawer, EmptyState, JsonBlock, Panel, PageHeader, TableFrame } from '../components/ui';
import { Icon } from '../components/icons';

export function AuditPage() {
  const { data, refresh, refreshing } = useStore();
  const [selected, setSelected] = useState<AuditEvent | null>(null);

  return (
    <>
      <PageHeader
        title="Routing audit"
        description="Every administrative mutation, attributed and timestamped."
        actions={<Button variant="ghost" icon={<Icon.Refresh className="btn-ico" />} loading={refreshing} onClick={() => void refresh()}>
          Refresh
        </Button>}
      />

      <Panel title="Events" eyebrow={`${data.audit.length} records`}>
        {data.audit.length === 0 ? (
          <EmptyState icon={<Icon.Scroll width={34} height={34} />} message="No audit events recorded." />
        ) : (
          <TableFrame label="Model audit events">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Action</th>
                  <th>Entity</th>
                  <th>Actor</th>
                  <th>Type</th>
                </tr>
              </thead>
              <tbody>
                {data.audit.map((event) => (
                  <tr key={event.id} className="row-clickable" onClick={() => setSelected(event)}>
                    <td className="cell-mono" title={formatTime(event.createdAt)}>
                      {relativeTime(event.createdAt)}
                    </td>
                    <td className="cell-strong">{event.action}</td>
                    <td className="cell-mono">
                      {event.entityType ?? '—'}
                      {event.entityId ? <span className="cell-mono"> · {event.entityId.slice(0, 8)}</span> : null}
                    </td>
                    <td className="cell-mono">{event.adminUser?.username ?? '—'}</td>
                    <td>
                      <Badge tone={event.actorType === 'admin' ? 'accent' : 'neutral'}>{event.actorType}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableFrame>
        )}
      </Panel>

      <Drawer
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        eyebrow="Audit event"
        title={selected?.action ?? ''}
        footer={
          <Button variant="ghost" onClick={() => setSelected(null)}>
            Close
          </Button>
        }
      >
        {selected ? (
          <>
            <div className="kv-list">
              <div className="kv-row">
                <span>Actor</span>
                <span className="cell-mono">{selected.adminUser?.username ?? selected.actorType}</span>
              </div>
              <div className="kv-row">
                <span>Entity</span>
                <span className="cell-mono">{selected.entityType ?? '—'}</span>
              </div>
              <div className="kv-row">
                <span>Entity ID</span>
                <span className="cell-mono">{selected.entityId ?? '—'}</span>
              </div>
              <div className="kv-row">
                <span>When</span>
                <span className="cell-mono">{formatTime(selected.createdAt)}</span>
              </div>
            </div>
            {selected.metadataJson ? (
              <>
                <p className="panel-eyebrow mt-5">
                  Metadata
                </p>
                <JsonBlock value={selected.metadataJson} />
              </>
            ) : null}
          </>
        ) : null}
      </Drawer>
    </>
  );
}
