import { useEffect, useState } from 'react';
import { Panel, Button, Badge } from '../../components/ui';
import { readSuiteHealth } from '../../lib/suite-health';
import { UpgradesPanel } from '../../components/upgrades';
type Status = Awaited<ReturnType<typeof readSuiteHealth>>;
export default function SuiteOverview() {
  const [rows, setRows] = useState<Status>([]),
    [busy, setBusy] = useState(false);
  async function refresh() {
    setBusy(true);
    try {
      setRows(await readSuiteHealth());
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  return (
    <>
      <div className="page-head">
        <div>
          <h2>Installation overview</h2>
          <p>Independent products connected through your Oathweave identity.</p>
        </div>
        <Button loading={busy} onClick={() => void refresh()}>
          Check readiness
        </Button>
      </div>
      <Panel title="Products">
        <div className="check-list">
          {rows.map((row) => (
            <div className="check-row" key={row.product}>
              <div>
                <strong>{row.name}</strong>
                <span>
                  {row.message}
                  {row.latencyMs !== undefined ? ` · ${row.latencyMs} ms` : ''}
                </span>
              </div>
              <Badge
                tone={row.state === 'ready' ? 'success' : 'warning'}
              >
                {row.state}
              </Badge>
            </div>
          ))}
        </div>
        <p>
          Readiness checks verify service availability. Migration and workflow
          acceptance are recorded separately by the Hive controller.
        </p>
      </Panel>
      <UpgradesPanel canUpgrade={false} />
    </>
  );
}
