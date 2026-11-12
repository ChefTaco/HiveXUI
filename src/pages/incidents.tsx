import { useState } from 'react';
import { Badge, Button, Drawer, EmptyState, JsonBlock, Panel, StatCard, PageHeader } from '../components/ui';
import { Icon } from '../components/icons';
import { useStore } from '../lib/store';
import type { HiveIncident } from '../lib/types';
import { formatTime, relativeTime } from '../lib/format';
import { productInstalled } from '../lib/runtime';

function failureSources(): string {
  const names = [
    productInstalled('emberpath') && 'model',
    productInstalled('oathweave') && 'identity',
    productInstalled('hivemem') && 'memory',
  ].filter((name) => name !== false);
  return new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(names);
}

function severityTone(severity: HiveIncident['severity']): 'warning' | 'success' | 'danger' | 'neutral' {
  if (severity === 'critical') return 'danger';
  if (severity === 'warning') return 'warning';
  if (severity === 'info') return 'success';
  return 'neutral';
}

export function IncidentsPage() {
  const { data, refresh, refreshing, loadIssues } = useStore();
  const unavailable = loadIssues.filter(issue => issue.includes('failure summary unavailable'));
  const [selected, setSelected] = useState<HiveIncident | null>(null);
  const open = data.incidents.filter((incident) => incident.status === 'open').length;
  const critical = data.incidents.filter((incident) => incident.severity === 'critical').length;
  const crossService = data.incidents.filter((incident) => incident.services.length > 1).length;

  return (
    <>
      <PageHeader
        title="Hive incidents"
        description={<>Authorized {failureSources()} failures grouped by request ID and time. Review and response stay in the owning product.</>}
        actions={<Button variant="ghost" icon={<Icon.Refresh className="btn-ico" />} loading={refreshing} onClick={() => void refresh()}>
          Refresh
        </Button>}
      />

      {unavailable.length > 0 && <p role="status">Some failure summaries are unavailable: {unavailable.join(' · ')}.</p>}

      <div className="page-grid--4">
        <StatCard label="Open" value={open} sub="needs attention" tone={open ? 'danger' : 'success'} />
        <StatCard label="Critical" value={critical} sub="hard failures" tone="danger" />
        <StatCard label="Cross-Service" value={crossService} sub="shared request IDs" tone="accent" />
        <StatCard label="Total" value={data.incidents.length} sub="recent groups" tone="accent" />
      </div>

      <Panel title="Timeline" eyebrow={`${data.incidents.length} groups`}>
        {data.incidents.length === 0 ? (
          <EmptyState icon={<Icon.Activity width={34} height={34} />} message="No recent failures in the data available to this identity." />
        ) : (
          <div className="timeline-list">
            {data.incidents.map((incident) => (
              <button className="timeline-item" key={incident.id} onClick={() => setSelected(incident)}>
                <span className={`timeline-rail timeline-rail--${incident.severity}`} />
                <span className="timeline-main">
                  <span className="timeline-title">
                    <strong>{incident.title}</strong>
                    <Badge tone={severityTone(incident.severity)} dot>{incident.severity}</Badge>
                  </span>
                  <span className="muted-line">{incident.summary}</span>
                  <span className="muted-line">
                    {incident.services.join(' + ')} · {incident.actors.join(', ') || 'system'} · {relativeTime(incident.startedAt)}
                  </span>
                </span>
                <span className="cell-mono">{incident.events.length} events</span>
              </button>
            ))}
          </div>
        )}
      </Panel>

      <Drawer
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        eyebrow="Incident"
        title={selected?.title ?? ''}
        footer={<Button variant="ghost" onClick={() => setSelected(null)}>Close</Button>}
      >
        {selected ? (
          <>
            <div className="kv-list">
              <div className="kv-row"><span>Severity</span><Badge tone={severityTone(selected.severity)}>{selected.severity}</Badge></div>
              <div className="kv-row"><span>Status</span><span>{selected.status}</span></div>
              <div className="kv-row"><span>Services</span><span>{selected.services.join(', ')}</span></div>
              <div className="kv-row"><span>Started</span><span className="cell-mono">{formatTime(selected.startedAt)}</span></div>
              <div className="kv-row"><span>Request IDs</span><span className="cell-mono">{selected.requestIds.join(', ') || 'none'}</span></div>
            </div>

            <p className="panel-eyebrow mt-5">Events</p>
            <div className="stack-list">
              {selected.events.map((event) => (
                <div className="stack-item" key={event.id}>
                  <div>
                    <strong>{event.service}: {event.title}</strong>
                    <span className="muted-line">{event.outcome ?? event.kind} · {formatTime(event.timestamp)}</span>
                  </div>
                  <Badge tone={severityTone(event.severity)}>{event.severity}</Badge>
                </div>
              ))}
            </div>

            <p className="panel-eyebrow mt-5">Raw Incident</p>
            <JsonBlock value={selected} />
          </>
        ) : null}
      </Drawer>
    </>
  );
}
