import { Archive, Database, RefreshCw } from 'lucide-react';
import { retentionSummaryResponseSchema } from '@contracts/magnus/browser';
import { Badge, Button, PageHeader } from '@ui';
import { magnus } from '../../../api/client';
import { useMagnusResource } from '../../../api/use-resource';
import { FxPanel, PageItem } from '../../../effects';
import { manualTables } from './retention-model';
import { RetentionPanel } from './retention-panel';

// The summary counts every table on each request, so it is read once and on Refresh, not polled.
export default function RetentionPage() {
  const retention = useMagnusResource((signal) => magnus.get('/ops/retention', retentionSummaryResponseSchema, { signal }));
  const manual = retention.data ? manualTables(retention.data.data.tables) : [];
  return (
    <div className="page-stack" data-testid="retention-page">
      <PageItem>
        <PageHeader
          title="Retention"
          eyebrow="Operations"
          icon={<Database className="size-5" />}
          description="Operational data volume, oldest rows and purge-policy visibility."
          actions={<Button size="sm" icon={<RefreshCw className="size-4" />} loading={retention.refreshing} onClick={() => void retention.refresh()}>Refresh</Button>}
        />
      </PageItem>
      <PageItem><RetentionPanel resource={retention} /></PageItem>
      {manual.length > 0 ? (
        <PageItem>
          <FxPanel
            fxTone="warning"
            interactive={false}
            title={<span className="flex items-center gap-2"><Archive className="size-4 text-warning" />Kept until reviewed</span>}
            description="Nothing purges these tables automatically. They grow until someone removes old rows."
          >
            <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
              {manual.map((table) => <li key={table.name}><Badge tone="warning">{table.name} <span className="num">{table.count.toLocaleString()}</span></Badge></li>)}
            </ul>
          </FxPanel>
        </PageItem>
      ) : null}
    </div>
  );
}
