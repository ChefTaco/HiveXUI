import type { ReactNode } from 'react';
import type { z } from 'zod';
import { Database, HardDrive } from 'lucide-react';
import type { retentionSummaryResponseSchema } from '@contracts/magnus/browser';
import { Badge, DataTable, LoadingRows, ResourceError, type DataTableColumn } from '@ui';
import { formatTime } from '@lib/format';
import { errorMessage } from '../../../api/errors';
import type { Resource } from '../../../api/use-resource';
import { FxMeter, FxPanel } from '../../../effects';
import { Figure } from '../../fleet/shared/figure';
import { cutoffLabel, oldestState, shareOf, totalRecords, type RetentionTable } from './retention-model';

function columns(total: number): ReadonlyArray<DataTableColumn<RetentionTable>> {
  return [
    { key: 'table', header: 'Table', cell: (table) => <span className="font-semibold">{table.name}</span> },
    { key: 'rows', header: 'Rows', className: 'num text-accent', cell: (table) => table.count.toLocaleString() },
    {
      key: 'share',
      header: 'Share',
      cell: (table) => <FxMeter className="w-28" tone="accent" value={shareOf(table.count, total)} label={`${table.name} share of rows`} valueLabel={`${shareOf(table.count, total).toFixed(0)}%`} />,
    },
    {
      key: 'oldest',
      header: 'Oldest',
      className: 'text-text-muted',
      cell: (table) => {
        const state = oldestState(table);
        return state === 'dated' ? <span className="num" title={table.oldestAt ?? undefined}>{formatTime(table.oldestAt)}</span> : state === 'untracked' ? 'Not tracked' : 'None';
      },
    },
    { key: 'policy', header: 'Policy', className: 'text-text-muted', cell: (table) => table.policy },
    {
      key: 'cutoffs',
      header: 'Calculated cutoffs',
      className: 'text-xs text-text-muted',
      cell: (table) =>
        table.cutoffs && Object.keys(table.cutoffs).length > 0
          ? Object.entries(table.cutoffs).map(([name, value]) => <div key={name} title={value} className="whitespace-nowrap"><span className="font-semibold">{cutoffLabel(name)}:</span> <span className="num">{formatTime(value)}</span></div>)
          : 'None',
    },
  ];
}

/**
 * Operational data volume, oldest rows and purge policy, from GET /ops/retention. Fleet readiness shows it as
 * a panel; /retention gives it the page.
 */
export function RetentionPanel({ resource, actions }: { resource: Resource<z.output<typeof retentionSummaryResponseSchema>>; actions?: ReactNode }) {
  const data = resource.data?.data;
  const total = data ? totalRecords(data.tables) : 0;
  return (
    <FxPanel
      id="data-retention"
      title={<span className="flex items-center gap-2"><Database className="size-4 text-accent" />Data retention</span>}
      description="Operational data volume, oldest rows and purge policy."
      interactive={false}
      className="scroll-mt-4"
      {...(actions ? { actions } : {})}
    >
      {!data ? (
        resource.loading ? <LoadingRows rows={5} /> : <ResourceError error={resource.error} title="Retention data unavailable" onRetry={() => void resource.refresh()} />
      ) : (
        <div className="grid gap-4">
          {resource.error ? <p role="alert" className="m-0 text-sm text-warning">Showing the last good answer: {errorMessage(resource.error)}</p> : null}
          <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1">
            <Badge tone={data.policyStatus.status === 'pass' ? 'success' : 'warning'} dot>Policy {data.policyStatus.status}</Badge>
            <span className="text-sm text-text-muted">{data.policyStatus.message}</span>
            <span className="num text-xs text-text-muted">Calculated {formatTime(data.generatedAt)}</span>
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Figure label="Total records" value={total.toLocaleString()} icon={Database} />
            <Figure label="Tables tracked" value={data.tables.length} icon={HardDrive} tone="info" />
          </div>
          <DataTable label="Retention by table" columns={columns(total)} rows={data.tables} rowKey={(table) => table.name} rowClassName={() => 'fx-rail'} empty="No tables reported" />
        </div>
      )}
    </FxPanel>
  );
}
