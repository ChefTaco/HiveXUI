import { useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import type { ApiDoc } from '../lib/types';
import {
  Badge,
  Button,
  Drawer,
  EmptyState,
  JsonBlock,
  Panel,
} from '../components/ui';
import { Icon } from '../components/icons';
import { viewAvailable } from '../lib/navigation';
import { RegistryProducts } from '../components/registry-products';
import { browserIdentity, productInstalled } from '../lib/runtime';

const SUITE_RUNBOOKS = [
  {
    title: 'Installation health',
    symptom: 'A configured product is unavailable',
    action:
      'Inspect product readiness and the installation inventory. Repair the owning service through its operator workflow.',
    command: './hive.sh doctor --config installation.json',
    target: 'hive',
  },
  {
    title: 'Verified backup',
    symptom: 'Prepare for maintenance or recovery',
    action:
      'Create an installation-bound backup and rehearse restoration in isolation before activation.',
    command: './hive.sh backup --config installation.json',
    target: 'hive',
  },
  {
    title: 'Recoverable rollback',
    symptom: 'A release fails readiness or workflow checks',
    action:
      'Review the retained release and storage compatibility. Reconcile writes before any data restore.',
    command: './hive.sh rollback --config installation.json --release VERSION',
    target: 'hive',
  },
  {
    title: 'Identity recovery',
    symptom: 'A password is expired or a second factor is unavailable',
    action:
      'Use Oathweave password recovery or a saved recovery code. If delivery is unavailable, contact the identity administrator; host login does not bypass product authorization.',
    command: 'Oathweave sign-in → Forgot password?',
    target: 'account',
  },
  {
    title: 'External provider unavailable',
    symptom: 'Model discovery, generation or streaming fails',
    action:
      'Inspect the external provider and its protected credential reference. Hive verifies endpoints; the provider operator manages inference services and models.',
    command: './hive.sh doctor --config installation.json',
    target: 'providers',
  },
] as const;

const RUNBOOKS = [
  {
    title: 'Secret rotation',
    symptom: 'Planned credential change or suspected exposure',
    action:
      'Run a dry-run rotation, review the redacted plan, then apply during a maintenance window.',
    command: 'npm run rotate:secrets -- --host hive --kind all',
    target: 'settings',
  },
  {
    title: 'Rollback',
    symptom: 'Router deploy fails health or the UI regresses after release',
    action:
      'Roll Router back to the previous retained release, then verify readiness and audit drift.',
    command: 'npm run deploy -- --rollback',
    target: 'routers',
  },
  {
    title: 'Dependency degraded',
    symptom:
      'IAM Redis, Memory Qdrant, provider health, or SQLite checks are degraded',
    action:
      'Open the service page, inspect failing checks, repair the dependency, then restart only the affected service.',
    command: 'npm run audit:deployments',
    target: 'hive',
  },
  {
    title: 'Certificate warning',
    symptom:
      'TLS cert is expired, near expiry, or does not match the public FQDN',
    action:
      'Redeploy Router with the expected certificate domain and verify the parsed TLS details.',
    command: 'HIVE_ROUTER_CERT_DOMAIN=hive.example.com npm run deploy:router',
    target: 'hive',
  },
  {
    title: 'Memory queue backlog',
    symptom: 'HiveMem queue or worker checks show warn/fail',
    action:
      'Open Memory, inspect queue state, retry or cancel stuck jobs, and check Qdrant before restarting HiveMem.',
    command: 'curl --fail https://hive.example.com/v1/health/dependencies',
    target: 'memories',
  },
  {
    title: 'IAM lockout',
    symptom:
      'Operator cannot sign in or sessions are failing step-up/auth checks',
    action:
      'Use OS/PAM break-glass login, inspect IAM sessions/audit, then reset the admin password only if needed.',
    command: 'IAM_RESET_PASSWORD=<known-password> npm run reset:admin',
    target: 'iam-sessions',
  },
] as const;

function methodTone(
  method?: string,
): 'success' | 'info' | 'warning' | 'danger' | 'neutral' {
  switch ((method ?? '').toUpperCase()) {
    case 'GET':
      return 'info';
    case 'POST':
      return 'success';
    case 'PUT':
    case 'PATCH':
      return 'warning';
    case 'DELETE':
      return 'danger';
    default:
      return 'neutral';
  }
}

export function DocsPage({
  onNavigate,
}: {
  onNavigate?: (view: string) => void;
}) {
  const { data } = useStore();
  const endpoints = productInstalled('emberpath');
  const runbooks = (browserIdentity() ? SUITE_RUNBOOKS : RUNBOOKS).filter(
    (runbook) => viewAvailable(runbook.target, productInstalled),
  );
  const [selected, setSelected] = useState<ApiDoc | null>(null);

  const grouped = useMemo(() => {
    const map = new Map<string, ApiDoc[]>();
    for (const doc of data.docs) {
      const scope = doc.scope ?? 'general';
      const list = map.get(scope) ?? [];
      list.push(doc);
      map.set(scope, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [data.docs]);

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Docs</h2>
          <p>
            {endpoints
              ? 'Runbooks and endpoint surface grouped by scope.'
              : 'Runbooks for operating this installation.'}
          </p>
        </div>
      </div>

      <Panel title="Operator Runbooks" eyebrow={`${runbooks.length} workflows`}>
        <div className="runbook-grid">
          {runbooks.map((runbook) => (
            <article className="runbook-card" key={runbook.title}>
              <div>
                <h3>{runbook.title}</h3>
                <p>{runbook.symptom}</p>
              </div>
              <p className="runbook-action">{runbook.action}</p>
              <code>{runbook.command}</code>
              {onNavigate ? (
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() => onNavigate(runbook.target)}
                >
                  Open
                </button>
              ) : null}
            </article>
          ))}
        </div>
      </Panel>

      <RegistryProducts title="Product links" />

      {!endpoints ? null : data.docs.length === 0 ? (
        <Panel title="Endpoints" eyebrow="0 documented">
          <EmptyState
            icon={<Icon.Book width={34} height={34} />}
            message="No API documentation available."
          />
        </Panel>
      ) : (
        grouped.map(([scope, docs]) => (
          <Panel key={scope} title={scope} eyebrow={`${docs.length} endpoints`}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Method</th>
                    <th>Path</th>
                    <th>Summary</th>
                  </tr>
                </thead>
                <tbody>
                  {docs.map((doc, i) => (
                    <tr
                      key={`${scope}-${doc.method}-${doc.route}-${i}`}
                      className="row-clickable"
                      onClick={() => setSelected(doc)}
                    >
                      <td>
                        <Badge tone={methodTone(doc.method)}>
                          {doc.method ?? '—'}
                        </Badge>
                      </td>
                      <td className="cell-mono">
                        {doc.route}
                      </td>
                      <td>{doc.summary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        ))
      )}

      <Drawer
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        eyebrow={selected?.method ?? 'Endpoint'}
        title={selected?.route ?? ''}
        footer={
          <Button variant="ghost" onClick={() => setSelected(null)}>
            Close
          </Button>
        }
      >
        {selected ? (
          <>
            {selected.summary ? (
              <p>
                {selected.summary}
              </p>
            ) : null}
            <p className="panel-eyebrow mt-4">
              Definition
            </p>
            <JsonBlock value={selected} />
          </>
        ) : null}
      </Drawer>
    </>
  );
}
